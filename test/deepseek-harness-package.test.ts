import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { Session } from '@deepseek-ai/dsh-session'
import { ContextEditorHost } from '../adapters/deepseek-harness/index.js'
import { descriptors, TYPERT } from '../adapters/deepseek-harness/typert.js'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'adapters', 'deepseek-harness')

describe('DeepSeek Harness installable bundle', () => {
  it('declares one bundle patch and one browser client face', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      name: string
      version: string
      files?: string[]
      dsh?: { bundle?: { patch?: string }; client?: { platform?: string } }
    }
    expect(manifest.name).toBe('context-editor-deepseek-harness')
    expect(manifest.version).toBe('0.4.10')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.files).toContain('host-compat.js')
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

  it('reports the current Surface blockers without claiming persistence support', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    host.ctx = {
      sessions: { messageProjections: [] },
      sessionPersistence: { open() {} },
      storageDomain: { open() {} },
    }
    host.hostAdapter = 'session-surface-v1'
    const report = await host.getCompatibility()

    expect(report.features.contextExclusion).toMatchObject({
      available: false,
      status: 'unsupported',
      reason: 'official-surface-has-no-lossless-message-removal',
    })
    expect(report.features.assistantReplacement).toMatchObject({
      available: false,
      status: 'unsupported',
      reason: 'assistant-message-surface-replacement-rejected-by-source-reference-contract',
    })
    expect(JSON.stringify(report)).not.toMatch(/alpha.?2/i)
    expect(report.selfTest).toBeUndefined()
  })

  it('declares peer ranges that admit the alpha.1 prerelease components', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      version: string
      peerDependencies: Record<string, string>
      dependencies?: Record<string, string>
    }
    const lock = JSON.parse(readFileSync(resolve(root, '..', '..', 'package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string; peerDependencies?: Record<string, string>; dependencies?: Record<string, string> }>
    }
    const expected = '>=0.1.0-rc.8 <0.2.0-0 || >=0.1.6-alpha.1 <0.1.6'
    const harnessPeers = Object.entries(manifest.peerDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(harnessPeers.length).toBeGreaterThan(0)
    expect(harnessPeers.every(([, range]) => range === expected)).toBe(true)
    expect(lock.packages['adapters/deepseek-harness']).toMatchObject({
      version: manifest.version,
      peerDependencies: manifest.peerDependencies,
    })
    expect(manifest.dependencies?.zod).toBe('4.4.3')
    expect(lock.packages['adapters/deepseek-harness']?.dependencies?.zod).toBe('4.4.3')
  })

  it('keeps apply and inject on the module namespace for the Cordis loader', () => {
    const hostEntry = readFileSync(resolve(root, 'index.js'), 'utf8')
    const clientEntry = readFileSync(resolve(root, 'client.js'), 'utf8')
    const clientStateEntry = readFileSync(resolve(root, 'client-state.js'), 'utf8')
    expect(hostEntry).toContain("export const inject = ['storageDomain', 'sessionPersistence', 'sessions', 'agents', 'agentPresets', 'llm']")
    expect(hostEntry).toContain("from './host-api.js'")
    expect(readFileSync(resolve(root, 'host-api.js'), 'utf8')).toContain("import * as remoteApi from '@deepseek-ai/dsh-typert-protocol'")
    expect(hostEntry).toContain('export class ContextEditorHost extends TypertRemoteService')
    expect(hostEntry).toContain("super(ctx, 'contextEditor')")
    expect(hostEntry).toContain('contextMutationUnavailableReason: features.contextExclusion')
    expect(hostEntry).toContain('baseContextRevision')
    expect(hostEntry).toContain('recordIndex')
    expect(clientEntry).toContain('subscribe(listener)')
    expect(clientEntry).toContain('compatibilitySummary(loaded.snapshot.compatibility)')
    expect(clientEntry).toContain('loadInitialContextRecords')
    expect(clientEntry).toContain('async loadRecord(recordId, expectedRevision)')
    expect(clientEntry).toContain('historyGapBefore')
    expect(clientEntry).toContain('loadUntilRecord(recordId, cursor, expectedRevision')
    expect(clientEntry).toContain("async getOperation(operationId)")
    expect(clientEntry).toContain('readPendingReplacement(sessionId)')
    expect(clientEntry).toContain('resolvePendingReplacement')
    expect(clientEntry).toContain("status === 'persisted-and-verified'")
    expect(clientEntry).toContain('text.loadMoreHistory(loaded.records.length, loaded.total)')
    expect(clientEntry).not.toContain('for (let page = 0; page < 512; page += 1)')
    expect(clientStateEntry).toContain("call('getSnapshot', { includeRecords: false })")
    expect(readFileSync(resolve(root, 'host-compat.js'), 'utf8')).toContain('persistenceTested: false')
    expect(hostEntry).not.toContain("ctx.provide('contextEditor'")
    expect(hostEntry).not.toContain('ctx.typert.register')
    expect(hostEntry).not.toContain('export default apply')
    expect(clientEntry).toContain("export const inject = ['remote']")
    expect(clientEntry).toContain("ctx.inject(['slots', 'remote', 'remote.contextEditor', 'uiWorkspace']")
    expect(clientEntry).not.toContain('export default apply')
  })

  it('provides callable codecs for new gateways and preserves rc.8 schema consumers', () => {
    const request = { sessionId: 'compat-session', pageSize: 20 }
    for (const descriptor of descriptors) {
      for (const codec of [descriptor.parameters[0].codec, descriptor.result]) {
        const current = codec.create()
        expect(current.parse(request)).toEqual(request)
        expect((codec.schema as { parse(value: unknown): unknown }).parse(request)).toEqual(current.parse(request))
      }
    }
  })

  it('exports the direct Remote surface with context replacement methods', () => {
    expect(descriptors.map(descriptor => descriptor.method)).toEqual([
      'getSnapshot', 'getCompatibility', 'runCompatibilityCheck', 'getOperation', 'previewRecovery', 'createRecoveryBranch', 'listRecords', 'getRecord', 'searchRecords', 'getSearchMatch', 'previewContext', 'previewReplacement', 'commitContext', 'commitView', 'undoView', 'commitReplacement', 'restoreReplacement', 'undoReplacement',
    ])
    expect(descriptors.every(descriptor => descriptor.namespace === 'contextEditor')).toBe(true)
    expect(descriptors.every(descriptor => descriptor.parameters[0]?.codec.mode === 'strict')).toBe(true)
    expect(descriptors.every(descriptor => descriptor.result.mode === 'strict')).toBe(true)
    expect(descriptors.every(descriptor => typeof (descriptor.parameters[0]?.codec.schema as { parse?: unknown }).parse === 'function')).toBe(true)
    expect(descriptors.every(descriptor => typeof (descriptor.result.schema as { parse?: unknown }).parse === 'function')).toBe(true)
    expect(TYPERT.face).toBe('host')
    expect(TYPERT.invocations).toHaveLength(18)
  })

  it('versions effective messages and request routing while ignoring non-context log events', () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    host.hostAdapter = 'session-surface-v1'
    const session = (Session as any).create('context-revision-fixture')
    session.append('request/header', {
      header: { config: { provider: 'synthetic', model: 'model-a', maxTokens: 128 } },
      reason: 'initial',
    })
    const initial = host.contextRevisionFromSession(session)

    session.append('turn/start', { turn: 1 })
    expect(host.contextRevisionFromSession(session)).toBe(initial)

    session.append('user/message', {
      id: 'context-revision-user',
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'new effective prompt' }],
    }, { surfaceOp: 'append' })
    const withMessage = host.contextRevisionFromSession(session)
    expect(withMessage).not.toBe(initial)

    session.append('request/header', {
      header: { config: { provider: 'synthetic', model: 'model-b', maxTokens: 128 } },
      reason: 'change',
    })
    expect(host.contextRevisionFromSession(session)).not.toBe(withMessage)
  })

  it('keeps full snapshots backward compatible and supports an empty-record snapshot for paged clients', () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    host.hostAdapter = 'session-surface-v1'
    host.ctx = { agents: { get: () => undefined }, sessions: { get: () => undefined, messageProjections: [] } }
    host.compatibilityReport = {
      features: {
        contextExclusion: { available: false, reason: 'official-surface-has-no-lossless-message-removal' },
        contextReplacement: { available: true },
        contextCondensation: { available: true },
      },
    }
    const records = [{ id: 'record-1', kind: 'user', units: [] }, { id: 'record-2', kind: 'ai', units: [] }]
    const projection = {
      identity: { id: 'snapshot-fixture' },
      contextRevision: 'context-r1',
      revision: 'view-r1',
      sourceRevision: 4,
      sourceEvents: [{ seq: 3 }],
      events: [],
      records,
      canUndo: false,
      condensationEvents: [],
    }
    host.readProjection = async () => projection

    const fullSnapshot = host.snapshotOf(projection, false)
    expect(fullSnapshot.records.map((record: { id: string }) => record.id)).toEqual(['record-1', 'record-2'])
    expect(fullSnapshot.recordsIncluded).toBe(true)
    expect(fullSnapshot.recordCount).toBe(2)

    const pagedSnapshot = host.snapshotOf(projection, false, { includeRecords: false })
    expect(pagedSnapshot.records).toEqual([])
    expect(pagedSnapshot.recordsIncluded).toBe(false)
    expect(pagedSnapshot.recordCount).toBe(2)
  })

  it('does not report a replacement as applied when only its plugin operation record exists', async () => {
    const host = Object.create(ContextEditorHost.prototype) as any
    const sessionId = 'pending-replacement-operation'
    const operationId = 'pending-replacement-op-1'
    host.readProjection = async () => ({
      identity: { id: sessionId, createdAt: 1 },
      revision: 'history-r1',
      contextRevision: 'context-r1',
      sourceEvents: [{ seq: 0, type: 'user/message', data: { id: 'original', content: [{ type: 'text', text: 'original' }] } }],
      records: [],
    })
    host.rowFor = () => ({
      replacementEvents: [{
        schemaVersion: 1,
        type: 'replacement',
        action: 'replace',
        eventId: operationId,
        unitId: 'user-unit-0',
        unitKind: 'user',
        atomRefs: [{ atomId: 'atom-0', sourceRef: { entryId: '0', blockIndex: 0 }, fingerprint: 'fingerprint-0' }],
        beforeText: null,
        afterText: 'replacement',
        baseRevision: 'context-r1',
        createdAt: new Date(0).toISOString(),
      }],
      condensationEvents: [],
      recoveryEvents: [],
    })

    const result = await host.getOperation({ sessionId, operationId })
    expect(result.status).toBe('pending')
    expect(result.commit).toMatchObject({
      operationId,
      status: 'pending',
      persistenceLocations: ['context_editor'],
    })
  })
})
