import type { AtomKind, ViewState } from "./types.js";

type PiSearchScope = "dialogue" | "all";

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
  searchScope(scope: PiSearchScope): string;
  hiddenSummary(hidden: number, shown: boolean): string;
  resetSummary(hidden: number): string;
  browseSummary(matches: number, total: number): string;
  searchSummary(query: string): string;
  typeSummary(count: number, total: number): string;
  unitTitle(unitKind: string, recordKind: string, state: string, tokens: number): string;
  hiddenUnit(unitKind: string): string;
  hiddenSearchHit(): string;
  tuiTitle(units: number): string;
  unitCount(units: number): string;
  tuiSearch(query: string, count: number, index: number, scope?: PiSearchScope): string;
  tuiSearchIdle(query: string, count: number, index: number, scope?: PiSearchScope): string;
  tuiStatus(mode?: "normal" | "search" | "results" | "help", scope?: PiSearchScope): string;
  tuiHelpTitle(): string;
  tuiHelpLines(): string[];
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
    searchScope: (scope) => scope === "all"
      ? (zh ? "\u641c\u7d22\u8303\u56f4\uff1a\u5168\u6587" : "Search scope: Full")
      : (zh ? "\u641c\u7d22\u8303\u56f4\uff1a\u5bf9\u8bdd" : "Search scope: Dialogue"),
    hiddenSummary: (hidden, shown) => zh ? `已隐藏记录（${shown ? "当前显示" : "当前不显示"}）` : `Hidden records (${shown ? "shown" : "hidden"})`,
    resetSummary: (hidden) => zh ? `重置当前对话状态（已隐藏 ${hidden}）` : `Reset current conversation state (${hidden} hidden)`,
    browseSummary: (matches, total) => zh ? `浏览对话记录（${matches}/${total}）` : `Browse conversation records (${matches}/${total})`,
    searchSummary: (query) => query ? `${zh ? "搜索对话记录" : "Search conversation records"}${zh ? "：" : ": "}${query}` : (zh ? "搜索对话记录" : "Search conversation records"),
    typeSummary: (count, total) => `${zh ? "筛选对话记录类型" : "Filter record types"} (${count}/${total})`,
    unitTitle: (unitKind, recordKind, state, tokens) => `${unitKind} · ${recordKind} · ${state} · ${tokens} tok`,
    hiddenUnit: (unitKind) => zh ? `    ${unitKind} 已隐藏 · 按 v 显示` : `    ${unitKind} hidden · press v to reveal`,
    hiddenSearchHit: () => zh ? " · " : " · match is in hidden content",
    tuiTitle: (units) => `${zh ? "Pi Context Editor" : "Pi Context Editor"}  ${units} ${zh ? "单元" : "units"}`,
    unitCount: (units) => `${units} ${zh ? "单元" : "units"}`,
    tuiSearch: (query, count, _index, scope = "dialogue") => {
      const scopeLabel = scope === "all" ? (zh ? "\u5168\u6587" : "full") : (zh ? "\u5bf9\u8bdd" : "dialogue");
      return zh ? `\u641c\u7d22\uff1a[${scopeLabel}] ${query}▌ · ${count} \u4e2a\u547d\u4e2d` : `Search: [${scopeLabel}] ${query}▌ · ${count} matches`;
    },
    tuiSearchIdle: (query, count, index, scope = "dialogue") => {
      const scopeLabel = scope === "all" ? (zh ? "\u5168\u6587" : "full") : query ? (zh ? "\u5bf9\u8bdd" : "dialogue") : "";
      const prefix = `${zh ? "\u641c\u7d22" : "Search"}${zh ? "\uff1a" : ": "}${query || (zh ? "\uff08\u6309 / \u641c\u7d22\uff09" : "(press /)")}${scopeLabel ? ` · ${scopeLabel}` : ""}`;
      if (count <= 0) return prefix;
      return `${prefix} · ${index >= 0 ? `${index + 1}/${count}` : `${count} ${zh ? "\u4e2a\u547d\u4e2d" : "matches"}`}`;
    },
    tuiStatus: (mode = "normal", scope = "dialogue") => {
      if (mode === "search") return zh ? "\u8f93\u5165\u5173\u952e\u8bcd · Enter \u8df3\u8f6c · Esc \u7ed3\u675f\u641c\u7d22" : "Type a query · Enter jump · Esc finish search";
      if (mode === "results") return zh ? "n \u4e0b\u4e00\u4e2a\u547d\u4e2d，N \u4e0a\u4e00\u4e2a\u547d\u4e2d · s \u5207\u6362\u8303\u56f4 · / \u4fee\u6539\u641c\u7d22 · ? \u5e2e\u52a9 · q \u5173\u95ed" : "n next / N previous occurrence · s toggle scope · / edit search · ? help · q close";
      if (mode === "help") return zh ? "? Esc \u8fd4\u56de\u7f16\u8f91\u5668" : "? / Esc return to editor";
      return zh ? "j/k · Enter \u67e5\u770b/\u6536\u8d77 · h \u9690\u85cf · r \u6062\u590d · / \u641c\u7d22 · ? \u5e2e\u52a9 · q \u5173\u95ed" : "j/k move · Enter view/collapse · h hide · r restore · / search · ? help · q close";
    },
    tuiHelpTitle: () => zh ? "Context Editor \u5feb\u6377\u952e" : "Context Editor help",
    tuiHelpLines: () => zh
      ? [
        "Enter  \u4e34\u65f6\u5c55\u5f00/\u6536\u8d77\uff0c\u4e0d\u4fdd\u5b58",
        "h      \u6301\u4e45\u9690\u85cf\uff1br      \u6062\u590d\u9690\u85cf\u5355\u5143",
        "Space  \u9009\u62e9/\u53d6\u6d88\uff1bShift+↑/↓ \u8fde\u7eed\u9009\u62e9",
        "j/k、↑/↓、PgUp/PgDn \u5bfc\u822a\uff1bg/G \u8df3\u5230\u9996\u5c3e",
        "/      \u641c\u7d22\uff1bn \u4e0b\u4e00\u4e2a\uff0cN \u4e0a\u4e00\u4e2a\u547d\u4e2d",
        "s      \u5207\u6362\u5bf9\u8bdd/\u5168\u6587\u641c\u7d22\u8303\u56f4",
        "1/2/3  \u7b5b\u9009\u7528\u6237\u3001AI、\u5de5\u5177\uff1ba \u5168\u9009\u5f53\u524d\u7ed3\u679c",
        "u \u64a4\u9500\uff1bv \u4e34\u65f6\u663e\u793a\u9690\u85cf\u6b63\u6587",
        "R  \u6062\u590d\u5168\u90e8\u9690\u85cf\u5355\u5143\uff08\u517c\u5bb9\u952e\uff09",
      ]
      : [
        "Enter  temporarily expand/collapse; does not persist",
        "h      persistently hide; r      restore hidden",
        "Space  select; Shift+↑/↓ extend the selection",
        "j/k, arrows, PgUp/PgDn navigate; g/G jump to ends",
        "/      search; n next, N previous occurrence",
        "s      dialogue/full search scope",
        "1/2/3 filter User, AI, Tool; a select all visible matches",
        "u undo; v reveal hidden content temporarily",
        "R restore all hidden units (compatibility shortcut)",
      ],
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
