import type {
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { atomId, fingerprintBlock } from "./fingerprint.js";
import type { AtomKind, ContextAtom } from "./types.js";

type ContentPart = TextContent | ThinkingContent | ImageContent | ToolCall;

function timestampOf(entry: SessionEntry): number {
  if (entry.type === "message") return entry.message.timestamp;
  const parsed = Date.parse(entry.timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part: ContentPart | unknown) => {
      if (!part || typeof part !== "object") return "";
      const value = part as Record<string, unknown>;
      switch (value.type) {
        case "text":
          return typeof value.text === "string" ? value.text : "";
        case "thinking":
          return typeof value.thinking === "string" ? value.thinking : "";
        case "toolCall": {
          const name = typeof value.name === "string" ? value.name : "tool";
          let args = "";
          try {
            args = JSON.stringify(value.arguments ?? {});
          } catch {
            args = "[unserializable arguments]";
          }
          return `${name} ${args}`;
        }
        case "image":
          return `[image${typeof value.mimeType === "string" ? ` ${value.mimeType}` : ""}]`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function addAtom(
  atoms: ContextAtom[],
  entry: SessionEntry,
  turnId: string,
  blockIndex: number,
  kind: AtomKind,
  text: string,
  options: {
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    hasSignature?: boolean;
    redacted?: boolean;
  } = {},
): void {
  const timestamp = timestampOf(entry);
  const fingerprint = fingerprintBlock(kind, timestamp, options.toolCallId, text);
  const atom: ContextAtom = {
    id: "",
    sourceRef: { entryId: entry.id, blockIndex },
    kind,
    turnId,
    timestamp,
    text,
    fingerprint,
    approxTokens: approximateTokens(text),
    ...options,
  };
  atom.id = atomId(atom);
  atoms.push(atom);
}

function normalizeMessageEntry(
  atoms: ContextAtom[],
  entry: Extract<SessionEntry, { type: "message" }>,
  turnId: string,
): void {
  const message = entry.message;
  if (message.role === "user") {
    addAtom(atoms, entry, turnId, 0, "user", contentToText(message.content));
    return;
  }

  if (message.role === "toolResult") {
    addAtom(atoms, entry, turnId, 0, "tool_output", contentToText(message.content), {
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      isError: message.isError,
    });
    return;
  }

  if (message.role !== "assistant") return;
  const content = Array.isArray(message.content) ? message.content : [];
  content.forEach((part, blockIndex) => {
    if (part.type === "text") {
      addAtom(atoms, entry, turnId, blockIndex, "assistant_text", part.text, {
        hasSignature: Boolean(part.textSignature),
      });
    } else if (part.type === "thinking") {
      addAtom(atoms, entry, turnId, blockIndex, "reasoning", part.thinking, {
        hasSignature: Boolean(part.thinkingSignature),
        redacted: part.redacted,
      });
    } else if (part.type === "toolCall") {
      addAtom(atoms, entry, turnId, blockIndex, "tool_call", contentToText([part]), {
        toolCallId: part.id,
        toolName: part.name,
        hasSignature: Boolean(part.thoughtSignature),
      });
    }
  });
}

/** Normalize active, compaction-aware session entries into message-level atoms. */
export function normalizeSessionEntries(entries: readonly SessionEntry[]): ContextAtom[] {
  const atoms: ContextAtom[] = [];
  let activeTurnId = "turn-0";

  for (const entry of entries) {
    if (entry.type === "message") {
      if (entry.message.role === "user") activeTurnId = entry.id;
      normalizeMessageEntry(atoms, entry, activeTurnId);
      continue;
    }

    if (entry.type === "compaction") {
      addAtom(atoms, entry, `compaction-${entry.id}`, 0, "summary", entry.summary);
    } else if (entry.type === "branch_summary") {
      addAtom(atoms, entry, `branch-summary-${entry.id}`, 0, "summary", entry.summary);
    } else if (entry.type === "custom_message") {
      addAtom(atoms, entry, `custom-${entry.id}`, 0, "summary", contentToText(entry.content));
    }
  }

  return atoms;
}

export function contentToSearchText(content: unknown): string {
  return contentToText(content);
}
