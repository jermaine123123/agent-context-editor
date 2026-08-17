import { describe, expect, it } from "vitest";
import { runDesktopContextEditor, type DesktopEditorUI } from "../adapters/pi-extension/src/desktop-ui.js";
import type { ContextAtom, ContextEditorStateV1 } from "../adapters/pi-extension/src/types.js";

class ScriptedUI implements DesktopEditorUI {
  readonly selectCalls: Array<{ title: string; options: string[] }> = [];
  readonly editorPrefills: string[] = [];
  readonly notifications: string[] = [];
  private readonly selectHandler: (title: string, options: string[]) => string | undefined;
  private readonly inputValue: string | undefined;
  private readonly confirmValue: boolean;

  constructor(
    selectHandler: (title: string, options: string[]) => string | undefined,
    inputValue?: string,
    confirmValue = true,
  ) {
    this.selectHandler = selectHandler;
    this.inputValue = inputValue;
    this.confirmValue = confirmValue;
  }

  async select(title: string, options: string[]): Promise<string | undefined> {
    this.selectCalls.push({ title, options });
    return this.selectHandler(title, options);
  }

  async input(): Promise<string | undefined> {
    return this.inputValue;
  }

  async editor(_title: string, prefill?: string): Promise<string | undefined> {
    this.editorPrefills.push(prefill ?? "");
    return prefill;
  }

  async confirm(): Promise<boolean> {
    return this.confirmValue;
  }

  notify(message: string): void {
    this.notifications.push(message);
  }
}

function atom(
  id: string,
  kind: ContextAtom["kind"],
  turnId: string,
  text: string,
  extra: Partial<ContextAtom> = {},
): ContextAtom {
  return {
    id,
    sourceRef: { entryId: id, blockIndex: 0 },
    kind,
    turnId,
    timestamp: 1,
    text,
    fingerprint: `${id}-fingerprint`,
    approxTokens: Math.max(1, Math.ceil(text.length / 4)),
    ...extra,
  };
}

