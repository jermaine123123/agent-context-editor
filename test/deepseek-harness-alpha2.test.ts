import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { deriveCondensationCoverage } from '../packages/context-editor-core/src/index.js'
import { nativeCompactionEvidence } from '../adapters/deepseek-harness/index.js'

const targetRoot = process.env.DSH_HOST_ROOT ?? process.env.DSH_ALPHA2_ROOT
const expectedHostVersion = process.env.DSH_EXPECTED_HOST_VERSION ?? '0.1.6-alpha.2'
const installedHarness = targetRoot ? describe : describe.skip
const targetRequire = targetRoot ? createRequire(resolve(targetRoot, 'package.json')) : undefined

async function importTarget(name: string) {
  if (!targetRequire) throw new Error('DSH_HOST_ROOT is required for the pinned Harness acceptance test')
  return import(pathToFileURL(targetRequire.resolve(name)).href)
}

function textOf(message: any) {
  return (Array.isArray(message?.content) ? message.content : [])
    .filter((block: any) => block?.type === 'text')
    .map((block: any) => String(block.text ?? ''))
    .join('')
}

installedHarness(`DeepSeek Harness official ${expectedHostVersion} Session contract`, () => {
  it('persists, restarts, edits, restores, and preserves User and tool message identities', async () => {
    const [{ Session }, { currentSessionMessageProjections }, { default: JsonlPersistence }, { Context }] = await Promise.all([
      importTarget('@deepseek-ai/dsh-session'),
      importTarget('@deepseek-ai/dsh-session-format-catalog/message-projections'),
      importTarget('@deepseek-ai/dsh-session-persistence-jsonl'),
      importTarget('@deepseek-ai/cordis'),
    ])
    expect(targetRequire?.('@deepseek-ai/dsh-session/package.json').version).toBe(expectedHostVersion)
    expect(targetRequire?.('@deepseek-ai/dsh-session-persistence-jsonl/package.json').version).toBe(expectedHostVersion)

    const storageRoot = await mkdtemp(join(tmpdir(), 'context-editor-dsh-alpha2-'))
    try {
      const ctx = new Context()
      const persistence = new JsonlPersistence(ctx, { root: storageRoot, compression: 'none' })
      const sessionId = `context-editor-${crypto.randomUUID()}`
      const session = Session.create(sessionId)
      const originalData = {
        id: 'synthetic-user-original',
        role: 'user',
        source: { kind: 'plugin', plugin: 'context-editor-alpha2-test' },
        content: [{ type: 'text', text: 'fixed synthetic prompt' }],
      }
      const original = session.append('user/message', originalData, { surfaceOp: 'append' })
      const markerId = `context-editor-surface-v1:${encodeURIComponent(sessionId)}:${original.seq}:edit-1`
      const edited = session.append('user/message', {
        ...originalData,
        id: markerId,
        content: [{ type: 'text', text: 'fixed synthetic edit' }],
      }, {
        surfaceOp: { op: 'replace', startSeq: original.seq, endSeq: original.seq },
        sourceEventSeqs: [original.seq],
      })
      expect(session.deriveMessages().map(textOf)).toEqual(['fixed synthetic edit'])
      expect(session.deriveMessages()[0]?.id).toBe(markerId)

      const writeHandle = await persistence.create(session.header)
      await writeHandle.append([original, edited])
      await writeHandle.flush()
      await writeHandle.close()

      const observation = await persistence.stat(sessionId)
      expect(observation).toBeDefined()
      const readHandle = await persistence.open(sessionId, 'read')
      let events: any[] = []
      try {
        const firstPage = await readHandle.read(0, 1)
        const secondPage = await readHandle.read(1, 1)
        events = [...firstPage.events, ...secondPage.events]
        expect(firstPage.eventState).toBeTruthy()
      } finally {
        await readHandle.close()
      }
      const restarted = Session.create(sessionId, events, session.header, 0, currentSessionMessageProjections)
      expect(restarted.deriveMessages()).toEqual(session.deriveMessages())
      expect(restarted.deriveMessages().map(textOf)).toEqual(['fixed synthetic edit'])

      const restoredEdit = restarted.append('user/message', {
        ...originalData,
        id: `context-editor-surface-v1:${encodeURIComponent(sessionId)}:${original.seq}:restore-2`,
      }, {
        surfaceOp: { op: 'replace', startSeq: edited.seq, endSeq: edited.seq },
        sourceEventSeqs: [edited.seq],
      })
      expect(restoredEdit.seq).toBeGreaterThan(edited.seq)
      expect(restarted.deriveMessages().map(textOf)).toEqual(['fixed synthetic prompt'])

      const blank = Session.create(`context-editor-blank-${crypto.randomUUID()}`)
      const prompt = blank.append('user/message', originalData, { surfaceOp: 'append' })
      blank.append('user/message', { ...originalData, id: 'synthetic-empty', content: [] }, {
        surfaceOp: { op: 'replace', startSeq: prompt.seq, endSeq: prompt.seq },
        sourceEventSeqs: [prompt.seq],
      })
      expect(blank.deriveMessages()).toHaveLength(1)
      expect(blank.deriveMessages()[0]?.content).toEqual([])

      const assistant = Session.create(`context-editor-assistant-${crypto.randomUUID()}`)
      const answer = assistant.append('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'synthetic-answer',
          role: 'assistant',
          source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
          content: [{ type: 'text', text: 'fixed synthetic answer' }],
        },
        stream: [],
      }, { surfaceOp: 'append' })
      expect(() => assistant.append('assistant/message', {
        ...answer.data,
        message: { ...answer.data.message, content: [{ type: 'text', text: 'fixed synthetic edit' }] },
      }, {
        surfaceOp: { op: 'replace', startSeq: answer.seq, endSeq: answer.seq },
        sourceEventSeqs: [answer.seq],
      })).toThrow(/sourceEventSeqs|assistant/i)

      const tools = Session.create(`context-editor-tools-${crypto.randomUUID()}`)
      tools.append('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'synthetic-tool-call-message',
          role: 'assistant',
          source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
          content: [{ type: 'tool-call', id: 'call-1', name: 'echo', arguments: '{}' }],
        },
        stream: [],
      }, { surfaceOp: 'append' })
      const result = tools.append('tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: 'synthetic-tool-result',
          role: 'user',
          source: { kind: 'tool', callId: 'call-1' },
          content: [{ type: 'tool-result', content: 'fixed synthetic output' }],
        },
      }, { surfaceOp: 'append' })
      tools.append('tool/result', {
        ...result.data,
        message: { ...result.data.message, content: [{ ...result.data.message.content[0], content: null }] },
      }, {
        surfaceOp: { op: 'replace', startSeq: result.seq, endSeq: result.seq },
        sourceEventSeqs: [result.seq],
      })
      const toolMessages = tools.deriveMessages()
      expect(toolMessages[0]?.content?.[0]?.id).toBe('call-1')
      expect(toolMessages[1]?.id).toBe('synthetic-tool-result')
      expect(toolMessages[1]?.content?.[0]?.content).toBeNull()
    } finally {
      await rm(storageRoot, { recursive: true, force: true })
    }
  })

  it('shows the in-memory message-projection contract, but rejects custom events on JSONL replay', async () => {
    const [{ Session, deriveEventMessage }, { currentSessionMessageProjections }, { default: JsonlPersistence }, { Context }] = await Promise.all([
      importTarget('@deepseek-ai/dsh-session'),
      importTarget('@deepseek-ai/dsh-session-format-catalog/message-projections'),
      importTarget('@deepseek-ai/dsh-session-persistence-jsonl'),
      importTarget('@deepseek-ai/cordis'),
    ])
    const contextProjection = {
      type: 'context/projection',
      project(event: any, context: any) {
        const updates = new Map<number, any>()
        for (const change of event.data.changes) {
          const root = Number(change.rootEventSeq)
          const source = context.events.find((candidate: any) => Number(candidate.seq) === root)
          const original = context.messages.get(root) ?? deriveEventMessage(source)
          if (!original) throw new Error(`synthetic context projection could not resolve source ${root}`)
          const next = change.mode === 'remove'
            ? { ...original, content: [] }
            : change.mode === 'clear'
              ? deriveEventMessage(source)
              : { ...original, content: structuredClone(change.message.content) }
          if (!next) throw new Error(`synthetic context projection could not restore source ${root}`)
          updates.set(root, { ...next, id: original.id })
        }
        return updates
      },
    }
    const projections = [...currentSessionMessageProjections, contextProjection]
    const storageRoot = await mkdtemp(join(tmpdir(), 'context-editor-dsh-alpha2-message-projection-'))
    try {
      const sessionId = `context-editor-projection-${crypto.randomUUID()}`
      const session = Session.create(sessionId, [], undefined, 0, projections)
      const user = session.append('user/message', {
        id: 'synthetic-projection-user',
        role: 'user',
        source: { kind: 'user' },
        content: [
          { type: 'text', text: 'fixed synthetic prompt with an image' },
          { type: 'image', data: 'synthetic-image-payload' },
        ],
      }, { surfaceOp: 'append' })
      session.append('image/offload', { targets: [{ seq: user.seq, imageIndexes: [0] }] })
      const answer = session.append('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'synthetic-projection-assistant',
          role: 'assistant',
          source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
          content: [{ type: 'text', text: 'fixed synthetic original answer' }],
        },
        stream: [],
      }, { surfaceOp: 'append' })
      session.append('context/projection', {
        schemaVersion: 1,
        owner: 'context-editor-deepseek-harness',
        operationId: 'projection-assistant-edit',
        baseSeq: answer.seq,
        changes: [{
          rootEventSeq: answer.seq,
          mode: 'replace',
          message: {
            id: 'projection-copy-must-not-replace-host-id',
            role: 'assistant',
            source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
            content: [{ type: 'text', text: 'fixed synthetic edited answer' }],
          },
        }],
      })
      const liveMessages = session.deriveMessages()
      expect(liveMessages[0]?.id).toBe('synthetic-projection-user')
      expect(liveMessages[0]?.content?.[1]).toMatchObject({ type: 'image', offloaded: true })
      expect(liveMessages[1]?.id).toBe('synthetic-projection-assistant')
      expect(textOf(liveMessages[1])).toBe('fixed synthetic edited answer')
      expect(textOf(session.eventAt(answer.seq)?.data?.message)).toBe('fixed synthetic original answer')

      const persistence = new JsonlPersistence(new Context(), { root: storageRoot, compression: 'none' })
      const writeHandle = await persistence.create(session.header)
      try {
        await writeHandle.append(session.snapshotEvents())
        await writeHandle.flush()
      } finally {
        await writeHandle.close()
      }
      await expect(persistence.open(sessionId, 'read'))
        .rejects.toThrow(/context\/projection.*unknown to this harness.*not marked ignorable/i)
      expect(session.snapshotEvents().some((event: any) => event.type === 'context/projection')).toBe(true)

      const condensed = Session.create(`context-editor-empty-condensation-${crypto.randomUUID()}`, [], undefined, 0, projections)
      const first = condensed.append('user/message', {
        id: 'synthetic-condense-user',
        role: 'user',
        source: { kind: 'user' },
        content: [{ type: 'text', text: 'fixed synthetic user range source' }],
      }, { surfaceOp: 'append' })
      const second = condensed.append('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'synthetic-condense-assistant',
          role: 'assistant',
          source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
          content: [{ type: 'text', text: 'fixed synthetic assistant range source' }],
        },
        stream: [],
      }, { surfaceOp: 'append' })
      condensed.append('context/projection', {
        schemaVersion: 1,
        owner: 'context-editor-deepseek-harness',
        operationId: 'projection-multi-message-condense',
        baseSeq: second.seq,
        changes: [
          { rootEventSeq: first.seq, mode: 'replace', message: { id: 'summary', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'fixed synthetic summary' }] } },
          { rootEventSeq: second.seq, mode: 'remove' },
        ],
      })
      const condensedMessages = condensed.deriveMessages()
      expect(condensedMessages).toHaveLength(2)
      expect(textOf(condensedMessages[0])).toBe('fixed synthetic summary')
      expect(condensedMessages[1]?.content).toEqual([])
    } finally {
      await rm(storageRoot, { recursive: true, force: true })
    }
  })

  it('compacts a multi-message range with the official engine and recovers through a pre-compaction branch', async () => {
    const [{ Session, SessionStore }, { BasicCompactionEngine }, { default: JsonlPersistence }, { Context }] = await Promise.all([
      importTarget('@deepseek-ai/dsh-session'),
      importTarget('@deepseek-ai/dsh-compaction-basic'),
      importTarget('@deepseek-ai/dsh-session-persistence-jsonl'),
      importTarget('@deepseek-ai/cordis'),
    ])
    expect(targetRequire?.('@deepseek-ai/dsh-compaction-basic/package.json').version).toBe(expectedHostVersion)

    const storageRoot = await mkdtemp(join(tmpdir(), 'context-editor-dsh-alpha2-compaction-'))
    try {
      const store = new SessionStore(new Context())
      const sessionId = `context-editor-compaction-${crypto.randomUUID()}`
      const session = store.create(sessionId)
      session.append('turn/start', { turn: 1 })
      const originalMessages = [
        session.append('user/message', {
          id: 'synthetic-compaction-user-1',
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'fixed synthetic first user message' }],
        }, { surfaceOp: 'append' }),
        session.append('assistant/message', {
          turn: 1,
          step: 1,
          message: {
            id: 'synthetic-compaction-assistant',
            role: 'assistant',
            source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
            content: [{ type: 'text', text: 'fixed synthetic assistant answer' }],
          },
          stream: [],
        }, { surfaceOp: 'append' }),
        session.append('user/message', {
          id: 'synthetic-compaction-user-2',
          role: 'user',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'fixed synthetic second user message' }],
        }, { surfaceOp: 'append' }),
        session.append('assistant/message', {
          turn: 1,
          step: 2,
          message: {
            id: 'synthetic-compaction-assistant-2',
            role: 'assistant',
            source: { kind: 'model', provider: 'synthetic', model: 'fixed' },
            content: [{ type: 'text', text: 'fixed synthetic second answer' }],
          },
          stream: [],
        }, { surfaceOp: 'append' }),
      ]
      const preCompactionBoundary = session.append('turn/end', { turn: 1, reason: 'complete' })
      session.append('turn/start', { turn: 2 })

      const tokenMeter = {
        measure(activeSession: any) {
          return { nodes: activeSession.surface.nodes.map((seq: number) => ({ seq, tokens: 128, heuristicTokens: 128 })) }
        },
        estimateMessage() { return 16 },
      }
      const engine = Object.create(BasicCompactionEngine.prototype) as any
      engine.ctx = { tokenMeter, waterfall: (_name: string, _payload: unknown, fallback: () => unknown) => fallback() }
      let summarizedMessageCount = 0
      engine.summarize = async (input: { messages: unknown[] }) => {
        summarizedMessageCount = input.messages.length
        return { summary: [{ type: 'text', text: 'fixed synthetic multi-message summary' }], provider: 'synthetic', model: 'fixed' }
      }
      const result = await engine.compactRegion(originalMessages[0].seq, originalMessages.at(-1)!.seq, {
        session,
        options: { provider: 'synthetic', model: 'fixed' },
      })
      session.append('turn/end', { turn: 2, reason: 'complete' })
      expect(summarizedMessageCount).toBe(4)
      expect(result.shadowedSeqs).toEqual(originalMessages.map(event => event.seq))

      const persistence = new JsonlPersistence(new Context(), { root: storageRoot, compression: 'none' })
      const writeHandle = await persistence.create(session.header)
      try {
        await writeHandle.append(session.snapshotEvents())
        await writeHandle.flush()
      } finally {
        await writeHandle.close()
      }

      const readHandle = await persistence.open(sessionId, 'read')
      let persistedEvents: any[] = []
      try {
        for (let offset = 0; offset < 10_000;) {
          const page = await readHandle.read(offset, 128)
          persistedEvents = [...persistedEvents, ...page.events]
          offset += page.events.length
          if (page.events.length < 128) break
        }
      } finally {
        await readHandle.close()
      }
      const restarted = Session.create(sessionId, persistedEvents, session.header)
      expect(restarted?.deriveMessages()).toHaveLength(1)
      expect(textOf(restarted?.deriveMessages()[0])).toContain('fixed synthetic multi-message summary')

      const evidence = nativeCompactionEvidence(persistedEvents)
      expect(evidence).toMatchObject([{
        host: 'deepseek-harness',
        compactionId: result.compactionId,
        shadowedRootSeqs: originalMessages.map(event => event.seq),
        startSeq: result.startSeq,
        shadowedRange: { start: originalMessages[0].seq, end: originalMessages.at(-1)!.seq },
        summarySeq: result.summarySeq,
        endSeq: result.endSeq,
        committed: true,
      }])
      expect(deriveCondensationCoverage(originalMessages.map(event => event.seq), evidence)).toMatchObject({
        status: 'full',
        restoreMode: 'checkpoint',
        checkpointCompactionId: result.compactionId,
      })

      const restartedSource = store.create(`${sessionId}-restarted`, {
        seed: persistedEvents,
        inheritedEventCount: persistedEvents.length,
        meta: { parentSession: sessionId, isSeeded: true, createdAt: session.header.createdAt },
      })
      const restoredBranch = store.fork(restartedSource, preCompactionBoundary.seq, `${sessionId}-pre-compaction-branch`)
      expect(restoredBranch.deriveMessages().map(textOf)).toEqual([
        'fixed synthetic first user message',
        'fixed synthetic assistant answer',
        'fixed synthetic second user message',
        'fixed synthetic second answer',
      ])
      expect(persistedEvents.some(event => event.seq === originalMessages[0].seq)).toBe(true)
    } finally {
      await rm(storageRoot, { recursive: true, force: true })
    }
  })
})
