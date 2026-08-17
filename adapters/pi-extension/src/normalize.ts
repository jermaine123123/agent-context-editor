import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  atomId,
  fingerprintBlock,
  type AtomKind,
  type ContextAtom,
} from "./shared-core/index.js";

type BranchEntry = {
  id?: string;
  type?: string;
  timestamp?: string | number;
  summary?: string;
  message?: {
    role?: string;
    content?: unknown;
    timestamp?: string | number;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  };
};

function timestampOf(entry: BranchEntry): number {
  const raw = entry.message?.timestamp ?? entry.timestamp ?? 0;
  const value = typeof raw === "number" ? raw : Date.parse(String(raw));
  return Number.isFinite(value) ? value : 0;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = part as Record<string, unknown>;
      if (value.type === "text") return typeof value.text === "string" ? value.text : "";
      if (value.type === "thinking") return typeof value.thinking === "string" ? value.thinking : "";
      if (value.type === "toolCall") {
        const name = typeof value.name === "string" ? value.name : "tool";
        let args = "{}";
        try { args = JSON.stringify(value.arguments ?? value.input ?? {}) ?? "{}"; }
        catch { args = "[unserializable arguments]"; }
        return `${name} ${args}`;
      }
      if (value.type === "toolResult") return contentToText(value.content);
      if (typeof value.text === "string") return value.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function addAtom(
  atoms: ContextAtom[],
  entry: BranchEntry,
  turnId: string,
  blockIndex: number,
  kind: AtomKind,
  text: string,
  options: Partial<Pick<ContextAtom, "recordId" | "toolCallId" | "toolName" | "isError" | "hasSignature" | "redacted">> = {},
): ContextAtom | undefined {
  const entryId = String(entry.id ?? "");
  if (!entryId) return undefined;
  const timestamp = timestampOf(entry);
  const atom: ContextAtom = {
    id: "",
    recordId: options.recordId,
    sourceRef: { entryId, blockIndex },
    kind,
    turnId,
    timestamp,
    text,
    fingerprint: fingerprintBlock(kind, timestamp, options.toolCallId, text),
    approxTokens: approximateTokens(text),
    ...options,
  };
  atom.id = atomId(atom);
  atoms.push(atom);
  return atom;
}

function toolCallDetails(value: Record<string, unknown>): { id?: string; name: string; input: unknown; signature?: string } {
  const nested = value.toolCall && typeof value.toolCall === "object" ? value.toolCall as Record<string, unknown> : undefined;
  const id = String(value.id ?? nested?.id ?? "") || undefined;
  const name = String(value.name ?? nested?.name ?? "tool");
  const input = value.arguments ?? value.input ?? nested?.arguments ?? nested?.input ?? {};
  const signature = value.thoughtSignature ?? value.signature ?? nested?.thoughtSignature;
  return { id, name, input, signature: typeof signature === "string" ? signature : undefined };
}

/** Convert Pi's active branch into host-neutral ContextAtoms. */
export function normalizeSessionEntries(entries: readonly SessionEntry[] | readonly unknown[]): ContextAtom[] {
  const atoms: ContextAtom[] = [];
  const toolRecordByCallId = new Map<string, string>();
  let turnId = "turn-0";

  for (const raw of entries) {
    const entry = raw as BranchEntry;
    const entryId = String(entry.id ?? "");
    if (!entryId) continue;
    if (entry.type === "custom" || entry.type === "custom_message") continue;
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      addAtom(atoms, entry, `summary:${entryId}`, 0, "summary", String(entry.summary ?? ""));
      continue;
    }
    if (entry.type !== "message" || !entry.message) continue;

    const message = entry.message;
    const role = String(message.role ?? "");
    if (role === "user") {
      turnId = entryId;
      const text = contentToText(message.content).trim();
      // Slash commands are host control entries, not context records.
      if (!/^\/[A-Za-z][A-Za-z0-9:_-]*(?:\s|$)/.test(text)) addAtom(atoms, entry, turnId, 0, "user", text);
      continue;
    }
    if (role === "toolResult") {
      const callId = String(message.toolCallId ?? "") || undefined;
      const recordId = callId ? toolRecordByCallId.get(callId) : undefined;
      addAtom(atoms, entry, turnId, 0, "tool_output", contentToText(message.content), {
        toolCallId: callId,
        toolName: message.toolName,
        isError: message.isError,
        recordId: recordId ?? `tool-result:${entryId}:block:0`,
      });
      continue;
    }
    if (role !== "assistant") continue;

    const content = Array.isArray(message.content) ? message.content : [];
    for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
      const part = content[blockIndex];
      if (!part || typeof part !== "object") continue;
      const value = part as Record<string, unknown>;
      if (value.type === "text" && typeof value.text === "string") {
        addAtom(atoms, entry, turnId, blockIndex, "assistant_text", value.text, {
          hasSignature: typeof value.textSignature === "string",
        });
      } else if (value.type === "thinking" && typeof value.thinking === "string") {
        addAtom(atoms, entry, turnId, blockIndex, "reasoning", value.thinking, {
          hasSignature: typeof value.thinkingSignature === "string",
          redacted: value.redacted === true,
        });
      } else if (value.type === "toolCall") {
        const detail = toolCallDetails(value);
        const recordId = detail.id ? `tool:${entryId}:${detail.id}` : `tool:${entryId}:block:${blockIndex}`;
        if (detail.id) toolRecordByCallId.set(detail.id, recordId);
        let input = "{}";
        try { input = JSON.stringify(detail.input ?? {}) ?? "{}"; }
        catch { input = "[unserializable arguments]"; }
        addAtom(atoms, entry, turnId, blockIndex, "tool_call", input, {
          toolCallId: detail.id,
          toolName: detail.name,
          hasSignature: !!detail.signature,
          recordId,
        });
      }
    }
  }
  return atoms;
}

export function contentToSearchText(content: unknown): string {
  return contentToText(content);
}
