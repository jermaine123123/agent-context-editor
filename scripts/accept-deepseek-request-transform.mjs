import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const hostRoot = process.argv[2]
if (!hostRoot) throw new Error('Pass the source host root; this is source integration, not packaged Web acceptance.')
const root = process.env.CE_PROBE_ROOT ?? await mkdtemp(join(tmpdir(), 'ce-request-transform-'))
let worker = await readFile(new URL(process.env.CE_PROBE_AUTO_TOOL ? './fixtures/dsh-auto-tool-worker.mjs' : process.env.CE_PROBE_INDEPENDENT ? './fixtures/dsh-independent-restore-worker.mjs' : process.env.CE_PROBE_MIXED ? './fixtures/dsh-mixed-worker.mjs' : './fixtures/dsh-request-transform-worker.mjs', import.meta.url), 'utf8')
// Windows can allocate low ephemeral ports that fetch refuses (e.g. 4045).
// Use a high fixture port and retry collisions; this never changes host code.
worker = `async function listenFixtureServer(server) {
  for (let attempt=0; attempt<30; attempt++) {
    try { await new Promise((resolve,reject)=>{
      const failed=error=>{server.off('listening',ready);reject(error)};
      const ready=()=>{server.off('error',failed);resolve()};
      server.once('error',failed);server.once('listening',ready);
      server.listen(20000+Math.floor(Math.random()*30000),'127.0.0.1');
    }); return } catch(error) { if(error.code!=='EADDRINUSE')throw error }
  }
  throw Error('No free high local fixture port');
}\n` + worker.replace(/await new Promise\([^\n]*server\.listen\(0, '127\.0\.0\.1', resolve\)[^\n]*\)/g,'await listenFixtureServer(server)')
let resolutionBootstrap
if (process.env.CE_DESKTOP_RUNTIME) {
  worker = worker.replace("import { mountAgentLoopTestDependencies } from './packages/test-support/agent-loop-testkit/src/index.ts'", `
    async function mountAgentLoopTestDependencies(ctx) {
      for (const name of ['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent']) {
        const module = await import('@deepseek-ai/dsh-' + name); await ctx.plugin(module.default)
      }
    }
  `)
  worker = worker.replace(/from '\.\/packages\/[^/]+\/([^/]+)\/src\/index\.ts'/g, (_match, name) => `from '@deepseek-ai/dsh-${name}'`)
  worker = worker.replaceAll("protocol: 'chat-completions', ", '').replaceAll(", thinking: 'disabled'", '')
    .replaceAll("model: 'mock'", "model: 'deepseek-flash'").replaceAll("model: 'first'", "model: 'deepseek-flash'").replaceAll("model: 'second'", "model: 'deepseek-v4-pro'")
    .replaceAll("resolveApiKey: () => 'local-only'", "resolveAuth: async () => ({ headers: { authorization: 'Bearer local-only' } })")
    .replaceAll("resolveApiKey: () => 'synthetic-local-only'", "resolveAuth: async () => ({ headers: { authorization: 'Bearer local-only' } })")
    .replaceAll("resolveApiKey: () => 'local-test'", "resolveAuth: async () => ({ headers: { authorization: 'Bearer local-only' } })")
    .replaceAll("protocol: wireProtocol, ", '').replaceAll(", thinking: 'enabled'", '')
    .replaceAll('deepseek-v4-flash', 'deepseek-flash')
    .replace("models: [{ id: 'deepseek-flash', inputModalities: ['text', 'image'] }]", "models: [{ id: 'deepseek-flash', inputModalities: ['text', 'image'] }, ...(process.env.CE_PROBE_MIGRATED ? [{ id: 'deepseek-v4-flash', inputModalities: ['text', 'image'] }] : [])]")
    .replace("let id = 'mixed-acceptance'", "let id = process.env.CE_PROBE_SESSION_ID ?? 'mixed-acceptance'")
    .replaceAll("const targets = JSON.parse(await readFile(join(root, 'mixed-targets.json'), 'utf8'))", "const targets = JSON.parse(await readFile(join(root, 'mixed-targets.json'), 'utf8')); if (process.env.CE_PROBE_MIGRATED) for (const key of ['answer','user','tool']) targets[key] = targets[key].replaceAll('mixed-acceptance', id)")
    .replace("assert.equal(requestFingerprint(current), saved.fingerprint, 'original event changed')", "if (!process.env.CE_PROBE_MIGRATED) assert.equal(requestFingerprint(current), saved.fingerprint, 'original event changed')")
    .replace("if (wireProtocol === 'messages') assert.ok(payload.includes('synthetic-signature'), payload)", "if (wireProtocol === 'messages' && !process.env.CE_PROBE_MIGRATED) assert.ok(payload.includes('synthetic-signature'), payload)")
    .replaceAll("source: { kind: 'plugin', plugin: 'synthetic-fixture' }", "source: { kind: 'synthetic-fixture' }")
    .replace(/session\.append\('session\/title-llm-request', \{ titleProvider: 'synthetic', messageSeqs: \[\], route: \{[^}]+\}, system: '', messages: \[\], maxTokens: 1 \}\)/g, "session.append('model/selection', { provider: 'mock', model: 'deepseek-flash' })")
    .replaceAll("handle.agent.session.append('request/header', { header: { ...header, config: { ...header.config, provider: 'mock', model: 'deepseek-v4-pro' } }, reason: 'change' })",
      "handle.agent.session.append('model/selection', { provider: 'mock', model: 'deepseek-v4-pro', reasoningEffort: 'low' })")
    .replace("handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: route })", "handle = await ctx.agents.resume({ resumeSessionId: id, agentOptions: stage === 'restart-A' ? { ...route, provider: 'mock', model: 'deepseek-v4-pro', reasoningEffort: 'low' } : route })")
  if (!process.env.CE_PROBE_MIXED) {
    worker = worker.replace(/response.end\(\[[\s\S]*?\]\.map\(event => `data: \$\{JSON.stringify\(event\)\}\\n\\n`\)\.join\(''\) \+ 'data: \[DONE\]\\n\\n'\)/,
      `const answer = typeof content === 'undefined' ? 'Fixed synthetic answer.' : content;
      response.end([
        {type:'message_start',message:{id:'synthetic',type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:100,output_tokens:0}}},
        {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
        {type:'content_block_delta',index:0,delta:{type:'text_delta',text:answer}},
        {type:'content_block_stop',index:0},
        {type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:8}},
        {type:'message_stop'},
      ].map(event=>'event: '+event.type+'\\ndata: '+JSON.stringify(event)+'\\n\\n').join(''))`)
  }
  resolutionBootstrap = `import { registerHooks } from 'node:module';
    registerHooks({resolve(specifier,context,next){return next(specifier,specifier.startsWith('@deepseek-ai/')?{...context,parentURL:${JSON.stringify(pathToFileURL(join(resolve(hostRoot), 'entry.mjs')).href)}}:context)}});
  `
} else if (process.env.CE_PUBLISHED_HOST) {
  worker = worker.replace("const wireProtocol = process.env.CE_PROBE_PROTOCOL ?? 'messages'", "const wireProtocol = process.env.CE_PROBE_PROTOCOL ?? 'chat-completions'")
  const requireHost = createRequire(join(resolve(hostRoot), 'node_modules/@deepseek-ai/dsh/package.json'))
  const hostUrl = name => pathToFileURL(requireHost.resolve(name)).href
  worker = worker.replace("import { mountAgentLoopTestDependencies } from './packages/test-support/agent-loop-testkit/src/index.ts'", `
    async function mountAgentLoopTestDependencies(ctx) {
      for (const url of ${JSON.stringify(['llm', 'session', 'session-projection', 'system-prompt', 'tools', 'agent'].map(name => hostUrl('@deepseek-ai/dsh-' + name)))}) {
        const module = await import(url); await ctx.plugin(module.default)
      }
    }
  `)
  worker = worker.replace(/from '(\.\/packages\/[^/]+\/([^/]+)\/src\/index\.ts|@deepseek-ai\/cordis)'/g, (_match, specifier, name) => `from '${hostUrl(name ? '@deepseek-ai/dsh-' + name : specifier)}'`)
  if (worker.includes("from './packages/")) throw new Error('Unmapped source import in published-host fixture')
  resolutionBootstrap = `import { registerHooks } from 'node:module';
    registerHooks({resolve(specifier,context,next){return next(specifier,specifier.startsWith('@deepseek-ai/')?{...context,parentURL:${JSON.stringify(pathToFileURL(join(resolve(hostRoot),'node_modules/@deepseek-ai/dsh/lib/bin.js')).href)}}:context)}});
  `
}
if (resolutionBootstrap) {
  const entry = join(root, 'fixture-worker.mjs')
  await writeFile(entry, worker)
  worker = resolutionBootstrap + `await import(${JSON.stringify(pathToFileURL(entry).href)});`
}
const pluginRoot = process.env.CE_PLUGIN_ROOT ?? resolve(fileURLToPath(new URL('../adapters/deepseek-harness/', import.meta.url)))
const stages = process.env.CE_PROBE_STAGE ? process.env.CE_PROBE_STAGE.split(',') : ['write', 'restart', 'absent', 'restore', 'restored']
console.log(JSON.stringify({ root, hostRoot: resolve(hostRoot), pluginRoot, evidence: process.env.CE_DESKTOP_RUNTIME ? 'official-desktop-bundled-agent-local-http' : process.env.CE_PUBLISHED_HOST ? 'published-host-real-agent-official-provider-local-http' : 'source-host-real-agent-official-provider-local-http' }))
const evidence = { testedAt: new Date().toISOString(), pluginVersion: JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8')).version, mixed: Boolean(process.env.CE_PROBE_MIXED), stages: [] }
for (const stage of stages) {
  if(stage==='missing-config'){
    const path=join(root,'storage/context_editor_requests.json')
    const stored=JSON.parse(await readFile(path,'utf8'))
    await writeFile(join(root,'profiles-before-removal.json'),JSON.stringify(stored,null,2))
    stored.tables.profiles={}
    await writeFile(path,JSON.stringify(stored,null,2))
  }
  const env = { ...process.env, CE_PROBE_ROOT: root, CE_PLUGIN_ROOT: pluginRoot, CE_PROBE_STAGE: stage }
  for (const name of Object.keys(env)) if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) delete env[name]
  const desktop = process.env.CE_DESKTOP_RUNTIME
  if (desktop) env.ELECTRON_RUN_AS_NODE = '1'
  const result = spawnSync(desktop ?? process.execPath, [...(desktop ? ['--expose-internals'] : process.env.CE_PUBLISHED_HOST ? [] : ['--import', 'tsx/esm']), '--input-type=module', '-'], { cwd: desktop ? resolve(root) : resolve(hostRoot), input: worker, encoding: 'utf8', env, windowsHide: true, timeout: 45_000 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  evidence.stages.push({ stage, exitCode: result.status, checks: result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => { try { return JSON.parse(line) } catch { return { output: line } } }) })
  if (stage.startsWith('fault-') && stage !== 'fault-recover' && result.status === 86) { console.log(JSON.stringify({ stage, interrupted: true })); continue }
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
}
await writeFile(join(root, 'acceptance-evidence.json'), JSON.stringify(evidence, null, 2))
