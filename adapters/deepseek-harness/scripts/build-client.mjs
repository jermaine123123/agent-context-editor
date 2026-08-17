import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const input = resolve(packageRoot, 'client.js')
const output = resolve(packageRoot, 'client.bundle.js')
const cssPath = resolve(packageRoot, 'client.css')
const cssModuleId = '\0context-editor-client-css'

const bundle = await rolldown({
  input,
  external: ['react'],
  plugins: [{
    name: 'context-editor-css',
    resolveId(source, importer) {
      if (source === './client.css' && importer === input) return cssModuleId
    },
    async load(id) {
      if (id !== cssModuleId) return null
      const css = await readFile(cssPath, 'utf8')
      return [
        `const style = document.createElement('style')`,
        `style.textContent = ${JSON.stringify(css)}`,
        `document.head.appendChild(style)`,
      ].join('\n')
    },
  }],
})

const generated = await bundle.generate({
  format: 'cjs',
  exports: 'named',
  sourcemap: false,
})
await bundle.close()

const chunk = generated.output.find(item => item.type === 'chunk')
if (chunk === undefined) throw new Error('Context Editor client build produced no JavaScript chunk')

const wrapped = [
  'window.__ModuleLoader__.load({',
  "  id: 'context-editor-deepseek-harness',",
  '  factory: (require) => {',
  '    var module = { exports: {} };',
  '    var exports = module.exports;',
  chunk.code.split('\n').map(line => `    ${line}`).join('\n'),
  '    return module.exports;',
  '  },',
  '});',
  '',
].join('\n')

await writeFile(output, wrapped, 'utf8')
