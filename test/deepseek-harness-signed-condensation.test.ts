import { describe, expect, it, vi } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { ContextEditorHost } from '../adapters/deepseek-harness/index.js'

function fixture() {
  const header = { version: 0, id: 'signed-condensation', createdAt: 10, cwd: 'D:/fixture' }
  const events: any[] = [
    { seq: 0, time: 10, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: {
      id: 'assistant-original', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model', replayState: {
        response: { kind: 'deepseek-messages', version: 1, model: 'test-model' },
        blocks: [{ type: 'reasoning', signature: 'original-signature' }, { type: 'text' }, { type: 'tool-call' }],
      } },
      content: [{ type: 'reasoning', text: 'Reasoning facts. '.repeat(100) }, { type: 'text', text: 'Answer facts. '.repeat(100) }, { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{}' }],
    } } },
    { seq: 1, time: 11, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, callId: 'call-1', message: { id: 'result-original', role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'Tool result. '.repeat(100) }] }] } } },
  ]
  const original = structuredClone(events)
  const session = {
    id: header.id,
    header,
    snapshotEvents: () => events,
    requestHeader: () => ({ config: { provider: 'test', model: 'test-model' } }),
    deriveMessages: () => Session.create(header.id as any, events as any, header as any).deriveMessages(),
    append: (type: string, data: any, options: any = {}) => {
      const e = { seq: events.length, time: events.length + 10, type, data, ...options }
      events.push(e)
      return e
    },
  }
  const stream = vi.fn(async function* () { yield { type: 'text-delta', text: 'Preserved reasoning, answer and tool facts.' }; yield { type: 'finish', reason: { kind: 'stop' } } })
  const agent = { session, status: 'idle', runMaintenance: (run: () => unknown) => run() }
  const host = Object.create(ContextEditorHost.prototype) as any
    host.nativeProjectionSupported = true // Fixture models the extended rc.8 native API.
  const rows = new Map()
  host.ctx = { agents: { get: () => agent }, sessions: { flush: vi.fn() }, sessionPersistence: { inspect: async () => ({ meta: header, events }) }, llm: { stream } }
  host.table = { get: (id: string) => rows.get(id), put: async (id: string, row: any) => { rows.set(id, row) } }
  host.condensationControllers = new Map()
  host.condensationOperations = new Map()
  host.operationTails = new Map()
  host.searchCache = new Map()
  host.historyCache = new Map()
  host.mutationAdmissionOpen = true
  return { host, header, events, original, stream }
}

