import { describe, expect, it } from 'vitest'
import {
  normalizeContextEditorPrefs,
  recordKindsForUnitKinds,
} from './prefs.js'

describe('context editor preferences', () => {
  it('preserves an explicit empty unit filter', () => {
    expect(normalizeContextEditorPrefs({ enabledUnitKinds: [], showHidden: false })).toEqual({
      version: 3,
      enabledUnitKinds: [],
      showHidden: false,
    })
  })

  it('migrates legacy AI filters into reasoning and answer units', () => {
    expect(normalizeContextEditorPrefs({ version: 2, enabledKinds: ['ai'], showHidden: true })).toEqual({
      version: 3,
      enabledUnitKinds: ['reasoning', 'answer'],
      showHidden: true,
    })
    expect(normalizeContextEditorPrefs({ version: 2, enabledKinds: [], showHidden: false })).toEqual({
      version: 3,
      enabledUnitKinds: [],
      showHidden: false,
    })
  })

  it('defaults malformed values and de-duplicates known unit kinds', () => {
    expect(normalizeContextEditorPrefs({ enabledUnitKinds: ['answer', 'unknown', 'answer'], showHidden: true })).toEqual({
      version: 3,
      enabledUnitKinds: ['answer'],
      showHidden: true,
    })
    expect(normalizeContextEditorPrefs({ showHidden: true })).toEqual({
      version: 3,
      enabledUnitKinds: ['user', 'reasoning', 'answer', 'tool'],
      showHidden: false,
    })
  })

  it('derives record containers without losing partial AI filters', () => {
    expect(recordKindsForUnitKinds(['reasoning'])).toEqual(['ai'])
    expect(recordKindsForUnitKinds(['answer', 'tool'])).toEqual(['ai', 'tool'])
    expect(recordKindsForUnitKinds([])).toEqual([])
  })
})
