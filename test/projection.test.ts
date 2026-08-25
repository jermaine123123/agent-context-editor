import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { normalizeSessionEntries } from "../adapters/pi-extension/src/normalize.js";
import {
  projectRecords,
  reduceProjectionStates,
  selectProjectionTargets,
  type ContextAtom,
  type ContextProjectionEventV1,
} from "../packages/context-editor-core/src/index.js";
import { projectModelContext, projectionOverlapsEntryIds, ProjectionAlignmentError } from "../adapters/pi-extension/src/projection-hook.js";

function fixture() {
  const entries = [
    { type: "message", id: "u1", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "保留用户" } },
    {
      type: "message",
      id: "a1",
      parentId: "u1",
      timestamp: new Date(2).toISOString(),
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "签名思考", thinkingSignature: "sig-1" },
          { type: "text", text: "最终回答" },
          { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" }, thoughtSignature: "sig-call" },
        ],
      },
    },
    {
      type: "message",
      id: "t1",
      parentId: "a1",
      timestamp: new Date(3).toISOString(),
      message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "工具输出" }], isError: false },
    },
  ];
  const atoms = normalizeSessionEntries(entries);
  return { entries, atoms, records: projectRecords(atoms) };
}

function event(atoms: readonly ContextAtom[], action: "exclude" | "restore", ids: readonly string[]): ContextProjectionEventV1 {
  const target = action === "exclude" ? "exclude" : "include";
  return {
    version: 1,
    transactionId: "tx-" + action + "-" + ids.join("-"),
    createdAt: new Date().toISOString(),
    baseRevision: "rev",
    action,
    changes: ids.map((id) => {
      const atom = atoms.find((candidate) => candidate.id === id);
      if (!atom) throw new Error("missing atom " + id);
      return { atomId: atom.id, sourceRef: atom.sourceRef, fingerprint: atom.fingerprint, before: target === "exclude" ? "include" : "exclude", after: target };
    }),
  };
}

describe("context projection core", () => {
  it("keeps signed reasoning and tool call/result closure while leaving final answer independent", () => {
    const { records } = fixture();
    const reasoning = records.find((record) => record.kind === "ai")?.units.find((unit) => unit.kind === "reasoning");
    const tool = records.find((record) => record.kind === "tool")?.units.find((unit) => unit.kind === "tool");
    const answer = records.find((record) => record.kind === "ai")?.units.find((unit) => unit.kind === "answer");
    if (!reasoning || !tool || !answer) throw new Error("fixture units missing");
    const selection = selectProjectionTargets(records, [reasoning.id]);
    expect(selection.effectiveUnitIds).toContain(reasoning.id);
    expect(selection.effectiveUnitIds).toContain(tool.id);
    expect(selection.effectiveUnitIds).not.toContain(answer.id);
    expect(selection.autoExpandedUnitIds).toContain(tool.id);
  });

  it("reduces events idempotently and marks changed fingerprints unavailable", () => {
    const { atoms } = fixture();
    const user = atoms.find((atom) => atom.kind === "user");
    if (!user) throw new Error("user atom missing");
    const first = event(atoms, "exclude", [user.id]);
    const states = reduceProjectionStates(atoms, [first, first]);
    expect(states.get(user.id)).toBe("exclude");
    const changed = { ...first, changes: [{ ...first.changes[0]!, fingerprint: "changed" }] };
    expect(reduceProjectionStates(atoms, [changed]).get(user.id)).toBe("unavailable");
  });

  it("fails summary overlap checks closed on an active fingerprint mismatch", () => {
    const { atoms } = fixture();
    const user = atoms.find((atom) => atom.kind === "user");
    if (!user) throw new Error("user atom missing");
    const changed = event(atoms, "exclude", [user.id]);
    changed.changes[0] = { ...changed.changes[0]!, fingerprint: "changed" };
    expect(() => projectionOverlapsEntryIds(new Set([user.sourceRef.entryId]), atoms, [changed]))
      .toThrow("active projection is unavailable");
  });

  it("removes a full user message and paired tool chain without mutating source messages", () => {
    const { entries, atoms } = fixture();
    const user = atoms.find((atom) => atom.kind === "user");
    const reasoning = atoms.find((atom) => atom.kind === "reasoning");
    const toolAtoms = atoms.filter((atom) => atom.kind === "tool_call" || atom.kind === "tool_output");
    if (!user || !reasoning || toolAtoms.length !== 2) throw new Error("fixture atoms missing");
    const projectionEvents = [
      event(atoms, "exclude", [user.id]),
      event(atoms, "exclude", [reasoning.id, ...toolAtoms.map((atom) => atom.id)]),
    ];
    const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry as never));
    const before = JSON.stringify(messages);
    const projected = projectModelContext({ messages, entries, atoms, projectionEvents });
    expect(projected.some((message) => message.role === "user")).toBe(false);
    const assistant = projected.find((message) => message.role === "assistant") as { content?: unknown[] } | undefined;
    expect(assistant?.content).toHaveLength(1);
    const restored = projectModelContext({ messages, entries, atoms, projectionEvents: [...projectionEvents, event(atoms, "restore", [user.id, reasoning.id, ...toolAtoms.map((atom) => atom.id)])] });
    expect(JSON.stringify(restored)).toBe(JSON.stringify(messages));

    expect((assistant?.content?.[0] as { type?: string } | undefined)?.type).toBe("text");
    expect(projected.some((message) => message.role === "toolResult")).toBe(false);
    expect(JSON.stringify(messages)).toBe(before);
  });

  it("restores from the previous projected message array", () => {
    const { entries, atoms } = fixture();
    const user = atoms.find((atom) => atom.kind === "user");
    const reasoning = atoms.find((atom) => atom.kind === "reasoning");
    const toolAtoms = atoms.filter((atom) => atom.kind === "tool_call" || atom.kind === "tool_output");
    if (!user || !reasoning || toolAtoms.length !== 2) throw new Error("fixture atoms missing");
    const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry as never));
    const excluded = [event(atoms, "exclude", [user.id]), event(atoms, "exclude", [reasoning.id, ...toolAtoms.map((atom) => atom.id)])];
    const projected = projectModelContext({ messages, entries, atoms, projectionEvents: excluded });
    const restored = projectModelContext({ messages: projected, entries, atoms, projectionEvents: [...excluded, event(atoms, "restore", [user.id, reasoning.id, ...toolAtoms.map((atom) => atom.id)])] });
    expect(JSON.stringify(restored)).toBe(JSON.stringify(messages));
  });

  it("fails closed when an excluded active message cannot be aligned", () => {
    const { entries, atoms } = fixture();
    const user = atoms.find((atom) => atom.kind === "user");
    if (!user) throw new Error("user atom missing");
    const messages = entries.slice(1).flatMap((entry) => sessionEntryToContextMessages(entry as never));
    expect(() => projectModelContext({ messages, entries, atoms, projectionEvents: [event(atoms, "exclude", [user.id])] }))
      .toThrow(ProjectionAlignmentError);
  });
});
