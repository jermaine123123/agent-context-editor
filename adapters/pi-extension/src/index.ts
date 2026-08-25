import type { ContextEvent, ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent, SessionBeforeTreeEvent } from "@earendil-works/pi-coding-agent";
import { normalizeSessionEntries } from "./normalize.js";
import { readLatestState, STATE_ENTRY_TYPE } from "./state.js";
import { runDesktopContextEditor } from "./desktop-ui.js";
import { ContextEditorComponent } from "./ui.js";
import { PiContextEditorHost } from "./host.js";
import type { ContextEditorStateV1 } from "./types.js";
import { detectPiLocale } from "./locale.js";
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
        if (ctx.hasUI) ctx.ui.notify("Compaction cancelled because it would summarize excluded context.", "warning");
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
        if (ctx.hasUI) ctx.ui.notify("Branch summary cancelled because it would summarize excluded context.", "warning");
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

      const host = new PiContextEditorHost(ctx);
      const records = host.records();
      if (records.length === 0) {
        ctx.ui.notify("There are no editable context records in the active branch.", "info");
        return;
      }
      const snapshot = host.snapshot();
      const locator = { host: "pi", sessionId: host.sessionId };
      const prefs = host.getPrefs();
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
            undo: (baseRevision) => host.undo(baseRevision),
            persistPrefs: (nextPrefs) => host.setPrefs(nextPrefs),
            notify: (message, type = "info") => ctx.ui.notify(message, type),
            locale,
          },
          () => done(undefined),
        ),
      );
    },
  });
}
