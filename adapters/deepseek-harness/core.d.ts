/*
 * GENERATED FILE - do not edit directly.
 * Canonical Core source digest: f3f2e5d503d28a435a6ed6c681602b742d856aaae096212ff0b2f0588af2230d
 * Rebuild with: npm run build:deepseek
 */
export const HOST_ID: string
export const VIEW_SCHEMA_VERSION: number
export const STORAGE_SCHEMA_VERSION: number
export const RECORD_KINDS: readonly string[]

export type ContextEditableUnitKind = 'reasoning' | 'answer' | 'user' | 'tool'
export type ContextEditableUnitViewState = 'show' | 'hide' | 'collapse' | 'mixed'
export type ContextEditableUnitProjectionState = 'include' | 'exclude' | 'mixed' | 'unavailable'
export type ContextSearchScope = 'dialogue' | 'all'

export interface SessionIdentity {
  id: string
  createdAt: number
  cwd?: string
}

export interface ContextAtom {
  id: string
  recordId?: string
  sourceRef: { entryId: string; blockIndex: number; sourceId: string; sequence: number; turnId?: string; stepId?: string; callId?: string }
  kind: string
  turnId: string
  timestamp: number
  text: string
  fingerprint: string
  approxTokens: number
  toolCallId?: string
  toolName?: string
  isError?: boolean
  hasSignature?: boolean
  structured?: boolean
  mutable: boolean
}

export interface ContextRecord {
  id: string
  kind: 'user' | 'ai' | 'tool'
  atomIds: string[]
  atoms: ContextAtom[]
  units: ContextEditableUnit[]
  entryId?: string
  entryIds?: string[]
  anchorEntryId?: string
  toolCallId?: string
  searchableText: string
  viewState: 'show' | 'collapse' | 'hide'
  projectionState?: ContextEditableUnitProjectionState
  mutable: boolean
}

export interface ContextEditableUnit {
  id: string
  recordId: string
  kind: ContextEditableUnitKind
  atomIds: string[]
  atoms: ContextAtom[]
  viewState: ContextEditableUnitViewState
  projectionState?: ContextEditableUnitProjectionState
  mutable: boolean
  effectiveText: string
  replacementState: ContextReplacementProjectionState
  replacementSupported: boolean
  replacementDisabledReason?: ContextReplacementDisabledReason
  canRestoreReplacement: boolean
  canUndoReplacement: boolean
}

export type ContextReplacementProjectionState = 'original' | 'replaced' | 'unavailable'
export type ContextReplacementDisabledReason = 'unsupported-unit-kind' | 'structured-user-content' | 'signed-content' | 'projection-unavailable' | 'invalid-target'
export interface ContextReplacementAtomRef {
  atomId: string
  sourceRef: { entryId: string; blockIndex: number }
  fingerprint: string
}
export type ContextReplacementEventV1 = {
  schemaVersion: 1
  type: 'replacement'
  action: 'replace' | 'restore'
  eventId: string
  unitId: string
  unitKind: 'user' | 'answer'
  atomRefs: ContextReplacementAtomRef[]
  beforeText: string | null
  afterText: string | null
  baseRevision: string | number
  createdAt: string
} | {
  schemaVersion: 1
  type: 'replacement'
  action: 'undo'
  eventId: string
  unitId: string
  unitKind: 'user' | 'answer'
  undoOf: string
  baseRevision: string | number
  createdAt: string
}

export interface ViewEvent {
  version: 2
  transactionId: string
  createdAt: string
  baseRevision: string
  action: 'hide' | 'restore' | 'reset' | 'undo'
  changes: Array<{ atomId: string; fingerprint: string; before: string; after: string }>
  undoOf?: string
}

