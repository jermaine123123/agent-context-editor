import { describe, expect, it } from 'vitest'
import type { ContextEditorPageCall } from '../adapters/deepseek-harness/client-state.js'
import { loadContextRecord, loadContextRecordsThrough, loadInitialContextRecords } from '../adapters/deepseek-harness/client-state.js'

describe('DeepSeek client history paging', () => {
  it('loads one initial page and jumps directly to a search result in a 100,000-record history', async () => {
    const records = Array.from({ length: 100_000 }, (_, index) => ({ id: `record-${index}` }))
    let pageCalls = 0
    let recordCalls = 0
    const call: ContextEditorPageCall<{ id: string; historyIndex?: number }> = async (method, payload) => {
      if (method === 'getSnapshot') {
        expect(payload.includeRecords).toBe(false)
        return { revision: 'history-r1', recordsIncluded: false, records: [], recordCount: records.length }
      }
      if (method === 'getRecord') {
        recordCalls += 1
        return { revision: 'history-r1', record: records[99_999], recordIndex: 99_999, total: records.length }
      }
      expect(method).toBe('listRecords')
      pageCalls += 1
      const cursor = Number(payload.cursor ?? 0)
      const pageSize = Number(payload.pageSize ?? 0)
      const page = records.slice(cursor, cursor + pageSize)
      return {
        revision: 'history-r1',
        records: page,
        total: records.length,
        nextCursor: cursor + page.length < records.length ? String(cursor + page.length) : null,
      }
    }

    const initial = await loadInitialContextRecords<{ id: string; historyIndex?: number }>(call)
    expect(initial.records).toHaveLength(100)
    expect(initial.nextCursor).toBe('100')
    expect(initial.total).toBe(100_000)
    expect(pageCalls).toBe(1)
    expect(initial.records.at(-1)?.historyIndex).toBe(99)

    const located = await loadContextRecord<{ id: string; historyIndex?: number }>(call, 'record-99999', initial.snapshot.revision)
    expect(located?.found).toBe(true)
    expect(located?.record?.id).toBe('record-99999')
    expect(located?.record?.historyIndex).toBe(99_999)
    expect(located?.total).toBe(100_000)
    expect(recordCalls).toBe(1)
    expect(pageCalls).toBe(1)
  })

  it('retains sequential paging as a fallback for hosts without indexed record lookup', async () => {
    const records = Array.from({ length: 250 }, (_, index) => ({ id: `legacy-${index}` }))
    let pageCalls = 0
    const call: ContextEditorPageCall<{ id: string }> = async (method, payload) => {
      if (method === 'getRecord') return { revision: 'legacy-pages-r1', record: records[150] }
      expect(method).toBe('listRecords')
      pageCalls += 1
      const cursor = Number(payload.cursor ?? 0)
      const pageSize = Number(payload.pageSize ?? 0)
      const page = records.slice(cursor, cursor + pageSize)
      return { revision: 'legacy-pages-r1', records: page, total: records.length, nextCursor: cursor + page.length < records.length ? String(cursor + page.length) : null }
    }
    const direct = await loadContextRecord<{ id: string }>(call, 'legacy-150', 'legacy-pages-r1')
    expect(direct).toBeNull()
    const located = await loadContextRecordsThrough<{ id: string }>(call, 'legacy-150', '100', 'legacy-pages-r1', records.slice(0, 100))
    expect(located.found).toBe(true)
    expect(located.records.some(record => record.id === 'legacy-150')).toBe(true)
    expect(pageCalls).toBe(1)
  })

  it('keeps the full-snapshot fallback for older client/host pairings', async () => {
    const existing = [{ id: 'legacy-1' }, { id: 'legacy-2' }]
    let listCalls = 0
    const call: ContextEditorPageCall<{ id: string }> = async method => {
      if (method === 'getSnapshot') return { revision: 'legacy-r1', records: existing }
      listCalls += 1
      throw new Error('unexpected listRecords call')
    }
    const loaded = await loadInitialContextRecords<{ id: string }>(call)
    expect(loaded.records).toEqual(existing)
    expect(loaded.nextCursor).toBeNull()
    expect(listCalls).toBe(0)
  })
})
