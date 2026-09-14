import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionEntryToContextMessages, type ExtensionAPI, type ExtensionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import contextEditorExtension from "../adapters/pi-extension/src/index.js";
import { PiContextEditorHost } from "../adapters/pi-extension/src/host.js";
import {
  inferPiShadowedEntryIds,
  nativeCompactionPreparationId,
  nativeCompactionRefs,
  readNativeCompactionSidecar,
  reconcileNativeCompactionEntry,
  upsertNativeCompactionEvidence,
} from "../adapters/pi-extension/src/native-compaction-sidecar.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function handlersFor(piContext: ExtensionContext) {
  const handlers = new Map<string, (event: any, context: ExtensionContext) => unknown>();
  const pi = {
    on: (name: string, handler: (event: any, context: ExtensionContext) => unknown) => handlers.set(name, handler),
    registerCommand: () => undefined,
  } as unknown as ExtensionAPI;
  contextEditorExtension(pi);
  return handlers;
}

function testContext() {
  const dir = mkdtempSync(join(tmpdir(), "pi-native-compaction-"));
  dirs.push(dir);
  const sessionFile = join(dir, "session.jsonl");
  writeFileSync(sessionFile, "canonical\n", "utf8");
  const branch: SessionEntry[] = [
    {
      id: "u-native",
      type: "message",
      parentId: null,
      timestamp: new Date(1).toISOString(),
      message: { role: "user", content: "keep this task" },
    } as SessionEntry,
    {
      id: "a-native",
      type: "message",
      parentId: "u-native",
      timestamp: new Date(2).toISOString(),
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "remove this reasoning", thinkingSignature: "sig-native" },
          { type: "toolCall", id: "read-native", name: "read", arguments: { path: "excluded.md" }, thoughtSignature: "sig-call" },
        ],
      },
    } as SessionEntry,
    {
      id: "t-native",
      type: "message",
      parentId: "a-native",
      timestamp: new Date(3).toISOString(),
      message: {
        role: "toolResult",
        toolCallId: "read-native",
        toolName: "read",
        content: [{ type: "text", text: "excluded file contents" }],
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
      getSessionId: () => "session-native",
      getBranch: () => branch,
      getLeafId: () => branch.at(-1)?.id ?? null,
      buildContextEntries: () => branch,
    },
  } as unknown as ExtensionContext;
  return { ctx, sessionFile, branch };
}

