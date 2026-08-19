import type { Theme } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import {
  searchOccurrences,
  type ContextEditableUnit,
  type ContextEditorPrefsV2,
  type ContextEditorSnapshot,
  type ContextMutationResult,
  type ContextRecord,
  type ContextRecordKind,
  type ContextSearchOccurrence,
  type ContextSearchScope,
} from "./shared-core/index.js";
import { createPiText, detectPiLocale, type PiLocale, type PiText } from "./locale.js";

type FlatUnit = { record: ContextRecord; unit: ContextEditableUnit };
type PersistPrefs = (prefs: ContextEditorPrefsV2) => void;
type LoadRecords = () => ContextRecord[];
type LoadSnapshot = () => ContextEditorSnapshot;
type Mutate = (input: { baseRevision: string; action: "hide" | "restore" | "reset"; unitIds?: readonly string[] }) => ContextMutationResult;
type Undo = (baseRevision: string) => ContextMutationResult;
type Notify = (message: string, type?: "info" | "warning" | "error") => void;
type Confirm = (message: string) => Promise<boolean>;

const RECORD_KINDS: readonly ContextRecordKind[] = ["user", "ai", "tool"];

function colorForKind(kind: ContextRecordKind): Parameters<Theme["fg"]>[0] {
  return kind === "user" ? "accent" : kind === "ai" ? "text" : "toolOutput";
}

