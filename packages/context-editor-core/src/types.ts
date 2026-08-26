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

/** The revision type is string in Pi, while small in-memory hosts often use a number. */
export type ContextRevision = string | number

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
}

export interface ContextEditorSnapshot {
  revision: string
  sourceLeafId: string | null
  records: Array<Pick<ContextRecord, 'id' | 'kind' | 'viewState' | 'mutable' | 'entryId' | 'entryIds' | 'anchorEntryId' | 'toolCallId'> & { projectionState?: ContextEditableUnitProjectionState; units: Array<Pick<ContextEditableUnit, 'id' | 'recordId' | 'kind' | 'atomIds' | 'viewState' | 'mutable'> & { projectionState?: ContextEditableUnitProjectionState; effectiveText?: string; replacementState?: ContextReplacementProjectionState; replacementSupported?: boolean; replacementDisabledReason?: ContextReplacementDisabledReason; canRestoreReplacement?: boolean; canUndoReplacement?: boolean }> }>
  canUndo: boolean
  legacyStateFound: boolean
  projectionAvailable?: boolean
  projectionError?: string
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
    }

export type ContextProjectionEvent = ContextProjectionEventV1 | ContextReplacementEventV1

export function contextProjectionEventId(event: ContextProjectionEvent): string {
  return 'type' in event && event.type === 'replacement' ? event.eventId : (event as ContextProjectionEventV1).transactionId
}
