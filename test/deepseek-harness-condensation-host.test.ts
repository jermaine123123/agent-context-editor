import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { ContextEditorHost, inject } from '../adapters/deepseek-harness/index.js'

// Use the running Harness native validator instead of an unchecked append mock.
const nativeProjectionPath = '../deepseek-harness-latest/packages/core/session/src/context-projection.ts'
const { validateContextProjectionEvent, applyContextProjectionEvent } = await import(nativeProjectionPath)

function makeFixture(failure?: { code: string; message: string }) {
  const overlays = new Map()
  const session: any = {
    id: 'host-condense',
    header: { id: 'host-condense', createdAt: 7, cwd: 'D:/workspace', config: { provider: 'mock', model: 'mock-model' } },
    events: [
      { seq: 0, time: 1, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [{ type: 'text', text: 'inspect and fix ' + 'a'.repeat(900) }] } },
      { seq: 1, time: 2, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'read the file first ' + 'b'.repeat(900) }] } } },
      { seq: 2, time: 3, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'the fix is complete ' + 'c'.repeat(900) }] } } },
    ],
    requestHeader() { return this.header },
    appendContextProjection(data: unknown) {
      const event = { seq: this.events.length, time: this.events.length + 1, type: 'context/projection', data }
      validateContextProjectionEvent(data, event.seq, this.events, this.events.filter((entry: any) => entry.surfaceOp === 'append').map((entry: any) => entry.seq), overlays)
      applyContextProjectionEvent(overlays, event)
      this.events.push(event)
      return event
    },
  }
  const rows = new Map<string, unknown>()
  const table = { get: (key: string) => rows.get(key), put: async (key: string, value: unknown) => { rows.set(key, value) } }
  const ctx = new Context()
  ctx.provide('storageDomain', { open: async () => ({ table: () => table, close: async () => {} }) } as never)
  ctx.provide('sessionPersistence', { inspect: async () => ({ meta: { id: session.id, createdAt: 7, cwd: 'D:/workspace' }, events: session.events }) } as never)
  ctx.provide('sessions', { flush: async () => {} } as never)
  const agent = { status: 'idle', session, runMaintenance: (operation: () => unknown) => operation() }
  ctx.provide('agents', { get: (id: string) => id === session.id ? agent : undefined, resume: async () => ({ agent, dispose: async () => {} }) } as never)
  ctx.provide('llm', {
    listModels: async () => [{ id: 'mock-model', name: 'Mock model' }],
    stream: (options: any) => (async function* () {
      for (const message of options.messages) {
        expect(Array.isArray(message.content)).toBe(true)
        expect(message.content.filter((block: any) => block.type === 'text')).toBeDefined()
      }
      expect(options.messages.at(-1)).toMatchObject({ role: 'user', content: [{ type: 'text', text: expect.stringContaining('<selected-context>') }] })
      if (failure) {
        yield { type: 'finish', reason: { kind: 'error', failure } }
        return
      }
      yield { type: 'text-delta', index: 0, text: 'goal, evidence, and completed fix' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })(),
  } as never)
  return { ctx, session, rows }
}

