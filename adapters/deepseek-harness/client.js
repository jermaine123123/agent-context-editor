/**
 * Browser half of the Context Editor Harness adapter.
 *
 * It contributes a single `conversation.view` tab.  The view owns a
 * per-Session controller, paginates through Host records, and treats every
 * asynchronous response as latest-wins so an old search/page cannot overwrite
 * the current Session state.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { contextEditorRemote } from './remote.js'
import { createHarnessText, detectHarnessLocale } from './locale.js'
import {
  CLIENT_KINDS,
  CLIENT_UNIT_KINDS,
  computeCenteredScrollTop,
  migrateEnabledKindsToUnits,
  nextSearchIndex,
  normalizeEnabledUnitKinds,
  toggleEnabledUnitKind,
} from './client-state.js'
import './client.css'

export const inject = ['remote']

const h = React.createElement
const ALL_KINDS = CLIENT_KINDS
const ALL_UNIT_KINDS = CLIENT_UNIT_KINDS
const PREFS_KEY_V1 = 'dsh-context-editor:prefs:v1'
const PREFS_KEY_V2 = 'dsh-context-editor:prefs:v2'

function unwrap(value) {
  if (value && value.ok === false && value.error !== undefined) {
    const error = new Error(value.error.message ?? value.error.code ?? 'Context Editor Remote failed')
    Object.assign(error, value.error)
    throw error
  }
  // Generated Typert clients wrap the business result in { ok, value }.
  if (value && value.ok === true && Object.prototype.hasOwnProperty.call(value, 'value')) return value.value
  return value
}

function safePreferences() {
  const defaults = { enabledUnitKinds: [...ALL_UNIT_KINDS], showHidden: false }
  try {
    const rawV2 = globalThis.localStorage?.getItem(PREFS_KEY_V2)
    if (rawV2) {
      const value = JSON.parse(rawV2)
      if (Array.isArray(value?.enabledUnitKinds)) {
        return {
          enabledUnitKinds: normalizeEnabledUnitKinds(value.enabledUnitKinds, defaults.enabledUnitKinds),
          showHidden: Boolean(value?.showHidden),
        }
      }
    }
    const rawV1 = globalThis.localStorage?.getItem(PREFS_KEY_V1)
    if (rawV1) {
      const value = JSON.parse(rawV1)
      if (Array.isArray(value?.enabledKinds)) {
        return {
          enabledUnitKinds: migrateEnabledKindsToUnits(value.enabledKinds, defaults.enabledUnitKinds),
          showHidden: Boolean(value?.showHidden),
        }
      }
    }
    return defaults
  } catch {
    return defaults
  }
}

function savePreferences(value) {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY_V2, JSON.stringify(value))
  } catch {
    // Private browsing/storage-disabled pages keep the preference in memory.
  }
}

function unitsForRecord(record) {
  const atoms = Array.isArray(record?.atoms) ? record.atoms : []
  const byId = new Map(atoms.map(atom => [atom.id, atom]))
  if (Array.isArray(record?.units) && record.units.length > 0) {
    return record.units.map(unit => ({
      ...unit,
      atoms: Array.isArray(unit.atoms) && unit.atoms.length > 0
        ? unit.atoms
        : (unit.atomIds ?? []).map(id => byId.get(id)).filter(Boolean),
    }))
  }
  const kind = record?.kind === 'ai' ? 'answer' : record?.kind
  return [{
    id: `${record.id}#${kind}`,
    recordId: record.id,
    kind,
    atomIds: atoms.map(atom => atom.id),
    atoms,
    viewState: record.viewState,
    mutable: record.mutable,
    projectionState: record.projectionState ?? 'include',
  }]
}

function highlight(text, match) {
  if (!match || typeof text !== 'string') return text
  const start = Math.max(0, Math.min(text.length, Number(match.start) || 0))
  const end = Math.max(start, Math.min(text.length, Number(match.end) || start))
  return h(React.Fragment, null,
    text.slice(0, start),
    h('mark', { className: 'context-editor__hit' }, text.slice(start, end)),
    text.slice(end),
  )
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error')
}

function isScrollableElement(element) {
  if (!element || typeof element.scrollHeight !== 'number' || typeof element.clientHeight !== 'number') return false
  if (element.scrollHeight <= element.clientHeight + 1) return false
  const style = globalThis.getComputedStyle?.(element)
  if (!style) return true
  const overflowY = style.overflowY || style.overflow || ''
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
}

function findScrollableContainer(node) {
  let current = node?.parentElement ?? null
  while (current) {
    if (isScrollableElement(current)) return current
    current = current.parentElement
  }
  const documentObject = globalThis.document
  return documentObject?.scrollingElement
    ?? documentObject?.documentElement
    ?? documentObject?.body
    ?? null
}

function elementRect(element, fallbackHeight = 0) {
  const documentObject = globalThis.document
  const isDocumentScroller = element && (
    element === documentObject?.scrollingElement
    || element === documentObject?.documentElement
    || element === documentObject?.body
  )
  if (isDocumentScroller) {
    const viewportHeight = Number(globalThis.innerHeight)
      || Number(documentObject?.documentElement?.clientHeight)
      || Number(element.clientHeight)
      || fallbackHeight
    return { top: 0, bottom: viewportHeight }
  }
  const rect = element?.getBoundingClientRect?.()
  if (rect && Number.isFinite(rect.top) && Number.isFinite(rect.bottom)) {
    return { top: rect.top, bottom: rect.bottom }
  }
  const height = Number.isFinite(Number(element?.clientHeight))
    ? Number(element.clientHeight)
    : fallbackHeight
  return { top: 0, bottom: height }
}

function scrollTopOf(element) {
  return Number.isFinite(Number(element?.scrollTop)) ? Number(element.scrollTop) : 0
}

function scrollToTop(element, top, behavior) {
  if (!element) return
  const left = Number.isFinite(Number(element.scrollLeft)) ? Number(element.scrollLeft) : 0
  const options = { top, left, behavior }
  if (typeof element.scrollTo === 'function') {
    try {
      element.scrollTo(options)
      return
    } catch {
      try {
        element.scrollTo(0, top)
        return
      } catch {
        // Fall through to the scrollTop assignment below.
      }
    }
  }
  if (element === globalThis.document?.scrollingElement && typeof globalThis.scrollTo === 'function') {
    try {
      globalThis.scrollTo({ top, behavior })
      return
    } catch {
      // Fall through to the scrollTop assignment below.
    }
  }
  try {
    element.scrollTop = top
  } catch {
    // A detached or read-only host element can be ignored safely.
  }
}

function enabledRecordKindsForUnits(enabledUnitKinds) {
  const enabled = new Set(enabledUnitKinds)
  return ALL_KINDS.filter(kind => kind === 'ai'
    ? enabled.has('reasoning') || enabled.has('answer')
    : enabled.has(kind))
}

function unitFilterState(enabledUnitKinds, kind) {
  return enabledUnitKinds.includes(kind) ? 'on' : 'off'
}

function aiFilterState(enabledUnitKinds) {
  const reasoning = enabledUnitKinds.includes('reasoning')
  const answer = enabledUnitKinds.includes('answer')
  if (reasoning && answer) return 'on'
  if (!reasoning && !answer) return 'off'
  return 'mixed'
}

/** Thin generated-Remote consumer with no global Session state. */
export class ContextEditorController {
  constructor(remote, sessionId) {
    this.remote = remote
    this.sessionId = String(sessionId)
    this.disposed = false
    this.sequence = 0
  }

