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
  type ContextCondensationPreview,
  type ContextCondensationSnapshot,
  type ContextReplacementPreview,
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
type ReplacementMutation = (input: { baseRevision: string; operationId: string; unitId: string; text: string; excludeAssociatedReasoning?: boolean; confirmedUnitIds?: readonly string[]; confirmationScope?: readonly string[] }) => ContextMutationResult | Promise<ContextMutationResult>;
type ReplacementPreview = (input: { baseRevision: string; operationId: string; unitId: string; text: string; excludeAssociatedReasoning?: boolean }) => ContextReplacementPreview | Promise<ContextReplacementPreview>;
type ReplacementUnitMutation = (input: { baseRevision: string; operationId: string; unitId: string }) => ContextMutationResult | Promise<ContextMutationResult>;

export interface ReplacementReview {
  draft: {
    unitId: string;
    title: string;
    text: string;
    originalText: string;
    baseRevision: string;
    operationId: string;
    unitKind: "user" | "answer";
    uiState: ContextEditorUiState;
  };
  preview: ContextReplacementPreview;
  excludeAssociatedReasoning: boolean;
}

export interface CondensationReview {
  draft: {
    unitIds: string[];
    baseRevision: string;
    operationId: string;
    expandRelated: boolean;
    uiState: ContextEditorUiState;
  };
  preview: ContextCondensationPreview;
}

interface CondensationSetup {
  unitIds: string[];
  baseRevision: string;
  canExpandRelated: boolean;
  expandRelated: boolean;
  uiState: ContextEditorUiState;
}

type CondensationGenerate = (input: {
  baseRevision: string;
  unitIds: readonly string[];
  expandRelated: boolean;
  signal?: AbortSignal;
}) => Promise<ContextCondensationPreview>;
type CondensationCancel = (operationId: string) => Promise<{ ok: boolean; operationId: string; cancelled: boolean }>;
type CondensationCommit = (input: {
  baseRevision: string;
  operationId: string;
  summary: string;
  unitIds: readonly string[];
}) => ContextMutationResult | Promise<ContextMutationResult>;

export interface ContextEditorUiState {
  query: string;
  searchScope: ContextSearchScope;
  selectedUnitId?: string;
  checkedUnitIds?: string[];
  showOriginal: boolean;
}

export type ContextEditorExit =
  | { kind: "close" }
  | { kind: "edit"; unitId: string; title: string; text: string; originalText: string; baseRevision: string; operationId: string; unitKind: "user" | "answer"; excludeAssociatedReasoning?: boolean; uiState: ContextEditorUiState }
  | { kind: "replacement-commit"; review: ReplacementReview; uiState: ContextEditorUiState }
  | { kind: "condensation-edit"; review: CondensationReview; uiState: ContextEditorUiState }
  | { kind: "condensation-commit"; review: CondensationReview; uiState: ContextEditorUiState }
  | { kind: "condensation-cancel"; operationId?: string; uiState: ContextEditorUiState }
  | { kind: "cancel-edit"; uiState: ContextEditorUiState };
type PreviewContext = (input: { baseRevision: string; action: "exclude" | "restore"; unitIds?: readonly string[]; condensationOperationId?: string }) => ContextProjectionPreview | Promise<ContextProjectionPreview>;
type CommitContext = (input: { baseRevision: string; action: "exclude" | "restore"; unitIds?: readonly string[]; condensationOperationId?: string }) => ContextMutationResult | Promise<ContextMutationResult>;
type Notify = (message: string, type?: "info" | "warning" | "error") => void;
type Confirm = (message: string) => Promise<boolean>;
type PendingConfirmation =
  | { kind: "projection"; action: "exclude" | "restore"; unitIds: string[]; preview: ContextProjectionPreview; message: string }
  | { kind: "reset"; message: string }
  | { kind: "replacement-restore"; unitId: string; message: string };

const UNIT_KINDS = CONTEXT_EDITOR_UNIT_KINDS;

function colorForKind(kind: ContextRecordKind): Parameters<Theme["fg"]>[0] {
  return kind === "user" ? "accent" : kind === "ai" ? "text" : "toolOutput";
}

