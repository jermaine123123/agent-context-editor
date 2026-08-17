import { DEFAULT_ENABLED_KINDS, filterAtoms, kindLabel } from "./filter.js";
import {
  TOOL_OUTPUT_TOMBSTONE,
  toolOutputProtection,
  type ToolOutputProtectionReason,
} from "./projection.js";
import { atomState, stateForAtoms, stateWithAtom, stateWithViewFilter } from "./state.js";
import type {
  AtomFilter,
  AtomKind,
  ContextAtom,
  ContextEditorStateV1,
  ContextViewFilterState,
} from "./types.js";
import { ATOM_KINDS } from "./types.js";

const PAGE_SIZE = 50;
const MAX_EDITOR_CHARS = 100_000;
const BACK = "返回";
const CLOSE = "关闭";
const BROWSE = "浏览对话记录";
const SEARCH = "搜索对话记录";
const TYPES = "筛选对话记录类型";
const HIDDEN = "已隐藏记录";
const RESET = "重置当前对话状态";
const SHOW_CONTENT = "查看完整记录（只读）";
const OLDER = "← 更早记录";
const NEWER = "更新记录 →";

/** The subset of ExtensionUIContext that Pi Desktop supports natively. */
export interface DesktopEditorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface DesktopEditorDeps {
  ui: DesktopEditorUI;
  atoms: readonly ContextAtom[];
  initialState: ContextEditorStateV1 | undefined;
  sourceLeafId?: string;
  persistState: (state: ContextEditorStateV1) => void;
  /** Re-check the selected source atom immediately before a destructive action. */
  validateAtom?: (atom: ContextAtom) => boolean | Promise<boolean>;
}

interface DesktopFilterState {
  enabledKinds: Set<AtomKind>;
  query: string;
  showHidden: boolean;
}

function compactPreview(text: string, maxChars = 96): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "（空内容）";
  return compact.length > maxChars ? `${compact.slice(0, maxChars - 1)}…` : compact;
}

function viewLabel(viewState: ReturnType<typeof atomState>["viewState"]): string {
  return viewState === "hide" ? "已隐藏" : viewState === "collapse" ? "已折叠" : "正常显示";
}

function contextLabel(contextState: ReturnType<typeof atomState>["contextState"]): string {
  if (contextState === "replace") return "后续上下文已精简";
  if (contextState === "summarize") return "后续上下文已摘要";
  if (contextState === "exclude") return "已从后续上下文排除";
  return "后续上下文完整保留";
}

function atomOption(atom: ContextAtom, index: number, state: ContextEditorStateV1): string {
  const current = atomState(state, atom);
  const meta = [
    kindLabel(atom.kind),
    atom.toolName,
    viewLabel(current.viewState),
    contextLabel(current.contextState),
    `${atom.approxTokens} tok`,
  ]
    .filter(Boolean)
    .join(" · ");
  return `#${String(index + 1).padStart(4, "0")} · ${meta} · ${compactPreview(atom.text)}`;
}