  dispose() {
    this.disposed = true
    this.sequence += 1
  }

  async call(method, payload = {}) {
    if (this.disposed) throw new Error('Context Editor controller is disposed')
    const fn = this.remote?.[method]
    if (typeof fn !== 'function') throw new Error(`Context Editor Remote method '${method}' is unavailable`)
    const response = await fn({
      sessionId: this.sessionId,
      locator: { host: 'deepseek-harness', sessionId: this.sessionId },
      ...payload,
    })
    return unwrap(response)
  }

  async load() {
    const ticket = ++this.sequence
    const snapshot = await this.call('getSnapshot')
    const records = []
    let cursor = undefined
    for (let page = 0; page < 512; page += 1) {
      const value = await this.call('listRecords', { pageSize: 100, ...(cursor === undefined ? {} : { cursor }) })
      if (value.revision !== snapshot.revision) {
        // The source log or sidecar changed between the snapshot and page
        // read; restart once from the new revision rather than mixing pages.
        if (ticket !== this.sequence) return null
        return this.load()
      }
      records.push(...(value.records ?? []))
      if (value.nextCursor === null || value.nextCursor === undefined) break
      cursor = value.nextCursor
    }
    if (ticket !== this.sequence) return null
    return { snapshot, records }
  }

  async search(query, enabledKinds, scope = 'dialogue', enabledUnitKinds) {
    const value = await this.call('searchRecords', {
      query,
      enabledKinds,
      scope,
      ...(enabledUnitKinds === undefined ? {} : { enabledUnitKinds }),
    })
    return value
  }

  async match(searchId, index, revision) {
    return this.call('getSearchMatch', { searchId, index, revision })
  }

  async commit(action, baseRevision, unitIds) {
    return this.call('commitView', {
      action,
      baseRevision,
      ...(unitIds === undefined ? {} : { unitIds }),
    })
  }

  async undo(baseRevision) {
    return this.call('undoView', { baseRevision })
  }

  async previewContext(action, expectedRevision, unitIds) {
    return this.call('previewContext', {
      action,
      expectedRevision,
      ...(unitIds === undefined ? {} : { unitIds }),
    })
  }

  async commitContext(operationId, action, expectedRevision, unitIds) {
    return this.call('commitContext', {
      operationId,
      action,
      expectedRevision,
      ...(unitIds === undefined ? {} : { unitIds }),
    })
  }

  replacementOperationId(action, unitId) {
    return `context-replacement-${action}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${String(unitId).slice(-12)}`
  }

  async commitReplacement(unitId, baseRevision, text) {
    return this.call('commitReplacement', { operationId: this.replacementOperationId('replace', unitId), unitId, baseRevision, text })
  }

  async restoreReplacement(unitId, baseRevision) {
    return this.call('restoreReplacement', { operationId: this.replacementOperationId('restore', unitId), unitId, baseRevision })
  }

