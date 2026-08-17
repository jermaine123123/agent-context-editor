/*
 * GENERATED FILE - do not edit directly.
 * Canonical Core source digest: 4b0873d1fb89c2d6429d7ac722b8e32d3f5406df98aef1bfb758de72cc68716b
 * Rebuild with: npm run build:deepseek
 */
import {
  projectRecords as projectSharedRecords,
  searchRecords as searchSharedRecords,
} from './core-runtime.js'

export const HOST_ID = 'deepseek-harness'
export const VIEW_SCHEMA_VERSION = 2
export const STORAGE_SCHEMA_VERSION = 1
export const RECORD_KINDS = Object.freeze(['user', 'ai', 'tool'])

function asObject(value) {
  return value !== null && typeof value === 'object' ? value : {}
}

function encodePart(value) {
  return encodeURIComponent(String(value ?? ''))
}

/** A small deterministic hash used for fingerprints, not for security. */
export function hashText(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function sessionIdentity(session) {
  const raw = asObject(session)
  return Object.freeze({
    id: String(raw.id ?? raw.sessionId ?? ''),
    createdAt: Number.isSafeInteger(raw.createdAt) ? raw.createdAt : 0,
    ...(raw.cwd === undefined ? {} : { cwd: String(raw.cwd) }),
  })
}

export function sameSessionLifecycle(left, right) {
  const a = sessionIdentity(left)
  const b = sessionIdentity(right)
  return a.id === b.id && a.createdAt === b.createdAt && a.cwd === b.cwd
}

function stableSource(identity, event, blockIndex, kind, extra = '') {
  return [
    HOST_ID,
    identity.id,
    identity.createdAt,
    event?.seq ?? 0,
    blockIndex,
    kind,
    event?.data?.turn ?? '',
    event?.data?.step ?? '',
    extra,
  ].map(encodePart).join(':')
}

function stableRecord(identity, kind, key) {
  return [HOST_ID, identity.id, identity.createdAt, identity.cwd ?? '', kind, key]
    .map(encodePart).join(':')
}

function textOfBlock(block) {
  const value = asObject(block)
  switch (value.type) {
    case 'text':
    case 'reasoning':
      return typeof value.text === 'string' ? value.text : ''
    case 'tool-call':
      return [value.name, value.arguments].filter(item => typeof item === 'string').join('\n')
    case 'tool-result':
      return Array.isArray(value.content) ? value.content.map(textOfBlock).filter(Boolean).join('\n') : ''
    default:
      return ''
  }
}

function contentOf(message) {
  const value = asObject(message)
  if (typeof value.content === 'string') return value.content
  if (!Array.isArray(value.content)) return ''
  return value.content.map(textOfBlock).filter(Boolean).join('\n')
}

function atom(identity, event, blockIndex, kind, text, options = {}) {
  const extra = options.callId ?? options.recordId ?? ''
  const id = stableSource(identity, event, blockIndex, kind, extra)
  const sourceId = stableSource(identity, event, blockIndex, 'source', extra)
  const cleanText = String(text ?? '')
  return {
    id,
    ...(options.recordId === undefined ? {} : { recordId: options.recordId }),
    sourceRef: {
      // entryId/blockIndex keep the shared Pi core source-compatible.  The
      // neutral fields are retained for adapters that do not have Pi entries.
      entryId: String(event?.seq ?? 0),
      blockIndex,
      sourceId,
      sequence: Number.isSafeInteger(event?.seq) ? event.seq : 0,
      ...(event?.data?.turn === undefined ? {} : { turnId: String(event.data.turn) }),
      ...(event?.data?.step === undefined ? {} : { stepId: String(event.data.step) }),
      ...(options.callId === undefined ? {} : { callId: String(options.callId) }),
    },
    kind,
    turnId: String(options.turnId ?? event?.data?.turn ?? `seq-${event?.seq ?? 0}`),
    timestamp: Number.isFinite(event?.time) ? event.time : 0,
    text: cleanText,
    fingerprint: `${kind}:${hashText(cleanText)}`,
    approxTokens: Math.ceil(cleanText.length / 4),
    ...(options.toolCallId === undefined ? {} : { toolCallId: String(options.toolCallId) }),
    ...(options.toolName === undefined ? {} : { toolName: String(options.toolName) }),
    ...(options.isError === undefined ? {} : { isError: Boolean(options.isError) }),
    mutable: true,
  }
}

function toolCallIdFromResult(data) {
  const value = asObject(data)
  const message = asObject(value.message)
  const source = asObject(message.source)
  const first = Array.isArray(message.content) ? asObject(message.content[0]) : {}
  return value.callId ?? message.callId ?? source.callId ?? first.toolCallId
}

/**
 * Convert the complete persisted event log into finalized ContextAtoms.
 * `assistant/chunk` and other live/structural events are intentionally ignored.
 */
export function normalizeSessionEvents(session, events) {
  const identity = sessionIdentity(session)
  const atoms = []
  let sourceRevision = 0
  for (const event of Array.isArray(events) ? events : []) {
    const value = asObject(event)
    const seq = Number.isSafeInteger(value.seq) ? value.seq : sourceRevision
    sourceRevision = Math.max(sourceRevision, seq)
    const type = value.type
    const data = asObject(value.data)
    if (type === 'user/message') {
      const recordId = `user:${stableRecord(identity, 'user', seq)}`
      const text = contentOf(data)
      if (text || Array.isArray(data.content)) {
        atoms.push(atom(identity, value, 0, 'user', text, { recordId }))
      }
      continue
    }
    if (type === 'assistant/message') {
      const turnId = String(data.turn ?? `seq-${seq}`)
      const message = asObject(data.message)
      const blocks = Array.isArray(message.content) ? message.content : []
      blocks.forEach((block, blockIndex) => {
        const candidate = asObject(block)
        if (candidate.type === 'text' || candidate.type === 'reasoning') {
          const kind = candidate.type === 'reasoning' ? 'reasoning' : 'assistant_text'
          atoms.push(atom(identity, value, blockIndex, kind, candidate.text, {
            recordId: `ai-turn:${stableRecord(identity, 'ai-turn', turnId)}`,
            turnId,
          }))
        } else if (candidate.type === 'tool-call') {
          const callId = String(candidate.id ?? candidate.callId ?? `seq-${seq}-block-${blockIndex}`)
          const recordId = `tool:${stableRecord(identity, 'tool', callId)}`
          atoms.push(atom(identity, value, blockIndex, 'tool_call', textOfBlock(candidate), {
            recordId,
            callId,
            toolCallId: callId,
            toolName: candidate.name,
            turnId,
          }))
        }
      })
      continue
    }
    if (type === 'tool/call') {
      const callId = String(data.callId ?? `seq-${seq}`)
      const recordId = `tool:${stableRecord(identity, 'tool', callId)}`
      const text = [data.name, data.arguments].filter(item => typeof item === 'string').join('\n')
      atoms.push(atom(identity, value, 0, 'tool_call', text, {
        recordId,
        callId,
        toolCallId: callId,
        toolName: data.name,
        turnId: String(data.turn ?? `seq-${seq}`),
      }))
      continue
    }
    if (type === 'tool/result') {
      const callId = String(toolCallIdFromResult(data) ?? `seq-${seq}`)
      const recordId = `tool:${stableRecord(identity, 'tool', callId)}`
      const message = asObject(data.message)
      const text = [contentOf(message), data.error?.name, data.error?.code]
        .filter(item => typeof item === 'string' && item.length > 0)
        .join('\n')
      atoms.push(atom(identity, value, 0, 'tool_output', text, {
        recordId,
        callId,
        toolCallId: callId,
        toolName: data.name ?? message.name,
        isError: message.isError ?? data.error !== undefined,
        turnId: String(data.turn ?? `seq-${seq}`),
      }))
    }
  }
  return { identity, atoms, sourceRevision }
}

/** Project and search through the canonical host-neutral Core bundle. */
export function projectRecords(atoms, states = new Map()) {
  return projectSharedRecords(atoms, states)
}

export function searchRecords(records, query, enabledKinds = RECORD_KINDS) {
  return searchSharedRecords(records, query, new Set(enabledKinds))
}

function validViewState(value) {
  return value === 'show' || value === 'collapse' || value === 'hide'
}

function validViewEvent(value) {
  const raw = asObject(value)
  return raw.version === VIEW_SCHEMA_VERSION
    && typeof raw.transactionId === 'string'
    && typeof raw.baseRevision === 'string'
    && Array.isArray(raw.changes)
}

export function normalizeViewEvents(events) {
  return (Array.isArray(events) ? events : []).filter(validViewEvent).map(value => ({
    version: VIEW_SCHEMA_VERSION,
    transactionId: String(value.transactionId),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    baseRevision: String(value.baseRevision),
    action: ['hide', 'restore', 'reset', 'undo'].includes(value.action) ? value.action : 'restore',
    changes: value.changes.filter(change => {
      const candidate = asObject(change)
      return typeof candidate.atomId === 'string'
        && typeof candidate.fingerprint === 'string'
        && validViewState(candidate.before)
        && validViewState(candidate.after)
    }).map(change => ({
      atomId: String(change.atomId),
      fingerprint: String(change.fingerprint),
      before: change.before,
      after: change.after,
    })),
    ...(typeof value.undoOf === 'string' ? { undoOf: value.undoOf } : {}),
  })).filter(value => value.changes.length > 0)
}

export function reduceViewStates(atoms, events) {
  const result = new Map()
  for (const value of atoms) result.set(value.id, 'show')
  for (const event of normalizeViewEvents(events)) {
    for (const change of event.changes) {
      const atomValue = atoms.find(candidate => candidate.id === change.atomId)
      if (atomValue !== undefined && atomValue.fingerprint === change.fingerprint) {
        result.set(change.atomId, change.after)
      }
    }
  }
  return result
}

export function latestUndoableEvent(events) {
  const normalized = normalizeViewEvents(events)
  const undone = new Set(normalized.filter(value => value.action === 'undo' && value.undoOf).map(value => value.undoOf))
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    const event = normalized[index]
    if (event.action !== 'undo' && !undone.has(event.transactionId)) return event
  }
  return undefined
}

