import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'

const root = resolve(process.argv[2]), archive = resolve(process.argv[3])
const home=resolve(process.env.CE_DESKTOP_HOME??join(root,'home'))
const bytes = await readFile(archive), sha256 = createHash('sha256').update(bytes).digest('hex')
await mkdir(join(root, 'candidates'), { recursive: true })
const candidate = join(root, 'candidates', `${sha256}.tgz`)
await copyFile(archive, candidate)
const runtime = join(root, 'desktop/resources/app.asar/dsh')
const pnpm = join(root, 'desktop/resources/runtime/pnpm/bin/pnpm.mjs')
const nodeBin = join(root, 'desktop/resources/runtime/bin')
const carrier = join(root, 'install.mjs')
await writeFile(carrier, `import {pathToFileURL} from 'node:url';
const runtime=${JSON.stringify(runtime)};
const {initProfile}=await import(pathToFileURL(runtime+'/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'));
initProfile(${JSON.stringify(join(home, 'profiles/desktop'))},['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']);
const {runCli}=await import(pathToFileURL(runtime+'/node_modules/@deepseek-ai/dsh/lib/bin.js'));
await runCli({manageDesktopProfile:true,packageManager:{command:process.execPath,args:['--expose-internals',${JSON.stringify(pnpm)}],env:{ELECTRON_RUN_AS_NODE:'1',DSH_DESKTOP_NODE_EXECUTABLE:process.execPath,PATH:${JSON.stringify(nodeBin)}+';'+process.env.PATH}}});
`)
const result = spawnSync(join(root, 'desktop/DeepSeek Harness.exe'), ['--expose-internals', carrier,
  'plugin', '--profile', 'desktop', 'add', candidate, '--store-dir', resolve('.pnpm-store'),
  ...process.env.CE_INSTALL_ONLINE ? ['--fetch-retries', '0'] : ['--offline']], {
  windowsHide: true, timeout: 120000, encoding: 'utf8',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home },
})
await writeFile(join(root, 'installation.json'), JSON.stringify({ sha256, candidate, method: 'official-runCli-managed-desktop-profile',
  versionExemption: false, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2))
console.log(JSON.stringify({ sha256, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }))
if (result.error) throw result.error
process.exitCode = result.status ?? 1
