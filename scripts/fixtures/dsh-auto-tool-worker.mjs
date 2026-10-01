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
  const first = requests.length === 1
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
  const send = async text => {
    handle.agent.followup(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}))
    await handle.agent.whenIdle(); await ctx.sessions.flush(handle.agent.session)
    assert.ok(!handle.agent.session.snapshotEvents().slice(-5).some(event=>event.type==='step/error'))
  }
  handle=await ctx.agents.create({sessionId:'repair-parent',agentOptions:{provider:'mock',model:'deepseek-v4-flash'}})
  await send('TOOL_REPAIR_ORIGINAL')
  const events=handle.agent.session.snapshotEvents()
  const call=events.find(event=>event.type==='assistant/message'&&event.data.message.content.some(block=>block.type==='tool-call'))
  assert.ok(call)
  const {buildForkSeed}=await import('@deepseek-ai/dsh-session')
  const prefix=buildForkSeed(events,call.seq)
  await handle.dispose()
  handle=await ctx.agents.create({sessionId:'repair-branch',seed:prefix,inheritedEventCount:call.seq+1,meta:{parentSession:'repair-parent',isSeeded:true},agentOptions:{provider:'mock',model:'deepseek-v4-flash'}})
  const api=await import(pathToFileURL(join(process.env.CE_PLUGIN_ROOT,'host-api.js')))
  api.validateSessionCandidate(handle.agent.session)
  const repairs=handle.agent.session.snapshotEvents().filter(event=>event.type==='tool/result'&&event.data.error?.code==='TOOL_NOT_STARTED')
  assert.equal(repairs.length,1);assert.equal(repairs[0].data.message.role,'tool');assert.equal(repairs[0].data.message.isError,true)
  assert.equal(repairs[0].data.message.toolCallId,'paired-call')
  const snapshot=()=>host.getSnapshot({sessionId:'repair-branch'})
  const tool=(await snapshot()).records.flatMap(record=>record.units).find(unit=>unit.kind==='tool')
  assert.ok(tool)
  let state=await snapshot()
  const exclude=await host.commitContext({sessionId:'repair-branch',operationId:'repair-exclude',action:'exclude',unitIds:[tool.id],expandRelated:true,baseContextRevision:state.contextRevision})
  assert.equal(exclude.commit.status,'persisted-and-verified')
  await send('AFTER_REPAIR_EXCLUDE')
  assert.ok(!JSON.stringify(requests.at(-1).messages).includes('paired-call'))
  state=await snapshot()
  assert.equal((await host.commitContext({sessionId:'repair-branch',operationId:'repair-restore',action:'restore',unitIds:[tool.id],expandRelated:true,baseContextRevision:state.contextRevision})).commit.status,'persisted-and-verified')
  await send('AFTER_REPAIR_RESTORE')
  const results=requests.at(-1).messages.flatMap(message=>message.content??[]).filter(block=>block.type==='tool_result'&&block.tool_use_id==='paired-call')
  const calls=requests.at(-1).messages.flatMap(message=>message.content??[]).filter(block=>block.type==='tool_use'&&block.id==='paired-call')
  assert.equal(calls.length,1);assert.equal(results.length,1);assert.equal(results[0].is_error,true)
  api.validateSessionCandidate(handle.agent.session)
  await writeFile(join(root,'auto-tool-repair.json'),JSON.stringify({passed:true,repairs,requests,events:handle.agent.session.snapshotEvents()},null,2))
  console.log(JSON.stringify({stage,passed:true,verified:['official-fork-tool-not-started','v4-validator','exclude-restore-tool-pair','exactly-one-error-result']}))

} finally {
  if (handle) await handle.dispose(); if (host) await host.dispose(); await ctx.fiber.dispose()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
