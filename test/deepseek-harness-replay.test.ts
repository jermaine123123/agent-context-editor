import { describe, expect, it, vi } from 'vitest'
import { buildProjection, composeNativeRoot, normalizeSessionEvents, projectedMessageSource, projectRecords, selectCondensationRange } from '../adapters/deepseek-harness/core.js'

import { ContextEditorHost } from '../adapters/deepseek-harness/index.js'

const identity = { id: 'replay-test', createdAt: 1 }
function message() {
  return {
    role: 'assistant',
    source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-flash', replayState: {
      response: { kind: 'deepseek-messages', version: 1, model: 'deepseek-flash' },
      blocks: [{ type: 'reasoning', signature: 'test-signature' }, { type: 'text' }, { type: 'text' }],
    } },
    content: [{ type: 'reasoning', text: 'unchanged thought' }, { type: 'text', text: 'long answer part one' }, { type: 'text', text: 'long answer part two' }],
  }
}
function events(m = message()) { return [{ seq: 0, time: 1, type: 'assistant/message', data: { turn: 1, message: m } }] }

describe('DeepSeek Messages replay metadata', () => {
  it('allows ordinary answer editing while marking only signed reasoning', () => {
    const { atoms } = normalizeSessionEvents(identity, events())
    expect(atoms.map(atom => atom.hasSignature)).toEqual([true, false, false])
    const records = projectRecords(atoms)
    const answer = records[0]!.units.find(unit => unit.kind === 'answer')!
    expect(answer.replacementSupported).toBe(true)
    const range = selectCondensationRange(records, [answer.id])
    expect(range.sourceUnits.some(unit => unit.kind === 'answer')).toBe(true)
  })

  it('preserves signatures and block alignment when an answer is replaced', () => {
    const m = message()
    const before = structuredClone(m)
    const projection = buildProjection(identity, events(m))
    const answer = projection.records[0]!.units.find(unit => unit.kind === 'answer')!
    const replacements = new Map([[answer.id, { replacementState: 'replaced', effectiveText: 'short answer' }]])
    const composed = composeNativeRoot(projection, 0, replacements as never)
    const output = composed.message as { content: unknown; source: unknown }
    expect(output.content).toEqual([m.content[0], { type: 'text', text: 'short answer' }])
    expect(output.source).toMatchObject({ replayState: { blocks: [{ type: 'reasoning', signature: 'test-signature' }, { type: 'text' }] } })
    expect(m).toEqual(before)
  })

  it('realigns metadata after exclusion without assigning a removed signature to text', () => {
    const m = message()
    expect(projectedMessageSource(m, m.content.slice(1))).toMatchObject({ replayState: { blocks: [{ type: 'text' }, { type: 'text' }] } })
    expect(projectedMessageSource(m, [m.content[0]!])).toMatchObject({ replayState: { blocks: [{ type: 'reasoning', signature: 'test-signature' }] } })
  })

  it('continues protecting explicit signatures and unrecognized replay envelopes', () => {
    for (const source of [
      { ...message().source, signed: true },
      { ...message().source, replayBound: true },
      { ...message().source, replayState: { response: { kind: 'unknown' } } },
      { ...message().source, replayState: { ...message().source.replayState, blocks: [] } },
    ]) {
      const m = { ...message(), source }
      const { atoms } = normalizeSessionEvents(identity, events(m as never))
      expect(projectRecords(atoms)[0]!.units.find(unit => unit.kind === 'answer')!.replacementSupported).toBe(false)
    }
    const m = message()
    Object.assign(m.content[1]!, { signature: 'explicit-text-signature' })
    const { atoms } = normalizeSessionEvents(identity, events(m))
    expect(projectRecords(atoms)[0]!.units.find(unit => unit.kind === 'answer')!.replacementSupported).toBe(false)
  })

  it('generates an answer-only condensation without mutating signed reasoning', async () => {
    const m = message()
    m.content[1]!.text = 'Detailed answer to preserve the important result. '.repeat(60)
    const projection = buildProjection(identity, events(m))
    const answer = projection.records[0]!.units.find(unit => unit.kind === 'answer')!
    const host = Object.create(ContextEditorHost.prototype) as any
    host.nativeProjectionSupported = true // Fixture models the extended rc.8 native API.
    const session = { id: identity.id, header: identity, events: events(m), requestHeader: () => ({ config: { provider: 'deepseek-official', model: 'deepseek-flash' } }) }
    const agent = { status: 'idle', session, runMaintenance: (run: () => unknown) => run() }
    const stream = vi.fn(async function* () { yield { type: 'text-delta', text: 'Preserve the important result.' }; yield { type: 'finish', reason: { kind: 'stop' } } })
    host.ctx = { agents: { get: () => agent }, llm: { stream } }
    host.readProjection = async () => projection
    host.projectionFromSession = () => projection
    host.rowFor = () => ({ session: identity, events: [], replacementEvents: [], condensationEvents: [] })
    host.table = { put: vi.fn() }
    host.snapshotOf = () => ({ revision: projection.revision })
    host.condensationControllers = new Map()
    host.condensationOperations = new Map()
    const result = await host.previewCondensation({ sessionId: identity.id, unitIds: [answer.id], expandRelated: false, baseRevision: projection.revision, operationId: 'replay-condense' })
    expect(result.ok).toBe(true)
    expect(stream).toHaveBeenCalledOnce()
    const change = host.condensationOperations.get('replay-condense').afterChanges[0]
    expect(change.message.content[0]).toEqual(m.content[0])
    expect(change.message.content[1].text).toContain('Preserve the important result.')
    expect(change.message.source.replayState.blocks).toEqual([{ type: 'reasoning', signature: 'test-signature' }, { type: 'text' }])
  })

  it('refuses to reuse a signature after changing a reasoning block', () => {
    expect(() => projectedMessageSource(message(), [{ type: 'reasoning', text: 'changed' }])).toThrow('CONTEXT_EDITOR_REPLAY_BLOCK_CHANGED')
  })
})
