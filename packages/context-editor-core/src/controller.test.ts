import { describe, expect, it } from 'vitest'
import {
  contextEditorCapabilities,
  contextEditorRuntimeReducer,
  initialContextEditorRuntimeState,
} from './controller.js'

const snapshot = {
  revision: 'r1',
  sourceLeafId: 'leaf-1',
  records: [],
  canUndo: true,
  legacyStateFound: false,
}

describe('context editor runtime controller', () => {
  it('ignores stale responses from an older session', () => {
    const loading = contextEditorRuntimeReducer(initialContextEditorRuntimeState, {
      type: 'load-started',
      sessionKey: 'session-b',
    })
    const next = contextEditorRuntimeReducer(loading, {
      type: 'snapshot-loaded',
      sessionKey: 'session-a',
      snapshot,
    })
    expect(next).toBe(loading)
  })

  it('keeps filters/search available while mutations wait for the snapshot', () => {
    const state = contextEditorRuntimeReducer(initialContextEditorRuntimeState, {
      type: 'load-started',
      sessionKey: 'session-a',
    })
    expect(contextEditorCapabilities(state, false)).toEqual({
      canFilter: true,
      canSearch: true,
      canMutate: false,
      canUndo: false,
      mutationDisabledReason: 'loading',
    })
  })

  it('disables only write operations while the agent is running', () => {
    const state = contextEditorRuntimeReducer(
      contextEditorRuntimeReducer(initialContextEditorRuntimeState, {
        type: 'load-started',
        sessionKey: 'session-a',
      }),
      { type: 'snapshot-loaded', sessionKey: 'session-a', snapshot },
    )
    expect(contextEditorCapabilities(state, true)).toMatchObject({
      canFilter: true,
      canSearch: true,
      canMutate: false,
      mutationDisabledReason: 'agent-running',
    })
  })
})
