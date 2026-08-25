import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const uiFiles = [
  'adapters/pi-extension/src/desktop-ui.ts',
  'adapters/pi-extension/src/index.ts',
  'adapters/pi-extension/src/ui.ts',
  'adapters/deepseek-harness/client.js',
  'pi-app/src/renderer/src/features/timeline/context-editor.tsx',
]
const chinese = /[\u4e00-\u9fff]/u
const failures = []

for (const relative of uiFiles) {
  const file = resolve(root, relative)
  if (!existsSync(file)) continue
  const source = await readFile(file, 'utf8')
  if (chinese.test(source)) failures.push(relative)
}

if (failures.length > 0) {
  throw new Error(`Chinese UI literals found outside locale dictionaries:\n${failures.map(value => `- ${value}`).join('\n')}`)
}

const scanned = uiFiles.filter((relative) => existsSync(resolve(root, relative))).length
console.log(`i18n literal scan passed (${scanned} UI sources)`)
