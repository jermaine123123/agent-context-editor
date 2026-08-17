import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENABLED_KINDS, filterAtoms } from "../adapters/pi-extension/src/filter.js";
import { normalizeSessionEntries } from "../adapters/pi-extension/src/normalize.js";
import { atomState, readLatestState, stateWithAtom, stateWithViewFilter, STATE_ENTRY_TYPE } from "../adapters/pi-extension/src/state.js";

const userEntry: SessionEntry = {
  type: "message",
  id: "u1",
  parentId: null,
  timestamp: new Date(10).toISOString(),
  message: { role: "user", content: "保留这条", timestamp: 10 } as never,
};

const assistantEntry: SessionEntry = {
  type: "message",
  id: "a1",
  parentId: "u1",
  timestamp: new Date(20).toISOString(),
  message: {
    role: "assistant",
    content: [{ type: "text", text: "assistant answer" }],
    api: "openai-completions",
    provider: "openai",
    model: "test",
    usage: {},
    stopReason: "stop",
    timestamp: 20,
  } as never,
};

describe("filter and state", () => {
  it("filters by default kinds and searches Chinese text", () => {
    const atoms = normalizeSessionEntries([userEntry, assistantEntry]);
    expect(filterAtoms(atoms, { enabledKinds: DEFAULT_ENABLED_KINDS, query: "保留" })).toHaveLength(1);
    expect(filterAtoms(atoms, { enabledKinds: new Set(["assistant_text"]), query: "assistant" })).toHaveLength(1);
  });

  it("reads the latest valid branch-local state and ignores stale fingerprints", () => {
    const atom = normalizeSessionEntries([userEntry])[0]!;
    const state = stateWithAtom(undefined, atom, { viewState: "hide" }, "leaf-1");
    const entries: SessionEntry[] = [
      {
        type: "custom",
        id: "s1",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: STATE_ENTRY_TYPE,
        data: state,
      },
    ];
    const restored = readLatestState(entries);
    expect(restored?.sourceLeafId).toBe("leaf-1");
    expect(atomState(restored, atom).viewState).toBe("hide");
    expect(atomState(restored, { ...atom, text: "changed", fingerprint: "changed" }).viewState).toBe("show");
  });

  it("migrates only V1 visual state and ignores model-context flags", () => {
    const atom = normalizeSessionEntries([userEntry])[0]!;
    const restored = readLatestState([{
      type: "custom",
      id: "s-context",
      parentId: null,
      timestamp: new Date().toISOString(),
      customType: STATE_ENTRY_TYPE,
      data: {
        version: 1,
        updatedAt: new Date().toISOString(),
        items: {
          [atom.id]: { fingerprint: atom.fingerprint, viewState: "hide", contextState: "exclude" },
        },
      },
    } as never]);
    expect(atomState(restored, atom)).toEqual({ viewState: "hide", contextState: "keep" });
  });

  it("restores optional desktop browser preferences from older-compatible V1 state", () => {
    const atom = normalizeSessionEntries([userEntry])[0]!;
    const state = stateWithViewFilter(
      stateWithAtom(undefined, atom, { viewState: "hide" }, "leaf-1"),
      { enabledKinds: ["user"], query: "保留", showHidden: true },
      "leaf-1",
    );
    const restored = readLatestState([
      {
        type: "custom",
        id: "s2",
        parentId: null,
        timestamp: new Date().toISOString(),
        customType: STATE_ENTRY_TYPE,
        data: state,
      },
    ]);
    expect(restored?.viewFilter).toEqual({ enabledKinds: ["user"], query: "保留", showHidden: true });
  });
});
