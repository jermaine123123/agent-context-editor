import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stableFingerprint, type ContextProjectionChange, type ContextProjectionEvent, type ContextProjectionEventV1, type ContextCondensationEventV1 } from "./shared-core/index.js";

export const PROJECTION_SIDECAR_SCHEMA_VERSION = 1 as const;

export interface PiProjectionEnvelope {
  anchorEntryId: string;
  event: ContextProjectionEvent;
}

export interface PiContextProjectionSidecar {
  schemaVersion: typeof PROJECTION_SIDECAR_SCHEMA_VERSION;
  sessionId: string;
  events: PiProjectionEnvelope[];
}

export interface ProjectionSidecarReadResult {
  path: string;
  document: PiContextProjectionSidecar;
  revision: string;
  projectionRevision: string;
  integrity: "ok" | "missing" | "invalid";
  error?: string;
}

function defaultDocument(sessionId: string): PiContextProjectionSidecar {
  return { schemaVersion: PROJECTION_SIDECAR_SCHEMA_VERSION, sessionId, events: [] };
}

function isProjectionChange(value: unknown): value is ContextProjectionChange {
  if (!value || typeof value !== "object") return false;
  const change = value as Record<string, unknown>;
  const sourceRef = change.sourceRef;
  if (!sourceRef || typeof sourceRef !== "object") return false;
  const ref = sourceRef as Record<string, unknown>;
  return typeof change.atomId === "string" && change.atomId.length > 0 &&
    typeof change.fingerprint === "string" && change.fingerprint.length > 0 &&
    typeof ref.entryId === "string" && ref.entryId.length > 0 && typeof ref.blockIndex === "number" && Number.isInteger(ref.blockIndex) && ref.blockIndex >= 0 &&
    (change.before === "include" || change.before === "exclude") &&
    (change.after === "include" || change.after === "exclude") && change.before !== change.after;
}

function isLinkedExclusion(value: unknown, eventId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const linked = value as Record<string, unknown>;
  if (linked.operationId !== eventId || !Array.isArray(linked.unitIds) || !Array.isArray(linked.atomChanges)) return false;
  if (!linked.unitIds.every((id) => typeof id === "string" && id.length > 0) || new Set(linked.unitIds).size !== linked.unitIds.length) return false;
  const atomIds = new Set<string>();
  for (const change of linked.atomChanges) {
    if (!isProjectionChange(change) || atomIds.has(change.atomId)) return false;
    atomIds.add(change.atomId);
  }
  return true;
}

