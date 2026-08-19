/* GENERATED FROM packages/context-editor-core; do not edit directly. */
import type {
  ContextEditorSnapshot,
  ContextEditableUnitKind,
  ContextRecord,
  ContextRecordKind,
  ContextSearchMatch,
  ContextSearchScope,
  ContextEditorViewEventV2,
} from './types.js'

/** Host-neutral identity for one persisted conversation. */
export interface ContextSessionLocator {
  readonly host: string
  readonly sessionId: string
  readonly workspaceId?: string
  readonly branchId?: string
}

/** Host-neutral source position used to derive stable atom and record ids. */
export interface ContextSourceRef {
  readonly sourceId: string
  readonly sequence: number
  readonly blockIndex: number
  readonly turnId?: string
  readonly stepId?: string | number
  readonly callId?: string
}

/** Capabilities exposed by a host adapter. */
export interface ContextHostCapabilities {
  readonly paging: boolean
  readonly search: boolean
  readonly viewMutation: boolean
  readonly undo: boolean
  readonly persistence: boolean
  /** Reserved for the later model-context exclusion feature. */
  readonly contextExclusion: false
}

export interface ContextRecordPage {
  readonly records: readonly ContextRecord[]
  readonly nextCursor: string | null
  readonly sourceRevision: string
  readonly viewRevision: string
}

export interface ContextRecordDetail {
  readonly record: ContextRecord
  readonly sourceRevision: string
  readonly viewRevision: string
}

export interface ContextSearchRequest {
  readonly locator: ContextSessionLocator
  readonly query: string
  readonly enabledKinds: readonly ContextRecordKind[]
  /** Optional unit-level filter. Omitted by older clients for V1 behavior. */
  readonly enabledUnitKinds?: readonly ContextEditableUnitKind[]
  readonly scope?: ContextSearchScope
}

export interface ContextSearchSummary {
  readonly searchId: string
  readonly revision: string
  readonly total: number
  readonly totalOccurrences: number
}

export interface ContextSearchMatchRequest {
  readonly locator: ContextSessionLocator
  readonly searchId: string
  readonly revision: string
  readonly index: number
}

export interface ContextViewMutationRequest {
  readonly locator: ContextSessionLocator
  readonly baseRevision: string
  readonly action: 'hide' | 'restore' | 'reset'
  readonly recordIds?: readonly string[]
  readonly unitIds?: readonly string[]
}

export interface ContextMutationResult {
  readonly ok: boolean
  readonly conflict?: boolean
  readonly eventId?: string
  readonly snapshot: ContextEditorSnapshot
}

/** Host contract consumed by any Context Editor client. */
export interface ContextEditorHostAdapter {
  getSnapshot(locator: ContextSessionLocator): Promise<ContextEditorSnapshot>
  listRecords(locator: ContextSessionLocator, cursor?: string, limit?: number): Promise<ContextRecordPage>
  getRecord(locator: ContextSessionLocator, recordId: string): Promise<ContextRecordDetail | null>
  searchRecords(request: ContextSearchRequest): Promise<ContextSearchSummary>
  getSearchMatch(request: ContextSearchMatchRequest): Promise<ContextSearchMatch | null>
  commitView(request: ContextViewMutationRequest): Promise<ContextMutationResult>
  undoView(locator: ContextSessionLocator, baseRevision: string): Promise<ContextMutationResult>
}

/** Persisted view event shape shared by Pi and non-Pi hosts. */
export type ContextViewEvent = ContextEditorViewEventV2
