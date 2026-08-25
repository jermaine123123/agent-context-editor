import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const adapterRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryRoot = resolve(adapterRoot, '../..')
const sourceRoot = resolve(repositoryRoot, 'packages/context-editor-core/src')
const targetRoot = resolve(adapterRoot, 'src/shared-core')
const files = [
  'types.ts',
  'fingerprint.ts',
  'records.ts',
  'projection.ts',
  'search.ts',
  'state.ts',
  'controller.ts',
  'prefs.ts',
  'service.ts',
  'protocol.ts',
  'index.ts',
]

await rm(targetRoot, { recursive: true, force: true })
await mkdir(targetRoot, { recursive: true })
for (const file of files) {
  const source = await readFile(join(sourceRoot, file), 'utf8')
  await writeFile(join(targetRoot, file), [
    '/* GENERATED FROM packages/context-editor-core; do not edit directly. */',
    source,
  ].join('\n'), 'utf8')
}
console.log(`Copied canonical Core into ${targetRoot}`)
