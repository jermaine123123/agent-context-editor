import type { Theme } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import {
  searchRecords,
  type ContextEditableUnit,
  type ContextEditorPrefsV2,
  type ContextEditorSnapshot,
  type ContextMutationResult,
  type ContextRecord,
  type ContextRecordKind,
  type ContextSearchMatch,
} from "./shared-core/index.js";

type FlatUnit = { record: ContextRecord; unit: ContextEditableUnit };
type PersistPrefs = (prefs: ContextEditorPrefsV2) => void;
type LoadRecords = () => ContextRecord[];
type LoadSnapshot = () => ContextEditorSnapshot;
type Mutate = (input: { baseRevision: string; action: "hide" | "restore" | "reset"; unitIds?: readonly string[] }) => ContextMutationResult;
type Undo = (baseRevision: string) => ContextMutationResult;
type Notify = (message: string, type?: "info" | "warning" | "error") => void;

const RECORD_KINDS: readonly ContextRecordKind[] = ["user", "ai", "tool"];

function kindLabel(kind: ContextRecordKind): string {
  return kind === "ai" ? "AI" : kind === "tool" ? "Tool" : "User";
}

function unitLabel(unit: ContextEditableUnit): string {
  return unit.kind === "reasoning" ? "Reasoning" : unit.kind === "answer" ? "Answer" : unit.kind === "tool" ? "Tool" : "User";
}

function colorForKind(kind: ContextRecordKind): Parameters<Theme["fg"]>[0] {
  return kind === "user" ? "accent" : kind === "ai" ? "text" : "toolOutput";
}

function visiblePad(text: string, width: number): string {
  return truncateToWidth(text, Math.max(1, width), "…", true);
}

function bodyLines(text: string, width: number, maxLines = 8): string[] {
  const available = Math.max(8, width - 8);
  const source = text.split(/\r?\n/);
  const output = source.slice(0, maxLines).map((line) => truncateToWidth(line || " ", available));
  if (source.length > maxLines) {
    const last = output.length - 1;
    if (last >= 0) output[last] = truncateToWidth(`${output[last]} …`, available);
  }
  return output.length > 0 ? output : [" "];
}

export class ContextEditorComponent implements Component {
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly loadRecords: LoadRecords;
  private readonly loadSnapshot: LoadSnapshot;
  private readonly mutate: Mutate;
  private readonly undoMutation: Undo;
  private readonly persistPrefs: PersistPrefs;
  private readonly notify: Notify;
  private readonly done: () => void;

  private records: ContextRecord[];
  private prefs: ContextEditorPrefsV2;
  private query = "";
  private revision: string;
  private canUndo: boolean;
  private selectedIndex = 0;
  private scrollOffset = 0;
  private selected = new Set<string>();
  private rangeAnchor: number | null = null;
  private expanded = new Set<string>();
  private searchMode = false;
  private matches: ContextSearchMatch[] = [];
  private matchIndex = -1;

  constructor(
    tui: TUI,
    theme: Theme,
    records: readonly ContextRecord[],
    snapshot: ContextEditorSnapshot,
    prefs: ContextEditorPrefsV2,
    deps: {
      loadRecords: LoadRecords;
      loadSnapshot: LoadSnapshot;
      mutate: Mutate;
      undo: Undo;
      persistPrefs: PersistPrefs;
      notify: Notify;
    },
    done: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.records = [...records];
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.prefs = { ...prefs, enabledKinds: [...prefs.enabledKinds] };
    this.loadRecords = deps.loadRecords;
    this.loadSnapshot = deps.loadSnapshot;
    this.mutate = deps.mutate;
    this.undoMutation = deps.undo;
    this.persistPrefs = deps.persistPrefs;
    this.notify = deps.notify;
    this.done = done;
  }

  private flatUnits(): FlatUnit[] {
    const enabled = new Set(this.prefs.enabledKinds);
    return this.records.flatMap((record) => {
      if (!enabled.has(record.kind)) return [];
      return record.units.map((unit) => ({ record, unit }));
    });
  }

  private selectedUnitIds(): string[] {
    return [...this.selected].filter((id) => this.flatUnits().some(({ unit }) => unit.id === id));
  }

  private currentUnit(): FlatUnit | undefined {
    return this.flatUnits()[this.selectedIndex];
  }

  private contentText(unit: ContextEditableUnit): string {
    return unit.atoms.map((atom) => atom.text).filter(Boolean).join("\n");
  }

