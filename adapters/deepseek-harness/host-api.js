/** Host module exports are resolved here so optional exports cannot break ESM linking. */
import * as sessionApi from '@deepseek-ai/dsh-session'
import * as storageApi from '@deepseek-ai/dsh-storage-domain'
import * as remoteApi from '@deepseek-ai/dsh-typert-protocol'
const surfaceApi = await import('@deepseek-ai/dsh-session/surface').catch(() => ({}))

export const Session = sessionApi.Session
export const SessionStore = sessionApi.SessionStore
export const hasSurfaceContract = typeof sessionApi.foldSurface === 'function'
export const foldSurface = sessionApi.foldSurface ?? (events => ({ nodes: events.map(event => event.seq) }))
export const defineDomain = storageApi.defineDomain
export const domainTable = storageApi.domainTable
export const TypertRemoteService = remoteApi.TypertRemoteService ?? class {
  constructor() { throw new Error('CONTEXT_EDITOR_RPC_CONTRACT_UNSUPPORTED') }
}

export function eventsOf(session) {
  return typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : [...session.events]
}

/** Rehydrate history; creating a new fork and restoring an existing fork are different contracts. */
export function restoreSession(id, events, header, inherited, projections) {
  if (header?.isSeeded) {
    if (typeof Session?.fromRestore !== 'function') throw new Error('CONTEXT_EDITOR_SESSION_RESTORE_CONTRACT_UNSUPPORTED')
    // fromRestore adopts its inputs. Give it detached copies, never live/persistence-owned objects.
    return Session.fromRestore(id, structuredClone(events), structuredClone(header), inherited, 'detached', projections)
  }
  if (typeof Session?.create !== 'function') throw new Error('CONTEXT_EDITOR_SESSION_CONTRACT_UNSUPPORTED')
  return Session.create(id, events, header, inherited, projections)
}

/** Detached durable reader using the host's own incremental projection engine. */
export class HostHistoryView {
  constructor(id, events, header, inherited, projections) {
    this.id = id
    this.header = header
    this.inheritedEventCount = inherited ?? 0
    this.projections = [...projections]
    this.log = []
    this.messages = []
    this.nodeCount = 0
    this.generation = -1
    if (typeof surfaceApi.SurfaceManager === 'function' && typeof sessionApi.foldRequestHeader === 'function') {
      this.surface = new surfaceApi.SurfaceManager(this.log, 0, this.projections)
      this.update(events)
    } else {
      this.fallback = restoreSession(id, events, header, inherited, projections)
      for (const event of events) this.log.push(event)
    }
  }
  get seq() { return this.log.length }
  eventAt(seq) { return this.log[seq] }
  snapshotEvents() { return this.log }
  update(events) {
    const tail = events.slice(this.log.length)
    // Avoid argument limits on large initial histories.
    for (const event of tail) this.log.push(event)
    if (this.fallback) this.fallback = restoreSession(this.id, events, this.header, this.inheritedEventCount, this.projections)
    else {
      this.foldedHeader = sessionApi.foldRequestHeader(tail, this.foldedHeader)
      for (const event of tail) if (event.type === 'request/context') this.foldedContext = event.data
    }
  }
  requestHeader() { return this.fallback ? this.fallback.requestHeader() : this.foldedHeader }
  requestContext() { return this.fallback ? this.fallback.requestContext() : this.foldedContext }
  get nodes() { return this.fallback ? foldSurface(this.log, this.projections).nodes : this.surface.nodes }
  deriveMessages() {
    if (this.fallback) return this.fallback.deriveMessages()
    const nodes = this.surface.nodes
    const generation = this.surface.contentGeneration ?? this.surface.replaceGeneration
    if (this.generation !== generation) {
      this.messages = []; this.nodeCount = 0; this.generation = generation
    }
    for (const seq of nodes.slice(this.nodeCount)) {
      const message = typeof this.surface.deriveEventMessage === 'function'
        ? this.surface.deriveEventMessage(this.log[seq])
        : sessionApi.deriveEventMessage(this.log[seq])
      if (message) this.messages.push(message)
    }
    this.nodeCount = nodes.length
    return this.messages
  }
}
