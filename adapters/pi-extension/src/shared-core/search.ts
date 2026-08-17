/* GENERATED FROM packages/context-editor-core; do not edit directly. */
import type { ContextEditableUnit, ContextRecord, ContextRecordKind, ContextSearchMatch } from './types.js'

export function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase()
}

export function searchRecords(
  records: readonly ContextRecord[],
  query: string,
  enabledKinds: ReadonlySet<ContextRecordKind>,
): ContextSearchMatch[] {
  const needle = normalizeSearchQuery(query)
  if (!needle) return []
  type Occurrence = Omit<ContextSearchMatch, 'index' | 'total' | 'occurrenceCount'>
  const grouped = new Map<string, { record: ContextRecord; unit: ContextEditableUnit; occurrences: Occurrence[] }>()
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
      const group = grouped.get(unit.id) ?? { record, unit, occurrences: [] }
      group.occurrences.push({
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
      grouped.set(unit.id, group)
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
          mutable: record.mutable,
        } satisfies ContextEditableUnit]
    for (const unit of units) {
      for (const atom of unit.atoms) {
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
  const groups = Array.from(grouped.values())
  return groups.map((group, index) => {
    const first = group.occurrences[0]
    if (!first) throw new Error(`search record ${group.record.id} has no occurrence`)
    return {
      ...first,
      index,
      total: groups.length,
      occurrenceCount: group.occurrences.length,
    }
  })
}
