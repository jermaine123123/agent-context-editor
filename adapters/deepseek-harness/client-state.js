export const CLIENT_KINDS = Object.freeze(['user', 'ai', 'tool'])
export const CLIENT_UNIT_KINDS = Object.freeze(['user', 'reasoning', 'answer', 'tool'])

/**
 * Normalize the persisted type filter without treating an explicit empty
 * array as malformed.  An empty array is the valid "show nothing" state;
 * missing or non-array values use the default filter.
 */
export function normalizeEnabledKinds(value, defaults = CLIENT_KINDS) {
  if (!Array.isArray(value)) return [...defaults]
  return [...new Set(value.filter(kind => CLIENT_KINDS.includes(kind)))]
}

export function toggleEnabledKind(enabledKinds, kind) {
  if (!CLIENT_KINDS.includes(kind)) return [...enabledKinds]
  return enabledKinds.includes(kind)
    ? enabledKinds.filter(value => value !== kind)
    : [...enabledKinds, kind]
}

/**
 * Normalize the persisted unit-level filter.  An explicit empty array means
 * that the user intentionally hid every unit and must remain empty.
 */
export function normalizeEnabledUnitKinds(value, defaults = CLIENT_UNIT_KINDS) {
  if (!Array.isArray(value)) return [...defaults]
  return [...new Set(value.filter(kind => CLIENT_UNIT_KINDS.includes(kind)))]
}

/** Migrate the V1 record-level filter into the V2 unit-level representation. */
export function migrateEnabledKindsToUnits(value, defaults = CLIENT_UNIT_KINDS) {
  if (!Array.isArray(value)) return [...defaults]
  const next = []
  for (const kind of value) {
    if (kind === 'user' || kind === 'tool') next.push(kind)
    else if (kind === 'ai') next.push('reasoning', 'answer')
  }
  return [...new Set(next)]
}

export function toggleEnabledUnitKind(enabledKinds, kind) {
  if (!CLIENT_UNIT_KINDS.includes(kind)) return [...enabledKinds]
  return enabledKinds.includes(kind)
    ? enabledKinds.filter(value => value !== kind)
    : [...enabledKinds, kind]
}

export function nextSearchIndex(currentIndex, delta, total) {
  if (!Number.isInteger(total) || total < 1) return 0
  const current = Number.isInteger(currentIndex) ? currentIndex : 0
  return (current + delta + total) % total
}

export async function listContextRecordPage(call, cursor, expectedRevision, pageSize = 100) {
  const page = await call('listRecords', {
    pageSize,
    ...(cursor === undefined || cursor === null ? {} : { cursor }),
  })
  if (expectedRevision !== undefined && String(page.revision) !== String(expectedRevision)) {
    throw new Error('CONTEXT_EDITOR_HISTORY_CHANGED_DURING_READ')
  }
  const startIndex = Math.max(0, Number.parseInt(String(cursor ?? 0), 10) || 0)
  return {
    ...page,
    records: (page.records ?? []).map((record, index) => record && typeof record === 'object'
      ? { ...record, historyIndex: Number.isSafeInteger(record.historyIndex) ? record.historyIndex : startIndex + index }
      : record),
  }
}

export async function loadContextRecord(call, recordId, expectedRevision) {
  let value
  try {
    value = await call('getRecord', { recordId })
  } catch (error) {
    if (/Remote method ['"].*getRecord.*unavailable/iu.test(String(error?.message ?? error))) return null
    throw error
  }
  if (value?.record == null) return { found: false, record: null, total: value?.total ?? 0 }
  if (typeof value.revision !== 'string' || !Number.isSafeInteger(value.recordIndex)) return null
  if (expectedRevision !== undefined && String(value.revision) !== String(expectedRevision)) {
    throw new Error('CONTEXT_EDITOR_HISTORY_CHANGED_DURING_READ')
  }
  return {
    found: true,
    record: { ...value.record, historyIndex: Number.isSafeInteger(value.record.historyIndex) ? value.record.historyIndex : value.recordIndex },
    recordIndex: value.recordIndex,
    total: value.total ?? 0,
    revision: value.revision,
  }
}

export async function loadInitialContextRecords(call, attempt = 0) {
  const snapshot = await call('getSnapshot', { includeRecords: false })
  // Older plugin builds ignore includeRecords and return a complete snapshot.
  if (snapshot?.recordsIncluded !== false && Array.isArray(snapshot?.records)) {
    return { snapshot, records: snapshot.records, nextCursor: null, total: snapshot.records.length }
  }
  try {
    const page = await listContextRecordPage(call, undefined, snapshot.revision)
    return {
      snapshot,
      records: page.records ?? [],
      nextCursor: page.nextCursor ?? null,
      total: page.total ?? snapshot.recordCount ?? 0,
    }
  } catch (error) {
    if (error?.message === 'CONTEXT_EDITOR_HISTORY_CHANGED_DURING_READ' && attempt < 2) {
      return loadInitialContextRecords(call, attempt + 1)
    }
    throw error
  }
}

export async function loadContextRecordsThrough(call, recordId, cursor, expectedRevision, initialRecords = []) {
  const records = [...initialRecords]
  let nextCursor = cursor ?? null
  let total = records.length
  for (let page = 0; nextCursor !== null && !records.some(record => record.id === recordId); page += 1) {
    if (page >= 100_000) throw new Error('CONTEXT_EDITOR_HISTORY_PAGE_LIMIT')
    const value = await listContextRecordPage(call, nextCursor, expectedRevision)
    records.push(...(value.records ?? []))
    nextCursor = value.nextCursor ?? null
    total = value.total ?? total
    if (!(value.records ?? []).length && nextCursor !== null) throw new Error('CONTEXT_EDITOR_HISTORY_PAGE_EMPTY')
  }
  return { records, nextCursor, total, found: records.some(record => record.id === recordId) }
}

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

/**
 * Return the scroll offset that places a target in the middle of the usable
 * viewport.  The usable viewport starts below the sticky Context Editor
 * controls and ends at the scroll container's bottom edge.  The returned
 * value is always clamped to the container's actual scroll range, so short
 * documents and first/last matches naturally degrade to the closest visible
 * position.
 */
export function computeCenteredScrollTop({
  currentScrollTop = 0,
  scrollHeight = 0,
  clientHeight = 0,
  containerTop = 0,
  containerBottom,
  controlsBottom = containerTop,
  targetTop = 0,
  targetBottom = targetTop,
  gap = 12,
} = {}) {
  const current = finiteNumber(currentScrollTop)
  const height = Math.max(0, finiteNumber(clientHeight))
  const contentHeight = Math.max(0, finiteNumber(scrollHeight))
  const maximum = Math.max(0, contentHeight - height)
  if (maximum === 0) return Math.min(Math.max(current, 0), maximum)

  const top = finiteNumber(containerTop)
  const bottom = finiteNumber(containerBottom, top + height)
  const inset = Math.max(0, finiteNumber(gap, 12))
  const usableTop = Math.max(top, finiteNumber(controlsBottom, top)) + inset
  const usableBottom = Math.min(bottom, bottom - inset)
  const usableCenter = usableBottom > usableTop
    ? (usableTop + usableBottom) / 2
    : top + height / 2
  const targetCenter = (finiteNumber(targetTop) + finiteNumber(targetBottom, targetTop)) / 2
  const desired = current + targetCenter - usableCenter
  return Math.min(Math.max(desired, 0), maximum)
}
