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
import type {
  CondensationProposal,
  CondensationRange,
  CondensationValidation,
} from './condensation.js'
import type { ContextEditableUnitProjectionState } from './types.js'

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
  /** Whether this host can change the model-facing context projection. */
  readonly contextExclusion: boolean
  /** Whether the host can edit User/Answer text in the model-facing projection. */
  readonly contextReplacement: boolean
  /** Whether this host can generate and apply AI condensation proposals. */
  readonly contextCondensation?: boolean
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
  /** Record-level compatibility filter. New clients derive it from enabledUnitKinds. */
  readonly enabledKinds: readonly ContextRecordKind[]
  /** Canonical user/reasoning/answer/tool filter. Omitted by older clients. */
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

export interface ContextProjectionMutationRequest {
  readonly locator: ContextSessionLocator
  readonly baseRevision: string
  readonly action: 'exclude' | 'restore'
  readonly recordIds?: readonly string[]
  readonly unitIds?: readonly string[]
  /** Identifies the active condensation surface when toggling its summary as a whole. */
  readonly condensationOperationId?: string
}

export interface ContextReplacementMutationRequest {
  readonly locator: ContextSessionLocator
  readonly baseRevision: string | number
  readonly operationId: string
  readonly unitId: string
  readonly text: string
  /** When true, a replace may also exclude same-turn reasoning in one operation. */
  readonly excludeAssociatedReasoning?: boolean
  /** Unit ids explicitly confirmed by the impact preview. */
  readonly confirmedUnitIds?: readonly string[]
  /** Alias accepted by hosts that call the field a confirmation scope. */
  readonly confirmationScope?: readonly string[]
}

export interface ContextReplacementUnitRequest {
  readonly locator: ContextSessionLocator
  readonly baseRevision: string | number
  readonly operationId: string
  readonly unitId: string
}

export interface ContextReplacementPreview {
  readonly baseRevision: string
  readonly unitId: string
  readonly unitKind: 'user' | 'answer'
  readonly textChanged: boolean
  readonly excludeAssociatedReasoning: boolean
  readonly associatedReasoningUnitIds: readonly string[]
  readonly requestedUnitIds: readonly string[]
  readonly effectiveUnitIds: readonly string[]
  readonly autoExpandedUnitIds: readonly string[]
  readonly newlyExcludedUnitIds: readonly string[]
  readonly alreadyExcludedUnitIds: readonly string[]
  readonly newlyExcludedAtomIds: readonly string[]
  readonly alreadyExcludedAtomIds: readonly string[]
  readonly unavailableUnitIds: readonly string[]
  readonly requiresConfirmation: boolean
  readonly canCommit: boolean
  readonly disabledReason?: string
}

export interface ContextProjectionPreview {
  readonly baseRevision: string
  readonly action: 'exclude' | 'restore'
  readonly requestedUnitIds: readonly string[]
  readonly effectiveUnitIds: readonly string[]
  readonly autoExpandedUnitIds: readonly string[]
  readonly requestedAtomIds: readonly string[]
  readonly effectiveAtomIds: readonly string[]
  readonly unavailableUnitIds: readonly string[]
  readonly touchesRecentTurn: boolean
  readonly stateByUnitId: Readonly<Record<string, ContextEditableUnitProjectionState>>
}

export interface ContextMutationResult {
  readonly ok: boolean
  readonly conflict?: boolean
  readonly operationId?: string
  readonly eventId?: string
  /** The operation is still valid, but native compaction requires a checkpoint return first. */
  readonly restoreRequired?: boolean
  readonly restoreMode?: 'inline' | 'checkpoint' | 'unavailable'
  readonly checkpointCompactionId?: string
  readonly checkpointSeq?: number
  readonly checkpointEntryId?: string
  readonly snapshot: ContextEditorSnapshot
}

export interface ContextCondensationPrepareRequest {
  readonly expandRelated?: boolean
  readonly locator: ContextSessionLocator
  readonly baseRevision: string
  readonly unitIds: readonly string[]
  readonly provider?: string
  readonly model?: string
  readonly maxTokens?: number
  readonly signal?: AbortSignal
}

export interface ContextCondensationCommitRequest {
  readonly locator: ContextSessionLocator
  readonly baseRevision: string
  readonly operationId: string
  readonly summary: string
  readonly unitIds?: readonly string[]
}

export interface ContextCondensationRestoreRequest {
  readonly locator: ContextSessionLocator
  readonly baseRevision: string
  readonly operationId: string
}

export interface ContextCondensationCancelRequest {
  readonly locator: ContextSessionLocator
  readonly operationId: string
}

export interface ContextCondensationUndoRequest extends ContextCondensationRestoreRequest {}

export interface ContextCondensationPreview extends CondensationProposal {
  readonly ok: boolean
  readonly snapshot: ContextEditorSnapshot
  readonly range?: CondensationRange
  readonly validation?: CondensationValidation
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
  previewContext(request: ContextProjectionMutationRequest): Promise<ContextProjectionPreview>
  previewReplacement?(request: ContextReplacementMutationRequest): Promise<ContextReplacementPreview>
  commitContext(request: ContextProjectionMutationRequest): Promise<ContextMutationResult>
  commitReplacement?(request: ContextReplacementMutationRequest): Promise<ContextMutationResult>
  restoreReplacement?(request: ContextReplacementUnitRequest): Promise<ContextMutationResult>
  undoReplacement?(request: ContextReplacementUnitRequest): Promise<ContextMutationResult>
  prepareCondensation?(request: ContextCondensationPrepareRequest): Promise<ContextCondensationPreview>
  generateCondensation?(request: ContextCondensationPrepareRequest): Promise<ContextCondensationPreview>
  cancelCondensation?(request: ContextCondensationCancelRequest): Promise<{ readonly ok: boolean; readonly operationId: string; readonly cancelled: boolean }>
  commitCondensation?(request: ContextCondensationCommitRequest): Promise<ContextMutationResult>
  restoreCondensation?(request: ContextCondensationRestoreRequest): Promise<ContextMutationResult>
  undoCondensation?(request: ContextCondensationUndoRequest): Promise<ContextMutationResult>
}

/** Persisted view event shape shared by Pi and non-Pi hosts. */
export type ContextViewEvent = ContextEditorViewEventV2
