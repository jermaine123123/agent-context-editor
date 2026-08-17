import type { ContextRecordKind } from './types.js'

export interface ContextEditorPrefsV2 {
  version: 2
  enabledKinds: ContextRecordKind[]
  showHidden: boolean
}

export const DEFAULT_CONTEXT_EDITOR_PREFS: ContextEditorPrefsV2 = {
  version: 2,
  enabledKinds: ['user', 'ai', 'tool'],
  showHidden: false,
}

/**
 * Migrate persisted preferences without treating an explicit empty filter as
 * corrupt. An empty enabledKinds array is the user's valid "show no
 * conversation kinds" choice; missing or malformed values use defaults.
 */
export function normalizeContextEditorPrefs(value: unknown): ContextEditorPrefsV2 {
  if (!value || typeof value !== 'object') return { ...DEFAULT_CONTEXT_EDITOR_PREFS }
  const raw = value as { enabledKinds?: unknown; showHidden?: unknown }
  if (!Array.isArray(raw.enabledKinds)) return { ...DEFAULT_CONTEXT_EDITOR_PREFS }
  const enabledKinds = Array.from(new Set(raw.enabledKinds.filter(
    (kind): kind is ContextRecordKind => kind === 'user' || kind === 'ai' || kind === 'tool',
  )))
  return {
    version: 2,
    enabledKinds,
    showHidden: raw.showHidden === true,
  }
}
