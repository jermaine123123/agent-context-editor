/**
 * DeepSeek Harness Host adapter.
 *
 * The adapter reads the complete durable Session event log, projects only
 * finalized user/AI/tool records, and stores V2 view events in a separate
 * storage-domain sidecar.  Nothing is appended to the Session log, so normal
 * Chat and model requests remain untouched.
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
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

export const inject = ['storageDomain', 'sessionPersistence', 'sessions']

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

function isBusySession(sessions, sessionId) {
  const live = sessions?.get?.(sessionId)
  if (live === undefined) return false
  const snapshot = live.getSnapshot?.()
  return Boolean(snapshot?.running ?? live.running ?? live.status === 'running')
}

function success(snapshot, extra = {}) {
  return { ok: true, ...extra, snapshot }
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
    return buildProjection(identity, inspection.events ?? [], row)
  }

  snapshotOf(projection, running = isBusySession(this.ctx.sessions, projection.identity.id)) {
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
        mutable: record.mutable,
        units: (record.units ?? []).map(unit => ({
          id: unit.id,
          recordId: unit.recordId,
          kind: unit.kind,
          atomIds: unit.atomIds,
          viewState: unit.viewState,
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
        contextExclusion: false,
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

  async commitView(request) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx.sessions, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
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
      if (isBusySession(this.ctx.sessions, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
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