export function inverseChanges(event) {
  return event.changes.map(change => ({
    atomId: change.atomId,
    fingerprint: change.fingerprint,
    before: change.after,
    after: change.before,
  }))
}

export function revisionFor(identity, sourceRevision, events) {
  const list = normalizeViewEvents(events)
  const tail = list.at(-1)?.transactionId ?? 'none'
  return [
    'ce2', identity.id, identity.createdAt, identity.cwd ?? '', sourceRevision, list.length, tail,
  ].map(encodePart).join(':')
}

export function sidecarRow(identity, events = []) {
  return {
    session: { createdAt: identity.createdAt, ...(identity.cwd === undefined ? {} : { cwd: identity.cwd }) },
    schemaVersion: STORAGE_SCHEMA_VERSION,
    storageVersion: 1,
    events: normalizeViewEvents(events),
  }
}

export function buildViewEvent(options) {
  const {
    identity, sourceRevision, events, action, recordIds, unitIds, transactionId, now = new Date(),
    records = [], states = new Map(),
  } = options
  const normalizedEvents = normalizeViewEvents(events)
  const selectedRecordIds = recordIds === undefined ? undefined : new Set(recordIds)
  const selectedUnitIds = unitIds === undefined ? undefined : new Set(unitIds)
  const selectedAtoms = new Set()
  for (const record of records) {
    const recordSelected = selectedRecordIds?.has(record.id) ?? false
    const wholeRecord = selectedRecordIds === undefined && selectedUnitIds === undefined
    if (recordSelected || wholeRecord) {
      for (const value of record.atoms) selectedAtoms.add(value.id)
      continue
    }
    if (selectedUnitIds !== undefined) {
      for (const unit of record.units ?? []) {
        if (!selectedUnitIds.has(unit.id)) continue
        for (const value of unit.atoms) selectedAtoms.add(value.id)
      }
    }
  }
  const target = action === 'hide' ? 'hide' : 'show'
  const changes = []
  for (const record of records) {
    for (const value of record.atoms) {
      if (!selectedAtoms.has(value.id)) continue
      const before = states.get(value.id) ?? 'show'
      if (before !== target) changes.push({ atomId: value.id, fingerprint: value.fingerprint, before, after: target })
    }
  }
  return {
    version: VIEW_SCHEMA_VERSION,
    transactionId: String(transactionId),
    createdAt: now.toISOString(),
    baseRevision: revisionFor(identity, sourceRevision, normalizedEvents),
    action,
    changes,
  }
}

