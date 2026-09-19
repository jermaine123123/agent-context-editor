import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionStore, foldSurface, hasSurfaceContract } from './host-api.js'

const require = createRequire(import.meta.url)
const ownPackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
export const PLUGIN_VERSION = String(ownPackage.version ?? 'unknown')
const pluginBuildFingerprint = createHash('sha256')
for (const file of ['package.json', 'index.js', 'request-transform.js', 'host-api.js', 'history-index.js', 'host-compat.js', 'core.js', 'core-runtime.js', 'client.bundle.js', 'client.css']) {
  pluginBuildFingerprint.update(file).update(readFileSync(new URL(file, import.meta.url)))
}
const PLUGIN_BUILD_FINGERPRINT = pluginBuildFingerprint.digest('hex')
export const SURFACE_ADAPTER_ID = 'session-surface-v1'
export const LEGACY_ADAPTER_ID = 'legacy-context-projection'
export const READ_ONLY_ADAPTER_ID = 'read-only'

function packageVersion(name) {
  try {
    let directory = dirname(require.resolve(name))
    for (;;) {
      const manifestPath = resolve(directory, 'package.json')
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (manifest.name === name) return String(manifest.version ?? 'unknown')
      } catch {
        // Continue walking until this package's own manifest is found.
      }
      const parent = dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  } catch {
    // A host component may intentionally be absent in a reduced profile.
  }
  return 'unavailable'
}

