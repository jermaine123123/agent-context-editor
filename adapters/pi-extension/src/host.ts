import { sessionEntryToContextMessages, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  branchRevision,
  contextEditorBranchRevisionParts,
  ContextEditorService,
  stableFingerprint,
  type ContextEditorHostAdapter,
  type ContextEditorPrefs,
  type ContextEditorSessionAdapter,
  type ContextEditorSnapshot,
  type ContextEditorViewEventV2,
  type ContextMutationResult,
  type ContextRecord,
  type ContextRecordDetail,
  type ContextRecordPage,
  type ContextSearchMatch,
  type ContextSearchMatchRequest,
  type ContextSearchRequest,
  type ContextSearchScope,
  type ContextSearchSummary,
  type ContextSessionLocator,
  type ContextViewMutationRequest,
  type ContextProjectionMutationRequest,
  type ContextProjectionPreview,
  type ContextProjectionEvent,
  type ContextReplacementMutationRequest,
  type ContextReplacementPreview,
  type ContextReplacementUnitRequest,
  type ContextCondensationPrepareRequest,
  type ContextCondensationPreview,
  type ContextCondensationCommitRequest,
  type ContextCondensationRestoreRequest,
  type ContextCondensationCancelRequest,
  type ContextCondensationEventV1,
  type ContextCondensationSnapshot,
  selectCondensationRange,
  reduceProjectionStates,
  validateCondensationSummary,
  frameCondensationSummary,
  estimateCondensationTokens,
} from "./shared-core/index.js";
import { appendProjectionSidecarEvent, readProjectionSidecar } from "./projection-sidecar.js";
import { readSidecar, appendSidecarEvent, writeSidecarPrefs } from "./sidecar.js";
import { normalizeSessionEntries } from "./normalize.js";
import { activePiCondensationEvents, buildPiCondensationEvent, condensationInstruction } from "./condensation-host.js";

const service = new ContextEditorService();

function asLocator(value: ContextSessionLocator | undefined, sessionId: string): void {
  if (value && value.sessionId !== sessionId) throw new Error("CONTEXT_EDITOR_SESSION_MISMATCH");
}

export class PiContextEditorHost implements ContextEditorSessionAdapter, ContextEditorHostAdapter {
  readonly capabilities = {
    paging: false,
    search: true,
    viewMutation: true,
    undo: true,
    persistence: true,
    contextExclusion: true as const,
    contextReplacement: true as const,
    contextCondensation: true as const,
  };

  private readonly condensationOperations = new Map<string, { proposal: ContextCondensationPreview; event: ContextCondensationEventV1 }>();
  private readonly condensationControllers = new Map<string, AbortController>();

  constructor(private readonly ctx: ExtensionContext) {}

  get sessionFile(): string {
    return this.ctx.sessionManager.getSessionFile() ?? "memory-session.jsonl";
  }

  get sessionId(): string {
    return this.ctx.sessionManager.getSessionId() ?? this.sessionFile;
  }

  private branchEntries(): unknown[] {
    return this.ctx.sessionManager.getBranch() as unknown[];
  }

  read() {
    const entries = this.branchEntries();
    const atoms = normalizeSessionEntries(entries);
    const leafId = this.ctx.sessionManager.getLeafId();
    const sidecar = readSidecar(this.sessionFile, this.sessionId);
    const projection = readProjectionSidecar(this.sessionFile, this.sessionId);
    const branchIds = new Set(entries.map((entry) => String((entry as { id?: unknown }).id ?? "")));
    const viewEvents = sidecar.document.events
      .filter((envelope) => envelope.anchorEntryId.length === 0 || branchIds.has(envelope.anchorEntryId))
      .map((envelope) => envelope.event);
    const projectionEvents = projection.integrity === "ok"
      ? projection.document.events
        .filter((envelope) => envelope.anchorEntryId.length === 0 || branchIds.has(envelope.anchorEntryId))
        .map((envelope) => envelope.event)
      : [];
    const branchParts = contextEditorBranchRevisionParts(entries);
    const revision = branchRevision(leafId, atoms, [...branchParts, sidecar.viewRevision, projection.revision]);
    const revisionProbe = stableFingerprint([
      this.sessionFile,
      this.sessionId,
      leafId ?? "",
      sidecar.viewRevision,
      projection.revision,
      revision,
      ...branchParts,
    ]);
    return {
      entries, atoms, leafId, revision, revisionProbe, viewEvents, projectionEvents,
      projectionAvailable: projection.integrity !== "invalid",
      ...(projection.error ? { projectionError: projection.error } : {}),
      projectionRevision: projection.revision,
    };
  }

