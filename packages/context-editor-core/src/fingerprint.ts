import type { AtomKind, ContextAtom } from './types.js'

/** Deterministic identity check; this is not intended as a security hash. */
export function stableFingerprint(parts: readonly string[]): string {
  let hash = 2166136261
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
    hash ^= 124
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function fingerprintBlock(
  kind: AtomKind,
  timestamp: number,
  toolCallId: string | undefined,
  text: string,
): string {
  return stableFingerprint([kind, String(timestamp), toolCallId ?? '', text])
}

/** Stable atom identity. Content belongs in fingerprint, not in the key. */
export function atomId(atom: Pick<ContextAtom, 'sourceRef' | 'kind'>): string {
  return `${atom.sourceRef.entryId}:${atom.sourceRef.blockIndex}:${atom.kind}`
}

/** ID emitted by the original ctx editor V1 implementation. */
export function legacyAtomId(
  atom: Pick<ContextAtom, 'sourceRef' | 'kind' | 'fingerprint'>,
): string {
  return `${atom.sourceRef.entryId}:${atom.sourceRef.blockIndex}:${atom.kind}:${atom.fingerprint}`
}

export function branchRevision(
  leafId: string | null | undefined,
  atoms: readonly ContextAtom[],
  extra: readonly string[] = [],
): string {
  return stableFingerprint([
    leafId ?? '',
    ...atoms.map((atom) => `${atom.id}:${atom.fingerprint}`),
    ...extra,
  ])
}
