import { openSync, readSync, closeSync } from 'node:fs'
import { createHash } from 'node:crypto'

// Read-only inspection of the installed Electron archive. Never writes to it.
export function openAsar(path) {
  const fd = openSync(path, 'r')
  const lead = Buffer.alloc(16)
  readSync(fd, lead, 0, 16, 0)
  const bytes = Buffer.alloc(lead.readUInt32LE(12))
  readSync(fd, bytes, 0, bytes.length, 16)
  const tree = JSON.parse(bytes.toString('utf8'))
  const offset = 8 + lead.readUInt32LE(4)
  const read = name => {
    let entry = tree
    for (const segment of name.split('/')) entry = entry.files?.[segment]
    if (!entry || entry.unpacked || !Number.isSafeInteger(entry.size)) throw new Error(`Not an archived file: ${name}`)
    const data = Buffer.alloc(entry.size)
    readSync(fd, data, 0, data.length, offset + Number(entry.offset))
    return data
  }
  const files = []
  const walk = (node, parent = '') => {
    for (const [key, entry] of Object.entries(node.files ?? {})) {
      const name = parent ? `${parent}/${key}` : key
      if (entry.files) walk(entry, name)
      else files.push({ name, ...entry })
    }
  }
  walk(tree)
  return { read, files, close: () => closeSync(fd) }
}
export const sha256 = data => createHash('sha256').update(data).digest('hex')
