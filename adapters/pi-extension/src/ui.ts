import type { Theme } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component, type TUI } from "@earendil-works/pi-tui";
import {
  CONTEXT_EDITOR_UNIT_KINDS,
  recordKindsForUnitKinds,
  searchOccurrences,
  type ContextEditableUnit,
  type ContextEditableUnitKind,
  type ContextEditorPrefs,
  type ContextEditorSnapshot,
  type ContextMutationResult,
  type ContextProjectionPreview,
  type ContextRecord,
  type ContextRecordKind,
  type ContextSearchOccurrence,
  type ContextSearchScope,
} from "./shared-core/index.js";
import { createPiText, detectPiLocale, type PiLocale, type PiText } from "./locale.js";

type FlatUnit = { record: ContextRecord; unit: ContextEditableUnit };
type PersistPrefs = (prefs: ContextEditorPrefs) => void;
type LoadRecords = () => ContextRecord[];
type LoadSnapshot = () => ContextEditorSnapshot;
type Mutate = (input: { baseRevision: string; action: "hide" | "restore" | "reset"; unitIds?: readonly string[] }) => ContextMutationResult;
type Undo = (baseRevision: string) => ContextMutationResult;
type PreviewContext = (input: { baseRevision: string; action: "exclude" | "restore"; unitIds?: readonly string[] }) => ContextProjectionPreview | Promise<ContextProjectionPreview>;
type CommitContext = (input: { baseRevision: string; action: "exclude" | "restore"; unitIds?: readonly string[] }) => ContextMutationResult | Promise<ContextMutationResult>;
type Notify = (message: string, type?: "info" | "warning" | "error") => void;
type Confirm = (message: string) => Promise<boolean>;
type PendingConfirmation =
  | { kind: "projection"; action: "exclude" | "restore"; unitIds: string[]; preview: ContextProjectionPreview; message: string }
  | { kind: "reset"; message: string };