describe('DeepSeek signed reasoning whole-block condensation', () => {
  it.each([{ kinds: ['answer', 'reasoning'] }, { kinds: ['answer'] }, { kinds: ['reasoning'] }])('closes checkpoint selections across tool steps ($kinds)', async ({ kinds }) => {
    const { host, header, events, stream } = fixture()
    host.hostAdapter = 'session-surface-v1'
    host.inspect = host.ctx.sessionPersistence.inspect
    host.ctx.sessions.messageProjections = []
    events.push({ seq: 2, time: 12, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: {
      id: 'assistant-final', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model' }, content: [{ type: 'text', text: 'Final result. '.repeat(100) }],
    } } })
    events.push({ seq: 3, time: 13, type: 'user/message', surfaceOp: 'append', data: { id: 'unselected-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep this outside the summary.' }] } })
    const before = structuredClone(events)
    const projection = await host.readProjection(header.id)
    const units = projection.records.flatMap((r: any) => r.units)
    const requested = units.filter((u: any) => kinds.includes(u.kind)).map((u: any) => u.id)
    const proposal = await host.previewCondensation({ sessionId: header.id, unitIds: requested, expandRelated: false })
    expect(proposal.ok).toBe(true)
    expect(proposal.expandRelated).toBe(true)
    expect(proposal.sourceRootSeqs).toEqual([0, 1, 2])
    expect(proposal.autoExpandedUnitIds).toContain(units.find((u: any) => u.kind === 'tool').id)
    expect(proposal.sourceUnits.map((u: any) => u.kind)).toEqual(['reasoning', 'answer', 'tool'])
    expect(stream).toHaveBeenCalledOnce()
    expect(events).toEqual(before)
  })

  it.each([{ kinds: ['answer', 'reasoning'] }, { kinds: ['answer'] }])('includes mid-turn input in the explicit preview ($kinds)', async ({ kinds }) => {
    const { host, header, events, stream } = fixture()
    host.hostAdapter = 'session-surface-v1'
    host.inspect = host.ctx.sessionPersistence.inspect
    host.ctx.sessions.messageProjections = []
    events.push({ seq: 2, time: 12, type: 'user/message', surfaceOp: 'append', data: { id: 'gap', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Do not silently absorb this input.' }] } })
    events.push({ seq: 3, time: 13, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: {
      id: 'assistant-final', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model' }, content: [{ type: 'text', text: 'Final result.' }],
    } } })
    const projection = await host.readProjection(header.id)
    const requested = projection.records[0].units.filter((u: any) => kinds.includes(u.kind)).map((u: any) => u.id)
    const proposal = await host.previewCondensation({ sessionId: header.id, unitIds: requested })
    expect(proposal.sourceRootSeqs).toEqual([0, 1, 2, 3])
    const intervening = proposal.sourceUnits.find((unit: any) => unit.kind === 'user')
    expect(proposal.autoExpandedUnitIds).toContain(intervening.id)
    expect(intervening.text).toContain('Do not silently absorb this input.')
    expect(stream).toHaveBeenCalledOnce()
  })

  it.each([true, false])('previews, commits and restores signed reasoning with answer (sync=%s)', async sync => {
    const { host, header, events, original, stream } = fixture()
    const before = await host.readProjection(header.id)
    const units = before.records.flatMap((r: any) => r.units)
    const answer = units.find((u: any) => u.kind === 'answer')
    const reasoning = units.find((u: any) => u.kind === 'reasoning')
    const request = { sessionId: header.id, baseRevision: before.revision, unitIds: sync ? [answer.id] : [answer.id, reasoning.id], expandRelated: sync, operationId: 'signed-summary' }
    const proposal = await host.previewCondensation(request)
    expect(proposal.ok).toBe(true)
    expect(stream).toHaveBeenCalledOnce()
    const prepared = host.condensationOperations.get(request.operationId)
    const assistant = prepared.afterChanges.find((c: any) => c.rootEventSeq === 0).message
    expect(assistant.content.some((b: any) => b.type === 'reasoning')).toBe(false)
    expect(assistant.source.replayState.blocks.some((b: any) => b.signature !== undefined)).toBe(false)
    if (sync) {
      expect(assistant.content.some((b: any) => b.type === 'tool-call')).toBe(false)
      expect(prepared.afterChanges.find((c: any) => c.rootEventSeq === 1).mode).toBe('remove')
    } else {
      expect(assistant.content.some((b: any) => b.type === 'tool-call')).toBe(true)
      expect(prepared.afterChanges.some((c: any) => c.rootEventSeq === 1)).toBe(false)
    }
    const committed = await host.commitCondensation({ ...request, summary: proposal.summary })
    expect(committed.ok).toBe(true)
    host.condensationOperations.clear() // A fresh snapshot must recover applied status from durable records.
    const after = await host.readProjection(header.id)
    const appliedSnapshot = host.snapshotOf(after, false)
    expect(appliedSnapshot.condensations).toHaveLength(1)
    expect(appliedSnapshot.condensations[0]).toMatchObject({ operationId: request.operationId, status: 'applied', summary: proposal.summary, contextExcluded: false })
    const recovery = await host.previewRecovery({ sessionId: header.id, kind: 'condensation', operationId: request.operationId })
    expect(recovery).toMatchObject({ ok: true, boundarySeq: original.at(-1).seq, messageCount: 2 })
    expect(events.slice(0, original.length)).toEqual(original)
    expect(events.at(-1).type).toBe('user/message')
    expect(events.at(-1).data.id).toContain('context-editor-condensation-v1:')
  })

  it('still rejects unknown replay formats before generating', async () => {
    const { host, header, events, stream } = fixture()
    events[0].data.message.source.replayState.response.version = 2
    const projection = await host.readProjection(header.id)
    const unitIds = projection.records[0].units.map((u: any) => u.id)
    await expect(host.previewCondensation({ sessionId: header.id, baseRevision: projection.revision, unitIds })).rejects.toThrow('CONTEXT_EDITOR_CONDENSATION_OPAQUE_CONTENT')
    expect(stream).not.toHaveBeenCalled()
  })
})

