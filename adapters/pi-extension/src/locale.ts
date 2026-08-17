import type { AtomKind, ViewState } from "./types.js";

export type PiLocale = "zh" | "en";

type LocaleSource = {
  navigator?: { language?: string; languages?: readonly string[] };
  process?: { env?: Record<string, string | undefined> };
};

/** Resolve the host language without depending on Pi's optional UI settings API. */
export function detectPiLocale(source: LocaleSource = globalThis as LocaleSource): PiLocale {
  const candidates = [
    ...(source.navigator?.languages ?? []),
    source.navigator?.language,
    source.process?.env?.LC_ALL,
    source.process?.env?.LC_MESSAGES,
    source.process?.env?.LANG,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const value of candidates) {
    if (value.toLowerCase().startsWith("zh")) return "zh";
  }
  return "en";
}

export interface PiText {
  locale: PiLocale;
  back: string;
  close: string;
  browse: string;
  search: string;
  types: string;
  hidden: string;
  reset: string;
  showContent: string;
  older: string;
  newer: string;
  done: string;
  atomKind(kind: AtomKind): string;
  recordKind(kind: "user" | "ai" | "tool"): string;
  unitKind(kind: string): string;
  unitState(state: "partial" | "hidden" | "shown"): string;
  viewState(state: ViewState): string;
  emptyContent(): string;
  detail(atom: { kind: AtomKind; entryId: string; blockIndex: number; turnId: string; approxTokens: number; toolCallId?: string; toolName?: string }): string;
  truncatedDetail(maxChars: number): string;
  readOnlyTitle(kind: AtomKind): string;
  readOnlyChanged(): string;
  viewAction(hidden: boolean): string;
  messageLabel(): string;
  page(start: number, end: number, total: number): string;
  noMatches(): string;
  typeFilterTitle(): string;
  resetEmpty(): string;
  resetTitle(): string;
  resetMessage(hidden: number): string;
  savedMessage(hidden: number): string;
  searchTitle(): string;
  searchPlaceholder(): string;
  hiddenSummary(hidden: number, shown: boolean): string;
  resetSummary(hidden: number): string;
  browseSummary(matches: number, total: number): string;
  searchSummary(query: string): string;
  typeSummary(count: number, total: number): string;
  unitTitle(unitKind: string, recordKind: string, state: string, tokens: number): string;
  hiddenUnit(unitKind: string): string;
  tuiTitle(units: number): string;
  unitCount(units: number): string;
  tuiSearch(query: string, count: number, index: number): string;
  tuiSearchIdle(query: string, count: number, index: number): string;
  tuiStatus(): string;
  savePrefsFailed(error: string): string;
  sessionChanged(): string;
  sidecarChanged(): string;
  operationFailed(error: string): string;
  busy(): string;
  undoConflict(): string;
  undoFailed(error: string): string;
  restoreAllConfirmTitle(): string;
  restoreAllConfirmMessage(): string;
}

function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(values[key] ?? ""));
}

function kindLabel(locale: PiLocale, kind: AtomKind): string {
  const labels: Record<PiLocale, Record<AtomKind, string>> = {
    en: {
      user: "User",
      assistant_text: "Assistant",
      reasoning: "Reasoning",
      tool_call: "Tool Call",
      tool_output: "Tool Output",
      summary: "Summary",
    },
    zh: {
      user: "用户",
      assistant_text: "助手",
      reasoning: "思考",
      tool_call: "工具调用",
      tool_output: "工具输出",
      summary: "摘要",
    },
  };
  return labels[locale][kind];
}

