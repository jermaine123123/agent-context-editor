import type {
  ContextAtom,
  ContextCondensationCoverage,
  ContextEditableUnit,
  ContextEditableUnitKind,
  ContextRecord,
  ContextNativeCompactionRef,
} from './types.js'
import { stableFingerprint } from './fingerprint.js'

export const CONDENSATION_SCHEMA_VERSION = 1 as const

export type CondensationRiskKind =
  | 'tool-output'
  | 'reasoning'
  | 'structured-content'
  | 'already-excluded'
  | 'non-contiguous'
  | 'small-saving'

export interface CondensationSourceUnit {
  id: string
  recordId: string
  kind: ContextEditableUnitKind
  atomIds: string[]
  /** Host-native entry identifiers; Pi uses opaque string IDs. */
  sourceEntryIds?: string[]
  sourceRootSeqs: number[]
  text: string
  approxTokens: number
  included: boolean
  toolNames?: string[]
  isError?: boolean
  hasSignature?: boolean
  structured?: boolean
}

export interface CondensationRange {
  expandRelated?: boolean
  requestedUnitIds: string[]
  effectiveUnitIds: string[]
  autoExpandedUnitIds: string[]
  recordIds: string[]
  sourceEntryIds?: string[]
  sourceRootSeqs: number[]
  sourceFingerprint: string
  sourceUnits: CondensationSourceUnit[]
  shadowedTokenCount: number
  unavailableUnitIds: string[]
  risks: CondensationRiskKind[]
}

export interface CondensationMetrics {
  beforeTokens: number
  afterTokens: number
  savedTokens: number
  savingsRatio: number
  belowRecommendedThreshold: boolean
}

/**
 * Reconcile a selective condensation with successful host-native compactions.
 *
 * Native compaction operates on surface roots, so the relationship is derived
 * from the exact shadowed root set rather than from a positional range. This
 * keeps partial coverage meaningful when a later compaction only absorbs part
 * of an older selective summary.
 */
export function deriveCondensationCoverage(
  sourceRootSeqs: readonly number[] | readonly string[],
  nativeCompactions: readonly ContextNativeCompactionRef[],
): ContextCondensationCoverage {
  if (sourceRootSeqs.some(value => typeof value === "string")) {
    return deriveCondensationEntryCoverage(sourceRootSeqs.map(String), nativeCompactions)
  }
  const source = Array.from(new Set(((sourceRootSeqs as readonly number[]) ?? [])
    .map(Number)
    .filter((value) => Number.isSafeInteger(value) && value >= 0)))
    .sort((a, b) => a - b)
  const refs = Array.from(new Map((nativeCompactions ?? [])
    .filter((ref) => ref && typeof ref.compactionId === 'string' && ref.compactionId.length > 0)
    .map((ref) => [ref.compactionId, {
      ...ref,
      host: String(ref.host ?? ''),
      compactionId: String(ref.compactionId),
      shadowedRootSeqs: Array.from(new Set((ref.shadowedRootSeqs ?? [])
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value >= 0))).sort((a, b) => a - b),
      ...(Number.isSafeInteger(ref.startSeq) ? { startSeq: Number(ref.startSeq) } : {}),
      ...(ref.shadowedRange && Number.isSafeInteger(ref.shadowedRange.start) && Number.isSafeInteger(ref.shadowedRange.end)
        ? { shadowedRange: { start: Number(ref.shadowedRange.start), end: Number(ref.shadowedRange.end) } }
        : {}),
      ...(Number.isSafeInteger(ref.summarySeq) ? { summarySeq: Number(ref.summarySeq) } : {}),
      ...(Number.isSafeInteger(ref.checkpointSeq) ? { checkpointSeq: Number(ref.checkpointSeq) } : {}),
      ...(Number.isSafeInteger(ref.endSeq) ? { endSeq: Number(ref.endSeq) } : {}),
      committed: ref.committed !== false,
    } satisfies ContextNativeCompactionRef]))
    .values())
    .filter((ref) => ref.shadowedRootSeqs.length > 0)
    .sort((left, right) => (right.checkpointSeq ?? right.endSeq ?? right.summarySeq ?? -1)
      - (left.checkpointSeq ?? left.endSeq ?? left.summarySeq ?? -1))
  const relatedRefs = refs.filter((ref) => source.some((root) => ref.shadowedRootSeqs.includes(root)))
  const verifiedRefs = relatedRefs.filter((ref) => ref.committed !== false)
  const covered = source.filter((root) => verifiedRefs.some((ref) => ref.shadowedRootSeqs.includes(root)))
  const uncertainRefs = relatedRefs.filter((ref) => ref.committed === false
    && ref.shadowedRootSeqs.some((root) => source.includes(root) && !covered.includes(root)))
  const outputRefs = [...verifiedRefs, ...uncertainRefs]
  const uncertain = uncertainRefs.length > 0
  const uncovered = source.filter((root) => !covered.includes(root))
  const status: ContextCondensationCoverage['status'] = covered.length === 0
    ? 'none'
    : uncovered.length === 0 ? 'full' : 'partial'
  const checkpoint = verifiedRefs.find((ref) => Number.isSafeInteger(ref.checkpointSeq))
  const restoreMode: ContextCondensationCoverage['restoreMode'] = uncertain
    ? 'unavailable'
    : status === 'none'
      ? 'inline'
      : checkpoint ? 'checkpoint' : 'unavailable'
  return {
    status,
    restoreMode,
    coveredSourceRootSeqs: covered,
    uncoveredSourceRootSeqs: uncovered,
    nativeCompactions: outputRefs,
    ...(checkpoint ? { checkpointCompactionId: checkpoint.compactionId, checkpointSeq: checkpoint.checkpointSeq } : {}),
    ...(restoreMode === 'inline' ? {} : {
      reason: restoreMode === 'checkpoint'
        ? 'native-compaction-absorbed-source' as const
        : 'checkpoint-unavailable' as const,
    }),
  }
}

