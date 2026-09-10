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

function sha(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-condensation-"));
  dirs.push(dir);
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, "canonical session\n", "utf8");
  const answer = [
    "结论：完成上下文编辑迁移。路径 E:/workspace/app/src/index.ts，命令 npm run check。",
    "事实：保留用户目标、约束、错误、待办和工具结果。",
    "细节：".repeat(80),
  ].join("\n");
  const branch: any[] = [
    { id: "entry-user", type: "message", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "请完成上下文编辑迁移并保留错误和待办。" } },
    { id: "entry-answer", type: "message", parentId: "entry-user", timestamp: new Date(2).toISOString(), message: { role: "assistant", content: [
      { type: "thinking", thinking: "先检查边界" },
      { type: "text", text: answer },
      { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
    ] } },
    { id: "entry-tool", type: "message", parentId: "entry-answer", timestamp: new Date(3).toISOString(), message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "工具结果：文件存在，错误为空。" }], isError: false } },
  ];
  const model = { provider: "fake", id: "fake-condense" };
  const ctx = {
    mode: "tui",
    model,
    isIdle: () => true,
    modelRegistry: {
      find: () => model,
      getAvailable: async () => [model],
      complete: async () => ({
        stopReason: "stop",
        content: [{ type: "text", text: "保留迁移目标、路径、命令、结果、错误与待办。" }],
      }),
    },
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => "pi-condensation-session",
      getBranch: () => branch,
      getLeafId: () => branch.at(-1)?.id ?? null,
      buildContextEntries: () => branch,
    },
  } as never;
  return { ctx, branch, sessionFile };
}

