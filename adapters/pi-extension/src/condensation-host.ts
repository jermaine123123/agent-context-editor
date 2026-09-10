import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  estimateCondensationTokens,
  frameCondensationSummary,
  stableFingerprint,
  type CondensationRange,
  type ContextCondensationEventV1,
  type ContextAtom,
  type ContextProjectionEvent,
} from "./shared-core/index.js";

export interface PiCondensationMessage {
  entryId: string;
  message: AgentMessage | null;
}

export interface PiCondensationBuildInput {
  sessionId: string;
  baseRevision: string;
  operationId: string;
  range: CondensationRange;
  summary: string;
  provider: string;
  model: string;
  prefixTokens?: number;
  prefixReused?: boolean;
  createdAt?: string;
  entries: readonly unknown[];
  excludedAtomIds?: ReadonlySet<string>;
}

function sourceEntryIds(range: CondensationRange): string[] {
  return Array.from(new Set([
    ...(range.sourceEntryIds ?? []),
    ...range.sourceUnits.flatMap((unit) => unit.sourceEntryIds ?? []),
  ].filter(Boolean)));
}

function stableRangeFingerprint(range: CondensationRange): string {
  return range.sourceFingerprint || stableFingerprint([
    ...sourceEntryIds(range),
    ...range.sourceUnits.flatMap((unit) => [unit.id, unit.text, unit.included ? "include" : "exclude"]),
  ]);
}

function selectedBlockIndices(range: CondensationRange, atoms: readonly ContextAtom[]): Map<string, Set<number>> {
  const selected = new Set(range.sourceUnits.flatMap((unit) => unit.atomIds));
  const result = new Map<string, Set<number>>();
  for (const atom of atoms) {
    if (!selected.has(atom.id)) continue;
    const set = result.get(atom.sourceRef.entryId) ?? new Set<number>();
    set.add(atom.sourceRef.blockIndex);
    result.set(atom.sourceRef.entryId, set);
  }
  return result;
}

function cloneMessage(message: AgentMessage, content: unknown): AgentMessage {
  return { ...(message as object), content } as AgentMessage;
}

function contentOf(message: AgentMessage): unknown {
  return (message as { content?: unknown }).content;
}

function condensationInput(range: CondensationRange): string {
  return range.sourceUnits
    .filter((source) => source.included && source.text.trim())
    .map((source) => {
      const facts = [
        "[" + source.kind + "] " + source.id,
        source.toolNames?.length ? "tools=" + source.toolNames.join(",") : "",
        source.isError ? "status=error" : "",
        source.hasSignature ? "signed-or-opaque-block=true" : "",
      ].filter(Boolean).join(" ");
      return facts + "\n" + source.text;
    })
    .join("\n\n");
}

export function condensationInstruction(range: CondensationRange): string {
  const originalTokens = range.sourceUnits
    .filter((source) => source.included)
    .reduce((sum, source) => sum + source.approxTokens, 0);
  const targetTokens = Math.max(1, Math.floor(originalTokens * 0.5));
  return [
    "Only condense the selected context below. Return summary text only; do not add a preamble or markdown fence.",
    "Write the summary in the same natural language as the selected conversation. If the conversation is Chinese, write in Chinese. Keep identifiers, paths and commands verbatim.",
    "Merge repeated facts and remove filler. Preserve the user goal, constraints, conclusions, evidence, unfinished work, file paths, commands, parameters, results, errors, modifications and artifact locations.",
    "Keep reasoning and tool facts needed to continue safely. Do not invent facts or silently drop essential information.",
    "Aim to reduce the selected content by at least 40%, preferably around 50–70%. Approximate original size: " + originalTokens + " tokens; aim for about " + targetTokens + " tokens.",
    "<selected-context>",
    condensationInput(range),
    "</selected-context>",
  ].join("\n");
}

function entryMessages(entries: readonly unknown[]): Map<string, AgentMessage> {
  const result = new Map<string, AgentMessage>();
  for (const raw of entries) {
    const entry = raw as { id?: unknown };
    const id = String(entry.id ?? "");
    if (!id) continue;
    const message = sessionEntryToContextMessages(raw as never)[0] as AgentMessage | undefined;
    if (message) result.set(id, message);
  }
  return result;
}

