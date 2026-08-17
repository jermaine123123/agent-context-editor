import { describe, expect, it } from 'vitest'
import { normalizeContextEditorPrefs } from './prefs.js'

describe('context editor preferences', () => {
  it('preserves an explicit empty type filter', () => {
    expect(normalizeContextEditorPrefs({ enabledKinds: [], showHidden: false })).toEqual({
      version: 2,
      enabledKinds: [],
      showHidden: false,
    })
  })

  it('defaults missing or malformed values and de-duplicates known kinds', () => {
    expect(normalizeContextEditorPrefs({ enabledKinds: ['ai', 'unknown', 'ai'], showHidden: true })).toEqual({
      version: 2,
      enabledKinds: ['ai'],
      showHidden: true,
    })
    expect(normalizeContextEditorPrefs({ showHidden: true })).toEqual({
      version: 2,
      enabledKinds: ['user', 'ai', 'tool'],
      showHidden: false,
    })
  })
})