/** Derive coverage for hosts whose durable surface uses opaque entry IDs (Pi). */
export function deriveCondensationEntryCoverage(
  sourceEntryIds: readonly string[],
  nativeCompactions: readonly ContextNativeCompactionRef[],
): ContextCondensationCoverage {
  const source = Array.from(new Set(sourceEntryIds.map(String).filter(Boolean)))
  const refs = Array.from(new Map((nativeCompactions ?? [])
    .filter(ref => ref && typeof ref.compactionId === 'string' && ref.compactionId.length > 0)
    .map(ref => [ref.compactionId, {
      ...ref,
      host: String(ref.host ?? ''),
      compactionId: String(ref.compactionId),
      shadowedRootSeqs: Array.from(new Set((ref.shadowedRootSeqs ?? []).map(Number)
        .filter(value => Number.isSafeInteger(value) && value >= 0))).sort((a, b) => a - b),
      shadowedEntryIds: Array.from(new Set((ref.shadowedEntryIds ?? []).map(String).filter(Boolean))),
      ...(typeof ref.checkpointEntryId === 'string' && ref.checkpointEntryId.length > 0 ? { checkpointEntryId: ref.checkpointEntryId } : {}),
      committed: ref.committed !== false,
    } satisfies ContextNativeCompactionRef]))
    .values())
    .filter(ref => ref.shadowedEntryIds.length > 0)
    .sort((left, right) => (right.checkpointSeq ?? right.endSeq ?? right.summarySeq ?? -1)
      - (left.checkpointSeq ?? left.endSeq ?? left.summarySeq ?? -1))
  const relatedRefs = refs.filter(ref => source.some(entryId => ref.shadowedEntryIds?.includes(entryId)))
  const verifiedRefs = relatedRefs.filter(ref => ref.committed !== false)
  const covered = source.filter(entryId => verifiedRefs.some(ref => ref.shadowedEntryIds?.includes(entryId)))
  const uncertainRefs = relatedRefs.filter(ref => ref.committed === false
    && ref.shadowedEntryIds?.some(entryId => source.includes(entryId) && !covered.includes(entryId)))
  const uncovered = source.filter(entryId => !covered.includes(entryId))
  const status: ContextCondensationCoverage['status'] = covered.length === 0
    ? 'none'
    : uncovered.length === 0 ? 'full' : 'partial'
  const checkpoint = verifiedRefs.find(ref => typeof ref.checkpointEntryId === 'string' && ref.checkpointEntryId.length > 0)
  const restoreMode: ContextCondensationCoverage['restoreMode'] = uncertainRefs.length > 0
    ? 'unavailable'
    : status === 'none' ? 'inline' : checkpoint ? 'checkpoint' : 'unavailable'
  return {
    status,
    restoreMode,
    coveredSourceRootSeqs: [],
    uncoveredSourceRootSeqs: [],
    coveredSourceEntryIds: covered,
    uncoveredSourceEntryIds: uncovered,
    nativeCompactions: [...verifiedRefs, ...uncertainRefs],
    ...(checkpoint ? {
      checkpointCompactionId: checkpoint.compactionId,
      ...(checkpoint.checkpointSeq === undefined ? {} : { checkpointSeq: checkpoint.checkpointSeq }),
      ...(checkpoint.checkpointEntryId === undefined ? {} : { checkpointEntryId: checkpoint.checkpointEntryId }),
    } : {}),
    ...(restoreMode === 'inline' ? {} : {
      reason: restoreMode === 'checkpoint'
        ? 'native-compaction-absorbed-source' as const
        : 'checkpoint-unavailable' as const,
    }),
  }
}

