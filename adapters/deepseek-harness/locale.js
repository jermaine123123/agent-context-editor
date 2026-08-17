export function detectHarnessLocale(source = globalThis) {
  const candidates = [
    ...(source.navigator?.languages ?? []),
    source.navigator?.language,
  ].filter(value => typeof value === 'string' && value.length > 0)
  return candidates.some(value => value.toLowerCase().startsWith('zh')) ? 'zh' : 'en'
}

export function createHarnessText(locale) {
  const zh = locale === 'zh'
  const kind = value => zh
    ? value === 'ai' ? 'AI' : value === 'tool' ? '工具' : '用户'
    : value === 'ai' ? 'AI' : value === 'tool' ? 'Tool' : 'User'
  const unitKind = value => zh
    ? value === 'reasoning' ? '思考' : value === 'answer' ? '回答' : value === 'tool' ? '工具' : '用户'
    : value === 'reasoning' ? 'Reasoning' : value === 'answer' ? 'Answer' : value === 'tool' ? 'Tool' : 'User'
  return {
    locale,
    kind,
    unitKind,
    empty: zh ? '（空记录）' : '(empty record)',
    mixedPlaceholder: zh ? '部分内容不可用（原位置占位）' : 'Part of this content is unavailable (placeholder at original position)',
    hiddenPlaceholder: unit => zh ? `${unitKind(unit)}已隐藏（原位置占位）` : `${unitKind(unit)} hidden (placeholder at original position)`,
    partiallyHidden: zh ? '部分隐藏' : 'Partially hidden',
    hidden: zh ? '隐藏' : 'Hidden',
    restore: zh ? '恢复' : 'Restore',
    showHidden: zh ? '显示隐藏内容' : 'Show hidden content',
    searchPlaceholder: zh ? '搜索完整会话历史…' : 'Search complete session history…',
    searchAria: zh ? '搜索上下文' : 'Search context',
    searchFailed: error => zh ? `搜索失败：${error}` : `Search failed: ${error}`,
    searchSummary: (total, occurrences, current, index, active = false) => {
      if (!active) return zh ? '搜索覆盖完整持久化历史' : 'Search covers the complete persisted history'
      if (!total) return zh ? '0 个单元 · 0 次出现' : '0 units · 0 matches'
      const currentPart = current === undefined ? '' : zh ? ` · 当前单元 ${current} 次` : ` · ${current} matches in current unit`
      const indexPart = zh ? ` · ${index + 1}/${total}` : ` · ${index + 1}/${total}`
      return zh ? `${total} 个单元 · ${occurrences} 次出现${currentPart}${indexPart}` : `${total} units · ${occurrences} matches${currentPart}${indexPart}`
    },
    previous: zh ? '上一条' : 'Previous',
    next: zh ? '下一条' : 'Next',
    hideSelected: count => zh ? `隐藏选中${count ? `（${count}）` : ''}` : `Hide selected${count ? ` (${count})` : ''}`,
    restoreSelected: zh ? '恢复选中' : 'Restore selected',
    restoreAll: zh ? '恢复全部' : 'Restore all',
    undo: zh ? '撤销' : 'Undo',
    running: zh ? 'Agent 运行中：仅可读取和搜索' : 'Agent running: only reading and searching are available',
    loading: zh ? '正在读取完整会话…' : 'Reading the complete session…',
    noRecords: zh ? '没有符合当前筛选的可编辑记录。' : 'No editable records match the current filters.',
  }
}
