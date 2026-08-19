import { branchRevision, stableFingerprint } from './fingerprint.js'
import { projectRecords } from './records.js'
import { searchRecords } from './search.js'
import {
  inverseChanges,
  latestUndoableEvent,
  readLatestLegacyState,
  readViewEvents,
  reduceViewStates,
  VIEW_EVENT_ENTRY_TYPE,
} from './state.js'
import type {
  ContextAtom,
  ContextEditableUnitKind,
  ContextEditorSnapshot,
  ContextEditorViewEventV2,
  ContextRecord,
  ContextRecordKind,
  ContextSearchMatch,
  ContextSearchScope,
  ViewState,
} from './types.js'

export interface ContextEditorAdapterSnapshot {
  entries: readonly unknown[]
  atoms: readonly ContextAtom[]
  leafId: string | null
  revision: string
  revisionProbe: string
  /** V2 events stored outside the host session (for example a Pi sidecar). */
  viewEvents?: readonly ContextEditorViewEventV2[]
}

/** Host-specific session access required by the shared context editor service. */
export interface ContextEditorSessionAdapter {
  read(): ContextEditorAdapterSnapshot
  /** Persist a V2 event in host-specific storage. */
  appendViewEvent?(data: ContextEditorViewEventV2): string
  /** @deprecated Use appendViewEvent. Kept for Pi Desktop and old adapters. */
  appendCustomEntry?(customType: typeof VIEW_EVENT_ENTRY_TYPE, data: ContextEditorViewEventV2): string
  isBusy(): boolean
}

type ContextOperation = 'hide' | 'restore' | 'reset'

type SearchCache = {
  id: string
  revision: string
  revisionProbe: string
  matches: ContextSearchMatch[]
}

function recordSnapshot(record: ContextRecord) {
  return {
    id: record.id,
    kind: record.kind,
    viewState: record.viewState,
    mutable: record.mutable,
    units: record.units.map((unit) => ({
      id: unit.id,
      recordId: unit.recordId,
      kind: unit.kind,
      atomIds: unit.atomIds,
      viewState: unit.viewState,
      mutable: unit.mutable,
    })),
    ...(record.entryId ? { entryId: record.entryId } : {}),
    ...(record.entryIds?.length ? { entryIds: record.entryIds } : {}),
    ...(record.anchorEntryId ? { anchorEntryId: record.anchorEntryId } : {}),
    ...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
  }
}

function currentState(adapter: ContextEditorSessionAdapter) {
  const current = adapter.read()
  const legacy = readLatestLegacyState(current.entries)
  const persistedEvents = current.viewEvents ?? []
  const sessionEvents = readViewEvents(current.entries)
  const seen = new Set<string>()
  const events = [...sessionEvents, ...persistedEvents].filter((event) => {
    if (seen.has(event.transactionId)) return false
    seen.add(event.transactionId)
    return true
  })
  const states = reduceViewStates(current.atoms, legacy, events)
  const records = projectRecords(current.atoms, states)
  return { ...current, legacy, events, states, records }
}

function appendViewEvent(adapter: ContextEditorSessionAdapter, event: ContextEditorViewEventV2): string {
  if (adapter.appendViewEvent) return adapter.appendViewEvent(event)
  if (adapter.appendCustomEntry) return adapter.appendCustomEntry(VIEW_EVENT_ENTRY_TYPE, event)
  throw new Error('CONTEXT_EDITOR_PERSISTENCE_UNSUPPORTED')
}

function snapshotOf(state: ReturnType<typeof currentState>): ContextEditorSnapshot {
  return {
    revision: state.revision,
    sourceLeafId: state.leafId,
    records: state.records.map(recordSnapshot),
    canUndo: !!latestUndoableEvent(state.events),
    legacyStateFound: !!state.legacy,
  }
}

function atomCurrentView(state: ReturnType<typeof currentState>, atomId: string): ViewState {
  return state.states.get(atomId) ?? 'show'
}