describe('DeepSeek condensation host lifecycle', () => {
  // The published adapter declaration models the remote Typert service. This
  // test exercises the local runtime class exported by the same module.
  const RuntimeContextEditorHost: any = ContextEditorHost as any
  let host: any
  afterEach(async () => { await host?.dispose() })

  it('preserves model failure details without applying a projection', async () => {
    const fixture = makeFixture({ code: 'INVALID_REQUEST', message: 'invalid message content' })
    const pluginContext = await new Promise<Context>(resolve => {
      fixture.ctx.plugin({ inject: [...inject], apply(ctx: Context) { resolve(ctx) } })
    })
    host = new RuntimeContextEditorHost(pluginContext)
    await host.init()
    const initial = await host.getSnapshot({ sessionId: fixture.session.id })
    await expect(host.previewCondensation({ sessionId: fixture.session.id, baseRevision: initial.revision, unitIds: [initial.records[0].units[0].id] }))
      .rejects.toThrow('CONTEXT_EDITOR_CONDENSATION_MODEL_ERROR: INVALID_REQUEST: invalid message content')
    expect(fixture.session.events.filter((event: any) => event.type === 'context/projection')).toHaveLength(0)
  })
  it.each(['user', 'assistant'])('applies and restores a range beginning with %s through native validation', async (startRole) => {
    const fixture = makeFixture()
    const pluginContext = await new Promise<Context>(resolve => {
      fixture.ctx.plugin({ inject: [...inject], apply(ctx: Context) { resolve(ctx) } })
    })
    host = new RuntimeContextEditorHost(pluginContext)
    await host.init()
    const initial = await host.getSnapshot({ sessionId: fixture.session.id }) as any
    const userId = initial.records.find((record: any) => record.kind === 'user').units[0].id
    const answerId = initial.records.find((record: any) => record.kind === 'ai').units.find((unit: any) => unit.kind === 'answer').id
    const excludedUserPreview = await host.previewContext({ sessionId: fixture.session.id, action: 'exclude', expectedRevision: initial.revision, unitIds: [userId] }) as any
    const excludedUser = await host.commitContext({ sessionId: fixture.session.id, operationId: 'pre-existing-exclusion', action: 'exclude', expectedRevision: excludedUserPreview.expectedRevision, unitIds: [userId] }) as any
    expect(excludedUser.ok).toBe(true)
    const proposal = await host.previewCondensation({ sessionId: fixture.session.id, baseRevision: excludedUser.snapshot.revision, unitIds: startRole === 'assistant' ? [answerId] : [userId, answerId], expandRelated: true }) as any
    expect(proposal.ok).toBe(true)
    expect(proposal.canExpandRelated).toBe(startRole === 'assistant')
    expect(proposal.expandRelated).toBe(startRole === 'assistant')
    if (startRole === 'assistant') expect(proposal.autoExpandedUnitIds.length).toBeGreaterThan(0)
    else expect(proposal.autoExpandedUnitIds).toEqual([])
    expect((([...fixture.rows.values()][0] as any).condensationEvents ?? [])[0].status).toBe('pending')
    const editedSummary = 'goal, evidence, and completed fix (manually checked)'
    const applied = await host.commitCondensation({ sessionId: fixture.session.id, operationId: proposal.operationId, baseRevision: proposal.baseRevision, summary: editedSummary }) as any
    expect(applied.ok).toBe(true)
    expect(fixture.session.events.filter((event: any) => event.type === 'context/projection')).toHaveLength(2)
    expect(applied.snapshot.condensations).toHaveLength(1)
    expect(applied.snapshot.condensations[0].sourceUnits.length).toBeGreaterThan(0)
    expect(applied.snapshot.condensations[0].summary).toBe(editedSummary)
    host.condensationOperations.clear()
    const restarted = await host.getSnapshot({ sessionId: fixture.session.id }) as any
    expect(restarted.condensations).toHaveLength(1)
    expect(restarted.condensations[0].summary).toBe(editedSummary)
    const sourceUnitId = applied.snapshot.condensations[0].sourceUnits[0].id
    const blockedEdit = await host.previewReplacement({ sessionId: fixture.session.id, unitId: sourceUnitId, baseRevision: applied.snapshot.revision, text: 'manual edit' }) as any
    expect(blockedEdit.canCommit).toBe(false)
    expect(blockedEdit.disabledReason).toBe('condensation-active')
    await expect(host.previewContext({ sessionId: fixture.session.id, action: 'exclude', expectedRevision: applied.snapshot.revision, unitIds: [sourceUnitId] })).rejects.toThrow('CONTEXT_EDITOR_CONDENSATION_RESTORE_REQUIRED')
    const surfacePreview = await host.previewContext({ sessionId: fixture.session.id, action: 'exclude', expectedRevision: applied.snapshot.revision, unitIds: [sourceUnitId], condensationOperationId: proposal.operationId }) as any
    expect(surfacePreview.ok).toBe(true)
    const surfaceApplied = await host.commitContext({ sessionId: fixture.session.id, operationId: 'summary-surface', action: 'exclude', expectedRevision: surfacePreview.expectedRevision, unitIds: [sourceUnitId], condensationOperationId: proposal.operationId }) as any
    expect(surfaceApplied.ok).toBe(true)
    const surfaceRestored = await host.previewContext({ sessionId: fixture.session.id, action: 'restore', expectedRevision: surfaceApplied.snapshot.revision, unitIds: [sourceUnitId], condensationOperationId: proposal.operationId }) as any
    expect(surfaceRestored.ok).toBe(true)
    const surfaceRestoreApplied = await host.commitContext({ sessionId: fixture.session.id, operationId: 'summary-surface-restore', action: 'restore', expectedRevision: surfaceRestored.expectedRevision, unitIds: [sourceUnitId], condensationOperationId: proposal.operationId }) as any
    expect(surfaceRestoreApplied.ok).toBe(true)
    const restored = await host.restoreCondensation({ sessionId: fixture.session.id, operationId: proposal.operationId, baseRevision: surfaceRestoreApplied.snapshot.revision }) as any
    expect(restored.ok).toBe(true)
    expect(restored.snapshot.condensations).toHaveLength(0)
    expect(fixture.session.events.filter((event: any) => event.type === 'context/projection')).toHaveLength(5)
  })
  it('keeps unselected reasoning and tool calls in a shared root through apply, exclude and restore', async () => {
    const fixture = makeFixture()
    const reasoning = { type: 'reasoning', text: 'keep this reasoning verbatim' }
    const call = { type: 'tool-call', id: 'read-1', name: 'read', arguments: '{"path":"a.txt"}' }
    fixture.session.events[2].data.message.content.unshift(reasoning)
    fixture.session.events[2].data.message.content.push(call)
    fixture.session.events.push({ seq: 3, time: 4, type: 'tool/result', surfaceOp: 'append', data: { turn: 1, message: { id: 'result-1', role: 'user', source: { kind: 'tool', callId: 'read-1' }, content: [{ type: 'tool-result', toolCallId: 'read-1', content: [{ type: 'text', text: 'file contents' }] }] } } })
    const pluginContext = await new Promise<Context>(resolve => {
      fixture.ctx.plugin({ inject: [...inject], apply(ctx: Context) { resolve(ctx) } })
    })
    host = new RuntimeContextEditorHost(pluginContext)
    await host.init()
    const snapshot = await host.getSnapshot({ sessionId: fixture.session.id })
    const answer = snapshot.records.flatMap((record: any) => record.units).find((unit: any) => unit.kind === 'answer')
    const proposal = await host.previewCondensation({ sessionId: fixture.session.id, baseRevision: snapshot.revision, unitIds: [answer.id] })
    expect(proposal.expandRelated).toBe(false)
    expect(proposal.canExpandRelated).toBe(true)
    expect(proposal.effectiveUnitIds).toEqual([answer.id])
    expect(proposal.sourceUnits.every((unit: any) => unit.kind === 'answer')).toBe(true)
    const applied = await host.commitCondensation({ sessionId: fixture.session.id, operationId: proposal.operationId, baseRevision: proposal.baseRevision })
    expect(applied.ok).toBe(true)
    const changes = fixture.session.events.at(-1).data.changes
    expect(changes).toHaveLength(1)
    expect(changes[0].rootEventSeq).toBe(2)
    expect(changes[0].message.content).toEqual([reasoning, { type: 'text', text: expect.stringContaining('<condensed-context>') }, call])
    const preview = await host.previewContext({ sessionId: fixture.session.id, action: 'exclude', expectedRevision: applied.snapshot.revision, unitIds: [answer.id], condensationOperationId: proposal.operationId })
    const excluded = await host.commitContext({ sessionId: fixture.session.id, operationId: 'exclude-partial-summary', action: 'exclude', expectedRevision: preview.expectedRevision, unitIds: [answer.id], condensationOperationId: proposal.operationId })
    expect(fixture.session.events.at(-1).data.changes[0].message.content).toEqual([reasoning, call])
    expect(excluded.snapshot.condensations[0].contextExcluded).toBe(true)
    host.condensationOperations.clear()
    const restored = await host.restoreCondensation({ sessionId: fixture.session.id, operationId: proposal.operationId, baseRevision: excluded.snapshot.revision })
    expect(restored.ok).toBe(true)
    expect(restored.snapshot.condensations).toEqual([])
    expect(fixture.session.events.at(-1).data.changes).toEqual([{ rootEventSeq: 2, mode: 'clear' }])
  })

})
