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
export type ContextRecordKind = 'user' | 'ai' | 'tool'
export type ContextEditableUnitKind = 'reasoning' | 'answer' | 'user' | 'tool'
export type ContextEditableUnitViewState = ViewState | 'mixed'

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
  mutable: boolean
}

export interface ContextEditableUnit {
  id: string
  recordId: string
  kind: ContextEditableUnitKind
  atomIds: string[]
  atoms: ContextAtom[]
  viewState: ContextEditableUnitViewState
  mutable: boolean
}

export interface ContextEditorSnapshot {
  revision: string
  sourceLeafId: string | null
  records: Array<Pick<ContextRecord, 'id' | 'kind' | 'viewState' | 'mutable' | 'entryId' | 'entryIds' | 'anchorEntryId' | 'toolCallId'> & { units: Array<Pick<ContextEditableUnit, 'id' | 'recordId' | 'kind' | 'atomIds' | 'viewState' | 'mutable'>> }>
  canUndo: boolean
  legacyStateFound: boolean
}

export interface ContextSearchMatch {
  index: number
  total: number
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
  occurrenceCount: number
}
