/**
 * DeepSeek Harness Host adapter.
 *
 * The adapter reads the complete durable Session event log, projects only
 * finalized user/AI/tool records, stores visual V2 view events in a separate
 * storage-domain sidecar, and folds native `context/projection` events into
 * model-derived messages. Surface events and normal Chat display remain unchanged.
 */

import { createHash } from 'node:crypto'
import { defineDomain, domainTable, TypertRemoteService, foldSurface, Session, HostHistoryView, restoreSession } from './host-api.js'
import { z } from 'zod'
import { reduceReplacementStates, selectAssociatedReasoningTargets, selectProjectionTargets, selectCondensationRange, validateCondensationSummary, frameCondensationSummary, estimateCondensationTokens, deriveCondensationCoverage } from './core-runtime.js'
import {
  buildProjection,
  selectCheckpointCondensationRange,
  canCondenseReasoningBlock,
  buildViewEvent,
  composeNativeRoot,
  inverseChanges,
  latestUndoableEvent,
  normalizeReplacementEvents,
  normalizeViewEvents,
  projectRecords,
  parseContextEditorSurfaceMarker,
  projectedMessageSource,
  recordSnapshot,
  sameSessionLifecycle,
  searchRecords,
  sessionIdentity,
  CONTEXT_PROJECTION_OWNER,
} from './core.js'
import { PACKAGE_NAME } from './typert.js'
import { HistoryIndex } from './history-index.js'
import { RequestTransformRuntime, requestTransformDomain, transformMessages, canTransformMessage, REQUEST_PROVIDER, requestFingerprint } from './request-transform.js'
import {
  compatibilityCacheKey,
  createCompatibilityReport,
  detectHostAdapter,
  PLUGIN_VERSION,
  runSurfaceSelfTest,
  SURFACE_ADAPTER_ID,
} from './host-compat.js'

const nativeProjectionSupported = typeof Session?.prototype.appendContextProjection === 'function'
function requireNativeProjection(host, feature = 'contextExclusion') {
  if (host.compatibilityReport !== undefined) {
    const result = host.compatibilityReport.features?.[feature]
    if (result?.available === true) return
    const reason = result?.reason ?? 'host-capability-not-confirmed'
    const error = new Error(`CONTEXT_EDITOR_FEATURE_UNSUPPORTED:${reason}`)
    error.code = 'CONTEXT_EDITOR_FEATURE_UNSUPPORTED'
    error.reason = reason
    throw error
  }
  if (!(host.nativeProjectionSupported ?? nativeProjectionSupported)) throw new Error('CONTEXT_EDITOR_NATIVE_PROJECTION_UNSUPPORTED')
}

export const inject = ['storageDomain', 'sessionPersistence', 'sessions', 'agents', 'agentPresets', 'llm']

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
  checkpointSeq: nonNegativeSafeInteger.optional(),
  checkpointMessageId: z.string().optional(),
  recoveryAnchorSeq: z.number().int().min(-1).optional(),
  recoveryPrefixFingerprint: z.string().optional(),
  recoverySessionId: z.string().optional(),
  coverage: condensationCoverageSchema.optional(),
}).passthrough()
const recoveryEventSchema = z.object({
  operationId: z.string().min(1),
  sourceOperationId: z.string().min(1).optional(),
  sourceSessionId: z.string().min(1),
  childSessionId: z.string().min(1),
  kind: z.enum(['condensation', 'native-compaction']),
  status: z.enum(['pending', 'persisted-and-verified', 'unverified', 'failed']),
  boundarySeq: z.number().int().min(-1),
  prefixFingerprint: z.string().min(1),
  contextFingerprint: z.string().min(1),
  createdAt: z.string(),
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
  recoveryEvents: z.array(recoveryEventSchema).optional(),
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
  const eventId = extra.eventId
  const eventSeq = eventId !== undefined && Number.isSafeInteger(Number(eventId)) && String(Number(eventId)) === String(eventId)
  const commit = extra.commit ?? (eventId === undefined ? undefined : {
    operationId: String(extra.operationId ?? eventId),
    status: 'persisted-and-verified',
    eventId: String(eventId),
    persistenceLocation: eventSeq ? 'session-log' : 'context_editor',
    contextVersion: String(snapshot?.contextRevision ?? snapshot?.revision ?? ''),
  })
  return { ok: true, ...extra, ...(commit === undefined ? {} : { commit }), snapshot }
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
      ...(Number.isSafeInteger(raw.checkpointSeq) ? { checkpointSeq: Number(raw.checkpointSeq) } : {}),
      ...(typeof raw.checkpointMessageId === 'string' ? { checkpointMessageId: raw.checkpointMessageId } : {}),
      ...(Number.isSafeInteger(raw.recoveryAnchorSeq) ? { recoveryAnchorSeq: raw.recoveryAnchorSeq } : {}),
      ...(typeof raw.recoveryPrefixFingerprint === 'string' ? { recoveryPrefixFingerprint: raw.recoveryPrefixFingerprint } : {}),
      ...(typeof raw.recoverySessionId === 'string' ? { recoverySessionId: raw.recoverySessionId } : {}),
      ...(raw.coverage && ['none', 'partial', 'full'].includes(raw.coverage.status)
        ? { coverage: normalizeCondensationCoverage(raw.coverage) }
        : {}),
    }
  })
}

function normalizeRecoveryEvents(events) {
  return (Array.isArray(events) ? events : []).filter(value => recoveryEventSchema.safeParse(value).success).map(value => ({
    ...value,
    operationId: String(value.operationId),
    sourceSessionId: String(value.sourceSessionId),
    childSessionId: String(value.childSessionId),
    kind: value.kind === 'native-compaction' ? 'native-compaction' : 'condensation',
    status: ['pending', 'persisted-and-verified', 'unverified', 'failed'].includes(value.status) ? value.status : 'unverified',
    boundarySeq: Number(value.boundarySeq),
    prefixFingerprint: String(value.prefixFingerprint),
    contextFingerprint: String(value.contextFingerprint),
    createdAt: String(value.createdAt),
  }))
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
  const checkpoint = parseCondensationCheckpointId(data.id)
  if (checkpoint) return checkpoint.operationId
  return undefined
}

function condensationActionForEvent(event) {
  const data = asObject(event?.data)
  const explicit = data.condensationAction ?? data.condensation?.action
  if (explicit === 'apply' || explicit === 'restore') return explicit
  return parseCondensationCheckpointId(data.id) ? 'apply' : undefined
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
      // alpha.2 names the inclusive range `startSeq`/`endSeq`. Retain the
      // earlier `start`/`end` spelling for persisted records from older host
      // adapters, but never accept a different range as proof of coverage.
      const surfaceStart = surfaceOp?.startSeq ?? surfaceOp?.start
      const surfaceEnd = surfaceOp?.endSeq ?? surfaceOp?.end
      const rangeMatches = !shadowedRange || (surfaceStart === Number(shadowedRange.start) && surfaceEnd === Number(shadowedRange.end))
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
    const action = condensationActionForEvent(event)
    if (action === 'restore') restored.add(id)
    else if (action === 'apply') applied.add(id)
  }
  const compactions = nativeCompactionEvidence(sourceEvents)
  return normalizeCondensationEvents(rowEvents)
    .filter(event => event.status !== 'restored' && applied.has(event.operationId) && !restored.has(event.operationId))
    .map(event => {
      const checkpointSeq = Number.isSafeInteger(event.checkpointSeq)
        ? event.checkpointSeq
        : (Array.isArray(sourceEvents) ? sourceEvents.find(value => nativeCondensationOperationId(value) === event.operationId)?.seq : undefined)
      const coverageRoots = [...event.sourceRootSeqs, ...(Number.isSafeInteger(checkpointSeq) ? [checkpointSeq] : [])]
      return {
        ...event,
        ...(Number.isSafeInteger(checkpointSeq) ? { checkpointSeq } : {}),
        coverage: deriveCondensationCoverage(coverageRoots, compactions),
      }
    })
}

function condensationSnapshot(event, projection) {
  const firstRoot = Number(event.sourceRootSeqs?.[0])
  const overlay = projection?.contextOverlays?.get(firstRoot)
  const contextExcluded = Number.isSafeInteger(event.checkpointSeq)
    ? false
    : overlay?.mode === 'remove' || !(overlay?.message?.content ?? []).some(block => block.type === 'text' && block.text === frameCondensationSummary(event.summary))
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
    ...(Number.isSafeInteger(event.checkpointSeq) ? {
      checkpointSeq: event.checkpointSeq,
      checkpointMessageId: event.checkpointMessageId,
      recovery: {
        available: Number.isSafeInteger(event.recoveryAnchorSeq),
        mode: 'branch',
        boundarySeq: event.recoveryAnchorSeq,
        status: event.recoveryStatus ?? 'available',
        ...(event.recoverySessionId ? { sessionId: event.recoverySessionId } : {}),
      },
    } : {}),
    ...(event.coverage ? { coverage: event.coverage } : {}),
  }
}

