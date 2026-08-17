/** Hand-authored Typert host contribution for the prebuilt plugin package. */

import { z } from 'zod'

export const PACKAGE_NAME = 'context-editor-deepseek-harness'
export const methods = Object.freeze([
  'getSnapshot',
  'listRecords',
  'getRecord',
  'searchRecords',
  'getSearchMatch',
  'commitView',
  'undoView',
])

export const descriptors = Object.freeze(methods.map(method => {
  const requestType = `${PACKAGE_NAME}#contextEditor/${method}:request`
  const resultType = `${PACKAGE_NAME}#contextEditor/${method}:result`
  return {
    id: `${PACKAGE_NAME}#${method}`,
    service: 'contextEditor',
    namespace: 'contextEditor',
    method,
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: {
        mode: 'strict',
        typeSymbol: requestType,
        schema: z.unknown(),
      },
    }],
    result: {
      mode: 'strict',
      typeSymbol: resultType,
      schema: z.unknown(),
    },
  }
}))

/** Host-side generated-artifact equivalent used by ctx.typert.register(). */
export const TYPERT = Object.freeze({
  package: PACKAGE_NAME,
  face: 'host',
  schemas: [],
  model: {
    services: [{
      key: 'contextEditor',
      exportName: 'ContextEditorHost',
      members: methods.map(name => ({ kind: 'method', name, signature: '(request: unknown) => Promise<unknown>' })),
      types: [],
      tags: [],
    }],
    events: [],
    objects: [],
  },
  invocations: descriptors,
})

export default TYPERT
