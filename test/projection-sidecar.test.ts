import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendProjectionSidecarEvent, projectionSidecarPath, readProjectionSidecar } from "../adapters/pi-extension/src/projection-sidecar.js";
import type { ContextProjectionEventV1 } from "../packages/context-editor-core/src/index.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-projection-"));
  dirs.push(dir);
  return join(dir, "session.jsonl");
}

function event(id: string): ContextProjectionEventV1 {
  return {
    version: 1,
    transactionId: id,
    createdAt: new Date().toISOString(),
    baseRevision: "base",
    action: "exclude",
    changes: [{ atomId: "u1:0:user", sourceRef: { entryId: "u1", blockIndex: 0 }, fingerprint: "fp", before: "include", after: "exclude" }],
  };
}

describe("Pi projection sidecar", () => {
  it("round-trips atomically and leaves Session JSONL untouched", () => {
    const sessionFile = fixture();
    writeFileSync(sessionFile, "canonical\n", "utf8");
    const before = readFileSync(sessionFile, "utf8");
    const first = readProjectionSidecar(sessionFile, "session-1");
    expect(first.integrity).toBe("missing");
    appendProjectionSidecarEvent(sessionFile, "session-1", "leaf-1", event("tx-1"), first.revision);
    const next = readProjectionSidecar(sessionFile, "session-1");
    expect(next.integrity).toBe("ok");
    expect(next.document.events[0]?.anchorEntryId).toBe("leaf-1");
    expect(readFileSync(sessionFile, "utf8")).toBe(before);
    expect(JSON.parse(readFileSync(projectionSidecarPath(sessionFile), "utf8")).schemaVersion).toBe(1);
  });

  it("fails closed for stale CAS, malformed JSON, and foreign Session ids", () => {
    const sessionFile = fixture();
    const first = readProjectionSidecar(sessionFile, "session-1");
    writeFileSync(projectionSidecarPath(sessionFile), "{not-json", "utf8");
    const malformed = readProjectionSidecar(sessionFile, "session-1");
    expect(malformed.integrity).toBe("invalid");
    expect(() => appendProjectionSidecarEvent(sessionFile, "session-1", "leaf-1", event("tx-1"), first.revision)).toThrow("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
    writeFileSync(projectionSidecarPath(sessionFile), JSON.stringify({ schemaVersion: 1, sessionId: "other-session", events: [] }), "utf8");
    expect(readProjectionSidecar(sessionFile, "session-1").integrity).toBe("invalid");
  });
  it("changes revision after a projection event and rejects stale append", () => {
    const sessionFile = fixture();
    const first = readProjectionSidecar(sessionFile, "session-1");
    appendProjectionSidecarEvent(sessionFile, "session-1", "", event("tx-1"), first.revision);
    const second = readProjectionSidecar(sessionFile, "session-1");
    expect(second.revision).not.toBe(first.revision);
    expect(() => appendProjectionSidecarEvent(sessionFile, "session-1", "", event("tx-2"), first.revision)).toThrow("CONTEXT_EDITOR_CONFLICT");
  });
});
