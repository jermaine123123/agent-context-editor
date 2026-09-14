import { sessionEntryToContextMessages, type ContextEvent, type ExtensionAPI, type ExtensionContext, type FileOperations, type SessionBeforeCompactEvent, type SessionBeforeTreeEvent } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeSessionEntries } from "./normalize.js";
import { readLatestState, STATE_ENTRY_TYPE } from "./state.js";
import { runDesktopContextEditor } from "./desktop-ui.js";
import { ContextEditorComponent, type ContextEditorExit, type ContextEditorUiState, type ReplacementReview, type CondensationReview } from "./ui.js";
import { PiContextEditorHost } from "./host.js";
import type { ContextEditorStateV1 } from "./types.js";
import { estimateCondensationTokens, frameCondensationSummary, validateCondensationSummary, stableFingerprint } from "./shared-core/index.js";
import { createPiText, detectPiLocale } from "./locale.js";
import { projectModelContext, projectionOverlapsEntryIds } from "./projection-hook.js";
import { inferPiShadowedEntryIds, nativeCompactionPreparationId, piCompactionCheckpointEntryId, readNativeCompactionSidecar, reconcileNativeCompactionEntry, upsertNativeCompactionEvidence } from "./native-compaction-sidecar.js";

function sourceLeafId(ctx: ExtensionContext): string | undefined {
  return ctx.sessionManager.getLeafId() ?? undefined;
}

function notifyProjectionFailure(ctx: ExtensionContext, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (ctx.hasUI) ctx.ui.notify("Context projection blocked this operation: " + message, "error");
}

function projectionEntryIdsBeforeFirstKept(
  event: SessionBeforeCompactEvent,
): Set<string> {
  return new Set(inferPiShadowedEntryIds(
    event.branchEntries,
    event.preparation.firstKeptEntryId,
    event.preparation.turnPrefixMessages.length > 0,
  ));
}

function messageMatches(left: AgentMessage, right: AgentMessage): boolean {
  if (left === right) return true;
  const a = left as unknown as Record<string, unknown>;
  const b = right as unknown as Record<string, unknown>;
  return String(a.role ?? "") === String(b.role ?? "")
    && JSON.stringify(a.content) === JSON.stringify(b.content)
    && String(a.toolCallId ?? "") === String(b.toolCallId ?? "")
    && String(a.toolName ?? "") === String(b.toolName ?? "");
}

function entryIdsForMessages(messages: readonly AgentMessage[], entries: readonly unknown[]): string[] {
  const used = new Set<string>();
  const result: string[] = [];
  for (const message of messages) {
    const matches = entries.filter(entry => {
      const id = String((entry as { id?: unknown }).id ?? "");
      if (!id || used.has(id)) return false;
      return sessionEntryToContextMessages(entry as never).some(candidate => messageMatches(message, candidate as AgentMessage));
    });
    if (matches.length !== 1) throw new Error("CONTEXT_EDITOR_COMPACTION_ALIGNMENT_UNAVAILABLE");
    const match = matches[0];
    const id = String((match as { id?: unknown } | undefined)?.id ?? "");
    if (id) {
      used.add(id);
      result.push(id);
    }
  }
  return result;
}

function projectCompactionMessages(
  messages: readonly AgentMessage[],
  entries: readonly unknown[],
  atoms: ReturnType<typeof normalizeSessionEntries>,
  projectionEvents: Parameters<typeof projectModelContext>[0]["projectionEvents"],
): AgentMessage[] {
  if (messages.length === 0 || projectionEvents.length === 0) return [...messages];
  const entryIds = entryIdsForMessages(messages, entries);
  if (entryIds.length !== messages.length) throw new Error("CONTEXT_EDITOR_COMPACTION_ALIGNMENT_UNAVAILABLE");
  const selected = entries.filter(entry => entryIds.includes(String((entry as { id?: unknown }).id ?? "")));
  return projectModelContext({ messages: [...messages], entries: selected, atoms, projectionEvents });
}