function visiblePad(text: string, width: number): string {
  return truncateToWidth(text, Math.max(1, width), "…", true);
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
  private readonly confirm: Confirm;
  private readonly done: () => void;
  private readonly text: PiText;

  private records: ContextRecord[];
  private prefs: ContextEditorPrefsV2;
  private query = "";
  private revision: string;
  private canUndo: boolean;
  private selectedIndex = 0;
  private scrollOffset = 0;
  private manualScroll = false;
  private selected = new Set<string>();
  private rangeAnchor: number | null = null;
  private expanded = new Set<string>();
  private searchMode = false;
  private helpMode = false;
  private searchScope: ContextSearchScope = "dialogue";
  private matches: ContextSearchOccurrence[] = [];
  private matchIndex = -1;
  private lastRenderWidth = 0;
  private lastRenderRows = 0;
  private readonly bodyCache = new Map<string, { width: number; text: string; highlightKey: string; lines: string[] }>();

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
      confirm?: Confirm;
      locale?: PiLocale;
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
    this.confirm = deps.confirm ?? (async () => true);
    this.done = done;
    this.text = createPiText(deps.locale ?? detectPiLocale());
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

  private highlightText(text: string, start: number, end: number): string {
    if (start < 0 || end <= start || start >= text.length) return text;
    const safeEnd = Math.min(text.length, end);
    return `${text.slice(0, start)}${this.theme.fg("warning", text.slice(start, safeEnd))}${text.slice(safeEnd)}`;
  }

  private contentText(unit: ContextEditableUnit, activeHit?: ContextSearchOccurrence): string {
    return unit.atoms.map((atom) => {
      if (activeHit && activeHit.field !== "tool_name" && activeHit.atomId === atom.id) {
        return this.highlightText(atom.text, activeHit.start, activeHit.end);
      }
      return atom.text;
    }).filter(Boolean).join("\n");
  }

  private unitIsHidden(unit: ContextEditableUnit): boolean {
    return unit.viewState === "hide" || unit.viewState === "mixed";
  }

  private bodyLinesFor(unit: ContextEditableUnit, width: number, activeHit?: ContextSearchOccurrence): string[] {
    const text = this.contentText(unit, activeHit);
    const available = Math.max(8, width - 8);
    const highlightKey = activeHit ? `${activeHit.atomId}:${activeHit.field}:${activeHit.start}:${activeHit.end}` : "";
    const cached = this.bodyCache.get(unit.id);
    if (cached && cached.width === available && cached.text === text && cached.highlightKey === highlightKey) return cached.lines;
    const lines = wrapTextWithAnsi(text || " ", available);
    const normalized = lines.length > 0 ? lines : [" "];
    this.bodyCache.set(unit.id, { width: available, text, highlightKey, lines: normalized });
    return normalized;
  }

  private activeHitForUnit(unit: ContextEditableUnit): ContextSearchOccurrence | undefined {
    const hit = this.matches[this.matchIndex];
    return hit?.unitId === unit.id ? hit : undefined;
  }

  private toolNameForUnit(unit: ContextEditableUnit): { name: string; atomId: string } | undefined {
    const atom = unit.atoms.find((candidate) => !!candidate.toolName);
    return atom?.toolName ? { name: atom.toolName, atomId: atom.id } : undefined;
  }

  private titleText(record: ContextRecord, unit: ContextEditableUnit, index: number, activeHit?: ContextSearchOccurrence): string {
    const selected = this.selected.has(unit.id);
    const cursor = index === this.selectedIndex ? "▶" : " ";
    const checkbox = selected ? "[x]" : "[ ]";
    const hidden = this.unitIsHidden(unit);
    const state = hidden ? (unit.viewState === "mixed" ? "partial" : "hidden") : "shown";
    const base = `${cursor} ${checkbox} ${this.text.unitKind(unit.kind)} · ${this.text.recordKind(record.kind)} · ${this.text.unitState(state)} · ${unit.atoms.reduce((sum, atom) => sum + atom.approxTokens, 0)} tok`;
    if (hidden && !this.prefs.showHidden) return base;
    const tool = this.toolNameForUnit(unit);
    if (!tool) return base;
    const toolText = activeHit?.field === "tool_name" && activeHit.atomId === tool.atomId
      ? this.highlightText(tool.name, activeHit.start, activeHit.end)
      : tool.name;
    return `${base} · ${toolText}`;
  }

  private unitLineCount(item: FlatUnit, width: number): number {
    const { unit } = item;
    if (this.unitIsHidden(unit) && !this.prefs.showHidden) return 2;
    if (!this.expanded.has(unit.id) && !this.prefs.showHidden) return 1;
    if (!this.expanded.has(unit.id) && this.unitIsHidden(unit)) return 1 + this.bodyLinesFor(unit, width).length;
    if (!this.expanded.has(unit.id)) return 1;
    return 1 + this.bodyLinesFor(unit, width).length;
  }

  private unitRows(width: number, start = 0, end = this.flatUnits().length): { item: FlatUnit; lines: string[] }[] {
    const units = this.flatUnits();
    return units.slice(start, end).map((item, offset) => {
      const index = start + offset;
      const { record, unit } = item;
      const activeHit = this.activeHitForUnit(unit);
      const hidden = this.unitIsHidden(unit);
      const state = hidden ? (unit.viewState === "mixed" ? "partial" : "hidden") : "shown";
      const title = this.titleText(record, unit, index, activeHit);
      const titleLine = this.theme.fg(colorForKind(record.kind), title);
      const lines = [index === this.selectedIndex ? this.theme.bg("selectedBg", visiblePad(titleLine, width)) : visiblePad(titleLine, width)];
      if (hidden && !this.prefs.showHidden) {
        const hiddenLabel = this.activeHitForUnit(unit)
          ? `${this.text.hiddenUnit(this.text.unitKind(unit.kind))}${this.text.hiddenSearchHit()}`
          : this.text.hiddenUnit(this.text.unitKind(unit.kind));
        lines.push(visiblePad(this.theme.fg("dim", hiddenLabel), width));
      } else if (this.expanded.has(unit.id) || (hidden && this.prefs.showHidden)) {
        for (const line of this.bodyLinesFor(unit, width, activeHit)) {
          lines.push(visiblePad(this.theme.fg("dim", `    │ ${line}`), width));
        }
      }
      return { item, lines };
    });
  }

  private availableRows(): number {
    return Math.max(5, this.tui.terminal.rows - 7);
  }

  private totalLineCount(width: number): number {
    return this.flatUnits().reduce((sum, item) => sum + this.unitLineCount(item, width), 0);
  }

  private clampScroll(width = this.tui.terminal.columns): number {
    const viewport = this.availableRows();
    const maxOffset = Math.max(0, this.totalLineCount(width) - viewport);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
    return maxOffset;
  }

  private scrollByRows(delta: number): void {
    const width = Math.max(24, this.tui.terminal.columns);
    const maxOffset = this.clampScroll(width);
    const next = Math.max(0, Math.min(maxOffset, this.scrollOffset + delta));
    if (next === this.scrollOffset && maxOffset === 0) {
      this.moveSelection(delta >= 0 ? this.availableRows() : -this.availableRows(), false);
      return;
    }
    this.scrollOffset = next;
    this.manualScroll = true;
    this.tui.requestRender();
  }

  private ensureSelectionVisible(width = this.tui.terminal.columns): void {
    const selectedLine = this.unitStartOffset(this.selectedIndex, width);
    const viewport = this.availableRows();
    if (selectedLine < this.scrollOffset) this.scrollOffset = selectedLine;
    if (selectedLine >= this.scrollOffset + viewport) this.scrollOffset = selectedLine - viewport + 1;
    this.scrollOffset = Math.max(0, this.scrollOffset);
  }

  private unitStartOffset(index: number, width: number): number {
    return this.flatUnits()
      .slice(0, index)
      .reduce((sum, item) => sum + this.unitLineCount(item, width), 0);
  }

  private bodyLineIndexForHit(unit: ContextEditableUnit, hit: ContextSearchOccurrence, width: number): number {
    if (hit.field === "tool_name") return 0;
    const atomIndex = unit.atoms.findIndex((atom) => atom.id === hit.atomId);
    if (atomIndex < 0) return 0;
    const preceding = unit.atoms.slice(0, atomIndex).map((atom) => atom.text).filter(Boolean).join("\n");
    const target = unit.atoms[atomIndex]?.text ?? "";
    const prefix = preceding ? `${preceding}\n${target.slice(0, hit.start)}` : target.slice(0, hit.start);
    return Math.max(0, wrapTextWithAnsi(prefix || " ", Math.max(8, width - 8)).length - 1);
  }

  private positionSearchHit(width: number): void {
    const hit = this.matches[this.matchIndex];
    if (!hit) return;
    const units = this.flatUnits();
    const unitIndex = units.findIndex(({ unit }) => unit.id === hit.unitId);
    if (unitIndex < 0) return;
    const unit = units[unitIndex]?.unit;
    if (!unit) return;
    const hidden = this.unitIsHidden(unit) && !this.prefs.showHidden;
    if (!hidden) this.expanded.add(unit.id);
    const unitStart = this.unitStartOffset(unitIndex, width);
    const targetLine = hidden
      ? unitStart + 1
      : unitStart + (hit.field === "tool_name" ? 0 : 1 + this.bodyLineIndexForHit(unit, hit, width));
    this.scrollOffset = Math.max(0, targetLine - Math.floor(this.availableRows() / 2));
    this.manualScroll = true;
    this.clampScroll(width);
  }

  private focusSearchHit(index: number): void {
    if (!this.matches[index]) return;
    this.matchIndex = index;
    const units = this.flatUnits();
    const unitIndex = units.findIndex(({ unit }) => unit.id === this.matches[index]?.unitId);
    if (unitIndex < 0) return;
    this.selectedIndex = unitIndex;
    this.resetSelection();
    this.positionSearchHit(Math.max(24, this.tui.terminal.columns));
    this.tui.requestRender();
  }

  /** Build only rows intersecting the terminal viewport. Long bodies outside
   * the viewport are never converted into strings during this frame. */
  private renderWindow(width: number, start: number, end: number): string[] {
    const units = this.flatUnits();
    const output: string[] = [];
    let lineOffset = 0;
    for (let index = 0; index < units.length; index += 1) {
      const item = units[index];
      if (!item) continue;
      const count = this.unitLineCount(item, width);
      if (lineOffset + count > start && lineOffset < end) {
        const row = this.unitRows(width, index, index + 1)[0];
        if (row) {
          const from = Math.max(0, start - lineOffset);
          const to = Math.min(row.lines.length, end - lineOffset);
          output.push(...row.lines.slice(from, to));
        }
      }
      lineOffset += count;
      if (lineOffset >= end) break;
    }
    return output;
  }

  private resetSelection(): void {
    this.selected.clear();
    this.rangeAnchor = null;
  }

  private savePrefs(): void {
    try {
      this.persistPrefs(this.prefs);
    } catch (error) {
      this.notify(this.text.savePrefsFailed(error instanceof Error ? error.message : String(error)), "warning");
    }
  }

  private refreshData(): void {
    const snapshot = this.loadSnapshot();
    this.records = this.loadRecords();
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
    this.manualScroll = false;
    this.resetSelection();
    this.matches = this.query.trim() ? searchOccurrences(this.records, this.query, new Set(this.prefs.enabledKinds), this.searchScope) : [];
    this.matchIndex = -1;
    this.ensureSelectionVisible();
    this.tui.requestRender();
  }

  private syncExternalState(): void {
    const snapshot = this.loadSnapshot();
    if (snapshot.revision === this.revision) return;
    this.records = this.loadRecords();
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
    this.scrollOffset = 0;
    this.manualScroll = false;
    this.resetSelection();
    this.matches = this.query.trim() ? searchOccurrences(this.records, this.query, new Set(this.prefs.enabledKinds), this.searchScope) : [];
    this.matchIndex = -1;
    this.notify(this.text.sessionChanged(), "info");
  }

  private applyMutation(action: "hide" | "restore" | "reset"): void {
    const unitIds = action === "reset" ? undefined : this.selectedUnitIds().length > 0 ? this.selectedUnitIds() : [this.currentUnit()?.unit.id].filter((id): id is string => !!id);
    try {
      const result = this.mutate({ baseRevision: this.revision, action, ...(unitIds ? { unitIds } : {}) });
      if (!result.ok || result.conflict) {
        this.notify(this.text.sidecarChanged(), "warning");
        this.refreshData();
        return;
      }
      this.refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(message === "AGENT_RUNTIME_BUSY" ? this.text.busy() : this.text.operationFailed(message), "warning");
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
    this.matchIndex = -1;
    this.manualScroll = false;
    this.ensureSelectionVisible();
    this.tui.requestRender();
  }

  private refreshSearch(): void {
    this.matches = searchOccurrences(this.records, this.query, new Set(this.prefs.enabledKinds), this.searchScope);
    this.matchIndex = -1;
    this.resetSelection();
    this.tui.requestRender();
  }

  private toggleSearchScope(): void {
    this.searchScope = this.searchScope === "dialogue" ? "all" : "dialogue";
    this.matches = searchOccurrences(this.records, this.query, new Set(this.prefs.enabledKinds), this.searchScope);
    this.matchIndex = -1;
    this.resetSelection();
    if (this.query.trim() && this.matches.length > 0) this.focusSearchHit(0);
    else this.tui.requestRender();
  }

  private nextMatch(delta: number): void {
    if (this.matches.length === 0) return;
    const start = this.matchIndex < 0 ? (delta < 0 ? this.matches.length - 1 : 0) : this.matchIndex + delta;
    this.focusSearchHit((start + this.matches.length) % this.matches.length);
  }

  private toggleKind(kind: ContextRecordKind): void {
    const enabled = new Set(this.prefs.enabledKinds);
    if (enabled.has(kind)) enabled.delete(kind);
    else enabled.add(kind);
    this.prefs = { ...this.prefs, enabledKinds: RECORD_KINDS.filter((candidate) => enabled.has(candidate)) };
    this.savePrefs();
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.manualScroll = false;
    this.resetSelection();
    this.refreshSearch();
  }

  private toggleAll(): void {
    const allUnits = this.flatUnits();
    const matchingIds = new Set(this.matches.map((match) => match.unitId));
    const units = this.query.trim()
      ? allUnits.filter(({ unit }) => matchingIds.has(unit.id))
      : allUnits;
    if (units.length === 0) return;
    if (units.length > 0 && units.every(({ unit }) => this.selected.has(unit.id))) this.resetSelection();
    else this.selected = new Set(units.map(({ unit }) => unit.id));
    this.tui.requestRender();
  }

  private helpLines(): string[] {
    return this.text.tuiHelpLines();
  }

  private handleSearchInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.searchMode = false;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "enter")) {
      this.searchMode = false;
      if (this.matches.length > 0) this.focusSearchHit(0);
      else this.tui.requestRender();
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

  private async resetAllWithConfirmation(): Promise<void> {
    const confirmed = await this.confirm(this.text.restoreAllConfirmTitle());
    if (confirmed) this.applyMutation("reset");
  }

  handleInput(data: string): void {
    this.syncExternalState();
    if (this.searchMode) {
      this.handleSearchInput(data);
      return;
    }
    if (this.helpMode) {
      if (data === "?" || matchesKey(data, "escape") || data === "q" || data === "Q") {
        this.helpMode = false;
        this.tui.requestRender();
      }
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
    if (data === "s") {
      this.toggleSearchScope();
      return;
    }
    if (data === "?") {
      this.helpMode = true;
      this.tui.requestRender();
      return;
    }
    if (data === "j" || matchesKey(data, "down")) { this.moveSelection(1, false); return; }
    if (data === "k" || matchesKey(data, "up")) { this.moveSelection(-1, false); return; }
    if (matchesKey(data, "shift+down")) { this.moveSelection(1, true); return; }
    if (matchesKey(data, "shift+up")) { this.moveSelection(-1, true); return; }
    if (matchesKey(data, "pageDown")) { this.scrollByRows(this.availableRows()); return; }
    if (matchesKey(data, "pageUp")) { this.scrollByRows(-this.availableRows()); return; }
    if (data === "g") { this.selectedIndex = 0; this.matchIndex = -1; this.manualScroll = false; this.ensureSelectionVisible(); this.tui.requestRender(); return; }
    if (data === "G") { this.selectedIndex = Math.max(0, this.flatUnits().length - 1); this.matchIndex = -1; this.manualScroll = false; this.ensureSelectionVisible(); this.tui.requestRender(); return; }
    if (data === "1") { this.toggleKind("user"); return; }
    if (data === "2") { this.toggleKind("ai"); return; }
    if (data === "3") { this.toggleKind("tool"); return; }
    if (data === "a" || data === "A") { this.toggleAll(); return; }
    if (data === "v" || data === "V") {
      this.prefs = { ...this.prefs, showHidden: !this.prefs.showHidden };
      this.savePrefs();
      if (this.matchIndex >= 0) this.focusSearchHit(this.matchIndex);
      else this.tui.requestRender();
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
      this.matchIndex = -1;
      this.manualScroll = false;
      this.ensureSelectionVisible();
      this.tui.requestRender();
      return;
    }
    if (data === "h" || data === "H") { this.applyMutation("hide"); return; }
    if (data === "r") { this.applyMutation("restore"); return; }
    if (data === "R") { void this.resetAllWithConfirmation(); return; }
    if (data === "u") {
      if (!this.canUndo) return;
      try {
        const result = this.undoMutation(this.revision);
        if (!result.ok || result.conflict) this.notify(this.text.undoConflict(), "warning");
        this.refreshData();
      } catch (error) {
        this.notify(this.text.undoFailed(error instanceof Error ? error.message : String(error)), "warning");
      }
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(24, width);
    const viewport = this.availableRows();
    let visible: string[];
    if (this.helpMode) {
      visible = this.helpLines().slice(0, viewport);
    } else {
      const layoutChanged = this.lastRenderWidth !== safeWidth || this.lastRenderRows !== this.tui.terminal.rows;
      if (this.matchIndex >= 0 && layoutChanged) this.positionSearchHit(safeWidth);
      if (!this.manualScroll) this.ensureSelectionVisible(safeWidth);
      const totalLines = this.totalLineCount(safeWidth);
      const maxOffset = Math.max(0, totalLines - viewport);
      this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
      visible = this.renderWindow(safeWidth, this.scrollOffset, this.scrollOffset + viewport);
    }
    this.lastRenderWidth = safeWidth;
    this.lastRenderRows = this.tui.terminal.rows;
    while (visible.length < viewport) visible.push("");

    const enabled = (kind: ContextRecordKind): string => this.prefs.enabledKinds.includes(kind) ? this.theme.fg("accent", this.text.recordKind(kind)) : this.theme.fg("dim", this.text.recordKind(kind));
    const title = this.helpMode
      ? this.theme.fg("accent", this.text.tuiHelpTitle())
      : this.theme.fg("accent", "Pi Context Editor") + this.theme.fg("dim", `  ${this.text.unitCount(this.flatUnits().length)}`);
    const mode = this.helpMode
      ? this.theme.fg("dim", "")
      : this.searchMode
      ? this.theme.fg("warning", this.text.tuiSearch(this.query, this.matches.length, this.matchIndex, this.searchScope))
      : this.theme.fg("dim", this.text.tuiSearchIdle(this.query, this.matches.length, this.matchIndex, this.searchScope));
    const filterLine = this.helpMode ? "" : `${enabled("user")} [1]  ${enabled("ai")} [2]  ${enabled("tool")} [3]`;
    const statusMode = this.helpMode ? "help" : this.searchMode ? "search" : this.matches.length > 0 ? "results" : "normal";
    const status = this.theme.fg("dim", this.text.tuiStatus(statusMode, this.searchScope));
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