export interface CondensationProposal {
  schemaVersion: 1
  operationId: string
  sessionId: string
  baseRevision: string
  requestedUnitIds: string[]
  effectiveUnitIds: string[]
  autoExpandedUnitIds: string[]
  recordIds: string[]
  sourceEntryIds?: string[]
  sourceRootSeqs: number[]
  sourceUnits: CondensationSourceUnit[]
  summary: string
  provider: string
  model: string
  metrics: CondensationMetrics
  prefixTokens: number
  prefixReused?: boolean
  summaryTokens: number
  risks: CondensationRiskKind[]
  createdAt: string
  warnings?: string[]
  sourceFingerprint: string
}

export interface CondensationValidation {
  ok: boolean
  summary: string
  metrics: CondensationMetrics
  warnings: string[]
  error?: 'empty-summary' | 'truncated-summary' | 'not-smaller'
}

function textOfAtom(atom: ContextAtom): string {
  return [atom.toolName ?? '', atom.text].filter(Boolean).join(': ')
}

function estimateTextTokens(text: string): number {
  return Math.max(0, Math.ceil(String(text ?? '').length / 4))
}

/** Return the effective text that should be supplied to the summary model. */
export function condensationUnitText(
  unit: ContextEditableUnit,
  projectionStates?: ReadonlyMap<string, 'include' | 'exclude' | 'unavailable'>,
): string {
  if (unit.projectionState === 'exclude') return ''
  const atoms = (unit.atoms ?? []).filter((atom) => {
    const state = projectionStates?.get(atom.id)
    return state !== 'exclude' && state !== 'unavailable'
  })
  if ((unit.kind === 'user' || unit.kind === 'answer') && atoms.length === (unit.atoms ?? []).length) {
    return String(unit.effectiveText ?? '')
  }
  return atoms.map(textOfAtom).filter(Boolean).join('\n')
}

function atomRoot(atom: ContextAtom): number | undefined {
  const root = Number(atom.sourceRef?.entryId)
  return Number.isSafeInteger(root) ? root : undefined
}

function atomEntryId(atom: ContextAtom): string | undefined {
  const value = String(atom.sourceRef?.entryId ?? '')
  return value ? value : undefined
}

function sourceInfo(
  unit: ContextEditableUnit,
  projectionStates?: ReadonlyMap<string, 'include' | 'exclude' | 'unavailable'>,
): CondensationSourceUnit {
  const atoms = unit.atoms ?? []
  const entryIds = Array.from(new Set(atoms.map(atomEntryId).filter((value): value is string => value !== undefined)))
  const roots = Array.from(new Set(atoms.map(atomRoot).filter((value): value is number => value !== undefined))).sort((a, b) => a - b)
  const includedAtoms = atoms.filter((atom) => projectionStates?.get(atom.id) !== 'exclude' && projectionStates?.get(atom.id) !== 'unavailable')
  const text = condensationUnitText(unit, projectionStates)
  const toolNames = Array.from(new Set(includedAtoms.map((atom) => atom.toolName).filter((value): value is string => Boolean(value))))
  const approxTokens = includedAtoms.reduce((sum, atom) => sum + (Number(atom.approxTokens) || estimateTextTokens(atom.text)), 0)
  return {
    id: unit.id,
    recordId: unit.recordId,
    kind: unit.kind,
    atomIds: atoms.map((atom) => atom.id),
    ...(entryIds.length ? { sourceEntryIds: entryIds } : {}),
    sourceRootSeqs: roots,
    text,
    approxTokens: text ? Math.max(approxTokens, estimateTextTokens(text)) : 0,
    included: unit.projectionState !== 'exclude' && unit.projectionState !== 'unavailable' && includedAtoms.length > 0,
    ...(toolNames.length ? { toolNames } : {}),
    ...(includedAtoms.some((atom) => atom.isError) ? { isError: true } : {}),
    ...(includedAtoms.some((atom) => atom.hasSignature) ? { hasSignature: true } : {}),
    ...(includedAtoms.some((atom) => atom.structured) ? { structured: true } : {}),
  }
}

