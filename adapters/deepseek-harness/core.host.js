/**
 * Host-neutral projection and view-state logic for the DeepSeek Harness
 * adapter.  This file deliberately has no Cordis or Node imports so it can be
 * used by the Host service and by fixture tests alike.
 *
 * The Pi adapter and this adapter use the same behavioral rules: records are
 * projected from finalized atoms, V2 events are append-only, and a changed
 * fingerprint fails open to `show`.
 */

import {
  atomMatchesSearchScope as atomMatchesSharedSearchScope,
  projectRecords as projectSharedRecords,
  reduceReplacementStates,
  searchRecords as searchSharedRecords,
} from './core-runtime.js'

export const HOST_ID = 'deepseek-harness'
export const CONTEXT_PROJECTION_OWNER = 'context-editor-deepseek-harness'
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
    ...(options.hasSignature === undefined ? {} : { hasSignature: Boolean(options.hasSignature) }),
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
      const blocks = Array.isArray(data.content) ? data.content : []
      const plainBlocks = blocks.length > 0 && blocks.every(block => asObject(block).type === 'text' && typeof asObject(block).text === 'string')
      const structured = typeof data.content === 'string'
        ? data.content.trim().length === 0
        : !plainBlocks
      if (text || Array.isArray(data.content)) {
        atoms.push(atom(identity, value, 0, 'user', text, { recordId, structured }))
      }
      continue
    }
    if (type === 'assistant/message') {
      const turnId = String(data.turn ?? `seq-${seq}`)
      const message = asObject(data.message)
      const blocks = Array.isArray(message.content) ? message.content : []
      const source = asObject(message.source)
      const replayBound = source.replayState !== undefined || source.replayBound === true || source.signed === true
      blocks.forEach((block, blockIndex) => {
        const candidate = asObject(block)
        if (candidate.type === 'text' || candidate.type === 'reasoning') {
          const kind = candidate.type === 'reasoning' ? 'reasoning' : 'assistant_text'
          atoms.push(atom(identity, value, blockIndex, kind, candidate.text, {
            recordId: `ai-turn:${stableRecord(identity, 'ai-turn', turnId)}`,
            turnId,
            hasSignature: candidate.signature !== undefined || candidate.signed === true || replayBound,
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

function eventForSeq(events, seq) {
  const target = Number(seq)
  return (Array.isArray(events) ? events.find(event => Number(event?.seq) === target) : undefined) ?? events?.[target]
}

function surfaceMessage(event) {
  const value = asObject(event)
  const data = asObject(value.data)
  if (value.type === 'user/message') return data
  if (value.type === 'assistant/message') return asObject(data.message)
  if (value.type === 'tool/result') return asObject(data.message)
  return undefined
}

function blockKey(block) {
  try {
    return JSON.stringify(block)
  } catch {
    return ''
  }
}


/** Project and search through the canonical host-neutral Core bundle. */
export function projectRecords(atoms, states = new Map(), projectionStates = new Map(), replacementStates = new Map()) {
  return projectSharedRecords(atoms, states, projectionStates, replacementStates)
}

export function atomMatchesSearchScope(kind, scope = 'dialogue') {
  return atomMatchesSharedSearchScope(kind, scope)
}

export function searchRecords(records, query, enabledKinds = RECORD_KINDS, scope = 'dialogue', enabledUnitKinds) {
  return searchSharedRecords(records, query, new Set(enabledKinds), scope, enabledUnitKinds === undefined ? undefined : new Set(enabledUnitKinds))
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

function validReplacementAtomRef(value) {
  const raw = asObject(value)
  const sourceRef = asObject(raw.sourceRef)
  return typeof raw.atomId === 'string' && raw.atomId.length > 0
    && typeof raw.fingerprint === 'string' && raw.fingerprint.length > 0
    && typeof sourceRef.entryId === 'string' && Number.isSafeInteger(sourceRef.blockIndex)
}

function validReplacementEvent(value) {
  const raw = asObject(value)
  if (raw.schemaVersion !== 1 || raw.type !== 'replacement' || typeof raw.eventId !== 'string' || !raw.eventId) return false
  if (typeof raw.unitId !== 'string' || !raw.unitId || !['user', 'answer'].includes(raw.unitKind)) return false
  if (raw.action === 'undo') return typeof raw.undoOf === 'string' && raw.undoOf.length > 0
  return ['replace', 'restore'].includes(raw.action)
    && Array.isArray(raw.atomRefs) && raw.atomRefs.length > 0
    && raw.atomRefs.every(validReplacementAtomRef)
    && (raw.beforeText === null || typeof raw.beforeText === 'string')
    && (raw.afterText === null || typeof raw.afterText === 'string')
}

export function normalizeReplacementEvents(events) {
  return (Array.isArray(events) ? events : []).filter(validReplacementEvent).map(value => {
    const raw = asObject(value)
    if (raw.action === 'undo') {
      return {
        schemaVersion: 1,
        type: 'replacement',
        action: 'undo',
        eventId: String(raw.eventId),
        unitId: String(raw.unitId),
        unitKind: raw.unitKind,
        undoOf: String(raw.undoOf),
        baseRevision: raw.baseRevision,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
      }
    }
    return {
      schemaVersion: 1,
      type: 'replacement',
      action: raw.action,
      eventId: String(raw.eventId),
      unitId: String(raw.unitId),
      unitKind: raw.unitKind,
      atomRefs: raw.atomRefs.map(ref => ({
        atomId: String(ref.atomId),
        sourceRef: { entryId: String(ref.sourceRef.entryId), blockIndex: Number(ref.sourceRef.blockIndex) },
        fingerprint: String(ref.fingerprint),
      })),
      beforeText: raw.beforeText === null ? null : String(raw.beforeText),
      afterText: raw.afterText === null ? null : String(raw.afterText),
      baseRevision: raw.baseRevision,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    }
  })
}

function nativeProjectionEvents(events) {
  return (Array.isArray(events) ? events : []).filter(event => event?.type === 'context/projection')
}

function matchedReplacementEvents(rowEvents, events, prepared = []) {
  const nativeIds = new Set(nativeProjectionEvents(events).map(event => String(event?.data?.operationId ?? '')).filter(Boolean))
  const preparedIds = new Set((Array.isArray(prepared) ? prepared : []).map(event => String(event.eventId)))
  return normalizeReplacementEvents(rowEvents).filter(event => nativeIds.has(event.eventId) || preparedIds.has(event.eventId))
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

export function revisionFor(identity, sourceRevision, events, replacementEvents = [], nativeEvents = []) {
  const list = normalizeViewEvents(events)
  const tail = list.at(-1)?.transactionId ?? 'none'
  const replacements = normalizeReplacementEvents(replacementEvents)
  const replacementTail = replacements.at(-1)
    ? `${replacements.at(-1)?.eventId ?? ''}:${hashText(JSON.stringify(replacements.at(-1)))}`
    : 'none'
  const native = nativeProjectionEvents(nativeEvents)
  const nativeTail = native.at(-1)
    ? `${native.at(-1)?.seq ?? ''}:${native.at(-1)?.data?.operationId ?? ''}:${hashText(JSON.stringify(native.at(-1)?.data?.changes ?? []))}`
    : 'none'
  return [
    'ce3', identity.id, identity.createdAt, identity.cwd ?? '', sourceRevision, list.length, tail,
    replacements.length, replacementTail, native.length, nativeTail,
  ].map(encodePart).join(':')
}

export function sidecarRow(identity, events = [], replacementEvents = []) {
  return {
    session: { createdAt: identity.createdAt, ...(identity.cwd === undefined ? {} : { cwd: identity.cwd }) },
    schemaVersion: STORAGE_SCHEMA_VERSION,
    storageVersion: 1,
    events: normalizeViewEvents(events),
    replacementEvents: normalizeReplacementEvents(replacementEvents),
  }
}

export function buildViewEvent(options) {
  const {
    identity, sourceRevision, events, action, recordIds, unitIds, transactionId, now = new Date(), baseRevision,
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
    baseRevision: baseRevision ?? revisionFor(identity, sourceRevision, normalizedEvents),
    action,
    changes,
  }
}

/** Build an adapter snapshot from a normalized event log and sidecar row. */


/** Build an adapter snapshot from a normalized event log and sidecar row. */
export function buildProjection(identity, events, row, options = {}) {
  const normalized = normalizeSessionEvents(identity, events)
  const viewEvents = normalizeViewEvents(row?.events)
  const replacementEvents = normalizeReplacementEvents(row?.replacementEvents)
  const activeReplacementEvents = matchedReplacementEvents(replacementEvents, events, options.preparedReplacementEvents)
  const states = reduceViewStates(normalized.atoms, viewEvents)
  const baseRecords = projectRecords(normalized.atoms, states, new Map())
  const replacementStates = reduceReplacementStates(
    baseRecords.flatMap(record => record.units ?? []),
    activeReplacementEvents,
    options.projectionAvailable !== false,
  )
  const contextProjection = reduceContextProjectionStates(events, normalized.atoms, options.activeSurfaceSeqs, {
    records: baseRecords,
    replacementStates,
  })
  const records = projectRecords(normalized.atoms, states, contextProjection.states, replacementStates)
  const matched = matchedReplacementEvents(replacementEvents, events)
  const revision = revisionFor(normalized.identity, normalized.sourceRevision, viewEvents, matched, events)
  return {
    ...normalized,
    sourceEvents: Array.isArray(events) ? events : [],
    events: viewEvents,
    replacementEvents: matched,
    activeReplacementEvents,
    replacementStates,
    states,
    projectionStates: contextProjection.states,
    contextOverlays: contextProjection.overlays,
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
    projectionState: record.projectionState,
    mutable: record.mutable,
    atomIds: record.atomIds,
    units: (record.units ?? []).map(unit => ({
      id: unit.id,
      recordId: unit.recordId,
      kind: unit.kind,
      atomIds: unit.atomIds,
      viewState: unit.viewState,
      projectionState: unit.projectionState,
      mutable: unit.mutable,
      effectiveText: unit.effectiveText,
      replacementState: unit.replacementState,
      replacementSupported: unit.replacementSupported,
      ...(unit.replacementDisabledReason ? { replacementDisabledReason: unit.replacementDisabledReason } : {}),
      canRestoreReplacement: unit.canRestoreReplacement,
      canUndoReplacement: unit.canUndoReplacement,
    })),
    searchableText: record.searchableText,
    ...(record.entryId === undefined ? {} : { entryId: record.entryId }),
    ...(record.entryIds?.length ? { entryIds: record.entryIds } : {}),
    ...(record.anchorEntryId === undefined ? {} : { anchorEntryId: record.anchorEntryId }),
    ...(record.toolCallId === undefined ? {} : { toolCallId: record.toolCallId }),
    atoms: record.atoms,
  }
}

function replacementLookup(records, replacementStates) {
  const byAtom = new Map()
  const byUnit = new Map()
  for (const record of records ?? []) {
    for (const unit of record.units ?? []) {
      const state = replacementStates?.get(unit.id)
      if (!state || state.replacementState !== 'replaced') continue
      const item = { unit, state }
      byUnit.set(unit.id, item)
      for (const atom of unit.atoms ?? []) byAtom.set(atom.id, item)
    }
  }
  return { byAtom, byUnit }
}

function cloneContextMessage(original, pairs, replacementId, changed) {
  const copy = structuredClone(original)
  copy.content = pairs.map(pair => pair.block)
  if (replacementId !== undefined) copy.id = replacementId
  if (changed && copy.role === 'assistant' && copy.source?.kind === 'model') {
    const { replayState: _replayState, ...safeSource } = asObject(copy.source)
    copy.source = safeSource
  }
  return copy
}

/** Compose canonical blocks with the active replacement before exclusion. */
function composedRoot(projection, root, replacementStates = projection.replacementStates, records = projection.records, replacementId) {
  const original = surfaceMessage(eventForSeq(projection.sourceEvents, root))
  const sourceBlocks = Array.isArray(original?.content) ? original.content : []
  const rootAtoms = projection.atoms.filter(atom => Number(atom.sourceRef?.entryId) === root)
  const lookup = replacementLookup(records, replacementStates)
  let pairs = sourceBlocks.map((block, index) => {
    const atom = rootAtoms.find(candidate => candidate.sourceRef.blockIndex === index)
    const item = atom ? lookup.byAtom.get(atom.id) : undefined
    return { block, atomId: atom?.id, unitId: item?.unit.id, synthetic: false }
  })
  let changed = false
  for (const item of lookup.byUnit.values()) {
    const unitAtoms = item.unit.atoms ?? []
    const inRoot = unitAtoms.filter(atom => Number(atom.sourceRef?.entryId) === root)
    if (inRoot.length === 0) continue
    if (item.unit.kind === 'user') {
      const firstIndex = pairs.findIndex(candidate => candidate.atomId === unitAtoms[0]?.id)
      if (firstIndex >= 0) {
        // A plain User message may be represented by several text blocks but
        // is one editable atom. Remove every canonical block from that root,
        // then inject the replacement exactly once at the first block position.
        const preserved = pairs.filter(candidate => candidate.atomId && candidate.atomId !== unitAtoms[0]?.id)
        const insertionOffset = pairs.slice(0, firstIndex)
          .filter(candidate => candidate.atomId && candidate.atomId !== unitAtoms[0]?.id).length
        pairs = preserved
        pairs.splice(insertionOffset, 0, {
          block: { type: 'text', text: item.state.effectiveText },
          atomId: unitAtoms[0].id,
          unitId: item.unit.id,
          synthetic: true,
        })
        changed = true
      }
      continue
    }
    if (item.unit.kind !== 'answer') continue
    const ids = new Set(unitAtoms.map(atom => atom.id))
    const lastAtom = unitAtoms.at(-1)
    const lastIsHere = lastAtom && Number(lastAtom.sourceRef?.entryId) === root
    const lastIndex = lastIsHere ? pairs.findIndex(pair => pair.atomId === lastAtom.id) : -1
    const before = pairs.length
    const insertionOffset = lastIndex < 0 ? -1 : pairs.slice(0, lastIndex).filter(pair => !ids.has(pair.atomId)).length
    pairs = pairs.filter(pair => !ids.has(pair.atomId))
    if (lastIndex >= 0) {
      pairs.splice(insertionOffset, 0, {
        block: { type: 'text', text: item.state.effectiveText },
        atomId: lastAtom.id,
        unitId: item.unit.id,
        synthetic: true,
      })
    }
    if (pairs.length !== before || lastIndex >= 0) changed = true
  }
  if (!original) return { message: undefined, pairs: [], lookup }
  return { message: cloneContextMessage(original, pairs, replacementId, changed), pairs, lookup }
}

export function composeNativeRoot(projection, root, replacementStates = projection.replacementStates, records = projection.records, replacementId) {
  return composedRoot(projection, root, replacementStates, records, replacementId)
}

function matchedBlockIds(baselinePairs, replacementMessage) {
  const used = new Set()
  const included = new Set()
  const syntheticUnits = new Set()
  const blocks = Array.isArray(replacementMessage?.content) ? replacementMessage.content : []
  for (const pair of baselinePairs) {
    const index = blocks.findIndex((block, candidate) => !used.has(candidate) && blockKey(block) === blockKey(pair.block))
    if (index < 0) continue
    used.add(index)
    if (pair.atomId) included.add(pair.atomId)
    if (pair.synthetic && pair.unitId) syntheticUnits.add(pair.unitId)
  }
  return { included, syntheticUnits }
}

function reduceContextProjectionStates(events, atoms, activeSurfaceSeqs, options = {}) {
  const overlays = new Map()
  for (const event of Array.isArray(events) ? events : []) {
    const value = asObject(event)
    if (value.type !== 'context/projection') continue
    const data = asObject(value.data)
    for (const change of Array.isArray(data.changes) ? data.changes : []) {
      const root = Number(change?.rootEventSeq)
      if (!Number.isSafeInteger(root) || root < 0) continue
      if (change.mode === 'clear') overlays.delete(root)
      else if (change.mode === 'remove' || change.mode === 'replace') {
        overlays.set(root, {
          owner: String(data.owner ?? ''),
          operationId: String(data.operationId ?? ''),
          mode: change.mode,
          ...(change.mode === 'replace' ? { message: change.message } : {}),
          eventSeq: value.seq,
        })
      }
    }
  }
  const active = Array.isArray(activeSurfaceSeqs) ? new Set(activeSurfaceSeqs) : undefined
  const states = new Map()
  for (const value of atoms) {
    const root = Number(value.sourceRef?.entryId)
    if (active !== undefined && (!active.has(root) || !Number.isSafeInteger(root))) {
      states.set(value.id, 'unavailable')
      continue
    }
    const overlay = overlays.get(root)
    if (overlay === undefined || overlay.mode === 'clear') {
      states.set(value.id, 'include')
      continue
    }
    if (overlay.mode === 'remove') {
      states.set(value.id, 'exclude')
      continue
    }
    const composed = composedRoot({ sourceEvents: events, atoms, records: options.records, replacementStates: options.replacementStates }, root)
    const matched = matchedBlockIds(composed.pairs, overlay.message)
    const item = composed.lookup.byAtom.get(value.id)
    const included = matched.included.has(value.id) || (item?.state.replacementState === 'replaced' && matched.syntheticUnits.has(item.unit.id))
    states.set(value.id, included ? 'include' : 'exclude')
  }
  return { states, overlays }
}