function replacementOperationId(): string {
  return `pi-context-replacement-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
  private readonly isIdle?: () => boolean;
  private readonly done: (exit?: ContextEditorExit) => void;
  private readonly previewContext?: PreviewContext;
  private readonly commitContext?: CommitContext;
  private readonly commitReplacement?: ReplacementMutation;
  private readonly previewReplacement?: ReplacementPreview;
  private readonly restoreReplacement?: ReplacementUnitMutation;
  private readonly undoReplacement?: ReplacementUnitMutation;
  private readonly generateCondensation?: CondensationGenerate;
  private readonly cancelCondensation?: CondensationCancel;
  private readonly commitCondensation?: CondensationCommit;
  private readonly restoreCondensation?: (input: { baseRevision: string; operationId: string }) => ContextMutationResult | Promise<ContextMutationResult>;
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
  private showOriginal = false;
  private matches: ContextSearchOccurrence[] = [];
  private matchIndex = -1;
  private lastRenderWidth = 0;
  private lastRenderRows = 0;
  private pendingConfirmation: PendingConfirmation | null = null;
  private replacementReview: ReplacementReview | null = null;
  private replacementReviewScrollOffset = 0;
  private condensationError: string | null = null;
  private condensationSetup: CondensationSetup | null = null;
  private condensationReview: CondensationReview | null = null;
  private condensationReviewScrollOffset = 0;
  private condensationAbortController: AbortController | null = null;
  private condensationGenerationNonce = 0;
  private condensations: ContextCondensationSnapshot[] = [];
  private condensationCardExpanded = false;
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
      isIdle?: () => boolean;
      confirm?: Confirm;
      previewContext?: PreviewContext;
      commitContext?: CommitContext;
      commitReplacement?: ReplacementMutation;
      previewReplacement?: ReplacementPreview;
      restoreReplacement?: ReplacementUnitMutation;
      undoReplacement?: ReplacementUnitMutation;
      generateCondensation?: CondensationGenerate;
      cancelCondensation?: CondensationCancel;
      commitCondensation?: CondensationCommit;
      restoreCondensation?: (input: { baseRevision: string; operationId: string }) => ContextMutationResult | Promise<ContextMutationResult>;
      initialUiState?: Partial<ContextEditorUiState>;
      locale?: PiLocale;
      initialReplacementReview?: ReplacementReview;
      initialCondensationReview?: CondensationReview;
    },
    done: (exit?: ContextEditorExit) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.records = [...records];
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.previewContext = deps.previewContext;
    this.commitContext = deps.commitContext;
    this.commitReplacement = deps.commitReplacement;
    this.previewReplacement = deps.previewReplacement;
    this.restoreReplacement = deps.restoreReplacement;
    this.undoReplacement = deps.undoReplacement;
    this.generateCondensation = deps.generateCondensation;
    this.cancelCondensation = deps.cancelCondensation;
    this.commitCondensation = deps.commitCondensation;
    this.restoreCondensation = deps.restoreCondensation;
    this.condensations = [...(snapshot.condensations ?? [])];
    this.projectionAvailable = snapshot.projectionAvailable !== false && !!deps.previewContext && !!deps.commitContext;
    this.prefs = { ...prefs, enabledUnitKinds: [...prefs.enabledUnitKinds] };
    this.query = deps.initialUiState?.query ?? "";
    this.searchScope = deps.initialUiState?.searchScope ?? "dialogue";
    this.showOriginal = deps.initialUiState?.showOriginal ?? false;
    this.loadRecords = deps.loadRecords;
    this.loadSnapshot = deps.loadSnapshot;
    this.mutate = deps.mutate;
    this.undoMutation = deps.undo;
    this.persistPrefs = deps.persistPrefs;
    this.notify = deps.notify;
    this.isIdle = deps.isIdle;
    this.done = done;
    this.text = createPiText(deps.locale ?? detectPiLocale());
    const validIds = new Set(records.flatMap(record => record.units.map(unit => unit.id)));
    for (const id of deps.initialUiState?.checkedUnitIds ?? []) if (validIds.has(id)) this.selected.add(id);
    const selectedUnitId = deps.initialUiState?.selectedUnitId;
    if (selectedUnitId) {
      const index = this.flatUnits().findIndex(({ unit }) => unit.id === selectedUnitId);
      if (index >= 0) this.selectedIndex = index;
    }
    this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
    this.replacementReview = deps.initialReplacementReview ?? null;
    this.condensationReview = deps.initialCondensationReview ?? null;

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

  private originalText(unit: ContextEditableUnit): string {
    return unit.atoms.map((atom) => atom.text).join("\n");
  }

  private contentText(unit: ContextEditableUnit, activeHit?: ContextSearchOccurrence): string {
    const text = this.showOriginal && this.currentUnit()?.unit.id === unit.id ? this.originalText(unit) : unit.effectiveText;
    if (!activeHit || this.showOriginal || activeHit.field === "tool_name" || activeHit.unitId !== unit.id) return text;
    return this.highlightText(text, activeHit.start, activeHit.end);
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
    const sourceIndex = this.records.flatMap(r => r.units).findIndex(u => u.id === unit.id) + 1;
    const covering = this.condensations.findIndex(c => c.sourceUnits.some(u => u.id === unit.id));
    const label = covering >= 0 ? this.text.condensationCovered(covering + 1) : this.text.contextState(modelState);
    const base = `${cursor} ${checkbox} #${sourceIndex} ${this.text.unitKind(unit.kind)} · ${this.text.recordKind(record.kind)} · ${this.text.unitState(state)} · ${label} · ${unit.atoms.reduce((sum, atom) => sum + atom.approxTokens, 0)} tok`;
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
    return this.condensationCardLines(width).length + this.flatUnits().reduce((sum, item) => sum + this.unitLineCount(item, width), 0);
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
    const item = this.currentUnit();
    const visibleHeight = item ? Math.min(viewport, this.unitLineCount(item, width)) : 1;
    if (selectedLine + visibleHeight > this.scrollOffset + viewport) this.scrollOffset = selectedLine + visibleHeight - viewport;
    this.scrollOffset = Math.max(0, this.scrollOffset);
  }

  private unitStartOffset(index: number, width: number): number {
    return this.condensationCardLines(width).length + this.flatUnits()
      .slice(0, index)
      .reduce((sum, item) => sum + this.unitLineCount(item, width), 0);
  }

  private bodyLineIndexForHit(unit: ContextEditableUnit, hit: ContextSearchOccurrence, width: number): number {
    if (hit.field === "tool_name") return 0;
    const text = unit.effectiveText;
    return Math.max(0, wrapTextWithAnsi(text.slice(0, hit.start) || " ", Math.max(8, width - 8)).length - 1);
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
    let lineOffset = this.condensationCardLines(width).length;
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
    const focusId = this.currentUnit()?.unit.id;
    const snapshot = this.loadSnapshot();
    this.records = this.loadRecords();
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.condensations = [...(snapshot.condensations ?? [])];
    this.projectionAvailable = snapshot.projectionAvailable !== false && !!this.previewContext && !!this.commitContext;
    const focusedIndex = focusId ? this.flatUnits().findIndex(({ unit }) => unit.id === focusId) : -1;
    this.selectedIndex = focusedIndex >= 0 ? focusedIndex : Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
    this.manualScroll = false;
    this.resetSelection();
    this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
    this.matchIndex = -1;
    this.ensureSelectionVisible();
    this.tui.requestRender();
  }

  private syncExternalState(): boolean {
    const focusId = this.currentUnit()?.unit.id;
    const snapshot = this.loadSnapshot();
    if (snapshot.revision === this.revision) return false;
    this.records = this.loadRecords();
    this.revision = snapshot.revision;
    this.canUndo = snapshot.canUndo;
    this.condensations = [...(snapshot.condensations ?? [])];
    this.projectionAvailable = snapshot.projectionAvailable !== false && !!this.previewContext && !!this.commitContext;
    const focusedIndex = focusId ? this.flatUnits().findIndex(({ unit }) => unit.id === focusId) : -1;
    this.selectedIndex = focusedIndex >= 0 ? focusedIndex : Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
    this.scrollOffset = 0;
    this.manualScroll = false;
    this.resetSelection();
    this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
    this.matchIndex = -1;
    this.pendingConfirmation = null;
    this.replacementReview = null;
    this.replacementReviewScrollOffset = 0;
    this.condensationGenerationNonce += 1;
    this.condensationAbortController?.abort();
    this.condensationAbortController = null;
    this.condensationSetup = null;
    this.condensationReview = null;
    this.condensationReviewScrollOffset = 0;
    this.notify(this.text.sessionChanged(), "info");
    return true;
  }

  private uiState(): ContextEditorUiState {
    return { checkedUnitIds: [...this.selected], query: this.query, searchScope: this.searchScope, selectedUnitId: this.currentUnit()?.unit.id, showOriginal: this.showOriginal };
  }

  private requestEdit(): void {
    if (this.isIdle && !this.isIdle()) { this.notify(this.text.replacementBusy(), "warning"); return; }
    if (!this.commitReplacement) { this.notify(this.text.contextUnavailableAction(), "warning"); return; }
    const selected = this.selectedUnitIds();
    if (selected.length > 1) { this.notify("Select exactly one User or Answer unit to edit.", "warning"); return; }
    const item = selected.length === 1 ? this.flatUnits().find(({ unit }) => unit.id === selected[0]) : this.currentUnit();
    if (!item) return;
    if (!item.unit.replacementSupported || (item.unit.kind !== "user" && item.unit.kind !== "answer")) {
      this.notify(this.text.operationFailed(item.unit.replacementDisabledReason ?? "unsupported-unit-kind"), "warning");
      return;
    }
    const unitKind = item.unit.kind as "user" | "answer";
    this.done({ kind: "edit", unitId: item.unit.id, unitKind, title: this.text.editTitle(this.text.unitKind(unitKind)), text: item.unit.effectiveText, originalText: this.originalText(item.unit), baseRevision: this.revision, operationId: replacementOperationId(), uiState: { ...this.uiState(), selectedUnitId: item.unit.id } });
  }

  private beginCondensation(): void {
    if (this.isIdle && !this.isIdle()) {
      this.notify(this.text.condensationBusy(), "warning");
      return;
    }
    if (!this.generateCondensation) {
      this.notify(this.text.contextUnavailableAction(), "warning");
      return;
    }
    const selected = this.selectedUnitIds();
    const unitIds = selected.length > 0
      ? selected
      : [this.currentUnit()?.unit.id].filter((id): id is string => !!id);
    const items = this.flatUnits().filter(({ unit }) => unitIds.includes(unit.id));
    if (!unitIds.length || items.length !== unitIds.length) {
      this.notify(this.text.condensationNoSelection(), "warning");
      return;
    }
    const canExpandRelated = unitIds.length === 1 && items[0]?.unit.kind === "answer";
    this.condensationError = null;
    this.condensationSetup = {
      unitIds: [...unitIds],
      baseRevision: this.revision,
      canExpandRelated,
      expandRelated: false,
      uiState: { ...this.uiState(), selectedUnitId: unitIds[0] },
    };
    this.condensationReview = null;
    this.condensationReviewScrollOffset = 0;
    this.tui.requestRender();
  }

  private condensationSetupLines(width: number): string[] {
    const setup = this.condensationSetup;
    if (!setup) return [];
    const wrap = (value: string): string[] => wrapTextWithAnsi(value, Math.max(8, width - 4)).map((line) => this.theme.fg("dim", "  " + line));
    if (this.operationInFlight) {
      return [
        this.theme.fg("warning", "[AI] " + this.text.condensationGenerating()),
        ...wrap(this.text.condensationSetup(setup.unitIds.length, setup.canExpandRelated, setup.expandRelated)),
        this.theme.fg("accent", this.text.condensationCancelHint()),
      ];
    }
    return [
      this.theme.fg("warning", "[AI] " + this.text.condensationSetupTitle()),
      ...wrap(this.text.condensationSetup(setup.unitIds.length, setup.canExpandRelated, setup.expandRelated)),
      ...(setup.canExpandRelated
        ? [this.theme.fg("accent", this.text.condensationExpandRelated(setup.expandRelated))]
        : [this.theme.fg("dim", this.text.condensationExpandDisabled())]),
      ...(this.condensationError ? wrap(this.condensationError) : []),
      this.theme.fg("accent", this.text.condensationSetupHint()),
    ];
  }

  private async startCondensationGeneration(): Promise<void> {
    const setup = this.condensationSetup;
    if (!setup || !this.generateCondensation || this.operationInFlight) return;
    this.operationInFlight = true;
    this.condensationError = null;
    const controller = new AbortController();
    const nonce = ++this.condensationGenerationNonce;
    this.condensationAbortController = controller;
    this.tui.requestRender();
    try {
      const preview = await this.generateCondensation({
        baseRevision: setup.baseRevision,
        unitIds: setup.unitIds,
        expandRelated: setup.expandRelated,
        signal: controller.signal,
      });
      if (nonce !== this.condensationGenerationNonce || controller.signal.aborted) return;
      this.condensationReview = {
        draft: {
          unitIds: [...setup.unitIds],
          baseRevision: setup.baseRevision,
          operationId: preview.operationId,
          expandRelated: setup.expandRelated,
          uiState: setup.uiState,
        },
        preview,
      };
      this.condensationSetup = null;
      this.condensationReviewScrollOffset = 0;
    } catch (error) {
      if (nonce !== this.condensationGenerationNonce) return;
      const message = error instanceof Error ? error.message : String(error);
      if (!controller.signal.aborted) {
        this.condensationError = this.text.condensationGenerationFailed(message);
        this.notify(this.condensationError, "warning");
      }
      this.condensationReview = null;
    } finally {
      if (nonce === this.condensationGenerationNonce) {
        this.condensationAbortController = null;
        this.operationInFlight = false;
        this.tui.requestRender();
      }
    }
  }

  private cancelCondensationGeneration(): void {
    this.condensationGenerationNonce += 1;
    this.condensationAbortController?.abort();
    this.condensationAbortController = null;
    this.operationInFlight = false;
    this.condensationSetup = null;
    this.tui.requestRender();
  }

  private condensationReviewLines(width: number): string[] {
    const review = this.condensationReview;
    if (!review) return [];
    const preview = review.preview;
    const wrap = (value: string): string[] => wrapTextWithAnsi(value, Math.max(8, width - 4)).map((line) => this.theme.fg("dim", "  " + line));
    const metrics = preview.metrics;
    const lines: string[] = [this.theme.fg("warning", "[AI] " + this.text.condensationReviewTitle())];
    lines.push(...wrap(this.text.condensationSource(preview.effectiveUnitIds.length, (preview.sourceEntryIds ?? []).length)));
    lines.push(...wrap(this.text.condensationModel(preview.provider, preview.model)));
    lines.push(...wrap(this.text.condensationMetrics(metrics.beforeTokens, metrics.afterTokens, metrics.savedTokens, metrics.savingsRatio)));
    if (preview.risks.length) lines.push(...wrap(this.text.condensationRisks(preview.risks)));
    if (preview.warnings?.length) lines.push(...wrap(this.text.condensationWarnings(preview.warnings)));
    lines.push(this.theme.fg("accent", this.text.condensationSummaryTitle()));
    lines.push(...wrap(preview.summary));
    lines.push(this.theme.fg("accent", this.text.condensationReviewHint()));
    return lines;
  }

  private scrollCondensationReview(delta: number): void {
    const lines = this.condensationReviewLines(Math.max(24, this.tui.terminal.columns));
    const maxOffset = Math.max(0, lines.length - this.availableRows());
    this.condensationReviewScrollOffset = Math.max(0, Math.min(maxOffset, this.condensationReviewScrollOffset + delta));
    this.tui.requestRender();
  }

  private async regenerateCondensation(): Promise<void> {
    const review = this.condensationReview;
    if (!review || !this.cancelCondensation || this.operationInFlight) return;
    try {
      await this.cancelCondensation(review.draft.operationId);
    } catch {
      // A pending candidate may already have been discarded by a session change.
    }
    this.condensationReview = null;
    this.condensationSetup = {
      unitIds: [...review.draft.unitIds],
      baseRevision: review.draft.baseRevision,
      canExpandRelated: review.draft.unitIds.length === 1 && this.flatUnits().find(({ unit }) => unit.id === review.draft.unitIds[0])?.unit.kind === "answer",
      expandRelated: review.draft.expandRelated,
      uiState: review.draft.uiState,
    };
    void this.startCondensationGeneration();
  }

  private handleCondensationSetupInput(data: string): void {
    const setup = this.condensationSetup;
    if (!setup) return;
    if (this.operationInFlight) {
      if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") this.cancelCondensationGeneration();
      return;
    }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") {
      this.condensationSetup = null;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "space") && setup.canExpandRelated) {
      setup.expandRelated = !setup.expandRelated;
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "enter")) void this.startCondensationGeneration();
  }

  private handleCondensationReviewInput(data: string): void {
    const review = this.condensationReview;
    if (!review) return;
    if (this.operationInFlight) return;
    if (matchesKey(data, "pageDown") || matchesKey(data, "down") || data === "j") {
      this.scrollCondensationReview(matchesKey(data, "pageDown") ? this.availableRows() : 1);
      return;
    }
    if (matchesKey(data, "pageUp") || matchesKey(data, "up") || data === "k") {
      this.scrollCondensationReview(matchesKey(data, "pageUp") ? -this.availableRows() : -1);
      return;
    }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") {
      this.condensationReview = null;
      this.done({ kind: "condensation-cancel", operationId: review.draft.operationId, uiState: review.draft.uiState });
      return;
    }
    if (data === "e") {
      this.condensationReview = null;
      this.done({ kind: "condensation-edit", review, uiState: review.draft.uiState });
      return;
    }
    if (data === "r") {
      void this.regenerateCondensation();
      return;
    }
    if (matchesKey(data, "enter")) {
      if (review.preview.validation && !review.preview.validation.ok) {
        this.notify(this.text.condensationBlocked(review.preview.validation.error ?? "invalid-summary"), "warning");
        return;
      }
      this.condensationReview = null;
      this.done({ kind: "condensation-commit", review, uiState: review.draft.uiState });
    }
  }

  private replacementReviewLines(width: number): string[] {
    const review = this.replacementReview;
    if (!review) return [];
    const preview = review.preview;
    const wrap = (value: string): string[] => wrapTextWithAnsi(value, Math.max(8, width - 4)).map((line) => this.theme.fg("dim", `  ${line}`));
    const lines: string[] = [this.theme.fg("warning", `⚠ ${this.text.replacementReviewTitle()}`)];
    lines.push(...wrap(this.text.replacementReviewAnswer(preview.textChanged)));
    if (preview.associatedReasoningUnitIds.length > 0) {
      lines.push(...wrap(this.text.replacementReviewLink(review.excludeAssociatedReasoning, preview.associatedReasoningUnitIds.length)));
      lines.push(...wrap(this.text.replacementReviewScope("associated", preview.associatedReasoningUnitIds)));
    }
    lines.push(...wrap(this.text.replacementReviewScope("newlyExcluded", preview.newlyExcludedUnitIds)));
    lines.push(...wrap(this.text.replacementReviewScope("alreadyExcluded", preview.alreadyExcludedUnitIds)));
    if (preview.autoExpandedUnitIds.length > 0) {
      lines.push(...wrap(this.text.replacementReviewScope("autoExpanded", preview.autoExpandedUnitIds)));
      if (preview.requiresConfirmation) lines.push(...wrap(this.text.replacementReviewConfirmationRequired(preview.autoExpandedUnitIds.length)));
    }
    if (!preview.canCommit) lines.push(...wrap(this.text.replacementReviewBlocked(preview.disabledReason ?? "unavailable")));
    if (!preview.textChanged && preview.newlyExcludedAtomIds.length === 0) lines.push(...wrap(this.text.replacementReviewNoop()));
    lines.push(this.theme.fg("accent", this.text.replacementReviewHint()));
    return lines;
  }

  private scrollReplacementReview(delta: number): void {
    const lines = this.replacementReviewLines(Math.max(24, this.tui.terminal.columns));
    const maxOffset = Math.max(0, lines.length - this.availableRows());
    this.replacementReviewScrollOffset = Math.max(0, Math.min(maxOffset, this.replacementReviewScrollOffset + delta));
    this.tui.requestRender();
  }
  private async toggleReplacementReviewLink(): Promise<void> {
    const review = this.replacementReview;
    if (!review || !this.previewReplacement || review.preview.associatedReasoningUnitIds.length === 0) return;
    const enabled = !review.excludeAssociatedReasoning;
    this.operationInFlight = true;
    this.tui.requestRender();
    try {
      const preview = await this.previewReplacement({
        baseRevision: review.draft.baseRevision,
        operationId: review.draft.operationId,
        unitId: review.draft.unitId,
        text: review.draft.text,
        excludeAssociatedReasoning: enabled,
      });
      if (!preview.canCommit && preview.disabledReason === "revision-conflict") {
        this.replacementReview = null;
        this.replacementReviewScrollOffset = 0;
        this.notify(this.text.sidecarChanged(), "warning");
        this.done({ kind: "cancel-edit", uiState: review.draft.uiState });
        return;
      }
      this.replacementReview = { ...review, preview, excludeAssociatedReasoning: enabled };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(message === "CONTEXT_EDITOR_CONFLICT" ? this.text.sidecarChanged() : this.text.operationFailed(message), "warning");
    } finally {
      this.operationInFlight = false;
      this.tui.requestRender();
    }
  }

  private handleReplacementReviewInput(data: string): void {
    const review = this.replacementReview;
    if (!review) return;
    if (matchesKey(data, "pageDown") || matchesKey(data, "down") || data === "j") {
      this.scrollReplacementReview(matchesKey(data, "pageDown") ? this.availableRows() : 1);
      return;
    }
    if (matchesKey(data, "pageUp") || matchesKey(data, "up") || data === "k") {
      this.scrollReplacementReview(matchesKey(data, "pageUp") ? -this.availableRows() : -1);
      return;
    }
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") {
      this.replacementReview = null;
      this.done({ kind: "cancel-edit", uiState: review.draft.uiState });
      return;
    }
    if (data === "e") {
      this.replacementReview = null;
      this.done({ kind: "edit", ...review.draft, excludeAssociatedReasoning: review.excludeAssociatedReasoning });
      return;
    }
    if (matchesKey(data, "space")) {
      void this.toggleReplacementReviewLink();
      return;
    }
    if (matchesKey(data, "enter")) {
      if (!review.preview.canCommit) {
        this.notify(this.text.replacementReviewBlocked(review.preview.disabledReason ?? "unavailable"), "warning");
        return;
      }
      this.replacementReview = null;
      this.done({ kind: "replacement-commit", review, uiState: review.draft.uiState });
    }
  }
  private beginRestoreReplacement(): void {
    if (this.isIdle && !this.isIdle()) { this.notify(this.text.replacementBusy(), "warning"); return; }
    if (this.operationInFlight || this.pendingConfirmation || !this.restoreReplacement) return;
    const selected = this.selectedUnitIds();
    if (selected.length > 1) { this.notify("Select exactly one User or Answer unit to restore.", "warning"); return; }
    const item = selected.length === 1 ? this.flatUnits().find(({ unit }) => unit.id === selected[0]) : this.currentUnit();
    if (!item || !item.unit.canRestoreReplacement) return;
    this.pendingConfirmation = { kind: "replacement-restore", unitId: item.unit.id, message: this.text.replacementRestoreMessage() };
    this.tui.requestRender();
  }

  private async commitPendingReplacementRestore(pending: Extract<PendingConfirmation, { kind: "replacement-restore" }>): Promise<void> {
    if (this.operationInFlight || !this.restoreReplacement) return;
    this.operationInFlight = true;
    try {
      const result = await this.restoreReplacement({ baseRevision: this.revision, operationId: replacementOperationId(), unitId: pending.unitId });
      if (!result.ok || result.conflict) { this.notify(this.text.sidecarChanged(), "warning"); this.refreshData(); return; }
      this.refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(message === "AGENT_RUNTIME_BUSY" ? this.text.busy() : this.text.operationFailed(message), "warning");
    } finally { this.operationInFlight = false; this.tui.requestRender(); }
  }

  private async undoCurrentReplacement(): Promise<void> {
    if (this.isIdle && !this.isIdle()) { this.notify(this.text.replacementBusy(), "warning"); return; }
    if (this.operationInFlight || !this.undoReplacement) return;
    const selected = this.selectedUnitIds();
    if (selected.length > 1) { this.notify("Select exactly one User or Answer unit to undo.", "warning"); return; }
    const item = selected.length === 1 ? this.flatUnits().find(({ unit }) => unit.id === selected[0]) : this.currentUnit();
    if (!item || !item.unit.canUndoReplacement) return;
    this.operationInFlight = true;
    try {
      const result = await this.undoReplacement({ baseRevision: this.revision, operationId: replacementOperationId(), unitId: item.unit.id });
      if (!result.ok || result.conflict) { this.notify(this.text.sidecarChanged(), "warning"); this.refreshData(); return; }
      this.refreshData();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notify(message === "AGENT_RUNTIME_BUSY" ? this.text.busy() : this.text.operationFailed(message), "warning");
    } finally { this.operationInFlight = false; this.tui.requestRender(); }
  }
  private condensationCardLines(width: number): string[] {
    if (this.condensations.length === 0) return [];
    const wrap = (value: string): string[] => wrapTextWithAnsi(value, Math.max(8, width - 4)).map((line) => this.theme.fg("dim", "  " + line));
    const lines: string[] = [];
    for (const [cardIndex, condensation] of this.condensations.entries()) {
      const state = condensation.contextExcluded ? this.text.condensationCardExcluded() : this.text.condensationCardActive();
      lines.push(this.theme.fg("accent", this.text.condensationCardTitle(condensation.operationId, state)));
      lines.push(...wrap(this.condensationCardExpanded ? condensation.summary : condensation.summary.split(/\r?\n/)[0]!.slice(0, 100)));
      lines.push(...wrap(this.text.condensationSourceList(cardIndex + 1, condensation.sourceUnits.length)));
      lines.push(...wrap(this.text.condensationCardMetrics(condensation.metrics.savedTokens, condensation.metrics.savingsRatio)));
      if (condensation.coverage) {
        lines.push(...wrap(this.text.condensationCoverage(condensation.coverage.status, condensation.coverage.restoreMode)));
        if (condensation.coverage.status !== "none" || condensation.coverage.restoreMode === "unavailable") {
          lines.push(...wrap(this.text.condensationRestoreRequired(condensation.coverage.restoreMode, condensation.coverage.checkpointEntryId)));
        }
      }
      const allUnits = this.records.flatMap(record => record.units);
      for (const source of condensation.sourceUnits) {
        const sourceIndex = allUnits.findIndex(unit => unit.id === source.id) + 1;
        const title = '#' + (sourceIndex || '?') + ' ' + this.text.unitKind(source.kind) + ' · ' + source.id;
        lines.push(...wrap(title));
        const content = source.text || this.text.contextState("exclude");
        lines.push(...wrap(this.condensationCardExpanded ? content : content.replace(/\s+/g, ' ').slice(0, 100)));
      }
    }
    return lines;
  }

  private async toggleCondensationSurface(): Promise<void> {
    const condensation = this.condensations[0];
    if (!condensation || this.operationInFlight || !this.previewContext || !this.commitContext) return;
    this.operationInFlight = true;
    const action = condensation.contextExcluded ? "restore" : "exclude";
    try {
      const preview = await this.previewContext({ baseRevision: this.revision, action, condensationOperationId: condensation.operationId });
      const result = await this.commitContext({ baseRevision: preview.baseRevision, action, condensationOperationId: condensation.operationId });
      if (!result.ok || result.conflict) {
        if (result.restoreRequired) this.notify(this.text.condensationRestoreRequired(result.restoreMode ?? "unavailable", result.checkpointEntryId), "warning");
        else this.notify(this.text.sidecarChanged(), "warning");
        this.refreshData();
      } else {
        this.refreshData();
      }
    } catch (error) {
      this.notify(this.text.operationFailed(error instanceof Error ? error.message : String(error)), "warning");
    } finally {
      this.operationInFlight = false;
      this.tui.requestRender();
    }
  }

  private async restoreActiveCondensation(): Promise<void> {
    const condensation = this.condensations[0];
    if (!condensation || this.operationInFlight || !this.restoreCondensation) return;
    if (this.isIdle && !this.isIdle()) {
      this.notify(this.text.condensationBusy(), "warning");
      return;
    }
    this.operationInFlight = true;
    try {
      const result = await this.restoreCondensation({ baseRevision: this.revision, operationId: condensation.operationId });
      if (!result.ok || result.conflict) {
        if (result.restoreRequired) this.notify(this.text.condensationRestoreRequired(result.restoreMode ?? "unavailable", result.checkpointEntryId), "warning");
        else this.notify(this.text.sidecarChanged(), "warning");
        this.refreshData();
      } else {
        this.refreshData();
        this.notify(this.text.condensationRestored(), "info");
      }
    } catch (error) {
      this.notify(this.text.operationFailed(error instanceof Error ? error.message : String(error)), "warning");
    } finally {
      this.operationInFlight = false;
      this.tui.requestRender();
    }
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
        if (result.restoreRequired) this.notify(this.text.condensationRestoreRequired(result.restoreMode ?? "unavailable", result.checkpointEntryId), "warning");
        else this.notify(this.text.sidecarChanged(), "warning");
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
    if (pending.kind === "replacement-restore") {
      void this.commitPendingReplacementRestore(pending);
      return;
    }
    void this.commitPendingProjection(pending);
  }
  private applyMutation(action: "hide" | "restore" | "reset"): void {
    const unitIds = action === "reset" ? undefined : this.selectedUnitIds().length > 0 ? this.selectedUnitIds() : [this.currentUnit()?.unit.id].filter((id): id is string => !!id);
    try {
      const result = this.mutate({ baseRevision: this.revision, action, ...(unitIds ? { unitIds } : {}) });
      if (!result.ok || result.conflict) {
        if (result.restoreRequired) this.notify(this.text.condensationRestoreRequired(result.restoreMode ?? "unavailable", result.checkpointEntryId), "warning");
        else this.notify(this.text.sidecarChanged(), "warning");
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
      this.rangeAnchor = null;
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
      : pending.kind === "reset"
        ? this.text.restoreAllConfirmTitle()
        : this.text.replacementRestoreTitle();
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
    if (this.condensationSetup) {
      this.handleCondensationSetupInput(data);
      return;
    }
    if (this.condensationReview) {
      this.handleCondensationReviewInput(data);
      return;
    }
    if (this.replacementReview) {
      if (this.operationInFlight) return;
      this.handleReplacementReviewInput(data);
      return;
    }
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
      this.done({ kind: "close" });
      return;
    }
    if (data === "q" || data === "Q") {
      this.done({ kind: "close" });
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
    if (data === "c") { this.beginCondensation(); return; }
    if (data === "C") { void this.toggleCondensationSurface(); return; }
    if (data === "D") { void this.restoreActiveCondensation(); return; }
    if (data === "O") { this.condensationCardExpanded = !this.condensationCardExpanded; this.scrollOffset = 0; this.manualScroll = true; this.tui.requestRender(); return; }
    if (data === "e") { this.requestEdit(); return; }
    if (data === "E") { this.beginRestoreReplacement(); return; }
    if (data === "z") { void this.undoCurrentReplacement(); return; }
    if (data === "o") { this.showOriginal = !this.showOriginal; this.tui.requestRender(); return; }
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
    if (this.condensationReview) {
      const reviewLines = this.condensationReviewLines(safeWidth);
      const maxOffset = Math.max(0, reviewLines.length - viewport);
      this.condensationReviewScrollOffset = Math.max(0, Math.min(this.condensationReviewScrollOffset, maxOffset));
      visible = reviewLines.slice(this.condensationReviewScrollOffset, this.condensationReviewScrollOffset + viewport);
    } else if (this.condensationSetup) {
      visible = this.condensationSetupLines(safeWidth).slice(0, viewport);
    } else if (this.replacementReview) {
      const reviewLines = this.replacementReviewLines(safeWidth);
      const maxOffset = Math.max(0, reviewLines.length - viewport);
      this.replacementReviewScrollOffset = Math.max(0, Math.min(this.replacementReviewScrollOffset, maxOffset));
      visible = reviewLines.slice(this.replacementReviewScrollOffset, this.replacementReviewScrollOffset + viewport);
    } else if (this.pendingConfirmation) {
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
      const card = this.condensationCardLines(safeWidth);
      const end = this.scrollOffset + viewport;
      visible = [...card.slice(this.scrollOffset, end), ...this.renderWindow(safeWidth, this.scrollOffset, end)];
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
    const mode = this.condensationReview || this.condensationSetup
      ? this.theme.fg("warning", this.text.contextAwaiting())
      : this.replacementReview
      ? this.theme.fg("warning", this.text.contextAwaiting())
      : this.pendingConfirmation
      ? this.theme.fg("warning", this.text.contextAwaiting())
      : this.helpMode
      ? this.theme.fg("dim", "")
      : this.searchMode
      ? this.theme.fg("warning", this.text.tuiSearch(this.query, this.matches.length, this.matchIndex, this.searchScope))
      : this.theme.fg("dim", this.text.tuiSearchIdle(this.query, this.matches.length, this.matchIndex, this.searchScope));
    const filterLine = this.helpMode || this.pendingConfirmation || this.replacementReview || this.condensationSetup || this.condensationReview ? "" : `${enabled("user")} [1]  ${aiLabel} [2] (${enabled("reasoning")} [4]  ${enabled("answer")} [5])  ${enabled("tool")} [3]`;
    const statusMode = this.helpMode ? "help" : this.searchMode ? "search" : this.matches.length > 0 ? "results" : "normal";
    const status = this.condensationReview
      ? this.theme.fg("dim", this.text.condensationReviewHint())
      : this.condensationSetup
      ? this.theme.fg("dim", this.operationInFlight ? this.text.condensationCancelHint() : this.text.condensationSetupHint())
      : this.replacementReview
      ? this.theme.fg("dim", this.text.replacementReviewHint())
      : this.pendingConfirmation
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
