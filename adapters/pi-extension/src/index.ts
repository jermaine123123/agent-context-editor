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
          persistState: (nextState) => {
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

      await ctx.ui.custom((tui, theme, _keybindings, done) =>
        new ContextEditorComponent(
          tui,
          theme,
          atoms,
          state,
          leafId,
          (nextState) => {
            activeState = nextState;
            pi.appendEntry(STATE_ENTRY_TYPE, nextState);
          },
          async (atom, nextState) => {
            if (nextState === "keep") {
              return true;
            }
            const protection = toolOutputProtection(atoms, atom, 2);
            if (!protection.eligible) {
              ctx.ui.notify(
                protection.reason === "recent-turn"
                  ? "最近两个 User Turn 中的 Tool Output 受保护。"
                  : protection.reason === "missing-tool-call"
                    ? "找不到配对 Tool Call，已跳过替换。"
                    : protection.reason === "missing-tool-call-id"
                      ? "Tool Output 缺少 toolCallId，已跳过替换。"
                      : "Error Tool Output 受保护。",
                "warning",
              );
              return false;
            }
            const freshAtoms = normalizeSessionEntries(ctx.sessionManager.buildContextEntries());
            const fresh = freshAtoms.find((candidate) => candidate.id === atom.id);
            if (
              !fresh ||
              fresh.fingerprint !== atom.fingerprint ||
              fresh.sourceRef.entryId !== atom.sourceRef.entryId ||
              fresh.sourceRef.blockIndex !== atom.sourceRef.blockIndex
            ) {
              ctx.ui.notify("消息内容或身份已变化，已跳过操作以保护原始上下文。", "warning");
              return false;
            }
            return ctx.ui.confirm(
              "精简这条工具输出？",
              `${atom.toolName ?? "工具"} · 约 ${atom.approxTokens} tokens。精简结果只用于后续模型调用，原始对话记录会保留。`,
            );
          },
          () => done(undefined),
        ),
      );
    },
  });
}