function makeEvent(
  state: ReturnType<typeof currentState>,
  action: ContextOperation | 'undo',
  changes: ContextEditorViewEventV2['changes'],
  undoOf?: string,
): ContextEditorViewEventV2 {
  return {
    version: 2,
    transactionId: `context-tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    baseRevision: state.revision,
    action,
    changes,
    ...(undoOf ? { undoOf } : {}),
  }
}

function enabledRecordKinds(raw: unknown): Set<ContextRecordKind> {
  const values = Array.isArray(raw) ? raw : ['user', 'ai', 'tool']
  return new Set(values.filter((value): value is ContextRecordKind => value === 'user' || value === 'ai' || value === 'tool'))
}

export class ContextEditorService {
  /** Search results are scoped by id so simultaneous Sessions cannot replace one another. */
  private readonly searchCache = new Map<string, SearchCache>()
  private readonly maxSearchCacheEntries = 32

  getSnapshot(adapter: ContextEditorSessionAdapter): ContextEditorSnapshot {
    return snapshotOf(currentState(adapter))
  }

  /** Return the full host-neutral records for clients that render content. */
  getRecords(adapter: ContextEditorSessionAdapter): ContextRecord[] {
    return currentState(adapter).records
  }

  getRecord(adapter: ContextEditorSessionAdapter, recordId: string): ContextRecord | null {
    return currentState(adapter).records.find((record) => record.id === recordId) ?? null
  }

  searchContextRecords(
    adapter: ContextEditorSessionAdapter,
    input: { query: string; enabledKinds?: unknown; enabledUnitKinds?: unknown; scope?: unknown },
  ): { searchId: string; revision: string; total: number; totalOccurrences: number } {
    const state = currentState(adapter)
    const scope: ContextSearchScope = input.scope === 'all' ? 'all' : 'dialogue'
    const enabledUnitKinds = Array.isArray(input.enabledUnitKinds)
      ? new Set(input.enabledUnitKinds.filter((value): value is ContextEditableUnitKind => value === 'reasoning' || value === 'answer' || value === 'user' || value === 'tool'))
      : undefined
    const matches = searchRecords(state.records, input.query, enabledRecordKinds(input.enabledKinds), scope, enabledUnitKinds)
    const id = `context-search-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    this.searchCache.set(id, { id, revision: state.revision, revisionProbe: state.revisionProbe, matches })
    while (this.searchCache.size > this.maxSearchCacheEntries) {
      const oldest = this.searchCache.keys().next().value
      if (typeof oldest !== 'string') break
      this.searchCache.delete(oldest)
    }
    return {
      searchId: id,
      revision: state.revision,
      total: matches.length,
      totalOccurrences: matches.reduce((sum, match) => sum + match.occurrenceCount, 0),
    }
  }

  getContextSearchMatch(
    adapter: ContextEditorSessionAdapter,
    input: { searchId: string; revision?: string; index: number },
  ): ContextSearchMatch | null {
    const cache = this.searchCache.get(input.searchId)
    if (!cache) return null
    if (input.revision && input.revision !== cache.revision) return null
    try {
      if (adapter.read().revisionProbe !== cache.revisionProbe) {
        this.searchCache.delete(cache.id)
        return null
      }
    } catch {
      this.searchCache.delete(cache.id)
      return null
    }
    if (!cache.matches.length) return null
    const index = ((Math.trunc(input.index) % cache.matches.length) + cache.matches.length) % cache.matches.length
    return cache.matches[index] ?? null
  }

  commitContextView(
    adapter: ContextEditorSessionAdapter,
    input: { baseRevision: string; action: ContextOperation; recordIds?: unknown; unitIds?: unknown },
  ): { ok: boolean; conflict?: boolean; eventId?: string; snapshot: ContextEditorSnapshot } {
    if (adapter.isBusy()) throw new Error('AGENT_RUNTIME_BUSY')
    const state = currentState(adapter)
    if (input.baseRevision !== state.revision) {
      return { ok: false, conflict: true, snapshot: snapshotOf(currentState(adapter)) }
    }
    const requestedRecords = Array.isArray(input.recordIds)
      ? new Set(input.recordIds.filter((id): id is string => typeof id === 'string'))
      : null
    const requestedUnits = Array.isArray(input.unitIds)
      ? new Set(input.unitIds.filter((id): id is string => typeof id === 'string'))
      : null
    const selected = input.action === 'reset'
      ? state.records
      : requestedRecords === null && requestedUnits === null
        ? state.records
        : state.records.filter((record) => requestedRecords?.has(record.id) || record.units.some((unit) => requestedUnits?.has(unit.id)))
    const target: ViewState = input.action === 'hide' ? 'hide' : 'show'
    const changes: ContextEditorViewEventV2['changes'] = []
    for (const record of selected) {
      if (!record.mutable && input.action !== 'reset') continue
      const recordSelected = input.action === 'reset'
        || requestedRecords?.has(record.id)
        || (requestedRecords === null && requestedUnits === null)
      const units = recordSelected
        ? record.units
        : record.units.filter((unit) => requestedUnits?.has(unit.id))
      for (const atom of units.flatMap((unit) => unit.atoms)) {
        const before = atomCurrentView(state, atom.id)
        if (before === target) continue
        changes.push({ atomId: atom.id, fingerprint: atom.fingerprint, before, after: target })
      }
    }
    if (!changes.length) return { ok: true, snapshot: snapshotOf(currentState(adapter)) }
    // Re-read immediately before appending. The main process serializes local
    // writes, but another Pi host can still append to the same JSONL between
    // the first read and this event.
    if (adapter.isBusy()) throw new Error('AGENT_RUNTIME_BUSY')
    const latest = currentState(adapter)
    if (latest.revision !== state.revision) {
      return { ok: false, conflict: true, snapshot: snapshotOf(latest) }
    }
    const event = makeEvent(state, input.action, changes)
    const eventId = appendViewEvent(adapter, event)
    this.searchCache.clear()
    return { ok: true, eventId, snapshot: snapshotOf(currentState(adapter)) }
  }

  undoContextView(
    adapter: ContextEditorSessionAdapter,
    input: { baseRevision: string },
  ): { ok: boolean; conflict?: boolean; eventId?: string; snapshot: ContextEditorSnapshot } {
    if (adapter.isBusy()) throw new Error('AGENT_RUNTIME_BUSY')
    const state = currentState(adapter)
    if (input.baseRevision !== state.revision) {
      return { ok: false, conflict: true, snapshot: snapshotOf(currentState(adapter)) }
    }
    const target = latestUndoableEvent(state.events)
    if (!target) return { ok: true, snapshot: snapshotOf(currentState(adapter)) }
    if (adapter.isBusy()) throw new Error('AGENT_RUNTIME_BUSY')
    const latest = currentState(adapter)
    if (latest.revision !== state.revision) {
      return { ok: false, conflict: true, snapshot: snapshotOf(latest) }
    }
    const event = makeEvent(state, 'undo', inverseChanges(target), target.transactionId)
    const eventId = appendViewEvent(adapter, event)
    this.searchCache.clear()
    return { ok: true, eventId, snapshot: snapshotOf(currentState(adapter)) }
  }
}