  private unitRows(width: number): { item: FlatUnit; lines: string[] }[] {
    const units = this.flatUnits();
    return units.map((item, index) => {
      const { record, unit } = item;
      const selected = this.selected.has(unit.id);
      const cursor = index === this.selectedIndex ? "▶" : " ";
      const checkbox = selected ? "[x]" : "[ ]";
      const hidden = unit.viewState === "hide" || unit.viewState === "mixed";
      const state = hidden ? (unit.viewState === "mixed" ? "partial" : "hidden") : "shown";
      const title = `${cursor} ${checkbox} ${unitLabel(unit)} · ${kindLabel(record.kind)} · ${state} · ${unit.atoms.reduce((sum, atom) => sum + atom.approxTokens, 0)} tok`;
      const titleLine = this.theme.fg(colorForKind(record.kind), title);
      const lines = [index === this.selectedIndex ? this.theme.bg("selectedBg", visiblePad(titleLine, width)) : visiblePad(titleLine, width)];
      if (hidden && !this.prefs.showHidden) {
        lines.push(visiblePad(this.theme.fg("dim", `    ${unitLabel(unit)} hidden · press v to reveal`), width));
      } else if (this.expanded.has(unit.id)) {
        for (const line of bodyLines(this.contentText(unit), width)) {
          lines.push(visiblePad(this.theme.fg("dim", `    │ ${line}`), width));
        }
      }
      return { item, lines };
    });
  }

  private availableRows(): number {
    return Math.max(5, this.tui.terminal.rows - 7);
  }

  private ensureSelectionVisible(width = this.tui.terminal.columns): void {
    const rows = this.unitRows(width);
    let selectedLine = 0;
    for (const row of rows) {
      if (row.item.unit.id === this.currentUnit()?.unit.id) break;
      selectedLine += row.lines.length;
    }
    const viewport = this.availableRows();
    if (selectedLine < this.scrollOffset) this.scrollOffset = selectedLine;
    if (selectedLine >= this.scrollOffset + viewport) this.scrollOffset = selectedLine - viewport + 1;
    this.scrollOffset = Math.max(0, this.scrollOffset);
  }

  private resetSelection(): void {
    this.selected.clear();
    this.rangeAnchor = null;
  }

  private refreshData(): void {
    const snapshot = this.loadSnapshot();
    this.records = this.loadRecords();
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
    this.resetSelection();
    this.matches = [];
    this.matchIndex = -1;
    this.ensureSelectionVisible();
    this.tui.requestRender();
  }

  private applyMutation(action: "hide" | "restore" | "reset"): void {
    const unitIds = action === "reset" ? undefined : this.selectedUnitIds().length > 0 ? this.selectedUnitIds() : [this.currentUnit()?.unit.id].filter((id): id is string => !!id);
    try {
      const result = this.mutate({ baseRevision: this.revision, action, ...(unitIds ? { unitIds } : {}) });
      if (!result.ok || result.conflict) {
        this.notify("会话或 sidecar 已变化，已刷新 Context Editor。", "warning");
        this.refreshData();
        return;
      }
      this.refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(message === "AGENT_RUNTIME_BUSY" ? "Agent 运行中，暂时不能修改隐藏状态。" : `Context Editor 操作失败：${message}`, "warning");
    }
  }

  private moveSelection(delta: number, extend: boolean): void {
    const count = this.flatUnits().length;
    if (count === 0) return;
    if (extend && this.rangeAnchor === null) this.rangeAnchor = this.selectedIndex;
    this.selectedIndex = Math.max(0, Math.min(count - 1, this.selectedIndex + delta));
    if (extend && this.rangeAnchor !== null) {
      const lo = Math.min(this.rangeAnchor, this.selectedIndex);
      const hi = Math.max(this.rangeAnchor, this.selectedIndex);
      this.selected = new Set(this.flatUnits().slice(lo, hi + 1).map(({ unit }) => unit.id));
    } else if (!extend) {
      this.resetSelection();
    }
    this.ensureSelectionVisible();
    this.tui.requestRender();
  }

  private refreshSearch(): void {
    this.matches = searchRecords(this.records, this.query, new Set(this.prefs.enabledKinds));
    this.matchIndex = this.matches.length > 0 ? 0 : -1;
    this.focusMatch();
  }

  private focusMatch(): void {
    const match = this.matches[this.matchIndex];
    if (!match) return;
    const index = this.flatUnits().findIndex(({ unit }) => unit.id === match.unitId);
    if (index >= 0) {
      this.selectedIndex = index;
      this.resetSelection();
      this.ensureSelectionVisible();
    }
    this.tui.requestRender();
  }

  private nextMatch(delta: number): void {
    if (this.matches.length === 0) return;
    this.matchIndex = (this.matchIndex + delta + this.matches.length) % this.matches.length;
    this.focusMatch();
  }

  private toggleKind(kind: ContextRecordKind): void {
    const enabled = new Set(this.prefs.enabledKinds);
    if (enabled.has(kind)) enabled.delete(kind);
    else enabled.add(kind);
    this.prefs = { ...this.prefs, enabledKinds: RECORD_KINDS.filter((candidate) => enabled.has(candidate)) };
    this.persistPrefs(this.prefs);
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.resetSelection();
    this.refreshSearch();
  }