  appendViewEvent(event: ContextEditorViewEventV2): string {
    if (!this.ctx.isIdle()) throw new Error("AGENT_RUNTIME_BUSY");
    const current = this.read();
    if (String(current.revision) !== String(event.baseRevision)) throw new Error("CONTEXT_EDITOR_CONFLICT");
    const sidecar = readSidecar(this.sessionFile, this.sessionId);
    // Re-read the active branch immediately before taking the sidecar lock.
    // This closes the normal race where a Session append lands while the TUI
    // is preparing a view event; the sidecar writer then fails closed instead
    // of attaching a stale event to a new branch revision.
    const latest = this.read();
    if (latest.revision !== current.revision) throw new Error("CONTEXT_EDITOR_CONFLICT");
    return appendSidecarEvent(
      this.sessionFile,
      this.sessionId,
      current.leafId ?? "",
      event,
      sidecar.revision,
    );
  }

  appendProjectionEvent(event: ContextProjectionEvent): string {
    if (!this.ctx.isIdle()) throw new Error("AGENT_RUNTIME_BUSY");
    const current = this.read();
    if (current.projectionAvailable === false) throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
    if (String(current.revision) !== String(event.baseRevision)) throw new Error("CONTEXT_EDITOR_CONFLICT");
    const sidecar = readProjectionSidecar(this.sessionFile, this.sessionId);
    if (sidecar.integrity === "invalid") throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
    const latest = this.read();
    if (latest.revision !== current.revision) throw new Error("CONTEXT_EDITOR_CONFLICT");
    return appendProjectionSidecarEvent(
      this.sessionFile,
      this.sessionId,
      current.leafId ?? "",
      event,
      sidecar.revision,
    );
  }

  previewReplacementMutation(input: Pick<ContextReplacementMutationRequest, "baseRevision" | "unitId" | "text" | "excludeAssociatedReasoning"> & Partial<Pick<ContextReplacementMutationRequest, "operationId">>): ContextReplacementPreview {
    return service.previewReplacement(this, input);
  }

