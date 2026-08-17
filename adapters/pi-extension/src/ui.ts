import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  matchesKey,
  truncateToWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import { DEFAULT_ENABLED_KINDS, filterAtoms, kindLabel, allEnabledKinds } from "./filter.js";
import { atomState, stateWithAtom, stateForAtoms } from "./state.js";
import type {
  AtomFilter,
  AtomKind,
  ContextAtom,
  ContextEditorStateV1,
  ContextState,
  ViewState,
} from "./types.js";

type PersistState = (state: ContextEditorStateV1) => void;
type ContextAction = (atom: ContextAtom, nextState: ContextState) => Promise<boolean>;

const FILTER_KEYS: Record<string, AtomKind> = {
  "1": "user",
  "2": "assistant_text",
  "3": "reasoning",
  "4": "tool_call",
  "5": "tool_output",
};

function colorForKind(kind: AtomKind): Parameters<Theme["fg"]>[0] {
  switch (kind) {
    case "user":
      return "accent";
    case "assistant_text":
      return "text";
    case "reasoning":
      return "thinkingText";
    case "tool_call":
      return "toolTitle";
    case "tool_output":
      return "toolOutput";
    case "summary":
      return "muted";
  }
}

function visiblePad(text: string, width: number): string {
  return truncateToWidth(text, Math.max(1, width), "…", true);
}

function bodyLines(text: string, width: number, maxLines: number): string[] {
  const available = Math.max(8, width - 6);
  const lines = text.split(/\r?\n/);
  const output = lines.slice(0, maxLines).map((line) => truncateToWidth(line || " ", available));
  if (lines.length > maxLines) {
    const last = output.length - 1;
    if (last >= 0) output[last] = truncateToWidth(`${output[last]} …`, available);
    else output.push("…");
  }
  return output;
}

export class ContextEditorComponent implements Component {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly atoms: readonly ContextAtom[];
  private readonly sourceLeafId: string | undefined;
  private readonly persistState: PersistState;
  private readonly contextAction: ContextAction | undefined;
  private readonly done: () => void;
  private state: ContextEditorStateV1;
  private filter: AtomFilter = {
    enabledKinds: new Set(DEFAULT_ENABLED_KINDS),
    query: "",
  };
  private selectedIndex = 0;
  private scrollOffset = 0;
  private searchMode = false;
  private expanded = new Set<string>();
  private showHidden = false;

  constructor(
    tui: TUI,
    theme: Theme,
    atoms: readonly ContextAtom[],
    initialState: ContextEditorStateV1 | undefined,
    sourceLeafId: string | undefined,
    persistState: PersistState,
    contextAction: ContextAction | undefined,
    done: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.atoms = atoms;
    this.sourceLeafId = sourceLeafId;
    this.persistState = persistState;
    this.contextAction = contextAction;
    this.done = done;
    this.state = stateForAtoms(initialState, atoms, sourceLeafId);
  }

  private visibleAtoms(): ContextAtom[] {
    return filterAtoms(this.atoms, this.filter).filter(
      (atom) => this.showHidden || atomState(this.state, atom).viewState !== "hide",
    );
  }

  private availableContentRows(): number {
    return Math.max(5, this.tui.terminal.rows - 7);
  }

  private contentRows(width: number): { atom: ContextAtom; lines: string[] }[] {
    return this.visibleAtoms().map((atom) => {
      const state = atomState(this.state, atom);
      const selected = this.visibleAtoms()[this.selectedIndex]?.id === atom.id;
      const marker = selected ? "▶" : " ";
      const stateIcon = state.viewState === "collapse" || this.expanded.has(atom.id) ? "▾" : "▸";
      const contextLabel = state.contextState === "replace" ? "ctx:replace" : undefined;
      const hiddenLabel = state.viewState === "hide" ? "view:hidden" : undefined;
      const meta = [kindLabel(atom.kind), atom.toolName, contextLabel, hiddenLabel, `${atom.approxTokens} tok`]
        .filter(Boolean)
        .join(" · ");
      const title = `${marker} ${stateIcon} ${meta}`;
      const styledTitle = this.theme.fg(colorForKind(atom.kind), title);
      const titleLine = selected
        ? this.theme.bg("selectedBg", visiblePad(styledTitle, width))
        : visiblePad(styledTitle, width);
      const lines = [titleLine];
      const isExpanded = state.viewState !== "collapse" && this.expanded.has(atom.id);
      if (isExpanded) {
        for (const line of bodyLines(atom.text, width, 8)) {
          lines.push(visiblePad(this.theme.fg("dim", `  │ ${line}`), width));
        }
      }
      return { atom, lines };
    });
  }

  private selectedAtom(): ContextAtom | undefined {
    return this.visibleAtoms()[this.selectedIndex];
  }

  private ensureSelectionVisible(width = this.tui.terminal.columns): void {
    const rows = this.contentRows(width);
    let selectedLine = 0;
    for (const row of rows) {
      if (row.atom.id === this.selectedAtom()?.id) break;
      selectedLine += row.lines.length;
    }
    const viewport = this.availableContentRows();
    if (selectedLine < this.scrollOffset) this.scrollOffset = selectedLine;
    if (selectedLine >= this.scrollOffset + viewport) this.scrollOffset = selectedLine - viewport + 1;
    this.scrollOffset = Math.max(0, this.scrollOffset);
  }

