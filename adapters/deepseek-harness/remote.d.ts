export interface ContextEditorRemote {
  getSnapshot(request: unknown): Promise<unknown>
  getCompatibility(): Promise<unknown>
  runCompatibilityCheck(): Promise<unknown>
  getOperation(request: unknown): Promise<unknown>
  previewRecovery(request: unknown): Promise<unknown>
  createRecoveryBranch(request: unknown): Promise<unknown>
  listRecords(request: unknown): Promise<unknown>
  getRecord(request: unknown): Promise<unknown>
  searchRecords(request: unknown): Promise<unknown>
  getSearchMatch(request: unknown): Promise<unknown>
  previewContext(request: unknown): Promise<unknown>
  previewReplacement(request: unknown): Promise<unknown>
  commitContext(request: unknown): Promise<unknown>
  commitView(request: unknown): Promise<unknown>
  undoView(request: unknown): Promise<unknown>
  commitReplacement(request: unknown): Promise<unknown>
  restoreReplacement(request: unknown): Promise<unknown>
  undoReplacement(request: unknown): Promise<unknown>
}

export declare const contextEditorRemote: {
  readonly package: 'context-editor-deepseek-harness'
  readonly descriptors: readonly unknown[]
}
export default contextEditorRemote

