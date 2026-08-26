import { sessionEntryToContextMessages, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  projectRecords,
  reduceProjectionStates,
  reduceReplacementStates,
  type ContextAtom,
  type ContextEditableUnit,
  type ContextProjectionEvent,
  type ContextProjectionEventV1,
  type ReplacementUnitProjection,
} from "./shared-core/index.js";

export class ProjectionAlignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectionAlignmentError";
  }
}

type MessageRow = { entryId: string; baseline: AgentMessage };
type ProjectionState = "include" | "exclude" | "unavailable";
type UnitProjection = { unit: ContextEditableUnit; state: ReplacementUnitProjection };

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
          return [value.type, value.id, value.toolCallId, value.name].map((item) => String(item ?? "")).join(":");
        }).join("|")
      : "";
  return roleOf(message) + "|" + blocks;
}

function messageIdentityCompatible(baseline: AgentMessage, current: AgentMessage): boolean {
  if (roleOf(baseline) !== roleOf(current)) return false;
  const baselineRow = baseline as { content?: unknown; toolCallId?: unknown; toolName?: unknown };
  const currentRow = current as { content?: unknown; toolCallId?: unknown; toolName?: unknown };
  if (roleOf(baseline) === "user") return JSON.stringify(baselineRow.content) === JSON.stringify(currentRow.content);
  if (roleOf(baseline) === "toolResult") return String(baselineRow.toolCallId ?? "") === String(currentRow.toolCallId ?? "") && String(baselineRow.toolName ?? "") === String(currentRow.toolName ?? "") && JSON.stringify(baselineRow.content) === JSON.stringify(currentRow.content);
  return false;
}

function structurallyCompatible(baseline: AgentMessage, current: AgentMessage): boolean {
  if (roleOf(baseline) !== roleOf(current)) return false;
  if (structuralShape(baseline) === structuralShape(current)) return true;
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
  if (role === "user" || role === "toolResult") return messageIdentityCompatible(baseline, current);
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

function uniqueProjectionEvents(events: readonly ContextProjectionEvent[]): ContextProjectionEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const id = "type" in event && event.type === "replacement" ? event.eventId : (event as ContextProjectionEventV1).transactionId;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function isExclusionEvent(event: ContextProjectionEvent): event is ContextProjectionEventV1 {
  return !("type" in event);
}

function activeAtomsByEntry(atoms: readonly ContextAtom[], events: readonly ContextProjectionEvent[]) {
  const states = reduceProjectionStates(atoms, events.filter(isExclusionEvent));
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
  events: readonly ContextProjectionEvent[],
  states: ReadonlyMap<string, ProjectionState>,
): Set<string> {
  const ids = new Set<string>();
  const known = new Set(atoms.map((atom) => atom.id));
  for (const event of events) {
    if (!isExclusionEvent(event) || event.action !== "restore") continue;
    for (const change of event.changes) if (known.has(change.atomId) && states.get(change.atomId) === "include") ids.add(change.atomId);
  }
  return ids;
}

function atomForAssistantBlock(atoms: readonly ContextAtom[], blockIndex: number, part: unknown): ContextAtom | undefined {
  if (!part || typeof part !== "object") return undefined;
  const type = String((part as { type?: unknown }).type ?? "");
  const kind = type === "text" ? "assistant_text" : type === "thinking" ? "reasoning" : type === "toolCall" ? "tool_call" : "";
  return atoms.find((atom) => atom.sourceRef.blockIndex === blockIndex && (kind === "" || atom.kind === kind));
}

function replacementUnits(atoms: readonly ContextAtom[], exclusionStates: ReadonlyMap<string, ProjectionState>, events: readonly ContextProjectionEvent[]): { byAtom: Map<string, UnitProjection>; historyUnitIds: Set<string> } {
  const base = projectRecords(atoms, undefined, exclusionStates);
  const units = base.flatMap((record) => record.units);
  const states = reduceReplacementStates(units, events, true);
  const byAtom = new Map<string, UnitProjection>();
  const historyUnitIds = new Set<string>();
  const projectedUnits = projectRecords(atoms, undefined, exclusionStates, states).flatMap((record) => record.units);
  for (const event of events) if ("type" in event && event.type === "replacement") historyUnitIds.add(event.unitId);
  for (const record of base) for (const unit of record.units) {
    const state = states.get(unit.id);
    if (!state) continue;
    if (state.replacementState === "unavailable") throw new ProjectionAlignmentError("active replacement is unavailable");
    const projected = projectedUnits.find((candidate) => candidate.id === unit.id) ?? unit;
    const item = { unit: projected, state };
    for (const atom of unit.atoms) byAtom.set(atom.id, item);
  }
  return { byAtom, historyUnitIds };
}

function cloneWithContent(message: AgentMessage, content: unknown): AgentMessage {
  return { ...(message as object), content } as AgentMessage;
}

function projectOneMessage(
  message: AgentMessage,
  atoms: readonly ContextAtom[],
  states: ReadonlyMap<string, ProjectionState>,
  unitByAtom: ReadonlyMap<string, UnitProjection>,
): AgentMessage | undefined {
  const excluded = new Set(atoms.filter((atom) => states.get(atom.id) === "exclude").map((atom) => atom.id));
  const projection = atoms.map((atom) => unitByAtom.get(atom.id)).find((item): item is UnitProjection => !!item && item.state.replacementState === "replaced");
  const role = roleOf(message);
  if (role === "user") {
    if (excluded.size > 0) return undefined;
    if (projection && projection.unit.kind === "user") {
      const content = (message as { content?: unknown }).content;
      if (Array.isArray(content)) {
        const next: unknown[] = [];
        let replaced = false;
        for (const part of content) {
          if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
            if (replaced) continue;
            replaced = true;
            next.push({ ...(part as object), text: projection.unit.effectiveText });
          } else {
            next.push(part);
          }
        }
        return cloneWithContent(message, next);
      }
      return cloneWithContent(message, projection.unit.effectiveText);
    }
    return message;
  }
  if (role === "toolResult") {
    if (excluded.size > 0) return undefined;
    return message;
  }
  if (role !== "assistant") {
    if (excluded.size > 0 || projection) throw new ProjectionAlignmentError("unsupported active message role");
    return message;
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) throw new ProjectionAlignmentError("assistant message content is not an array");
  const lastReplacementAtomId = projection?.unit.kind === "answer" ? projection.unit.atomIds[projection.unit.atomIds.length - 1] : undefined;
  const nextContent = content.map((part, blockIndex) => ({ part, blockIndex })).filter(({ part, blockIndex }) => {
    const atom = atomForAssistantBlock(atoms, blockIndex, part);
    if (!atom) return true;
    if (excluded.has(atom.id)) return false;
    if (projection?.unit.kind === "answer" && projection.unit.atomIds.includes(atom.id) && atom.kind === "assistant_text") return atom.id === lastReplacementAtomId;
    return true;
  }).map(({ part, blockIndex }) => {
    if (!projection || projection.unit.kind !== "answer") return part;
    const atom = atomForAssistantBlock(atoms, blockIndex, part);
    if (atom && atom.id === lastReplacementAtomId && atom.kind === "assistant_text") return { ...(part as object), text: projection.unit.effectiveText };
    return part;
  });
  if (nextContent.length === 0) return undefined;
  return cloneWithContent(message, nextContent);
}

