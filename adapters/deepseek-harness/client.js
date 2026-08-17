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
import './client.css'

export const inject = ['remote']

const h = React.createElement
const ALL_KINDS = Object.freeze(['user', 'ai', 'tool'])
const PREFS_KEY = 'dsh-context-editor:prefs:v1'

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
  const defaults = { enabledKinds: [...ALL_KINDS], showHidden: false }
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY)
    if (!raw) return defaults
    const value = JSON.parse(raw)
    const enabledKinds = Array.isArray(value?.enabledKinds)
      ? value.enabledKinds.filter(kind => ALL_KINDS.includes(kind))
      : defaults.enabledKinds
    return {
      enabledKinds: enabledKinds.length ? [...new Set(enabledKinds)] : defaults.enabledKinds,
      showHidden: Boolean(value?.showHidden),
    }
  } catch {
    return defaults
  }
}

function savePreferences(value) {
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(value))
  } catch {
    // Private browsing/storage-disabled pages keep the preference in memory.
  }
}

function displayKind(kind) {
  return kind === 'ai' ? 'AI' : kind === 'tool' ? 'Tool' : 'User'
}

function displayUnitKind(kind) {
  return kind === 'reasoning' ? '思考' : kind === 'answer' ? '回答' : displayKind(kind)
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

  async search(query, enabledKinds) {
    const value = await this.call('searchRecords', { query, enabledKinds })
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
}

function FilterButton({ kind, enabled, onClick }) {
  return h('button', {
    type: 'button',
    className: `context-editor__filter ${enabled ? 'is-active' : ''}`,
    onClick,
    'aria-pressed': enabled,
  }, displayKind(kind))
}

function UnitBody({ unit, match }) {
  const atoms = unit.atoms ?? []
  if (!atoms.length) return h('span', { className: 'context-editor__empty' }, '（空记录）')
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

function UnitSection({ unit, selected, onSelect, focused, showHidden, match, disabled, onRestore }) {
  const hidden = unit.viewState === 'hide' || unit.viewState === 'mixed'
  const mixed = unit.viewState === 'mixed'
  const body = hidden && !showHidden
    ? h('div', { className: 'context-editor__unit-placeholder' }, mixed ? '部分内容不可用（原位置占位）' : `${displayUnitKind(unit.kind)}已隐藏（原位置占位）`)
    : h(UnitBody, { unit, match })
  return h('div', {
    className: `context-editor__unit ${focused ? 'is-focused' : ''} ${hidden ? 'is-hidden' : ''}`,
    'data-unit-id': unit.id,
  },
  h('div', { className: 'context-editor__unit-header' },
    h('label', { className: 'context-editor__unit-select' },
      h('input', { type: 'checkbox', checked: selected, disabled, onChange: event => onSelect(event) }),
      h('span', { className: 'context-editor__unit-kind' }, displayUnitKind(unit.kind)),
    ),
    mixed ? h('span', { className: 'context-editor__hidden-badge' }, '部分隐藏') : null,
    hidden && !mixed ? h('span', { className: 'context-editor__hidden-badge' }, '隐藏') : null,
    hidden ? h('button', { type: 'button', disabled, onClick: onRestore }, '恢复') : null,
  ),
  h('div', { className: 'context-editor__unit-body' }, body),
  )
}

function RecordRow({ record, selected, onSelect, focusedUnitId, showHidden, match, disabled, onRestore }) {
  const units = unitsForRecord(record)
  const focused = units.some(unit => unit.id === focusedUnitId)
  return h('article', {
    className: `context-editor__row ${focused ? 'is-focused' : ''}`,
    'data-record-id': record.id,
  },
  h('div', { className: 'context-editor__row-content' },
    h('div', { className: 'context-editor__row-meta' },
      h('span', { className: 'context-editor__kind' }, displayKind(record.kind)),
      record.toolCallId ? h('code', null, record.toolCallId) : null,
    ),
    h('div', { className: 'context-editor__units' }, units.map(unit => h(UnitSection, {
      key: unit.id,
      unit,
      selected: selected.has(unit.id),
      onSelect: event => onSelect(unit, event),
      focused: focusedUnitId === unit.id,
      showHidden,
      match: focusedUnitId === unit.id ? match : null,
      disabled,
      onRestore: () => onRestore(unit.id),
    }))),
  ),
  )
}

/** Context Editor tab body.  The parent ConversationSession keeps the shared composer. */
export function ContextEditorView({ sessionId, controller, useSession }) {
  const running = useSession(snapshot => Boolean(snapshot?.running))
  const [prefs, setPrefs] = useState(safePreferences)
  const [loaded, setLoaded] = useState({ status: 'loading', snapshot: null, records: [], error: null })
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState(null)
  const [searchIndex, setSearchIndex] = useState(0)
  const [match, setMatch] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const lastSelectedIndex = useRef(null)
  const loadSequence = useRef(0)
  const searchSequence = useRef(0)
  const matchSequence = useRef(0)

  const refresh = useCallback(async () => {
    const ticket = ++loadSequence.current
    setLoaded(current => ({ ...current, status: current.snapshot ? 'refreshing' : 'loading', error: null }))
    try {
      const value = await controller.load()
      if (value === null || ticket !== loadSequence.current) return
      setLoaded({ status: 'ready', ...value, error: null })
      setSelected(new Set())
      lastSelectedIndex.current = null
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
    const ticket = ++searchSequence.current
    const matchTicket = ++matchSequence.current
    const needle = query.trim()
    if (!needle) {
      setSearch(null)
      setMatch(null)
      setSearchIndex(0)
      return undefined
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const value = await controller.search(needle, prefs.enabledKinds)
          if (ticket !== searchSequence.current) return
          setSearch(value)
          setSearchIndex(0)
          const first = value.total > 0
            ? await controller.match(value.searchId, 0, value.revision)
            : null
          if (ticket === searchSequence.current && matchTicket === matchSequence.current) setMatch(first)
        } catch (error) {
          if (ticket === searchSequence.current) setSearch({ error })
        }
      })()
    }, 120)
    return () => clearTimeout(timer)
  }, [controller, prefs.enabledKinds, query])

  const visibleRecords = useMemo(() => loaded.records.filter(record => prefs.enabledKinds.includes(record.kind)), [loaded.records, prefs.enabledKinds])
  const visibleUnits = useMemo(() => visibleRecords.flatMap(record => unitsForRecord(record)), [visibleRecords])
  const selectedCount = selected.size
  const readOnly = running || loaded.status === 'loading' || loaded.status === 'refreshing'

  const updatePrefs = useCallback(next => {
    setPrefs(current => {
      const value = { ...current, ...next }
      savePreferences(value)
      return value
    })
  }, [])

  const toggleKind = kind => {
    const enabled = prefs.enabledKinds.includes(kind)
    const next = enabled
      ? prefs.enabledKinds.filter(value => value !== kind)
      : [...prefs.enabledKinds, kind]
    updatePrefs({ enabledKinds: next.length ? next : [...ALL_KINDS] })
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
    const nextIndex = (searchIndex + delta + search.total) % search.total
    const ticket = ++matchSequence.current
    setSearchIndex(nextIndex)
    try {
      const value = await controller.match(search.searchId, nextIndex, search.revision)
      if (ticket === matchSequence.current) setMatch(value)
    } catch {
      setMatch(null)
    }
  }

  const matchUnitId = match?.unitId
  return h('section', { className: 'context-editor', 'aria-label': 'Context Editor' },
    h('div', { className: 'context-editor__toolbar' },
      h('div', { className: 'context-editor__filters' }, ALL_KINDS.map(kind => h(FilterButton, {
        key: kind,
        kind,
        enabled: prefs.enabledKinds.includes(kind),
        onClick: () => toggleKind(kind),
      }))),
      h('label', { className: 'context-editor__toggle' },
        h('input', {
          type: 'checkbox', checked: prefs.showHidden,
          onChange: event => updatePrefs({ showHidden: event.target.checked }),
        }),
        '显示隐藏内容',
      ),
    ),
    h('div', { className: 'context-editor__searchbar' },
      h('input', {
        type: 'search', value: query, placeholder: '搜索完整会话历史…',
        onChange: event => setQuery(event.target.value),
        'aria-label': '搜索上下文',
      }),
      h('span', { className: 'context-editor__search-summary' }, search?.error
        ? `搜索失败：${errorText(search.error)}`
        : search
          ? `${search.total} 个单元 · ${search.totalOccurrences} 次出现${match?.occurrenceCount === undefined ? '' : ` · 当前单元 ${match.occurrenceCount} 次`}${search.total ? ` · ${searchIndex + 1}/${search.total}` : ''}`
          : '搜索覆盖完整持久化历史'),
      h('button', { type: 'button', disabled: !search || search.total < 1, onClick: () => void moveMatch(-1) }, '上一条'),
      h('button', { type: 'button', disabled: !search || search.total < 1, onClick: () => void moveMatch(1) }, '下一条'),
    ),
    h('div', { className: 'context-editor__actions' },
      h('button', { type: 'button', disabled: readOnly || selectedCount === 0, onClick: () => void mutate('hide', [...selected]) }, `隐藏选中${selectedCount ? `（${selectedCount}）` : ''}`),
      h('button', { type: 'button', disabled: readOnly || selectedCount === 0, onClick: () => void mutate('restore', [...selected]) }, '恢复选中'),
      h('button', { type: 'button', disabled: readOnly, onClick: () => void mutate('reset') }, '恢复全部'),
      h('button', { type: 'button', disabled: readOnly || !loaded.snapshot?.canUndo, onClick: () => void undo() }, '撤销'),
      running ? h('span', { className: 'context-editor__running' }, 'Agent 运行中：仅可读取和搜索') : null,
      loaded.status === 'error' ? h('span', { className: 'context-editor__error' }, errorText(loaded.error)) : null,
    ),
    h('div', { className: 'context-editor__list' }, visibleRecords.map(record => h(RecordRow, {
      key: record.id,
      record,
      selected,
      onSelect: selectUnit,
      focusedUnitId: matchUnitId,
      showHidden: prefs.showHidden,
      match: matchUnitId === match?.unitId ? match : null,
      disabled: readOnly,
      onRestore: unitId => void mutate('restore', [unitId]),
    }))),
    loaded.status === 'loading' ? h('div', { className: 'context-editor__state' }, '正在读取完整会话…') : null,
    loaded.status !== 'loading' && visibleRecords.length === 0 ? h('div', { className: 'context-editor__state' }, '没有符合当前筛选的可编辑记录。') : null,
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
