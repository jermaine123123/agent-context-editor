import { describe, expect, it } from 'vitest'
const modulePath = '../adapters/deepseek-harness/request-transform.js'
const { RequestTransformRuntime, transformMessages, messageFingerprint, requestFingerprint } = await import(modulePath)

const original = () => ({ id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'original' }], source: { kind: 'model', provider: 'upstream', model: 'model', replayState: { response: { kind: 'deepseek-messages', version: 1, model: 'model' }, blocks: [{ type: 'text' }] } } })
const patch = (message: ReturnType<typeof original>) => ({ rootEventSeq: 0, originalId: message.id, originalFingerprint: messageFingerprint(message), mode: 'replace', message: { ...message, content: [{ type: 'text', text: 'edited' }] } })
function fixture() {
  const tables = new Map<string, Map<string, unknown>>()
  const domain = { table(name: string) {
    const rows = tables.get(name) ?? new Map(); tables.set(name, rows)
    return { get: (key: string) => rows.get(key), put: async (key: string, value: unknown) => { rows.set(key, structuredClone(value)) }, entries: () => rows.entries() }
  } }
  const runtime = new RequestTransformRuntime({ get: () => undefined }, domain)
  const message = original()
  const events: any[] = [{ seq: 0, type: 'assistant/message', data: { message } }]
  const header = { config: { provider: 'upstream', model: 'model' }, tools: [] }
  const session = { id: 'synthetic', header: { createdAt: 1 }, snapshotEvents: () => events, deriveMessages: () => [message], requestHeader: () => [...events].reverse().find(e => e.type === 'request/header')?.data.header ?? header, append(type: string, data: unknown) { const event = { seq: events.length, type, data }; events.push(event); return event } }
  return { runtime, session, events, message }
}

