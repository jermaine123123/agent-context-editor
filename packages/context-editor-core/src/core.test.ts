import { describe, expect, it } from 'vitest'
import {
  atomId,
  legacyAtomId,
  projectRecords,
  readViewEvents,
  reduceViewStates,
  atomViewState,
  searchOccurrences,
  searchRecords,
  type ContextAtom,
  type ContextEditorViewEventV2,
} from './index.js'

function atom(partial: Partial<ContextAtom> & Pick<ContextAtom, 'kind' | 'text' | 'sourceRef'>): ContextAtom {
  const base = {
    id: '',
    turnId: 'turn-1',
    timestamp: 1,
    fingerprint: `${partial.kind}-${partial.sourceRef.entryId}-${partial.sourceRef.blockIndex}`,
    approxTokens: 1,
    ...partial,
  } as ContextAtom
  base.id = atomId(base)
  return base
}

describe('context editor core', () => {
  it('groups assistant parts and paired tool atoms into visible records', () => {
    const assistantText = atom({ kind: 'assistant_text', text: 'hello', sourceRef: { entryId: 'a1', blockIndex: 0 } })
    const thinking = atom({ kind: 'reasoning', text: 'why', sourceRef: { entryId: 'a1', blockIndex: 1 } })
    const call = atom({ kind: 'tool_call', text: 'read {}', toolCallId: 'c1', recordId: 'tool:a1:c1', sourceRef: { entryId: 'a1', blockIndex: 2 } })
    const output = atom({ kind: 'tool_output', text: 'file', toolCallId: 'c1', recordId: 'tool:a1:c1', sourceRef: { entryId: 'r1', blockIndex: 0 } })
    const records = projectRecords([assistantText, thinking, call, output])
    expect(records.map((record) => [record.kind, record.atomIds.length])).toEqual([
      ['ai', 2],
      ['tool', 2],
    ])
    expect(records[0]?.units.map((unit) => unit.kind)).toEqual(['answer', 'reasoning'])
  })

  it('groups assistant entries from the same user turn into one AI record', () => {
    const first = atom({
      kind: 'reasoning',
      text: 'inspect first',
      sourceRef: { entryId: 'a1', blockIndex: 0 },
      turnId: 'u1',
    })
    const second = atom({
      kind: 'assistant_text',
      text: 'the answer',
      sourceRef: { entryId: 'a2', blockIndex: 0 },
      turnId: 'u1',
    })
    const nextTurn = atom({
      kind: 'assistant_text',
      text: 'another answer',
      sourceRef: { entryId: 'a3', blockIndex: 0 },
      turnId: 'u2',
    })

    const records = projectRecords([first, second, nextTurn])
    expect(records.map((record) => record.id)).toEqual(['ai:a1', 'ai:a3'])
    expect(records[0]?.entryIds).toEqual(['a1', 'a2'])
    expect(records[0]?.atomIds).toEqual([first.id, second.id])
    expect(searchRecords(records, 'answer', new Set(['ai']))[0]?.anchorEntryId).toBe('a2')
    expect(records[0]?.units.map((unit) => unit.id)).toEqual(['ai:a1#reasoning', 'ai:a1#answer'])
  })

  it('only hides a record when all constituent atoms are hidden', () => {
    const first = atom({ kind: 'assistant_text', text: 'a', sourceRef: { entryId: 'a1', blockIndex: 0 } })
    const second = atom({ kind: 'reasoning', text: 'b', sourceRef: { entryId: 'a1', blockIndex: 1 } })
    const states = new Map([[first.id, 'hide' as const]])
    expect(projectRecords([first, second], states)[0]?.viewState).toBe('show')
    states.set(second.id, 'hide')
    expect(projectRecords([first, second], states)[0]?.viewState).toBe('hide')
  })

  it('projects partial unit visibility without exposing a false all-hidden state', () => {
    const first = atom({ kind: 'reasoning', text: 'a', sourceRef: { entryId: 'a1', blockIndex: 0 } })
    const second = atom({ kind: 'reasoning', text: 'b', sourceRef: { entryId: 'a1', blockIndex: 1 } })
    const states = new Map([[first.id, 'hide' as const]])
    expect(projectRecords([first, second], states)[0]?.units[0]?.viewState).toBe('mixed')
  })

  it('searches selected record kinds and aggregates occurrences by record', () => {
    const user = atom({ kind: 'user', text: 'Keep this phrase phrase', sourceRef: { entryId: 'u1', blockIndex: 0 } })
    const tool = atom({ kind: 'tool_output', text: 'phrase', recordId: 'tool:r1:c1', sourceRef: { entryId: 'r1', blockIndex: 0 } })
    const records = projectRecords([user, tool])
    const matches = searchRecords(records, 'PHRASE', new Set(['user']))
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      recordId: 'user:u1',
      recordKind: 'user',
      atomId: user.id,
      blockIndex: 0,
      occurrenceCount: 2,
      total: 1,
    })
  })

  it('keeps separate records as separate navigation results', () => {
    const first = atom({ kind: 'user', text: 'phrase', sourceRef: { entryId: 'u1', blockIndex: 0 } })
    const second = atom({ kind: 'user', text: 'phrase phrase', sourceRef: { entryId: 'u2', blockIndex: 0 } })
    const matches = searchRecords(projectRecords([first, second]), 'phrase', new Set(['user']))
    expect(matches).toHaveLength(2)
    expect(matches.map((match) => match.recordId)).toEqual(['user:u1', 'user:u2'])
    expect(matches.map((match) => match.occurrenceCount)).toEqual([1, 2])
    expect(matches.every((match) => match.total === 2)).toBe(true)
  })

  it('keeps tool name and arguments as separate searchable fields', () => {
    const tool = atom({
      kind: 'tool_call',
      text: '{"path":"src/app.ts"}',
      toolName: 'read',
      recordId: 'tool:a1:c1',
      sourceRef: { entryId: 'a1', blockIndex: 0 },
    })
    const records = projectRecords([tool])
    expect(searchRecords(records, 'read', new Set(['tool']), 'all')[0]?.field).toBe('tool_name')
    expect(searchRecords(records, 'app.ts', new Set(['tool']), 'all')[0]?.field).toBe('tool_args')
  })

  it('returns every text occurrence in stable atom and field order', () => {
    const first = atom({
      kind: 'assistant_text',
      text: 'needle once needle',
      sourceRef: { entryId: 'a-occ', blockIndex: 0 },
    })
    const second = atom({
      kind: 'reasoning',
      text: 'needle again',
      sourceRef: { entryId: 'a-occ', blockIndex: 1 },
    })
    const records = projectRecords([first, second])
    const occurrences = searchOccurrences(records, 'NEEDLE', new Set(['ai']), 'all')
    expect(occurrences.map((occurrence) => [occurrence.atomId, occurrence.start, occurrence.field])).toEqual([
      [first.id, 0, 'message'],
      [first.id, 12, 'message'],
      [second.id, 0, 'reasoning'],
    ])
    expect(searchRecords(records, 'needle', new Set(['ai']), 'all').reduce((sum, match) => sum + match.occurrenceCount, 0)).toBe(3)
  })

  it('defaults to dialogue atoms and expands to reasoning/tools only in full scope', () => {
    const answer = atom({ kind: 'assistant_text', text: 'dialogue needle', sourceRef: { entryId: 'scope-a', blockIndex: 0 } })
    const reasoning = atom({ kind: 'reasoning', text: 'reasoning needle', sourceRef: { entryId: 'scope-a', blockIndex: 1 } })
    const tool = atom({ kind: 'tool_output', text: 'tool needle', recordId: 'tool:scope:c1', toolCallId: 'c1', sourceRef: { entryId: 'scope-tool', blockIndex: 0 } })
    const records = projectRecords([answer, reasoning, tool])
    const dialogue = searchOccurrences(records, 'needle', new Set(['ai', 'tool']))
    expect(dialogue.map((occurrence) => occurrence.unitKind)).toEqual(['answer'])
    const all = searchOccurrences(records, 'needle', new Set(['ai', 'tool']), 'all')
    expect(all.map((occurrence) => occurrence.unitKind)).toEqual(['answer', 'reasoning', 'tool'])
  })

  it('replays valid V2 view events and ignores malformed events', () => {
    const atomValue = atom({ kind: 'user', text: 'x', sourceRef: { entryId: 'u1', blockIndex: 0 }, fingerprint: 'fp' })
    const event: ContextEditorViewEventV2 = {
      version: 2,
      transactionId: 'tx-1',
      createdAt: new Date().toISOString(),
      baseRevision: 'r1',
      action: 'hide',
      changes: [{ atomId: atomValue.id, fingerprint: 'fp', before: 'show', after: 'hide' }],
    }
    const entries = [
      { type: 'custom', customType: 'context-editor-view-event-v2', data: event },
      { type: 'custom', customType: 'context-editor-view-event-v2', data: { version: 2 } },
    ]
    expect(readViewEvents(entries)).toHaveLength(1)
    expect(reduceViewStates([atomValue], undefined, readViewEvents(entries)).get(atomValue.id)).toBe('hide')
  })

  it('keeps atom identity stable while fingerprints detect changed content', () => {
    const original = atom({ kind: 'user', text: 'before', fingerprint: 'fp-before', sourceRef: { entryId: 'u2', blockIndex: 0 } })
    const changed = atom({ kind: 'user', text: 'after', fingerprint: 'fp-after', sourceRef: original.sourceRef })
    expect(changed.id).toBe(original.id)
    expect(legacyAtomId(changed)).not.toBe(legacyAtomId(original))
  })

  it('reads legacy V1 state but fails open on a fingerprint conflict', () => {
    const original = atom({ kind: 'user', text: 'before', fingerprint: 'fp-before', sourceRef: { entryId: 'u3', blockIndex: 0 } })
    const changed = atom({ kind: 'user', text: 'after', fingerprint: 'fp-after', sourceRef: original.sourceRef })
    const legacy = {
      version: 1 as const,
      updatedAt: new Date().toISOString(),
      items: { [legacyAtomId(original)]: { fingerprint: original.fingerprint, viewState: 'hide' as const, contextState: 'keep' as const } },
    }
    expect(atomViewState(legacy, [], original)).toBe('hide')
    expect(atomViewState(legacy, [], changed)).toBe('show')
  })
})
