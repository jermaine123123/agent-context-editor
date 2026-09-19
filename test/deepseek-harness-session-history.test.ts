import { describe, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { ContextEditorHost } from '../adapters/deepseek-harness/index.js'

function fixture(modern: boolean) {
  const header = { id: 'history-compat', createdAt: 123, cwd: resolve('fixture') }
  const events = [{ seq: 0, time: 123, type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, message: {
    id: 'answer', role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test-model' }, content: [{ type: 'text', text: 'Preserve the important configuration and result. '.repeat(80) }],
  } } }]
  const session = { id: header.id, header, requestHeader: () => ({ config: { provider: 'test', model: 'test-model' } }), ...(modern ? { snapshotEvents: () => events } : { events }) }
  const stream = vi.fn(async function* () { yield { type: 'text-delta', text: 'Preserve configuration and result.' }; yield { type: 'finish', reason: { kind: 'stop' } } })
  const agent = { session, status: 'idle', runMaintenance: (run: () => unknown) => run() }
  const host = Object.create(ContextEditorHost.prototype) as any
    host.nativeProjectionSupported = true // Fixture models the extended rc.8 native API.
  host.ctx = { agents: { get: () => agent }, sessionPersistence: { inspect: async () => ({ meta: header, events }) }, llm: { stream } }
  host.table = { get: () => undefined, put: vi.fn() }
  host.condensationControllers = new Map()
  host.condensationOperations = new Map()
  return { host, session, stream, header }
}

describe('DeepSeek live session history compatibility', () => {
  it.each([true, false])('generates from the same durable and live revision (modern=%s)', async modern => {
    const { host, session, stream, header } = fixture(modern)
    const persisted = await host.readProjection(header.id)
    const live = host.projectionFromSession(session)
    expect(live.revision).toBe(persisted.revision)
    expect(live.records).toHaveLength(1)
    const answer = persisted.records[0].units.find((unit: any) => unit.kind === 'answer')
    const result = await host.previewCondensation({ sessionId: header.id, baseRevision: persisted.revision, unitIds: [answer.id], expandRelated: false })
    expect(result.ok).toBe(true)
    expect(stream).toHaveBeenCalledOnce()
  })

  it('refuses an unsupported session shape instead of treating it as empty', () => {
    const { host, header } = fixture(true)
    expect(() => host.projectionFromSession({ id: header.id, header })).toThrow('CONTEXT_EDITOR_SESSION_HISTORY_UNAVAILABLE')
  })

  it('keeps real revision conflicts and does not call the model', async () => {
    const { host, header, stream } = fixture(true)
    const result = await host.previewCondensation({ sessionId: header.id, baseRevision: 'stale', unitIds: [] })
    expect(result).toMatchObject({ ok: false, conflict: true })
    expect(stream).not.toHaveBeenCalled()
  })
})