describe('DeepSeek background delivery and tool execution traces', () => {
  it('keeps a proposal valid across delivery receipts but rejects new conversation content', async () => {
    const { host, header, events, original } = fixture()
    const projection = await host.readProjection(header.id)
    const answer = projection.records.flatMap((r: any) => r.units).find((u: any) => u.kind === 'answer')
    const request = { sessionId: header.id, baseRevision: projection.revision, unitIds: [answer.id], expandRelated: true, operationId: 'receipt-test' }
    const proposal = await host.previewCondensation(request)
    events.push({ seq: events.length, time: 12, type: 'session-log-deepseek/delivery-accepted', ignorable: true, data: { throughSeq: 1 } })
    expect((await host.readProjection(header.id)).revision).toBe(projection.revision)
    expect((await host.commitCondensation({ ...request, summary: proposal.summary })).ok).toBe(true)
    const after = await host.readProjection(header.id)
    events.push({ seq: events.length, time: 13, type: 'user/message', surfaceOp: 'append', data: { id: 'new-user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'A real change' }] } })
    expect((await host.readProjection(header.id)).revision).not.toBe(after.revision)
    const recovery = await host.previewRecovery({ sessionId: header.id, operationId: request.operationId })
    expect(recovery).toMatchObject({ ok: true, boundarySeq: original.length, messageCount: 2 })
  })

  it('does not turn a duplicate log-only tool/call into an unavailable source', async () => {
    const { host, header, events } = fixture()
    events.push({ seq: events.length, type: 'tool/call', data: { turn: 1, callId: 'call-1', name: 'read', arguments: '{}' } })
    const projection = await host.readProjection(header.id)
    const tool = projection.records.find((r: any) => r.kind === 'tool')
    expect(tool.atoms).toHaveLength(2)
    expect(tool.units[0].projectionState).not.toBe('unavailable')
    const answer = projection.records.flatMap((r: any) => r.units).find((u: any) => u.kind === 'answer')
    const proposal = await host.previewCondensation({ sessionId: header.id, baseRevision: projection.revision, unitIds: [answer.id], expandRelated: true })
    expect(proposal.ok).toBe(true)
    expect(proposal.sourceRootSeqs).toEqual([0, 1])
  })
})

it('refuses unsupported native projection before generating or writing', async () => {
  const { host, header, stream, events } = fixture()
  host.nativeProjectionSupported = false
  const snapshot = host.snapshotOf(await host.readProjection(header.id), false)
  expect(snapshot.capabilities.contextCondensation).toBe(false)
  expect(snapshot.contextMutationUnavailableReason).toBe('native-projection-unsupported')
  await expect(host.previewCondensation({ sessionId: header.id })).rejects.toThrow('CONTEXT_EDITOR_NATIVE_PROJECTION_UNSUPPORTED')
  await expect(host.commitCondensation({ sessionId: header.id })).rejects.toThrow('CONTEXT_EDITOR_NATIVE_PROJECTION_UNSUPPORTED')
  expect(stream).not.toHaveBeenCalled()
  expect(events).toHaveLength(2)
})
