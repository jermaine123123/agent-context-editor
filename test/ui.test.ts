import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { normalizeSessionEntries } from "../adapters/pi-extension/src/normalize.js";
import { ContextEditorComponent } from "../adapters/pi-extension/src/ui.js";
import { projectRecords, type ContextEditorPrefsV2, type ContextEditorSnapshot, type ContextMutationResult } from "../packages/context-editor-core/src/index.js";

function fakeTui(): TUI {
  return {
    terminal: { rows: 16, columns: 80 } as never,
    requestRender: () => undefined,
  } as unknown as TUI;
}

function fakeTheme(): Theme {
  return {
    fg: (color: string, text: string) => color === "warning" ? `\u001b[33m${text}\u001b[39m` : text,
    bg: (_color: string, text: string) => text,
  } as unknown as Theme;
}

function snapshotFor(records: ReturnType<typeof projectRecords>, revision: string): ContextEditorSnapshot {
  return {
    revision,
    sourceLeafId: `leaf-${revision}`,
    records: records.map((record) => ({
      id: record.id,
      kind: record.kind,
      viewState: record.viewState,
      mutable: record.mutable,
      units: record.units.map((unit) => ({
        id: unit.id,
        recordId: unit.recordId,
        kind: unit.kind,
        atomIds: unit.atomIds,
        viewState: unit.viewState,
        mutable: unit.mutable,
      })),
    })),
    canUndo: false,
    legacyStateFound: false,
  };
}

