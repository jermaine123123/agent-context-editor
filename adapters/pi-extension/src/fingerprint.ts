import type { AtomKind, ContextAtom } from "./types.js";

/** Small deterministic hash; it is an identity check, not a security primitive. */
export function stableFingerprint(parts: readonly string[]): string {
  let hash = 2166136261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index++) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 124;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintBlock(
  kind: AtomKind,
  timestamp: number,
  toolCallId: string | undefined,
  text: string,
): string {
  return stableFingerprint([kind, String(timestamp), toolCallId ?? "", text]);
}

export function atomId(atom: Pick<ContextAtom, "sourceRef" | "kind" | "fingerprint">): string {
  return `${atom.sourceRef.entryId}:${atom.sourceRef.blockIndex}:${atom.kind}:${atom.fingerprint}`;
}
