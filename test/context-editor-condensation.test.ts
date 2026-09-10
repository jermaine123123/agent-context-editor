import { describe, expect, it } from 'vitest'
import {
  frameCondensationSummary,
  normalizeSessionEvents,
  projectRecords,
  selectCondensationRange,
  validateCondensationSummary,
} from '../adapters/deepseek-harness/core.js'

const session = { id: 'condense-session', createdAt: 1, cwd: 'D:/workspace' }
function event(seq: number, type: string, data: unknown) {
  return { seq, time: seq + 1, type, data }
}

describe('shared condensation contract', () => {
  it('expands a selected answer to its reasoning and paired tool records', () => {
    const events = [
      event(0, 'user/message', { role: 'user', content: [{ type: 'text', text: 'inspect the file and report' }] }),
      event(1, 'assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'need to read first' }] } }),
      event(2, 'assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'I will read it' }, { type: 'tool-call', id: 'call-1', name: 'read', arguments: '{"path":"a.txt"}' }] } }),
      event(3, 'tool/result', { turn: 1, message: { role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [{ type: 'text', text: 'read succeeded: important facts' }] } }),
      event(4, 'assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'the task is complete' }] } }),
    ]
    const normalized = normalizeSessionEvents(session, events)
    const records = projectRecords(normalized.atoms)
    const answer = records.find(record => record.kind === 'ai')!.units.find(unit => unit.kind === 'answer')!
    const exact = selectCondensationRange(records, [answer.id])
    expect(exact.effectiveUnitIds).toEqual([answer.id])
    expect(exact.autoExpandedUnitIds).toEqual([])
    const range = selectCondensationRange(records, [answer.id], undefined, { expandRelated: true })
    expect(range.requestedUnitIds).toEqual([answer.id])
    expect(range.autoExpandedUnitIds).toContain(records.find(record => record.kind === 'ai')!.units.find(unit => unit.kind === 'reasoning')!.id)
    expect(range.effectiveUnitIds.some(id => id.startsWith('tool:'))).toBe(true)
    expect(range.sourceRootSeqs).toEqual([1, 2, 3, 4])
  })

  it('rejects empty, truncated, and non-shorter summaries while warning on small savings', () => {
    expect(validateCondensationSummary('', 100).error).toBe('empty-summary')
    expect(validateCondensationSummary('short', 100, { truncated: true }).error).toBe('truncated-summary')
    expect(validateCondensationSummary('x'.repeat(500), 100).error).toBe('not-smaller')
    const warning = validateCondensationSummary('x'.repeat(20), 100)
    expect(warning.ok).toBe(true)
    expect(warning.metrics.belowRecommendedThreshold).toBe(true)
    expect(warning.warnings.length).toBeGreaterThan(0)
  })

  it('frames summaries with a stable persisted marker', () => {
    expect(frameCondensationSummary('goal and result')).toBe('<condensed-context>\ngoal and result\n</condensed-context>')
  })
})