describe("Pi condensation host", () => {
  it("applies, projects idempotently, toggles summary visibility, and restores without rewriting Session", async () => {
    const { ctx, branch, sessionFile } = fixture();
    const before = sha(sessionFile);
    const host = new PiContextEditorHost(ctx);
    const locator = { host: "pi", sessionId: host.sessionId };
    const answer = host.records().find((record) => record.kind === "ai")!.units.find((unit) => unit.kind === "answer")!;
    const proposal = await host.generateCondensation({
      locator,
      baseRevision: host.snapshot().revision,
      unitIds: [answer.id],
      expandRelated: false,
    });
    expect(proposal.ok).toBe(true);
    expect(proposal.autoExpandedUnitIds).toEqual([]);
    const committed = await host.commitCondensation({
      locator,
      baseRevision: proposal.baseRevision,
      operationId: proposal.operationId,
      summary: proposal.summary,
      unitIds: [answer.id],
    });
    expect(committed.ok).toBe(true);
    const duplicate = await host.commitCondensation({ locator, baseRevision: proposal.baseRevision, operationId: proposal.operationId, summary: proposal.summary, unitIds: [answer.id] });
    expect(duplicate.eventId).toBe(committed.eventId);
    expect((host.read().projectionEvents ?? []).filter((event) => 'type' in event && event.type === "condensation" && event.action === "apply")).toHaveLength(1);
    expect(sha(sessionFile)).toBe(before);

    const canonical = branch.flatMap((entry) => sessionEntryToContextMessages(entry));
    const events = host.read().projectionEvents ?? [];
    expect(events.some((event) => "type" in event && event.type === "condensation" && event.action === "apply")).toBe(true);
    const projected = projectModelContext({ messages: canonical, entries: branch, atoms: host.read().atoms, projectionEvents: events });
    const text = JSON.stringify(projected);
    expect(text).toContain("<condensed-context>");
    expect(text).not.toContain("结论：完成上下文编辑迁移。");
    expect(text).toContain("先检查边界");
    expect(text).toContain("call-1");
    const twice = projectModelContext({ messages: projected, entries: branch, atoms: host.read().atoms, projectionEvents: events });
    expect(JSON.stringify(twice)).toBe(JSON.stringify(projected));

    const excluded = await host.commitContext({ locator, baseRevision: host.snapshot().revision, action: "exclude", condensationOperationId: proposal.operationId });
    expect(excluded.ok).toBe(true);
    const hidden = projectModelContext({ messages: canonical, entries: branch, atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect(JSON.stringify(hidden)).not.toContain("<condensed-context>");
    expect(JSON.stringify(hidden)).toContain("先检查边界");
    const restoredSummary = await host.commitContext({ locator, baseRevision: host.snapshot().revision, action: "restore", condensationOperationId: proposal.operationId });
    expect(restoredSummary.ok).toBe(true);

    const restored = await host.restoreCondensation({ locator, baseRevision: host.snapshot().revision, operationId: proposal.operationId });
    expect(restored.ok).toBe(true);
    const original = projectModelContext({ messages: canonical, entries: branch, atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect(JSON.stringify(original)).toContain("结论：完成上下文编辑迁移。");
    expect(JSON.stringify(original)).toContain("先检查边界");
    expect(JSON.stringify(original)).toContain("工具结果");
    expect(host.snapshot().condensations ?? []).toHaveLength(0);
    expect(sha(sessionFile)).toBe(before);
  });

  it("uses the effective projection when a same-entry reasoning block was excluded", async () => {
    const { ctx, branch } = fixture();
    const host = new PiContextEditorHost(ctx);
    const locator = { host: "pi", sessionId: host.sessionId };
    const ai = host.records().find((record) => record.kind === "ai")!;
    const answer = ai.units.find((unit) => unit.kind === "answer")!;
    const reasoning = ai.units.find((unit) => unit.kind === "reasoning")!;
    const excluded = await host.commitContext({ locator, baseRevision: host.snapshot().revision, action: "exclude", unitIds: [reasoning.id] });
    expect(excluded.ok).toBe(true);
    const proposal = await host.generateCondensation({ locator, baseRevision: host.snapshot().revision, unitIds: [answer.id], expandRelated: false });
    const applied = await host.commitCondensation({ locator, baseRevision: proposal.baseRevision, operationId: proposal.operationId, summary: proposal.summary, unitIds: [answer.id] });
    expect(applied.ok).toBe(true);
    const canonical = branch.flatMap((entry) => sessionEntryToContextMessages(entry));
    const projected = projectModelContext({ messages: canonical, entries: branch, atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect(JSON.stringify(projected)).not.toContain("先检查边界");
    expect(JSON.stringify(projected)).toContain("<condensed-context>");
    expect(JSON.stringify(projected)).toContain("call-1");
  });

  it("rejects a non-contiguous flattened selection", async () => {
    const { ctx } = fixture();
    const host = new PiContextEditorHost(ctx);
    const user = host.records().find((record) => record.kind === "user")!.units[0]!;
    const tool = host.records().flatMap((record) => record.units).find((unit) => unit.kind === "tool")!;
    await expect(host.generateCondensation({ locator: { host: "pi", sessionId: host.sessionId }, baseRevision: host.snapshot().revision, unitIds: [user.id, tool.id], expandRelated: false })).rejects.toThrow("CONTEXT_EDITOR_CONDENSATION_NON_CONTIGUOUS");
  });
  it("condenses DeepSeek reasoning field metadata with its answer and paired tools", async () => {
    const { ctx, branch } = fixture();
    branch[1].message.api = "openai-completions";
    branch[1].message.provider = "deepseek";
    branch[1].message.content[0].thinkingSignature = "reasoning_content";
    const host = new PiContextEditorHost(ctx);
    const locator = { host: "pi", sessionId: host.sessionId };
    const answer = host.records().flatMap(r => r.units).find(u => u.kind === "answer")!;
    const preview = await host.generateCondensation({ locator, baseRevision: host.snapshot().revision, unitIds: [answer.id], expandRelated: true });
    expect(preview.autoExpandedUnitIds.length).toBeGreaterThan(0);
    const result = await host.commitCondensation({ locator, baseRevision: preview.baseRevision, operationId: preview.operationId, summary: preview.summary, unitIds: [answer.id] });
    expect(result.ok).toBe(true);
    const projected = projectModelContext({ messages: branch.flatMap(e => sessionEntryToContextMessages(e)), entries: branch, atoms: host.read().atoms, projectionEvents: host.read().projectionEvents ?? [] });
    expect(JSON.stringify(projected)).toContain("<condensed-context>");
    expect(JSON.stringify(projected)).not.toContain("call-1");
  });
  it("still rejects actual signed reasoning", async () => {
    const { ctx, branch } = fixture();
    branch[1].message.content[0].thinkingSignature = "opaque-signature";
    const host = new PiContextEditorHost(ctx);
    const answer = host.records().flatMap(r => r.units).find(u => u.kind === "answer")!;
    await expect(host.generateCondensation({ locator: { host: "pi", sessionId: host.sessionId }, baseRevision: host.snapshot().revision, unitIds: [answer.id], expandRelated: true })).rejects.toThrow("OPAQUE_CONTENT");
  });

  it.each([false, true])("allows condensation after restoring and reopening (expandRelated=%s)", async expandRelated => {
    const { ctx } = fixture();
    const host = new PiContextEditorHost(ctx);
    const locator = { host: "pi", sessionId: host.sessionId };
    const answer = host.records().flatMap(r => r.units).find(u => u.kind === "answer")!;
    const generate = (h: PiContextEditorHost) => h.generateCondensation({ locator, baseRevision: h.snapshot().revision, unitIds: [answer.id], expandRelated });
    const preview = await generate(host);
    await host.commitCondensation({ locator, baseRevision: preview.baseRevision, operationId: preview.operationId, summary: preview.summary, unitIds: [answer.id] });
    await expect(generate(new PiContextEditorHost(ctx))).rejects.toThrow("CONDENSATION_OVERLAP");
    await host.commitContext({ locator, baseRevision: host.snapshot().revision, action: "exclude", condensationOperationId: preview.operationId });
    await expect(generate(host)).rejects.toThrow("CONDENSATION_OVERLAP");
    await host.restoreCondensation({ locator, baseRevision: host.snapshot().revision, operationId: preview.operationId });
    const reopened = new PiContextEditorHost(ctx);
    const retry = await generate(reopened);
    expect(retry.ok).toBe(true);
    expect((await reopened.commitCondensation({ locator, baseRevision: retry.baseRevision, operationId: retry.operationId, summary: retry.summary, unitIds: [answer.id] })).ok).toBe(true);
  });

});