export function hashText(value: string): string
export function sessionIdentity(session: unknown): SessionIdentity
export function sameSessionLifecycle(left: unknown, right: unknown): boolean
export function normalizeSessionEvents(session: unknown, events: readonly unknown[]): { identity: SessionIdentity; atoms: ContextAtom[]; sourceRevision: number }
export function projectRecords(atoms: readonly ContextAtom[], states?: ReadonlyMap<string, string>, projectionStates?: ReadonlyMap<string, ContextEditableUnitProjectionState | 'unavailable'>, replacementStates?: ReadonlyMap<string, unknown>): ContextRecord[]
export function selectProjectionTargets(records: readonly ContextRecord[], unitIds?: readonly string[], recordIds?: readonly string[]): { requestedUnitIds: string[]; effectiveUnitIds: string[]; autoExpandedUnitIds: string[]; requestedAtomIds: string[]; effectiveAtomIds: string[]; unavailableUnitIds: string[]; touchesRecentTurn: boolean }
export function atomMatchesSearchScope(kind: string, scope?: ContextSearchScope): boolean
export function searchRecords(records: readonly ContextRecord[], query: string, enabledKinds?: readonly string[], scope?: ContextSearchScope, enabledUnitKinds?: readonly ContextEditableUnitKind[] | ReadonlySet<ContextEditableUnitKind>): Array<{
  index: number
  total: number
  recordId: string
  recordKind: 'user' | 'ai' | 'tool'
  atomId: string
  anchorEntryId?: string
  blockIndex: number
  unitId: string
  unitKind: ContextEditableUnitKind
  field: string
  start: number
  end: number
  excerpt: string
  occurrenceCount: number
}>
export function normalizeViewEvents(events: readonly unknown[]): ViewEvent[]
export function normalizeReplacementEvents(events: readonly unknown[]): ContextReplacementEventV1[]
export function reduceReplacementStates(units: readonly ContextEditableUnit[], events: readonly ContextReplacementEventV1[], projectionAvailable?: boolean): Map<string, unknown>
export function composeNativeRoot(projection: unknown, root: number, replacementStates?: ReadonlyMap<string, unknown>, records?: readonly ContextRecord[], replacementId?: string): { message?: unknown; pairs: Array<{ atomId?: string; unitId?: string; block: unknown }> }
export function reduceViewStates(atoms: readonly ContextAtom[], events: readonly unknown[]): Map<string, string>
export function latestUndoableEvent(events: readonly unknown[]): ViewEvent | undefined
export function inverseChanges(event: ViewEvent): ViewEvent['changes']
export function revisionFor(identity: unknown, sourceRevision: number, events: readonly unknown[], replacementEvents?: readonly unknown[], nativeEvents?: readonly unknown[]): string
export function buildViewEvent(options: {
  identity: unknown
  sourceRevision: number
  events: readonly unknown[]
  action: 'hide' | 'restore' | 'reset'
  records: readonly ContextRecord[]
  states: ReadonlyMap<string, string>
  recordIds?: readonly string[]
  unitIds?: readonly string[]
  transactionId: string
  now?: Date
  baseRevision?: string
}): ViewEvent
export function buildProjection(identity: unknown, events: readonly unknown[], row?: { session?: unknown; schemaVersion?: number; storageVersion?: number; events?: readonly unknown[]; replacementEvents?: readonly ContextReplacementEventV1[] }, options?: { activeSurfaceSeqs?: readonly number[]; preparedReplacementEvents?: readonly ContextReplacementEventV1[]; projectionAvailable?: boolean }): {
  identity: SessionIdentity
  atoms: ContextAtom[]
  sourceRevision: number
  events: ViewEvent[]
  states: Map<string, string>
  records: ContextRecord[]
  sourceEvents: unknown[]
  projectionStates: Map<string, ContextEditableUnitProjectionState | 'unavailable'>
  contextOverlays: Map<number, unknown>
  replacementEvents: ContextReplacementEventV1[]
  activeReplacementEvents: ContextReplacementEventV1[]
  replacementStates: Map<string, unknown>
  revision: string
  canUndo: boolean
}
export function recordSnapshot(record: ContextRecord): ContextRecord
