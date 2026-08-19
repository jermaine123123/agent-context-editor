import { DEFAULT_ENABLED_KINDS } from "./filter.js";
import { atomState, stateForAtoms, stateWithAtom, stateWithViewFilter } from "./state.js";
import type {
  AtomKind,
  ContextAtom,
  ContextEditorStateV1,
  ContextViewFilterState,
} from "./types.js";
import { ATOM_KINDS } from "./types.js";
import { createPiText, detectPiLocale, type PiLocale, type PiText } from "./locale.js";
import { atomMatchesSearchScope, type ContextSearchScope } from "./shared-core/index.js";

const PAGE_SIZE = 50;
const MAX_EDITOR_CHARS = 100_000;
/** The subset of ExtensionUIContext that Pi Desktop supports natively. */
export interface DesktopEditorUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
  editor(title: string, prefill?: string): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  notify(message: string, type?: "info" | "warning" | "error"): void;
}

export interface DesktopEditorDeps {
  ui: DesktopEditorUI;
  atoms: readonly ContextAtom[];
  initialState: ContextEditorStateV1 | undefined;
  sourceLeafId?: string;
  locale?: PiLocale;
  persistState: (state: ContextEditorStateV1) => void;
}

interface DesktopFilterState {
  enabledKinds: Set<AtomKind>;
  query: string;
  showHidden: boolean;
  /** Search-only scope; intentionally not part of the persisted V1 filter. */
  searchScope: ContextSearchScope;
}

function compactPreview(text: PiText, value: string, maxChars = 96): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return text.emptyContent();
  return compact.length > maxChars ? `${compact.slice(0, maxChars - 1)}…` : compact;
}

function viewLabel(text: PiText, viewState: ReturnType<typeof atomState>["viewState"]): string {
  return text.viewState(viewState);
}

function atomOption(text: PiText, atom: ContextAtom, index: number, state: ContextEditorStateV1): string {
  const current = atomState(state, atom);
  const meta = [
    text.atomKind(atom.kind),
    atom.toolName,
    viewLabel(text, current.viewState),
    `${atom.approxTokens} tok`,
  ]
    .filter(Boolean)
    .join(" · ");
  return `#${String(index + 1).padStart(4, "0")} · ${meta} · ${compactPreview(text, atom.text)}`;
}

function detailText(text: PiText, atom: ContextAtom): string {
  const metadata = text.detail({
    kind: atom.kind,
    entryId: atom.sourceRef.entryId,
    blockIndex: atom.sourceRef.blockIndex,
    turnId: atom.turnId,
    approxTokens: atom.approxTokens,
    toolCallId: atom.toolCallId,
    toolName: atom.toolName,
  });
  const body = atom.text || text.emptyContent();
  const limited = body.length > MAX_EDITOR_CHARS
    ? `${body.slice(0, MAX_EDITOR_CHARS)}\n\n${text.truncatedDetail(MAX_EDITOR_CHARS)}`
    : body;
  return `${metadata}\n\n${limited}`;
}

