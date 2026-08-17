import type {
  ContextEditorSnapshot,
  ContextRecordKind,
  ContextSearchMatch,
} from './types.js'

export type ContextEditorPhase = 'loading' | 'ready' | 'mutating' | 'error'

export type ContextEditorErrorCode =
  | 'not-ready'
  | 'busy'
  | 'conflict'
  | 'session-changed'
  | 'io'

export interface ContextEditorError {
  code: ContextEditorErrorCode
  message: string
}

export interface ContextEditorSearchInfo {
  searchId: string
  revision: string
  total: number
  totalOccurrences: number
}

export interface ContextEditorTransport {
  getSnapshot(input: { sessionFile: string; workspaceId?: string | null }): Promise<ContextEditorSnapshot>
  search(input: {
    sessionFile: string
    workspaceId?: string | null
    query: string
    enabledKinds: readonly ContextRecordKind[]
  }): Promise<ContextEditorSearchInfo>
  getSearchMatch(input: {
    sessionFile: string
    workspaceId?: string | null
    searchId: string
    revision: string
    index: number
  }): Promise<ContextSearchMatch | null>
  commit(input: {
    sessionFile: string
    workspaceId?: string | null
    baseRevision: string
    action: 'hide' | 'restore' | 'reset'
    recordIds?: readonly string[]
    unitIds?: readonly string[]
  }): Promise<{ ok: boolean; conflict?: boolean; snapshot?: ContextEditorSnapshot }>
  undo(input: {
    sessionFile: string
    workspaceId?: string | null
    baseRevision: string
  }): Promise<{ ok: boolean; conflict?: boolean; snapshot?: ContextEditorSnapshot }>
}

export interface ContextEditorRuntimeState {
  phase: ContextEditorPhase
  sessionKey: string
  snapshot: ContextEditorSnapshot | null
  error: ContextEditorError | null
}

export type ContextEditorRuntimeAction =
  | { type: 'load-started'; sessionKey: string }
  | { type: 'snapshot-loaded'; sessionKey: string; snapshot: ContextEditorSnapshot }
  | { type: 'mutation-started'; sessionKey: string }
  | { type: 'mutation-finished'; sessionKey: string; snapshot: ContextEditorSnapshot }
  | { type: 'request-failed'; sessionKey: string; error: ContextEditorError }
  | { type: 'reset'; sessionKey?: string }

export const initialContextEditorRuntimeState: ContextEditorRuntimeState = {
  phase: 'loading',
  sessionKey: '',
  snapshot: null,
  error: null,
}

export function contextEditorRuntimeReducer(
  state: ContextEditorRuntimeState,
  action: ContextEditorRuntimeAction,
): ContextEditorRuntimeState {
  if (
    action.type !== 'reset' &&
    action.type !== 'load-started' &&
    action.sessionKey !== state.sessionKey
  ) {
    // A response from a previous session must never overwrite the current view.
    return state
  }

  switch (action.type) {
    case 'load-started':
      return {
        phase: 'loading',
        sessionKey: action.sessionKey,
        snapshot: null,
        error: null,
      }
    case 'snapshot-loaded':
      return {
        phase: 'ready',
        sessionKey: action.sessionKey,
        snapshot: action.snapshot,
        error: null,
      }
    case 'mutation-started':
      return { ...state, phase: 'mutating', error: null }
    case 'mutation-finished':
      return {
        phase: 'ready',
        sessionKey: action.sessionKey,
        snapshot: action.snapshot,
        error: null,
      }
    case 'request-failed':
      return { ...state, phase: 'error', error: action.error }
    case 'reset':
      return {
        ...initialContextEditorRuntimeState,
        sessionKey: action.sessionKey ?? '',
      }
  }
}

export interface ContextEditorCapabilities {
  canFilter: boolean
  canSearch: boolean
  canMutate: boolean
  canUndo: boolean
  mutationDisabledReason?: 'loading' | 'mutating' | 'agent-running' | 'error' | 'unavailable'
}

export function contextEditorCapabilities(
  state: Pick<ContextEditorRuntimeState, 'phase' | 'sessionKey' | 'snapshot'>,
  agentRunning: boolean,
): ContextEditorCapabilities {
  const canFilter = !!state.sessionKey
  const canSearch = !!state.sessionKey && state.phase !== 'error'
  if (!state.sessionKey) {
    return { canFilter: false, canSearch: false, canMutate: false, canUndo: false, mutationDisabledReason: 'unavailable' }
  }
  if (agentRunning) {
    return { canFilter, canSearch, canMutate: false, canUndo: false, mutationDisabledReason: 'agent-running' }
  }
  if (state.phase === 'loading') {
    return { canFilter, canSearch, canMutate: false, canUndo: false, mutationDisabledReason: 'loading' }
  }
  if (state.phase === 'mutating') {
    return { canFilter, canSearch, canMutate: false, canUndo: false, mutationDisabledReason: 'mutating' }
  }
  if (state.phase === 'error' || !state.snapshot) {
    return { canFilter, canSearch, canMutate: false, canUndo: false, mutationDisabledReason: 'error' }
  }
  return {
    canFilter,
    canSearch,
    canMutate: true,
    canUndo: state.snapshot.canUndo,
  }
}
