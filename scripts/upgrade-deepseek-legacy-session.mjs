// Offline recovery into a NEW session. Run with the isolated profile stopped.
import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import {verifyCandidate} from './deepseek-acceptance-artifact.mjs'
const [rootArg,sourceArg,newId]=process.argv.slice(2)
if(!rootArg||!sourceArg||!newId)throw new Error('Arguments: prepared Desktop root, uncompressed historical session.v3.jsonl, NEW session ID')
const root=resolve(rootArg),source=resolve(sourceArg),runtime=join(root,'desktop/resources/app.asar/dsh')
const plugin=join(root,'home/profiles/desktop/node_modules/context-editor-deepseek-harness')
const candidate=await verifyCandidate(process.env.CE_CANDIDATE_ARCHIVE??'release/context-editor-deepseek-harness-0.6.0.tgz',plugin)
const sessionRoot=resolve(process.env.CE_SESSION_ROOT??join(root,'home/sessions'))
const worker=join(root,'legacy-upgrade.mjs')
await writeFile(worker,`
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';import {pathToFileURL} from 'node:url';
const runtime=${JSON.stringify(runtime)},plugin=${JSON.stringify(plugin)},source=${JSON.stringify(source)};
registerHooks({resolve(specifier,context,next){return next(specifier,specifier.startsWith('@deepseek-ai/')?{...context,parentURL:pathToFileURL(runtime+'/entry.mjs').href}:context)}});
const api=await import(pathToFileURL(plugin+'/host-api.js'));
const {Context}=await import('@deepseek-ai/cordis');const {default:Sessions}=await import('@deepseek-ai/dsh-session');const {default:Persistence}=await import('@deepseek-ai/dsh-session-persistence-jsonl');
const bytes=await readFile(source);const hash=v=>createHash('sha256').update(v).digest('hex');
const rows=bytes.toString('utf8').trim().split(/\\r?\\n/).map(JSON.parse);const {type,...header}=rows.shift();assert.equal(type,'session');assert.equal(header.version,3);
assert.ok(!header.isSeeded&&!header.parentSession&&(header.delegationDepth??0)===0,'Only standalone v3 root sessions are supported');
const sourceHash=hash(bytes);const artifact=api.migrateLegacySessionArtifact({header,events:rows,inheritedEventCount:0},${JSON.stringify(newId)});
const ctx=new Context();await ctx.plugin(Sessions);await ctx.plugin(Persistence,{root:${JSON.stringify(sessionRoot)},compression:'none'});
try{const handle=await ctx.sessionPersistence.create(artifact.header);try{await handle.append(artifact.events);await handle.flush()}finally{await handle.close()}
const reader=await ctx.sessionPersistence.open(artifact.header.id,'read');try{const page=await reader.read();assert.deepEqual(page.events,artifact.events)}finally{await reader.close()}
assert.equal(hash(await readFile(source)),sourceHash);
const result={...${JSON.stringify(candidate)},sourceSha256:sourceHash,sourceSessionId:header.id,newSessionId:artifact.header.id,sourceUnchanged:true,officialV4Validation:true,persistentReadback:true,convertedHeaderSeqs:artifact.convertedHeaderSeqs,eventCount:artifact.events.length};
await writeFile(${JSON.stringify(join(root,'legacy-upgrade-evidence.json'))},JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await ctx.fiber.dispose()}
`)
const env={...process.env,ELECTRON_RUN_AS_NODE:'1'}
for(const key of Object.keys(env))if(/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key))delete env[key]
const result=spawnSync(join(root,'desktop/DeepSeek Harness.exe'),['--expose-internals',worker],{env,encoding:'utf8',windowsHide:true,timeout:45000})
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');if(result.error)throw result.error;process.exitCode=result.status??1
