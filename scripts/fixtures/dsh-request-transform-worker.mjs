// Executed over stdin with the source host as cwd by accept-deepseek-request-transform.mjs.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from './packages/test-support/agent-loop-testkit/src/index.ts'
import AgentLoop from './packages/core/agent-loop/src/index.ts'
import Storage from './packages/storage/storage/src/index.ts'
import * as Json from './packages/storage/storage-json/src/index.ts'
import * as Domain from './packages/storage/storage-domain/src/index.ts'
import Persistence from './packages/session/session-persistence-jsonl/src/index.ts'
import { createUserMessage } from './packages/llm/llm/src/index.ts'
import { DeepSeekAdapter, resolveAdapterOptions } from './packages/llm/llm-deepseek/src/index.ts'
import TokenMeter from './packages/llm/token-meter/src/index.ts'
import BasicCompactionEngine from './packages/compaction/compaction-basic/src/index.ts'
import { generateSessionTitleWithLlm } from './packages/session/session-title-llm/src/index.ts'
const { ContextEditorHost } = await import(pathToFileURL(join(process.env.CE_PLUGIN_ROOT, 'index.js')))
const root = process.env.CE_PROBE_ROOT
const stage = process.env.CE_PROBE_STAGE
const ctx = new Context()
let host
let handle
const requests = []
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  const content = stage === 'write' && requests.length === 1 ? 'ORIGINAL_ANSWER' : ['native', 'condense', 'branch-condense'].includes(stage) && requests.length === 1 ? 'SUMMARY' : `AFTER_${stage}`
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    { id: 'synthetic', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] },
    { id: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
})
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
try {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(Json, { root: join(root, 'storage') })
  await ctx.plugin(Domain, { backend: 'json' })
  await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  await ctx.plugin(BasicCompactionEngine, { auto: false })
  const capture = { requests }
  ctx.llm.registerAdapter(['mock'], new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ protocol: 'chat-completions', baseURL: `http://127.0.0.1:${server.address().port}`, thinking: 'disabled' }),
    resolveApiKey: () => 'synthetic-local-only', resolveUserId: () => 'context-editor-synthetic',
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  }))
  if (stage !== 'absent') {
    host = new ContextEditorHost(ctx)
    await host.init()
  }
  let id = 'request-transform-acceptance'
  if (stage === 'recovered' || stage.startsWith('branch-')) id = JSON.parse(await readFile(join(root, 'recovery.json'), 'utf8')).targetSessionId
  const send = async text => {
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    await ctx.sessions.flush(handle.agent.session)
  }
  if (stage === 'write') {
    handle = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'mock', model: 'mock' } })
    await send('ORIGINAL_USER')
    let snapshot = await host.getSnapshot({ sessionId: id })
    const answer = snapshot.records.flatMap(record => record.units).find(unit => unit.kind === 'answer')
    assert.ok(answer, JSON.stringify({ requests: requests.length, tail: handle.agent.session.snapshotEvents().slice(-3) }))
    const user = snapshot.records.flatMap(record => record.units).find(unit => unit.kind === 'user')
    const edit = { sessionId: id, operationId: 'edit-1', baseContextRevision: snapshot.contextRevision, unitId: answer.id, text: 'EDITED_ANSWER' }
    const result = await host.commitReplacement(edit)
    assert.equal(result.commit?.status, 'persisted-and-verified', JSON.stringify({ commit: result.commit, expected: snapshot.contextRevision }))
    snapshot = await host.getSnapshot({ sessionId: id })
    const exclude = { sessionId: id, operationId: 'exclude-1', baseRevision: snapshot.revision, action: 'exclude', unitIds: [user.id] }
    assert.equal((await host.commitContext(exclude)).commit?.status, 'persisted-and-verified')
    const before = handle.agent.session.seq
    assert.equal((await host.commitContext(exclude)).commit?.status, 'persisted-and-verified')
    assert.equal(handle.agent.session.seq, before, 'idempotent retry appended an event')
    await assert.rejects(() => host.commitReplacement({ ...edit, text: 'DIFFERENT' }), /OPERATION_REUSED/)
    await writeFile(join(root, 'targets.json'), JSON.stringify({ user: user.id, answer: answer.id, edit, exclude }))
  } else {
    const read = await ctx.sessionPersistence.open(id, 'read')
    let route
    try {
      const events = (await read.read()).events
      route = events.findLast(event => event.type === 'request/header').data.header.config
    } finally { await read.close() }
    // The Web controller restores the logged selection. Explicit CLI route overrides are outside this case.
    handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: route })
    if (stage === 'concurrency') {
      let state = await host.getSnapshot({ sessionId: id })
      const target = state.records.flatMap(record => record.units).findLast(unit => unit.kind === 'user' && unit.projectionState === 'include')
      const originalRevision = state.contextRevision
      assert.equal((await host.commitView({ sessionId: id, action: 'hide', unitIds: [target.id], baseRevision: state.revision })).ok, true)
      state = await host.getSnapshot({ sessionId: id })
      assert.equal(state.contextRevision, originalRevision, 'view-only operation invalidated context')
      const request = { sessionId: id, unitId: target.id, baseContextRevision: originalRevision }
      const results = await Promise.all([
        host.commitReplacement({ ...request, operationId: 'view-one', text: 'FIRST_VIEW_EDIT' }),
        host.commitReplacement({ ...request, operationId: 'view-two', text: 'SECOND_VIEW_EDIT' }),
      ])
      assert.equal(results.filter(value => value.commit?.status === 'persisted-and-verified').length, 1)
      assert.equal(results.filter(value => value.commit?.status === 'conflict').length, 1)
      console.log(JSON.stringify({ stage, viewOnlyStable: true, oneConcurrentWinner: true }))
    }
    if (stage.startsWith('fault-') && stage !== 'fault-recover') {
      const snapshot = await host.getSnapshot({ sessionId: id })
      const target = snapshot.records.flatMap(record => record.units).findLast(unit => unit.kind === 'user' && unit.projectionState === 'include')
      assert.ok(target)
      const request = { sessionId: id, operationId: stage, unitId: target.id, text: 'FAULT_EDITED', baseContextRevision: snapshot.contextRevision }
      await writeFile(join(root, 'fault.json'), JSON.stringify({ stage, request }))
      if (stage === 'fault-pending') {
        const put = host.requestTransform.operations.put.bind(host.requestTransform.operations)
        host.requestTransform.operations.put = async (...args) => { await put(...args); process.exit(86) }
      } else if (stage === 'fault-appended') {
        const append = host.requestTransform.appendSelection.bind(host.requestTransform)
        host.requestTransform.appendSelection = (...args) => { append(...args); process.exit(86) }
      } else if (stage === 'fault-flushed') {
        const flush = ctx.sessions.flush.bind(ctx.sessions)
        ctx.sessions.flush = async (...args) => { await flush(...args); process.exit(86) }
      } else if (stage === 'fault-result') {
        const settle = host.requestTransform.settle.bind(host.requestTransform)
        host.requestTransform.settle = async (...args) => { await settle(...args); process.exit(86) }
      }
      await host.commitReplacement(request)
      throw new Error('fault injection did not interrupt')
    }
    if (stage === 'fault-recover') {
      const fault = JSON.parse(await readFile(join(root, 'fault.json'), 'utf8'))
      const before = handle.agent.session.seq
      const operation = await host.getOperation({ sessionId: id, operationId: fault.request.operationId })
      if (fault.stage === 'fault-pending') assert.equal(operation.status, 'failed')
      if (['fault-flushed', 'fault-result'].includes(fault.stage)) assert.equal(operation.status, 'persisted-and-verified')
      const result = await host.commitReplacement(fault.request)
      assert.equal(result.commit?.status, 'persisted-and-verified', JSON.stringify(result))
      const seq = handle.agent.session.seq
      assert.equal((await host.commitReplacement(fault.request)).commit?.status, 'persisted-and-verified')
      assert.equal(handle.agent.session.seq, seq, 'retry duplicated commit')
      if (operation.status === 'persisted-and-verified') assert.equal(seq, before)
      console.log(JSON.stringify({ stage, interruptedAt: fault.stage, priorStatus: operation.status, retryVerified: true }))
    }
    if (stage === 'condense' || stage === 'branch-condense') {
      if (stage === 'branch-condense') {
        assert.equal(handle.agent.session.header.isSeeded, true)
        await send('BRANCH_NEW_USER')
        let state = await host.getSnapshot({ sessionId: id })
        const target = state.records.flatMap(record => record.units).findLast(unit => unit.kind === 'user')
        const edit = await host.commitReplacement({ sessionId: id, operationId: 'branch-edit', unitId: target.id, text: 'BRANCH_EDITED_USER', baseContextRevision: state.contextRevision })
        assert.equal(edit.commit?.status, 'persisted-and-verified', JSON.stringify(edit))
        assert.equal((await host.getOperation({ sessionId: id, operationId: 'branch-edit' })).status, 'persisted-and-verified')
        requests.length = 0
      }
      const snapshot = await host.getSnapshot({ sessionId: id })
      const unitIds = snapshot.records.flatMap(record => record.units).filter(unit => ['user', 'answer'].includes(unit.kind)).map(unit => unit.id)
      const request = { sessionId: id, operationId: 'checkpoint', baseContextRevision: snapshot.contextRevision, unitIds }
      const proposal = await host.previewCondensation(request)
      assert.equal(proposal.ok, true, JSON.stringify(proposal))
      assert.ok(!JSON.stringify(requests[0]).includes('ORIGINAL_USER'))
      assert.ok(JSON.stringify(requests[0]).includes('EDITED_ANSWER'))
      const commit = await host.commitCondensation({ ...request, summary: proposal.summary })
      assert.equal(commit.commit?.status, 'persisted-and-verified', JSON.stringify(commit))
    }
    if (stage === 'native') {
      const compacted = await ctx.compaction.compactNow(handle.agent, new AbortController().signal)
      assert.ok(compacted, 'native compaction did not commit')
      assert.ok(!JSON.stringify(requests[0]).includes('ORIGINAL_USER'))
      assert.ok(JSON.stringify(requests[0]).includes('EDITED_ANSWER'))
      const snapshot = await host.getSnapshot({ sessionId: id })
      assert.ok(snapshot.recoveryOptions.length > 0)
      await writeFile(join(root, 'native.json'), JSON.stringify(snapshot.recoveryOptions.at(-1)))
    }
    if (stage === 'recover' || stage === 'checkpoint-recover' || stage === 'branch-recover') {
      const recoveryRequest = stage === 'recover'
        ? { sessionId: id, kind: 'native-compaction', compactionId: JSON.parse(await readFile(join(root, 'native.json'), 'utf8')).compactionId }
        : { sessionId: id, kind: 'condensation', operationId: 'checkpoint' }
      const preview = await host.previewRecovery(recoveryRequest)
      const recovered = await host.createRecoveryBranch({ ...recoveryRequest, previewFingerprint: preview.prefixFingerprint })
      assert.equal(recovered.ok, true, JSON.stringify(recovered))
      await writeFile(join(root, 'recovery.json'), JSON.stringify(preview))
      await handle.dispose()
      id = preview.targetSessionId
      const branch = ctx.agents.get(id)
      assert.ok(branch)
      handle = { agent: branch, dispose: async () => {} }
    }
    if (stage === 'restore') {
      const targets = JSON.parse(await readFile(join(root, 'targets.json'), 'utf8'))
      let snapshot = await host.getSnapshot({ sessionId: id })
      assert.equal((await host.restoreReplacement({ sessionId: id, operationId: 'restore-edit', unitId: targets.answer, baseContextRevision: snapshot.contextRevision })).commit?.status, 'persisted-and-verified')
      snapshot = await host.getSnapshot({ sessionId: id })
      assert.equal((await host.commitContext({ sessionId: id, operationId: 'restore-exclusion', action: 'restore', unitIds: [targets.user], baseRevision: snapshot.revision })).commit?.status, 'persisted-and-verified')
    }
  }
  if (stage === 'large') {
    const session = handle.agent.session
    const started = performance.now()
    for (let index = 0; index < 100000; index++) {
      if (index % 50 === 0) session.append('user/message', createUserMessage({ content: [{ type: 'text', text: `LARGE_MESSAGE_${index}` }], source: { kind: 'user' } }), { surfaceOp: 'append' })
      else session.append('session/title-llm-request', { titleProvider: 'synthetic', messageSeqs: [], route: { provider: 'mock', model: 'mock' }, system: '', messages: [], maxTokens: 1 })
    }
    await ctx.sessions.flush(session)
    const state = await host.getSnapshot({ sessionId: id, includeRecords: false })
    const fullBuilds = host.projectionIndex.stats.fullBuilds
    let page = await host.listRecords({ sessionId: id, pageSize: 25 })
    assert.equal(page.records.length, 25)
    for (let index = 0; index < 5 && page.nextCursor; index++) page = await host.listRecords({ sessionId: id, pageSize: 25, cursor: page.nextCursor, expectedRevision: state.revision })
    session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'LARGE_SEARCH_TARGET' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    await ctx.sessions.flush(session)
    const next = await host.getSnapshot({ sessionId: id, includeRecords: false })
    const search = await host.searchRecords({ sessionId: id, query: 'LARGE_SEARCH_TARGET' })
    assert.equal(search.total, 1)
    assert.equal(host.projectionIndex.stats.fullBuilds, fullBuilds, 'normal append rebuilt complete projection')
    const result = { stage, passed: true, events: session.seq, initialRecords: state.recordCount, nextRevisionChanged: next.revision !== state.revision, incremental: host.projectionIndex.stats, milliseconds: Math.round(performance.now() - started) }
    await writeFile(join(root, 'large-evidence.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  }
  await send('CONTINUE ' + 'Synthetic retained context for compaction. '.repeat(120))
  if (stage === 'title') {
    const session = handle.agent.session
    const inputs = session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
      .map(event => ({ seq: event.seq, text: event.data.content.map(block => block.text ?? '').join('') }))
    const config = { targetWords: 6, targetCjkCharacters: 12, maxInputBytes: 50000, maxOutputTokens: 128, timeoutMs: 5000 }
    const request = { session, messages: inputs, route: session.requestHeader().config, signal: new AbortController().signal }
    const title = await generateSessionTitleWithLlm(ctx, config, request, inputs, 'synthetic-official-title')
    assert.ok(title.title)
    assert.ok(!JSON.stringify(requests.at(-1)).includes('ORIGINAL_USER'))
    assert.ok(JSON.stringify(requests.at(-1)).includes('Synthetic retained context'))
    const count = requests.length
    await assert.rejects(() => generateSessionTitleWithLlm(ctx, config, request, inputs.slice(0, 1), 'synthetic-official-title'))
    assert.equal(requests.length, count, 'fully excluded title input caused a model request')
    console.log(JSON.stringify({ stage, passed: true, officialTitle: true, allExcludedNoHttp: true }))
    await send('AFTER_TITLE')
  }
  if (stage === 'absent' || stage === 'missing-config') {
    assert.equal(capture.requests.length, 0, 'missing plugin forwarded original context')
    assert.ok(handle.agent.session.snapshotEvents().some(event => JSON.stringify(event).includes(stage === 'absent' ? 'NO_ADAPTER' : 'CONTEXT_EDITOR_PROFILE_MISSING_OR_INVALID')))
  } else {
    const messages = capture.requests.at(-1)?.messages
    assert.ok(messages)
    const text = JSON.stringify(messages)
    if (['native', 'native-restart', 'condense', 'condense-restart', 'branch-condense', 'branch-condense-restart'].includes(stage)) {
      assert.ok(text.includes('SUMMARY'))
      assert.ok(!text.includes('ORIGINAL_USER'))
      assert.ok(!text.includes('EDITED_ANSWER'))
    } else if (stage === 'restore' || stage === 'restored') {
      assert.ok(text.includes('ORIGINAL_USER'))
      assert.ok(!text.includes('EDITED_ANSWER'))
    } else {
      assert.ok(!text.includes('ORIGINAL_USER'))
      assert.ok(text.includes('EDITED_ANSWER'))
    }
    const original = handle.agent.session.snapshotEvents().find(event => event.type === 'assistant/message')
    assert.equal(original.data.message.content[0].text, 'ORIGINAL_ANSWER')
  }
  console.log(JSON.stringify({ stage, passed: true, requests: capture.requests.length }))
} finally {
  if (handle) await handle.dispose()
  if (host) await host.dispose()
  await ctx.fiber.dispose()
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