  private updateState(atom: ContextAtom, patch: { viewState?: ViewState; contextState?: ContextState }): void {
    this.state = stateWithAtom(this.state, atom, patch, this.sourceLeafId);
    this.persistState(this.state);
    this.tui.requestRender();
  }

  private resetView(): void {
    this.state = stateForAtoms(undefined, this.atoms, this.sourceLeafId);
    this.expanded.clear();
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.persistState(this.state);
    this.tui.requestRender();
  }

  private moveSelection(delta: number): void {
    const count = this.visibleAtoms().length;
    if (count === 0) return;
    this.selectedIndex = Math.max(0, Math.min(count - 1, this.selectedIndex + delta));
    this.ensureSelectionVisible();
    this.tui.requestRender();
  }

  private toggleContextState(atom: ContextAtom): void {
    if (atom.kind !== "tool_output" || !this.contextAction) return;
    const current = atomState(this.state, atom).contextState;
    const next: ContextState = current === "replace" ? "keep" : "replace";
    void this.contextAction(atom, next).then((confirmed) => {
      if (!confirmed) return;
      this.updateState(atom, { contextState: next });
    });
  }

  private toggleKind(kind: AtomKind): void {
    const next = new Set(this.filter.enabledKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    this.filter = { ...this.filter, enabledKinds: next };
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.tui.requestRender();
  }

  private handleSearchInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.searchMode = false;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "enter")) {
      this.searchMode = false;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.filter = { ...this.filter, query: this.filter.query.slice(0, -1) };
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (!data.includes("\x1b") && data !== "\r" && data !== "\n" && data.length > 0) {
      this.filter = { ...this.filter, query: this.filter.query + data };
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
    }
  }

  handleInput(data: string): void {
    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }

    if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.done();
      return;
    }
    if (data === "/" || data === "f" || data === "F") {
      this.searchMode = true;
      this.tui.requestRender();
      return;
    }
    if (data === "j" || matchesKey(data, "down")) {
      this.moveSelection(1);
      return;
    }
    if (data === "k" || matchesKey(data, "up")) {
      this.moveSelection(-1);
      return;
    }
    if (matchesKey(data, "pageDown")) {
      this.moveSelection(this.availableContentRows());
      return;
    }
    if (matchesKey(data, "pageUp")) {
      this.moveSelection(-this.availableContentRows());
      return;
    }
    if (data === "g") {
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (data === "G") {
      this.selectedIndex = Math.max(0, this.visibleAtoms().length - 1);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }
    if (data === "a" || data === "A") {
      const enabled = this.filter.enabledKinds.size === 0 || this.filter.enabledKinds.size < 6
        ? allEnabledKinds()
        : new Set(DEFAULT_ENABLED_KINDS);
      this.filter = { ...this.filter, enabledKinds: enabled };
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    if (data === "v" || data === "V") {
      this.showHidden = !this.showHidden;
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }
    const kind = FILTER_KEYS[data];
    if (kind) {
      this.toggleKind(kind);
      return;
    }

    const atom = this.selectedAtom();
    if (!atom) return;
    if (data === " " || matchesKey(data, "space")) {
      if (this.expanded.has(atom.id)) this.expanded.delete(atom.id);
      else this.expanded.add(atom.id);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }
    if (data === "h" || data === "H") {
      this.updateState(atom, { viewState: "hide" });
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.visibleAtoms().length - 1));
      this.ensureSelectionVisible();
      return;
    }
    if (data === "x" || data === "X") {
      this.toggleContextState(atom);
      return;
    }
    if (data === "r" || data === "R") {
      if (data === "R") {
        this.resetView();
      } else {
        this.updateState(atom, { viewState: "show" });
      }
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(20, width);
    const rows = this.contentRows(safeWidth);
    const content = rows.flatMap((row) => row.lines);
    const viewport = this.availableContentRows();
    const maxOffset = Math.max(0, content.length - viewport);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    const visible = content.slice(this.scrollOffset, this.scrollOffset + viewport);
    while (visible.length < viewport) visible.push("");

    const enabled = (kind: AtomKind): string =>
      this.filter.enabledKinds.has(kind) ? this.theme.fg("accent", kindLabel(kind)) : this.theme.fg("dim", kindLabel(kind));
    const title = this.theme.fg("accent", "Pi Context Editor") + this.theme.fg("dim", `  ${this.atoms.length} atoms`);
    const mode = this.searchMode
      ? this.theme.fg("warning", `Search: ${this.filter.query}▌`)
      : this.theme.fg("dim", `Search: ${this.filter.query || "(press / or f)"}`);
    const filterLine = `${enabled("user")} [1]  ${enabled("assistant_text")} [2]  ${enabled("reasoning")} [3]  ${enabled("tool_call")} [4]  ${enabled("tool_output")} [5]`;
    const hiddenStatus = this.showHidden ? "hidden:shown" : "hidden:off";
    const status = this.theme.fg(
      "dim",
      `j/k move · space expand · h hide · v ${hiddenStatus} · r restore · x replace/restore Tool Output · a all · R reset · q close`,
    );
    return [
      visiblePad(title, safeWidth),
      visiblePad(filterLine, safeWidth),
      visiblePad(mode, safeWidth),
      this.theme.fg("borderMuted", "─".repeat(safeWidth)),
      ...visible.map((line) => visiblePad(line, safeWidth)),
      this.theme.fg("borderMuted", "─".repeat(safeWidth)),
      visiblePad(status, safeWidth),
    ];
  }

  invalidate(): void {
    // Rendering is derived from current state; no component cache is used.
  }
}
