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