function isCondensationEvent(value: unknown): value is ContextCondensationEventV1 {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.type !== "condensation" || row.schemaVersion !== 1) return false;
  if (!['apply', 'restore', 'exclude-summary', 'restore-summary'].includes(String(row.action))) return false;
  if (typeof row.eventId !== 'string' || !row.eventId || typeof row.operationId !== 'string' || !row.operationId ||
      typeof row.sessionId !== 'string' || !row.sessionId || (typeof row.baseRevision !== 'string' && typeof row.baseRevision !== 'number') ||
      typeof row.summary !== 'string' || typeof row.provider !== 'string' || typeof row.model !== 'string' || typeof row.createdAt !== 'string') return false;
  if (row.sourceFingerprint !== undefined && typeof row.sourceFingerprint !== "string") return false;
  if (!Array.isArray(row.requestedUnitIds) || !row.requestedUnitIds.every((id) => typeof id === 'string')) return false;
  if (!Array.isArray(row.effectiveUnitIds) || !row.effectiveUnitIds.every((id) => typeof id === 'string')) return false;
  if (!Array.isArray(row.sourceEntryIds) || !row.sourceEntryIds.every((id) => typeof id === 'string' && id.length > 0)) return false;
  if (!Array.isArray(row.sourceRootSeqs) || !row.sourceRootSeqs.every((id) => Number.isSafeInteger(id))) return false;
  if (!Array.isArray(row.sourceUnits) || !row.sourceUnits.every((unit) => {
    if (!unit || typeof unit !== 'object') return false;
    const item = unit as Record<string, unknown>;
    return typeof item.id === 'string' && typeof item.recordId === 'string' && typeof item.kind === 'string' &&
      Array.isArray(item.atomIds) && item.atomIds.every((id) => typeof id === 'string') &&
      Array.isArray(item.sourceRootSeqs) && item.sourceRootSeqs.every((id) => Number.isSafeInteger(id)) &&
      (item.sourceEntryIds === undefined || (Array.isArray(item.sourceEntryIds) && item.sourceEntryIds.every((id) => typeof id === 'string'))) &&
      typeof item.text === 'string' && typeof item.included === 'boolean' && Number.isFinite(Number(item.approxTokens));
  })) return false;
  const metrics = row.metrics;
  if (!metrics || typeof metrics !== 'object') return false;
  if (!Array.isArray(row.beforeMessages) || !row.beforeMessages.every((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).entryId === 'string' && 'message' in (item as Record<string, unknown>))) return false;
  if (!Array.isArray(row.afterMessages) || !row.afterMessages.every((item) => item && typeof item === 'object' && typeof (item as Record<string, unknown>).entryId === 'string' && 'message' in (item as Record<string, unknown>))) return false;
  return true;
}
function isProjectionEvent(value: unknown): value is ContextProjectionEvent {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (row.type === "condensation") return isCondensationEvent(value);
  if ("type" in row && row.type !== "replacement") return false;
  if (row.type === "replacement") {
    if (row.schemaVersion !== 1 || typeof row.eventId !== "string" || row.eventId.length === 0 || typeof row.unitId !== "string" || row.unitId.length === 0 || typeof row.createdAt !== "string" || (typeof row.baseRevision !== "string" && typeof row.baseRevision !== "number")) return false;
    if (row.action === "undo") {
      if (typeof row.undoOf !== "string" || row.undoOf.length === 0) return false;
      if (row.linkedExclusion !== undefined && !isLinkedExclusion(row.linkedExclusion, row.eventId)) return false;
      return true;
    }
    if (row.action !== "replace" && row.action !== "restore") return false;
    if (row.unitKind !== "user" && row.unitKind !== "answer") return false;
    if (!Array.isArray(row.atomRefs) || row.atomRefs.length === 0) return false;
    if ((typeof row.beforeText !== "string" && row.beforeText !== null) || (typeof row.afterText !== "string" && row.afterText !== null)) return false;
    if (row.action === "replace" && (typeof row.afterText !== "string" || row.afterText.trim().length === 0)) return false;
    if (row.action === "restore" && (row.afterText !== null || typeof row.beforeText !== "string")) return false;
    if (row.linkedExclusion !== undefined && !isLinkedExclusion(row.linkedExclusion, row.eventId)) return false;
    const atomIds = new Set<string>();
    return row.atomRefs.every((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const ref = candidate as Record<string, unknown>;
      const sourceRef = ref.sourceRef;
      if (typeof ref.atomId !== "string" || atomIds.has(ref.atomId)) return false;
      atomIds.add(ref.atomId);
      const source = sourceRef as Record<string, unknown> | undefined;
      return typeof ref.atomId === "string" && ref.atomId.length > 0 && typeof ref.fingerprint === "string" && ref.fingerprint.length > 0 && !!sourceRef && typeof sourceRef === "object" &&
        typeof source?.entryId === "string" && typeof source.blockIndex === "number" && Number.isInteger(source.blockIndex) && source.blockIndex >= 0;
    });
  }
  if (row.version !== 1 || typeof row.transactionId !== "string" || typeof row.createdAt !== "string" ||
    typeof row.baseRevision !== "string" || (row.action !== "exclude" && row.action !== "restore") ||
    !Array.isArray(row.changes) || row.changes.length === 0) return false;
  return row.changes.every((candidate) => isProjectionChange(candidate));
}
function parseDocument(raw: unknown, sessionId: string): { document: PiContextProjectionSidecar; error?: string } {
  if (!raw || typeof raw !== "object") return { document: defaultDocument(sessionId), error: "projection sidecar JSON is malformed" };
  const row = raw as Record<string, unknown>;
  if (row.schemaVersion !== PROJECTION_SIDECAR_SCHEMA_VERSION) {
    return { document: defaultDocument(sessionId), error: "projection sidecar schema version is unsupported" };
  }
  if (row.sessionId !== sessionId) {
    return { document: defaultDocument(sessionId), error: "projection sidecar Session id does not match" };
  }
  if (!Array.isArray(row.events)) {
    return { document: defaultDocument(sessionId), error: "projection sidecar events are malformed" };
  }
  const events: PiProjectionEnvelope[] = [];
  for (const candidate of row.events) {
    if (!candidate || typeof candidate !== "object") return { document: defaultDocument(sessionId), error: "projection sidecar envelope is malformed" };
    const envelope = candidate as Record<string, unknown>;
    if (typeof envelope.anchorEntryId !== "string" || !isProjectionEvent(envelope.event)) {
      return { document: defaultDocument(sessionId), error: "projection sidecar event is malformed" };
    }
    events.push({ anchorEntryId: envelope.anchorEntryId, event: envelope.event });
  }
  return { document: { schemaVersion: PROJECTION_SIDECAR_SCHEMA_VERSION, sessionId, events } };
}