  async undoReplacement(unitId, baseRevision) {
    return this.call('undoReplacement', { operationId: this.replacementOperationId('undo', unitId), unitId, baseRevision })
  }
}

function FilterButton({ kind, state, onClick, text, label }) {
  const enabled = state === 'on'
  return h('button', {
    type: 'button',
    className: `context-editor__filter ${enabled ? 'is-active' : ''} ${state === 'mixed' ? 'is-mixed' : ''}`,
    'data-filter-kind': kind,
    'data-filter-state': state,
    onClick,
    'aria-pressed': enabled,
    'aria-checked': state,
    role: 'checkbox',
  }, label ?? text.kind(kind))
}

function UnitBody({ unit, match, text, showOriginal = false }) {
  const atoms = unit.atoms ?? []
  if (!atoms.length) return h('span', { className: 'context-editor__empty' }, text.empty)
  if (unit.kind === 'user' || unit.kind === 'answer') {
    const value = showOriginal
      ? atoms.map(atom => atom.text ?? '').join('\n')
      : (unit.effectiveText ?? atoms.map(atom => atom.text ?? '').join('\n'))
    const anchor = atoms.at(-1)?.id
    return h('div', { className: 'context-editor__record-body' },
      h('div', { className: `context-editor__atom context-editor__atom--${unit.kind}` },
        h('span', null, !showOriginal && match?.atomId === anchor ? highlight(value, match) : value),
      ),
    )
  }
  return h('div', { className: 'context-editor__record-body' }, atoms.map(atom => {
    const atomMatch = match?.atomId === atom.id && match?.field !== 'tool_name'
    const toolName = atom.toolName
      ? h('span', { className: 'context-editor__tool-name' }, `${atom.toolName}: `)
      : null
    return h('div', { key: atom.id, className: `context-editor__atom context-editor__atom--${atom.kind}` },
      toolName,
      h('span', null, atomMatch ? highlight(atom.text ?? '', match) : (atom.text ?? '')),
    )
  }))
}

function EditDialog({ unit, initialText, text, onCancel, onSave }) {
  const [value, setValue] = useState(initialText)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const textarea = useRef(null)

  useEffect(() => {
    setValue(initialText)
    setError('')
    const timer = globalThis.setTimeout?.(() => textarea.current?.focus?.(), 0)
    return () => {
      if (timer !== undefined) globalThis.clearTimeout?.(timer)
    }
  }, [initialText, unit.id])

  const submit = async () => {
    if (saving) return
    if (value.trim().length === 0) {
      setError(text.replacementEmpty)
      return
    }
    if (value === initialText) {
      onCancel()
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(value)
    } catch (cause) {
      setSaving(false)
      setError(errorText(cause))
    }
  }

  const onKeyDown = event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!saving) onCancel()
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void submit()
    }
  }

  return h('div', { className: 'context-editor__dialog-backdrop' },
    h('div', {
      className: 'context-editor__dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': text.editTitle(unit.kind),
      onKeyDown,
    },
    h('div', { className: 'context-editor__dialog-header' },
      h('h2', null, text.editTitle(unit.kind)),
      h('button', { type: 'button', className: 'context-editor__dialog-close', disabled: saving, onClick: onCancel, 'aria-label': text.cancel }, '×'),
    ),
    h('textarea', {
      ref: textarea,
      className: 'context-editor__dialog-input',
      value,
      onChange: event => setValue(event.target.value),
      spellCheck: false,
      disabled: saving,
      'aria-label': text.editTitle(unit.kind),
    }),
    h('div', { className: 'context-editor__dialog-hint' }, 'Ctrl/Cmd+Enter', ' · ', text.cancel, ' Esc'),
    error ? h('div', { className: 'context-editor__dialog-error', role: 'alert' }, error) : null,
    h('div', { className: 'context-editor__dialog-actions' },
      h('button', { type: 'button', disabled: saving, onClick: onCancel }, text.cancel),
      h('button', { type: 'button', disabled: saving, onClick: () => void submit() }, saving ? text.loading : text.save),
    ),
    ),
  )
}

