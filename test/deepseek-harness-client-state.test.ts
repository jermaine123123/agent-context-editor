import { describe, expect, it } from 'vitest'
import {
  CLIENT_KINDS,
  CLIENT_UNIT_KINDS,
  computeCenteredScrollTop,
  migrateEnabledKindsToUnits,
  nextSearchIndex,
  normalizeEnabledKinds,
  normalizeEnabledUnitKinds,
  toggleEnabledKind,
  toggleEnabledUnitKind,
} from '../adapters/deepseek-harness/client-state.js'

describe('DeepSeek Harness client state', () => {
  it('preserves an explicit empty type filter', () => {
    expect(normalizeEnabledKinds([])).toEqual([])
    expect(normalizeEnabledKinds(undefined)).toEqual([...CLIENT_KINDS])
    expect(normalizeEnabledKinds(['ai', 'unknown', 'ai'])).toEqual(['ai'])
  })

  it('allows toggling the last enabled type off', () => {
    expect(toggleEnabledKind(['user'], 'user')).toEqual([])
    expect(toggleEnabledKind([], 'tool')).toEqual(['tool'])
  })

  it('migrates V1 AI filters into independent reasoning and answer units', () => {
    expect(migrateEnabledKindsToUnits(['user', 'ai', 'tool'])).toEqual([...CLIENT_UNIT_KINDS])
    expect(migrateEnabledKindsToUnits([])).toEqual([])
    expect(migrateEnabledKindsToUnits(['ai', 'unknown', 'ai'])).toEqual(['reasoning', 'answer'])
  })

  it('normalizes and toggles unit filters without losing the empty state', () => {
    expect(normalizeEnabledUnitKinds(undefined)).toEqual([...CLIENT_UNIT_KINDS])
    expect(normalizeEnabledUnitKinds([])).toEqual([])
    expect(normalizeEnabledUnitKinds(['answer', 'answer', 'unknown'])).toEqual(['answer'])
    expect(toggleEnabledUnitKind(['reasoning', 'answer'], 'reasoning')).toEqual(['answer'])
    expect(toggleEnabledUnitKind([], 'answer')).toEqual(['answer'])
  })

  it('wraps search navigation indexes and handles empty results', () => {
    expect(nextSearchIndex(0, -1, 3)).toBe(2)
    expect(nextSearchIndex(2, 1, 3)).toBe(0)
    expect(nextSearchIndex(0, 1, 0)).toBe(0)
  })

  it('centers a match in the usable viewport below sticky controls', () => {
    expect(computeCenteredScrollTop({
      currentScrollTop: 100,
      scrollHeight: 3000,
      clientHeight: 600,
      containerTop: 0,
      containerBottom: 600,
      controlsBottom: 120,
      targetTop: 1200,
      targetBottom: 1240,
    })).toBe(960)
  })

  it('clamps first and last matches to the scroll range', () => {
    const input = {
      currentScrollTop: 500,
      scrollHeight: 3000,
      clientHeight: 600,
      containerTop: 0,
      containerBottom: 600,
      controlsBottom: 120,
    }
    expect(computeCenteredScrollTop({ ...input, targetTop: -400, targetBottom: -360 })).toBe(0)
    expect(computeCenteredScrollTop({ ...input, targetTop: 2900, targetBottom: 2940 })).toBe(2400)
  })

  it('does not invent a scroll for content shorter than the viewport', () => {
    expect(computeCenteredScrollTop({
      currentScrollTop: 12,
      scrollHeight: 500,
      clientHeight: 600,
      containerTop: 0,
      containerBottom: 600,
      controlsBottom: 120,
      targetTop: 240,
      targetBottom: 280,
    })).toBe(0)
  })

  it('handles a wrapped control area by using its measured bottom edge', () => {
    const shortControls = computeCenteredScrollTop({
      currentScrollTop: 100,
      scrollHeight: 3000,
      clientHeight: 600,
      containerTop: 0,
      containerBottom: 600,
      controlsBottom: 90,
      targetTop: 1200,
      targetBottom: 1240,
    })
    const wrappedControls = computeCenteredScrollTop({
      currentScrollTop: 100,
      scrollHeight: 3000,
      clientHeight: 600,
      containerTop: 0,
      containerBottom: 600,
      controlsBottom: 180,
      targetTop: 1200,
      targetBottom: 1240,
    })
    expect(wrappedControls).toBeLessThan(shortControls)
  })
})
