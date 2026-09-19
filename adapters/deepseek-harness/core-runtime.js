/*
 * GENERATED FILE - do not edit directly.
 * Canonical Core source digest: fbe593c146890700434ebd0da5029d5337677db1fa8663cc2495ad358a9f7acc
 * Rebuild with: npm run build:deepseek
 */
//#region packages/context-editor-core/src/projection.ts
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
function selectProjectionTargets(records, unitIds, recordIds, options = {}) {
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
	if (selectedTool && !options.preserveSignedReasoning || selectedSignedReasoning) {
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
//#region packages/context-editor-core/src/records.ts
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
//#region packages/context-editor-core/src/search.ts
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
//#endregion
//#region packages/context-editor-core/src/fingerprint.ts
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
//#endregion
//#region packages/context-editor-core/src/condensation.ts
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
export { atomMatchesSearchScope, deriveCondensationCoverage, estimateCondensationTokens, frameCondensationSummary, projectRecords, reduceProjectionStates, reduceReplacementStates, searchRecords, selectAssociatedReasoningTargets, selectCondensationRange, selectProjectionTargets, validateCondensationSummary };
