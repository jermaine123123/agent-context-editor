import { describe, expect, it } from "vitest";
import { normalizeSessionEntries } from "../adapters/pi-extension/src/normalize.js";
import { CLIENT_UNIT_KINDS, migrateEnabledKindsToUnits } from "../adapters/deepseek-harness/client-state.js";
import { projectRecords as projectDeepSeekRecords, searchRecords as searchDeepSeekRecords, normalizeSessionEvents } from "../adapters/deepseek-harness/core.js";
import { CONTEXT_EDITOR_UNIT_KINDS, normalizeContextEditorPrefs, projectRecords as projectPiRecords, searchRecords as searchPiRecords } from "../packages/context-editor-core/src/index.js";

describe("cross-host record/unit contract", () => {
  it("keeps the canonical unit filter taxonomy and legacy AI migration aligned", () => {
    expect([...CONTEXT_EDITOR_UNIT_KINDS]).toEqual([...CLIENT_UNIT_KINDS]);
    expect(normalizeContextEditorPrefs({ version: 2, enabledKinds: ["ai"], showHidden: false }).enabledUnitKinds)
      .toEqual(migrateEnabledKindsToUnits(["ai"]));
  });
  it("projects the same logical turn shape, search totals, and independent AI units", () => {
    const piEntries = [
      { type: "message", id: "u1", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "请检查部署" } },
      { type: "message", id: "a1", parentId: "u1", timestamp: new Date(2).toISOString(), message: { role: "assistant", content: [
        { type: "thinking", thinking: "部署思考" },
        { type: "text", text: "部署完成" },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
      ] } },
      { type: "message", id: "t1", parentId: "a1", timestamp: new Date(3).toISOString(), message: { role: "toolResult", toolCallId: "call-1", toolName: "read", content: [{ type: "text", text: "部署输出" }], isError: false } },
    ];
    const deepSeekEvents = [
      { seq: 0, time: 1, type: "user/message", data: { content: [{ type: "text", text: "请检查部署" }] } },
      { seq: 1, time: 2, type: "assistant/message", data: { turn: 1, message: { content: [
        { type: "reasoning", text: "部署思考" },
        { type: "text", text: "部署完成" },
        { type: "tool-call", id: "call-1", name: "read", arguments: "{\"path\":\"README.md\"}" },
      ] } } },
      { seq: 2, time: 2, type: "tool/call", data: { turn: 1, callId: "call-1", name: "read", arguments: "{\"path\":\"README.md\"}" } },
      { seq: 3, time: 3, type: "tool/result", data: { turn: 1, message: { source: { kind: "tool", callId: "call-1" }, content: [{ type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "部署输出" }], isError: false }] } } },
    ];

    const piAtoms = normalizeSessionEntries(piEntries);
    const piRecords = projectPiRecords(piAtoms);
    const deepSeekAtoms = normalizeSessionEvents({ id: "contract", createdAt: 1, cwd: "test" }, deepSeekEvents).atoms;
    const deepSeekRecords = projectDeepSeekRecords(deepSeekAtoms);

    const shape = (records: readonly { kind: string; units: readonly { kind: string }[] }[]) => records.map((record) => [
      record.kind,
      record.units.map((unit) => unit.kind),
    ]);
    expect(shape(piRecords)).toEqual(shape(deepSeekRecords));
    expect(piRecords.find((record) => record.kind === "tool")?.atoms.some((atom) => atom.kind === "tool_output")).toBe(true);
    expect(deepSeekRecords.find((record) => record.kind === "tool")?.atoms.some((atom) => atom.kind === "tool_output")).toBe(true);

    const piMatches = searchPiRecords(piRecords, "部署", new Set(["user", "ai", "tool"]));
    const deepSeekMatches = searchDeepSeekRecords(deepSeekRecords, "部署", ["user", "ai", "tool"]);
    expect(piMatches.map((match) => [match.recordKind, match.unitKind, match.occurrenceCount])).toEqual(
      deepSeekMatches.map((match) => [match.recordKind, match.unitKind, match.occurrenceCount]),
    );
    expect(piMatches.map((match) => match.unitKind)).toEqual(["user", "answer"]);
    const piFullMatches = searchPiRecords(piRecords, "部署", new Set(["user", "ai", "tool"]), "all");
    const deepSeekFullMatches = searchDeepSeekRecords(deepSeekRecords, "部署", ["user", "ai", "tool"], "all");
    expect(piFullMatches.map((match) => [match.recordKind, match.unitKind, match.occurrenceCount])).toEqual(
      deepSeekFullMatches.map((match) => [match.recordKind, match.unitKind, match.occurrenceCount]),
    );

    const piReasoning = piRecords.find((record) => record.kind === "ai")!.units.find((unit) => unit.kind === "reasoning")!;
    const deepSeekReasoning = deepSeekRecords.find((record) => record.kind === "ai")!.units.find((unit) => unit.kind === "reasoning")!;
    const piStates = new Map(piReasoning.atomIds.map((id) => [id, "hide" as const]));
    const deepSeekStates = new Map(deepSeekReasoning.atomIds.map((id) => [id, "hide" as const]));
    expect(projectPiRecords(piAtoms, piStates).find((record) => record.kind === "ai")?.units.map((unit) => [unit.kind, unit.viewState])).toEqual([
      ["reasoning", "hide"],
      ["answer", "show"],
    ]);
    expect(projectDeepSeekRecords(deepSeekAtoms, deepSeekStates).find((record) => record.kind === "ai")?.units.map((unit) => [unit.kind, unit.viewState])).toEqual([
      ["reasoning", "hide"],
      ["answer", "show"],
    ]);
  });
});
