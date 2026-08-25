import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const npmCli = process.env.npm_execpath ?? resolve(process.execPath, '..', 'node_modules/npm/bin/npm-cli.js')
const cache = resolve(root, '.npm-cache')
const temp = await mkdtemp(join(tmpdir(), 'agent-context-editor-pack-'))

const expected = {
  'adapters/pi-extension': {
    required: ['src/index.ts', 'src/host.ts', 'src/shared-core/index.ts', 'dist/index.js', 'desktop/pi-context-editor.adapter.json', 'scripts/install-desktop.ps1'],
    forbidden: ['core.js', 'pi-app/'],
  },
  'adapters/deepseek-harness': {
    required: ['core.js', 'core-runtime.js', 'core.d.ts', 'client.bundle.js', 'cordis.patch.yml'],
    forbidden: ['core.host.js', 'core.d.ts.template', 'runtime-entry.js'],
  },
}

try {
  for (const [workspace, rules] of Object.entries(expected)) {
    const { stdout } = await run(process.execPath, [npmCli,
      'pack', '--workspace', workspace, '--pack-destination', temp,
      '--ignore-scripts', '--json', '--cache', cache,
    ], { cwd: root, maxBuffer: 4 * 1024 * 1024 })
    const metadata = JSON.parse(stdout)[0]
    const paths = new Set((metadata.files ?? []).map((file) => file.path))
    for (const file of rules.required) {
      if (!paths.has(file)) throw new Error(`${workspace} pack is missing ${file}`)
    }
    for (const file of rules.forbidden) {
      if ([...paths].some((path) => path === file || path.startsWith(file))) {
        throw new Error(`${workspace} pack unexpectedly contains ${file}`)
      }
    }
    console.log(`${workspace}: ${metadata.filename} (${metadata.size} bytes)`)
  }
} finally {
  await rm(temp, { recursive: true, force: true })
}
