import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { PiContextEditorHost } from "../adapters/pi-extension/src/host.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-host-"));
  tempDirs.push(dir);
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, "fixture session\n", "utf8");
  let branch: unknown[] = [
    { id: "u1", type: "message", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "检查" } },
    { id: "a1", type: "message", parentId: "u1", timestamp: new Date(2).toISOString(), message: { role: "assistant", content: [{ type: "thinking", thinking: "先思考" }, { type: "text", text: "答案" }] } },
  ];
  const ctx = {
    mode: "tui",
    isIdle: () => true,
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => "session-1",
      getBranch: () => branch,
      getLeafId: () => (branch.at(-1) as { id?: string } | undefined)?.id ?? null,
    },
  } as never;
  return {
    sessionFile,
    ctx: ctx as never,
    setBranch: (next: unknown[]) => { branch = next; },
    modelProjection: () => JSON.stringify(branch.flatMap((entry) => sessionEntryToContextMessages(entry as SessionEntry))),
  };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("Pi context host", () => {
  it("persists visual unit events in sidecar and isolates sibling branches", () => {
    const { sessionFile, ctx, setBranch, modelProjection } = fixture();
    const before = sha256(sessionFile);
    const beforeModelProjection = modelProjection();
    const host = new PiContextEditorHost(ctx);
    const ai = host.records().find((record) => record.kind === "ai");
    const reasoning = ai?.units.find((unit) => unit.kind === "reasoning");
    expect(reasoning).toBeDefined();

    const result = host.commit({ baseRevision: host.snapshot().revision, action: "hide", unitIds: [reasoning!.id] });
    expect(result.ok).toBe(true);
    expect(host.records().find((record) => record.kind === "ai")?.units.find((unit) => unit.kind === "reasoning")?.viewState).toBe("hide");
    expect(sha256(sessionFile)).toBe(before);
    expect(modelProjection()).toBe(beforeModelProjection);

    const viewRevision = host.snapshot().revision;
    host.setPrefs({ version: 2, enabledKinds: ["ai"], showHidden: true });
    expect(host.snapshot().revision).toBe(viewRevision);

    // A sibling branch created from u1 does not contain the mutation anchor a1.
    setBranch([{ id: "u1", type: "message", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "检查" } }]);
    expect(new PiContextEditorHost(ctx).records().find((record) => record.kind === "user")?.viewState).toBe("show");

    // A descendant branch containing a1 inherits the event.
    setBranch([
      { id: "u1", type: "message", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "检查" } },
      { id: "a1", type: "message", parentId: "u1", timestamp: new Date(2).toISOString(), message: { role: "assistant", content: [{ type: "thinking", thinking: "先思考" }, { type: "text", text: "答案" }] } },
      { id: "b1", type: "message", parentId: "a1", timestamp: new Date(3).toISOString(), message: { role: "user", content: "继续" } },
    ]);
    expect(new PiContextEditorHost(ctx).records().find((record) => record.kind === "ai")?.units.find((unit) => unit.kind === "reasoning")?.viewState).toBe("hide");
  });
});