function risksFor(source: CondensationSourceUnit, unit: ContextEditableUnit): Set<CondensationRiskKind> {
  const risks = new Set<CondensationRiskKind>()
  if (source.kind === 'tool') risks.add('tool-output')
  if (source.kind === 'reasoning') risks.add('reasoning')
  if (source.structured) risks.add('structured-content')
  if (source.included === false || unit.projectionState === 'mixed') risks.add('already-excluded')
  return risks
}

/** Expand a contiguous editor selection to complete records/turns. */
export function selectCondensationRange(
  records: readonly ContextRecord[],
  requestedUnitIds: readonly string[],
  projectionStates?: ReadonlyMap<string, 'include' | 'exclude' | 'unavailable'>,
  options: { expandRelated?: boolean } = {},
): CondensationRange {
  const requested = Array.from(new Set((requestedUnitIds ?? []).map(String).filter(Boolean)))
  const positions = new Map<string, number>()
  records.forEach((record, index) => (record.units ?? []).forEach((unit) => positions.set(unit.id, index)))
  const unavailableUnitIds = requested.filter((id) => !positions.has(id))
  const selectedPositions = requested.map((id) => positions.get(id)).filter((value): value is number => value !== undefined)
  if (selectedPositions.length === 0) {
    return {
      requestedUnitIds: requested,
      effectiveUnitIds: [],
      autoExpandedUnitIds: [],
      recordIds: [],
      sourceRootSeqs: [],
      sourceUnits: [],
      shadowedTokenCount: 0,
      unavailableUnitIds,
      risks: [],
      sourceFingerprint: stableFingerprint([]),
    }
  }

  let first = Math.min(...selectedPositions)
  let last = Math.max(...selectedPositions)
  // Reasoning and tool records belonging to one turn may be separate records
  // in a host projection. Pull adjacent records sharing a turn/call identity
  // into the effective range so a selected answer cannot strand its tool log.
  const related = new Set<string>()
  for (const index of selectedPositions) {
    for (const atom of records[index]?.atoms ?? []) {
      if (atom.turnId) related.add(`turn:${atom.turnId}`)
      if (atom.toolCallId) related.add(`call:${atom.toolCallId}`)
    }
  }
  const recordRelated = (index: number) => (records[index]?.atoms ?? []).some((atom) =>
    (atom.turnId && related.has(`turn:${atom.turnId}`)) || (atom.toolCallId && related.has(`call:${atom.toolCallId}`)))
  let changed = true
  while (changed && options.expandRelated === true) {
    changed = false
    if (first > 0 && recordRelated(first - 1)) { first -= 1; changed = true }
    if (last + 1 < records.length && recordRelated(last + 1)) { last += 1; changed = true }
  }
  const effectiveUnits: Array<{ record: ContextRecord; unit: ContextEditableUnit }> = []
  for (let index = first; index <= last; index += 1) {
    const record = records[index]
    if (!record) continue
    for (const unit of record.units ?? []) {
      if (options.expandRelated === true || requested.includes(unit.id)) effectiveUnits.push({ record, unit })
    }
  }
  const effectiveUnitIds = effectiveUnits.map(({ unit }) => unit.id)
  const requestedSet = new Set(requested)
  const autoExpandedUnitIds = effectiveUnitIds.filter((id) => !requestedSet.has(id))
  const sourceUnits = effectiveUnits.map(({ unit }) => sourceInfo(unit, projectionStates))
  const sourceEntryIds = Array.from(new Set(sourceUnits.flatMap((unit) => unit.sourceEntryIds ?? [])))
  const sourceRootSeqs = Array.from(new Set(sourceUnits.flatMap((unit) => unit.sourceRootSeqs))).sort((a, b) => a - b)
  const risks = new Set<CondensationRiskKind>()
  sourceUnits.forEach((source, index) => {
    const item = effectiveUnits[index]
    if (item) risksFor(source, item.unit).forEach((risk) => risks.add(risk))
  })
  const unavailable = effectiveUnits
    .filter(({ unit, record }) => unit.projectionState === 'unavailable' || !unit.mutable || !record.mutable)
    .map(({ unit }) => unit.id)
  unavailableUnitIds.push(...unavailable.filter((id) => !unavailableUnitIds.includes(id)))
  const shadowedTokenCount = sourceUnits.filter((source) => !source.included).reduce((sum, source) => sum + source.approxTokens, 0)
  const sourceFingerprint = stableFingerprint(sourceUnits.flatMap((source) => [
    source.id,
    source.atomIds.join(','),
    (source.sourceEntryIds ?? []).join(','),
    source.text,
    source.included ? 'include' : 'exclude',
  ]))
  return {
    requestedUnitIds: requested,
    effectiveUnitIds,
    autoExpandedUnitIds,
    recordIds: Array.from(new Set(effectiveUnits.map(({ record }) => record.id))),
    ...(sourceEntryIds.length ? { sourceEntryIds } : {}),
    sourceRootSeqs,
    sourceUnits,
    shadowedTokenCount,
    unavailableUnitIds,
    risks: Array.from(risks),
    sourceFingerprint,
  }
}

