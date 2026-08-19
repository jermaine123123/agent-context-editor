import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { descriptors, TYPERT } from '../adapters/deepseek-harness/typert.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'adapters', 'deepseek-harness')

describe('DeepSeek Harness installable bundle', () => {
  it('declares one bundle patch and one browser client face', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      name: string
      version: string
      dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
    }
    expect(manifest.name).toBe('context-editor-deepseek-harness')
    expect(manifest.version).toBe('0.1.4')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')).toContain('id: context-editor')
    const clientBundle = readFileSync(resolve(root, 'client.bundle.js'), 'utf8')
    expect(clientBundle).toContain("id: 'context-editor-deepseek-harness'")
    expect(clientBundle).toContain('window.__ModuleLoader__.load({')
    expect(clientBundle).toContain('exports.apply')
    expect(clientBundle).toContain('remote.contextEditor')
    expect(clientBundle).toContain('enabledUnitKinds')
    expect(clientBundle).toContain('context-editor__controls')
    expect(clientBundle).toContain('computeCenteredScrollTop')
    expect(clientBundle).not.toContain("block: 'nearest'")
    expect(readFileSync(resolve(root, 'client.css'), 'utf8')).toContain('position: sticky')
  })

  it('keeps apply and inject on the module namespace for the Cordis loader', () => {
    const hostEntry = readFileSync(resolve(root, 'index.js'), 'utf8')
    const clientEntry = readFileSync(resolve(root, 'client.js'), 'utf8')
    expect(hostEntry).toContain("export const inject = ['storageDomain', 'sessionPersistence', 'sessions']")
    expect(hostEntry).toContain("import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'")
    expect(hostEntry).toContain('export class ContextEditorHost extends TypertRemoteService')
    expect(hostEntry).toContain("super(ctx, 'contextEditor')")
    expect(hostEntry).not.toContain("ctx.provide('contextEditor'")
    expect(hostEntry).not.toContain('ctx.typert.register')
    expect(hostEntry).not.toContain('export default apply')
    expect(clientEntry).toContain("export const inject = ['remote']")
    expect(clientEntry).toContain("ctx.inject(['slots', 'remote', 'remote.contextEditor']")
    expect(clientEntry).not.toContain('export default apply')
  })

  it('exports the complete direct Remote surface with context exclusion disabled by contract', () => {
    expect(descriptors.map(descriptor => descriptor.method)).toEqual([
      'getSnapshot', 'listRecords', 'getRecord', 'searchRecords', 'getSearchMatch', 'commitView', 'undoView',
    ])
    expect(descriptors.every(descriptor => descriptor.namespace === 'contextEditor')).toBe(true)
    expect(descriptors.every(descriptor => descriptor.parameters[0]?.codec.mode === 'strict')).toBe(true)
    expect(descriptors.every(descriptor => descriptor.result.mode === 'strict')).toBe(true)
    expect(descriptors.every(descriptor => typeof (descriptor.parameters[0]?.codec.schema as { parse?: unknown }).parse === 'function')).toBe(true)
    expect(descriptors.every(descriptor => typeof (descriptor.result.schema as { parse?: unknown }).parse === 'function')).toBe(true)
    expect(TYPERT.face).toBe('host')
    expect(TYPERT.invocations).toHaveLength(7)
  })
})
