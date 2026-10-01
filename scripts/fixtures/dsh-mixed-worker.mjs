// Independent processes, real Agent and official Messages adapter; synthetic local model only.
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
import { defineTool } from './packages/core/tools/src/index.ts'
import { DeepSeekAdapter, resolveAdapterOptions } from './packages/llm/llm-deepseek/src/index.ts'
import TokenMeter from './packages/llm/token-meter/src/index.ts'
import BasicCompactionEngine from './packages/compaction/compaction-basic/src/index.ts'
const { ContextEditorHost } = await import(pathToFileURL(join(process.env.CE_PLUGIN_ROOT, 'index.js')))
const { requestFingerprint } = await import(pathToFileURL(join(process.env.CE_PLUGIN_ROOT, 'request-transform.js')))
const root = process.env.CE_PROBE_ROOT, stage = process.env.CE_PROBE_STAGE
const withImage = !process.env.CE_PROBE_NO_IMAGE
const wireProtocol = process.env.CE_PROBE_PROTOCOL ?? 'messages'
const ctx = new Context(), requests = []
let host, handle
const image = { attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 3, width: 1, height: 1 }
const server = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk)
  if (request.url.endsWith('/files')) { response.writeHead(404, { 'content-type': 'application/json' }); response.end('{"error":{"message":"local fixture uses base64 images"}}'); return }
  const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); requests.push(payload)
  const first = stage === 'write' && requests.length === 1
  const followTool = process.env.CE_PROBE_INTERLEAVED && stage === 'write' && requests.length > 1 && requests.length <= 4
  const toolId = first ? 'paired-call' : `extra-call-${requests.length}`
  const toolText = first ? 'TOOL_PAYLOAD' : `EXTRA_PAYLOAD_${requests.length}`
  if (wireProtocol === 'chat-completions') {
    const delta = first
      ? { role: 'assistant', reasoning_content: 'PRESERVED_THOUGHT', content: 'ORIGINAL_ANSWER', tool_calls: [{ index: 0, id: 'paired-call', type: 'function', function: { name: 'echo', arguments: JSON.stringify({ text: 'TOOL_PAYLOAD' }) } }] }
      : followTool ? { role: 'assistant', tool_calls: [{ index: 0, id: toolId, type: 'function', function: { name: 'echo', arguments: JSON.stringify({ text: toolText }) } }] } : { role: 'assistant', content: 'FOLLOWUP_ANSWER' }
    const events = [{ id: 'synthetic', choices: [{ index: 0, delta, finish_reason: null }] }, { id: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: first || followTool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    return
  }
  const blocks = first ? [
    { type: 'thinking', thinking: 'PRESERVED_THOUGHT', signature: 'synthetic-signature' },
    { type: 'text', text: 'ORIGINAL_ANSWER' },
    { type: 'tool_use', id: 'paired-call', name: 'echo', input: { text: 'TOOL_PAYLOAD' } },
  ] : followTool ? [{ type: 'tool_use', id: toolId, name: 'echo', input: { text: toolText } }] : [{ type: 'text', text: 'FOLLOWUP_ANSWER' }]
  const events = [{ type: 'message_start', message: { id: 'synthetic', type: 'message', role: 'assistant', model: payload.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } }]
  blocks.forEach((block, index) => {
    events.push({ type: 'content_block_start', index, content_block: block }, { type: 'content_block_stop', index })
  })
  events.push({ type: 'message_delta', delta: { stop_reason: first || followTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } }, { type: 'message_stop' })
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Storage); await ctx.plugin(Json, { root: join(root, 'storage') }); await ctx.plugin(Domain, { backend: 'json' })
  await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: 'none' })
  await ctx.plugin(AgentLoop, { agents: [] }); await ctx.plugin(TokenMeter); await ctx.plugin(BasicCompactionEngine, { auto: false })
  ctx.tools.register(defineTool({ name: 'echo', description: 'echo', parameters: { text: { type: 'string' } }, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, async execute(args) {
    if (process.env.CE_PROBE_INTERLEAVED && args.text === 'TOOL_PAYLOAD') handle.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'MID_TURN_PLUGIN_INPUT' }], source: { kind: 'plugin', plugin: 'synthetic-fixture' } }), { surfaceOp: 'append' })
    if (process.env.CE_PROBE_TOOL_FAIL) throw new Error(args.text)
    return args.text
  } }))
  ctx.llm.registerAdapter(['mock'], new DeepSeekAdapter({
    options: () => resolveAdapterOptions({ protocol: wireProtocol, models: [{ id: 'deepseek-v4-flash', inputModalities: ['text', 'image'] }], baseURL: `http://127.0.0.1:${server.address().port}`, thinking: 'enabled' }),
    resolveApiKey: () => 'local-test', resolveUserId: () => 'synthetic',
    resolveAttachments: () => ({ readImageRequest: async ref => ({ variantId: `sha256:${'b'.repeat(64)}`, attachment: ref, data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', bytes: 3, width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: true }), imageHostPath: () => undefined }),
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  }))
  host = new ContextEditorHost(ctx); await host.init()
  let id = 'mixed-acceptance'
  if (stage === 'condense-recovered') id = JSON.parse(await readFile(join(root, 'mixed-recovery.json'), 'utf8')).sessionId
  const send = async content => {
    handle.agent.followup(createUserMessage({ content, source: { kind: 'user' } }))
    await handle.agent.whenIdle(); await ctx.sessions.flush(handle.agent.session)
    assert.ok(!handle.agent.session.snapshotEvents().slice(-5).some(event => event.type === 'step/error'), JSON.stringify(handle.agent.session.snapshotEvents().slice(-5)))
  }
  if (stage === 'write') {
    handle = await ctx.agents.create({ sessionId: id, agentOptions: { provider: 'mock', model: 'deepseek-v4-flash' } })
    await send([{ type: 'text', text: 'IMAGE_ORIGINAL' }, ...(withImage ? [{ type: 'image', attachment: image }] : [])])
    let state = await host.getSnapshot({ sessionId: id })
    const units = state.records.flatMap(record => record.units)
    const answer = units.find(unit => unit.kind === 'answer' && unit.effectiveText.includes('ORIGINAL_ANSWER'))
    const user = units.find(unit => unit.kind === 'user'), tool = units.find(unit => unit.kind === 'tool')
    assert.ok(answer && user && tool, JSON.stringify({ units, events: handle.agent.session.snapshotEvents().slice(-8) }))
    const originals = handle.agent.session.snapshotEvents().filter(event => ['assistant/message', 'user/message', 'tool/result'].includes(event.type))
    await writeFile(join(root, 'mixed-targets.json'), JSON.stringify({ answer: answer.id, user: user.id, tool: tool.id, originals, fingerprint: requestFingerprint(originals) }))
    const edit = async (unitId, text, operationId) => {
      state = await host.getSnapshot({ sessionId: id })
      const result = await host.commitReplacement({ sessionId: id, operationId, unitId, text, baseContextRevision: state.contextRevision })
      assert.equal(result.commit?.status, 'persisted-and-verified', JSON.stringify(result))
    }
    await edit(answer.id, 'EDITED_ANSWER' + (process.env.CE_PROBE_AI_SELECTION ? ' Preserve the chosen configuration and verified results.'.repeat(30) : ''), 'answer-edit')
    await edit(user.id, 'IMAGE_EDITED', 'image-edit')
    state = await host.getSnapshot({ sessionId: id })
    const preview = await host.previewContext({ sessionId: id, action: 'exclude', unitIds: [tool.id], expectedRevision: state.contextRevision })
    assert.equal(preview.ok, true, JSON.stringify(preview))
    const excluded = await host.commitContext({ sessionId: id, operationId: 'tool-exclude', action: 'exclude', unitIds: [tool.id], baseContextRevision: state.contextRevision, expandRelated: true })
    assert.equal(excluded.commit?.status, 'persisted-and-verified', JSON.stringify(excluded))
    if (withImage) {
      state = await host.getSnapshot({ sessionId: id })
      const before = requests.length
      await assert.rejects(() => host.previewCondensation({ sessionId: id, operationId: 'image-summary-rejected', baseContextRevision: state.contextRevision, unitIds: state.records.flatMap(record => record.units).map(unit => unit.id) }), /OPAQUE_CONTENT/)
      assert.equal(requests.length, before)
    }
  } else {
    const read = await ctx.sessionPersistence.open(id, 'read'); let route
    try { route = (await read.read()).events.findLast(event => event.type === 'request/header').data.header.config } finally { await read.close() }
    handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: route })
    if (stage === 'condense') {
      let state = await host.getSnapshot({ sessionId: id })
      const targets = JSON.parse(await readFile(join(root, 'mixed-targets.json'), 'utf8'))
      assert.equal((await host.commitContext({ sessionId: id, operationId: 'include-tools-for-summary', action: 'restore', unitIds: [targets.tool], baseContextRevision: state.contextRevision })).commit?.status, 'persisted-and-verified')
      state = await host.getSnapshot({ sessionId: id })
      const selectedUnits = process.env.CE_PROBE_AI_SELECTION
        ? state.records.find(record => record.kind === 'ai').units.filter(unit => (process.env.CE_PROBE_ANSWER_ONLY ? ['answer'] : ['answer', 'reasoning']).includes(unit.kind))
        : state.records.flatMap(record => record.units)
      const request = { sessionId: id, operationId: 'mixed-checkpoint', baseContextRevision: state.contextRevision, unitIds: selectedUnits.map(unit => unit.id) }
      const proposal = await host.previewCondensation(request)
      assert.equal(proposal.ok, true, JSON.stringify(proposal))
      if (process.env.CE_PROBE_AI_SELECTION) {
        assert.ok(proposal.sourceUnits.some(unit => unit.kind === 'tool' && proposal.autoExpandedUnitIds.includes(unit.id)), JSON.stringify(proposal))
        assert.equal(proposal.sourceUnits.some(unit => unit.kind === 'user'), Boolean(process.env.CE_PROBE_INTERLEAVED))
        if (process.env.CE_PROBE_INTERLEAVED) {
          const mid = proposal.sourceUnits.find(unit => unit.text.includes('MID_TURN_PLUGIN_INPUT'))
          assert.ok(mid && proposal.autoExpandedUnitIds.includes(mid.id))
          assert.equal(proposal.sourceUnits.filter(unit => unit.kind === 'tool').length, 4)
        }
      }
      const input = JSON.stringify(requests.at(-1))
      assert.ok(input.includes('PRESERVED_THOUGHT') && input.includes('EDITED_ANSWER') && input.includes('TOOL_PAYLOAD'))
      assert.equal((await host.commitCondensation({ ...request, summary: 'MIXED_CHECKPOINT_SUMMARY' })).commit?.status, 'persisted-and-verified')
    }
    if (stage === 'condense-recover') {
      const request = { sessionId: id, kind: 'condensation', operationId: 'mixed-checkpoint' }
      const preview = await host.previewRecovery(request)
      const recovery = await host.createRecoveryBranch({ ...request, previewFingerprint: preview.prefixFingerprint })
      assert.equal(recovery.ok, true, JSON.stringify(recovery))
      const target = preview.targetSessionId
      assert.ok(target, JSON.stringify(recovery))
      await writeFile(join(root, 'mixed-recovery.json'), JSON.stringify({ sessionId: target }))
      await handle.dispose()
      id = target
      const branch = ctx.agents.get(id)
      assert.ok(branch)
      handle = { agent: branch, dispose: async () => {} }
    }
    if (stage === 'inline-restore') {
      const state = await host.getSnapshot({ sessionId: id })
      const restored = await host.restoreCondensation({ sessionId: id, operationId: 'mixed-checkpoint', baseContextRevision: state.contextRevision })
      assert.equal(restored.commit?.status, 'persisted-and-verified', JSON.stringify(restored))
      assert.equal((await host.getSnapshot({ sessionId: id })).condensations.length, 0)
    }
    if (stage === 'restore') {
      const targets = JSON.parse(await readFile(join(root, 'mixed-targets.json'), 'utf8'))
      for (const unitId of [targets.answer, targets.user]) {
        const state = await host.getSnapshot({ sessionId: id })
        const result = await host.restoreReplacement({ sessionId: id, operationId: 'restore-' + unitId, unitId, baseContextRevision: state.contextRevision })
        assert.equal(result.commit?.status, 'persisted-and-verified', JSON.stringify(result))
      }
      const state = await host.getSnapshot({ sessionId: id })
      const result = await host.commitContext({ sessionId: id, operationId: 'tool-restore', action: 'restore', unitIds: [targets.tool], baseContextRevision: state.contextRevision, expandRelated: true })
      assert.equal(result.commit?.status, 'persisted-and-verified', JSON.stringify(result))
    }
  }
  await send([{ type: 'text', text: 'MIXED_CONTINUE_' + stage }])
  const payload = JSON.stringify(requests.at(-1).messages)
  const restored = ['restore', 'restored'].includes(stage)
  const checkpointRestored = ['condense-recover', 'condense-recovered', 'inline-restore', 'inline-restart'].includes(stage)
  if (stage === 'condense' || stage === 'condense-restart') {
    assert.ok(payload.includes('MIXED_CHECKPOINT_SUMMARY') && !payload.includes('EDITED_ANSWER') && !payload.includes('PRESERVED_THOUGHT'))
    if (process.env.CE_PROBE_AI_SELECTION) {
      assert.ok(payload.includes('IMAGE_EDITED') && payload.includes('MIXED_CONTINUE_write'), 'Unselected messages must remain')
      assert.ok(!payload.includes('paired-call') && !payload.includes('TOOL_PAYLOAD'), 'Tool group must be condensed together')
      assert.equal(payload.split('MIXED_CHECKPOINT_SUMMARY').length - 1, 1)
      if (process.env.CE_PROBE_INTERLEAVED) assert.ok(!payload.includes('MID_TURN_PLUGIN_INPUT') && !payload.includes('EXTRA_PAYLOAD'))
    }
  } else {
  assert.ok(payload.includes(restored ? 'ORIGINAL_ANSWER' : 'EDITED_ANSWER'), payload)
  assert.ok(payload.includes(restored ? 'IMAGE_ORIGINAL' : 'IMAGE_EDITED'), payload)
  assert.equal(payload.includes('TOOL_PAYLOAD'), restored || checkpointRestored, payload)
  assert.equal(payload.includes('paired-call'), restored || checkpointRestored, payload)
  if (checkpointRestored) {
    assert.ok(!payload.includes('MIXED_CHECKPOINT_SUMMARY'))
    if (stage.startsWith('inline')) assert.ok(payload.includes('"MIXED_CONTINUE_condense"'), 'Individual restore must retain later messages')
    else assert.ok(!payload.includes('"MIXED_CONTINUE_condense"') && !payload.includes('"MIXED_CONTINUE_condense-restart"'), 'Recovery must restore the exact prefix')
  }
  if (checkpointRestored && process.env.CE_PROBE_INTERLEAVED) assert.ok(payload.includes('MID_TURN_PLUGIN_INPUT') && payload.includes('EXTRA_PAYLOAD_4'))
  assert.ok(payload.includes('PRESERVED_THOUGHT'), payload)
  if (wireProtocol === 'messages') assert.ok(payload.includes('synthetic-signature'), payload)
  if (withImage) assert.ok(payload.includes('image/png') && payload.includes('AQID'), payload)
  }
  const saved = JSON.parse(await readFile(join(root, 'mixed-targets.json'), 'utf8'))
  const current = handle.agent.session.snapshotEvents().filter(event => saved.originals.some(original => original.seq === event.seq))
  assert.equal(requestFingerprint(current), saved.fingerprint, 'original event changed')
  await writeFile(join(root, `mixed-${stage}.json`), JSON.stringify({ stage, requests, passed: true }, null, 2))
  if (process.env.CE_PROBE_TOOL_FAIL && restored) {
    const results = requests.at(-1).messages.flatMap(message => message.content ?? []).filter(block => block.type === 'tool_result' && block.tool_use_id === 'paired-call')
    if (wireProtocol === 'messages') { assert.equal(results.length, 1); assert.equal(results[0].is_error, true) }
  }
  console.log(JSON.stringify({ stage, wireProtocol, passed: true, requests: requests.length, verified: [process.env.CE_PROBE_MIGRATED ? 'migrated-unsigned-thought' : wireProtocol === 'messages' ? 'answer-with-signed-thought' : 'answer-with-reasoning', 'paired-tool', ...(withImage ? ['image-text', 'image-summary-rejected'] : []), ...(stage.startsWith('condense') ? ['reasoning-and-closed-tools-checkpoint'] : []), ...(process.env.CE_PROBE_TOOL_FAIL && restored && wireProtocol === 'messages' ? ['single-error-tool-result'] : []), ...(process.env.CE_PROBE_MIGRATED ? [] : ['original-events-unchanged'])] }))
} finally {
  if (handle) await handle.dispose(); if (host) await host.dispose(); await ctx.fiber.dispose()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
