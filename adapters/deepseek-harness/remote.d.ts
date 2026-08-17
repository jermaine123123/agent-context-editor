export interface ContextEditorRemote {
  getSnapshot(request: unknown): Promise<unknown>
  listRecords(request: unknown): Promise<unknown>
  getRecord(request: unknown): Promise<unknown>
  searchRecords(request: unknown): Promise<unknown>
  getSearchMatch(request: unknown): Promise<unknown>
  commitView(request: unknown): Promise<unknown>
  undoView(request: unknown): Promise<unknown>
}

export declare const contextEditorRemote: {
  readonly package: 'context-editor-deepseek-harness'
  readonly descriptors: readonly unknown[]
}
export default contextEditorRemote