/** Build an adapter snapshot from a normalized event log and sidecar row. */
export function buildProjection(identity, events, row) {
  const normalized = normalizeSessionEvents(identity, events)
  const viewEvents = normalizeViewEvents(row?.events)
  const states = reduceViewStates(normalized.atoms, viewEvents)
  const records = projectRecords(normalized.atoms, states)
  const revision = revisionFor(normalized.identity, normalized.sourceRevision, viewEvents)
  return {
    ...normalized,
    events: viewEvents,
    states,
    records,
    revision,
    canUndo: latestUndoableEvent(viewEvents) !== undefined,
  }
}

export function recordSnapshot(record) {
  return {
    id: record.id,
    kind: record.kind,
    viewState: record.viewState,
    mutable: record.mutable,
    atomIds: record.atomIds,
    units: (record.units ?? []).map(unit => ({
      id: unit.id,
      recordId: unit.recordId,
      kind: unit.kind,
      atomIds: unit.atomIds,
      viewState: unit.viewState,
      mutable: unit.mutable,
    })),
    searchableText: record.searchableText,
    ...(record.entryId === undefined ? {} : { entryId: record.entryId }),
    ...(record.entryIds?.length ? { entryIds: record.entryIds } : {}),
    ...(record.anchorEntryId === undefined ? {} : { anchorEntryId: record.anchorEntryId }),
    ...(record.toolCallId === undefined ? {} : { toolCallId: record.toolCallId }),
    atoms: record.atoms,
  }
}
