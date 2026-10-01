import {spawnSync} from 'node:child_process'
import {writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {verifyCandidate} from './deepseek-acceptance-artifact.mjs'
const root=resolve(process.argv[2]),runtime=join(root,'desktop/resources/app.asar/dsh'),plugin=join(root,'home/profiles/desktop/node_modules/context-editor-deepseek-harness')
const candidate=await verifyCandidate(process.argv[3]??'release/context-editor-deepseek-harness-0.6.0.tgz',plugin)
const results=[]
for(const mode of ['missing-validator','future-format']){
 const stub=join(root,mode+'.mjs'),worker=join(root,mode+'-probe.mjs')
 await writeFile(stub,mode==='missing-validator'?'export {}':`export * from ${JSON.stringify(pathToFileURL(join(runtime,'node_modules/@deepseek-ai/dsh-session/lib/index.js')).href)};export const SESSION_FORMAT_VERSION=5;`)
 await writeFile(worker,`import assert from 'node:assert/strict';import{registerHooks}from'node:module';import{pathToFileURL}from'node:url';
 registerHooks({resolve(specifier,context,next){if(specifier===${JSON.stringify(mode==='missing-validator'?'@deepseek-ai/dsh-session-format-v3-to-v4':'@deepseek-ai/dsh-session')})return next(${JSON.stringify(pathToFileURL(stub).href)},context);return next(specifier,specifier.startsWith('@deepseek-ai/')?{...context,parentURL:${JSON.stringify(pathToFileURL(join(runtime,'entry.mjs')).href)}}:context)}});
 const api=await import(${JSON.stringify(pathToFileURL(join(plugin,'host-api.js')).href)});const compat=await import(${JSON.stringify(pathToFileURL(join(plugin,'host-compat.js')).href)});
 assert.equal(api.hasV4WriteContract,false);assert.equal(compat.detectHostAdapter({sessionPersistence:{open(){}},sessions:{}}),'read-only');const report=compat.createCompatibilityReport({},'0.6.0');assert.equal(report.features.contextReplacement.available,false);assert.equal(report.features.contextCondensation.available,false);assert.match(report.writeUnavailableReason,/write-contract-unavailable/);console.log(JSON.stringify({mode:${JSON.stringify(mode)},moduleLoaded:true,writeRefused:true}));`)
 const result=spawnSync(join(root,'desktop/DeepSeek Harness.exe'),['--expose-internals',worker],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:20000})
 results.push({mode,exitCode:result.status,stdout:result.stdout,stderr:result.stderr});if(result.error)throw result.error
 if(result.status!==0)process.exitCode=1
 process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'')
}
await writeFile(join(root,'optional-contract-evidence.json'),JSON.stringify({...candidate,results},null,2))
