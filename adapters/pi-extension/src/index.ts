import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeSessionEntries } from "./normalize.js";
import { readLatestState, STATE_ENTRY_TYPE } from "./state.js";
import {
  buildToolOutputActions,
  projectToolOutputs,
  toolOutputProtection,
} from "./projection.js";
import { runDesktopContextEditor } from "./desktop-ui.js";
import { ContextEditorComponent } from "./ui.js";
import { PiContextEditorHost } from "./host.js";
import type { ContextEditorStateV1 } from "./types.js";

function sourceLeafId(ctx: ExtensionContext): string | undefined {
  return ctx.sessionManager.getLeafId() ?? undefined;
}

export default function contextEditorExtension(pi: ExtensionAPI): void {
  let activeState: ContextEditorStateV1 | undefined;

  const restoreState = (ctx: ExtensionContext): void => {
    activeState = readLatestState(ctx.sessionManager.getBranch());
  };

  pi.on("session_start", async (_event, ctx) => {
    restoreState(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restoreState(ctx);
  });

  pi.on("context", async (event, ctx) => {
    if (!activeState) return;

    const currentAtoms = normalizeSessionEntries(ctx.sessionManager.buildContextEntries());
    const actions = buildToolOutputActions(currentAtoms, activeState, 2);
    if (actions.length === 0) return;

    const result = projectToolOutputs(event.messages, actions);
    if (result.skippedToolCallIds.length > 0) {
      ctx.ui.notify(
        `Context Editor skipped ${result.skippedToolCallIds.length} changed Tool Output(s) to preserve safety.`,
        "warning",
      );
    }
    if (result.appliedToolCallIds.length === 0) return;
    return { messages: result.messages };
  });

  pi.registerCommand("ctx", {
    description: "Inspect the active Pi context (usage: /ctx)",
    handler: async (_args, ctx) => {
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
      activeState = state;

      if (ctx.mode === "rpc") {
        await runDesktopContextEditor({
          ui: ctx.ui,
          atoms,
          initialState: state,
          sourceLeafId: leafId,
          persistState: (nextState: ContextEditorStateV1) => {
            activeState = nextState;
            pi.appendEntry(STATE_ENTRY_TYPE, nextState);
          },
          validateAtom: (atom) => {
            const freshAtoms = normalizeSessionEntries(ctx.sessionManager.buildContextEntries());
            const fresh = freshAtoms.find((candidate) => candidate.id === atom.id);
            return Boolean(
              fresh &&
                fresh.fingerprint === atom.fingerprint &&
                fresh.sourceRef.entryId === atom.sourceRef.entryId &&
                fresh.sourceRef.blockIndex === atom.sourceRef.blockIndex,
            );
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
      const snapshot = host.snapshot();
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
            undo: (baseRevision) => host.undo(baseRevision),
            persistPrefs: (nextPrefs) => host.setPrefs(nextPrefs),
            notify: (message, type = "info") => ctx.ui.notify(message, type),
          },
          () => done(undefined),
        ),
      );
    },
  });
}
