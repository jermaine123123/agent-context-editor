import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { normalizeSessionEntries } from "./normalize.js";
import { readLatestState, STATE_ENTRY_TYPE } from "./state.js";
import { runDesktopContextEditor } from "./desktop-ui.js";
import { ContextEditorComponent } from "./ui.js";
import { PiContextEditorHost } from "./host.js";
import type { ContextEditorStateV1 } from "./types.js";
import { createPiText, detectPiLocale } from "./locale.js";

function sourceLeafId(ctx: ExtensionContext): string | undefined {
  return ctx.sessionManager.getLeafId() ?? undefined;
}

export default function contextEditorExtension(pi: ExtensionAPI): void {
  pi.registerCommand("ctx", {
    description: "Inspect the active Pi context (usage: /ctx)",
    handler: async (_args, ctx) => {
      const locale = detectPiLocale();
      const text = createPiText(locale);
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
            locale,
            confirm: () => ctx.ui.confirm(text.restoreAllConfirmTitle(), text.restoreAllConfirmMessage()),
          },
          () => done(undefined),
        ),
      );
    },
  });
}