describe("Pi native compaction bridge", () => {
  it("persists preparation evidence and reconciles it only after the native entry exists", () => {
    const { sessionFile } = testContext();
    const preparationId = nativeCompactionPreparationId({
      sessionId: "session-native",
      firstKeptEntryId: "kept-native",
      shadowedEntryIds: ["u-native", "a-native"],
      preparedRevision: "rev-1",
      sourceFingerprint: "fp-1",
    });
    upsertNativeCompactionEvidence(sessionFile, "session-native", {
      schemaVersion: 1,
      sessionId: "session-native",
      preparationId,
      firstKeptEntryId: "kept-native",
      shadowedEntryIds: ["u-native", "a-native"],
      checkpointEntryId: "parent-native",
      preparedRevision: "rev-1",
      sourceFingerprint: "fp-1",
      reason: "manual",
      committed: false,
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    });
    const pending = readNativeCompactionSidecar(sessionFile, "session-native");
    expect(pending.integrity).toBe("ok");
    expect(nativeCompactionRefs(pending.document)[0]?.committed).toBe(false);

    const committed = reconcileNativeCompactionEntry(
      [
        { id: "u-native", type: "message" },
        { id: "kept-native", type: "message" },
        { id: "compact-native", type: "compaction", parentId: "u-native", firstKeptEntryId: "kept-native" },
      ],
      { id: "compact-native", parentId: "u-native", firstKeptEntryId: "kept-native" },
      pending.document.events[0]!,
    );
    expect(committed.committed).toBe(true);
    expect(committed.compactionId).toBe("compact-native");
    expect(committed.checkpointEntryId).toBe("u-native");
    upsertNativeCompactionEvidence(sessionFile, "session-native", committed);
    const after = readNativeCompactionSidecar(sessionFile, "session-native");
    expect(nativeCompactionRefs(after.document)[0]?.committed).toBeUndefined();
    expect(JSON.parse(readFileSync(after.path, "utf8")).events).toHaveLength(1);
  });

  it("projects both compact segments and file operations before Pi sends the native summary request", async () => {
    const { ctx, sessionFile, branch } = testContext();
    const host = new PiContextEditorHost(ctx);
    const excluded = host.records().flatMap(record => record.kind === "ai" ? record.units : []).map(unit => unit.id);
    expect(excluded.length).toBeGreaterThan(0);
    const mutation = await host.commitContext({
      locator: { host: "pi", sessionId: host.sessionId },
      baseRevision: host.snapshot().revision,
      action: "exclude",
      unitIds: excluded,
    });
    expect(mutation.ok).toBe(true);

    const handlers = handlersFor(ctx);
    const handler = handlers.get("session_before_compact");
    if (!handler) throw new Error("session_before_compact hook missing");
    const messages = branch.flatMap(entry => sessionEntryToContextMessages(entry));
    const preparation = {
      firstKeptEntryId: "t-native",
      messagesToSummarize: messages.slice(0, 2),
      turnPrefixMessages: messages.slice(1, 2),
      retainedTail: messages.slice(2),
      isSplitTurn: true,
      tokensBefore: 100,
      fileOps: { read: new Set(["excluded.md"]), written: new Set<string>(), edited: new Set<string>() },
      settings: { enabled: true, reserveTokens: 100, keepRecentTokens: 20 },
    };
    const result = await handler({
      type: "session_before_compact",
      branchEntries: branch,
      preparation,
      reason: "manual",
      willRetry: false,
      signal: new AbortController().signal,
    }, ctx) as { cancel?: boolean } | undefined;
    expect(result?.cancel).toBeUndefined();
    expect(preparation.messagesToSummarize).toHaveLength(1);
    expect(JSON.stringify(preparation.messagesToSummarize)).toContain("keep this task");
    expect(preparation.turnPrefixMessages).toHaveLength(0);
    expect([...preparation.fileOps.read]).toEqual([]);
    const sidecar = readNativeCompactionSidecar(sessionFile, host.sessionId);
    expect(sidecar.integrity).toBe("ok");
    expect(sidecar.document.events).toHaveLength(1);
    expect(sidecar.document.events[0]?.committed).toBe(false);
    expect(inferPiShadowedEntryIds(branch, "t-native", true)).toEqual(["u-native", "a-native"]);

    const compactHandler = handlers.get("session_compact");
    if (!compactHandler) throw new Error("session_compact hook missing");
    await compactHandler({
      type: "session_compact",
      compactionEntry: { id: "compact-native", parentId: "a-native", firstKeptEntryId: "t-native" },
      fromExtension: false,
      reason: "manual",
      willRetry: false,
    }, ctx);
    const committed = readNativeCompactionSidecar(sessionFile, host.sessionId);
    expect(committed.document.events[0]?.committed).toBe(true);
    expect(committed.document.events[0]?.checkpointEntryId).toBe("a-native");
  });

  it("reconciles pending evidence after Pi tree navigation", async () => {
    const { ctx, sessionFile, branch } = testContext();
    const preparationId = nativeCompactionPreparationId({
      sessionId: "session-native",
      firstKeptEntryId: "t-native",
      shadowedEntryIds: ["u-native"],
      preparedRevision: "rev-tree",
      sourceFingerprint: "fp-tree",
    });
    upsertNativeCompactionEvidence(sessionFile, "session-native", {
      schemaVersion: 1,
      sessionId: "session-native",
      preparationId,
      firstKeptEntryId: "t-native",
      shadowedEntryIds: ["u-native"],
      preparedRevision: "rev-tree",
      sourceFingerprint: "fp-tree",
      reason: "manual",
      committed: false,
      createdAt: new Date(1).toISOString(),
      updatedAt: new Date(1).toISOString(),
    });
    branch.push({ id: "compact-tree", type: "compaction", parentId: "a-native", firstKeptEntryId: "t-native" } as SessionEntry);
    const handlers = handlersFor(ctx);
    const handler = handlers.get("session_tree");
    if (!handler) throw new Error("session_tree hook missing");
    await handler({ type: "session_tree", newLeafId: "compact-tree", oldLeafId: "t-native" }, ctx);
    const after = readNativeCompactionSidecar(sessionFile, "session-native");
    expect(after.document.events[0]?.committed).toBe(true);
    expect(after.document.events[0]?.checkpointEntryId).toBe("a-native");
  });
  it("cancels native compaction when identical messages map to multiple opaque entries", async () => {
    const { ctx, branch } = testContext();
    branch.push({ ...branch[0]!, id: "u-native-duplicate", parentId: null });
    const host = new PiContextEditorHost(ctx);
    const excluded = host.records().flatMap(record => record.kind === "ai" ? record.units : []).map(unit => unit.id);
    await host.commitContext({
      locator: { host: "pi", sessionId: host.sessionId },
      baseRevision: host.snapshot().revision,
      action: "exclude",
      unitIds: excluded,
    });
    const handlers = handlersFor(ctx);
    const handler = handlers.get("session_before_compact");
    if (!handler) throw new Error("session_before_compact hook missing");
    const preparation = {
      firstKeptEntryId: "t-native",
      messagesToSummarize: sessionEntryToContextMessages(branch[0]!),
      turnPrefixMessages: [],
      retainedTail: [],
      isSplitTurn: false,
      tokensBefore: 100,
      fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
      settings: { enabled: true, reserveTokens: 100, keepRecentTokens: 20 },
    };
    const result = await handler({
      type: "session_before_compact",
      branchEntries: branch,
      preparation,
      reason: "manual",
      willRetry: false,
      signal: new AbortController().signal,
    }, ctx) as { cancel?: boolean } | undefined;
    expect(result?.cancel).toBe(true);
  });
  it("gates restoration and undo until the user returns through /tree", () => {
    const host = Object.create(PiContextEditorHost.prototype) as {
      snapshot: () => unknown;
      nativeRecoveryRequired: (operationId?: string) => unknown;
    };
    host.snapshot = () => ({
      condensations: [{
        operationId: "selective-native",
        coverage: {
          status: "full",
          restoreMode: "checkpoint",
          coveredSourceRootSeqs: [],
          uncoveredSourceRootSeqs: [],
          nativeCompactions: [],
          checkpointCompactionId: "compact-native",
          checkpointEntryId: "before-native",
        },
      }],
    });
    expect(host.nativeRecoveryRequired("selective-native")).toMatchObject({
      ok: false,
      restoreRequired: true,
      restoreMode: "checkpoint",
      checkpointCompactionId: "compact-native",
      checkpointEntryId: "before-native",
    });
  });});