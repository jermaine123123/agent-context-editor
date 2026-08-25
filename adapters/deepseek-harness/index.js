/**
 * DeepSeek Harness Host adapter.
 *
 * The adapter reads the complete durable Session event log, projects only
 * finalized user/AI/tool records, stores visual V2 view events in a separate
 * storage-domain sidecar, and folds native `context/projection` events into
 * model-derived messages. Surface events and normal Chat display remain unchanged.
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { foldSurface } from '@deepseek-ai/dsh-session'
import { selectProjectionTargets } from './core-runtime.js'
import {
  buildProjection,
  buildViewEvent,
  inverseChanges,
  latestUndoableEvent,
  normalizeViewEvents,
  recordSnapshot,
  sameSessionLifecycle,
  searchRecords,
  sessionIdentity,
} from './core.js'
import { PACKAGE_NAME } from './typert.js'

export const inject = ['storageDomain', 'sessionPersistence', 'sessions', 'agents']

const viewStateSchema = z.enum(['show', 'collapse', 'hide'])
const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const viewChangeSchema = z.object({
  atomId: z.string().min(1),
  fingerprint: z.string().min(1),
  before: viewStateSchema,
  after: viewStateSchema,
})
const viewEventSchema = z.object({
  version: z.literal(2),
  transactionId: z.string().min(1),
  createdAt: z.string(),
  baseRevision: z.string(),
  action: z.enum(['hide', 'restore', 'reset', 'undo']),
  changes: z.array(viewChangeSchema).min(1),
  undoOf: z.string().optional(),
})
const sidecarRowSchema = z.object({
  session: z.object({
    createdAt: nonNegativeSafeInteger,
    cwd: z.string().optional(),
  }),
  schemaVersion: z.literal(1),
  storageVersion: z.literal(1),
  events: z.array(viewEventSchema),
})

export const contextEditorDomainSpec = defineDomain({
  name: 'context_editor',
  version: 1,
  tables: {
    sessions: domainTable(sidecarRowSchema),
  },
})

function requestSessionId(request) {
  const value = request && typeof request === 'object' ? request : {}
  if (value.locator?.host !== undefined && value.locator.host !== 'deepseek-harness') {
    throw new Error('CONTEXT_EDITOR_HOST_MISMATCH')
  }
  return String(value.sessionId ?? value.locator?.sessionId ?? '')
}

function identityFromInspection(inspection, sessionId) {
  const meta = inspection?.meta ?? inspection?.header ?? {}
  return sessionIdentity({
    id: meta.id ?? sessionId,
    createdAt: meta.createdAt,
    cwd: meta.cwd,
  })
}

function randomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function clampPageSize(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) return 50
  return Math.min(200, Math.max(1, number))
}

function asPageCursor(value) {
  const number = Number.parseInt(String(value ?? '0'), 10)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function isBusySession(ctx, sessionId) {
  const agent = ctx?.agents?.get?.(sessionId)
  if (agent !== undefined) return agent.status === 'running'
  const live = ctx?.sessions?.get?.(sessionId)
  if (live === undefined) return false
  const snapshot = live.getSnapshot?.()
  return Boolean(snapshot?.running ?? live.running ?? live.status === 'running')
}

function success(snapshot, extra = {}) {
  return { ok: true, ...extra, snapshot }
}

function messageForRoot(event) {
  const value = event && typeof event === 'object' ? event : {}
  const data = value.data && typeof value.data === 'object' ? value.data : {}
  if (value.type === 'user/message') return data
  if (value.type === 'assistant/message') return data.message
  if (value.type === 'tool/result') return data.message
  return undefined
}

function cloneReplacementMessage(original, excludedBlockIndices, replacementId) {
  const copy = structuredClone(original)
  const blocks = Array.isArray(copy?.content) ? copy.content : []
  copy.content = blocks.filter((_block, index) => !excludedBlockIndices.has(index))
  copy.id = replacementId ?? globalThis.crypto?.randomUUID?.() ?? randomId('context-message')
  if (copy.role === 'assistant' && copy.source?.kind === 'model') {
    const source = copy.source
    const { replayState: _replayState, ...safeSource } = source
    copy.source = safeSource
  }
  return copy
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function sameIdSet(left, right) {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

function sameOptionalIdList(left, right) {
  if (left === undefined || right === undefined) return left === right
  return sameIdSet(new Set(left.map(String)), new Set(right.map(String)))
}

function assertContextOperationReuse(stored, sessionId, action, unitIds, recordIds) {
  if (stored === undefined) return
  if (stored.sessionId !== sessionId || stored.action !== action
    || !sameOptionalIdList(stored.unitIds, unitIds)
    || !sameOptionalIdList(stored.recordIds, recordIds)) {
    throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
  }
}

function buildNativeContextChanges(projection, action, request) {
  if (action !== 'exclude' && action !== 'restore') throw new Error('CONTEXT_EDITOR_CONTEXT_ACTION_INVALID')
  const selection = selectProjectionTargets(
    projection.records,
    Array.isArray(request?.unitIds) ? request.unitIds.map(String) : undefined,
    Array.isArray(request?.recordIds) ? request.recordIds.map(String) : undefined,
  )
  if (selection.unavailableUnitIds.length > 0) {
    throw new Error('CONTEXT_EDITOR_CONTEXT_UNAVAILABLE:' + selection.unavailableUnitIds.join(','))
  }

  const units = projection.records.flatMap(record => (record.units ?? []).map(unit => ({ record, unit })))
  const selectedAtomIds = new Set(
    units
      .filter(item => selection.effectiveUnitIds.includes(item.unit.id))
      .flatMap(item => item.unit.atomIds),
  )
  const atomsByRoot = new Map()
  for (const atom of projection.atoms) {
    const root = Number(atom.sourceRef?.entryId)
    if (!Number.isSafeInteger(root)) continue
    const group = atomsByRoot.get(root)
    if (group) group.push(atom)
    else atomsByRoot.set(root, [atom])
  }

  const sourceEvents = projection.sourceEvents ?? []
  const changes = []
  const nextExcludedByRoot = new Map()
  const beforeExcludedByRoot = new Map()
  for (const [root, atoms] of atomsByRoot) {
    const selected = new Set(atoms.filter(atom => selectedAtomIds.has(atom.id)).map(atom => atom.id))
    if (selected.size === 0) continue
    const currentExcluded = new Set(atoms.filter(atom => projection.projectionStates?.get(atom.id) === 'exclude').map(atom => atom.id))
    const unavailable = atoms.some(atom => projection.projectionStates?.get(atom.id) === 'unavailable')
    if (unavailable) throw new Error('CONTEXT_EDITOR_CONTEXT_UNAVAILABLE:root-' + root)
    const nextExcluded = action === 'exclude'
      ? new Set([...currentExcluded, ...selected])
      : new Set([...currentExcluded].filter(id => !selected.has(id)))
    beforeExcludedByRoot.set(root, currentExcluded)
    nextExcludedByRoot.set(root, nextExcluded)
    if (sameIdSet(currentExcluded, nextExcluded)) continue

    const overlay = projection.contextOverlays?.get(root)
    if (nextExcluded.size === 0) {
      if (overlay !== undefined) changes.push({ rootEventSeq: root, mode: 'clear' })
      continue
    }
    if (nextExcluded.size >= atoms.length) {
      if (overlay?.mode === 'remove') continue
      changes.push({ rootEventSeq: root, mode: 'remove' })
      continue
    }

    const original = messageForRoot(sourceEvents.find(event => Number(event?.seq) === root) ?? sourceEvents[root])
    if (original === undefined || !Array.isArray(original.content)) {
      throw new Error('CONTEXT_EDITOR_CONTEXT_UNAVAILABLE:root-' + root)
    }
    const excludedBlockIndices = new Set(
      atoms
        .filter(atom => nextExcluded.has(atom.id))
        .map(atom => atom.sourceRef.blockIndex),
    )
    const replacementId = request?.operationId === undefined
      ? undefined
      : `context-${String(request.operationId)}-${root}`
    const message = cloneReplacementMessage(original, excludedBlockIndices, replacementId)
    if (message.content.length === 0) {
      changes.push({ rootEventSeq: root, mode: 'remove' })
    } else {
      changes.push({ rootEventSeq: root, mode: 'replace', message })
    }
  }

  let beforeTokens = 0
  let afterTokens = 0
  for (const atom of projection.atoms) {
    const root = Number(atom.sourceRef?.entryId)
    const current = projection.projectionStates?.get(atom.id) ?? 'include'
    if (current === 'include') beforeTokens += atom.approxTokens ?? 0
    const nextExcluded = nextExcludedByRoot.get(root)
    const excluded = nextExcluded === undefined
      ? current === 'exclude'
      : nextExcluded.has(atom.id)
    if (!excluded && current !== 'unavailable') afterTokens += atom.approxTokens ?? 0
  }
  return {
    changes,
    selection,
    tokenEstimate: {
      before: beforeTokens,
      after: afterTokens,
      delta: afterTokens - beforeTokens,
    },
    beforeExcludedByRoot,
  }
}

async function withSourceAgent(ctx, sessionId, operation) {
  const live = ctx?.agents?.get?.(sessionId)
  if (live !== undefined) {
    if (live.status === 'running') throw new Error('CONTEXT_EDITOR_BUSY')
    return live.runMaintenance(() => operation(live))
  }
  if (ctx?.agents?.resume === undefined) throw new Error('CONTEXT_EDITOR_AGENT_UNAVAILABLE')
  const handle = await ctx.agents.resume({ resumeSessionId: sessionId })
  try {
    return await handle.agent.runMaintenance(() => operation(handle.agent))
  } finally {
    await handle.dispose()
  }
}

/** One Host service instance owns all sidecar writes and search caches. */
export class ContextEditorHost extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'contextEditor')
    this.ctx = ctx
    this.table = undefined
    this.domain = undefined
    this.operationTails = new Map()
    this.searchCache = new Map()
    this.searchSequence = 0
    this.contextOperations = new Map()
    this.mutationAdmissionOpen = true
  }

  async init() {
    this.domain = await this.ctx.storageDomain.open(contextEditorDomainSpec)
    this.table = this.domain.table('sessions')
  }

  async dispose() {
    this.mutationAdmissionOpen = false
    await Promise.all(this.operationTails.values())
    if (this.domain !== undefined) await this.domain.close()
    this.searchCache.clear()
  }

  async inspect(sessionId) {
    if (!sessionId) throw new Error('CONTEXT_EDITOR_SESSION_REQUIRED')
    return this.ctx.sessionPersistence.inspect(sessionId)
  }

  rowFor(identity) {
    const stored = this.table?.get(identity.id)
    if (stored !== undefined && sameSessionLifecycle(
      { id: identity.id, ...stored.session },
      identity,
    )) {
      return {
        session: stored.session,
        schemaVersion: 1,
        storageVersion: 1,
        events: normalizeViewEvents(stored.events),
      }
    }
    // A reused Session id must never inherit another lifecycle's hidden state.
    return {
      session: {
        createdAt: identity.createdAt,
        ...(identity.cwd === undefined ? {} : { cwd: identity.cwd }),
      },
      schemaVersion: 1,
      storageVersion: 1,
      events: [],
    }
  }

  async readProjection(sessionId) {
    const inspection = await this.inspect(sessionId)
    const identity = identityFromInspection(inspection, sessionId)
    const row = this.rowFor(identity)
    const events = inspection.events ?? []
    const activeSurfaceSeqs = foldSurface(events).nodes
    return buildProjection(identity, events, row, { activeSurfaceSeqs })
  }

  projectionFromSession(session) {
    const identity = identityFromInspection({ meta: session.header }, session.id)
    const row = this.rowFor(identity)
    const events = session.events ?? []
    const activeSurfaceSeqs = foldSurface(events).nodes
    return buildProjection(identity, events, row, { activeSurfaceSeqs })
  }

  snapshotOf(projection, running = isBusySession(this.ctx, projection.identity.id)) {
    return {
      host: 'deepseek-harness',
      sessionId: projection.identity.id,
      revision: projection.revision,
      sourceLeafId: null,
      sourceRevision: String(projection.sourceRevision),
      viewRevision: String(projection.events.length),
      records: projection.records.map(record => ({
        id: record.id,
        kind: record.kind,
        viewState: record.viewState,
        projectionState: record.projectionState,
        mutable: record.mutable,
        units: (record.units ?? []).map(unit => ({
          id: unit.id,
          recordId: unit.recordId,
          kind: unit.kind,
          atomIds: unit.atomIds,
          viewState: unit.viewState,
          projectionState: unit.projectionState,
          mutable: unit.mutable,
        })),
        ...(record.entryId === undefined ? {} : { entryId: record.entryId }),
        ...(record.entryIds?.length ? { entryIds: record.entryIds } : {}),
        ...(record.anchorEntryId === undefined ? {} : { anchorEntryId: record.anchorEntryId }),
        ...(record.toolCallId === undefined ? {} : { toolCallId: record.toolCallId }),
      })),
      canUndo: projection.canUndo,
      legacyStateFound: false,
      running,
      capabilities: {
        paging: true,
        search: true,
        viewMutation: !running,
        undo: !running,
        persistence: true,
        // rc.8 Host/Browser composition, regression coverage, and a real
        // DeepSeek API smoke request have passed; advertise native projection.
        contextExclusion: true,
      },
    }
  }

  async getSnapshot(request) {
    const projection = await this.readProjection(requestSessionId(request))
    return this.snapshotOf(projection)
  }

  async listRecords(request) {
    const projection = await this.readProjection(requestSessionId(request))
    const cursor = asPageCursor(request?.cursor)
    const pageSize = clampPageSize(request?.pageSize)
    const page = projection.records.slice(cursor, cursor + pageSize).map(recordSnapshot)
    return {
      sessionId: projection.identity.id,
      revision: projection.revision,
      sourceRevision: String(projection.sourceRevision),
      viewRevision: String(projection.events.length),
      records: page,
      nextCursor: cursor + page.length < projection.records.length ? String(cursor + page.length) : null,
      total: projection.records.length,
    }
  }

  async getRecord(request) {
    const projection = await this.readProjection(requestSessionId(request))
    const record = projection.records.find(value => value.id === request?.recordId)
    return record === undefined
      ? null
      : {
        record: recordSnapshot(record),
        sourceRevision: String(projection.sourceRevision),
        viewRevision: String(projection.events.length),
      }
  }

  async searchRecords(request) {
    const projection = await this.readProjection(requestSessionId(request))
    const query = String(request?.query ?? '')
    const enabledKinds = Array.isArray(request?.enabledKinds)
      ? request.enabledKinds
      : ['user', 'ai', 'tool']
    const scope = request?.scope === 'all' ? 'all' : 'dialogue'
    const enabledUnitKinds = Array.isArray(request?.enabledUnitKinds) ? request.enabledUnitKinds : undefined
    const matches = searchRecords(projection.records, query, enabledKinds, scope, enabledUnitKinds)
    const searchId = `${projection.identity.id}:${++this.searchSequence}:${randomId('search')}`
    this.searchCache.set(searchId, {
      sessionId: projection.identity.id,
      revision: projection.revision,
      matches,
    })
    while (this.searchCache.size > 64) this.searchCache.delete(this.searchCache.keys().next().value)
    return {
      searchId,
      sessionId: projection.identity.id,
      revision: projection.revision,
      total: matches.length,
      totalOccurrences: matches.reduce((sum, value) => sum + value.occurrenceCount, 0),
    }
  }

  async getSearchMatch(request) {
    const cache = this.searchCache.get(String(request?.searchId ?? ''))
    if (cache === undefined) return null
    if (request?.revision !== undefined && request.revision !== cache.revision) return null
    if (request?.sessionId !== undefined && String(request.sessionId) !== cache.sessionId) return null
    try {
      const current = await this.readProjection(cache.sessionId)
      if (current.revision !== cache.revision) {
        this.searchCache.delete(String(request.searchId))
        return null
      }
    } catch {
      this.searchCache.delete(String(request.searchId))
      return null
    }
    if (cache.matches.length === 0) return null
    const index = ((Math.trunc(Number(request?.index ?? 0)) % cache.matches.length) + cache.matches.length) % cache.matches.length
    return cache.matches[index] ?? null
  }

  enqueue(sessionId, operation) {
    if (!this.mutationAdmissionOpen) return Promise.reject(new Error('CONTEXT_EDITOR_DISPOSING'))
    const previous = this.operationTails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.operationTails.set(sessionId, tail)
    return result.finally(() => {
      if (this.operationTails.get(sessionId) === tail) this.operationTails.delete(sessionId)
    })
  }

  async previewContext(request) {
    const sessionId = requestSessionId(request)
    if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
    const projection = await this.readProjection(sessionId)
    const requestedRevision = request?.expectedRevision ?? request?.baseRevision
    if (requestedRevision !== undefined && String(requestedRevision) !== projection.revision) {
      return {
        ok: false,
        conflict: true,
        expectedRevision: projection.revision,
        snapshot: this.snapshotOf(projection),
      }
    }
    const action = request?.action
    const unitIds = Array.isArray(request?.unitIds) ? request.unitIds.map(String) : undefined
    const recordIds = Array.isArray(request?.recordIds) ? request.recordIds.map(String) : undefined
    const operationId = String(request?.operationId ?? randomId('context-operation'))
    const calculated = buildNativeContextChanges(projection, action, { ...request, unitIds, recordIds, operationId })
    assertContextOperationReuse(this.contextOperations.get(operationId), sessionId, action, unitIds, recordIds)
    this.contextOperations.set(operationId, {
      sessionId,
      expectedRevision: projection.revision,
      action,
      unitIds,
      recordIds,
      changes: structuredClone(calculated.changes),
      tokenEstimate: calculated.tokenEstimate,
    })
    return {
      ok: true,
      operationId,
      expectedRevision: projection.revision,
      action,
      normalizedTargets: calculated.selection.requestedUnitIds,
      effectiveTargets: calculated.selection.effectiveUnitIds,
      autoExpandedTargets: calculated.selection.autoExpandedUnitIds,
      unavailableUnitIds: calculated.selection.unavailableUnitIds,
      tokenEstimate: calculated.tokenEstimate,
      changes: calculated.changes.map(change => ({
        rootEventSeq: change.rootEventSeq,
        mode: change.mode,
      })),
    }
  }

  async commitContext(request) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      const operationId = String(request?.operationId ?? randomId('context-operation'))
      const stored = this.contextOperations.get(operationId)
      const action = request?.action ?? stored?.action
      const unitIds = Array.isArray(request?.unitIds)
        ? request.unitIds.map(String)
        : stored?.unitIds
      const recordIds = Array.isArray(request?.recordIds)
        ? request.recordIds.map(String)
        : stored?.recordIds
      assertContextOperationReuse(stored, sessionId, action, unitIds, recordIds)
      const expectedRevision = String(
        request?.expectedRevision
        ?? request?.baseRevision
        ?? stored?.expectedRevision
        ?? '',
      )
      if (!expectedRevision) throw new Error('CONTEXT_EDITOR_REVISION_REQUIRED')

      return withSourceAgent(this.ctx, sessionId, async (agent) => {
        const session = agent.session
        const projection = this.projectionFromSession(session)
        const priorEvent = (session.events ?? []).find(event => event?.type === 'context/projection'
          && event?.data?.owner === 'context-editor-deepseek-harness'
          && event?.data?.operationId === operationId)
        if (priorEvent !== undefined) {
          if (stored?.changes !== undefined && !sameJson(stored.changes, priorEvent.data.changes)) {
            throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
          }
          if (stored === undefined && action !== undefined) {
            const priorIndex = session.events.indexOf(priorEvent)
            const beforeSession = {
              id: session.id,
              header: session.header,
              events: session.events.slice(0, priorIndex),
            }
            const priorProjection = this.projectionFromSession(beforeSession)
            const expectedChanges = buildNativeContextChanges(priorProjection, action, {
              unitIds,
              recordIds,
              operationId,
            }).changes
            if (!sameJson(expectedChanges, priorEvent.data.changes)) {
              throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
            }
          }
          await this.ctx.sessions.flush(session)
          this.searchCache.clear()
          const next = this.projectionFromSession(session)
          return success(this.snapshotOf(next, false), {
            operationId,
            eventId: priorEvent.seq,
            expectedRevision: next.revision,
            tokenEstimate: stored?.tokenEstimate ?? { before: 0, after: 0, delta: 0 },
          })
        }
        if (expectedRevision !== projection.revision) {
          return {
            ok: false,
            conflict: true,
            expectedRevision: projection.revision,
            snapshot: this.snapshotOf(projection, false),
          }
        }
        const calculated = buildNativeContextChanges(projection, action, {
          unitIds,
          recordIds,
          operationId,
        })
        if (calculated.changes.length === 0) {
          return success(this.snapshotOf(projection, false), {
            operationId,
            expectedRevision: projection.revision,
            tokenEstimate: calculated.tokenEstimate,
          })
        }

        const baseSeq = session.events.at(-1)?.seq ?? -1
        if (baseSeq < 0) throw new Error('CONTEXT_EDITOR_SESSION_EMPTY')
        const data = {
          schemaVersion: 1,
          owner: 'context-editor-deepseek-harness',
          operationId,
          baseSeq,
          changes: calculated.changes,
        }
        const event = typeof session.appendContextProjection === 'function'
          ? session.appendContextProjection(data)
          : session.append('context/projection', data)
        await this.ctx.sessions.flush(session)
        this.searchCache.clear()
        const next = this.projectionFromSession(session)
        return success(this.snapshotOf(next, false), {
          operationId,
          eventId: event.seq,
          expectedRevision: next.revision,
          tokenEstimate: calculated.tokenEstimate,
        })
      })
    })
  }

  async commitView(request) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const projection = await this.readProjection(sessionId)
      if (String(request?.baseRevision ?? '') !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(projection) }
      }
      const action = request?.action
      if (!['hide', 'restore', 'reset'].includes(action)) throw new Error('CONTEXT_EDITOR_ACTION_INVALID')
      // Re-read immediately before constructing the event.  This closes the
      // normal cross-client race window even when another writer shares the
      // same storage-domain table; a stale writer gets the authoritative
      // snapshot and never performs a partial write.
      const latest = await this.readProjection(sessionId)
      if (latest.revision !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(latest) }
      }
      const event = buildViewEvent({
        identity: latest.identity,
        sourceRevision: latest.sourceRevision,
        events: latest.events,
        records: latest.records,
        states: latest.states,
        action,
        recordIds: Array.isArray(request?.recordIds) ? request.recordIds : undefined,
        unitIds: Array.isArray(request?.unitIds) ? request.unitIds : undefined,
        transactionId: randomId('context-view'),
      })
      if (event.changes.length === 0) return success(this.snapshotOf(projection))
      const nextRow = {
        session: {
          createdAt: latest.identity.createdAt,
          ...(latest.identity.cwd === undefined ? {} : { cwd: latest.identity.cwd }),
        },
        schemaVersion: 1,
        storageVersion: 1,
        events: [...latest.events, event],
      }
      await this.table.put(sessionId, nextRow)
      this.searchCache.clear()
      const next = await this.readProjection(sessionId)
      return success(this.snapshotOf(next), { eventId: event.transactionId })
    })
  }

  async undoView(request) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const projection = await this.readProjection(sessionId)
      if (String(request?.baseRevision ?? '') !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(projection) }
      }
      const latest = await this.readProjection(sessionId)
      if (latest.revision !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(latest) }
      }
      const target = latestUndoableEvent(latest.events)
      if (target === undefined) return success(this.snapshotOf(projection))
      const event = {
        version: 2,
        transactionId: randomId('context-undo'),
        createdAt: new Date().toISOString(),
        baseRevision: latest.revision,
        action: 'undo',
        changes: inverseChanges(target),
        undoOf: target.transactionId,
      }
      await this.table.put(sessionId, {
        session: {
          createdAt: latest.identity.createdAt,
          ...(latest.identity.cwd === undefined ? {} : { cwd: latest.identity.cwd }),
        },
        schemaVersion: 1,
        storageVersion: 1,
        events: [...latest.events, event],
      })
      this.searchCache.clear()
      const next = await this.readProjection(sessionId)
      return success(this.snapshotOf(next), { eventId: event.transactionId })
    })
  }
}

/** Official Harness plugin entry; the patch row mounts this one Host face. */
export async function apply(ctx) {
  const host = new ContextEditorHost(ctx)
  await host.init()
  ctx.effect(() => async () => {
    await host.dispose()
  }, 'context-editor-deepseek-harness: dispose')
}

export { PACKAGE_NAME }
