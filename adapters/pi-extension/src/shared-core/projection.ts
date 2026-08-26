/* GENERATED FROM packages/context-editor-core; do not edit directly. */
import type {
  ContextAtom,
  ContextEditableUnit,
  ContextEditableUnitProjectionState,
  ContextProjectionEventV1,
  ContextProjectionEvent,
  ContextReplacementEventV1,
  ContextReplacementProjectionState,
  ContextReplacementDisabledReason,
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

export interface ReplacementUnitProjection {
  unitId: string
  originalText: string
  effectiveText: string
  replacementText: string | null
  replacementState: ContextReplacementProjectionState
  replacementSupported: boolean
  replacementDisabledReason?: ContextReplacementDisabledReason
  canRestoreReplacement: boolean
  canUndoReplacement: boolean
  activeEventId?: string
}

type ReplacementStackItem = { eventId: string; beforeText: string | null; afterText: string | null }

type MutableReplacementState = ReplacementUnitProjection & { stack: ReplacementStackItem[] }

export function unitOriginalText(unit: Pick<ContextEditableUnit, 'atoms'>): string {
  return unit.atoms.map((atom) => atom.text).join('\n')
}

export function replacementEligibility(unit: Pick<ContextEditableUnit, 'kind' | 'atoms' | 'mutable'>): {
  supported: boolean
  disabledReason?: ContextReplacementDisabledReason
} {
  if (!unit.mutable) return { supported: false, disabledReason: 'invalid-target' }
  if (unit.kind === 'user') {
    const atom = unit.atoms.length === 1 ? unit.atoms[0] : undefined
    if (!atom || atom.kind !== 'user') return { supported: false, disabledReason: 'invalid-target' }
    if (atom.structured === true) return { supported: false, disabledReason: 'structured-user-content' }
    return { supported: true }
  }
  if (unit.kind === 'answer') {
    if (!unit.atoms.length || unit.atoms.some((atom) => atom.kind !== 'assistant_text')) {
      return { supported: false, disabledReason: 'invalid-target' }
    }
    if (unit.atoms.some((atom) => atom.hasSignature === true)) return { supported: false, disabledReason: 'signed-content' }
    return { supported: true }
  }
  return { supported: false, disabledReason: 'unsupported-unit-kind' }
}

function sameAtomRefs(unit: ContextEditableUnit, refs: readonly { atomId: string; sourceRef: { entryId: string; blockIndex: number }; fingerprint: string }[]): boolean {
  if (unit.atoms.length !== refs.length || !refs.length) return false
  return unit.atoms.every((atom, index) => {
    const ref = refs[index]
    return !!ref && ref.atomId === atom.id && ref.fingerprint === atom.fingerprint &&
      ref.sourceRef.entryId === atom.sourceRef.entryId && ref.sourceRef.blockIndex === atom.sourceRef.blockIndex
  })
}

function isReplacementEvent(event: ContextProjectionEvent): event is ContextReplacementEventV1 {
  return 'type' in event && event.type === 'replacement' && event.schemaVersion === 1
}

/** Replay replacement history independently for every editable unit. Invalid history fails closed for that unit. */
export function reduceReplacementStates(
  units: readonly ContextEditableUnit[],
  events: readonly ContextProjectionEvent[],
  projectionAvailable = true,
): Map<string, ReplacementUnitProjection> {
  const states = new Map<string, MutableReplacementState>()
  for (const unit of units) {
    const eligibility = replacementEligibility(unit)
    const unavailable = !projectionAvailable
    states.set(unit.id, {
      unitId: unit.id,
      originalText: unitOriginalText(unit),
      effectiveText: unitOriginalText(unit),
      replacementText: null,
      replacementState: unavailable ? 'unavailable' : 'original',
      replacementSupported: eligibility.supported && !unavailable,
      ...(unavailable ? { replacementDisabledReason: 'projection-unavailable' as const } : eligibility.disabledReason ? { replacementDisabledReason: eligibility.disabledReason } : {}),
      canRestoreReplacement: false,
      canUndoReplacement: false,
      stack: [],
    })
  }
  if (!projectionAvailable) return new Map([...states].map(([id, value]) => [id, value]))
  const seenEventIds = new Set<string>()
  for (const event of events) {
    if (!isReplacementEvent(event)) continue
    if (seenEventIds.has(event.eventId)) continue
    seenEventIds.add(event.eventId)
    const state = states.get(event.unitId)
    if (!state || state.replacementState === 'unavailable') continue
    const unit = units.find((candidate) => candidate.id === event.unitId)
    if (!unit || !state.replacementSupported) {
      if (state) state.replacementState = 'unavailable'
      continue
    }
    if (event.action === 'undo') {
      const top = state.stack[state.stack.length - 1]
      if (!top || top.eventId !== event.undoOf) {
        state.replacementState = 'unavailable'
        state.replacementDisabledReason = 'invalid-target'
        continue
      }
      state.stack.pop()
      state.replacementText = top.beforeText
      state.effectiveText = top.beforeText ?? state.originalText
      state.replacementState = top.beforeText === null ? 'original' : 'replaced'
      state.activeEventId = state.stack[state.stack.length - 1]?.eventId
      continue
    }
    if (event.unitKind !== unit.kind || !sameAtomRefs(unit, event.atomRefs) || event.beforeText !== state.replacementText) {
      state.replacementState = 'unavailable'
      state.replacementDisabledReason = 'invalid-target'
      continue
    }
    if (event.action === 'replace') {
      if (typeof event.afterText !== 'string' || event.afterText.trim().length === 0) {
        state.replacementState = 'unavailable'
        state.replacementDisabledReason = 'invalid-target'
        continue
      }
    } else if (event.afterText !== null || event.beforeText === null) {
      state.replacementState = 'unavailable'
      state.replacementDisabledReason = 'invalid-target'
      continue
    }
    state.stack.push({ eventId: event.eventId, beforeText: event.beforeText, afterText: event.afterText })
    state.replacementText = event.afterText
    state.effectiveText = event.afterText ?? state.originalText
    state.replacementState = event.afterText === null ? 'original' : 'replaced'
    state.activeEventId = event.eventId
  }
  const output = new Map<string, ReplacementUnitProjection>()
  for (const [id, state] of states) {
    state.canRestoreReplacement = state.replacementState === 'replaced' && state.replacementText !== null
    state.canUndoReplacement = state.replacementState !== 'unavailable' && state.stack.length > 0
    const { stack: _stack, ...projection } = state
    output.set(id, projection)
  }
  return output
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
