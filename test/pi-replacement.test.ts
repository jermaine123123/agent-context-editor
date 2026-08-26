import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { PiContextEditorHost } from "../adapters/pi-extension/src/host.js";
import { projectModelContext } from "../adapters/pi-extension/src/projection-hook.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function sha(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-replacement-")); dirs.push(dir);
  const sessionFile = join(dir, "session.jsonl"); writeFileSync(sessionFile, "canonical session\n", "utf8");
  let branch: any[] = [
    { id: "u", type: "message", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "original user" } },
    { id: "a", type: "message", parentId: "u", timestamp: new Date(2).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "original answer" }] } },
  ];
  const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getSessionFile: () => sessionFile, getSessionId: () => "replacement-session", getBranch: () => branch, getLeafId: () => branch.at(-1)?.id ?? null, buildContextEntries: () => branch } } as never;
  return { ctx, sessionFile, branch: () => branch, setBranch: (next: any[]) => { branch = next; } };
}

describe("Pi replacement host", () => {
  it("keeps Session immutable, supports LIFO, exclusion precedence and branch anchors", async () => {
    const { ctx, sessionFile, branch, setBranch } = fixture();
    const before = sha(sessionFile);
    const host = new PiContextEditorHost(ctx);
    const user = host.records().find((record) => record.kind === "user")!.units.find((unit) => unit.kind === "user")!;
    const locator = { host: "pi", sessionId: host.sessionId };
    const a = host.commitReplacementMutation({ baseRevision: host.snapshot().revision, unitId: user.id, text: "A" });
    expect(a.ok).toBe(true);
    const b = host.commitReplacementMutation({ baseRevision: host.snapshot().revision, unitId: user.id, text: "B" });
    expect(b.ok).toBe(true);
    expect(host.records().find((record) => record.kind === "user")!.units[0]!.effectiveText).toBe("B");
    expect(host.search("B", ["user"]).total).toBe(1);
    expect(host.search("original user", ["user"]).total).toBe(0);
    expect(sha(sessionFile)).toBe(before);
    const undone = host.undoReplacementMutation({ baseRevision: host.snapshot().revision, unitId: user.id });
    expect(undone.ok).toBe(true);
    expect(host.records().find((record) => record.kind === "user")!.units[0]!.effectiveText).toBe("A");
    const restored = host.restoreReplacementMutation({ baseRevision: host.snapshot().revision, unitId: user.id });
    expect(restored.ok).toBe(true);
    expect(host.records().find((record) => record.kind === "user")!.units[0]!.effectiveText).toBe("original user");
    const undoRestore = host.undoReplacementMutation({ baseRevision: host.snapshot().revision, unitId: user.id });
    expect(undoRestore.ok).toBe(true);
    expect(host.records().find((record) => record.kind === "user")!.units[0]!.effectiveText).toBe("A");

    const excluded = await host.commitContext({ locator, baseRevision: host.snapshot().revision, action: "exclude", unitIds: [user.id] });
    expect(excluded.ok).toBe(true);
    const messages = branch().flatMap((entry) => sessionEntryToContextMessages(entry));
    expect(projectModelContext({ messages, entries: branch(), atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] }).some((message) => message.role === "user")).toBe(false);
    const restoredReplacement = host.restoreReplacementMutation({ baseRevision: host.snapshot().revision, unitId: user.id });
    expect(restoredReplacement.ok).toBe(true);
    const restoredExclusion = await host.commitContext({ locator, baseRevision: host.snapshot().revision, action: "restore", unitIds: [user.id] });
    expect(restoredExclusion.ok).toBe(true);
    const visible = projectModelContext({ messages, entries: branch(), atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect((visible.find((message) => message.role === "user") as any).content).toBe("original user");

    const originalBranch = branch();
    setBranch([{ id: "u", type: "message", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "original user" } }]);
    expect(new PiContextEditorHost(ctx).records().find((record) => record.kind === "user")!.units[0]!.effectiveText).toBe("original user");
    setBranch(originalBranch);
  });
});
