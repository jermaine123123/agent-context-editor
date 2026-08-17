import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { normalizeSessionEntries } from "../adapters/pi-extension/src/normalize.js";

function messageEntry(id: string, message: unknown, parentId: string | null): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: new Date(1_700_000_000_000 + id.length).toISOString(),
    message: message as never,
  };
}

describe("normalizeSessionEntries", () => {
  it("splits user, assistant blocks, tool call, tool output, and compaction", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", {
        role: "user",
        content: "读取 README",
        timestamp: 1_700_000_000_000,
      }, null),
      messageEntry("a1", {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "先查看文件", thinkingSignature: "sig-1" },
          { type: "text", text: "我来读取。", textSignature: "text-1" },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
        ],
        api: "openai-completions",
        provider: "openai",
        model: "test",
        usage: {},
        stopReason: "toolUse",
        timestamp: 1_700_000_000_100,
      }, "u1"),
      messageEntry("t1", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "# README" }],
        isError: false,
        timestamp: 1_700_000_000_200,
      }, "a1"),
      {
        type: "compaction",
        id: "c1",
        parentId: "t1",
        timestamp: new Date(1_700_000_000_300).toISOString(),
        summary: "已有一个 README 读取步骤。",
        firstKeptEntryId: "t1",
        tokensBefore: 100,
      },
    ];

    const atoms = normalizeSessionEntries(entries);
    expect(atoms.map((atom) => atom.kind)).toEqual([
      "user",
      "reasoning",
      "assistant_text",
      "tool_call",
      "tool_output",
      "summary",
    ]);
    expect(atoms[0]?.sourceRef.entryId).toBe("u1");
    expect(atoms[1]?.hasSignature).toBe(true);
    expect(atoms[3]?.toolCallId).toBe("call-1");
    expect(atoms[4]?.toolName).toBe("read");
    expect(atoms[5]?.text).toContain("README");
  });

  it("keeps fingerprints stable for the same message block", () => {
    const entries: SessionEntry[] = [
      messageEntry("u1", { role: "user", content: "same", timestamp: 10 }, null),
    ];
    const first = normalizeSessionEntries(entries);
    const second = normalizeSessionEntries(entries);
    expect(first[0]?.fingerprint).toBe(second[0]?.fingerprint);
    expect(first[0]?.id).toBe(second[0]?.id);
  });
});
