import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendSidecarEvent, readSidecar, sidecarPath, writeSidecarPrefs } from "../adapters/pi-extension/src/sidecar.js";
import type { ContextEditorViewEventV2 } from "../packages/context-editor-core/src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-context-editor-"));
  tempDirs.push(dir);
  return join(dir, "session.jsonl");
}

function event(id: string): ContextEditorViewEventV2 {
  return {
    version: 2,
    transactionId: id,
    createdAt: new Date().toISOString(),
    baseRevision: "base",
    action: "hide",
    changes: [{ atomId: "u1:0:user", fingerprint: "fp", before: "show", after: "hide" }],
  };
}

describe("Pi sidecar", () => {
  it("writes atomically and round-trips events and preferences", () => {
    const sessionFile = fixture();
    const first = readSidecar(sessionFile, "session-1");
    const id = appendSidecarEvent(sessionFile, "session-1", "leaf-1", event("tx-1"), first.revision);
    expect(id).toBe("tx-1");
    const withPrefs = writeSidecarPrefs(sessionFile, "session-1", { version: 2, enabledKinds: ["ai"], showHidden: true });
    expect(withPrefs.document.events[0]?.anchorEntryId).toBe("leaf-1");
    expect(withPrefs.document.prefs).toEqual({ version: 2, enabledKinds: ["ai"], showHidden: true });
    expect(JSON.parse(readFileSync(sidecarPath(sessionFile), "utf8")).schemaVersion).toBe(1);
  });

  it("rejects a stale sidecar revision without a partial write", () => {
    const sessionFile = fixture();
    const first = readSidecar(sessionFile, "session-1");
    writeSidecarPrefs(sessionFile, "session-1", { version: 2, enabledKinds: ["tool"], showHidden: false });
    expect(() => appendSidecarEvent(sessionFile, "session-1", "leaf-1", event("tx-1"), first.revision)).toThrow("CONTEXT_EDITOR_CONFLICT");
    expect(readSidecar(sessionFile, "session-1").document.events).toHaveLength(0);
  });

  it("fails open for malformed JSON and replaces it on the next write", () => {
    const sessionFile = fixture();
    writeFileSync(sidecarPath(sessionFile), "{not-json", "utf8");
    const parsed = readSidecar(sessionFile, "session-1");
    expect(parsed.document.events).toEqual([]);
    appendSidecarEvent(sessionFile, "session-1", "leaf-1", event("tx-1"), parsed.revision);
    expect(() => JSON.parse(readFileSync(sidecarPath(sessionFile), "utf8"))).not.toThrow();
  });
});