export function buildPiCondensationMessages(
  entries: readonly unknown[],
  atoms: readonly ContextAtom[],
  range: CondensationRange,
  summary: string,
  excludedAtomIds: ReadonlySet<string> = new Set(),
): { beforeMessages: PiCondensationMessage[]; afterMessages: PiCondensationMessage[] } {
  const byEntry = entryMessages(entries);
  const entryIds = sourceEntryIds(range);
  const selected = selectedBlockIndices(range, atoms);
  const atomIdsByBlock = new Map<string, Set<string>>();
  for (const atom of atoms) {
    const key = atom.sourceRef.entryId + ":" + atom.sourceRef.blockIndex;
    const set = atomIdsByBlock.get(key) ?? new Set<string>();
    set.add(atom.id);
    atomIdsByBlock.set(key, set);
  }
  const first = entryIds.find((id) => selected.has(id)) ?? entryIds[0];
  const summaryBlock = { type: "text", text: frameCondensationSummary(summary) };
  const beforeMessages: PiCondensationMessage[] = [];
  const afterMessages: PiCondensationMessage[] = [];
  let inserted = false;

  for (const entryId of entryIds) {
    const original = byEntry.get(entryId);
    if (!original) continue;
    const blocks = selected.get(entryId) ?? new Set<number>();
    const originalContent = contentOf(original);
    const effectiveContent = Array.isArray(originalContent)
      ? originalContent.filter((_block, index) => {
          if (blocks.has(index)) return true;
          const atomIds = atomIdsByBlock.get(entryId + ":" + index) ?? new Set<string>();
          return ![...atomIds].some((atomId) => excludedAtomIds.has(atomId));
        })
      : originalContent;
    const effective = Array.isArray(originalContent) ? cloneMessage(original, effectiveContent) : original;
    const before = structuredClone(effective);
    beforeMessages.push({ entryId, message: before });
    const role = String((effective as { role?: unknown }).role ?? "");
    const content = contentOf(effective);
    let next: AgentMessage | null = structuredClone(effective);
    if (Array.isArray(effectiveContent) && effectiveContent.length === 0 && blocks.size === 0) next = null;

    if (role === "user") {
      if (blocks.size > 0) {
        next = entryId === first && !inserted ? cloneMessage(effective, [summaryBlock]) : null;
        inserted ||= entryId === first;
      }
    } else if (role === "assistant" && Array.isArray(content)) {
      const output: unknown[] = [];
      for (let index = 0; index < content.length; index += 1) {
        if (blocks.has(index)) {
          if (entryId === first && !inserted) {
            output.push(summaryBlock);
            inserted = true;
          }
          continue;
        }
        output.push(content[index]);
      }
      if (entryId === first && !inserted) {
        output.unshift(summaryBlock);
        inserted = true;
      }
      next = output.length ? cloneMessage(effective, output) : null;
    } else if (role === "toolResult" && blocks.size > 0) {
      next = entryId === first && !inserted ? cloneMessage(effective, [summaryBlock]) : null;
      inserted ||= entryId === first;
    } else if (blocks.size > 0 && entryId === first && !inserted) {
      next = cloneMessage(effective, [summaryBlock]);
      inserted = true;
    } else if (blocks.size > 0) {
      next = null;
    }

    afterMessages.push({ entryId, message: next });
  }

  if (!inserted && first) {
    const original = byEntry.get(first);
    if (original) {
      const item = afterMessages.find((candidate) => candidate.entryId === first);
      if (item) item.message = cloneMessage(original, [summaryBlock]);
    }
  }

  return { beforeMessages, afterMessages };
}

export function buildPiCondensationEvent(input: PiCondensationBuildInput, atoms: readonly ContextAtom[]): ContextCondensationEventV1 {
  const messages = buildPiCondensationMessages(input.entries, atoms, input.range, input.summary, input.excludedAtomIds);
  return {
    schemaVersion: 1,
    type: "condensation",
    action: "apply",
    eventId: input.operationId,
    operationId: input.operationId,
    sessionId: input.sessionId,
    baseRevision: input.baseRevision,
    requestedUnitIds: input.range.requestedUnitIds,
    effectiveUnitIds: input.range.effectiveUnitIds,
    autoExpandedUnitIds: input.range.autoExpandedUnitIds,
    recordIds: input.range.recordIds,
    sourceEntryIds: sourceEntryIds(input.range),
    sourceRootSeqs: input.range.sourceRootSeqs,
    sourceFingerprint: stableRangeFingerprint(input.range),
    sourceUnits: input.range.sourceUnits,
    summary: input.summary,
    provider: input.provider,
    model: input.model,
    metrics: {
      beforeTokens: input.range.sourceUnits.filter((source) => source.included).reduce((sum, source) => sum + source.approxTokens, 0),
      afterTokens: estimateCondensationTokens(frameCondensationSummary(input.summary)),
      savedTokens: 0,
      savingsRatio: 0,
      belowRecommendedThreshold: false,
    },
    prefixTokens: input.prefixTokens ?? 0,
    ...(input.prefixReused === undefined ? {} : { prefixReused: input.prefixReused }),
    summaryTokens: estimateCondensationTokens(frameCondensationSummary(input.summary)),
    createdAt: input.createdAt ?? new Date().toISOString(),
    beforeMessages: messages.beforeMessages,
    afterMessages: messages.afterMessages,
  };
}

export function activePiCondensationEvents(events: readonly ContextProjectionEvent[]): ContextCondensationEventV1[] {
  const result = new Map<string, ContextCondensationEventV1>();
  for (const event of events) {
    if (!("type" in event) || event.type !== "condensation") continue;
    if (event.action === "apply") result.set(event.operationId, event);
    else if (event.action === "restore") result.delete(event.operationId);
  }
  return [...result.values()];
}