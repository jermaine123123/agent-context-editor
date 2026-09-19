import { describe, expect, it } from 'vitest'
const indexModule = '../adapters/deepseek-harness/history-index.js'
const { HistoryIndex } = await import(indexModule)
const coreModule = '../adapters/deepseek-harness/core.js'
const { buildProjection, recordSnapshot } = await import(coreModule)
const identity = { id: 'indexed', createdAt: 1 }
const row = { events: [], replacementEvents: [] }
const message = (seq: number, turn: number) => ({ seq, time: seq, type: 'assistant/message', surfaceOp: 'append', data: { turn, message: { id: `m${seq}`, role: 'assistant', source: { kind: 'model', provider: 'mock', model: 'mock' }, content: [{ type: 'text', text: `answer-${seq}` }] } } })
const options = (events: any[]) => ({ activeSurfaceSeqs: events.filter(event => event.surfaceOp === 'append').map(event => event.seq) })
describe('incremental history projection', () => {
  it('matches a complete projection when an existing turn grows and another turn begins', () => {
    const index = new HistoryIndex(), events = [message(0, 1)]
    index.build(identity, events, row, options(events))
    events.push(message(1, 1), message(2, 2))
    const actual = index.build(identity, events, row, options(events))
    const expected = buildProjection(identity, events, row, options(events))
    expect(actual.records.map(recordSnapshot)).toEqual(expected.records.map(recordSnapshot))
    expect(actual.revision).toEqual(expected.revision)
    expect(index.stats).toEqual({ fullBuilds: 1, tailEvents: 2 })
    expect(index.build(identity, events, row, options(events))).toBe(actual)
  })
  it('rebuilds on surface replacement or session lifecycle reuse', () => {
    const index = new HistoryIndex(), events: any[] = [message(0, 1)]
    index.build(identity, events, row, options(events))
    events.push({ ...message(1, 2), surfaceOp: { type: 'replace', start: 0, end: 0 } })
    index.build(identity, events, row, { activeSurfaceSeqs: [1] })
    index.build({ ...identity, createdAt: 2 }, events, row, { activeSurfaceSeqs: [1] })
    expect(index.stats.fullBuilds).toBe(3)
  })
  it('indexes 100000 events once and projects only the appended tail on subsequent pages', () => {
    const index = new HistoryIndex()
    const events: any[] = Array.from({ length: 100000 }, (_, seq) => seq % 10 === 0 ? message(seq, seq) : ({ seq, time: seq, type: 'diagnostic/log', data: {} }))
    const initial = index.build(identity, events, row, options(events))
    expect(initial.records).toHaveLength(10000)
    events.push(message(100000, 100000))
    const next = index.build(identity, events, row, options(events))
    expect(next.records).toHaveLength(10001)
    expect(next.recordIndex.get(next.records.at(-1).id)).toBe(10000)
    for (let page = 0; page < 10; page++) expect(index.build(identity, events, row, options(events))).toBe(next)
    expect(index.stats).toEqual({ fullBuilds: 1, tailEvents: 1 })
  }, 20000)
})
