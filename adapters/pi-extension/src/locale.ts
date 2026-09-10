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
  contextState(state: "include" | "exclude" | "mixed" | "unavailable"): string;
  contextConfirmTitle(): string;
  contextConfirmHint(): string;
  contextAwaiting(): string;
  contextConfirm(action: "exclude" | "restore", requested: number, effective: number, autoExpanded: number, recent: boolean): string;
  contextUnavailableAction(): string;
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
  replacementBusy(): string;
  undoConflict(): string;
  undoFailed(error: string): string;
  restoreAllConfirmTitle(): string;
  restoreAllConfirmMessage(): string;
  editTitle(kind: string): string;
  replacementReviewTitle(): string;
  replacementReviewHint(): string;
  replacementReviewAnswer(changed: boolean): string;
  replacementReviewLink(enabled: boolean, count: number): string;
  replacementReviewScope(scope: "associated" | "newlyExcluded" | "alreadyExcluded" | "autoExpanded", ids: readonly string[]): string;
  replacementReviewConfirmationRequired(count: number): string;
  replacementReviewBlocked(reason: string): string;
  replacementReviewNoop(): string;
  replacementRestoreTitle(): string;
  replacementRestoreMessage(): string;
  replacementEmpty(): string;
  condensationBusy(): string;
  condensationNoSelection(): string;
  condensationSetupTitle(): string;
  condensationSetup(count: number, canExpand: boolean, enabled: boolean): string;
  condensationExpandRelated(enabled: boolean): string;
  condensationExpandDisabled(): string;
  condensationSetupHint(): string;
  condensationCancelHint(): string;
  condensationGenerating(): string;
  condensationGenerationFailed(error: string): string;
  condensationReviewTitle(): string;
  condensationReviewHint(): string;
  condensationSource(units: number, entries: number): string;
  condensationModel(provider: string, model: string): string;
  condensationMetrics(before: number, after: number, saved: number, ratio: number): string;
  condensationRisks(risks: readonly string[]): string;
  condensationWarnings(warnings: readonly string[]): string;
  condensationSummaryTitle(): string;
  condensationBlocked(reason: string): string;
  condensationApplied(): string;
  condensationRestored(): string;
  condensationCardTitle(operationId: string, state: string): string;
  condensationCardActive(): string;
  condensationCardExcluded(): string;
  condensationCardMetrics(saved: number, ratio: number): string;
  condensationCovered(index: number): string;
  condensationSourceList(index: number, count: number): string;
  condensationCardSources(ids: readonly string[]): string;
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
    contextState: (state) => {
      if (zh) return state === "exclude" ? "模型排除" : state === "mixed" ? "模型部分排除" : state === "unavailable" ? "模型不可用" : "模型保留";
      return state === "exclude" ? "Model excluded" : state === "mixed" ? "Model mixed" : state === "unavailable" ? "Model unavailable" : "Model included";
    },
    contextConfirmTitle: () => zh ? "确认模型上下文变更" : "Confirm model context change",
    contextConfirmHint: () => zh ? "Enter/y 确认 · Esc/n 取消" : "Enter/y confirm · Esc/n cancel",
    contextAwaiting: () => zh ? "等待确认" : "Awaiting confirmation",
    contextConfirm: (action, requested, effective, autoExpanded, recent) => {
      const actionLabel = action === "exclude" ? (zh ? "排除" : "excluding") : (zh ? "恢复" : "restoring");
      const recentWarning = recent
        ? (zh ? "; 涉及最近一轮及其后续工具链，请确认任务连续性影响" : "; this touches the latest turn and may affect task continuity")
        : "";
      const expansion = autoExpanded > 0
        ? (zh ? "; 结构闭包自动扩展 " + autoExpanded + " 个单元" : "; structural closure adds " + autoExpanded + " units")
        : "";
      return zh
        ? "确认" + actionLabel + "模型上下文？请求 " + requested + " 个单元，最终影响 " + effective + " 个单元" + expansion + recentWarning + "。原始 Session 不会修改。"
        : "Confirm " + actionLabel + " model context? Requested " + requested + " unit(s), affecting " + effective + expansion + recentWarning + ". The original Session will not be modified.";
    },
    contextUnavailableAction: () => zh ? "模型投影 sidecar 不可用，已禁用 x；视觉隐藏仍可用。" : "The model projection sidecar is unavailable; x is disabled. View actions remain available.",
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
      return zh ? "Space 勾选/取消 · Shift+↑/↓ 连选 · c 精简 · ? 帮助 · j/k · Enter 查看/收起 · C 摘要排除/恢复 · D 恢复精简前内容 · O 展开来源 · e 编辑 · E 恢复原文 · z 撤销编辑 · o 对照原文 · h 隐藏 · r 恢复 · x 排除/恢复模型上下文 · / 搜索 · ? 帮助 · q 关闭" : "Space select/unselect · Shift+↑/↓ range · c condense · ? help · j/k move · Enter view/collapse · C exclude/restore summary · D restore pre-condensation · O expand sources · e edit · E restore original · z undo edit · o compare original · h hide · r restore · x exclude/restore model context · / search · ? help · q close";
    },
    tuiHelpTitle: () => zh ? "Context Editor \u5feb\u6377\u952e" : "Context Editor help",
    tuiHelpLines: () => zh
      ? [
        "Enter  \u4e34\u65f6\u5c55\u5f00/\u6536\u8d77\uff0c\u4e0d\u4fdd\u5b58",

        "c      AI 精简选中内容；设置页 Space 选择关联思考/工具，Enter 生成；C/D/O 操作已应用摘要",
        "e      编辑当前用户/回答单元（提交到 sidecar）",
"E      确认恢复原文；z 撤销最近一次编辑；o 对照原文",
"x      排除/恢复模型上下文；Enter/y 确认，Esc/n 取消，不修改 Session JSONL",
        "h      \u6301\u4e45\u9690\u85cf\uff1br      \u6062\u590d\u9690\u85cf\u5355\u5143",
        "Space  \u9009\u62e9/\u53d6\u6d88\uff1bShift+↑/↓ \u8fde\u7eed\u9009\u62e9",
        "j/k、↑/↓、PgUp/PgDn \u5bfc\u822a\uff1bg/G \u8df3\u5230\u9996\u5c3e",
        "/      \u641c\u7d22\uff1bn \u4e0b\u4e00\u4e2a\uff0cN \u4e0a\u4e00\u4e2a\u547d\u4e2d",
        "s      \u5207\u6362\u5bf9\u8bdd/\u5168\u6587\u641c\u7d22\u8303\u56f4",
        "1/2/3  筛选用户、AI、工具；4/5 筛选思考、回答；a 全选当前结果",
        "u \u64a4\u9500\uff1bv \u4e34\u65f6\u663e\u793a\u9690\u85cf\u6b63\u6587",
        "R  \u6062\u590d\u5168\u90e8\u9690\u85cf\u5355\u5143\uff08\u517c\u5bb9\u952e\uff09",
      ]
      : [
        "Enter  temporarily expand/collapse; does not persist",
"c      AI condense the selection; Space enables related reasoning/tools for one Answer; C/D/O act on applied cards",
        "e      edit the current User/Answer unit (sidecar only)",
"E      restore canonical text; z undo the latest edit; o compare original",
"x      exclude/restore model context; Enter/y confirm, Esc/n cancel; Session JSONL stays unchanged",
        "h      persistently hide; r      restore hidden",
        "Space  select; Shift+↑/↓ extend the selection",
        "j/k, arrows, PgUp/PgDn navigate; g/G jump to ends",
        "/      search; n next, N previous occurrence",
        "s      dialogue/full search scope",
        "1/2/3 filter User, AI, Tool; 4/5 filter Reasoning, Answer; a select all visible matches",
        "u undo; v reveal hidden content temporarily",
        "R restore all hidden units (compatibility shortcut)",
      ],
    savePrefsFailed: (error) => zh ? `Context Editor 偏好保存失败：${error}` : `Context Editor preferences could not be saved: ${error}`,
    sessionChanged: () => zh ? "Session 或分支已变化，已清空临时选择。" : "The Session or branch changed; temporary selection was cleared.",
    sidecarChanged: () => zh ? "会话或 sidecar 已变化，已刷新 Context Editor。" : "The conversation or sidecar changed; Context Editor was refreshed.",
    operationFailed: (error) => zh ? `Context Editor 操作失败：${error}` : `Context Editor operation failed: ${error}`,
    busy: () => zh ? "Agent 运行中，暂时不能修改隐藏状态。" : "The Agent is running; hidden state cannot be changed yet.",
    replacementBusy: () => zh ? "Agent 正在运行，暂时不能编辑上下文。" : "The Agent is running; context editing is temporarily unavailable.",
    undoConflict: () => zh ? "撤销时发现 revision 冲突，已刷新。" : "A revision conflict occurred while undoing; the view was refreshed.",
    undoFailed: (error) => zh ? `撤销失败：${error}` : `Undo failed: ${error}`,
    restoreAllConfirmTitle: () => zh ? "恢复全部隐藏单元？" : "Restore all hidden units?",
    restoreAllConfirmMessage: () => zh ? "这只会恢复 Context Editor 的视觉状态，不会修改 Session 或模型上下文。" : "This only restores the Context Editor view state; the Session and model context are unchanged.",
    editTitle: (kind) => zh ? `编辑${kind}` : `Edit ${kind}`,
    replacementReviewTitle: () => zh ? "确认 Answer 编辑与联动排除" : "Review Answer edit and linked exclusion",
    replacementReviewHint: () => zh ? "Space 切换联动排除 · PgUp/PgDn 滚动 · Enter 保存 · e 返回修改草稿 · Esc 取消整次编辑" : "Space toggle linked exclusion · PgUp/PgDn scroll · Enter save · e edit draft · Esc cancel",
    replacementReviewAnswer: (changed) => zh ? `Answer 文本：${changed ? "已改变" : "未改变"}` : `Answer text: ${changed ? "changed" : "unchanged"}`,
    replacementReviewLink: (enabled, count) => zh ? `同时排除本轮思考：[${enabled ? "x" : " "}]（关联 ${count} 个 Reasoning 单元）` : `Exclude associated reasoning: [${enabled ? "x" : " "}] (${count} reasoning unit${count === 1 ? "" : "s"})`,
    replacementReviewScope: (scope, ids) => {
      const labels = zh ? { associated: "关联 Reasoning", newlyExcluded: "新增排除", alreadyExcluded: "原已排除", autoExpanded: "自动扩展工具链" } : { associated: "Associated reasoning", newlyExcluded: "Newly excluded", alreadyExcluded: "Already excluded", autoExpanded: "Auto-expanded tool closure" };
      return `${labels[scope]}: ${ids.length ? ids.join(", ") : (zh ? "无" : "none")}`;
    },
    replacementReviewConfirmationRequired: (count) => zh ? `签名思考触发结构闭包：需确认 ${count} 个自动扩展单元。` : `Signed reasoning expands the structural closure; confirm ${count} auto-expanded unit${count === 1 ? "" : "s"}.`,
    replacementReviewBlocked: (reason) => zh ? `当前联动事务不可保存：${reason}` : `This linked transaction cannot be saved: ${reason}`,
    replacementReviewNoop: () => zh ? "文本和联动范围都没有变化，未追加事件。" : "No text or linked-scope changes; no event was appended.",
    replacementRestoreTitle: () => zh ? "恢复 Answer 原文？" : "Restore Answer canonical text?",
    replacementRestoreMessage: () => zh ? "仅恢复 Answer 原文；本轮 Reasoning 的排除状态会保留。" : "Only the Answer text is restored; Reasoning exclusion for this turn remains.",
    replacementEmpty: () => zh ? "替换文本不能为空白。" : "Replacement text cannot be blank.",
    condensationBusy: () => zh ? "Agent 正在运行，暂时不能生成精简。" : "The Agent is running; condensation is temporarily unavailable.",
    condensationNoSelection: () => zh ? "请先选择一个连续的上下文单元。" : "Select a contiguous context range first.",
    condensationSetupTitle: () => zh ? "AI 精简设置" : "AI condensation settings",
    condensationSetup: (count, canExpand, enabled) => zh
      ? `已选择 ${count} 个单元。默认使用当前会话模型；${canExpand ? "可选同步关联的思考和工具输出。" : "当前选区不支持同步扩展。"}`
      : `${count} unit(s) selected. The current session model will be used; ${canExpand ? "related reasoning and tool output can be included." : "related expansion is disabled for this selection."}`,
    condensationExpandRelated: (enabled) => zh ? `同步精简 AI 思考和工具输出：[${enabled ? "x" : " "}]` : `Also condense related reasoning and tool output: [${enabled ? "x" : " "}]`,
    condensationExpandDisabled: () => zh ? "同步精简选项：置灰（仅单条 Answer 可用）" : "Related condensation: disabled (only available for one Answer)",
    condensationSetupHint: () => zh ? "Space 切换扩展 · Enter 生成/重试 · Esc 返回" : "Space toggle expansion · Enter generate/retry · Esc back",
    condensationCancelHint: () => zh ? "正在生成；Esc 取消并丢弃迟到结果" : "Generating; Esc cancels and discards late results",
    condensationGenerating: () => zh ? "正在生成精简候选…" : "Generating condensation candidate…",
    condensationGenerationFailed: (error) => error.includes("CONTEXT_EDITOR_CONDENSATION_OVERLAP:")
      ? (zh ? "选区已有生效的精简摘要。请按 Esc 返回列表，再按 D 恢复精简前内容后重试；C 仅排除摘要，不会解除精简。" : "This selection already has an active summary. Press Esc, then D to restore pre-condensation content before retrying. C only excludes the summary.")
      : zh ? `精简生成失败：${error}` : `Condensation generation failed: ${error}`,
    condensationReviewTitle: () => zh ? "预览 AI 精简" : "Preview AI condensation",
    condensationReviewHint: () => zh ? "j/k、PgUp/PgDn 滚动 · e 编辑摘要 · r 重新生成 · Enter 应用 · Esc 取消" : "j/k, PgUp/PgDn scroll · e edit summary · r regenerate · Enter apply · Esc cancel",
    condensationSource: (units, entries) => zh ? `来源：${units} 个单元，${entries} 条 Pi entry` : `Source: ${units} unit(s), ${entries} Pi entr(y/ies)`,
    condensationModel: (provider, model) => zh ? `模型：${provider}/${model}` : `Model: ${provider}/${model}`,
    condensationMetrics: (before, after, saved, ratio) => zh ? `估算 Token：${before} → ${after}，节省 ${saved}（${Math.round(ratio * 100)}%）` : `Estimated tokens: ${before} -> ${after}; saved ${saved} (${Math.round(ratio * 100)}%)`,
    condensationRisks: (risks) => zh ? `风险：${risks.join("、")}` : `Risks: ${risks.join(", ")}`,
    condensationWarnings: (warnings) => zh ? `提示：${warnings.join("、")}` : `Warnings: ${warnings.join(", ")}`,
    condensationSummaryTitle: () => zh ? "摘要正文（应用前可编辑）" : "Summary (editable before apply)",
    condensationBlocked: (reason) => zh ? `当前摘要不可应用：${reason}` : `This summary cannot be applied: ${reason}`,
    condensationApplied: () => zh ? "已应用 AI 精简；原始 Session 未修改。" : "AI condensation applied; the original Session was unchanged.",
    condensationRestored: () => zh ? "已恢复精简前内容。" : "Condensed content was restored.",
    condensationCardTitle: (operationId, state) => zh ? `AI 精简 ${state} · ${operationId}` : `AI condensation ${state} · ${operationId}`,
    condensationCardActive: () => zh ? "生效" : "active",
    condensationCardExcluded: () => zh ? "摘要已排除" : "summary excluded",
    condensationCardMetrics: (saved, ratio) => zh ? `预计节省 ${saved} tokens（${Math.round(ratio * 100)}%）· C 排除/恢复摘要 · D 恢复精简前内容 · O 展开来源` : `Estimated saving ${saved} tokens (${Math.round(ratio * 100)}%) · C exclude/restore summary · D restore pre-condensation content · O expand sources`,
    condensationCovered: (index) => zh ? `已由摘要 #${index} 替换` : `Replaced by summary #${index}`,
    condensationSourceList: (index, count) => zh ? `摘要 #${index} 来源 ${count} 条 · O 展开/收起原文 · PgUp/PgDn 滚动` : `Summary #${index}: ${count} sources · O expand/collapse originals · PgUp/PgDn scroll`,
    condensationCardSources: (ids) => zh ? `来源单元：${ids.length ? ids.join("、") : "无"}` : `Source units: ${ids.length ? ids.join(", ") : "none"}`,


  };
}
