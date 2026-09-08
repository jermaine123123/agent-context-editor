import type { ContextEvent, ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeTreeEvent } from "@earendil-works/pi-coding-agent";
import { normalizeSessionEntries } from "./normalize.js";
import { readLatestState, STATE_ENTRY_TYPE } from "./state.js";
import { runDesktopContextEditor } from "./desktop-ui.js";
import { ContextEditorComponent, type ContextEditorExit, type ContextEditorUiState, type ReplacementReview } from "./ui.js";
import { PiContextEditorHost } from "./host.js";
import type { ContextEditorStateV1 } from "./types.js";
import { createPiText, detectPiLocale } from "./locale.js";
import { projectModelContext, projectionOverlapsEntryIds } from "./projection-hook.js";

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
  const ids = new Set<string>();
  const first = event.branchEntries.findIndex((entry) => entry.id === event.preparation.firstKeptEntryId);
  if (first < 0) return ids;
  for (let index = 0; index < first; index += 1) {
    const entry = event.branchEntries[index];
    if (entry) ids.add(entry.id);
  }
  if (event.preparation.turnPrefixMessages.length > 0) {
    const entry = event.branchEntries[first];
    if (entry) ids.add(entry.id);
  }
  return ids;
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
      const current = new PiContextEditorHost(ctx).read();
      if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
      const ids = projectionEntryIdsBeforeFirstKept(event);
      if (ids.size > 0 && projectionSummaryOverlap(ctx, event.branchEntries, ids)) {
        if (ctx.hasUI) ctx.ui.notify("Compaction cancelled because it would summarize edited or excluded context.", "warning");
        return { cancel: true };
      }
    } catch (error) {
      notifyProjectionFailure(ctx, error);
      return { cancel: true };
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
      const text = createPiText(locale);
      while (true) {
        const host = new PiContextEditorHost(ctx);
        const records = host.records();
        if (records.length === 0) {
          ctx.ui.notify("There are no editable context records in the active branch.", "info");
          break;
        }
        const snapshot = host.snapshot();
        const locator = { host: "pi", sessionId: host.sessionId };
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
              restoreReplacement: (input) => host.restoreReplacementMutation(input),
              undoReplacement: (input) => host.undoReplacementMutation(input),
              undo: (baseRevision) => host.undo(baseRevision),
              persistPrefs: (nextPrefs) => host.setPrefs(nextPrefs),
              notify: (message, type = "info") => ctx.ui.notify(message, type),
              isIdle: () => ctx.isIdle(),
              initialUiState: uiState,
              initialReplacementReview: replacementReview,
              locale,
            },
            (result) => { exit = result; done(undefined); },
          ),
        );
        if (!exit || exit.kind === "close") break;
        uiState = exit.uiState;
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
