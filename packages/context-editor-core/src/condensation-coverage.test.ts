import { describe, expect, it } from 'vitest'
import { deriveCondensationCoverage } from './condensation.js'

describe('native compaction coverage', () => {
  it('distinguishes no, partial, and full source coverage', () => {
    const none = deriveCondensationCoverage([1, 2], [])
    expect(none.status).toBe('none')
    expect(none.restoreMode).toBe('inline')

    const partial = deriveCondensationCoverage([1, 2], [{
      host: 'deepseek-harness',
      compactionId: 'c1',
      shadowedRootSeqs: [2],
      summarySeq: 10,
      checkpointSeq: 11,
      committed: true,
    }])
    expect(partial.status).toBe('partial')
    expect(partial.restoreMode).toBe('checkpoint')
    expect(partial.coveredSourceRootSeqs).toEqual([2])
    expect(partial.uncoveredSourceRootSeqs).toEqual([1])
    expect(partial.checkpointSeq).toBe(11)

    const full = deriveCondensationCoverage([1, 2], [{
      host: 'deepseek-harness',
      compactionId: 'c1',
      shadowedRootSeqs: [1, 2],
      committed: true,
    }])
    expect(full.status).toBe('full')
    expect(full.restoreMode).toBe('unavailable')
    expect(full.reason).toBe('checkpoint-unavailable')
  })

  it('ignores failed compactions and deduplicates replayed native records', () => {
    const coverage = deriveCondensationCoverage([4], [
      { host: 'deepseek-harness', compactionId: 'failed', shadowedRootSeqs: [4], committed: false },
      { host: 'deepseek-harness', compactionId: 'ok', shadowedRootSeqs: [4], checkpointSeq: 8, committed: true },
      { host: 'deepseek-harness', compactionId: 'ok', shadowedRootSeqs: [4], checkpointSeq: 8, committed: true },
    ])
    expect(coverage.status).toBe('full')
    expect(coverage.nativeCompactions).toHaveLength(1)
    expect(coverage.nativeCompactions[0]?.compactionId).toBe('ok')
  })
})