  private toggleAll(): void {
    const units = this.flatUnits();
    if (units.length > 0 && units.every(({ unit }) => this.selected.has(unit.id))) this.resetSelection();
    else this.selected = new Set(units.map(({ unit }) => unit.id));
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
      this.query = this.query.slice(0, -1);
      this.refreshSearch();
      return;
    }
    const printable = decodeKittyPrintable(data) ?? (data.length === 1 && !data.includes("\x1b") ? data : undefined);
    if (printable) {
      this.query += printable;
      this.refreshSearch();
    }
  }

  handleInput(data: string): void {
    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }
    if (matchesKey(data, "ctrl+c") || matchesKey(data, "escape")) {
      this.done();
      return;
    }
    if (data === "q" || data === "Q") {
      this.done();
      return;
    }
    if (data === "/") {
      this.searchMode = true;
      this.tui.requestRender();
      return;
    }
    if (data === "j" || matchesKey(data, "down")) { this.moveSelection(1, false); return; }
    if (data === "k" || matchesKey(data, "up")) { this.moveSelection(-1, false); return; }
    if (matchesKey(data, "shift+down")) { this.moveSelection(1, true); return; }
    if (matchesKey(data, "shift+up")) { this.moveSelection(-1, true); return; }
    if (matchesKey(data, "pageDown")) { this.moveSelection(this.availableRows(), false); return; }
    if (matchesKey(data, "pageUp")) { this.moveSelection(-this.availableRows(), false); return; }
    if (data === "g") { this.selectedIndex = 0; this.ensureSelectionVisible(); this.tui.requestRender(); return; }
    if (data === "G") { this.selectedIndex = Math.max(0, this.flatUnits().length - 1); this.ensureSelectionVisible(); this.tui.requestRender(); return; }
    if (data === "1") { this.toggleKind("user"); return; }
    if (data === "2") { this.toggleKind("ai"); return; }
    if (data === "3") { this.toggleKind("tool"); return; }
    if (data === "a" || data === "A") { this.toggleAll(); return; }
    if (data === "v" || data === "V") {
      this.prefs = { ...this.prefs, showHidden: !this.prefs.showHidden };
      this.persistPrefs(this.prefs);
      this.tui.requestRender();
      return;
    }
    if (data === "n") { this.nextMatch(1); return; }
    if (data === "N") { this.nextMatch(-1); return; }
    if (matchesKey(data, "space")) {
      const unit = this.currentUnit()?.unit;
      if (!unit) return;
      if (this.selected.has(unit.id)) this.selected.delete(unit.id);
      else this.selected.add(unit.id);
      this.rangeAnchor = this.selectedIndex;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "enter")) {
      const unit = this.currentUnit()?.unit;
      if (!unit) return;
      if (this.expanded.has(unit.id)) this.expanded.delete(unit.id);
      else this.expanded.add(unit.id);
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }
    if (data === "h" || data === "H") { this.applyMutation("hide"); return; }
    if (data === "r") { this.applyMutation("restore"); return; }
    if (data === "R") { this.applyMutation("reset"); return; }
    if (data === "u") {
      if (!this.canUndo) return;
      try {
        const result = this.undoMutation(this.revision);
        if (!result.ok || result.conflict) this.notify("撤销时发现 revision 冲突，已刷新。", "warning");
        this.refreshData();
      } catch (error) {
        this.notify(`撤销失败：${error instanceof Error ? error.message : String(error)}`, "warning");
      }
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(24, width);
    const rows = this.unitRows(safeWidth);
    const content = rows.flatMap((row) => row.lines);
    const viewport = this.availableRows();
    const maxOffset = Math.max(0, content.length - viewport);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
    const visible = content.slice(this.scrollOffset, this.scrollOffset + viewport);
    while (visible.length < viewport) visible.push("");

    const enabled = (kind: ContextRecordKind): string => this.prefs.enabledKinds.includes(kind) ? this.theme.fg("accent", kindLabel(kind)) : this.theme.fg("dim", kindLabel(kind));
    const title = this.theme.fg("accent", "Pi Context Editor") + this.theme.fg("dim", `  ${this.flatUnits().length} units`);
    const mode = this.searchMode
      ? this.theme.fg("warning", `Search: ${this.query}▌  ${this.matches.length} units`)
      : this.theme.fg("dim", `Search: ${this.query || "(press /)"}${this.matches.length > 0 ? ` · ${this.matchIndex + 1}/${this.matches.length}` : ""}`);
    const filterLine = `${enabled("user")} [1]  ${enabled("ai")} [2]  ${enabled("tool")} [3]`;
    const status = this.theme.fg("dim", "j/k move · shift+↑/↓ range · space select · enter expand · h hide · r restore · u undo · v reveal · q close");
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
    // All rows derive from the current records and prefs.
  }
}
