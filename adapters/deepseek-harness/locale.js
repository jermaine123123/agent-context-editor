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
    excludeContext: zh ? '\u6392\u9664\u4e0a\u4e0b\u6587' : 'Exclude context',
    restoreContext: zh ? '\u6062\u590d\u4e0a\u4e0b\u6587' : 'Restore context',
    contextState: state => state === 'exclude'
      ? (zh ? '\u5df2\u6392\u9664\u4e0a\u4e0b\u6587' : 'Excluded from context')
      : state === 'mixed'
        ? (zh ? '\u90e8\u5206\u6392\u9664' : 'Partially excluded')
        : (zh ? '\u4e0d\u53ef\u7528' : 'Unavailable'),
    excludeSelected: count => zh ? `\u6392\u9664\u9009\u4e2d${count ? `（${count}）` : ''}` : `Exclude selected${count ? ` (${count})` : ''}`,
    restoreContextSelected: zh ? '\u6062\u590d\u9009\u4e2d\u4e0a\u4e0b\u6587' : 'Restore selected context',
    contextPreview: (before, after, delta, closureCount) => {
      const beforeValue = Number.isFinite(Number(before)) ? Number(before) : 0
      const afterValue = Number.isFinite(Number(after)) ? Number(after) : 0
      const deltaValue = Number.isFinite(Number(delta)) ? Number(delta) : afterValue - beforeValue
      const sign = deltaValue > 0 ? '+' : ''
      const closure = closureCount > 0
        ? (zh ? ` · \u8fde\u5e26\u5355\u5143 ${closureCount} \u4e2a` : ` · ${closureCount} related units`)
        : ''
      return zh
        ? `\u9884\u8ba1\u4e0a\u4e0b\u6587 token：${beforeValue} → ${afterValue}（${sign}${deltaValue}）${closure}。\u786e\u5b9a\u63d0\u4ea4\uff1f`
        : `Estimated context tokens: ${beforeValue} → ${afterValue} (${sign}${deltaValue})${closure}. Continue?`
    },
    showHidden: zh ? '显示隐藏内容' : 'Show hidden content',
    searchPlaceholder: zh ? '\u641c\u7d22：\u7528\u6237\u6d88\u606f\u548c AI \u56de\u7b54…' : 'Search user messages and AI answers…',
    searchPlaceholderForScope: scope => zh
      ? scope === 'all' ? '\u641c\u7d22：\u5168\u6587…' : '\u641c\u7d22：\u7528\u6237\u6d88\u606f\u548c AI \u56de\u7b54…'
      : scope === 'all' ? 'Search full history…' : 'Search user messages and AI answers…',
    searchAria: zh ? '搜索上下文' : 'Search context',
    searchFailed: error => zh ? `\u641c\u7d22\u5931\u8d25：${error}` : `Search failed: ${error}`,
    searchSummary: (total, occurrences, current, index, active = false, scope = 'dialogue') => {
      const scopeLabel = scope === 'all' ? (zh ? '\u5168\u6587' : 'full') : (zh ? '\u5bf9\u8bdd' : 'dialogue')
      if (!active) return zh ? `\u641c\u7d22\u8303\u56f4：${scopeLabel}` : `Search scope: ${scopeLabel}`
      if (!total) return zh ? `0 \u4e2a\u5355\u5143 · 0 \u4e2a\u547d\u4e2d · ${scopeLabel}` : `0 units · 0 matches · ${scopeLabel}`
      const currentPart = current === undefined ? '' : zh ? ` · \u5f53\u524d\u5355\u5143 ${current} \u4e2a\u547d\u4e2d` : ` · ${current} matches in current unit`
      const indexPart = zh ? ` · ${index + 1}/${total}` : ` · ${index + 1}/${total}`
      return zh ? `${total} \u4e2a\u5355\u5143 · ${occurrences} \u4e2a\u547d\u4e2d${currentPart}${indexPart} · ${scopeLabel}` : `${total} units · ${occurrences} matches${currentPart}${indexPart} · ${scopeLabel}`
    },
    searchScope: scope => scope === 'all' ? (zh ? '\u641c\u7d22\u8303\u56f4：\u5168\u6587' : 'Full search') : (zh ? '\u641c\u7d22\u8303\u56f4：\u5bf9\u8bdd' : 'Dialogue search'),
    previous: zh ? '上一条' : 'Previous',
    next: zh ? '下一条' : 'Next',
    hideSelected: count => zh ? `隐藏选中${count ? `（${count}）` : ''}` : `Hide selected${count ? ` (${count})` : ''}`,
    restoreSelected: zh ? '恢复选中' : 'Restore selected',
    restoreAll: zh ? '恢复全部' : 'Restore all',
    undo: zh ? '撤销' : 'Undo',
    running: zh ? 'Agent 运行中：仅可读取和搜索' : 'Agent running: only reading and searching are available',
    loading: zh ? '正在读取完整会话…' : 'Reading the complete session…',
    noRecords: zh ? '没有符合当前筛选的可编辑记录。' : 'No editable records match the current filters.',
    edit: zh ? '编辑' : 'Edit',
    edited: zh ? '已编辑' : 'Edited',
    restoreOriginal: zh ? '恢复原文' : 'Restore original',
    undoReplacement: zh ? '撤销本次编辑' : 'Undo this edit',
    compareOriginal: zh ? '对照原文' : 'Compare original',
    showEffective: zh ? '显示编辑文本' : 'Show edited text',
    originalText: zh ? '原文' : 'Original text',
    editTitle: kind => zh ? `编辑${unitKind(kind)}` : `Edit ${unitKind(kind)}`,
    cancel: zh ? '取消' : 'Cancel',
    save: zh ? '保存' : 'Save',
    replacementEmpty: zh ? '编辑内容不能为空或全为空白。' : 'Replacement text cannot be blank.',
    replacementConflict: zh ? '会话已发生变化，已丢弃过期编辑并刷新。' : 'The session changed; the stale edit was discarded and the view refreshed.',
    replacementUnavailable: reason => {
      const labels = {
        'structured-user-content': zh ? '用户消息包含结构化内容' : 'the user message contains structured content',
        'signed-content': zh ? '回答包含签名内容' : 'the answer contains signed content',
        'projection-unavailable': zh ? 'Provider 投影暂不可用' : 'provider projection is unavailable',
        'unsupported-unit-kind': zh ? '该单元类型不支持编辑' : 'this unit type does not support editing',
        'invalid-target': zh ? '原文已变化，无法安全编辑' : 'the canonical text changed and cannot be edited safely',
      }
      return zh ? `不可编辑：${labels[reason] ?? '内容类型不支持'}` : `Not editable: ${labels[reason] ?? 'this content is not supported'}`
    },
    replacementDisabled: zh ? '手动上下文编辑尚未启用' : 'Manual context editing is not enabled',
    restoreReplacementConfirm: zh ? '确认恢复该单元的原文吗？' : 'Restore this unit to its original text?',
    editFailed: error => zh ? `编辑失败：${error}` : `Edit failed: ${error}`,
  }
}
