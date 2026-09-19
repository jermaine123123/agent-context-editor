import { buildProjection, normalizeSessionEvents } from './core.js'

/** Rebuild on projection edits; ordinary appended events only reproject affected records. */
export class HistoryIndex {
  constructor() { this.sessions = new Map(); this.stats = { fullBuilds: 0, tailEvents: 0 } }
  clear() { this.sessions.clear() }
  build(identity, events, row, options) {
    const key = JSON.stringify([identity, row, options.committedReplacementEvents, options.requestOverlays])
    const old = this.sessions.get(identity.id)
    const samePrefix = old && old.key === key && old.count <= events.length
      && (old.count === 0 || JSON.stringify(events[old.count - 1]) === old.last)
    if (samePrefix && old.count === events.length) return old.projection
    const tail = samePrefix ? events.slice(old.count) : []
    const active = new Set(options.activeSurfaceSeqs)
    const canAppend = samePrefix && tail.every(event => !event.surfaceOp || event.surfaceOp === 'append')
      && !tail.some(event => event.type === 'context/projection' || event.type === 'compaction/summary' || event.type === 'image/offload')
      && (old.projection.activeSurfaceSeqs ?? []).every(root => active.has(root))
    let projection
    if (canAppend) {
      this.stats.tailEvents += tail.length
      const normalized = normalizeSessionEvents(identity, tail, { modelToolCalls: old.toolCalls })
      const affected = new Set(normalized.atoms.map(atom => atom.recordId))
      const priorAtoms = old.projection.records.filter(record => affected.has(record.id)).flatMap(record => record.atoms)
      const partial = buildProjection(identity, events, row, { ...options,
        normalized: { identity, atoms: [...priorAtoms, ...normalized.atoms], sourceRevision: Math.max(old.projection.sourceRevision, normalized.sourceRevision) } })
      const replacements = new Map(partial.records.map(record => [record.id, record]))
      const records = old.projection.records.map(record => {
        const next = replacements.get(record.id); replacements.delete(record.id); return next ?? record
      }).concat([...replacements.values()])
      projection = { ...partial, records, atoms: old.projection.atoms.concat(normalized.atoms) }
      for (const name of ['states', 'replacementStates', 'projectionStates']) projection[name] = new Map([...old.projection[name], ...partial[name]])
    } else {
      this.stats.fullBuilds++
      projection = buildProjection(identity, events, row, options)
    }
    projection.recordIndex = new Map(projection.records.map((record, index) => [record.id, index]))
    const toolCalls = samePrefix ? old.toolCalls : new Set()
    for (const event of samePrefix ? tail : events) if (event.type === 'assistant/message') {
      for (const block of event.data?.message?.content ?? []) if (block.type === 'tool-call') toolCalls.add(String(block.id ?? block.callId))
    }
    this.sessions.delete(identity.id)
    this.sessions.set(identity.id, { key, projection, toolCalls, count: events.length, last: JSON.stringify(events.at(-1)) })
    if (this.sessions.size > 8) this.sessions.delete(this.sessions.keys().next().value)
    return projection
  }
}