function revisionOf(path: string, raw: string | undefined, document: PiContextProjectionSidecar, integrity: string): string {
  let stat = "missing";
  try {
    const value = statSync(path);
    stat = String(value.size) + ":" + String(value.mtimeMs);
  } catch { /* missing sidecars are stable defaults */ }
  return stableFingerprint([path, stat, integrity, raw ?? JSON.stringify(document)]);
}

function projectionRevisionOf(document: PiContextProjectionSidecar): string {
  return stableFingerprint([document.sessionId, JSON.stringify(document.events)]);
}

export function projectionSidecarPath(sessionFile: string): string {
  return resolve(sessionFile) + ".context-editor.projection.json";
}

export function readProjectionSidecar(sessionFile: string, sessionId: string): ProjectionSidecarReadResult {
  const path = projectionSidecarPath(sessionFile);
  if (!existsSync(path)) {
    const document = defaultDocument(sessionId);
    return { path, document, revision: revisionOf(path, undefined, document, "missing"), projectionRevision: projectionRevisionOf(document), integrity: "missing" };
  }
  let rawText: string;
  try {
    rawText = readFileSync(path, "utf8");
  } catch {
    const document = defaultDocument(sessionId);
    return { path, document, revision: revisionOf(path, undefined, document, "invalid"), projectionRevision: projectionRevisionOf(document), integrity: "invalid", error: "projection sidecar could not be read" };
  }
  let raw: unknown;
  try { raw = JSON.parse(rawText); }
  catch {
    const document = defaultDocument(sessionId);
    return { path, document, revision: revisionOf(path, rawText, document, "invalid"), projectionRevision: projectionRevisionOf(document), integrity: "invalid", error: "projection sidecar JSON is malformed" };
  }
  const parsed = parseDocument(raw, sessionId);
  if (parsed.error) {
    return { path, document: parsed.document, revision: revisionOf(path, rawText, parsed.document, "invalid"), projectionRevision: projectionRevisionOf(parsed.document), integrity: "invalid", error: parsed.error };
  }
  return { path, document: parsed.document, revision: revisionOf(path, rawText, parsed.document, "ok"), projectionRevision: projectionRevisionOf(parsed.document), integrity: "ok" };
}

function withLock<T>(path: string, fn: () => T): T {
  const lockPath = path + ".lock";
  const deadline = Date.now() + 2000;
  let handle: number | undefined;
  while (handle === undefined && Date.now() < deadline) {
    try {
      handle = openSync(lockPath, "wx");
      writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      fsyncSync(handle);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (handle === undefined) throw new Error("CONTEXT_EDITOR_SIDECAR_BUSY");
  try { return fn(); }
  finally {
    try { closeSync(handle); } catch { /* already closed */ }
    try { unlinkSync(lockPath); } catch { /* best effort cleanup */ }
  }
}

function writeDocument(path: string, document: PiContextProjectionSidecar): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = path + "." + process.pid + "." + Date.now() + ".tmp";
  const handle = openSync(tempPath, "w");
  try {
    writeFileSync(handle, JSON.stringify(document, null, 2) + "\n", "utf8");
    fsyncSync(handle);
  } finally { closeSync(handle); }
  renameSync(tempPath, path);
}

export function appendProjectionSidecarEvent(
  sessionFile: string,
  sessionId: string,
  anchorEntryId: string,
  event: ContextProjectionEvent,
  expectedRevision: string,
): string {
  const path = projectionSidecarPath(sessionFile);
  return withLock(path, () => {
    const current = readProjectionSidecar(sessionFile, sessionId);
    if (current.integrity === "invalid") throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
    if (current.revision !== expectedRevision) throw new Error("CONTEXT_EDITOR_CONFLICT");
    const next: PiContextProjectionSidecar = {
      ...current.document,
      events: [...current.document.events, { anchorEntryId, event }],
    };
    writeDocument(path, next);
    return "type" in event ? event.eventId : (event as ContextProjectionEventV1).transactionId;
  });
}
