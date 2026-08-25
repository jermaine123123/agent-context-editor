import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stableFingerprint } from "./shared-core/index.js";
import type {
  ContextEditorPrefs,
  ContextEditorPrefsInput,
  ContextEditorViewEventV2,
} from "./shared-core/index.js";
import { DEFAULT_CONTEXT_EDITOR_PREFS, normalizeContextEditorPrefs } from "./shared-core/prefs.js";

export const SIDECAR_SCHEMA_VERSION = 1 as const;

export interface PiSidecarEvent {
  anchorEntryId: string;
  event: ContextEditorViewEventV2;
}

export interface PiContextEditorSidecar {
  schemaVersion: typeof SIDECAR_SCHEMA_VERSION;
  sessionId: string;
  prefs: ContextEditorPrefs;
  events: PiSidecarEvent[];
}

export interface SidecarReadResult {
  path: string;
  document: PiContextEditorSidecar;
  revision: string;
  /** Revision of the view event stream; preferences do not invalidate CAS. */
  viewRevision: string;
}

function defaultDocument(sessionId: string): PiContextEditorSidecar {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    sessionId,
    prefs: { ...DEFAULT_CONTEXT_EDITOR_PREFS },
    events: [],
  };
}

function isEvent(value: unknown): value is ContextEditorViewEventV2 {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const changes = Array.isArray(row.changes) ? row.changes : [];
  const validChanges = changes.length > 0 && changes.every((change) => {
    if (!change || typeof change !== "object") return false;
    const item = change as Record<string, unknown>;
    return typeof item.atomId === "string" &&
      typeof item.fingerprint === "string" &&
      (item.before === "show" || item.before === "collapse" || item.before === "hide") &&
      (item.after === "show" || item.after === "collapse" || item.after === "hide");
  });
  return row.version === 2 &&
    typeof row.transactionId === "string" &&
    typeof row.createdAt === "string" &&
    typeof row.baseRevision === "string" &&
    (row.action === "hide" || row.action === "restore" || row.action === "reset" || row.action === "undo") &&
    validChanges;
}

function parseDocument(raw: unknown, sessionId: string): PiContextEditorSidecar {
  if (!raw || typeof raw !== "object") return defaultDocument(sessionId);
  const row = raw as Record<string, unknown>;
  if (row.schemaVersion !== SIDECAR_SCHEMA_VERSION ||
      (typeof row.sessionId === "string" && row.sessionId !== sessionId)) {
    return defaultDocument(sessionId);
  }
  const events = Array.isArray(row.events)
    ? row.events.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") return [];
        const envelope = candidate as Record<string, unknown>;
        if (typeof envelope.anchorEntryId !== "string" || !isEvent(envelope.event)) return [];
        return [{ anchorEntryId: envelope.anchorEntryId, event: envelope.event }];
      })
    : [];
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    sessionId: typeof row.sessionId === "string" ? row.sessionId : sessionId,
    prefs: normalizeContextEditorPrefs(row.prefs),
    events,
  };
}

export function sidecarPath(sessionFile: string): string {
  return `${resolve(sessionFile)}.context-editor.json`;
}

function revisionOf(path: string, document: PiContextEditorSidecar): string {
  let stat = "missing";
  try {
    const value = statSync(path);
    stat = `${value.size}:${value.mtimeMs}`;
  } catch {
    // Missing sidecars are represented by the default document.
  }
  return stableFingerprint([path, stat, JSON.stringify(document)]);
}

function viewRevisionOf(document: PiContextEditorSidecar): string {
  return stableFingerprint([document.sessionId, JSON.stringify(document.events)]);
}

export function readSidecar(sessionFile: string, sessionId: string): SidecarReadResult {
  const path = sidecarPath(sessionFile);
  let raw: unknown;
  if (existsSync(path)) {
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // A partially written or manually edited sidecar must fail open. The
      // next successful mutation replaces it with a valid document.
      raw = undefined;
    }
  }
  const document = parseDocument(raw, sessionId);
  return {
    path,
    document,
    revision: revisionOf(path, document),
    viewRevision: viewRevisionOf(document),
  };
}

function withLock<T>(path: string, fn: () => T): T {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + 2000;
  let handle: number | undefined;
  while (handle === undefined && Date.now() < deadline) {
    try {
      handle = openSync(lockPath, "wx");
      writeFileSync(handle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      fsyncSync(handle);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A short bounded wait prevents two Pi processes from interleaving JSON
      // writes while keeping the extension synchronous for the TUI command.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (handle === undefined) throw new Error("CONTEXT_EDITOR_SIDECAR_BUSY");
  try {
    return fn();
  } finally {
    try { closeSync(handle); } catch { /* already closed */ }
    try { unlinkSync(lockPath); } catch { /* best effort cleanup */ }
  }
}

function writeDocument(path: string, document: PiContextEditorSidecar): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const handle = openSync(tempPath, "w");
  try {
    writeFileSync(handle, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  renameSync(tempPath, path);
}

export function appendSidecarEvent(
  sessionFile: string,
  sessionId: string,
  anchorEntryId: string,
  event: ContextEditorViewEventV2,
  expectedRevision: string,
): string {
  const path = sidecarPath(sessionFile);
  return withLock(path, () => {
    const current = readSidecar(sessionFile, sessionId);
    if (current.revision !== expectedRevision) throw new Error("CONTEXT_EDITOR_CONFLICT");
    const next: PiContextEditorSidecar = {
      ...current.document,
      events: [...current.document.events, { anchorEntryId, event }],
    };
    writeDocument(path, next);
    return event.transactionId;
  });
}

export function writeSidecarPrefs(
  sessionFile: string,
  sessionId: string,
  prefs: ContextEditorPrefsInput,
): SidecarReadResult {
  const path = sidecarPath(sessionFile);
  return withLock(path, () => {
    const current = readSidecar(sessionFile, sessionId);
    const next: PiContextEditorSidecar = {
      ...current.document,
      prefs: normalizeContextEditorPrefs(prefs),
    };
    writeDocument(path, next);
    return readSidecar(sessionFile, sessionId);
  });
}