type PiFileOps = { read: Set<string>; written: Set<string>; edited: Set<string> };

function createPiFileOps(): PiFileOps {
  return { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() };
}

function extractPiFileOps(messages: readonly AgentMessage[], fileOps: PiFileOps): void {
  for (const message of messages) {
    const row = message as unknown as { role?: unknown; content?: unknown };
    if (row.role !== "assistant" || !Array.isArray(row.content)) continue;
    for (const block of row.content) {
      if (!block || typeof block !== "object") continue;
      const item = block as { type?: unknown; name?: unknown; arguments?: unknown };
      if (item.type !== "toolCall" || !item.arguments || typeof item.arguments !== "object") continue;
      const args = item.arguments as { path?: unknown };
      const path = typeof args.path === "string" && args.path.length > 0 ? args.path : undefined;
      if (!path) continue;
      if (item.name === "read") fileOps.read.add(path);
      else if (item.name === "write") fileOps.written.add(path);
      else if (item.name === "edit") fileOps.edited.add(path);
    }
  }
}

function previousPiCompactionFileOps(branchEntries: readonly unknown[], firstKeptEntryId: string): PiFileOps {
  const result = createPiFileOps();
  const rows = branchEntries as Array<{ id?: unknown; type?: unknown; fromHook?: unknown; details?: unknown }>;
  const firstKeptIndex = rows.findIndex(entry => String(entry.id ?? "") === firstKeptEntryId);
  for (let index = firstKeptIndex - 1; index >= 0; index -= 1) {
    const entry = rows[index];
    if (entry?.type !== "compaction" || entry.fromHook === true || !entry.details || typeof entry.details !== "object") continue;
    const details = entry.details as { readFiles?: unknown; modifiedFiles?: unknown };
    if (Array.isArray(details.readFiles)) for (const path of details.readFiles) if (typeof path === "string" && path) result.read.add(path);
    if (Array.isArray(details.modifiedFiles)) for (const path of details.modifiedFiles) if (typeof path === "string" && path) result.edited.add(path);
    break;
  }
  return result;
}

function projectPreparationFileOps(
  preparationFileOps: FileOperations,
  branchEntries: readonly unknown[],
  firstKeptEntryId: string,
  beforeMessages: readonly AgentMessage[],
  beforePrefixMessages: readonly AgentMessage[],
  afterMessages: readonly AgentMessage[],
  afterPrefixMessages: readonly AgentMessage[],
): FileOperations {
  const before = createPiFileOps();
  extractPiFileOps(beforeMessages, before);
  extractPiFileOps(beforePrefixMessages, before);
  const after = createPiFileOps();
  extractPiFileOps(afterMessages, after);
  extractPiFileOps(afterPrefixMessages, after);
  const previous = previousPiCompactionFileOps(branchEntries, firstKeptEntryId);
  const result: PiFileOps = {
    read: new Set(preparationFileOps.read ?? []),
    written: new Set(preparationFileOps.written ?? []),
    edited: new Set(preparationFileOps.edited ?? []),
  };
  for (const key of ["read", "written", "edited"] as const) {
    for (const path of before[key]) {
      if (!after[key].has(path) && !previous[key].has(path)) result[key].delete(path);
    }
    for (const path of after[key]) result[key].add(path);
    for (const path of previous[key]) result[key].add(path);
  }
  return result;
}
function projectionSummaryOverlap(
  ctx: ExtensionContext,
  entries: readonly unknown[],
  entryIds: ReadonlySet<string>,
): boolean {
  const host = new PiContextEditorHost(ctx);
  const current = host.read();
  if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
  const atoms = normalizeSessionEntries(entries);
  return projectionOverlapsEntryIds(entryIds, atoms, current.projectionEvents ?? []);
}

