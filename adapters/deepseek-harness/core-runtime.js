/*
 * GENERATED FILE - do not edit directly.
 * Canonical Core source digest: 4b0873d1fb89c2d6429d7ac722b8e32d3f5406df98aef1bfb758de72cc68716b
 * Rebuild with: npm run build:deepseek
 */
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
function projectUnits(recordId, atoms, states) {
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
			mutable: true
		};
	});
}
function projectRecords(atoms, states) {
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
		const units = projectUnits(id, grouped, states).map((unit) => ({
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
			mutable
		};
	});
}
//#endregion
//#region packages/context-editor-core/src/search.ts
function normalizeSearchQuery(query) {
	return query.trim().toLocaleLowerCase();
}
function searchRecords(records, query, enabledKinds) {
	const needle = normalizeSearchQuery(query);
	if (!needle) return [];
	const grouped = /* @__PURE__ */ new Map();
	const addMatches = (record, unit, atomId, blockIndex, field, haystack, anchorEntryId = record.anchorEntryId) => {
		if (!haystack) return;
		const lowered = haystack.toLocaleLowerCase();
		let from = 0;
		while (from < lowered.length) {
			const start = lowered.indexOf(needle, from);
			if (start < 0) break;
			const group = grouped.get(unit.id) ?? {
				record,
				unit,
				occurrences: []
			};
			group.occurrences.push({
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
			grouped.set(unit.id, group);
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
			mutable: record.mutable
		}];
		for (const unit of units) for (const atom of unit.atoms) {
			if (atom.toolName) addMatches(record, unit, atom.id, atom.sourceRef.blockIndex, "tool_name", atom.toolName, atom.sourceRef.entryId);
			const field = atom.kind === "reasoning" ? "reasoning" : atom.kind === "tool_output" ? "tool_output" : atom.kind === "tool_call" ? "tool_args" : "message";
			addMatches(record, unit, atom.id, atom.sourceRef.blockIndex, field, atom.text, atom.sourceRef.entryId);
		}
	}
	const groups = Array.from(grouped.values());
	return groups.map((group, index) => {
		const first = group.occurrences[0];
		if (!first) throw new Error(`search record ${group.record.id} has no occurrence`);
		return {
			...first,
			index,
			total: groups.length,
			occurrenceCount: group.occurrences.length
		};
	});
}
//#endregion
export { projectRecords, searchRecords };