function rowProjection(rowAtoms: readonly ContextAtom[], unitByAtom: ReadonlyMap<string, UnitProjection>): UnitProjection | undefined {
  return rowAtoms.map((atom) => unitByAtom.get(atom.id)).find((item): item is UnitProjection => !!item && item.state.replacementState === "replaced");
}

function rowHasHistory(rowAtoms: readonly ContextAtom[], unitByAtom: ReadonlyMap<string, UnitProjection>, historyUnitIds: ReadonlySet<string>): boolean {
  return rowAtoms.some((atom) => { const item = unitByAtom.get(atom.id); return !!item && historyUnitIds.has(item.unit.id); });
}

function messagePayloadEqual(left: AgentMessage, right: AgentMessage): boolean {
  return roleOf(left) === roleOf(right) && JSON.stringify((left as { content?: unknown }).content) === JSON.stringify((right as { content?: unknown }).content);
}

function replacementCompatible(baseline: AgentMessage, current: AgentMessage, rowAtoms: readonly ContextAtom[], unitByAtom: ReadonlyMap<string, UnitProjection>, historyUnitIds: ReadonlySet<string>): boolean {
  const projection = rowProjection(rowAtoms, unitByAtom);
  if (projection) {
    const expected = projectOneMessage(baseline, rowAtoms, new Map(), unitByAtom);
    if (messagePayloadEqual(baseline, current) || (expected && messagePayloadEqual(expected, current))) return true;
    if (roleOf(baseline) === "user") return false;
    return structurallyCompatible(baseline, current) || isKindSubsequence(baseline, current) || (!!expected && (structurallyCompatible(expected, current) || isKindSubsequence(expected, current)));
  }
  if (rowHasHistory(rowAtoms, unitByAtom, historyUnitIds)) return restoreCompatible(baseline, current) || structurallyCompatible(baseline, current);
  return structurallyCompatible(baseline, current) || isKindSubsequence(baseline, current);
}

export interface ProjectContextInput {
  messages: readonly AgentMessage[];
  entries: readonly unknown[];
  atoms: readonly ContextAtom[];
  projectionEvents: readonly ContextProjectionEvent[];
}

