import { describe, expect, it } from "vitest";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { normalizeSessionEntries } from "../adapters/pi-extension/src/normalize.js";
import { projectModelContext, ProjectionAlignmentError } from "../adapters/pi-extension/src/projection-hook.js";
import { projectRecords, reduceReplacementStates, type ContextAtom, type ContextReplacementEventV1 } from "../packages/context-editor-core/src/index.js";

function atom(id: string, kind: ContextAtom["kind"], entryId: string, blockIndex: number, text: string, extra: Partial<ContextAtom> = {}): ContextAtom {
  return { id, kind, sourceRef: { entryId, blockIndex }, turnId: "turn", timestamp: blockIndex, text, fingerprint: "fp-" + id, approxTokens: 1, ...extra };
}

function replacementEvent(unit: { id: string; kind: "user" | "answer"; atoms: ContextAtom[] }, text: string, beforeText: string | null = null): ContextReplacementEventV1 {
  return { schemaVersion: 1, type: "replacement", action: "replace", eventId: "replace-1", unitId: unit.id, unitKind: unit.kind, atomRefs: unit.atoms.map((candidate) => ({ atomId: candidate.id, sourceRef: candidate.sourceRef, fingerprint: candidate.fingerprint })), beforeText, afterText: text, baseRevision: "rev", createdAt: new Date().toISOString() };
}

describe("context replacement projection", () => {
  it("projects effective text and replays LIFO replacement history", () => {
    const atoms = [atom("u", "user", "u1", 0, "original")];
    const records = projectRecords(atoms);
    const unit = records[0]!.units[0]!;
    const first = replacementEvent({ ...unit, kind: "user" }, "A");
    const second = { ...replacementEvent({ ...unit, kind: "user" }, "B", "A"), eventId: "replace-2" } as ContextReplacementEventV1;
    const undo = { schemaVersion: 1, type: "replacement", action: "undo", eventId: "undo-2", unitId: unit.id, undoOf: "replace-2", baseRevision: "rev", createdAt: new Date().toISOString() } as const;
    const states = reduceReplacementStates([unit], [first, second, undo]);
    const projected = projectRecords(atoms, undefined, undefined, states);
    expect(projected[0]!.units[0]!.effectiveText).toBe("A");
    expect(projected[0]!.units[0]!.canUndoReplacement).toBe(true);
  });

  it("rejects mismatched unit kinds and repeated message ambiguity", () => {
    const atoms = [atom("u", "user", "u1", 0, "same")];
    const unit = projectRecords(atoms)[0]!.units[0]!;
    const mismatched = { ...replacementEvent({ ...unit, kind: "user" }, "edited"), unitKind: "answer" } as ContextReplacementEventV1;
    expect(reduceReplacementStates([unit], [mismatched]).get(unit.id)?.replacementState).toBe("unavailable");

    const entries: any[] = [
      { id: "u1", type: "message", message: { role: "user", content: "same" } },
      { id: "u2", type: "message", message: { role: "user", content: "same" } },
    ];
    const repeatedAtoms = normalizeSessionEntries(entries);
    const firstUnit = projectRecords(repeatedAtoms)[0]!.units[0]!;
    const repeatedEvent = replacementEvent({ ...firstUnit, kind: "user" }, "edited");
    const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry as never));
    expect(() => projectModelContext({ messages, entries, atoms: repeatedAtoms, projectionEvents: [repeatedEvent] })).toThrow(ProjectionAlignmentError);
  });

  it("replaces a text-only User array exactly once", () => {
    const entries: any[] = [
      { id: "u-array", type: "message", message: { role: "user", content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] } },
    ];
    const atoms = normalizeSessionEntries(entries);
    const unit = projectRecords(atoms)[0]!.units[0]!;
    const event = replacementEvent({ ...unit, kind: "user" }, "edited");
    const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry as never));
    const projected = projectModelContext({ messages, entries, atoms, projectionEvents: [event] });
    expect((projected[0] as any)?.content).toEqual([{ type: "text", text: "edited" }]);
  });

  it("replaces a multi-entry Answer at its final text block", () => {
    const entries: any[] = [
      { id: "u", type: "message", message: { role: "user", content: "question" } },
      { id: "a1", type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "reason" }, { type: "text", text: "first" }] } },
      { id: "a2", type: "message", message: { role: "assistant", content: [{ type: "text", text: "second" }, { type: "toolCall", id: "c", name: "read", arguments: {} }] } },
      { id: "t", type: "message", message: { role: "toolResult", toolCallId: "c", toolName: "read", content: [{ type: "text", text: "tool" }] } },
    ];
    const atoms = normalizeSessionEntries(entries);
    const answer = projectRecords(atoms).find((record) => record.kind === "ai")!.units.find((unit) => unit.kind === "answer")!;
    const event = replacementEvent({ ...answer, kind: "answer" }, "edited");
    const messages = entries.flatMap((entry) => sessionEntryToContextMessages(entry as never));
    const projected = projectModelContext({ messages, entries, atoms, projectionEvents: [event] });
    const assistants = projected.filter((message) => message.role === "assistant") as any[];
    expect(assistants[0].content).toEqual([{ type: "thinking", thinking: "reason" }]);
    expect(assistants[1].content[0].text).toBe("edited");
    expect(assistants[1].content[1].type).toBe("toolCall");
  });
});
