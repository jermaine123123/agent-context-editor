/* GENERATED FILE - rebuild with npm run build:pi. */
/* Canonical Core source digest: 5fbf9432539f4794c97cdb65a5ebb8564a14e376cecb530b5ca01c2058998e7b */
import { sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { decodeKittyPrintable, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
	const linkedByEvent = /* @__PURE__ */ new Map();
	const ownerByAtom = /* @__PURE__ */ new Map();
	for (const atom of atoms) result.set(atom.id, "include");
	const apply = (change, owner) => {
		const atom = byId.get(change.atomId);
		if (!atom) return;
		if (atom.fingerprint !== change.fingerprint || atom.sourceRef.entryId !== change.sourceRef.entryId || atom.sourceRef.blockIndex !== change.sourceRef.blockIndex) {
			result.set(atom.id, "unavailable");
			return;
		}
		const current = result.get(atom.id) ?? "include";
		if (current === "unavailable") return;
		if (current !== change.before && current !== change.after) {
			result.set(atom.id, "unavailable");
			return;
		}
		result.set(atom.id, change.after);
		ownerByAtom.set(atom.id, owner);
	};
	for (const event of events) {
		if ("type" in event && event.type === "condensation") continue;
		if (isReplacementEvent(event)) {
			if (event.action === "undo") {
				const changes = linkedByEvent.get(event.undoOf);
				if (changes) {
					for (const change of changes) if ((result.get(change.atomId) ?? "include") === change.after && ownerByAtom.get(change.atomId) === event.undoOf) {
						result.set(change.atomId, change.before);
						ownerByAtom.delete(change.atomId);
					}
				}
			} else if (event.linkedExclusion?.atomChanges) {
				const changes = event.linkedExclusion.atomChanges;
				linkedByEvent.set(event.eventId, changes);
				for (const change of changes) apply(change, event.eventId);
			}
			continue;
		}
		for (const change of event.changes) apply(change, event.transactionId);
	}
	return result;
}
function unitOriginalText(unit) {
	return unit.atoms.map((atom) => atom.text).join("\n");
}
function replacementEligibility(unit) {
	if (!unit.mutable) return {
		supported: false,
		disabledReason: "invalid-target"
	};
	if (unit.kind === "user") {
		const atom = unit.atoms.length === 1 ? unit.atoms[0] : void 0;
		if (!atom || atom.kind !== "user") return {
			supported: false,
			disabledReason: "invalid-target"
		};
		if (atom.structured === true) return {
			supported: false,
			disabledReason: "structured-user-content"
		};
		return { supported: true };
	}
	if (unit.kind === "answer") {
		if (!unit.atoms.length || unit.atoms.some((atom) => atom.kind !== "assistant_text")) return {
			supported: false,
			disabledReason: "invalid-target"
		};
		if (unit.atoms.some((atom) => atom.hasSignature === true)) return {
			supported: false,
			disabledReason: "signed-content"
		};
		return { supported: true };
	}
	return {
		supported: false,
		disabledReason: "unsupported-unit-kind"
	};
}
function sameAtomRefs(unit, refs) {
	if (unit.atoms.length !== refs.length || !refs.length) return false;
	return unit.atoms.every((atom, index) => {
		const ref = refs[index];
		return !!ref && ref.atomId === atom.id && ref.fingerprint === atom.fingerprint && ref.sourceRef.entryId === atom.sourceRef.entryId && ref.sourceRef.blockIndex === atom.sourceRef.blockIndex;
	});
}
function isReplacementEvent(event) {
	return "type" in event && event.type === "replacement" && event.schemaVersion === 1;
}
/** Replay replacement history independently for every editable unit. Invalid history fails closed for that unit. */
function reduceReplacementStates(units, events, projectionAvailable = true) {
	const states = /* @__PURE__ */ new Map();
	for (const unit of units) {
		const eligibility = replacementEligibility(unit);
		const unavailable = !projectionAvailable;
		states.set(unit.id, {
			unitId: unit.id,
			originalText: unitOriginalText(unit),
			effectiveText: unitOriginalText(unit),
			replacementText: null,
			replacementState: unavailable ? "unavailable" : "original",
			replacementSupported: eligibility.supported && !unavailable,
			...unavailable ? { replacementDisabledReason: "projection-unavailable" } : eligibility.disabledReason ? { replacementDisabledReason: eligibility.disabledReason } : {},
			canRestoreReplacement: false,
			canUndoReplacement: false,
			stack: []
		});
	}
	if (!projectionAvailable) return new Map([...states].map(([id, value]) => [id, value]));
	const seenEventIds = /* @__PURE__ */ new Set();
	for (const event of events) {
		if (!isReplacementEvent(event)) continue;
		if (seenEventIds.has(event.eventId)) continue;
		seenEventIds.add(event.eventId);
		const state = states.get(event.unitId);
		if (!state || state.replacementState === "unavailable") continue;
		const unit = units.find((candidate) => candidate.id === event.unitId);
		if (!unit || !state.replacementSupported) {
			if (state) state.replacementState = "unavailable";
			continue;
		}
		if (event.action === "undo") {
			const top = state.stack[state.stack.length - 1];
			if (!top || top.eventId !== event.undoOf) {
				state.replacementState = "unavailable";
				state.replacementDisabledReason = "invalid-target";
				continue;
			}
			state.stack.pop();
			state.replacementText = top.beforeText;
			state.effectiveText = top.beforeText ?? state.originalText;
			state.replacementState = top.beforeText === null ? "original" : "replaced";
			state.activeEventId = state.stack[state.stack.length - 1]?.eventId;
			continue;
		}
		if (event.unitKind !== unit.kind || !sameAtomRefs(unit, event.atomRefs) || event.beforeText !== state.replacementText) {
			state.replacementState = "unavailable";
			state.replacementDisabledReason = "invalid-target";
			continue;
		}
		if (event.action === "replace") {
			if (typeof event.afterText !== "string" || event.afterText.trim().length === 0) {
				state.replacementState = "unavailable";
				state.replacementDisabledReason = "invalid-target";
				continue;
			}
		} else if (event.afterText !== null || event.beforeText === null) {
			state.replacementState = "unavailable";
			state.replacementDisabledReason = "invalid-target";
			continue;
		}
		state.stack.push({
			eventId: event.eventId,
			beforeText: event.beforeText,
			afterText: event.afterText
		});
		state.replacementText = event.afterText;
		state.effectiveText = event.afterText ?? state.originalText;
		state.replacementState = event.afterText === null ? "original" : "replaced";
		state.activeEventId = event.eventId;
	}
	const output = /* @__PURE__ */ new Map();
	for (const [id, state] of states) {
		state.canRestoreReplacement = state.replacementState === "replaced" && state.replacementText !== null;
		state.canUndoReplacement = state.replacementState !== "unavailable" && state.stack.length > 0;
		const { stack: _stack, ...projection } = state;
		output.set(id, projection);
	}
	return output;
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
/** Find same-turn reasoning for an Answer and expand signed reasoning to its tool closure. */
function selectAssociatedReasoningTargets(records, answerUnitId, projectionStates = /* @__PURE__ */ new Map()) {
	const units = records.flatMap((record) => record.units.map((unit) => ({
		record,
		unit
	})));
	const answer = units.find((item) => item.unit.id === answerUnitId && item.unit.kind === "answer")?.unit;
	if (!answer) return {
		answerUnitId,
		associatedReasoningUnitIds: [],
		requestedUnitIds: [],
		effectiveUnitIds: [],
		autoExpandedUnitIds: [],
		requestedAtomIds: [],
		effectiveAtomIds: [],
		unavailableUnitIds: [],
		touchesRecentTurn: false,
		newlyExcludedUnitIds: [],
		alreadyExcludedUnitIds: [],
		newlyExcludedAtomIds: [],
		alreadyExcludedAtomIds: [],
		disabledReason: "invalid-target"
	};
	const turnIds = new Set(answer.atoms.map((atom) => atom.turnId));
	const reasoningIds = units.filter((item) => item.unit.kind === "reasoning" && item.unit.atoms.some((atom) => turnIds.has(atom.turnId))).map((item) => item.unit.id);
	const selection = selectProjectionTargets(records, reasoningIds);
	const effectiveItems = units.filter((item) => selection.effectiveUnitIds.includes(item.unit.id));
	const unavailableUnitIds = [.../* @__PURE__ */ new Set([...selection.unavailableUnitIds, ...effectiveItems.filter((item) => item.unit.projectionState === "unavailable" || item.unit.mutable === false).map((item) => item.unit.id)])];
	const newlyExcludedUnitIds = [];
	const alreadyExcludedUnitIds = [];
	const newlyExcludedAtomIds = [];
	const alreadyExcludedAtomIds = [];
	for (const item of effectiveItems) {
		if (item.unit.id === answerUnitId) continue;
		const includedAtoms = item.unit.atoms.filter((atom) => (projectionStates.get(atom.id) ?? "include") === "include");
		const excludedAtoms = item.unit.atoms.filter((atom) => (projectionStates.get(atom.id) ?? "include") === "exclude");
		if (includedAtoms.length) newlyExcludedUnitIds.push(item.unit.id);
		else alreadyExcludedUnitIds.push(item.unit.id);
		newlyExcludedAtomIds.push(...includedAtoms.map((atom) => atom.id));
		alreadyExcludedAtomIds.push(...excludedAtoms.map((atom) => atom.id));
	}
	const disabledReason = unavailableUnitIds.length ? "associated-reasoning-unavailable" : void 0;
	return {
		...selection,
		answerUnitId,
		associatedReasoningUnitIds: reasoningIds,
		newlyExcludedUnitIds,
		alreadyExcludedUnitIds,
		newlyExcludedAtomIds,
		alreadyExcludedAtomIds,
		unavailableUnitIds,
		disabledReason
	};
}
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
function projectUnits(recordId, atoms, states, projectionStates, replacementStates) {
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
			mutable: true,
			...kind === "answer" && groups.has("reasoning") ? { associatedReasoningUnitIds: [`${recordId}#reasoning`] } : {}
		};
	}).map((base) => {
		const originalText = unitOriginalText(base);
		const eligibility = replacementEligibility(base);
		const replacement = replacementStates?.get(base.id);
		return {
			...base,
			effectiveText: replacement?.effectiveText ?? originalText,
			replacementState: replacement?.replacementState ?? "original",
			replacementSupported: replacement?.replacementSupported ?? eligibility.supported,
			...replacement?.replacementDisabledReason ?? eligibility.disabledReason ? { replacementDisabledReason: replacement?.replacementDisabledReason ?? eligibility.disabledReason } : {},
			canRestoreReplacement: replacement?.canRestoreReplacement ?? false,
			canUndoReplacement: replacement?.canUndoReplacement ?? false
		};
	});
}
function projectRecords(atoms, states, projectionStates, replacementStates) {
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
		const units = projectUnits(id, grouped, states, projectionStates, replacementStates).map((unit) => ({
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
			searchableText: units.map((unit) => unit.kind === "user" || unit.kind === "answer" ? unit.effectiveText : unit.atoms.map(fieldText).filter(Boolean).join(" ")).filter(Boolean).join("\n"),
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
			mutable: record.mutable,
			effectiveText: record.atoms.map((atom) => atom.text).join("\n"),
			replacementState: "original",
			replacementSupported: false,
			canRestoreReplacement: false,
			canUndoReplacement: false
		}];
		for (const unit of units) {
			if (enabledUnitKinds !== void 0 && !enabledUnitKinds.has(unit.kind)) continue;
			if ((unit.kind === "user" || unit.kind === "answer") && (normalizedScope === "all" || unit.atoms.some((atom) => atomMatchesSearchScope(atom.kind, normalizedScope)))) {
				const anchor = unit.atoms[unit.atoms.length - 1] ?? unit.atoms[0];
				if (anchor) addMatches(record, unit, anchor.id, anchor.sourceRef.blockIndex, "message", unit.effectiveText, anchor.sourceRef.entryId);
				continue;
			}
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
			mutable: unit.mutable,
			effectiveText: unit.effectiveText,
			replacementState: unit.replacementState,
			replacementSupported: unit.replacementSupported,
			...unit.replacementDisabledReason ? { replacementDisabledReason: unit.replacementDisabledReason } : {},
			canRestoreReplacement: unit.canRestoreReplacement,
			canUndoReplacement: unit.canUndoReplacement,
			...unit.associatedReasoningUnitIds?.length ? { associatedReasoningUnitIds: unit.associatedReasoningUnitIds } : {}
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
		const id = "type" in event ? event.eventId : event.transactionId;
		if (seenProjection.has(id)) return false;
		seenProjection.add(id);
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
	const replacementStates = reduceReplacementStates(projectRecords(current.atoms, states, projectionStates).flatMap((record) => record.units), projectionEventsUnique, current.projectionAvailable !== false);
	const records = projectRecords(current.atoms, states, projectionStates, replacementStates);
	return {
		...current,
		legacy,
		events,
		projectionEvents: projectionEventsUnique,
		states,
		projectionStates,
		replacementStates,
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
function replacementEventId() {
	return `context-replacement-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
function revisionMatches(input, current) {
	return String(input) === String(current);
}
function replacementTarget(state, unitId) {
	for (const record of state.records) {
		const unit = record.units.find((candidate) => candidate.id === unitId);
		if (unit) return {
			record,
			unit,
			replacement: state.replacementStates.get(unit.id)
		};
	}
	return null;
}
function replacementEventById(state, eventId) {
	return state.projectionEvents.find((event) => "type" in event && event.type === "replacement" && event.eventId === eventId);
}
function linkedUndoExclusion(state, undoOf, operationId) {
	const linked = replacementEventById(state, undoOf)?.linkedExclusion;
	if (!linked) return void 0;
	return {
		operationId,
		unitIds: [...linked.unitIds],
		atomChanges: linked.atomChanges.map((change) => ({
			...change,
			before: change.after,
			after: change.before
		}))
	};
}
function replacementPreviewFailure(state, input, disabledReason) {
	return {
		baseRevision: state.revision,
		unitId: input.unitId,
		unitKind: "answer",
		textChanged: false,
		excludeAssociatedReasoning: Boolean(input.excludeAssociatedReasoning),
		associatedReasoningUnitIds: [],
		requestedUnitIds: [],
		effectiveUnitIds: [],
		autoExpandedUnitIds: [],
		newlyExcludedUnitIds: [],
		alreadyExcludedUnitIds: [],
		newlyExcludedAtomIds: [],
		alreadyExcludedAtomIds: [],
		unavailableUnitIds: [],
		requiresConfirmation: false,
		canCommit: false,
		disabledReason
	};
}
function assertReplacementTarget(target) {
	if (!target) throw new Error("CONTEXT_EDITOR_REPLACEMENT_TARGET_NOT_FOUND");
	if (!target.unit.replacementSupported || target.unit.replacementState === "unavailable") throw new Error(`CONTEXT_EDITOR_REPLACEMENT_UNSUPPORTED:${target.unit.replacementDisabledReason ?? "invalid-target"}`);
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
	previewReplacement(adapter, input) {
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const state = currentState(adapter);
		if (state.projectionAvailable === false) return replacementPreviewFailure(state, input, state.projectionError || "projection-unavailable");
		if (!revisionMatches(input.baseRevision, state.revision)) return replacementPreviewFailure(state, input, "revision-conflict");
		const target = replacementTarget(state, input.unitId);
		if (!target) throw new Error("CONTEXT_EDITOR_REPLACEMENT_TARGET_NOT_FOUND");
		assertReplacementTarget(target);
		const text = input.text === void 0 ? target.unit.effectiveText : input.text;
		if (text.trim().length === 0) throw new Error("CONTEXT_EDITOR_REPLACEMENT_EMPTY");
		const link = Boolean(input.excludeAssociatedReasoning && target.unit.kind === "answer");
		const associated = target.unit.kind === "answer" ? selectAssociatedReasoningTargets(state.records, target.unit.id, state.projectionStates) : void 0;
		const selection = link && associated ? associated : {
			associatedReasoningUnitIds: associated?.associatedReasoningUnitIds ?? [],
			requestedUnitIds: [],
			effectiveUnitIds: [],
			autoExpandedUnitIds: [],
			newlyExcludedUnitIds: [],
			alreadyExcludedUnitIds: [],
			newlyExcludedAtomIds: [],
			alreadyExcludedAtomIds: [],
			unavailableUnitIds: [],
			disabledReason: void 0
		};
		return {
			baseRevision: state.revision,
			unitId: target.unit.id,
			unitKind: target.unit.kind,
			textChanged: text !== target.unit.effectiveText,
			excludeAssociatedReasoning: link,
			associatedReasoningUnitIds: selection.associatedReasoningUnitIds,
			requestedUnitIds: [target.unit.id, ...selection.requestedUnitIds.filter((id) => id !== target.unit.id)],
			effectiveUnitIds: [target.unit.id, ...selection.effectiveUnitIds.filter((id) => id !== target.unit.id)],
			autoExpandedUnitIds: selection.autoExpandedUnitIds,
			newlyExcludedUnitIds: selection.newlyExcludedUnitIds,
			alreadyExcludedUnitIds: selection.alreadyExcludedUnitIds,
			newlyExcludedAtomIds: selection.newlyExcludedAtomIds,
			alreadyExcludedAtomIds: selection.alreadyExcludedAtomIds,
			unavailableUnitIds: selection.unavailableUnitIds,
			requiresConfirmation: selection.autoExpandedUnitIds.length > 0,
			canCommit: selection.disabledReason === void 0 && selection.unavailableUnitIds.length === 0,
			...selection.disabledReason ? { disabledReason: selection.disabledReason } : {}
		};
	}
	commitReplacement(adapter, input) {
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const state = currentState(adapter);
		const operationId = input.operationId ?? replacementEventId();
		if (state.projectionAvailable === false) throw new Error(state.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (!revisionMatches(input.baseRevision, state.revision)) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(currentState(adapter))
		};
		if (input.text.trim().length === 0) throw new Error("CONTEXT_EDITOR_REPLACEMENT_EMPTY");
		const target = replacementTarget(state, input.unitId);
		assertReplacementTarget(target);
		const link = Boolean(input.excludeAssociatedReasoning && target.unit.kind === "answer");
		const selection = link ? selectAssociatedReasoningTargets(state.records, target.unit.id, state.projectionStates) : void 0;
		if (selection?.disabledReason || selection?.unavailableUnitIds.length) throw new Error("CONTEXT_EDITOR_REPLACEMENT_LINK_UNAVAILABLE");
		const confirmed = new Set((input.confirmedUnitIds ?? input.confirmationScope ?? []).map(String));
		if (selection?.autoExpandedUnitIds.some((id) => !confirmed.has(id))) throw new Error("CONTEXT_EDITOR_REPLACEMENT_CONFIRMATION_REQUIRED");
		if (input.text === target.unit.effectiveText && !selection?.newlyExcludedAtomIds.length) return {
			ok: true,
			operationId,
			snapshot: snapshotOf(state)
		};
		const beforeText = target.replacement?.replacementText ?? null;
		const latest = currentState(adapter);
		if (latest.revision !== state.revision) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(latest)
		};
		const latestTarget = replacementTarget(latest, input.unitId);
		assertReplacementTarget(latestTarget);
		if (latestTarget.unit.atomIds.join("|") !== target.unit.atomIds.join("|") || (latestTarget.replacement?.replacementText ?? null) !== beforeText) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(latest)
		};
		const latestSelection = link ? selectAssociatedReasoningTargets(latest.records, latestTarget.unit.id, latest.projectionStates) : void 0;
		if (latestSelection?.disabledReason || latestSelection?.unavailableUnitIds.length) throw new Error("CONTEXT_EDITOR_REPLACEMENT_LINK_UNAVAILABLE");
		if (latestSelection?.autoExpandedUnitIds.some((id) => !confirmed.has(id))) throw new Error("CONTEXT_EDITOR_REPLACEMENT_CONFIRMATION_REQUIRED");
		const atomRefs = latestTarget.unit.atoms.map((atom) => ({
			atomId: atom.id,
			sourceRef: atom.sourceRef,
			fingerprint: atom.fingerprint
		}));
		const linkedChanges = latestSelection?.newlyExcludedAtomIds.map((atomId) => {
			const atom = latest.atoms.find((candidate) => candidate.id === atomId);
			return atom ? {
				atomId: atom.id,
				fingerprint: atom.fingerprint,
				sourceRef: atom.sourceRef,
				before: latest.projectionStates.get(atom.id) === "exclude" ? "exclude" : "include",
				after: "exclude"
			} : void 0;
		}).filter((change) => change !== void 0) ?? [];
		const eventId = appendProjectionEvent(adapter, {
			schemaVersion: 1,
			type: "replacement",
			action: "replace",
			eventId: operationId,
			unitId: latestTarget.unit.id,
			unitKind: latestTarget.unit.kind,
			atomRefs,
			beforeText,
			afterText: input.text,
			baseRevision: state.revision,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			...link && latestSelection ? { linkedExclusion: {
				operationId,
				unitIds: latestSelection.newlyExcludedUnitIds,
				atomChanges: linkedChanges
			} } : {}
		});
		this.searchCache.clear();
		return {
			ok: true,
			operationId,
			eventId,
			snapshot: snapshotOf(currentState(adapter))
		};
	}
	restoreReplacement(adapter, input) {
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const state = currentState(adapter);
		const operationId = input.operationId ?? replacementEventId();
		if (state.projectionAvailable === false) throw new Error(state.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (!revisionMatches(input.baseRevision, state.revision)) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(currentState(adapter))
		};
		const target = replacementTarget(state, input.unitId);
		assertReplacementTarget(target);
		const beforeText = target.replacement?.replacementText ?? null;
		if (beforeText === null) return {
			ok: true,
			operationId,
			snapshot: snapshotOf(currentState(adapter))
		};
		const latest = currentState(adapter);
		if (latest.revision !== state.revision) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(latest)
		};
		const latestTarget = replacementTarget(latest, input.unitId);
		assertReplacementTarget(latestTarget);
		if ((latestTarget.replacement?.replacementText ?? null) !== beforeText) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(latest)
		};
		const eventId = appendProjectionEvent(adapter, {
			schemaVersion: 1,
			type: "replacement",
			action: "restore",
			eventId: operationId,
			unitId: target.unit.id,
			unitKind: target.unit.kind,
			atomRefs: target.unit.atoms.map((atom) => ({
				atomId: atom.id,
				sourceRef: atom.sourceRef,
				fingerprint: atom.fingerprint
			})),
			beforeText,
			afterText: null,
			baseRevision: state.revision,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		});
		this.searchCache.clear();
		return {
			ok: true,
			operationId,
			eventId,
			snapshot: snapshotOf(currentState(adapter))
		};
	}
	undoReplacement(adapter, input) {
		if (adapter.isBusy()) throw new Error("AGENT_RUNTIME_BUSY");
		const state = currentState(adapter);
		const operationId = input.operationId ?? replacementEventId();
		if (state.projectionAvailable === false) throw new Error(state.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (!revisionMatches(input.baseRevision, state.revision)) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(currentState(adapter))
		};
		const target = replacementTarget(state, input.unitId);
		assertReplacementTarget(target);
		const undoOf = target.replacement?.activeEventId;
		if (!undoOf || !target.unit.canUndoReplacement) return {
			ok: true,
			operationId,
			snapshot: snapshotOf(currentState(adapter))
		};
		const latest = currentState(adapter);
		if (latest.revision !== state.revision) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(latest)
		};
		const latestTarget = replacementTarget(latest, input.unitId);
		assertReplacementTarget(latestTarget);
		if (latestTarget.replacement?.activeEventId !== undoOf) return {
			ok: false,
			conflict: true,
			operationId,
			snapshot: snapshotOf(latest)
		};
		const linkedExclusion = linkedUndoExclusion(state, undoOf, operationId);
		const eventId = appendProjectionEvent(adapter, {
			schemaVersion: 1,
			type: "replacement",
			action: "undo",
			eventId: operationId,
			unitId: target.unit.id,
			undoOf,
			baseRevision: state.revision,
			createdAt: (/* @__PURE__ */ new Date()).toISOString(),
			...linkedExclusion ? { linkedExclusion } : {}
		});
		this.searchCache.clear();
		return {
			ok: true,
			operationId,
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
//#region adapters/pi-extension/src/shared-core/condensation.ts
/**
* Reconcile a selective condensation with successful host-native compactions.
*
* Native compaction operates on surface roots, so the relationship is derived
* from the exact shadowed root set rather than from a positional range. This
* keeps partial coverage meaningful when a later compaction only absorbs part
* of an older selective summary.
*/
function deriveCondensationCoverage(sourceRootSeqs, nativeCompactions) {
	if (sourceRootSeqs.some((value) => typeof value === "string")) return deriveCondensationEntryCoverage(sourceRootSeqs.map(String), nativeCompactions);
	const source = Array.from(new Set((sourceRootSeqs ?? []).map(Number).filter((value) => Number.isSafeInteger(value) && value >= 0))).sort((a, b) => a - b);
	const relatedRefs = Array.from(new Map((nativeCompactions ?? []).filter((ref) => ref && typeof ref.compactionId === "string" && ref.compactionId.length > 0).map((ref) => [ref.compactionId, {
		...ref,
		host: String(ref.host ?? ""),
		compactionId: String(ref.compactionId),
		shadowedRootSeqs: Array.from(new Set((ref.shadowedRootSeqs ?? []).map(Number).filter((value) => Number.isSafeInteger(value) && value >= 0))).sort((a, b) => a - b),
		...Number.isSafeInteger(ref.startSeq) ? { startSeq: Number(ref.startSeq) } : {},
		...ref.shadowedRange && Number.isSafeInteger(ref.shadowedRange.start) && Number.isSafeInteger(ref.shadowedRange.end) ? { shadowedRange: {
			start: Number(ref.shadowedRange.start),
			end: Number(ref.shadowedRange.end)
		} } : {},
		...Number.isSafeInteger(ref.summarySeq) ? { summarySeq: Number(ref.summarySeq) } : {},
		...Number.isSafeInteger(ref.checkpointSeq) ? { checkpointSeq: Number(ref.checkpointSeq) } : {},
		...Number.isSafeInteger(ref.endSeq) ? { endSeq: Number(ref.endSeq) } : {},
		committed: ref.committed !== false
	}])).values()).filter((ref) => ref.shadowedRootSeqs.length > 0).sort((left, right) => (right.checkpointSeq ?? right.endSeq ?? right.summarySeq ?? -1) - (left.checkpointSeq ?? left.endSeq ?? left.summarySeq ?? -1)).filter((ref) => source.some((root) => ref.shadowedRootSeqs.includes(root)));
	const verifiedRefs = relatedRefs.filter((ref) => ref.committed !== false);
	const covered = source.filter((root) => verifiedRefs.some((ref) => ref.shadowedRootSeqs.includes(root)));
	const uncertainRefs = relatedRefs.filter((ref) => ref.committed === false && ref.shadowedRootSeqs.some((root) => source.includes(root) && !covered.includes(root)));
	const outputRefs = [...verifiedRefs, ...uncertainRefs];
	const uncertain = uncertainRefs.length > 0;
	const uncovered = source.filter((root) => !covered.includes(root));
	const status = covered.length === 0 ? "none" : uncovered.length === 0 ? "full" : "partial";
	const checkpoint = verifiedRefs.find((ref) => Number.isSafeInteger(ref.checkpointSeq));
	const restoreMode = uncertain ? "unavailable" : status === "none" ? "inline" : checkpoint ? "checkpoint" : "unavailable";
	return {
		status,
		restoreMode,
		coveredSourceRootSeqs: covered,
		uncoveredSourceRootSeqs: uncovered,
		nativeCompactions: outputRefs,
		...checkpoint ? {
			checkpointCompactionId: checkpoint.compactionId,
			checkpointSeq: checkpoint.checkpointSeq
		} : {},
		...restoreMode === "inline" ? {} : { reason: restoreMode === "checkpoint" ? "native-compaction-absorbed-source" : "checkpoint-unavailable" }
	};
}
/** Derive coverage for hosts whose durable surface uses opaque entry IDs (Pi). */
function deriveCondensationEntryCoverage(sourceEntryIds, nativeCompactions) {
	const source = Array.from(new Set(sourceEntryIds.map(String).filter(Boolean)));
	const relatedRefs = Array.from(new Map((nativeCompactions ?? []).filter((ref) => ref && typeof ref.compactionId === "string" && ref.compactionId.length > 0).map((ref) => [ref.compactionId, {
		...ref,
		host: String(ref.host ?? ""),
		compactionId: String(ref.compactionId),
		shadowedRootSeqs: Array.from(new Set((ref.shadowedRootSeqs ?? []).map(Number).filter((value) => Number.isSafeInteger(value) && value >= 0))).sort((a, b) => a - b),
		shadowedEntryIds: Array.from(new Set((ref.shadowedEntryIds ?? []).map(String).filter(Boolean))),
		...typeof ref.checkpointEntryId === "string" && ref.checkpointEntryId.length > 0 ? { checkpointEntryId: ref.checkpointEntryId } : {},
		committed: ref.committed !== false
	}])).values()).filter((ref) => ref.shadowedEntryIds.length > 0).sort((left, right) => (right.checkpointSeq ?? right.endSeq ?? right.summarySeq ?? -1) - (left.checkpointSeq ?? left.endSeq ?? left.summarySeq ?? -1)).filter((ref) => source.some((entryId) => ref.shadowedEntryIds?.includes(entryId)));
	const verifiedRefs = relatedRefs.filter((ref) => ref.committed !== false);
	const covered = source.filter((entryId) => verifiedRefs.some((ref) => ref.shadowedEntryIds?.includes(entryId)));
	const uncertainRefs = relatedRefs.filter((ref) => ref.committed === false && ref.shadowedEntryIds?.some((entryId) => source.includes(entryId) && !covered.includes(entryId)));
	const uncovered = source.filter((entryId) => !covered.includes(entryId));
	const status = covered.length === 0 ? "none" : uncovered.length === 0 ? "full" : "partial";
	const checkpoint = verifiedRefs.find((ref) => typeof ref.checkpointEntryId === "string" && ref.checkpointEntryId.length > 0);
	const restoreMode = uncertainRefs.length > 0 ? "unavailable" : status === "none" ? "inline" : checkpoint ? "checkpoint" : "unavailable";
	return {
		status,
		restoreMode,
		coveredSourceRootSeqs: [],
		uncoveredSourceRootSeqs: [],
		coveredSourceEntryIds: covered,
		uncoveredSourceEntryIds: uncovered,
		nativeCompactions: [...verifiedRefs, ...uncertainRefs],
		...checkpoint ? {
			checkpointCompactionId: checkpoint.compactionId,
			...checkpoint.checkpointSeq === void 0 ? {} : { checkpointSeq: checkpoint.checkpointSeq },
			...checkpoint.checkpointEntryId === void 0 ? {} : { checkpointEntryId: checkpoint.checkpointEntryId }
		} : {},
		...restoreMode === "inline" ? {} : { reason: restoreMode === "checkpoint" ? "native-compaction-absorbed-source" : "checkpoint-unavailable" }
	};
}
function textOfAtom(atom) {
	return [atom.toolName ?? "", atom.text].filter(Boolean).join(": ");
}
function estimateTextTokens(text) {
	return Math.max(0, Math.ceil(String(text ?? "").length / 4));
}
/** Return the effective text that should be supplied to the summary model. */
function condensationUnitText(unit, projectionStates) {
	if (unit.projectionState === "exclude") return "";
	const atoms = (unit.atoms ?? []).filter((atom) => {
		const state = projectionStates?.get(atom.id);
		return state !== "exclude" && state !== "unavailable";
	});
	if ((unit.kind === "user" || unit.kind === "answer") && atoms.length === (unit.atoms ?? []).length) return String(unit.effectiveText ?? "");
	return atoms.map(textOfAtom).filter(Boolean).join("\n");
}
function atomRoot(atom) {
	const root = Number(atom.sourceRef?.entryId);
	return Number.isSafeInteger(root) ? root : void 0;
}
function atomEntryId(atom) {
	const value = String(atom.sourceRef?.entryId ?? "");
	return value ? value : void 0;
}
function sourceInfo(unit, projectionStates) {
	const atoms = unit.atoms ?? [];
	const entryIds = Array.from(new Set(atoms.map(atomEntryId).filter((value) => value !== void 0)));
	const roots = Array.from(new Set(atoms.map(atomRoot).filter((value) => value !== void 0))).sort((a, b) => a - b);
	const includedAtoms = atoms.filter((atom) => projectionStates?.get(atom.id) !== "exclude" && projectionStates?.get(atom.id) !== "unavailable");
	const text = condensationUnitText(unit, projectionStates);
	const toolNames = Array.from(new Set(includedAtoms.map((atom) => atom.toolName).filter((value) => Boolean(value))));
	const approxTokens = includedAtoms.reduce((sum, atom) => sum + (Number(atom.approxTokens) || estimateTextTokens(atom.text)), 0);
	return {
		id: unit.id,
		recordId: unit.recordId,
		kind: unit.kind,
		atomIds: atoms.map((atom) => atom.id),
		...entryIds.length ? { sourceEntryIds: entryIds } : {},
		sourceRootSeqs: roots,
		text,
		approxTokens: text ? Math.max(approxTokens, estimateTextTokens(text)) : 0,
		included: unit.projectionState !== "exclude" && unit.projectionState !== "unavailable" && includedAtoms.length > 0,
		...toolNames.length ? { toolNames } : {},
		...includedAtoms.some((atom) => atom.isError) ? { isError: true } : {},
		...includedAtoms.some((atom) => atom.hasSignature) ? { hasSignature: true } : {},
		...includedAtoms.some((atom) => atom.structured) ? { structured: true } : {}
	};
}
function risksFor(source, unit) {
	const risks = /* @__PURE__ */ new Set();
	if (source.kind === "tool") risks.add("tool-output");
	if (source.kind === "reasoning") risks.add("reasoning");
	if (source.structured) risks.add("structured-content");
	if (source.included === false || unit.projectionState === "mixed") risks.add("already-excluded");
	return risks;
}
/** Expand a contiguous editor selection to complete records/turns. */
function selectCondensationRange(records, requestedUnitIds, projectionStates, options = {}) {
	const requested = Array.from(new Set((requestedUnitIds ?? []).map(String).filter(Boolean)));
	const positions = /* @__PURE__ */ new Map();
	records.forEach((record, index) => (record.units ?? []).forEach((unit) => positions.set(unit.id, index)));
	const unavailableUnitIds = requested.filter((id) => !positions.has(id));
	const selectedPositions = requested.map((id) => positions.get(id)).filter((value) => value !== void 0);
	if (selectedPositions.length === 0) return {
		requestedUnitIds: requested,
		effectiveUnitIds: [],
		autoExpandedUnitIds: [],
		recordIds: [],
		sourceRootSeqs: [],
		sourceUnits: [],
		shadowedTokenCount: 0,
		unavailableUnitIds,
		risks: [],
		sourceFingerprint: stableFingerprint([])
	};
	let first = Math.min(...selectedPositions);
	let last = Math.max(...selectedPositions);
	const related = /* @__PURE__ */ new Set();
	for (const index of selectedPositions) for (const atom of records[index]?.atoms ?? []) {
		if (atom.turnId) related.add(`turn:${atom.turnId}`);
		if (atom.toolCallId) related.add(`call:${atom.toolCallId}`);
	}
	const recordRelated = (index) => (records[index]?.atoms ?? []).some((atom) => atom.turnId && related.has(`turn:${atom.turnId}`) || atom.toolCallId && related.has(`call:${atom.toolCallId}`));
	let changed = true;
	while (changed && options.expandRelated === true) {
		changed = false;
		if (first > 0 && recordRelated(first - 1)) {
			first -= 1;
			changed = true;
		}
		if (last + 1 < records.length && recordRelated(last + 1)) {
			last += 1;
			changed = true;
		}
	}
	const effectiveUnits = [];
	for (let index = first; index <= last; index += 1) {
		const record = records[index];
		if (!record) continue;
		for (const unit of record.units ?? []) if (options.expandRelated === true || requested.includes(unit.id)) effectiveUnits.push({
			record,
			unit
		});
	}
	const effectiveUnitIds = effectiveUnits.map(({ unit }) => unit.id);
	const requestedSet = new Set(requested);
	const autoExpandedUnitIds = effectiveUnitIds.filter((id) => !requestedSet.has(id));
	const sourceUnits = effectiveUnits.map(({ unit }) => sourceInfo(unit, projectionStates));
	const sourceEntryIds = Array.from(new Set(sourceUnits.flatMap((unit) => unit.sourceEntryIds ?? [])));
	const sourceRootSeqs = Array.from(new Set(sourceUnits.flatMap((unit) => unit.sourceRootSeqs))).sort((a, b) => a - b);
	const risks = /* @__PURE__ */ new Set();
	sourceUnits.forEach((source, index) => {
		const item = effectiveUnits[index];
		if (item) risksFor(source, item.unit).forEach((risk) => risks.add(risk));
	});
	const unavailable = effectiveUnits.filter(({ unit, record }) => unit.projectionState === "unavailable" || !unit.mutable || !record.mutable).map(({ unit }) => unit.id);
	unavailableUnitIds.push(...unavailable.filter((id) => !unavailableUnitIds.includes(id)));
	const shadowedTokenCount = sourceUnits.filter((source) => !source.included).reduce((sum, source) => sum + source.approxTokens, 0);
	const sourceFingerprint = stableFingerprint(sourceUnits.flatMap((source) => [
		source.id,
		source.atomIds.join(","),
		(source.sourceEntryIds ?? []).join(","),
		source.text,
		source.included ? "include" : "exclude"
	]));
	return {
		requestedUnitIds: requested,
		effectiveUnitIds,
		autoExpandedUnitIds,
		recordIds: Array.from(new Set(effectiveUnits.map(({ record }) => record.id))),
		...sourceEntryIds.length ? { sourceEntryIds } : {},
		sourceRootSeqs,
		sourceUnits,
		shadowedTokenCount,
		unavailableUnitIds,
		risks: Array.from(risks),
		sourceFingerprint
	};
}
/** Validate model or user edited output against the real framed replacement. */
function validateCondensationSummary(summary, beforeTokens, options = {}) {
	const value = String(summary ?? "").trim();
	const before = Math.max(0, Number(beforeTokens) || 0);
	const after = Math.max(0, Number(options.summaryTokens) || estimateTextTokens(frameCondensationSummary(value)));
	const saved = before - after;
	const ratio = before > 0 ? Math.max(0, saved / before) : 0;
	const metrics = {
		beforeTokens: before,
		afterTokens: after,
		savedTokens: saved,
		savingsRatio: ratio,
		belowRecommendedThreshold: ratio < .4 || saved < 500
	};
	if (!value) return {
		ok: false,
		summary: value,
		metrics,
		warnings: [],
		error: "empty-summary"
	};
	if (options.truncated) return {
		ok: false,
		summary: value,
		metrics,
		warnings: [],
		error: "truncated-summary"
	};
	if (after >= before) return {
		ok: false,
		summary: value,
		metrics,
		warnings: [],
		error: "not-smaller"
	};
	const warnings = [];
	if (ratio < .4) warnings.push("savings-below-40-percent");
	if (saved < 500) warnings.push("savings-below-500-tokens");
	return {
		ok: true,
		summary: value,
		metrics,
		warnings
	};
}
/** Stable wrapper persisted in the model-facing message. */
function frameCondensationSummary(summary) {
	return `<condensed-context>\n${String(summary ?? "").trim()}\n</condensed-context>`;
}
function estimateCondensationTokens(value) {
	return estimateTextTokens(value);
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
function isPlainTextUserContent(content) {
	if (typeof content === "string") return true;
	if (!Array.isArray(content) || content.length === 0) return false;
	return content.every((part) => {
		if (!part || typeof part !== "object") return false;
		const value = part;
		return value.type === "text" && typeof value.text === "string";
	});
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
			const text = contentToText(message.content);
			if (!/^\/[A-Za-z][A-Za-z0-9:_-]*(?:\s|$)/.test(text.trim())) addAtom(atoms, entry, turnId, 0, "user", text, { structured: !isPlainTextUserContent(message.content) });
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
				hasSignature: typeof value.thinkingSignature === "string" && value.thinkingSignature.length > 0 && !((message.api === "openai-completions" || message.provider === "deepseek") && [
					"reasoning_content",
					"reasoning",
					"reasoning_text"
				].includes(value.thinkingSignature)),
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
			return zh ? "Space 勾选/取消 · Shift+↑/↓ 连选 · c 精简 · ? 帮助 · j/k · Enter 查看/收起 · C 摘要排除/恢复 · D 恢复精简前内容 · O 展开来源 · e 编辑 · E 恢复原文 · z 撤销编辑 · o 对照原文 · h 隐藏 · r 恢复 · x 排除/恢复模型上下文 · / 搜索 · ? 帮助 · q 关闭" : "Space select/unselect · Shift+↑/↓ range · c condense · ? help · j/k move · Enter view/collapse · C exclude/restore summary · D restore pre-condensation · O expand sources · e edit · E restore original · z undo edit · o compare original · h hide · r restore · x exclude/restore model context · / search · ? help · q close";
		},
		tuiHelpTitle: () => zh ? "Context Editor 快捷键" : "Context Editor help",
		tuiHelpLines: () => zh ? [
			"Enter  临时展开/收起，不保存",
			"c      AI 精简选中内容；设置页 Space 选择关联思考/工具，Enter 生成；C/D/O 操作已应用摘要",
			"e      编辑当前用户/回答单元（提交到 sidecar）",
			"E      确认恢复原文；z 撤销最近一次编辑；o 对照原文",
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
			"c      AI condense the selection; Space enables related reasoning/tools for one Answer; C/D/O act on applied cards",
			"e      edit the current User/Answer unit (sidecar only)",
			"E      restore canonical text; z undo the latest edit; o compare original",
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
		replacementBusy: () => zh ? "Agent 正在运行，暂时不能编辑上下文。" : "The Agent is running; context editing is temporarily unavailable.",
		undoConflict: () => zh ? "撤销时发现 revision 冲突，已刷新。" : "A revision conflict occurred while undoing; the view was refreshed.",
		undoFailed: (error) => zh ? `撤销失败：${error}` : `Undo failed: ${error}`,
		restoreAllConfirmTitle: () => zh ? "恢复全部隐藏单元？" : "Restore all hidden units?",
		restoreAllConfirmMessage: () => zh ? "这只会恢复 Context Editor 的视觉状态，不会修改 Session 或模型上下文。" : "This only restores the Context Editor view state; the Session and model context are unchanged.",
		editTitle: (kind) => zh ? `编辑${kind}` : `Edit ${kind}`,
		replacementReviewTitle: () => zh ? "确认 Answer 编辑与联动排除" : "Review Answer edit and linked exclusion",
		replacementReviewHint: () => zh ? "Space 切换联动排除 · PgUp/PgDn 滚动 · Enter 保存 · e 返回修改草稿 · Esc 取消整次编辑" : "Space toggle linked exclusion · PgUp/PgDn scroll · Enter save · e edit draft · Esc cancel",
		replacementReviewAnswer: (changed) => zh ? `Answer 文本：${changed ? "已改变" : "未改变"}` : `Answer text: ${changed ? "changed" : "unchanged"}`,
		replacementReviewLink: (enabled, count) => zh ? `同时排除本轮思考：[${enabled ? "x" : " "}]（关联 ${count} 个 Reasoning 单元）` : `Exclude associated reasoning: [${enabled ? "x" : " "}] (${count} reasoning unit${count === 1 ? "" : "s"})`,
		replacementReviewScope: (scope, ids) => {
			return `${(zh ? {
				associated: "关联 Reasoning",
				newlyExcluded: "新增排除",
				alreadyExcluded: "原已排除",
				autoExpanded: "自动扩展工具链"
			} : {
				associated: "Associated reasoning",
				newlyExcluded: "Newly excluded",
				alreadyExcluded: "Already excluded",
				autoExpanded: "Auto-expanded tool closure"
			})[scope]}: ${ids.length ? ids.join(", ") : zh ? "无" : "none"}`;
		},
		replacementReviewConfirmationRequired: (count) => zh ? `签名思考触发结构闭包：需确认 ${count} 个自动扩展单元。` : `Signed reasoning expands the structural closure; confirm ${count} auto-expanded unit${count === 1 ? "" : "s"}.`,
		replacementReviewBlocked: (reason) => zh ? `当前联动事务不可保存：${reason}` : `This linked transaction cannot be saved: ${reason}`,
		replacementReviewNoop: () => zh ? "文本和联动范围都没有变化，未追加事件。" : "No text or linked-scope changes; no event was appended.",
		replacementRestoreTitle: () => zh ? "恢复 Answer 原文？" : "Restore Answer canonical text?",
		replacementRestoreMessage: () => zh ? "仅恢复 Answer 原文；本轮 Reasoning 的排除状态会保留。" : "Only the Answer text is restored; Reasoning exclusion for this turn remains.",
		replacementEmpty: () => zh ? "替换文本不能为空白。" : "Replacement text cannot be blank.",
		condensationBusy: () => zh ? "Agent 正在运行，暂时不能生成精简。" : "The Agent is running; condensation is temporarily unavailable.",
		condensationNoSelection: () => zh ? "请先选择一个连续的上下文单元。" : "Select a contiguous context range first.",
		condensationSetupTitle: () => zh ? "AI 精简设置" : "AI condensation settings",
		condensationSetup: (count, canExpand, enabled) => zh ? `已选择 ${count} 个单元。默认使用当前会话模型；${canExpand ? "可选同步关联的思考和工具输出。" : "当前选区不支持同步扩展。"}` : `${count} unit(s) selected. The current session model will be used; ${canExpand ? "related reasoning and tool output can be included." : "related expansion is disabled for this selection."}`,
		condensationExpandRelated: (enabled) => zh ? `同步精简 AI 思考和工具输出：[${enabled ? "x" : " "}]` : `Also condense related reasoning and tool output: [${enabled ? "x" : " "}]`,
		condensationExpandDisabled: () => zh ? "同步精简选项：置灰（仅单条 Answer 可用）" : "Related condensation: disabled (only available for one Answer)",
		condensationSetupHint: () => zh ? "Space 切换扩展 · Enter 生成/重试 · Esc 返回" : "Space toggle expansion · Enter generate/retry · Esc back",
		condensationCancelHint: () => zh ? "正在生成；Esc 取消并丢弃迟到结果" : "Generating; Esc cancels and discards late results",
		condensationGenerating: () => zh ? "正在生成精简候选…" : "Generating condensation candidate…",
		condensationGenerationFailed: (error) => error.includes("CONTEXT_EDITOR_CONDENSATION_OVERLAP:") ? zh ? "选区已有生效的精简摘要。请按 Esc 返回列表，再按 D 恢复精简前内容后重试；C 仅排除摘要，不会解除精简。" : "This selection already has an active summary. Press Esc, then D to restore pre-condensation content before retrying. C only excludes the summary." : zh ? `精简生成失败：${error}` : `Condensation generation failed: ${error}`,
		condensationReviewTitle: () => zh ? "预览 AI 精简" : "Preview AI condensation",
		condensationReviewHint: () => zh ? "j/k、PgUp/PgDn 滚动 · e 编辑摘要 · r 重新生成 · Enter 应用 · Esc 取消" : "j/k, PgUp/PgDn scroll · e edit summary · r regenerate · Enter apply · Esc cancel",
		condensationSource: (units, entries) => zh ? `来源：${units} 个单元，${entries} 条 Pi entry` : `Source: ${units} unit(s), ${entries} Pi entr(y/ies)`,
		condensationModel: (provider, model) => zh ? `模型：${provider}/${model}` : `Model: ${provider}/${model}`,
		condensationMetrics: (before, after, saved, ratio) => zh ? `估算 Token：${before} → ${after}，节省 ${saved}（${Math.round(ratio * 100)}%）` : `Estimated tokens: ${before} -> ${after}; saved ${saved} (${Math.round(ratio * 100)}%)`,
		condensationRisks: (risks) => zh ? `风险：${risks.join("、")}` : `Risks: ${risks.join(", ")}`,
		condensationWarnings: (warnings) => zh ? `提示：${warnings.join("、")}` : `Warnings: ${warnings.join(", ")}`,
		condensationSummaryTitle: () => zh ? "摘要正文（应用前可编辑）" : "Summary (editable before apply)",
		condensationBlocked: (reason) => zh ? `当前摘要不可应用：${reason}` : `This summary cannot be applied: ${reason}`,
		condensationApplied: () => zh ? "已应用 AI 精简；原始 Session 未修改。" : "AI condensation applied; the original Session was unchanged.",
		condensationRestored: () => zh ? "已恢复精简前内容。" : "Condensed content was restored.",
		condensationCardTitle: (operationId, state) => zh ? `AI 精简 ${state} · ${operationId}` : `AI condensation ${state} · ${operationId}`,
		condensationCardActive: () => zh ? "生效" : "active",
		condensationCardExcluded: () => zh ? "摘要已排除" : "summary excluded",
		condensationCardMetrics: (saved, ratio) => zh ? `预计节省 ${saved} tokens（${Math.round(ratio * 100)}%）· C 排除/恢复摘要 · D 恢复精简前内容 · O 展开来源` : `Estimated saving ${saved} tokens (${Math.round(ratio * 100)}%) · C exclude/restore summary · D restore pre-condensation content · O expand sources`,
		condensationCoverage: (status, restoreMode) => zh ? `原生压缩覆盖：${status} · 恢复方式：${restoreMode}` : `Native compaction coverage: ${status} · restore: ${restoreMode}`,
		condensationRestoreRequired: (restoreMode, checkpointEntryId) => zh ? `原生压缩已吸收来源；请先通过 /tree 返回压缩前检查点${checkpointEntryId ? `（${checkpointEntryId}）` : ""}，再恢复。` : `Native compaction absorbed this source; use /tree to return to the pre-compaction checkpoint${checkpointEntryId ? ` (${checkpointEntryId})` : ""} before restoring.`,
		condensationCovered: (index) => zh ? `已由摘要 #${index} 替换` : `Replaced by summary #${index}`,
		condensationSourceList: (index, count) => zh ? `摘要 #${index} 来源 ${count} 条 · O 展开/收起原文 · PgUp/PgDn 滚动` : `Summary #${index}: ${count} sources · O expand/collapse originals · PgUp/PgDn scroll`,
		condensationCardSources: (ids) => zh ? `来源单元：${ids.length ? ids.join("、") : "无"}` : `Source units: ${ids.length ? ids.join(", ") : "none"}`
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
function replacementOperationId() {
	return `pi-context-replacement-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
	isIdle;
	done;
	previewContext;
	commitContext;
	commitReplacement;
	previewReplacement;
	restoreReplacement;
	undoReplacement;
	generateCondensation;
	cancelCondensation;
	commitCondensation;
	restoreCondensation;
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
	showOriginal = false;
	matches = [];
	matchIndex = -1;
	lastRenderWidth = 0;
	lastRenderRows = 0;
	pendingConfirmation = null;
	replacementReview = null;
	replacementReviewScrollOffset = 0;
	condensationError = null;
	condensationSetup = null;
	condensationReview = null;
	condensationReviewScrollOffset = 0;
	condensationAbortController = null;
	condensationGenerationNonce = 0;
	condensations = [];
	condensationCardExpanded = false;
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
		this.commitReplacement = deps.commitReplacement;
		this.previewReplacement = deps.previewReplacement;
		this.restoreReplacement = deps.restoreReplacement;
		this.undoReplacement = deps.undoReplacement;
		this.generateCondensation = deps.generateCondensation;
		this.cancelCondensation = deps.cancelCondensation;
		this.commitCondensation = deps.commitCondensation;
		this.restoreCondensation = deps.restoreCondensation;
		this.condensations = [...snapshot.condensations ?? []];
		this.projectionAvailable = snapshot.projectionAvailable !== false && !!deps.previewContext && !!deps.commitContext;
		this.prefs = {
			...prefs,
			enabledUnitKinds: [...prefs.enabledUnitKinds]
		};
		this.query = deps.initialUiState?.query ?? "";
		this.searchScope = deps.initialUiState?.searchScope ?? "dialogue";
		this.showOriginal = deps.initialUiState?.showOriginal ?? false;
		this.loadRecords = deps.loadRecords;
		this.loadSnapshot = deps.loadSnapshot;
		this.mutate = deps.mutate;
		this.undoMutation = deps.undo;
		this.persistPrefs = deps.persistPrefs;
		this.notify = deps.notify;
		this.isIdle = deps.isIdle;
		this.done = done;
		this.text = createPiText(deps.locale ?? detectPiLocale());
		const validIds = new Set(records.flatMap((record) => record.units.map((unit) => unit.id)));
		for (const id of deps.initialUiState?.checkedUnitIds ?? []) if (validIds.has(id)) this.selected.add(id);
		const selectedUnitId = deps.initialUiState?.selectedUnitId;
		if (selectedUnitId) {
			const index = this.flatUnits().findIndex(({ unit }) => unit.id === selectedUnitId);
			if (index >= 0) this.selectedIndex = index;
		}
		this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
		this.replacementReview = deps.initialReplacementReview ?? null;
		this.condensationReview = deps.initialCondensationReview ?? null;
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
	originalText(unit) {
		return unit.atoms.map((atom) => atom.text).join("\n");
	}
	contentText(unit, activeHit) {
		const text = this.showOriginal && this.currentUnit()?.unit.id === unit.id ? this.originalText(unit) : unit.effectiveText;
		if (!activeHit || this.showOriginal || activeHit.field === "tool_name" || activeHit.unitId !== unit.id) return text;
		return this.highlightText(text, activeHit.start, activeHit.end);
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
		const sourceIndex = this.records.flatMap((r) => r.units).findIndex((u) => u.id === unit.id) + 1;
		const covering = this.condensations.findIndex((c) => c.sourceUnits.some((u) => u.id === unit.id));
		const label = covering >= 0 ? this.text.condensationCovered(covering + 1) : this.text.contextState(modelState);
		const base = `${cursor} ${checkbox} #${sourceIndex} ${this.text.unitKind(unit.kind)} · ${this.text.recordKind(record.kind)} · ${this.text.unitState(state)} · ${label} · ${unit.atoms.reduce((sum, atom) => sum + atom.approxTokens, 0)} tok`;
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
		return this.condensationCardLines(width).length + this.flatUnits().reduce((sum, item) => sum + this.unitLineCount(item, width), 0);
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
		const item = this.currentUnit();
		const visibleHeight = item ? Math.min(viewport, this.unitLineCount(item, width)) : 1;
		if (selectedLine + visibleHeight > this.scrollOffset + viewport) this.scrollOffset = selectedLine + visibleHeight - viewport;
		this.scrollOffset = Math.max(0, this.scrollOffset);
	}
	unitStartOffset(index, width) {
		return this.condensationCardLines(width).length + this.flatUnits().slice(0, index).reduce((sum, item) => sum + this.unitLineCount(item, width), 0);
	}
	bodyLineIndexForHit(unit, hit, width) {
		if (hit.field === "tool_name") return 0;
		const text = unit.effectiveText;
		return Math.max(0, wrapTextWithAnsi(text.slice(0, hit.start) || " ", Math.max(8, width - 8)).length - 1);
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
		let lineOffset = this.condensationCardLines(width).length;
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
		const focusId = this.currentUnit()?.unit.id;
		const snapshot = this.loadSnapshot();
		this.records = this.loadRecords();
		this.revision = snapshot.revision;
		this.canUndo = snapshot.canUndo;
		this.condensations = [...snapshot.condensations ?? []];
		this.projectionAvailable = snapshot.projectionAvailable !== false && !!this.previewContext && !!this.commitContext;
		const focusedIndex = focusId ? this.flatUnits().findIndex(({ unit }) => unit.id === focusId) : -1;
		this.selectedIndex = focusedIndex >= 0 ? focusedIndex : Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
		this.manualScroll = false;
		this.resetSelection();
		this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
		this.matchIndex = -1;
		this.ensureSelectionVisible();
		this.tui.requestRender();
	}
	syncExternalState() {
		const focusId = this.currentUnit()?.unit.id;
		const snapshot = this.loadSnapshot();
		if (snapshot.revision === this.revision) return false;
		this.records = this.loadRecords();
		this.revision = snapshot.revision;
		this.canUndo = snapshot.canUndo;
		this.condensations = [...snapshot.condensations ?? []];
		this.projectionAvailable = snapshot.projectionAvailable !== false && !!this.previewContext && !!this.commitContext;
		const focusedIndex = focusId ? this.flatUnits().findIndex(({ unit }) => unit.id === focusId) : -1;
		this.selectedIndex = focusedIndex >= 0 ? focusedIndex : Math.min(this.selectedIndex, Math.max(0, this.flatUnits().length - 1));
		this.scrollOffset = 0;
		this.manualScroll = false;
		this.resetSelection();
		this.matches = this.query.trim() ? this.searchOccurrencesForPrefs() : [];
		this.matchIndex = -1;
		this.pendingConfirmation = null;
		this.replacementReview = null;
		this.replacementReviewScrollOffset = 0;
		this.condensationGenerationNonce += 1;
		this.condensationAbortController?.abort();
		this.condensationAbortController = null;
		this.condensationSetup = null;
		this.condensationReview = null;
		this.condensationReviewScrollOffset = 0;
		this.notify(this.text.sessionChanged(), "info");
		return true;
	}
	uiState() {
		return {
			checkedUnitIds: [...this.selected],
			query: this.query,
			searchScope: this.searchScope,
			selectedUnitId: this.currentUnit()?.unit.id,
			showOriginal: this.showOriginal
		};
	}
	requestEdit() {
		if (this.isIdle && !this.isIdle()) {
			this.notify(this.text.replacementBusy(), "warning");
			return;
		}
		if (!this.commitReplacement) {
			this.notify(this.text.contextUnavailableAction(), "warning");
			return;
		}
		const selected = this.selectedUnitIds();
		if (selected.length > 1) {
			this.notify("Select exactly one User or Answer unit to edit.", "warning");
			return;
		}
		const item = selected.length === 1 ? this.flatUnits().find(({ unit }) => unit.id === selected[0]) : this.currentUnit();
		if (!item) return;
		if (!item.unit.replacementSupported || item.unit.kind !== "user" && item.unit.kind !== "answer") {
			this.notify(this.text.operationFailed(item.unit.replacementDisabledReason ?? "unsupported-unit-kind"), "warning");
			return;
		}
		const unitKind = item.unit.kind;
		this.done({
			kind: "edit",
			unitId: item.unit.id,
			unitKind,
			title: this.text.editTitle(this.text.unitKind(unitKind)),
			text: item.unit.effectiveText,
			originalText: this.originalText(item.unit),
			baseRevision: this.revision,
			operationId: replacementOperationId(),
			uiState: {
				...this.uiState(),
				selectedUnitId: item.unit.id
			}
		});
	}
	beginCondensation() {
		if (this.isIdle && !this.isIdle()) {
			this.notify(this.text.condensationBusy(), "warning");
			return;
		}
		if (!this.generateCondensation) {
			this.notify(this.text.contextUnavailableAction(), "warning");
			return;
		}
		const selected = this.selectedUnitIds();
		const unitIds = selected.length > 0 ? selected : [this.currentUnit()?.unit.id].filter((id) => !!id);
		const items = this.flatUnits().filter(({ unit }) => unitIds.includes(unit.id));
		if (!unitIds.length || items.length !== unitIds.length) {
			this.notify(this.text.condensationNoSelection(), "warning");
			return;
		}
		const canExpandRelated = unitIds.length === 1 && items[0]?.unit.kind === "answer";
		this.condensationError = null;
		this.condensationSetup = {
			unitIds: [...unitIds],
			baseRevision: this.revision,
			canExpandRelated,
			expandRelated: false,
			uiState: {
				...this.uiState(),
				selectedUnitId: unitIds[0]
			}
		};
		this.condensationReview = null;
		this.condensationReviewScrollOffset = 0;
		this.tui.requestRender();
	}
	condensationSetupLines(width) {
		const setup = this.condensationSetup;
		if (!setup) return [];
		const wrap = (value) => wrapTextWithAnsi(value, Math.max(8, width - 4)).map((line) => this.theme.fg("dim", "  " + line));
		if (this.operationInFlight) return [
			this.theme.fg("warning", "[AI] " + this.text.condensationGenerating()),
			...wrap(this.text.condensationSetup(setup.unitIds.length, setup.canExpandRelated, setup.expandRelated)),
			this.theme.fg("accent", this.text.condensationCancelHint())
		];
		return [
			this.theme.fg("warning", "[AI] " + this.text.condensationSetupTitle()),
			...wrap(this.text.condensationSetup(setup.unitIds.length, setup.canExpandRelated, setup.expandRelated)),
			...setup.canExpandRelated ? [this.theme.fg("accent", this.text.condensationExpandRelated(setup.expandRelated))] : [this.theme.fg("dim", this.text.condensationExpandDisabled())],
			...this.condensationError ? wrap(this.condensationError) : [],
			this.theme.fg("accent", this.text.condensationSetupHint())
		];
	}
	async startCondensationGeneration() {
		const setup = this.condensationSetup;
		if (!setup || !this.generateCondensation || this.operationInFlight) return;
		this.operationInFlight = true;
		this.condensationError = null;
		const controller = new AbortController();
		const nonce = ++this.condensationGenerationNonce;
		this.condensationAbortController = controller;
		this.tui.requestRender();
		try {
			const preview = await this.generateCondensation({
				baseRevision: setup.baseRevision,
				unitIds: setup.unitIds,
				expandRelated: setup.expandRelated,
				signal: controller.signal
			});
			if (nonce !== this.condensationGenerationNonce || controller.signal.aborted) return;
			this.condensationReview = {
				draft: {
					unitIds: [...setup.unitIds],
					baseRevision: setup.baseRevision,
					operationId: preview.operationId,
					expandRelated: setup.expandRelated,
					uiState: setup.uiState
				},
				preview
			};
			this.condensationSetup = null;
			this.condensationReviewScrollOffset = 0;
		} catch (error) {
			if (nonce !== this.condensationGenerationNonce) return;
			const message = error instanceof Error ? error.message : String(error);
			if (!controller.signal.aborted) {
				this.condensationError = this.text.condensationGenerationFailed(message);
				this.notify(this.condensationError, "warning");
			}
			this.condensationReview = null;
		} finally {
			if (nonce === this.condensationGenerationNonce) {
				this.condensationAbortController = null;
				this.operationInFlight = false;
				this.tui.requestRender();
			}
		}
	}
	cancelCondensationGeneration() {
		this.condensationGenerationNonce += 1;
		this.condensationAbortController?.abort();
		this.condensationAbortController = null;
		this.operationInFlight = false;
		this.condensationSetup = null;
		this.tui.requestRender();
	}
	condensationReviewLines(width) {
		const review = this.condensationReview;
		if (!review) return [];
		const preview = review.preview;
		const wrap = (value) => wrapTextWithAnsi(value, Math.max(8, width - 4)).map((line) => this.theme.fg("dim", "  " + line));
		const metrics = preview.metrics;
		const lines = [this.theme.fg("warning", "[AI] " + this.text.condensationReviewTitle())];
		lines.push(...wrap(this.text.condensationSource(preview.effectiveUnitIds.length, (preview.sourceEntryIds ?? []).length)));
		lines.push(...wrap(this.text.condensationModel(preview.provider, preview.model)));
		lines.push(...wrap(this.text.condensationMetrics(metrics.beforeTokens, metrics.afterTokens, metrics.savedTokens, metrics.savingsRatio)));
		if (preview.risks.length) lines.push(...wrap(this.text.condensationRisks(preview.risks)));
		if (preview.warnings?.length) lines.push(...wrap(this.text.condensationWarnings(preview.warnings)));
		lines.push(this.theme.fg("accent", this.text.condensationSummaryTitle()));
		lines.push(...wrap(preview.summary));
		lines.push(this.theme.fg("accent", this.text.condensationReviewHint()));
		return lines;
	}
	scrollCondensationReview(delta) {
		const lines = this.condensationReviewLines(Math.max(24, this.tui.terminal.columns));
		const maxOffset = Math.max(0, lines.length - this.availableRows());
		this.condensationReviewScrollOffset = Math.max(0, Math.min(maxOffset, this.condensationReviewScrollOffset + delta));
		this.tui.requestRender();
	}
	async regenerateCondensation() {
		const review = this.condensationReview;
		if (!review || !this.cancelCondensation || this.operationInFlight) return;
		try {
			await this.cancelCondensation(review.draft.operationId);
		} catch {}
		this.condensationReview = null;
		this.condensationSetup = {
			unitIds: [...review.draft.unitIds],
			baseRevision: review.draft.baseRevision,
			canExpandRelated: review.draft.unitIds.length === 1 && this.flatUnits().find(({ unit }) => unit.id === review.draft.unitIds[0])?.unit.kind === "answer",
			expandRelated: review.draft.expandRelated,
			uiState: review.draft.uiState
		};
		this.startCondensationGeneration();
	}
	handleCondensationSetupInput(data) {
		const setup = this.condensationSetup;
		if (!setup) return;
		if (this.operationInFlight) {
			if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") this.cancelCondensationGeneration();
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") {
			this.condensationSetup = null;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "space") && setup.canExpandRelated) {
			setup.expandRelated = !setup.expandRelated;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, "enter")) this.startCondensationGeneration();
	}
	handleCondensationReviewInput(data) {
		const review = this.condensationReview;
		if (!review) return;
		if (this.operationInFlight) return;
		if (matchesKey(data, "pageDown") || matchesKey(data, "down") || data === "j") {
			this.scrollCondensationReview(matchesKey(data, "pageDown") ? this.availableRows() : 1);
			return;
		}
		if (matchesKey(data, "pageUp") || matchesKey(data, "up") || data === "k") {
			this.scrollCondensationReview(matchesKey(data, "pageUp") ? -this.availableRows() : -1);
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") {
			this.condensationReview = null;
			this.done({
				kind: "condensation-cancel",
				operationId: review.draft.operationId,
				uiState: review.draft.uiState
			});
			return;
		}
		if (data === "e") {
			this.condensationReview = null;
			this.done({
				kind: "condensation-edit",
				review,
				uiState: review.draft.uiState
			});
			return;
		}
		if (data === "r") {
			this.regenerateCondensation();
			return;
		}
		if (matchesKey(data, "enter")) {
			if (review.preview.validation && !review.preview.validation.ok) {
				this.notify(this.text.condensationBlocked(review.preview.validation.error ?? "invalid-summary"), "warning");
				return;
			}
			this.condensationReview = null;
			this.done({
				kind: "condensation-commit",
				review,
				uiState: review.draft.uiState
			});
		}
	}
	replacementReviewLines(width) {
		const review = this.replacementReview;
		if (!review) return [];
		const preview = review.preview;
		const wrap = (value) => wrapTextWithAnsi(value, Math.max(8, width - 4)).map((line) => this.theme.fg("dim", `  ${line}`));
		const lines = [this.theme.fg("warning", `⚠ ${this.text.replacementReviewTitle()}`)];
		lines.push(...wrap(this.text.replacementReviewAnswer(preview.textChanged)));
		if (preview.associatedReasoningUnitIds.length > 0) {
			lines.push(...wrap(this.text.replacementReviewLink(review.excludeAssociatedReasoning, preview.associatedReasoningUnitIds.length)));
			lines.push(...wrap(this.text.replacementReviewScope("associated", preview.associatedReasoningUnitIds)));
		}
		lines.push(...wrap(this.text.replacementReviewScope("newlyExcluded", preview.newlyExcludedUnitIds)));
		lines.push(...wrap(this.text.replacementReviewScope("alreadyExcluded", preview.alreadyExcludedUnitIds)));
		if (preview.autoExpandedUnitIds.length > 0) {
			lines.push(...wrap(this.text.replacementReviewScope("autoExpanded", preview.autoExpandedUnitIds)));
			if (preview.requiresConfirmation) lines.push(...wrap(this.text.replacementReviewConfirmationRequired(preview.autoExpandedUnitIds.length)));
		}
		if (!preview.canCommit) lines.push(...wrap(this.text.replacementReviewBlocked(preview.disabledReason ?? "unavailable")));
		if (!preview.textChanged && preview.newlyExcludedAtomIds.length === 0) lines.push(...wrap(this.text.replacementReviewNoop()));
		lines.push(this.theme.fg("accent", this.text.replacementReviewHint()));
		return lines;
	}
	scrollReplacementReview(delta) {
		const lines = this.replacementReviewLines(Math.max(24, this.tui.terminal.columns));
		const maxOffset = Math.max(0, lines.length - this.availableRows());
		this.replacementReviewScrollOffset = Math.max(0, Math.min(maxOffset, this.replacementReviewScrollOffset + delta));
		this.tui.requestRender();
	}
	async toggleReplacementReviewLink() {
		const review = this.replacementReview;
		if (!review || !this.previewReplacement || review.preview.associatedReasoningUnitIds.length === 0) return;
		const enabled = !review.excludeAssociatedReasoning;
		this.operationInFlight = true;
		this.tui.requestRender();
		try {
			const preview = await this.previewReplacement({
				baseRevision: review.draft.baseRevision,
				operationId: review.draft.operationId,
				unitId: review.draft.unitId,
				text: review.draft.text,
				excludeAssociatedReasoning: enabled
			});
			if (!preview.canCommit && preview.disabledReason === "revision-conflict") {
				this.replacementReview = null;
				this.replacementReviewScrollOffset = 0;
				this.notify(this.text.sidecarChanged(), "warning");
				this.done({
					kind: "cancel-edit",
					uiState: review.draft.uiState
				});
				return;
			}
			this.replacementReview = {
				...review,
				preview,
				excludeAssociatedReasoning: enabled
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.notify(message === "CONTEXT_EDITOR_CONFLICT" ? this.text.sidecarChanged() : this.text.operationFailed(message), "warning");
		} finally {
			this.operationInFlight = false;
			this.tui.requestRender();
		}
	}
	handleReplacementReviewInput(data) {
		const review = this.replacementReview;
		if (!review) return;
		if (matchesKey(data, "pageDown") || matchesKey(data, "down") || data === "j") {
			this.scrollReplacementReview(matchesKey(data, "pageDown") ? this.availableRows() : 1);
			return;
		}
		if (matchesKey(data, "pageUp") || matchesKey(data, "up") || data === "k") {
			this.scrollReplacementReview(matchesKey(data, "pageUp") ? -this.availableRows() : -1);
			return;
		}
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q" || data === "Q") {
			this.replacementReview = null;
			this.done({
				kind: "cancel-edit",
				uiState: review.draft.uiState
			});
			return;
		}
		if (data === "e") {
			this.replacementReview = null;
			this.done({
				kind: "edit",
				...review.draft,
				excludeAssociatedReasoning: review.excludeAssociatedReasoning
			});
			return;
		}
		if (matchesKey(data, "space")) {
			this.toggleReplacementReviewLink();
			return;
		}
		if (matchesKey(data, "enter")) {
			if (!review.preview.canCommit) {
				this.notify(this.text.replacementReviewBlocked(review.preview.disabledReason ?? "unavailable"), "warning");
				return;
			}
			this.replacementReview = null;
			this.done({
				kind: "replacement-commit",
				review,
				uiState: review.draft.uiState
			});
		}
	}
	beginRestoreReplacement() {
		if (this.isIdle && !this.isIdle()) {
			this.notify(this.text.replacementBusy(), "warning");
			return;
		}
		if (this.operationInFlight || this.pendingConfirmation || !this.restoreReplacement) return;
		const selected = this.selectedUnitIds();
		if (selected.length > 1) {
			this.notify("Select exactly one User or Answer unit to restore.", "warning");
			return;
		}
		const item = selected.length === 1 ? this.flatUnits().find(({ unit }) => unit.id === selected[0]) : this.currentUnit();
		if (!item || !item.unit.canRestoreReplacement) return;
		this.pendingConfirmation = {
			kind: "replacement-restore",
			unitId: item.unit.id,
			message: this.text.replacementRestoreMessage()
		};
		this.tui.requestRender();
	}
	async commitPendingReplacementRestore(pending) {
		if (this.operationInFlight || !this.restoreReplacement) return;
		this.operationInFlight = true;
		try {
			const result = await this.restoreReplacement({
				baseRevision: this.revision,
				operationId: replacementOperationId(),
				unitId: pending.unitId
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
		} finally {
			this.operationInFlight = false;
			this.tui.requestRender();
		}
	}
	async undoCurrentReplacement() {
		if (this.isIdle && !this.isIdle()) {
			this.notify(this.text.replacementBusy(), "warning");
			return;
		}
		if (this.operationInFlight || !this.undoReplacement) return;
		const selected = this.selectedUnitIds();
		if (selected.length > 1) {
			this.notify("Select exactly one User or Answer unit to undo.", "warning");
			return;
		}
		const item = selected.length === 1 ? this.flatUnits().find(({ unit }) => unit.id === selected[0]) : this.currentUnit();
		if (!item || !item.unit.canUndoReplacement) return;
		this.operationInFlight = true;
		try {
			const result = await this.undoReplacement({
				baseRevision: this.revision,
				operationId: replacementOperationId(),
				unitId: item.unit.id
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
		} finally {
			this.operationInFlight = false;
			this.tui.requestRender();
		}
	}
	condensationCardLines(width) {
		if (this.condensations.length === 0) return [];
		const wrap = (value) => wrapTextWithAnsi(value, Math.max(8, width - 4)).map((line) => this.theme.fg("dim", "  " + line));
		const lines = [];
		for (const [cardIndex, condensation] of this.condensations.entries()) {
			const state = condensation.contextExcluded ? this.text.condensationCardExcluded() : this.text.condensationCardActive();
			lines.push(this.theme.fg("accent", this.text.condensationCardTitle(condensation.operationId, state)));
			lines.push(...wrap(this.condensationCardExpanded ? condensation.summary : condensation.summary.split(/\r?\n/)[0].slice(0, 100)));
			lines.push(...wrap(this.text.condensationSourceList(cardIndex + 1, condensation.sourceUnits.length)));
			lines.push(...wrap(this.text.condensationCardMetrics(condensation.metrics.savedTokens, condensation.metrics.savingsRatio)));
			if (condensation.coverage) {
				lines.push(...wrap(this.text.condensationCoverage(condensation.coverage.status, condensation.coverage.restoreMode)));
				if (condensation.coverage.status !== "none" || condensation.coverage.restoreMode === "unavailable") lines.push(...wrap(this.text.condensationRestoreRequired(condensation.coverage.restoreMode, condensation.coverage.checkpointEntryId)));
			}
			const allUnits = this.records.flatMap((record) => record.units);
			for (const source of condensation.sourceUnits) {
				const title = "#" + (allUnits.findIndex((unit) => unit.id === source.id) + 1 || "?") + " " + this.text.unitKind(source.kind) + " · " + source.id;
				lines.push(...wrap(title));
				const content = source.text || this.text.contextState("exclude");
				lines.push(...wrap(this.condensationCardExpanded ? content : content.replace(/\s+/g, " ").slice(0, 100)));
			}
		}
		return lines;
	}
	async toggleCondensationSurface() {
		const condensation = this.condensations[0];
		if (!condensation || this.operationInFlight || !this.previewContext || !this.commitContext) return;
		this.operationInFlight = true;
		const action = condensation.contextExcluded ? "restore" : "exclude";
		try {
			const preview = await this.previewContext({
				baseRevision: this.revision,
				action,
				condensationOperationId: condensation.operationId
			});
			const result = await this.commitContext({
				baseRevision: preview.baseRevision,
				action,
				condensationOperationId: condensation.operationId
			});
			if (!result.ok || result.conflict) {
				if (result.restoreRequired) this.notify(this.text.condensationRestoreRequired(result.restoreMode ?? "unavailable", result.checkpointEntryId), "warning");
				else this.notify(this.text.sidecarChanged(), "warning");
				this.refreshData();
			} else this.refreshData();
		} catch (error) {
			this.notify(this.text.operationFailed(error instanceof Error ? error.message : String(error)), "warning");
		} finally {
			this.operationInFlight = false;
			this.tui.requestRender();
		}
	}
	async restoreActiveCondensation() {
		const condensation = this.condensations[0];
		if (!condensation || this.operationInFlight || !this.restoreCondensation) return;
		if (this.isIdle && !this.isIdle()) {
			this.notify(this.text.condensationBusy(), "warning");
			return;
		}
		this.operationInFlight = true;
		try {
			const result = await this.restoreCondensation({
				baseRevision: this.revision,
				operationId: condensation.operationId
			});
			if (!result.ok || result.conflict) {
				if (result.restoreRequired) this.notify(this.text.condensationRestoreRequired(result.restoreMode ?? "unavailable", result.checkpointEntryId), "warning");
				else this.notify(this.text.sidecarChanged(), "warning");
				this.refreshData();
			} else {
				this.refreshData();
				this.notify(this.text.condensationRestored(), "info");
			}
		} catch (error) {
			this.notify(this.text.operationFailed(error instanceof Error ? error.message : String(error)), "warning");
		} finally {
			this.operationInFlight = false;
			this.tui.requestRender();
		}
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
				if (result.restoreRequired) this.notify(this.text.condensationRestoreRequired(result.restoreMode ?? "unavailable", result.checkpointEntryId), "warning");
				else this.notify(this.text.sidecarChanged(), "warning");
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
		if (pending.kind === "replacement-restore") {
			this.commitPendingReplacementRestore(pending);
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
				if (result.restoreRequired) this.notify(this.text.condensationRestoreRequired(result.restoreMode ?? "unavailable", result.checkpointEntryId), "warning");
				else this.notify(this.text.sidecarChanged(), "warning");
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
		} else if (!extend) this.rangeAnchor = null;
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
		const title = pending.kind === "projection" ? this.text.contextConfirmTitle() : pending.kind === "reset" ? this.text.restoreAllConfirmTitle() : this.text.replacementRestoreTitle();
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
		if (this.condensationSetup) {
			this.handleCondensationSetupInput(data);
			return;
		}
		if (this.condensationReview) {
			this.handleCondensationReviewInput(data);
			return;
		}
		if (this.replacementReview) {
			if (this.operationInFlight) return;
			this.handleReplacementReviewInput(data);
			return;
		}
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
			this.done({ kind: "close" });
			return;
		}
		if (data === "q" || data === "Q") {
			this.done({ kind: "close" });
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
		if (data === "c") {
			this.beginCondensation();
			return;
		}
		if (data === "C") {
			this.toggleCondensationSurface();
			return;
		}
		if (data === "D") {
			this.restoreActiveCondensation();
			return;
		}
		if (data === "O") {
			this.condensationCardExpanded = !this.condensationCardExpanded;
			this.scrollOffset = 0;
			this.manualScroll = true;
			this.tui.requestRender();
			return;
		}
		if (data === "e") {
			this.requestEdit();
			return;
		}
		if (data === "E") {
			this.beginRestoreReplacement();
			return;
		}
		if (data === "z") {
			this.undoCurrentReplacement();
			return;
		}
		if (data === "o") {
			this.showOriginal = !this.showOriginal;
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
		if (this.condensationReview) {
			const reviewLines = this.condensationReviewLines(safeWidth);
			const maxOffset = Math.max(0, reviewLines.length - viewport);
			this.condensationReviewScrollOffset = Math.max(0, Math.min(this.condensationReviewScrollOffset, maxOffset));
			visible = reviewLines.slice(this.condensationReviewScrollOffset, this.condensationReviewScrollOffset + viewport);
		} else if (this.condensationSetup) visible = this.condensationSetupLines(safeWidth).slice(0, viewport);
		else if (this.replacementReview) {
			const reviewLines = this.replacementReviewLines(safeWidth);
			const maxOffset = Math.max(0, reviewLines.length - viewport);
			this.replacementReviewScrollOffset = Math.max(0, Math.min(this.replacementReviewScrollOffset, maxOffset));
			visible = reviewLines.slice(this.replacementReviewScrollOffset, this.replacementReviewScrollOffset + viewport);
		} else if (this.pendingConfirmation) visible = this.confirmationLines(safeWidth).slice(0, viewport);
		else if (this.helpMode) visible = this.helpLines().slice(0, viewport);
		else {
			const layoutChanged = this.lastRenderWidth !== safeWidth || this.lastRenderRows !== this.tui.terminal.rows;
			if (this.matchIndex >= 0 && layoutChanged) this.positionSearchHit(safeWidth);
			if (!this.manualScroll) this.ensureSelectionVisible(safeWidth);
			const totalLines = this.totalLineCount(safeWidth);
			const maxOffset = Math.max(0, totalLines - viewport);
			this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
			const card = this.condensationCardLines(safeWidth);
			const end = this.scrollOffset + viewport;
			visible = [...card.slice(this.scrollOffset, end), ...this.renderWindow(safeWidth, this.scrollOffset, end)];
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
		const mode = this.condensationReview || this.condensationSetup ? this.theme.fg("warning", this.text.contextAwaiting()) : this.replacementReview ? this.theme.fg("warning", this.text.contextAwaiting()) : this.pendingConfirmation ? this.theme.fg("warning", this.text.contextAwaiting()) : this.helpMode ? this.theme.fg("dim", "") : this.searchMode ? this.theme.fg("warning", this.text.tuiSearch(this.query, this.matches.length, this.matchIndex, this.searchScope)) : this.theme.fg("dim", this.text.tuiSearchIdle(this.query, this.matches.length, this.matchIndex, this.searchScope));
		const filterLine = this.helpMode || this.pendingConfirmation || this.replacementReview || this.condensationSetup || this.condensationReview ? "" : `${enabled("user")} [1]  ${aiLabel} [2] (${enabled("reasoning")} [4]  ${enabled("answer")} [5])  ${enabled("tool")} [3]`;
		const statusMode = this.helpMode ? "help" : this.searchMode ? "search" : this.matches.length > 0 ? "results" : "normal";
		const status = this.condensationReview ? this.theme.fg("dim", this.text.condensationReviewHint()) : this.condensationSetup ? this.theme.fg("dim", this.operationInFlight ? this.text.condensationCancelHint() : this.text.condensationSetupHint()) : this.replacementReview ? this.theme.fg("dim", this.text.replacementReviewHint()) : this.pendingConfirmation ? this.theme.fg("dim", this.text.contextConfirmHint()) : this.theme.fg("dim", this.text.tuiStatus(statusMode, this.searchScope));
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
function defaultDocument$2(sessionId) {
	return {
		schemaVersion: 1,
		sessionId,
		events: []
	};
}
function isProjectionChange(value) {
	if (!value || typeof value !== "object") return false;
	const change = value;
	const sourceRef = change.sourceRef;
	if (!sourceRef || typeof sourceRef !== "object") return false;
	const ref = sourceRef;
	return typeof change.atomId === "string" && change.atomId.length > 0 && typeof change.fingerprint === "string" && change.fingerprint.length > 0 && typeof ref.entryId === "string" && ref.entryId.length > 0 && typeof ref.blockIndex === "number" && Number.isInteger(ref.blockIndex) && ref.blockIndex >= 0 && (change.before === "include" || change.before === "exclude") && (change.after === "include" || change.after === "exclude") && change.before !== change.after;
}
function isLinkedExclusion(value, eventId) {
	if (!value || typeof value !== "object") return false;
	const linked = value;
	if (linked.operationId !== eventId || !Array.isArray(linked.unitIds) || !Array.isArray(linked.atomChanges)) return false;
	if (!linked.unitIds.every((id) => typeof id === "string" && id.length > 0) || new Set(linked.unitIds).size !== linked.unitIds.length) return false;
	const atomIds = /* @__PURE__ */ new Set();
	for (const change of linked.atomChanges) {
		if (!isProjectionChange(change) || atomIds.has(change.atomId)) return false;
		atomIds.add(change.atomId);
	}
	return true;
}
function isCondensationEvent$1(value) {
	if (!value || typeof value !== "object") return false;
	const row = value;
	if (row.type !== "condensation" || row.schemaVersion !== 1) return false;
	if (![
		"apply",
		"restore",
		"exclude-summary",
		"restore-summary"
	].includes(String(row.action))) return false;
	if (typeof row.eventId !== "string" || !row.eventId || typeof row.operationId !== "string" || !row.operationId || typeof row.sessionId !== "string" || !row.sessionId || typeof row.baseRevision !== "string" && typeof row.baseRevision !== "number" || typeof row.summary !== "string" || typeof row.provider !== "string" || typeof row.model !== "string" || typeof row.createdAt !== "string") return false;
	if (row.sourceFingerprint !== void 0 && typeof row.sourceFingerprint !== "string") return false;
	if (!Array.isArray(row.requestedUnitIds) || !row.requestedUnitIds.every((id) => typeof id === "string")) return false;
	if (!Array.isArray(row.effectiveUnitIds) || !row.effectiveUnitIds.every((id) => typeof id === "string")) return false;
	if (!Array.isArray(row.sourceEntryIds) || !row.sourceEntryIds.every((id) => typeof id === "string" && id.length > 0)) return false;
	if (!Array.isArray(row.sourceRootSeqs) || !row.sourceRootSeqs.every((id) => Number.isSafeInteger(id))) return false;
	if (!Array.isArray(row.sourceUnits) || !row.sourceUnits.every((unit) => {
		if (!unit || typeof unit !== "object") return false;
		const item = unit;
		return typeof item.id === "string" && typeof item.recordId === "string" && typeof item.kind === "string" && Array.isArray(item.atomIds) && item.atomIds.every((id) => typeof id === "string") && Array.isArray(item.sourceRootSeqs) && item.sourceRootSeqs.every((id) => Number.isSafeInteger(id)) && (item.sourceEntryIds === void 0 || Array.isArray(item.sourceEntryIds) && item.sourceEntryIds.every((id) => typeof id === "string")) && typeof item.text === "string" && typeof item.included === "boolean" && Number.isFinite(Number(item.approxTokens));
	})) return false;
	const metrics = row.metrics;
	if (!metrics || typeof metrics !== "object") return false;
	if (!Array.isArray(row.beforeMessages) || !row.beforeMessages.every((item) => item && typeof item === "object" && typeof item.entryId === "string" && "message" in item)) return false;
	if (!Array.isArray(row.afterMessages) || !row.afterMessages.every((item) => item && typeof item === "object" && typeof item.entryId === "string" && "message" in item)) return false;
	return true;
}
function isProjectionEvent(value) {
	if (!value || typeof value !== "object") return false;
	const row = value;
	if (row.type === "condensation") return isCondensationEvent$1(value);
	if ("type" in row && row.type !== "replacement") return false;
	if (row.type === "replacement") {
		if (row.schemaVersion !== 1 || typeof row.eventId !== "string" || row.eventId.length === 0 || typeof row.unitId !== "string" || row.unitId.length === 0 || typeof row.createdAt !== "string" || typeof row.baseRevision !== "string" && typeof row.baseRevision !== "number") return false;
		if (row.action === "undo") {
			if (typeof row.undoOf !== "string" || row.undoOf.length === 0) return false;
			if (row.linkedExclusion !== void 0 && !isLinkedExclusion(row.linkedExclusion, row.eventId)) return false;
			return true;
		}
		if (row.action !== "replace" && row.action !== "restore") return false;
		if (row.unitKind !== "user" && row.unitKind !== "answer") return false;
		if (!Array.isArray(row.atomRefs) || row.atomRefs.length === 0) return false;
		if (typeof row.beforeText !== "string" && row.beforeText !== null || typeof row.afterText !== "string" && row.afterText !== null) return false;
		if (row.action === "replace" && (typeof row.afterText !== "string" || row.afterText.trim().length === 0)) return false;
		if (row.action === "restore" && (row.afterText !== null || typeof row.beforeText !== "string")) return false;
		if (row.linkedExclusion !== void 0 && !isLinkedExclusion(row.linkedExclusion, row.eventId)) return false;
		const atomIds = /* @__PURE__ */ new Set();
		return row.atomRefs.every((candidate) => {
			if (!candidate || typeof candidate !== "object") return false;
			const ref = candidate;
			const sourceRef = ref.sourceRef;
			if (typeof ref.atomId !== "string" || atomIds.has(ref.atomId)) return false;
			atomIds.add(ref.atomId);
			const source = sourceRef;
			return typeof ref.atomId === "string" && ref.atomId.length > 0 && typeof ref.fingerprint === "string" && ref.fingerprint.length > 0 && !!sourceRef && typeof sourceRef === "object" && typeof source?.entryId === "string" && typeof source.blockIndex === "number" && Number.isInteger(source.blockIndex) && source.blockIndex >= 0;
		});
	}
	if (row.version !== 1 || typeof row.transactionId !== "string" || typeof row.createdAt !== "string" || typeof row.baseRevision !== "string" || row.action !== "exclude" && row.action !== "restore" || !Array.isArray(row.changes) || row.changes.length === 0) return false;
	return row.changes.every((candidate) => isProjectionChange(candidate));
}
function parseDocument$2(raw, sessionId) {
	if (!raw || typeof raw !== "object") return {
		document: defaultDocument$2(sessionId),
		error: "projection sidecar JSON is malformed"
	};
	const row = raw;
	if (row.schemaVersion !== 1) return {
		document: defaultDocument$2(sessionId),
		error: "projection sidecar schema version is unsupported"
	};
	if (row.sessionId !== sessionId) return {
		document: defaultDocument$2(sessionId),
		error: "projection sidecar Session id does not match"
	};
	if (!Array.isArray(row.events)) return {
		document: defaultDocument$2(sessionId),
		error: "projection sidecar events are malformed"
	};
	const events = [];
	for (const candidate of row.events) {
		if (!candidate || typeof candidate !== "object") return {
			document: defaultDocument$2(sessionId),
			error: "projection sidecar envelope is malformed"
		};
		const envelope = candidate;
		if (typeof envelope.anchorEntryId !== "string" || !isProjectionEvent(envelope.event)) return {
			document: defaultDocument$2(sessionId),
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
function revisionOf$2(path, raw, document, integrity) {
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
		const document = defaultDocument$2(sessionId);
		return {
			path,
			document,
			revision: revisionOf$2(path, void 0, document, "missing"),
			projectionRevision: projectionRevisionOf(document),
			integrity: "missing"
		};
	}
	let rawText;
	try {
		rawText = readFileSync(path, "utf8");
	} catch {
		const document = defaultDocument$2(sessionId);
		return {
			path,
			document,
			revision: revisionOf$2(path, void 0, document, "invalid"),
			projectionRevision: projectionRevisionOf(document),
			integrity: "invalid",
			error: "projection sidecar could not be read"
		};
	}
	let raw;
	try {
		raw = JSON.parse(rawText);
	} catch {
		const document = defaultDocument$2(sessionId);
		return {
			path,
			document,
			revision: revisionOf$2(path, rawText, document, "invalid"),
			projectionRevision: projectionRevisionOf(document),
			integrity: "invalid",
			error: "projection sidecar JSON is malformed"
		};
	}
	const parsed = parseDocument$2(raw, sessionId);
	if (parsed.error) return {
		path,
		document: parsed.document,
		revision: revisionOf$2(path, rawText, parsed.document, "invalid"),
		projectionRevision: projectionRevisionOf(parsed.document),
		integrity: "invalid",
		error: parsed.error
	};
	return {
		path,
		document: parsed.document,
		revision: revisionOf$2(path, rawText, parsed.document, "ok"),
		projectionRevision: projectionRevisionOf(parsed.document),
		integrity: "ok"
	};
}
function withLock$2(path, fn) {
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
function writeDocument$2(path, document) {
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
	return withLock$2(path, () => {
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
		writeDocument$2(path, next);
		return "type" in event ? event.eventId : event.transactionId;
	});
}
function defaultDocument$1(sessionId) {
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
function parseDocument$1(raw, sessionId) {
	if (!raw || typeof raw !== "object") return defaultDocument$1(sessionId);
	const row = raw;
	if (row.schemaVersion !== 1 || typeof row.sessionId === "string" && row.sessionId !== sessionId) return defaultDocument$1(sessionId);
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
function revisionOf$1(path, document) {
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
	const document = parseDocument$1(raw, sessionId);
	return {
		path,
		document,
		revision: revisionOf$1(path, document),
		viewRevision: viewRevisionOf(document)
	};
}
function withLock$1(path, fn) {
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
function writeDocument$1(path, document) {
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
	return withLock$1(path, () => {
		const current = readSidecar(sessionFile, sessionId);
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
function writeSidecarPrefs(sessionFile, sessionId, prefs) {
	const path = sidecarPath(sessionFile);
	return withLock$1(path, () => {
		const next = {
			...readSidecar(sessionFile, sessionId).document,
			prefs: normalizeContextEditorPrefs(prefs)
		};
		writeDocument$1(path, next);
		return readSidecar(sessionFile, sessionId);
	});
}
//#endregion
//#region adapters/pi-extension/src/condensation-host.ts
function sourceEntryIds(range) {
	return Array.from(new Set([...range.sourceEntryIds ?? [], ...range.sourceUnits.flatMap((unit) => unit.sourceEntryIds ?? [])].filter(Boolean)));
}
function stableRangeFingerprint(range) {
	return range.sourceFingerprint || stableFingerprint([...sourceEntryIds(range), ...range.sourceUnits.flatMap((unit) => [
		unit.id,
		unit.text,
		unit.included ? "include" : "exclude"
	])]);
}
function selectedBlockIndices(range, atoms) {
	const selected = new Set(range.sourceUnits.flatMap((unit) => unit.atomIds));
	const result = /* @__PURE__ */ new Map();
	for (const atom of atoms) {
		if (!selected.has(atom.id)) continue;
		const set = result.get(atom.sourceRef.entryId) ?? /* @__PURE__ */ new Set();
		set.add(atom.sourceRef.blockIndex);
		result.set(atom.sourceRef.entryId, set);
	}
	return result;
}
function cloneMessage(message, content) {
	return {
		...message,
		content
	};
}
function contentOf(message) {
	return message.content;
}
function condensationInput(range) {
	return range.sourceUnits.filter((source) => source.included && source.text.trim()).map((source) => {
		return [
			"[" + source.kind + "] " + source.id,
			source.toolNames?.length ? "tools=" + source.toolNames.join(",") : "",
			source.isError ? "status=error" : "",
			source.hasSignature ? "signed-or-opaque-block=true" : ""
		].filter(Boolean).join(" ") + "\n" + source.text;
	}).join("\n\n");
}
function condensationInstruction(range) {
	const originalTokens = range.sourceUnits.filter((source) => source.included).reduce((sum, source) => sum + source.approxTokens, 0);
	const targetTokens = Math.max(1, Math.floor(originalTokens * .5));
	return [
		"Only condense the selected context below. Return summary text only; do not add a preamble or markdown fence.",
		"Write the summary in the same natural language as the selected conversation. If the conversation is Chinese, write in Chinese. Keep identifiers, paths and commands verbatim.",
		"Merge repeated facts and remove filler. Preserve the user goal, constraints, conclusions, evidence, unfinished work, file paths, commands, parameters, results, errors, modifications and artifact locations.",
		"Keep reasoning and tool facts needed to continue safely. Do not invent facts or silently drop essential information.",
		"Aim to reduce the selected content by at least 40%, preferably around 50–70%. Approximate original size: " + originalTokens + " tokens; aim for about " + targetTokens + " tokens.",
		"<selected-context>",
		condensationInput(range),
		"</selected-context>"
	].join("\n");
}
function entryMessages(entries) {
	const result = /* @__PURE__ */ new Map();
	for (const raw of entries) {
		const id = String(raw.id ?? "");
		if (!id) continue;
		const message = sessionEntryToContextMessages(raw)[0];
		if (message) result.set(id, message);
	}
	return result;
}
function buildPiCondensationMessages(entries, atoms, range, summary, excludedAtomIds = /* @__PURE__ */ new Set()) {
	const byEntry = entryMessages(entries);
	const entryIds = sourceEntryIds(range);
	const selected = selectedBlockIndices(range, atoms);
	const atomIdsByBlock = /* @__PURE__ */ new Map();
	for (const atom of atoms) {
		const key = atom.sourceRef.entryId + ":" + atom.sourceRef.blockIndex;
		const set = atomIdsByBlock.get(key) ?? /* @__PURE__ */ new Set();
		set.add(atom.id);
		atomIdsByBlock.set(key, set);
	}
	const first = entryIds.find((id) => selected.has(id)) ?? entryIds[0];
	const summaryBlock = {
		type: "text",
		text: frameCondensationSummary(summary)
	};
	const beforeMessages = [];
	const afterMessages = [];
	let inserted = false;
	for (const entryId of entryIds) {
		const original = byEntry.get(entryId);
		if (!original) continue;
		const blocks = selected.get(entryId) ?? /* @__PURE__ */ new Set();
		const originalContent = contentOf(original);
		const effectiveContent = Array.isArray(originalContent) ? originalContent.filter((_block, index) => {
			if (blocks.has(index)) return true;
			return ![...atomIdsByBlock.get(entryId + ":" + index) ?? /* @__PURE__ */ new Set()].some((atomId) => excludedAtomIds.has(atomId));
		}) : originalContent;
		const effective = Array.isArray(originalContent) ? cloneMessage(original, effectiveContent) : original;
		const before = structuredClone(effective);
		beforeMessages.push({
			entryId,
			message: before
		});
		const role = String(effective.role ?? "");
		const content = contentOf(effective);
		let next = structuredClone(effective);
		if (Array.isArray(effectiveContent) && effectiveContent.length === 0 && blocks.size === 0) next = null;
		if (role === "user") {
			if (blocks.size > 0) {
				next = entryId === first && !inserted ? cloneMessage(effective, [summaryBlock]) : null;
				inserted ||= entryId === first;
			}
		} else if (role === "assistant" && Array.isArray(content)) {
			const output = [];
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
		} else if (blocks.size > 0) next = null;
		afterMessages.push({
			entryId,
			message: next
		});
	}
	if (!inserted && first) {
		const original = byEntry.get(first);
		if (original) {
			const item = afterMessages.find((candidate) => candidate.entryId === first);
			if (item) item.message = cloneMessage(original, [summaryBlock]);
		}
	}
	return {
		beforeMessages,
		afterMessages
	};
}
function buildPiCondensationEvent(input, atoms) {
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
			belowRecommendedThreshold: false
		},
		prefixTokens: input.prefixTokens ?? 0,
		...input.prefixReused === void 0 ? {} : { prefixReused: input.prefixReused },
		summaryTokens: estimateCondensationTokens(frameCondensationSummary(input.summary)),
		createdAt: input.createdAt ?? (/* @__PURE__ */ new Date()).toISOString(),
		beforeMessages: messages.beforeMessages,
		afterMessages: messages.afterMessages
	};
}
function activePiCondensationEvents(events) {
	const result = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (!("type" in event) || event.type !== "condensation") continue;
		if (event.action === "apply") result.set(event.operationId, event);
		else if (event.action === "restore") result.delete(event.operationId);
	}
	return [...result.values()];
}
function defaultDocument(sessionId) {
	return {
		schemaVersion: 1,
		sessionId,
		events: []
	};
}
function revisionOf(path, raw, document, state) {
	let stat = "";
	try {
		const item = requireStat(path);
		stat = `${item.size}:${item.mtimeMs}`;
	} catch {}
	return stableFingerprint([
		path,
		stat,
		state,
		raw ?? JSON.stringify(document)
	]);
}
function requireStat(path) {
	return statSync(path);
}
function nativeCompactionSidecarPath(sessionFile) {
	return resolve(sessionFile) + ".context-editor.compaction.json";
}
function parseEvidence(value) {
	if (!value || typeof value !== "object") return false;
	const row = value;
	return row.schemaVersion === 1 && typeof row.sessionId === "string" && row.sessionId.length > 0 && typeof row.preparationId === "string" && row.preparationId.length > 0 && typeof row.firstKeptEntryId === "string" && row.firstKeptEntryId.length > 0 && Array.isArray(row.shadowedEntryIds) && row.shadowedEntryIds.every((id) => typeof id === "string" && id.length > 0) && (row.checkpointEntryId === void 0 || typeof row.checkpointEntryId === "string") && typeof row.preparedRevision === "string" && typeof row.sourceFingerprint === "string" && (row.reason === "manual" || row.reason === "threshold" || row.reason === "overflow") && typeof row.committed === "boolean" && (row.compactionId === void 0 || typeof row.compactionId === "string") && (row.summaryEntryId === void 0 || typeof row.summaryEntryId === "string") && typeof row.createdAt === "string" && typeof row.updatedAt === "string";
}
function parseDocument(value, sessionId) {
	if (!value || typeof value !== "object") return {
		document: defaultDocument(sessionId),
		error: "native compaction sidecar must be an object"
	};
	const row = value;
	if (row.schemaVersion !== 1) return {
		document: defaultDocument(sessionId),
		error: "unsupported native compaction sidecar version"
	};
	if (typeof row.sessionId !== "string" || row.sessionId !== sessionId) return {
		document: defaultDocument(sessionId),
		error: "native compaction sidecar session mismatch"
	};
	if (!Array.isArray(row.events) || !row.events.every(parseEvidence)) return {
		document: defaultDocument(sessionId),
		error: "native compaction sidecar contains an invalid event"
	};
	return { document: {
		schemaVersion: 1,
		sessionId,
		events: row.events
	} };
}
function readNativeCompactionSidecar(sessionFile, sessionId) {
	const path = nativeCompactionSidecarPath(sessionFile);
	if (!existsSync(path)) {
		const document = defaultDocument(sessionId);
		return {
			path,
			document,
			revision: revisionOf(path, void 0, document, "missing"),
			integrity: "missing"
		};
	}
	let rawText;
	try {
		rawText = readFileSync(path, "utf8");
	} catch {
		const document = defaultDocument(sessionId);
		return {
			path,
			document,
			revision: revisionOf(path, void 0, document, "invalid"),
			integrity: "invalid",
			error: "native compaction sidecar could not be read"
		};
	}
	let raw;
	try {
		raw = JSON.parse(rawText);
	} catch {
		const document = defaultDocument(sessionId);
		return {
			path,
			document,
			revision: revisionOf(path, rawText, document, "invalid"),
			integrity: "invalid",
			error: "native compaction sidecar JSON is malformed"
		};
	}
	const parsed = parseDocument(raw, sessionId);
	if (parsed.error) return {
		path,
		document: parsed.document,
		revision: revisionOf(path, rawText, parsed.document, "invalid"),
		integrity: "invalid",
		error: parsed.error
	};
	return {
		path,
		document: parsed.document,
		revision: revisionOf(path, rawText, parsed.document, "ok"),
		integrity: "ok"
	};
}
function withLock(path, fn) {
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
function writeDocument(path, document) {
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
function upsertNativeCompactionEvidence(sessionFile, sessionId, evidence) {
	const path = nativeCompactionSidecarPath(sessionFile);
	return withLock(path, () => {
		const current = readNativeCompactionSidecar(sessionFile, sessionId);
		if (current.integrity === "invalid") throw new Error("CONTEXT_EDITOR_NATIVE_COMPACTION_UNAVAILABLE");
		const events = current.document.events.filter((item) => item.preparationId !== evidence.preparationId && item.compactionId !== evidence.compactionId);
		writeDocument(path, {
			...current.document,
			events: [...events, evidence]
		});
		return evidence.preparationId;
	});
}
function nativeCompactionPreparationId(input) {
	return stableFingerprint([
		input.sessionId,
		input.firstKeptEntryId,
		...input.shadowedEntryIds,
		input.preparedRevision,
		input.sourceFingerprint
	]);
}
function inferPiShadowedEntryIds(branchEntries, firstKeptEntryId, turnPrefixMessagesPresent) {
	const rows = branchEntries;
	const firstKeptIndex = rows.findIndex((entry) => String(entry.id ?? "") === firstKeptEntryId);
	if (firstKeptIndex < 0) return [];
	let boundary = 0;
	for (let index = firstKeptIndex - 1; index >= 0; index -= 1) {
		const entry = rows[index];
		if (entry?.type === "compaction") {
			const previousKept = String(entry.firstKeptEntryId ?? "");
			const previousIndex = rows.findIndex((candidate) => String(candidate.id ?? "") === previousKept);
			boundary = previousIndex >= 0 ? previousIndex : index + 1;
			break;
		}
	}
	if (turnPrefixMessagesPresent) {
		for (let index = firstKeptIndex - 1; index >= boundary; index -= 1) if (rows[index]?.type === "message" && String(rows[index]?.message?.role ?? "") === "user") {
			boundary = index;
			break;
		}
	}
	return rows.slice(boundary, firstKeptIndex).map((entry) => String(entry.id ?? "")).filter(Boolean).filter((id) => !rows.find((entry) => String(entry.id ?? "") === id && entry.type === "compaction"));
}
function piCompactionCheckpointEntryId(branchEntries) {
	const last = branchEntries.at(-1);
	return String(last?.id ?? "") || void 0;
}
function reconcileNativeCompactionEntry(branchEntries, compactionEntry, pending) {
	const compactionId = String(compactionEntry.id ?? "");
	const checkpointEntryId = String(compactionEntry.parentId ?? piCompactionCheckpointEntryId(branchEntries) ?? "");
	return {
		...pending,
		committed: true,
		compactionId: compactionId || pending.compactionId,
		summaryEntryId: compactionId || pending.summaryEntryId,
		firstKeptEntryId: String(compactionEntry.firstKeptEntryId ?? pending.firstKeptEntryId),
		...checkpointEntryId ? { checkpointEntryId } : {},
		updatedAt: (/* @__PURE__ */ new Date()).toISOString()
	};
}
function nativeCompactionRefs(document) {
	return document.events.map((event) => ({
		host: "pi",
		compactionId: event.compactionId ?? event.preparationId,
		shadowedRootSeqs: [],
		shadowedEntryIds: [...event.shadowedEntryIds],
		...event.checkpointEntryId ? { checkpointEntryId: event.checkpointEntryId } : {},
		...event.committed ? {} : { committed: false }
	}));
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
		contextExclusion: true,
		contextReplacement: true,
		contextCondensation: true
	};
	condensationOperations = /* @__PURE__ */ new Map();
	condensationControllers = /* @__PURE__ */ new Map();
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
	contextEntries() {
		return this.ctx.sessionManager.buildContextEntries();
	}
	effectiveRead() {
		const current = this.read();
		const entries = this.contextEntries();
		return {
			...current,
			entries,
			atoms: normalizeSessionEntries(entries)
		};
	}
	effectiveRecords() {
		const snapshot = this.effectiveRead();
		return service.getRecords({
			read: () => snapshot,
			isBusy: () => this.isBusy()
		});
	}
	read() {
		const entries = this.branchEntries();
		const atoms = normalizeSessionEntries(entries);
		const leafId = this.ctx.sessionManager.getLeafId();
		const sidecar = readSidecar(this.sessionFile, this.sessionId);
		const projection = readProjectionSidecar(this.sessionFile, this.sessionId);
		const native = readNativeCompactionSidecar(this.sessionFile, this.sessionId);
		const branchIds = new Set(entries.map((entry) => String(entry.id ?? "")));
		const viewEvents = sidecar.document.events.filter((envelope) => envelope.anchorEntryId.length === 0 || branchIds.has(envelope.anchorEntryId)).map((envelope) => envelope.event);
		const projectionEvents = projection.integrity === "ok" ? projection.document.events.filter((envelope) => envelope.anchorEntryId.length === 0 || branchIds.has(envelope.anchorEntryId)).map((envelope) => envelope.event) : [];
		const branchParts = contextEditorBranchRevisionParts(entries);
		const revision = branchRevision(leafId, atoms, [
			...branchParts,
			sidecar.viewRevision,
			projection.revision,
			native.revision
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
				native.revision,
				revision,
				...branchParts
			]),
			viewEvents,
			projectionEvents,
			nativeCompactions: native.integrity === "invalid" ? [] : nativeCompactionRefs(native.document).filter((ref) => ref.committed !== false && branchIds.has(ref.compactionId)),
			nativeCompactionAvailable: native.integrity !== "invalid",
			projectionAvailable: projection.integrity !== "invalid",
			...projection.error ? { projectionError: projection.error } : {},
			...native.error ? { nativeCompactionError: native.error } : {},
			projectionRevision: projection.revision,
			nativeCompactionRevision: native.revision
		};
	}
	nativeRecoveryRequired(operationId) {
		const snapshot = this.snapshot();
		const condensation = snapshot.condensations?.find((item) => item.operationId === operationId && item.coverage && (item.coverage.status !== "none" || item.coverage.restoreMode === "unavailable")) ?? (operationId ? void 0 : snapshot.condensations?.find((item) => item.coverage && (item.coverage.status !== "none" || item.coverage.restoreMode === "unavailable")));
		const coverage = condensation?.coverage;
		if (!condensation || !coverage) return void 0;
		return {
			ok: false,
			operationId: condensation.operationId,
			restoreRequired: true,
			restoreMode: coverage.restoreMode,
			...coverage.checkpointCompactionId ? { checkpointCompactionId: coverage.checkpointCompactionId } : {},
			...coverage.checkpointSeq === void 0 ? {} : { checkpointSeq: coverage.checkpointSeq },
			...coverage.checkpointEntryId ? { checkpointEntryId: coverage.checkpointEntryId } : {},
			snapshot
		};
	}
	appendViewEvent(event) {
		if (!this.ctx.isIdle()) throw new Error("AGENT_RUNTIME_BUSY");
		const current = this.read();
		if (String(current.revision) !== String(event.baseRevision)) throw new Error("CONTEXT_EDITOR_CONFLICT");
		const sidecar = readSidecar(this.sessionFile, this.sessionId);
		if (this.read().revision !== current.revision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		return appendSidecarEvent(this.sessionFile, this.sessionId, current.leafId ?? "", event, sidecar.revision);
	}
	appendProjectionEvent(event) {
		if (!this.ctx.isIdle()) throw new Error("AGENT_RUNTIME_BUSY");
		const current = this.read();
		if (current.projectionAvailable === false) throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (String(current.revision) !== String(event.baseRevision)) throw new Error("CONTEXT_EDITOR_CONFLICT");
		const sidecar = readProjectionSidecar(this.sessionFile, this.sessionId);
		if (sidecar.integrity === "invalid") throw new Error("CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		if (this.read().revision !== current.revision) throw new Error("CONTEXT_EDITOR_CONFLICT");
		return appendProjectionSidecarEvent(this.sessionFile, this.sessionId, current.leafId ?? "", event, sidecar.revision);
	}
	previewReplacementMutation(input) {
		return service.previewReplacement(this, input);
	}
	commitReplacementMutation(input) {
		try {
			return service.commitReplacement(this, input);
		} catch (error) {
			if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) return {
				ok: false,
				conflict: true,
				snapshot: this.snapshot()
			};
			throw error;
		}
	}
	restoreReplacementMutation(input) {
		const blocked = this.nativeRecoveryRequired();
		if (blocked) return blocked;
		try {
			return service.restoreReplacement(this, input);
		} catch (error) {
			if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) return {
				ok: false,
				conflict: true,
				snapshot: this.snapshot()
			};
			throw error;
		}
	}
	undoReplacementMutation(input) {
		const blocked = this.nativeRecoveryRequired();
		if (blocked) return blocked;
		try {
			return service.undoReplacement(this, input);
		} catch (error) {
			if (error instanceof Error && (error.message === "CONTEXT_EDITOR_CONFLICT" || error.message === "CONTEXT_EDITOR_SIDECAR_BUSY")) return {
				ok: false,
				conflict: true,
				snapshot: this.snapshot()
			};
			throw error;
		}
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
		const snapshot = service.getSnapshot(this);
		const current = this.read();
		const projectionEvents = current.projectionEvents ?? [];
		const byOperation = /* @__PURE__ */ new Map();
		for (const event of projectionEvents) {
			if (!("type" in event) || event.type !== "condensation") continue;
			if (event.action === "apply") byOperation.set(event.operationId, {
				event,
				contextExcluded: false
			});
			else if (event.action === "restore") byOperation.delete(event.operationId);
			else {
				const current = byOperation.get(event.operationId);
				if (current) current.contextExcluded = event.action === "exclude-summary";
			}
		}
		const condensations = [...byOperation.values()].map(({ event, contextExcluded }) => ({
			operationId: event.operationId,
			status: "applied",
			contextExcluded,
			summary: event.summary,
			requestedUnitIds: event.requestedUnitIds,
			effectiveUnitIds: event.effectiveUnitIds,
			autoExpandedUnitIds: event.autoExpandedUnitIds ?? [],
			recordIds: event.recordIds ?? [],
			...event.sourceEntryIds?.length ? { sourceEntryIds: event.sourceEntryIds } : {},
			sourceRootSeqs: event.sourceRootSeqs,
			...event.sourceFingerprint ? { sourceFingerprint: event.sourceFingerprint } : {},
			sourceUnits: event.sourceUnits,
			metrics: event.metrics,
			provider: event.provider,
			model: event.model,
			createdAt: event.createdAt,
			coverage: (() => {
				const coverage = deriveCondensationCoverage(event.sourceEntryIds?.length ? event.sourceEntryIds : event.sourceRootSeqs, current.nativeCompactions ?? []);
				return current.nativeCompactionAvailable === false ? {
					...coverage,
					restoreMode: "unavailable",
					reason: "checkpoint-unavailable"
				} : coverage;
			})()
		}));
		return {
			...snapshot,
			capabilities: this.capabilities,
			...condensations.length ? { condensations } : {}
		};
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
		if (input.action === "restore") {
			const blocked = this.nativeRecoveryRequired();
			if (blocked) return blocked;
		}
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
		const blocked = this.nativeRecoveryRequired();
		if (blocked) return blocked;
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
	currentCondensation(operationId) {
		let active;
		for (const event of this.read().projectionEvents ?? []) {
			if (!("type" in event) || event.type !== "condensation" || event.operationId !== operationId) continue;
			if (event.action === "apply") active = event;
			else if (event.action === "restore") active = void 0;
		}
		return active;
	}
	condensationRange(request) {
		const current = this.effectiveRead();
		if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
		const records = this.effectiveRecords();
		const requested = Array.from(new Set(request.unitIds.map(String).filter(Boolean)));
		if (!requested.length) throw new Error("CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY");
		const positions = /* @__PURE__ */ new Map();
		let flatPosition = 0;
		for (const record of records) for (const unit of record.units) positions.set(unit.id, flatPosition++);
		const selectedPositions = requested.map((id) => positions.get(id)).filter((value) => value !== void 0).sort((a, b) => a - b);
		if (selectedPositions.length !== requested.length) throw new Error("CONTEXT_EDITOR_CONDENSATION_UNAVAILABLE");
		const target = records.flatMap((record) => record.units).find((unit) => unit.id === requested[0]);
		const expandRelated = request.expandRelated === true && requested.length === 1 && target?.kind === "answer";
		for (let index = 1; index < selectedPositions.length; index += 1) if (selectedPositions[index] !== selectedPositions[index - 1] && selectedPositions[index] !== selectedPositions[index - 1] + 1) throw new Error("CONTEXT_EDITOR_CONDENSATION_NON_CONTIGUOUS");
		const range = selectCondensationRange(records, requested, reduceProjectionStates(current.atoms, current.projectionEvents ?? []), { expandRelated });
		if (!range.effectiveUnitIds.length) throw new Error("CONTEXT_EDITOR_CONDENSATION_RANGE_EMPTY");
		if (range.unavailableUnitIds.length) throw new Error("CONTEXT_EDITOR_CONDENSATION_UNAVAILABLE:" + range.unavailableUnitIds.join(","));
		const opaque = range.sourceUnits.find((source) => source.hasSignature || source.structured);
		if (opaque) throw new Error("CONTEXT_EDITOR_CONDENSATION_OPAQUE_CONTENT:" + opaque.id);
		const entryIds = new Set(range.sourceEntryIds ?? range.sourceUnits.flatMap((unit) => unit.sourceEntryIds ?? []));
		for (const event of activePiCondensationEvents(current.projectionEvents ?? [])) if ([...entryIds].some((id) => (event.sourceEntryIds ?? []).includes(id))) throw new Error("CONTEXT_EDITOR_CONDENSATION_OVERLAP:" + event.operationId);
		return {
			current,
			records,
			range,
			expandRelated
		};
	}
	async condensationModel(provider, modelId) {
		if (provider && modelId) {
			const found = this.ctx.modelRegistry.find(provider, modelId);
			if (found) return found;
		}
		if (this.ctx.model) return this.ctx.model;
		const found = (await this.ctx.modelRegistry.getAvailable())[0];
		if (!found) throw new Error("CONTEXT_EDITOR_CONDENSATION_MODEL_REQUIRED");
		return found;
	}
	async prepareCondensation(request) {
		return this.generateCondensation(request);
	}
	async generateCondensation(request) {
		if (!this.ctx.isIdle()) throw new Error("CONTEXT_EDITOR_BUSY");
		const prepared = this.condensationRange(request);
		const model = await this.condensationModel(request.provider, request.model);
		const operationId = "condensation-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
		const controller = new AbortController();
		if (request.signal?.aborted) throw new Error("CONTEXT_EDITOR_CONDENSATION_CANCELLED");
		const abort = () => controller.abort();
		request.signal?.addEventListener("abort", abort, { once: true });
		this.condensationControllers.set(operationId, controller);
		const beforeTokens = prepared.range.sourceUnits.filter((unit) => unit.included).reduce((sum, unit) => sum + unit.approxTokens, 0);
		try {
			const instruction = condensationInstruction(prepared.range);
			const response = await this.ctx.modelRegistry.complete(model, { messages: [{
				role: "user",
				content: [{
					type: "text",
					text: instruction
				}],
				timestamp: Date.now()
			}] }, {
				maxTokens: request.maxTokens ?? 4096,
				signal: controller.signal
			});
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
				schemaVersion: 1,
				operationId: operation,
				sessionId: this.sessionId,
				baseRevision: prepared.current.revision,
				requestedUnitIds: prepared.range.requestedUnitIds,
				effectiveUnitIds: prepared.range.effectiveUnitIds,
				autoExpandedUnitIds: prepared.range.autoExpandedUnitIds,
				recordIds: prepared.range.recordIds,
				...prepared.range.sourceEntryIds?.length ? { sourceEntryIds: prepared.range.sourceEntryIds } : {},
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
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				warnings: validation.warnings.concat("prefix-not-reused"),
				sourceFingerprint: prepared.range.sourceFingerprint
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
				excludedAtomIds: new Set([...reduceProjectionStates(prepared.current.atoms, prepared.current.projectionEvents ?? []).entries()].filter(([, state]) => state === "exclude" || state === "unavailable").map(([id]) => id))
			}, prepared.current.atoms);
			event.metrics = validation.metrics;
			this.condensationOperations.set(operation, {
				proposal,
				event
			});
			return {
				ok: true,
				...proposal,
				range: prepared.range,
				validation,
				snapshot: this.snapshot()
			};
		} finally {
			request.signal?.removeEventListener("abort", abort);
			this.condensationControllers.delete(operationId);
		}
	}
	async cancelCondensation(request) {
		asLocator(request.locator, this.sessionId);
		const controller = this.condensationControllers.get(request.operationId);
		if (controller) controller.abort();
		const cancelled = this.condensationOperations.delete(request.operationId) || !!controller;
		return {
			ok: true,
			operationId: request.operationId,
			cancelled
		};
	}
	async commitCondensation(request) {
		asLocator(request.locator, this.sessionId);
		const blocked = this.nativeRecoveryRequired(request.operationId);
		if (blocked) return blocked;
		if (!this.ctx.isIdle()) throw new Error("CONTEXT_EDITOR_BUSY");
		const pending = this.condensationOperations.get(request.operationId);
		const active = this.currentCondensation(request.operationId);
		if (active) {
			if (request.summary.trim() !== active.summary.trim()) throw new Error("CONTEXT_EDITOR_CONDENSATION_OPERATION_REUSED");
			return {
				ok: true,
				operationId: request.operationId,
				eventId: active.eventId,
				snapshot: this.snapshot()
			};
		}
		if (!pending) throw new Error("CONTEXT_EDITOR_CONDENSATION_PROPOSAL_NOT_FOUND");
		const current = this.read();
		if (String(request.baseRevision) !== String(current.revision)) return {
			ok: false,
			conflict: true,
			operationId: request.operationId,
			snapshot: this.snapshot()
		};
		const range = this.condensationRange({
			locator: request.locator,
			baseRevision: current.revision,
			unitIds: request.unitIds ?? pending.proposal.requestedUnitIds,
			expandRelated: pending.proposal.autoExpandedUnitIds.length > 0
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
			entries: range.current.entries,
			excludedAtomIds: new Set([...reduceProjectionStates(range.current.atoms, range.current.projectionEvents ?? []).entries()].filter(([, state]) => state === "exclude" || state === "unavailable").map(([id]) => id))
		}, range.current.atoms);
		event.metrics = validation.metrics;
		const eventId = this.appendProjectionEvent(event);
		this.condensationOperations.delete(request.operationId);
		return {
			ok: true,
			operationId: request.operationId,
			eventId,
			snapshot: this.snapshot()
		};
	}
	async restoreCondensation(request) {
		asLocator(request.locator, this.sessionId);
		const active = this.currentCondensation(request.operationId);
		if (!active) return {
			ok: true,
			operationId: request.operationId,
			snapshot: this.snapshot()
		};
		const currentSnapshot = this.snapshot();
		const coverage = currentSnapshot.condensations?.find((item) => item.operationId === request.operationId)?.coverage;
		if (coverage && (coverage.status !== "none" || coverage.restoreMode === "unavailable")) return {
			ok: false,
			operationId: request.operationId,
			restoreRequired: true,
			restoreMode: coverage.restoreMode,
			...coverage.checkpointCompactionId ? { checkpointCompactionId: coverage.checkpointCompactionId } : {},
			...coverage.checkpointSeq === void 0 ? {} : { checkpointSeq: coverage.checkpointSeq },
			...coverage.checkpointEntryId ? { checkpointEntryId: coverage.checkpointEntryId } : {},
			snapshot: currentSnapshot
		};
		const current = this.read();
		if (String(request.baseRevision) !== String(current.revision)) return {
			ok: false,
			conflict: true,
			operationId: request.operationId,
			snapshot: this.snapshot()
		};
		const event = {
			...active,
			action: "restore",
			eventId: request.operationId + ":restore:" + Date.now(),
			baseRevision: current.revision,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		const eventId = this.appendProjectionEvent(event);
		return {
			ok: true,
			operationId: request.operationId,
			eventId,
			snapshot: this.snapshot()
		};
	}
	async undoCondensation(request) {
		return this.restoreCondensation(request);
	}
	condensationSurfaceEvent(operationId) {
		return this.currentCondensation(operationId);
	}
	condensationSurfaceResult(operationId, action) {
		const active = this.condensationSurfaceEvent(operationId);
		if (!active) throw new Error("CONTEXT_EDITOR_CONDENSATION_RESTORE_UNAVAILABLE");
		const snapshot = this.snapshot();
		const coverage = snapshot.condensations?.find((item) => item.operationId === operationId)?.coverage;
		if (coverage && (coverage.status !== "none" || coverage.restoreMode === "unavailable")) return {
			ok: false,
			operationId,
			restoreRequired: true,
			restoreMode: coverage.restoreMode,
			...coverage.checkpointCompactionId ? { checkpointCompactionId: coverage.checkpointCompactionId } : {},
			...coverage.checkpointSeq === void 0 ? {} : { checkpointSeq: coverage.checkpointSeq },
			snapshot
		};
		const current = this.read();
		const event = {
			...active,
			action: action === "exclude" ? "exclude-summary" : "restore-summary",
			eventId: operationId + ":" + action + ":" + Date.now(),
			baseRevision: current.revision,
			createdAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		return {
			ok: true,
			operationId,
			eventId: this.appendProjectionEvent(event),
			snapshot: this.snapshot()
		};
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
	async previewReplacement(request) {
		asLocator(request.locator, this.sessionId);
		return service.previewReplacement(this, request);
	}
	async commitReplacement(request) {
		asLocator(request.locator, this.sessionId);
		return this.commitReplacementMutation(request);
	}
	async restoreReplacement(request) {
		asLocator(request.locator, this.sessionId);
		return this.restoreReplacementMutation(request);
	}
	async undoReplacement(request) {
		asLocator(request.locator, this.sessionId);
		return this.undoReplacementMutation(request);
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
				stateByUnitId: unit ? { [unit.id]: request.action === "exclude" ? "exclude" : "include" } : {}
			};
		}
		return service.previewContextProjection(this, request);
	}
	async commitContext(request) {
		if (request.action === "restore") {
			const blocked = this.nativeRecoveryRequired();
			if (blocked) return blocked;
		}
		asLocator(request.locator, this.sessionId);
		if (request.condensationOperationId) return this.condensationSurfaceResult(request.condensationOperationId, request.action);
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
function uniqueProjectionEvents(events) {
	const seen = /* @__PURE__ */ new Set();
	return events.filter((event) => {
		const id = "type" in event ? event.eventId : event.transactionId;
		if (seen.has(id)) return false;
		seen.add(id);
		return true;
	});
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
		if (!("type" in event)) {
			if (event.action !== "restore") continue;
			for (const change of event.changes) if (known.has(change.atomId) && states.get(change.atomId) === "include") ids.add(change.atomId);
			continue;
		}
		if (event.type === "replacement" && event.action === "undo" && event.linkedExclusion) {
			for (const change of event.linkedExclusion.atomChanges) if (known.has(change.atomId) && states.get(change.atomId) === "include") ids.add(change.atomId);
		}
	}
	return ids;
}
function atomForAssistantBlock(atoms, blockIndex, part) {
	if (!part || typeof part !== "object") return void 0;
	const type = String(part.type ?? "");
	const kind = type === "text" ? "assistant_text" : type === "thinking" ? "reasoning" : type === "toolCall" ? "tool_call" : "";
	return atoms.find((atom) => atom.sourceRef.blockIndex === blockIndex && (kind === "" || atom.kind === kind));
}
function replacementUnits(atoms, exclusionStates, events) {
	const base = projectRecords(atoms, void 0, exclusionStates);
	const states = reduceReplacementStates(base.flatMap((record) => record.units), events, true);
	const byAtom = /* @__PURE__ */ new Map();
	const historyUnitIds = /* @__PURE__ */ new Set();
	const historyAtomIds = /* @__PURE__ */ new Set();
	const linkedTurnIds = /* @__PURE__ */ new Set();
	const projectedUnits = projectRecords(atoms, void 0, exclusionStates, states).flatMap((record) => record.units);
	for (const event of events) {
		if (!("type" in event) || event.type !== "replacement") continue;
		historyUnitIds.add(event.unitId);
		if (event.action !== "undo") for (const ref of event.atomRefs) {
			historyAtomIds.add(ref.atomId);
			const atom = atoms.find((candidate) => candidate.id === ref.atomId);
			if (event.linkedExclusion && atom) linkedTurnIds.add(atom.turnId);
		}
		for (const change of event.linkedExclusion?.atomChanges ?? []) historyAtomIds.add(change.atomId);
	}
	for (const atom of atoms) if (linkedTurnIds.has(atom.turnId)) historyAtomIds.add(atom.id);
	for (const record of base) for (const unit of record.units) {
		const state = states.get(unit.id);
		if (!state) continue;
		if (state.replacementState === "unavailable") throw new ProjectionAlignmentError("active replacement is unavailable");
		const item = {
			unit: projectedUnits.find((candidate) => candidate.id === unit.id) ?? unit,
			state
		};
		for (const atom of unit.atoms) byAtom.set(atom.id, item);
	}
	return {
		byAtom,
		historyUnitIds,
		historyAtomIds
	};
}
function cloneWithContent(message, content) {
	return {
		...message,
		content
	};
}
function projectOneMessage(message, atoms, states, unitByAtom) {
	const excluded = new Set(atoms.filter((atom) => states.get(atom.id) === "exclude").map((atom) => atom.id));
	const projection = atoms.map((atom) => unitByAtom.get(atom.id)).find((item) => !!item && item.state.replacementState === "replaced");
	const role = roleOf(message);
	if (role === "user") {
		if (excluded.size > 0) return void 0;
		if (projection && projection.unit.kind === "user") {
			const content = message.content;
			if (Array.isArray(content)) {
				const next = [];
				let replaced = false;
				for (const part of content) if (part && typeof part === "object" && part.type === "text") {
					if (replaced) continue;
					replaced = true;
					next.push({
						...part,
						text: projection.unit.effectiveText
					});
				} else next.push(part);
				return cloneWithContent(message, next);
			}
			return cloneWithContent(message, projection.unit.effectiveText);
		}
		return message;
	}
	if (role === "toolResult") {
		if (excluded.size > 0) return void 0;
		return message;
	}
	if (role !== "assistant") {
		if (excluded.size > 0 || projection) throw new ProjectionAlignmentError("unsupported active message role");
		return message;
	}
	const content = message.content;
	if (!Array.isArray(content)) throw new ProjectionAlignmentError("assistant message content is not an array");
	const lastReplacementAtomId = projection?.unit.kind === "answer" ? projection.unit.atomIds[projection.unit.atomIds.length - 1] : void 0;
	const nextContent = content.map((part, blockIndex) => ({
		part,
		blockIndex
	})).filter(({ part, blockIndex }) => {
		const atom = atomForAssistantBlock(atoms, blockIndex, part);
		if (!atom) return true;
		if (excluded.has(atom.id)) return false;
		if (projection?.unit.kind === "answer" && projection.unit.atomIds.includes(atom.id) && atom.kind === "assistant_text") return atom.id === lastReplacementAtomId;
		return true;
	}).map(({ part, blockIndex }) => {
		if (!projection || projection.unit.kind !== "answer") return part;
		const atom = atomForAssistantBlock(atoms, blockIndex, part);
		if (atom && atom.id === lastReplacementAtomId && atom.kind === "assistant_text") return {
			...part,
			text: projection.unit.effectiveText
		};
		return part;
	});
	if (nextContent.length === 0) return void 0;
	return cloneWithContent(message, nextContent);
}
function rowProjection(rowAtoms, unitByAtom) {
	return rowAtoms.map((atom) => unitByAtom.get(atom.id)).find((item) => !!item && item.state.replacementState === "replaced");
}
function rowHasHistory(rowAtoms, unitByAtom, historyUnitIds, historyAtomIds) {
	return rowAtoms.some((atom) => historyAtomIds.has(atom.id) || (() => {
		const item = unitByAtom.get(atom.id);
		return !!item && historyUnitIds.has(item.unit.id);
	})());
}
function messagePayloadEqual(left, right) {
	return roleOf(left) === roleOf(right) && JSON.stringify(left.content) === JSON.stringify(right.content);
}
function replacementCompatible(baseline, current, rowAtoms, unitByAtom, historyUnitIds, historyAtomIds) {
	if (rowProjection(rowAtoms, unitByAtom)) {
		const expected = projectOneMessage(baseline, rowAtoms, /* @__PURE__ */ new Map(), unitByAtom);
		if (messagePayloadEqual(baseline, current) || expected && messagePayloadEqual(expected, current)) return true;
		if (roleOf(baseline) === "user") return false;
		return structurallyCompatible(baseline, current) || isKindSubsequence(baseline, current) || !!expected && (structurallyCompatible(expected, current) || isKindSubsequence(expected, current));
	}
	if (rowHasHistory(rowAtoms, unitByAtom, historyUnitIds, historyAtomIds)) return restoreCompatible(baseline, current) || structurallyCompatible(baseline, current);
	return structurallyCompatible(baseline, current) || isKindSubsequence(baseline, current);
}
function isCondensationEvent(event) {
	return "type" in event && event.type === "condensation" && event.schemaVersion === 1;
}
function condensationMessages(events) {
	const operations = /* @__PURE__ */ new Map();
	for (const event of events) {
		if (!isCondensationEvent(event)) continue;
		const current = operations.get(event.operationId);
		if (event.action === "apply") operations.set(event.operationId, {
			event,
			summaryExcluded: false
		});
		else if (event.action === "restore") operations.delete(event.operationId);
		else if (current) operations.set(event.operationId, {
			event: current.event,
			summaryExcluded: event.action === "exclude-summary"
		});
	}
	const result = /* @__PURE__ */ new Map();
	for (const { event, summaryExcluded } of operations.values()) {
		const summaryText = frameCondensationSummary(event.summary);
		for (const item of event.afterMessages) {
			let message = item.message;
			if (message && summaryExcluded) {
				const content = message.content;
				if (Array.isArray(content)) {
					const next = content.filter((part) => !(part && typeof part === "object" && part.type === "text" && String(part.text ?? "") === summaryText));
					message = next.length ? {
						...message,
						content: next
					} : null;
				} else if (content === summaryText) message = null;
			}
			result.set(String(item.entryId), message ? structuredClone(message) : null);
		}
	}
	return result;
}
function projectModelContext(input) {
	const projectionEvents = uniqueProjectionEvents(input.projectionEvents);
	if (projectionEvents.length === 0) return [...input.messages];
	const rows = rowsForEntries(input.entries);
	const { states, byEntry } = activeAtomsByEntry(input.atoms, projectionEvents);
	const { byAtom: unitByAtom, historyUnitIds, historyAtomIds } = replacementUnits(input.atoms, states, projectionEvents);
	const restoredIds = restoredAtomIds(input.atoms, projectionEvents, states);
	const condensationByEntry = condensationMessages(projectionEvents);
	const output = [];
	let cursor = 0;
	for (const row of rows) {
		const rowAtoms = byEntry.get(row.entryId) ?? [];
		if (condensationByEntry.has(row.entryId)) {
			const condensed = condensationByEntry.get(row.entryId) ?? null;
			let condensedMatch = -1;
			for (let index = cursor; index < input.messages.length; index += 1) {
				const candidate = input.messages[index];
				if (candidate && (structurallyCompatible(row.baseline, candidate) || condensed !== null && roleOf(row.baseline) === roleOf(candidate))) {
					condensedMatch = index;
					break;
				}
			}
			if (condensedMatch < 0) {
				if (!condensed) continue;
				throw new ProjectionAlignmentError("condensed message could not be aligned");
			}
			for (let index = cursor; index < condensedMatch; index += 1) {
				const extra = input.messages[index];
				if (extra) output.push(extra);
			}
			if (condensed) output.push(structuredClone(condensed));
			cursor = condensedMatch + 1;
			continue;
		}
		const projection = rowProjection(rowAtoms, unitByAtom);
		const hasExcluded = rowAtoms.some((atom) => states.get(atom.id) === "exclude");
		const hasRestored = rowAtoms.some((atom) => restoredIds.has(atom.id));
		const hasHistory = rowHasHistory(rowAtoms, unitByAtom, historyUnitIds, historyAtomIds);
		const compatible = [];
		for (let index = cursor; index < input.messages.length; index += 1) {
			const candidate = input.messages[index];
			if (candidate && replacementCompatible(row.baseline, candidate, rowAtoms, unitByAtom, historyUnitIds, historyAtomIds)) compatible.push({
				candidate,
				index
			});
		}
		let match = -1;
		let reconstructed = false;
		if (projection) {
			const expected = projectOneMessage(row.baseline, rowAtoms, /* @__PURE__ */ new Map(), unitByAtom);
			const exact = compatible.filter(({ candidate }) => messagePayloadEqual(row.baseline, candidate) || !!expected && messagePayloadEqual(expected, candidate));
			if (exact.length > 1) throw new ProjectionAlignmentError("projected message could not be aligned unambiguously");
			if (exact.length === 1) {
				match = exact[0].index;
				reconstructed = !messagePayloadEqual(row.baseline, exact[0].candidate);
			} else if (compatible.length > 1) throw new ProjectionAlignmentError("projected message could not be aligned unambiguously");
			else if (compatible.length === 1) {
				match = compatible[0].index;
				reconstructed = true;
			}
		} else if (compatible.length > 0) {
			match = compatible[0].index;
			reconstructed = hasHistory || hasRestored && !structurallyCompatible(row.baseline, compatible[0].candidate);
		}
		if (match < 0) {
			if (hasExcluded) {
				if (hasHistory) continue;
				throw new ProjectionAlignmentError("excluded message could not be aligned with the active context");
			}
			if (hasRestored || hasHistory) {
				const restored = projectOneMessage(row.baseline, rowAtoms, states, unitByAtom);
				if (restored) output.push(restored);
				continue;
			}
			if (projection) {
				if (projectOneMessage(row.baseline, rowAtoms, states, unitByAtom)) throw new ProjectionAlignmentError("projected message could not be aligned");
				continue;
			}
			continue;
		}
		for (let index = cursor; index < match; index += 1) {
			const extra = input.messages[index];
			if (extra) output.push(extra);
		}
		const current = input.messages[match];
		if (current) {
			const projected = projectOneMessage(reconstructed ? row.baseline : current, rowAtoms, states, unitByAtom);
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
	const uniqueEvents = uniqueProjectionEvents(projectionEvents);
	const states = reduceProjectionStates(atoms, uniqueEvents);
	if ([...states.values()].some((state) => state === "unavailable")) throw new ProjectionAlignmentError("active projection is unavailable");
	if (atoms.some((atom) => entryIds.has(atom.sourceRef.entryId) && states.get(atom.id) === "exclude")) return true;
	const { byAtom } = replacementUnits(atoms, states, uniqueEvents);
	return atoms.some((atom) => entryIds.has(atom.sourceRef.entryId) && byAtom.get(atom.id)?.state.replacementState === "replaced");
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
	return new Set(inferPiShadowedEntryIds(event.branchEntries, event.preparation.firstKeptEntryId, event.preparation.turnPrefixMessages.length > 0));
}
function messageMatches(left, right) {
	if (left === right) return true;
	const a = left;
	const b = right;
	return String(a.role ?? "") === String(b.role ?? "") && JSON.stringify(a.content) === JSON.stringify(b.content) && String(a.toolCallId ?? "") === String(b.toolCallId ?? "") && String(a.toolName ?? "") === String(b.toolName ?? "");
}
function entryIdsForMessages(messages, entries) {
	const used = /* @__PURE__ */ new Set();
	const result = [];
	for (const message of messages) {
		const matches = entries.filter((entry) => {
			const id = String(entry.id ?? "");
			if (!id || used.has(id)) return false;
			return sessionEntryToContextMessages(entry).some((candidate) => messageMatches(message, candidate));
		});
		if (matches.length !== 1) throw new Error("CONTEXT_EDITOR_COMPACTION_ALIGNMENT_UNAVAILABLE");
		const match = matches[0];
		const id = String(match?.id ?? "");
		if (id) {
			used.add(id);
			result.push(id);
		}
	}
	return result;
}
function projectCompactionMessages(messages, entries, atoms, projectionEvents) {
	if (messages.length === 0 || projectionEvents.length === 0) return [...messages];
	const entryIds = entryIdsForMessages(messages, entries);
	if (entryIds.length !== messages.length) throw new Error("CONTEXT_EDITOR_COMPACTION_ALIGNMENT_UNAVAILABLE");
	const selected = entries.filter((entry) => entryIds.includes(String(entry.id ?? "")));
	return projectModelContext({
		messages: [...messages],
		entries: selected,
		atoms,
		projectionEvents
	});
}
function createPiFileOps() {
	return {
		read: /* @__PURE__ */ new Set(),
		written: /* @__PURE__ */ new Set(),
		edited: /* @__PURE__ */ new Set()
	};
}
function extractPiFileOps(messages, fileOps) {
	for (const message of messages) {
		const row = message;
		if (row.role !== "assistant" || !Array.isArray(row.content)) continue;
		for (const block of row.content) {
			if (!block || typeof block !== "object") continue;
			const item = block;
			if (item.type !== "toolCall" || !item.arguments || typeof item.arguments !== "object") continue;
			const args = item.arguments;
			const path = typeof args.path === "string" && args.path.length > 0 ? args.path : void 0;
			if (!path) continue;
			if (item.name === "read") fileOps.read.add(path);
			else if (item.name === "write") fileOps.written.add(path);
			else if (item.name === "edit") fileOps.edited.add(path);
		}
	}
}
function previousPiCompactionFileOps(branchEntries, firstKeptEntryId) {
	const result = createPiFileOps();
	const rows = branchEntries;
	const firstKeptIndex = rows.findIndex((entry) => String(entry.id ?? "") === firstKeptEntryId);
	for (let index = firstKeptIndex - 1; index >= 0; index -= 1) {
		const entry = rows[index];
		if (entry?.type !== "compaction" || entry.fromHook === true || !entry.details || typeof entry.details !== "object") continue;
		const details = entry.details;
		if (Array.isArray(details.readFiles)) {
			for (const path of details.readFiles) if (typeof path === "string" && path) result.read.add(path);
		}
		if (Array.isArray(details.modifiedFiles)) {
			for (const path of details.modifiedFiles) if (typeof path === "string" && path) result.edited.add(path);
		}
		break;
	}
	return result;
}
function projectPreparationFileOps(preparationFileOps, branchEntries, firstKeptEntryId, beforeMessages, beforePrefixMessages, afterMessages, afterPrefixMessages) {
	const before = createPiFileOps();
	extractPiFileOps(beforeMessages, before);
	extractPiFileOps(beforePrefixMessages, before);
	const after = createPiFileOps();
	extractPiFileOps(afterMessages, after);
	extractPiFileOps(afterPrefixMessages, after);
	const previous = previousPiCompactionFileOps(branchEntries, firstKeptEntryId);
	const result = {
		read: new Set(preparationFileOps.read ?? []),
		written: new Set(preparationFileOps.written ?? []),
		edited: new Set(preparationFileOps.edited ?? [])
	};
	for (const key of [
		"read",
		"written",
		"edited"
	]) {
		for (const path of before[key]) if (!after[key].has(path) && !previous[key].has(path)) result[key].delete(path);
		for (const path of after[key]) result[key].add(path);
		for (const path of previous[key]) result[key].add(path);
	}
	return result;
}
function projectionSummaryOverlap(ctx, entries, entryIds) {
	const current = new PiContextEditorHost(ctx).read();
	if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
	return projectionOverlapsEntryIds(entryIds, normalizeSessionEntries(entries), current.projectionEvents ?? []);
}
function reconcilePendingNativeCompactions(ctx) {
	const host = new PiContextEditorHost(ctx);
	const native = readNativeCompactionSidecar(host.sessionFile, host.sessionId);
	if (native.integrity === "invalid") return;
	const branchEntries = ctx.sessionManager.getBranch();
	for (const entry of branchEntries) {
		if (entry.type !== "compaction") continue;
		const compaction = entry;
		const firstKeptEntryId = String(compaction.firstKeptEntryId ?? "");
		const pending = native.document.events.filter((item) => item.firstKeptEntryId === firstKeptEntryId && !item.committed).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
		if (!pending) continue;
		upsertNativeCompactionEvidence(host.sessionFile, host.sessionId, reconcileNativeCompactionEntry(branchEntries, compaction, pending));
	}
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
			const host = new PiContextEditorHost(ctx);
			const current = host.read();
			if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
			if (current.nativeCompactionAvailable === false) throw new Error(current.nativeCompactionError || "CONTEXT_EDITOR_NATIVE_COMPACTION_UNAVAILABLE");
			const projectionEvents = current.projectionEvents ?? [];
			if (projectionEvents.length === 0) return;
			const shadowedEntryIds = [...projectionEntryIdsBeforeFirstKept(event)];
			if (shadowedEntryIds.length === 0) throw new Error("CONTEXT_EDITOR_COMPACTION_ALIGNMENT_UNAVAILABLE");
			const sourceFingerprint = stableFingerprint([
				event.preparation.firstKeptEntryId,
				...shadowedEntryIds,
				JSON.stringify(event.preparation.messagesToSummarize),
				JSON.stringify(event.preparation.turnPrefixMessages)
			]);
			const preparedRevision = current.revision;
			const preparationId = nativeCompactionPreparationId({
				sessionId: host.sessionId,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				shadowedEntryIds,
				preparedRevision,
				sourceFingerprint
			});
			const checkpointEntryId = piCompactionCheckpointEntryId(event.branchEntries);
			const atoms = normalizeSessionEntries(event.branchEntries);
			const preparation = event.preparation;
			const beforeMessages = [...preparation.messagesToSummarize];
			const beforePrefixMessages = [...preparation.turnPrefixMessages];
			const projectedMessages = projectCompactionMessages(beforeMessages, event.branchEntries, atoms, projectionEvents);
			const projectedPrefixMessages = projectCompactionMessages(beforePrefixMessages, event.branchEntries, atoms, projectionEvents);
			preparation.messagesToSummarize = projectedMessages;
			preparation.turnPrefixMessages = projectedPrefixMessages;
			preparation.fileOps = projectPreparationFileOps(preparation.fileOps, event.branchEntries, event.preparation.firstKeptEntryId, beforeMessages, beforePrefixMessages, projectedMessages, projectedPrefixMessages);
			upsertNativeCompactionEvidence(host.sessionFile, host.sessionId, {
				schemaVersion: 1,
				sessionId: host.sessionId,
				preparationId,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				shadowedEntryIds,
				...checkpointEntryId ? { checkpointEntryId } : {},
				preparedRevision,
				sourceFingerprint,
				reason: event.reason,
				committed: false,
				createdAt: (/* @__PURE__ */ new Date()).toISOString(),
				updatedAt: (/* @__PURE__ */ new Date()).toISOString()
			});
		} catch (error) {
			notifyProjectionFailure(ctx, error);
			return { cancel: true };
		}
	});
	pi.on("session_compact", async (event, ctx) => {
		try {
			const host = new PiContextEditorHost(ctx);
			const native = readNativeCompactionSidecar(host.sessionFile, host.sessionId);
			if (native.integrity === "invalid") throw new Error(native.error || "CONTEXT_EDITOR_NATIVE_COMPACTION_UNAVAILABLE");
			const branchEntries = ctx.sessionManager.getBranch();
			const firstKeptEntryId = String(event.compactionEntry.firstKeptEntryId ?? "");
			const pending = native.document.events.filter((item) => item.firstKeptEntryId === firstKeptEntryId && !item.committed).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
			if (!pending) return;
			upsertNativeCompactionEvidence(host.sessionFile, host.sessionId, reconcileNativeCompactionEntry(branchEntries, event.compactionEntry, pending));
		} catch (error) {
			notifyProjectionFailure(ctx, error);
		}
	});
	pi.on("session_start", async (_event, ctx) => {
		try {
			reconcilePendingNativeCompactions(ctx);
		} catch (error) {
			notifyProjectionFailure(ctx, error);
		}
	});
	pi.on("session_tree", async (_event, ctx) => {
		try {
			reconcilePendingNativeCompactions(ctx);
		} catch (error) {
			notifyProjectionFailure(ctx, error);
		}
	});
	pi.on("session_before_tree", async (event, ctx) => {
		if (!event.preparation.userWantsSummary) return;
		try {
			const current = new PiContextEditorHost(ctx).read();
			if (current.projectionAvailable === false) throw new Error(current.projectionError || "CONTEXT_EDITOR_PROJECTION_UNAVAILABLE");
			const ids = new Set(event.preparation.entriesToSummarize.map((entry) => entry.id));
			if (ids.size > 0 && projectionSummaryOverlap(ctx, event.preparation.entriesToSummarize, ids)) {
				if (ctx.hasUI) ctx.ui.notify("Branch summary cancelled because it would summarize edited or excluded context.", "warning");
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
			let uiState;
			let replacementReview;
			let condensationReview;
			const text = createPiText(locale);
			const host = new PiContextEditorHost(ctx);
			const locator = {
				host: "pi",
				sessionId: host.sessionId
			};
			while (true) {
				const records = host.records();
				if (records.length === 0) {
					ctx.ui.notify("There are no editable context records in the active branch.", "info");
					break;
				}
				const snapshot = host.snapshot();
				const prefs = host.getPrefs();
				let exit;
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
					previewReplacement: (input) => host.previewReplacementMutation(input),
					commitReplacement: (input) => host.commitReplacementMutation(input),
					generateCondensation: (input) => host.generateCondensation({
						locator,
						...input
					}),
					cancelCondensation: (operationId) => host.cancelCondensation({
						locator,
						operationId
					}),
					commitCondensation: (input) => host.commitCondensation({
						locator,
						...input
					}),
					restoreCondensation: (input) => host.restoreCondensation({
						locator,
						...input
					}),
					restoreReplacement: (input) => host.restoreReplacementMutation(input),
					undoReplacement: (input) => host.undoReplacementMutation(input),
					undo: (baseRevision) => host.undo(baseRevision),
					persistPrefs: (nextPrefs) => host.setPrefs(nextPrefs),
					notify: (message, type = "info") => ctx.ui.notify(message, type),
					isIdle: () => ctx.isIdle(),
					initialUiState: uiState,
					initialReplacementReview: replacementReview,
					initialCondensationReview: condensationReview,
					locale
				}, (result) => {
					exit = result;
					done(void 0);
				}));
				if (!exit || exit.kind === "close") break;
				uiState = exit.uiState;
				if (exit.kind === "condensation-cancel") {
					condensationReview = void 0;
					if (exit.operationId) try {
						await host.cancelCondensation({
							locator,
							operationId: exit.operationId
						});
					} catch {}
					continue;
				}
				if (exit.kind === "condensation-commit") {
					const review = exit.review;
					condensationReview = void 0;
					try {
						const result = await host.commitCondensation({
							locator,
							baseRevision: review.draft.baseRevision,
							operationId: review.draft.operationId,
							summary: review.preview.summary,
							unitIds: review.draft.unitIds
						});
						if (!result.ok || result.conflict) ctx.ui.notify(text.sidecarChanged(), "warning");
						else ctx.ui.notify(text.condensationApplied(), "info");
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						ctx.ui.notify(text.condensationBlocked(message), "warning");
					}
					continue;
				}
				if (exit.kind === "condensation-edit") {
					const review = exit.review;
					let value;
					try {
						value = await ctx.ui.editor(text.condensationSummaryTitle(), review.preview.summary);
					} catch (error) {
						ctx.ui.notify("Editor failed: " + (error instanceof Error ? error.message : String(error)), "warning");
						condensationReview = review;
						continue;
					}
					if (value === void 0) {
						condensationReview = review;
						continue;
					}
					const summary = value.trim();
					const summaryTokens = estimateCondensationTokens(frameCondensationSummary(summary));
					const validation = validateCondensationSummary(summary, review.preview.metrics.beforeTokens, { summaryTokens });
					if (!validation.ok) {
						ctx.ui.notify(text.condensationBlocked(validation.error ?? "invalid-summary"), "warning");
						condensationReview = review;
						continue;
					}
					condensationReview = {
						...review,
						preview: {
							...review.preview,
							summary,
							summaryTokens,
							metrics: validation.metrics,
							validation,
							warnings: validation.warnings
						}
					};
					continue;
				}
				if (exit.kind === "cancel-edit") {
					replacementReview = void 0;
					continue;
				}
				if (exit.kind === "replacement-commit") {
					const review = exit.review;
					replacementReview = void 0;
					try {
						const result = host.commitReplacementMutation({
							baseRevision: review.draft.baseRevision,
							operationId: review.draft.operationId,
							unitId: review.draft.unitId,
							text: review.draft.text,
							excludeAssociatedReasoning: review.excludeAssociatedReasoning,
							confirmedUnitIds: review.preview.effectiveUnitIds,
							confirmationScope: review.preview.effectiveUnitIds
						});
						if (!result.ok || result.conflict) ctx.ui.notify(text.sidecarChanged(), "warning");
						else if (!result.eventId) ctx.ui.notify(text.replacementReviewNoop(), "info");
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						ctx.ui.notify(message === "CONTEXT_EDITOR_REPLACEMENT_EMPTY" ? text.replacementReviewBlocked(text.replacementEmpty()) : text.operationFailed(message), "warning");
					}
					continue;
				}
				if (exit.kind !== "edit") continue;
				replacementReview = void 0;
				let value;
				try {
					value = await ctx.ui.editor(exit.title, exit.text);
				} catch (error) {
					ctx.ui.notify("Editor failed: " + (error instanceof Error ? error.message : String(error)), "warning");
					continue;
				}
				if (value === void 0) continue;
				try {
					const linkRequested = exit.excludeAssociatedReasoning ?? exit.unitKind === "answer";
					const preview = host.previewReplacementMutation({
						baseRevision: exit.baseRevision,
						operationId: exit.operationId,
						unitId: exit.unitId,
						text: value,
						excludeAssociatedReasoning: linkRequested
					});
					const draft = {
						unitId: exit.unitId,
						title: exit.title,
						text: value,
						originalText: exit.originalText,
						baseRevision: exit.baseRevision,
						operationId: exit.operationId,
						unitKind: exit.unitKind,
						uiState: exit.uiState
					};
					if (!preview.canCommit && exit.unitKind === "answer" && linkRequested && preview.associatedReasoningUnitIds.length > 0) {
						if (host.previewReplacementMutation({
							baseRevision: exit.baseRevision,
							operationId: exit.operationId,
							unitId: exit.unitId,
							text: value,
							excludeAssociatedReasoning: false
						}).canCommit && (preview.textChanged || preview.newlyExcludedAtomIds.length > 0)) {
							replacementReview = {
								draft,
								preview,
								excludeAssociatedReasoning: true
							};
							continue;
						}
					}
					if (!preview.canCommit) {
						ctx.ui.notify(text.replacementReviewBlocked(preview.disabledReason ?? "unavailable"), "warning");
						continue;
					}
					if (!preview.textChanged && preview.newlyExcludedAtomIds.length === 0) {
						ctx.ui.notify(text.replacementReviewNoop(), "info");
						continue;
					}
					if (exit.unitKind === "answer" && preview.associatedReasoningUnitIds.length > 0) {
						replacementReview = {
							draft,
							preview,
							excludeAssociatedReasoning: linkRequested
						};
						continue;
					}
					const result = host.commitReplacementMutation({
						baseRevision: exit.baseRevision,
						operationId: exit.operationId,
						unitId: exit.unitId,
						text: value,
						excludeAssociatedReasoning: false
					});
					if (!result.ok || result.conflict) ctx.ui.notify(text.sidecarChanged(), "warning");
					else if (!result.eventId) ctx.ui.notify(text.replacementReviewNoop(), "info");
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (message === "CONTEXT_EDITOR_CONFLICT") ctx.ui.notify(text.sidecarChanged(), "warning");
					else if (message === "CONTEXT_EDITOR_REPLACEMENT_EMPTY") ctx.ui.notify(text.replacementReviewBlocked(text.replacementEmpty()), "warning");
					else ctx.ui.notify(text.operationFailed(message), "warning");
				}
			}
		}
	});
}
//#endregion
export { contextEditorExtension as default };
