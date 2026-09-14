import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stableFingerprint, type ContextNativeCompactionRef } from "./shared-core/index.js";

export const NATIVE_COMPACTION_SIDECAR_SCHEMA_VERSION = 1 as const;

export interface PiNativeCompactionEvidence {
  schemaVersion: typeof NATIVE_COMPACTION_SIDECAR_SCHEMA_VERSION;
  sessionId: string;
  preparationId: string;
  firstKeptEntryId: string;
  shadowedEntryIds: string[];
  checkpointEntryId?: string;
  preparedRevision: string;
  sourceFingerprint: string;
  reason: "manual" | "threshold" | "overflow";
  committed: boolean;
  compactionId?: string;
  summaryEntryId?: string;
  createdAt: string;
  updatedAt: string;
}

interface PiNativeCompactionSidecar {
  schemaVersion: typeof NATIVE_COMPACTION_SIDECAR_SCHEMA_VERSION;
  sessionId: string;
  events: PiNativeCompactionEvidence[];
}

export interface NativeCompactionSidecarReadResult {
  path: string;
  document: PiNativeCompactionSidecar;
  revision: string;
  integrity: "ok" | "missing" | "invalid";
  error?: string;
}

function defaultDocument(sessionId: string): PiNativeCompactionSidecar {
  return { schemaVersion: NATIVE_COMPACTION_SIDECAR_SCHEMA_VERSION, sessionId, events: [] };
}

function revisionOf(path: string, raw: string | undefined, document: PiNativeCompactionSidecar, state: string): string {
  let stat = "";
  try {
    const item = requireStat(path);
    stat = `${item.size}:${item.mtimeMs}`;
  } catch { /* missing or transient file */ }
  return stableFingerprint([path, stat, state, raw ?? JSON.stringify(document)]);
}

function requireStat(path: string): { size: number; mtimeMs: number } {
  return statSync(path);
}

export function nativeCompactionSidecarPath(sessionFile: string): string {
  return resolve(sessionFile) + ".context-editor.compaction.json";
}

function parseEvidence(value: unknown): value is PiNativeCompactionEvidence {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.schemaVersion === NATIVE_COMPACTION_SIDECAR_SCHEMA_VERSION
    && typeof row.sessionId === "string" && row.sessionId.length > 0
    && typeof row.preparationId === "string" && row.preparationId.length > 0
    && typeof row.firstKeptEntryId === "string" && row.firstKeptEntryId.length > 0
    && Array.isArray(row.shadowedEntryIds) && row.shadowedEntryIds.every(id => typeof id === "string" && id.length > 0)
    && (row.checkpointEntryId === undefined || typeof row.checkpointEntryId === "string")
    && typeof row.preparedRevision === "string"
    && typeof row.sourceFingerprint === "string"
    && (row.reason === "manual" || row.reason === "threshold" || row.reason === "overflow")
    && typeof row.committed === "boolean"
    && (row.compactionId === undefined || typeof row.compactionId === "string")
    && (row.summaryEntryId === undefined || typeof row.summaryEntryId === "string")
    && typeof row.createdAt === "string" && typeof row.updatedAt === "string";
}

function parseDocument(value: unknown, sessionId: string): { document: PiNativeCompactionSidecar; error?: string } {
  if (!value || typeof value !== "object") return { document: defaultDocument(sessionId), error: "native compaction sidecar must be an object" };
  const row = value as Record<string, unknown>;
  if (row.schemaVersion !== NATIVE_COMPACTION_SIDECAR_SCHEMA_VERSION) return { document: defaultDocument(sessionId), error: "unsupported native compaction sidecar version" };
  if (typeof row.sessionId !== "string" || row.sessionId !== sessionId) return { document: defaultDocument(sessionId), error: "native compaction sidecar session mismatch" };
  if (!Array.isArray(row.events) || !row.events.every(parseEvidence)) return { document: defaultDocument(sessionId), error: "native compaction sidecar contains an invalid event" };
  return { document: { schemaVersion: NATIVE_COMPACTION_SIDECAR_SCHEMA_VERSION, sessionId, events: row.events as PiNativeCompactionEvidence[] } };
}

export function readNativeCompactionSidecar(sessionFile: string, sessionId: string): NativeCompactionSidecarReadResult {
  const path = nativeCompactionSidecarPath(sessionFile);
  if (!existsSync(path)) {
    const document = defaultDocument(sessionId);
    return { path, document, revision: revisionOf(path, undefined, document, "missing"), integrity: "missing" };
  }
  let rawText: string;
  try { rawText = readFileSync(path, "utf8"); }
  catch {
    const document = defaultDocument(sessionId);
    return { path, document, revision: revisionOf(path, undefined, document, "invalid"), integrity: "invalid", error: "native compaction sidecar could not be read" };
  }
  let raw: unknown;
  try { raw = JSON.parse(rawText); }
  catch {
    const document = defaultDocument(sessionId);
    return { path, document, revision: revisionOf(path, rawText, document, "invalid"), integrity: "invalid", error: "native compaction sidecar JSON is malformed" };
  }
  const parsed = parseDocument(raw, sessionId);
  if (parsed.error) return { path, document: parsed.document, revision: revisionOf(path, rawText, parsed.document, "invalid"), integrity: "invalid", error: parsed.error };
  return { path, document: parsed.document, revision: revisionOf(path, rawText, parsed.document, "ok"), integrity: "ok" };
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

function writeDocument(path: string, document: PiNativeCompactionSidecar): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = path + "." + process.pid + "." + Date.now() + ".tmp";
  const handle = openSync(tempPath, "w");
  try {
    writeFileSync(handle, JSON.stringify(document, null, 2) + "\n", "utf8");
    fsyncSync(handle);
  } finally { closeSync(handle); }
  renameSync(tempPath, path);
}