function UnitSection({ unit, selected, onSelect, focused, showHidden, showOriginal, match, disabled, onRestore, onContextToggle, onEdit, onRestoreReplacement, onUndoReplacement, onCompareOriginal, replacementAvailable, registerNode, text }) {
  const hidden = unit.viewState === 'hide' || unit.viewState === 'mixed'
  const mixed = unit.viewState === 'mixed'
  const projectionState = unit.projectionState ?? 'include'
  const contextExcluded = projectionState === 'exclude' || projectionState === 'mixed'
  const contextUnavailable = projectionState === 'unavailable'
  const isEditableKind = unit.kind === 'user' || unit.kind === 'answer'
  const replacementSupported = unit.replacementSupported === true
  const replacementTitle = !replacementAvailable
    ? text.replacementDisabled
    : text.replacementUnavailable(unit.replacementDisabledReason)
  const body = hidden && !showHidden
    ? h('div', { className: 'context-editor__unit-placeholder' }, mixed ? text.mixedPlaceholder : text.hiddenPlaceholder(unit.kind))
    : h(UnitBody, { unit, match, text, showOriginal })
  return h('div', {
    className: `context-editor__unit ${focused ? 'is-focused' : ''} ${hidden ? 'is-hidden' : ''} ${contextExcluded ? 'is-context-excluded' : ''}`,
    'data-unit-id': unit.id,
    'data-unit-kind': unit.kind,
    'data-context-state': projectionState,
    ref: node => registerNode?.(unit.id, node),
  },
  h('div', { className: 'context-editor__unit-header' },
    h('label', { className: 'context-editor__unit-select' },
      h('input', { type: 'checkbox', checked: selected, disabled, onChange: event => onSelect(event) }),
      h('span', { className: 'context-editor__unit-kind' }, text.unitKind(unit.kind)),
    ),
    mixed ? h('span', { className: 'context-editor__hidden-badge' }, text.partiallyHidden) : null,
    hidden && !mixed ? h('span', { className: 'context-editor__hidden-badge' }, text.hidden) : null,
    contextExcluded ? h('span', { className: 'context-editor__context-badge' }, text.contextState(projectionState)) : null,
    contextUnavailable ? h('span', { className: 'context-editor__context-badge is-unavailable' }, text.contextState(projectionState)) : null,
    hidden ? h('button', { type: 'button', disabled, onClick: onRestore }, text.restore) : null,
    isEditableKind && unit.replacementState === 'replaced'
      ? h('span', { className: 'context-editor__replacement-badge', title: text.edited }, text.edited)
      : null,
    isEditableKind && !replacementSupported
      ? h('span', { className: 'context-editor__replacement-reason', title: replacementTitle }, replacementTitle)
      : null,
    isEditableKind && replacementSupported
      ? h('div', { className: 'context-editor__replacement-actions' },
        h('button', {
          type: 'button',
          disabled: disabled || !replacementAvailable,
          onClick: onEdit,
          title: !replacementAvailable ? text.replacementDisabled : text.editTitle(unit.kind),
        }, text.edit),
        unit.canRestoreReplacement
          ? h('button', { type: 'button', disabled: disabled || !replacementAvailable, onClick: onRestoreReplacement }, text.restoreOriginal)
          : null,
        unit.canUndoReplacement
          ? h('button', { type: 'button', disabled: disabled || !replacementAvailable, onClick: onUndoReplacement }, text.undoReplacement)
          : null,
        unit.replacementState === 'replaced'
          ? h('button', { type: 'button', onClick: onCompareOriginal }, showOriginal ? text.showEffective : text.compareOriginal)
          : null,
      )
      : null,
    h('button', {
      type: 'button',
      className: 'context-editor__context-toggle',
      disabled: disabled || contextUnavailable,
      onClick: onContextToggle,
    }, contextExcluded ? text.restoreContext : text.excludeContext),
  ),
  h('div', { className: 'context-editor__unit-body' }, body),
  )
}

function RecordRow({ record, selected, onSelect, focusedUnitId, showHidden, showOriginalUnitId, match, disabled, onRestore, onContextToggle, onEdit, onRestoreReplacement, onUndoReplacement, onCompareOriginal, replacementAvailable, registerNode, text }) {
  const units = unitsForRecord(record)
  const focused = units.some(unit => unit.id === focusedUnitId)
  return h('article', {
    className: `context-editor__row ${focused ? 'is-focused' : ''}`,
    'data-record-id': record.id,
  },
  h('div', { className: 'context-editor__row-content' },
    h('div', { className: 'context-editor__row-meta' },
      h('span', { className: 'context-editor__kind' }, text.kind(record.kind)),
      record.toolCallId ? h('code', null, record.toolCallId) : null,
    ),
    h('div', { className: 'context-editor__units' }, units.map(unit => h(UnitSection, {
      key: unit.id,
      unit,
      selected: selected.has(unit.id),
      onSelect: event => onSelect(unit, event),
      focused: focusedUnitId === unit.id,
      showHidden,
      showOriginal: showOriginalUnitId === unit.id,
      match: focusedUnitId === unit.id ? match : null,
      disabled,
      onRestore: () => onRestore(unit.id),
      onContextToggle: () => onContextToggle(unit),
      onEdit: () => onEdit(unit),
      onRestoreReplacement: () => onRestoreReplacement(unit),
      onUndoReplacement: () => onUndoReplacement(unit),
      onCompareOriginal: () => onCompareOriginal(unit),
      replacementAvailable,
      registerNode,
      text,
    }))),
  ),
  )
}

