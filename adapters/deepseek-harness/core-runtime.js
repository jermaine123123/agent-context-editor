/*
 * GENERATED FILE - do not edit directly.
 * Canonical Core source digest: 5b40cd1f4132deba15505e61db10055c5247c189d9a7562aaefc0ff37bc3658e
 * Rebuild with: npm run build:deepseek
 */
//#region packages/context-editor-core/src/projection.ts
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
//#endregion
export { atomMatchesSearchScope, projectRecords, reduceProjectionStates, searchRecords, selectProjectionTargets };
