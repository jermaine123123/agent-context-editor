import { describe, expect, it } from 'vitest'
import {
  buildProjection,
  buildViewEvent,
  inverseChanges,
  latestUndoableEvent,
  normalizeSessionEvents,
  projectRecords,
  reduceViewStates,
  searchRecords,
} from '../adapters/deepseek-harness/core.js'

const session = { id: 'deepseek-session', createdAt: 42, cwd: 'D:/workspace' }

function event(seq: number, type: string, data: unknown, time = seq + 1) {
  return { seq, time, type, data }
}

describe('DeepSeek Harness Context Editor core', () => {
  it('aggregates reasoning and answer blocks by turn and pairs tool call/result by callId', () => {
    const events = [
      event(0, 'user/message', { role: 'user', content: [{ type: 'text', text: '请检查文件' }] }),
      event(1, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'reasoning', text: '先读取' }] },
      }),
      event(2, 'assistant/message', {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: '我来读取' }, { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a"}' }],
        },
      }),
      event(3, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'read', arguments: '{"path":"a"}' }),
      event(4, 'tool/result', {
        turn: 1,
        step: 1,
        message: { role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: '内容' }], isError: false }] },
      }),
      event(5, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', text: '未完成' } }),
      event(6, 'summary', { text: '不应出现' }),
    ]
    const normalized = normalizeSessionEvents(session, events)
    const records = projectRecords(normalized.atoms, new Map())
    expect(records.map(record => record.kind)).toEqual(['user', 'ai', 'tool'])
    expect(records[1]?.atoms.map(atom => atom.kind)).toEqual(['reasoning', 'assistant_text'])
    expect(records[1]?.units.map(unit => unit.kind)).toEqual(['reasoning', 'answer'])
    expect(records[1]?.units.map(unit => unit.id)).toEqual([
      `${records[1]!.id}#reasoning`,
      `${records[1]!.id}#answer`,
    ])
    expect(records[2]?.atoms.map(atom => atom.kind)).toEqual(['tool_call', 'tool_call', 'tool_output'])
    expect(records[2]?.toolCallId).toBe('call-1')
    expect(records.some(record => record.searchableText.includes('未完成'))).toBe(false)
  })

  it('keeps IDs stable across re-projection and changes them across session lifecycles', () => {
    const events = [event(0, 'user/message', { content: [{ type: 'text', text: 'same' }] })]
    const first = normalizeSessionEvents(session, events).atoms
    const second = normalizeSessionEvents({ ...session }, events).atoms
    const other = normalizeSessionEvents({ ...session, createdAt: 43 }, events).atoms
    expect(first[0]?.id).toBe(second[0]?.id)
    expect(first[0]?.id).not.toBe(other[0]?.id)
  })

  it('searches Unicode literals and reports record/occurrence totals', () => {
    const atoms = normalizeSessionEvents(session, [
      event(0, 'user/message', { content: [{ type: 'text', text: '部署 部署 完成' }] }),
    ]).atoms
    const records = projectRecords(atoms)
    const matches = searchRecords(records, '部署', ['user'])
    expect(matches).toHaveLength(1)
    expect(matches[0]?.occurrenceCount).toBe(2)
    expect(matches[0]?.total).toBe(1)
  })

  it('defaults to dialogue scope and exposes reasoning/tools only in full scope', () => {
    const normalized = normalizeSessionEvents(session, [
      event(0, 'assistant/message', { turn: 1, message: { content: [
        { type: 'reasoning', text: 'scope needle reasoning' },
        { type: 'text', text: 'scope needle answer' },
        { type: 'tool-call', id: 'scope-call', name: 'scope-tool', arguments: 'scope needle args' },
      ] } }),
      event(1, 'tool/result', { turn: 1, message: { source: { kind: 'tool', callId: 'scope-call' }, content: [{ type: 'text', text: 'scope needle output' }] } }),
    ])
    const records = projectRecords(normalized.atoms)
    expect(searchRecords(records, 'needle', ['ai', 'tool']).map(match => match.unitKind)).toEqual(['answer'])
    expect(searchRecords(records, 'needle', ['ai', 'tool'], 'all').map(match => match.unitKind)).toEqual(['reasoning', 'answer', 'tool'])
  })

  it('intersects record and unit filters for dialogue and full searches', () => {
    const normalized = normalizeSessionEvents(session, [
      event(0, 'user/message', { content: [{ type: 'text', text: 'unit-filter needle user' }] }),
      event(1, 'assistant/message', { turn: 1, message: { content: [
        { type: 'reasoning', text: 'unit-filter needle reasoning' },
        { type: 'text', text: 'unit-filter needle answer' },
        { type: 'tool-call', id: 'unit-filter-call', name: 'unit-filter-tool', arguments: 'unit-filter needle args' },
      ] } }),
      event(2, 'tool/result', { turn: 1, message: { source: { kind: 'tool', callId: 'unit-filter-call' }, content: [{ type: 'text', text: 'unit-filter needle output' }] } }),
    ])
    const records = projectRecords(normalized.atoms)
    const enabled = ['user', 'ai', 'tool']
    expect(searchRecords(records, 'needle', enabled, 'all', new Set(['answer']))).toEqual([
      expect.objectContaining({ unitKind: 'answer', occurrenceCount: 1 }),
    ])
    expect(searchRecords(records, 'needle', enabled, 'all', new Set(['reasoning', 'tool']))
      .map(match => match.unitKind)).toEqual(['reasoning', 'tool'])
    expect(searchRecords(records, 'needle', enabled, 'dialogue', new Set(['user', 'reasoning', 'answer', 'tool']))
      .map(match => match.unitKind)).toEqual(['user', 'answer'])
    expect(searchRecords(records, 'needle', ['ai'], 'all', new Set(['tool']))).toEqual([])
  })

  it('replays hide, restore and continuous undo events with fingerprints', () => {
    const atoms = normalizeSessionEvents(session, [
      event(0, 'user/message', { content: [{ type: 'text', text: 'one' }] }),
      event(1, 'user/message', { content: [{ type: 'text', text: 'two' }] }),
    ]).atoms
    const initial = projectRecords(atoms)
    const first = buildViewEvent({
      identity: session,
      sourceRevision: 1,
      events: [],
      records: initial,
      states: reduceViewStates(atoms, []),
      action: 'hide',
      recordIds: [initial[0]!.id],
      transactionId: 'tx-1',
    })
    const afterHide = buildProjection(session, [
      event(0, 'user/message', { content: [{ type: 'text', text: 'one' }] }),
      event(1, 'user/message', { content: [{ type: 'text', text: 'two' }] }),
    ], { session: { createdAt: 42, cwd: 'D:/workspace' }, schemaVersion: 1, storageVersion: 1, events: [first] })
    expect(afterHide.records[0]?.viewState).toBe('hide')
    const undo = { ...first, action: 'undo' as const, transactionId: 'tx-2', undoOf: first.transactionId, changes: inverseChanges(first) }
    expect(latestUndoableEvent([first, undo])).toBeUndefined()
    const afterUndo = buildProjection(session, [
      event(0, 'user/message', { content: [{ type: 'text', text: 'one' }] }),
      event(1, 'user/message', { content: [{ type: 'text', text: 'two' }] }),
    ], { session: { createdAt: 42, cwd: 'D:/workspace' }, schemaVersion: 1, storageVersion: 1, events: [first, undo] })
    expect(afterUndo.records.every(record => record.viewState === 'show')).toBe(true)
  })

  it('hides reasoning and answer units independently while preserving old record selectors', () => {
    const events = [
      event(0, 'assistant/message', { turn: 1, message: { content: [{ type: 'reasoning', text: 'think' }] } }),
      event(1, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: 'answer' }] } }),
    ]
    const normalized = normalizeSessionEvents(session, events)
    const initial = projectRecords(normalized.atoms)
    const ai = initial[0]!
    const hiddenReasoning = buildViewEvent({
      identity: session,
      sourceRevision: normalized.sourceRevision,
      events: [],
      records: initial,
      states: reduceViewStates(normalized.atoms, []),
      action: 'hide',
      unitIds: [ai.units.find(unit => unit.kind === 'reasoning')!.id],
      transactionId: 'reasoning-only',
    })
    const afterReasoning = buildProjection(session, events, { events: [hiddenReasoning] })
    expect(afterReasoning.records[0]?.units.map(unit => [unit.kind, unit.viewState])).toEqual([
      ['reasoning', 'hide'],
      ['answer', 'show'],
    ])

    const hiddenRecord = buildViewEvent({
      identity: session,
      sourceRevision: normalized.sourceRevision,
      events: [hiddenReasoning],
      records: afterReasoning.records,
      states: afterReasoning.states,
      action: 'hide',
      recordIds: [ai.id],
      transactionId: 'record-selector',
    })
    const afterRecord = buildProjection(session, events, { events: [hiddenReasoning, hiddenRecord] })
    expect(afterRecord.records[0]?.units.every(unit => unit.viewState === 'hide')).toBe(true)
  })

  it('reports search matches per editable unit and marks mixed state safely', () => {
    const events = [
      event(0, 'assistant/message', { turn: 1, message: { content: [{ type: 'reasoning', text: '部署思考' }, { type: 'reasoning', text: '部署补充' }] } }),
      event(1, 'assistant/message', { turn: 1, message: { content: [{ type: 'text', text: '部署完成' }] } }),
    ]
    const normalized = normalizeSessionEvents(session, events)
    const initial = projectRecords(normalized.atoms)
    const reasoning = initial[0]!.units.find(unit => unit.kind === 'reasoning')!
    const states = new Map([[reasoning.atomIds[0]!, 'hide']])
    const projected = projectRecords(normalized.atoms, states)
    expect(projected[0]?.units.find(unit => unit.kind === 'reasoning')?.viewState).toBe('mixed')
    const matches = searchRecords(projected, '部署', ['ai'], 'all')
    expect(matches.map(match => match.unitKind)).toEqual(['reasoning', 'answer'])
    expect(matches.map(match => match.occurrenceCount)).toEqual([2, 1])
  })
})