/** Shared revision helper for adapters that already provide branch atoms. */
export function contextEditorRevision(
  sessionFile: string,
  leafId: string | null,
  atoms: readonly ContextAtom[],
  extra: readonly string[] = [],
): string {
  return branchRevision(leafId, atoms, [sessionFile, ...extra])
}

export function contextEditorRevisionProbe(parts: readonly string[]): string {
  return stableFingerprint(parts)
}

/** Stable branch-shape parts shared by Worker and disk-preview adapters. */
export function contextEditorBranchRevisionParts(entries: readonly unknown[]): string[] {
  return entries.map((entry) => {
    const value = entry as Record<string, unknown>
    const data = value.data as Record<string, unknown> | undefined
    const message = value.message as Record<string, unknown> | undefined
    const content = message?.content
    const contentShape = Array.isArray(content)
      ? content.map((part) => {
          if (!part || typeof part !== 'object') return typeof part
          const row = part as Record<string, unknown>
          return [
            row.type,
            row.id,
            row.toolCallId,
            row.name,
            typeof row.text === 'string' ? row.text.length : '',
            typeof row.thinking === 'string' ? row.thinking.length : '',
          ].join(':')
        }).join(',')
      : typeof content === 'string'
        ? String(content.length)
        : ''
    return [
      value.id,
      value.parentId,
      value.type,
      value.customType,
      data?.transactionId,
      value.timestamp,
      message?.role,
      message?.timestamp,
      message?.toolCallId,
      contentShape,
    ].map((part) => String(part ?? '')).join(':')
  })
}