function objectName(value) {
  return value?.constructor?.name || 'unknown'
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function detectHostAdapter(ctx) {
  if (typeof Session?.prototype.appendContextProjection === 'function') return LEGACY_ADAPTER_ID
  // The request adapter writes standard Surface events. Optional message-projection
  // registration is needed only by hosts that expose that separate extension API.
  if (typeof Session?.prototype.append === 'function'
    && hasSurfaceContract
    && typeof Session?.create === 'function'
    && typeof Session?.fromRestore === 'function'
    && typeof Session?.prototype.deriveMessages === 'function'
    && typeof ctx?.sessionPersistence?.open === 'function') {
    return SURFACE_ADAPTER_ID
  }
  return READ_ONLY_ADAPTER_ID
}

export function createHostIdentity(ctx, pluginVersion, adapter = detectHostAdapter(ctx)) {
  const componentNames = [
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-persistence',
    '@deepseek-ai/dsh-compaction-basic',
    '@deepseek-ai/dsh-typert-protocol',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-conversation',
  ]
  const components = Object.fromEntries(componentNames.map(name => [name, packageVersion(name)]))
  const runtime = `node=${process.version};platform=${process.platform};arch=${process.arch}`
  const storageBackend = objectName(ctx?.sessionPersistence)
  const projectionTypes = (ctx?.sessions?.messageProjections ?? []).map(value => String(value?.type ?? '')).sort()
  const buildFingerprint = digest(JSON.stringify({ components, runtime, storageBackend, projectionTypes, adapter }))
  return {
    host: 'deepseek-harness',
    version: components['@deepseek-ai/dsh-session'],
    components,
    buildFingerprint,
    pluginVersion: String(pluginVersion ?? 'unknown'),
    pluginBuildFingerprint: PLUGIN_BUILD_FINGERPRINT,
    adapter,
    runtime,
    storageBackend,
  }
}

function messageText(messages) {
  return (messages ?? []).flatMap(message => Array.isArray(message?.content) ? message.content : [])
    .map(block => block?.type === 'text' ? String(block.text ?? '') : '')
    .filter(Boolean)
    .join('\n')
}

function syntheticUser(id, text) {
  return {
    id,
    role: 'user',
    source: { kind: 'plugin', plugin: 'context-editor-compatibility-check' },
    content: [{ type: 'text', text }],
  }
}

function appendSurfaceReplacement(session, type, data, startSeq, endSeq, sourceEventSeqs) {
  let lastError
  for (const range of [
    { startSeq, endSeq },
    { start: startSeq, end: endSeq },
  ]) {
    try {
      return session.append(type, data, {
        surfaceOp: { op: 'replace', ...range },
        ...(sourceEventSeqs === undefined ? {} : { sourceEventSeqs }),
      })
    } catch (error) {
      lastError = error
      if (!/invalid replace surfaceOp/i.test(String(error?.message ?? error))) throw error
    }
  }
  throw lastError ?? new Error('session Surface replacement shape is unavailable')
}

export function runSurfaceSelfTest(ctx) {
  const diagnostics = []
  const cases = {
    sessionSurfaceAvailable: typeof Session?.prototype.append === 'function',
    userMessageReplacement: false,
    restartReplay: false,
    toolResultContentOnly: false,
    emptyUserMessageRetained: false,
    assistantReplacementRejected: false,
    multiMessageUserCheckpointReplayed: false,
    multiMessageCompactionCheckpointReplayed: false,
    preCompactionForkRestoresOriginalMessages: false,
    noUserDataOrCredentials: true,
  }
  if (!cases.sessionSurfaceAvailable) {
    return { status: 'failed', usedSyntheticData: true, cases, diagnostics: ['Session.append is unavailable'] }
  }

  const projections = Array.isArray(ctx?.sessions?.messageProjections) ? ctx.sessions.messageProjections : []
  const sessionId = `context-editor-compat-${randomUUID()}`
  try {
    const session = Session.create(sessionId)
    const events = []
    const original = session.append('user/message', syntheticUser('compat-user-original', 'fixed synthetic prompt'), { surfaceOp: 'append' })
    events.push(original)
    const edited = appendSurfaceReplacement(session, 'user/message', {
      ...syntheticUser('compat-user-edited', 'fixed synthetic edit'),
      sourceEventMarker: `${sessionId}:0`,
    }, original.seq, original.seq, [original.seq])
    events.push(edited)
    const folded = foldSurface(events, projections)
    cases.userMessageReplacement = folded.nodes.length === 1
      && folded.nodes[0] === edited.seq
      && messageText(session.deriveMessages()) === 'fixed synthetic edit'
    const serialized = JSON.parse(JSON.stringify(events))
    const restored = Session.create(sessionId, serialized, session.header, session.inheritedEventCount, projections)
    cases.restartReplay = JSON.stringify(restored.deriveMessages()) === JSON.stringify(session.deriveMessages())
    if (!cases.userMessageReplacement) diagnostics.push('User Surface replacement did not change the derived model message')
    if (!cases.restartReplay) diagnostics.push('A detached Session replay did not preserve the derived model message')
  } catch (error) {
    diagnostics.push(`User Surface replay: ${String(error?.message ?? error)}`)
  }

  try {
    const sessionId = `context-editor-condensation-check-${randomUUID()}`
    const session = Session.create(sessionId)
    session.append('turn/start', { turn: 1 })
    const first = session.append('user/message', syntheticUser('condense-user', 'fixed synthetic original user'), { surfaceOp: 'append' })
    const second = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'condense-assistant',
        role: 'assistant',
        source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
        content: [{ type: 'text', text: 'fixed synthetic original answer' }],
      },
      stream: [],
    }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: 'complete' })
    appendSurfaceReplacement(session, 'user/message', {
      id: `context-editor-condensation-v1:${encodeURIComponent(sessionId)}:synthetic`,
      role: 'user',
      source: { kind: 'plugin', plugin: 'context-editor-deepseek-harness', form: 'condensation' },
      content: [{ type: 'text', text: 'fixed synthetic user checkpoint summary' }],
    }, first.seq, second.seq, [first.seq, second.seq])
    const events = typeof session.snapshotEvents === 'function' ? session.snapshotEvents() : []
    const replayed = Session.create(sessionId, JSON.parse(JSON.stringify(events)), session.header, 0, projections)
    const messages = replayed.deriveMessages()
    cases.multiMessageUserCheckpointReplayed = foldSurface(events, projections).nodes.length === 1
      && messages.length === 1
      && messages[0]?.role === 'user'
      && messageText(messages) === 'fixed synthetic user checkpoint summary'
    if (!cases.multiMessageUserCheckpointReplayed) diagnostics.push('A plugin User Surface checkpoint did not replay as the sole current model message')
  } catch (error) {
    diagnostics.push(`Plugin User checkpoint check: ${String(error?.message ?? error)}`)
  }

  try {
    const session = Session.create(`context-editor-tool-check-${randomUUID()}`)
    const call = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'compat-assistant-call',
        role: 'assistant',
        source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
        content: [{ type: 'tool-call', id: 'compat-call', name: 'echo', arguments: '{}' }],
      },
      stream: [],
    }, { surfaceOp: 'append' })
    const result = session.append('tool/result', {
      turn: 1,
      step: 1,
      message: {
        id: 'compat-tool-result',
        role: 'user',
        source: { kind: 'tool', callId: 'compat-call' },
        content: [{ type: 'tool-result', content: 'fixed synthetic output' }],
      },
    }, { surfaceOp: 'append' })
    const redacted = appendSurfaceReplacement(session, 'tool/result', {
      ...result.data,
      message: { ...result.data.message, content: [{ ...result.data.message.content[0], content: null }] },
    }, result.seq, result.seq, [result.seq])
    const messages = session.deriveMessages()
    cases.toolResultContentOnly = messages.length === 2
      && messages[0]?.content?.[0]?.id === 'compat-call'
      && messages[1]?.id === result.data.message.id
      && messages[1]?.content?.[0]?.content === null
      && redacted.sourceEventSeqs?.includes(result.seq) === true
    if (!cases.toolResultContentOnly) diagnostics.push('Tool-result replacement changed tool correlation or message identity')
    void call
  } catch (error) {
    diagnostics.push(`Tool-result Surface replay: ${String(error?.message ?? error)}`)
  }

  try {
    const session = Session.create(`context-editor-empty-check-${randomUUID()}`)
    const original = session.append('user/message', syntheticUser('compat-empty-original', 'fixed synthetic prompt'), { surfaceOp: 'append' })
    appendSurfaceReplacement(session, 'user/message', {
      id: 'compat-empty-user',
      role: 'user',
      source: { kind: 'plugin', plugin: 'context-editor-compatibility-check' },
      content: [],
    }, original.seq, original.seq, [original.seq])
    const messages = session.deriveMessages()
    cases.emptyUserMessageRetained = messages.length === 1 && messages[0]?.role === 'user' && Array.isArray(messages[0]?.content) && messages[0].content.length === 0
  } catch (error) {
    diagnostics.push(`Empty User behavior: ${String(error?.message ?? error)}`)
  }

  try {
    const session = Session.create(`context-editor-assistant-check-${randomUUID()}`)
    const original = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'compat-assistant-original',
        role: 'assistant',
        source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
        content: [{ type: 'text', text: 'fixed synthetic answer' }],
      },
      stream: [],
    }, { surfaceOp: 'append' })
    try {
      appendSurfaceReplacement(session, 'assistant/message', {
        ...original.data,
        message: { ...original.data.message, id: 'compat-assistant-edited', content: [{ type: 'text', text: 'fixed synthetic edit' }] },
      }, original.seq, original.seq)
    } catch (error) {
      cases.assistantReplacementRejected = /sourceEventSeqs/.test(String(error?.message ?? error))
      if (!cases.assistantReplacementRejected) diagnostics.push(`Assistant replacement rejected for an unexpected reason: ${String(error?.message ?? error)}`)
    }
  } catch (error) {
    diagnostics.push(`Assistant replacement check: ${String(error?.message ?? error)}`)
  }

  try {
    const isolatedStore = new SessionStore(new Context())
    const sessionId = `context-editor-native-compaction-check-${randomUUID()}`
    const session = isolatedStore.create(sessionId)
    session.append('turn/start', { turn: 1 })
    const first = session.append('user/message', syntheticUser('compat-compaction-user', 'fixed synthetic original user'), { surfaceOp: 'append' })
    const second = session.append('assistant/message', {
      turn: 1,
      step: 1,
      message: {
        id: 'compat-compaction-assistant',
        role: 'assistant',
        source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
        content: [{ type: 'text', text: 'fixed synthetic original answer' }],
      },
      stream: [],
    }, { surfaceOp: 'append' })
    const preCompactionBoundary = session.append('turn/end', { turn: 1, reason: 'complete' })
    session.append('turn/start', { turn: 2 })
    const compactionId = `compat-${randomUUID()}`
    const start = session.append('compaction/start', { compactionId, turn: 2 })
    const summary = session.append('compaction/summary', {
      compactionId,
      summary: [{ type: 'text', text: 'fixed synthetic compacted summary' }],
      shadowedRange: { start: first.seq, end: second.seq },
      shadowedSeqs: [first.seq, second.seq],
      shadowedTokenCount: 100,
      provider: 'synthetic',
      model: 'fixed',
    })
    appendSurfaceReplacement(session, 'user/message', {
      id: 'compat-native-checkpoint',
      role: 'user',
      source: { kind: 'plugin', plugin: 'compact', compactionId },
      content: [{ type: 'text', text: 'fixed synthetic compacted summary' }],
    }, first.seq, second.seq, [start.seq, summary.seq, first.seq, second.seq])
    session.append('compaction/end', { compactionId, turn: 2 })
    const projections = Array.isArray(ctx?.sessions?.messageProjections) ? ctx.sessions.messageProjections : []
    const events = typeof session.snapshotEvents === 'function'
      ? session.snapshotEvents()
      : Array.isArray(session.events) ? session.events : []
    const replayed = Session.create(sessionId, events, session.header, 0, projections)
    cases.multiMessageCompactionCheckpointReplayed = foldSurface(events, projections).nodes.length === 1
      && messageText(replayed.deriveMessages()) === 'fixed synthetic compacted summary'
    const branch = isolatedStore.fork(session, preCompactionBoundary.seq, `context-editor-pre-compaction-${randomUUID()}`)
    cases.preCompactionForkRestoresOriginalMessages = JSON.stringify(branch.deriveMessages().map(message => messageText([message])))
      === JSON.stringify(['fixed synthetic original user', 'fixed synthetic original answer'])
    if (!cases.multiMessageCompactionCheckpointReplayed) diagnostics.push('A multi-message compaction checkpoint did not replay as the sole current Surface message')
    if (!cases.preCompactionForkRestoresOriginalMessages) diagnostics.push('SessionStore.fork did not recover the pre-compaction model messages')
  } catch (error) {
    diagnostics.push(`Native compaction and fork check: ${String(error?.message ?? error)}`)
  }

  const required = [
    'userMessageReplacement',
    'restartReplay',
    'toolResultContentOnly',
    'emptyUserMessageRetained',
    'assistantReplacementRejected',
    'multiMessageUserCheckpointReplayed',
    'multiMessageCompactionCheckpointReplayed',
    'preCompactionForkRestoresOriginalMessages',
  ]
  const passedCount = required.filter(key => cases[key]).length
  const status = passedCount === required.length ? 'passed' : passedCount > 0 ? 'partial' : 'failed'
  return { status, usedSyntheticData: true, persistenceTested: false, cases, diagnostics }
}