/** Context Editor tab body.  The parent ConversationSession keeps the shared composer. */
export function ContextEditorView({ sessionId, controller, useSession }) {
  const [locale] = useState(() => detectHarnessLocale())
  const text = useMemo(() => createHarnessText(locale), [locale])
  const running = useSession(snapshot => Boolean(snapshot?.running))
  const [prefs, setPrefs] = useState(safePreferences)
  const [loaded, setLoaded] = useState({ status: 'loading', snapshot: null, records: [], error: null })
  const [query, setQuery] = useState('')
  const [searchScope, setSearchScope] = useState('dialogue')
  const [search, setSearch] = useState(null)
  const [searchIndex, setSearchIndex] = useState(0)
  const [match, setMatch] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [matching, setMatching] = useState(false)
  const [contextMutating, setContextMutating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [comparisonUnitId, setComparisonUnitId] = useState(null)
  const [notice, setNotice] = useState('')
  const lastSelectedIndex = useRef(null)
  const loadSequence = useRef(0)
  const searchSequence = useRef(0)
  const matchSequence = useRef(0)
  const navigationIndexRef = useRef(0)
  const requestedIndexRef = useRef(0)
  const scrollSequence = useRef(0)
  const unitNodes = useRef(new Map())
  const searchInput = useRef(null)
  const controlsNode = useRef(null)
  const editFocus = useRef(null)

  useEffect(() => {
    // Search scope is deliberately window-local. A reused tab that switches
    // Sessions must not carry a previous Session's full-scope choice over.
    setSearchScope('dialogue')
    setSearch(null)
    setMatch(null)
    setSearchIndex(0)
    setEditing(null)
    setComparisonUnitId(null)
    setNotice('')
  }, [sessionId])

  const registerUnitNode = useCallback((unitId, node) => {
    if (node) unitNodes.current.set(unitId, node)
    else unitNodes.current.delete(unitId)
  }, [])

  const enabledRecordKinds = useMemo(() => enabledRecordKindsForUnits(prefs.enabledUnitKinds), [prefs.enabledUnitKinds])
  const visibleRecords = useMemo(() => {
    const records = []
    for (const record of loaded.records) {
      if (!enabledRecordKinds.includes(record.kind)) continue
      const units = unitsForRecord(record)
      const visibleUnitsForRecord = record.kind === 'ai'
        ? units.filter(unit => prefs.enabledUnitKinds.includes(unit.kind))
        : units
      if (visibleUnitsForRecord.length === 0) continue
      records.push(visibleUnitsForRecord.length === units.length
        ? record
        : { ...record, units: visibleUnitsForRecord })
    }
    return records
  }, [enabledRecordKinds, loaded.records, prefs.enabledUnitKinds])
  const visibleUnits = useMemo(() => visibleRecords.flatMap(record => unitsForRecord(record)), [visibleRecords])
  const selectedCount = selected.size
  const readOnly = running || loaded.status === 'loading' || loaded.status === 'refreshing' || contextMutating
  const contextAvailable = loaded.snapshot?.capabilities?.contextExclusion === true
  const replacementAvailable = loaded.snapshot?.capabilities?.contextReplacement === true

  const refresh = useCallback(async (preserveSelection = false) => {
    const ticket = ++loadSequence.current
    setLoaded(current => ({ ...current, status: current.snapshot ? 'refreshing' : 'loading', error: null }))
    try {
      const value = await controller.load()
      if (value === null || ticket !== loadSequence.current) return
      setLoaded({ status: 'ready', ...value, error: null })
      if (!preserveSelection) {
        setSelected(new Set())
        lastSelectedIndex.current = null
      }
    } catch (error) {
      if (ticket === loadSequence.current) setLoaded(current => ({ ...current, status: 'error', error }))
    }
  }, [controller])

  useEffect(() => {
    void refresh()
  }, [controller, refresh])

  // Running is read-only: the next settled edge refreshes the durable log and
  // re-enables view mutations without fabricating a partial record.
  useEffect(() => {
    if (!running) void refresh()
  }, [running, refresh])

  useEffect(() => {
    const visibleIds = new Set(visibleUnits.map(unit => unit.id))
    setSelected(current => {
      const next = new Set([...current].filter(id => visibleIds.has(id)))
      if (next.size === current.size && [...next].every(id => current.has(id))) return current
      return next
    })
    // A Shift range is defined in the current flattened visible order.
    // Changing filters invalidates the previous anchor.
    lastSelectedIndex.current = null
  }, [visibleUnits])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key !== '/' || event.defaultPrevented) return
      const target = event.target
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      searchInput.current?.focus?.()
    }
    globalThis.addEventListener?.('keydown', onKeyDown)
    return () => globalThis.removeEventListener?.('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const ticket = ++searchSequence.current
    const matchTicket = ++matchSequence.current
    const needle = query.trim()
    setSearch(null)
    setMatch(null)
    setSearchIndex(0)
    setMatching(false)
    navigationIndexRef.current = 0
    requestedIndexRef.current = 0
    setSelected(new Set())
    lastSelectedIndex.current = null
    if (!needle) {
      return undefined
    }
    const timer = setTimeout(() => {
      void (async () => {
        if (ticket !== searchSequence.current) return
        setMatching(true)
        try {
          const value = await controller.search(needle, enabledRecordKinds, searchScope, prefs.enabledUnitKinds)
          if (ticket !== searchSequence.current) return
          setSearch(value)
          if (value.total < 1) {
            setSearchIndex(0)
            setMatching(false)
            return
          }
          const first = await controller.match(value.searchId, 0, value.revision)
          if (ticket === searchSequence.current && matchTicket === matchSequence.current) {
            navigationIndexRef.current = 0
            requestedIndexRef.current = 0
            setSearchIndex(0)
            setMatch(first)
            setMatching(false)
          }
        } catch (error) {
          if (ticket === searchSequence.current) {
            setSearch({ error })
            setMatch(null)
            setMatching(false)
          }
        }
      })()
    }, 120)
    return () => clearTimeout(timer)
  }, [controller, enabledRecordKinds, prefs.enabledUnitKinds, query, searchScope])

  useEffect(() => {
    const ticket = ++scrollSequence.current
    const unitId = match?.unitId
    if (!unitId) return undefined
    let frame
    let initialTimer
    let correctionTimer
    let correctionFrame
    const scroll = behavior => {
      if (ticket !== scrollSequence.current) return
      const node = unitNodes.current.get(unitId)
      if (!node) return
      // A reasoning/answer unit can be much taller than the viewport.  Scrolling
      // its root to the center may leave the actual hit at the top or bottom
      // outside the viewport, so prefer the rendered current hit when present.
      const target = node.querySelector('mark.context-editor__hit') ?? node
      const container = findScrollableContainer(node)
      if (!container) return
      const containerRect = elementRect(container, globalThis.innerHeight ?? 0)
      const targetRect = elementRect(target)
      const controlsRect = elementRect(controlsNode.current)
      const currentScrollTop = scrollTopOf(container)
      const nextScrollTop = computeCenteredScrollTop({
        currentScrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        containerTop: containerRect.top,
        containerBottom: containerRect.bottom,
        controlsBottom: controlsRect.bottom,
        targetTop: targetRect.top,
        targetBottom: targetRect.bottom,
      })
      if (Math.abs(nextScrollTop - currentScrollTop) > 1) {
        scrollToTop(container, nextScrollTop, behavior)
      }
    }
    const settle = () => {
      if (ticket !== scrollSequence.current) return
      if (typeof globalThis.requestAnimationFrame === 'function') {
        correctionFrame = globalThis.requestAnimationFrame(() => scroll('auto'))
      } else {
        scroll('auto')
      }
    }
    const schedule = () => {
      if (ticket !== scrollSequence.current) return
      scroll('smooth')
      correctionTimer = globalThis.setTimeout(settle, 350)
    }
    if (typeof globalThis.requestAnimationFrame === 'function') {
      frame = globalThis.requestAnimationFrame(schedule)
    } else {
      initialTimer = globalThis.setTimeout(schedule, 0)
    }
    return () => {
      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame)
      if (initialTimer !== undefined) globalThis.clearTimeout?.(initialTimer)
      if (correctionTimer !== undefined) globalThis.clearTimeout?.(correctionTimer)
      if (correctionFrame !== undefined) globalThis.cancelAnimationFrame?.(correctionFrame)
    }
  }, [loaded.records, match?.atomId, match?.end, match?.field, match?.start, match?.unitId, prefs.enabledUnitKinds, search?.searchId, searchIndex])

  const updatePrefs = useCallback(next => {
    setPrefs(current => {
      const value = { ...current, ...next }
      savePreferences(value)
      return value
    })
  }, [])

  const toggleUnitKind = kind => {
    updatePrefs({ enabledUnitKinds: toggleEnabledUnitKind(prefs.enabledUnitKinds, kind) })
  }

  const toggleAiKind = () => {
    const bothEnabled = prefs.enabledUnitKinds.includes('reasoning') && prefs.enabledUnitKinds.includes('answer')
    const next = bothEnabled
      ? prefs.enabledUnitKinds.filter(kind => kind !== 'reasoning' && kind !== 'answer')
      : [...new Set([...prefs.enabledUnitKinds, 'reasoning', 'answer'])]
    updatePrefs({ enabledUnitKinds: next })
  }

  const toggleSearchScope = () => {
    setSearchScope(current => current === 'dialogue' ? 'all' : 'dialogue')
    setSearchIndex(0)
    setMatch(null)
    setSelected(new Set())
    lastSelectedIndex.current = null
  }

  const selectUnit = (unit, event) => {
    const index = visibleUnits.findIndex(value => value.id === unit.id)
    setSelected(current => {
      const next = new Set(current)
      if (event.shiftKey && lastSelectedIndex.current !== null) {
        const start = Math.min(lastSelectedIndex.current, index)
        const end = Math.max(lastSelectedIndex.current, index)
        for (const value of visibleUnits.slice(start, end + 1)) next.add(value.id)
      } else if (next.has(unit.id)) {
        next.delete(unit.id)
      } else {
        next.add(unit.id)
      }
      return next
    })
    lastSelectedIndex.current = index
  }

  const mutate = async (action, unitIds) => {
    if (readOnly || loaded.snapshot === null) return
    try {
      const value = await controller.commit(action, loaded.snapshot.revision, unitIds)
      if (value?.conflict) {
        await refresh()
        return
      }
      await refresh()
    } catch (error) {
      setLoaded(current => ({ ...current, status: 'error', error }))
    }
  }

  const mutateContext = async (action, unitIds) => {
    if (readOnly || !contextAvailable || loaded.snapshot === null) return
    setContextMutating(true)
    try {
      const preview = await controller.previewContext(action, loaded.snapshot.revision, unitIds)
      if (preview?.conflict) {
        await refresh()
        return
      }
      const estimate = preview?.tokenEstimate ?? {}
      const closureCount = Math.max(0, (preview?.effectiveTargets?.length ?? 0) - (preview?.normalizedTargets?.length ?? 0))
      const warning = text.contextPreview(estimate.before, estimate.after, estimate.delta, closureCount)
      let confirmed = true
      if (typeof globalThis.confirm === 'function') {
        try { confirmed = globalThis.confirm(warning) } catch { confirmed = true }
      }
      if (!confirmed) return
      const value = await controller.commitContext(
        preview.operationId,
        action,
        preview.expectedRevision ?? loaded.snapshot.revision,
        unitIds,
      )
      if (value?.conflict) {
        await refresh()
        return
      }
      await refresh()
    } catch (error) {
      setLoaded(current => ({ ...current, status: 'error', error }))
    } finally {
      setContextMutating(false)
    }
  }

  const closeReplacementDialog = () => {
    const target = editFocus.current
    editFocus.current = null
    setEditing(null)
    globalThis.setTimeout?.(() => target?.focus?.(), 0)
  }

  const openReplacementEdit = unit => {
    if (readOnly || !replacementAvailable || unit.replacementSupported !== true) return
    editFocus.current = globalThis.document?.activeElement ?? null
    setNotice('')
    setComparisonUnitId(null)
    setEditing({
      unitId: unit.id,
      kind: unit.kind,
      text: String(unit.effectiveText ?? unit.atoms?.map(atom => atom.text ?? '').join('\n') ?? ''),
    })
  }

  const saveReplacement = async value => {
    if (!editing || loaded.snapshot === null) return
    if (running) throw new Error('CONTEXT_EDITOR_BUSY')
    setContextMutating(true)
    try {
      const result = await controller.commitReplacement(editing.unitId, loaded.snapshot.revision, value)
      if (result?.conflict) {
        setNotice(text.replacementConflict)
        closeReplacementDialog()
        await refresh(true)
        return
      }
      closeReplacementDialog()
      setNotice('')
      await refresh(true)
    } catch (error) {
      setNotice(text.editFailed(errorText(error)))
      throw error
    } finally {
      setContextMutating(false)
    }
  }

  const mutateReplacement = async (action, unit) => {
    if (readOnly || !replacementAvailable || unit.replacementSupported !== true || loaded.snapshot === null) return
    if (action === 'restore' && typeof globalThis.confirm === 'function') {
      let confirmed = true
      try { confirmed = globalThis.confirm(text.restoreReplacementConfirm) } catch { confirmed = true }
      if (!confirmed) return
    }
    setContextMutating(true)
    try {
      const method = action === 'restore' ? 'restoreReplacement' : 'undoReplacement'
      const result = await controller[method](unit.id, loaded.snapshot.revision)
      if (result?.conflict) {
        setNotice(text.replacementConflict)
        await refresh(true)
        return
      }
      setNotice('')
      await refresh(true)
    } catch (error) {
      setNotice(text.editFailed(errorText(error)))
    } finally {
      setContextMutating(false)
    }
  }

  const compareOriginal = unit => {
    if (unit.replacementState !== 'replaced') return
    setComparisonUnitId(current => current === unit.id ? null : unit.id)
  }

  const undo = async () => {
    if (readOnly || loaded.snapshot === null || !loaded.snapshot.canUndo) return
    try {
      const value = await controller.undo(loaded.snapshot.revision)
      if (value?.conflict) await refresh()
      else await refresh()
    } catch (error) {
      setLoaded(current => ({ ...current, status: 'error', error }))
    }
  }

  const moveMatch = async delta => {
    if (!search || search.error || search.total < 1) return
    const nextIndex = nextSearchIndex(requestedIndexRef.current, delta, search.total)
    requestedIndexRef.current = nextIndex
    const ticket = ++matchSequence.current
    setMatching(true)
    try {
      const value = await controller.match(search.searchId, nextIndex, search.revision)
      if (ticket === matchSequence.current) {
        navigationIndexRef.current = nextIndex
        setSearchIndex(nextIndex)
        setMatch(value)
        setMatching(false)
      }
    } catch {
      if (ticket === matchSequence.current) {
        requestedIndexRef.current = navigationIndexRef.current
        setMatching(false)
        setMatch(null)
      }
    }
  }

  const matchUnitId = match?.unitId
  const aiState = aiFilterState(prefs.enabledUnitKinds)
  return h('section', { className: 'context-editor', 'aria-label': 'Context Editor' },
    h('div', { className: 'context-editor__controls', ref: controlsNode },
      h('div', { className: 'context-editor__toolbar' },
        h('div', { className: 'context-editor__filters' },
          h(FilterButton, {
            kind: 'user',
            state: unitFilterState(prefs.enabledUnitKinds, 'user'),
            onClick: () => toggleUnitKind('user'),
            text,
          }),
          h('div', { className: 'context-editor__filter-group context-editor__filter-group--ai' },
            h(FilterButton, {
              kind: 'ai',
              state: aiState,
              onClick: toggleAiKind,
              text,
            }),
            h('div', { className: 'context-editor__subfilters', 'aria-label': text.kind('ai') },
              h(FilterButton, {
                kind: 'reasoning',
                state: unitFilterState(prefs.enabledUnitKinds, 'reasoning'),
                onClick: () => toggleUnitKind('reasoning'),
                text,
                label: text.unitKind('reasoning'),
              }),
              h(FilterButton, {
                kind: 'answer',
                state: unitFilterState(prefs.enabledUnitKinds, 'answer'),
                onClick: () => toggleUnitKind('answer'),
                text,
                label: text.unitKind('answer'),
              }),
            ),
          ),
          h(FilterButton, {
            kind: 'tool',
            state: unitFilterState(prefs.enabledUnitKinds, 'tool'),
            onClick: () => toggleUnitKind('tool'),
            text,
          }),
        ),
        h('label', { className: 'context-editor__toggle' },
          h('input', {
            type: 'checkbox', checked: prefs.showHidden,
            onChange: event => updatePrefs({ showHidden: event.target.checked }),
          }),
          text.showHidden,
        ),
      ),
      h('div', { className: 'context-editor__searchbar' },
        h('input', {
          ref: searchInput,
          type: 'search', value: query, placeholder: text.searchPlaceholderForScope(searchScope),
          onChange: event => setQuery(event.target.value),
          'aria-label': text.searchAria,
        }),
        h('button', {
          type: 'button',
          className: 'context-editor__search-scope',
          onClick: toggleSearchScope,
          'aria-pressed': searchScope === 'all',
        }, text.searchScope(searchScope)),
        h('span', { className: 'context-editor__search-summary' }, search?.error
          ? text.searchFailed(errorText(search.error))
          : search
            ? text.searchSummary(search.total, search.totalOccurrences, match?.occurrenceCount, searchIndex, true, searchScope)
            : text.searchSummary(0, 0, undefined, 0, false, searchScope)),
        h('button', { type: 'button', disabled: !search || search.error || search.total < 1 || matching, onClick: () => void moveMatch(-1) }, text.previous),
        h('button', { type: 'button', disabled: !search || search.error || search.total < 1 || matching, onClick: () => void moveMatch(1) }, text.next),
      ),
      h('div', { className: 'context-editor__actions' },
        h('button', { type: 'button', disabled: readOnly || selectedCount === 0, onClick: () => void mutate('hide', [...selected]) }, text.hideSelected(selectedCount)),
        h('button', { type: 'button', disabled: readOnly || selectedCount === 0, onClick: () => void mutate('restore', [...selected]) }, text.restoreSelected),
        h('button', { type: 'button', disabled: readOnly, onClick: () => void mutate('reset') }, text.restoreAll),
        h('button', { type: 'button', disabled: readOnly || !contextAvailable || selectedCount === 0, onClick: () => void mutateContext('exclude', [...selected]) }, text.excludeSelected(selectedCount)),
        h('button', { type: 'button', disabled: readOnly || !contextAvailable || selectedCount === 0, onClick: () => void mutateContext('restore', [...selected]) }, text.restoreContextSelected),
        h('button', { type: 'button', disabled: readOnly || !loaded.snapshot?.canUndo, onClick: () => void undo() }, text.undo),
        running ? h('span', { className: 'context-editor__running' }, text.running) : null,
        loaded.status === 'error' ? h('span', { className: 'context-editor__error' }, errorText(loaded.error)) : null,
        notice ? h('span', { className: 'context-editor__notice', role: 'status' }, notice) : null,
      ),
    ),
    h('div', { className: 'context-editor__list' }, visibleRecords.map(record => h(RecordRow, {
      key: record.id,
      record,
      selected,
      onSelect: selectUnit,
      focusedUnitId: matchUnitId,
      showHidden: prefs.showHidden,
      showOriginalUnitId: comparisonUnitId,
      match: matchUnitId === match?.unitId ? match : null,
      disabled: readOnly,
      onRestore: unitId => void mutate('restore', [unitId]),
      onContextToggle: unit => void mutateContext(unit.projectionState === 'exclude' || unit.projectionState === 'mixed' ? 'restore' : 'exclude', [unit.id]),
      onEdit: openReplacementEdit,
      onRestoreReplacement: unit => void mutateReplacement('restore', unit),
      onUndoReplacement: unit => void mutateReplacement('undo', unit),
      onCompareOriginal: compareOriginal,
      replacementAvailable,
      registerNode: registerUnitNode,
      text,
    }))),
    loaded.status === 'loading' ? h('div', { className: 'context-editor__state' }, text.loading) : null,
    loaded.status !== 'loading' && visibleRecords.length === 0 ? h('div', { className: 'context-editor__state' }, text.noRecords) : null,
    editing
      ? h(EditDialog, {
        unit: editing,
        initialText: editing.text,
        text,
        onCancel: closeReplacementDialog,
        onSave: saveReplacement,
      })
      : null,
  )
}

export async function apply(ctx) {
  const disposeRemote = await ctx.remote.$mount(contextEditorRemote)
  ctx.inject(['slots', 'remote', 'remote.contextEditor'], scopedCtx => {
    const controllers = new Map()
    const controllerFor = sessionId => {
      const key = String(sessionId)
      let controller = controllers.get(key)
      if (controller === undefined) {
        controller = new ContextEditorController(scopedCtx.remote.contextEditor, key)
        controllers.set(key, controller)
      }
      return controller
    }

    scopedCtx.effect(() => () => {
      for (const controller of controllers.values()) controller.dispose()
      controllers.clear()
    }, 'context-editor-deepseek-harness: controllers')

    scopedCtx.slots.inject('conversation.view', () => scopedCtx.slots.register({
      name: 'conversation.view',
      id: 'context-editor',
      order: 20,
      label: () => 'Context Editor',
      inject: sessionId => ({ controller: controllerFor(sessionId) }),
    }, ContextEditorView))
  })

  return disposeRemote
}
