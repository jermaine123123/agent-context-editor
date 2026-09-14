/**
 * DeepSeek Harness Host adapter.
 *
 * The adapter reads the complete durable Session event log, projects only
 * finalized user/AI/tool records, stores visual V2 view events in a separate
 * storage-domain sidecar, and folds native `context/projection` events into
 * model-derived messages. Surface events and normal Chat display remain unchanged.
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { foldSurface } from '@deepseek-ai/dsh-session'
import { reduceReplacementStates, selectAssociatedReasoningTargets, selectProjectionTargets, selectCondensationRange, validateCondensationSummary, frameCondensationSummary, estimateCondensationTokens, deriveCondensationCoverage } from './core-runtime.js'
import {
  buildProjection,
  buildViewEvent,
  composeNativeRoot,
  inverseChanges,
  latestUndoableEvent,
  normalizeReplacementEvents,
  normalizeViewEvents,
  projectRecords,
  recordSnapshot,
  sameSessionLifecycle,
  searchRecords,
  sessionIdentity,
  CONTEXT_PROJECTION_OWNER,
} from './core.js'
import { PACKAGE_NAME } from './typert.js'

export const inject = ['storageDomain', 'sessionPersistence', 'sessions', 'agents', 'llm']

const viewStateSchema = z.enum(['show', 'collapse', 'hide'])
function asObject(value) {
  return value !== null && typeof value === 'object' ? value : {}
}

const nonNegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const viewChangeSchema = z.object({
  atomId: z.string().min(1),
  fingerprint: z.string().min(1),
  before: viewStateSchema,
  after: viewStateSchema,
})
const viewEventSchema = z.object({
  version: z.literal(2),
  transactionId: z.string().min(1),
  createdAt: z.string(),
  baseRevision: z.string(),
  action: z.enum(['hide', 'restore', 'reset', 'undo']),
  changes: z.array(viewChangeSchema).min(1),
  undoOf: z.string().optional(),
})
const linkedExclusionSchema = z.object({
  operationId: z.string().min(1),
  unitIds: z.array(z.string().min(1)),
  atomChanges: z.array(z.object({
    atomId: z.string().min(1),
    fingerprint: z.string().min(1),
    sourceRef: z.object({ entryId: z.string(), blockIndex: nonNegativeSafeInteger }),
    before: z.enum(['include', 'exclude']),
    after: z.enum(['include', 'exclude']),
  })),
})
const replacementEventSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('replacement'),
  action: z.enum(['replace', 'restore', 'undo']),
  eventId: z.string().min(1),
  unitId: z.string().min(1),
  unitKind: z.enum(['user', 'answer']),
  atomRefs: z.array(z.object({
    atomId: z.string().min(1),
    sourceRef: z.object({ entryId: z.string(), blockIndex: nonNegativeSafeInteger }),
    fingerprint: z.string().min(1),
  })).optional(),
  beforeText: z.string().nullable().optional(),
  afterText: z.string().nullable().optional(),
  undoOf: z.string().min(1).optional(),
  baseRevision: z.union([z.string(), z.number()]),
  createdAt: z.string(),
  linkedExclusion: linkedExclusionSchema.optional(),
}).passthrough()
const condensationChangeSchema = z.object({
  rootEventSeq: nonNegativeSafeInteger,
  mode: z.enum(['clear', 'remove', 'replace']),
  message: z.unknown().optional(),
}).passthrough()
const condensationSourceUnitSchema = z.object({
  id: z.string().min(1),
  recordId: z.string().min(1),
  kind: z.enum(['reasoning', 'answer', 'user', 'tool']),
  atomIds: z.array(z.string()),
  sourceEntryIds: z.array(z.string()).optional(),
  sourceRootSeqs: z.array(nonNegativeSafeInteger),
  text: z.string(),
  approxTokens: z.number().nonnegative(),
  included: z.boolean(),
}).passthrough()
const nativeCompactionRefSchema = z.object({
  host: z.string().min(1),
  compactionId: z.string().min(1),
  shadowedRootSeqs: z.array(nonNegativeSafeInteger),
  startSeq: nonNegativeSafeInteger.optional(),
  shadowedRange: z.object({ start: nonNegativeSafeInteger, end: nonNegativeSafeInteger }).optional(),
  summarySeq: nonNegativeSafeInteger.optional(),
  checkpointSeq: nonNegativeSafeInteger.optional(),
  endSeq: nonNegativeSafeInteger.optional(),
  committed: z.boolean().optional(),
}).passthrough()
const condensationCoverageSchema = z.object({
  status: z.enum(['none', 'partial', 'full']),
  restoreMode: z.enum(['inline', 'checkpoint', 'unavailable']),
  coveredSourceRootSeqs: z.array(nonNegativeSafeInteger),
  uncoveredSourceRootSeqs: z.array(nonNegativeSafeInteger),
  nativeCompactions: z.array(nativeCompactionRefSchema),
  checkpointCompactionId: z.string().optional(),
  checkpointSeq: nonNegativeSafeInteger.optional(),
  reason: z.enum(['native-compaction-absorbed-source', 'checkpoint-unavailable']).optional(),
}).passthrough()
const condensationEventSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('condensation'),
  action: z.enum(['apply', 'restore']),
  status: z.enum(['pending', 'applied', 'restored']).optional(),
  operationId: z.string().min(1),
  sessionId: z.string().min(1),
  baseRevision: z.string(),
  requestedUnitIds: z.array(z.string()),
  effectiveUnitIds: z.array(z.string()),
  recordIds: z.array(z.string()),
  sourceRootSeqs: z.array(nonNegativeSafeInteger),
  sourceFingerprint: z.string(),
  sourceUnits: z.array(condensationSourceUnitSchema),
  summary: z.string(),
  provider: z.string(),
  model: z.string(),
  metrics: z.object({
    beforeTokens: z.number(), afterTokens: z.number(), savedTokens: z.number(), savingsRatio: z.number(), belowRecommendedThreshold: z.boolean(),
  }),
  prefixTokens: z.number(),
  summaryTokens: z.number(),
  createdAt: z.string(),
  beforeChanges: z.array(condensationChangeSchema),
  afterChanges: z.array(condensationChangeSchema),
  restoreEventSeq: nonNegativeSafeInteger.optional(),
  coverage: condensationCoverageSchema.optional(),
}).passthrough()
const sidecarRowSchema = z.object({
  session: z.object({
    createdAt: nonNegativeSafeInteger,
    cwd: z.string().optional(),
  }),
  schemaVersion: z.literal(1),
  storageVersion: z.literal(1),
  events: z.array(viewEventSchema),
  replacementEvents: z.array(replacementEventSchema).optional(),
  condensationEvents: z.array(condensationEventSchema).optional(),
})

export const contextEditorDomainSpec = defineDomain({
  name: 'context_editor',
  version: 1,
  tables: {
    sessions: domainTable(sidecarRowSchema),
  },
})

function requestSessionId(request) {
  const value = request && typeof request === 'object' ? request : {}
  if (value.locator?.host !== undefined && value.locator.host !== 'deepseek-harness') {
    throw new Error('CONTEXT_EDITOR_HOST_MISMATCH')
  }
  return String(value.sessionId ?? value.locator?.sessionId ?? '')
}

function identityFromInspection(inspection, sessionId) {
  const meta = inspection?.meta ?? inspection?.header ?? {}
  return sessionIdentity({
    id: meta.id ?? sessionId,
    createdAt: meta.createdAt,
    cwd: meta.cwd,
  })
}

function randomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function clampPageSize(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) return 50
  return Math.min(200, Math.max(1, number))
}

function asPageCursor(value) {
  const number = Number.parseInt(String(value ?? '0'), 10)
  return Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function isBusySession(ctx, sessionId) {
  const agent = ctx?.agents?.get?.(sessionId)
  if (agent !== undefined) return agent.status === 'running'
  const live = ctx?.sessions?.get?.(sessionId)
  if (live === undefined) return false
  const snapshot = live.getSnapshot?.()
  return Boolean(snapshot?.running ?? live.running ?? live.status === 'running')
}

function success(snapshot, extra = {}) {
  return { ok: true, ...extra, snapshot }
}

function messageForRoot(event) {
  const value = event && typeof event === 'object' ? event : {}
  const data = value.data && typeof value.data === 'object' ? value.data : {}
  if (value.type === 'user/message') return data
  if (value.type === 'assistant/message') return data.message
  if (value.type === 'tool/result') return data.message
  return undefined
}

function validCondensationChange(value) {
  const raw = asObject(value)
  const root = Number(raw.rootEventSeq)
  return Number.isSafeInteger(root) && root >= 0
    && ['clear', 'remove', 'replace'].includes(raw.mode)
}

function validCondensationEvent(value) {
  const raw = asObject(value)
  return raw.schemaVersion === 1
    && raw.type === 'condensation'
    && typeof raw.operationId === 'string' && raw.operationId.length > 0
    && typeof raw.sessionId === 'string'
    && ['apply', 'restore'].includes(raw.action)
    && Array.isArray(raw.sourceRootSeqs)
    && Array.isArray(raw.beforeChanges) && raw.beforeChanges.every(validCondensationChange)
    && Array.isArray(raw.afterChanges) && raw.afterChanges.every(validCondensationChange)
    && typeof raw.summary === 'string'
}

function normalizeCondensationEvents(events) {
  return (Array.isArray(events) ? events : []).filter(validCondensationEvent).map(value => {
    const raw = asObject(value)
    const metrics = asObject(raw.metrics)
    const sourceUnits = Array.isArray(raw.sourceUnits) ? raw.sourceUnits.map(value => {
      const unit = asObject(value)
      return {
        ...unit,
        id: String(unit.id ?? ''),
        recordId: String(unit.recordId ?? ''),
        kind: String(unit.kind ?? 'tool'),
        atomIds: Array.isArray(unit.atomIds) ? unit.atomIds.map(String) : [],
        ...(Array.isArray(unit.sourceEntryIds) ? { sourceEntryIds: unit.sourceEntryIds.map(String) } : {}),
        sourceRootSeqs: Array.isArray(unit.sourceRootSeqs) ? unit.sourceRootSeqs.map(Number).filter(Number.isSafeInteger) : [],
        text: String(unit.text ?? ''),
        approxTokens: Number(unit.approxTokens) || 0,
        included: unit.included !== false,
      }
    }) : []
    return {
      ...raw,
      schemaVersion: 1,
      type: 'condensation',
      action: raw.action === 'restore' ? 'restore' : 'apply',
      status: raw.status === 'pending' ? 'pending' : raw.status === 'restored' ? 'restored' : 'applied',
      operationId: String(raw.operationId),
      sessionId: String(raw.sessionId),
      baseRevision: String(raw.baseRevision ?? ''),
      requestedUnitIds: Array.isArray(raw.requestedUnitIds) ? raw.requestedUnitIds.map(String) : [],
      effectiveUnitIds: Array.isArray(raw.effectiveUnitIds) ? raw.effectiveUnitIds.map(String) : [],
      recordIds: Array.isArray(raw.recordIds) ? raw.recordIds.map(String) : [],
      sourceRootSeqs: Array.isArray(raw.sourceRootSeqs) ? raw.sourceRootSeqs.map(Number).filter(Number.isSafeInteger) : [],
      sourceFingerprint: String(raw.sourceFingerprint ?? ''),
      sourceUnits,
      summary: String(raw.summary),
      provider: String(raw.provider ?? ''),
      model: String(raw.model ?? ''),
      metrics: {
        beforeTokens: Number(metrics.beforeTokens) || 0,
        afterTokens: Number(metrics.afterTokens) || 0,
        savedTokens: Number(metrics.savedTokens) || 0,
        savingsRatio: Number(metrics.savingsRatio) || 0,
        belowRecommendedThreshold: Boolean(metrics.belowRecommendedThreshold),
      },
      prefixTokens: Number(raw.prefixTokens) || 0,
      summaryTokens: Number(raw.summaryTokens) || 0,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
      beforeChanges: raw.beforeChanges.map(change => ({ ...change, rootEventSeq: Number(change.rootEventSeq) })),
      afterChanges: raw.afterChanges.map(change => ({ ...change, rootEventSeq: Number(change.rootEventSeq) })),
      ...(Number.isSafeInteger(raw.restoreEventSeq) ? { restoreEventSeq: Number(raw.restoreEventSeq) } : {}),
      ...(raw.coverage && ['none', 'partial', 'full'].includes(raw.coverage.status)
        ? { coverage: normalizeCondensationCoverage(raw.coverage) }
        : {}),
    }
  })
}

function normalizeCondensationCoverage(value) {
  const raw = asObject(value)
  const refs = Array.isArray(raw.nativeCompactions) ? raw.nativeCompactions.map(item => {
    const ref = asObject(item)
    return {
      ...ref,
      host: String(ref.host ?? ''),
      compactionId: String(ref.compactionId ?? ''),
      shadowedRootSeqs: Array.isArray(ref.shadowedRootSeqs) ? ref.shadowedRootSeqs.map(Number).filter(Number.isSafeInteger) : [],
      ...(Number.isSafeInteger(ref.startSeq) ? { startSeq: Number(ref.startSeq) } : {}),
      ...(ref.shadowedRange && Number.isSafeInteger(ref.shadowedRange.start) && Number.isSafeInteger(ref.shadowedRange.end)
        ? { shadowedRange: { start: Number(ref.shadowedRange.start), end: Number(ref.shadowedRange.end) } }
        : {}),
      ...(Number.isSafeInteger(ref.summarySeq) ? { summarySeq: Number(ref.summarySeq) } : {}),
      ...(Number.isSafeInteger(ref.checkpointSeq) ? { checkpointSeq: Number(ref.checkpointSeq) } : {}),
      ...(Number.isSafeInteger(ref.endSeq) ? { endSeq: Number(ref.endSeq) } : {}),
      ...(typeof ref.committed === 'boolean' ? { committed: ref.committed } : {}),
    }
  }).filter(ref => ref.host && ref.compactionId && ref.shadowedRootSeqs.length > 0) : []
  return {
    status: ['none', 'partial', 'full'].includes(raw.status) ? raw.status : 'none',
    restoreMode: ['inline', 'checkpoint', 'unavailable'].includes(raw.restoreMode) ? raw.restoreMode : 'inline',
    coveredSourceRootSeqs: Array.isArray(raw.coveredSourceRootSeqs) ? raw.coveredSourceRootSeqs.map(Number).filter(Number.isSafeInteger) : [],
    uncoveredSourceRootSeqs: Array.isArray(raw.uncoveredSourceRootSeqs) ? raw.uncoveredSourceRootSeqs.map(Number).filter(Number.isSafeInteger) : [],
    nativeCompactions: refs,
    ...(typeof raw.checkpointCompactionId === 'string' ? { checkpointCompactionId: raw.checkpointCompactionId } : {}),
    ...(Number.isSafeInteger(raw.checkpointSeq) ? { checkpointSeq: Number(raw.checkpointSeq) } : {}),
    ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
  }
}

function nativeCondensationOperationId(event) {
  const data = asObject(event?.data)
  if (data.condensationOperationId !== undefined) return String(data.condensationOperationId)
  if (data.condensation?.operationId !== undefined) return String(data.condensation.operationId)
  return undefined
}

export function nativeCompactionRefs(sourceEvents) {
  return nativeCompactionEvidence(sourceEvents).filter(ref => ref.committed === true)
}

/**
 * Rebuild native compaction evidence from the durable event log.
 *
 * A summary/end pair without a persisted Surface replacement is deliberately
 * retained as uncommitted evidence. It is not counted as covered content, but
 * callers can surface an unavailable recovery path instead of guessing that
 * the selective operation is still restorable inline.
 */
