import { describe, expect, it, vi } from 'vitest'
import { ContextEditorHost } from '../adapters/deepseek-harness/index.js'

const hostPrototype = ContextEditorHost.prototype as unknown as { inspect(this: unknown, sessionId: string): Promise<unknown> }
const inspect = (persistence: unknown) => hostPrototype.inspect.call({ ctx: { sessionPersistence: persistence } }, 'session-compat')

describe('DeepSeek persistence compatibility', () => {
  it('preserves the rc.8 inspection path', async () => {
    const result = { meta: { id: 'session-compat' }, events: [] }
    const persistence = { inspect: vi.fn().mockResolvedValue(result), open: vi.fn() }
    expect(await inspect(persistence)).toBe(result)
    expect(persistence.inspect).toHaveBeenCalledWith('session-compat')
    expect(persistence.open).not.toHaveBeenCalled()
  })

  it('reads through a non-owning handle and closes it', async () => {
    const events = [{ seq: 0, type: 'user/message', data: { content: [] } }]
    const handle = { header: { id: 'session-compat' }, inheritedEventCount: 1, read: vi.fn().mockResolvedValue({ events }), close: vi.fn().mockResolvedValue(undefined) }
    const persistence = { open: vi.fn().mockResolvedValue(handle) }
    expect(await inspect(persistence)).toEqual({ meta: handle.header, inheritedEventCount: 1, events })
    expect(persistence.open).toHaveBeenCalledWith('session-compat', 'read')
    expect(handle.close).toHaveBeenCalledOnce()
  })

  it('releases a handle after read failure and propagates the failure', async () => {
    const error = new Error('invalid session log')
    const handle = { read: vi.fn().mockRejectedValue(error), close: vi.fn().mockResolvedValue(undefined) }
    await expect(inspect({ open: vi.fn().mockResolvedValue(handle) })).rejects.toBe(error)
    expect(handle.close).toHaveBeenCalledOnce()
  })
})