/** Validate model or user edited output against the real framed replacement. */
export function validateCondensationSummary(
  summary: string,
  beforeTokens: number,
  options: { summaryTokens?: number; truncated?: boolean } = {},
): CondensationValidation {
  const value = String(summary ?? '').trim()
  const before = Math.max(0, Number(beforeTokens) || 0)
  const after = Math.max(0, Number(options.summaryTokens) || estimateTextTokens(frameCondensationSummary(value)))
  const saved = before - after
  const ratio = before > 0 ? Math.max(0, saved / before) : 0
  const metrics = {
    beforeTokens: before,
    afterTokens: after,
    savedTokens: saved,
    savingsRatio: ratio,
    belowRecommendedThreshold: ratio < 0.4 || saved < 500,
  }
  if (!value) return { ok: false, summary: value, metrics, warnings: [], error: 'empty-summary' }
  if (options.truncated) return { ok: false, summary: value, metrics, warnings: [], error: 'truncated-summary' }
  if (after >= before) return { ok: false, summary: value, metrics, warnings: [], error: 'not-smaller' }
  const warnings: string[] = []
  if (ratio < 0.4) warnings.push('savings-below-40-percent')
  if (saved < 500) warnings.push('savings-below-500-tokens')
  return { ok: true, summary: value, metrics, warnings }
}

/** Stable wrapper persisted in the model-facing message. */
export function frameCondensationSummary(summary: string): string {
  return `<condensed-context>\n${String(summary ?? '').trim()}\n</condensed-context>`
}

export function estimateCondensationTokens(value: string): number {
  return estimateTextTokens(value)
}

export interface CondensationChange {
  rootEventSeq: number
  mode: 'clear' | 'remove' | 'replace'
  message?: unknown
}

export interface CondensationEvent {
  schemaVersion: 1
  type: 'condensation'
  action: 'apply' | 'restore'
  status: 'pending' | 'applied' | 'restored'
  operationId: string
  sessionId: string
  baseRevision: string
  requestedUnitIds: string[]
  effectiveUnitIds: string[]
  recordIds: string[]
  sourceEntryIds?: string[]
  sourceRootSeqs: number[]
  sourceFingerprint: string
  sourceUnits: CondensationSourceUnit[]
  summary: string
  provider: string
  model: string
  metrics: CondensationMetrics
  prefixTokens: number
  prefixReused?: boolean
  summaryTokens: number
  createdAt: string
  beforeChanges: CondensationChange[]
  afterChanges: CondensationChange[]
  restoreEventSeq?: number
  coverage?: ContextCondensationCoverage
}
