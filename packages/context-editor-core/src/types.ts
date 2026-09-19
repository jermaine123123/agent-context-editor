export const ATOM_KINDS = [
  'user',
  'assistant_text',
  'reasoning',
  'tool_call',
  'tool_output',
  'summary',
] as const

export type AtomKind = (typeof ATOM_KINDS)[number]
export type ViewState = 'show' | 'collapse' | 'hide'
export type ContextState = 'keep' | 'replace' | 'summarize' | 'exclude'
export type ContextProjectionState = 'include' | 'exclude'
export type ContextEditableUnitProjectionState = ContextProjectionState | 'mixed' | 'unavailable'
export type ContextRecordKind = 'user' | 'ai' | 'tool'
export type ContextEditableUnitKind = 'reasoning' | 'answer' | 'user' | 'tool'
export type ContextEditableUnitViewState = ViewState | 'mixed'
export type ContextSearchScope = 'dialogue' | 'all'
export type ReplacementText = string | null
export type ContextReplacementProjectionState = 'original' | 'replaced' | 'unavailable'
export type ContextReplacementDisabledReason =
  | 'unsupported-unit-kind'
  | 'structured-user-content'
  | 'signed-content'
  | 'projection-unavailable'
  | 'invalid-target'
  | 'condensation-active'
  | 'host-surface-contract'

export type CompatibilityState = 'available' | 'unsupported' | 'self-test-passed' | 'formally-accepted' | 'unknown'
export type CompatibilityVerificationLevel = 'interface-recognized' | 'isolated-self-test' | 'formal-acceptance' | 'none'
export interface HostIdentity {
  host: string
  version?: string
  components: Record<string, string>
  buildFingerprint: string
  pluginVersion: string
  pluginBuildFingerprint?: string
  adapter: string
  runtime: string
  storageBackend: string
}
export interface CompatibilityFeatureResult {
  available: boolean
  status: CompatibilityState
  verificationLevel: CompatibilityVerificationLevel
  reason?: string
  scope?: string
  evidence?: string[]
}
export interface CompatibilityReport {
  schemaVersion: 1
  hostIdentity: HostIdentity
  checkedAt: string
  features: Record<string, CompatibilityFeatureResult>
  selfTest?: {
    status: 'passed' | 'partial' | 'failed'
    usedSyntheticData: true
    persistenceTested: false
    cases: Record<string, boolean>
    diagnostics: string[]
  }
}
/** The revision type is string in Pi, while small in-memory hosts often use a number. */
export type ContextRevision = string | number

export type ContextCondensationCoverageStatus = 'none' | 'partial' | 'full'
export type ContextCondensationRestoreMode = 'inline' | 'checkpoint' | 'unavailable'

export interface ContextNativeCompactionRef {
  host: string
  compactionId: string
  shadowedRootSeqs: number[]
  /** Host-native opaque entry identifiers (Pi uses these instead of seqs). */
  shadowedEntryIds?: string[]
  startSeq?: number
  shadowedRange?: { start: number; end: number }
  summarySeq?: number
  checkpointSeq?: number
  /** Host-native checkpoint identifier used for branch/tree recovery. */
  checkpointEntryId?: string
  endSeq?: number
  committed?: boolean
}

export interface ContextCondensationCoverage {
  status: ContextCondensationCoverageStatus
  restoreMode: ContextCondensationRestoreMode
  coveredSourceRootSeqs: number[]
  uncoveredSourceRootSeqs: number[]
  coveredSourceEntryIds?: string[]
  uncoveredSourceEntryIds?: string[]
  nativeCompactions: ContextNativeCompactionRef[]
  checkpointCompactionId?: string
  checkpointSeq?: number
  checkpointEntryId?: string
  reason?: 'native-compaction-absorbed-source' | 'checkpoint-unavailable'
}

export interface SourceRef {
  entryId: string
  blockIndex: number
}

export interface ContextAtom {
  id: string
  /** Adapter-provided record identity for paired call/result atoms. */
  recordId?: string
  sourceRef: SourceRef
  kind: AtomKind
  turnId: string
  timestamp: number
  text: string
  fingerprint: string
  approxTokens: number
  toolCallId?: string
  toolName?: string
  isError?: boolean
  hasSignature?: boolean
  redacted?: boolean
  /** User content that is not a plain text message cannot be edited in v1. */
  structured?: boolean
}

