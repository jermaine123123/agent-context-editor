import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const ignored = new Set(['node_modules', 'pi-app', 'deepseek-harness-latest', '.git', '.npm-cache', '.release-backup-20260818', 'release', 'dist', 'out'])
const patterns = [
  /[A-Z]:\\Users\\[^\s"']+/i,
  /(?:api[_-]?key|access[_-]?token|secret)\s*[:=]\s*['"][^'"]{12,}/i,
  /Bearer\s+[A-Za-z0-9._-]{20,}/i,
  /sk-[A-Za-z0-9]{20,}/,
]
const textExtensions = new Set(['.ts', '.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.ps1', '.cmd', '.css', '.d.ts', '.txt', '.svg'])
const findings = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(path)
      continue
    }
    const extension = entry.name.endsWith('.d.ts') ? '.d.ts' : entry.name.slice(entry.name.lastIndexOf('.'))
    if (!textExtensions.has(extension)) continue
    const text = await readFile(path, 'utf8')
    for (const pattern of patterns) {
      if (pattern.test(text)) findings.push(`${relative(root, path)} matches ${pattern}`)
    }
  }
}

await walk(root)
if (findings.length > 0) {
  console.error('Sensitive-data scan failed:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exitCode = 1
} else {
  console.log('Sensitive-data scan passed.')
}