const UNIT_KINDS = CONTEXT_EDITOR_UNIT_KINDS;

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
  private readonly done: () => void;
  private readonly previewContext?: PreviewContext;
  private readonly commitContext?: CommitContext;
  private projectionAvailable: boolean;
  private readonly text: PiText;

  private records: ContextRecord[];
  private prefs: ContextEditorPrefs;
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
  private pendingConfirmation: PendingConfirmation | null = null;
  private operationInFlight = false;
  private readonly bodyCache = new Map<string, { width: number; text: string; highlightKey: string; lines: string[] }>();

  constructor(
    tui: TUI,
    theme: Theme,
    records: readonly ContextRecord[],
    snapshot: ContextEditorSnapshot,
    prefs: ContextEditorPrefs,
    deps: {
      loadRecords: LoadRecords;
      loadSnapshot: LoadSnapshot;
      mutate: Mutate;
      undo: Undo;
      persistPrefs: PersistPrefs;
      notify: Notify;
      confirm?: Confirm;
      previewContext?: PreviewContext;
      commitContext?: CommitContext;
      locale?: PiLocale;
    },
    done: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.records = [...records];
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.previewContext = deps.previewContext;
    this.commitContext = deps.commitContext;
    this.projectionAvailable = snapshot.projectionAvailable !== false && !!deps.previewContext && !!deps.commitContext;
    this.prefs = { ...prefs, enabledUnitKinds: [...prefs.enabledUnitKinds] };
    this.loadRecords = deps.loadRecords;
    this.loadSnapshot = deps.loadSnapshot;
    this.mutate = deps.mutate;
    this.undoMutation = deps.undo;
    this.persistPrefs = deps.persistPrefs;
    this.notify = deps.notify;
    this.done = done;
    this.text = createPiText(deps.locale ?? detectPiLocale());
  }

  private flatUnits(): FlatUnit[] {
    const enabled = new Set(this.prefs.enabledUnitKinds);
    return this.records.flatMap((record) => record.units
      .filter((unit) => enabled.has(unit.kind))
      .map((unit) => ({ record, unit })));
  }

  private searchOccurrencesForPrefs(): ContextSearchOccurrence[] {
    const enabledUnitKinds = new Set(this.prefs.enabledUnitKinds);
    return searchOccurrences(
      this.records,
      this.query,
      new Set(recordKindsForUnitKinds(this.prefs.enabledUnitKinds)),
      this.searchScope,
      enabledUnitKinds,
    );
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
    const modelState = unit.projectionState ?? "include";
    const base = `${cursor} ${checkbox} ${this.text.unitKind(unit.kind)} · ${this.text.recordKind(record.kind)} · ${this.text.unitState(state)} · ${this.text.contextState(modelState)} · ${unit.atoms.reduce((sum, atom) => sum + atom.approxTokens, 0)} tok`;
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
    this.projectionAvailable = snapshot.projectionAvailable !== false && !!this.previewContext && !!this.commitContext;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
    this.manualScroll = false;
    this.resetSelection();
    this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
    this.matchIndex = -1;
    this.ensureSelectionVisible();
    this.tui.requestRender();
  }

  private syncExternalState(): boolean {
    const snapshot = this.loadSnapshot();
    if (snapshot.revision === this.revision) return false;
    this.records = this.loadRecords();
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.projectionAvailable = snapshot.projectionAvailable !== false && !!this.previewContext && !!this.commitContext;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
    this.scrollOffset = 0;
    this.manualScroll = false;
    this.resetSelection();
    this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
    this.matchIndex = -1;
    this.pendingConfirmation = null;
    this.notify(this.text.sessionChanged(), "info");
    return true;
  }

  private async beginContextProjection(): Promise<void> {
    if (this.operationInFlight || this.pendingConfirmation) return;
    if (!this.projectionAvailable || !this.previewContext || !this.commitContext) {
      this.notify(this.text.contextUnavailableAction(), "warning");
      return;
    }
    const selected = this.selectedUnitIds();
    const unitIds = selected.length > 0
      ? selected
      : [this.currentUnit()?.unit.id].filter((id): id is string => !!id);
    const units = this.flatUnits().filter(({ unit }) => unitIds.includes(unit.id));
    if (units.length === 0) return;
    const action: "exclude" | "restore" = units.some(({ unit }) => unit.projectionState !== "exclude") ? "exclude" : "restore";
    this.operationInFlight = true;
    try {
      const preview = await this.previewContext({ baseRevision: this.revision, action, unitIds });
      if (preview.unavailableUnitIds.length > 0) {
        this.notify(this.text.contextUnavailableAction(), "warning");
        return;
      }
      this.pendingConfirmation = {
        kind: "projection",
        action,
        unitIds: [...unitIds],
        preview,
        message: this.text.contextConfirm(
          action,
          preview.requestedUnitIds.length,
          preview.effectiveUnitIds.length,
          preview.autoExpandedUnitIds.length,
          preview.touchesRecentTurn,
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "CONTEXT_EDITOR_CONFLICT") {
        this.notify(this.text.sidecarChanged(), "warning");
        this.refreshData();
      } else {
        this.notify(message === "AGENT_RUNTIME_BUSY" ? this.text.busy() : this.text.operationFailed(message), "warning");
      }
    } finally {
      this.operationInFlight = false;
      this.tui.requestRender();
    }
  }

  private async commitPendingProjection(pending: Extract<PendingConfirmation, { kind: "projection" }>): Promise<void> {
    if (this.operationInFlight || !this.commitContext) return;
    this.operationInFlight = true;
    try {
      const result = await this.commitContext({ baseRevision: this.revision, action: pending.action, unitIds: pending.unitIds });
      if (!result.ok || result.conflict) {
        this.notify(this.text.sidecarChanged(), "warning");
        this.refreshData();
        return;
      }
      this.refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "CONTEXT_EDITOR_CONFLICT") {
        this.notify(this.text.sidecarChanged(), "warning");
        this.refreshData();
      } else {
        this.notify(message === "AGENT_RUNTIME_BUSY" ? this.text.busy() : this.text.operationFailed(message), "warning");
      }
    } finally {
      this.operationInFlight = false;
      this.tui.requestRender();
    }
  }

  private beginResetConfirmation(): void {
    if (this.operationInFlight || this.pendingConfirmation) return;
    this.pendingConfirmation = { kind: "reset", message: this.text.restoreAllConfirmMessage() };
    this.tui.requestRender();
  }

  private handleConfirmationInput(data: string): void {
    const isConfirm = matchesKey(data, "enter") || data === "y" || data === "Y";
    const isCancel = matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "n" || data === "N";
    if (!isConfirm && !isCancel) return;
    const pending = this.pendingConfirmation;
    this.pendingConfirmation = null;
    this.tui.requestRender();
    if (isCancel || !pending) return;
    if (pending.kind === "reset") {
      this.applyMutation("reset");
      return;
    }
    void this.commitPendingProjection(pending);
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
    this.matches = this.searchOccurrencesForPrefs();
    this.matchIndex = -1;
    this.resetSelection();
    this.tui.requestRender();
  }

  private toggleSearchScope(): void {
    this.searchScope = this.searchScope === "dialogue" ? "all" : "dialogue";
    this.matches = this.searchOccurrencesForPrefs();
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

  private setEnabledUnitKinds(enabled: ReadonlySet<ContextEditableUnitKind>): void {
    this.prefs = { ...this.prefs, enabledUnitKinds: UNIT_KINDS.filter((kind) => enabled.has(kind)) };
    this.savePrefs();
    this.selectedIndex = 0;
    this.scrollOffset = 0;
    this.manualScroll = false;
    this.resetSelection();
    this.refreshSearch();
  }

  private toggleUnitKind(kind: ContextEditableUnitKind): void {
    const enabled = new Set(this.prefs.enabledUnitKinds);
    if (enabled.has(kind)) enabled.delete(kind);
    else enabled.add(kind);
    this.setEnabledUnitKinds(enabled);
  }

  private toggleAiKind(): void {
    const enabled = new Set(this.prefs.enabledUnitKinds);
    if (enabled.has("reasoning") && enabled.has("answer")) {
      enabled.delete("reasoning");
      enabled.delete("answer");
    } else {
      enabled.add("reasoning");
      enabled.add("answer");
    }
    this.setEnabledUnitKinds(enabled);
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

  private confirmationLines(width: number): string[] {
    const pending = this.pendingConfirmation;
    if (!pending) return [];
    const title = pending.kind === "projection"
      ? this.text.contextConfirmTitle()
      : this.text.restoreAllConfirmTitle();
    const hint = this.text.contextConfirmHint();
    const body = wrapTextWithAnsi(pending.message, Math.max(8, width - 4));
    return [
      this.theme.fg("warning", `⚠ ${title}`),
      ...body.map((line) => this.theme.fg("dim", `  ${line}`)),
      this.theme.fg("accent", hint),
    ];
  }

  handleInput(data: string): void {
    if (this.syncExternalState()) return;
    if (this.pendingConfirmation) {
      this.handleConfirmationInput(data);
      return;
    }
    if (this.operationInFlight) return;
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
    if (data === "1") { this.toggleUnitKind("user"); return; }
    if (data === "2") { this.toggleAiKind(); return; }
    if (data === "3") { this.toggleUnitKind("tool"); return; }
    if (data === "4") { this.toggleUnitKind("reasoning"); return; }
    if (data === "5") { this.toggleUnitKind("answer"); return; }
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
    if (data === "x" || data === "X") { void this.beginContextProjection(); return; }
    if (data === "r") { this.applyMutation("restore"); return; }
    if (data === "R") { this.beginResetConfirmation(); return; }
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
    if (this.pendingConfirmation) {
      visible = this.confirmationLines(safeWidth).slice(0, viewport);
    } else if (this.helpMode) {
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

    const enabled = (kind: ContextEditableUnitKind): string => this.prefs.enabledUnitKinds.includes(kind)
      ? this.theme.fg("accent", this.text.unitKind(kind))
      : this.theme.fg("dim", this.text.unitKind(kind));
    const reasoningEnabled = this.prefs.enabledUnitKinds.includes("reasoning");
    const answerEnabled = this.prefs.enabledUnitKinds.includes("answer");
    const aiState = reasoningEnabled && answerEnabled ? "on" : reasoningEnabled || answerEnabled ? "mixed" : "off";
    const aiLabel = this.theme.fg(aiState === "on" ? "accent" : aiState === "mixed" ? "warning" : "dim", `${this.text.recordKind("ai")}${aiState === "mixed" ? " ±" : ""}`);
    const title = this.helpMode
      ? this.theme.fg("accent", this.text.tuiHelpTitle())
      : this.theme.fg("accent", "Pi Context Editor") + this.theme.fg("dim", `  ${this.text.unitCount(this.flatUnits().length)}`);
    const mode = this.pendingConfirmation
      ? this.theme.fg("warning", this.text.contextAwaiting())
      : this.helpMode
      ? this.theme.fg("dim", "")
      : this.searchMode
      ? this.theme.fg("warning", this.text.tuiSearch(this.query, this.matches.length, this.matchIndex, this.searchScope))
      : this.theme.fg("dim", this.text.tuiSearchIdle(this.query, this.matches.length, this.matchIndex, this.searchScope));
    const filterLine = this.helpMode || this.pendingConfirmation ? "" : `${enabled("user")} [1]  ${aiLabel} [2] (${enabled("reasoning")} [4]  ${enabled("answer")} [5])  ${enabled("tool")} [3]`;
    const statusMode = this.helpMode ? "help" : this.searchMode ? "search" : this.matches.length > 0 ? "results" : "normal";
    const status = this.pendingConfirmation
      ? this.theme.fg("dim", this.text.contextConfirmHint())
      : this.theme.fg("dim", this.text.tuiStatus(statusMode, this.searchScope));
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