export interface AtomViewState {
  fingerprint: string
  viewState: ViewState
  contextState: ContextState
}

export interface ContextViewFilterState {
  enabledKinds: AtomKind[]
  query: string
  showHidden: boolean
}

export interface ContextEditorStateV1 {
  version: 1
  updatedAt: string
  sourceLeafId?: string
  items: Record<string, AtomViewState>
  viewFilter?: ContextViewFilterState
}

export interface ContextEditorViewChange {
  atomId: string
  fingerprint: string
  before: ViewState
  after: ViewState
}

export interface ContextEditorViewEventV2 {
  version: 2
  transactionId: string
  createdAt: string
  baseRevision: string
  action: 'hide' | 'restore' | 'reset' | 'undo'
  changes: ContextEditorViewChange[]
  undoOf?: string
}

export interface ContextRecord {
  id: string
  kind: ContextRecordKind
  atomIds: string[]
  atoms: ContextAtom[]
  units: ContextEditableUnit[]
  entryId?: string
  /** Every Pi entry represented by this record (an AI reply may span several entries). */
  entryIds?: string[]
  anchorEntryId?: string
  toolCallId?: string
  searchableText: string
  viewState: ViewState
  projectionState: ContextEditableUnitProjectionState
  mutable: boolean
}

export interface ContextEditableUnit {
  id: string
  recordId: string
  kind: ContextEditableUnitKind
  atomIds: string[]
  atoms: ContextAtom[]
  viewState: ContextEditableUnitViewState
  projectionState: ContextEditableUnitProjectionState
  mutable: boolean

  /** Text currently visible to the editor and search index. Canonical atoms remain unchanged. */
  effectiveText: string
  replacementState: ContextReplacementProjectionState
  replacementSupported: boolean
  replacementDisabledReason?: ContextReplacementDisabledReason
  canRestoreReplacement: boolean
  canUndoReplacement: boolean
  associatedReasoningUnitIds?: string[]
}

export interface ContextEditorSnapshot {
  revision: string
  contextRevision?: string
  historyCursor?: string
  compatibility?: CompatibilityReport
  sourceLeafId: string | null
  records: Array<Pick<ContextRecord, 'id' | 'kind' | 'viewState' | 'mutable' | 'entryId' | 'entryIds' | 'anchorEntryId' | 'toolCallId'> & { projectionState?: ContextEditableUnitProjectionState; units: Array<Pick<ContextEditableUnit, 'id' | 'recordId' | 'kind' | 'atomIds' | 'viewState' | 'mutable'> & { projectionState?: ContextEditableUnitProjectionState; effectiveText?: string; replacementState?: ContextReplacementProjectionState; replacementSupported?: boolean; replacementDisabledReason?: ContextReplacementDisabledReason; canRestoreReplacement?: boolean; canUndoReplacement?: boolean; associatedReasoningUnitIds?: string[] }> }>
  canUndo: boolean
  legacyStateFound: boolean
  projectionAvailable?: boolean
  projectionError?: string
  capabilities?: {
    paging: boolean
    search: boolean
    viewMutation: boolean
    undo: boolean
    persistence: boolean
    contextExclusion: boolean
    contextReplacement: boolean
    contextCondensation?: boolean
    contextReplacementScope?: string
    nativeCompaction?: boolean
  }
  /** Applied AI condensation summaries currently visible in the model projection. */
  condensations?: ContextCondensationSnapshot[]
}

export interface ContextCondensationSnapshot {
  operationId: string
  status: 'applied' | 'restored'
  contextExcluded?: boolean
  summary: string
  requestedUnitIds: string[]
  effectiveUnitIds: string[]
  autoExpandedUnitIds: string[]
  recordIds: string[]
  sourceRootSeqs: number[]
  sourceFingerprint?: string
  sourceUnits: Array<{
    id: string
    recordId: string
    kind: ContextEditableUnitKind
    atomIds: string[]
    sourceEntryIds?: string[]
    sourceRootSeqs: number[]
    text: string
    included: boolean
    approxTokens: number
    toolNames?: string[]
    isError?: boolean
    hasSignature?: boolean
    structured?: boolean
  }>
  metrics: {
    beforeTokens: number
    afterTokens: number
    savedTokens: number
    savingsRatio: number
    belowRecommendedThreshold: boolean
  }
  provider: string
  model: string
  createdAt: string
  coverage?: ContextCondensationCoverage
}

