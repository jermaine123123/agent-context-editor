import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { parse } from 'yaml'
import { openAsar } from './opencode-asar.mjs'
const [version='0.2.0-rc.2',rootArg='.compat-desktop-026',extractorArg]=process.argv.slice(2)
const root=resolve(rootArg),feedUrl='https://download.deepseek.com/dsh-desk/feeds/win-x64/nightly.yml'
const extractor=extractorArg??process.env.CE_7ZIP??'D:/qq game/QQGameTempest/Hall.58574/7za.exe'
await mkdir(root,{recursive:true})
const feedText=process.env.CE_PREPARE_OFFLINE?await readFile(join(root,'nightly.yml'),'utf8'):await fetch(feedUrl).then(r=>{if(!r.ok)throw Error('Feed HTTP '+r.status);return r.text()})
const feed=parse(feedText)
if(feed.version!==version)throw Error(`Update source is ${feed.version}; requested ${version}. Explicitly retain the matching release feed for a pinned rerun.`)
await writeFile(join(root,'nightly.yml'),feedText)
const file=feed.files.find(f=>f.url.endsWith('-win-x64.exe'))
const url=new URL(file.url,'https://download.deepseek.com/dsh-desk/bin/win-x64/').href
const installer=join(root,'installer.exe')
try{await stat(installer)}catch{
 const response=await fetch(url);if(!response.ok)throw Error('Installer HTTP '+response.status)
 const {pipeline}=await import('node:stream/promises');const {createWriteStream}=await import('node:fs')
 await pipeline(response.body,createWriteStream(installer,{flags:'wx'}))
}
const hash=createHash('sha512');for await(const chunk of createReadStream(installer))hash.update(chunk)
if(hash.digest('base64')!==file.sha512)throw Error('Official feed SHA-512 mismatch')
if(file.size&&(await stat(installer)).size!==file.size)throw Error('Official installer size mismatch')
const desktop=join(root,'desktop')
let exists=false;try{await stat(join(desktop,'resources/app.asar'));exists=true}catch{}
if(!exists){const extracted=spawnSync(extractor,['x',installer,'-o'+desktop,'-y'],{windowsHide:true,encoding:'utf8',timeout:120000});if(extracted.status!==0)throw Error('7-Zip extraction failed: '+extracted.stderr)}
const asar=openAsar(join(desktop,'resources/app.asar'))
let identity
try{
 const desktopManifest=JSON.parse(asar.read('package.json')),runtimeManifest=JSON.parse(asar.read('dsh/node_modules/@deepseek-ai/dsh/package.json'))
 const names=['session','session-persistence','session-persistence-jsonl','session-format-v3-to-v4','agent-loop','llm-deepseek','client-runtime','client-ui-conversation']
 const components=Object.fromEntries(names.map(name=>{try{const manifest=JSON.parse(asar.read('dsh/node_modules/@deepseek-ai/dsh-'+name+'/package.json'));return[manifest.name,manifest.version]}catch{return['@deepseek-ai/dsh-'+name,'unavailable']}}))
 if(desktopManifest.version!==version||runtimeManifest.version!==version)throw Error('Packaged versions differ from requested release')
 identity={verifiedAt:new Date().toISOString(),feedUrl,installerUrl:url,installerSha512:file.sha512,installerBytes:file.size,releaseDate:feed.releaseDate,desktopVersion:desktopManifest.version,runtimeVersion:runtimeManifest.version,buildCommit:desktopManifest.dshBuildCommit,buildDirty:desktopManifest.dshBuildDirty,components}
}finally{asar.close()}
await writeFile(join(root,'identity.json'),JSON.stringify(identity,null,2));console.log(JSON.stringify(identity))