describe("desktop context editor", () => {
  it("uses English labels for a non-Chinese host locale", async () => {
    const ui = new ScriptedUI((_title, options) => options.find((option) => option === "Close") ?? "Back");
    await runDesktopContextEditor({
      ui,
      atoms: [atom("u-en", "user", "u-en", "English content")],
      initialState: undefined,
      locale: "en",
      persistState: () => undefined,
    });

    expect(ui.selectCalls[0]?.options[0]).toContain("Browse conversation records");
    expect(ui.selectCalls[0]?.options[1]).toBe("Search conversation records");
    expect(ui.selectCalls[0]?.options.at(-1)).toBe("Close");
  });

  it("applies Chinese keyword search before opening the message list", async () => {
    const atoms = [
      atom("u1", "user", "u1", "目标内容"),
      atom("u2", "user", "u2", "other content"),
    ];
    let mainVisits = 0;
    let browseLabel = "";
    let savedState: ContextEditorStateV1 | undefined;
    const ui = new ScriptedUI((title, options) => {
      if (title === "Pi Context Editor") {
        mainVisits += 1;
        if (mainVisits === 1) return options.find((option) => option.startsWith("搜索对话记录"));
        browseLabel = options.find((option) => option.startsWith("浏览对话记录")) ?? "";
        return "关闭";
      }
      return "返回";
    }, "目标");

    await runDesktopContextEditor({
      ui,
      atoms,
      initialState: undefined,
      locale: "zh",
      persistState: (state) => {
        savedState = state;
      },
    });

    expect(browseLabel).toContain("1/2");
    expect(savedState?.viewFilter?.query).toBe("目标");
    expect(ui.notifications.some((message) => message.includes("已保存当前对话状态"))).toBe(true);
  });

  it("runs the native dialog flow and persists view-only Hide", async () => {
    const atoms = [atom("u1", "user", "u1", "保留目标")];
    const persisted: ContextEditorStateV1[] = [];

    let mainVisits = 0;
    const controlledUi = new ScriptedUI((title, options) => {
      if (title === "Pi Context Editor") {
        mainVisits += 1;
        if (mainVisits === 1) return options.find((option) => option.startsWith("浏览对话记录"));
        return "关闭";
      }
      if (title.startsWith("对话记录 ")) {
        const message = options.find((option) => option.startsWith("#"));
        return message;
      }
      if (title.startsWith("用户")) {
        if (options.some((option) => option.startsWith("从记录管理器中隐藏"))) {
          return options.find((option) => option.startsWith("从记录管理器中隐藏"));
        }
        return "返回";
      }
      return "返回";
    });

    await runDesktopContextEditor({
      ui: controlledUi,
      atoms,
      initialState: undefined,
      locale: "zh",
      sourceLeafId: "leaf-1",
      persistState: (state) => persisted.push(state),
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.items.u1?.viewState).toBe("hide");
  });

  it("supports type filtering while keeping Tool Output visual-only", async () => {
    const atoms = [
      atom("u1", "user", "u1", "old request"),
      atom("call1", "tool_call", "u1", "read {}", { toolCallId: "call-1", toolName: "read" }),
      atom("out1", "tool_output", "u1", "large old output", { toolCallId: "call-1", toolName: "read" }),
      atom("u2", "user", "u2", "recent request"),
      atom("u3", "user", "u3", "latest request"),
    ];
    const persisted: ContextEditorStateV1[] = [];
    let typeVisits = 0;
    let mainVisits = 0;
    let messageVisits = 0;
    const ui = new ScriptedUI((title, options) => {
      if (title === "Pi Context Editor") {
        mainVisits += 1;
        if (mainVisits === 1) return options.find((option) => option.startsWith("筛选对话记录类型"));
        if (mainVisits === 2) return options.find((option) => option.startsWith("浏览对话记录"));
        return "关闭";
      }
      if (title.startsWith("筛选对话记录类型")) {
        typeVisits += 1;
        if (typeVisits === 1) return "✓ 用户";
        if (typeVisits === 2) return "○ 工具输出";
        return "完成";
      }
      if (title.startsWith("对话记录 ")) {
        messageVisits += 1;
        return messageVisits === 1 ? options.find((option) => option.startsWith("#")) : "返回";
      }
      if (title.startsWith("工具输出")) return "返回";
      return "返回";
    });

    await runDesktopContextEditor({
      ui,
      atoms,
      initialState: undefined,
      locale: "zh",
      sourceLeafId: "leaf-1",
      persistState: (state) => persisted.push(state),
    });

    expect(persisted.at(-1)?.items.out1?.contextState ?? "keep").toBe("keep");
    expect(ui.selectCalls.some((call) => call.options.some((option) => option.startsWith("精简这条工具输出")))).toBe(false);
  });

  it("opens long content in a capped detail preview without persisting edits", async () => {
    const longText = "中英文 output ".repeat(10_000);
    const atoms = [atom("u1", "user", "u1", longText)];
    let mainVisits = 0;
    let detailShown = false;
    let messageVisits = 0;
    const ui = new ScriptedUI((title, options) => {
      if (title === "Pi Context Editor") {
        mainVisits += 1;
        return mainVisits === 1 ? options.find((option) => option.startsWith("浏览对话记录")) : "关闭";
      }
      if (title.startsWith("对话记录 ")) {
        messageVisits += 1;
        return messageVisits === 1 ? options.find((option) => option.startsWith("#")) : "返回";
      }
      if (title.startsWith("用户") && options.includes("查看完整记录（只读）") && !detailShown) {
        detailShown = true;
        return "查看完整记录（只读）";
      }
      if (title.startsWith("用户")) return "返回";
      return "返回";
    });

    await runDesktopContextEditor({
      ui,
      atoms,
      initialState: undefined,
      locale: "zh",
      persistState: () => undefined,
    });

    expect(ui.editorPrefills[0]).toContain("原始内容未修改");
  });
});
