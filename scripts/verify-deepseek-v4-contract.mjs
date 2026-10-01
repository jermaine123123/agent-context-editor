import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import {verifyCandidate} from './deepseek-acceptance-artifact.mjs'

const root = resolve(process.argv[2])
const runtime = join(root, 'desktop/resources/app.asar/dsh')
const plugin = join(root, 'home/profiles/desktop/node_modules/context-editor-deepseek-harness')
const candidate=await verifyCandidate(process.argv[3]??'release/context-editor-deepseek-harness-0.6.0.tgz',plugin)
const worker = join(root, 'v4-contract.mjs')
await writeFile(worker, `
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const runtime=${JSON.stringify(runtime)},plugin=${JSON.stringify(plugin)};
registerHooks({resolve(specifier,context,next){return next(specifier,specifier.startsWith('@deepseek-ai/')?{...context,parentURL:pathToFileURL(runtime+'/entry.mjs').href}:context)}});
const api=await import(pathToFileURL(plugin+'/host-api.js'));
const rt=await import(pathToFileURL(plugin+'/request-transform.js'));
const compat=await import(pathToFileURL(plugin+'/host-compat.js'));
const identity=compat.createHostIdentity({},'0.6.0');assert.equal(identity.version,'0.2.0-rc.2');assert.equal(identity.buildCommit,'04f392c9ddd144fa426da2045178797da6db6c11');
assert.equal(api.SESSION_FORMAT_VERSION,4);assert.equal(api.hasV4WriteContract,true);
const s=api.Session.create('synthetic-v4-contract');
s.append('user/message',{id:'u',role:'user',source:{kind:'user'},content:[{type:'text',text:'original'}]},{surfaceOp:'append'});
const selected=api.appendModelSelection(s,{provider:'context-editor',model:'profile'});
assert.equal(selected.type,'model/selection');api.validateSessionCandidate(s);
assert.equal(s.snapshotEvents().filter(e=>e.type==='request/header').length,0);
const invalid=api.restoreSession(s.id,s.snapshotEvents(),s.header,0);
invalid.append('request/header',{header:{config:{provider:'test',model:'test'}},reason:'change'});
assert.throws(()=>api.validateSessionCandidate(invalid),/outside an open turn/);
const badSource=api.Session.create('synthetic-bad-source');
badSource.append('user/message',{id:'bad',role:'user',source:{kind:'plugin'},content:[]},{surfaceOp:'append'});
assert.throws(()=>api.validateSessionCandidate(badSource),/producer-owned/);
const checkpoint=api.restoreSession(s.id,s.snapshotEvents(),s.header,0);
checkpoint.append('user/message',{id:'summary',role:'user',source:api.pluginMessageSource('condensation'),content:[{type:'text',text:'summary'}]},{surfaceOp:{op:'replace',startSeq:0,endSeq:0},sourceEventSeqs:[0]});
api.validateSessionCandidate(checkpoint);
const tool={id:'tool',role:'tool',toolCallId:'call',source:{kind:'tool',callId:'call'},isError:true,content:[{type:'text',text:'error'}]};
assert.equal(rt.canTransformMessage(tool),true);assert.equal(rt.canTransformMessage({...tool,toolCallId:'wrong'}),false);
const changed={...tool,content:[{type:'text',text:'redacted'}]};
const output=rt.transformMessages([tool],{version:3,changes:[{originalId:tool.id,originalFingerprint:rt.messageFingerprint(tool),mode:'replace',message:changed}]});
assert.equal(output[0].role,'tool');assert.equal(output[0].toolCallId,'call');assert.equal(output[0].isError,true);
assert.throws(()=>api.validateSessionCandidate({header:{version:5}}),/WRITE_UNSUPPORTED/);
const {Context}=await import('@deepseek-ai/cordis');const {default:Sessions}=await import('@deepseek-ai/dsh-session');const {default:Persistence}=await import('@deepseek-ai/dsh-session-persistence-jsonl');
const ctx=new Context();await ctx.plugin(Sessions);await ctx.plugin(Persistence,{root:${JSON.stringify(join(root,'v4-profile-sessions'))},compression:'none'});
try{for(const version of [1,2,3]){
 const session=api.Session.create('legacy-profile-'+version+'-'+randomUUID());
 const original={id:'legacy-user',role:'user',source:{kind:'user'},content:[{type:'text',text:'original'}]};session.append('user/message',original,{surfaceOp:'append'});
 const old={version,upstream:{provider:'synthetic',model:'fixed'},origin:{id:session.id,createdAt:session.header.createdAt},previous:null,operationId:'legacy-'+version,baseline:'synthetic',changes:[{rootEventSeq:0,originalId:original.id,originalFingerprint:rt.messageFingerprint(original),mode:'replace',message:{...original,source:{kind:'plugin',plugin:'legacy-fixture'},content:[{type:'text',text:'edited'}]}}],replacementEvents:[],...(version>=2?{routeState:'active'}:{}),...(version===3?{checkpointRestorations:[]}: {})};
 const oldId='ce'+version+'-'+rt.requestFingerprint(old),rows=new Map([[oldId,structuredClone(old)]]),operations=new Map();
 const handle=await ctx.sessionPersistence.create({...session.header,delegationDepth:0});let cursor=0;
 try{const runtime=new rt.RequestTransformRuntime({sessionPersistence:ctx.sessionPersistence,sessions:{flush:async value=>{const events=value.snapshotEvents();await handle.append(events.slice(cursor));cursor=events.length;await handle.flush()}}},{table:name=>{const table=name==='profiles'?rows:operations;return{get:key=>table.get(key),put:async(key,value)=>table.set(key,structuredClone(value))}}});
 const upgraded=await runtime.upgradeProfile(session,{id:oldId,profile:old});assert.notEqual(upgraded.id,oldId);assert.equal(upgraded.profile.previous,oldId);assert.deepEqual(rows.get(oldId),old);assert.equal(runtime.operation(session,upgraded.profile.operationId).status,'persisted-and-verified');assert.equal(rt.transformMessages([original],upgraded.profile)[0].content[0].text,'edited');
 const persisted=await ctx.sessionPersistence.open(session.id,'read');try{assert.ok((await persisted.read()).events.some(e=>api.isProfileSelection(e,'context-editor',upgraded.id)))}finally{await persisted.close()}
 }finally{await handle.close()}
}}finally{await ctx.fiber.dispose()}
const results={officialFormatVersion:4,buildIdentityVerified:true,selectionOutsideTurn:true,headerOutsideTurnRejected:true,retiredSourceRejected:true,checkpointValidated:true,toolIdentityPreserved:true,unknownFormatWriteRefused:true,immutableProfiles123UpgradedWithOfficialPersistence:true};
console.log(JSON.stringify(results));
`)
const result = spawnSync(join(root, 'desktop/DeepSeek Harness.exe'), ['--expose-internals', worker], {
  windowsHide: true, timeout: 20000, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
await writeFile(join(root, 'v4-contract-evidence.json'), JSON.stringify({ ...candidate, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2))
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '')
if (result.error) throw result.error
process.exitCode = result.status ?? 1