describe('plugin request profiles', () => {
  it('restores one checkpoint in place, retains later summaries and edits, and ignores covered checkpoints', () => {
    const message = original()
    const checkpoint = { id: 'checkpoint-A', role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'summary A' }] }
    const other = { ...checkpoint, id: 'checkpoint-B', content: [{ type: 'text', text: 'summary B' }] }
    const profile = { version: 3, changes: [patch(message)], checkpointRestorations: [{ operationId: 'A', checkpointId: checkpoint.id, checkpointFingerprint: messageFingerprint(checkpoint), sourceRootSeqs: [0], messages: [message] }] }
    const output = transformMessages([checkpoint, other], profile)
    expect(output.map((value: any) => value.id)).toEqual(['answer', 'checkpoint-B'])
    expect(output[0].content[0].text).toBe('edited')
    expect(output[1]).toEqual(other)
    expect(transformMessages([other], profile)).toEqual([other])
    expect(() => transformMessages([{ ...checkpoint, content: [] }], profile)).toThrow('CHECKPOINT_CHANGED')
    expect(() => transformMessages([checkpoint, message], profile)).toThrow('DUPLICATE_MESSAGE_ID')
  })

  it('keeps the immutable restore mapping when editing a restored message', async () => {
    const { runtime, session, events, message } = fixture()
    const checkpoint = { id: 'checkpoint', role: 'user', source: { kind: 'plugin' }, content: [{ type: 'text', text: 'summary' }] }
    events.push({ seq: 1, type: 'user/message', data: checkpoint })
    session.deriveMessages = () => [checkpoint] as any
    const restoration = { operationId: 'A', checkpointId: checkpoint.id, checkpointFingerprint: messageFingerprint(checkpoint), sourceRootSeqs: [0], messages: [message] }
    const restored = await runtime.prepare(session, 'restore-A', { mutation: 'restore-condensation' }, [], undefined, restoration)
    runtime.appendSelection(session, restored)
    expect(restored.profile.version).toBe(3)
    const edited = await runtime.prepare(session, 'edit-restored', { text: 'edited' }, [{ rootEventSeq: 0, mode: 'replace', message: { ...message, content: [{ type: 'text', text: 'edited' }] } }])
    expect(edited.profile.checkpointRestorations).toEqual([restoration])
    expect(transformMessages([checkpoint], edited.profile)[0].content[0].text).toBe('edited')
    expect(runtime.profile(restored.id).changes).toEqual([])
  })

  it('retains Assistant identity, does not mutate original replay metadata, and preserves unrelated structured messages', () => {
    const message = original(); const before = structuredClone(message)
    const untouched = { id: 'signed', role: 'assistant', content: [{ type: 'reasoning', text: 'thought', signature: 'signature' }, { type: 'tool-call', id: 'call' }] }
    const image = { id: 'image', role: 'user', content: [{ type: 'image', data: 'synthetic' }] }
    const output = transformMessages([message, untouched, image], { changes: [patch(message)] })
    expect(output[0]).toMatchObject({ id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'edited' }] })
    expect(output[0].source.replayState).toBeUndefined()
    expect(output[1]).toBe(untouched); expect(output[2]).toBe(image)
    expect(message).toEqual(before)
  })
  it('removes the whole message and never resurrects targets removed by compaction', () => {
    const message = original(); const profile = { changes: [{ ...patch(message), mode: 'remove' }] }
    expect(transformMessages([message], profile)).toEqual([])
    expect(transformMessages([], { changes: [patch(message)] })).toEqual([])
  })
  it('rejects changed content, duplicate identity, signed blocks and role conversion', () => {
    const message = original(); const change = patch(message)
    expect(() => transformMessages([{ ...message, content: [{ type: 'text', text: 'changed' }] }], { changes: [change] })).toThrow('MESSAGE_CHANGED')
    expect(() => transformMessages([message, message], { changes: [change] })).toThrow('DUPLICATE_MESSAGE_ID')
    const signed = { ...message, content: [{ type: 'text', text: 'original', signature: 'signed' }] }
    expect(() => transformMessages([signed], { changes: [{ ...change, originalFingerprint: messageFingerprint(signed) }] })).toThrow('PLAIN_TEXT_REQUIRED')
    expect(() => transformMessages([message], { changes: [{ ...change, message: { ...change.message, role: 'user' } }] })).toThrow('INVALID_PROFILE_MESSAGE')
  })
  it('persists pending evidence before append, retries without duplicate append, and rejects ID reuse', async () => {
    const { runtime, session, events, message } = fixture()
    const change = { rootEventSeq: 0, mode: 'replace', message: { ...message, content: [{ type: 'text', text: 'edited' }] } }
    const prepared = await runtime.prepare(session, 'op', { text: 'edited' }, [change])
    expect(runtime.operation(session, 'op').status).toBe('pending'); expect(events).toHaveLength(1)
    runtime.appendSelection(session, prepared)
    await runtime.settle(session, 'op', 'unverified', 'simulated failure after append')
    const retry = await runtime.prepare(session, 'op', { text: 'edited' }, [change])
    runtime.appendSelection(session, retry)
    expect(events).toHaveLength(2)
    await expect(runtime.prepare(session, 'op', { text: 'different' }, [change])).rejects.toThrow('OPERATION_REUSED')
    await runtime.settle(session, 'op', 'persisted-and-verified')
    expect(runtime.operation(session, 'op').status).toBe('persisted-and-verified')
  })
  it('refuses a pending-only operation after its source context changes', async () => {
    const { runtime, session, message } = fixture()
    const prepared = await runtime.prepare(session, 'op', {}, [{ rootEventSeq: 0, mode: 'remove' }])
    message.content[0]!.text = 'new content'
    expect(() => runtime.appendSelection(session, prepared)).toThrow('CONTEXT_CHANGED')
  })
  it('checks content-addressed profile integrity and canonical key order', async () => {
    expect(requestFingerprint({ a: 1, b: 2 })).toBe(requestFingerprint({ b: 2, a: 1 }))
    const { runtime, session } = fixture()
    const prepared = await runtime.prepare(session, 'op', {}, [{ rootEventSeq: 0, mode: 'remove' }])
    await runtime.profiles.put(prepared.id, { ...prepared.profile, changes: [] })
    expect(() => runtime.profile(prepared.id)).toThrow('MISSING_OR_INVALID')
  })
})
