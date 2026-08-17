/* GENERATED FROM packages/context-editor-core; do not edit directly. */
import type { AtomKind, ContextAtom, ContextEditableUnitKind, ContextEditableUnitViewState, ContextRecord, ContextRecordKind, ViewState } from './types.js'

function recordIdFor(atom: ContextAtom): string {
  if (atom.recordId) return atom.recordId
  if (atom.kind === 'user') return `user:${atom.sourceRef.entryId}`
  if (atom.kind === 'assistant_text' || atom.kind === 'reasoning') return `ai:${atom.sourceRef.entryId}`
  if (atom.kind === 'tool_call') {
    return atom.toolCallId
      ? `tool:${atom.sourceRef.entryId}:${atom.toolCallId}`
      : `tool:${atom.sourceRef.entryId}:block:${atom.sourceRef.blockIndex}`
  }
  if (atom.kind === 'tool_output') {
    return `tool-result:${atom.sourceRef.entryId}:block:${atom.sourceRef.blockIndex}`
  }
  return `system:${atom.sourceRef.entryId}`
}

function recordGroupKeyFor(atom: ContextAtom): string {
  if (
    !atom.recordId &&
    (atom.kind === 'assistant_text' || atom.kind === 'reasoning')
  ) {
    // Pi can write one logical AI reply as several assistant entries around
    // tool calls. Treat the entire user turn as the default display unit.
    return `ai-turn:${atom.turnId}`
  }
  return recordIdFor(atom)
}

function kindFor(atom: ContextAtom): ContextRecordKind | null {
  if (atom.kind === 'user') return 'user'
  if (atom.kind === 'assistant_text' || atom.kind === 'reasoning') return 'ai'
  if (atom.kind === 'tool_call' || atom.kind === 'tool_output') return 'tool'
  return null
}

function fieldText(atom: ContextAtom): string {
  return [atom.toolName ?? '', atom.text].filter(Boolean).join(' ')
}

function unitKindFor(atom: ContextAtom): ContextEditableUnitKind | null {
  if (atom.kind === 'reasoning') return 'reasoning'
  if (atom.kind === 'assistant_text') return 'answer'
  if (atom.kind === 'user') return 'user'
  if (atom.kind === 'tool_call' || atom.kind === 'tool_output') return 'tool'
  return null
}

function unitViewState(atoms: readonly ContextAtom[], states?: ReadonlyMap<string, ViewState>): ContextEditableUnitViewState {
  if (!atoms.length) return 'show'
  const values = atoms.map((atom) => states?.get(atom.id) ?? 'show')
  if (values.every((value) => value === 'hide')) return 'hide'
  if (values.every((value) => value === 'show')) return 'show'
  if (values.every((value) => value === 'collapse')) return 'collapse'
  return 'mixed'
}

function projectUnits(
  recordId: string,
  atoms: readonly ContextAtom[],
  states?: ReadonlyMap<string, ViewState>,
) {
  const order: ContextEditableUnitKind[] = []
  const groups = new Map<ContextEditableUnitKind, ContextAtom[]>()
  for (const atom of atoms) {
    const kind = unitKindFor(atom)
    if (!kind) continue
    const group = groups.get(kind)
    if (group) group.push(atom)
    else {
      order.push(kind)
      groups.set(kind, [atom])
    }
  }
  return order.map((kind) => {
    const grouped = groups.get(kind) ?? []
    return {
      id: `${recordId}#${kind}`,
      recordId,
      kind,
      atomIds: grouped.map((atom) => atom.id),
      atoms: grouped,
      viewState: unitViewState(grouped, states),
      mutable: true,
    }
  })
}

export function projectRecords(
  atoms: readonly ContextAtom[],
  states?: ReadonlyMap<string, ViewState>,
): ContextRecord[] {
  const order: string[] = []
  const groups = new Map<string, ContextAtom[]>()
  for (const atom of atoms) {
    // Compaction/system atoms stay in the host timeline and are intentionally
    // not exposed as hideable context records in V0.1.
    if (!kindFor(atom)) continue
    const groupKey = recordGroupKeyFor(atom)
    const group = groups.get(groupKey)
    if (group) group.push(atom)
    else {
      order.push(groupKey)
      groups.set(groupKey, [atom])
    }
  }
  return order.map((groupKey) => {
    const grouped = groups.get(groupKey) ?? []
    const id = grouped[0] ? recordIdFor(grouped[0]) : groupKey
    const kind = grouped.map(kindFor).find((value): value is ContextRecordKind => value !== null)
    if (!kind) throw new Error(`context record ${id} has no actionable atoms`)
    const allHidden = grouped.length > 0 && grouped.every((atom) => states?.get(atom.id) === 'hide')
    const first = grouped[0]
    const mutable = kind !== 'tool' || grouped.every((atom) => !!atom.sourceRef.entryId)
    const units = projectUnits(id, grouped, states).map((unit) => ({ ...unit, mutable }))
    return {
      id,
      kind,
      atomIds: grouped.map((atom) => atom.id),
      atoms: grouped,
      units,
      entryId: first?.sourceRef.entryId,
      entryIds: Array.from(new Set(grouped.map((atom) => atom.sourceRef.entryId).filter(Boolean))),
      anchorEntryId: first?.sourceRef.entryId,
      toolCallId: grouped.find((atom) => atom.toolCallId)?.toolCallId,
      searchableText: grouped.map(fieldText).filter(Boolean).join('\n'),
      viewState: allHidden ? 'hide' : 'show',
      mutable,
    }
  })
}

export function atomKindsForRecord(record: ContextRecord): Set<AtomKind> {
  return new Set(record.atoms.map((atom) => atom.kind))
}

export function recordMatchesKinds(record: ContextRecord, enabled: ReadonlySet<ContextRecordKind>): boolean {
  return enabled.has(record.kind)
}