export interface ContextSearchOccurrence {
  recordId: string
  recordKind: ContextRecordKind
  unitId: string
  unitKind: ContextEditableUnitKind
  atomId: string
  anchorEntryId?: string
  blockIndex: number
  field: 'message' | 'reasoning' | 'tool_name' | 'tool_args' | 'tool_output'
  start: number
  end: number
  excerpt: string
}

export interface ContextSearchMatch extends ContextSearchOccurrence {
  index: number
  total: number
  occurrenceCount: number
}

export interface ContextProjectionChange {
  atomId: string
  fingerprint: string
  sourceRef: SourceRef
  before: ContextProjectionState
  after: ContextProjectionState
}

export interface ContextProjectionEventV1 {
  version: 1
  transactionId: string
  createdAt: string
  baseRevision: string
  action: 'exclude' | 'restore'
  changes: ContextProjectionChange[]
}

export interface ContextReplacementAtomRef {
  atomId: string
  sourceRef: SourceRef
  fingerprint: string
}

/** Metadata carried by an Answer replacement that also excludes its reasoning. */
export interface ContextReplacementLinkedExclusion {
  /** The operation that owns this linked exclusion (normally the replacement event id). */
  operationId: string
  /** Reasoning/tool units newly affected by this operation. */
  unitIds: string[]
  /** Atom-level transitions, including the state that must be restored on whole-operation undo. */
  atomChanges: ContextProjectionChange[]
}

export type ContextReplacementEventV1 =
  | {
      schemaVersion: 1
      type: 'replacement'
      action: 'replace' | 'restore'
      eventId: string
      unitId: string
      unitKind: 'user' | 'answer'
      atomRefs: ContextReplacementAtomRef[]
      beforeText: ReplacementText
      afterText: ReplacementText
      baseRevision: ContextRevision
      createdAt: string
      linkedExclusion?: ContextReplacementLinkedExclusion
    }
  | {
      schemaVersion: 1
      type: 'replacement'
      action: 'undo'
      eventId: string
      unitId: string
      undoOf: string
      baseRevision: ContextRevision
      createdAt: string
      linkedExclusion?: ContextReplacementLinkedExclusion
    }

/** A host-neutral, reversible model-context condensation projection. */
export interface ContextCondensationEventV1 {
  schemaVersion: 1
  type: 'condensation'
  action: 'apply' | 'restore' | 'exclude-summary' | 'restore-summary'
  eventId: string
  operationId: string
  sessionId: string
  baseRevision: ContextRevision
  requestedUnitIds: string[]
  effectiveUnitIds: string[]
  autoExpandedUnitIds?: string[]
  recordIds?: string[]
  sourceEntryIds: string[]
  sourceRootSeqs: number[]
  sourceFingerprint?: string
  sourceUnits: Array<{
    id: string
    recordId: string
    kind: ContextEditableUnitKind
    atomIds: string[]
    sourceEntryIds?: string[]
    sourceRootSeqs: number[]
    text: string
    included: boolean
    approxTokens: number
    toolNames?: string[]
    isError?: boolean
    hasSignature?: boolean
    structured?: boolean
  }>
  summary: string
  provider: string
  model: string
  metrics: {
    beforeTokens: number
    afterTokens: number
    savedTokens: number
    savingsRatio: number
    belowRecommendedThreshold: boolean
  }
  prefixTokens: number
  prefixReused?: boolean
  summaryTokens: number
  createdAt: string
  /** Provider-shaped messages before and after the condensation. */
  beforeMessages: Array<{ entryId: string; message: unknown }>
  afterMessages: Array<{ entryId: string; message: unknown }>
  coverage?: ContextCondensationCoverage
}

export type ContextProjectionEvent = ContextProjectionEventV1 | ContextReplacementEventV1 | ContextCondensationEventV1

export function contextProjectionEventId(event: ContextProjectionEvent): string {
  if ('type' in event && event.type === 'replacement') return event.eventId
  if ('type' in event && event.type === 'condensation') return event.eventId
  return (event as ContextProjectionEventV1).transactionId
}