export function createPiText(locale: PiLocale): PiText {
  const zh = locale === "zh";
  return {
    locale,
    back: zh ? "返回" : "Back",
    close: zh ? "关闭" : "Close",
    browse: zh ? "浏览对话记录" : "Browse conversation records",
    search: zh ? "搜索对话记录" : "Search conversation records",
    types: zh ? "筛选对话记录类型" : "Filter record types",
    hidden: zh ? "已隐藏记录" : "Hidden records",
    reset: zh ? "重置当前对话状态" : "Reset current conversation state",
    showContent: zh ? "查看完整记录（只读）" : "View full record (read-only)",
    older: zh ? "← 更早记录" : "← Older records",
    newer: zh ? "更新记录 →" : "Newer records →",
    done: zh ? "完成" : "Done",
    atomKind: (kind) => kindLabel(locale, kind),
    recordKind: (kind) => zh ? kind === "ai" ? "AI" : kind === "tool" ? "工具" : "用户" : kind === "ai" ? "AI" : kind === "tool" ? "Tool" : "User",
    unitKind: (kind) => zh
      ? kind === "reasoning" ? "思考" : kind === "answer" ? "回答" : kind === "tool" ? "工具" : "用户"
      : kind === "reasoning" ? "Reasoning" : kind === "answer" ? "Answer" : kind === "tool" ? "Tool" : "User",
    unitState: (state) => zh ? state === "partial" ? "部分" : state === "hidden" ? "已隐藏" : "显示" : state === "partial" ? "Partial" : state === "hidden" ? "Hidden" : "Shown",
    viewState: (state) => zh
      ? state === "hide" ? "已隐藏" : state === "collapse" ? "已折叠" : "正常显示"
      : state === "hide" ? "Hidden" : state === "collapse" ? "Collapsed" : "Shown",
    emptyContent: () => zh ? "（空内容）" : "(empty content)",
    detail: (atom) => {
      const labels = zh
        ? [`类型：${kindLabel(locale, atom.kind)}`, `来源：${atom.entryId}:${atom.blockIndex}`, `所属对话轮次：${atom.turnId}`, `预估 Token：${atom.approxTokens}`, atom.toolCallId ? `工具调用编号：${atom.toolCallId}` : undefined, atom.toolName ? `工具：${atom.toolName}` : undefined]
        : [`Type: ${kindLabel(locale, atom.kind)}`, `Source: ${atom.entryId}:${atom.blockIndex}`, `Turn: ${atom.turnId}`, `Estimated tokens: ${atom.approxTokens}`, atom.toolCallId ? `Tool call ID: ${atom.toolCallId}` : undefined, atom.toolName ? `Tool: ${atom.toolName}` : undefined];
      return labels.filter(Boolean).join("\n");
    },
    truncatedDetail: (maxChars) => zh ? `[详情仅显示前 ${maxChars} 个字符；原始内容未修改]` : `[Only the first ${maxChars} characters are shown; original content is unchanged]`,
    readOnlyTitle: (kind) => zh ? `查看 ${kindLabel(locale, kind)} 记录（只读）` : `View ${kindLabel(locale, kind)} record (read-only)`,
    readOnlyChanged: () => zh ? "预览窗口中的修改不会保存，原始对话记录没有变化。" : "Edits in the preview are not saved; the original conversation record is unchanged.",
    viewAction: (hidden) => hidden ? (zh ? "恢复在记录管理器中显示" : "Restore in record manager") : (zh ? "从记录管理器中隐藏（不会隐藏主聊天窗口）" : "Hide from record manager (the main chat is unchanged)"),
    messageLabel: () => zh ? "消息" : "Message",
    page: (start, end, total) => zh ? `对话记录 ${start}-${end}/${total}` : `Conversation records ${start}-${end}/${total}`,
    noMatches: () => zh ? "没有符合当前筛选条件的对话记录。" : "No conversation records match the current filters.",
    typeFilterTitle: () => zh ? "筛选对话记录类型（可多选）" : "Filter record types (multi-select)",
    resetEmpty: () => zh ? "当前对话没有需要重置的管理状态。" : "There is no managed state to reset for this conversation.",
    resetTitle: () => zh ? "重置当前对话状态？" : "Reset current conversation state?",
    resetMessage: (hidden) => zh ? `将恢复 ${hidden} 条已隐藏记录；原始对话记录不会删除，也不会改变模型上下文。` : `This will restore ${hidden} hidden records; the original conversation and model context will not be changed.`,
    savedMessage: (hidden) => zh ? `已保存当前对话状态：隐藏 ${hidden} 条。隐藏和筛选只影响记录管理器，不会改变主聊天窗口或模型上下文；下次打开时会恢复这些设置。` : `Conversation state saved: ${hidden} hidden. Hiding and filtering only affect the record manager; the main chat and model context are unchanged, and these settings will be restored next time.`,
    searchTitle: () => zh ? "搜索对话记录" : "Search conversation records",
    searchPlaceholder: () => zh ? "输入关键词；留空清除" : "Enter a keyword; leave blank to clear",
    hiddenSummary: (hidden, shown) => zh ? `已隐藏记录（${shown ? "当前显示" : "当前不显示"}）` : `Hidden records (${shown ? "shown" : "hidden"})`,
    resetSummary: (hidden) => zh ? `重置当前对话状态（已隐藏 ${hidden}）` : `Reset current conversation state (${hidden} hidden)`,
    browseSummary: (matches, total) => zh ? `浏览对话记录（${matches}/${total}）` : `Browse conversation records (${matches}/${total})`,
    searchSummary: (query) => query ? `${zh ? "搜索对话记录" : "Search conversation records"}${zh ? "：" : ": "}${query}` : (zh ? "搜索对话记录" : "Search conversation records"),
    typeSummary: (count, total) => `${zh ? "筛选对话记录类型" : "Filter record types"} (${count}/${total})`,
    unitTitle: (unitKind, recordKind, state, tokens) => `${unitKind} · ${recordKind} · ${state} · ${tokens} tok`,
    hiddenUnit: (unitKind) => zh ? `    ${unitKind} 已隐藏 · 按 v 显示` : `    ${unitKind} hidden · press v to reveal`,
    tuiTitle: (units) => `${zh ? "Pi Context Editor" : "Pi Context Editor"}  ${units} ${zh ? "单元" : "units"}`,
    unitCount: (units) => `${units} ${zh ? "单元" : "units"}`,
    tuiSearch: (query, count, index) => zh ? `搜索：${query}▌  ${count} 单元` : `Search: ${query}▌  ${count} units`,
    tuiSearchIdle: (query, count, index) => `${zh ? "搜索" : "Search"}: ${query || (zh ? "（按 /）" : "(press /)")}${count > 0 ? ` · ${index + 1}/${count}` : ""}`,
    tuiStatus: () => zh ? "j/k 移动 · shift+↑/↓ 区间选择 · 空格选择 · enter 展开 · h 隐藏 · r 恢复 · u 撤销 · v 显示 · q 关闭" : "j/k move · shift+↑/↓ range · space select · enter expand · h hide · r restore · u undo · v reveal · q close",
    savePrefsFailed: (error) => zh ? `Context Editor 偏好保存失败：${error}` : `Context Editor preferences could not be saved: ${error}`,
    sessionChanged: () => zh ? "Session 或分支已变化，已清空临时选择。" : "The Session or branch changed; temporary selection was cleared.",
    sidecarChanged: () => zh ? "会话或 sidecar 已变化，已刷新 Context Editor。" : "The conversation or sidecar changed; Context Editor was refreshed.",
    operationFailed: (error) => zh ? `Context Editor 操作失败：${error}` : `Context Editor operation failed: ${error}`,
    busy: () => zh ? "Agent 运行中，暂时不能修改隐藏状态。" : "The Agent is running; hidden state cannot be changed yet.",
    undoConflict: () => zh ? "撤销时发现 revision 冲突，已刷新。" : "A revision conflict occurred while undoing; the view was refreshed.",
    undoFailed: (error) => zh ? `撤销失败：${error}` : `Undo failed: ${error}`,
    restoreAllConfirmTitle: () => zh ? "恢复全部隐藏单元？" : "Restore all hidden units?",
    restoreAllConfirmMessage: () => zh ? "这只会恢复 Context Editor 的视觉状态，不会修改 Session 或模型上下文。" : "This only restores the Context Editor view state; the Session and model context are unchanged.",
  };
}