function nativeCompactionRecoveryOptions(sourceEvents) {
  return nativeCompactionEvidence(sourceEvents).filter(ref => ref.committed === true).map(ref => {
    const start = sourceEvents.find(event => event?.type === 'compaction/start' && String(event?.data?.compactionId ?? '') === ref.compactionId)
    const boundary = sourceEvents.filter(event => event?.type === 'turn/end'
      && Number.isSafeInteger(event.seq)
      && (start === undefined || event.seq < start.seq)).at(-1)
    const summaryEvent = sourceEvents.find(event => event?.type === 'compaction/summary' && String(event?.data?.compactionId ?? '') === ref.compactionId)
    const summary = (Array.isArray(summaryEvent?.data?.summary) ? summaryEvent.data.summary : [])
      .filter(block => block?.type === 'text')
      .map(block => String(block.text ?? ''))
      .join('\n')
    return {
      kind: 'native-compaction',
      operationId: ref.compactionId,
      compactionId: ref.compactionId,
      checkpointSeq: ref.checkpointSeq,
      summary,
      available: boundary !== undefined,
      ...(boundary === undefined ? { reason: 'recovery-boundary-unavailable' } : { boundarySeq: Number(boundary.seq) }),
    }
  })
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
function opaqueCondensationSource(projection, sources) {
  return sources.find(source => {
    if (source.structured) return true
    if ((source.sourceRootSeqs ?? []).some(root => messageForRoot(projection.sourceEvents[Number(root)])?.content?.some(block => block.type === 'image'))) return true
    if (!source.hasSignature) return false
    // A signature protects the original thought, not a new text summary of it.
    // Only allow a known, readable block whose entire atom is being replaced.
    const atoms = (source.atomIds ?? []).map(id => projection.atoms.find(atom => atom.id === id))
    if (!atoms.length || atoms.some(atom => !atom)) return true
    return atoms.some(atom => atom.hasSignature && !canCondenseReasoningBlock(
      messageForRoot(projection.sourceEvents.find(event => eventSequence(event) === Number(atom.sourceRef?.entryId))),
      atom.sourceRef?.blockIndex,
    ))
  })
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
    return { rootEventSeq: root, mode: 'replace', message: { ...structuredClone(composed.message), id: root === first ? summaryMessage.id : summaryMessage.id + '-' + root, source: composed.message?.source?.kind === 'model' ? projectedMessageSource(composed.message, content) : summaryMessage.source, content } }
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
  if (summaryMessage.source?.kind === 'model') withoutSummary.source = projectedMessageSource(summaryMessage, withoutSummary.content)
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
    copy.source = projectedMessageSource(original, copy.content)
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
    copy.source = projectedMessageSource(composed.message, copy.content)
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
    { preserveSignedReasoning: projection.requestTransform === true },
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

function selectionFingerprint(projection, unitIds) {
  const ids = new Set(unitIds)
  return requestFingerprint(projection.records.flatMap(record => record.units).filter(unit => ids.has(unit.id))
    .map(unit => ({ id: unit.id, atoms: unit.atoms.map(atom => [atom.id, atom.fingerprint]), text: unit.effectiveText, context: unit.projectionState })))
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

function sessionEvents(session) {
  if (typeof session?.eventAt === 'function' && Number.isSafeInteger(session?.seq) && session.seq >= 0) {
    const events = []
    for (let seq = 0; seq < session.seq; seq += 1) {
      const event = session.eventAt(seq)
      if (event === undefined) throw new Error('CONTEXT_EDITOR_SESSION_HISTORY_GAP:' + seq)
      events.push(event)
    }
    return events
  }
  if (typeof session?.snapshotEvents === 'function') return session.snapshotEvents()
  if (Array.isArray(session?.events)) return session.events
  throw new Error('CONTEXT_EDITOR_SESSION_HISTORY_UNAVAILABLE')
}

async function readSessionPages(handle, startOffset = 0, prefix = []) {
  const events = [...prefix]
  let offset = startOffset
  for (let page = 0; page < 1_000_000; page += 1) {
    const result = await handle.read(offset, 256)
    const batch = Array.isArray(result?.events) ? result.events : []
    if (batch.length === 0) break
    for (let index = 0; index < batch.length; index += 1) {
      const event = batch[index]
      if (!Number.isSafeInteger(event?.seq) || event.seq !== offset + index) {
        throw new Error('CONTEXT_EDITOR_SESSION_HISTORY_GAP:' + (offset + index))
      }
      events.push(event)
    }
    offset += batch.length
    if (batch.length < 256) break
  }
  if (offset >= 256 * 1_000_000) throw new Error('CONTEXT_EDITOR_SESSION_HISTORY_LIMIT')
  return events
}

function moveMapEntryToEnd(map, key, value) {
  map.delete(key)
  map.set(key, value)
  while (map.size > 16) map.delete(map.keys().next().value)
}

function activeSurfaceRoots(events, nodes) {
  return [...new Set((nodes ?? []).map(seq => {
    const event = events[Number(seq)]
    return parseContextEditorSurfaceMarker(event?.data?.id)?.rootEventSeq ?? Number(seq)
  }).filter(Number.isSafeInteger))]
}

function surfaceReplacementId(sessionId, rootEventSeq, operationId) {
  return `context-editor-surface-v1:${encodeURIComponent(String(sessionId))}:${rootEventSeq}:${encodeURIComponent(String(operationId))}`
}

function condensationCheckpointId(sessionId, operationId) {
  return `context-editor-condensation-v1:${encodeURIComponent(String(sessionId))}:${encodeURIComponent(String(operationId))}`
}

function parseCondensationCheckpointId(value) {
  const match = /^context-editor-condensation-v1:([^:]+):([^:]+)$/u.exec(String(value ?? ''))
  if (!match) return undefined
  try {
    return { sessionId: decodeURIComponent(match[1]), operationId: decodeURIComponent(match[2]) }
  } catch {
    return undefined
  }
}

function recoveryOperationId(kind, sessionId, operationId) {
  return `${kind}:${String(sessionId)}:${String(operationId)}`
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function recoverySessionId(sourceSessionId, operationId) {
  const digest = createHash('sha256').update(`${sourceSessionId}\0${operationId}`).digest('hex').slice(0, 40)
  return `context-editor-recovery-${digest}`
}

function surfaceReplaceOp(host, startSeq, endSeq) {
  // alpha.2 renamed the range fields while preserving the Surface semantics.
  // Select by the detected contract rather than guessing from a version string.
  return host.hostAdapter === SURFACE_ADAPTER_ID
    ? { op: 'replace', startSeq, endSeq }
    : { op: 'replace', start: startSeq, end: endSeq }
}

function surfaceRangeForRoots(session, roots, projections = []) {
  const events = sessionEvents(session)
  const rootSet = new Set(roots.map(Number))
  const eventBySeq = new Map(events.map(event => [Number(event?.seq), event]))
  const nodes = foldSurface(events, projections).nodes.map(seq => {
    const event = eventBySeq.get(Number(seq))
    const marker = parseContextEditorSurfaceMarker(event?.data?.id)
    return { seq: Number(seq), root: marker?.rootEventSeq ?? Number(seq), event }
  })
  const indexes = nodes.flatMap((node, index) => rootSet.has(node.root) ? [index] : [])
  if (!indexes.length) throw new Error('CONTEXT_EDITOR_CONDENSATION_SURFACE_RANGE_EMPTY')
  const start = indexes[0]
  const end = indexes.at(-1)
  const range = nodes.slice(start, end + 1)
  if (range.some(node => !rootSet.has(node.root)) || roots.some(root => !range.some(node => node.root === root))) {
    throw new Error('CONTEXT_EDITOR_CONDENSATION_SURFACE_RANGE_NON_CONTIGUOUS')
  }
  if (range.some(node => !Number.isSafeInteger(node.seq) || node.seq < 0)) throw new Error('CONTEXT_EDITOR_CONDENSATION_SURFACE_RANGE_INVALID')
  return {
    startSeq: range[0].seq,
    endSeq: range.at(-1).seq,
    sourceEventSeqs: range.map(node => node.seq),
    events,
  }
}

function prefixThrough(events, boundarySeq) {
  if (!Number.isSafeInteger(boundarySeq) || boundarySeq < -1) throw new Error('CONTEXT_EDITOR_RECOVERY_BOUNDARY_INVALID')
  const prefix = events.filter(event => Number(event?.seq) <= boundarySeq)
  if (prefix.length !== boundarySeq + 1 || prefix.some((event, index) => Number(event?.seq) !== index)) {
    throw new Error('CONTEXT_EDITOR_RECOVERY_PREFIX_GAP')
  }
  return prefix
}

function balancedRecoveryPrefix(events) {
  let turnOpen = false
  let stepOpen = false
  const tools = new Set()
  for (const event of events) {
    const data = asObject(event?.data)
    if (event?.type === 'turn/start') {
      if (turnOpen) return false
      turnOpen = true
    } else if (event?.type === 'turn/end') {
      if (!turnOpen) return false
      turnOpen = false
      stepOpen = false
    } else if (event?.type === 'step/start') {
      if (!turnOpen || stepOpen) return false
      stepOpen = true
    } else if (event?.type === 'step/end') {
      if (!turnOpen || !stepOpen) return false
      stepOpen = false
    }
    const message = event?.type === 'assistant/message' ? data.message : undefined
    for (const block of Array.isArray(message?.content) ? message.content : []) {
      if (block?.type === 'tool-call' && typeof block.id === 'string') tools.add(block.id)
    }
    if (event?.type === 'tool/result') {
      const callId = String(data.message?.source?.callId ?? '')
      if (callId) tools.delete(callId)
    }
  }
  return !turnOpen && !stepOpen && tools.size === 0
}

function recoveryPrefixInfo(sessionId, events, boundarySeq, header, inheritedEventCount, projections = []) {
  const prefix = prefixThrough(events, boundarySeq)
  if (!balancedRecoveryPrefix(prefix)) throw new Error('CONTEXT_EDITOR_RECOVERY_BOUNDARY_NOT_BALANCED')
  const session = restoreSession(sessionId, prefix, header, inheritedEventCount, projections)
  const messages = session.deriveMessages()
  return { prefix, messages, prefixFingerprint: fingerprint(prefix), contextFingerprint: fingerprint(messages) }
}

function textMessageText(message) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter(block => block?.type === 'text')
    .map(block => String(block.text ?? ''))
    .join('')
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
  static compatibilityReports = new Map()
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
    this.historyCache = new Map()
    this.recoveryHandles = new Map()
    this.compatibilityReport = undefined
    this.hostAdapter = undefined
    this.compatibilityCacheKey = undefined
    this.mutationAdmissionOpen = true
  }

  async init() {
    this.domain = await this.ctx.storageDomain.open(contextEditorDomainSpec)
    this.table = this.domain.table('sessions')
    this.hostAdapter = detectHostAdapter(this.ctx)
    const initialReport = createCompatibilityReport(this.ctx, PLUGIN_VERSION, this.hostAdapter)
    this.compatibilityCacheKey = compatibilityCacheKey(initialReport)
    const cached = ContextEditorHost.compatibilityReports.get(this.compatibilityCacheKey)
    if (cached !== undefined) {
      this.compatibilityReport = cached
    } else {
      const selfTest = this.hostAdapter === SURFACE_ADAPTER_ID ? runSurfaceSelfTest(this.ctx) : undefined
      this.compatibilityReport = createCompatibilityReport(this.ctx, PLUGIN_VERSION, this.hostAdapter, selfTest)
      ContextEditorHost.compatibilityReports.set(this.compatibilityCacheKey, this.compatibilityReport)
    }
    if (this.hostAdapter === SURFACE_ADAPTER_ID
      && typeof this.ctx.llm?.registerAdapter === 'function' && typeof this.ctx.llm?.resolveModelInfo === 'function') {
      const domain = await this.ctx.storageDomain.open(requestTransformDomain)
      this.requestTransform = new RequestTransformRuntime(this.ctx, domain)
      try { await this.requestTransform.install() } catch (error) {
        await this.requestTransform.dispose()
        await this.domain.close()
        throw error
      }
      this.applyRequestCapabilities()
    }
  }

  applyRequestCapabilities() {
    if (this.requestTransform) {
      const reason = this.requestTransform.availabilityReason()
      this.compatibilityReport = structuredClone(this.compatibilityReport)
      for (const feature of ['contextExclusion', 'assistantReplacement', 'contextReplacement']) {
        this.compatibilityReport.features[feature] = {
          available: !reason, status: reason ? 'unsupported' : 'available', verificationLevel: 'interface-recognized',
          ...(reason ? { reason } : {}),
          scope: 'recognized-text-reasoning-tools-and-image-text-through-context-editor-provider',
          evidence: ['Plugin-owned persisted model profiles; original Session events remain intact', 'Requires the Context Editor Provider; full host acceptance is recorded separately'],
        }
      }
    }
  }

  async dispose() {
    this.mutationAdmissionOpen = false
    for (const controller of this.condensationControllers.values()) controller.abort()
    this.condensationControllers.clear()
    await Promise.all(this.operationTails.values())
    await Promise.all([...this.recoveryHandles.values()].map(handle => handle.dispose().catch(() => undefined)))
    this.recoveryHandles.clear()
    if (this.requestTransform) await this.requestTransform.dispose()
    if (this.domain !== undefined) await this.domain.close()
    this.historyCache.clear()
    this.projectionIndex?.clear()
    this.durableProjectionCache?.clear()
    this.table = undefined
    this.searchCache.clear()
  }

  async inspect(sessionId) {
    if (!sessionId) throw new Error('CONTEXT_EDITOR_SESSION_REQUIRED')
    const persistence = this.ctx.sessionPersistence
    if (this.hostAdapter !== SURFACE_ADAPTER_ID && typeof persistence.inspect === 'function') return persistence.inspect(sessionId)
    if (typeof persistence.open !== 'function') throw new Error('CONTEXT_EDITOR_SESSION_HISTORY_UNAVAILABLE')
    const historyCache = this.historyCache ?? (this.historyCache = new Map())

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const before = typeof persistence.stat === 'function' ? await persistence.stat(sessionId) : undefined
      const cached = historyCache.get(sessionId)
      const beforeRevision = before?.revision === undefined ? undefined : String(before.revision)
      if (before !== undefined && cached?.revision === beforeRevision) {
        moveMapEntryToEnd(historyCache, sessionId, cached)
        return { meta: before.header, inheritedEventCount: cached.inheritedEventCount, events: cached.events, revision: beforeRevision, eventCount: cached.events.length }
      }

      const handle = await persistence.open(sessionId, 'read')
      try {
        let prefix = []
        let offset = 0
        const eventCount = Number.isSafeInteger(before?.eventCount) ? before.eventCount : undefined
        const sameLifecycle = cached !== undefined
          && String(cached.header?.id ?? '') === String(handle.header?.id ?? sessionId)
          && Number(cached.header?.createdAt ?? 0) === Number(handle.header?.createdAt ?? 0)
          && String(cached.header?.cwd ?? '') === String(handle.header?.cwd ?? '')
        if (sameLifecycle && eventCount !== undefined && cached.events.length <= eventCount && cached.events.length > 0) {
          const tail = await handle.read(cached.events.length - 1, 1)
          const candidate = tail?.events?.[0]
          if (candidate?.seq === cached.events.length - 1 && sameJson(candidate, cached.events.at(-1))) {
            prefix = cached.events
            offset = prefix.length
          }
        }
        const events = await readSessionPages(handle, offset, prefix)
        if (eventCount !== undefined && events.length !== eventCount) {
          if (attempt < 2) continue
          throw new Error('CONTEXT_EDITOR_SESSION_HISTORY_CHANGED_DURING_READ')
        }
        const after = typeof persistence.stat === 'function' ? await persistence.stat(sessionId) : undefined
        if (beforeRevision !== undefined && after?.revision !== undefined && String(after.revision) !== beforeRevision) {
          if (attempt < 2) continue
          throw new Error('CONTEXT_EDITOR_SESSION_HISTORY_CHANGED_DURING_READ')
        }
        const revision = after?.revision ?? before?.revision
        const record = { revision: revision === undefined ? undefined : String(revision), eventCount: events.length, header: handle.header, inheritedEventCount: handle.inheritedEventCount, events }
        moveMapEntryToEnd(historyCache, sessionId, record)
        return {
          meta: handle.header,
          inheritedEventCount: handle.inheritedEventCount,
          events,
          ...(record.revision === undefined ? {} : { revision: record.revision }),
          ...(before === undefined && after === undefined ? {} : { eventCount: events.length }),
        }
      } finally {
        await handle.close()
      }
    }
    throw new Error('CONTEXT_EDITOR_SESSION_HISTORY_CHANGED_DURING_READ')
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
        recoveryEvents: normalizeRecoveryEvents(stored.recoveryEvents),
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
      recoveryEvents: [],
    }
  }

  contextRevisionFromEvents(identity, events, header, inheritedEventCount = 0) {
    if (this.hostAdapter !== SURFACE_ADAPTER_ID) return undefined
    const session = restoreSession(identity.id, events, header, inheritedEventCount, this.ctx.sessions.messageProjections)
    return this.contextRevisionFromSession(session)
  }

  contextRevisionFromSession(session) {
    if (this.hostAdapter !== SURFACE_ADAPTER_ID) return undefined
    const payload = {
      header: { ...session.header, delegationDepth: session.header.delegationDepth ?? 0 },
      requestHeader: typeof session.requestHeader === 'function' ? session.requestHeader() : undefined,
      requestContext: typeof session.requestContext === 'function' ? session.requestContext() : undefined,
      messages: this.requestTransform?.fromSession(session)
        ? transformMessages(session.deriveMessages(), this.requestTransform.fromSession(session).profile)
        : session.deriveMessages(),
    }
    return 'dsh-context-v1:' + requestFingerprint(payload)
  }
  applyAdapterCapabilities(projection) {
    projection.requestTransform = Boolean(this.requestTransform)
    if (this.hostAdapter !== SURFACE_ADAPTER_ID && this.hostAdapter !== 'read-only') return projection
    const surfaceWriteAvailable = this.compatibilityReport?.features?.contextReplacement?.available === true
    const bySequence = new Map(projection.sourceEvents.map(event => [event.seq, event]))
    for (const record of projection.records ?? []) {
      for (const unit of record.units ?? []) {
        const root = Number(unit.atoms[0]?.sourceRef?.entryId)
        const rootEvent = bySequence.get(root)
        if (this.requestTransform) {
          const supported = unit.atoms.every(atom => {
            const event = bySequence.get(Number(atom.sourceRef?.entryId))
            return canTransformMessage(event?.type === 'user/message' ? event.data : event?.data?.message)
          })
          const signedReasoning = unit.kind === 'reasoning' && unit.atoms.some(atom => atom.hasSignature)
          unit.operations = {
            edit: { available: supported && unit.replacementSupported === true, ...(!supported ? { reason: 'request-transform-unsupported-block' } : unit.replacementSupported ? {} : { reason: unit.replacementDisabledReason ?? 'unsupported-unit-kind' }) },
            exclude: { available: supported && !signedReasoning, ...(!supported ? { reason: 'request-transform-unsupported-block' } : signedReasoning ? { reason: 'signed-content' } : {}) },
            restore: { available: supported && !signedReasoning, ...(!supported ? { reason: 'request-transform-unsupported-block' } : signedReasoning ? { reason: 'signed-content' } : {}) },
            condense: { available: supported && !unit.atoms.some(atom => atom.structured || messageForRoot(bySequence.get(Number(atom.sourceRef?.entryId)))?.content?.some(block => block.type === 'image')), reason: 'requires-complete-closed-turn-selection' },
          }
          if (supported && !signedReasoning) continue
          unit.contextMutationDisabledReason = signedReasoning ? 'signed-content' : 'request-transform-unsupported-block'
          unit.replacementSupported = false
          unit.replacementDisabledReason = unit.contextMutationDisabledReason
          continue
        }
        const source = rootEvent?.type === 'user/message' ? rootEvent : undefined
        const content = Array.isArray(source?.data?.content) ? source.data.content : []
        const plainSingleTextMessage = unit.atoms.length === 1 && unit.atoms.every(atom => atom.structured !== true)
          && content.length === 1 && content[0]?.type === 'text' && typeof content[0]?.text === 'string'
        if (this.hostAdapter === SURFACE_ADAPTER_ID && surfaceWriteAvailable
          && unit.kind === 'user' && plainSingleTextMessage) continue
        unit.replacementSupported = false
        unit.replacementDisabledReason = 'host-surface-contract'
      }
    }
    return projection
  }

  async readProjection(sessionId) {
    const inspection = await this.inspect(sessionId)
    const identity = identityFromInspection(inspection, sessionId)
    const row = this.rowFor(identity)
    const events = inspection.events ?? []
    const cache = this.durableProjectionCache ??= new Map()
    const cached = cache.get(sessionId)
    const rowKey = requestFingerprint([identity, row])
    const projections = this.ctx.sessions?.messageProjections ?? []
    const sameHistory = cached?.events === events && cached.count === events.length && cached.last === requestFingerprint(events.at(-1) ?? null) && cached.headerKey === requestFingerprint(inspection.meta ?? inspection.header)
      && projections.length === cached.projections.length && projections.every((value, index) => value === cached.projections[index])
    if (sameHistory && cached.rowKey === rowKey) return cached.projection
    const samePrefix = cached && cached.count <= events.length && cached.last === requestFingerprint(events[cached.count - 1] ?? null)
      && cached.headerKey === requestFingerprint(inspection.meta ?? inspection.header)
      && projections.length === cached.projections.length && projections.every((value, index) => value === cached.projections[index])
    const reader = samePrefix ? cached.reader : new HostHistoryView(identity.id, events, inspection.meta ?? inspection.header, inspection.inheritedEventCount, projections)
    if (samePrefix && !sameHistory) reader.update(events)
    const surfaceNodes = reader.nodes
    const activeSurfaceSeqs = activeSurfaceRoots(events, surfaceNodes)
    const profile = this.requestTransform?.selected(events)?.profile
    this.projectionIndex ??= new HistoryIndex()
    const projection = this.projectionIndex.build(identity, events, row, { activeSurfaceSeqs, committedReplacementEvents: profile?.replacementEvents, requestOverlays: profile?.changes })
    projection.sessionHeader = inspection.meta ?? inspection.header
    projection.inheritedEventCount = inspection.inheritedEventCount ?? 0
    projection.condensationEvents = activeCondensationEvents(row.condensationEvents, events)
    projection.contextRevision = sameHistory ? cached.projection.contextRevision : this.contextRevisionFromSession(reader)
    this.applyAdapterCapabilities(projection)
    cache.delete(sessionId)
    cache.set(sessionId, { events, count: events.length, last: requestFingerprint(events.at(-1) ?? null), rowKey, headerKey: requestFingerprint(inspection.meta ?? inspection.header), projections: [...projections], projection, surfaceNodes, reader })
    if (cache.size > 8) cache.delete(cache.keys().next().value)
    return projection
  }

  projectionFromSession(session) {
    const identity = identityFromInspection({ meta: session.header }, session.id)
    const row = this.rowFor(identity)
    const events = sessionEvents(session)
    const surfaceNodes = foldSurface(events, this.ctx.sessions?.messageProjections ?? []).nodes
    const activeSurfaceSeqs = activeSurfaceRoots(events, surfaceNodes)
    const profile = this.requestTransform?.selected(events)?.profile
    const projection = buildProjection(identity, events, row, { activeSurfaceSeqs, committedReplacementEvents: profile?.replacementEvents, requestOverlays: profile?.changes })
    projection.sessionHeader = session.header
    projection.inheritedEventCount = session.inheritedEventCount ?? 0
    projection.condensationEvents = activeCondensationEvents(row.condensationEvents, events)
    projection.contextRevision = this.contextRevisionFromSession(session)
    return this.applyAdapterCapabilities(projection)
  }

  snapshotOf(projection, running = isBusySession(this.ctx, projection.identity.id), options = {}) {
    const legacyWriteSupported = this.nativeProjectionSupported ?? (typeof Session?.prototype.appendContextProjection === 'function')
    const features = this.compatibilityReport?.features ?? {}
    const contextExclusion = features.contextExclusion?.available ?? legacyWriteSupported
    const contextReplacement = features.contextReplacement?.available ?? legacyWriteSupported
    const contextCondensation = features.contextCondensation?.available ?? legacyWriteSupported
    const legacyUnavailableReason = legacyWriteSupported ? undefined : 'native-projection-unsupported'
    const includeRecords = options.includeRecords !== false
    return {
      host: 'deepseek-harness',
      ...(this.requestTransform ? { requestRouting: (() => {
        const selected = this.requestTransform.selected(projection.sourceEvents)
        return { formatVersion: selected?.profile.version ?? null, state: selected?.profile.routeState ?? (selected ? 'active' : 'ordinary'), upstream: selected?.profile.upstream ?? null,
          replayDependency: selected?.profile.routeState !== 'released' && selected?.profile.changes.length === 0 }
      })() } : {}),
      ...(this.compatibilityReport === undefined ? {} : { compatibility: this.compatibilityReport }),
      contextRevision: projection.contextRevision ?? String(projection.sourceRevision),
      historyCursor: String(projection.sourceEvents?.at(-1)?.seq ?? -1),
      sessionId: projection.identity.id,
      revision: projection.revision,
      sourceLeafId: null,
      sourceRevision: String(projection.sourceRevision),
      viewRevision: String(projection.events.length),
      recordCount: projection.records.length,
      recordsIncluded: includeRecords,
      records: includeRecords ? projection.records.map(record => ({
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
          ...(unit.contextMutationDisabledReason ? { contextMutationDisabledReason: unit.contextMutationDisabledReason } : {}),
          ...(unit.replacementDisabledReason ? { replacementDisabledReason: unit.replacementDisabledReason } : {}),
          canRestoreReplacement: unit.canRestoreReplacement,
          canUndoReplacement: unit.canUndoReplacement,
          ...(unit.associatedReasoningUnitIds?.length ? { associatedReasoningUnitIds: unit.associatedReasoningUnitIds } : {}),
        })),
        ...(record.entryId === undefined ? {} : { entryId: record.entryId }),
        ...(record.entryIds?.length ? { entryIds: record.entryIds } : {}),
        ...(record.anchorEntryId === undefined ? {} : { anchorEntryId: record.anchorEntryId }),
        ...(record.toolCallId === undefined ? {} : { toolCallId: record.toolCallId }),
      })) : [],
      canUndo: projection.canUndo,
      legacyStateFound: false,
      running,
      capabilities: {
        paging: true,
        search: true,
        viewMutation: !running,
        undo: !running,
        persistence: true,
        contextExclusion,
        contextReplacement,
        contextCondensation,
        ...(this.hostAdapter === SURFACE_ADAPTER_ID ? { contextReplacementScope: this.requestTransform ? 'text-blocks-with-preserved-known-content' : 'plain-text-user-message' } : {}),
        nativeCompaction: features.nativeCompaction?.available === true,
        nativeCompactionRecovery: features.nativeCompactionRecovery?.available === true,
      },
      ...(!contextExclusion ? { contextMutationUnavailableReason: features.contextExclusion?.reason ?? legacyUnavailableReason ?? 'host-capability-not-confirmed' } : {}),
      ...(!contextCondensation ? { contextCondensationUnavailableReason: features.contextCondensation?.reason ?? legacyUnavailableReason ?? 'host-capability-not-confirmed' } : {}),
      ...(!contextReplacement ? { contextReplacementUnavailableReason: features.contextReplacement?.reason ?? legacyUnavailableReason ?? 'host-capability-not-confirmed' } : {}),
      condensations: (projection.condensationEvents ?? []).map(event => condensationSnapshot(event, projection)),
      recoveryOptions: nativeCompactionRecoveryOptions(projection.sourceEvents ?? []),
    }
  }

  async getCompatibility() {
    return this.compatibilityReport ?? createCompatibilityReport(this.ctx, PLUGIN_VERSION, this.hostAdapter ?? detectHostAdapter(this.ctx))
  }

  async runCompatibilityCheck() {
    const adapter = this.hostAdapter ?? detectHostAdapter(this.ctx)
    const selfTest = adapter === SURFACE_ADAPTER_ID ? runSurfaceSelfTest(this.ctx) : undefined
    this.compatibilityReport = createCompatibilityReport(this.ctx, PLUGIN_VERSION, adapter, selfTest)
    this.compatibilityCacheKey = compatibilityCacheKey(this.compatibilityReport)
    ContextEditorHost.compatibilityReports.set(this.compatibilityCacheKey, this.compatibilityReport)
    this.applyRequestCapabilities()
    return this.compatibilityReport
  }

  async getSnapshot(request) {
    const projection = await this.readProjection(requestSessionId(request))
    return this.snapshotOf(projection, undefined, { includeRecords: request?.includeRecords !== false })
  }

  async listRecords(request) {
    const projection = await this.readProjection(requestSessionId(request))
    const cursor = asPageCursor(request?.cursor)
    const pageSize = clampPageSize(request?.pageSize)
    const page = projection.records.slice(cursor, cursor + pageSize).map((record, index) => ({
      ...recordSnapshot(record),
      historyIndex: cursor + index,
    }))
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
    const recordIndex = projection.recordIndex?.get(request?.recordId) ?? projection.records.findIndex(value => value.id === request?.recordId)
    const record = recordIndex < 0 ? undefined : projection.records[recordIndex]
    return record === undefined
      ? null
      : {
        record: { ...recordSnapshot(record), historyIndex: recordIndex },
        recordIndex,
        revision: projection.revision,
        sourceRevision: String(projection.sourceRevision),
        viewRevision: String(projection.events.length),
        total: projection.records.length,
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
    if (requestedRevision !== undefined && String(requestedRevision) !== projection.revision
      && !(this.requestTransform && String(requestedRevision) === projection.contextRevision)) {
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
    if (this.requestTransform && calculated.selection.effectiveUnitIds.some(id => targetUnit(projection, id)?.unit.contextMutationDisabledReason)) {
      return { ok: false, canCommit: false, disabledReason: 'request-transform-unsupported-block', operationId }
    }
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
      selectionFingerprint: selectionFingerprint(projection, calculated.selection.effectiveUnitIds),
      ...(request?.condensationOperationId === undefined ? {} : { condensationOperationId: String(request.condensationOperationId) }),
    })
    return {
      ok: true,
      operationId,
      expectedRevision: this.requestTransform ? projection.contextRevision : projection.revision,
      action,
      normalizedTargets: calculated.selection.requestedUnitIds,
      effectiveTargets: calculated.selection.effectiveUnitIds,
      selectionFingerprint: selectionFingerprint(projection, calculated.selection.effectiveUnitIds),
      effectiveSelection: projection.records.flatMap(record => record.units).filter(unit => calculated.selection.effectiveUnitIds.includes(unit.id)).map(unit => ({ id: unit.id, kind: unit.kind, preview: unit.effectiveText.slice(0, 160) })),
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
          recoveryEvents: row.recoveryEvents,
        })
      }
    }
    return { ok: true, operationId, cancelled: Boolean(controller) }
  }

  async previewCondensation(request = {}) {
    requireNativeProjection(this, 'contextCondensation')
    const sessionId = requestSessionId(request)
    if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
    const initial = await this.readProjection(sessionId)
    const initialContextVersion = String(initial.contextRevision ?? initial.revision)
    const expectedRevision = request?.baseContextRevision ?? request?.baseRevision ?? request?.expectedRevision
    if (expectedRevision !== undefined && String(expectedRevision) !== initialContextVersion) {
      return { ok: false, conflict: true, snapshot: this.snapshotOf(initial), baseRevision: initialContextVersion, contextRevision: initialContextVersion }
    }
    return withSourceAgent(this.ctx, sessionId, async agent => {
      const session = agent.session
      const projection = this.projectionFromSession(session)
      const contextVersion = String(projection.contextRevision ?? projection.revision)
      if (expectedRevision !== undefined && String(expectedRevision) !== contextVersion) {
        return { ok: false, conflict: true, snapshot: this.snapshotOf(projection, false), baseRevision: contextVersion, contextRevision: contextVersion }
      }
      const requestedUnitIds = Array.isArray(request.unitIds) ? request.unitIds.map(String) : []
      const onlyUnit = requestedUnitIds.length === 1 ? targetUnit(projection, requestedUnitIds[0])?.unit : undefined
      // A Surface checkpoint replaces whole message nodes, while the UI groups
      // one turn's answer/thought across tool steps. Close that range before
      // generation, and expose every extra unit in the proposal for confirmation.
      const checkpointRange = this.hostAdapter === SURFACE_ADAPTER_ID
      const canExpandRelated = !checkpointRange && onlyUnit?.kind === 'answer'
      const expandRelated = checkpointRange || (canExpandRelated && request.expandRelated === true)
      const range = checkpointRange ? selectCheckpointCondensationRange(projection, requestedUnitIds)
        : selectCondensationRange(projection.records, requestedUnitIds, projection.projectionStates, { expandRelated })
      if (!range.requestedUnitIds.length) throw new Error('CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY')
      if (range.unavailableUnitIds.length) throw new Error('CONTEXT_EDITOR_CONDENSATION_UNAVAILABLE:' + range.unavailableUnitIds.join(','))
      const opaque = opaqueCondensationSource(projection, range.sourceUnits)
      if (opaque) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPAQUE_CONTENT:' + opaque.id)
      const roots = range.sourceRootSeqs
      if (roots.some(root => !rootEventExists(projection, root))) throw new Error('CONTEXT_EDITOR_CONDENSATION_SOURCE_GONE')
      if (checkpointRange) surfaceRangeForRoots(session, roots, this.ctx.sessions.messageProjections)
      const overlap = overlappingCondensation(projection, roots)
      if (overlap) throw new Error('CONTEXT_EDITOR_CONDENSATION_OVERLAP:' + overlap.operationId)
      const overlayConflict = conflictingOverlay(projection, roots)
      if (overlayConflict && !this.requestTransform) throw new Error('CONTEXT_EDITOR_CONDENSATION_OVERLAP:root-' + overlayConflict.root)
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
        const streamOptions = {
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
        }
        const stream = this.requestTransform ? this.requestTransform.streamEffective(streamOptions) : this.ctx.llm.stream(streamOptions)
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
        baseRevision: contextVersion,
        baseContextRevision: contextVersion,
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
        recoveryEvents: row.recoveryEvents,
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
    requireNativeProjection(this, 'contextCondensation')
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const operationId = String(request.operationId ?? '')
      if (!operationId) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPERATION_ID_REQUIRED')
      const initial = await this.readProjection(sessionId)
      const row = this.rowFor(initial.identity)
      const sidecarEvent = row.condensationEvents.find(event => event.operationId === operationId)
      const checkpointId = condensationCheckpointId(sessionId, operationId)
      const priorCheckpoint = (initial.sourceEvents ?? []).find(event => event?.type === 'user/message' && event?.data?.id === checkpointId)
      if (priorCheckpoint !== undefined) {
        if (!sidecarEvent) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPERATION_RECORD_MISSING')
        const committedSummary = textMessageText(priorCheckpoint.data)
        if (committedSummary !== frameCondensationSummary(sidecarEvent.summary)
          || (request.summary !== undefined && String(request.summary).trim() !== String(sidecarEvent.summary).trim())) {
          throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        }
        const persistedSession = restoreSession(sessionId, initial.sourceEvents, initial.sessionHeader ?? initial.identity, initial.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
        const modelMessages = persistedSession.deriveMessages()
        const checkpointMessages = modelMessages.filter(message => message?.id === checkpointId)
        const activeSurfaceSeqs = foldSurface(initial.sourceEvents, this.ctx.sessions.messageProjections ?? []).nodes
        if (checkpointMessages.length !== 1
          || textMessageText(checkpointMessages[0]) !== committedSummary
          || !activeSurfaceSeqs.includes(Number(priorCheckpoint.seq))) {
          throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:model-message-mismatch')
        }
        let boundary = Number.isSafeInteger(sidecarEvent.recoveryAnchorSeq) ? sidecarEvent.recoveryAnchorSeq : undefined
        let prefixFingerprint = sidecarEvent.recoveryPrefixFingerprint
        if (boundary === undefined || boundary >= Number(priorCheckpoint.seq)) {
          boundary = undefined
          prefixFingerprint = undefined
        } else {
          try {
            const recovery = recoveryPrefixInfo(sessionId, initial.sourceEvents, boundary, initial.sessionHeader ?? initial.identity, initial.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
            if (prefixFingerprint !== undefined && prefixFingerprint !== recovery.prefixFingerprint) {
              boundary = undefined
              prefixFingerprint = undefined
            } else {
              prefixFingerprint = recovery.prefixFingerprint
            }
          } catch {
            // The checkpoint is durable, but a malformed or incomplete prefix
            // must not be guessed into a recovery location.
            boundary = undefined
            prefixFingerprint = undefined
          }
        }
        const { recoveryAnchorSeq: _oldAnchor, recoveryPrefixFingerprint: _oldFingerprint, ...checkpointRecord } = sidecarEvent
        const appliedEvent = {
          ...checkpointRecord,
          status: 'applied',
          checkpointSeq: Number(priorCheckpoint.seq),
          checkpointMessageId: checkpointId,
          ...(boundary === undefined ? {} : { recoveryAnchorSeq: boundary }),
          ...(prefixFingerprint === undefined ? {} : { recoveryPrefixFingerprint: prefixFingerprint }),
          ...(sidecarEvent.recoverySessionId ? {} : { recoverySessionId: recoverySessionId(sessionId, recoveryOperationId('condensation', sessionId, operationId)) }),
        }
        if (!sameJson(sidecarEvent, appliedEvent)) {
          await this.table.put(sessionId, {
            session: row.session,
            schemaVersion: 1,
            storageVersion: 1,
            events: row.events,
            replacementEvents: row.replacementEvents,
            condensationEvents: row.condensationEvents.map(value => value.operationId === operationId ? appliedEvent : value),
            recoveryEvents: row.recoveryEvents,
          })
        }
        const verifiedProjection = await this.readProjection(sessionId)
        return success(this.snapshotOf(verifiedProjection, false), {
          operationId,
          eventId: String(priorCheckpoint.seq),
          checkpointMessageId: checkpointId,
          recoveryBoundarySeq: Number.isSafeInteger(appliedEvent.recoveryAnchorSeq) ? appliedEvent.recoveryAnchorSeq : undefined,
          commit: {
            operationId,
            status: 'persisted-and-verified',
            eventId: String(priorCheckpoint.seq),
            persistenceLocations: ['session-log', 'context_editor'],
            contextVersion: verifiedProjection.contextRevision,
          },
        })
      }
      const prepared = this.condensationOperations.get(operationId) ?? sidecarEvent
      if (!prepared) throw new Error('CONTEXT_EDITOR_CONDENSATION_PROPOSAL_NOT_FOUND')
      const expectedRevision = String(request.baseContextRevision ?? request.baseRevision ?? prepared.baseContextRevision ?? prepared.baseRevision ?? '')
      if (!expectedRevision) throw new Error('CONTEXT_EDITOR_REVISION_REQUIRED')
      const initialContextVersion = String(initial.contextRevision ?? initial.revision)
      if (expectedRevision !== initialContextVersion) return { ok: false, conflict: true, operationId, contextVersion: initialContextVersion, snapshot: this.snapshotOf(initial, false) }
      const roots = (prepared.sourceRootSeqs ?? []).map(Number).filter(Number.isSafeInteger)
      if (!roots.length) throw new Error('CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY')
      const opaque = opaqueCondensationSource(initial, prepared.sourceUnits ?? [])
      if (opaque) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPAQUE_CONTENT:' + opaque.id)
      if (roots.some(root => !rootEventExists(initial, root))) throw new Error('CONTEXT_EDITOR_CONDENSATION_SOURCE_GONE')
      if (prepared.sourceFingerprint) {
        const requestedIds = prepared.requestedUnitIds ?? request.unitIds ?? []
        const currentRange = this.hostAdapter === SURFACE_ADAPTER_ID ? selectCheckpointCondensationRange(initial, requestedIds)
          : selectCondensationRange(initial.records, requestedIds, initial.projectionStates, { expandRelated: prepared.expandRelated ?? true })
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
      const changes = {
        beforeChanges: Array.isArray(prepared.beforeChanges)
          ? prepared.beforeChanges
          : roots.map(root => beforeChangeForRoot(initial, root)),
        afterChanges: Array.isArray(prepared.afterChanges) ? prepared.afterChanges : [],
      }
      let event = {
        schemaVersion: 1,
        type: 'condensation',
        action: 'apply',
        status: 'pending',
        operationId,
        sessionId,
        baseRevision: initialContextVersion,
        baseContextRevision: initialContextVersion,
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
        recoveryEvents: row.recoveryEvents,
      })
      return withSourceAgent(this.ctx, sessionId, async agent => {
        const session = agent.session
        const projection = this.projectionFromSession(session)
        const existing = sessionEvents(session).find(value => value?.type === 'user/message' && value?.data?.id === checkpointId)
        if (existing !== undefined) {
          if (textMessageText(existing.data) !== frameCondensationSummary(summary)) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
          if (!sidecarEvent) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPERATION_RECORD_MISSING')
          await this.ctx.sessions.flush(session)
          this.historyCache.delete(sessionId)
          const persisted = await this.inspect(sessionId)
          const durableCheckpoint = (persisted.events ?? []).find(value => value?.type === 'user/message' && value?.data?.id === checkpointId)
          if (!durableCheckpoint || textMessageText(durableCheckpoint.data) !== frameCondensationSummary(summary)) {
            throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:persistence-readback-mismatch')
          }
          const persistedSession = restoreSession(sessionId, persisted.events, persisted.meta ?? session.header, persisted.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
          const modelMessages = persistedSession.deriveMessages()
          const checkpointMessages = modelMessages.filter(message => message?.id === checkpointId)
          const surfaceSeqs = foldSurface(persisted.events, this.ctx.sessions.messageProjections ?? []).nodes
          if (checkpointMessages.length !== 1
            || textMessageText(checkpointMessages[0]) !== frameCondensationSummary(summary)
            || !surfaceSeqs.includes(Number(durableCheckpoint.seq))) {
            throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:model-message-mismatch')
          }
          const activeRoots = activeSurfaceRoots(persisted.events, surfaceSeqs)
          if (roots.some(root => activeRoots.includes(root))) {
            throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:source-range-still-active')
          }
          let recoveryAnchorSeq = Number.isSafeInteger(sidecarEvent.recoveryAnchorSeq)
            && sidecarEvent.recoveryAnchorSeq < Number(durableCheckpoint.seq)
            ? sidecarEvent.recoveryAnchorSeq
            : undefined
          let recoveryPrefixFingerprint = sidecarEvent.recoveryPrefixFingerprint
          if (recoveryAnchorSeq !== undefined) {
            try {
              const recovery = recoveryPrefixInfo(sessionId, persisted.events, recoveryAnchorSeq, persisted.meta ?? session.header, persisted.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
              if (recoveryPrefixFingerprint !== undefined && recoveryPrefixFingerprint !== recovery.prefixFingerprint) {
                recoveryAnchorSeq = undefined
                recoveryPrefixFingerprint = undefined
              } else {
                recoveryPrefixFingerprint = recovery.prefixFingerprint
              }
            } catch {
              recoveryAnchorSeq = undefined
              recoveryPrefixFingerprint = undefined
            }
          } else {
            recoveryPrefixFingerprint = undefined
          }
          const {
            recoveryAnchorSeq: _oldAnchor,
            recoveryPrefixFingerprint: _oldFingerprint,
            ...pendingRecord
          } = sidecarEvent
          const appliedEvent = {
            ...pendingRecord,
            status: 'applied',
            checkpointSeq: Number(durableCheckpoint.seq),
            checkpointMessageId: checkpointId,
            ...(recoveryAnchorSeq === undefined ? {} : { recoveryAnchorSeq }),
            ...(recoveryPrefixFingerprint === undefined ? {} : { recoveryPrefixFingerprint }),
            ...(sidecarEvent.recoverySessionId ? {} : { recoverySessionId: recoverySessionId(sessionId, recoveryOperationId('condensation', sessionId, operationId)) }),
          }
          await this.table.put(sessionId, {
            session: row.session,
            schemaVersion: 1,
            storageVersion: 1,
            events: row.events,
            replacementEvents: row.replacementEvents,
            condensationEvents: row.condensationEvents.map(value => value.operationId === operationId ? appliedEvent : value),
            recoveryEvents: row.recoveryEvents,
          })
          this.searchCache.clear()
          this.condensationOperations.delete(operationId)
          const verifiedProjection = await this.readProjection(sessionId)
          return success(this.snapshotOf(verifiedProjection, false), {
            operationId,
            eventId: String(durableCheckpoint.seq),
            checkpointMessageId: checkpointId,
            ...(recoveryAnchorSeq === undefined ? {} : { recoveryBoundarySeq: recoveryAnchorSeq }),
            commit: {
              operationId,
              status: 'persisted-and-verified',
              eventId: String(durableCheckpoint.seq),
              persistenceLocations: ['session-log', 'context_editor'],
              contextVersion: verifiedProjection.contextRevision,
            },
          })
        }
        const currentContextVersion = String(projection.contextRevision ?? projection.revision)
        if (currentContextVersion !== initialContextVersion) return { ok: false, conflict: true, operationId, contextVersion: currentContextVersion, snapshot: this.snapshotOf(projection, false) }
        const currentBefore = roots.map(root => beforeChangeForRoot(projection, root))
        if (!sameJson(currentBefore, changes.beforeChanges)) throw new Error('CONTEXT_EDITOR_CONDENSATION_CONFLICT')
        const beforeEvents = sessionEvents(session)
        const recoveryAnchorSeq = beforeEvents.at(-1)?.seq ?? -1
        const recovery = recoveryPrefixInfo(sessionId, beforeEvents, recoveryAnchorSeq, session.header, session.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
        const surfaceRange = surfaceRangeForRoots(session, roots, this.ctx.sessions.messageProjections)
        const checkpointData = {
          id: checkpointId,
          role: 'user',
          source: { kind: 'plugin', plugin: PACKAGE_NAME, form: 'condensation' },
          content: [{ type: 'text', text: frameCondensationSummary(summary) }],
        }
        const appendOptions = {
          surfaceOp: surfaceReplaceOp(this, surfaceRange.startSeq, surfaceRange.endSeq),
          sourceEventSeqs: surfaceRange.sourceEventSeqs,
        }
        const clonedSession = restoreSession(sessionId, beforeEvents, session.header, session.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
        clonedSession.append('user/message', checkpointData, appendOptions)
        const expectedMessages = clonedSession.deriveMessages()
        event = {
          ...event,
          recoveryAnchorSeq,
          recoveryPrefixFingerprint: recovery.prefixFingerprint,
          recoverySessionId: recoverySessionId(sessionId, recoveryOperationId('condensation', sessionId, operationId)),
        }
        const pendingEvents = row.condensationEvents.some(value => value.operationId === operationId)
          ? row.condensationEvents.map(value => value.operationId === operationId ? event : value)
          : [...row.condensationEvents, event]
        await this.table.put(sessionId, {
          session: row.session,
          schemaVersion: 1,
          storageVersion: 1,
          events: row.events,
          replacementEvents: row.replacementEvents,
          condensationEvents: pendingEvents,
          recoveryEvents: row.recoveryEvents,
        })
        const nativeEvent = session.append('user/message', checkpointData, appendOptions)
        await this.ctx.sessions.flush(session)
        const actualMessages = session.deriveMessages()
        if (!sameJson(actualMessages, expectedMessages)) throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:model-message-mismatch')
        const checkpointMatches = actualMessages.filter(message => message?.id === checkpointId && textMessageText(message) === frameCondensationSummary(summary))
        if (checkpointMatches.length !== 1) throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:checkpoint-count')
        this.historyCache.delete(sessionId)
        const persisted = await this.inspect(sessionId)
        const persistedSession = restoreSession(sessionId, persisted.events, persisted.meta ?? session.header, persisted.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
        const durableEvent = persisted.events.find(value => value?.type === 'user/message' && value?.data?.id === checkpointId)
        if (!durableEvent || !sameJson(persistedSession.deriveMessages(), expectedMessages)) {
          throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:persistence-readback-mismatch')
        }
        const appliedEvent = { ...event, status: 'applied', checkpointSeq: Number(durableEvent.seq), checkpointMessageId: checkpointId }
        await this.table.put(sessionId, {
          session: row.session,
          schemaVersion: 1,
          storageVersion: 1,
          events: row.events,
          replacementEvents: row.replacementEvents,
          condensationEvents: pendingEvents.map(value => value.operationId === operationId ? appliedEvent : value),
          recoveryEvents: row.recoveryEvents,
        })
        this.searchCache.clear()
        this.condensationOperations.delete(operationId)
        const next = await this.readProjection(sessionId)
        return success(this.snapshotOf(next, false), {
          operationId,
          eventId: String(durableEvent.seq ?? nativeEvent.seq),
          checkpointMessageId: checkpointId,
          recoveryBoundarySeq: recoveryAnchorSeq,
          metrics: validation.metrics,
          warnings: validation.warnings,
          commit: {
            operationId,
            status: 'persisted-and-verified',
            eventId: String(durableEvent.seq ?? nativeEvent.seq),
            persistenceLocations: ['session-log', 'context_editor'],
            contextVersion: next.contextRevision,
          },
        })
      })
    })
  }

  async restoreCondensation(request = {}) {
    return this.createRecoveryBranch({ ...request, kind: 'condensation' })
  }

  async resolveRecoveryPlan(request = {}) {
    const sessionId = requestSessionId(request)
    if (!sessionId) throw new Error('CONTEXT_EDITOR_SESSION_REQUIRED')
    const projection = await this.readProjection(sessionId)
    const identity = projection.identity
    const row = this.rowFor(identity)
    const sourceEvents = projection.sourceEvents ?? []
    const requestedKind = request.kind === 'native-compaction' || request.compactionId !== undefined ? 'native-compaction' : 'condensation'
    let operationId
    let boundarySeq
    let checkpointSeq
    let summary = ''
    let condensationEvent
    let compaction
    if (requestedKind === 'condensation') {
      operationId = String(request.operationId ?? '')
      if (!operationId) throw new Error('CONTEXT_EDITOR_CONDENSATION_OPERATION_ID_REQUIRED')
      condensationEvent = row.condensationEvents.find(value => value.operationId === operationId)
      if (!condensationEvent) throw new Error('CONTEXT_EDITOR_CONDENSATION_NOT_FOUND')
      const checkpoint = sourceEvents.find(value => value?.type === 'user/message' && value?.data?.id === condensationCheckpointId(sessionId, operationId))
      if (!checkpoint || checkpoint.seq !== condensationEvent.checkpointSeq) throw new Error('CONTEXT_EDITOR_CONDENSATION_CHECKPOINT_UNVERIFIED')
      boundarySeq = condensationEvent.recoveryAnchorSeq
      checkpointSeq = Number(checkpoint.seq)
      summary = String(condensationEvent.summary ?? '')
      if (!Number.isSafeInteger(boundarySeq) || boundarySeq >= checkpointSeq) throw new Error('CONTEXT_EDITOR_RECOVERY_BOUNDARY_UNAVAILABLE')
    } else {
      operationId = String(request.compactionId ?? request.operationId ?? '')
      if (!operationId) throw new Error('CONTEXT_EDITOR_COMPACTION_ID_REQUIRED')
      compaction = nativeCompactionEvidence(sourceEvents).find(value => value.compactionId === operationId && value.committed === true)
      if (!compaction) throw new Error('CONTEXT_EDITOR_NATIVE_COMPACTION_UNVERIFIED')
      const starts = sourceEvents.filter(value => value?.type === 'compaction/start'
        && String(value?.data?.compactionId ?? '') === operationId
        && Number.isSafeInteger(value.seq))
      const startSeq = starts.at(-1)?.seq
      const priorEnd = sourceEvents.filter(value => value?.type === 'turn/end'
        && Number.isSafeInteger(value.seq)
        && (startSeq === undefined || value.seq < startSeq)).at(-1)
      if (!priorEnd) throw new Error('CONTEXT_EDITOR_RECOVERY_BOUNDARY_UNAVAILABLE')
      boundarySeq = Number(priorEnd.seq)
      checkpointSeq = compaction.checkpointSeq
      const summaryEvent = sourceEvents.find(value => value?.type === 'compaction/summary' && String(value?.data?.compactionId ?? '') === operationId)
      summary = (Array.isArray(summaryEvent?.data?.summary) ? summaryEvent.data.summary : [])
        .filter(block => block?.type === 'text')
        .map(block => String(block.text ?? ''))
        .join('\n')
    }
    const info = recoveryPrefixInfo(sessionId, sourceEvents, boundarySeq, projection.sessionHeader ?? identity, projection.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
    const recoveryProfile = this.requestTransform?.selected(info.prefix)?.profile
    if (recoveryProfile) {
      info.messages = transformMessages(info.messages, recoveryProfile)
      info.contextFingerprint = fingerprint(info.messages)
    }
    const recoveryId = recoveryOperationId(requestedKind, sessionId, operationId)
    const childSessionId = requestedKind === 'condensation'
      ? String(condensationEvent.recoverySessionId ?? recoverySessionId(sessionId, recoveryId))
      : recoverySessionId(sessionId, recoveryId)
    const previous = row.recoveryEvents.find(value => value.operationId === recoveryId)
    if (previous && (previous.childSessionId !== childSessionId
      || previous.boundarySeq !== boundarySeq
      || previous.prefixFingerprint !== info.prefixFingerprint
      || previous.contextFingerprint !== info.contextFingerprint)) {
      throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
    }
    if (condensationEvent?.recoveryPrefixFingerprint
      && condensationEvent.recoveryPrefixFingerprint !== info.prefixFingerprint) {
      throw new Error('CONTEXT_EDITOR_RECOVERY_PREFIX_CHANGED')
    }
    const preview = {
      ok: true,
      sessionId,
      kind: requestedKind,
      operationId,
      recoveryOperationId: recoveryId,
      targetSessionId: childSessionId,
      boundarySeq,
      checkpointSeq,
      prefixEventCount: info.prefix.length,
      prefixFingerprint: info.prefixFingerprint,
      contextFingerprint: info.contextFingerprint,
      messageCount: info.messages.length,
      conversationPreview: info.messages.filter(message => message.role === 'user' && message.source?.kind !== 'tool').at(-1)?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n').slice(0, 160) ?? '',
      retainedMessageCount: sourceEvents.filter(event => event.seq > boundarySeq && ['user/message', 'assistant/message'].includes(event.type)).length,
      summary,
      ...(previous ? { status: previous.status } : {}),
    }
    return { preview, identity, projection, row, sourceEvents, prefix: info.prefix, messages: info.messages, recoveryId, condensationEvent, compaction }
  }

  async previewRecovery(request = {}) {
    if (isBusySession(this.ctx, requestSessionId(request))) throw new Error('CONTEXT_EDITOR_BUSY')
    const plan = await this.resolveRecoveryPlan(request)
    return plan.preview
  }

  async getOperation(request = {}) {
    const sessionId = requestSessionId(request)
    const operationId = String(request.operationId ?? '')
    if (!sessionId || !operationId) throw new Error('CONTEXT_EDITOR_OPERATION_ID_REQUIRED')
    const projection = await this.readProjection(sessionId)
    const row = this.rowFor(projection.identity)
    if (this.requestTransform) {
      const subject = { id: sessionId, header: projection.sessionHeader }
      const operation = this.requestTransform.operation(subject, operationId)
      if (operation) {
        const durable = projection.sourceEvents.find(event => event.type === 'request/header'
          && event.data.header.config.provider === REQUEST_PROVIDER && event.data.header.config.model === operation.profileId)
        const live = this.ctx.sessions.get(sessionId)
        const inMemory = live?.snapshotEvents().some(event => event.type === 'request/header'
          && event.data.header.config.provider === REQUEST_PROVIDER && event.data.header.config.model === operation.profileId)
        let status = durable ? 'persisted-and-verified' : inMemory ? 'unverified' : 'failed'
        if (durable) {
          try {
            const prefix = projection.sourceEvents.filter(event => event.seq <= durable.seq)
            const restored = restoreSession(sessionId, prefix, projection.sessionHeader, Math.min(projection.inheritedEventCount ?? 0, prefix.length), this.ctx.sessions.messageProjections)
            transformMessages(restored.deriveMessages(), this.requestTransform.profile(operation.profileId))
          } catch { status = 'unverified' }
        }
        await this.requestTransform.settle(subject, operationId, status, durable ? undefined : 'profile-selection-not-persisted')
        const profile = this.requestTransform.profile(operation.profileId)
        return { operationId, status, ...profile.operation, sessionId,
          contextVersion: projection.contextRevision,
          persistenceLocations: ['context_editor_requests', 'session'],
          ...(durable ? { eventId: String(durable.seq) } : { reason: 'profile-selection-not-persisted' }) }
      }
    }
    const recovery = row.recoveryEvents.find(value => value.operationId === operationId
      || value.sourceOperationId === operationId
      || value.childSessionId === operationId)
    const condensation = row.condensationEvents.find(value => value.operationId === operationId)
    if (recovery !== undefined) return recovery
    if (condensation !== undefined) return condensation

    const replacement = row.replacementEvents.find(value => value.eventId === operationId)
    if (replacement === undefined) return null

    const priorReplacement = replacement.action === 'undo'
      ? row.replacementEvents.find(value => value.eventId === replacement.undoOf)
      : undefined
    const target = targetUnit(projection, replacement.unitId)
    const rootEventSeq = Number(
      replacement.atomRefs?.[0]?.sourceRef?.entryId
      ?? priorReplacement?.atomRefs?.[0]?.sourceRef?.entryId
      ?? target?.unit?.atoms?.[0]?.sourceRef?.entryId,
    )
    if (!Number.isSafeInteger(rootEventSeq) || rootEventSeq < 0) {
      return {
        ...replacement,
        operationId,
        status: 'unverified',
        reason: 'replacement-source-unavailable',
        commit: { operationId, status: 'unverified', reason: 'replacement-source-unavailable', contextVersion: projection.contextRevision ?? projection.revision },
      }
    }

    const markerId = surfaceReplacementId(sessionId, rootEventSeq, operationId)
    const sourceEvents = projection.sourceEvents ?? []
    const markerEvent = sourceEvents.find(value => value?.type === 'user/message' && value?.data?.id === markerId)
    if (markerEvent === undefined) {
      return {
        ...replacement,
        operationId,
        status: 'pending',
        reason: 'host-event-not-found',
        commit: {
          operationId,
          status: 'pending',
          reason: 'host-event-not-found',
          persistenceLocations: ['context_editor'],
          contextVersion: projection.contextRevision ?? projection.revision,
        },
      }
    }

    const throughMarker = sourceEvents.filter(value => Number(value?.seq) <= Number(markerEvent.seq))
    const originalEvent = throughMarker.find(value => value?.type === 'user/message' && Number(value.seq) === rootEventSeq)
    const originalText = originalEvent === undefined ? undefined : textMessageText({ content: originalEvent.data?.content })
    const expectedText = replacement.action === 'replace'
      ? String(replacement.afterText ?? '')
      : replacement.action === 'restore'
        ? originalText
        : priorReplacement?.beforeText ?? originalText
    let verified = false
    let reason = 'replacement-replay-verification-failed'
    let contextVersion = projection.contextRevision ?? projection.revision
    if (typeof expectedText === 'string' && originalEvent !== undefined) {
      try {
        const session = restoreSession(
          sessionId,
          throughMarker,
          projection.sessionHeader ?? projection.identity,
          projection.inheritedEventCount ?? 0,
          this.ctx.sessions.messageProjections,
        )
        const activeSurfaceSeqs = foldSurface(throughMarker, this.ctx.sessions.messageProjections ?? []).nodes
        const modelMessage = session.deriveMessages().find(value => value?.id === markerId)
        verified = activeSurfaceSeqs.includes(Number(markerEvent.seq))
          && textMessageText(modelMessage) === expectedText
        contextVersion = this.contextRevisionFromEvents(
          projection.identity,
          throughMarker,
          projection.sessionHeader ?? projection.identity,
          projection.inheritedEventCount ?? 0,
        ) ?? contextVersion
        if (verified) reason = undefined
      } catch {
        reason = 'replacement-replay-verification-failed'
      }
    } else {
      reason = 'replacement-expected-content-unavailable'
    }
    const status = verified ? 'persisted-and-verified' : 'unverified'
    return {
      ...replacement,
      operationId,
      status,
      eventId: String(markerEvent.seq),
      ...(reason === undefined ? {} : { reason }),
      commit: {
        operationId,
        status,
        eventId: String(markerEvent.seq),
        persistenceLocations: ['session-log', 'context_editor'],
        contextVersion,
        ...(reason === undefined ? {} : { reason }),
      },
    }
  }

  async createRecoveryBranch(request = {}) {
    const sessionId = requestSessionId(request)
    if (!sessionId) throw new Error('CONTEXT_EDITOR_SESSION_REQUIRED')
    return this.enqueue(sessionId, async () => {
      if (!this.mutationAdmissionOpen) throw new Error('CONTEXT_EDITOR_UNLOADING')
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const plan = await this.resolveRecoveryPlan(request)
      const { preview, identity, projection, row, prefix, messages, recoveryId, condensationEvent } = plan
      if (request.previewFingerprint !== undefined && String(request.previewFingerprint) !== preview.prefixFingerprint) {
        return { ok: false, conflict: true, operationId: preview.operationId, reason: 'recovery-prefix-changed', preview }
      }
      const now = new Date().toISOString()
      const prior = row.recoveryEvents.find(value => value.operationId === recoveryId)
      const record = {
        operationId: recoveryId,
        sourceOperationId: preview.operationId,
        sourceSessionId: sessionId,
        childSessionId: preview.targetSessionId,
        kind: preview.kind,
        status: prior?.status === 'persisted-and-verified' ? prior.status : 'pending',
        boundarySeq: preview.boundarySeq,
        prefixFingerprint: preview.prefixFingerprint,
        contextFingerprint: preview.contextFingerprint,
        createdAt: prior?.createdAt ?? now,
      }
      const writeRecord = async nextRecord => {
        const recoveries = row.recoveryEvents.some(value => value.operationId === recoveryId)
          ? row.recoveryEvents.map(value => value.operationId === recoveryId ? nextRecord : value)
          : [...row.recoveryEvents, nextRecord]
        const condensations = condensationEvent
          ? row.condensationEvents.map(value => value.operationId === condensationEvent.operationId
            ? { ...value, recoveryStatus: nextRecord.status, recoverySessionId: preview.targetSessionId }
            : value)
          : row.condensationEvents
        await this.table.put(sessionId, {
          session: row.session,
          schemaVersion: 1,
          storageVersion: 1,
          events: row.events,
          replacementEvents: row.replacementEvents,
          condensationEvents: condensations,
          recoveryEvents: recoveries,
        })
      }

      await writeRecord(record)
      const verifyCandidate = async (candidateEvents, candidateHeader, inheritedEventCount) => {
        if (!candidateHeader || candidateHeader.parentSession !== sessionId || candidateHeader.isSeeded !== true
          || inheritedEventCount !== prefix.length || candidateEvents.length < prefix.length
          || !sameJson(candidateEvents.slice(0, prefix.length), prefix)) {
          throw new Error('CONTEXT_EDITOR_RECOVERY_BRANCH_ID_CONFLICT')
        }
        const candidatePrefix = restoreSession(preview.targetSessionId, candidateEvents.slice(0, inheritedEventCount), candidateHeader, inheritedEventCount, this.ctx.sessions.messageProjections)
        const profile = this.requestTransform?.fromSession(candidatePrefix)?.profile
        const candidateMessages = profile ? transformMessages(candidatePrefix.deriveMessages(), profile) : candidatePrefix.deriveMessages()
        if (!sameJson(candidateMessages, messages)) throw new Error('CONTEXT_EDITOR_RECOVERY_BRANCH_CONTEXT_MISMATCH')
      }
      const existingAgent = this.ctx.agents?.get?.(preview.targetSessionId)
      let branchHandle = this.recoveryHandles.get(preview.targetSessionId)
      try {
        if (existingAgent !== undefined) {
          const events = sessionEvents(existingAgent.session)
          await verifyCandidate(events, existingAgent.session.header, existingAgent.session.inheritedEventCount ?? 0)
        } else {
          let persisted
          try {
            persisted = await this.inspect(preview.targetSessionId)
          } catch (error) {
            if (!/(?:not found|no such|does not exist|enoent|unknown session|session.*missing)/iu.test(String(error?.message ?? error))) throw error
          }
          if (persisted !== undefined) {
            await verifyCandidate(persisted.events, persisted.meta, persisted.inheritedEventCount ?? 0)
          } else {
            if (typeof this.ctx.agents?.create !== 'function') throw new Error('CONTEXT_EDITOR_AGENT_CREATE_UNAVAILABLE')
            const header = projection.sessionHeader ?? projection.identity
            const sourcePrefix = restoreSession(sessionId, prefix, header, projection.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
            const requestHeader = requestHeaderFor(sourcePrefix)
            const config = asObject(requestHeader.config)
            const agentOptions = {
              ...(typeof config.provider === 'string' && config.provider ? { provider: config.provider } : {}),
              ...(typeof config.model === 'string' && config.model ? { model: config.model } : {}),
              ...(typeof config.reasoningEffort === 'string' ? { reasoningEffort: config.reasoningEffort } : {}),
              ...(Number.isSafeInteger(config.maxTokens) && config.maxTokens > 0 ? { maxTokens: config.maxTokens } : {}),
            }
            const presetId = typeof header.agentPreset === 'string' && header.agentPreset ? header.agentPreset : undefined
            if (presetId && typeof this.ctx.agentPresets?.mount !== 'function') throw new Error('CONTEXT_EDITOR_RECOVERY_PRESET_UNAVAILABLE')
            const meta = {
              ...(typeof header.cwd === 'string' ? { cwd: header.cwd } : {}),
              parentSession: sessionId,
              isSeeded: true,
              ...(presetId ? { agentPreset: presetId } : {}),
            }
            branchHandle = await this.ctx.agents.create({
              sessionId: preview.targetSessionId,
              seed: prefix,
              inheritedEventCount: prefix.length,
              meta,
              ...(Object.keys(agentOptions).length ? { agentOptions } : {}),
              ...(presetId ? { setup: async agentCtx => { await this.ctx.agentPresets.mount(agentCtx, presetId) } } : {}),
            })
            this.recoveryHandles.set(preview.targetSessionId, branchHandle)
            await this.ctx.sessions.flush(branchHandle.agent.session)
            const branchSession = branchHandle.agent.session
            await verifyCandidate(sessionEvents(branchSession), branchSession.header, branchSession.inheritedEventCount ?? 0)
          }
        }
        this.historyCache.delete(preview.targetSessionId)
        const durable = await this.inspect(preview.targetSessionId)
        await verifyCandidate(durable.events, durable.meta, durable.inheritedEventCount ?? 0)
        const nextRecord = { ...record, status: 'persisted-and-verified' }
        await writeRecord(nextRecord)
        this.searchCache.clear()
        const nextProjection = await this.readProjection(sessionId)
        return {
          ok: true,
          operationId: preview.operationId,
          recoveryOperationId: recoveryId,
          kind: preview.kind,
          sourceSessionId: sessionId,
          targetSessionId: preview.targetSessionId,
          boundarySeq: preview.boundarySeq,
          commit: {
            operationId: recoveryId,
            status: 'persisted-and-verified',
            persistenceLocations: ['session-log', 'context_editor'],
            contextVersion: nextProjection.contextRevision,
          },
          snapshot: this.snapshotOf(nextProjection, false),
        }
      } catch (error) {
        await writeRecord({ ...record, status: 'unverified', reason: String(error?.message ?? error) })
        throw error
      }
    })
  }

  async prepareCondensation(request) { return this.previewCondensation(request) }
  async generateCondensation(request) { return this.previewCondensation(request) }
  async undoCondensation(request) { return this.restoreCondensation(request) }

  async commitContext(request) {
    if (request?.action === 'condense') return this.commitCondensation(request)
    if (request?.action === 'restore-condensation') return this.restoreCondensation(request)
    requireNativeProjection(this, 'contextExclusion')
    if (this.requestTransform) return this.commitRequestMutation(request, 'context')
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
        const priorEvent = sessionEvents(session).find(event => event?.type === 'context/projection'
          && event?.data?.owner === 'context-editor-deepseek-harness'
          && event?.data?.operationId === operationId)
        if (priorEvent !== undefined) {
          if (stored?.changes !== undefined && !sameJson(stored.changes, priorEvent.data.changes)) {
            throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
          }
          if (stored === undefined && action !== undefined) {
            const priorIndex = sessionEvents(session).indexOf(priorEvent)
            const beforeSession = {
              id: session.id,
              header: session.header,
              events: sessionEvents(session).slice(0, priorIndex),
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

        const baseSeq = sessionEvents(session).at(-1)?.seq ?? -1
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

  async commitRequestMutation(request, mutation) {
    const sessionId = requestSessionId(request)
    const operationId = String(request?.operationId ?? '')
    if (!operationId) throw new Error('CONTEXT_EDITOR_OPERATION_ID_REQUIRED')
    return this.enqueue(sessionId, async () => {
      if (!this.mutationAdmissionOpen) throw new Error('CONTEXT_EDITOR_UNLOADING')
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      return withSourceAgent(this.ctx, sessionId, async agent => {
        const session = agent.session
        const initial = this.projectionFromSession(session)
        const input = {
          mutation, action: request.action ?? null, unitId: request.unitId ?? null,
          unitIds: request.unitIds ?? null, recordIds: request.recordIds ?? null,
          text: request.text ?? null, excludeAssociatedReasoning: Boolean(request.excludeAssociatedReasoning),
        }
        const prior = this.requestTransform.operation(session, operationId)
        if (prior && prior.requestFingerprint !== requestFingerprint(input)) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        const expected = String(request.baseContextRevision ?? request.expectedRevision ?? request.baseRevision ?? '')
        if (!prior && expected !== initial.contextRevision && expected !== initial.revision) {
          return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(initial, false), commit: { operationId, status: 'conflict', contextVersion: initial.contextRevision } }
        }
        for (const [, value] of this.requestTransform.operations.entries()) {
          if (value === prior || !['pending', 'unverified'].includes(value.status)) continue
          const origin = this.requestTransform.profile(value.profileId).origin
          if (origin.id === session.id && origin.createdAt === session.header.createdAt) throw new Error('CONTEXT_EDITOR_PENDING_OPERATION_REQUIRES_VERIFICATION')
        }
        let changes = []
        let replacementEvent
        if (!prior && mutation === 'context') {
          const calculated = buildNativeContextChanges(initial, request.action, { unitIds: request.unitIds, recordIds: request.recordIds, operationId })
          const expectedSelection = request.selectionFingerprint ?? this.contextOperations.get(operationId)?.selectionFingerprint
          if (expectedSelection && expectedSelection !== selectionFingerprint(initial, calculated.selection.effectiveUnitIds)) return { ok: false, conflict: true, operationId, commit: { operationId, status: 'conflict', reason: 'selection-changed', contextVersion: initial.contextRevision } }
          if (calculated.selection.effectiveUnitIds.some(id => targetUnit(initial, id)?.unit.contextMutationDisabledReason)) throw new Error('CONTEXT_EDITOR_UNSUPPORTED_MESSAGE_CONTRACT')
          if (activeCondensationForUnits(initial, calculated.selection.effectiveUnitIds)) throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_REQUIRED')
          changes = calculated.changes
        } else if (!prior) {
          const target = targetUnit(initial, String(request.unitId ?? ''))
          if (!target || !target.unit.replacementSupported || target.unit.replacementState === 'unavailable') throw new Error('CONTEXT_EDITOR_PLAIN_TEXT_CURRENT_MESSAGE_REQUIRED')
          if (request.excludeAssociatedReasoning) throw new Error('CONTEXT_EDITOR_PLAIN_TEXT_REQUIRED')
          if (activeCondensationForUnits(initial, [target.unit.id])) throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_REQUIRED')
          const state = initial.replacementStates.get(target.unit.id)
          if (mutation === 'replace' && !String(request.text ?? '').trim()) throw new Error('CONTEXT_EDITOR_REPLACEMENT_EMPTY')
          if ((mutation === 'restore' && state?.replacementText == null)
            || (mutation === 'undo' && !target.unit.canUndoReplacement)
            || (mutation === 'replace' && request.text === target.unit.effectiveText)) {
            return success(this.snapshotOf(initial, false), { operationId, commit: { operationId, status: 'no-op', contextVersion: initial.contextRevision } })
          }
          replacementEvent = {
            schemaVersion: 1, type: 'replacement', action: mutation, eventId: operationId,
            unitId: target.unit.id, unitKind: target.unit.kind,
            atomRefs: target.unit.atoms.map(atom => ({ atomId: atom.id, sourceRef: atom.sourceRef, fingerprint: atom.fingerprint })),
            beforeText: state?.replacementText ?? null, afterText: mutation === 'replace' ? String(request.text) : null,
            ...(mutation === 'undo' ? { undoOf: state.activeEventId } : {}),
            baseRevision: initial.contextRevision, createdAt: new Date().toISOString(),
          }
          changes = buildNativeReplacementChanges(initial, replacementEvent, { operationId }).changes
        }
        if (!prior && !changes.length) return success(this.snapshotOf(initial, false), { operationId, commit: { operationId, status: 'no-op', contextVersion: initial.contextRevision } })
        const prepared = await this.requestTransform.prepare(session, operationId, input, changes, replacementEvent)
        try {
          const event = this.requestTransform.appendSelection(session, prepared)
          await this.ctx.sessions.flush(session)
          this.historyCache.delete(sessionId)
          const persisted = await this.inspect(sessionId)
          if (!persisted.events.some(value => value.type === 'request/header'
            && value.data.header.config.provider === REQUEST_PROVIDER && value.data.header.config.model === prepared.id)) {
            throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:profile-selection-not-persisted')
          }
          const restored = restoreSession(sessionId, persisted.events, persisted.meta, persisted.inheritedEventCount, this.ctx.sessions.messageProjections)
          const latest = this.requestTransform.fromSession(restored)
          if (!latest) throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:profile-not-selected')
          transformMessages(restored.deriveMessages(), latest.profile)
          await this.requestTransform.settle(session, operationId, 'persisted-and-verified')
          this.searchCache.clear()
          const next = await this.readProjection(sessionId)
          return success(this.snapshotOf(next, false), {
            operationId, eventId: String(event.seq), expectedRevision: next.revision,
            commit: { operationId, status: 'persisted-and-verified', eventId: String(event.seq), persistenceLocations: ['session-log', 'context_editor_requests'], contextVersion: next.contextRevision },
          })
        } catch (error) {
          await this.requestTransform.settle(session, operationId, 'unverified', String(error?.message ?? error))
          return { ok: false, operationId, commit: { operationId, status: 'unverified', reason: String(error?.message ?? error), contextVersion: initial.contextRevision } }
        }
      })
    })
  }

  async previewReplacement(request) {
    requireNativeProjection(this, 'contextReplacement')
    const sessionId = requestSessionId(request)
    if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
    const projection = await this.readProjection(sessionId)
    const requestedRevision = this.hostAdapter === SURFACE_ADAPTER_ID
      ? request?.baseContextRevision ?? request?.baseRevision
      : request?.baseRevision
    const currentRevision = this.hostAdapter === SURFACE_ADAPTER_ID
      ? String(projection.contextRevision ?? projection.revision)
      : projection.revision
    if (requestedRevision !== undefined && String(requestedRevision) !== currentRevision) {
      return { ok: false, conflict: true, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, contextRevision: projection.contextRevision, unitId: String(request?.unitId ?? ''), unitKind: 'answer', textChanged: false, excludeAssociatedReasoning: Boolean(request?.excludeAssociatedReasoning), associatedReasoningUnitIds: [], requestedUnitIds: [], effectiveUnitIds: [], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: 'revision-conflict' }
    }
    const target = targetUnit(projection, String(request?.unitId ?? ''))
    if (!target) throw new Error('CONTEXT_EDITOR_REPLACEMENT_TARGET_NOT_FOUND')
    if (activeCondensationForUnits(projection, [target.unit.id])) {
      return { ok: false, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, contextRevision: projection.contextRevision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: false, excludeAssociatedReasoning: false, associatedReasoningUnitIds: [], requestedUnitIds: [target.unit.id], effectiveUnitIds: [target.unit.id], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: 'condensation-active' }
    }
    if (!target.unit.replacementSupported || target.unit.replacementState === 'unavailable') {
      return { ok: false, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, contextRevision: projection.contextRevision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: false, excludeAssociatedReasoning: false, associatedReasoningUnitIds: [], requestedUnitIds: [target.unit.id], effectiveUnitIds: [target.unit.id], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: target.unit.replacementDisabledReason ?? 'invalid-target' }
    }
    if (this.hostAdapter === SURFACE_ADAPTER_ID && ((!this.requestTransform && target.unit.kind !== 'user') || request?.excludeAssociatedReasoning === true)) {
      return { ok: false, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, contextRevision: projection.contextRevision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: false, excludeAssociatedReasoning: false, associatedReasoningUnitIds: [], requestedUnitIds: [target.unit.id], effectiveUnitIds: [target.unit.id], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: 'host-surface-contract' }
    }
    const text = request?.text === undefined ? target.unit.effectiveText : String(request.text)
    if (text.trim().length === 0) {
      return { ok: false, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, contextRevision: projection.contextRevision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: false, excludeAssociatedReasoning: false, associatedReasoningUnitIds: [], requestedUnitIds: [target.unit.id], effectiveUnitIds: [target.unit.id], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], requiresConfirmation: false, canCommit: false, disabledReason: 'replacement-empty' }
    }
    const link = Boolean(request?.excludeAssociatedReasoning && target.unit.kind === 'answer')
    const selection = link ? selectAssociatedReasoningTargets(projection.records, target.unit.id, projection.projectionStates) : { associatedReasoningUnitIds: [], requestedUnitIds: [], effectiveUnitIds: [], autoExpandedUnitIds: [], newlyExcludedUnitIds: [], alreadyExcludedUnitIds: [], newlyExcludedAtomIds: [], alreadyExcludedAtomIds: [], unavailableUnitIds: [], disabledReason: undefined }
    const requestedUnitIds = [target.unit.id, ...selection.requestedUnitIds.filter(id => id !== target.unit.id)]
    const effectiveUnitIds = [target.unit.id, ...selection.effectiveUnitIds.filter(id => id !== target.unit.id)]
    return { ok: true, snapshot: this.snapshotOf(projection), baseRevision: projection.revision, contextRevision: projection.contextRevision, unitId: target.unit.id, unitKind: target.unit.kind, textChanged: text !== target.unit.effectiveText, excludeAssociatedReasoning: link, associatedReasoningUnitIds: selection.associatedReasoningUnitIds, requestedUnitIds, effectiveUnitIds, autoExpandedUnitIds: selection.autoExpandedUnitIds, newlyExcludedUnitIds: selection.newlyExcludedUnitIds, alreadyExcludedUnitIds: selection.alreadyExcludedUnitIds, newlyExcludedAtomIds: selection.newlyExcludedAtomIds, alreadyExcludedAtomIds: selection.alreadyExcludedAtomIds, unavailableUnitIds: selection.unavailableUnitIds, requiresConfirmation: selection.autoExpandedUnitIds.length > 0, canCommit: !selection.disabledReason && selection.unavailableUnitIds.length === 0, ...(selection.disabledReason ? { disabledReason: selection.disabledReason } : {}) }
  }

  async commitSurfaceReplacementMutation(request, action) {
    const sessionId = requestSessionId(request)
    return this.enqueue(sessionId, async () => {
      if (!this.mutationAdmissionOpen) throw new Error('CONTEXT_EDITOR_UNLOADING')
      if (isBusySession(this.ctx, sessionId)) throw new Error('CONTEXT_EDITOR_BUSY')
      const operationId = String(request?.operationId ?? '')
      if (!operationId) throw new Error('CONTEXT_EDITOR_OPERATION_ID_REQUIRED')
      const expectedContextRevision = String(request?.baseContextRevision ?? request?.baseRevision ?? '')
      if (!expectedContextRevision) throw new Error('CONTEXT_EDITOR_CONTEXT_REVISION_REQUIRED')
      if (!['replace', 'restore', 'undo'].includes(action)) throw new Error('CONTEXT_EDITOR_REPLACEMENT_ACTION_INVALID')
      if (request?.excludeAssociatedReasoning === true) throw new Error('CONTEXT_EDITOR_FEATURE_UNSUPPORTED:host-surface-contract')

      const initial = await this.readProjection(sessionId)
      const unitId = String(request?.unitId ?? '')
      const target = targetUnit(initial, unitId)
      if (!target) throw new Error('CONTEXT_EDITOR_REPLACEMENT_TARGET_NOT_FOUND')
      const row = this.rowFor(initial.identity)
      const existing = row.replacementEvents.find(value => value.eventId === operationId)
      const rootEventSeq = Number(target.unit.atoms[0]?.sourceRef?.entryId)
      const markerId = surfaceReplacementId(sessionId, rootEventSeq, operationId)
      const priorSurfaceEvent = (initial.sourceEvents ?? []).find(value => value?.type === 'user/message' && value?.data?.id === markerId)
      const originalEvent = (initial.sourceEvents ?? []).find(value => value?.seq === rootEventSeq && value?.type === 'user/message')
      const originalData = originalEvent?.data
      const originalBlocks = Array.isArray(originalData?.content) ? originalData.content : []
      if (target.unit.kind !== 'user' || !target.unit.replacementSupported || target.unit.replacementState === 'unavailable') {
        throw new Error('CONTEXT_EDITOR_FEATURE_UNSUPPORTED:' + (target.unit.replacementDisabledReason ?? 'host-surface-contract'))
      }
      if (activeCondensationForUnits(initial, [unitId])) throw new Error('CONTEXT_EDITOR_CONDENSATION_RESTORE_REQUIRED')
      if (!Number.isSafeInteger(rootEventSeq) || rootEventSeq < 0 || !originalEvent
        || target.unit.atoms.length !== 1 || originalBlocks.length !== 1
        || originalBlocks[0]?.type !== 'text' || typeof originalBlocks[0]?.text !== 'string') {
        throw new Error('CONTEXT_EDITOR_FEATURE_UNSUPPORTED:host-surface-contract')
      }
      const originalText = String(originalBlocks[0].text)
      if (originalText.trim().length === 0) throw new Error('CONTEXT_EDITOR_FEATURE_UNSUPPORTED:host-surface-contract')
      const currentState = initial.replacementStates.get(unitId)
      const surfaceTextFor = event => {
        if (event.action === 'replace') return event.afterText
        if (event.action === 'restore') return originalText
        if (event.action === 'undo') {
          const prior = row.replacementEvents.find(value => value.eventId === event.undoOf)
          return prior?.beforeText ?? originalText
        }
        return undefined
      }

      if (priorSurfaceEvent !== undefined) {
        if (!existing || existing.unitId !== unitId || existing.action !== action) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        const marker = parseContextEditorSurfaceMarker(priorSurfaceEvent.data.id)
        if (marker?.sessionId !== sessionId || marker.rootEventSeq !== rootEventSeq) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        const activeNodes = foldSurface(initial.sourceEvents, this.ctx.sessions.messageProjections).nodes
        const activeSource = activeNodes.map(seq => initial.sourceEvents.find(value => value?.seq === seq)).find(value => {
          const activeMarker = parseContextEditorSurfaceMarker(value?.data?.id)
          return (activeMarker?.rootEventSeq ?? value?.seq) === rootEventSeq
        })
        if (activeSource?.data?.id !== markerId) {
          return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(initial, false), commit: { operationId, status: 'conflict', reason: 'replacement-no-longer-active', contextVersion: initial.contextRevision } }
        }
        const expectedText = surfaceTextFor(existing)
        const persistedSession = restoreSession(sessionId, initial.sourceEvents, initial.sessionHeader ?? initial.identity, initial.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
        const modelMessage = persistedSession.deriveMessages().find(value => value?.id === markerId)
        if (target.unit.effectiveText !== expectedText || textMessageText(modelMessage) !== expectedText) throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED')
        return success(this.snapshotOf(initial, false), {
          operationId,
          eventId: String(priorSurfaceEvent.seq),
          commit: { operationId, status: 'persisted-and-verified', eventId: String(priorSurfaceEvent.seq), persistenceLocations: ['session-log', 'context_editor'], contextVersion: initial.contextRevision },
        })
      }

      if (expectedContextRevision !== String(initial.contextRevision ?? initial.sourceRevision)) {
        return { ok: false, conflict: true, operationId, contextRevision: initial.contextRevision, snapshot: this.snapshotOf(initial, false), commit: { operationId, status: 'conflict', reason: 'context-changed', contextVersion: initial.contextRevision } }
      }
      const event = existing
      let replacementEvent = event
      let surfaceText
      if (replacementEvent !== undefined) {
        if (replacementEvent.unitId !== unitId || replacementEvent.action !== action) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        if (action === 'replace' && request?.text !== undefined && String(request.text) !== String(replacementEvent.afterText ?? '')) throw new Error('CONTEXT_EDITOR_OPERATION_REUSED')
        surfaceText = surfaceTextFor(replacementEvent)
      } else if (action === 'replace') {
        surfaceText = String(request?.text ?? '')
        if (surfaceText.trim().length === 0) throw new Error('CONTEXT_EDITOR_REPLACEMENT_EMPTY')
        if (surfaceText === target.unit.effectiveText) return success(this.snapshotOf(initial, false), { operationId, commit: { operationId, status: 'no-op', contextVersion: initial.contextRevision } })
        replacementEvent = { schemaVersion: 1, type: 'replacement', action: 'replace', eventId: operationId, unitId, unitKind: 'user', atomRefs: target.unit.atoms.map(atom => ({ atomId: atom.id, sourceRef: atom.sourceRef, fingerprint: atom.fingerprint })), beforeText: currentState?.replacementText ?? null, afterText: surfaceText, baseRevision: initial.contextRevision ?? initial.revision, createdAt: new Date().toISOString() }
      } else if (action === 'restore') {
        if (currentState?.replacementText === null || currentState?.replacementText === undefined) return success(this.snapshotOf(initial, false), { operationId, commit: { operationId, status: 'no-op', contextVersion: initial.contextRevision } })
        surfaceText = originalText
        replacementEvent = { schemaVersion: 1, type: 'replacement', action: 'restore', eventId: operationId, unitId, unitKind: 'user', atomRefs: target.unit.atoms.map(atom => ({ atomId: atom.id, sourceRef: atom.sourceRef, fingerprint: atom.fingerprint })), beforeText: currentState.replacementText, afterText: null, baseRevision: initial.contextRevision ?? initial.revision, createdAt: new Date().toISOString() }
      } else {
        const undoOf = currentState?.activeEventId
        if (!undoOf || !currentState?.canUndoReplacement) return success(this.snapshotOf(initial, false), { operationId, commit: { operationId, status: 'no-op', contextVersion: initial.contextRevision } })
        const prior = row.replacementEvents.find(value => value.eventId === undoOf)
        if (!prior) throw new Error('CONTEXT_EDITOR_REPLACEMENT_HISTORY_UNAVAILABLE')
        surfaceText = prior.beforeText ?? originalText
        replacementEvent = { schemaVersion: 1, type: 'replacement', action: 'undo', eventId: operationId, unitId, unitKind: 'user', undoOf, baseRevision: initial.contextRevision ?? initial.revision, createdAt: new Date().toISOString() }
      }
      if (typeof surfaceText !== 'string' || surfaceText.trim().length === 0) throw new Error('CONTEXT_EDITOR_REPLACEMENT_EMPTY')
      const replacementEvents = row.replacementEvents.some(value => value.eventId === replacementEvent.eventId)
        ? row.replacementEvents
        : [...row.replacementEvents, replacementEvent]
      await this.table.put(sessionId, { session: row.session, schemaVersion: 1, storageVersion: 1, events: row.events, replacementEvents, condensationEvents: row.condensationEvents ?? [], recoveryEvents: row.recoveryEvents ?? [] })

      return withSourceAgent(this.ctx, sessionId, async agent => {
        const session = agent.session
        const current = this.projectionFromSession(session)
        if (String(current.contextRevision ?? current.sourceRevision) !== String(initial.contextRevision ?? initial.sourceRevision)) {
          return { ok: false, conflict: true, operationId, contextRevision: current.contextRevision, snapshot: this.snapshotOf(current, false), commit: { operationId, status: 'conflict', reason: 'context-changed-before-append', contextVersion: current.contextRevision } }
        }
        const events = sessionEvents(session)
        let nativeEvent = events.find(value => value?.type === 'user/message' && value?.data?.id === markerId)
        if (nativeEvent === undefined) {
          const activeNodes = foldSurface(events, this.ctx.sessions.messageProjections).nodes
          const activeSource = activeNodes.map(seq => events.find(value => value?.seq === seq)).find(value => {
            const marker = parseContextEditorSurfaceMarker(value?.data?.id)
            return (marker?.rootEventSeq ?? value?.seq) === rootEventSeq
          })
          if (activeSource === undefined) throw new Error('CONTEXT_EDITOR_REPLACEMENT_SOURCE_NOT_ACTIVE')
          const activeSeq = Number(activeSource.seq)
          const data = { ...structuredClone(originalData), id: markerId, content: [{ type: 'text', text: surfaceText }] }
          nativeEvent = session.append('user/message', data, {
            surfaceOp: surfaceReplaceOp(this, activeSeq, activeSeq),
            sourceEventSeqs: [activeSeq],
          })
        }
        await this.ctx.sessions.flush(session)
        const modelMessage = session.deriveMessages().find(value => value?.id === markerId)
        if (textMessageText(modelMessage) !== surfaceText) throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:model-message-mismatch')
        this.searchCache.clear()
        const persisted = await this.readProjection(sessionId)
        const durableEvent = (persisted.sourceEvents ?? []).find(value => value?.type === 'user/message' && value?.data?.id === markerId)
        const durableUnit = targetUnit(persisted, unitId)
        const detached = restoreSession(sessionId, persisted.sourceEvents, persisted.sessionHeader ?? persisted.meta ?? persisted.identity, persisted.inheritedEventCount ?? 0, this.ctx.sessions.messageProjections)
        const durableModel = detached.deriveMessages().find(value => value?.id === markerId)
        if (!durableEvent || !durableUnit || durableUnit.unit.effectiveText !== surfaceText || textMessageText(durableModel) !== surfaceText) {
          throw new Error('CONTEXT_EDITOR_COMMIT_VERIFICATION_FAILED:persistence-readback-mismatch')
        }
        return success(this.snapshotOf(persisted, false), {
          operationId,
          eventId: String(durableEvent.seq ?? nativeEvent.seq),
          commit: { operationId, status: 'persisted-and-verified', eventId: String(durableEvent.seq ?? nativeEvent.seq), persistenceLocations: ['session-log', 'context_editor'], contextVersion: persisted.contextRevision },
        })
      })
    })
  }
  async commitReplacementMutation(request, action) {
    requireNativeProjection(this, 'contextReplacement')
    if (this.requestTransform) return this.commitRequestMutation(request, action)
    if (this.hostAdapter === SURFACE_ADAPTER_ID) return this.commitSurfaceReplacementMutation(request, action)
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
      await this.table.put(sessionId, { session: row.session, schemaVersion: 1, storageVersion: 1, events: row.events, replacementEvents, condensationEvents: row.condensationEvents ?? [], recoveryEvents: row.recoveryEvents ?? [] })
      return withSourceAgent(this.ctx, sessionId, async agent => {
        const session = agent.session
        const sourceProjection = this.projectionFromSession(session)
        const priorEvent = sessionEvents(session).find(value => value?.type === 'context/projection' && value?.data?.owner === CONTEXT_PROJECTION_OWNER && value?.data?.operationId === operationId)
        if (priorEvent !== undefined) {
          await this.ctx.sessions.flush(session)
          this.searchCache.clear()
          const next = this.projectionFromSession(session)
          return success(this.snapshotOf(next, false), { operationId, eventId: String(priorEvent.seq) })
        }
        if (sourceProjection.revision !== initial.revision) return { ok: false, conflict: true, operationId, snapshot: this.snapshotOf(sourceProjection, false) }
        const calculated = buildNativeReplacementChanges(sourceProjection, event, { operationId })
        if (calculated.changes.length === 0) throw new Error('CONTEXT_EDITOR_REPLACEMENT_ALIGNMENT_FAILED')
        const baseSeq = sessionEvents(session).at(-1)?.seq ?? -1
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
        recoveryEvents: latest.recoveryEvents ?? [],
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
        recoveryEvents: latest.recoveryEvents ?? [],
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
