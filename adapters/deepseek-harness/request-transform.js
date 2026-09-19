/** Plugin-owned model profiles. Session logs select a profile; original messages stay intact. */
import { createHash } from 'node:crypto'
import { defineDomain, domainTable } from './host-api.js'
import { z } from 'zod'
import { projectedMessageSource } from './core.js'

export const REQUEST_PROVIDER = 'context-editor'
const legacyProfileSchema = z.object({
  version: z.literal(1),
  upstream: z.object({ provider: z.string().min(1), model: z.string().min(1) }),
  origin: z.object({ id: z.string(), createdAt: z.number() }),
  previous: z.string().nullable(),
  operationId: z.string().min(1),
  baseline: z.string().min(1),
  changes: z.array(z.object({
    rootEventSeq: z.number().int().nonnegative(),
    originalId: z.string().min(1),
    originalFingerprint: z.string().min(1),
    mode: z.enum(['remove', 'replace']),
    message: z.unknown().optional(),
  }).strict()),
  replacementEvents: z.array(z.unknown()),
}).strict()
const profileSchema = z.union([legacyProfileSchema, legacyProfileSchema.extend({
  version: z.literal(2),
  routeState: z.enum(['active', 'released']),
  operation: z.object({ action: z.string(), unitId: z.string().nullable(), unitIds: z.array(z.string()).nullable() }).optional(),
}).strict()])

export function canTransformMessage(message) {
  if (!Array.isArray(message?.content) || !['user', 'assistant'].includes(message.role)) return false
  if (message.source?.signed || message.source?.replayBound) return false
  const replay = message.source?.replayState
  if (replay && (replay.response?.kind !== 'deepseek-messages' || replay.response?.version !== 1
    || replay.blocks?.length !== message.content.length
    || replay.blocks.some((block, i) => block.type !== message.content[i].type))) return false
  return message.content.every(block => (['text', 'reasoning', 'tool-call', 'image'].includes(block.type)
      || (block.type === 'tool-result' && message.source?.kind === 'tool' && block.toolCallId === message.source.callId
        && Array.isArray(block.content) && block.content.every(value => ['text', 'image'].includes(value.type))))
    && (block.type !== 'text' || (!block.signature && !block.signed)))
}

function validateReplacement(original, replacement) {
  if (!canTransformMessage(original) || !canTransformMessage({ ...replacement, source: { ...replacement.source, replayState: undefined } })) throw new Error('CONTEXT_EDITOR_UNSUPPORTED_MESSAGE_CONTRACT')
  // Non-text blocks can only be retained unchanged or removed as a validated selection.
  const remaining = [...original.content]
  for (const block of replacement.content) {
    if (block.type === 'text') continue
    const index = remaining.findIndex(value => requestFingerprint(value) === requestFingerprint(block))
    if (index < 0) throw new Error('CONTEXT_EDITOR_PROTECTED_BLOCK_CHANGED')
    remaining.splice(index, 1)
  }
  const protectedBlocks = original.content.filter((block, index) => block.type === 'reasoning'
    && (block.signature || original.source?.replayState?.blocks?.[index]?.signature))
  for (const block of protectedBlocks) {
    if (!replacement.content.some(value => requestFingerprint(value) === requestFingerprint(block))) throw new Error('CONTEXT_EDITOR_SIGNED_REASONING_REQUIRED')
  }
}
export const requestTransformDomain = defineDomain({
  name: 'context_editor_requests', version: 1,
  tables: {
    profiles: domainTable(profileSchema),
    operations: domainTable(z.object({
      profileId: z.string(), requestFingerprint: z.string(),
      status: z.enum(['pending', 'persisted-and-verified', 'unverified', 'failed']),
      reason: z.string().optional(),
    }).strict()),
  },
})

export function requestFingerprint(value) {
  const canonical = JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)
  return createHash('sha256').update(canonical).digest('hex')
}

export function messageFingerprint(message) {
  return requestFingerprint({ id: message.id, role: message.role, content: message.content })
}

export function isPlainMessage(message) {
  return (message?.role === 'user' || message?.role === 'assistant')
    && message.source?.kind !== 'tool'
    && Array.isArray(message.content) && message.content.length > 0
    && message.content.every(block => block?.type === 'text' && typeof block.text === 'string'
      && Object.keys(block).every(key => key === 'type' || key === 'text'))
}

