import type { ContextEditableUnitKind, ContextRecordKind } from './types.js'

/** Legacy record-level preferences. Kept for sidecar/client migration only. */
export interface ContextEditorPrefsV2 {
  version: 2
  enabledKinds: ContextRecordKind[]
  showHidden: boolean
}

/** Canonical cross-host preferences. AI filters are stored as editable units. */
export interface ContextEditorPrefsV3 {
  version: 3
  enabledUnitKinds: ContextEditableUnitKind[]
  showHidden: boolean
}

export type ContextEditorPrefs = ContextEditorPrefsV3
export type ContextEditorPrefsInput = ContextEditorPrefsV2 | ContextEditorPrefsV3

export const CONTEXT_EDITOR_UNIT_KINDS = [
  'user',
  'reasoning',
  'answer',
  'tool',
] as const satisfies readonly ContextEditableUnitKind[]

export const DEFAULT_CONTEXT_EDITOR_PREFS: ContextEditorPrefsV3 = {
  version: 3,
  enabledUnitKinds: [...CONTEXT_EDITOR_UNIT_KINDS],
  showHidden: false,
}

export function migrateRecordKindsToUnitKinds(
  enabledKinds: readonly ContextRecordKind[],
): ContextEditableUnitKind[] {
  const enabled = new Set(enabledKinds)
  return CONTEXT_EDITOR_UNIT_KINDS.filter((kind) => {
    if (kind === 'reasoning' || kind === 'answer') return enabled.has('ai')
    return enabled.has(kind)
  })
}

export function recordKindsForUnitKinds(
  enabledUnitKinds: readonly ContextEditableUnitKind[],
): ContextRecordKind[] {
  const enabled = new Set(enabledUnitKinds)
  return (['user', 'ai', 'tool'] as const).filter((kind) => {
    if (kind === 'ai') return enabled.has('reasoning') || enabled.has('answer')
    return enabled.has(kind)
  })
}

/**
 * Migrate persisted preferences without treating an explicit empty filter as
 * corrupt. An empty filter is the user's valid "show no conversation kinds"
 * choice; missing or malformed values use defaults.
 */
export function normalizeContextEditorPrefs(value: unknown): ContextEditorPrefsV3 {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_CONTEXT_EDITOR_PREFS, enabledUnitKinds: [...DEFAULT_CONTEXT_EDITOR_PREFS.enabledUnitKinds] }
  }
  const raw = value as { enabledUnitKinds?: unknown; enabledKinds?: unknown; showHidden?: unknown }
  let enabledUnitKinds: ContextEditableUnitKind[]
  if (Array.isArray(raw.enabledUnitKinds)) {
    const enabled = new Set(raw.enabledUnitKinds.filter(
      (kind): kind is ContextEditableUnitKind => CONTEXT_EDITOR_UNIT_KINDS.includes(kind as ContextEditableUnitKind),
    ))
    enabledUnitKinds = CONTEXT_EDITOR_UNIT_KINDS.filter((kind) => enabled.has(kind))
  } else if (Array.isArray(raw.enabledKinds)) {
    const enabledKinds = Array.from(new Set(raw.enabledKinds.filter(
      (kind): kind is ContextRecordKind => kind === 'user' || kind === 'ai' || kind === 'tool',
    )))
    enabledUnitKinds = migrateRecordKindsToUnitKinds(enabledKinds)
  } else {
    return { ...DEFAULT_CONTEXT_EDITOR_PREFS, enabledUnitKinds: [...DEFAULT_CONTEXT_EDITOR_PREFS.enabledUnitKinds] }
  }
  return {
    version: 3,
    enabledUnitKinds,
    showHidden: raw.showHidden === true,
  }
}