export function nativeCompactionEvidence(sourceEvents) {
  const starts = new Map()
  const summaries = new Map()
  const ends = new Map()
  for (const event of Array.isArray(sourceEvents) ? sourceEvents : []) {
    const data = asObject(event?.data)
    if (event?.type === 'compaction/start' && data.compactionId !== undefined) {
      starts.set(String(data.compactionId), { event, data })
    } else if (event?.type === 'compaction/summary' && data.compactionId !== undefined) {
      summaries.set(String(data.compactionId), { event, data })
    } else if (event?.type === 'compaction/end' && data.compactionId !== undefined) {
      ends.set(String(data.compactionId), { event, data })
    }
  }
  const refs = []
  for (const [compactionId, summary] of summaries) {
    const end = ends.get(compactionId)
    if (end?.data.error !== undefined && end.data.error !== null) continue
    const shadowedRootSeqs = Array.isArray(summary.data.shadowedSeqs)
      ? summary.data.shadowedSeqs.map(Number).filter(Number.isSafeInteger)
      : []
    if (!shadowedRootSeqs.length) continue
    const summarySeq = eventSequence(summary.event)
    const endSeq = eventSequence(end.event)
    const checkpoint = (Array.isArray(sourceEvents) ? sourceEvents : []).find(event => {
      if (event?.type !== 'user/message') return false
      const sources = Array.isArray(event.sourceEventSeqs)
        ? event.sourceEventSeqs
        : Array.isArray(event?.data?.sourceEventSeqs) ? event.data.sourceEventSeqs : []
      const surfaceOp = event.surfaceOp ?? event?.data?.surfaceOp
      const sourceNumbers = sources.map(Number)
      const startSeq = eventSequence(starts.get(compactionId)?.event)
      const shadowedRange = summary.data.shadowedRange
      const rangeMatches = !shadowedRange || (surfaceOp?.start === Number(shadowedRange.start) && surfaceOp?.end === Number(shadowedRange.end))
      return surfaceOp?.op === 'replace'
        && summarySeq !== undefined
        && (startSeq === undefined || (eventSequence(event) ?? -1) > startSeq)
        && (endSeq === undefined || (eventSequence(event) ?? Number.MAX_SAFE_INTEGER) < endSeq)
        && sourceNumbers.includes(summarySeq)
        && (startSeq === undefined || sourceNumbers.includes(startSeq))
        && shadowedRootSeqs.every(root => sourceNumbers.includes(root))
        && rangeMatches
    })
    const checkpointSeq = eventSequence(checkpoint)
    // A summary/end pair alone is not proof that the host replaced its
    // current Surface. Keep the relation explicitly uncommitted so recovery
    // can report the missing proof without treating the range as covered.
    refs.push({
      host: 'deepseek-harness',
      compactionId,
      shadowedRootSeqs: Array.from(new Set(shadowedRootSeqs)).sort((a, b) => a - b),
      ...(eventSequence(starts.get(compactionId)?.event) === undefined ? {} : { startSeq: eventSequence(starts.get(compactionId)?.event) }),
      ...(Number.isSafeInteger(summary.data.shadowedRange?.start) && Number.isSafeInteger(summary.data.shadowedRange?.end)
        ? { shadowedRange: { start: Number(summary.data.shadowedRange.start), end: Number(summary.data.shadowedRange.end) } }
        : {}),
      ...(summarySeq === undefined ? {} : { summarySeq }),
      ...(checkpointSeq === undefined ? {} : { checkpointSeq }),
      ...(endSeq === undefined ? {} : { endSeq }),
      committed: checkpointSeq !== undefined && end !== undefined,
    })
  }
  return refs
}

function activeCondensationEvents(rowEvents, sourceEvents) {
  const applied = new Set()
  const restored = new Set()
  for (const event of Array.isArray(sourceEvents) ? sourceEvents : []) {
    const id = nativeCondensationOperationId(event)
    if (!id) continue
    const action = asObject(event.data).condensationAction ?? asObject(event.data).condensation?.action
    if (action === 'restore') restored.add(id)
    else if (action === 'apply') applied.add(id)
  }
  const compactions = nativeCompactionEvidence(sourceEvents)
  return normalizeCondensationEvents(rowEvents)
    .filter(event => event.status !== 'restored' && applied.has(event.operationId) && !restored.has(event.operationId))
    .map(event => ({
      ...event,
      coverage: deriveCondensationCoverage(event.sourceRootSeqs, compactions),
    }))
}

function condensationSnapshot(event, projection) {
  const firstRoot = Number(event.sourceRootSeqs?.[0])
  const overlay = projection?.contextOverlays?.get(firstRoot)
  const contextExcluded = overlay?.mode === 'remove' || !(overlay?.message?.content ?? []).some(block => block.type === 'text' && block.text === frameCondensationSummary(event.summary))
  return {
    operationId: event.operationId,
    status: event.status === 'restored' ? 'restored' : 'applied',
    summary: event.summary,
    requestedUnitIds: event.requestedUnitIds,
    effectiveUnitIds: event.effectiveUnitIds,
    sourceRootSeqs: event.sourceRootSeqs,
    sourceUnits: event.sourceUnits.map(unit => ({
      id: unit.id,
      recordId: unit.recordId,
      kind: unit.kind,
      atomIds: unit.atomIds,
      sourceRootSeqs: unit.sourceRootSeqs,
      text: unit.text,
      included: unit.included,
      approxTokens: unit.approxTokens,
      ...(unit.toolNames?.length ? { toolNames: unit.toolNames } : {}),
      ...(unit.isError ? { isError: true } : {}),
      ...(unit.hasSignature ? { hasSignature: true } : {}),
      ...(unit.structured ? { structured: true } : {}),
    })),
    metrics: event.metrics,
    provider: event.provider,
    model: event.model,
    createdAt: event.createdAt,
    contextExcluded,
    ...(event.coverage ? { coverage: event.coverage } : {}),
  }
}

function estimateMessageTokens(message) {
  try { return estimateCondensationTokens(JSON.stringify(message ?? '')) } catch { return 0 }
}

function eventSequence(event) {
  const seq = Number(event?.seq)
  return Number.isSafeInteger(seq) ? seq : undefined
}

export function messagesBefore(projection, endRoot) {
  const messages = []
  const seen = new Set()
  const events = [...(projection.sourceEvents ?? [])].sort((a, b) => (eventSequence(a) ?? 0) - (eventSequence(b) ?? 0))
  const activeSurface = Array.isArray(projection.activeSurfaceSeqs)
    ? new Set(projection.activeSurfaceSeqs.map(Number).filter(Number.isSafeInteger))
    : undefined
  for (const event of events) {
    const root = eventSequence(event)
    if (root === undefined || root > endRoot || seen.has(root)) continue
    if (activeSurface !== undefined && !activeSurface.has(root)) continue
    const original = messageForRoot(event)
    if (original === undefined) continue
    const overlay = projection.contextOverlays?.get(root)
    if (overlay?.mode === 'remove') {
      seen.add(root)
      continue
    }
    const composed = composeNativeRoot(projection, root)
    const message = overlay?.mode === 'replace' ? overlay.message : composed.message ?? original
    if (message !== undefined) messages.push(structuredClone(message))
    seen.add(root)
  }
  return messages
}

function condensationInput(range) {
  const lines = []
  for (const source of range.sourceUnits) {
    if (!source.included || !source.text.trim()) continue
    const facts = [
      `[${source.kind}] ${source.id}`,
      source.toolNames?.length ? `tools=${source.toolNames.join(',')}` : '',
      source.isError ? 'status=error' : '',
      source.hasSignature ? 'signed-or-opaque-block=true' : '',
    ].filter(Boolean).join(' ')
    lines.push(`${facts}\n${source.text}`)
  }
  return lines.join('\n\n')
}

