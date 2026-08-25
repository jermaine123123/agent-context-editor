/* GENERATED FILE - rebuild with npm run build:pi. */
/* Canonical Core source digest: 24f3e81e3644d0df5cf93fedf44d57f6b655f315476061cb36a2e0fbe5d7881f */
import { decodeKittyPrintable, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
//#region adapters/pi-extension/src/shared-core/fingerprint.ts
/** Deterministic identity check; this is not intended as a security hash. */
function stableFingerprint(parts) {
	let hash = 2166136261;
	for (const part of parts) {
		for (let index = 0; index < part.length; index += 1) {
			hash ^= part.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		hash ^= 124;
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
function fingerprintBlock(kind, timestamp, toolCallId, text) {
	return stableFingerprint([
		kind,
		String(timestamp),
		toolCallId ?? "",
		text
	]);
}
/** Stable atom identity. Content belongs in fingerprint, not in the key. */
function atomId(atom) {
	return `${atom.sourceRef.entryId}:${atom.sourceRef.blockIndex}:${atom.kind}`;
}
/** ID emitted by the original ctx editor V1 implementation. */
function legacyAtomId(atom) {
	return `${atom.sourceRef.entryId}:${atom.sourceRef.blockIndex}:${atom.kind}:${atom.fingerprint}`;
}
function branchRevision(leafId, atoms, extra = []) {
	return stableFingerprint([
		leafId ?? "",
		...atoms.map((atom) => `${atom.id}:${atom.fingerprint}`),
		...extra
	]);
}
//#endregion
//#region adapters/pi-extension/src/shared-core/projection.ts
function stateForAtom(states, atom) {
	return states.get(atom.id) ?? "include";
}
function reduceProjectionStates(atoms, events) {
	const result = /* @__PURE__ */ new Map();
	const byId = new Map(atoms.map((atom) => [atom.id, atom]));
	for (const atom of atoms) result.set(atom.id, "include");
	for (const event of events) for (const change of event.changes) {
		const atom = byId.get(change.atomId);
		if (!atom) continue;
		if (atom.fingerprint !== change.fingerprint || atom.sourceRef.entryId !== change.sourceRef.entryId || atom.sourceRef.blockIndex !== change.sourceRef.blockIndex) {
			result.set(atom.id, "unavailable");
			continue;
		}
		const current = result.get(atom.id) ?? "include";
		if (current === "unavailable") continue;
		if (current !== change.before && current !== change.after) {
			result.set(atom.id, "unavailable");
			continue;
		}
		result.set(atom.id, change.after);
	}
	return result;
}
function projectionStateForAtoms(atoms, states) {
	if (!atoms.length) return "unavailable";
	const values = atoms.map((atom) => stateForAtom(states, atom));
	if (values.some((value) => value === "unavailable")) return "unavailable";
	if (values.every((value) => value === "exclude")) return "exclude";
	if (values.every((value) => value === "include")) return "include";
	return "mixed";
}
function unitHasToolCall(unit, callIds) {
	return unit.atoms.some((atom) => !!atom.toolCallId && callIds.has(atom.toolCallId));
}
function unitHasSignedReasoning(unit) {
	return unit.kind === "reasoning" && unit.atoms.some((atom) => atom.hasSignature === true);
}
function unitHasKindAndTurn(unit, kind, turnIds) {
	return unit.kind === kind && unit.atoms.some((atom) => turnIds.has(atom.turnId));
}
/**
* Expand a user selection to a provider-safe context closure. Tool calls and
* results are paired by call id. A signed reasoning block is kept with all
* tool blocks in the same logical turn; the final answer remains independent.
*/
function selectProjectionTargets(records, unitIds, recordIds) {
	const units = records.flatMap((record) => record.units.map((unit) => ({
		record,
		unit
	})));
	const requested = /* @__PURE__ */ new Set();
	if (recordIds) {
		for (const item of units) if (recordIds.includes(item.record.id)) requested.add(item.unit.id);
	}
	if (unitIds) {
		for (const id of unitIds) if (units.some((item) => item.unit.id === id)) requested.add(id);
	}
	if (!unitIds && !recordIds) for (const item of units) requested.add(item.unit.id);
	const effective = new Set(requested);
	const selectedUnits = units.filter((item) => requested.has(item.unit.id)).map((item) => item.unit);
	const callIds = new Set(selectedUnits.flatMap((unit) => unit.atoms.map((atom) => atom.toolCallId).filter((id) => !!id)));
	for (const item of units) if (unitHasToolCall(item.unit, callIds)) effective.add(item.unit.id);
	const selectedTurns = new Set(selectedUnits.flatMap((unit) => unit.atoms.map((atom) => atom.turnId)));
	const selectedTool = selectedUnits.some((unit) => unit.kind === "tool");
	const selectedSignedReasoning = selectedUnits.some(unitHasSignedReasoning);
	if (selectedTool || selectedSignedReasoning) {
		const hasSignedReasoning = units.some((item) => unitHasSignedReasoning(item.unit) && item.unit.atoms.some((atom) => selectedTurns.has(atom.turnId)));
		const hasTool = units.some((item) => item.unit.kind === "tool" && item.unit.atoms.some((atom) => selectedTurns.has(atom.turnId)));
		if (hasSignedReasoning && hasTool) {
			for (const item of units) if (unitHasKindAndTurn(item.unit, "reasoning", selectedTurns) || unitHasKindAndTurn(item.unit, "tool", selectedTurns)) effective.add(item.unit.id);
		}
	}
	const effectiveItems = units.filter((item) => effective.has(item.unit.id));
	const recentTurnId = [...units].reverse().flatMap((item) => item.unit.atoms.map((atom) => atom.turnId))[0];
	const requestedAtomIds = units.filter((item) => requested.has(item.unit.id)).flatMap((item) => item.unit.atomIds);
	const effectiveAtomIds = effectiveItems.flatMap((item) => item.unit.atomIds);
	const unavailableUnitIds = effectiveItems.filter((item) => !item.unit.mutable || item.unit.projectionState === "unavailable").map((item) => item.unit.id);
	const requestedUnitIds = units.filter((item) => requested.has(item.unit.id)).map((item) => item.unit.id);
	const effectiveUnitIds = effectiveItems.map((item) => item.unit.id);
	return {
		requestedUnitIds,
		effectiveUnitIds,
		autoExpandedUnitIds: effectiveUnitIds.filter((id) => !requested.has(id)),
		requestedAtomIds,
		effectiveAtomIds,
		unavailableUnitIds,
		touchesRecentTurn: !!recentTurnId && effectiveItems.some((item) => item.unit.atoms.some((atom) => atom.turnId === recentTurnId))
	};
}
//#endregion
//#region adapters/pi-extension/src/shared-core/records.ts
function recordIdFor(atom) {
	if (atom.recordId) return atom.recordId;
	if (atom.kind === "user") return `user:${atom.sourceRef.entryId}`;
	if (atom.kind === "assistant_text" || atom.kind === "reasoning") return `ai:${atom.sourceRef.entryId}`;
	if (atom.kind === "tool_call") return atom.toolCallId ? `tool:${atom.sourceRef.entryId}:${atom.toolCallId}` : `tool:${atom.sourceRef.entryId}:block:${atom.sourceRef.blockIndex}`;
	if (atom.kind === "tool_output") return `tool-result:${atom.sourceRef.entryId}:block:${atom.sourceRef.blockIndex}`;
	return `system:${atom.sourceRef.entryId}`;
}
function recordGroupKeyFor(atom) {
	if (!atom.recordId && (atom.kind === "assistant_text" || atom.kind === "reasoning")) return `ai-turn:${atom.turnId}`;
	return recordIdFor(atom);
}
function kindFor(atom) {
	if (atom.kind === "user") return "user";
	if (atom.kind === "assistant_text" || atom.kind === "reasoning") return "ai";
	if (atom.kind === "tool_call" || atom.kind === "tool_output") return "tool";
	return null;
}
function fieldText(atom) {
	return [atom.toolName ?? "", atom.text].filter(Boolean).join(" ");
}
function unitKindFor(atom) {
	if (atom.kind === "reasoning") return "reasoning";
	if (atom.kind === "assistant_text") return "answer";
	if (atom.kind === "user") return "user";
	if (atom.kind === "tool_call" || atom.kind === "tool_output") return "tool";
	return null;
}
function unitViewState(atoms, states) {
	if (!atoms.length) return "show";
	const values = atoms.map((atom) => states?.get(atom.id) ?? "show");
	if (values.every((value) => value === "hide")) return "hide";
	if (values.every((value) => value === "show")) return "show";
	if (values.every((value) => value === "collapse")) return "collapse";
	return "mixed";
}
function projectUnits(recordId, atoms, states, projectionStates) {
	const order = [];
	const groups = /* @__PURE__ */ new Map();
	for (const atom of atoms) {
		const kind = unitKindFor(atom);
		if (!kind) continue;
		const group = groups.get(kind);
		if (group) group.push(atom);
		else {
			order.push(kind);
			groups.set(kind, [atom]);
		}
	}
	return order.map((kind) => {
		const grouped = groups.get(kind) ?? [];
		return {
			id: `${recordId}#${kind}`,
			recordId,
			kind,
			atomIds: grouped.map((atom) => atom.id),
			atoms: grouped,
			viewState: unitViewState(grouped, states),
			projectionState: projectionStateForAtoms(grouped, projectionStates ?? /* @__PURE__ */ new Map()),
			mutable: true
		};
	});
}
function projectRecords(atoms, states, projectionStates) {
	const order = [];
	const groups = /* @__PURE__ */ new Map();
	for (const atom of atoms) {
		if (!kindFor(atom)) continue;
		const groupKey = recordGroupKeyFor(atom);
		const group = groups.get(groupKey);
		if (group) group.push(atom);
		else {
			order.push(groupKey);
			groups.set(groupKey, [atom]);
		}
	}
	return order.map((groupKey) => {
		const grouped = groups.get(groupKey) ?? [];
		const id = grouped[0] ? recordIdFor(grouped[0]) : groupKey;
		const kind = grouped.map(kindFor).find((value) => value !== null);
		if (!kind) throw new Error(`context record ${id} has no actionable atoms`);
		const allHidden = grouped.length > 0 && grouped.every((atom) => states?.get(atom.id) === "hide");
		const first = grouped[0];
		const mutable = kind !== "tool" || grouped.every((atom) => !!atom.sourceRef.entryId);
		const units = projectUnits(id, grouped, states, projectionStates).map((unit) => ({
			...unit,
			mutable
		}));
		return {
			id,
			kind,
			atomIds: grouped.map((atom) => atom.id),
			atoms: grouped,
			units,
			entryId: first?.sourceRef.entryId,
			entryIds: Array.from(new Set(grouped.map((atom) => atom.sourceRef.entryId).filter(Boolean))),
			anchorEntryId: first?.sourceRef.entryId,
			toolCallId: grouped.find((atom) => atom.toolCallId)?.toolCallId,
			searchableText: grouped.map(fieldText).filter(Boolean).join("\n"),
			viewState: allHidden ? "hide" : "show",
			projectionState: projectionStateForAtoms(grouped, projectionStates ?? /* @__PURE__ */ new Map()),
			mutable
		};
	});
}
//#endregion
//#region adapters/pi-extension/src/shared-core/search.ts
function normalizeSearchQuery(query) {
	return query.trim().toLocaleLowerCase();
}
function normalizeSearchScope(scope) {
	return scope === "all" ? "all" : "dialogue";
}
function atomMatchesSearchScope(kind, scope = "dialogue") {
	return normalizeSearchScope(scope) === "all" || kind === "user" || kind === "assistant_text";
}
function searchOccurrences(records, query, enabledKinds, scope = "dialogue", enabledUnitKinds) {
	const needle = normalizeSearchQuery(query);
	if (!needle) return [];
	const normalizedScope = normalizeSearchScope(scope);
	const occurrences = [];
	const addMatches = (record, unit, atomId, blockIndex, field, haystack, anchorEntryId = record.anchorEntryId) => {
		if (!haystack) return;
		const lowered = haystack.toLocaleLowerCase();
		let from = 0;
		while (from < lowered.length) {
			const start = lowered.indexOf(needle, from);
			if (start < 0) break;
			occurrences.push({
				recordId: record.id,
				recordKind: record.kind,
				unitId: unit.id,
				unitKind: unit.kind,
				atomId,
				anchorEntryId,
				blockIndex,
				field,
				start,
				end: start + needle.length,
				excerpt: haystack.slice(Math.max(0, start - 80), Math.min(haystack.length, start + needle.length + 120))
			});
			from = start + Math.max(needle.length, 1);
		}
	};
	for (const record of records) {
		if (!enabledKinds.has(record.kind)) continue;
		const units = record.units.length > 0 ? record.units : [{
			id: `${record.id}#${record.kind}`,
			recordId: record.id,
			kind: record.kind === "ai" ? "answer" : record.kind,
			atomIds: record.atomIds,
			atoms: record.atoms,
			viewState: record.viewState,
			projectionState: record.projectionState,
			mutable: record.mutable
		}];
		for (const unit of units) {
			if (enabledUnitKinds !== void 0 && !enabledUnitKinds.has(unit.kind)) continue;
			for (const atom of unit.atoms) {
				if (!atomMatchesSearchScope(atom.kind, normalizedScope)) continue;
				if (atom.toolName) addMatches(record, unit, atom.id, atom.sourceRef.blockIndex, "tool_name", atom.toolName, atom.sourceRef.entryId);
				const field = atom.kind === "reasoning" ? "reasoning" : atom.kind === "tool_output" ? "tool_output" : atom.kind === "tool_call" ? "tool_args" : "message";
				addMatches(record, unit, atom.id, atom.sourceRef.blockIndex, field, atom.text, atom.sourceRef.entryId);
			}
		}
	}
	return occurrences;
}
function searchRecords(records, query, enabledKinds, scope = "dialogue", enabledUnitKinds) {
	const occurrences = searchOccurrences(records, query, enabledKinds, scope, enabledUnitKinds);
	const grouped = /* @__PURE__ */ new Map();
	for (const occurrence of occurrences) {
		const group = grouped.get(occurrence.unitId) ?? [];
		group.push(occurrence);
		grouped.set(occurrence.unitId, group);
	}
	const groups = Array.from(grouped.values());
	return groups.map((group, index) => {
		const first = group[0];
		if (!first) throw new Error("search record has no occurrence");
		return {
			...first,
			index,
			total: groups.length,
			occurrenceCount: group.length
		};
	});
}
const VIEW_EVENT_ENTRY_TYPE = "context-editor-view-event-v2";
function isViewState$1(value) {
	return value === "show" || value === "collapse" || value === "hide";
}
function isAtomKind$1(value) {
	return typeof value === "string" && [
		"user",
		"assistant_text",
		"reasoning",
		"tool_call",
		"tool_output",
		"summary"
	].includes(value);
}
function parseLegacyState(value) {
	if (!value || typeof value !== "object") return void 0;
	const raw = value;
	if (raw.version !== 1 || typeof raw.updatedAt !== "string" || !raw.items || typeof raw.items !== "object") return;
	const items = {};
	for (const [id, candidate] of Object.entries(raw.items)) {
		if (!candidate || typeof candidate !== "object") continue;
		const item = candidate;
		if (typeof item.fingerprint === "string" && isViewState$1(item.viewState)) items[id] = {
			fingerprint: item.fingerprint,
			viewState: item.viewState,
			contextState: "keep"
		};
	}
	const filter = raw.viewFilter;
	const viewFilter = filter && Array.isArray(filter.enabledKinds) && typeof filter.query === "string" && typeof filter.showHidden === "boolean" ? {
		enabledKinds: filter.enabledKinds.filter(isAtomKind$1),
		query: filter.query,
		showHidden: filter.showHidden
	} : void 0;
	return {
		version: 1,
		updatedAt: raw.updatedAt,
		...typeof raw.sourceLeafId === "string" ? { sourceLeafId: raw.sourceLeafId } : {},
		items,
		...viewFilter ? { viewFilter } : {}
	};
}
function readLatestLegacyState(entries) {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== "context-editor-state") continue;
		const parsed = parseLegacyState(entry.data);
		if (parsed) return parsed;
	}
}
function parseViewEvent(value) {
	if (!value || typeof value !== "object") return void 0;
	const raw = value;
	if (raw.version !== 2 || typeof raw.transactionId !== "string" || typeof raw.createdAt !== "string" || typeof raw.baseRevision !== "string" || ![
		"hide",
		"restore",
		"reset",
		"undo"
	].includes(String(raw.action)) || !Array.isArray(raw.changes)) return void 0;
	const changes = [];
	for (const candidate of raw.changes) {
		if (!candidate || typeof candidate !== "object") continue;
		const change = candidate;
		if (typeof change.atomId === "string" && typeof change.fingerprint === "string" && isViewState$1(change.before) && isViewState$1(change.after)) changes.push({
			atomId: change.atomId,
			fingerprint: change.fingerprint,
			before: change.before,
			after: change.after
		});
	}
	if (!changes.length) return void 0;
	return {
		version: 2,
		transactionId: raw.transactionId,
		createdAt: raw.createdAt,
		baseRevision: raw.baseRevision,
		action: raw.action,
		changes,
		...typeof raw.undoOf === "string" ? { undoOf: raw.undoOf } : {}
	};
}
function readViewEvents(entries) {
	const result = [];
	for (const entry of entries) {
		const raw = entry;
		if (raw?.type !== "custom" || raw.customType !== "context-editor-view-event-v2") continue;
		const parsed = parseViewEvent(raw.data);
		if (parsed) result.push(parsed);
	}
	return result;
}
function atomViewState(legacy, events, atom) {
	let value = "show";
	const old = legacy?.items[atom.id] ?? legacy?.items[legacyAtomId(atom)];
	if (old?.fingerprint === atom.fingerprint) value = old.viewState;
	for (const event of events) {
		const change = event.changes.find((candidate) => candidate.atomId === atom.id);
		if (change && change.fingerprint === atom.fingerprint) value = change.after;
	}
	return value;
}
function reduceViewStates(atoms, legacy, events) {
	const result = /* @__PURE__ */ new Map();
	for (const atom of atoms) result.set(atom.id, atomViewState(legacy, events, atom));
	return result;
}
function latestUndoableEvent(events) {
	const undone = /* @__PURE__ */ new Set();
	for (const event of events) if (event.action === "undo" && event.undoOf) undone.add(event.undoOf);
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (!event) continue;
		if (event.action !== "undo" && !undone.has(event.transactionId)) return event;
	}
}
function inverseChanges(event) {
	return event.changes.map((change) => ({
		atomId: change.atomId,
		fingerprint: change.fingerprint,
		before: change.after,
		after: change.before
	}));
}
//#endregion
//#region adapters/pi-extension/src/shared-core/prefs.ts
const CONTEXT_EDITOR_UNIT_KINDS = [
	"user",
	"reasoning",
	"answer",
	"tool"
];
const DEFAULT_CONTEXT_EDITOR_PREFS = {
	version: 3,
	enabledUnitKinds: [...CONTEXT_EDITOR_UNIT_KINDS],
	showHidden: false
};
function migrateRecordKindsToUnitKinds(enabledKinds) {
	const enabled = new Set(enabledKinds);
	return CONTEXT_EDITOR_UNIT_KINDS.filter((kind) => {
		if (kind === "reasoning" || kind === "answer") return enabled.has("ai");
		return enabled.has(kind);
	});
}
function recordKindsForUnitKinds(enabledUnitKinds) {
	const enabled = new Set(enabledUnitKinds);
	return [
		"user",
		"ai",
		"tool"
	].filter((kind) => {
		if (kind === "ai") return enabled.has("reasoning") || enabled.has("answer");
		return enabled.has(kind);
	});
}
/**
* Migrate persisted preferences without treating an explicit empty filter as
* corrupt. An empty filter is the user's valid "show no conversation kinds"
* choice; missing or malformed values use defaults.
*/
function normalizeContextEditorPrefs(value) {
	if (!value || typeof value !== "object") return {
		...DEFAULT_CONTEXT_EDITOR_PREFS,
		enabledUnitKinds: [...DEFAULT_CONTEXT_EDITOR_PREFS.enabledUnitKinds]
	};
	const raw = value;
	let enabledUnitKinds;
	if (Array.isArray(raw.enabledUnitKinds)) {
		const enabled = new Set(raw.enabledUnitKinds.filter((kind) => CONTEXT_EDITOR_UNIT_KINDS.includes(kind)));
		enabledUnitKinds = CONTEXT_EDITOR_UNIT_KINDS.filter((kind) => enabled.has(kind));
	} else if (Array.isArray(raw.enabledKinds)) enabledUnitKinds = migrateRecordKindsToUnitKinds(Array.from(new Set(raw.enabledKinds.filter((kind) => kind === "user" || kind === "ai" || kind === "tool"))));
	else return {
		...DEFAULT_CONTEXT_EDITOR_PREFS,
		enabledUnitKinds: [...DEFAULT_CONTEXT_EDITOR_PREFS.enabledUnitKinds]
	};
	return {
		version: 3,
		enabledUnitKinds,
		showHidden: raw.showHidden === true
	};
}
//#endregion
//#region adapters/pi-extension/src/shared-core/service.ts
function recordSnapshot(record) {
	return {
		id: record.id,
		kind: record.kind,
		viewState: record.viewState,
		projectionState: record.projectionState,
		mutable: record.mutable,
		units: record.units.map((unit) => ({
			id: unit.id,
			recordId: unit.recordId,
			kind: unit.kind,
			atomIds: unit.atomIds,
			viewState: unit.viewState,
			projectionState: unit.projectionState,
			mutable: unit.mutable
		})),
		...record.entryId ? { entryId: record.entryId } : {},
		...record.entryIds?.length ? { entryIds: record.entryIds } : {},
		...record.anchorEntryId ? { anchorEntryId: record.anchorEntryId } : {},
		...record.toolCallId ? { toolCallId: record.toolCallId } : {}
	};
}
function currentState(adapter) {
	const current = adapter.read();
	const legacy = readLatestLegacyState(current.entries);
	const persistedEvents = current.viewEvents ?? [];
	const projectionEvents = current.projectionEvents ?? [];
	const seenProjection = /* @__PURE__ */ new Set();
	const projectionEventsUnique = projectionEvents.filter((event) => {
		if (seenProjection.has(event.transactionId)) return false;
		seenProjection.add(event.transactionId);
		return true;
	});
	const sessionEvents = readViewEvents(current.entries);
	const seen = /* @__PURE__ */ new Set();
	const events = [...sessionEvents, ...persistedEvents].filter((event) => {
		if (seen.has(event.transactionId)) return false;
		seen.add(event.transactionId);
		return true;
	});
	const states = reduceViewStates(current.atoms, legacy, events);
	const projectionStates = current.projectionAvailable === false ? new Map(current.atoms.map((atom) => [atom.id, "unavailable"])) : reduceProjectionStates(current.atoms, projectionEventsUnique);
	const records = projectRecords(current.atoms, states, projectionStates);
	return {
		...current,
		legacy,
		events,
		projectionEvents: projectionEventsUnique,
		states,
		projectionStates,
		records
	};
}
function appendProjectionEvent(adapter, event) {
	if (adapter.appendProjectionEvent) return adapter.appendProjectionEvent(event);
	throw new Error("CONTEXT_EDITOR_PERSISTENCE_UNSUPPORTED");
}
function appendViewEvent(adapter, event) {
	if (adapter.appendViewEvent) return adapter.appendViewEvent(event);
	if (adapter.appendCustomEntry) return adapter.appendCustomEntry(VIEW_EVENT_ENTRY_TYPE, event);
	throw new Error("CONTEXT_EDITOR_PERSISTENCE_UNSUPPORTED");
}
function snapshotOf(state) {
	return {
		revision: state.revision,
		sourceLeafId: state.leafId,
		records: state.records.map(recordSnapshot),
		canUndo: !!latestUndoableEvent(state.events),
		legacyStateFound: !!state.legacy,
		...state.projectionAvailable !== void 0 ? { projectionAvailable: state.projectionAvailable } : {},
		...state.projectionError ? { projectionError: state.projectionError } : {}
	};
}
function atomCurrentView(state, atomId) {
	return state.states.get(atomId) ?? "show";
}
function makeEvent(state, action, changes, undoOf) {
	return {
		version: 2,
		transactionId: `context-tx-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
		createdAt: (/* @__PURE__ */ new Date()).toISOString(),
		baseRevision: state.revision,
		action,
		changes,
		...undoOf ? { undoOf } : {}
	};
}
function enabledRecordKinds(raw) {
	return new Set((Array.isArray(raw) ? raw : [
		"user",
		"ai",
		"tool"
	]).filter((value) => value === "user" || value === "ai" || value === "tool"));
}
var ContextEditorService = class {
	/** Search results are scoped by id so simultaneous Sessions cannot replace one another. */
	searchCache = /* @__PURE__ */ new Map();
	maxSearchCacheEntries = 32;
	getSnapshot(adapter) {
		return snapshotOf(currentState(adapter));
	}
	/** Return the full host-neutral records for clients that render content. */
	getRecords(adapter) {
		return currentState(adapter).records;
	}
	getRecord(adapter, recordId) {
		return currentState(adapter).records.find((record) => record.id === recordId) ?? null;
	}
	searchContextRecords(adapter, input) {
		const state = currentState(adapter);
		const scope = input.scope === "all" ? "all" : "dialogue";
		const enabledUnitKinds = Array.isArray(input.enabledUnitKinds) ? new Set(input.enabledUnitKinds.filter((value) => value === "reasoning" || value === "answer" || value === "user" || value === "tool")) : void 0;
		const matches = searchRecords(state.records, input.query, enabledRecordKinds(input.enabledKinds), scope, enabledUnitKinds);
		const id = `context-search-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		this.searchCache.set(id, {
			id,
			revision: state.revision,
			revisionProbe: state.revisionProbe,
			matches
		});
		while (this.searchCache.size > this.maxSearchCacheEntries) {
			const oldest = this.searchCache.keys().next().value;
			if (typeof oldest !== "string") break;
			this.searchCache.delete(oldest);
		}
		return {
			searchId: id,
			revision: state.revision,
			total: matches.length,
			totalOccurrences: matches.reduce((sum, match) => sum + match.occurrenceCount, 0)
		};
	}
	getContextSearchMatch(adapter, input) {
		const cache = this.searchCache.get(input.searchId);
		if (!cache) return null;
		if (input.revision && input.revision !== cache.revision) return null;
		try {
			if (adapter.read().revisionProbe !== cache.revisionProbe) {
				this.searchCache.delete(cache.id);
				return null;
			}
		} catch {
			this.searchCache.delete(cache.id);
			return null;
		}
		if (!cache.matches.length) return null;
		const index = (Math.trunc(input.index) % cache.matches.length + cache.matches.length) % cache.matches.length;
		return cache.matches[index] ?? null;
	}
	commitContextView(adapter, input) {
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const state = currentState(adapter);
		if (input.baseRevision !== state.revision) return {
			ok: false,
			conflict: true,
			snapshot: snapshotOf(currentState(adapter))
		};
		const requestedRecords = Array.isArray(input.recordIds) ? new Set(input.recordIds.filter((id) => typeof id === "string")) : null;
		const requestedUnits = Array.isArray(input.unitIds) ? new Set(input.unitIds.filter((id) => typeof id === "string")) : null;
		const selected = input.action === "reset" ? state.records : requestedRecords === null && requestedUnits === null ? state.records : state.records.filter((record) => requestedRecords?.has(record.id) || record.units.some((unit) => requestedUnits?.has(unit.id)));
		const target = input.action === "hide" ? "hide" : "show";
		const changes = [];
		for (const record of selected) {
			if (!record.mutable && input.action !== "reset") continue;
			const units = input.action === "reset" || requestedRecords?.has(record.id) || requestedRecords === null && requestedUnits === null ? record.units : record.units.filter((unit) => requestedUnits?.has(unit.id));
			for (const atom of units.flatMap((unit) => unit.atoms)) {
				const before = atomCurrentView(state, atom.id);
				if (before === target) continue;
				changes.push({
					atomId: atom.id,
					fingerprint: atom.fingerprint,
					before,
					after: target
				});
			}
		}
		if (!changes.length) return {
			ok: true,
			snapshot: snapshotOf(currentState(adapter))
		};
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const latest = currentState(adapter);
		if (latest.revision !== state.revision) return {
			ok: false,
			conflict: true,
			snapshot: snapshotOf(latest)
		};
		const eventId = appendViewEvent(adapter, makeEvent(state, input.action, changes));
		this.searchCache.clear();
		return {
			ok: true,
			eventId,
			snapshot: snapshotOf(currentState(adapter))
		};
	}
	previewContextProjection(adapter, input) {
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const state = currentState(adapter);
		if (state.projectionAvailable === false) throw new Error(state.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (input.baseRevision !== state.revision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		const recordIds = Array.isArray(input.recordIds) ? input.recordIds.filter((id) => typeof id === "string") : void 0;
		const unitIds = Array.isArray(input.unitIds) ? input.unitIds.filter((id) => typeof id === "string") : void 0;
		const selection = selectProjectionTargets(state.records, unitIds, recordIds);
		const stateByUnitId = {};
		for (const record of state.records) for (const unit of record.units) stateByUnitId[unit.id] = unit.projectionState;
		return {
			baseRevision: state.revision,
			action: input.action,
			...selection,
			stateByUnitId
		};
	}
	commitContextProjection(adapter, input) {
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const state = currentState(adapter);
		if (state.projectionAvailable === false) throw new Error(state.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (input.baseRevision !== state.revision) return {
			ok: false,
			conflict: true,
			snapshot: snapshotOf(currentState(adapter))
		};
		const preview = this.previewContextProjection(adapter, input);
		if (preview.unavailableUnitIds.length) throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		const target = input.action === "exclude" ? "exclude" : "include";
		const atoms = new Map(state.atoms.map((atom) => [atom.id, atom]));
		const changes = [];
		const seen = /* @__PURE__ */ new Set();
		for (const atomId of preview.effectiveAtomIds) {
			if (seen.has(atomId)) continue;
			seen.add(atomId);
			const atom = atoms.get(atomId);
			if (!atom) continue;
			const before = state.projectionStates.get(atomId) ?? "include";
			if (before === "unavailable") throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
			if (before === target) continue;
			changes.push({
				atomId,
				sourceRef: atom.sourceRef,
				fingerprint: atom.fingerprint,
				before,
				after: target
			});
		}
		if (!changes.length) return {
			ok: true,
			snapshot: snapshotOf(currentState(adapter))
		};
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const latest = currentState(adapter);
		if (latest.revision !== state.revision) return {
			ok: false,
			conflict: true,
			snapshot: snapshotOf(latest)
		};
		const eventId = appendProjectionEvent(adapter, {
			version: 1,
			transactionId: "context-projection-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9),
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			baseRevision: state.revision,
			action: input.action,
			changes
		});
		this.searchCache.clear();
		return {
			ok: true,
			eventId,
			snapshot: snapshotOf(currentState(adapter))
		};
	}
	undoContextView(adapter, input) {
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const state = currentState(adapter);
		if (input.baseRevision !== state.revision) return {
			ok: false,
			conflict: true,
			snapshot: snapshotOf(currentState(adapter))
		};
		const target = latestUndoableEvent(state.events);
		if (!target) return {
			ok: true,
			snapshot: snapshotOf(currentState(adapter))
		};
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const latest = currentState(adapter);
		if (latest.revision !== state.revision) return {
			ok: false,
			conflict: true,
			snapshot: snapshotOf(latest)
		};
		const eventId = appendViewEvent(adapter, makeEvent(state, "undo", inverseChanges(target), target.transactionId));
		this.searchCache.clear();
		return {
			ok: true,
			eventId,
			snapshot: snapshotOf(currentState(adapter))
		};
	}
};
/** Stable branch-shape parts shared by Worker and disk-preview adapters. */
function contextEditorBranchRevisionParts(entries) {
	return entries.map((entry) => {
		const value = entry;
		const data = value.data;
		const message = value.message;
		const content = message?.content;
		const contentShape = Array.isArray(content) ? content.map((part) => {
			if (!part || typeof part !== "object") return typeof part;
			const row = part;
			return [
				row.type,
				row.id,
				row.toolCallId,
				row.name,
				typeof row.text === "string" ? row.text.length : "",
				typeof row.thinking === "string" ? row.thinking.length : ""
			].join(":");
		}).join(",") : typeof content === "string" ? String(content.length) : "";
		return [
			value.id,
			value.parentId,
			value.type,
			value.customType,
			data?.transactionId,
			value.timestamp,
			message?.role,
			message?.timestamp,
			message?.toolCallId,
			contentShape
		].map((part) => String(part ?? "")).join(":");
	});
}
//#endregion
//#region adapters/pi-extension/src/normalize.ts
function timestampOf(entry) {
	const raw = entry.message?.timestamp ?? entry.timestamp ?? 0;
	const value = typeof raw === "number" ? raw : Date.parse(String(raw));
	return Number.isFinite(value) ? value : 0;
}
function contentToText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => {
		if (!part || typeof part !== "object") return "";
		const value = part;
		if (value.type === "text") return typeof value.text === "string" ? value.text : "";
		if (value.type === "thinking") return typeof value.thinking === "string" ? value.thinking : "";
		if (value.type === "toolCall") {
			const name = typeof value.name === "string" ? value.name : "tool";
			let args = "{}";
			try {
				args = JSON.stringify(value.arguments ?? value.input ?? {}) ?? "{}";
			} catch {
				args = "[unserializable arguments]";
			}
			return `${name} ${args}`;
		}
		if (value.type === "toolResult") return contentToText(value.content);
		if (typeof value.text === "string") return value.text;
		return "";
	}).filter(Boolean).join("\n");
}
function approximateTokens(text) {
	return Math.max(1, Math.ceil(text.length / 4));
}
function addAtom(atoms, entry, turnId, blockIndex, kind, text, options = {}) {
	const entryId = String(entry.id ?? "");
	if (!entryId) return void 0;
	const timestamp = timestampOf(entry);
	const atom = {
		id: "",
		recordId: options.recordId,
		sourceRef: {
			entryId,
			blockIndex
		},
		kind,
		turnId,
		timestamp,
		text,
		fingerprint: fingerprintBlock(kind, timestamp, options.toolCallId, text),
		approxTokens: approximateTokens(text),
		...options
	};
	atom.id = atomId(atom);
	atoms.push(atom);
	return atom;
}
function toolCallDetails(value) {
	const nested = value.toolCall && typeof value.toolCall === "object" ? value.toolCall : void 0;
	const id = String(value.id ?? nested?.id ?? "") || void 0;
	const name = String(value.name ?? nested?.name ?? "tool");
	const input = value.arguments ?? value.input ?? nested?.arguments ?? nested?.input ?? {};
	const signature = value.thoughtSignature ?? value.signature ?? nested?.thoughtSignature;
	return {
		id,
		name,
		input,
		signature: typeof signature === "string" ? signature : void 0
	};
}
/** Convert Pi's active branch into host-neutral ContextAtoms. */
function normalizeSessionEntries(entries) {
	const atoms = [];
	const toolRecordByCallId = /* @__PURE__ */ new Map();
	let turnId = "turn-0";
	for (const raw of entries) {
		const entry = raw;
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
			if (!/^\/[A-Za-z][A-Za-z0-9:_-]*(?:\s|$)/.test(text)) addAtom(atoms, entry, turnId, 0, "user", text);
			continue;
		}
		if (role === "toolResult") {
			const callId = String(message.toolCallId ?? "") || void 0;
			const recordId = callId ? toolRecordByCallId.get(callId) : void 0;
			addAtom(atoms, entry, turnId, 0, "tool_output", contentToText(message.content), {
				toolCallId: callId,
				toolName: message.toolName,
				isError: message.isError,
				recordId: recordId ?? `tool-result:${entryId}:block:0`
			});
			continue;
		}
		if (role !== "assistant") continue;
		const content = Array.isArray(message.content) ? message.content : [];
		for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
			const part = content[blockIndex];
			if (!part || typeof part !== "object") continue;
			const value = part;
			if (value.type === "text" && typeof value.text === "string") addAtom(atoms, entry, turnId, blockIndex, "assistant_text", value.text, { hasSignature: typeof value.textSignature === "string" });
			else if (value.type === "thinking" && typeof value.thinking === "string") addAtom(atoms, entry, turnId, blockIndex, "reasoning", value.thinking, {
				hasSignature: typeof value.thinkingSignature === "string",
				redacted: value.redacted === true
			});
			else if (value.type === "toolCall") {
				const detail = toolCallDetails(value);
				const recordId = detail.id ? `tool:${entryId}:${detail.id}` : `tool:${entryId}:block:${blockIndex}`;
				if (detail.id) toolRecordByCallId.set(detail.id, recordId);
				let input = "{}";
				try {
					input = JSON.stringify(detail.input ?? {}) ?? "{}";
				} catch {
					input = "[unserializable arguments]";
				}
				addAtom(atoms, entry, turnId, blockIndex, "tool_call", input, {
					toolCallId: detail.id,
					toolName: detail.name,
					hasSignature: !!detail.signature,
					recordId
				});
			}
		}
	}
	return atoms;
}
//#endregion
//#region adapters/pi-extension/src/types.ts
const ATOM_KINDS = [
	"user",
	"assistant_text",
	"reasoning",
	"tool_call",
	"tool_output",
	"summary"
];
//#endregion
//#region adapters/pi-extension/src/state.ts
const STATE_ENTRY_TYPE = "context-editor-state";
function isViewState(value) {
	return value === "show" || value === "collapse" || value === "hide";
}
function isAtomKind(value) {
	return typeof value === "string" && ATOM_KINDS.includes(value);
}
function parseViewFilter(value) {
	if (!value || typeof value !== "object") return void 0;
	const record = value;
	if (!Array.isArray(record.enabledKinds) || typeof record.query !== "string" || typeof record.showHidden !== "boolean") return;
	return {
		enabledKinds: record.enabledKinds.filter(isAtomKind),
		query: record.query,
		showHidden: record.showHidden
	};
}
function parseState(value) {
	if (!value || typeof value !== "object") return void 0;
	const record = value;
	if (record.version !== 1 || typeof record.updatedAt !== "string") return void 0;
	if (!record.items || typeof record.items !== "object") return void 0;
	const items = {};
	for (const [id, raw] of Object.entries(record.items)) {
		if (!raw || typeof raw !== "object") continue;
		const item = raw;
		if (typeof item.fingerprint === "string" && isViewState(item.viewState)) items[id] = {
			fingerprint: item.fingerprint,
			viewState: item.viewState,
			contextState: "keep"
		};
	}
	return {
		version: 1,
		updatedAt: record.updatedAt,
		...typeof record.sourceLeafId === "string" ? { sourceLeafId: record.sourceLeafId } : {},
		items,
		...parseViewFilter(record.viewFilter) ? { viewFilter: parseViewFilter(record.viewFilter) } : {}
	};
}
function readLatestState(entries) {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== "context-editor-state") continue;
		const state = parseState(entry.data);
		if (state) return state;
	}
}
function atomState(state, atom) {
	const item = state?.items[atom.id];
	if (!item || item.fingerprint !== atom.fingerprint) return {
		viewState: "show",
		contextState: "keep"
	};
	return {
		viewState: item.viewState,
		contextState: "keep"
	};
}
function stateWithAtom(state, atom, patch, sourceLeafId) {
	const previous = atomState(state, atom);
	return {
		version: 1,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		...sourceLeafId ? { sourceLeafId } : state?.sourceLeafId ? { sourceLeafId: state.sourceLeafId } : {},
		items: {
			...state?.items ?? {},
			[atom.id]: {
				fingerprint: atom.fingerprint,
				viewState: patch.viewState ?? previous.viewState,
				contextState: "keep"
			}
		},
		...state?.viewFilter ? { viewFilter: state.viewFilter } : {}
	};
}
function stateForAtoms(state, atoms, sourceLeafId) {
	const items = {};
	for (const atom of atoms) {
		const current = state?.items[atom.id];
		if (current?.fingerprint === atom.fingerprint) items[atom.id] = {
			...current,
			contextState: "keep"
		};
	}
	return {
		version: 1,
		updatedAt: state?.updatedAt ?? (/* @__PURE__ */ new Date(0)).toISOString(),
		...sourceLeafId ? { sourceLeafId } : state?.sourceLeafId ? { sourceLeafId: state.sourceLeafId } : {},
		items,
		...state?.viewFilter ? { viewFilter: state.viewFilter } : {}
	};
}
function stateWithViewFilter(state, viewFilter, sourceLeafId) {
	return {
		version: 1,
		updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
		...sourceLeafId ? { sourceLeafId } : state?.sourceLeafId ? { sourceLeafId: state.sourceLeafId } : {},
		items: Object.fromEntries(Object.entries(state?.items ?? {}).map(([id, item]) => [id, {
			...item,
			contextState: "keep"
		}])),
		viewFilter: {
			enabledKinds: [...viewFilter.enabledKinds],
			query: viewFilter.query,
			showHidden: viewFilter.showHidden
		}
	};
}
//#endregion
//#region adapters/pi-extension/src/filter.ts
const DEFAULT_ENABLED_KINDS = /* @__PURE__ */ new Set(["user", "assistant_text"]);
//#endregion
//#region adapters/pi-extension/src/locale.ts
/** Resolve the host language without depending on Pi's optional UI settings API. */
function detectPiLocale(source = globalThis) {
	const candidates = [
		...source.navigator?.languages ?? [],
		source.navigator?.language,
		source.process?.env?.LC_ALL,
		source.process?.env?.LC_MESSAGES,
		source.process?.env?.LANG
	].filter((value) => typeof value === "string" && value.length > 0);
	for (const value of candidates) if (value.toLowerCase().startsWith("zh")) return "zh";
	return "en";
}
function kindLabel(locale, kind) {
	return {
		en: {
			user: "User",
			assistant_text: "Assistant",
			reasoning: "Reasoning",
			tool_call: "Tool Call",
			tool_output: "Tool Output",
			summary: "Summary"
		},
		zh: {
			user: "用户",
			assistant_text: "助手",
			reasoning: "思考",
			tool_call: "工具调用",
			tool_output: "工具输出",
			summary: "摘要"
		}
	}[locale][kind];
}
function createPiText(locale) {
	const zh = locale === "zh";
	return {
		locale,
		back: zh ? "返回" : "Back",
		close: zh ? "关闭" : "Close",
		browse: zh ? "浏览对话记录" : "Browse conversation records",
		search: zh ? "搜索对话记录" : "Search conversation records",
		types: zh ? "筛选对话记录类型" : "Filter record types",
		hidden: zh ? "已隐藏记录" : "Hidden records",
		reset: zh ? "重置当前对话状态" : "Reset current conversation state",
		showContent: zh ? "查看完整记录（只读）" : "View full record (read-only)",
		older: zh ? "← 更早记录" : "← Older records",
		newer: zh ? "更新记录 →" : "Newer records →",
		done: zh ? "完成" : "Done",
		atomKind: (kind) => kindLabel(locale, kind),
		recordKind: (kind) => zh ? kind === "ai" ? "AI" : kind === "tool" ? "工具" : "用户" : kind === "ai" ? "AI" : kind === "tool" ? "Tool" : "User",
		unitKind: (kind) => zh ? kind === "reasoning" ? "思考" : kind === "answer" ? "回答" : kind === "tool" ? "工具" : "用户" : kind === "reasoning" ? "Reasoning" : kind === "answer" ? "Answer" : kind === "tool" ? "Tool" : "User",
		unitState: (state) => zh ? state === "partial" ? "部分" : state === "hidden" ? "已隐藏" : "显示" : state === "partial" ? "Partial" : state === "hidden" ? "Hidden" : "Shown",
		viewState: (state) => zh ? state === "hide" ? "已隐藏" : state === "collapse" ? "已折叠" : "正常显示" : state === "hide" ? "Hidden" : state === "collapse" ? "Collapsed" : "Shown",
		emptyContent: () => zh ? "（空内容）" : "(empty content)",
		detail: (atom) => {
			return (zh ? [
				`类型：${kindLabel(locale, atom.kind)}`,
				`来源：${atom.entryId}:${atom.blockIndex}`,
				`所属对话轮次：${atom.turnId}`,
				`预估 Token：${atom.approxTokens}`,
				atom.toolCallId ? `工具调用编号：${atom.toolCallId}` : void 0,
				atom.toolName ? `工具：${atom.toolName}` : void 0
			] : [
				`Type: ${kindLabel(locale, atom.kind)}`,
				`Source: ${atom.entryId}:${atom.blockIndex}`,
				`Turn: ${atom.turnId}`,
				`Estimated tokens: ${atom.approxTokens}`,
				atom.toolCallId ? `Tool call ID: ${atom.toolCallId}` : void 0,
				atom.toolName ? `Tool: ${atom.toolName}` : void 0
			]).filter(Boolean).join("\n");
		},
		contextState: (state) => {
			if (zh) return state === "exclude" ? "模型排除" : state === "mixed" ? "模型部分排除" : state === "unavailable" ? "模型不可用" : "模型保留";
			return state === "exclude" ? "Model excluded" : state === "mixed" ? "Model mixed" : state === "unavailable" ? "Model unavailable" : "Model included";
		},
		contextConfirmTitle: () => zh ? "确认模型上下文变更" : "Confirm model context change",
		contextConfirmHint: () => zh ? "Enter/y 确认 · Esc/n 取消" : "Enter/y confirm · Esc/n cancel",
		contextAwaiting: () => zh ? "等待确认" : "Awaiting confirmation",
		contextConfirm: (action, requested, effective, autoExpanded, recent) => {
			const actionLabel = action === "exclude" ? zh ? "排除" : "excluding" : zh ? "恢复" : "restoring";
			const recentWarning = recent ? zh ? "; 涉及最近一轮及其后续工具链，请确认任务连续性影响" : "; this touches the latest turn and may affect task continuity" : "";
			const expansion = autoExpanded > 0 ? zh ? "; 结构闭包自动扩展 " + autoExpanded + " 个单元" : "; structural closure adds " + autoExpanded + " units" : "";
			return zh ? "确认" + actionLabel + "模型上下文？请求 " + requested + " 个单元，最终影响 " + effective + " 个单元" + expansion + recentWarning + "。原始 Session 不会修改。" : "Confirm " + actionLabel + " model context? Requested " + requested + " unit(s), affecting " + effective + expansion + recentWarning + ". The original Session will not be modified.";
		},
		contextUnavailableAction: () => zh ? "模型投影 sidecar 不可用，已禁用 x；视觉隐藏仍可用。" : "The model projection sidecar is unavailable; x is disabled. View actions remain available.",
		truncatedDetail: (maxChars) => zh ? `[详情仅显示前 ${maxChars} 个字符；原始内容未修改]` : `[Only the first ${maxChars} characters are shown; original content is unchanged]`,
		readOnlyTitle: (kind) => zh ? `查看 ${kindLabel(locale, kind)} 记录（只读）` : `View ${kindLabel(locale, kind)} record (read-only)`,
		readOnlyChanged: () => zh ? "预览窗口中的修改不会保存，原始对话记录没有变化。" : "Edits in the preview are not saved; the original conversation record is unchanged.",
		viewAction: (hidden) => hidden ? zh ? "恢复在记录管理器中显示" : "Restore in record manager" : zh ? "从记录管理器中隐藏（不会隐藏主聊天窗口）" : "Hide from record manager (the main chat is unchanged)",
		messageLabel: () => zh ? "消息" : "Message",
		page: (start, end, total) => zh ? `对话记录 ${start}-${end}/${total}` : `Conversation records ${start}-${end}/${total}`,
		noMatches: () => zh ? "没有符合当前筛选条件的对话记录。" : "No conversation records match the current filters.",
		typeFilterTitle: () => zh ? "筛选对话记录类型（可多选）" : "Filter record types (multi-select)",
		resetEmpty: () => zh ? "当前对话没有需要重置的管理状态。" : "There is no managed state to reset for this conversation.",
		resetTitle: () => zh ? "重置当前对话状态？" : "Reset current conversation state?",
		resetMessage: (hidden) => zh ? `将恢复 ${hidden} 条已隐藏记录；原始对话记录不会删除，也不会改变模型上下文。` : `This will restore ${hidden} hidden records; the original conversation and model context will not be changed.`,
		savedMessage: (hidden) => zh ? `已保存当前对话状态：隐藏 ${hidden} 条。隐藏和筛选只影响记录管理器，不会改变主聊天窗口或模型上下文；下次打开时会恢复这些设置。` : `Conversation state saved: ${hidden} hidden. Hiding and filtering only affect the record manager; the main chat and model context are unchanged, and these settings will be restored next time.`,
		searchTitle: () => zh ? "搜索对话记录" : "Search conversation records",
		searchPlaceholder: () => zh ? "输入关键词；留空清除" : "Enter a keyword; leave blank to clear",
		searchScope: (scope) => scope === "all" ? zh ? "搜索范围：全文" : "Search scope: Full" : zh ? "搜索范围：对话" : "Search scope: Dialogue",
		hiddenSummary: (hidden, shown) => zh ? `已隐藏记录（${shown ? "当前显示" : "当前不显示"}）` : `Hidden records (${shown ? "shown" : "hidden"})`,
		resetSummary: (hidden) => zh ? `重置当前对话状态（已隐藏 ${hidden}）` : `Reset current conversation state (${hidden} hidden)`,
		browseSummary: (matches, total) => zh ? `浏览对话记录（${matches}/${total}）` : `Browse conversation records (${matches}/${total})`,
		searchSummary: (query) => query ? `${zh ? "搜索对话记录" : "Search conversation records"}${zh ? "：" : ": "}${query}` : zh ? "搜索对话记录" : "Search conversation records",
		typeSummary: (count, total) => `${zh ? "筛选对话记录类型" : "Filter record types"} (${count}/${total})`,
		unitTitle: (unitKind, recordKind, state, tokens) => `${unitKind} · ${recordKind} · ${state} · ${tokens} tok`,
		hiddenUnit: (unitKind) => zh ? `    ${unitKind} 已隐藏 · 按 v 显示` : `    ${unitKind} hidden · press v to reveal`,
		hiddenSearchHit: () => zh ? " · " : " · match is in hidden content",
		tuiTitle: (units) => `${zh ? "Pi Context Editor" : "Pi Context Editor"}  ${units} ${zh ? "单元" : "units"}`,
		unitCount: (units) => `${units} ${zh ? "单元" : "units"}`,
		tuiSearch: (query, count, _index, scope = "dialogue") => {
			const scopeLabel = scope === "all" ? zh ? "全文" : "full" : zh ? "对话" : "dialogue";
			return zh ? `\u641c\u7d22\uff1a[${scopeLabel}] ${query}▌ · ${count} \u4e2a\u547d\u4e2d` : `Search: [${scopeLabel}] ${query}▌ · ${count} matches`;
		},
		tuiSearchIdle: (query, count, index, scope = "dialogue") => {
			const scopeLabel = scope === "all" ? zh ? "全文" : "full" : query ? zh ? "对话" : "dialogue" : "";
			const prefix = `${zh ? "搜索" : "Search"}${zh ? "：" : ": "}${query || (zh ? "（按 / 搜索）" : "(press /)")}${scopeLabel ? ` · ${scopeLabel}` : ""}`;
			if (count <= 0) return prefix;
			return `${prefix} · ${index >= 0 ? `${index + 1}/${count}` : `${count} ${zh ? "个命中" : "matches"}`}`;
		},
		tuiStatus: (mode = "normal", scope = "dialogue") => {
			if (mode === "search") return zh ? "输入关键词 · Enter 跳转 · Esc 结束搜索" : "Type a query · Enter jump · Esc finish search";
			if (mode === "results") return zh ? "n 下一个命中，N 上一个命中 · s 切换范围 · / 修改搜索 · ? 帮助 · q 关闭" : "n next / N previous occurrence · s toggle scope · / edit search · ? help · q close";
			if (mode === "help") return zh ? "? Esc 返回编辑器" : "? / Esc return to editor";
			return zh ? "j/k · Enter 查看/收起 · h 隐藏 · r 恢复 · x 排除/恢复模型上下文 · / 搜索 · ? 帮助 · q 关闭" : "j/k move · Enter view/collapse · h hide · r restore · x exclude/restore model context · / search · ? help · q close";
		},
		tuiHelpTitle: () => zh ? "Context Editor 快捷键" : "Context Editor help",
		tuiHelpLines: () => zh ? [
			"Enter  临时展开/收起，不保存",
			"x      排除/恢复模型上下文；Enter/y 确认，Esc/n 取消，不修改 Session JSONL",
			"h      持久隐藏；r      恢复隐藏单元",
			"Space  选择/取消；Shift+↑/↓ 连续选择",
			"j/k、↑/↓、PgUp/PgDn 导航；g/G 跳到首尾",
			"/      搜索；n 下一个，N 上一个命中",
			"s      切换对话/全文搜索范围",
			"1/2/3  筛选用户、AI、工具；4/5 筛选思考、回答；a 全选当前结果",
			"u 撤销；v 临时显示隐藏正文",
			"R  恢复全部隐藏单元（兼容键）"
		] : [
			"Enter  temporarily expand/collapse; does not persist",
			"x      exclude/restore model context; Enter/y confirm, Esc/n cancel; Session JSONL stays unchanged",
			"h      persistently hide; r      restore hidden",
			"Space  select; Shift+↑/↓ extend the selection",
			"j/k, arrows, PgUp/PgDn navigate; g/G jump to ends",
			"/      search; n next, N previous occurrence",
			"s      dialogue/full search scope",
			"1/2/3 filter User, AI, Tool; 4/5 filter Reasoning, Answer; a select all visible matches",
			"u undo; v reveal hidden content temporarily",
			"R restore all hidden units (compatibility shortcut)"
		],
		savePrefsFailed: (error) => zh ? `Context Editor 偏好保存失败：${error}` : `Context Editor preferences could not be saved: ${error}`,
		sessionChanged: () => zh ? "Session 或分支已变化，已清空临时选择。" : "The Session or branch changed; temporary selection was cleared.",
		sidecarChanged: () => zh ? "会话或 sidecar 已变化，已刷新 Context Editor。" : "The conversation or sidecar changed; Context Editor was refreshed.",
		operationFailed: (error) => zh ? `Context Editor 操作失败：${error}` : `Context Editor operation failed: ${error}`,
		busy: () => zh ? "Agent 运行中，暂时不能修改隐藏状态。" : "The Agent is running; hidden state cannot be changed yet.",
		undoConflict: () => zh ? "撤销时发现 revision 冲突，已刷新。" : "A revision conflict occurred while undoing; the view was refreshed.",
		undoFailed: (error) => zh ? `撤销失败：${error}` : `Undo failed: ${error}`,
		restoreAllConfirmTitle: () => zh ? "恢复全部隐藏单元？" : "Restore all hidden units?",
		restoreAllConfirmMessage: () => zh ? "这只会恢复 Context Editor 的视觉状态，不会修改 Session 或模型上下文。" : "This only restores the Context Editor view state; the Session and model context are unchanged."
	};
}
//#endregion
//#region adapters/pi-extension/src/desktop-ui.ts
const PAGE_SIZE = 50;
const MAX_EDITOR_CHARS = 1e5;
function compactPreview(text, value, maxChars = 96) {
	const compact = value.replace(/\s+/g, " ").trim();
	if (!compact) return text.emptyContent();
	return compact.length > maxChars ? `${compact.slice(0, maxChars - 1)}…` : compact;
}
function viewLabel(text, viewState) {
	return text.viewState(viewState);
}
function atomOption(text, atom, index, state) {
	const current = atomState(state, atom);
	const meta = [
		text.atomKind(atom.kind),
		atom.toolName,
		viewLabel(text, current.viewState),
		`${atom.approxTokens} tok`
	].filter(Boolean).join(" · ");
	return `#${String(index + 1).padStart(4, "0")} · ${meta} · ${compactPreview(text, atom.text)}`;
}
function detailText(text, atom) {
	const metadata = text.detail({
		kind: atom.kind,
		entryId: atom.sourceRef.entryId,
		blockIndex: atom.sourceRef.blockIndex,
		turnId: atom.turnId,
		approxTokens: atom.approxTokens,
		toolCallId: atom.toolCallId,
		toolName: atom.toolName
	});
	const body = atom.text || text.emptyContent();
	return `${metadata}\n\n${body.length > MAX_EDITOR_CHARS ? `${body.slice(0, MAX_EDITOR_CHARS)}\n\n${text.truncatedDetail(MAX_EDITOR_CHARS)}` : body}`;
}
function visibleAtoms(atoms, state, filter) {
	const query = filter.query.trim().toLocaleLowerCase();
	return atoms.filter((atom) => {
		if (!filter.enabledKinds.has(atom.kind)) return false;
		if (query) {
			if (!atomMatchesSearchScope(atom.kind, filter.searchScope)) return false;
			if (![atom.toolName ?? "", atom.text].join(" ").toLocaleLowerCase().includes(query)) return false;
		}
		return filter.showHidden || atomState(state, atom).viewState !== "hide";
	});
}
function stateSummary(atoms, state) {
	let hidden = 0;
	for (const atom of atoms) if (atomState(state, atom).viewState === "hide") hidden += 1;
	return { hidden };
}
async function viewAtom(text, ui, atom) {
	const prefill = detailText(text, atom);
	const edited = await ui.editor(text.readOnlyTitle(atom.kind), prefill);
	if (edited !== void 0 && edited !== prefill) ui.notify(text.readOnlyChanged(), "info");
}
async function editAtom(text, deps, state, atom) {
	let currentState = state;
	while (true) {
		const current = atomState(currentState, atom);
		const viewAction = text.viewAction(current.viewState === "hide");
		const options = [
			text.showContent,
			viewAction,
			text.back
		];
		const selected = await deps.ui.select(`${text.atomKind(atom.kind)} · ${atom.toolName ?? text.messageLabel()}`, options);
		if (selected === void 0 || selected === text.back) return currentState;
		if (selected === text.showContent) {
			await viewAtom(text, deps.ui, atom);
			continue;
		}
		if (selected === viewAction) {
			currentState = stateWithAtom(currentState, atom, { viewState: current.viewState === "hide" ? "show" : "hide" }, deps.sourceLeafId);
			deps.persistState(currentState);
			continue;
		}
	}
}
async function browseAtoms(text, deps, atoms, state, filter) {
	let currentState = state;
	while (true) {
		const matches = visibleAtoms(atoms, currentState, filter);
		if (matches.length === 0) {
			deps.ui.notify(text.noMatches(), "info");
			return currentState;
		}
		const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
		let page = pageCount - 1;
		while (true) {
			const start = page * PAGE_SIZE;
			const pageAtoms = matches.slice(start, start + PAGE_SIZE);
			const atomOptions = pageAtoms.map((atom, index) => atomOption(text, atom, start + index, currentState));
			const optionToAtom = new Map(pageAtoms.map((atom, index) => [atomOption(text, atom, start + index, currentState), atom]));
			const options = [...atomOptions];
			if (page > 0) options.push(text.older);
			if (page < pageCount - 1) options.push(text.newer);
			options.push(text.back);
			const selected = await deps.ui.select(text.page(start + 1, start + pageAtoms.length, matches.length), options);
			if (selected === void 0 || selected === text.back) return currentState;
			if (selected === text.older) {
				page = Math.max(0, page - 1);
				continue;
			}
			if (selected === text.newer) {
				page = Math.min(pageCount - 1, page + 1);
				continue;
			}
			const atom = optionToAtom.get(selected);
			if (!atom) continue;
			currentState = await editAtom(text, deps, currentState, atom);
			break;
		}
	}
}
async function editTypeFilter(text, ui, filter) {
	while (true) {
		const options = ATOM_KINDS.map((kind) => `${filter.enabledKinds.has(kind) ? "✓" : "○"} ${text.atomKind(kind)}`);
		const optionToKind = new Map(ATOM_KINDS.map((kind) => [`${filter.enabledKinds.has(kind) ? "✓" : "○"} ${text.atomKind(kind)}`, kind]));
		options.push(text.done);
		const selected = await ui.select(text.typeFilterTitle(), options);
		if (selected === void 0 || selected === text.done) return;
		const kind = optionToKind.get(selected);
		if (!kind) continue;
		if (filter.enabledKinds.has(kind)) filter.enabledKinds.delete(kind);
		else filter.enabledKinds.add(kind);
	}
}
async function resetState(text, deps, atoms, state) {
	const summary = stateSummary(atoms, state);
	if (summary.hidden === 0) {
		deps.ui.notify(text.resetEmpty(), "info");
		return state;
	}
	if (!await deps.ui.confirm(text.resetTitle(), text.resetMessage(summary.hidden))) return state;
	const nextState = {
		...stateForAtoms(void 0, atoms, deps.sourceLeafId),
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
	deps.persistState(nextState);
	return nextState;
}
function persistFilterState(deps, state, filter) {
	const enabledKinds = [...filter.enabledKinds].sort();
	const previous = state.viewFilter;
	if (previous && previous.query === filter.query && previous.showHidden === filter.showHidden && previous.enabledKinds.length === enabledKinds.length && previous.enabledKinds.every((kind, index) => kind === enabledKinds[index])) return state;
	const nextState = stateWithViewFilter(state, {
		enabledKinds,
		query: filter.query,
		showHidden: filter.showHidden
	}, deps.sourceLeafId);
	deps.persistState(nextState);
	return nextState;
}
/** Run the Pi Desktop-compatible, dialog-only Context Editor. */
async function runDesktopContextEditor(deps) {
	const text = createPiText(deps.locale ?? detectPiLocale());
	let state = stateForAtoms(deps.initialState, deps.atoms, deps.sourceLeafId);
	let changed = false;
	const flowDeps = {
		...deps,
		persistState: (nextState) => {
			changed = true;
			deps.persistState(nextState);
		}
	};
	const savedFilter = state.viewFilter;
	const filter = {
		enabledKinds: new Set(savedFilter?.enabledKinds ?? DEFAULT_ENABLED_KINDS),
		query: savedFilter?.query ?? "",
		showHidden: savedFilter?.showHidden ?? false,
		searchScope: "dialogue"
	};
	while (true) {
		const matches = visibleAtoms(deps.atoms, state, filter);
		const summary = stateSummary(deps.atoms, state);
		const searchLabel = filter.query ? `${text.locale === "zh" ? "：" : ": "}${compactPreview(text, filter.query, 24)}` : "";
		`${filter.enabledKinds.size}${ATOM_KINDS.length}`;
		const selected = await deps.ui.select("Pi Context Editor", [
			text.browseSummary(matches.length, deps.atoms.length),
			`${text.search}${searchLabel}`,
			text.searchScope(filter.searchScope),
			text.typeSummary(filter.enabledKinds.size, ATOM_KINDS.length),
			text.hiddenSummary(summary.hidden, filter.showHidden),
			text.resetSummary(summary.hidden),
			text.close
		]);
		if (selected === void 0 || selected === text.close) {
			if (changed) deps.ui.notify(text.savedMessage(summary.hidden), "info");
			return;
		}
		if (selected.startsWith(text.browse)) {
			state = await browseAtoms(text, flowDeps, deps.atoms, state, filter);
			continue;
		}
		if (selected.startsWith(text.search)) {
			const query = await flowDeps.ui.input(text.searchTitle(), filter.query || text.searchPlaceholder());
			if (query !== void 0) {
				filter.query = query.trim();
				state = persistFilterState(flowDeps, state, filter);
			}
			continue;
		}
		if (selected === text.searchScope(filter.searchScope)) {
			filter.searchScope = filter.searchScope === "dialogue" ? "all" : "dialogue";
			continue;
		}
		if (selected.startsWith(text.types)) {
			await editTypeFilter(text, flowDeps.ui, filter);
			state = persistFilterState(flowDeps, state, filter);
			continue;
		}
		if (selected.startsWith(text.hidden)) {
			filter.showHidden = !filter.showHidden;
			state = persistFilterState(flowDeps, state, filter);
			continue;
		}
		if (selected.startsWith(text.reset)) {
			const previousState = state;
			state = await resetState(text, flowDeps, deps.atoms, state);
			if (state !== previousState) {
				filter.enabledKinds = new Set(DEFAULT_ENABLED_KINDS);
				filter.query = "";
				filter.showHidden = false;
				filter.searchScope = "dialogue";
				state = persistFilterState(flowDeps, state, filter);
			}
		}
	}
}
//#endregion
//#region adapters/pi-extension/src/ui.ts
const UNIT_KINDS = CONTEXT_EDITOR_UNIT_KINDS;
function colorForKind(kind) {
	return kind === "user" ? "accent" : kind === "ai" ? "text" : "toolOutput";
}
function visiblePad(text, width) {
	return truncateToWidth(text, Math.max(1, width), "…", true);
}
var ContextEditorComponent = class {
	tui;
	theme;
	loadRecords;
	loadSnapshot;
	mutate;
	undoMutation;
	persistPrefs;
	notify;
	done;
	previewContext;
	commitContext;
	projectionAvailable;
	text;
	records;
	prefs;
	query = "";
	revision;
	canUndo;
	selectedIndex = 0;
	scrollOffset = 0;
	manualScroll = false;
	selected = /* @__PURE__ */ new Set();
	rangeAnchor = null;
	expanded = /* @__PURE__ */ new Set();
	searchMode = false;
	helpMode = false;
	searchScope = "dialogue";
	matches = [];
	matchIndex = -1;
	lastRenderWidth = 0;
	lastRenderRows = 0;
	pendingConfirmation = null;
	operationInFlight = false;
	bodyCache = /* @__PURE__ */ new Map();
	constructor(tui, theme, records, snapshot, prefs, deps, done) {
		this.tui = tui;
		this.theme = theme;
		this.records = [...records];
		this.revision = snapshot.revision;
		this.canUndo = snapshot.canUndo;
		this.previewContext = deps.previewContext;
		this.commitContext = deps.commitContext;
		this.projectionAvailable = snapshot.projectionAvailable !== false && !!deps.previewContext && !!deps.commitContext;
		this.prefs = {
			...prefs,
			enabledUnitKinds: [...prefs.enabledUnitKinds]
		};
		this.loadRecords = deps.loadRecords;
		this.loadSnapshot = deps.loadSnapshot;
		this.mutate = deps.mutate;
		this.undoMutation = deps.undo;
		this.persistPrefs = deps.persistPrefs;
		this.notify = deps.notify;
		this.done = done;
		this.text = createPiText(deps.locale ?? detectPiLocale());
	}
	flatUnits() {
		const enabled = new Set(this.prefs.enabledUnitKinds);
		return this.records.flatMap((record) => record.units.filter((unit) => enabled.has(unit.kind)).map((unit) => ({
			record,
			unit
		})));
	}
	searchOccurrencesForPrefs() {
		const enabledUnitKinds = new Set(this.prefs.enabledUnitKinds);
		return searchOccurrences(this.records, this.query, new Set(recordKindsForUnitKinds(this.prefs.enabledUnitKinds)), this.searchScope, enabledUnitKinds);
	}
	selectedUnitIds() {
		return [...this.selected].filter((id) => this.flatUnits().some(({ unit }) => unit.id === id));
	}
	currentUnit() {
		return this.flatUnits()[this.selectedIndex];
	}
	highlightText(text, start, end) {
		if (start < 0 || end <= start || start >= text.length) return text;
		const safeEnd = Math.min(text.length, end);
		return `${text.slice(0, start)}${this.theme.fg("warning", text.slice(start, safeEnd))}${text.slice(safeEnd)}`;
	}
	contentText(unit, activeHit) {
		return unit.atoms.map((atom) => {
			if (activeHit && activeHit.field !== "tool_name" && activeHit.atomId === atom.id) return this.highlightText(atom.text, activeHit.start, activeHit.end);
			return atom.text;
		}).filter(Boolean).join("\n");
	}
	unitIsHidden(unit) {
		return unit.viewState === "hide" || unit.viewState === "mixed";
	}
	bodyLinesFor(unit, width, activeHit) {
		const text = this.contentText(unit, activeHit);
		const available = Math.max(8, width - 8);
		const highlightKey = activeHit ? `${activeHit.atomId}:${activeHit.field}:${activeHit.start}:${activeHit.end}` : "";
		const cached = this.bodyCache.get(unit.id);
		if (cached && cached.width === available && cached.text === text && cached.highlightKey === highlightKey) return cached.lines;
		const lines = wrapTextWithAnsi(text || " ", available);
		const normalized = lines.length > 0 ? lines : [" "];
		this.bodyCache.set(unit.id, {
			width: available,
			text,
			highlightKey,
			lines: normalized
		});
		return normalized;
	}
	activeHitForUnit(unit) {
		const hit = this.matches[this.matchIndex];
		return hit?.unitId === unit.id ? hit : void 0;
	}
	toolNameForUnit(unit) {
		const atom = unit.atoms.find((candidate) => !!candidate.toolName);
		return atom?.toolName ? {
			name: atom.toolName,
			atomId: atom.id
		} : void 0;
	}
	titleText(record, unit, index, activeHit) {
		const selected = this.selected.has(unit.id);
		const cursor = index === this.selectedIndex ? "▶" : " ";
		const checkbox = selected ? "[x]" : "[ ]";
		const hidden = this.unitIsHidden(unit);
		const state = hidden ? unit.viewState === "mixed" ? "partial" : "hidden" : "shown";
		const modelState = unit.projectionState ?? "include";
		const base = `${cursor} ${checkbox} ${this.text.unitKind(unit.kind)} · ${this.text.recordKind(record.kind)} · ${this.text.unitState(state)} · ${this.text.contextState(modelState)} · ${unit.atoms.reduce((sum, atom) => sum + atom.approxTokens, 0)} tok`;
		if (hidden && !this.prefs.showHidden) return base;
		const tool = this.toolNameForUnit(unit);
		if (!tool) return base;
		return `${base} · ${activeHit?.field === "tool_name" && activeHit.atomId === tool.atomId ? this.highlightText(tool.name, activeHit.start, activeHit.end) : tool.name}`;
	}
	unitLineCount(item, width) {
		const { unit } = item;
		if (this.unitIsHidden(unit) && !this.prefs.showHidden) return 2;
		if (!this.expanded.has(unit.id) && !this.prefs.showHidden) return 1;
		if (!this.expanded.has(unit.id) && this.unitIsHidden(unit)) return 1 + this.bodyLinesFor(unit, width).length;
		if (!this.expanded.has(unit.id)) return 1;
		return 1 + this.bodyLinesFor(unit, width).length;
	}
	unitRows(width, start = 0, end = this.flatUnits().length) {
		return this.flatUnits().slice(start, end).map((item, offset) => {
			const index = start + offset;
			const { record, unit } = item;
			const activeHit = this.activeHitForUnit(unit);
			const hidden = this.unitIsHidden(unit);
			hidden && unit.viewState;
			const title = this.titleText(record, unit, index, activeHit);
			const titleLine = this.theme.fg(colorForKind(record.kind), title);
			const lines = [index === this.selectedIndex ? this.theme.bg("selectedBg", visiblePad(titleLine, width)) : visiblePad(titleLine, width)];
			if (hidden && !this.prefs.showHidden) {
				const hiddenLabel = this.activeHitForUnit(unit) ? `${this.text.hiddenUnit(this.text.unitKind(unit.kind))}${this.text.hiddenSearchHit()}` : this.text.hiddenUnit(this.text.unitKind(unit.kind));
				lines.push(visiblePad(this.theme.fg("dim", hiddenLabel), width));
			} else if (this.expanded.has(unit.id) || hidden && this.prefs.showHidden) for (const line of this.bodyLinesFor(unit, width, activeHit)) lines.push(visiblePad(this.theme.fg("dim", `    │ ${line}`), width));
			return {
				item,
				lines
			};
		});
	}
	availableRows() {
		return Math.max(5, this.tui.terminal.rows - 7);
	}
	totalLineCount(width) {
		return this.flatUnits().reduce((sum, item) => sum + this.unitLineCount(item, width), 0);
	}
	clampScroll(width = this.tui.terminal.columns) {
		const viewport = this.availableRows();
		const maxOffset = Math.max(0, this.totalLineCount(width) - viewport);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
		return maxOffset;
	}
	scrollByRows(delta) {
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
	ensureSelectionVisible(width = this.tui.terminal.columns) {
		const selectedLine = this.unitStartOffset(this.selectedIndex, width);
		const viewport = this.availableRows();
		if (selectedLine < this.scrollOffset) this.scrollOffset = selectedLine;
		if (selectedLine >= this.scrollOffset + viewport) this.scrollOffset = selectedLine - viewport + 1;
		this.scrollOffset = Math.max(0, this.scrollOffset);
	}
	unitStartOffset(index, width) {
		return this.flatUnits().slice(0, index).reduce((sum, item) => sum + this.unitLineCount(item, width), 0);
	}
	bodyLineIndexForHit(unit, hit, width) {
		if (hit.field === "tool_name") return 0;
		const atomIndex = unit.atoms.findIndex((atom) => atom.id === hit.atomId);
		if (atomIndex < 0) return 0;
		const preceding = unit.atoms.slice(0, atomIndex).map((atom) => atom.text).filter(Boolean).join("\n");
		const target = unit.atoms[atomIndex]?.text ?? "";
		const prefix = preceding ? `${preceding}\n${target.slice(0, hit.start)}` : target.slice(0, hit.start);
		return Math.max(0, wrapTextWithAnsi(prefix || " ", Math.max(8, width - 8)).length - 1);
	}
	positionSearchHit(width) {
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
		const targetLine = hidden ? unitStart + 1 : unitStart + (hit.field === "tool_name" ? 0 : 1 + this.bodyLineIndexForHit(unit, hit, width));
		this.scrollOffset = Math.max(0, targetLine - Math.floor(this.availableRows() / 2));
		this.manualScroll = true;
		this.clampScroll(width);
	}
	focusSearchHit(index) {
		if (!this.matches[index]) return;
		this.matchIndex = index;
		const unitIndex = this.flatUnits().findIndex(({ unit }) => unit.id === this.matches[index]?.unitId);
		if (unitIndex < 0) return;
		this.selectedIndex = unitIndex;
		this.resetSelection();
		this.positionSearchHit(Math.max(24, this.tui.terminal.columns));
		this.tui.requestRender();
	}
	/** Build only rows intersecting the terminal viewport. Long bodies outside
	* the viewport are never converted into strings during this frame. */
	renderWindow(width, start, end) {
		const units = this.flatUnits();
		const output = [];
		let lineOffset = 0;
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
	resetSelection() {
		this.selected.clear();
		this.rangeAnchor = null;
	}
	savePrefs() {
		try {
			this.persistPrefs(this.prefs);
		} catch (error) {
			this.notify(this.text.savePrefsFailed(error instanceof Error ? error.message : String(error)), "warning");
		}
	}
	refreshData() {
		const snapshot = this.loadSnapshot();
		this.records = this.loadRecords();
		this.revision = snapshot.revision;
		this.canUndo = snapshot.canUndo;
		this.projectionAvailable = snapshot.projectionAvailable !== false && !!this.previewContext && !!this.commitContext;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
		this.manualScroll = false;
		this.resetSelection();
		this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
		this.matchIndex = -1;
		this.ensureSelectionVisible();
		this.tui.requestRender();
	}
	syncExternalState() {
		const snapshot = this.loadSnapshot();
		if (snapshot.revision === this.revision) return false;
		this.records = this.loadRecords();
		this.revision = snapshot.revision;
		this.canUndo = snapshot.canUndo;
		this.projectionAvailable = snapshot.projectionAvailable !== false && !!this.previewContext && !!this.commitContext;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
		this.scrollOffset = 0;
		this.manualScroll = false;
		this.resetSelection();
		this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
		this.matchIndex = -1;
		this.pendingConfirmation = null;
		this.notify(this.text.sessionChanged(), "info");
		return true;
	}
	async beginContextProjection() {
		if (this.operationInFlight || this.pendingConfirmation) return;
		if (!this.projectionAvailable || !this.previewContext || !this.commitContext) {
			this.notify(this.text.contextUnavailableAction(), "warning");
			return;
		}
		const selected = this.selectedUnitIds();
		const unitIds = selected.length > 0 ? selected : [this.currentUnit()?.unit.id].filter((id) => !!id);
		const units = this.flatUnits().filter(({ unit }) => unitIds.includes(unit.id));
		if (units.length === 0) return;
		const action = units.some(({ unit }) => unit.projectionState !== "exclude") ? "exclude" : "restore";
		this.operationInFlight = true;
		try {
			const preview = await this.previewContext({
				baseRevision: this.revision,
				action,
				unitIds
			});
			if (preview.unavailableUnitIds.length > 0) {
				this.notify(this.text.contextUnavailableAction(), "warning");
				return;
			}
			this.pendingConfirmation = {
				kind: "projection",
				action,
				unitIds: [...unitIds],
				preview,
				message: this.text.contextConfirm(action, preview.requestedUnitIds.length, preview.effectiveUnitIds.length, preview.autoExpandedUnitIds.length, preview.touchesRecentTurn)
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "CONTEXT_EDITOR_CONFLICT") {
				this.notify(this.text.sidecarChanged(), "warning");
				this.refreshData();
			} else this.notify(message === "AGENT_RUNTIME_BUSY" ? this.text.busy() : this.text.operationFailed(message), "warning");
		} finally {
			this.operationInFlight = false;
			this.tui.requestRender();
		}
	}
	async commitPendingProjection(pending) {
		if (this.operationInFlight || !this.commitContext) return;
		this.operationInFlight = true;
		try {
			const result = await this.commitContext({
				baseRevision: this.revision,
				action: pending.action,
				unitIds: pending.unitIds
			});
			if (!result.ok || result.conflict) {
				this.notify(this.text.sidecarChanged(), "warning");
				this.refreshData();
				return;
			}
			this.refreshData();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "CONTEXT_EDITOR_CONFLICT") {
				this.notify(this.text.sidecarChanged(), "warning");
				this.refreshData();
			} else this.notify(message === "AGENT_RUNTIME_BUSY" ? this.text.busy() : this.text.operationFailed(message), "warning");
		} finally {
			this.operationInFlight = false;
			this.tui.requestRender();
		}
	}
	beginResetConfirmation() {
		if (this.operationInFlight || this.pendingConfirmation) return;
		this.pendingConfirmation = {
			kind: "reset",
			message: this.text.restoreAllConfirmMessage()
		};
		this.tui.requestRender();
	}
	handleConfirmationInput(data) {
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
		this.commitPendingProjection(pending);
	}
	applyMutation(action) {
		const unitIds = action === "reset" ? void 0 : this.selectedUnitIds().length > 0 ? this.selectedUnitIds() : [this.currentUnit()?.unit.id].filter((id) => !!id);
		try {
			const result = this.mutate({
				baseRevision: this.revision,
				action,
				...unitIds ? { unitIds } : {}
			});
			if (!result.ok || result.conflict) {
				this.notify(this.text.sidecarChanged(), "warning");
				this.refreshData();
				return;
			}
			this.refreshData();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.notify(message === "AGENT_RUNTIME_BUSY" ? this.text.busy() : this.text.operationFailed(message), "warning");
		}
	}
	moveSelection(delta, extend) {
		const count = this.flatUnits().length;
		if (count === 0) return;
		if (extend && this.rangeAnchor === null) this.rangeAnchor = this.selectedIndex;
		this.selectedIndex = Math.max(0, Math.min(count - 1, this.selectedIndex + delta));
		if (extend && this.rangeAnchor !== null) {
			const lo = Math.min(this.rangeAnchor, this.selectedIndex);
			const hi = Math.max(this.rangeAnchor, this.selectedIndex);
			this.selected = new Set(this.flatUnits().slice(lo, hi + 1).map(({ unit }) => unit.id));
		} else if (!extend) this.resetSelection();
		this.matchIndex = -1;
		this.manualScroll = false;
		this.ensureSelectionVisible();
		this.tui.requestRender();
	}
	refreshSearch() {
		this.matches = this.searchOccurrencesForPrefs();
		this.matchIndex = -1;
		this.resetSelection();
		this.tui.requestRender();
	}
	toggleSearchScope() {
		this.searchScope = this.searchScope === "dialogue" ? "all" : "dialogue";
		this.matches = this.searchOccurrencesForPrefs();
		this.matchIndex = -1;
		this.resetSelection();
		if (this.query.trim() && this.matches.length > 0) this.focusSearchHit(0);
		else this.tui.requestRender();
	}
	nextMatch(delta) {
		if (this.matches.length === 0) return;
		const start = this.matchIndex < 0 ? delta < 0 ? this.matches.length - 1 : 0 : this.matchIndex + delta;
		this.focusSearchHit((start + this.matches.length) % this.matches.length);
	}
	setEnabledUnitKinds(enabled) {
		this.prefs = {
			...this.prefs,
			enabledUnitKinds: UNIT_KINDS.filter((kind) => enabled.has(kind))
		};
		this.savePrefs();
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.manualScroll = false;
		this.resetSelection();
		this.refreshSearch();
	}
	toggleUnitKind(kind) {
		const enabled = new Set(this.prefs.enabledUnitKinds);
		if (enabled.has(kind)) enabled.delete(kind);
		else enabled.add(kind);
		this.setEnabledUnitKinds(enabled);
	}
	toggleAiKind() {
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
	toggleAll() {
		const allUnits = this.flatUnits();
		const matchingIds = new Set(this.matches.map((match) => match.unitId));
		const units = this.query.trim() ? allUnits.filter(({ unit }) => matchingIds.has(unit.id)) : allUnits;
		if (units.length === 0) return;
		if (units.length > 0 && units.every(({ unit }) => this.selected.has(unit.id))) this.resetSelection();
		else this.selected = new Set(units.map(({ unit }) => unit.id));
		this.tui.requestRender();
	}
	helpLines() {
		return this.text.tuiHelpLines();
	}
	handleSearchInput(data) {
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
		const printable = decodeKittyPrintable(data) ?? (data.length === 1 && !data.includes("\x1B") ? data : void 0);
		if (printable) {
			this.query += printable;
			this.refreshSearch();
		}
	}
	confirmationLines(width) {
		const pending = this.pendingConfirmation;
		if (!pending) return [];
		const title = pending.kind === "projection" ? this.text.contextConfirmTitle() : this.text.restoreAllConfirmTitle();
		const hint = this.text.contextConfirmHint();
		const body = wrapTextWithAnsi(pending.message, Math.max(8, width - 4));
		return [
			this.theme.fg("warning", `⚠ ${title}`),
			...body.map((line) => this.theme.fg("dim", `  ${line}`)),
			this.theme.fg("accent", hint)
		];
	}
	handleInput(data) {
		if (this.syncExternalState()) return;
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
			this.done();
			return;
		}
		if (data === "q" || data === "Q") {
			this.done();
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
		if (data === "j" || matchesKey(data, "down")) {
			this.moveSelection(1, false);
			return;
		}
		if (data === "k" || matchesKey(data, "up")) {
			this.moveSelection(-1, false);
			return;
		}
		if (matchesKey(data, "shift+down")) {
			this.moveSelection(1, true);
			return;
		}
		if (matchesKey(data, "shift+up")) {
			this.moveSelection(-1, true);
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.scrollByRows(this.availableRows());
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.scrollByRows(-this.availableRows());
			return;
		}
		if (data === "g") {
			this.selectedIndex = 0;
			this.matchIndex = -1;
			this.manualScroll = false;
			this.ensureSelectionVisible();
			this.tui.requestRender();
			return;
		}
		if (data === "G") {
			this.selectedIndex = Math.max(0, this.flatUnits().length - 1);
			this.matchIndex = -1;
			this.manualScroll = false;
			this.ensureSelectionVisible();
			this.tui.requestRender();
			return;
		}
		if (data === "1") {
			this.toggleUnitKind("user");
			return;
		}
		if (data === "2") {
			this.toggleAiKind();
			return;
		}
		if (data === "3") {
			this.toggleUnitKind("tool");
			return;
		}
		if (data === "4") {
			this.toggleUnitKind("reasoning");
			return;
		}
		if (data === "5") {
			this.toggleUnitKind("answer");
			return;
		}
		if (data === "a" || data === "A") {
			this.toggleAll();
			return;
		}
		if (data === "v" || data === "V") {
			this.prefs = {
				...this.prefs,
				showHidden: !this.prefs.showHidden
			};
			this.savePrefs();
			if (this.matchIndex >= 0) this.focusSearchHit(this.matchIndex);
			else this.tui.requestRender();
			return;
		}
		if (data === "n") {
			this.nextMatch(1);
			return;
		}
		if (data === "N") {
			this.nextMatch(-1);
			return;
		}
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
		if (data === "h" || data === "H") {
			this.applyMutation("hide");
			return;
		}
		if (data === "x" || data === "X") {
			this.beginContextProjection();
			return;
		}
		if (data === "r") {
			this.applyMutation("restore");
			return;
		}
		if (data === "R") {
			this.beginResetConfirmation();
			return;
		}
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
	render(width) {
		const safeWidth = Math.max(24, width);
		const viewport = this.availableRows();
		let visible;
		if (this.pendingConfirmation) visible = this.confirmationLines(safeWidth).slice(0, viewport);
		else if (this.helpMode) visible = this.helpLines().slice(0, viewport);
		else {
			const layoutChanged = this.lastRenderWidth !== safeWidth || this.lastRenderRows !== this.tui.terminal.rows;
			if (this.matchIndex >= 0 && layoutChanged) this.positionSearchHit(safeWidth);
			if (!this.manualScroll) this.ensureSelectionVisible(safeWidth);
			const totalLines = this.totalLineCount(safeWidth);
			const maxOffset = Math.max(0, totalLines - viewport);
			this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
			visible = this.renderWindow(safeWidth, this.scrollOffset, this.scrollOffset + viewport);
		}
		this.lastRenderWidth = safeWidth;
		this.lastRenderRows = this.tui.terminal.rows;
		while (visible.length < viewport) visible.push("");
		const enabled = (kind) => this.prefs.enabledUnitKinds.includes(kind) ? this.theme.fg("accent", this.text.unitKind(kind)) : this.theme.fg("dim", this.text.unitKind(kind));
		const reasoningEnabled = this.prefs.enabledUnitKinds.includes("reasoning");
		const answerEnabled = this.prefs.enabledUnitKinds.includes("answer");
		const aiState = reasoningEnabled && answerEnabled ? "on" : reasoningEnabled || answerEnabled ? "mixed" : "off";
		const aiLabel = this.theme.fg(aiState === "on" ? "accent" : aiState === "mixed" ? "warning" : "dim", `${this.text.recordKind("ai")}${aiState === "mixed" ? " ±" : ""}`);
		const title = this.helpMode ? this.theme.fg("accent", this.text.tuiHelpTitle()) : this.theme.fg("accent", "Pi Context Editor") + this.theme.fg("dim", `  ${this.text.unitCount(this.flatUnits().length)}`);
		const mode = this.pendingConfirmation ? this.theme.fg("warning", this.text.contextAwaiting()) : this.helpMode ? this.theme.fg("dim", "") : this.searchMode ? this.theme.fg("warning", this.text.tuiSearch(this.query, this.matches.length, this.matchIndex, this.searchScope)) : this.theme.fg("dim", this.text.tuiSearchIdle(this.query, this.matches.length, this.matchIndex, this.searchScope));
		const filterLine = this.helpMode || this.pendingConfirmation ? "" : `${enabled("user")} [1]  ${aiLabel} [2] (${enabled("reasoning")} [4]  ${enabled("answer")} [5])  ${enabled("tool")} [3]`;
		const statusMode = this.helpMode ? "help" : this.searchMode ? "search" : this.matches.length > 0 ? "results" : "normal";
		const status = this.pendingConfirmation ? this.theme.fg("dim", this.text.contextConfirmHint()) : this.theme.fg("dim", this.text.tuiStatus(statusMode, this.searchScope));
		return [
			visiblePad(title, safeWidth),
			visiblePad(filterLine, safeWidth),
			visiblePad(mode, safeWidth),
			this.theme.fg("borderMuted", "─".repeat(safeWidth)),
			...visible.map((line) => visiblePad(line, safeWidth)),
			this.theme.fg("borderMuted", "─".repeat(safeWidth)),
			visiblePad(status, safeWidth)
		];
	}
	invalidate() {}
};
function defaultDocument$1(sessionId) {
	return {
		schemaVersion: 1,
		sessionId,
		events: []
	};
}
function isProjectionEvent(value) {
	if (!value || typeof value !== "object") return false;
	const row = value;
	if (row.version !== 1 || typeof row.transactionId !== "string" || typeof row.createdAt !== "string" || typeof row.baseRevision !== "string" || row.action !== "exclude" && row.action !== "restore" || !Array.isArray(row.changes) || row.changes.length === 0) return false;
	return row.changes.every((candidate) => {
		if (!candidate || typeof candidate !== "object") return false;
		const change = candidate;
		const sourceRef = change.sourceRef;
		if (!sourceRef || typeof sourceRef !== "object" || typeof sourceRef.entryId !== "string" || !Number.isInteger(sourceRef.blockIndex)) return false;
		return typeof change.atomId === "string" && typeof change.fingerprint === "string" && (change.before === "include" || change.before === "exclude") && (change.after === "include" || change.after === "exclude") && change.before !== change.after;
	});
}
function parseDocument$1(raw, sessionId) {
	if (!raw || typeof raw !== "object") return {
		document: defaultDocument$1(sessionId),
		error: "projection sidecar JSON is malformed"
	};
	const row = raw;
	if (row.schemaVersion !== 1) return {
		document: defaultDocument$1(sessionId),
		error: "projection sidecar schema version is unsupported"
	};
	if (row.sessionId !== sessionId) return {
		document: defaultDocument$1(sessionId),
		error: "projection sidecar Session id does not match"
	};
	if (!Array.isArray(row.events)) return {
		document: defaultDocument$1(sessionId),
		error: "projection sidecar events are malformed"
	};
	const events = [];
	for (const candidate of row.events) {
		if (!candidate || typeof candidate !== "object") return {
			document: defaultDocument$1(sessionId),
			error: "projection sidecar envelope is malformed"
		};
		const envelope = candidate;
		if (typeof envelope.anchorEntryId !== "string" || !isProjectionEvent(envelope.event)) return {
			document: defaultDocument$1(sessionId),
			error: "projection sidecar event is malformed"
		};
		events.push({
			anchorEntryId: envelope.anchorEntryId,
			event: envelope.event
		});
	}
	return { document: {
		schemaVersion: 1,
		sessionId,
		events
	} };
}
function revisionOf$1(path, raw, document, integrity) {
	let stat = "missing";
	try {
		const value = statSync(path);
		stat = String(value.size) + ":" + String(value.mtimeMs);
	} catch {}
	return stableFingerprint([
		path,
		stat,
		integrity,
		raw ?? JSON.stringify(document)
	]);
}
function projectionRevisionOf(document) {
	return stableFingerprint([document.sessionId, JSON.stringify(document.events)]);
}
function projectionSidecarPath(sessionFile) {
	return resolve(sessionFile) + ".context-editor.projection.json";
}
function readProjectionSidecar(sessionFile, sessionId) {
	const path = projectionSidecarPath(sessionFile);
	if (!existsSync(path)) {
		const document = defaultDocument$1(sessionId);
		return {
			path,
			document,
			revision: revisionOf$1(path, void 0, document, "missing"),
			projectionRevision: projectionRevisionOf(document),
			integrity: "missing"
		};
	}
	let rawText;
	try {
		rawText = readFileSync(path, "utf8");
	} catch {
		const document = defaultDocument$1(sessionId);
		return {
			path,
			document,
			revision: revisionOf$1(path, void 0, document, "invalid"),
			projectionRevision: projectionRevisionOf(document),
			integrity: "invalid",
			error: "projection sidecar could not be read"
		};
	}
	let raw;
	try {
		raw = JSON.parse(rawText);
	} catch {
		const document = defaultDocument$1(sessionId);
		return {
			path,
			document,
			revision: revisionOf$1(path, rawText, document, "invalid"),
			projectionRevision: projectionRevisionOf(document),
			integrity: "invalid",
			error: "projection sidecar JSON is malformed"
		};
	}
	const parsed = parseDocument$1(raw, sessionId);
	if (parsed.error) return {
		path,
		document: parsed.document,
		revision: revisionOf$1(path, rawText, parsed.document, "invalid"),
		projectionRevision: projectionRevisionOf(parsed.document),
		integrity: "invalid",
		error: parsed.error
	};
	return {
		path,
		document: parsed.document,
		revision: revisionOf$1(path, rawText, parsed.document, "ok"),
		projectionRevision: projectionRevisionOf(parsed.document),
		integrity: "ok"
	};
}
function withLock$1(path, fn) {
	const lockPath = path + ".lock";
	const deadline = Date.now() + 2e3;
	let handle;
	while (handle === void 0 && Date.now() < deadline) try {
		handle = openSync(lockPath, "wx");
		writeFileSync(handle, JSON.stringify({
			pid: process.pid,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		}));
		fsyncSync(handle);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
	}
	if (handle === void 0) throw new Error("CONTEXT_EDITOR_SIDECAR_BUSY");
	try {
		return fn();
	} finally {
		try {
			closeSync(handle);
		} catch {}
		try {
			unlinkSync(lockPath);
		} catch {}
	}
}
function writeDocument$1(path, document) {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = path + "." + process.pid + "." + Date.now() + ".tmp";
	const handle = openSync(tempPath, "w");
	try {
		writeFileSync(handle, JSON.stringify(document, null, 2) + "\n", "utf8");
		fsyncSync(handle);
	} finally {
		closeSync(handle);
	}
	renameSync(tempPath, path);
}
function appendProjectionSidecarEvent(sessionFile, sessionId, anchorEntryId, event, expectedRevision) {
	const path = projectionSidecarPath(sessionFile);
	return withLock$1(path, () => {
		const current = readProjectionSidecar(sessionFile, sessionId);
		if (current.integrity === "invalid") throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (current.revision !== expectedRevision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		const next = {
			...current.document,
			events: [...current.document.events, {
				anchorEntryId,
				event
			}]
		};
		writeDocument$1(path, next);
		return event.transactionId;
	});
}
function defaultDocument(sessionId) {
	return {
		schemaVersion: 1,
		sessionId,
		prefs: { ...DEFAULT_CONTEXT_EDITOR_PREFS },
		events: []
	};
}
function isEvent(value) {
	if (!value || typeof value !== "object") return false;
	const row = value;
	const changes = Array.isArray(row.changes) ? row.changes : [];
	const validChanges = changes.length > 0 && changes.every((change) => {
		if (!change || typeof change !== "object") return false;
		const item = change;
		return typeof item.atomId === "string" && typeof item.fingerprint === "string" && (item.before === "show" || item.before === "collapse" || item.before === "hide") && (item.after === "show" || item.after === "collapse" || item.after === "hide");
	});
	return row.version === 2 && typeof row.transactionId === "string" && typeof row.createdAt === "string" && typeof row.baseRevision === "string" && (row.action === "hide" || row.action === "restore" || row.action === "reset" || row.action === "undo") && validChanges;
}
function parseDocument(raw, sessionId) {
	if (!raw || typeof raw !== "object") return defaultDocument(sessionId);
	const row = raw;
	if (row.schemaVersion !== 1 || typeof row.sessionId === "string" && row.sessionId !== sessionId) return defaultDocument(sessionId);
	const events = Array.isArray(row.events) ? row.events.flatMap((candidate) => {
		if (!candidate || typeof candidate !== "object") return [];
		const envelope = candidate;
		if (typeof envelope.anchorEntryId !== "string" || !isEvent(envelope.event)) return [];
		return [{
			anchorEntryId: envelope.anchorEntryId,
			event: envelope.event
		}];
	}) : [];
	return {
		schemaVersion: 1,
		sessionId: typeof row.sessionId === "string" ? row.sessionId : sessionId,
		prefs: normalizeContextEditorPrefs(row.prefs),
		events
	};
}
function sidecarPath(sessionFile) {
	return `${resolve(sessionFile)}.context-editor.json`;
}
function revisionOf(path, document) {
	let stat = "missing";
	try {
		const value = statSync(path);
		stat = `${value.size}:${value.mtimeMs}`;
	} catch {}
	return stableFingerprint([
		path,
		stat,
		JSON.stringify(document)
	]);
}
function viewRevisionOf(document) {
	return stableFingerprint([document.sessionId, JSON.stringify(document.events)]);
}
function readSidecar(sessionFile, sessionId) {
	const path = sidecarPath(sessionFile);
	let raw;
	if (existsSync(path)) try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		raw = void 0;
	}
	const document = parseDocument(raw, sessionId);
	return {
		path,
		document,
		revision: revisionOf(path, document),
		viewRevision: viewRevisionOf(document)
	};
}
function withLock(path, fn) {
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + 2e3;
	let handle;
	while (handle === void 0 && Date.now() < deadline) try {
		handle = openSync(lockPath, "wx");
		writeFileSync(handle, JSON.stringify({
			pid: process.pid,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		}));
		fsyncSync(handle);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
	}
	if (handle === void 0) throw new Error("CONTEXT_EDITOR_SIDECAR_BUSY");
	try {
		return fn();
	} finally {
		try {
			closeSync(handle);
		} catch {}
		try {
			unlinkSync(lockPath);
		} catch {}
	}
}
function writeDocument(path, document) {
	mkdirSync(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	const handle = openSync(tempPath, "w");
	try {
		writeFileSync(handle, `${JSON.stringify(document, null, 2)}\n`, "utf8");
		fsyncSync(handle);
	} finally {
		closeSync(handle);
	}
	renameSync(tempPath, path);
}
function appendSidecarEvent(sessionFile, sessionId, anchorEntryId, event, expectedRevision) {
	const path = sidecarPath(sessionFile);
	return withLock(path, () => {
		const current = readSidecar(sessionFile, sessionId);
		if (current.revision !== expectedRevision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		const next = {
			...current.document,
			events: [...current.document.events, {
				anchorEntryId,
				event
			}]
		};
		writeDocument(path, next);
		return event.transactionId;
	});
}
function writeSidecarPrefs(sessionFile, sessionId, prefs) {
	const path = sidecarPath(sessionFile);
	return withLock(path, () => {
		const next = {
			...readSidecar(sessionFile, sessionId).document,
			prefs: normalizeContextEditorPrefs(prefs)
		};
		writeDocument(path, next);
		return readSidecar(sessionFile, sessionId);
	});
}
//#endregion
//#region adapters/pi-extension/src/host.ts
const service = new ContextEditorService();
function asLocator(value, sessionId) {
	if (value && value.sessionId !== sessionId) throw new Error("CONTEXT_EDITOR_SESSION_MISMATCH");
}
var PiContextEditorHost = class {
	ctx;
	capabilities = {
		paging: false,
		search: true,
		viewMutation: true,
		undo: true,
		persistence: true,
		contextExclusion: true
	};
	constructor(ctx) {
		this.ctx = ctx;
	}
	get sessionFile() {
		return this.ctx.sessionManager.getSessionFile() ?? "memory-session.jsonl";
	}
	get sessionId() {
		return this.ctx.sessionManager.getSessionId() ?? this.sessionFile;
	}
	branchEntries() {
		return this.ctx.sessionManager.getBranch();
	}
	read() {
		const entries = this.branchEntries();
		const atoms = normalizeSessionEntries(entries);
		const leafId = this.ctx.sessionManager.getLeafId();
		const sidecar = readSidecar(this.sessionFile, this.sessionId);
		const projection = readProjectionSidecar(this.sessionFile, this.sessionId);
		const branchIds = new Set(entries.map((entry) => String(entry.id ?? "")));
		const viewEvents = sidecar.document.events.filter((envelope) => envelope.anchorEntryId.length === 0 || branchIds.has(envelope.anchorEntryId)).map((envelope) => envelope.event);
		const projectionEvents = projection.integrity === "ok" ? projection.document.events.filter((envelope) => envelope.anchorEntryId.length === 0 || branchIds.has(envelope.anchorEntryId)).map((envelope) => envelope.event) : [];
		const branchParts = contextEditorBranchRevisionParts(entries);
		const revision = branchRevision(leafId, atoms, [
			...branchParts,
			sidecar.viewRevision,
			projection.revision
		]);
		return {
			entries,
			atoms,
			leafId,
			revision,
			revisionProbe: stableFingerprint([
				this.sessionFile,
				this.sessionId,
				leafId ?? "",
				sidecar.viewRevision,
				projection.revision,
				revision,
				...branchParts
			]),
			viewEvents,
			projectionEvents,
			projectionAvailable: projection.integrity !== "invalid",
			...projection.error ? { projectionError: projection.error } : {},
			projectionRevision: projection.revision
		};
	}
	appendViewEvent(event) {
		if (!this.ctx.isIdle()) throw new Error("AGENT_RUNTIME_BUSY");
		const current = this.read();
		if (current.revision !== event.baseRevision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		const sidecar = readSidecar(this.sessionFile, this.sessionId);
		if (this.read().revision !== current.revision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		return appendSidecarEvent(this.sessionFile, this.sessionId, current.leafId ?? "", event, sidecar.revision);
	}
	appendProjectionEvent(event) {
		if (!this.ctx.isIdle()) throw new Error("AGENT_RUNTIME_BUSY");
		const current = this.read();
		if (current.projectionAvailable === false) throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (current.revision !== event.baseRevision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		const sidecar = readProjectionSidecar(this.sessionFile, this.sessionId);
		if (sidecar.integrity === "invalid") throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (this.read().revision !== current.revision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		return appendProjectionSidecarEvent(this.sessionFile, this.sessionId, current.leafId ?? "", event, sidecar.revision);
	}
	isBusy() {
		return !this.ctx.isIdle();
	}
	getPrefs() {
		return readSidecar(this.sessionFile, this.sessionId).document.prefs;
	}
	setPrefs(prefs) {
		if (!this.ctx.isIdle()) return;
		writeSidecarPrefs(this.sessionFile, this.sessionId, prefs);
	}
	records() {
		return service.getRecords(this);
	}
	snapshot() {
		return service.getSnapshot(this);
	}
	search(query, enabledKinds, scope, enabledUnitKinds) {
		return service.searchContextRecords(this, {
			query,
			enabledKinds,
			enabledUnitKinds,
			scope
		});
	}
	searchMatch(input) {
		return service.getContextSearchMatch(this, input);
	}
	commit(input) {
		try {
			return service.commitContextView(this, input);
		} catch (error) {
			if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) return {
				ok: false,
				conflict: true,
				snapshot: this.snapshot()
			};
			throw error;
		}
	}
	undo(baseRevision) {
		try {
			return service.undoContextView(this, { baseRevision });
		} catch (error) {
			if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) return {
				ok: false,
				conflict: true,
				snapshot: this.snapshot()
			};
			throw error;
		}
	}
	async getSnapshot(locator) {
		asLocator(locator, this.sessionId);
		return this.snapshot();
	}
	async listRecords(locator, cursor, _limit) {
		asLocator(locator, this.sessionId);
		if (cursor) throw new Error("CONTEXT_EDITOR_PAGING_UNSUPPORTED");
		const current = this.read();
		return {
			records: this.records(),
			nextCursor: null,
			sourceRevision: current.revision,
			viewRevision: current.revision
		};
	}
	async getRecord(locator, recordId) {
		asLocator(locator, this.sessionId);
		const current = this.read();
		const record = service.getRecord(this, recordId);
		return record ? {
			record,
			sourceRevision: current.revision,
			viewRevision: current.revision
		} : null;
	}
	async searchRecords(request) {
		asLocator(request.locator, this.sessionId);
		return this.search(request.query, request.enabledKinds, request.scope, request.enabledUnitKinds);
	}
	async getSearchMatch(request) {
		asLocator(request.locator, this.sessionId);
		return this.searchMatch(request);
	}
	async commitView(request) {
		asLocator(request.locator, this.sessionId);
		return this.commit(request);
	}
	async undoView(locator, baseRevision) {
		asLocator(locator, this.sessionId);
		return this.undo(baseRevision);
	}
	async previewContext(request) {
		asLocator(request.locator, this.sessionId);
		return service.previewContextProjection(this, request);
	}
	async commitContext(request) {
		asLocator(request.locator, this.sessionId);
		try {
			return service.commitContextProjection(this, request);
		} catch (error) {
			if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) return {
				ok: false,
				conflict: true,
				snapshot: this.snapshot()
			};
			throw error;
		}
	}
};
//#endregion
//#region adapters/pi-extension/src/projection-hook.ts
var ProjectionAlignmentError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "ProjectionAlignmentError";
	}
};
function roleOf(message) {
	return typeof message === "object" && message !== null && "role" in message ? String(message.role ?? "") : "";
}
function structuralShape(message) {
	const content = message.content;
	const blocks = typeof content === "string" ? "string" : Array.isArray(content) ? content.map((part) => {
		if (!part || typeof part !== "object") return typeof part;
		const value = part;
		return [
			value.type,
			value.id,
			value.toolCallId,
			value.name
		].map((item) => String(item ?? "")).join(":");
	}).join("|") : "";
	return roleOf(message) + "|" + blocks;
}
function messageIdentityCompatible(baseline, current) {
	if (roleOf(baseline) !== roleOf(current)) return false;
	const baselineRow = baseline;
	const currentRow = current;
	if (roleOf(baseline) === "user") return JSON.stringify(baselineRow.content) === JSON.stringify(currentRow.content);
	if (roleOf(baseline) === "toolResult") return String(baselineRow.toolCallId ?? "") === String(currentRow.toolCallId ?? "") && String(baselineRow.toolName ?? "") === String(currentRow.toolName ?? "") && JSON.stringify(baselineRow.content) === JSON.stringify(currentRow.content);
	return false;
}
function structurallyCompatible(baseline, current) {
	if (roleOf(baseline) !== roleOf(current)) return false;
	if (structuralShape(baseline) === structuralShape(current)) return true;
	const baselineContent = baseline.content;
	const currentContent = current.content;
	if (Array.isArray(baselineContent) && Array.isArray(currentContent)) {
		const baselineKinds = baselineContent.map((part) => typeof part === "object" && part ? String(part.type ?? "") : "");
		const currentKinds = currentContent.map((part) => typeof part === "object" && part ? String(part.type ?? "") : "");
		if (baselineKinds.length === currentKinds.length && baselineKinds.every((kind, index) => kind === currentKinds[index])) return true;
	}
	return messageIdentityCompatible(baseline, current);
}
function contentKinds(message) {
	const content = message.content;
	if (!Array.isArray(content)) return void 0;
	return content.map((part) => typeof part === "object" && part ? String(part.type ?? "") : "");
}
function isKindSubsequence(baseline, current) {
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
function restoreCompatible(baseline, current) {
	const role = roleOf(baseline);
	if (role === "user" || role === "toolResult") return messageIdentityCompatible(baseline, current);
	return role === roleOf(current) && (structurallyCompatible(baseline, current) || isKindSubsequence(baseline, current));
}
function rowsForEntries(entries) {
	const rows = [];
	for (const raw of entries) {
		const entry = raw;
		const entryId = String(entry.id ?? "");
		if (!entryId) continue;
		for (const baseline of sessionEntryToContextMessages(entry)) rows.push({
			entryId,
			baseline
		});
	}
	return rows;
}
function activeAtomsByEntry(atoms, events) {
	const states = reduceProjectionStates(atoms, events);
	const result = /* @__PURE__ */ new Map();
	for (const atom of atoms) {
		if ((states.get(atom.id) ?? "include") === "unavailable") throw new ProjectionAlignmentError("an active projection fingerprint no longer matches");
		const group = result.get(atom.sourceRef.entryId);
		if (group) group.push(atom);
		else result.set(atom.sourceRef.entryId, [atom]);
	}
	return {
		states,
		byEntry: result
	};
}
function restoredAtomIds(atoms, events, states) {
	const ids = /* @__PURE__ */ new Set();
	const known = new Set(atoms.map((atom) => atom.id));
	for (const event of events) {
		if (event.action !== "restore") continue;
		for (const change of event.changes) if (known.has(change.atomId) && states.get(change.atomId) === "include") ids.add(change.atomId);
	}
	return ids;
}
function projectOneMessage(message, atoms, states) {
	const excluded = new Set(atoms.filter((atom) => states.get(atom.id) === "exclude").map((atom) => atom.id));
	if (excluded.size === 0) return message;
	const role = roleOf(message);
	if (role === "user" || role === "toolResult") return void 0;
	if (role !== "assistant") throw new ProjectionAlignmentError("unsupported active message role");
	const content = message.content;
	if (!Array.isArray(content)) throw new ProjectionAlignmentError("assistant message content is not an array");
	const nextContent = content.filter((_part, blockIndex) => {
		const atom = atoms.find((candidate) => candidate.sourceRef.blockIndex === blockIndex && candidate.kind !== "tool_output");
		return !atom || !excluded.has(atom.id);
	});
	if (nextContent.length === 0) return void 0;
	return {
		...message,
		content: nextContent
	};
}
function projectModelContext(input) {
	const rows = rowsForEntries(input.entries);
	const { states, byEntry } = activeAtomsByEntry(input.atoms, input.projectionEvents);
	const restoredIds = restoredAtomIds(input.atoms, input.projectionEvents, states);
	const output = [];
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
				const candidates = input.messages.map((candidate, index) => ({
					candidate,
					index
				})).filter(({ candidate, index }) => index >= cursor && restoreCompatible(row.baseline, candidate));
				if (candidates.length > 1) throw new ProjectionAlignmentError("restored message could not be aligned unambiguously");
				if (candidates.length === 1) {
					match = candidates[0].index;
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
function projectionOverlapsEntryIds(entryIds, atoms, projectionEvents) {
	const states = reduceProjectionStates(atoms, projectionEvents);
	if ([...states.values()].some((state) => state === "unavailable")) throw new ProjectionAlignmentError("active projection is unavailable");
	return atoms.some((atom) => entryIds.has(atom.sourceRef.entryId) && states.get(atom.id) === "exclude");
}
//#endregion
//#region adapters/pi-extension/src/index.ts
function sourceLeafId(ctx) {
	return ctx.sessionManager.getLeafId() ?? void 0;
}
function notifyProjectionFailure(ctx, error) {
	const message = error instanceof Error ? error.message : String(error);
	if (ctx.hasUI) ctx.ui.notify("Context projection blocked this operation: " + message, "error");
}
function projectionEntryIdsBeforeFirstKept(event) {
	const ids = /* @__PURE__ */ new Set();
	const first = event.branchEntries.findIndex((entry) => entry.id === event.preparation.firstKeptEntryId);
	if (first < 0) return ids;
	for (let index = 0; index < first; index += 1) {
		const entry = event.branchEntries[index];
		if (entry) ids.add(entry.id);
	}
	if (event.preparation.turnPrefixMessages.length > 0) {
		const entry = event.branchEntries[first];
		if (entry) ids.add(entry.id);
	}
	return ids;
}
function projectionSummaryOverlap(ctx, entries, entryIds) {
	const current = new PiContextEditorHost(ctx).read();
	if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
	return projectionOverlapsEntryIds(entryIds, normalizeSessionEntries(entries), current.projectionEvents ?? []);
}
function registerProjectionHooks(pi) {
	pi.on("context", async (event, ctx) => {
		try {
			const current = new PiContextEditorHost(ctx).read();
			if (!current.projectionEvents?.length && current.projectionAvailable !== false) return;
			if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
			const entries = ctx.sessionManager.buildContextEntries();
			const atoms = normalizeSessionEntries(entries);
			return { messages: projectModelContext({
				messages: event.messages,
				entries,
				atoms,
				projectionEvents: current.projectionEvents ?? []
			}) };
		} catch (error) {
			notifyProjectionFailure(ctx, error);
			ctx.abort();
			return { messages: [] };
		}
	});
	pi.on("session_before_compact", async (event, ctx) => {
		try {
			const current = new PiContextEditorHost(ctx).read();
			if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
			const ids = projectionEntryIdsBeforeFirstKept(event);
			if (ids.size > 0 && projectionSummaryOverlap(ctx, event.branchEntries, ids)) {
				if (ctx.hasUI) ctx.ui.notify("Compaction cancelled because it would summarize excluded context.", "warning");
				return { cancel: true };
			}
		} catch (error) {
			notifyProjectionFailure(ctx, error);
			return { cancel: true };
		}
	});
	pi.on("session_before_tree", async (event, ctx) => {
		if (!event.preparation.userWantsSummary) return;
		try {
			const current = new PiContextEditorHost(ctx).read();
			if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
			const ids = new Set(event.preparation.entriesToSummarize.map((entry) => entry.id));
			if (ids.size > 0 && projectionSummaryOverlap(ctx, event.preparation.entriesToSummarize, ids)) {
				if (ctx.hasUI) ctx.ui.notify("Branch summary cancelled because it would summarize excluded context.", "warning");
				return { cancel: true };
			}
		} catch (error) {
			notifyProjectionFailure(ctx, error);
			return { cancel: true };
		}
	});
}
function contextEditorExtension(pi) {
	registerProjectionHooks(pi);
	pi.registerCommand("ctx", {
		description: "Inspect the active Pi context (usage: /ctx)",
		handler: async (_args, ctx) => {
			const locale = detectPiLocale();
			if (ctx.mode === "json" || ctx.mode === "print") {
				ctx.ui.notify("/ctx requires interactive Pi TUI or Pi Desktop mode.", "warning");
				return;
			}
			const atoms = normalizeSessionEntries(ctx.sessionManager.buildContextEntries());
			if (atoms.length === 0) {
				ctx.ui.notify("There is no active context to inspect.", "info");
				return;
			}
			const leafId = sourceLeafId(ctx);
			const state = readLatestState(ctx.sessionManager.getBranch());
			if (ctx.mode === "rpc") {
				await runDesktopContextEditor({
					ui: ctx.ui,
					atoms,
					initialState: state,
					sourceLeafId: leafId,
					locale,
					persistState: (nextState) => {
						pi.appendEntry(STATE_ENTRY_TYPE, nextState);
					}
				});
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/ctx requires interactive Pi TUI or Pi Desktop mode.", "warning");
				return;
			}
			const host = new PiContextEditorHost(ctx);
			const records = host.records();
			if (records.length === 0) {
				ctx.ui.notify("There are no editable context records in the active branch.", "info");
				return;
			}
			const snapshot = host.snapshot();
			const locator = {
				host: "pi",
				sessionId: host.sessionId
			};
			const prefs = host.getPrefs();
			await ctx.ui.custom((tui, theme, _keybindings, done) => new ContextEditorComponent(tui, theme, records, snapshot, prefs, {
				loadRecords: () => host.records(),
				loadSnapshot: () => host.snapshot(),
				mutate: (input) => host.commit(input),
				previewContext: (input) => host.previewContext({
					locator,
					...input
				}),
				commitContext: (input) => host.commitContext({
					locator,
					...input
				}),
				undo: (baseRevision) => host.undo(baseRevision),
				persistPrefs: (nextPrefs) => host.setPrefs(nextPrefs),
				notify: (message, type = "info") => ctx.ui.notify(message, type),
				locale
			}, () => done(void 0)));
		}
	});
}
//#endregion
export { contextEditorExtension as default };
