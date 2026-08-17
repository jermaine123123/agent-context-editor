/* GENERATED FROM packages/context-editor-core; do not edit directly. */
import type {
  AtomKind,
  ContextAtom,
  ContextEditorStateV1,
  ContextEditorViewEventV2,
  ContextEditorViewChange,
  ViewState,
} from './types.js'
import { legacyAtomId } from './fingerprint.js'

export const LEGACY_STATE_ENTRY_TYPE = 'context-editor-state'
export const VIEW_EVENT_ENTRY_TYPE = 'context-editor-view-event-v2'

function isViewState(value: unknown): value is ViewState {
  return value === 'show' || value === 'collapse' || value === 'hide'
}

function isAtomKind(value: unknown): value is AtomKind {
  return typeof value === 'string' && ['user', 'assistant_text', 'reasoning', 'tool_call', 'tool_output', 'summary'].includes(value)
}

function parseLegacyState(value: unknown): ContextEditorStateV1 | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || typeof raw.updatedAt !== 'string' || !raw.items || typeof raw.items !== 'object') {
    return undefined
  }
  const items: ContextEditorStateV1['items'] = {}
  for (const [id, candidate] of Object.entries(raw.items as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== 'object') continue
    const item = candidate as Record<string, unknown>
    if (
      typeof item.fingerprint === 'string' &&
      isViewState(item.viewState) &&
      ['keep', 'replace', 'summarize', 'exclude'].includes(String(item.contextState))
    ) {
      items[id] = {
        fingerprint: item.fingerprint,
        viewState: item.viewState,
        contextState: item.contextState as 'keep' | 'replace' | 'summarize' | 'exclude',
      }
    }
  }
  const filter = raw.viewFilter as Record<string, unknown> | undefined
  const viewFilter =
    filter && Array.isArray(filter.enabledKinds) && typeof filter.query === 'string' && typeof filter.showHidden === 'boolean'
      ? {
          enabledKinds: filter.enabledKinds.filter(isAtomKind),
          query: filter.query,
          showHidden: filter.showHidden,
        }
      : undefined
  return {
    version: 1,
    updatedAt: raw.updatedAt,
    ...(typeof raw.sourceLeafId === 'string' ? { sourceLeafId: raw.sourceLeafId } : {}),
    items,
    ...(viewFilter ? { viewFilter } : {}),
  }
}

export function readLatestLegacyState(entries: readonly unknown[]): ContextEditorStateV1 | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index] as Record<string, unknown> | undefined
    if (entry?.type !== 'custom' || entry.customType !== LEGACY_STATE_ENTRY_TYPE) continue
    const parsed = parseLegacyState(entry.data)
    if (parsed) return parsed
  }
  return undefined
}

function parseViewEvent(value: unknown): ContextEditorViewEventV2 | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (
    raw.version !== 2 ||
    typeof raw.transactionId !== 'string' ||
    typeof raw.createdAt !== 'string' ||
    typeof raw.baseRevision !== 'string' ||
    !['hide', 'restore', 'reset', 'undo'].includes(String(raw.action)) ||
    !Array.isArray(raw.changes)
  ) return undefined
  const changes: ContextEditorViewChange[] = []
  for (const candidate of raw.changes) {
    if (!candidate || typeof candidate !== 'object') continue
    const change = candidate as Record<string, unknown>
    if (
      typeof change.atomId === 'string' &&
      typeof change.fingerprint === 'string' &&
      isViewState(change.before) &&
      isViewState(change.after)
    ) {
      changes.push({
        atomId: change.atomId,
        fingerprint: change.fingerprint,
        before: change.before,
        after: change.after,
      })
    }
  }
  if (!changes.length) return undefined
  return {
    version: 2,
    transactionId: raw.transactionId,
    createdAt: raw.createdAt,
    baseRevision: raw.baseRevision,
    action: raw.action as ContextEditorViewEventV2['action'],
    changes,
    ...(typeof raw.undoOf === 'string' ? { undoOf: raw.undoOf } : {}),
  }
}

export function readViewEvents(entries: readonly unknown[]): ContextEditorViewEventV2[] {
  const result: ContextEditorViewEventV2[] = []
  for (const entry of entries) {
    const raw = entry as Record<string, unknown> | undefined
    if (raw?.type !== 'custom' || raw.customType !== VIEW_EVENT_ENTRY_TYPE) continue
    const parsed = parseViewEvent(raw.data)
    if (parsed) result.push(parsed)
  }
  return result
}

export function atomViewState(
  legacy: ContextEditorStateV1 | undefined,
  events: readonly ContextEditorViewEventV2[],
  atom: ContextAtom,
): ViewState {
  let value: ViewState = 'show'
  // V1 used a fingerprint-bearing atom key. Read it as a migration fallback;
  // V2 uses the stable source-position key so a changed fingerprint fails open.
  const old = legacy?.items[atom.id] ?? legacy?.items[legacyAtomId(atom)]
  if (old?.fingerprint === atom.fingerprint) value = old.viewState
  for (const event of events) {
    const change = event.changes.find((candidate) => candidate.atomId === atom.id)
    if (change && change.fingerprint === atom.fingerprint) value = change.after
  }
  return value
}

export function reduceViewStates(
  atoms: readonly ContextAtom[],
  legacy: ContextEditorStateV1 | undefined,
  events: readonly ContextEditorViewEventV2[],
): Map<string, ViewState> {
  const result = new Map<string, ViewState>()
  for (const atom of atoms) result.set(atom.id, atomViewState(legacy, events, atom))
  return result
}

export function latestUndoableEvent(events: readonly ContextEditorViewEventV2[]): ContextEditorViewEventV2 | undefined {
  const undone = new Set<string>()
  for (const event of events) if (event.action === 'undo' && event.undoOf) undone.add(event.undoOf)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event) continue
    if (event.action !== 'undo' && !undone.has(event.transactionId)) return event
  }
  return undefined
}

export function inverseChanges(event: ContextEditorViewEventV2): ContextEditorViewChange[] {
  return event.changes.map((change) => ({
    atomId: change.atomId,
    fingerprint: change.fingerprint,
    before: change.after,
    after: change.before,
  }))
}
