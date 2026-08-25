import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  reduceProjectionStates,
  type ContextAtom,
  type ContextProjectionEventV1,
} from "./shared-core/index.js";

export class ProjectionAlignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionAlignmentError";
  }
}

type MessageRow = {
  entryId: string;
  baseline: AgentMessage;
};

function roleOf(message: AgentMessage): string {
  return typeof message === "object" && message !== null && "role" in message
    ? String((message as { role?: unknown }).role ?? "")
    : "";
}

function structuralShape(message: AgentMessage): string {
  const row = message as unknown as Record<string, unknown>;
  const content = row.content;
  const blocks = typeof content === "string"
    ? "string"
    : Array.isArray(content)
      ? content.map((part) => {
          if (!part || typeof part !== "object") return typeof part;
          const value = part as Record<string, unknown>;
          return [
            value.type,
            value.id,
            value.toolCallId,
            value.name,
          ].map((item) => String(item ?? "")).join(":");
        }).join("|")
      : "";
  return roleOf(message) + "|" + blocks;
}

function messageIdentityCompatible(baseline: AgentMessage, current: AgentMessage): boolean {
  if (roleOf(baseline) !== roleOf(current)) return false;
  const baselineRow = baseline as { content?: unknown; toolCallId?: unknown; toolName?: unknown };
  const currentRow = current as { content?: unknown; toolCallId?: unknown; toolName?: unknown };
  if (roleOf(baseline) === 'user') return JSON.stringify(baselineRow.content) === JSON.stringify(currentRow.content);
  if (roleOf(baseline) === 'toolResult') return String(baselineRow.toolCallId ?? '') === String(currentRow.toolCallId ?? '') && String(baselineRow.toolName ?? '') === String(currentRow.toolName ?? '') && JSON.stringify(baselineRow.content) === JSON.stringify(currentRow.content);
  return false;
}

function structurallyCompatible(baseline: AgentMessage, current: AgentMessage): boolean {
  if (roleOf(baseline) !== roleOf(current)) return false;
  const baselineShape = structuralShape(baseline);
  const currentShape = structuralShape(current);
  if (baselineShape === currentShape) return true;
  const baselineContent = (baseline as { content?: unknown }).content;
  const currentContent = (current as { content?: unknown }).content;
  if (Array.isArray(baselineContent) && Array.isArray(currentContent)) {
    const baselineKinds = baselineContent.map((part) => typeof part === "object" && part ? String((part as { type?: unknown }).type ?? "") : "");
    const currentKinds = currentContent.map((part) => typeof part === "object" && part ? String((part as { type?: unknown }).type ?? "") : "");
    if (baselineKinds.length === currentKinds.length && baselineKinds.every((kind, index) => kind === currentKinds[index])) return true;
  }
  return messageIdentityCompatible(baseline, current);
}

function contentKinds(message: AgentMessage): string[] | undefined {
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  return content.map((part) => typeof part === "object" && part ? String((part as { type?: unknown }).type ?? "") : "");
}

function isKindSubsequence(baseline: AgentMessage, current: AgentMessage): boolean {
  const baselineKinds = contentKinds(baseline);
  const currentKinds = contentKinds(current);
  if (!baselineKinds || !currentKinds) return false;
  let cursor = 0;
  for (const kind of currentKinds) {
    const index = baselineKinds.indexOf(kind, cursor);
    if (index < 0) return false;
    cursor = index + 1;
  }
  return true;
}

function restoreCompatible(baseline: AgentMessage, current: AgentMessage): boolean {
  const role = roleOf(baseline);
  if (role === 'user' || role === 'toolResult') return messageIdentityCompatible(baseline, current);
  return role === roleOf(current) && (structurallyCompatible(baseline, current) || isKindSubsequence(baseline, current));
}

function rowsForEntries(entries: readonly unknown[]): MessageRow[] {
  const rows: MessageRow[] = [];
  for (const raw of entries) {
    const entry = raw as SessionEntry;
    const entryId = String((entry as { id?: unknown }).id ?? "");
    if (!entryId) continue;
    for (const baseline of sessionEntryToContextMessages(entry)) rows.push({ entryId, baseline });
  }
  return rows;
}

function activeAtomsByEntry(atoms: readonly ContextAtom[], events: readonly ContextProjectionEventV1[]) {
  const states = reduceProjectionStates(atoms, events);
  const result = new Map<string, ContextAtom[]>();
  for (const atom of atoms) {
    const state = states.get(atom.id) ?? "include";
    if (state === "unavailable") throw new ProjectionAlignmentError("an active projection fingerprint no longer matches");
    const group = result.get(atom.sourceRef.entryId);
    if (group) group.push(atom);
    else result.set(atom.sourceRef.entryId, [atom]);
  }
  return { states, byEntry: result };
}

