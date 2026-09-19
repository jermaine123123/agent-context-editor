import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { deriveCondensationCoverage } from '../packages/context-editor-core/src/index.js'
import { ContextEditorHost, messagesBefore, nativeCompactionEvidence, nativeCompactionRefs } from '../adapters/deepseek-harness/index.js'
import { Session } from '@deepseek-ai/dsh-session'

function event(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}) {
  return { seq, time: seq + 1, type, data, ...extra }
}

describe('DeepSeek native compaction coverage', () => {
  it('links only completed native compactions to a checkpoint replacement', () => {
    const events = [
      event(1, 'user/message', { role: 'user', content: [{ type: 'text', text: 'old one' }] }),
      event(2, 'user/message', { role: 'user', content: [{ type: 'text', text: 'old two' }] }),
      event(3, 'compaction/start', { compactionId: 'native-1', turn: null }),
      event(4, 'compaction/summary', { compactionId: 'native-1', shadowedRange: { start: 1, end: 2 }, shadowedSeqs: [1, 2], summary: 'summary' }),
      event(5, 'user/message', { role: 'user', content: [{ type: 'text', text: 'checkpoint summary' }] }, {
        surfaceOp: { op: 'replace', start: 1, end: 2 },
        sourceEventSeqs: [3, 4, 1, 2],
      }),
      event(6, 'compaction/end', { compactionId: 'native-1', turn: null }),
      event(7, 'compaction/summary', { compactionId: 'failed', shadowedSeqs: [4] }),
      event(8, 'compaction/end', { compactionId: 'failed', error: 'model failed' }),
      event(9, 'compaction/summary', { compactionId: 'uncertain', shadowedSeqs: [2] }),
      event(10, 'compaction/end', { compactionId: 'uncertain', turn: null }),
    ]
    expect(nativeCompactionRefs(events)).toEqual([{
      host: 'deepseek-harness',
      compactionId: 'native-1',
      shadowedRootSeqs: [1, 2],
      startSeq: 3,
      shadowedRange: { start: 1, end: 2 },
      summarySeq: 4,
      checkpointSeq: 5,
      endSeq: 6,
      committed: true,
    }])
    expect(deriveCondensationCoverage([1, 2, 8], nativeCompactionRefs(events))).toMatchObject({
      status: 'partial',
      restoreMode: 'checkpoint',
      coveredSourceRootSeqs: [1, 2],
      uncoveredSourceRootSeqs: [8],
      checkpointCompactionId: 'native-1',
      checkpointSeq: 5,
    })
  })

  it('uses only the current native surface when preparing a later selective summary', () => {
    const projection = {
      sourceEvents: [
        event(1, 'user/message', { role: 'user', content: [{ type: 'text', text: 'shadowed original' }] }),
        event(2, 'user/message', { role: 'user', content: [{ type: 'text', text: 'still active' }] }),
        event(3, 'user/message', { role: 'user', content: [{ type: 'text', text: 'native summary' }] }),
      ],
      activeSurfaceSeqs: [2, 3],
      atoms: [],
      records: [],
      replacementStates: new Map(),
      contextOverlays: new Map(),
    }
    expect(messagesBefore(projection, 3).map(message => message.content?.[0]?.text)).toEqual([
      'still active',
      'native summary',
    ])
  })

  it('reports unavailable recovery when native records cannot prove a Surface checkpoint', () => {
    const events = [
      event(1, 'user/message', { role: 'user', content: [{ type: 'text', text: 'old' }] }),
      event(2, 'compaction/summary', { compactionId: 'native-uncertain', shadowedRange: { start: 1, end: 1 }, shadowedSeqs: [1], summary: 'summary' }),
      event(3, 'compaction/end', { compactionId: 'native-uncertain', turn: null }),
    ]
    expect(nativeCompactionRefs(events)).toEqual([])
    expect(nativeCompactionEvidence(events)).toMatchObject([{
      compactionId: 'native-uncertain',
      shadowedRootSeqs: [1],
      committed: false,
    }])
    expect(deriveCondensationCoverage([1], nativeCompactionEvidence(events))).toMatchObject({
      status: 'none',
      restoreMode: 'unavailable',
      uncoveredSourceRootSeqs: [1],
      reason: 'checkpoint-unavailable',
    })
  })

  it('does not claim recovery when an old sidecar has no durable User checkpoint', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    host.nativeProjectionSupported = true // Fixture models the extended rc.8 native API.
    const nativeEvents = [
      event(3, 'compaction/summary', { compactionId: 'native-2', shadowedSeqs: [1] }),
      event(4, 'user/message', { role: 'user', content: [{ type: 'text', text: 'summary' }] }, {
        surfaceOp: { op: 'replace' },
        sourceEventSeqs: [1, 3],
      }),
      event(5, 'compaction/end', { compactionId: 'native-2' }),
    ]
    const condensation = { operationId: 'selective-1', sourceRootSeqs: [1] }
    const projection = { revision: 'r1', sourceEvents: nativeEvents }
    host.ctx = { agents: new Map(), sessions: new Map() }
    host.operationTails = new Map()
    host.mutationAdmissionOpen = true
    host.readProjection = async () => projection
    host.rowFor = () => ({ condensationEvents: [condensation] })
    host.snapshotOf = () => ({ revision: 'r1' })
    await expect(host.previewRecovery({ sessionId: 's', operationId: 'selective-1' }))
      .rejects.toThrow('CONTEXT_EDITOR_CONDENSATION_CHECKPOINT_UNVERIFIED')
  })

  it('does not offer native recovery when a compaction lacks a committed checkpoint', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    host.nativeProjectionSupported = true // Fixture models the extended rc.8 native API.
    const nativeEvents = [
      event(3, 'compaction/summary', { compactionId: 'native-unknown', shadowedSeqs: [1] }),
      event(4, 'compaction/end', { compactionId: 'native-unknown', turn: null }),
    ]
    const projection = { revision: 'r1', sourceEvents: nativeEvents }
    host.ctx = { agents: new Map(), sessions: new Map() }
    host.readProjection = async () => projection
    host.rowFor = () => ({ condensationEvents: [], recoveryEvents: [] })
    await expect(host.previewRecovery({ sessionId: 's', kind: 'native-compaction', compactionId: 'native-unknown' }))
      .rejects.toThrow('CONTEXT_EDITOR_NATIVE_COMPACTION_UNVERIFIED')
  })

  it('reconciles a pending sidecar only when its durable User checkpoint is present', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    host.nativeProjectionSupported = true // Fixture models the extended rc.8 native API.
    const operationId = 'selective-2'
    const checkpointId = `context-editor-condensation-v1:s:${operationId}`
    const summary = 'fixed checkpoint summary'
    const session = (Session as any).create('s')
    const framedSummary = `<condensed-context>\n${summary}\n</condensed-context>`
    session.append('user/message', {
      id: checkpointId,
      role: 'user',
      source: { kind: 'plugin', plugin: 'context-editor-deepseek-harness', form: 'snapshot' },
      content: [{ type: 'text', text: framedSummary }],
    }, { surfaceOp: 'append' })
    const pending = {
      operationId,
      status: 'pending',
      summary,
      checkpointSeq: 0,
      recoveryAnchorSeq: -1,
      sourceRootSeqs: [],
    }
    const row = { session: { createdAt: session.header.createdAt }, schemaVersion: 1, storageVersion: 1, events: [], replacementEvents: [], condensationEvents: [pending], recoveryEvents: [] }
    const initial = {
      identity: { id: 's', createdAt: session.header.createdAt },
      revision: 'r2',
      sourceEvents: session.events,
      sessionHeader: session.header,
      inheritedEventCount: 0,
      contextRevision: 'context-r2',
    }
    const writes: unknown[] = []
    host.ctx = { agents: new Map(), sessions: new Map() }
    host.operationTails = new Map()
    host.mutationAdmissionOpen = true
    host.condensationOperations = new Map()
    host.historyCache = new Map()
    host.searchCache = new Map()
    host.readProjection = async () => initial
    host.rowFor = () => row
    host.snapshotOf = () => ({ revision: 'r2' })
    host.table = { put: async (_sessionId: string, value: unknown) => { writes.push(value) } }
    const result = await host.commitCondensation({ sessionId: 's', operationId, baseRevision: 'r2', summary })
    expect(result.ok).toBe(true)
    expect((writes[0] as any).condensationEvents[0].status).toBe('applied')
  })

  it('reconciles a live checkpoint after persistence flush and records a verified commit', async () => {
    const sessionId = 'live-checkpoint-reconcile'
    const operationId = 'live-reconcile'
    const checkpointId = `context-editor-condensation-v1:${sessionId}:${operationId}`
    const summary = 'fixed checkpoint summary'
    const session = (Session as any).create(sessionId)
    const source = session.append('user/message', {
      id: 'source-user',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'source context to replace' }],
    }, { surfaceOp: 'append' })
    const prefix = [...session.events]
    session.append('user/message', {
      id: checkpointId,
      role: 'user',
      source: { kind: 'plugin', plugin: 'context-editor-deepseek-harness', form: 'condensation' },
      content: [{ type: 'text', text: `<condensed-context>\n${summary}\n</condensed-context>` }],
    }, { surfaceOp: { op: 'replace', start: source.seq, end: source.seq }, sourceEventSeqs: [source.seq] })
    const liveEvents = [...session.events]
    const header = session.header
    let durableEvents: any[] = [...prefix]
    const pending = {
      schemaVersion: 1,
      type: 'condensation',
      action: 'apply',
      status: 'pending',
      operationId,
      sessionId,
      baseRevision: 'context-r1',
      requestedUnitIds: ['unit-0'],
      effectiveUnitIds: ['unit-0'],
      recordIds: ['record-0'],
      sourceRootSeqs: [source.seq],
      sourceFingerprint: '',
      sourceUnits: [],
      summary,
      provider: 'synthetic',
      model: 'fixed',
      metrics: { beforeTokens: 10000, afterTokens: 100, savedTokens: 9900, savingsRatio: 0.99, belowRecommendedThreshold: false },
      prefixTokens: 0,
      summaryTokens: 12,
      createdAt: new Date(0).toISOString(),
      beforeChanges: [{ rootEventSeq: source.seq, mode: 'clear' }],
      afterChanges: [],
      recoveryAnchorSeq: source.seq,
      recoveryPrefixFingerprint: createHash('sha256').update(JSON.stringify(prefix)).digest('hex'),
      recoverySessionId: 'recovery-live-checkpoint-reconcile',
    }
    const row: any = {
      session: { createdAt: header.createdAt, cwd: header.cwd },
      schemaVersion: 1,
      storageVersion: 1,
      events: [],
      replacementEvents: [],
      condensationEvents: [pending],
      recoveryEvents: [],
    }
    const identity = { id: sessionId, createdAt: header.createdAt, cwd: header.cwd }
    const staleProjection = {
      identity,
      sessionHeader: header,
      inheritedEventCount: 0,
      revision: 'context-r1',
      contextRevision: 'context-r1',
      sourceRevision: 1,
      sourceEvents: prefix,
      events: [],
      records: [],
      atoms: [{ id: 'atom-0', sourceRef: { entryId: String(source.seq), blockIndex: 0 } }],
      projectionStates: new Map([['atom-0', 'include']]),
      contextOverlays: new Map(),
      condensationEvents: [pending],
    }
    const agent = {
      session,
      status: 'idle',
      runMaintenance: async (run: () => unknown) => run(),
    }
    let readCount = 0
    const host = Object.create(ContextEditorHost.prototype) as any
    host.nativeProjectionSupported = true
    host.ctx = {
      agents: { get: () => agent },
      sessions: {
        messageProjections: [],
        flush: async () => { durableEvents = [...liveEvents] },
      },
      sessionPersistence: {
        inspect: async () => ({ meta: header, events: durableEvents, revision: `storage-${durableEvents.length}`, eventCount: durableEvents.length }),
      },
    }
    host.operationTails = new Map()
    host.mutationAdmissionOpen = true
    host.condensationOperations = new Map()
    host.condensationControllers = new Map()
    host.historyCache = new Map()
    host.searchCache = new Map()
    host.readProjection = async () => {
      readCount += 1
      return readCount === 1
        ? staleProjection
        : { ...staleProjection, revision: 'context-r2', contextRevision: 'context-r2', sourceEvents: durableEvents, condensationEvents: row.condensationEvents }
    }
    host.projectionFromSession = () => ({ ...staleProjection, sourceEvents: liveEvents, condensationEvents: row.condensationEvents })
    host.rowFor = () => row
    host.snapshotOf = (projection: any) => ({ revision: projection.revision, contextRevision: projection.contextRevision })
    host.table = {
      put: async (_sessionId: string, value: any) => {
        row.condensationEvents = value.condensationEvents
        row.recoveryEvents = value.recoveryEvents
      },
    }

    const result = await host.commitCondensation({ sessionId, operationId, baseContextRevision: 'context-r1', summary })
    expect(result.commit.status).toBe('persisted-and-verified')
    expect(result.eventId).toBe(String(liveEvents.at(-1).seq))
    expect(row.condensationEvents[0]).toMatchObject({ status: 'applied', checkpointSeq: liveEvents.at(-1).seq, recoveryAnchorSeq: source.seq })
  })

  it('does not mark a pending sidecar applied from the old non-persistable projection event', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    host.nativeProjectionSupported = true
    const pending = { operationId: 'legacy-selective', status: 'pending', baseRevision: 'r2', summary: 'summary', sourceRootSeqs: [1] }
    const row = { session: { createdAt: 1 }, schemaVersion: 1, storageVersion: 1, events: [], replacementEvents: [], condensationEvents: [pending], recoveryEvents: [] }
    const initial = {
      identity: { id: 's', createdAt: 1 },
      revision: 'r2',
      sourceEvents: [event(8, 'context/projection', { condensationOperationId: 'legacy-selective', condensationAction: 'apply' })],
    }
    const writes: unknown[] = []
    host.ctx = { agents: new Map(), sessions: new Map() }
    host.operationTails = new Map()
    host.mutationAdmissionOpen = true
    host.condensationOperations = new Map()
    host.readProjection = async () => initial
    host.rowFor = () => row
    host.table = { put: async (_sessionId: string, value: unknown) => { writes.push(value) } }
    await expect(host.commitCondensation({ sessionId: 's', operationId: 'legacy-selective', baseRevision: 'r2' }))
      .rejects.toThrow('CONTEXT_EDITOR_CONDENSATION_SOURCE_GONE')
    expect(writes).toHaveLength(0)
  })
})