/** Applies only to exact message identities; absent compacted messages are never reinserted. */
export function transformMessages(messages, profile) {
  const patches = new Map(profile.changes.map(change => [change.originalId, change]))
  const seen = new Set()
  return messages.flatMap(message => {
    const change = patches.get(message.id)
    if (!change) return [message]
    if (seen.has(message.id)) throw new Error('CONTEXT_EDITOR_DUPLICATE_MESSAGE_ID')
    seen.add(message.id)
    if (messageFingerprint(message) !== change.originalFingerprint) throw new Error('CONTEXT_EDITOR_MESSAGE_CHANGED')
    if (profile.version !== 2 && !isPlainMessage(message)) throw new Error('CONTEXT_EDITOR_PLAIN_TEXT_REQUIRED')
    if (profile.version === 2 && !canTransformMessage(message)) throw new Error('CONTEXT_EDITOR_UNSUPPORTED_MESSAGE_CONTRACT')
    if (change.mode === 'remove') return []
    if ((profile.version !== 2 && !isPlainMessage(change.message)) || change.message.id !== message.id || change.message.role !== message.role) {
      throw new Error('CONTEXT_EDITOR_INVALID_PROFILE_MESSAGE')
    }
    const replacement = structuredClone(change.message)
    if (profile.version === 2) {
      validateReplacement(message, replacement)
      replacement.source = projectedMessageSource(message, replacement.content)
      return [replacement]
    }
    // Text edits cannot retain an adapter's old serialized response. Signed blocks are rejected above.
    if (replacement.role === 'assistant' && replacement.source?.kind === 'model') delete replacement.source.replayState
    return [replacement]
  })
}

function operationKey(session, operationId) {
  return requestFingerprint([session.id, session.header.createdAt, operationId])
}

/** No prototype patching, unknown session events, or mutation of host event catalogs. */
export class RequestTransformRuntime {
  constructor(ctx, domain) {
    this.ctx = ctx
    this.domain = domain
    this.profiles = domain.table('profiles')
    this.operations = domain.table('operations')
    this.disposers = []
    this.forwarded = new WeakSet()
    this.effectiveRequests = new WeakSet()
    this.active = new Set()
    this.controllers = new Set()
    this.closed = false
    this.sessionIndexes = new WeakMap()
  }

  profile(id) {
    const value = this.profiles.get(String(id))
    if (!value || `ce${value.version}-${requestFingerprint(value)}` !== id) throw new Error('CONTEXT_EDITOR_PROFILE_MISSING_OR_INVALID')
    return profileSchema.parse(value)
  }