export function upsertNativeCompactionEvidence(
  sessionFile: string,
  sessionId: string,
  evidence: PiNativeCompactionEvidence,
): string {
  const path = nativeCompactionSidecarPath(sessionFile);
  return withLock(path, () => {
    const current = readNativeCompactionSidecar(sessionFile, sessionId);
    if (current.integrity === "invalid") throw new Error("CONTEXT_EDITOR_NATIVE_COMPACTION_UNAVAILABLE");
    const events = current.document.events.filter(item => item.preparationId !== evidence.preparationId && item.compactionId !== evidence.compactionId);
    writeDocument(path, { ...current.document, events: [...events, evidence] });
    return evidence.preparationId;
  });
}

export function nativeCompactionPreparationId(input: {
  sessionId: string;
  firstKeptEntryId: string;
  shadowedEntryIds: readonly string[];
  preparedRevision: string;
  sourceFingerprint: string;
}): string {
  return stableFingerprint([
    input.sessionId,
    input.firstKeptEntryId,
    ...input.shadowedEntryIds,
    input.preparedRevision,
    input.sourceFingerprint,
  ]);
}

export function inferPiShadowedEntryIds(
  branchEntries: readonly unknown[],
  firstKeptEntryId: string,
  turnPrefixMessagesPresent: boolean,
): string[] {
  const rows = branchEntries as Array<{ id?: unknown; type?: unknown; message?: { role?: unknown } }>;
  const firstKeptIndex = rows.findIndex(entry => String(entry.id ?? "") === firstKeptEntryId);
  if (firstKeptIndex < 0) return [];
  let boundary = 0;
  for (let index = firstKeptIndex - 1; index >= 0; index -= 1) {
    const entry = rows[index];
    if (entry?.type === "compaction") {
      const previousKept = String((entry as { firstKeptEntryId?: unknown }).firstKeptEntryId ?? "");
      const previousIndex = rows.findIndex(candidate => String(candidate.id ?? "") === previousKept);
      boundary = previousIndex >= 0 ? previousIndex : index + 1;
      break;
    }
  }
  if (turnPrefixMessagesPresent) {
    for (let index = firstKeptIndex - 1; index >= boundary; index -= 1) {
      if (rows[index]?.type === "message" && String(rows[index]?.message?.role ?? "") === "user") {
        boundary = index;
        break;
      }
    }
  }
  return rows.slice(boundary, firstKeptIndex)
    .map(entry => String(entry.id ?? ""))
    .filter(Boolean)
    .filter(id => !rows.find(entry => String(entry.id ?? "") === id && entry.type === "compaction"));
}

export function piCompactionCheckpointEntryId(branchEntries: readonly unknown[]): string | undefined {
  const last = branchEntries.at(-1) as { id?: unknown } | undefined;
  const id = String(last?.id ?? "");
  return id || undefined;
}

export function reconcileNativeCompactionEntry(
  branchEntries: readonly unknown[],
  compactionEntry: { id?: unknown; firstKeptEntryId?: unknown; parentId?: unknown },
  pending: PiNativeCompactionEvidence,
): PiNativeCompactionEvidence {
  const compactionId = String(compactionEntry.id ?? "");
  const checkpointEntryId = String(compactionEntry.parentId ?? piCompactionCheckpointEntryId(branchEntries) ?? "");
  return {
    ...pending,
    committed: true,
    compactionId: compactionId || pending.compactionId,
    summaryEntryId: compactionId || pending.summaryEntryId,
    firstKeptEntryId: String(compactionEntry.firstKeptEntryId ?? pending.firstKeptEntryId),
    ...(checkpointEntryId ? { checkpointEntryId } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function nativeCompactionRefs(document: NativeCompactionSidecarReadResult["document"]): ContextNativeCompactionRef[] {
  return document.events.map(event => ({
    host: "pi",
    compactionId: event.compactionId ?? event.preparationId,
    shadowedRootSeqs: [],
    shadowedEntryIds: [...event.shadowedEntryIds],
    ...(event.checkpointEntryId ? { checkpointEntryId: event.checkpointEntryId } : {}),
    ...(event.committed ? {} : { committed: false }),
  }));
}

export function findPendingEvidence(
  document: NativeCompactionSidecarReadResult["document"],
  firstKeptEntryId: string,
  shadowedEntryIds: readonly string[],
): PiNativeCompactionEvidence | undefined {
  const shadowed = new Set(shadowedEntryIds);
  return document.events
    .filter(event => !event.committed && event.firstKeptEntryId === firstKeptEntryId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .find(event => event.shadowedEntryIds.some(id => shadowed.has(id)));
}