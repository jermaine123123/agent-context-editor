/* GENERATED FROM packages/context-editor-core; do not edit directly. */
import type {
  ContextAtom,
  ContextEditableUnit,
  ContextEditableUnitProjectionState,
  ContextProjectionEventV1,
  ContextProjectionState,
  ContextRecord,
} from './types.js'

export type ProjectionAtomState = ContextProjectionState | 'unavailable'

export interface ProjectionSelection {
  requestedUnitIds: string[]
  effectiveUnitIds: string[]
  autoExpandedUnitIds: string[]
  requestedAtomIds: string[]
  effectiveAtomIds: string[]
  unavailableUnitIds: string[]
  touchesRecentTurn: boolean
}

function stateForAtom(states: ReadonlyMap<string, ProjectionAtomState>, atom: ContextAtom): ProjectionAtomState {
  return states.get(atom.id) ?? 'include'
}

export function reduceProjectionStates(
  atoms: readonly ContextAtom[],
  events: readonly ContextProjectionEventV1[],
): Map<string, ProjectionAtomState> {
  const result = new Map<string, ProjectionAtomState>()
  const byId = new Map(atoms.map((atom) => [atom.id, atom]))
  for (const atom of atoms) result.set(atom.id, 'include')
  for (const event of events) {
    for (const change of event.changes) {
      const atom = byId.get(change.atomId)
      // An event can legitimately point to a dormant atom that was removed by
      // compaction from the current branch projection. It is checked again by
      // the Pi hook when the atom becomes active.
      if (!atom) continue
      if (
        atom.fingerprint !== change.fingerprint ||
        atom.sourceRef.entryId !== change.sourceRef.entryId ||
        atom.sourceRef.blockIndex !== change.sourceRef.blockIndex
      ) {
        result.set(atom.id, 'unavailable')
        continue
      }
      const current = result.get(atom.id) ?? 'include'
      if (current === 'unavailable') continue
      if (current !== change.before && current !== change.after) {
        result.set(atom.id, 'unavailable')
        continue
      }
      result.set(atom.id, change.after)
    }
  }
  return result
}

export function projectionStateForAtoms(
  atoms: readonly ContextAtom[],
  states: ReadonlyMap<string, ProjectionAtomState>,
): ContextEditableUnitProjectionState {
  if (!atoms.length) return 'unavailable'
  const values = atoms.map((atom) => stateForAtom(states, atom))
  if (values.some((value) => value === 'unavailable')) return 'unavailable'
  if (values.every((value) => value === 'exclude')) return 'exclude'
  if (values.every((value) => value === 'include')) return 'include'
  return 'mixed'
}

function unitHasToolCall(unit: ContextEditableUnit, callIds: ReadonlySet<string>): boolean {
  return unit.atoms.some((atom) => !!atom.toolCallId && callIds.has(atom.toolCallId))
}

function unitHasSignedReasoning(unit: ContextEditableUnit): boolean {
  return unit.kind === 'reasoning' && unit.atoms.some((atom) => atom.hasSignature === true)
}

function unitHasKindAndTurn(unit: ContextEditableUnit, kind: ContextEditableUnit['kind'], turnIds: ReadonlySet<string>): boolean {
  return unit.kind === kind && unit.atoms.some((atom) => turnIds.has(atom.turnId))
}

/**
 * Expand a user selection to a provider-safe context closure. Tool calls and
 * results are paired by call id. A signed reasoning block is kept with all
 * tool blocks in the same logical turn; the final answer remains independent.
 */
export function selectProjectionTargets(
  records: readonly ContextRecord[],
  unitIds?: readonly string[],
  recordIds?: readonly string[],
): ProjectionSelection {
  const units = records.flatMap((record) => record.units.map((unit) => ({ record, unit })))
  const requested = new Set<string>()
  if (recordIds) {
    for (const item of units) if (recordIds.includes(item.record.id)) requested.add(item.unit.id)
  }
  if (unitIds) for (const id of unitIds) if (units.some((item) => item.unit.id === id)) requested.add(id)
  if (!unitIds && !recordIds) for (const item of units) requested.add(item.unit.id)

  const effective = new Set(requested)
  const selectedUnits = units.filter((item) => requested.has(item.unit.id)).map((item) => item.unit)
  const callIds = new Set(selectedUnits.flatMap((unit) => unit.atoms.map((atom) => atom.toolCallId).filter((id): id is string => !!id)))
  for (const item of units) if (unitHasToolCall(item.unit, callIds)) effective.add(item.unit.id)

  const selectedTurns = new Set(selectedUnits.flatMap((unit) => unit.atoms.map((atom) => atom.turnId)))
  const selectedTool = selectedUnits.some((unit) => unit.kind === 'tool')
  const selectedSignedReasoning = selectedUnits.some(unitHasSignedReasoning)
  if (selectedTool || selectedSignedReasoning) {
    const hasSignedReasoning = units.some((item) => unitHasSignedReasoning(item.unit) && item.unit.atoms.some((atom) => selectedTurns.has(atom.turnId)))
    const hasTool = units.some((item) => item.unit.kind === 'tool' && item.unit.atoms.some((atom) => selectedTurns.has(atom.turnId)))
    if (hasSignedReasoning && hasTool) {
      for (const item of units) {
        if (unitHasKindAndTurn(item.unit, 'reasoning', selectedTurns) || unitHasKindAndTurn(item.unit, 'tool', selectedTurns)) effective.add(item.unit.id)
      }
    }
  }

  const effectiveItems = units.filter((item) => effective.has(item.unit.id))
  const recentTurnId = [...units].reverse().flatMap((item) => item.unit.atoms.map((atom) => atom.turnId))[0]
  const requestedAtomIds = units.filter((item) => requested.has(item.unit.id)).flatMap((item) => item.unit.atomIds)
  const effectiveAtomIds = effectiveItems.flatMap((item) => item.unit.atomIds)
  const unavailableUnitIds = effectiveItems
    .filter((item) => !item.unit.mutable || item.unit.projectionState === 'unavailable')
    .map((item) => item.unit.id)
  const requestedUnitIds = units.filter((item) => requested.has(item.unit.id)).map((item) => item.unit.id)
  const effectiveUnitIds = effectiveItems.map((item) => item.unit.id)
  return {
    requestedUnitIds,
    effectiveUnitIds,
    autoExpandedUnitIds: effectiveUnitIds.filter((id) => !requested.has(id)),
    requestedAtomIds,
    effectiveAtomIds,
    unavailableUnitIds,
    touchesRecentTurn: !!recentTurnId && effectiveItems.some((item) => item.unit.atoms.some((atom) => atom.turnId === recentTurnId)),
  }
}