function restoredAtomIds(
  atoms: readonly ContextAtom[],
  events: readonly ContextProjectionEventV1[],
  states: ReadonlyMap<string, "include" | "exclude" | "unavailable">,
): Set<string> {
  const ids = new Set<string>();
  const known = new Set(atoms.map((atom) => atom.id));
  for (const event of events) {
    if (event.action !== "restore") continue;
    for (const change of event.changes) {
      if (known.has(change.atomId) && states.get(change.atomId) === "include") ids.add(change.atomId);
    }
  }
  return ids;
}

function projectOneMessage(
  message: AgentMessage,
  atoms: readonly ContextAtom[],
  states: ReadonlyMap<string, "include" | "exclude" | "unavailable">,
): AgentMessage | undefined {
  const excluded = new Set(atoms.filter((atom) => states.get(atom.id) === "exclude").map((atom) => atom.id));
  if (excluded.size === 0) return message;
  const role = roleOf(message);
  if (role === "user" || role === "toolResult") return undefined;
  if (role !== "assistant") throw new ProjectionAlignmentError("unsupported active message role");
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new ProjectionAlignmentError("assistant message content is not an array");
  const nextContent = content.filter((_part, blockIndex) => {
    const atom = atoms.find((candidate) => candidate.sourceRef.blockIndex === blockIndex && candidate.kind !== "tool_output");
    return !atom || !excluded.has(atom.id);
  });
  if (nextContent.length === 0) return undefined;
  return { ...(message as object), content: nextContent } as AgentMessage;
}

export interface ProjectContextInput {
  messages: readonly AgentMessage[];
  entries: readonly unknown[];
  atoms: readonly ContextAtom[];
  projectionEvents: readonly ContextProjectionEventV1[];
}

export function projectModelContext(input: ProjectContextInput): AgentMessage[] {
  const rows = rowsForEntries(input.entries);
  const { states, byEntry } = activeAtomsByEntry(input.atoms, input.projectionEvents);
  const restoredIds = restoredAtomIds(input.atoms, input.projectionEvents, states);
  const output: AgentMessage[] = [];
  let cursor = 0;
  for (const row of rows) {
    let match = -1;
    let reconstructed = false;
    const rowAtoms = byEntry.get(row.entryId) ?? [];
    const hasExcluded = rowAtoms.some((atom) => states.get(atom.id) === "exclude");
    const hasRestored = rowAtoms.some((atom) => restoredIds.has(atom.id));
    for (let index = cursor; index < input.messages.length; index += 1) {
      const candidate = input.messages[index];
      if (candidate && (hasRestored ? restoreCompatible(row.baseline, candidate) : structurallyCompatible(row.baseline, candidate))) {
        match = index;
        reconstructed = hasRestored && !structurallyCompatible(row.baseline, candidate);
        break;
      }
    }
    if (match < 0) {
      if (hasExcluded) throw new ProjectionAlignmentError("excluded message could not be aligned with the active context");
      if (hasRestored) {
        const candidates = input.messages
          .map((candidate, index) => ({ candidate, index }))
          .filter(({ candidate, index }) => index >= cursor && restoreCompatible(row.baseline, candidate));
        if (candidates.length > 1) throw new ProjectionAlignmentError("restored message could not be aligned unambiguously");
        if (candidates.length === 1) {
          match = candidates[0]!.index;
          reconstructed = true;
        } else {
          const restored = projectOneMessage(row.baseline, rowAtoms, states);
          if (restored) output.push(restored);
          continue;
        }
      }
      if (match < 0) continue;
    }
    for (let index = cursor; index < match; index += 1) {
      const extra = input.messages[index];
      if (extra) output.push(extra);
    }
    const current = input.messages[match];
    if (current) {
      const projected = projectOneMessage(reconstructed ? row.baseline : current, rowAtoms, states);
      if (projected) output.push(projected);
    }
    cursor = match + 1;
  }
  for (let index = cursor; index < input.messages.length; index += 1) {
    const extra = input.messages[index];
    if (extra) output.push(extra);
  }
  return output;
}

export function projectionOverlapsEntryIds(
  entryIds: ReadonlySet<string>,
  atoms: readonly ContextAtom[],
  projectionEvents: readonly ContextProjectionEventV1[],
): boolean {
  const states = reduceProjectionStates(atoms, projectionEvents);
  if ([...states.values()].some((state) => state === "unavailable")) {
    throw new ProjectionAlignmentError("active projection is unavailable");
  }
  return atoms.some((atom) => entryIds.has(atom.sourceRef.entryId) && states.get(atom.id) === "exclude");
}