describe("ContextEditorComponent", () => {
  it("renders units, searches, and hides one unit without changing atoms", () => {
    const atoms = normalizeSessionEntries([
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp: new Date(10).toISOString(),
        message: { role: "user", content: "保留目标", timestamp: 10 } as never,
      },
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: new Date(20).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "先保留思考" }, { type: "text", text: "保留 assistant answer" }],
          timestamp: 20,
        } as never,
      },
    ]);
    const records = projectRecords(atoms);
    const snapshot: ContextEditorSnapshot = {
      revision: "rev-1",
      sourceLeafId: "leaf-1",
      records: records.map((record) => ({
        id: record.id,
        kind: record.kind,
        viewState: record.viewState,
        mutable: record.mutable,
        units: record.units.map((unit) => ({
          id: unit.id,
          recordId: unit.recordId,
          kind: unit.kind,
          atomIds: unit.atomIds,
          viewState: unit.viewState,
          mutable: unit.mutable,
        })),
      })),
      canUndo: false,
      legacyStateFound: false,
    };
    const prefs: ContextEditorPrefsV2 = { version: 2, enabledKinds: ["user", "ai", "tool"], showHidden: false };
    let currentSnapshot = snapshot;
    let currentRecords = records;
    let mutationCount = 0;
    let lastMutation: { baseRevision: string; action: "hide" | "restore" | "reset"; unitIds?: readonly string[] } | undefined;
    const mutate = (input: { baseRevision: string; action: "hide" | "restore" | "reset"; unitIds?: readonly string[] }): ContextMutationResult => {
      mutationCount += 1;
      lastMutation = input;
      return { ok: true, snapshot: currentSnapshot, eventId: input.action };
    };
    const component = new ContextEditorComponent(fakeTui(), fakeTheme(), currentRecords, currentSnapshot, prefs, {
      loadRecords: () => currentRecords,
      loadSnapshot: () => currentSnapshot,
      mutate,
      undo: () => ({ ok: true, snapshot: currentSnapshot }),
      persistPrefs: () => undefined,
      notify: () => undefined,
      confirm: async () => true,
    }, () => undefined);

    expect(component.render(80).join("\n")).toContain("Pi Context Editor");
    component.handleInput("/");
    for (const character of "保留") component.handleInput(character);
    component.handleInput("\r");
    expect(mutationCount).toBe(0);
    expect(component.render(80).join("\n")).toContain("保留");
    component.handleInput("a");
    component.handleInput("h");
    expect(mutationCount).toBe(1);
    expect(lastMutation?.unitIds).toEqual(["user:u1#user", "ai:a1#answer"]);
    component.handleInput("r");
    expect(mutationCount).toBe(2);
    expect(lastMutation?.action).toBe("restore");
    expect(atoms.find((atom) => atom.text === "保留目标")?.text).toBe("保留目标");

    component.handleInput("?");
    expect(component.render(80).join("\n")).toContain("Enter");
    component.handleInput("\u001b");
  });

  it("wraps the complete answer and pages through long expanded content", () => {
    const answer = Array.from({ length: 24 }, (_, index) => `answer-line-${String(index + 1).padStart(2, "0")}`).join("\n");
    const atoms = normalizeSessionEntries([
      {
        type: "message",
        id: "u-long",
        parentId: null,
        timestamp: new Date(10).toISOString(),
        message: { role: "user", content: "展开长回答", timestamp: 10 } as never,
      },
      {
        type: "message",
        id: "a-long",
        parentId: "u-long",
        timestamp: new Date(20).toISOString(),
        message: { role: "assistant", content: [{ type: "text", text: answer }], timestamp: 20 } as never,
      },
    ]);
    const records = projectRecords(atoms);
    const snapshot: ContextEditorSnapshot = {
      revision: "rev-long",
      sourceLeafId: "leaf-long",
      records: records.map((record) => ({
        id: record.id,
        kind: record.kind,
        viewState: record.viewState,
        mutable: record.mutable,
        units: record.units.map((unit) => ({
          id: unit.id,
          recordId: unit.recordId,
          kind: unit.kind,
          atomIds: unit.atomIds,
          viewState: unit.viewState,
          mutable: unit.mutable,
        })),
      })),
      canUndo: false,
      legacyStateFound: false,
    };
    const prefs: ContextEditorPrefsV2 = { version: 2, enabledKinds: ["user", "ai", "tool"], showHidden: false };
    const component = new ContextEditorComponent(fakeTui(), fakeTheme(), records, snapshot, prefs, {
      loadRecords: () => records,
      loadSnapshot: () => snapshot,
      mutate: () => ({ ok: true, snapshot }),
      undo: () => ({ ok: true, snapshot }),
      persistPrefs: () => undefined,
      notify: () => undefined,
      confirm: async () => true,
    }, () => undefined);

    component.handleInput("j");
    component.handleInput("\r");
    expect(component.render(80).join("\n")).toContain("answer-line-01");
    expect(component.render(80).join("\n")).not.toContain("answer-line-24");

    component.handleInput("\x1b[6~");
    expect(component.render(80).join("\n")).toContain("answer-line-16");
    component.handleInput("\x1b[6~");
    expect(component.render(80).join("\n")).toContain("answer-line-24");
  });

  it("keeps dialogue search as the default and lets s enable full scope", () => {
    const atoms = normalizeSessionEntries([
      {
        type: "message",
        id: "u-scope",
        parentId: null,
        timestamp: new Date(10).toISOString(),
        message: { role: "user", content: "dialogue text", timestamp: 10 } as never,
      },
      {
        type: "message",
        id: "a-scope",
        parentId: "u-scope",
        timestamp: new Date(20).toISOString(),
        message: {
          role: "assistant",
          content: [{ type: "thinking", thinking: "reasoning-secret" }, { type: "text", text: "answer text" }],
          timestamp: 20,
        } as never,
      },
    ]);
    const records = projectRecords(atoms);
    const snapshot = snapshotFor(records, "rev-scope");
    const prefs: ContextEditorPrefsV2 = { version: 2, enabledKinds: ["user", "ai", "tool"], showHidden: false };
    let persistedPrefs = 0;
    const component = new ContextEditorComponent(fakeTui(), fakeTheme(), records, snapshot, prefs, {
      loadRecords: () => records,
      loadSnapshot: () => snapshot,
      mutate: () => ({ ok: true, snapshot }),
      undo: () => ({ ok: true, snapshot }),
      persistPrefs: () => { persistedPrefs += 1; },
      notify: () => undefined,
      confirm: async () => true,
      locale: "en",
    }, () => undefined);

    component.handleInput("/");
    component.handleInput("s");
    component.handleInput("\r");
    expect(component.render(80).join("\n")).toContain("dialogue");
    component.handleInput("/");
    component.handleInput("\x7f");
    for (const character of "reasoning-secret") component.handleInput(character);
    component.handleInput("\r");
    expect(component.render(80).join("\n")).not.toContain("\u001b[33mreasoning-secret\u001b[39m");
    component.handleInput("s");
    const full = component.render(80).join("\n");
    expect(full).toContain("full");
    expect(full).toContain("reasoning-secret");
    expect(full).toContain("\u001b[33mreasoning-secret\u001b[39m");
    expect(persistedPrefs).toBe(0);
  });

  it("jumps through each occurrence and highlights the active hit", () => {
    const answer = Array.from({ length: 24 }, (_, index) => index === 19
      ? `answer-line-${String(index + 1).padStart(2, "0")} needle needle`
      : `answer-line-${String(index + 1).padStart(2, "0")}`).join("\n");
    const atoms = normalizeSessionEntries([
      {
        type: "message",
        id: "u-search",
        parentId: null,
        timestamp: new Date(10).toISOString(),
        message: { role: "user", content: "search", timestamp: 10 } as never,
      },
      {
        type: "message",
        id: "a-search",
        parentId: "u-search",
        timestamp: new Date(20).toISOString(),
        message: { role: "assistant", content: [{ type: "text", text: answer }], timestamp: 20 } as never,
      },
    ]);
    const records = projectRecords(atoms);
    const snapshot = snapshotFor(records, "rev-search");
    const prefs: ContextEditorPrefsV2 = { version: 2, enabledKinds: ["user", "ai", "tool"], showHidden: false };
    const tui = fakeTui();
    const component = new ContextEditorComponent(tui, fakeTheme(), records, snapshot, prefs, {
      loadRecords: () => records,
      loadSnapshot: () => snapshot,
      mutate: () => ({ ok: true, snapshot }),
      undo: () => ({ ok: true, snapshot }),
      persistPrefs: () => undefined,
      notify: () => undefined,
      confirm: async () => true,
    }, () => undefined);

    component.handleInput("/");
    for (const character of "needle") component.handleInput(character);
    component.handleInput("\r");
    let output = component.render(80).join("\n");
    expect(output).toContain("answer-line-20");
    expect(output).toContain("1/2");
    expect(output).toContain("\u001b[33mneedle\u001b[39m");

    component.handleInput("n");
    output = component.render(80).join("\n");
    expect(output).toContain("2/2");
    expect(output).toContain("\u001b[33mneedle\u001b[39m");
    (tui.terminal as { columns: number }).columns = 120;
    expect(component.render(120).join("\n")).toContain("\u001b[33mneedle\u001b[39m");
    component.handleInput("N");
    expect(component.render(80).join("\n")).toContain("1/2");
  });

  it("protects hidden search content until v reveals it", () => {
    const atoms = normalizeSessionEntries([
      {
        type: "message",
        id: "u-hidden",
        parentId: null,
        timestamp: new Date(10).toISOString(),
        message: { role: "user", content: "visible", timestamp: 10 } as never,
      },
      {
        type: "message",
        id: "a-hidden",
        parentId: "u-hidden",
        timestamp: new Date(20).toISOString(),
        message: { role: "assistant", content: [{ type: "text", text: "hidden-secret payload" }], timestamp: 20 } as never,
      },
    ]);
    const hiddenAtom = atoms.find((atom) => atom.text === "hidden-secret payload");
    if (!hiddenAtom) throw new Error("hidden test atom missing");
    const records = projectRecords(atoms, new Map([[hiddenAtom.id, "hide" as const]]));
    const snapshot = snapshotFor(records, "rev-hidden");
    const prefs: ContextEditorPrefsV2 = { version: 2, enabledKinds: ["user", "ai", "tool"], showHidden: false };
    const component = new ContextEditorComponent(fakeTui(), fakeTheme(), records, snapshot, prefs, {
      loadRecords: () => records,
      loadSnapshot: () => snapshot,
      mutate: () => ({ ok: true, snapshot }),
      undo: () => ({ ok: true, snapshot }),
      persistPrefs: () => undefined,
      notify: () => undefined,
      confirm: async () => true,
    }, () => undefined);

    component.handleInput("/");
    for (const character of "hidden-secret") component.handleInput(character);
    component.handleInput("\r");
    expect(component.render(80).join("\n")).not.toContain("hidden-secret payload");
    component.handleInput("v");
    const revealed = component.render(80).join("\n");
    expect(revealed).toContain("payload");
    expect(revealed).toContain("\u001b[33mhidden-secret\u001b[39m");
  });
});
