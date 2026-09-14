import { describe, expect, it } from 'vitest'
import { deriveCondensationCoverage } from './condensation.js'

describe('Pi entry-id native compaction coverage', () => {
  it('tracks partial and full coverage without coercing opaque IDs to numbers', () => {
    const partial = deriveCondensationCoverage(['entry-a', 'entry-b', 'entry-c'], [{
      host: 'pi',
      compactionId: 'compact-1',
      shadowedRootSeqs: [],
      shadowedEntryIds: ['entry-a', 'entry-b'],
      checkpointEntryId: 'before-compact',
      committed: true,
    }])
    expect(partial.status).toBe('partial')
    expect(partial.restoreMode).toBe('checkpoint')
    expect(partial.coveredSourceEntryIds).toEqual(['entry-a', 'entry-b'])
    expect(partial.uncoveredSourceEntryIds).toEqual(['entry-c'])
    expect(partial.coveredSourceRootSeqs).toEqual([])
    expect(partial.checkpointEntryId).toBe('before-compact')

    const full = deriveCondensationCoverage(['entry-a', 'entry-b'], [{
      host: 'pi',
      compactionId: 'compact-2',
      shadowedRootSeqs: [],
      shadowedEntryIds: ['entry-a', 'entry-b'],
      checkpointEntryId: 'before-compact',
      committed: true,
    }])
    expect(full.status).toBe('full')
    expect(full.restoreMode).toBe('checkpoint')
  })

  it('treats an uncommitted Pi preparation as unavailable evidence', () => {
    const pending = deriveCondensationCoverage(['entry-a'], [{
      host: 'pi',
      compactionId: 'pending-1',
      shadowedRootSeqs: [],
      shadowedEntryIds: ['entry-a'],
      checkpointEntryId: 'before-compact',
      committed: false,
    }])
    expect(pending.status).toBe('none')
    expect(pending.restoreMode).toBe('unavailable')
    expect(pending.coveredSourceEntryIds).toEqual([])
  })

  it('deduplicates repeated events, isolates other branches, and keeps the earliest recoverable checkpoint across rounds', () => {
    const coverage = deriveCondensationCoverage(['branch-a', 'branch-b', 'branch-c'], [
      {
        host: 'pi',
        compactionId: 'round-1',
        shadowedRootSeqs: [],
        shadowedEntryIds: ['branch-a', 'branch-a'],
        checkpointEntryId: 'checkpoint-before-round-1',
        committed: true,
      },
      {
        host: 'pi',
        compactionId: 'round-2',
        shadowedRootSeqs: [],
        shadowedEntryIds: ['branch-b'],
        checkpointEntryId: 'checkpoint-after-round-1',
        committed: true,
      },
      {
        host: 'pi',
        compactionId: 'other-branch',
        shadowedRootSeqs: [],
        shadowedEntryIds: ['other-a'],
        checkpointEntryId: 'other-checkpoint',
        committed: true,
      },
      {
        host: 'pi',
        compactionId: 'round-1',
        shadowedRootSeqs: [],
        shadowedEntryIds: ['branch-a'],
        checkpointEntryId: 'checkpoint-before-round-1',
        committed: true,
      },
    ])
    expect(coverage.status).toBe('partial')
    expect(coverage.coveredSourceEntryIds).toEqual(['branch-a', 'branch-b'])
    expect(coverage.uncoveredSourceEntryIds).toEqual(['branch-c'])
    expect(coverage.nativeCompactions).toHaveLength(2)
    expect(coverage.checkpointEntryId).toBe('checkpoint-before-round-1')
  })})