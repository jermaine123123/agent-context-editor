import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { fingerprintBlock } from "../adapters/pi-extension/src/fingerprint.js";
import { contentToSearchText } from "../adapters/pi-extension/src/normalize.js";
import { buildToolOutputActions, projectToolOutputs, TOOL_OUTPUT_TOMBSTONE } from "../adapters/pi-extension/src/projection.js";
import { stateWithAtom } from "../adapters/pi-extension/src/state.js";
import type { ContextEditorStateV1 } from "../adapters/pi-extension/src/types.js";

describe("tool output projection", () => {
  it("replaces only the body and preserves the tool result envelope", () => {
    const message = {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: "large output" }],
      isError: false,
      timestamp: 100,
    } as ToolResultMessage;
    const expectedFingerprint = fingerprintBlock(
      "tool_output",
      100,
      "call-1",
      contentToSearchText(message.content),
    );
    const result = projectToolOutputs([message], [
      { toolCallId: "call-1", expectedFingerprint, action: "replace" },
    ]);
    const projected = result.messages[0] as ToolResultMessage;
    expect(contentToSearchText(projected.content)).toBe(TOOL_OUTPUT_TOMBSTONE);
    expect(projected.toolCallId).toBe("call-1");
    expect(result.appliedToolCallIds).toEqual(["call-1"]);
  });

  it("fails open when another extension changed the output", () => {
    const message = {
      role: "toolResult",
      toolCallId: "call-2",
      toolName: "bash",
      content: [{ type: "text", text: "changed" }],
      isError: false,
      timestamp: 200,
    } as ToolResultMessage;
    const result = projectToolOutputs([message], [
      { toolCallId: "call-2", expectedFingerprint: "wrong", action: "replace" },
    ]);
    expect(result.messages[0]).toBe(message);
    expect(result.skippedToolCallIds).toEqual(["call-2"]);
  });

  it("treats its own tombstone as an idempotent projection", () => {
    const message = {
      role: "toolResult",
      toolCallId: "call-tombstone",
      toolName: "read",
      content: [{ type: "text", text: TOOL_OUTPUT_TOMBSTONE }],
      isError: false,
      timestamp: 300,
    } as ToolResultMessage;
    const result = projectToolOutputs([message], [
      { toolCallId: "call-tombstone", expectedFingerprint: "old-fingerprint", action: "replace" },
    ]);
    expect(result.messages[0]).toBe(message);
    expect(result.appliedToolCallIds).toEqual(["call-tombstone"]);
    expect(result.skippedToolCallIds).toEqual([]);
  });

  it("skips a Tool Output whose matching Tool Call is unavailable", () => {
    const output = {
      id: "orphan-output",
      sourceRef: { entryId: "orphan-output", blockIndex: 0 },
      kind: "tool_output",
      turnId: "old-turn",
      timestamp: 10,
      text: "orphan",
      fingerprint: "orphan-fingerprint",
      approxTokens: 2,
      toolCallId: "missing-call",
    } as const;
    const state = stateWithAtom(undefined, output, { contextState: "replace" });
    expect(buildToolOutputActions([output], state)).toEqual([]);
  });

  it("protects the two most recent user turns and error output", () => {
    const atoms = [
      { id: "u1", sourceRef: { entryId: "u1", blockIndex: 0 }, kind: "user", turnId: "u1", timestamp: 1, text: "one", fingerprint: "u1", approxTokens: 1 },
      { id: "c1", sourceRef: { entryId: "c1", blockIndex: 0 }, kind: "tool_call", turnId: "u1", timestamp: 1, text: "read {}", fingerprint: "c1", approxTokens: 1, toolCallId: "call-1", toolName: "read" },
      { id: "t1", sourceRef: { entryId: "t1", blockIndex: 0 }, kind: "tool_output", turnId: "u1", timestamp: 2, text: "old", fingerprint: "t1", approxTokens: 1, toolCallId: "call-1", isError: false },
      { id: "u2", sourceRef: { entryId: "u2", blockIndex: 0 }, kind: "user", turnId: "u2", timestamp: 3, text: "two", fingerprint: "u2", approxTokens: 1 },
      { id: "c2", sourceRef: { entryId: "c2", blockIndex: 0 }, kind: "tool_call", turnId: "u2", timestamp: 3, text: "read {}", fingerprint: "c2", approxTokens: 1, toolCallId: "call-2", toolName: "read" },
      { id: "t2", sourceRef: { entryId: "t2", blockIndex: 0 }, kind: "tool_output", turnId: "u2", timestamp: 4, text: "recent", fingerprint: "t2", approxTokens: 1, toolCallId: "call-2", isError: false },
      { id: "u3", sourceRef: { entryId: "u3", blockIndex: 0 }, kind: "user", turnId: "u3", timestamp: 5, text: "three", fingerprint: "u3", approxTokens: 1 },
      { id: "c3", sourceRef: { entryId: "c3", blockIndex: 0 }, kind: "tool_call", turnId: "u3", timestamp: 5, text: "read {}", fingerprint: "c3", approxTokens: 1, toolCallId: "call-3", toolName: "read" },
      { id: "t3", sourceRef: { entryId: "t3", blockIndex: 0 }, kind: "tool_output", turnId: "u3", timestamp: 6, text: "recent", fingerprint: "t3", approxTokens: 1, toolCallId: "call-3", isError: false },
      { id: "c4", sourceRef: { entryId: "c4", blockIndex: 0 }, kind: "tool_call", turnId: "u0", timestamp: 6, text: "read {}", fingerprint: "c4", approxTokens: 1, toolCallId: "call-4", toolName: "read" },
      { id: "t4", sourceRef: { entryId: "t4", blockIndex: 0 }, kind: "tool_output", turnId: "u0", timestamp: 7, text: "error", fingerprint: "t4", approxTokens: 1, toolCallId: "call-4", isError: true },
    ] as const;
    let state: ContextEditorStateV1 | undefined;
    for (const atom of atoms.filter((item) => item.kind === "tool_output")) {
      state = stateWithAtom(state, atom, { contextState: "replace" });
    }
    expect(buildToolOutputActions(atoms, state).map((action) => action.toolCallId)).toEqual(["call-1"]);
  });
});
