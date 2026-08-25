import type { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

export declare class ContextEditorHost extends TypertRemoteService {
  getSnapshot(request: unknown): Promise<unknown>
  listRecords(request: unknown): Promise<unknown>
  getRecord(request: unknown): Promise<unknown>
  searchRecords(request: unknown): Promise<unknown>
  getSearchMatch(request: unknown): Promise<unknown>
  previewContext(request: unknown): Promise<unknown>
  commitContext(request: unknown): Promise<unknown>
  commitView(request: unknown): Promise<unknown>
  undoView(request: unknown): Promise<unknown>
}

export declare const inject: readonly ['storageDomain', 'sessionPersistence', 'sessions', 'agents']
export declare const contextEditorDomainSpec: unknown
export declare function apply(ctx: unknown): Promise<void>
