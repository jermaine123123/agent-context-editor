import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import { contentToSearchText } from "./normalize.js";
import { fingerprintBlock } from "./fingerprint.js";
import { atomState } from "./state.js";
import type { ContextAtom, ContextEditorStateV1 } from "./types.js";

export const TOOL_OUTPUT_TOMBSTONE = "[Tool output excluded by Context Editor. Original remains recoverable.]";

export interface ToolOutputProjectionAction {
  toolCallId: string;
  expectedFingerprint: string;
  action: "keep" | "replace" | "restore";
}

export interface ProjectionResult {
  messages: AgentMessage[];
  appliedToolCallIds: string[];
  skippedToolCallIds: string[];
}

export type ToolOutputProtectionReason =
  | "not-tool-output"
  | "missing-tool-call-id"
  | "missing-tool-call"
  | "recent-turn"
  | "error";

export interface ToolOutputProtection {
  eligible: boolean;
  reason?: ToolOutputProtectionReason;
}

/**
 * Return the fail-closed safety decision shared by both the TUI and the
 * desktop dialog flow. Tool results without a visible matching call are not
 * safe to replace because their pairing cannot be verified.
 */
export function toolOutputProtection(
  atoms: readonly ContextAtom[],
  atom: ContextAtom,
  protectedRecentUserTurns = 2,
): ToolOutputProtection {
  if (atom.kind !== "tool_output") return { eligible: false, reason: "not-tool-output" };
  if (!atom.toolCallId) return { eligible: false, reason: "missing-tool-call-id" };
  if (atom.isError) return { eligible: false, reason: "error" };

  const protectedTurns = new Set(
    atoms
      .filter((candidate) => candidate.kind === "user")
      .slice(-protectedRecentUserTurns)
      .map((candidate) => candidate.turnId),
  );
  if (protectedTurns.has(atom.turnId)) return { eligible: false, reason: "recent-turn" };

  const hasMatchingCall = atoms.some(
    (candidate) => candidate.kind === "tool_call" && candidate.toolCallId === atom.toolCallId,
  );
  if (!hasMatchingCall) return { eligible: false, reason: "missing-tool-call" };

  return { eligible: true };
}

export function buildToolOutputActions(
  atoms: readonly ContextAtom[],
  state: ContextEditorStateV1 | undefined,
  protectedRecentUserTurns = 2,
): ToolOutputProjectionAction[] {
  return atoms.flatMap((atom) => {
    if (atomState(state, atom).contextState !== "replace") return [];
    if (!toolOutputProtection(atoms, atom, protectedRecentUserTurns).eligible) return [];
    if (!atom.toolCallId) return [];
    return [
      {
        toolCallId: atom.toolCallId,
        expectedFingerprint: atom.fingerprint,
        action: "replace" as const,
      },
    ];
  });
}

function isToolResult(message: AgentMessage): message is ToolResultMessage {
  return message.role === "toolResult";
}

function textContent(text: string): TextContent[] {
  return [{ type: "text", text }];
}

/**
 * Safe V0.3 primitive: replace only a matching tool result body and retain its
 * envelope, call id, error flag, and timestamp. It is intentionally not wired
 * into the context hook until the UI has an explicit Apply/Preview flow.
 */
export function projectToolOutputs(
  messages: readonly AgentMessage[],
  actions: readonly ToolOutputProjectionAction[],
): ProjectionResult {
  const byId = new Map(actions.map((action) => [action.toolCallId, action]));
  const appliedToolCallIds: string[] = [];
  const skippedToolCallIds: string[] = [];

  const projected = messages.map((message) => {
    if (!isToolResult(message)) return message;
    const action = byId.get(message.toolCallId);
    if (!action || action.action !== "replace") return message;

    const currentText = contentToSearchText(message.content);
    if (currentText === TOOL_OUTPUT_TOMBSTONE) {
      appliedToolCallIds.push(message.toolCallId);
      return message;
    }
    const currentFingerprint = fingerprintBlock(
      "tool_output",
      message.timestamp,
      message.toolCallId,
      currentText,
    );
    if (currentFingerprint !== action.expectedFingerprint) {
      skippedToolCallIds.push(message.toolCallId);
      return message;
    }

    appliedToolCallIds.push(message.toolCallId);
    const replacement: ToolResultMessage = {
      ...message,
      content: textContent(TOOL_OUTPUT_TOMBSTONE),
    };
    return replacement;
  });

  return { messages: projected, appliedToolCallIds, skippedToolCallIds };
}

export function isProtectedToolResult(message: AgentMessage): boolean {
  return isToolResult(message) && message.isError;
}

export function isTextOrImageContent(value: unknown): value is TextContent | ImageContent {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type);
}
