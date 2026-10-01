/** Host module exports are resolved here so optional exports cannot break ESM linking. */
import * as sessionApi from '@deepseek-ai/dsh-session'
import * as storageApi from '@deepseek-ai/dsh-storage-domain'
import * as remoteApi from '@deepseek-ai/dsh-typert-protocol'
const surfaceApi = await import('@deepseek-ai/dsh-session/surface').catch(() => ({}))
const v4Api = await import('@deepseek-ai/dsh-session-format-v3-to-v4').catch(() => ({}))

export const Session = sessionApi.Session
export const SessionStore = sessionApi.SessionStore
export const SESSION_FORMAT_VERSION = sessionApi.SESSION_FORMAT_VERSION ?? 0
export const hasV4WriteContract = SESSION_FORMAT_VERSION === 4
  && typeof v4Api.restoreReleasedV4Artifact === 'function'
  && sessionApi.KNOWN_SESSION_EVENT_TYPES?.has('model/selection') === true

export function pluginMessageSource(form, plugin = 'context-editor-deepseek-harness') {
  return SESSION_FORMAT_VERSION >= 4
    ? { kind: 'context-editor', ...(form ? { form } : {}) }
    : { kind: 'plugin', plugin, ...(form ? { form } : {}) }
}

/** Validate a detached candidate before touching the live log or its persistence handle. */
export function validateSessionCandidate(session) {
  const version = session.header?.version ?? SESSION_FORMAT_VERSION
  if (version < 4) return
  if (version !== 4 || !hasV4WriteContract) throw new Error('CONTEXT_EDITOR_SESSION_FORMAT_WRITE_UNSUPPORTED')
  const artifact = {
    // Session's logical header omits the root depth; the durable v4 codec requires it explicitly.
    header: { ...structuredClone(session.header), delegationDepth: session.header.delegationDepth ?? 0 },
    events: structuredClone(eventsOf(session)),
    inheritedEventCount: session.inheritedEventCount ?? 0,
  }
  v4Api.restoreReleasedV4Artifact(artifact, sessionApi.KNOWN_SESSION_EVENT_TYPES)
}

export function profileSelectionOf(event) {
  return event?.type === 'model/selection' ? event.data
    : event?.type === 'request/header' ? event.data?.header?.config : undefined
}

/** Convert sidecar message payloads with the same public migration used by the host. */
export function migrateProfileMessage(message) {
  if (SESSION_FORMAT_VERSION !== 4) return structuredClone(message)
  if (typeof v4Api.createSessionFormatV3ToV4 !== 'function') throw new Error('CONTEXT_EDITOR_PROFILE_MIGRATION_UNAVAILABLE')
  const header = { id: 'context-editor-profile-migration', version: 3, createdAt: 0, isSeeded: false, delegationDepth: 0 }
  const migration = v4Api.createSessionFormatV3ToV4([])
  const stage = migration.createStage({ sourceHeader: header, targetHeader: { ...header, version: 4 }, sourceInheritedEventCount: 0 })
  const type = message.source?.kind === 'tool' ? 'tool/result' : message.role === 'user' ? 'user/message' : 'assistant/message'
  const emitted = []
  stage.transformEvent({ type, seq: 0, time: 0, data: type === 'user/message' ? structuredClone(message) : { turn: 1, step: 1, message: structuredClone(message), ...(type === 'assistant/message' ? { stream: [] } : {}) } }, { emitEvent: event => emitted.push(event) })
  const converted = emitted.find(event => event.type === type)
  if (!converted) throw new Error('CONTEXT_EDITOR_PROFILE_MIGRATION_UNAVAILABLE')
  return type === 'user/message' ? converted.data : converted.data.message
}

/** Build a separate, validated recovery artifact; never rewrite the historical log. */
export function migrateLegacySessionArtifact(artifact, newId) {
  if (!hasV4WriteContract || artifact.header?.version !== 3 || artifact.header.isSeeded
    || !newId || newId === artifact.header.id || artifact.events.some(event => event.type === 'subagent/catalog'
      || event.type.startsWith('subagent/') || event.type === 'session-log-deepseek/delivery-accepted')) {
    throw new Error('CONTEXT_EDITOR_LEGACY_BRANCH_MIGRATION_UNSUPPORTED')
  }
  const migration = v4Api.createSessionFormatV3ToV4([])
  const targetHeader = { ...migration.migrateHeader(artifact.header), id: newId }
  const stage = migration.createStage({ sourceHeader: artifact.header, targetHeader, sourceInheritedEventCount: 0 })
  const events = [], selections = []
  const context = { emitEvent: event => events.push(event) }
  let openTurn = false, previousHeader
  for (const original of artifact.events) {
    let event = structuredClone(original)
    if (event.type === 'turn/start') openTurn = true
    if (event.type === 'turn/end') openTurn = false
    if (event.type === 'request/header') {
      const header = event.data?.header
      if (!openTurn) {
        const config = header?.config
        const stable = value => JSON.stringify({ ...value, config: Object.fromEntries(Object.entries(value.config ?? {})
          .filter(([key]) => !['provider', 'model', 'reasoningEffort'].includes(key))) }, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
        if (event.data?.reason !== 'change' || !previousHeader || !config?.provider || !config?.model
          || stable(header) !== stable(previousHeader)) throw new Error('CONTEXT_EDITOR_LEGACY_HEADER_IDENTITY_UNVERIFIED')
        event = { ...event, type: 'model/selection', data: { provider: config.provider, model: config.model,
          ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }) } }
        selections.push(original.seq)
      }
      previousHeader = header
    }
    stage.transformEvent(event, context)
  }
  const inheritedEventCount = stage.finish(context)
  const candidate = { header: targetHeader, events, inheritedEventCount }
  v4Api.restoreReleasedV4Artifact(candidate, sessionApi.KNOWN_SESSION_EVENT_TYPES)
  return { ...candidate, convertedHeaderSeqs: selections, sourceSessionId: artifact.header.id }
}

export function isProfileSelection(event, provider, id) {
  const route = profileSelectionOf(event)
  return route?.provider === provider && route?.model === id
}

export function appendModelSelection(session, config) {
  if ((session.header?.version ?? SESSION_FORMAT_VERSION) >= 4) {
    const candidate = restoreSession(session.id, eventsOf(session), session.header, session.inheritedEventCount ?? 0)
    const data = { provider: config.provider, model: config.model,
      ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }) }
    candidate.append('model/selection', data)
    validateSessionCandidate(candidate)
    return session.append('model/selection', data)
  }
  const header = session.requestHeader()
  return session.append('request/header', { header: { ...header, config: { ...header.config, ...config } }, reason: 'change' })
}
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
