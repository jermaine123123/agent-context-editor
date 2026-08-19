import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const npmCli = resolve(process.execPath, '..', 'node_modules/npm/bin/npm-cli.js')
const releaseRoot = resolve(root, 'release')
const mainRelease = join(releaseRoot, 'v0.1.0-alpha.2')
const desktopRelease = join(releaseRoot, 'context-editor-v0.1.4')
const includeDesktop = process.argv.includes('--desktop')

async function sha256(path) {
  const digest = createHash('sha256')
  digest.update(await readFile(path))
  return digest.digest('hex').toUpperCase()
}

async function pack(workspace, destination) {
  const { stdout } = await run(process.execPath, [npmCli, 'pack', '--workspace', workspace,
    '--pack-destination', destination, '--ignore-scripts', '--json', '--cache', resolve(root, '.npm-cache')], {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  })
  return JSON.parse(stdout)[0].filename
}

await rm(mainRelease, { recursive: true, force: true })
await mkdir(mainRelease, { recursive: true })
const mainAssets = [
  await pack('adapters/pi-extension', mainRelease),
  await pack('adapters/deepseek-harness', mainRelease),
]

const mainSums = []
for (const asset of mainAssets) mainSums.push(`${await sha256(join(mainRelease, asset))}  ${asset}`)
await writeFile(join(mainRelease, 'SHA256SUMS.txt'), `${mainSums.join('\n')}\n`, 'utf8')
console.log(`Prepared ${mainRelease}`)

if (includeDesktop) {
  const dist = resolve(root, 'pi-app/dist')
  const setup = 'Pi Context Desktop-Setup-0.1.4-x64.exe'
  const portable = 'Pi Context Desktop-Portable-0.1.4-x64.exe'
  await rm(desktopRelease, { recursive: true, force: true })
  await mkdir(desktopRelease, { recursive: true })
  for (const file of [setup, portable]) await copyFile(join(dist, file), join(desktopRelease, file))
  const desktopSums = []
  for (const file of [setup, portable]) desktopSums.push(`${await sha256(join(desktopRelease, file))}  ${file}`)
  await writeFile(join(desktopRelease, 'SHA256SUMS.txt'), `${desktopSums.join('\n')}\n`, 'utf8')
  console.log(`Prepared ${desktopRelease}`)
}
