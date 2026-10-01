import {spawnSync} from 'node:child_process'
import {readFile,readdir,mkdtemp,rm,realpath} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join,resolve,relative,sep} from 'node:path'
export async function verifyCandidate(archive,pluginRoot){
 const temp=await mkdtemp(join(tmpdir(),'ce-artifact-'))
 try{
  const result=spawnSync('tar',['-xzf',resolve(archive),'-C',temp],{windowsHide:true,encoding:'utf8',timeout:20000});if(result.status!==0)throw Error('Candidate extraction failed: '+result.stderr)
  const expected=join(temp,'package');const names=await readdir(expected)
  for(const name of names){const [wanted,installed]=await Promise.all([readFile(join(expected,name)),readFile(join(pluginRoot,name))]);if(!wanted.equals(installed))throw Error('Installed candidate differs from archive: '+name)}
  const manifest=JSON.parse(await readFile(join(expected,'package.json'),'utf8'))
  return{archiveSha256:createHash('sha256').update(await readFile(archive)).digest('hex'),pluginVersion:manifest.version,installedPackagePath:await realpath(pluginRoot),exactPackedFilesVerified:names.length}
 }finally{const inside=relative(resolve(tmpdir()),resolve(temp));if(!inside||inside.startsWith('..'+sep)||inside==='..')throw Error('Unsafe temporary cleanup');await rm(temp,{recursive:true,force:true})}
}
