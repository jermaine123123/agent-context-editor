import { describe, expect, it } from 'vitest'
import { deriveCondensationCoverage } from '../packages/context-editor-core/src/index.js'
import { ContextEditorHost, messagesBefore, nativeCompactionEvidence, nativeCompactionRefs } from '../adapters/deepseek-harness/index.js'

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

  it('blocks direct restore after native absorption and returns checkpoint guidance', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
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
    const result = await host.restoreCondensation({ sessionId: 's', operationId: 'selective-1', baseRevision: 'r1' })
    expect(result).toMatchObject({
      ok: false,
      restoreRequired: true,
      restoreMode: 'checkpoint',
      checkpointCompactionId: 'native-2',
      checkpointSeq: 4,
    })
  })

  it('blocks direct restore when native coverage proof is unavailable', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    const nativeEvents = [
      event(3, 'compaction/summary', { compactionId: 'native-unknown', shadowedSeqs: [1] }),
      event(4, 'compaction/end', { compactionId: 'native-unknown', turn: null }),
    ]
    const condensation = { operationId: 'selective-unknown', sourceRootSeqs: [1] }
    const projection = { revision: 'r1', sourceEvents: nativeEvents }
    host.ctx = { agents: new Map(), sessions: new Map() }
    host.operationTails = new Map()
    host.mutationAdmissionOpen = true
    host.readProjection = async () => projection
    host.rowFor = () => ({ condensationEvents: [condensation] })
    host.snapshotOf = () => ({ revision: 'r1' })
    const result = await host.restoreCondensation({ sessionId: 's', operationId: 'selective-unknown', baseRevision: 'r1' })
    expect(result).toMatchObject({
      ok: false,
      restoreRequired: true,
      restoreMode: 'unavailable',
    })
  })

  it('heals a pending sidecar after a native apply event already exists', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    const pending = { operationId: 'selective-2', status: 'pending', sourceRootSeqs: [1] }
    const row = { session: { createdAt: 1 }, schemaVersion: 1, storageVersion: 1, events: [], replacementEvents: [], condensationEvents: [pending] }
    const initial = {
      identity: { id: 's', createdAt: 1 },
      revision: 'r2',
      sourceEvents: [event(8, 'context/projection', { condensationOperationId: 'selective-2', condensationAction: 'apply' })],
    }
    const writes: unknown[] = []
    host.ctx = { agents: new Map(), sessions: new Map() }
    host.operationTails = new Map()
    host.mutationAdmissionOpen = true
    host.condensationOperations = new Map()
    host.readProjection = async () => initial
    host.rowFor = () => row
    host.snapshotOf = () => ({ revision: 'r2' })
    host.table = { put: async (_sessionId: string, value: unknown) => { writes.push(value) } }
    const result = await host.commitCondensation({ sessionId: 's', operationId: 'selective-2', baseRevision: 'r2' })
    expect(result.ok).toBe(true)
    expect((writes[0] as any).condensationEvents[0].status).toBe('applied')
  })
})
