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
  const featureUnavailable = reason => {
    const messages = {
      'request-transform-unsupported-block': zh ? '所选内容包含尚不支持的格式。其他消息仍可操作。' : 'This selection contains an unsupported format. Other messages remain available.',
      'signed-content': zh ? '这段思考带有签名，需要保留原样。' : 'This signed reasoning must remain unchanged.',
      'official-surface-has-no-lossless-message-removal': zh ? '此宿主接口不能无损移除模型消息，无法排除上下文。' : 'This host API cannot remove model messages losslessly, so context exclusion is unavailable.',
      'assistant-message-surface-replacement-rejected-by-source-reference-contract': zh ? '此宿主不接受 Assistant 消息替换；目前仅支持单条纯文本 User 消息。' : 'This host rejects Assistant message replacement; only one plain text User message is supported.',
      'multi-message-summary-restore-not-proven-for-standard-surface': zh ? '尚未验证多消息精简与恢复契约，精简入口已停用。' : 'Multi-message condensation and restore are unverified, so condensation is disabled.',
      'host-surface-contract': zh ? '当前宿主只确认单条纯文本 User 消息可替换、恢复和撤销。' : 'This host only supports replacing, restoring, and undoing a single plain text User message.',
      'request-transform-plain-text-only': zh ? '目前仅支持完整的纯文本 User 或 Assistant 消息；含思考、工具、图片或签名的消息暂不支持。' : 'Only complete plain text User or Assistant messages are supported; reasoning, tools, images, and signatures are not supported.',
      'request-transform-compaction-route': zh ? '请求修改目前需要默认原生压缩，并继承当前会话模型；自定义压缩模型暂不支持。' : 'Request editing requires default native compaction inheriting the session model; custom compaction models are not supported.',
      'compaction-behavior-not-included-in-the-synthetic-self-test': zh ? '尚未核验原生压缩的覆盖与恢复行为。' : 'Native compaction coverage and restore behavior have not been verified.',
      'host-capability-not-confirmed': zh ? '宿主尚未确认此功能。' : 'The host has not confirmed this feature.',
    }
    return messages[reason] ?? (reason || (zh ? '宿主尚未确认此功能。' : 'The host has not confirmed this feature.'))
  }
  const compatibilitySummary = report => {
    const identity = report?.hostIdentity ?? {}
    const features = report?.features ?? {}
    const labels = {
      historyRead: zh ? '历史读取' : 'history read',
      search: zh ? '搜索' : 'search',
      viewMutation: zh ? '视图状态' : 'view state',
      contextExclusion: zh ? '上下文排除' : 'context exclusion',
      contextReplacement: zh ? 'User 文本替换' : 'User text replacement',
      assistantReplacement: zh ? 'Assistant 替换' : 'Assistant replacement',
      contextCondensation: zh ? '上下文精简' : 'context condensation',
      nativeCompaction: zh ? '原生压缩' : 'native compaction',
    }
    const available = Object.entries(features).filter(([, feature]) => feature?.available === true).map(([name]) => labels[name] ?? name)
    const gated = Object.entries(features).filter(([, feature]) => feature?.available !== true).map(([name, feature]) => `${labels[name] ?? name}: ${featureUnavailable(feature?.reason)}`)
    const version = identity.components?.['@deepseek-ai/dsh-session'] ?? identity.version ?? 'unknown'
    const test = report?.selfTest?.status ?? 'not run'
    return zh
      ? `Harness ${version} · 合成接口自检：${test}（未写入会话）· 可用：${available.join('、') || '无'} · 受限：${gated.join('；') || '无'}`
      : `Harness ${version} · synthetic API check: ${test} (no session writes) · available: ${available.join(', ') || 'none'} · gated: ${gated.join('; ') || 'none'}`
  }
  return {
    more: zh ? '更多' : 'More',
    diagnostics: zh ? '诊断' : 'Diagnostics',
    details: zh ? '详情' : 'Details',
    actionDetails: zh ? '操作说明' : 'Action details',
    dismiss: zh ? '关闭提示' : 'Dismiss',
    verifyOperation: zh ? '核实状态' : 'Verify status',
    nativeProjectionUnsupported: zh ? '当前 Harness 接口限制了部分上下文操作。' : 'Some context actions are limited by the current Harness API.',
    featureUnavailable,
    compatibilitySummary,
    runCompatibilityCheck: zh ? '重新检查宿主能力' : 'Recheck host capabilities',
    compatibilityChecking: zh ? '正在检查…' : 'Checking…',
    compatibilityCheckFailed: error => zh ? `能力检查失败：${error}` : `Compatibility check failed: ${error}`,
    condensationPending: zh ? '摘要已生成，尚未应用。点击“应用精简”后，列表才会显示“已应用精简”。' : 'Summary generated, not applied yet. Click Apply condensation to show it as applied in the list.',
    condensationConflict: zh ? '上下文已变化，已刷新。请确认选区后重新生成精简。' : 'The context changed and has been refreshed. Check your selection and generate again.',
    condensationExpandRelated: zh ? '同步精简 AI 思考和工具输出' : 'Also condense AI reasoning and tool outputs',
    condensationExpandedNotice: count => zh ? `为保留完整回合，本次精简还包含以下 ${count} 项。应用即确认此范围。` : `To keep complete turns, this summary also includes the following ${count} items. Apply confirms this range.`,
    generateCondensation: zh ? '生成精简' : 'Generate summary',
    condensationModelPicker: zh ? '\u7cbe\u7b80\u6a21\u578b' : 'Condensation model',
    condenseSelected: count => zh ? `AI \u7cbe\u7b80${count ? `\uff08${count}\uff09` : ''}` : `AI condense${count ? ` (${count})` : ''}`,
    condensationGenerating: zh ? '\u6b63\u5728\u751f\u6210\u7cbe\u7b80\u6458\u8981\u2026' : 'Generating condensation...',
    cancelCondensation: zh ? '\u53d6\u6d88\u7cbe\u7b80' : 'Cancel condensation',
    regenerateCondensation: zh ? '\u91cd\u65b0\u751f\u6210' : 'Regenerate',
    condensationTitle: zh ? 'AI \u7cbe\u7b80\u4e0a\u4e0b\u6587' : 'AI condense context',
    condensationSummary: zh ? '\u7cbe\u7b80\u6458\u8981' : 'Condensation summary',
    condensationOriginal: zh ? '\u5c55\u5f00\u539f\u6587\u8303\u56f4' : 'Show original selected range',
    applyCondensation: zh ? '\u5e94\u7528\u7cbe\u7b80' : 'Apply condensation',
    restoreCondensation: zh ? '\u6062\u590d\u5230\u7cbe\u7b80\u524d\u7684\u65b0\u5206\u652f' : 'Recover to a new branch',
    createRecoveryBranch: zh ? '\u521b\u5efa\u6062\u590d\u5206\u652f' : 'Create recovery branch',
    recoveryPreview: (count, retained) => zh
      ? `将在新分支恢复此前的 ${count} 条消息。之后的 ${retained} 条消息保留在原会话。下面是恢复位置附近的用户消息。继续？`
      : `Restore the earlier ${count} messages in a new branch. The later ${retained} messages stay in the original session. The nearby user message is shown below. Continue?`,
    recoveryCreated: zh ? '\u6062\u590d\u5206\u652f\u5df2\u6838\u5b9e\u5e76\u4fdd\u5b58\u3002' : 'Recovery branch verified and saved.',
    recoveryUnavailable: reason => zh ? `\u65e0\u6cd5\u6062\u590d\uff1a${reason}` : `Recovery is unavailable: ${reason}`,
    nativeCompactionRecovery: zh ? '\u539f\u751f\u538b\u7f29\u6062\u590d' : 'Native compaction recovery',
    nativeCompactionCheckpoint: value => zh ? `\u538b\u7f29\u68c0\u67e5\u70b9\uff1a${Number(value)}` : `Compaction checkpoint: ${Number(value)}`,
    activeCondensation: zh ? '\u5df2\u5e94\u7528\u7cbe\u7b80' : 'Applied condensation',
    activeCondensations: zh ? '\u5df2\u5e94\u7528\u7684\u7cbe\u7b80\u6458\u8981' : 'Applied condensations',
    condensationSource: (count, expanded) => zh ? `\u539f\u6587\u8303\u56f4\uff1a${count} \u4e2a\u5355\u5143${expanded ? `（\u81ea\u52a8\u6269\u5c55 ${expanded} \u4e2a）` : ''}` : `Source range: ${count} units${expanded ? ` (${expanded} auto-expanded)` : ''}`,
    condensationFirstChange: value => zh ? `\u9996\u6b21\u53d8\u5316\u4f4d\u7f6e\uff1a${value}` : `First changed root: ${value}`,
    condensationModel: (provider, model) => `${provider ?? ''} / ${model ?? ''}`,
    condensationBefore: value => zh ? `\u539f\u6587\u4f30\u7b97 token\uff1a${Number(value) || 0}` : `Original estimate: ${Number(value) || 0} tokens`,
    condensationPrefix: value => zh ? `\u672a\u6539\u53d8\u524d\u7f00\u4f30\u7b97 token\uff1a${Number(value) || 0}` : `Unchanged prefix estimate: ${Number(value) || 0} tokens`,
    condensationPrefixNotReused: zh ? '\u5df2\u5207\u6362\u7cbe\u7b80\u6a21\u578b\uff0c\u672c\u6b21\u751f\u6210\u672a\u590d\u7528\u4f1a\u8bdd\u524d\u7f00' : 'The selected model differs; this generation did not reuse the session prefix.',
    condensationAfter: value => zh ? `\u6458\u8981\u4f30\u7b97 token\uff1a${Number(value) || 0}` : `Summary estimate: ${Number(value) || 0} tokens`,
    condensationSaved: (saved, ratio) => zh ? `\u9884\u8ba1\u8282\u7701\uff1a${Number(saved) || 0} token\uff08${Math.round((Number(ratio) || 0) * 100)}%\uff09` : `Estimated savings: ${Number(saved) || 0} tokens (${Math.round((Number(ratio) || 0) * 100)}%)`,
    condensationCoverage: (status, covered, total) => {
      const label = status === 'full' ? (zh ? '\u5b8c\u5168\u88ab\u539f\u751f\u538b\u7f29\u8986\u76d6' : 'Fully covered by native compaction')
        : status === 'partial' ? (zh ? '\u90e8\u5206\u88ab\u539f\u751f\u538b\u7f29\u8986\u76d6' : 'Partially covered by native compaction')
          : (zh ? '\u5c1a\u672a\u88ab\u539f\u751f\u538b\u7f29\u5438\u6536' : 'Not covered by native compaction')
      return `${label} (${Number(covered) || 0}/${Number(total) || 0})`
    },
    condensationCheckpoint: value => zh ? `\u539f\u751f\u538b\u7f29\u5df2\u66ff\u6362\u539f\u6587\uff0c\u8bf7\u5148\u901a\u8fc7\u5bbf\u4e3b\u7684\u5206\u652f/\u68c0\u67e5\u70b9\u5165\u53e3\u8fd4\u56de\u538b\u7f29\u524d\u68c0\u67e5\u70b9${Number.isSafeInteger(Number(value)) ? `\uff08\u5e8f\u53f7 ${Number(value)}\uff09` : ''}\u540e\u518d\u6062\u590d\u3002` : `Native compaction replaced the original range. Use the host branch/checkpoint entry to return to the pre-compaction checkpoint${Number.isSafeInteger(Number(value)) ? ` (event ${Number(value)})` : ''} before restoring.`,
    condensationRestoreUnavailable: zh ? '\u539f\u751f\u538b\u7f29\u5df2\u8986\u76d6\u8be5\u8303\u56f4\uff0c\u5f53\u524d\u65e0\u53ef\u8bc1\u660e\u7684\u68c0\u67e5\u70b9\uff0c\u6682\u4e0d\u80fd\u76f4\u63a5\u6062\u590d\u3002' : 'Native compaction covered this range, but no verifiable checkpoint is available for direct restore.',
    condensationLowSaving: zh ? '本次精简收益较小：缩短不足 40% 或节省不足 500 个估算 token，可重新生成或手动删减。' : 'Small reduction: under 40% or fewer than 500 estimated tokens saved. Consider regenerating or editing.',
    condensationRisks: risks => zh ? `\u98ce\u9669\u63d0\u793a\uff1a${risks}` : `Risks: ${risks}`,
    condensationHint: zh ? '\u53ef\u624b\u52a8\u8c03\u6574\u6458\u8981\uff1bCtrl/Cmd+Enter \u5e94\u7528\uff0cEsc \u53d6\u6d88\u3002\u751f\u6210\u6216\u5e94\u7528\u671f\u95f4\u4e3b\u4f1a\u8bdd\u4fdd\u6301\u4e0d\u53d8\u3002' : 'You can edit the summary. Ctrl/Cmd+Enter applies it; Esc cancels. The main session stays unchanged while generating.',
    condensationFailed: error => zh ? `\u7cbe\u7b80\u5931\u8d25\uff1a${error}` : `Condensation failed: ${error}`,
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
    loading: zh ? '正在加载会话…' : 'Loading session…',
    loadingMore: zh ? '正在加载更多记录…' : 'Loading more history…',
    unloadedHistory: count => zh ? `中间还有 ${Number(count) || 0} 条未加载记录` : `${Number(count) || 0} history records between these items are not loaded`,
    loadMoreHistory: (loaded, total) => zh
      ? `加载更多记录（${Number(loaded) || 0}/${Number(total) || 0}）`
      : `Load more history (${Number(loaded) || 0}/${Number(total) || 0})`,
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
        'request-transform-plain-text-only': zh ? '仅支持完整的纯文本消息，不能包含思考、工具、图片或签名' : 'only complete plain text messages without reasoning, tools, images, or signatures are supported',
        'associated-reasoning-unavailable': zh ? '关联的本轮思考或工具链无法安全投影' : 'the associated reasoning or tool chain cannot be projected safely',
        'condensation-active': zh ? '摘要已生效，请先恢复精简前内容' : 'condensation is active; restore it before editing',
      }
      return zh ? `不可编辑：${labels[reason] ?? '内容类型不支持'}` : `Not editable: ${labels[reason] ?? 'this content is not supported'}`
    },
    replacementDisabled: zh ? '手动上下文编辑尚未启用' : 'Manual context editing is not enabled',
    restoreReplacementConfirm: zh ? '确认恢复该单元的原文吗？' : 'Restore this unit to its original text?',
    excludeAssociatedReasoning: zh ? '同时从后续上下文中排除本轮思考内容' : "Also exclude this turn's reasoning from later context",
    excludeAssociatedReasoningHint: zh ? '避免旧思考与修改后的回答不一致，可能影响下一次请求的提示词缓存。' : 'Prevents stale reasoning from disagreeing with the edited answer; prompt-cache behavior may change.',
    replacementImpactTitle: zh ? '实际影响范围' : 'Actual impact',
    replacementImpactExtra: ids => zh ? `签名保护会扩展到工具链：${ids}` : `Signature safety expands this to the tool chain: ${ids}`,
    replacementImpactUnits: ids => zh ? `将新增排除：${ids}` : `Newly excluded units: ${ids}`,
    replacementImpactDisabled: reason => zh ? `联动已禁用：${reason}` : `Linked exclusion disabled: ${reason}`,
    replacementImpactConfirm: zh ? '确认保存' : 'Confirm save',
    editFailed: error => zh ? `编辑失败：${error}` : `Edit failed: ${error}`,
    operationRecovered: zh ? '已从持久化会话核实上次编辑，修改已生效。' : 'The previous edit was verified from durable session history.',
    operationPending: zh ? '上次编辑尚未写入宿主会话；可重试同一操作完成提交。' : 'The previous edit has no verified host write yet. Retry the same action to finish it.',
    operationFailed: zh ? '已核实上次操作未写入会话，可重新操作。' : 'The previous operation was confirmed absent from the session. You can try again.',
    operationUnverified: zh ? '无法核实上次编辑状态，已暂停新的上下文修改。恢复宿主后重新打开面板再检查。' : 'The previous edit could not be verified. New context writes are paused; reopen the panel when the host is available to check again.',
  }
}
