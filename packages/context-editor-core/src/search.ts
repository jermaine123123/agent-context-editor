import type { AtomKind, ContextEditableUnit, ContextEditableUnitKind, ContextRecord, ContextRecordKind, ContextSearchMatch, ContextSearchOccurrence, ContextSearchScope } from './types.js'

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase()
}

export function normalizeSearchScope(scope: unknown): ContextSearchScope {
  return scope === 'all' ? 'all' : 'dialogue'
}

export function atomMatchesSearchScope(kind: AtomKind, scope: ContextSearchScope = 'dialogue'): boolean {
  return normalizeSearchScope(scope) === 'all' || kind === 'user' || kind === 'assistant_text'
}

export function searchOccurrences(
  records: readonly ContextRecord[],
  query: string,
  enabledKinds: ReadonlySet<ContextRecordKind>,
  scope: ContextSearchScope = 'dialogue',
  enabledUnitKinds?: ReadonlySet<ContextEditableUnitKind>,
): ContextSearchOccurrence[] {
  const needle = normalizeSearchQuery(query)
  if (!needle) return []
  const normalizedScope = normalizeSearchScope(scope)
  const occurrences: ContextSearchOccurrence[] = []
  const addMatches = (
    record: ContextRecord,
    unit: ContextEditableUnit,
    atomId: string,
    blockIndex: number,
    field: ContextSearchMatch['field'],
    haystack: string,
    anchorEntryId = record.anchorEntryId,
  ) => {
    if (!haystack) return
    const lowered = haystack.toLocaleLowerCase()
    let from = 0
    while (from < lowered.length) {
      const start = lowered.indexOf(needle, from)
      if (start < 0) break
      occurrences.push({
        recordId: record.id,
        recordKind: record.kind,
        unitId: unit.id,
        unitKind: unit.kind,
        atomId,
        anchorEntryId,
        blockIndex,
        field,
        start,
        end: start + needle.length,
        excerpt: haystack.slice(Math.max(0, start - 80), Math.min(haystack.length, start + needle.length + 120)),
      })
      from = start + Math.max(needle.length, 1)
    }
  }
  for (const record of records) {
    if (!enabledKinds.has(record.kind)) continue
    const units = record.units.length > 0
      ? record.units
      : [{
          id: `${record.id}#${record.kind}`,
          recordId: record.id,
          kind: record.kind === 'ai' ? 'answer' : record.kind,
          atomIds: record.atomIds,
          atoms: record.atoms,
          viewState: record.viewState,
          projectionState: record.projectionState,
          mutable: record.mutable,
          effectiveText: record.atoms.map((atom) => atom.text).join('\n'),
          replacementState: 'original',
          replacementSupported: false,
          canRestoreReplacement: false,
          canUndoReplacement: false,
    } satisfies ContextEditableUnit]
    for (const unit of units) {
      if (enabledUnitKinds !== undefined && !enabledUnitKinds.has(unit.kind)) continue
      if ((unit.kind === 'user' || unit.kind === 'answer') && (normalizedScope === 'all' || unit.atoms.some((atom) => atomMatchesSearchScope(atom.kind, normalizedScope)))) {
        const anchor = unit.atoms[unit.atoms.length - 1] ?? unit.atoms[0]
        if (anchor) addMatches(record, unit, anchor.id, anchor.sourceRef.blockIndex, 'message', unit.effectiveText, anchor.sourceRef.entryId)
        continue
      }
      for (const atom of unit.atoms) {
        if (!atomMatchesSearchScope(atom.kind, normalizedScope)) continue
        if (atom.toolName) addMatches(record, unit, atom.id, atom.sourceRef.blockIndex, 'tool_name', atom.toolName, atom.sourceRef.entryId)
        const field: ContextSearchMatch['field'] = atom.kind === 'reasoning'
          ? 'reasoning'
          : atom.kind === 'tool_output'
            ? 'tool_output'
            : atom.kind === 'tool_call'
              ? 'tool_args'
              : 'message'
        addMatches(record, unit, atom.id, atom.sourceRef.blockIndex, field, atom.text, atom.sourceRef.entryId)
      }
    }
  }
  return occurrences
}

export function searchRecords(
  records: readonly ContextRecord[],
  query: string,
  enabledKinds: ReadonlySet<ContextRecordKind>,
  scope: ContextSearchScope = 'dialogue',
  enabledUnitKinds?: ReadonlySet<ContextEditableUnitKind>,
): ContextSearchMatch[] {
  const occurrences = searchOccurrences(records, query, enabledKinds, scope, enabledUnitKinds)
  const grouped = new Map<string, ContextSearchOccurrence[]>()
  for (const occurrence of occurrences) {
    const group = grouped.get(occurrence.unitId) ?? []
    group.push(occurrence)
    grouped.set(occurrence.unitId, group)
  }
  const groups = Array.from(grouped.values())
  return groups.map((group, index) => {
    const first = group[0]
    if (!first) throw new Error('search record has no occurrence')
    return {
      ...first,
      index,
      total: groups.length,
      occurrenceCount: group.length,
    }
  })
}
