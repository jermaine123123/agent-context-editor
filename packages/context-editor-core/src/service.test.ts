import { describe, expect, it } from 'vitest'
import { ContextEditorService } from './service.js'
import type { ContextAtom, ContextEditorSessionAdapter, ContextEditorViewEventV2 } from './index.js'
import { VIEW_EVENT_ENTRY_TYPE } from './state.js'

function makeAtom(partial: Pick<ContextAtom, 'id' | 'sourceRef' | 'kind' | 'turnId' | 'text'> & Partial<ContextAtom>): ContextAtom {
  return {
    timestamp: 1,
    fingerprint: `fp-${partial.id}`,
    approxTokens: 1,
    ...partial,
  }
}

function fixtureAdapter(): ContextEditorSessionAdapter {
  const entries: unknown[] = [
    { id: 'e-user', type: 'message', message: { role: 'user', content: [{ type: 'text', text: '请检查部署状态' }] } },
    { id: 'e-ai', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: '我会先思考部署状态' }] } },
    { id: 'e-tool', type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'shell', arguments: { command: 'status' } }] } },
    { id: 'e-tool-result', type: 'message', message: { role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: '部署正常' }] } },
  ]
  const atoms: ContextAtom[] = [
    makeAtom({ id: 'a-user', sourceRef: { entryId: 'e-user', blockIndex: 0 }, kind: 'user', turnId: 'turn-1', text: '请检查部署状态' }),
    makeAtom({ id: 'a-ai-text', sourceRef: { entryId: 'e-ai', blockIndex: 0 }, kind: 'assistant_text', turnId: 'turn-1', text: '我会先思考部署状态' }),
    makeAtom({ id: 'a-ai-reasoning', sourceRef: { entryId: 'e-ai', blockIndex: 1 }, kind: 'reasoning', turnId: 'turn-1', text: '需要读取工具结果' }),
    makeAtom({ id: 'a-tool-call', sourceRef: { entryId: 'e-tool', blockIndex: 0 }, kind: 'tool_call', turnId: 'turn-1', text: 'status', toolCallId: 'call-1', toolName: 'shell', recordId: 'tool:e-tool:call-1' }),
    makeAtom({ id: 'a-tool-output', sourceRef: { entryId: 'e-tool-result', blockIndex: 0 }, kind: 'tool_output', turnId: 'turn-1', text: '部署正常', toolCallId: 'call-1', toolName: 'shell', recordId: 'tool:e-tool:call-1' }),
  ]
  const adapter: ContextEditorSessionAdapter = {
    read() {
      return {
        entries,
        atoms,
        leafId: 'leaf-1',
        revision: `revision-${entries.length}`,
        revisionProbe: `probe-${entries.length}`,
      }
    },
    appendCustomEntry(customType: typeof VIEW_EVENT_ENTRY_TYPE, data: ContextEditorViewEventV2) {
      const id = `custom-${entries.length}`
      entries.push({ id, type: 'custom', customType, data })
      return id
    },
    isBusy: () => false,
  }
  return adapter
}

describe('ContextEditorService', () => {
  it('searches full record text and applies a hide event with undo', () => {
    const adapter = fixtureAdapter()
    const service = new ContextEditorService()
    const snapshot = service.getSnapshot(adapter)
    expect(snapshot.records.map((record) => record.id)).toEqual([
      'user:e-user',
      'ai:e-ai',
      'tool:e-tool:call-1',
    ])

    const search = service.searchContextRecords(adapter, { query: '部署正常', enabledKinds: ['tool'] })
    expect(search.total).toBe(1)
    expect(search.totalOccurrences).toBe(1)
    const match = service.getContextSearchMatch(adapter, { ...search, index: 0 })
    expect(match).toMatchObject({
      recordId: 'tool:e-tool:call-1',
      unitId: 'tool:e-tool:call-1#tool',
      unitKind: 'tool',
      field: 'tool_output',
      recordKind: 'tool',
      occurrenceCount: 1,
      atomId: 'a-tool-output',
      blockIndex: 0,
    })

    const aiRecord = snapshot.records.find((record) => record.id === 'ai:e-ai')!
    const reasoningUnit = aiRecord.units.find((unit) => unit.kind === 'reasoning')!
    const hidden = service.commitContextView(adapter, {
      baseRevision: snapshot.revision,
      action: 'hide',
      unitIds: [reasoningUnit.id],
    })
    expect(hidden.ok).toBe(true)
    expect(hidden.snapshot.records.find((record) => record.id === 'ai:e-ai')?.viewState).toBe('show')
    expect(hidden.snapshot.records.find((record) => record.id === 'ai:e-ai')?.units.find((unit) => unit.kind === 'reasoning')?.viewState).toBe('hide')
    expect(hidden.snapshot.records.find((record) => record.id === 'ai:e-ai')?.units.find((unit) => unit.kind === 'answer')?.viewState).toBe('show')
    expect(hidden.snapshot.canUndo).toBe(true)

    const undone = service.undoContextView(adapter, { baseRevision: hidden.snapshot.revision })
    expect(undone.ok).toBe(true)
    expect(undone.snapshot.records.find((record) => record.id === 'ai:e-ai')?.units.every((unit) => unit.viewState === 'show')).toBe(true)

    const wholeRecord = service.commitContextView(adapter, {
      baseRevision: undone.snapshot.revision,
      action: 'hide',
      recordIds: ['ai:e-ai'],
    })
    expect(wholeRecord.snapshot.records.find((record) => record.id === 'ai:e-ai')?.units.every((unit) => unit.viewState === 'hide')).toBe(true)
  })

  it('rejects a stale base revision without appending an event', () => {
    const adapter = fixtureAdapter()
    const service = new ContextEditorService()
    const result = service.commitContextView(adapter, { baseRevision: 'stale', action: 'hide', recordIds: ['user:e-user'] })
    expect(result).toMatchObject({ ok: false, conflict: true })
    expect(result.snapshot.records.find((record) => record.id === 'user:e-user')?.viewState).toBe('show')
  })
})
