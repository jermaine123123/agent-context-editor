export type HarnessLocale = 'zh' | 'en'

export interface HarnessText {
  more: string
  diagnostics: string
  details: string
  actionDetails: string
  dismiss: string
  verifyOperation: string
  nativeProjectionUnsupported: string
  featureUnavailable(reason?: string): string
  compatibilitySummary(report: unknown): string
  runCompatibilityCheck: string
  compatibilityChecking: string
  compatibilityCheckFailed(error: string): string
  condensationPending: string
  condensationExpandedNotice(count: number): string
  condensationConflict: string
  restoreCondensation: string
  createRecoveryBranch: string
  recoveryPreview(boundary: number, count: number): string
  recoveryCreated: string
  recoveryUnavailable(reason: string): string
  nativeCompactionRecovery: string
  nativeCompactionCheckpoint(sequence: number): string
  locale: HarnessLocale
  kind(kind: string): string
  unitKind(kind: string): string
  empty: string
  mixedPlaceholder: string
  hiddenPlaceholder(kind: string): string
  partiallyHidden: string
  hidden: string
  restore: string
  showHidden: string
  searchPlaceholder: string
  searchPlaceholderForScope(scope: 'dialogue' | 'all'): string
  searchAria: string
  searchFailed(error: string): string
  searchSummary(total: number, occurrences: number, current: number | undefined, index: number, active?: boolean, scope?: 'dialogue' | 'all'): string
  searchScope(scope: 'dialogue' | 'all'): string
  previous: string
  next: string
  hideSelected(count: number): string
  restoreSelected: string
  restoreAll: string
  undo: string
  running: string
  loading: string
  loadingMore: string
  unloadedHistory(count: number): string
  loadMoreHistory(loaded: number, total: number): string
  noRecords: string
  edit: string
  edited: string
  restoreOriginal: string
  undoReplacement: string
  compareOriginal: string
  showEffective: string
  originalText: string
  editTitle(kind: string): string
  cancel: string
  save: string
  replacementEmpty: string
  replacementConflict: string
  replacementUnavailable(reason?: string): string
  replacementDisabled: string
  restoreReplacementConfirm: string
  editFailed(error: string): string
  operationRecovered: string
  operationPending: string
  operationUnverified: string
}

export declare function detectHarnessLocale(source?: unknown): HarnessLocale
export declare function createHarnessText(locale: HarnessLocale): HarnessText