function condensationInstruction(range) {
  const originalTokens = range.sourceUnits.filter(source => source.included).reduce((sum, source) => sum + source.approxTokens, 0)
  const targetTokens = Math.max(1, Math.floor(originalTokens * 0.5))
  return [
    'Only condense the selected context below. Return the summary text only; do not add a preamble or markdown fence.',
    'Write the summary in the same natural language as the selected conversation. For mixed-language content, follow the user-facing prose, not the language of code, logs, or these instructions. If the conversation is Chinese, write the summary in Chinese. Keep identifiers, paths and commands verbatim.',
    'Condense rather than paraphrase line by line: merge repeated facts, remove filler and redundant narration, retain decisions and essential evidence rather than a step-by-step reasoning transcript. Use compact paragraphs or a short list; avoid large headings and repeated labels.',
    'Aim to reduce the selected content by at least 40%, preferably around 50–70%, while preserving essential facts. If those facts cannot fit, preserve them rather than inventing or silently dropping them.',
    'Approximate original size: ' + originalTokens + ' tokens. Aim for about ' + targetTokens + ' tokens of summary; this is a target, not permission to truncate essential facts.',
    'Preserve the user goal, constraints, conclusions and evidence, unfinished work, and important file paths, commands, parameters, results, errors, modifications, and artifact locations.',
    'Keep reasoning and tool facts that are needed to continue safely. Do not invent facts. Mark uncertain or omitted details explicitly.',
    '<selected-context>',
    condensationInput(range),
    '</selected-context>',
  ].join('\n')
}

function beforeChangeForRoot(projection, root) {
  const overlay = projection.contextOverlays?.get(root)
  if (!overlay) return { rootEventSeq: root, mode: 'clear' }
  if (overlay.mode === 'remove') return { rootEventSeq: root, mode: 'remove' }
  return { rootEventSeq: root, mode: 'replace', message: structuredClone(overlay.message) }
}

function condensationRole(projection, sourceRootSeqs) {
  // Native projection replacements preserve the append root role, including
  // ranges beginning with an assistant reasoning or answer message.
  const original = (projection.sourceEvents ?? []).find(event => eventSequence(event) === sourceRootSeqs[0])
  const role = messageForRoot(original)?.role
  if (!['user', 'assistant', 'system'].includes(role)) throw new Error('CONTEXT_EDITOR_CONDENSATION_SOURCE_GONE')
  return role
}
function buildCondensationChanges(projection, sourceRootSeqs, summary, operationId, sourceUnits = []) {
  const roots = Array.from(new Set(sourceRootSeqs.map(Number).filter(value => Number.isSafeInteger(value)))).sort((a, b) => a - b)
  if (!roots.length) throw new Error('CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY')
  const first = roots[0]
  const beforeChanges = roots.map(root => beforeChangeForRoot(projection, root))
  const summaryMessage = {
    id: `condensed-context-${operationId}`,
    role: condensationRole(projection, roots, sourceUnits),
    source: { kind: 'plugin', plugin: PACKAGE_NAME, form: 'condensation' },
    content: [{ type: 'text', text: frameCondensationSummary(summary) }],
  }
  const selectedAtoms = new Set(sourceUnits.flatMap(unit => unit.atomIds ?? []))
  const selectedUnits = new Set(sourceUnits.map(unit => unit.id))
  const afterChanges = roots.map(root => {
    const composed = composeNativeRoot(projection, root)
    const content = []
    let inserted = false
    for (const pair of composed.pairs) {
      const selected = selectedAtoms.has(pair.atomId) || selectedUnits.has(pair.unitId)
        || (composed.message?.role === 'user' && sourceUnits.some(unit => unit.kind === 'user' && unit.sourceRootSeqs.includes(root)))
      if (selected) {
        if (root === first && !inserted) { content.push(summaryMessage.content[0]); inserted = true }
        continue
      }
      if (pair.atomId && ['exclude', 'unavailable'].includes(projection.projectionStates?.get(pair.atomId))) continue
      content.push(structuredClone(pair.block))
    }
    if (root === first && !inserted) content.unshift(summaryMessage.content[0])
    if (!content.length) return { rootEventSeq: root, mode: 'remove' }
    return { rootEventSeq: root, mode: 'replace', message: { ...structuredClone(composed.message), id: root === first ? summaryMessage.id : summaryMessage.id + '-' + root, source: summaryMessage.source, content } }
  })
  return { beforeChanges, afterChanges, summaryMessage }
}

function collectStreamText(stream) {
  return (async () => {
    const deltas = []
    const blocks = new Map()
    let finish
    let usage
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta') {
        const text = String(chunk.text ?? '')
        if (text) deltas.push(text)
      } else if (chunk?.type === 'block-end') {
        const block = asObject(chunk.block)
        if (block.type === 'text' && typeof block.text === 'string') blocks.set(Number(chunk.index), block.text)
      } else if (chunk?.type === 'usage') usage = chunk.usage
      else if (chunk?.type === 'finish') finish = chunk.reason
    }
    const text = deltas.length ? deltas.join('') : Array.from(blocks.values()).join('')
    const reasonKind = typeof finish === 'string' ? finish : finish?.kind ?? finish?.reason?.kind
    if (reasonKind === 'error') {
      const failure = finish?.failure ?? finish?.reason?.failure
      const detail = [failure?.code, failure?.message].filter(value => typeof value === 'string' && value.trim()).join(': ')
      throw new Error('CONTEXT_EDITOR_CONDENSATION_MODEL_ERROR' + (detail ? ': ' + detail : ''))
    }
    if (reasonKind === 'aborted' || reasonKind === 'cancelled') throw new Error('CONTEXT_EDITOR_CONDENSATION_CANCELLED')
    return { text, usage, truncated: ['max-tokens', 'length', 'truncated', 'limit'].includes(String(reasonKind)) }
  })()
}

function requestHeaderFor(session) {
  try { return session?.requestHeader?.() ?? session?.header ?? {} } catch { return session?.header ?? {} }
}

function modelTarget(session, request = {}) {
  const header = requestHeaderFor(session)
  const configured = asObject(header.config)
  const provider = String(request.provider ?? configured.provider ?? '')
  const model = String(request.model ?? configured.model ?? '')
  if (!provider || !model) throw new Error('CONTEXT_EDITOR_CONDENSATION_MODEL_REQUIRED')
  return { provider, model, header }
}

function rootEventExists(projection, root) {
  if (!(projection.sourceEvents ?? []).some(event => eventSequence(event) === root)) return false
  const atoms = (projection.atoms ?? []).filter(atom => Number(atom.sourceRef?.entryId) === root)
  if (!atoms.length) return false
  return atoms.some(atom => projection.projectionStates?.get(atom.id) !== 'unavailable')
}

function overlappingCondensation(projection, roots, operationId) {
  const selected = new Set(roots)
  return (projection.condensationEvents ?? []).find(event => event.operationId !== operationId
    && event.sourceRootSeqs.some(root => selected.has(Number(root))))
}

function conflictingOverlay(projection, roots, operationId) {
  for (const root of roots) {
    const overlay = projection.contextOverlays?.get(root)
    if (overlay
      && String(overlay.operationId ?? '') !== String(operationId ?? '')
      && String(overlay.owner ?? '') !== CONTEXT_PROJECTION_OWNER) return { root, overlay }
  }
  return undefined
}

function activeCondensationForUnits(projection, unitIds) {
  const requested = new Set((unitIds ?? []).map(String))
  if (!requested.size) return undefined
  return (projection.condensationEvents ?? []).find(event => event.effectiveUnitIds.some(id => requested.has(String(id))))
}

function condensationSurfaceEvent(projection, request, unitIds) {
  const operationId = String(request?.condensationOperationId ?? '')
  if (!operationId) return undefined
  const event = (projection.condensationEvents ?? []).find(value => value.operationId === operationId)
  if (!event) return undefined
  const firstRoot = event.sourceRootSeqs?.[0]
  const firstUnit = (event.sourceUnits ?? []).find(unit => unit.sourceRootSeqs?.includes(firstRoot))
  const requested = Array.from(new Set((unitIds ?? []).map(String)))
  return firstUnit?.id !== undefined && requested.length === 1 && requested[0] === String(firstUnit.id)
    ? event
    : undefined
}

function isCondensationSurfaceOperation(projection, request, unitIds) {
  return condensationSurfaceEvent(projection, request, unitIds) !== undefined
}

function buildCondensationSurfaceChanges(projection, event, action) {
  if (action !== 'exclude' && action !== 'restore') throw new Error('CONTEXT_EDITOR_CONTEXT_ACTION_INVALID')
  const root = Number(event.sourceRootSeqs?.[0])
  const overlay = projection.contextOverlays?.get(root)
  const summaryChange = (event.afterChanges ?? []).find(change => Number(change.rootEventSeq) === root && change.mode === 'replace')
  const summaryMessage = summaryChange?.message
  if (!Number.isSafeInteger(root) || !summaryMessage) throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_UNAVAILABLE')
  const visible = isCondensationSummaryOverlay(overlay, event)
  if (overlay?.mode !== 'remove' && !visible) throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_UNAVAILABLE')
  const hasSummary = (overlay?.message?.content ?? []).some(block => block.type === 'text' && block.text === frameCondensationSummary(event.summary))
  const withoutSummary = structuredClone(summaryMessage)
  withoutSummary.content = withoutSummary.content.filter(block => !(block.type === 'text' && block.text === frameCondensationSummary(event.summary)))
  const changes = action === 'exclude'
    ? (!hasSummary ? [] : [withoutSummary.content.length ? { rootEventSeq: root, mode: 'replace', message: withoutSummary } : { rootEventSeq: root, mode: 'remove' }])
    : (hasSummary ? [] : [{ rootEventSeq: root, mode: 'replace', message: structuredClone(summaryMessage) }])
  const summaryTokens = estimateCondensationTokens(frameCondensationSummary(event.summary))
  const before = hasSummary ? summaryTokens : 0
  const after = action === 'restore' ? summaryTokens : 0
  const firstUnit = (event.sourceUnits ?? []).find(unit => unit.sourceRootSeqs?.includes(root))
  return {
    changes,
    selection: {
      requestedUnitIds: firstUnit ? [firstUnit.id] : [],
      effectiveUnitIds: firstUnit ? [firstUnit.id] : [],
      autoExpandedUnitIds: [],
      recordIds: firstUnit ? [firstUnit.recordId] : [],
      unavailableUnitIds: [],
    },
    tokenEstimate: { before, after, delta: after - before },
  }
}

function isCondensationSummaryOverlay(overlay, event) {
  if (overlay?.mode !== 'replace' || !overlay.message) return false
  if (String(overlay.message.id ?? '') === `condensed-context-${event.operationId}`) return true
  const content = Array.isArray(overlay.message.content) ? overlay.message.content : []
  return content.some(block => asObject(block).type === 'text'
    && String(asObject(block).text ?? '') === frameCondensationSummary(event.summary))
}

function summaryValidationError(validation) {
  if (validation.error === 'empty-summary') return 'CONTEXT_EDITOR_CONDENSATION_EMPTY'
  if (validation.error === 'truncated-summary') return 'CONTEXT_EDITOR_CONDENSATION_TRUNCATED'
  return 'CONTEXT_EDITOR_CONDENSATION_NOT_SHORTER'
}

function cleanCondensationOutput(value) {
  let text = String(value ?? '').trim()
  text = text.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim()
  text = text.replace(/^<condensed-context>\s*/i, '').replace(/\s*<\/condensed-context>$/i, '').trim()
  return text
}




function cloneReplacementMessage(original, excludedBlockIndices, replacementId) {
  const copy = structuredClone(original)
  const blocks = Array.isArray(copy?.content) ? copy.content : []
  copy.content = blocks.filter((_block, index) => !excludedBlockIndices.has(index))
  copy.id = replacementId ?? globalThis.crypto?.randomUUID?.() ?? randomId('context-message')
  if (copy.role === 'assistant' && copy.source?.kind === 'model') {
    const source = copy.source
    const { replayState: _replayState, ...safeSource } = source
    copy.source = safeSource
  }
  return copy
}

function cloneComposedMessage(composed, excludedAtomIds, replacementId) {
  const copy = structuredClone(composed.message)
  copy.content = composed.pairs
    .filter(pair => !pair.atomId || !excludedAtomIds.has(pair.atomId))
    .map(pair => pair.block)
  copy.id = replacementId ?? globalThis.crypto?.randomUUID?.() ?? randomId('context-message')
  if (copy.role === 'assistant' && copy.source?.kind === 'model') {
    const source = asObject(copy.source)
    const { replayState: _replayState, ...safeSource } = source
    copy.source = safeSource
  }
  return copy
}

