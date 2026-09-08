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


function linkedFixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-answer-link-")); dirs.push(dir);
  const sessionFile = join(dir, "session.jsonl"); writeFileSync(sessionFile, "canonical session\n", "utf8");
  const branch: any[] = [
    { id: "u-link", type: "message", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "linked user" } },
    { id: "a-link", type: "message", parentId: "u-link", timestamp: new Date(2).toISOString(), message: { role: "assistant", content: [
      { type: "thinking", thinking: "LINKED_REASONING", thinkingSignature: "sig-reasoning" },
      { type: "text", text: "original answer" },
      { type: "toolCall", id: "linked-call", name: "read", arguments: { path: "README.md" }, thoughtSignature: "sig-call" },
    ] } },
    { id: "t-link", type: "message", parentId: "a-link", timestamp: new Date(3).toISOString(), message: { role: "toolResult", toolCallId: "linked-call", toolName: "read", content: [{ type: "text", text: "LINKED_TOOL_RESULT" }], isError: false } },
  ];
  const ctx = { mode: "tui", isIdle: () => true, sessionManager: { getSessionFile: () => sessionFile, getSessionId: () => "answer-link-session", getBranch: () => branch, getLeafId: () => branch.at(-1)?.id ?? null, buildContextEntries: () => branch } } as never;
  return { ctx, sessionFile, branch: () => branch };
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

  it("commits Answer + linked reasoning exclusion atomically and reconstructs the chain on undo", async () => {
    const { ctx, sessionFile, branch } = linkedFixture();
    const before = sha(sessionFile);
    const host = new PiContextEditorHost(ctx);
    const locator = { host: "pi", sessionId: host.sessionId };
    const answer = host.records().find((record) => record.kind === "ai")!.units.find((unit) => unit.kind === "answer")!;
    const reasoning = host.records().find((record) => record.kind === "ai")!.units.find((unit) => unit.kind === "reasoning")!;
    const preview = host.previewReplacementMutation({
      baseRevision: host.snapshot().revision,
      operationId: "answer-link",
      unitId: answer.id,
      text: "edited answer",
      excludeAssociatedReasoning: true,
    });
    expect(preview.associatedReasoningUnitIds).toContain(reasoning.id);
    expect(preview.newlyExcludedUnitIds).toContain(reasoning.id);
    const unlinkedPreview = host.previewReplacementMutation({
      baseRevision: preview.baseRevision,
      operationId: 'answer-link-off',
      unitId: answer.id,
      text: 'edited answer',
      excludeAssociatedReasoning: false,
    });
    expect(unlinkedPreview.associatedReasoningUnitIds).toContain(reasoning.id);
    expect(unlinkedPreview.newlyExcludedUnitIds).toEqual([]);
    const committed = host.commitReplacementMutation({
      baseRevision: preview.baseRevision,
      operationId: "answer-link",
      unitId: answer.id,
      text: "edited answer",
      excludeAssociatedReasoning: true,
      confirmedUnitIds: preview.effectiveUnitIds,
    });
    expect(committed.ok).toBe(true);
    expect(sha(sessionFile)).toBe(before);
    const canonical = branch().flatMap((entry) => sessionEntryToContextMessages(entry));
    const projected = projectModelContext({ messages: canonical, entries: branch(), atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect(JSON.stringify(projected)).toContain("edited answer");
    expect(JSON.stringify(projected)).not.toContain("LINKED_REASONING");
    expect(JSON.stringify(projected)).not.toContain("LINKED_TOOL_RESULT");

    const restoredAnswer = host.restoreReplacementMutation({ baseRevision: host.snapshot().revision, operationId: "answer-restore", unitId: answer.id });
    expect(restoredAnswer.ok).toBe(true);
    const afterRestore = projectModelContext({ messages: canonical, entries: branch(), atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect(JSON.stringify(afterRestore)).toContain("original answer");
    expect(JSON.stringify(afterRestore)).not.toContain("LINKED_REASONING");
    expect(JSON.stringify(afterRestore)).not.toContain("LINKED_TOOL");

    const undoRestore = host.undoReplacementMutation({ baseRevision: host.snapshot().revision, operationId: "answer-undo-restore", unitId: answer.id });
    expect(undoRestore.ok).toBe(true);
    const undoLink = host.undoReplacementMutation({ baseRevision: host.snapshot().revision, operationId: "answer-undo-link", unitId: answer.id });
    expect(undoLink.ok).toBe(true);
    const fullyRestored = projectModelContext({ messages: projected, entries: branch(), atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect(JSON.stringify(fullyRestored)).toContain("original answer");
    expect(JSON.stringify(fullyRestored)).toContain("LINKED_REASONING");
    expect(JSON.stringify(fullyRestored)).toContain("LINKED_TOOL");
    expect(JSON.stringify(fullyRestored)).toContain("LINKED_TOOL_RESULT");
    expect(sha(sessionFile)).toBe(before);
    expect(locator.sessionId).toBe(host.sessionId);
  });

  it("does not restore a reasoning unit that was excluded before the linked operation", async () => {
    const { ctx, sessionFile, branch } = linkedFixture();
    const before = sha(sessionFile);
    const host = new PiContextEditorHost(ctx);
    const locator = { host: "pi", sessionId: host.sessionId };
    const ai = host.records().find((record) => record.kind === "ai")!;
    const answer = ai.units.find((unit) => unit.kind === "answer")!;
    const reasoning = ai.units.find((unit) => unit.kind === "reasoning")!;
    const excluded = await host.commitContext({ locator, baseRevision: host.snapshot().revision, action: "exclude", unitIds: [reasoning.id] });
    expect(excluded.ok).toBe(true);
    const preview = host.previewReplacementMutation({ baseRevision: host.snapshot().revision, operationId: "answer-link-preexcluded", unitId: answer.id, text: "edited answer", excludeAssociatedReasoning: true });
    expect(preview.alreadyExcludedUnitIds).toContain(reasoning.id);
    const committed = host.commitReplacementMutation({ baseRevision: preview.baseRevision, operationId: "answer-link-preexcluded", unitId: answer.id, text: "edited answer", excludeAssociatedReasoning: true, confirmedUnitIds: preview.effectiveUnitIds });
    expect(committed.ok).toBe(true);
    const projected = projectModelContext({ messages: branch().flatMap((entry) => sessionEntryToContextMessages(entry)), entries: branch(), atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    const undone = host.undoReplacementMutation({ baseRevision: host.snapshot().revision, operationId: "answer-undo-preexcluded", unitId: answer.id });
    expect(undone.ok).toBe(true);
    const afterUndo = projectModelContext({ messages: projected, entries: branch(), atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect(JSON.stringify(afterUndo)).not.toContain("LINKED_REASONING");
    expect(JSON.stringify(afterUndo)).toContain("original answer");
    expect(sha(sessionFile)).toBe(before);
  });
});
