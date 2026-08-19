export declare const CLIENT_KINDS: readonly ['user', 'ai', 'tool']
export declare const CLIENT_UNIT_KINDS: readonly ['user', 'reasoning', 'answer', 'tool']

export declare function normalizeEnabledKinds(
  value: unknown,
  defaults?: readonly string[],
): string[]

export declare function toggleEnabledKind(
  enabledKinds: readonly string[],
  kind: string,
): string[]

export declare function normalizeEnabledUnitKinds(
  value: unknown,
  defaults?: readonly string[],
): string[]

export declare function migrateEnabledKindsToUnits(
  value: unknown,
  defaults?: readonly string[],
): string[]

export declare function toggleEnabledUnitKind(
  enabledKinds: readonly string[],
  kind: string,
): string[]

export declare function nextSearchIndex(currentIndex: number, delta: number, total: number): number

export interface CenteredScrollGeometry {
  currentScrollTop?: number
  scrollHeight?: number
  clientHeight?: number
  containerTop?: number
  containerBottom?: number
  controlsBottom?: number
  targetTop?: number
  targetBottom?: number
  gap?: number
}

export declare function computeCenteredScrollTop(input?: CenteredScrollGeometry): number