function sameJson(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function sameIdSet(left, right) {
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

function sameOptionalIdList(left, right) {
  if (left === undefined || right === undefined) return left === right
  return sameIdSet(new Set(left.map(String)), new Set(right.map(String)))
}

function assertContextOperationReuse(stored, sessionId, action, unitIds, recordIds) {
  if (stored === undefined) return
  if (stored.sessionId !== sessionId || stored.action !== action
    || !sameOptionalIdList(stored.unitIds, unitIds)
    || !sameOptionalIdList(stored.recordIds, recordIds)) {
    throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
  }
}

function buildNativeContextChanges(projection, action, request) {
  if (action !== 'exclude' && action !== 'restore') throw new Error('CONTEXT_EDITOR_CONTEXT_ACTION_INVALID')
  const selection = selectProjectionTargets(
    projection.records,
    Array.isArray(request?.unitIds) ? request.unitIds.map(String) : undefined,
    Array.isArray(request?.recordIds) ? request.recordIds.map(String) : undefined,
  )
  if (selection.unavailableUnitIds.length > 0) {
    throw new Error('CONTEXT_EDITOR_CONTEXT_UNAVAILABLE:' + selection.unavailableUnitIds.join(','))
  }

  const units = projection.records.flatMap(record => (record.units ?? []).map(unit => ({ record, unit })))
  const selectedAtomIds = new Set(
    units
      .filter(item => selection.effectiveUnitIds.includes(item.unit.id))
      .flatMap(item => item.unit.atomIds),
  )
  const atomsByRoot = new Map()
  for (const atom of projection.atoms) {
    const root = Number(atom.sourceRef?.entryId)
    if (!Number.isSafeInteger(root)) continue
    const group = atomsByRoot.get(root)
    if (group) group.push(atom)
    else atomsByRoot.set(root, [atom])
  }

  const sourceEvents = projection.sourceEvents ?? []
  const changes = []
  const nextExcludedByRoot = new Map()
  const beforeExcludedByRoot = new Map()
  for (const [root, atoms] of atomsByRoot) {
    const selected = new Set(atoms.filter(atom => selectedAtomIds.has(atom.id)).map(atom => atom.id))
    if (selected.size === 0) continue
    const currentExcluded = new Set(atoms.filter(atom => projection.projectionStates?.get(atom.id) === 'exclude').map(atom => atom.id))
    const unavailable = atoms.some(atom => projection.projectionStates?.get(atom.id) === 'unavailable')
    if (unavailable) throw new Error('CONTEXT_EDITOR_CONTEXT_UNAVAILABLE:root-' + root)
    const nextExcluded = action === 'exclude'
      ? new Set([...currentExcluded, ...selected])
      : new Set([...currentExcluded].filter(id => !selected.has(id)))
    beforeExcludedByRoot.set(root, currentExcluded)
    nextExcludedByRoot.set(root, nextExcluded)
    if (sameIdSet(currentExcluded, nextExcluded)) continue

    const overlay = projection.contextOverlays?.get(root)
    const composed = composeNativeRoot(projection, root)
    if (!composed.message) throw new Error('CONTEXT_EDITOR_CONTEXT_UNAVAILABLE:root-' + root)
    const replacementId = request?.operationId === undefined
      ? undefined
      : `context-${String(request.operationId)}-${root}`
    if (nextExcluded.size === 0) {
      const original = messageForRoot(sourceEvents.find(event => Number(event?.seq) === root) ?? sourceEvents[root])
      if (overlay !== undefined) {
        if (sameJson(composed.message, original)) changes.push({ rootEventSeq: root, mode: 'clear' })
        else changes.push({ rootEventSeq: root, mode: 'replace', message: cloneComposedMessage(composed, nextExcluded, replacementId) })
      }
      continue
    }
    if (nextExcluded.size >= atoms.length) {
      if (overlay?.mode === 'remove') continue
      changes.push({ rootEventSeq: root, mode: 'remove' })
      continue
    }

    const message = cloneComposedMessage(composed, nextExcluded, replacementId)
    if (message.content.length === 0) {
      changes.push({ rootEventSeq: root, mode: 'remove' })
    } else {
      changes.push({ rootEventSeq: root, mode: 'replace', message })
    }
  }

  let beforeTokens = 0
  let afterTokens = 0
  for (const atom of projection.atoms) {
    const root = Number(atom.sourceRef?.entryId)
    const current = projection.projectionStates?.get(atom.id) ?? 'include'
    if (current === 'include') beforeTokens += atom.approxTokens ?? 0
    const nextExcluded = nextExcludedByRoot.get(root)
    const excluded = nextExcluded === undefined
      ? current === 'exclude'
      : nextExcluded.has(atom.id)
    if (!excluded && current !== 'unavailable') afterTokens += atom.approxTokens ?? 0
  }
  return {
    changes,
    selection,
    tokenEstimate: {
      before: beforeTokens,
      after: afterTokens,
      delta: afterTokens - beforeTokens,
    },
    beforeExcludedByRoot,
  }
}

function targetUnit(projection, unitId) {
  for (const record of projection.records ?? []) {
    const unit = (record.units ?? []).find(candidate => candidate.id === unitId)
    if (unit) return { record, unit }
  }
  return undefined
}

function buildNativeReplacementChanges(projection, event, request = {}) {
  const target = targetUnit(projection, event.unitId)
  if (!target) throw new Error('CONTEXT_EDITOR_REPLACEMENT_TARGET_NOT_FOUND')
  const baseRecords = projectRecords(projection.atoms, projection.states, new Map())
  const activeEvents = [...(projection.activeReplacementEvents ?? []).filter(value => value.eventId !== event.eventId), event]
  const virtualStates = reduceReplacementStates(baseRecords.flatMap(record => record.units ?? []), activeEvents, true)
  const virtualRecords = projectRecords(projection.atoms, projection.states, projection.projectionStates, virtualStates)
  const virtualProjection = { ...projection, records: virtualRecords, replacementStates: virtualStates }
  const linkedExcluded = new Set(event.linkedExclusion?.atomChanges?.filter(change => change.after === 'exclude').map(change => change.atomId) ?? [])
  const linkedIncluded = new Set(event.linkedExclusion?.atomChanges?.filter(change => change.after === 'include').map(change => change.atomId) ?? [])
  const roots = new Set(target.unit.atoms.map(atom => Number(atom.sourceRef?.entryId)).filter(Number.isSafeInteger))
  for (const change of event.linkedExclusion?.atomChanges ?? []) {
    const root = Number(change.sourceRef?.entryId)
    if (Number.isSafeInteger(root)) roots.add(root)
  }
  const changes = []
  for (const root of roots) {
    const rootAtoms = projection.atoms.filter(atom => Number(atom.sourceRef?.entryId) === root)
    const excluded = new Set(rootAtoms.filter(atom => projection.projectionStates?.get(atom.id) === 'exclude').map(atom => atom.id))
    for (const atom of rootAtoms) {
      if (linkedExcluded.has(atom.id)) excluded.add(atom.id)
      if (linkedIncluded.has(atom.id)) excluded.delete(atom.id)
    }
    const composed = composeNativeRoot(virtualProjection, root, virtualStates, virtualRecords)
    if (!composed.message) throw new Error('CONTEXT_EDITOR_CONTEXT_UNAVAILABLE:root-' + root)
    if (excluded.size >= rootAtoms.length) {
      changes.push({ rootEventSeq: root, mode: 'remove' })
      continue
    }
    const replacementId = request.operationId === undefined ? undefined : `context-${String(request.operationId)}-${root}`
    const message = cloneComposedMessage(composed, excluded, replacementId)
    if (message.content.length === 0) changes.push({ rootEventSeq: root, mode: 'remove' })
    else changes.push({ rootEventSeq: root, mode: 'replace', message })
  }
  return { changes, virtualStates, virtualRecords }
}

async function withSourceAgent(ctx, sessionId, operation) {
  const live = ctx?.agents?.get?.(sessionId)
  if (live !== undefined) {
    if (live.status === 'running') throw new Error('CONTEXT_EDITOR_BUSY')
    return live.runMaintenance(() => operation(live))
  }
  if (ctx?.agents?.resume === undefined) throw new Error('CONTEXT_EDITOR_AGENT_UNAVAILABLE')
  const handle = await ctx.agents.resume({ resumeSessionId: sessionId })
  try {
    return await handle.agent.runMaintenance(() => operation(handle.agent))
  } finally {
    await handle.dispose()
  }
}

/** One Host service instance owns all sidecar writes and search caches. */
export class ContextEditorHost extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'contextEditor')
    this.ctx = ctx
    this.table = undefined
    this.domain = undefined
    this.operationTails = new Map()
    this.searchCache = new Map()
    this.searchSequence = 0
    this.contextOperations = new Map()
    this.condensationOperations = new Map()
    this.condensationControllers = new Map()
    this.mutationAdmissionOpen = true
  }

  async init() {
    this.domain = await this.ctx.storageDomain.open(contextEditorDomainSpec)
    this.table = this.domain.table('sessions')
  }

  async dispose() {
    this.mutationAdmissionOpen = false
    for (const controller of this.condensationControllers.values()) controller.abort()
    this.condensationControllers.clear()
    await Promise.all(this.operationTails.values())
    if (this.domain !== undefined) await this.domain.close()
    this.searchCache.clear()
  }

  async inspect(sessionId) {
    if (!sessionId) throw new Error('CONTEXT_EDITOR_SESSION_REQUIRED')
    return this.ctx.sessionPersistence.inspect(sessionId)
  }

  rowFor(identity) {
    const stored = this.table?.get(identity.id)
    if (stored !== undefined && sameSessionLifecycle(
      { id: identity.id, ...stored.session },
      identity,
    )) {
      return {
        session: stored.session,
        schemaVersion: 1,
        storageVersion: 1,
        events: normalizeViewEvents(stored.events),
        replacementEvents: normalizeReplacementEvents(stored.replacementEvents),
        condensationEvents: normalizeCondensationEvents(stored.condensationEvents),
      }
    }
    // A reused Session id must never inherit another lifecycle's hidden state.
    return {
      session: {
        createdAt: identity.createdAt,
        ...(identity.cwd === undefined ? {} : { cwd: identity.cwd }),
      },
      schemaVersion: 1,
      storageVersion: 1,
      events: [],
      replacementEvents: [],
      condensationEvents: [],
    }
  }

  async readProjection(sessionId) {
    const inspection = await this.inspect(sessionId)
    const identity = identityFromInspection(inspection, sessionId)
    const row = this.rowFor(identity)
    const events = inspection.events ?? []
    const activeSurfaceSeqs = foldSurface(events).nodes
    const projection = buildProjection(identity, events, row, { activeSurfaceSeqs })
    projection.condensationEvents = activeCondensationEvents(row.condensationEvents, events)
    return projection
  }

  projectionFromSession(session) {
    const identity = identityFromInspection({ meta: session.header }, session.id)
    const row = this.rowFor(identity)
    const events = session.events ?? []
    const activeSurfaceSeqs = foldSurface(events).nodes
    const projection = buildProjection(identity, events, row, { activeSurfaceSeqs })
    projection.condensationEvents = activeCondensationEvents(row.condensationEvents, events)
    return projection
  }

  snapshotOf(projection, running = isBusySession(this.ctx, projection.identity.id)) {
    return {
      host: 'deepseek-harness',
      sessionId: projection.identity.id,
      revision: projection.revision,
      sourceLeafId: null,
      sourceRevision: String(projection.sourceRevision),
      viewRevision: String(projection.events.length),
      records: projection.records.map(record => ({
        id: record.id,
        kind: record.kind,
        viewState: record.viewState,
        projectionState: record.projectionState,
        mutable: record.mutable,
        units: (record.units ?? []).map(unit => ({
          id: unit.id,
          recordId: unit.recordId,
          kind: unit.kind,
          atomIds: unit.atomIds,
          viewState: unit.viewState,
          projectionState: unit.projectionState,
          mutable: unit.mutable,
          effectiveText: unit.effectiveText,
          replacementState: unit.replacementState,
          replacementSupported: unit.replacementSupported,
          ...(unit.replacementDisabledReason ? { replacementDisabledReason: unit.replacementDisabledReason } : {}),
          canRestoreReplacement: unit.canRestoreReplacement,
          canUndoReplacement: unit.canUndoReplacement,
          ...(unit.associatedReasoningUnitIds?.length ? { associatedReasoningUnitIds: unit.associatedReasoningUnitIds } : {}),
        })),
        ...(record.entryId === undefined ? {} : { entryId: record.entryId }),
        ...(record.entryIds?.length ? { entryIds: record.entryIds } : {}),
        ...(record.anchorEntryId === undefined ? {} : { anchorEntryId: record.anchorEntryId }),
        ...(record.toolCallId === undefined ? {} : { toolCallId: record.toolCallId }),
      })),
      canUndo: projection.canUndo,
      legacyStateFound: false,
      running,
      capabilities: {
        paging: true,
        search: true,
        viewMutation: !running,
        undo: !running,
        persistence: true,
        // 0.4.0 release: the target profile install gate is complete;
        // real-provider smoke remains a separate user-owned check.
        contextExclusion: true,
        contextReplacement: true,
        contextCondensation: true,
      },
      condensations: (projection.condensationEvents ?? []).map(event => condensationSnapshot(event, projection)),
    }
  }

  async getSnapshot(request) {
    const projection = await this.readProjection(requestSessionId(request))
    return this.snapshotOf(projection)
  }

  async listRecords(request) {
    const projection = await this.readProjection(requestSessionId(request))
    const cursor = asPageCursor(request?.cursor)
    const pageSize = clampPageSize(request?.pageSize)
    const page = projection.records.slice(cursor, cursor + pageSize).map(recordSnapshot)
    return {
      sessionId: projection.identity.id,
      revision: projection.revision,
      sourceRevision: String(projection.sourceRevision),
      viewRevision: String(projection.events.length),
      records: page,
      nextCursor: cursor + page.length < projection.records.length ? String(cursor + page.length) : null,
      total: projection.records.length,
    }
  }

  async getRecord(request) {
    const projection = await this.readProjection(requestSessionId(request))
    const record = projection.records.find(value => value.id === request?.recordId)
    return record === undefined
      ? null
      : {
        record: recordSnapshot(record),
        sourceRevision: String(projection.sourceRevision),
        viewRevision: String(projection.events.length),
      }
  }

  async searchRecords(request) {
    const projection = await this.readProjection(requestSessionId(request))
    const query = String(request?.query ?? '')
    const enabledKinds = Array.isArray(request?.enabledKinds)
      ? request.enabledKinds
      : ['user', 'ai', 'tool']
    const scope = request?.scope === 'all' ? 'all' : 'dialogue'
    const enabledUnitKinds = Array.isArray(request?.enabledUnitKinds) ? request.enabledUnitKinds : undefined
    const matches = searchRecords(projection.records, query, enabledKinds, scope, enabledUnitKinds)
    const searchId = `${projection.identity.id}:${++this.searchSequence}:${randomId('search')}`
    this.searchCache.set(searchId, {
      sessionId: projection.identity.id,
      revision: projection.revision,
      matches,
    })
    while (this.searchCache.size > 64) this.searchCache.delete(this.searchCache.keys().next().value)
    return {
      searchId,
      sessionId: projection.identity.id,
      revision: projection.revision,
      total: matches.length,
      totalOccurrences: matches.reduce((sum, value) => sum + value.occurrenceCount, 0),
    }
  }

  async getSearchMatch(request) {
    const cache = this.searchCache.get(String(request?.searchId ?? ''))
    if (cache === undefined) return null
    if (request?.revision !== undefined && request.revision !== cache.revision) return null
    if (request?.sessionId !== undefined && String(request.sessionId) !== cache.sessionId) return null
    try {
      const current = await this.readProjection(cache.sessionId)
      if (current.revision !== cache.revision) {
        this.searchCache.delete(String(request.searchId))
        return null
      }
    } catch {
      this.searchCache.delete(String(request.searchId))
      return null
    }
    if (cache.matches.length === 0) return null
    const index = ((Math.trunc(Number(request?.index ?? 0)) % cache.matches.length) + cache.matches.length) % cache.matches.length
    return cache.matches[index] ?? null
  }

  enqueue(sessionId, operation) {
    if (!this.mutationAdmissionOpen) return Promise.reject(new Error('CONTEXT_EDITOR_DISPOSING'))
    const previous = this.operationTails.get(sessionId) ?? Promise.resolve()
    const result = previous.then(operation)
    const tail = result.then(() => undefined, () => undefined)
    this.operationTails.set(sessionId, tail)
    return result.finally(() => {
      if (this.operationTails.get(sessionId) === tail) this.operationTails.delete(sessionId)
    })
  }

  async previewContext(request) {
    if (request?.action === 'condense') return this.previewCondensation(request)
    if (request?.action === 'condense-models') return this.listCondensationModels(request)
    if (request?.action === 'cancel-condense') return this.cancelCondensation(request)
    const sessionId = requestSessionId(request)
    if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
    const projection = await this.readProjection(sessionId)
    const requestedRevision = request?.expectedRevision ?? request?.baseRevision
    if (requestedRevision !== undefined && String(requestedRevision) !== projection.revision) {
      return {
        ok: false,
        conflict: true,
        expectedRevision: projection.revision,
        snapshot: this.snapshotOf(projection),
      }
    }
    const action = request?.action
    const unitIds = Array.isArray(request?.unitIds) ? request.unitIds.map(String) : undefined
    const recordIds = Array.isArray(request?.recordIds) ? request.recordIds.map(String) : undefined
    const operationId = String(request?.operationId ?? randomId('context-operation'))
    const surfaceEvent = condensationSurfaceEvent(projection, request, unitIds)
    const calculated = surfaceEvent
      ? buildCondensationSurfaceChanges(projection, surfaceEvent, action)
      : buildNativeContextChanges(projection, action, { ...request, unitIds, recordIds, operationId })
    if (activeCondensationForUnits(projection, calculated.selection.effectiveUnitIds)
      && !surfaceEvent) {
      throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_REQUIRED')
    }
    assertContextOperationReuse(this.contextOperations.get(operationId), sessionId, action, unitIds, recordIds)
    this.contextOperations.set(operationId, {
      sessionId,
      expectedRevision: projection.revision,
      action,
      unitIds,
      recordIds,
      changes: structuredClone(calculated.changes),
      tokenEstimate: calculated.tokenEstimate,
      ...(request?.condensationOperationId === undefined ? {} : { condensationOperationId: String(request.condensationOperationId) }),
    })
    return {
      ok: true,
      operationId,
      expectedRevision: projection.revision,
      action,
      normalizedTargets: calculated.selection.requestedUnitIds,
      effectiveTargets: calculated.selection.effectiveUnitIds,
      autoExpandedTargets: calculated.selection.autoExpandedUnitIds,
      unavailableUnitIds: calculated.selection.unavailableUnitIds,
      tokenEstimate: calculated.tokenEstimate,
      changes: calculated.changes.map(change => ({
        rootEventSeq: change.rootEventSeq,
        mode: change.mode,
      })),
    }
  }

  async listCondensationModels(request) {
    const sessionId = requestSessionId(request)
    if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
    return withSourceAgent(this.ctx, sessionId, async agent => {
      const { provider, model } = modelTarget(agent.session, request)
      let models = []
      if (typeof this.ctx.llm?.listModels === 'function') {
        try {
          const listed = await this.ctx.llm.listModels(provider)
          models = (Array.isArray(listed) ? listed : []).map(value => ({
            provider,
            id: String(value?.id ?? value?.model ?? ''),
            name: String(value?.name ?? value?.id ?? value?.model ?? ''),
          })).filter(value => value.id)
        } catch {
          models = []
        }
      }
      if (!models.some(value => value.id === model)) models.unshift({ provider, id: model, name: model })
      return { ok: true, sessionId, provider, currentModel: model, models }
    })
  }

  async cancelCondensation(request = {}) {
    const sessionId = requestSessionId(request)
    const operationId = String(request.operationId ?? '')
    if (!operationId) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPERATION_ID_REQUIRED')
    const controller = this.condensationControllers.get(operationId)
    if (controller) controller.abort()
    this.condensationControllers.delete(operationId)
    this.condensationOperations.delete(operationId)
    if (this.table !== undefined && sessionId) {
      const inspection = await this.inspect(sessionId)
      const identity = identityFromInspection(inspection, sessionId)
      const row = this.rowFor(identity)
      const condensationEvents = row.condensationEvents.filter(event => !(event.operationId === operationId && event.status === 'pending'))
      if (condensationEvents.length !== row.condensationEvents.length) {
        await this.table.put(sessionId, {
          session: row.session,
          schemaVersion: 1,
          storageVersion: 1,
          events: row.events,
          replacementEvents: row.replacementEvents,
          condensationEvents,
        })
      }
    }
    return { ok: true, operationId, cancelled: Boolean(controller) }
  }

  async previewCondensation(request = {}) {
    const sessionId = requestSessionId(request)
    if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
    const initial = await this.readProjection(sessionId)
    const expectedRevision = request?.baseRevision ?? request?.expectedRevision
    if (expectedRevision !== undefined && String(expectedRevision) !== initial.revision) {
      return { ok: false, conflict: true, snapshot: this.snapshotOf(initial), baseRevision: initial.revision }
    }
    return withSourceAgent(this.ctx, sessionId, async agent => {
      const session = agent.session
      const projection = this.projectionFromSession(session)
      if (expectedRevision !== undefined && String(expectedRevision) !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(projection, false), baseRevision: projection.revision }
      }
      const requestedUnitIds = Array.isArray(request.unitIds) ? request.unitIds.map(String) : []
      const onlyUnit = requestedUnitIds.length === 1 ? targetUnit(projection, requestedUnitIds[0])?.unit : undefined
      const canExpandRelated = onlyUnit?.kind === 'answer'
      const expandRelated = canExpandRelated && request.expandRelated === true
      const range = selectCondensationRange(projection.records, requestedUnitIds, projection.projectionStates, { expandRelated })
      if (!range.requestedUnitIds.length) throw new Error('CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY')
      if (range.unavailableUnitIds.length) throw new Error('CONTEXT_EDITOR_CONDENSATION_UNAVAILABLE:' + range.unavailableUnitIds.join(','))
      const opaque = range.sourceUnits.find(source => source.hasSignature || source.structured)
      if (opaque) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPAQUE_CONTENT:' + opaque.id)
      const roots = range.sourceRootSeqs
      if (roots.some(root => !rootEventExists(projection, root))) throw new Error('CONTEXT_EDITOR_CONDENSATION_SOURCE_GONE')
      const overlap = overlappingCondensation(projection, roots)
      if (overlap) throw new Error('CONTEXT_EDITOR_CONDENSATION_OVERLAP:' + overlap.operationId)
      const overlayConflict = conflictingOverlay(projection, roots)
      if (overlayConflict) throw new Error('CONTEXT_EDITOR_CONDENSATION_OVERLAP:root-' + overlayConflict.root)
      const target = modelTarget(session, request)
      const prefixMessages = messagesBefore(projection, roots[0] - 1)
      const historyMessages = messagesBefore(projection, roots.at(-1))
      const configured = asObject(target.header.config)
      const prefixReused = String(configured.provider ?? '') === target.provider && String(configured.model ?? '') === target.model
      const generationMessages = prefixReused
        ? [...historyMessages, { id: randomId('condensation-instruction'), role: 'user', source: { kind: 'plugin', plugin: PACKAGE_NAME }, content: [{ type: 'text', text: condensationInstruction(range) }] }]
        : [{ id: randomId('condensation-instruction'), role: 'user', source: { kind: 'plugin', plugin: PACKAGE_NAME }, content: [{ type: 'text', text: condensationInstruction(range) }] }]
      const beforeTokens = range.sourceUnits.filter(source => source.included).reduce((sum, source) => sum + source.approxTokens, 0)
      if (Number(request.maxInputTokens) > 0 && estimateCondensationTokens(JSON.stringify(generationMessages)) > Number(request.maxInputTokens)) {
        throw new Error('CONTEXT_EDITOR_CONDENSATION_INPUT_TOO_LARGE')
      }
      if (typeof this.ctx.llm?.stream !== 'function') throw new Error('CONTEXT_EDITOR_CONDENSATION_LLM_UNAVAILABLE')
      const operationId = String(request.operationId ?? randomId('condensation'))
      const abortController = typeof AbortController === 'function' ? new AbortController() : undefined
      if (request.signal?.aborted) throw new Error('CONTEXT_EDITOR_CONDENSATION_CANCELLED')
      if (abortController) {
        this.condensationControllers.set(operationId, abortController)
        request.signal?.addEventListener?.('abort', () => abortController.abort(), { once: true })
      }
      let result
      try {
        const stream = this.ctx.llm.stream({
          provider: target.provider,
          model: target.model,
          messages: generationMessages,
          ...(prefixReused && target.header.system !== undefined ? { system: target.header.system } : {}),
          ...(prefixReused && target.header.tools !== undefined ? { tools: target.header.tools } : {}),
          ...(target.header.temperature === undefined ? {} : { temperature: target.header.temperature }),
          maxTokens: Number(request.maxTokens) > 0 ? Number(request.maxTokens) : 4096,
          ...(abortController ? { signal: abortController.signal } : request.signal === undefined ? {} : { signal: request.signal }),
          sessionId: session.id,
          purpose: 'compaction',
        })
        result = await collectStreamText(stream)
      } finally {
        if (this.condensationControllers.get(operationId) === abortController) this.condensationControllers.delete(operationId)
      }
      const summary = cleanCondensationOutput(result.text)
      const summaryTokens = estimateCondensationTokens(frameCondensationSummary(summary))
      const validation = validateCondensationSummary(summary, beforeTokens, { summaryTokens, truncated: result.truncated })
      if (!validation.ok) throw new Error(summaryValidationError(validation))
      const changes = buildCondensationChanges(projection, roots, summary, operationId, range.sourceUnits)
      const risks = Array.from(new Set([...range.risks, ...(validation.warnings.length ? ['small-saving'] : [])]))
      const proposal = {
        schemaVersion: 1,
        operationId,
        sessionId,
        baseRevision: projection.revision,
        expandRelated,
        canExpandRelated,
        requestedUnitIds: range.requestedUnitIds,
        effectiveUnitIds: range.effectiveUnitIds,
        autoExpandedUnitIds: range.autoExpandedUnitIds,
        recordIds: range.recordIds,
        sourceRootSeqs: roots,
        sourceFingerprint: range.sourceFingerprint,
        sourceUnits: range.sourceUnits,
        summary,
        provider: target.provider,
        model: target.model,
        metrics: validation.metrics,
        prefixTokens: prefixReused ? prefixMessages.reduce((sum, message) => sum + estimateMessageTokens(message), 0) : 0,
        prefixReused,
        summaryTokens,
        risks,
        warnings: [...validation.warnings, ...(prefixReused ? [] : ['prefix-not-reused'])],
        createdAt: new Date().toISOString(),
      }
      const pendingEvent = {
        ...proposal,
        type: 'condensation',
        action: 'apply',
        status: 'pending',
        beforeChanges: changes.beforeChanges,
        afterChanges: changes.afterChanges,
      }
      const row = this.rowFor(projection.identity)
      const condensationEvents = row.condensationEvents.some(value => value.operationId === operationId)
        ? row.condensationEvents.map(value => value.operationId === operationId ? pendingEvent : value)
        : [...row.condensationEvents, pendingEvent]
      await this.table.put(sessionId, {
        session: row.session,
        schemaVersion: 1,
        storageVersion: 1,
        events: row.events,
        replacementEvents: row.replacementEvents,
        condensationEvents,
      })
      this.condensationOperations.set(operationId, {
        ...proposal,
        beforeChanges: changes.beforeChanges,
        afterChanges: changes.afterChanges,
      })
      return {
        ok: true,
        ...proposal,
        range,
        validation,
        snapshot: this.snapshotOf(projection, false),
      }
    })
  }

  async commitCondensation(request = {}) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const operationId = String(request.operationId ?? '')
      if (!operationId) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPERATION_ID_REQUIRED')
      const initial = await this.readProjection(sessionId)
      const row = this.rowFor(initial.identity)
      const sidecarEvent = row.condensationEvents.find(event => event.operationId === operationId)
      const priorNative = (initial.sourceEvents ?? []).find(event => nativeCondensationOperationId(event) === operationId
        && (asObject(event.data).condensationAction ?? asObject(event.data).condensation?.action) === 'apply')
      if (priorNative !== undefined && sidecarEvent !== undefined) {
        if (sidecarEvent.status !== 'applied' && sidecarEvent.status !== 'restored') {
          const healedEvents = row.condensationEvents.map(value => value.operationId === operationId
            ? { ...value, status: 'applied' }
            : value)
          await this.table.put(sessionId, {
            session: row.session,
            schemaVersion: 1,
            storageVersion: 1,
            events: row.events,
            replacementEvents: row.replacementEvents,
            condensationEvents: healedEvents,
          })
        }
        return success(this.snapshotOf(initial, false), { operationId, eventId: String(priorNative.seq) })
      }
      const prepared = this.condensationOperations.get(operationId) ?? sidecarEvent
      if (!prepared) throw new Error('CONTEXT_EDITOR_CONDENSATION_PROPOSAL_NOT_FOUND')
      const expectedRevision = String(request.baseRevision ?? prepared.baseRevision ?? '')
      if (!expectedRevision) throw new Error('CONTEXT_EDITOR_REVISION_REQUIRED')
      if (expectedRevision !== initial.revision) return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(initial, false) }
      const roots = (prepared.sourceRootSeqs ?? []).map(Number).filter(Number.isSafeInteger)
      if (!roots.length) throw new Error('CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY')
      const opaque = (prepared.sourceUnits ?? []).find(source => source.hasSignature || source.structured)
      if (opaque) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPAQUE_CONTENT:' + opaque.id)
      if (roots.some(root => !rootEventExists(initial, root))) throw new Error('CONTEXT_EDITOR_CONDENSATION_SOURCE_GONE')
      if (prepared.sourceFingerprint) {
        const currentRange = selectCondensationRange(initial.records, prepared.requestedUnitIds ?? request.unitIds ?? [], initial.projectionStates, { expandRelated: prepared.expandRelated ?? true })
        if (currentRange.sourceFingerprint !== prepared.sourceFingerprint) throw new Error('CONTEXT_EDITOR_CONDENSATION_CONFLICT')
      }
      if (overlappingCondensation(initial, roots, operationId)) throw new Error('CONTEXT_EDITOR_CONDENSATION_OVERLAP')
      const overlayConflict = conflictingOverlay(initial, roots, operationId)
      if (overlayConflict) throw new Error('CONTEXT_EDITOR_CONDENSATION_CONFLICT:root-' + overlayConflict.root)
      if (prepared.beforeChanges) {
        const currentBefore = roots.map(root => beforeChangeForRoot(initial, root))
        if (!sameJson(currentBefore, prepared.beforeChanges)) throw new Error('CONTEXT_EDITOR_CONDENSATION_CONFLICT')
      }
      const summary = cleanCondensationOutput(String(request.summary ?? prepared.summary ?? ''))
      if (request.summary !== undefined && sidecarEvent?.status === 'applied' && summary !== String(sidecarEvent.summary).trim()) {
        throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
      }
      const beforeTokens = Number(prepared.metrics?.beforeTokens) || (prepared.sourceUnits ?? []).filter(source => source.included).reduce((sum, source) => sum + (Number(source.approxTokens) || 0), 0)
      const summaryTokens = estimateCondensationTokens(frameCondensationSummary(summary))
      const validation = validateCondensationSummary(summary, beforeTokens, { summaryTokens })
      if (!validation.ok) throw new Error(summaryValidationError(validation))
      const changes = buildCondensationChanges(initial, roots, summary, operationId, prepared.sourceUnits)
      const event = {
        schemaVersion: 1,
        type: 'condensation',
        action: 'apply',
        status: 'pending',
        operationId,
        sessionId,
        baseRevision: initial.revision,
        expandRelated: prepared.expandRelated ?? true,
        requestedUnitIds: (prepared.requestedUnitIds ?? request.unitIds ?? []).map(String),
        effectiveUnitIds: (prepared.effectiveUnitIds ?? request.unitIds ?? []).map(String),
        recordIds: (prepared.recordIds ?? []).map(String),
        sourceRootSeqs: roots,
        sourceFingerprint: String(prepared.sourceFingerprint ?? ''),
        sourceUnits: structuredClone(prepared.sourceUnits ?? []),
        summary,
        provider: String(prepared.provider ?? request.provider ?? ''),
        model: String(prepared.model ?? request.model ?? ''),
        metrics: validation.metrics,
        prefixTokens: Number(prepared.prefixTokens) || 0,
        ...(prepared.prefixReused === undefined ? {} : { prefixReused: Boolean(prepared.prefixReused) }),
        summaryTokens,
        createdAt: String(prepared.createdAt ?? new Date().toISOString()),
        beforeChanges: changes.beforeChanges,
        afterChanges: changes.afterChanges,
      }
      const condensationEvents = row.condensationEvents.some(value => value.operationId === operationId)
        ? row.condensationEvents.map(value => value.operationId === operationId ? event : value)
        : [...row.condensationEvents, event]
      await this.table.put(sessionId, {
        session: row.session,
        schemaVersion: 1,
        storageVersion: 1,
        events: row.events,
        replacementEvents: row.replacementEvents,
        condensationEvents,
      })
      return withSourceAgent(this.ctx, sessionId, async agent => {
        const session = agent.session
        const projection = this.projectionFromSession(session)
        const native = (session.events ?? []).find(value => nativeCondensationOperationId(value) === operationId
          && (asObject(value.data).condensationAction ?? asObject(value.data).condensation?.action) === 'apply')
        if (native !== undefined) {
          this.condensationOperations.delete(operationId)
          return success(this.snapshotOf(projection, false), { operationId, eventId: String(native.seq) })
        }
        if (projection.revision !== initial.revision) return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(projection, false) }
        const currentBefore = roots.map(root => beforeChangeForRoot(projection, root))
        if (!sameJson(currentBefore, changes.beforeChanges)) throw new Error('CONTEXT_EDITOR_CONDENSATION_CONFLICT')
        const baseSeq = session.events.at(-1)?.seq ?? -1
        if (baseSeq < 0) throw new Error('CONTEXT_EDITOR_SESSION_EMPTY')
        const data = {
          schemaVersion: 1,
          owner: CONTEXT_PROJECTION_OWNER,
          operationId: `${operationId}:apply`,
          baseSeq,
          changes: changes.afterChanges,
          condensationOperationId: operationId,
          condensationAction: 'apply',
          condensation: { operationId, action: 'apply' },
        }
        const nativeEvent = typeof session.appendContextProjection === 'function'
          ? session.appendContextProjection(data)
          : session.append('context/projection', data)
        await this.ctx.sessions.flush(session)
        const appliedEvent = { ...event, status: 'applied' }
        await this.table.put(sessionId, {
          session: row.session,
          schemaVersion: 1,
          storageVersion: 1,
          events: row.events,
          replacementEvents: row.replacementEvents,
          condensationEvents: condensationEvents.map(value => value.operationId === operationId ? appliedEvent : value),
        })
        this.searchCache.clear()
        this.condensationOperations.delete(operationId)
        const next = this.projectionFromSession(session)
        return success(this.snapshotOf(next, false), { operationId, eventId: String(nativeEvent.seq), metrics: validation.metrics, warnings: validation.warnings })
      })
    })
  }

  async restoreCondensation(request = {}) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const operationId = String(request.operationId ?? '')
      if (!operationId) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPERATION_ID_REQUIRED')
      const initial = await this.readProjection(sessionId)
      const row = this.rowFor(initial.identity)
      const event = row.condensationEvents.find(value => value.operationId === operationId)
      if (!event) throw new Error('CONTEXT_EDITOR_CONDENSATION_NOT_FOUND')
      const existingRestore = (initial.sourceEvents ?? []).find(value => nativeCondensationOperationId(value) === operationId
        && (asObject(value.data).condensationAction ?? asObject(value.data).condensation?.action) === 'restore')
      if (existingRestore !== undefined) return success(this.snapshotOf(initial, false), { operationId, eventId: String(existingRestore.seq) })
      const expectedRevision = String(request.baseRevision ?? initial.revision)
      if (expectedRevision !== initial.revision) return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(initial, false) }
      const derivedCoverage = deriveCondensationCoverage(
        event.sourceRootSeqs,
        nativeCompactionEvidence(initial.sourceEvents),
      )
      const derivedRequiresRecovery = derivedCoverage.status !== 'none' || derivedCoverage.restoreMode !== 'inline'
      const coverage = derivedRequiresRecovery
        ? derivedCoverage
        : event.coverage?.restoreMode && event.coverage.restoreMode !== 'inline'
          ? {
            ...event.coverage,
            restoreMode: 'unavailable',
            reason: 'checkpoint-unavailable',
          }
          : event.coverage?.status && event.coverage.status !== 'none'
          ? {
            ...event.coverage,
            restoreMode: 'unavailable',
            reason: 'checkpoint-unavailable',
          }
          : derivedCoverage
      if (coverage.status !== 'none' || coverage.restoreMode !== 'inline') {
        return {
          ok: false,
          restoreRequired: true,
          restoreMode: coverage.restoreMode,
          operationId,
          ...(coverage.checkpointCompactionId ? { checkpointCompactionId: coverage.checkpointCompactionId } : {}),
          ...(Number.isSafeInteger(coverage.checkpointSeq) ? { checkpointSeq: coverage.checkpointSeq } : {}),
          snapshot: this.snapshotOf(initial, false),
        }
      }
      const roots = event.sourceRootSeqs.map(Number).filter(Number.isSafeInteger)
      if (!roots.length || roots.some(root => !rootEventExists(initial, root))) throw new Error('CONTEXT_EDITOR_CONDENSATION_SOURCE_GONE')
      for (const root of roots) {
        const overlay = initial.contextOverlays?.get(root)
        if (!overlay || (![operationId, `${operationId}:apply`].includes(String(overlay.operationId ?? ''))
          && !isCondensationSummaryOverlay(overlay, event))) throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_UNAVAILABLE')
      }
      return withSourceAgent(this.ctx, sessionId, async agent => {
        const session = agent.session
        const projection = this.projectionFromSession(session)
        if (projection.revision !== initial.revision) return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(projection, false) }
        for (const root of roots) {
          const overlay = projection.contextOverlays?.get(root)
          if (!overlay || (![operationId, `${operationId}:apply`].includes(String(overlay.operationId ?? ''))
            && !isCondensationSummaryOverlay(overlay, event))) throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_UNAVAILABLE')
        }
        const baseSeq = session.events.at(-1)?.seq ?? -1
        if (baseSeq < 0) throw new Error('CONTEXT_EDITOR_SESSION_EMPTY')
        const restoreId = `${operationId}:restore`
        const data = {
          schemaVersion: 1,
          owner: CONTEXT_PROJECTION_OWNER,
          operationId: restoreId,
          baseSeq,
          changes: structuredClone(event.beforeChanges),
          condensationOperationId: operationId,
          condensationAction: 'restore',
          condensation: { operationId, action: 'restore' },
        }
        const nativeEvent = typeof session.appendContextProjection === 'function'
          ? session.appendContextProjection(data)
          : session.append('context/projection', data)
        await this.ctx.sessions.flush(session)
        const restoredEvent = { ...event, status: 'restored', restoreEventSeq: Number(nativeEvent.seq) }
        const condensationEvents = row.condensationEvents.map(value => value.operationId === operationId ? restoredEvent : value)
        await this.table.put(sessionId, {
          session: row.session,
          schemaVersion: 1,
          storageVersion: 1,
          events: row.events,
          replacementEvents: row.replacementEvents,
          condensationEvents,
        })
        this.searchCache.clear()
        this.condensationOperations.delete(operationId)
        const next = this.projectionFromSession(session)
        return success(this.snapshotOf(next, false), { operationId, eventId: String(nativeEvent.seq) })
      })
    })
  }

  async prepareCondensation(request) { return this.previewCondensation(request) }
  async generateCondensation(request) { return this.previewCondensation(request) }
  async undoCondensation(request) { return this.restoreCondensation(request) }

  async commitContext(request) {
    if (request?.action === 'condense') return this.commitCondensation(request)
    if (request?.action === 'restore-condensation') return this.restoreCondensation(request)
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      const operationId = String(request?.operationId ?? randomId('context-operation'))
      const stored = this.contextOperations.get(operationId)
      const action = request?.action ?? stored?.action
      const unitIds = Array.isArray(request?.unitIds)
        ? request.unitIds.map(String)
        : stored?.unitIds
      const recordIds = Array.isArray(request?.recordIds)
        ? request.recordIds.map(String)
        : stored?.recordIds
      assertContextOperationReuse(stored, sessionId, action, unitIds, recordIds)
      const expectedRevision = String(
        request?.expectedRevision
        ?? request?.baseRevision
        ?? stored?.expectedRevision
        ?? '',
      )
      if (!expectedRevision) throw new Error('CONTEXT_EDITOR_REVISION_REQUIRED')

      return withSourceAgent(this.ctx, sessionId, async (agent) => {
        const session = agent.session
        const projection = this.projectionFromSession(session)
        const priorEvent = (session.events ?? []).find(event => event?.type === 'context/projection'
          && event?.data?.owner === 'context-editor-deepseek-harness'
          && event?.data?.operationId === operationId)
        if (priorEvent !== undefined) {
          if (stored?.changes !== undefined && !sameJson(stored.changes, priorEvent.data.changes)) {
            throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
          }
          if (stored === undefined && action !== undefined) {
            const priorIndex = session.events.indexOf(priorEvent)
            const beforeSession = {
              id: session.id,
              header: session.header,
              events: session.events.slice(0, priorIndex),
            }
            const priorProjection = this.projectionFromSession(beforeSession)
            const priorSurface = condensationSurfaceEvent(priorProjection, { condensationOperationId: request?.condensationOperationId ?? stored?.condensationOperationId }, unitIds)
            const expectedChanges = (priorSurface
              ? buildCondensationSurfaceChanges(priorProjection, priorSurface, action)
              : buildNativeContextChanges(priorProjection, action, { unitIds, recordIds, operationId })).changes
            if (!sameJson(expectedChanges, priorEvent.data.changes)) {
              throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
            }
          }
          await this.ctx.sessions.flush(session)
          this.searchCache.clear()
          const next = this.projectionFromSession(session)
          return success(this.snapshotOf(next, false), {
            operationId,
            eventId: priorEvent.seq,
            expectedRevision: next.revision,
            tokenEstimate: stored?.tokenEstimate ?? { before: 0, after: 0, delta: 0 },
          })
        }
        if (expectedRevision !== projection.revision) {
          return {
            ok: false,
            conflict: true,
            expectedRevision: projection.revision,
            snapshot: this.snapshotOf(projection, false),
          }
        }
        const surfaceEvent = condensationSurfaceEvent(projection, { condensationOperationId: request?.condensationOperationId ?? stored?.condensationOperationId }, unitIds)
        const calculated = surfaceEvent
          ? buildCondensationSurfaceChanges(projection, surfaceEvent, action)
          : buildNativeContextChanges(projection, action, {
            unitIds,
            recordIds,
            operationId,
          })
        if (activeCondensationForUnits(projection, calculated.selection.effectiveUnitIds)
          && !surfaceEvent) {
          throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_REQUIRED')
        }
        if (calculated.changes.length === 0) {
          return success(this.snapshotOf(projection, false), {
            operationId,
            expectedRevision: projection.revision,
            tokenEstimate: calculated.tokenEstimate,
          })
        }

        const baseSeq = session.events.at(-1)?.seq ?? -1
        if (baseSeq < 0) throw new Error('CONTEXT_EDITOR_SESSION_EMPTY')
        const data = {
          schemaVersion: 1,
          owner: 'context-editor-deepseek-harness',
          operationId,
          baseSeq,
          changes: calculated.changes,
        }
        const event = typeof session.appendContextProjection === 'function'
          ? session.appendContextProjection(data)
          : session.append('context/projection', data)
        await this.ctx.sessions.flush(session)
        this.searchCache.clear()
        const next = this.projectionFromSession(session)
        return success(this.snapshotOf(next, false), {
          operationId,
          eventId: event.seq,
          expectedRevision: next.revision,
          tokenEstimate: calculated.tokenEstimate,
        })
      })
    })
  }

  async previewReplacement(request) {
    const sessionId = requestSessionId(request)
    if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
    const projection = await this.readProjection(sessionId)
    const requestedRevision = request?.baseRevision
    if (requestedRevision !== undefined && String(requestedRevision) !== projection.revision) {
      return { ok: false, conflict: true, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, unitId: String(request?.unitId ?? ''), unitKind: 'answer', textChanged: false, excludeAssociatedReasoning: Boolean(request?.excludeAssociatedReasoning), associatedReasoningUnitIds: [], requestedUnitIds: [], effectiveUnitIds: [], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: 'revision-conflict' }
    }
    const target = targetUnit(projection, String(request?.unitId ?? ''))
    if (!target) throw new Error('CONTEXT_EDITOR_REPLACEMENT_TARGET_NOT_FOUND')
    if (activeCondensationForUnits(projection, [target.unit.id])) {
      return { ok: false, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: false, excludeAssociatedReasoning: false, associatedReasoningUnitIds: [], requestedUnitIds: [target.unit.id], effectiveUnitIds: [target.unit.id], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: 'condensation-active' }
    }
    if (!target.unit.replacementSupported || target.unit.replacementState === 'unavailable') {
      return { ok: false, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: false, excludeAssociatedReasoning: false, associatedReasoningUnitIds: [], requestedUnitIds: [target.unit.id], effectiveUnitIds: [target.unit.id], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: target.unit.replacementDisabledReason ?? 'invalid-target' }
    }
    const text = request?.text === undefined ? target.unit.effectiveText : String(request.text)
    if (text.trim().length === 0) {
      return { ok: false, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: false, excludeAssociatedReasoning: false, associatedReasoningUnitIds: [], requestedUnitIds: [target.unit.id], effectiveUnitIds: [target.unit.id], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: 'replacement-empty' }
    }
    const link = Boolean(request?.excludeAssociatedReasoning && target.unit.kind === 'answer')
    const selection = link ? selectAssociatedReasoningTargets(projection.records, target.unit.id, projection.projectionStates) : { associatedReasoningUnitIds: [], requestedUnitIds: [], effectiveUnitIds: [], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], disabledReason: undefined }
    const requestedUnitIds = [target.unit.id, ...selection.requestedUnitIds.filter(id => id !== target.unit.id)]
    const effectiveUnitIds = [target.unit.id, ...selection.effectiveUnitIds.filter(id => id !== target.unit.id)]
    return { ok: true, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: text !== target.unit.effectiveText, excludeAssociatedReasoning: link, associatedReasoningUnitIds: selection.associatedReasoningUnitIds, requestedUnitIds, effectiveUnitIds, autoExpandedUnitIds: selection.autoExpandedUnitIds, newlyExcludedUnitIds: selection.newlyExcludedUnitIds, alreadyExcludedUnitIds: selection.alreadyExcludedUnitIds, newlyExcludedAtomIds: selection.newlyExcludedAtomIds, alreadyExcludedAtomIds: selection.alreadyExcludedAtomIds, unavailableUnitIds: selection.unavailableUnitIds, requiresConfirmation: selection.autoExpandedUnitIds.length > 0, canCommit: !selection.disabledReason && selection.unavailableUnitIds.length === 0, ...(selection.disabledReason ? { disabledReason: selection.disabledReason } : {}) }
  }

  async commitReplacementMutation(request, action) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const operationId = String(request?.operationId ?? '')
      if (!operationId) throw new Error('CONTEXT_EDITOR_OPERATION_ID_REQUIRED')
      const expectedRevision = String(request?.baseRevision ?? '')
      if (!expectedRevision) throw new Error('CONTEXT_EDITOR_REVISION_REQUIRED')
      const initial = await this.readProjection(sessionId)
      const initialRow = this.rowFor(initial.identity)
      const initialExisting = initialRow.replacementEvents.find(event => event.eventId === operationId)
      const initialNative = (initial.sourceEvents ?? []).find(value => value?.type === 'context/projection' && value?.data?.owner === CONTEXT_PROJECTION_OWNER && value?.data?.operationId === operationId)
      if (initialNative !== undefined) {
        if (!initialExisting) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        if (initialExisting.unitId !== String(request?.unitId ?? '') || initialExisting.action !== action) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        if (action === 'replace') {
          if (request?.text !== undefined && String(request.text) !== String(initialExisting.afterText ?? '')) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
          if (Boolean(request?.excludeAssociatedReasoning) !== Boolean(initialExisting.linkedExclusion)) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        }
        return success(this.snapshotOf(initial, false), { operationId, eventId: String(initialNative.seq) })
      }
      if (expectedRevision !== initial.revision) return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(initial, false) }
      const target = targetUnit(initial, String(request?.unitId ?? ''))
      if (!target) throw new Error('CONTEXT_EDITOR_REPLACEMENT_TARGET_NOT_FOUND')
      if (activeCondensationForUnits(initial, [target.unit.id])) throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_REQUIRED')
      if (!target.unit.replacementSupported || target.unit.replacementState === 'unavailable') throw new Error('CONTEXT_EDITOR_REPLACEMENT_UNSUPPORTED:' + (target.unit.replacementDisabledReason ?? 'invalid-target'))
      const currentState = initial.replacementStates.get(target.unit.id)
      const row = this.rowFor(initial.identity)
      const existing = row.replacementEvents.find(event => event.eventId === operationId)
      let event = existing
      if (event !== undefined) {
        if (event.unitId !== target.unit.id || event.action !== action) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        if (action === 'replace') {
          if (request?.text !== undefined && String(request.text) !== String(event.afterText ?? '')) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
          if (Boolean(request?.excludeAssociatedReasoning) !== Boolean(event.linkedExclusion)) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        }
      }
      if (event === undefined && action === 'replace') {
        const text = String(request?.text ?? '')
        if (text.trim().length === 0) throw new Error('CONTEXT_EDITOR_REPLACEMENT_EMPTY')
        const link = Boolean(request?.excludeAssociatedReasoning && target.unit.kind === 'answer')
        const selection = link ? selectAssociatedReasoningTargets(initial.records, target.unit.id, initial.projectionStates) : undefined
        if (selection?.disabledReason || selection?.unavailableUnitIds.length) throw new Error('CONTEXT_EDITOR_REPLACEMENT_LINK_UNAVAILABLE')
        const confirmed = new Set((request?.confirmedUnitIds ?? request?.confirmationScope ?? []).map(String))
        if (selection?.autoExpandedUnitIds.some(id => !confirmed.has(id))) throw new Error('CONTEXT_EDITOR_REPLACEMENT_CONFIRMATION_REQUIRED')
        const linkedChanges = selection?.newlyExcludedAtomIds.map(atomId => {
          const atom = initial.atoms.find(candidate => candidate.id === atomId)
          if (!atom) return undefined
          return { atomId: atom.id, fingerprint: atom.fingerprint, sourceRef: atom.sourceRef, before: initial.projectionStates.get(atom.id) === 'exclude' ? 'exclude' : 'include', after: 'exclude' }
        }).filter(Boolean) ?? []
        if (text === target.unit.effectiveText && linkedChanges.length === 0) return success(this.snapshotOf(initial, false), { operationId })
        event = { schemaVersion: 1, type: 'replacement', action: 'replace', eventId: operationId, unitId: target.unit.id, unitKind: target.unit.kind, atomRefs: target.unit.atoms.map(atom => ({ atomId: atom.id, sourceRef: atom.sourceRef, fingerprint: atom.fingerprint })), beforeText: currentState?.replacementText ?? null, afterText: text, baseRevision: initial.revision, createdAt: new Date().toISOString(), ...(link ? { linkedExclusion: { operationId, unitIds: selection?.newlyExcludedUnitIds ?? [], atomChanges: linkedChanges } } : {}) }
      }
      if (event === undefined && action === 'restore') {
        const beforeText = currentState?.replacementText ?? null
        if (beforeText === null) return success(this.snapshotOf(initial, false), { operationId })
        event = { schemaVersion: 1, type: 'replacement', action: 'restore', eventId: operationId, unitId: target.unit.id, unitKind: target.unit.kind, atomRefs: target.unit.atoms.map(atom => ({ atomId: atom.id, sourceRef: atom.sourceRef, fingerprint: atom.fingerprint })), beforeText, afterText: null, baseRevision: initial.revision, createdAt: new Date().toISOString() }
      }
      if (event === undefined && action === 'undo') {
        const undoOf = currentState?.activeEventId
        if (!undoOf || !target.unit.canUndoReplacement) return success(this.snapshotOf(initial, false), { operationId })
        const original = row.replacementEvents.find(value => value.eventId === undoOf)
        const linked = original?.linkedExclusion
        event = { schemaVersion: 1, type: 'replacement', action: 'undo', eventId: operationId, unitId: target.unit.id, unitKind: target.unit.kind, undoOf, baseRevision: initial.revision, createdAt: new Date().toISOString(), ...(linked ? { linkedExclusion: { operationId, unitIds: linked.unitIds, atomChanges: linked.atomChanges.map(change => ({ ...change, before: change.after, after: change.before })) } } : {}) }
      }
      if (event === undefined) throw new Error('CONTEXT_EDITOR_REPLACEMENT_ACTION_INVALID')
      const replacementEvents = row.replacementEvents.some(value => value.eventId === event.eventId) ? row.replacementEvents : [...row.replacementEvents, event]
      await this.table.put(sessionId, { session: row.session, schemaVersion: 1, storageVersion: 1, events: row.events, replacementEvents, condensationEvents: row.condensationEvents ?? [] })
      return withSourceAgent(this.ctx, sessionId, async agent => {
        const session = agent.session
        const sourceProjection = this.projectionFromSession(session)
        const priorEvent = (session.events ?? []).find(value => value?.type === 'context/projection' && value?.data?.owner === CONTEXT_PROJECTION_OWNER && value?.data?.operationId === operationId)
        if (priorEvent !== undefined) {
          await this.ctx.sessions.flush(session)
          this.searchCache.clear()
          const next = this.projectionFromSession(session)
          return success(this.snapshotOf(next, false), { operationId, eventId: String(priorEvent.seq) })
        }
        if (sourceProjection.revision !== initial.revision) return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(sourceProjection, false) }
        const calculated = buildNativeReplacementChanges(sourceProjection, event, { operationId })
        if (calculated.changes.length === 0) throw new Error('CONTEXT_EDITOR_REPLACEMENT_ALIGNMENT_FAILED')
        const baseSeq = session.events.at(-1)?.seq ?? -1
        if (baseSeq < 0) throw new Error('CONTEXT_EDITOR_SESSION_EMPTY')
        const data = { schemaVersion: 1, owner: CONTEXT_PROJECTION_OWNER, operationId, baseSeq, changes: calculated.changes }
        const nativeEvent = typeof session.appendContextProjection === 'function' ? session.appendContextProjection(data) : session.append('context/projection', data)
        await this.ctx.sessions.flush(session)
        this.searchCache.clear()
        const next = this.projectionFromSession(session)
        return success(this.snapshotOf(next, false), { operationId, eventId: String(nativeEvent.seq) })
      })
    })
  }

  async commitReplacement(request) { return this.commitReplacementMutation(request, 'replace') }
  async restoreReplacement(request) { return this.commitReplacementMutation(request, 'restore') }
  async undoReplacement(request) { return this.commitReplacementMutation(request, 'undo') }

  async commitView(request) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const projection = await this.readProjection(sessionId)
      if (String(request?.baseRevision ?? '') !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(projection) }
      }
      const action = request?.action
      if (!['hide', 'restore', 'reset'].includes(action)) throw new Error('CONTEXT_EDITOR_ACTION_INVALID')
      // Re-read immediately before constructing the event.  This closes the
      // normal cross-client race window even when another writer shares the
      // same storage-domain table; a stale writer gets the authoritative
      // snapshot and never performs a partial write.
      const latest = await this.readProjection(sessionId)
      if (latest.revision !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(latest) }
      }
      const event = buildViewEvent({
        identity: latest.identity,
        sourceRevision: latest.sourceRevision,
        baseRevision: latest.revision,
        events: latest.events,
        records: latest.records,
        states: latest.states,
        action,
        recordIds: Array.isArray(request?.recordIds) ? request.recordIds : undefined,
        unitIds: Array.isArray(request?.unitIds) ? request.unitIds : undefined,
        transactionId: randomId('context-view'),
      })
      if (event.changes.length === 0) return success(this.snapshotOf(projection))
      const nextRow = {
        session: {
          createdAt: latest.identity.createdAt,
          ...(latest.identity.cwd === undefined ? {} : { cwd: latest.identity.cwd }),
        },
        schemaVersion: 1,
        storageVersion: 1,
        events: [...latest.events, event],
        replacementEvents: latest.replacementEvents ?? [],
        condensationEvents: latest.condensationEvents ?? [],
      }
      await this.table.put(sessionId, nextRow)
      this.searchCache.clear()
      const next = await this.readProjection(sessionId)
      return success(this.snapshotOf(next), { eventId: event.transactionId })
    })
  }

  async undoView(request) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const projection = await this.readProjection(sessionId)
      if (String(request?.baseRevision ?? '') !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(projection) }
      }
      const latest = await this.readProjection(sessionId)
      if (latest.revision !== projection.revision) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(latest) }
      }
      const target = latestUndoableEvent(latest.events)
      if (target === undefined) return success(this.snapshotOf(projection))
      const event = {
        version: 2,
        transactionId: randomId('context-undo'),
        createdAt: new Date().toISOString(),
        baseRevision: latest.revision,
        action: 'undo',
        changes: inverseChanges(target),
        undoOf: target.transactionId,
      }
      await this.table.put(sessionId, {
        session: {
          createdAt: latest.identity.createdAt,
          ...(latest.identity.cwd === undefined ? {} : { cwd: latest.identity.cwd }),
        },
        schemaVersion: 1,
        storageVersion: 1,
        events: [...latest.events, event],
        replacementEvents: latest.replacementEvents ?? [],
        condensationEvents: latest.condensationEvents ?? [],
      })
      this.searchCache.clear()
      const next = await this.readProjection(sessionId)
      return success(this.snapshotOf(next), { eventId: event.transactionId })
    })
  }
}

/** Official Harness plugin entry; the patch row mounts this one Host face. */
export async function apply(ctx) {
  const host = new ContextEditorHost(ctx)
  await host.init()
  ctx.effect(() => async () => {
    await host.dispose()
  }, 'context-editor-deepseek-harness: dispose')
}

export { PACKAGE_NAME }