  commitReplacementMutation(input: Pick<ContextReplacementMutationRequest, "baseRevision" | "unitId" | "text" | "excludeAssociatedReasoning" | "confirmedUnitIds" | "confirmationScope"> & Partial<Pick<ContextReplacementMutationRequest, "operationId">>): ContextMutationResult {
    try {
      return service.commitReplacement(this, input);
    } catch (error) {
      if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) {
        return { ok: false, conflict: true, snapshot: this.snapshot() };
      }
      throw error;
    }
  }

  restoreReplacementMutation(input: Pick<ContextReplacementUnitRequest, "baseRevision" | "unitId"> & Partial<Pick<ContextReplacementUnitRequest, "operationId">>): ContextMutationResult {
    try {
      return service.restoreReplacement(this, input);
    } catch (error) {
      if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) {
        return { ok: false, conflict: true, snapshot: this.snapshot() };
      }
      throw error;
    }
  }

  undoReplacementMutation(input: Pick<ContextReplacementUnitRequest, "baseRevision" | "unitId"> & Partial<Pick<ContextReplacementUnitRequest, "operationId">>): ContextMutationResult {
    try {
      return service.undoReplacement(this, input);
    } catch (error) {
      if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) {
        return { ok: false, conflict: true, snapshot: this.snapshot() };
      }
      throw error;
    }
  }

  isBusy(): boolean {
    return !this.ctx.isIdle();
  }

  getPrefs(): ContextEditorPrefs {
    return readSidecar(this.sessionFile, this.sessionId).document.prefs;
  }

  setPrefs(prefs: ContextEditorPrefs): void {
    if (!this.ctx.isIdle()) return;
    writeSidecarPrefs(this.sessionFile, this.sessionId, prefs);
  }

  records(): ContextRecord[] {
    return service.getRecords(this);
  }

  snapshot(): ContextEditorSnapshot {
    const snapshot = service.getSnapshot(this);
    const projectionEvents = this.read().projectionEvents ?? [];
    const byOperation = new Map<string, { event: ContextCondensationEventV1; contextExcluded: boolean }>();
    for (const event of projectionEvents) {
      if (!("type" in event) || event.type !== "condensation") continue;
      if (event.action === "apply") byOperation.set(event.operationId, { event, contextExcluded: false });
      else if (event.action === "restore") byOperation.delete(event.operationId);
      else {
        const current = byOperation.get(event.operationId);
        if (current) current.contextExcluded = event.action === "exclude-summary";
      }
    }
    const condensations: ContextCondensationSnapshot[] = [...byOperation.values()].map(({ event, contextExcluded }) => ({
      operationId: event.operationId,
      status: "applied",
      contextExcluded,
      summary: event.summary,
      requestedUnitIds: event.requestedUnitIds,
      effectiveUnitIds: event.effectiveUnitIds,
      autoExpandedUnitIds: event.autoExpandedUnitIds ?? [],
      recordIds: event.recordIds ?? [],
      sourceRootSeqs: event.sourceRootSeqs,
      ...(event.sourceFingerprint ? { sourceFingerprint: event.sourceFingerprint } : {}),
      sourceUnits: event.sourceUnits,
      metrics: event.metrics,
      provider: event.provider,
      model: event.model,
      createdAt: event.createdAt,
    }));
    return {
      ...snapshot,
      capabilities: this.capabilities,
      ...(condensations.length ? { condensations } : {}),
    };
  }

  search(query: string, enabledKinds: readonly ("user" | "ai" | "tool")[], scope?: ContextSearchScope, enabledUnitKinds?: ContextSearchRequest["enabledUnitKinds"]): ContextSearchSummary {
    return service.searchContextRecords(this, { query, enabledKinds, enabledUnitKinds, scope });
  }

  searchMatch(input: { searchId: string; revision?: string; index: number }): ContextSearchMatch | null {
    return service.getContextSearchMatch(this, input);
  }

  commit(input: Pick<ContextViewMutationRequest, "baseRevision" | "action" | "recordIds" | "unitIds">): ContextMutationResult {
    try {
      return service.commitContextView(this, input);
    } catch (error) {
      if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) {
        return { ok: false, conflict: true, snapshot: this.snapshot() };
      }
      throw error;
    }
  }

  undo(baseRevision: string): ContextMutationResult {
    try {
      return service.undoContextView(this, { baseRevision });
    } catch (error) {
      if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) {
        return { ok: false, conflict: true, snapshot: this.snapshot() };
      }
      throw error;
    }
  }

  private currentCondensation(operationId: string): ContextCondensationEventV1 | undefined {
    let active: ContextCondensationEventV1 | undefined;
    for (const event of this.read().projectionEvents ?? []) {
      if (!("type" in event) || event.type !== "condensation" || event.operationId !== operationId) continue;
      if (event.action === "apply") active = event;
      else if (event.action === "restore") active = undefined;
    }
    return active;
  }

  private condensationRange(request: ContextCondensationPrepareRequest) {
    const current = this.read();
    if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
    const records = this.records();
    const requested = Array.from(new Set(request.unitIds.map(String).filter(Boolean)));
    if (!requested.length) throw new Error("CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY");
    const positions = new Map<string, number>();
    let flatPosition = 0;
    for (const record of records) for (const unit of record.units) positions.set(unit.id, flatPosition++);
    const selectedPositions = requested.map((id) => positions.get(id)).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
    if (selectedPositions.length !== requested.length) throw new Error("CONTEXT_EDITOR_CONDENSATION_UNAVAILABLE");
    const target = records.flatMap((record) => record.units).find((unit) => unit.id === requested[0]);
    const expandRelated = request.expandRelated === true && requested.length === 1 && target?.kind === "answer";
    for (let index = 1; index < selectedPositions.length; index += 1) {
      if (selectedPositions[index]! !== selectedPositions[index - 1]! && selectedPositions[index]! !== selectedPositions[index - 1]! + 1) {
        throw new Error("CONTEXT_EDITOR_CONDENSATION_NON_CONTIGUOUS");
      }
    }
    const projectionStates = reduceProjectionStates(current.atoms, current.projectionEvents ?? []);
    const range = selectCondensationRange(records, requested, projectionStates, { expandRelated });
    if (!range.effectiveUnitIds.length) throw new Error("CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY");
    if (range.unavailableUnitIds.length) throw new Error("CONTEXT_EDITOR_CONDENSATION_UNAVAILABLE:" + range.unavailableUnitIds.join(","));
    const opaque = range.sourceUnits.find((source) => source.hasSignature || source.structured);
    if (opaque) throw new Error("CONTEXT_EDITOR_CONDENSATION_OPAQUE_CONTENT:" + opaque.id);
    const entryIds = new Set(range.sourceEntryIds ?? range.sourceUnits.flatMap((unit) => unit.sourceEntryIds ?? []));
    for (const event of activePiCondensationEvents(current.projectionEvents ?? [])) {
      if ([...entryIds].some((id) => (event.sourceEntryIds ?? []).includes(id))) {
        throw new Error("CONTEXT_EDITOR_CONDENSATION_OVERLAP:" + event.operationId);
      }
    }
    return { current, records, range, expandRelated };
  }

  private async condensationModel(provider?: string, modelId?: string) {
    if (provider && modelId) {
      const found = this.ctx.modelRegistry.find(provider, modelId);
      if (found) return found;
    }
    if (this.ctx.model) return this.ctx.model;
    const available = await this.ctx.modelRegistry.getAvailable();
    const found = available[0];
    if (!found) throw new Error("CONTEXT_EDITOR_CONDENSATION_MODEL_REQUIRED");
    return found;
  }

  async prepareCondensation(request: ContextCondensationPrepareRequest): Promise<ContextCondensationPreview> {
    return this.generateCondensation(request);
  }

  async generateCondensation(request: ContextCondensationPrepareRequest): Promise<ContextCondensationPreview> {
    if (!this.ctx.isIdle()) throw new Error("CONTEXT_EDITOR_BUSY");
    const prepared = this.condensationRange(request);
    const model = await this.condensationModel(request.provider, request.model);
    const operationId = "condensation-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
    const controller = new AbortController();
    if (request.signal?.aborted) throw new Error("CONTEXT_EDITOR_CONDENSATION_CANCELLED");
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    this.condensationControllers.set(operationId, controller);
    const source = prepared.range.sourceUnits.filter((unit) => unit.included);
    const beforeTokens = source.reduce((sum, unit) => sum + unit.approxTokens, 0);
    try {
      const instruction = condensationInstruction(prepared.range);
      const response = await this.ctx.modelRegistry.complete(model, {
        messages: [{ role: "user", content: [{ type: "text", text: instruction }], timestamp: Date.now() }],
      }, { maxTokens: request.maxTokens ?? 4096, signal: controller.signal });
      if (response.stopReason === "aborted") throw new Error("CONTEXT_EDITOR_CONDENSATION_CANCELLED");
      if (response.stopReason === "error") throw new Error("CONTEXT_EDITOR_CONDENSATION_MODEL_ERROR: " + String(response.errorMessage ?? "unknown error"));
      const summary = response.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
      const summaryTokens = estimateCondensationTokens(frameCondensationSummary(summary));
      const validation = validateCondensationSummary(summary, beforeTokens, { summaryTokens });
      if (!validation.ok) {
        const error = validation.error === "empty-summary" ? "CONTEXT_EDITOR_CONDENSATION_EMPTY" : validation.error === "not-smaller" ? "CONTEXT_EDITOR_CONDENSATION_NOT_SHORTER" : "CONTEXT_EDITOR_CONDENSATION_TRUNCATED";
        throw new Error(error);
      }
      const operation = operationId;
      const proposal = {
        schemaVersion: 1 as const,
        operationId: operation,
        sessionId: this.sessionId,
        baseRevision: prepared.current.revision,
        requestedUnitIds: prepared.range.requestedUnitIds,
        effectiveUnitIds: prepared.range.effectiveUnitIds,
        autoExpandedUnitIds: prepared.range.autoExpandedUnitIds,
        recordIds: prepared.range.recordIds,
        ...(prepared.range.sourceEntryIds?.length ? { sourceEntryIds: prepared.range.sourceEntryIds } : {}),
        sourceRootSeqs: prepared.range.sourceRootSeqs,
        sourceUnits: prepared.range.sourceUnits,
        summary,
        provider: model.provider,
        model: model.id,
        metrics: validation.metrics,
        prefixTokens: 0,
        prefixReused: false,
        summaryTokens,
        risks: prepared.range.risks,
        createdAt: new Date().toISOString(),
        warnings: validation.warnings.concat("prefix-not-reused"),
        sourceFingerprint: prepared.range.sourceFingerprint,
      };
      const event = buildPiCondensationEvent({
        sessionId: this.sessionId,
        baseRevision: prepared.current.revision,
        operationId: operation,
        range: prepared.range,
        summary,
        provider: model.provider,
        model: model.id,
        prefixTokens: 0,
        prefixReused: false,
        createdAt: proposal.createdAt,
        entries: prepared.current.entries,
        excludedAtomIds: new Set([...reduceProjectionStates(prepared.current.atoms, prepared.current.projectionEvents ?? []).entries()].filter(([, state]) => state === "exclude" || state === "unavailable").map(([id]) => id)),
      }, prepared.current.atoms);
      event.metrics = validation.metrics;
      this.condensationOperations.set(operation, { proposal: proposal as ContextCondensationPreview, event });
      return {
        ok: true,
        ...proposal,
        range: prepared.range,
        validation,
        snapshot: this.snapshot(),
      };
    } finally {
      request.signal?.removeEventListener("abort", abort);
      this.condensationControllers.delete(operationId);
    }
  }

  async cancelCondensation(request: ContextCondensationCancelRequest): Promise<{ ok: boolean; operationId: string; cancelled: boolean }> {
    asLocator(request.locator, this.sessionId);
    const controller = this.condensationControllers.get(request.operationId);
    if (controller) controller.abort();
    const cancelled = this.condensationOperations.delete(request.operationId) || !!controller;
    return { ok: true, operationId: request.operationId, cancelled };
  }

  async commitCondensation(request: ContextCondensationCommitRequest): Promise<ContextMutationResult> {
    asLocator(request.locator, this.sessionId);
    if (!this.ctx.isIdle()) throw new Error("CONTEXT_EDITOR_BUSY");
    const pending = this.condensationOperations.get(request.operationId);
    const active = this.currentCondensation(request.operationId);
    if (active) {
      if (request.summary.trim() !== active.summary.trim()) throw new Error("CONTEXT_EDITOR_CONDENSATION_OPERATION_REUSED");
      return { ok: true, operationId: request.operationId, eventId: active.eventId, snapshot: this.snapshot() };
    }
    if (!pending) throw new Error("CONTEXT_EDITOR_CONDENSATION_PROPOSAL_NOT_FOUND");
    const current = this.read();
    if (String(request.baseRevision) !== String(current.revision)) return { ok: false, conflict: true, operationId: request.operationId, snapshot: this.snapshot() };
    const range = this.condensationRange({
      locator: request.locator,
      baseRevision: current.revision,
      unitIds: request.unitIds ?? pending.proposal.requestedUnitIds,
      expandRelated: pending.proposal.autoExpandedUnitIds.length > 0,
    });
    if (range.range.sourceFingerprint !== pending.proposal.sourceFingerprint) throw new Error("CONTEXT_EDITOR_CONDENSATION_CONFLICT");
    const beforeTokens = range.range.sourceUnits.filter((unit) => unit.included).reduce((sum, unit) => sum + unit.approxTokens, 0);
    const summaryTokens = estimateCondensationTokens(frameCondensationSummary(request.summary));
    const validation = validateCondensationSummary(request.summary, beforeTokens, { summaryTokens });
    if (!validation.ok) throw new Error("CONTEXT_EDITOR_CONDENSATION_NOT_SHORTER");
    const event = buildPiCondensationEvent({
      sessionId: this.sessionId,
      baseRevision: current.revision,
      operationId: request.operationId,
      range: range.range,
      summary: request.summary.trim(),
      provider: pending.proposal.provider,
      model: pending.proposal.model,
      entries: current.entries,
      excludedAtomIds: new Set([...reduceProjectionStates(current.atoms, current.projectionEvents ?? []).entries()].filter(([, state]) => state === "exclude" || state === "unavailable").map(([id]) => id)),
    }, current.atoms);
    event.metrics = validation.metrics;
    const eventId = this.appendProjectionEvent(event);
    this.condensationOperations.delete(request.operationId);
    return { ok: true, operationId: request.operationId, eventId, snapshot: this.snapshot() };
  }

  async restoreCondensation(request: ContextCondensationRestoreRequest): Promise<ContextMutationResult> {
    asLocator(request.locator, this.sessionId);
    const active = this.currentCondensation(request.operationId);
    if (!active) return { ok: true, operationId: request.operationId, snapshot: this.snapshot() };
    const current = this.read();
    if (String(request.baseRevision) !== String(current.revision)) return { ok: false, conflict: true, operationId: request.operationId, snapshot: this.snapshot() };
    const event: ContextCondensationEventV1 = { ...active, action: "restore", eventId: request.operationId + ":restore:" + Date.now(), baseRevision: current.revision, createdAt: new Date().toISOString() };
    const eventId = this.appendProjectionEvent(event);
    return { ok: true, operationId: request.operationId, eventId, snapshot: this.snapshot() };
  }

  async undoCondensation(request: ContextCondensationRestoreRequest): Promise<ContextMutationResult> {
    return this.restoreCondensation(request);
  }

  private condensationSurfaceEvent(operationId: string): ContextCondensationEventV1 | undefined {
    return this.currentCondensation(operationId);
  }

  private condensationSurfaceResult(operationId: string, action: "exclude" | "restore"): ContextMutationResult {
    const active = this.condensationSurfaceEvent(operationId);
    if (!active) throw new Error("CONTEXT_EDITOR_CONDENSATION_RESTORE_UNAVAILABLE");
    const current = this.read();
    const event: ContextCondensationEventV1 = {
      ...active,
      action: action === "exclude" ? "exclude-summary" : "restore-summary",
      eventId: operationId + ":" + action + ":" + Date.now(),
      baseRevision: current.revision,
      createdAt: new Date().toISOString(),
    };
    const eventId = this.appendProjectionEvent(event);
    return { ok: true, operationId, eventId, snapshot: this.snapshot() };
  }
  async getSnapshot(locator: ContextSessionLocator): Promise<ContextEditorSnapshot> {
    asLocator(locator, this.sessionId);
    return this.snapshot();
  }

  async listRecords(locator: ContextSessionLocator, cursor?: string, _limit?: number): Promise<ContextRecordPage> {
    asLocator(locator, this.sessionId);
    if (cursor) throw new Error("CONTEXT_EDITOR_PAGING_UNSUPPORTED");
    const current = this.read();
    return {
      records: this.records(),
      nextCursor: null,
      sourceRevision: current.revision,
      viewRevision: current.revision,
    };
  }

  async getRecord(locator: ContextSessionLocator, recordId: string): Promise<ContextRecordDetail | null> {
    asLocator(locator, this.sessionId);
    const current = this.read();
    const record = service.getRecord(this, recordId);
    return record ? { record, sourceRevision: current.revision, viewRevision: current.revision } : null;
  }

  async searchRecords(request: ContextSearchRequest): Promise<ContextSearchSummary> {
    asLocator(request.locator, this.sessionId);
    return this.search(request.query, request.enabledKinds, request.scope, request.enabledUnitKinds);
  }

  async getSearchMatch(request: ContextSearchMatchRequest): Promise<ContextSearchMatch | null> {
    asLocator(request.locator, this.sessionId);
    return this.searchMatch(request);
  }

  async previewReplacement(request: ContextReplacementMutationRequest): Promise<ContextReplacementPreview> {
    asLocator(request.locator, this.sessionId);
    return service.previewReplacement(this, request);
  }

  async commitReplacement(request: ContextReplacementMutationRequest): Promise<ContextMutationResult> {
    asLocator(request.locator, this.sessionId);
    return this.commitReplacementMutation(request);
  }

  async restoreReplacement(request: ContextReplacementUnitRequest): Promise<ContextMutationResult> {
    asLocator(request.locator, this.sessionId);
    return this.restoreReplacementMutation(request);
  }

  async undoReplacement(request: ContextReplacementUnitRequest): Promise<ContextMutationResult> {
    asLocator(request.locator, this.sessionId);
    return this.undoReplacementMutation(request);
  }

  async commitView(request: ContextViewMutationRequest): Promise<ContextMutationResult> {
    asLocator(request.locator, this.sessionId);
    return this.commit(request);
  }

  async undoView(locator: ContextSessionLocator, baseRevision: string): Promise<ContextMutationResult> {
    asLocator(locator, this.sessionId);
    return this.undo(baseRevision);
  }

  async previewContext(request: ContextProjectionMutationRequest): Promise<ContextProjectionPreview> {
    asLocator(request.locator, this.sessionId);
    if (request.condensationOperationId) {
      const active = this.condensationSurfaceEvent(request.condensationOperationId);
      if (!active) throw new Error("CONTEXT_EDITOR_CONDENSATION_RESTORE_UNAVAILABLE");
      const unit = active.sourceUnits[0];
      return {
        baseRevision: this.read().revision,
        action: request.action,
        requestedUnitIds: unit ? [unit.id] : [],
        effectiveUnitIds: unit ? [unit.id] : [],
        autoExpandedUnitIds: [],
        requestedAtomIds: unit?.atomIds ?? [],
        effectiveAtomIds: unit?.atomIds ?? [],
        unavailableUnitIds: [],
        touchesRecentTurn: false,
        stateByUnitId: unit ? { [unit.id]: request.action === "exclude" ? "exclude" : "include" } : {},
      };
    }
    return service.previewContextProjection(this, request);
  }

  async commitContext(request: ContextProjectionMutationRequest): Promise<ContextMutationResult> {
    asLocator(request.locator, this.sessionId);
    if (request.condensationOperationId) return this.condensationSurfaceResult(request.condensationOperationId, request.action);
    try {
      return service.commitContextProjection(this, request);
    } catch (error) {
      if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) {
        return { ok: false, conflict: true, snapshot: this.snapshot() };
      }
      throw error;
    }
  }
}
