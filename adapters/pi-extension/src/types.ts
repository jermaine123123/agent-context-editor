export const ATOM_KINDS = [
  "user",
  "assistant_text",
  "reasoning",
  "tool_call",
  "tool_output",
  "summary",
] as const;

export type AtomKind = (typeof ATOM_KINDS)[number];
export type ViewState = "show" | "collapse" | "hide";
export type ContextState = "keep" | "replace" | "summarize" | "exclude";

export interface SourceRef {
  entryId: string;
  blockIndex: number;
}

export interface ContextAtom {
  id: string;
  sourceRef: SourceRef;
  kind: AtomKind;
  turnId: string;
  timestamp: number;
  text: string;
  fingerprint: string;
  approxTokens: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  hasSignature?: boolean;
  redacted?: boolean;
}

export interface AtomViewState {
  fingerprint: string;
  viewState: ViewState;
  contextState: ContextState;
}

/** Optional per-branch browser preferences; absent in older V1 entries. */
export interface ContextViewFilterState {
  enabledKinds: AtomKind[];
  query: string;
  showHidden: boolean;
}

export interface ContextEditorStateV1 {
  version: 1;
  updatedAt: string;
  sourceLeafId?: string;
  items: Record<string, AtomViewState>;
  viewFilter?: ContextViewFilterState;
}

export interface AtomFilter {
  enabledKinds: ReadonlySet<AtomKind>;
  query: string;
}