export function createCompatibilityReport(ctx, pluginVersion, adapter = detectHostAdapter(ctx), selfTest = undefined) {
  const hostIdentity = createHostIdentity(ctx, pluginVersion, adapter)
  const interfaceLevel = 'interface-recognized'
  const unsupported = (reason, evidence = []) => ({
    available: false,
    status: 'unsupported',
    verificationLevel: interfaceLevel,
    reason,
    evidence,
  })
  const features = {
    historyRead: typeof ctx?.sessionPersistence?.open === 'function'
      ? { available: true, status: 'available', verificationLevel: interfaceLevel, evidence: ['SessionPersistence.open', 'SessionHandle.read', 'SessionHandle.close'] }
      : typeof ctx?.sessionPersistence?.inspect === 'function'
        ? { available: true, status: 'available', verificationLevel: interfaceLevel, evidence: ['SessionPersistence.inspect'] }
        : unsupported('session-history-api-unavailable'),
    search: { available: true, status: 'available', verificationLevel: interfaceLevel, evidence: ['shared-core-search'] },
    viewMutation: typeof ctx?.storageDomain?.open === 'function'
      ? { available: true, status: 'available', verificationLevel: interfaceLevel, evidence: ['isolated context_editor storage domain'] }
      : unsupported('storage-domain-unavailable'),
    contextExclusion: adapter === LEGACY_ADAPTER_ID
      ? { available: true, status: 'available', verificationLevel: interfaceLevel, evidence: ['legacy appendContextProjection contract'] }
      : adapter === SURFACE_ADAPTER_ID
        ? unsupported('official-surface-has-no-lossless-message-removal', [
          'Surface replacement keeps one message node; replacing a User message with empty content leaves that node on the model surface',
          'The current session format rejects an unknown required context/projection event during persistent replay',
          'Message projection callbacks do not receive a session id, so a sidecar-only decision cannot safely distinguish forks with the same event prefix',
        ])
        : unsupported('context-write-api-unavailable'),
    contextReplacement: adapter === LEGACY_ADAPTER_ID
      ? { available: true, status: 'available', verificationLevel: interfaceLevel, evidence: ['legacy appendContextProjection contract'] }
      : adapter === SURFACE_ADAPTER_ID && selfTest?.cases?.userMessageReplacement && selfTest?.cases?.restartReplay
        ? { available: true, status: 'self-test-passed', verificationLevel: interfaceLevel, scope: 'single plain-text User message; replace, restore, and undo only', evidence: ['synthetic in-memory user/message Surface replacement', 'JSON serialization and detached Session replay', 'tool-result source identity and call correlation preserved', 'host storage persistence is verified only when an operation is applied'] }
        : unsupported(adapter === SURFACE_ADAPTER_ID ? 'surface-replacement-self-test-failed' : 'context-write-api-unavailable'),
    assistantReplacement: adapter === SURFACE_ADAPTER_ID
      ? unsupported('assistant-message-surface-replacement-rejected-by-source-reference-contract', [
          'assistant/message cannot carry sourceEventSeqs, while Surface replacement requires references to every shadowed message node',
          'The current session format rejects an unknown required context/projection event during persistent replay',
          'A sidecar-only projection cannot safely identify one session when branches share the same event prefix',
        ])
      : unsupported('context-write-api-unavailable'),
    contextCondensation: adapter === LEGACY_ADAPTER_ID
      ? { available: true, status: 'available', verificationLevel: interfaceLevel, evidence: ['legacy appendContextProjection contract'] }
      : adapter === SURFACE_ADAPTER_ID && selfTest?.cases?.multiMessageUserCheckpointReplayed
        ? { available: true, status: 'contract-self-test-passed', verificationLevel: 'isolated-self-test', scope: 'completed User and Assistant message range replaced by a replayable User checkpoint; operation-level JSONL readback is still required', evidence: ['user/message Surface range replacement', 'JSON serialization and detached Session replay', 'checkpoint payload uses the standard user/message event type'] }
        : unsupported(adapter === SURFACE_ADAPTER_ID ? 'multi-message-summary-restore-not-proven-for-standard-surface' : 'context-write-api-unavailable', ['The checkpoint path uses standard user/message events; a persisted checkpoint must pass operation-level readback before it is reported applied']),
    nativeCompaction: adapter === SURFACE_ADAPTER_ID
      && hostIdentity.components['@deepseek-ai/dsh-compaction-basic'] !== 'unavailable'
      && selfTest?.cases?.multiMessageCompactionCheckpointReplayed
        ? { available: true, status: 'self-test-passed', verificationLevel: 'isolated-self-test', scope: 'multi-message summary checkpoint; inline un-compaction is not available', evidence: ['official compaction start/summary/Surface replacement/end contract', 'multi-message range replays as one checkpoint message'] }
        : { available: false, status: 'unknown', verificationLevel: 'none', reason: adapter === SURFACE_ADAPTER_ID ? 'native-compaction-contract-not-confirmed' : 'surface-api-unavailable' },
    nativeCompactionRecovery: adapter === SURFACE_ADAPTER_ID && selfTest?.cases?.preCompactionForkRestoresOriginalMessages
      ? typeof ctx?.agents?.create === 'function' && typeof ctx?.sessions?.flush === 'function'
        ? {
            available: true,
            status: 'plugin-path-integrated',
            verificationLevel: 'interface-recognized',
            hostApiSelfTest: 'passed',
            scope: 'plugin recovery branch uses AgentRegistry.create; durable behavior still requires host acceptance',
            evidence: [
              'AgentRegistry.create accepts a deterministic session id, balanced seed, inherited prefix length, and parent lineage',
              'The adapter persists and re-reads the child before exposing its session id',
              'The client navigates with the official uiWorkspace.openSession API',
            ],
          }
        : unsupported('agent-create-or-session-flush-unavailable', ['Recovery requires the official AgentRegistry.create and SessionStore.flush APIs'])
      : unsupported('pre-compaction-fork-not-confirmed'),
  }
  return {
    schemaVersion: 1,
    hostIdentity,
    checkedAt: new Date().toISOString(),
    features,
    ...(selfTest === undefined ? {} : { selfTest }),
  }
}

export function compatibilityCacheKey(report) {
  return `${report.hostIdentity.buildFingerprint}:${report.hostIdentity.pluginVersion}`
}

export { packageVersion }
