import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const canonicalSources = [
  'packages/context-editor-core/src/types.ts',
  'packages/context-editor-core/src/fingerprint.ts',
  'packages/context-editor-core/src/records.ts',
  'packages/context-editor-core/src/search.ts',
  'packages/context-editor-core/src/protocol.ts',
].map((file) => resolve(repositoryRoot, file))

const hash = createHash('sha256')
for (const file of canonicalSources) hash.update(await readFile(file))
const sourceDigest = hash.digest('hex')
const banner = [
  '/*',
  ' * GENERATED FILE - do not edit directly.',
  ` * Canonical Core source digest: ${sourceDigest}`,
  ' * Rebuild with: npm run build:deepseek',
  ' */',
  '',
].join('\n')

const bundle = await rolldown({
  input: resolve(packageRoot, 'runtime-entry.js'),
})
const generated = await bundle.generate({
  format: 'esm',
  exports: 'named',
  sourcemap: false,
})
await bundle.close()
const chunk = generated.output.find((item) => item.type === 'chunk')
if (!chunk || chunk.type !== 'chunk') throw new Error('Core runtime build produced no JavaScript chunk')

await writeFile(resolve(packageRoot, 'core-runtime.js'), `${banner}${chunk.code.trim()}\n`, 'utf8')
const hostSource = await readFile(resolve(packageRoot, 'core.host.js'), 'utf8')
await writeFile(resolve(packageRoot, 'core.js'), `${banner}${hostSource.replace(/^\/\*[\s\S]*?\*\/\s*/, '')}`, 'utf8')
const declaration = await readFile(resolve(packageRoot, 'core.d.ts.template'), 'utf8')
await writeFile(resolve(packageRoot, 'core.d.ts'), `${banner}${declaration.replace(/^\/\*[\s\S]*?\*\/\s*/, '')}`, 'utf8')

console.log(`Built DeepSeek Core from ${canonicalSources.length} canonical files (${sourceDigest.slice(0, 12)}).`)