function detailText(atom: ContextAtom): string {
  const metadata = [
    `类型：${kindLabel(atom.kind)}`,
    `来源：${atom.sourceRef.entryId}:${atom.sourceRef.blockIndex}`,
    `所属对话轮次：${atom.turnId}`,
    `预估 Token：${atom.approxTokens}`,
    atom.toolCallId ? `工具调用编号：${atom.toolCallId}` : undefined,
    atom.toolName ? `工具：${atom.toolName}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  const body = atom.text || "（空内容）";
  const limited = body.length > MAX_EDITOR_CHARS
    ? `${body.slice(0, MAX_EDITOR_CHARS)}\n\n[详情仅显示前 ${MAX_EDITOR_CHARS} 个字符；原始内容未修改]`
    : body;
  return `${metadata}\n\n${limited}`;
}

function reasonLabel(reason: ToolOutputProtectionReason | undefined): string {
  switch (reason) {
    case "missing-tool-call-id":
      return "缺少 toolCallId";
    case "missing-tool-call":
      return "找不到配对 Tool Call";
    case "recent-turn":
      return "最近两个 User Turn 受保护";
    case "error":
      return "Error 结果受保护";
    case "not-tool-output":
      return "仅 Tool Output 支持此操作";
    default:
      return "当前消息受安全策略保护";
  }
}

function visibleAtoms(
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1,
  filter: DesktopFilterState,
): ContextAtom[] {
  const atomFilter: AtomFilter = {
    enabledKinds: filter.enabledKinds,
    query: filter.query,
  };
  return filterAtoms(atoms, atomFilter).filter(
    (atom) => filter.showHidden || atomState(state, atom).viewState !== "hide",
  );
}

function stateSummary(
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1,
): { hidden: number; replaced: number } {
  let hidden = 0;
  let replaced = 0;
  for (const atom of atoms) {
    const current = atomState(state, atom);
    if (current.viewState === "hide") hidden += 1;
    if (current.contextState === "replace") replaced += 1;
  }
  return { hidden, replaced };
}

function replacementTokenEstimate(): number {
  return Math.max(1, Math.ceil(TOOL_OUTPUT_TOMBSTONE.length / 4));
}

async function viewAtom(ui: DesktopEditorUI, atom: ContextAtom): Promise<void> {
  const prefill = detailText(atom);
  const edited = await ui.editor(`查看 ${kindLabel(atom.kind)} 记录（只读）`, prefill);
  if (edited !== undefined && edited !== prefill) {
    ui.notify("预览窗口中的修改不会保存，原始对话记录没有变化。", "info");
  }
}

async function editAtom(
  deps: DesktopEditorDeps,
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1,
  atom: ContextAtom,
): Promise<ContextEditorStateV1> {
  let currentState = state;
  while (true) {
    const current = atomState(currentState, atom);
    const viewAction = current.viewState === "hide"
      ? "恢复在记录管理器中显示"
      : "从记录管理器中隐藏（不会隐藏主聊天窗口）";
    const protection = toolOutputProtection(atoms, atom);
    const contextAction = atom.kind === "tool_output"
      ? current.contextState === "keep"
        ? protection.eligible
          ? "精简这条工具输出（影响后续上下文）"
          : `暂不可精简：${reasonLabel(protection.reason)}`
        : "恢复完整工具输出"
      : undefined;
    const options = [SHOW_CONTENT, viewAction];
    if (contextAction) options.push(contextAction);
    options.push(BACK);

    const selected = await deps.ui.select(
      `${kindLabel(atom.kind)} · ${atom.toolName ?? "消息"}`,
      options,
    );
    if (selected === undefined || selected === BACK) return currentState;

    if (selected === SHOW_CONTENT) {
      await viewAtom(deps.ui, atom);
      continue;
    }

    if (selected === viewAction) {
      currentState = stateWithAtom(
        currentState,
        atom,
        { viewState: current.viewState === "hide" ? "show" : "hide" },
        deps.sourceLeafId,
      );
      deps.persistState(currentState);
      continue;
    }

    if (!contextAction || selected !== contextAction) continue;
    if (current.contextState !== "keep") {
      const restore = await deps.ui.confirm(
        "恢复完整工具输出？",
        "后续模型调用将重新使用完整的工具输出；原始对话记录始终保留。",
      );
      if (restore) {
        currentState = stateWithAtom(currentState, atom, { contextState: "keep" }, deps.sourceLeafId);
        deps.persistState(currentState);
      }
      continue;
    }

    if (!protection.eligible) {
      deps.ui.notify(`该工具输出暂不可精简：${reasonLabel(protection.reason)}。`, "warning");
      continue;
    }
    if (deps.validateAtom && !(await deps.validateAtom(atom))) {
      deps.ui.notify("消息内容或身份已变化，已跳过操作以保护原始上下文。", "warning");
      continue;
    }

    const replacementTokens = replacementTokenEstimate();
    const estimatedSavings = Math.max(0, atom.approxTokens - replacementTokens);
    const confirmed = await deps.ui.confirm(
      "精简这条工具输出？",
      [
        `工具：${atom.toolName ?? "unknown"}`,
        "影响记录：1",
        `Token 估算：${atom.approxTokens} → ${replacementTokens}`,
        `预计减少：${estimatedSavings} tokens`,
        "仅影响后续模型调用；原始对话记录不会修改。",
      ].join("\n"),
    );
    if (confirmed) {
      currentState = stateWithAtom(currentState, atom, { contextState: "replace" }, deps.sourceLeafId);
      deps.persistState(currentState);
    }
  }
}

async function browseAtoms(
  deps: DesktopEditorDeps,
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1,
  filter: DesktopFilterState,
): Promise<ContextEditorStateV1> {
  let currentState = state;
  while (true) {
    const matches = visibleAtoms(atoms, currentState, filter);
    if (matches.length === 0) {
      deps.ui.notify("没有符合当前筛选条件的对话记录。", "info");
      return currentState;
    }

    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    let page = pageCount - 1;
    while (true) {
      const start = page * PAGE_SIZE;
      const pageAtoms = matches.slice(start, start + PAGE_SIZE);
      const atomOptions = pageAtoms.map((atom, index) => atomOption(atom, start + index, currentState));
      const optionToAtom = new Map(pageAtoms.map((atom, index) => [
        atomOption(atom, start + index, currentState),
        atom,
      ]));
      const options = [...atomOptions];
      if (page > 0) options.push(OLDER);
      if (page < pageCount - 1) options.push(NEWER);
      options.push(BACK);

      const selected = await deps.ui.select(
        `对话记录 ${start + 1}-${start + pageAtoms.length}/${matches.length}`,
        options,
      );
      if (selected === undefined || selected === BACK) return currentState;
      if (selected === OLDER) {
        page = Math.max(0, page - 1);
        continue;
      }
      if (selected === NEWER) {
        page = Math.min(pageCount - 1, page + 1);
        continue;
      }

      const atom = optionToAtom.get(selected);
      if (!atom) continue;
      currentState = await editAtom(deps, atoms, currentState, atom);
      break;
    }
  }
}

async function editTypeFilter(ui: DesktopEditorUI, filter: DesktopFilterState): Promise<void> {
  while (true) {
    const options = ATOM_KINDS.map((kind) =>
      `${filter.enabledKinds.has(kind) ? "✓" : "○"} ${kindLabel(kind)}`,
    );
    const optionToKind = new Map(ATOM_KINDS.map((kind) => [
      `${filter.enabledKinds.has(kind) ? "✓" : "○"} ${kindLabel(kind)}`,
      kind,
    ]));
    options.push("完成");
    const selected = await ui.select("筛选对话记录类型（可多选）", options);
    if (selected === undefined || selected === "完成") return;
    const kind = optionToKind.get(selected);
    if (!kind) continue;
    if (filter.enabledKinds.has(kind)) filter.enabledKinds.delete(kind);
    else filter.enabledKinds.add(kind);
  }
}

async function resetState(
  deps: DesktopEditorDeps,
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1,
): Promise<ContextEditorStateV1> {
  const summary = stateSummary(atoms, state);
  if (summary.hidden === 0 && summary.replaced === 0) {
    deps.ui.notify("当前对话没有需要重置的管理状态。", "info");
    return state;
  }
  const confirmed = await deps.ui.confirm(
    "重置当前对话状态？",
    `将恢复 ${summary.hidden} 条已隐藏记录，并撤销 ${summary.replaced} 条工具输出的后续上下文精简；原始对话记录不会删除。`,
  );
  if (!confirmed) return state;
  const reset = stateForAtoms(undefined, atoms, deps.sourceLeafId);
  const nextState: ContextEditorStateV1 = {
    ...reset,
    updatedAt: new Date().toISOString(),
  };
  deps.persistState(nextState);
  return nextState;
}

function persistFilterState(
  deps: DesktopEditorDeps,
  state: ContextEditorStateV1,
  filter: DesktopFilterState,
): ContextEditorStateV1 {
  const enabledKinds = [...filter.enabledKinds].sort();
  const previous = state.viewFilter;
  if (
    previous &&
    previous.query === filter.query &&
    previous.showHidden === filter.showHidden &&
    previous.enabledKinds.length === enabledKinds.length &&
    previous.enabledKinds.every((kind, index) => kind === enabledKinds[index])
  ) {
    return state;
  }
  const nextFilter: ContextViewFilterState = {
    enabledKinds,
    query: filter.query,
    showHidden: filter.showHidden,
  };
  const nextState = stateWithViewFilter(state, nextFilter, deps.sourceLeafId);
  deps.persistState(nextState);
  return nextState;
}

/** Run the Pi Desktop-compatible, dialog-only Context Editor. */
export async function runDesktopContextEditor(deps: DesktopEditorDeps): Promise<void> {
  let state = stateForAtoms(deps.initialState, deps.atoms, deps.sourceLeafId);
  let changed = false;
  const flowDeps: DesktopEditorDeps = {
    ...deps,
    persistState: (nextState) => {
      changed = true;
      deps.persistState(nextState);
    },
  };
  const savedFilter = state.viewFilter;
  const filter: DesktopFilterState = {
    enabledKinds: new Set(savedFilter?.enabledKinds ?? DEFAULT_ENABLED_KINDS),
    query: savedFilter?.query ?? "",
    showHidden: savedFilter?.showHidden ?? false,
  };

  while (true) {
    const matches = visibleAtoms(deps.atoms, state, filter);
    const summary = stateSummary(deps.atoms, state);
    const searchLabel = filter.query ? `：${compactPreview(filter.query, 24)}` : "";
    const typeCount = `${filter.enabledKinds.size}/${ATOM_KINDS.length}`;
    const selected = await deps.ui.select("Pi Context Editor", [
      `${BROWSE}（${matches.length}/${deps.atoms.length}）`,
      `${SEARCH}${searchLabel}`,
      `${TYPES}（${typeCount}）`,
      `${HIDDEN}（${filter.showHidden ? "当前显示" : "当前不显示"}）`,
      `${RESET}（已隐藏 ${summary.hidden} · 已精简 ${summary.replaced}）`,
      CLOSE,
    ]);
    if (selected === undefined || selected === CLOSE) {
      if (changed) {
        deps.ui.notify(
          `已保存当前对话状态：隐藏 ${summary.hidden} 条，精简工具输出 ${summary.replaced} 条。隐藏和筛选只影响对话记录管理器，不会改变主聊天窗口；下次打开时会恢复这些设置。`,
          "info",
        );
      }
      return;
    }

    if (selected.startsWith(BROWSE)) {
      state = await browseAtoms(flowDeps, deps.atoms, state, filter);
      continue;
    }
    if (selected.startsWith(SEARCH)) {
      const query = await flowDeps.ui.input("搜索对话记录", filter.query || "输入关键词；留空清除");
      if (query !== undefined) {
        filter.query = query.trim();
        state = persistFilterState(flowDeps, state, filter);
      }
      continue;
    }
    if (selected.startsWith(TYPES)) {
      await editTypeFilter(flowDeps.ui, filter);
      state = persistFilterState(flowDeps, state, filter);
      continue;
    }
    if (selected.startsWith(HIDDEN)) {
      filter.showHidden = !filter.showHidden;
      state = persistFilterState(flowDeps, state, filter);
      continue;
    }
    if (selected.startsWith(RESET)) {
      const previousState = state;
      state = await resetState(flowDeps, deps.atoms, state);
      if (state !== previousState) {
        filter.enabledKinds = new Set(DEFAULT_ENABLED_KINDS);
        filter.query = "";
        filter.showHidden = false;
        state = persistFilterState(flowDeps, state, filter);
      }
    }
  }
}
