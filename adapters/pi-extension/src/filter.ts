import { ATOM_KINDS, type AtomFilter, type AtomKind, type ContextAtom } from "./types.js";

export const DEFAULT_ENABLED_KINDS: ReadonlySet<AtomKind> = new Set([
  "user",
  "assistant_text",
]);

export function allEnabledKinds(): Set<AtomKind> {
  return new Set(ATOM_KINDS);
}

export function matchesFilter(atom: ContextAtom, filter: AtomFilter): boolean {
  if (!filter.enabledKinds.has(atom.kind)) return false;
  const query = filter.query.trim().toLocaleLowerCase();
  if (!query) return true;
  const haystack = [atom.kind, atom.toolName ?? "", atom.text].join(" ").toLocaleLowerCase();
  return haystack.includes(query);
}

export function filterAtoms(atoms: readonly ContextAtom[], filter: AtomFilter): ContextAtom[] {
  return atoms.filter((atom) => matchesFilter(atom, filter));
}

export function kindLabel(kind: AtomKind): string {
  switch (kind) {
    case "user":
      return "User";
    case "assistant_text":
      return "Assistant";
    case "reasoning":
      return "Reasoning";
    case "tool_call":
      return "Tool Call";
    case "tool_output":
      return "Tool Output";
    case "summary":
      return "Summary";
  }
}
