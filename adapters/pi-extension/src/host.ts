import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  branchRevision,
  contextEditorBranchRevisionParts,
  ContextEditorService,
  stableFingerprint,
  type ContextEditorHostAdapter,
  type ContextEditorPrefsV2,
  type ContextEditorSessionAdapter,
  type ContextEditorSnapshot,
  type ContextEditorViewEventV2,
  type ContextMutationResult,
  type ContextRecord,
  type ContextRecordDetail,
  type ContextRecordPage,
  type ContextSearchMatch,
  type ContextSearchMatchRequest,
  type ContextSearchSummary,
  type ContextSessionLocator,
  type ContextViewMutationRequest,
} from "./shared-core/index.js";
import { readSidecar, appendSidecarEvent, writeSidecarPrefs } from "./sidecar.js";
import { normalizeSessionEntries } from "./normalize.js";

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
    contextExclusion: false as const,
  };

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
    const branchIds = new Set(entries.map((entry) => String((entry as { id?: unknown }).id ?? "")));
    const viewEvents = sidecar.document.events
      .filter((envelope) => envelope.anchorEntryId.length === 0 || branchIds.has(envelope.anchorEntryId))
      .map((envelope) => envelope.event);
    const branchParts = contextEditorBranchRevisionParts(entries);
    const revision = branchRevision(leafId, atoms, [...branchParts, sidecar.viewRevision]);
    const revisionProbe = stableFingerprint([
      this.sessionFile,
      this.sessionId,
      leafId ?? "",
      sidecar.viewRevision,
      revision,
      ...branchParts,
    ]);
    return { entries, atoms, leafId, revision, revisionProbe, viewEvents };
  }

  appendViewEvent(event: ContextEditorViewEventV2): string {
    if (!this.ctx.isIdle()) throw new Error("AGENT_RUNTIME_BUSY");
    const current = this.read();
    if (current.revision !== event.baseRevision) throw new Error("CONTEXT_EDITOR_CONFLICT");
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

  isBusy(): boolean {
    return !this.ctx.isIdle();
  }

  getPrefs(): ContextEditorPrefsV2 {
    return readSidecar(this.sessionFile, this.sessionId).document.prefs;
  }

  setPrefs(prefs: ContextEditorPrefsV2): void {
    if (!this.ctx.isIdle()) return;
    writeSidecarPrefs(this.sessionFile, this.sessionId, prefs);
  }

  records(): ContextRecord[] {
    return service.getRecords(this);
  }

  snapshot(): ContextEditorSnapshot {
    return service.getSnapshot(this);
  }

  search(query: string, enabledKinds: readonly ("user" | "ai" | "tool")[]): ContextSearchSummary {
    return service.searchContextRecords(this, { query, enabledKinds });
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

  async searchRecords(request: { locator: ContextSessionLocator; query: string; enabledKinds: readonly ("user" | "ai" | "tool")[] }): Promise<ContextSearchSummary> {
    asLocator(request.locator, this.sessionId);
    return this.search(request.query, request.enabledKinds);
  }

  async getSearchMatch(request: ContextSearchMatchRequest): Promise<ContextSearchMatch | null> {
    asLocator(request.locator, this.sessionId);
    return this.searchMatch(request);
  }

  async commitView(request: ContextViewMutationRequest): Promise<ContextMutationResult> {
    asLocator(request.locator, this.sessionId);
    return this.commit(request);
  }

  async undoView(locator: ContextSessionLocator, baseRevision: string): Promise<ContextMutationResult> {
    asLocator(locator, this.sessionId);
    return this.undo(baseRevision);
  }
}