  selected(events) {
    // A later ordinary route does not silently clear an earlier committed editing profile.
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]
      const route = event.type === 'request/header' ? event.data?.header?.config : undefined
      if (route?.provider === REQUEST_PROVIDER) return { id: route.model, profile: this.profile(route.model) }
    }
    return undefined
  }

  fromSession(session) {
    if (!session) return undefined
    let index = this.sessionIndexes.get(session)
    if (!index || index.seq > session.seq) {
      index = { seq: 0, selected: undefined, events: [] }
      this.sessionIndexes.set(session, index)
    }
    // Session eventAt reads only the newly observed tail. Older contracts use one snapshot fallback.
    const events = typeof session.eventAt === 'function' ? undefined : session.snapshotEvents()
    const count = typeof session.eventAt === 'function' ? session.seq : events.length
    for (; index.seq < count; index.seq++) {
      const event = events ? events[index.seq] : session.eventAt(index.seq)
      index.events.push(event)
      const config = event?.type === 'request/header' ? event.data.header.config : undefined
      if (event?.type === 'model/selection') index.pendingSelection = { ...event.data, seq: event.seq }
      if (config && index.pendingSelection?.provider === config.provider && index.pendingSelection.model === config.model
        && index.pendingSelection.reasoningEffort === config.reasoningEffort) index.pendingSelection = undefined
      if (config?.provider === REQUEST_PROVIDER) index.selected = { id: config.model, profile: this.profile(config.model) }
    }
    return index.selected
  }

  effectiveMessages(session) {
    const selected = this.fromSession(session)
    return selected ? transformMessages(session.deriveMessages(), selected.profile) : session.deriveMessages()
  }

  async rebind(session, selected, route) {
    const unresolved = this.operation(session, selected.profile.operationId)
    if (unresolved && ['pending', 'unverified'].includes(unresolved.status)) throw new Error('CONTEXT_EDITOR_PENDING_OPERATION_REQUIRES_VERIFICATION')
    const pending = this.sessionIndexes.get(session)?.pendingSelection
    if (route.provider === REQUEST_PROVIDER || (!pending && route.provider === selected.profile.upstream.provider && route.model === selected.profile.upstream.model)) return selected
    await this.ctx.llm.resolveModelInfo(route.provider, route.model)
    const profile = profileSchema.parse({ ...selected.profile, version: 2, routeState: 'active',
      operation: { action: 'model-rebind', unitId: null, unitIds: null },
      previous: selected.id, upstream: { provider: route.provider, model: route.model },
      operationId: 'model-' + requestFingerprint([session.id, session.header.createdAt, selected.id, route.provider, route.model, pending?.seq ?? null]) })
    const id = `ce2-${requestFingerprint(profile)}`
    await this.profiles.put(id, profile)
    await this.operations.put(operationKey(session, profile.operationId), { profileId: id, requestFingerprint: requestFingerprint(route), status: 'pending' })
    try {
      const header = session.requestHeader()
      // Resolve the user's upstream choice to the actual registered Provider.
      // Leaving the ordinary selection pending would bypass this route when the plugin is absent.
      if (pending) session.append('model/selection', { provider: REQUEST_PROVIDER, model: id, ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }) })
      session.append('request/header', { header: { ...header, config: { ...header.config, ...route, provider: REQUEST_PROVIDER, model: id } }, reason: 'change' })
      await this.ctx.sessions.flush(session)
      const handle = await this.ctx.sessionPersistence.open(session.id, 'read')
      try {
        const page = await handle.read(session.seq - 1, 1)
        if (!page.events?.some(event => event.type === 'request/header' && event.data.header.config.model === id)) throw new Error('CONTEXT_EDITOR_MODEL_SELECTION_UNVERIFIED')
      } finally { await handle.close() }
      await this.settle(session, profile.operationId, 'persisted-and-verified')
    } catch (error) {
      await this.settle(session, profile.operationId, 'unverified', String(error?.message ?? error))
      throw error
    }
    return { id, profile }
  }

  async install() {
    const owner = this
    class ProfileAdapter {
      providerInfo(provider) { return { id: provider, name: 'Context Editor' } }
      providerRetryPolicy() { return undefined }
      listModels() { return Promise.resolve([]) }
      imageRequestPricing(_provider, model) {
        const { upstream } = owner.profile(model)
        return owner.ctx.llm.imageRequestPricing(upstream.provider, upstream.model)
      }
      async resolveModel(provider, model, signal) {
        const { upstream } = owner.profile(model)
        const resolved = await owner.ctx.llm.resolveModelInfo(upstream.provider, upstream.model, signal)
        return { ...resolved, provider, id: model, name: resolved.name }
      }
      async prepareCall(provider, model, signal) {
        return { model: await this.resolveModel(provider, model, signal), stream: options => this.stream(options) }
      }
      stream() { throw new Error('CONTEXT_EDITOR_REQUEST_HANDLER_UNAVAILABLE') }
    }
    this.disposers.push(this.ctx.llm.registerAdapter([REQUEST_PROVIDER], new ProfileAdapter()))
    this.disposers.push(this.ctx.on('agent/pre-step', async ({ agent }, next) => {
      const decision = await next()
      if (decision.kind !== 'enter' || !owner.fromSession(agent.session) || owner.fromSession(agent.session).profile.routeState === 'released') return decision
      return { ...decision, messages: decision.messages.filter(message => message.source?.plugin !== 'model-selection') }
    }, { global: true, prepend: true }))
    this.disposers.push(this.ctx.on('agent/request', async ({ agent }, next) => {
      const route = await next()
      let selected = owner.fromSession(agent.session)
      if (!selected) return route
      if (selected.profile.routeState === 'released') return route.provider === REQUEST_PROVIDER ? { ...route, ...selected.profile.upstream } : route
      selected = await owner.rebind(agent.session, selected, route)
      return { ...route, provider: REQUEST_PROVIDER, model: selected.id }
    }, { global: true, prepend: true }))
    this.disposers.push(this.ctx.on('llm/stream', (options, next) => {
      if (owner.forwarded.has(options)) return next()
      const session = options.sessionId === undefined ? undefined : owner.ctx.sessions.get(options.sessionId)
      const selected = options.provider === REQUEST_PROVIDER
        ? { id: options.model, profile: owner.profile(options.model) }
        : session ? owner.fromSession(session) : undefined
      if (!selected || (selected.profile.routeState === 'released' && options.provider !== REQUEST_PROVIDER)) return next()
      return owner.stream(options, selected.profile, owner.effectiveRequests.has(options))
    }, { global: true, prepend: true }))
  }

  streamEffective(options) {
    // Only the plugin's own summary builder can mark already-projected input.
    this.effectiveRequests.add(options)
    return this.ctx.llm.stream(options)
  }

  async *stream(options, profile, alreadyEffective = false) {
    if (this.closed) throw new Error('CONTEXT_EDITOR_DISPOSING')
    // Title generators can concatenate original text into a new message; identity filtering cannot cover it.
    if (options.purpose === 'session-title' && profile.changes.length) {
      const session = this.ctx.sessions.get(options.sessionId)
      this.fromSession(session)
      const events = this.sessionIndexes.get(session)?.events ?? []
      const source = events.findLast(event => event?.type === 'session/title-llm-request'
        && requestFingerprint(event.data.messages) === requestFingerprint(options.messages))
      if (!source) return // Unknown framing: no request, no impact on the main Agent.
      const selected = new Set(source.data.messageSeqs)
      const originals = events.filter(event => selected.has(event.seq) && event.type === 'user/message').map(event => event.data)
      const texts = transformMessages(originals, profile).map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')).filter(Boolean)
      if (!texts.length) return
      options = { ...options, messages: [{ ...options.messages[0], content: [{ type: 'text', text: 'Generate a concise session title from these human messages:\n' + JSON.stringify(texts) }] }] }
      alreadyEffective = true
    }
    let finish
    const controller = new AbortController()
    this.controllers.add(controller)
    const pending = new Promise(resolve => { finish = resolve })
    this.active.add(pending)
    try {
      let messages = alreadyEffective ? options.messages : transformMessages(options.messages, profile)
      messages = messages.map(message => {
        if (message.role !== 'assistant' || message.source?.provider !== REQUEST_PROVIDER) return message
        const sourceProfile = this.profile(message.source.model)
        return { ...message, source: { ...message.source, ...sourceProfile.upstream } }
      })
      const route = options.provider === REQUEST_PROVIDER ? profile.upstream : { provider: options.provider, model: options.model }
      const forwarded = { ...options, ...route, messages, signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal }
      this.forwarded.add(forwarded)
      yield* this.ctx.llm.stream(forwarded)
    } finally {
      finish()
      this.active.delete(pending)
      this.controllers.delete(controller)
    }
  }

  operation(session, operationId) { return this.operations.get(operationKey(session, operationId)) }

  availabilityReason() {
    const compaction = this.ctx.get('compaction')
    if (compaction && (compaction.constructor.name !== 'BasicCompactionEngine'
      || compaction.config?.summarizationProvider !== '' || compaction.config?.modelPolicies?.length)) {
      return 'request-transform-compaction-route'
    }
    return undefined
  }

  async prepare(session, operationId, request, changes, replacementEvent) {
    if (this.availabilityReason()) throw new Error('CONTEXT_EDITOR_COMPACTION_ROUTE_UNSUPPORTED')
    const requestHash = requestFingerprint(request)
    const prior = this.operation(session, operationId)
    if (prior) {
      if (prior.requestFingerprint !== requestHash) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
      return { id: prior.profileId, profile: this.profile(prior.profileId), existing: true }
    }
    const selected = this.fromSession(session)
    const config = session.requestHeader()?.config
    const upstream = selected && selected.profile.routeState !== 'released'
      ? selected.profile.upstream
      : config?.provider === REQUEST_PROVIDER ? selected?.profile.upstream : config && { provider: config.provider, model: config.model }
    if (!upstream || upstream.provider === REQUEST_PROVIDER) throw new Error('CONTEXT_EDITOR_MODEL_ROUTE_REQUIRED')
    const patches = new Map((selected?.profile.changes ?? []).map(change => [change.rootEventSeq, change]))
    const events = session.snapshotEvents()
    const messages = session.deriveMessages()
    for (const change of changes) {
      const originalEvent = events[change.rootEventSeq]
      const source = originalEvent?.type === 'user/message' ? originalEvent.data : originalEvent?.data?.message
      const previous = patches.get(change.rootEventSeq)
      const raw = messages.find(message => message.id === (previous?.originalId ?? source?.id))
      if (!raw || !canTransformMessage(raw)) throw new Error('CONTEXT_EDITOR_UNSUPPORTED_MESSAGE_CONTRACT')
      if (change.mode === 'clear') { patches.delete(change.rootEventSeq); continue }
      const message = change.mode === 'replace' ? { ...structuredClone(raw), content: structuredClone(change.message.content) } : undefined
      if (message) validateReplacement(raw, message)
      if (message && messageFingerprint(message) === messageFingerprint(raw)) { patches.delete(change.rootEventSeq); continue }
      patches.set(change.rootEventSeq, {
        rootEventSeq: change.rootEventSeq, originalId: raw.id, originalFingerprint: messageFingerprint(raw),
        mode: change.mode, ...(message ? { message } : {}),
      })
    }
    const profile = profileSchema.parse({
      version: 2, routeState: 'active', upstream, origin: { id: session.id, createdAt: session.header.createdAt },
      operation: { action: (request.mutation === 'context' ? request.action : request.mutation) ?? 'context', unitId: request.unitId ?? null, unitIds: request.unitIds ?? null },
      previous: selected?.id ?? null, operationId,
      baseline: requestFingerprint({ messages, header: session.requestHeader() }),
      changes: [...patches.values()].sort((a, b) => a.rootEventSeq - b.rootEventSeq),
      replacementEvents: [...(selected?.profile.replacementEvents ?? []), ...(replacementEvent ? [replacementEvent] : [])],
    })
    transformMessages(messages, profile)
    // Unsigned plain responses do not need their old Provider replay envelope after restore.
    if (!profile.changes.length && !messages.some(message => message.source?.provider === REQUEST_PROVIDER
      && (!canTransformMessage(message) || message.content.some(block => block.type !== 'text')))) profile.routeState = 'released'
    const id = `ce2-${requestFingerprint(profile)}`
    await this.profiles.put(id, profile)
    await this.operations.put(operationKey(session, operationId), { profileId: id, requestFingerprint: requestHash, status: 'pending' })
    return { id, profile, existing: false }
  }

  appendSelection(session, prepared) {
    const prior = session.snapshotEvents().find(event => event.type === 'request/header'
      && event.data.header.config.provider === REQUEST_PROVIDER && event.data.header.config.model === prepared.id)
    if (prior) return prior
    if (prepared.profile.baseline !== requestFingerprint({ messages: session.deriveMessages(), header: session.requestHeader() })) {
      throw new Error('CONTEXT_EDITOR_CONTEXT_CHANGED_BEFORE_PROFILE_SELECTION')
    }
    const header = session.requestHeader()
    if (!header) throw new Error('CONTEXT_EDITOR_MODEL_ROUTE_REQUIRED')
    // This is an actual Provider/model selection, not a custom operation smuggled into another event.
    const event = session.append('request/header', {
      header: { ...header, config: { ...header.config, provider: REQUEST_PROVIDER, model: prepared.id } }, reason: 'change',
    })
    if (prepared.profile.routeState === 'released') session.append('request/header', { header: { ...header, config: { ...header.config, ...prepared.profile.upstream } }, reason: 'change' })
    return event
  }

  async settle(session, operationId, status, reason) {
    const key = operationKey(session, operationId)
    const operation = this.operations.get(key)
    if (!operation) throw new Error('CONTEXT_EDITOR_OPERATION_MISSING')
    await this.operations.put(key, { ...operation, status, ...(reason ? { reason } : {}) })
  }

  async dispose() {
    this.closed = true
    for (const controller of this.controllers) controller.abort(new Error('CONTEXT_EDITOR_DISPOSING'))
    await Promise.all(this.active)
    for (const dispose of this.disposers.reverse()) await dispose()
    await this.domain.close()
  }
}
