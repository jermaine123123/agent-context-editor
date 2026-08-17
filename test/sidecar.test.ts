import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSidecarEvent,
  readSidecar,
  writeSidecarPrefs,
} from "../adapters/pi-extension/src/sidecar.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "context-editor-sidecar-"));
  temporaryRoots.push(root);
  return join(root, "session.jsonl");
}

const event = {
  version: 2 as const,
  transactionId: "tx-1",
  createdAt: "2026-08-18T00:00:00.000Z",
  baseRevision: "base",
  action: "hide" as const,
  changes: [{ atomId: "a1", fingerprint: "fp", before: "show" as const, after: "hide" as const }],
};

describe("Pi sidecar", () => {
  it("persists events atomically and rejects stale revisions", () => {
    const session = fixture();
    const initial = readSidecar(session, "session-1");
    appendSidecarEvent(session, "session-1", "entry-1", event, initial.revision);
    const next = readSidecar(session, "session-1");
    expect(next.document.events).toHaveLength(1);
    expect(next.document.events[0]?.event.transactionId).toBe("tx-1");
    expect(() => appendSidecarEvent(session, "session-1", "entry-2", event, initial.revision)).toThrow("CONTEXT_EDITOR_CONFLICT");
  });

  it("normalizes and persists preferences without touching events", () => {
    const session = fixture();
    const result = writeSidecarPrefs(session, "session-2", {
      version: 2,
      enabledKinds: ["ai", "ai"],
      showHidden: true,
    });
    expect(result.document.prefs).toEqual({ version: 2, enabledKinds: ["ai"], showHidden: true });
    expect(result.document.events).toEqual([]);
  });
});
