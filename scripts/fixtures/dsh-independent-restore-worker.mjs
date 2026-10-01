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
const { ContextEditorHost } = await import(pathToFileURL(join(process.env.CE_PLUGIN_ROOT, 'index.js')))
const { requestFingerprint } = await import(pathToFileURL(join(process.env.CE_PLUGIN_ROOT, 'request-transform.js')))
const root = process.env.CE_PROBE_ROOT, stage = process.env.CE_PROBE_STAGE
const ctx = new Context(), requests = []
let host, handle
const id = 'individual-restore'
const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk)
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end([
    { id: 'synthetic', choices: [{ index: 0, delta: { role: 'assistant', content: 'Fixed synthetic answer.' }, finish_reason: null }] },
    { id: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Storage); await ctx.plugin(Json, { root: join(root, 'storage') }); await ctx.plugin(Domain, { backend: 'json' })
  await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(TokenMeter); await ctx.plugin(BasicCompactionEngine, { auto: false })
  ctx.llm.registerAdapter(['mock'], new DeepSeekAdapter({ options: () => resolveAdapterOptions({ protocol: 'chat-completions', baseURL: `http://127.0.0.1:${server.address().port}`, thinking: 'disabled' }), resolveApiKey: () => 'local-only', resolveUserId: () => 'synthetic', prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) }))
  host = new ContextEditorHost(ctx); await host.init()
  const snapshot = () => host.getSnapshot({ sessionId: id })
  const send = async text => { handle.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await handle.agent.whenIdle(); await ctx.sessions.flush(handle.agent.session) }
  const restore = async operationId => host.restoreCondensation({ sessionId: id, operationId, baseContextRevision: (await snapshot()).contextRevision })
  if (stage === 'write') {
    handle = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'mock', model: 'first' } })
    const units = {}
    for (const name of ['A', 'B']) {
      const before = new Set((await snapshot()).records.flatMap(record => record.units).map(unit => unit.id))
      await send(`${name}_ORIGINAL ` + 'Useful synthetic details. '.repeat(80))
      let state = await snapshot()
      const selected = state.records.flatMap(record => record.units).filter(unit => !before.has(unit.id))
      units[name] = selected.find(unit => unit.kind === 'user').id
      if (name === 'A') {
        assert.equal((await host.commitReplacement({ sessionId: id, operationId: 'edit-A', unitId: units.A, text: 'A_EDITED ' + 'Preserve this edit. '.repeat(80), baseContextRevision: state.contextRevision })).commit.status, 'persisted-and-verified')
        state = await snapshot()
      }
      const request = { sessionId: id, operationId: name, unitIds: selected.map(unit => unit.id), baseContextRevision: state.contextRevision }
      assert.equal((await host.previewCondensation(request)).ok, true)
      assert.equal((await host.commitCondensation({ ...request, summary: `${name}_SUMMARY` })).commit.status, 'persisted-and-verified')
    }
    await send('C_LATER')
    await writeFile(join(root, 'independent.json'), JSON.stringify({ units, events: handle.agent.session.snapshotEvents(), fingerprint: requestFingerprint(handle.agent.session.snapshotEvents()) }))
  } else {
    const read = await ctx.sessionPersistence.open(id, 'read'); let route
    try { route = (await read.read()).events.findLast(event => event.type === 'request/header').data.header.config } finally { await read.close() }
    handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: route })
    if (stage === 'cover' || stage === 'cover-restored') {
      // Native compaction requires enough effective input to exceed its framed summary.
      await send('COMPACTION_PADDING ' + 'Synthetic context for native compaction. '.repeat(150))
      requests.length = 0
      assert.ok(await ctx.compaction.compactNow(handle.agent, new AbortController().signal))
      if (stage === 'cover-restored') assert.ok(JSON.stringify(requests[0]).includes('A_EDITED') && !JSON.stringify(requests[0]).includes('A_SUMMARY'))
      const count = handle.agent.session.seq
      assert.equal((await restore(stage === 'cover' ? 'A' : 'B')).commit.status, 'unsupported')
      assert.equal(handle.agent.session.seq, count)
      await send('CHECK_COVERED')
      assert.ok(!JSON.stringify(requests.at(-1).messages).includes('A_EDITED'), 'Covered restore mapping must not reinsert old messages')
      console.log(JSON.stringify({ stage, passed: true, coveredRestoreRejectedWithoutWrite: true })); process.exitCode = 0
    } else {
      if (stage.startsWith('fault-') && stage !== 'fault-recover') {
        const point = stage.slice(6), runtime = host.requestTransform
        if (point === 'pending') runtime.appendSelection = () => process.exit(86)
        if (point === 'appended') { const append = runtime.appendSelection.bind(runtime); runtime.appendSelection = (...args) => { append(...args); process.exit(86) } }
        if (point === 'flushed') { const flush = ctx.sessions.flush.bind(ctx.sessions); ctx.sessions.flush = async (...args) => { await flush(...args); process.exit(86) } }
        if (point === 'result') runtime.settle = () => process.exit(86)
      }
      if (stage === 'restore-A' || stage.startsWith('fault-')) {
        if (stage === 'fault-recover') await host.getOperation({ sessionId: id, operationId: 'restore-condensation:A' })
        if (stage === 'restore-A') assert.equal((await host.restoreCondensation({ sessionId: id, operationId: 'A', baseContextRevision: 'stale' })).commit.status, 'conflict')
        assert.equal((await restore('A')).commit.status, 'persisted-and-verified')
        const count = handle.agent.session.seq
        assert.equal((await restore('A')).commit.status, 'persisted-and-verified')
        assert.equal(handle.agent.session.seq, count, 'duplicate restore appended')
      }
      if (stage === 'restart-A') {
        const header = handle.agent.session.requestHeader()
        handle.agent.session.append('request/header', { header: { ...header, config: { ...header.config, provider: 'mock', model: 'second' } }, reason: 'change' })
      }
      if (stage === 'restore-B') assert.equal((await restore('B')).commit.status, 'persisted-and-verified')
      if (stage === 'restart-B') {
        const count = handle.agent.session.seq
        assert.equal((await restore('A')).commit.status, 'persisted-and-verified')
        assert.equal(handle.agent.session.seq, count, 'late retry must not revert later operations')
      }
      if (stage === 'edit-restored' || stage === 'recondense') {
        const saved = JSON.parse(await readFile(join(root, 'independent.json'), 'utf8'))
        const state = await snapshot()
        if (stage === 'edit-restored') assert.equal((await host.commitReplacement({ sessionId: id, operationId: 'edit-restored-A', unitId: saved.units.A, text: 'A_EDITED_AGAIN ' + 'Retain independent changes. '.repeat(80), baseContextRevision: state.contextRevision })).commit.status, 'persisted-and-verified')
        else {
          const request = { sessionId: id, operationId: 'A2', unitIds: [saved.units.A], baseContextRevision: state.contextRevision }
          assert.equal((await host.previewCondensation(request)).ok, true)
          assert.equal((await host.commitCondensation({ ...request, summary: 'A2_SUMMARY' })).commit.status, 'persisted-and-verified')
          assert.equal((await restore('A2')).commit.status, 'persisted-and-verified')
        }
      }
      const state = await snapshot()
      assert.equal(state.condensations.some(value => value.operationId === 'A'), false)
      assert.equal(state.condensations.some(value => value.operationId === 'B'), !['restore-B', 'restart-B'].includes(stage))
      await send('CHECK_' + stage)
      if (process.env.CE_DESKTOP_RUNTIME && stage === 'restart-A') {
        assert.equal(requests.at(-1).model, 'deepseek-v4-pro')
        assert.equal(requests.at(-1).thinking.type, 'enabled')
        assert.equal(requests.at(-1).output_config.effort, 'low')
      }
      const payload = JSON.stringify(requests.at(-1).messages)
      assert.ok(payload.includes('A_EDITED') && !payload.includes('A_ORIGINAL') && !payload.includes('A_SUMMARY'), payload)
      assert.ok(payload.includes('C_LATER'), payload)
      assert.equal(payload.includes('B_SUMMARY'), !['restore-B', 'restart-B'].includes(stage), payload)
      assert.equal(payload.includes('B_ORIGINAL'), ['restore-B', 'restart-B'].includes(stage), payload)
      const saved = JSON.parse(await readFile(join(root, 'independent.json'), 'utf8'))
      assert.equal(requestFingerprint(handle.agent.session.snapshotEvents().slice(0, saved.events.length)), saved.fingerprint)
    }
  }
  await writeFile(join(root, `independent-${stage}.json`), JSON.stringify({ stage, passed: true, requests }, null, 2))
  console.log(JSON.stringify({ stage, passed: true, requests: requests.length, sessionId: id }))
} finally {
  if (handle) await handle.dispose(); if (host) await host.dispose(); await ctx.fiber.dispose()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
