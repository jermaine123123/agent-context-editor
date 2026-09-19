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

export interface ContextRecordPage<TRecord = unknown> {
  revision: string
  records: TRecord[]
  nextCursor?: string | null
  total?: number
}

export interface ContextRecordSnapshot<TRecord = unknown> {
  revision: string
  recordsIncluded?: boolean
  records?: TRecord[]
  recordCount?: number
  record?: TRecord | null
  recordIndex?: number
  nextCursor?: string | null
  total?: number
  [key: string]: unknown
}

export type ContextEditorPageCall<TRecord = unknown> = (
  method: string,
  payload: Record<string, unknown>,
) => Promise<ContextRecordSnapshot<TRecord>>

export declare function listContextRecordPage<TRecord = unknown>(
  call: ContextEditorPageCall<TRecord>,
  cursor: string | number | undefined,
  expectedRevision?: string,
  pageSize?: number,
): Promise<ContextRecordPage<TRecord>>

export declare function loadContextRecord<TRecord = unknown>(
  call: ContextEditorPageCall<TRecord>,
  recordId: string,
  expectedRevision?: string,
): Promise<{ found: boolean; record: TRecord | null; recordIndex?: number; total: number; revision?: string } | null>

export declare function loadInitialContextRecords<TRecord = unknown>(
  call: ContextEditorPageCall<TRecord>,
  attempt?: number,
): Promise<{ snapshot: ContextRecordSnapshot<TRecord>; records: TRecord[]; nextCursor: string | null; total: number }>

export declare function loadContextRecordsThrough<TRecord extends { id: string } = { id: string }>(
  call: ContextEditorPageCall<TRecord>,
  recordId: string,
  cursor: string | null,
  expectedRevision: string,
  initialRecords?: TRecord[],
): Promise<{ records: TRecord[]; nextCursor: string | null; total: number; found: boolean }>

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
