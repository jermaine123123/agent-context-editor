// Uses an already installed candidate in a synthetic profile; never points at the user's real DSH_HOME.
import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { parse as parseYaml } from 'yaml'
import { pathToFileURL } from 'node:url'
import {verifyCandidate} from './deepseek-acceptance-artifact.mjs'
const run = promisify(execFile)
const root = resolve(process.argv[2]); const hostRoot=join(root,'desktop'), home=resolve(process.env.CE_DESKTOP_HOME??join(root,'home')), profile='desktop', pnpmEntry=join(hostRoot,'resources/runtime/pnpm/bin/pnpm.mjs'); const archive=resolve(process.argv[3]??'release/context-editor-deepseek-harness-0.6.0.tgz')
if (!hostRoot || !home || !profile || !pnpmEntry) throw new Error('Arguments: host source root, isolated DSH_HOME, profile, pnpm JS entry')
const manifestPath = join(home, 'profiles', profile, 'package.json')
const manifest = await readFile(manifestPath, 'utf8')
const candidate=await verifyCandidate(archive,join(home,'profiles',profile,'node_modules/context-editor-deepseek-harness'))
const workspace = join(root, 'synthetic-workspace')
await mkdir(workspace, { recursive: true })
const requests = []
const cloud = process.env.CE_CLOUD_SMOKE === '1'
let cloudBudget
if(cloud){
  try{cloudBudget=JSON.parse(await readFile(join(root,'cloud-budget.json'),'utf8'))}catch{
    let prior=0;try{prior=JSON.parse(await readFile(join(root,'home/cloud-evidence.json'),'utf8')).requestCount??0}catch{}
    cloudBudget={limit:8,attempts:prior,requests:[],historicalAttempts:prior}
  }
}
const server = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  if (cloud) {
    if (cloudBudget.attempts >= cloudBudget.limit) { response.writeHead(429); response.end('Cloud smoke request limit reached'); return }
    const evidence={attempt:++cloudBudget.attempts,startedAt:new Date().toISOString(),requestSha256:createHash('sha256').update(JSON.stringify(requests.at(-1))).digest('hex')}
    cloudBudget.requests.push(evidence);await writeFile(join(root,'cloud-budget.json'),JSON.stringify(cloudBudget,null,2))
    try {
      const payload={...requests.at(-1),max_tokens:96}
      const upstream=await fetch('https://api.deepseek.com'+request.url,{method:'POST',headers:{'content-type':'application/json','x-api-key':env.DEEPSEEK_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)})
      evidence.httpStatus=upstream.status
      response.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'text/event-stream'})
      for await(const chunk of upstream.body)response.write(chunk)
      response.end()
      evidence.completed=true
    } catch { evidence.completed=false;response.writeHead(502);response.end('Cloud transport unavailable') }
    await writeFile(join(root,'cloud-budget.json'),JSON.stringify(cloudBudget,null,2))
    return
  }
  if (!request.url.includes('messages')) {
    const firstThought = process.env.CE_PANEL_AI_SELECTION && requests.length === 1
    const events = [
      { id: 'synthetic', choices: [{ index: 0, delta: { role: 'assistant', content: 'WEB_ORIGINAL_ASSISTANT' + (firstThought ? ' Preserve the selected answer facts.'.repeat(30) : ''), ...(firstThought ? { reasoning_content: 'WEB_ORIGINAL_THOUGHT. '.repeat(30) } : {}) }, finish_reason: null }] },
      { id: 'synthetic', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 8, total_tokens: 108 } },
    ]
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n')
    return
  }
  const events = [
    { type: 'message_start', message: { id: 'synthetic', type: 'message', role: 'assistant', model: 'deepseek-flash', content: [], stop_reason: null, usage: { input_tokens: 100, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'WEB_ORIGINAL_ASSISTANT' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } },
    { type: 'message_stop' },
  ]
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''))
})
await new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolvePromise) })
const env = { ...process.env }
for (const name of Object.keys(env)) if (/(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name)) delete env[name]
Object.assign(env, { DSH_HOME: home, USERPROFILE: home, HOME: home, DEEPSEEK_API_KEY: 'local-test', DEEPSEEK_BASE_URL: `http://127.0.0.1:${server.address().port}/anthropic` })
if(cloud){
  const credentials=parseYaml(await readFile(process.env.CE_CREDENTIALS_FILE??join(homedir(),'.dsh/.credentials.yaml'),'utf8'))
  const key=process.env.DEEPSEEK_API_KEY??credentials.refs?.DEEPSEEK_API_KEY
  if(typeof key!=='string'||!key){await writeFile(join(home,'cloud-evidence.json'),JSON.stringify({completed:false,reason:'No API-key credential available'}));server.close();process.exit(1)}
  env.DEEPSEEK_API_KEY=key
}
let child
let desktopApp, nativePage
let origin
let cookie
let logs = ''
let sessionId = `ce-web-${randomUUID()}`
const ownedSessions=new Set()
const evidence = []
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))
const sanitize = text => text.replaceAll(env.DEEPSEEK_API_KEY??'local-test','[redacted]').replace(/([?&]token=)[^\s&]+/g, '$1[redacted]')
async function stop() {
  if (desktopApp) {
    for(const id of ownedSessions)await rpc('session/cancel',{sessionId:id}).catch(()=>{})
    for(let attempt=0;attempt<450;attempt++){
      const states=await Promise.all([...ownedSessions].map(id=>rpc('contextEditor/getSnapshot',{sessionId:id}).catch(()=>({running:false}))))
      if(states.every(state=>!state.running))break
      await sleep(100)
    }
    await desktopApp.close(); desktopApp=undefined; nativePage=undefined; return
  }
  if (!child) return
  const current = child
  const exited = new Promise(resolvePromise => current.once('exit', resolvePromise))
  if (current.exitCode === null) {
    if(current.connected)current.send({ type: 'shutdown' },()=>{});
    await Promise.race([exited, new Promise((_, reject) => { const t=setTimeout(()=>reject(new Error('Host shutdown timed out')),15000);t.unref() })]);
  }
  child = undefined
}
async function start() {
  logs = ''
  const resources = join(hostRoot,'resources'), runtime=join(resources,'app.asar/dsh');
  if (process.env.CE_DESKTOP_WINDOW === '1') {
    const {_electron}=await import(pathToFileURL(process.env.CE_PLAYWRIGHT_ENTRY))
    for(const path of ['AppData/Roaming','AppData/Local','electron-user-data'])await mkdir(join(home,path),{recursive:true})
    desktopApp=await _electron.launch({executablePath:join(hostRoot,'DeepSeek Harness.exe'),args:['--lang=zh-CN','--disable-gpu','--user-data-dir='+join(home,'electron-user-data')],cwd:home,env:{...env,APPDATA:join(home,'AppData/Roaming'),LOCALAPPDATA:join(home,'AppData/Local'),DSH_TELEMETRY_DISABLED:'1'},timeout:45000})
    for(const stream of [desktopApp.process().stdout,desktopApp.process().stderr]) stream?.on('data',chunk=>{logs+=chunk})
    for(let attempt=0;attempt<180&&!logs.match(/dsh web: (http:\/\/[^\s]+)/);attempt++) await sleep(250)
    const launch=logs.match(/dsh web: (http:\/\/[^\s]+)/)?.[1]
    if(!launch)throw new Error('Native Desktop Host readiness timed out: '+sanitize(logs))
    origin=new URL(launch).origin
    cookie=(await fetch(launch,{redirect:'manual'})).headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
    nativePage=desktopApp.windows().find(page=>page.url().startsWith('dsh-app://app'))??await desktopApp.firstWindow({timeout:45000})
    await nativePage.waitForFunction(()=>!document.body.innerText.includes('Loading plugins'),{},{timeout:45000})
    await writeFile(join(home,'native-startup.json'),JSON.stringify(await desktopApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({visible:w.isVisible(),url:w.webContents.getURL()}))),null,2))
    return
  }
  child=spawn(join(hostRoot,'DeepSeek Harness.exe'),['--expose-internals',join(runtime,'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js'),runtime,join(home,'profiles',profile),join(resources,'runtime/primary-runtime'),join(resources,'runtime/pnpm/bin/pnpm.mjs'),join(resources,'runtime/bin')],{cwd:join(home,'profiles',profile),env:{...env,ELECTRON_RUN_AS_NODE:'1',DSH_TELEMETRY_DISABLED:'1',APPDATA:join(home,'AppData/Roaming'),LOCALAPPDATA:join(home,'AppData/Local')},windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.on('data',chunk=>{logs+=chunk});child.stderr.on('data',chunk=>{logs+=chunk});
  const launch=await new Promise((res,rej)=>{const t=setTimeout(()=>rej(Error(sanitize(logs.slice(-4000)))),45000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(t);res(m.url)}else if(m.type==='fatal'){clearTimeout(t);rej(Error(sanitize(JSON.stringify(m))))}});child.on('exit',code=>{clearTimeout(t);rej(Error('Host exit '+code+': '+sanitize(logs.slice(-4000))))})});
  origin = new URL(launch).origin
  const response = await fetch(launch, { redirect: 'manual' })
  cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie)
}
async function rpc(method, request) {
  if(method==='session/prompt')ownedSessions.add(request.sessionId)
  const response = await fetch(`${origin}/api/${method}`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request } } }) })
  const result = await response.json()
  if (!result.result?.ok) throw new Error(`${method}: ${JSON.stringify(result)}`)
  return result.result.value
}
async function snapshot() { return rpc('contextEditor/getSnapshot', { sessionId }) }
async function prompt(text, withPlugin = true) {
  const before = requests.length
  try {
    await rpc('session/prompt', { sessionId, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text }] })
  } catch (error) {
    if (withPlugin || !error.message.includes('session/model-unavailable')) throw error
  }
  if (!withPlugin) { await sleep(1800); assert.equal(requests.length, before, 'missing plugin sent a model request'); return }
  for (let attempt = 0; attempt < 450; attempt++) {
    let state;try{state=await snapshot()}catch(e){if(e.message.includes('not found')){await sleep(100);continue}throw e}
    if (requests.length > before && !state.running && state.records.some(record => record.units.some(unit => unit.kind === 'user' && unit.effectiveText.includes(text)))) return state
    await sleep(200)
  }
  const stalled=await snapshot()
  await writeFile(join(home,'stalled-snapshot.json'),JSON.stringify(stalled,null,2))
  await writeFile(join(home,'stalled-page.json'),JSON.stringify(await rpc('session/page',{address:{kind:'session',sessionId},throughSeq:Number(stalled.sourceRevision)-1,maxMessages:100}).catch(e=>({error:e.message})),null,2))
  if(nativePage)await writeFile(join(home,'stalled-window.txt'),await nativePage.locator('body').innerText())
  throw new Error('Prompt did not finish: ' + sanitize(logs.slice(-1800)))
}
try {
  await start();const outcomes=[];
  await writeFile(join(home,'compatibility-report.json'),JSON.stringify({...candidate,report:await rpc('contextEditor/getCompatibility',{})},null,2));
  for(const action of process.env.CE_DESKTOP_ACTIONS==='none'?[]:process.env.CE_DESKTOP_ACTIONS?.split(',')??(cloud?['edit-user','exclude','condense']:['read','edit-user','edit-assistant','exclude','condense'])){
    sessionId='desktop-probe-'+randomUUID();
    ownedSessions.add(sessionId)
    const result={action,sessionId};
    try{
      await rpc('session/create',{sessionId,cwd:workspace});
      await rpc('session/selectModel',{sessionId,provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off'});
      let state=await prompt('WEB_ORIGINAL_USER '+(cloud?'Compatibility check. Reply with exactly OK. Do not use any tools.':'Synthetic context retained for compatibility checking. '.repeat(100)));
      const units=state.records.flatMap(r=>r.units), user=units.find(u=>u.kind==='user'&&u.effectiveText.startsWith('WEB_ORIGINAL_USER')),answer=units.find(u=>u.kind==='answer');
      result.read={records:state.records.length,running:state.running,hasUser:!!user,hasAssistant:!!answer};
      if(action.startsWith('edit')||action==='model')result.commit=await rpc('contextEditor/commitReplacement',{sessionId,operationId:action,baseContextRevision:state.contextRevision,unitId:action==='edit-assistant'?answer.id:user.id,text:'EDITED_TEXT'});
      if(action==='model')result.modelSelection=await rpc('session/selectModel',{sessionId,provider:'deepseek-official',model:'deepseek-v4-pro',reasoningEffort:'low'});
      if(action==='exclude')result.commit=await rpc('contextEditor/commitContext',{sessionId,operationId:action,baseContextRevision:state.contextRevision,action:'exclude',unitIds:[user.id]});
      if(action==='condense'){
        const request={sessionId,operationId:'condense',action:'condense',unitIds:[user.id,answer.id],baseContextRevision:state.contextRevision};
        const preview=await rpc('contextEditor/previewContext',request);result.preview={ok:preview.ok,error:preview.error,summary:preview.summary};
        result.commit=await rpc('contextEditor/commitContext',{...request,summary:'CHECKPOINT_SUMMARY'});
        if(result.commit.commit?.status==='persisted-and-verified'){
          const snap=await snapshot();result.restore=await rpc('contextEditor/commitContext',{sessionId,operationId:'condense',restoreOperationId:'individual-restore',action:'restore-condensation',baseContextRevision:snap.contextRevision});
        }
      }
      assert.equal(result.commit?.commit?.status??'persisted-and-verified','persisted-and-verified',JSON.stringify(result.commit?.commit));
      await stop(); await start();
      state=await prompt('AFTER_RESTART_'+action+(cloud?' Reply with exactly OK. Do not use any tools.':''));
      const body=JSON.stringify(requests.at(-1).messages);
      if(action.startsWith('edit')) assert.ok(body.includes('EDITED_TEXT'),body);
      if(action==='edit-user')assert.ok(!JSON.stringify(requests.at(-1).messages.filter(message=>message.role==='user')).includes('WEB_ORIGINAL_USER'),body);
      if(action==='edit-assistant'&&!cloud)assert.ok(!body.includes('WEB_ORIGINAL_ASSISTANT'),body);
      if(action==='model'){assert.ok(body.includes('EDITED_TEXT')&&!body.includes('WEB_ORIGINAL_USER'));assert.equal(requests.at(-1).model,'deepseek-v4-pro');assert.equal(requests.at(-1).thinking.type,'enabled');assert.equal(requests.at(-1).output_config.effort,'low')}
      if(action==='exclude') assert.ok(!body.includes('WEB_ORIGINAL_USER'),body);
      if(action==='condense') assert.ok(body.includes('WEB_ORIGINAL_USER'),body);
      result.readAfter=true; result.restartedRequestVerified=true;
      await writeFile(join(home,action+'-request.json'),JSON.stringify(requests.at(-1),null,2));
      await writeFile(join(home,action+'-evidence.json'),JSON.stringify({...candidate,...result,externalModel:cloud,desktopWindow:process.env.CE_DESKTOP_WINDOW==='1'},null,2));
    }catch(e){result.error=e.message}
    outcomes.push(result);if(result.error)process.exitCode=1;await writeFile(join(home,cloud?'cloud-evidence.json':'feature-probes.json'),JSON.stringify({...candidate,outcomes,externalModel:cloud,requestCount:requests.length,...(cloud?{cumulativeCloudAttempts:cloudBudget.attempts,limit:8}: {})},null,2));
    console.log(JSON.stringify({action,read:result.read,preview:result.preview,commit:result.commit?.commit,restore:result.restore?.commit,error:result.error,readAfterError:result.readAfterError}));
  }
  if(process.env.CE_PANEL==='1'){
    sessionId='desktop-panel-'+randomUUID();ownedSessions.add(sessionId);await rpc('session/create',{sessionId,cwd:workspace})
    await rpc('session/selectModel',{sessionId,provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off'})
    await prompt('WEB_ORIGINAL_USER')
    const {acceptPanel}=await import('./accept-deepseek-panel.mjs')
    await acceptPanel({origin,cookie,home,sessionId,rpc,prompt,requests,nativePage})
    const panelEvidence=JSON.parse(await readFile(join(home,'panel-evidence.json'),'utf8'))
    await writeFile(join(home,'panel-evidence.json'),JSON.stringify({...candidate,...panelEvidence,runtime:process.env.CE_DESKTOP_WINDOW==='1'?'official-desktop-window':'official-host-web-client'},null,2))
  }
} catch (error) {
  console.error(sanitize(error.stack ?? String(error))); await writeFile(join(home,'desktop-behavior-failure.json'),JSON.stringify({error:sanitize(error.stack ?? String(error)),log:sanitize(logs),requests},null,2))
  process.exitCode = 1
} finally {
  try { await stop() } catch (error) { console.error('Test host cleanup: ' + sanitize(error.message)); process.exitCode = 1 }
  await writeFile(manifestPath, manifest)
  server.closeAllConnections()
  await new Promise(resolvePromise => server.close(resolvePromise))
}
