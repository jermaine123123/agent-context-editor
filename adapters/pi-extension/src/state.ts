import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { ATOM_KINDS, type AtomKind, type ContextAtom, type ContextEditorStateV1, type ContextViewFilterState, type ViewState } from "./types.js";

export const STATE_ENTRY_TYPE = "context-editor-state";

export function emptyState(sourceLeafId?: string): ContextEditorStateV1 {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    ...(sourceLeafId ? { sourceLeafId } : {}),
    items: {},
  };
}

function isViewState(value: unknown): value is ViewState {
  return value === "show" || value === "collapse" || value === "hide";
}

function isAtomKind(value: unknown): value is AtomKind {
  return typeof value === "string" && (ATOM_KINDS as readonly string[]).includes(value);
}

function parseViewFilter(value: unknown): ContextViewFilterState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.enabledKinds) || typeof record.query !== "string" || typeof record.showHidden !== "boolean") {
    return undefined;
  }
  const enabledKinds = record.enabledKinds.filter(isAtomKind);
  return { enabledKinds, query: record.query, showHidden: record.showHidden };
}

function parseState(value: unknown): ContextEditorStateV1 | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.updatedAt !== "string") return undefined;
  if (!record.items || typeof record.items !== "object") return undefined;

  const items: ContextEditorStateV1["items"] = {};
  for (const [id, raw] of Object.entries(record.items as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.fingerprint === "string" && isViewState(item.viewState)) {
      items[id] = {
        fingerprint: item.fingerprint,
        viewState: item.viewState,
        contextState: "keep",
      };
    }
  }

  return {
    version: 1,
    updatedAt: record.updatedAt,
    ...(typeof record.sourceLeafId === "string" ? { sourceLeafId: record.sourceLeafId } : {}),
    items,
    ...(parseViewFilter(record.viewFilter) ? { viewFilter: parseViewFilter(record.viewFilter) } : {}),
  };
}

export function readLatestState(entries: readonly SessionEntry[]): ContextEditorStateV1 | undefined {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry?.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
    const state = parseState(entry.data);
    if (state) return state;
  }
  return undefined;
}

export function atomState(
  state: ContextEditorStateV1 | undefined,
  atom: ContextAtom,
): { viewState: ViewState; contextState: "keep" } {
  const item = state?.items[atom.id];
  if (!item || item.fingerprint !== atom.fingerprint) {
    return { viewState: "show", contextState: "keep" };
  }
  return { viewState: item.viewState, contextState: "keep" };
}

export function stateWithAtom(
  state: ContextEditorStateV1 | undefined,
  atom: ContextAtom,
  patch: Partial<Pick<ContextEditorStateV1["items"][string], "viewState" | "contextState">>,
  sourceLeafId?: string,
): ContextEditorStateV1 {
  const previous = atomState(state, atom);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...(sourceLeafId ? { sourceLeafId } : state?.sourceLeafId ? { sourceLeafId: state.sourceLeafId } : {}),
    items: {
      ...(state?.items ?? {}),
      [atom.id]: {
        fingerprint: atom.fingerprint,
        viewState: patch.viewState ?? previous.viewState,
        contextState: "keep",
      },
    },
    ...(state?.viewFilter ? { viewFilter: state.viewFilter } : {}),
  };
}

export function stateForAtoms(
  state: ContextEditorStateV1 | undefined,
  atoms: readonly ContextAtom[],
  sourceLeafId?: string,
): ContextEditorStateV1 {
  const items: ContextEditorStateV1["items"] = {};
  for (const atom of atoms) {
    const current = state?.items[atom.id];
    if (current?.fingerprint === atom.fingerprint) items[atom.id] = { ...current, contextState: "keep" };
  }
  return {
    version: 1,
    updatedAt: state?.updatedAt ?? new Date(0).toISOString(),
    ...(sourceLeafId ? { sourceLeafId } : state?.sourceLeafId ? { sourceLeafId: state.sourceLeafId } : {}),
    items,
    ...(state?.viewFilter ? { viewFilter: state.viewFilter } : {}),
  };
}

export function stateWithViewFilter(
  state: ContextEditorStateV1 | undefined,
  viewFilter: ContextViewFilterState,
  sourceLeafId?: string,
): ContextEditorStateV1 {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    ...(sourceLeafId ? { sourceLeafId } : state?.sourceLeafId ? { sourceLeafId: state.sourceLeafId } : {}),
    items: Object.fromEntries(Object.entries(state?.items ?? {}).map(([id, item]) => [id, { ...item, contextState: "keep" }])),
    viewFilter: {
      enabledKinds: [...viewFilter.enabledKinds],
      query: viewFilter.query,
      showHidden: viewFilter.showHidden,
    },
  };
}