export function projectModelContext(input: ProjectContextInput): AgentMessage[] {
  const projectionEvents = uniqueProjectionEvents(input.projectionEvents);
  if (projectionEvents.length === 0) return [...input.messages];
  const rows = rowsForEntries(input.entries);
  const { states, byEntry } = activeAtomsByEntry(input.atoms, projectionEvents);
  const { byAtom: unitByAtom, historyUnitIds } = replacementUnits(input.atoms, states, projectionEvents);
  const restoredIds = restoredAtomIds(input.atoms, projectionEvents, states);
  const output: AgentMessage[] = [];
  let cursor = 0;
  for (const row of rows) {
    const rowAtoms = byEntry.get(row.entryId) ?? [];
    const projection = rowProjection(rowAtoms, unitByAtom);
    const hasExcluded = rowAtoms.some((atom) => states.get(atom.id) === "exclude");
    const hasRestored = rowAtoms.some((atom) => restoredIds.has(atom.id));
    const hasHistory = rowHasHistory(rowAtoms, unitByAtom, historyUnitIds);
    let match = -1;
    let reconstructed = false;
    const compatible: Array<{ candidate: AgentMessage; index: number }> = [];
    for (let index = cursor; index < input.messages.length; index += 1) {
      const candidate = input.messages[index];
      if (candidate && replacementCompatible(row.baseline, candidate, rowAtoms, unitByAtom, historyUnitIds)) compatible.push({ candidate, index });
    }
    if (projection) {
      const expected = projectOneMessage(row.baseline, rowAtoms, new Map(), unitByAtom);
      const exact = compatible.filter(({ candidate }) => messagePayloadEqual(row.baseline, candidate) || (!!expected && messagePayloadEqual(expected, candidate)));
      if (exact.length > 1) throw new ProjectionAlignmentError("projected message could not be aligned unambiguously");
      if (exact.length === 1) {
        match = exact[0]!.index;
        reconstructed = !messagePayloadEqual(row.baseline, exact[0]!.candidate);
      } else if (compatible.length > 1) {
        throw new ProjectionAlignmentError("projected message could not be aligned unambiguously");
      } else if (compatible.length === 1) {
        match = compatible[0]!.index;
        reconstructed = true;
      }
    } else if (compatible.length > 0) {
      match = compatible[0]!.index;
      reconstructed = hasHistory || (hasRestored && !structurallyCompatible(row.baseline, compatible[0]!.candidate));
    }
    if (match < 0) {
      if (projection) {
        const expected = projectOneMessage(row.baseline, rowAtoms, states, unitByAtom);
        if (expected) throw new ProjectionAlignmentError("projected message could not be aligned");
        continue;
      }
      if (hasExcluded && !projection) throw new ProjectionAlignmentError("excluded message could not be aligned with the active context");
      if (hasRestored || projection || hasHistory) {
        const candidates = input.messages.map((candidate, index) => ({ candidate, index })).filter(({ candidate, index }) => index >= cursor && replacementCompatible(row.baseline, candidate, rowAtoms, unitByAtom, historyUnitIds));
        if (candidates.length > 1 && projection) throw new ProjectionAlignmentError("projected message could not be aligned unambiguously");
        if (candidates.length === 1) { match = candidates[0]!.index; reconstructed = true; }
        else {
          const restored = projectOneMessage(row.baseline, rowAtoms, states, unitByAtom);
          if (restored) output.push(restored);
          continue;
        }
      }
      if (match < 0) continue;
    }
    for (let index = cursor; index < match; index += 1) { const extra = input.messages[index]; if (extra) output.push(extra); }
    const current = input.messages[match];
    if (current) {
      const projected = projectOneMessage(reconstructed ? row.baseline : current, rowAtoms, states, unitByAtom);
      if (projected) output.push(projected);
    }
    cursor = match + 1;
  }
  for (let index = cursor; index < input.messages.length; index += 1) { const extra = input.messages[index]; if (extra) output.push(extra); }
  return output;
}

export function projectionOverlapsEntryIds(
  entryIds: ReadonlySet<string>,
  atoms: readonly ContextAtom[],
  projectionEvents: readonly ContextProjectionEvent[],
): boolean {
  const uniqueEvents = uniqueProjectionEvents(projectionEvents);
  const states = reduceProjectionStates(atoms, uniqueEvents.filter(isExclusionEvent));
  if ([...states.values()].some((state) => state === "unavailable")) throw new ProjectionAlignmentError("active projection is unavailable");
  if (atoms.some((atom) => entryIds.has(atom.sourceRef.entryId) && states.get(atom.id) === "exclude")) return true;
  const { byAtom } = replacementUnits(atoms, states, uniqueEvents);
  return atoms.some((atom) => entryIds.has(atom.sourceRef.entryId) && byAtom.get(atom.id)?.state.replacementState === "replaced");
}