function visibleAtoms(
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1,
  filter: DesktopFilterState,
): ContextAtom[] {
  const query = filter.query.trim().toLocaleLowerCase();
  return atoms.filter((atom) => {
    if (!filter.enabledKinds.has(atom.kind)) return false;
    if (query) {
      if (!atomMatchesSearchScope(atom.kind, filter.searchScope)) return false;
      const haystack = [atom.toolName ?? "", atom.text].join(" ").toLocaleLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return filter.showHidden || atomState(state, atom).viewState !== "hide";
  });
}

function stateSummary(atoms: readonly ContextAtom[], state: ContextEditorStateV1): { hidden: number } {
  let hidden = 0;
  for (const atom of atoms) {
    const current = atomState(state, atom);
    if (current.viewState === "hide") hidden += 1;
  }
  return { hidden };
}

async function viewAtom(text: PiText, ui: DesktopEditorUI, atom: ContextAtom): Promise<void> {
  const prefill = detailText(text, atom);
  const edited = await ui.editor(text.readOnlyTitle(atom.kind), prefill);
  if (edited !== undefined && edited !== prefill) {
    ui.notify(text.readOnlyChanged(), "info");
  }
}

async function editAtom(
  text: PiText,
  deps: DesktopEditorDeps,
  state: ContextEditorStateV1,
  atom: ContextAtom,
): Promise<ContextEditorStateV1> {
  let currentState = state;
  while (true) {
    const current = atomState(currentState, atom);
    const viewAction = text.viewAction(current.viewState === "hide");
    const options = [text.showContent, viewAction, text.back];

    const selected = await deps.ui.select(
      `${text.atomKind(atom.kind)} · ${atom.toolName ?? text.messageLabel()}`,
      options,
    );
    if (selected === undefined || selected === text.back) return currentState;

    if (selected === text.showContent) {
      await viewAtom(text, deps.ui, atom);
      continue;
    }

    if (selected === viewAction) {
      currentState = stateWithAtom(
        currentState,
        atom,
        { viewState: current.viewState === "hide" ? "show" : "hide" },
        deps.sourceLeafId,
      );
      deps.persistState(currentState);
      continue;
    }

  }
}

async function browseAtoms(
  text: PiText,
  deps: DesktopEditorDeps,
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1,
  filter: DesktopFilterState,
): Promise<ContextEditorStateV1> {
  let currentState = state;
  while (true) {
    const matches = visibleAtoms(atoms, currentState, filter);
    if (matches.length === 0) {
      deps.ui.notify(text.noMatches(), "info");
      return currentState;
    }

    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    let page = pageCount - 1;
    while (true) {
      const start = page * PAGE_SIZE;
      const pageAtoms = matches.slice(start, start + PAGE_SIZE);
      const atomOptions = pageAtoms.map((atom, index) => atomOption(text, atom, start + index, currentState));
      const optionToAtom = new Map(pageAtoms.map((atom, index) => [
        atomOption(text, atom, start + index, currentState),
        atom,
      ]));
      const options = [...atomOptions];
      if (page > 0) options.push(text.older);
      if (page < pageCount - 1) options.push(text.newer);
      options.push(text.back);

      const selected = await deps.ui.select(
        text.page(start + 1, start + pageAtoms.length, matches.length),
        options,
      );
      if (selected === undefined || selected === text.back) return currentState;
      if (selected === text.older) {
        page = Math.max(0, page - 1);
        continue;
      }
      if (selected === text.newer) {
        page = Math.min(pageCount - 1, page + 1);
        continue;
      }

      const atom = optionToAtom.get(selected);
      if (!atom) continue;
      currentState = await editAtom(text, deps, currentState, atom);
      break;
    }
  }
}

async function editTypeFilter(text: PiText, ui: DesktopEditorUI, filter: DesktopFilterState): Promise<void> {
  while (true) {
    const options = ATOM_KINDS.map((kind) =>
      `${filter.enabledKinds.has(kind) ? "✓" : "○"} ${text.atomKind(kind)}`,
    );
    const optionToKind = new Map(ATOM_KINDS.map((kind) => [
      `${filter.enabledKinds.has(kind) ? "✓" : "○"} ${text.atomKind(kind)}`,
      kind,
    ]));
    options.push(text.done);
    const selected = await ui.select(text.typeFilterTitle(), options);
    if (selected === undefined || selected === text.done) return;
    const kind = optionToKind.get(selected);
    if (!kind) continue;
    if (filter.enabledKinds.has(kind)) filter.enabledKinds.delete(kind);
    else filter.enabledKinds.add(kind);
  }
}

async function resetState(
  text: PiText,
  deps: DesktopEditorDeps,
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1,
): Promise<ContextEditorStateV1> {
  const summary = stateSummary(atoms, state);
  if (summary.hidden === 0) {
    deps.ui.notify(text.resetEmpty(), "info");
    return state;
  }
  const confirmed = await deps.ui.confirm(
    text.resetTitle(),
    text.resetMessage(summary.hidden),
  );
  if (!confirmed) return state;
  const reset = stateForAtoms(undefined, atoms, deps.sourceLeafId);
  const nextState: ContextEditorStateV1 = {
    ...reset,
    updatedAt: new Date().toISOString(),
  };
  deps.persistState(nextState);
  return nextState;
}

function persistFilterState(
  deps: DesktopEditorDeps,
  state: ContextEditorStateV1,
  filter: DesktopFilterState,
): ContextEditorStateV1 {
  const enabledKinds = [...filter.enabledKinds].sort();
  const previous = state.viewFilter;
  if (
    previous &&
    previous.query === filter.query &&
    previous.showHidden === filter.showHidden &&
    previous.enabledKinds.length === enabledKinds.length &&
    previous.enabledKinds.every((kind, index) => kind === enabledKinds[index])
  ) {
    return state;
  }
  const nextFilter: ContextViewFilterState = {
    enabledKinds,
    query: filter.query,
    showHidden: filter.showHidden,
  };
  const nextState = stateWithViewFilter(state, nextFilter, deps.sourceLeafId);
  deps.persistState(nextState);
  return nextState;
}

/** Run the Pi Desktop-compatible, dialog-only Context Editor. */
export async function runDesktopContextEditor(deps: DesktopEditorDeps): Promise<void> {
  const text = createPiText(deps.locale ?? detectPiLocale());
  let state = stateForAtoms(deps.initialState, deps.atoms, deps.sourceLeafId);
  let changed = false;
  const flowDeps: DesktopEditorDeps = {
    ...deps,
    persistState: (nextState) => {
      changed = true;
      deps.persistState(nextState);
    },
  };
  const savedFilter = state.viewFilter;
  const filter: DesktopFilterState = {
    enabledKinds: new Set(savedFilter?.enabledKinds ?? DEFAULT_ENABLED_KINDS),
    query: savedFilter?.query ?? "",
    showHidden: savedFilter?.showHidden ?? false,
    searchScope: "dialogue",
  };

  while (true) {
    const matches = visibleAtoms(deps.atoms, state, filter);
    const summary = stateSummary(deps.atoms, state);
    const searchLabel = filter.query ? `${text.locale === "zh" ? "：" : ": "}${compactPreview(text, filter.query, 24)}` : "";
    const typeCount = `${filter.enabledKinds.size}/${ATOM_KINDS.length}`;
    const selected = await deps.ui.select("Pi Context Editor", [
      text.browseSummary(matches.length, deps.atoms.length),
      `${text.search}${searchLabel}`,
      text.searchScope(filter.searchScope),
      text.typeSummary(filter.enabledKinds.size, ATOM_KINDS.length),
      text.hiddenSummary(summary.hidden, filter.showHidden),
      text.resetSummary(summary.hidden),
      text.close,
    ]);
    if (selected === undefined || selected === text.close) {
      if (changed) {
        deps.ui.notify(
          text.savedMessage(summary.hidden),
          "info",
        );
      }
      return;
    }

    if (selected.startsWith(text.browse)) {
      state = await browseAtoms(text, flowDeps, deps.atoms, state, filter);
      continue;
    }
    if (selected.startsWith(text.search)) {
      const query = await flowDeps.ui.input(text.searchTitle(), filter.query || text.searchPlaceholder());
      if (query !== undefined) {
        filter.query = query.trim();
        state = persistFilterState(flowDeps, state, filter);
      }
      continue;
    }
    if (selected === text.searchScope(filter.searchScope)) {
      filter.searchScope = filter.searchScope === "dialogue" ? "all" : "dialogue";
      continue;
    }
    if (selected.startsWith(text.types)) {
      await editTypeFilter(text, flowDeps.ui, filter);
      state = persistFilterState(flowDeps, state, filter);
      continue;
    }
    if (selected.startsWith(text.hidden)) {
      filter.showHidden = !filter.showHidden;
      state = persistFilterState(flowDeps, state, filter);
      continue;
    }
    if (selected.startsWith(text.reset)) {
      const previousState = state;
      state = await resetState(text, flowDeps, deps.atoms, state);
      if (state !== previousState) {
        filter.enabledKinds = new Set(DEFAULT_ENABLED_KINDS);
        filter.query = "";
        filter.showHidden = false;
        filter.searchScope = "dialogue";
        state = persistFilterState(flowDeps, state, filter);
      }
    }
  }
}
