import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionEntryToContextMessages, type SessionEntry, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import contextEditorExtension from "../adapters/pi-extension/src/index.js";
import { PiContextEditorHost } from "../adapters/pi-extension/src/host.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function invalidProjectionContext() {
  const dir = mkdtempSync(join(tmpdir(), "pi-projection-hook-"));
  dirs.push(dir);
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, "canonical\n", "utf8");
  writeFileSync(sessionFile + ".context-editor.projection.json", "{not-json", "utf8");
  let aborted = 0;
  const ctx = {
    mode: "tui",
    hasUI: false,
    isIdle: () => true,
    abort: () => { aborted += 1; },
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => "session-hook",
      getBranch: () => [
        {
          id: "u-hook",
          type: "message",
          parentId: null,
          timestamp: new Date(1).toISOString(),
          message: { role: "user", content: "hook" },
        },
      ],
      getLeafId: () => "u-hook",
      buildContextEntries: () => [],
    },
  } as unknown as ExtensionContext;
  return { ctx, getAborted: () => aborted };
}

function validProjectionContext() {
  const dir = mkdtempSync(join(tmpdir(), "pi-projection-restore-"));
  dirs.push(dir);
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, "canonical\n", "utf8");
  let branch: SessionEntry[] = [
    {
      id: "u-hook",
      type: "message",
      parentId: null,
      timestamp: new Date(1).toISOString(),
      message: { role: "user", content: "RESTORE_PROBE_USER" },
    } as SessionEntry,
    {
      id: "a-hook",
      type: "message",
      parentId: "u-hook",
      timestamp: new Date(2).toISOString(),
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "RESTORE_PROBE_REASONING", thinkingSignature: "sig-restore" },
          { type: "text", text: "RESTORE_PROBE_ANSWER" },
          { type: "toolCall", id: "restore-call", name: "read", arguments: { path: "README.md" }, thoughtSignature: "sig-call" },
        ],
      },
    } as SessionEntry,
    {
      id: "t-hook",
      type: "message",
      parentId: "a-hook",
      timestamp: new Date(3).toISOString(),
      message: {
        role: "toolResult",
        toolCallId: "restore-call",
        toolName: "read",
        content: [{ type: "text", text: "RESTORE_PROBE_TOOL" }],
        isError: false,
      },
    } as SessionEntry,
  ];
  const ctx = {
    mode: "tui",
    hasUI: false,
    isIdle: () => true,
    abort: () => undefined,
    sessionManager: {
      getSessionFile: () => sessionFile,
      getSessionId: () => "session-restore-hook",
      getBranch: () => branch,
      getLeafId: () => branch.at(-1)?.id ?? null,
      buildContextEntries: () => branch,
    },
  } as unknown as ExtensionContext;
  return { ctx, sessionFile, branch: () => branch };
}

function contextHandler(ctx: ExtensionContext) {
  const handlers = new Map<string, (event: any, context: ExtensionContext) => unknown>();
  const pi = {
    on: (name: string, handler: (event: any, context: ExtensionContext) => unknown) => {
      handlers.set(name, handler);
    },
    registerCommand: () => undefined,
  } as unknown as ExtensionAPI;
  contextEditorExtension(pi);
  const handler = handlers.get("context");
  if (!handler) throw new Error("context hook was not registered");
  return handler;
}

describe("Pi projection hooks", () => {
  it("aborts before a provider request when the projection sidecar is corrupt", async () => {
    const { ctx, getAborted } = invalidProjectionContext();
    const handler = contextHandler(ctx);
    let providerRequests = 0;
    const result = await handler({ type: "context", messages: [] }, ctx) as { messages?: unknown[] } | undefined;
    if (result?.messages && getAborted() === 0) providerRequests += 1;
    expect(getAborted()).toBe(1);
    expect(providerRequests).toBe(0);
  });

  it("cancels compaction when projection integrity cannot be proven", async () => {
    const { ctx, getAborted } = invalidProjectionContext();
    const handlers = new Map<string, (event: unknown, context: ExtensionContext) => unknown>();
    const pi = {
      on: (name: string, handler: (event: unknown, context: ExtensionContext) => unknown) => {
        handlers.set(name, handler);
      },
      registerCommand: () => undefined,
    } as unknown as ExtensionAPI;
    contextEditorExtension(pi);
    const handler = handlers.get("session_before_compact");
    if (!handler) throw new Error("compact hook was not registered");
    const result = await handler({
      type: "session_before_compact",
      branchEntries: [],
      preparation: {
        firstKeptEntryId: "missing",
        turnPrefixMessages: [],
      },
    }, ctx) as { cancel?: boolean } | undefined;
    expect(result?.cancel).toBe(true);
    expect(getAborted()).toBe(0);
  });

  it("restores a full message and a partial assistant chain from the previous projected input", async () => {
    const { ctx, branch } = validProjectionContext();
    const host = new PiContextEditorHost(ctx);
    const handler = contextHandler(ctx);
    const fullMessages = branch().flatMap((entry) => sessionEntryToContextMessages(entry));
    const user = host.records().find((record) => record.kind === "user")?.units.find((unit) => unit.kind === "user");
    if (!user) throw new Error("user unit missing");

    const excludedUser = await host.commitContext({
      locator: { host: "pi", sessionId: host.sessionId },
      baseRevision: host.snapshot().revision,
      action: "exclude",
      unitIds: [user.id],
    });
    expect(excludedUser.ok).toBe(true);
    const excludedUserMessages = (await handler({ type: "context", messages: fullMessages }, ctx) as { messages: any[] }).messages;
    expect(JSON.stringify(excludedUserMessages)).not.toContain("RESTORE_PROBE_USER");

    const restoredUser = await host.commitContext({
      locator: { host: "pi", sessionId: host.sessionId },
      baseRevision: host.snapshot().revision,
      action: "restore",
      unitIds: [user.id],
    });
    expect(restoredUser.ok).toBe(true);
    const restoredUserMessages = (await handler({ type: "context", messages: excludedUserMessages }, ctx) as { messages: any[] }).messages;
    expect(JSON.stringify(restoredUserMessages)).toBe(JSON.stringify(fullMessages));

    const reasoning = host.records().find((record) => record.kind === "ai")?.units.find((unit) => unit.kind === "reasoning");
    if (!reasoning) throw new Error("reasoning unit missing");
    const excludedReasoning = await host.commitContext({
      locator: { host: "pi", sessionId: host.sessionId },
      baseRevision: host.snapshot().revision,
      action: "exclude",
      unitIds: [reasoning.id],
    });
    expect(excludedReasoning.ok).toBe(true);
    const excludedReasoningMessages = (await handler({ type: "context", messages: fullMessages }, ctx) as { messages: any[] }).messages;
    expect(JSON.stringify(excludedReasoningMessages)).not.toContain("RESTORE_PROBE_REASONING");
    expect(JSON.stringify(excludedReasoningMessages)).toContain("RESTORE_PROBE_ANSWER");
    expect(JSON.stringify(excludedReasoningMessages)).not.toContain("RESTORE_PROBE_TOOL");

    const restoredReasoning = await host.commitContext({
      locator: { host: "pi", sessionId: host.sessionId },
      baseRevision: host.snapshot().revision,
      action: "restore",
      unitIds: [reasoning.id],
    });
    expect(restoredReasoning.ok).toBe(true);
    const restoredReasoningMessages = (await handler({ type: "context", messages: excludedReasoningMessages }, ctx) as { messages: any[] }).messages;
    expect(JSON.stringify(restoredReasoningMessages)).toBe(JSON.stringify(fullMessages));
  });
});