function reconcilePendingNativeCompactions(ctx: ExtensionContext): void {
  const host = new PiContextEditorHost(ctx);
  const native = readNativeCompactionSidecar(host.sessionFile, host.sessionId);
  if (native.integrity === "invalid") return;
  const branchEntries = ctx.sessionManager.getBranch() as unknown[];
  for (const entry of branchEntries) {
    if ((entry as { type?: unknown }).type !== "compaction") continue;
    const compaction = entry as { id?: unknown; firstKeptEntryId?: unknown; parentId?: unknown };
    const firstKeptEntryId = String(compaction.firstKeptEntryId ?? "");
    const pending = native.document.events
      .filter(item => item.firstKeptEntryId === firstKeptEntryId && !item.committed)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!pending) continue;
    upsertNativeCompactionEvidence(host.sessionFile, host.sessionId, reconcileNativeCompactionEntry(branchEntries, compaction, pending));
  }
}
function registerProjectionHooks(pi: ExtensionAPI): void {
  pi.on("context", async (event: ContextEvent, ctx) => {
    try {
      const host = new PiContextEditorHost(ctx);
      const current = host.read();
      if (!current.projectionEvents?.length && current.projectionAvailable !== false) return;
      if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
      const entries = ctx.sessionManager.buildContextEntries();
      const atoms = normalizeSessionEntries(entries);
      const messages = projectModelContext({
        messages: event.messages,
        entries,
        atoms,
        projectionEvents: current.projectionEvents ?? [],
      });
      return { messages };
    } catch (error) {
      notifyProjectionFailure(ctx, error);
      ctx.abort();
      return { messages: [] };
    }
  });

  pi.on("session_before_compact", async (event: SessionBeforeCompactEvent, ctx) => {
    try {
      const host = new PiContextEditorHost(ctx);
      const current = host.read();
      if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
      if (current.nativeCompactionAvailable === false) throw new Error(current.nativeCompactionError || "CONTEXT_EDITOR_NATIVE_COMPACTION_UNAVAILABLE");
      const projectionEvents = current.projectionEvents ?? [];
      if (projectionEvents.length === 0) return;

      const shadowedEntryIds = [...projectionEntryIdsBeforeFirstKept(event)];
      if (shadowedEntryIds.length === 0) throw new Error("CONTEXT_EDITOR_COMPACTION_ALIGNMENT_UNAVAILABLE");
      const sourceFingerprint = stableFingerprint([
        event.preparation.firstKeptEntryId,
        ...shadowedEntryIds,
        JSON.stringify(event.preparation.messagesToSummarize),
        JSON.stringify(event.preparation.turnPrefixMessages),
      ]);
      const preparedRevision = current.revision;
      const preparationId = nativeCompactionPreparationId({
        sessionId: host.sessionId,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        shadowedEntryIds,
        preparedRevision,
        sourceFingerprint,
      });
      const checkpointEntryId = piCompactionCheckpointEntryId(event.branchEntries);
      const atoms = normalizeSessionEntries(event.branchEntries);
      const preparation = event.preparation as typeof event.preparation & {
        messagesToSummarize: AgentMessage[];
        turnPrefixMessages: AgentMessage[];
        fileOps: FileOperations;
      };
      const beforeMessages = [...preparation.messagesToSummarize];
      const beforePrefixMessages = [...preparation.turnPrefixMessages];
      const projectedMessages = projectCompactionMessages(
        beforeMessages,
        event.branchEntries,
        atoms,
        projectionEvents,
      );
      const projectedPrefixMessages = projectCompactionMessages(
        beforePrefixMessages,
        event.branchEntries,
        atoms,
        projectionEvents,
      );
      preparation.messagesToSummarize = projectedMessages;
      preparation.turnPrefixMessages = projectedPrefixMessages;
      preparation.fileOps = projectPreparationFileOps(
        preparation.fileOps,
        event.branchEntries,
        event.preparation.firstKeptEntryId,
        beforeMessages,
        beforePrefixMessages,
        projectedMessages,
        projectedPrefixMessages,
      );
      upsertNativeCompactionEvidence(host.sessionFile, host.sessionId, {
        schemaVersion: 1,
        sessionId: host.sessionId,
        preparationId,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        shadowedEntryIds,
        ...(checkpointEntryId ? { checkpointEntryId } : {}),
        preparedRevision,
        sourceFingerprint,
        reason: event.reason,
        committed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      notifyProjectionFailure(ctx, error);
      return { cancel: true };
    }
  });

  pi.on("session_compact", async (event, ctx) => {
    try {
      const host = new PiContextEditorHost(ctx);
      const native = readNativeCompactionSidecar(host.sessionFile, host.sessionId);
      if (native.integrity === "invalid") throw new Error(native.error || "CONTEXT_EDITOR_NATIVE_COMPACTION_UNAVAILABLE");
      const branchEntries = ctx.sessionManager.getBranch() as unknown[];
      const firstKeptEntryId = String(event.compactionEntry.firstKeptEntryId ?? "");
      const pending = native.document.events
        .filter(item => item.firstKeptEntryId === firstKeptEntryId && !item.committed)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (!pending) return;
      upsertNativeCompactionEvidence(
        host.sessionFile,
        host.sessionId,
        reconcileNativeCompactionEntry(branchEntries, event.compactionEntry, pending),
      );
    } catch (error) {
      notifyProjectionFailure(ctx, error);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    try {
      reconcilePendingNativeCompactions(ctx);
    } catch (error) {
      notifyProjectionFailure(ctx, error);
    }
  });
  pi.on("session_tree", async (_event, ctx) => {
    try {
      reconcilePendingNativeCompactions(ctx);
    } catch (error) {
      notifyProjectionFailure(ctx, error);
    }
  });
  pi.on("session_before_tree", async (event: SessionBeforeTreeEvent, ctx) => {
    if (!event.preparation.userWantsSummary) return;
    try {
      const current = new PiContextEditorHost(ctx).read();
      if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
      const ids = new Set(event.preparation.entriesToSummarize.map((entry) => entry.id));
      if (ids.size > 0 && projectionSummaryOverlap(ctx, event.preparation.entriesToSummarize, ids)) {
        if (ctx.hasUI) ctx.ui.notify("Branch summary cancelled because it would summarize edited or excluded context.", "warning");
        return { cancel: true };
      }
    } catch (error) {
      notifyProjectionFailure(ctx, error);
      return { cancel: true };
    }
  });
}
export default function contextEditorExtension(pi: ExtensionAPI): void {
  registerProjectionHooks(pi);
  pi.registerCommand("ctx", {
    description: "Inspect the active Pi context (usage: /ctx)",
    handler: async (_args, ctx) => {
      const locale = detectPiLocale();
      if (ctx.mode === "json" || ctx.mode === "print") {
        ctx.ui.notify("/ctx requires interactive Pi TUI or Pi Desktop mode.", "warning");
        return;
      }

      const entries = ctx.sessionManager.buildContextEntries();
      const atoms = normalizeSessionEntries(entries);
      if (atoms.length === 0) {
        ctx.ui.notify("There is no active context to inspect.", "info");
        return;
      }

      const leafId = sourceLeafId(ctx);
      const state = readLatestState(ctx.sessionManager.getBranch());

      if (ctx.mode === "rpc") {
        await runDesktopContextEditor({
          ui: ctx.ui,
          atoms,
          initialState: state,
          sourceLeafId: leafId,
          locale,
          persistState: (nextState: ContextEditorStateV1) => {
            pi.appendEntry(STATE_ENTRY_TYPE, nextState);
          },
        });
        return;
      }

      if (ctx.mode !== "tui") {
        ctx.ui.notify("/ctx requires interactive Pi TUI or Pi Desktop mode.", "warning");
        return;
      }

      let uiState: ContextEditorUiState | undefined;
      let replacementReview: ReplacementReview | undefined;
      let condensationReview: CondensationReview | undefined;
      const text = createPiText(locale);
      const host = new PiContextEditorHost(ctx);
      const locator = { host: "pi", sessionId: host.sessionId };
      while (true) {
        const records = host.records();
        if (records.length === 0) {
          ctx.ui.notify("There are no editable context records in the active branch.", "info");
          break;
        }
        const snapshot = host.snapshot();
        const prefs = host.getPrefs();
        let exit: ContextEditorExit | undefined;
        await ctx.ui.custom((tui, theme, _keybindings, done) =>
          new ContextEditorComponent(
            tui,
            theme,
            records,
            snapshot,
            prefs,
            {
              loadRecords: () => host.records(),
              loadSnapshot: () => host.snapshot(),
              mutate: (input) => host.commit(input),
              previewContext: (input) => host.previewContext({ locator, ...input }),
              commitContext: (input) => host.commitContext({ locator, ...input }),
              previewReplacement: (input) => host.previewReplacementMutation(input),
              commitReplacement: (input) => host.commitReplacementMutation(input),
              generateCondensation: (input) => host.generateCondensation({ locator, ...input }),
              cancelCondensation: (operationId) => host.cancelCondensation({ locator, operationId }),
              commitCondensation: (input) => host.commitCondensation({ locator, ...input }),
              restoreCondensation: (input) => host.restoreCondensation({ locator, ...input }),
              restoreReplacement: (input) => host.restoreReplacementMutation(input),
              undoReplacement: (input) => host.undoReplacementMutation(input),
              undo: (baseRevision) => host.undo(baseRevision),
              persistPrefs: (nextPrefs) => host.setPrefs(nextPrefs),
              notify: (message, type = "info") => ctx.ui.notify(message, type),
              isIdle: () => ctx.isIdle(),
              initialUiState: uiState,
              initialReplacementReview: replacementReview,
              initialCondensationReview: condensationReview,
              locale,
            },
            (result) => { exit = result; done(undefined); },
          ),
        );
        if (!exit || exit.kind === "close") break;
        uiState = exit.uiState;
        if (exit.kind === "condensation-cancel") {
          condensationReview = undefined;
          if (exit.operationId) {
            try { await host.cancelCondensation({ locator, operationId: exit.operationId }); } catch { /* candidate already gone */ }
          }
          continue;
        }
        if (exit.kind === "condensation-commit") {
          const review = exit.review;
          condensationReview = undefined;
          try {
            const result = await host.commitCondensation({
              locator,
              baseRevision: review.draft.baseRevision,
              operationId: review.draft.operationId,
              summary: review.preview.summary,
              unitIds: review.draft.unitIds,
            });
            if (!result.ok || result.conflict) ctx.ui.notify(text.sidecarChanged(), "warning");
            else ctx.ui.notify(text.condensationApplied(), "info");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(text.condensationBlocked(message), "warning");
          }
          continue;
        }
        if (exit.kind === "condensation-edit") {
          const review = exit.review;
          let value: string | undefined;
          try {
            value = await ctx.ui.editor(text.condensationSummaryTitle(), review.preview.summary);
          } catch (error) {
            ctx.ui.notify("Editor failed: " + (error instanceof Error ? error.message : String(error)), "warning");
            condensationReview = review;
            continue;
          }
          if (value === undefined) {
            condensationReview = review;
            continue;
          }
          const summary = value.trim();
          const summaryTokens = estimateCondensationTokens(frameCondensationSummary(summary));
          const validation = validateCondensationSummary(summary, review.preview.metrics.beforeTokens, { summaryTokens });
          if (!validation.ok) {
            ctx.ui.notify(text.condensationBlocked(validation.error ?? "invalid-summary"), "warning");
            condensationReview = review;
            continue;
          }
          condensationReview = {
            ...review,
            preview: {
              ...review.preview,
              summary,
              summaryTokens,
              metrics: validation.metrics,
              validation,
              warnings: validation.warnings,
            },
          };
          continue;
        }
        if (exit.kind === "cancel-edit") {
          replacementReview = undefined;
          continue;
        }
        if (exit.kind === "replacement-commit") {
          const review = exit.review;
          replacementReview = undefined;
          try {
            const result = host.commitReplacementMutation({
              baseRevision: review.draft.baseRevision,
              operationId: review.draft.operationId,
              unitId: review.draft.unitId,
              text: review.draft.text,
              excludeAssociatedReasoning: review.excludeAssociatedReasoning,
              confirmedUnitIds: review.preview.effectiveUnitIds,
              confirmationScope: review.preview.effectiveUnitIds,
            });
            if (!result.ok || result.conflict) ctx.ui.notify(text.sidecarChanged(), "warning");
            else if (!result.eventId) ctx.ui.notify(text.replacementReviewNoop(), "info");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(message === "CONTEXT_EDITOR_REPLACEMENT_EMPTY" ? text.replacementReviewBlocked(text.replacementEmpty()) : text.operationFailed(message), "warning");
          }
          continue;
        }
        if (exit.kind !== "edit") continue;
        replacementReview = undefined;
        let value: string | undefined;
        try {
          value = await ctx.ui.editor(exit.title, exit.text);
        } catch (error) {
          ctx.ui.notify("Editor failed: " + (error instanceof Error ? error.message : String(error)), "warning");
          continue;
        }
        if (value === undefined) continue;
        try {
          const linkRequested = exit.excludeAssociatedReasoning ?? exit.unitKind === "answer";
          const preview = host.previewReplacementMutation({
            baseRevision: exit.baseRevision,
            operationId: exit.operationId,
            unitId: exit.unitId,
            text: value,
            excludeAssociatedReasoning: linkRequested,
          });
          const draft = {
            unitId: exit.unitId,
            title: exit.title,
            text: value,
            originalText: exit.originalText,
            baseRevision: exit.baseRevision,
            operationId: exit.operationId,
            unitKind: exit.unitKind,
            uiState: exit.uiState,
          } as const;
          if (!preview.canCommit && exit.unitKind === "answer" && linkRequested && preview.associatedReasoningUnitIds.length > 0) {
            const standalonePreview = host.previewReplacementMutation({
              baseRevision: exit.baseRevision,
              operationId: exit.operationId,
              unitId: exit.unitId,
              text: value,
              excludeAssociatedReasoning: false,
            });
            if (standalonePreview.canCommit && (preview.textChanged || preview.newlyExcludedAtomIds.length > 0)) {
              replacementReview = { draft, preview, excludeAssociatedReasoning: true };
              continue;
            }
          }
          if (!preview.canCommit) {
            ctx.ui.notify(text.replacementReviewBlocked(preview.disabledReason ?? "unavailable"), "warning");
            continue;
          }
          if (!preview.textChanged && preview.newlyExcludedAtomIds.length === 0) {
            ctx.ui.notify(text.replacementReviewNoop(), "info");
            continue;
          }
          if (exit.unitKind === "answer" && preview.associatedReasoningUnitIds.length > 0) {
            replacementReview = { draft, preview, excludeAssociatedReasoning: linkRequested };
            continue;
          }
          const result = host.commitReplacementMutation({
            baseRevision: exit.baseRevision,
            operationId: exit.operationId,
            unitId: exit.unitId,
            text: value,
            excludeAssociatedReasoning: false,
          });
          if (!result.ok || result.conflict) ctx.ui.notify(text.sidecarChanged(), "warning");
          else if (!result.eventId) ctx.ui.notify(text.replacementReviewNoop(), "info");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "CONTEXT_EDITOR_CONFLICT") ctx.ui.notify(text.sidecarChanged(), "warning");
          else if (message === "CONTEXT_EDITOR_REPLACEMENT_EMPTY") ctx.ui.notify(text.replacementReviewBlocked(text.replacementEmpty()), "warning");
          else ctx.ui.notify(text.operationFailed(message), "warning");
        }
      }
    },
  });
}
