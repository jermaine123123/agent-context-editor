export declare const PACKAGE_NAME: 'context-editor-deepseek-harness'
export declare const methods: readonly string[]
export interface ContextEditorInvocation {
  readonly id: string
  readonly service: 'contextEditor'
  readonly namespace: 'contextEditor'
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly parameters: readonly [{ readonly name: 'request'; readonly wire: 'request'; readonly source: 'json'; readonly codec: { readonly mode: 'strict'; readonly typeSymbol: string; readonly schema: unknown } }]
  readonly result: { readonly mode: 'strict'; readonly typeSymbol: string; readonly schema: unknown }
}
export declare const descriptors: readonly ContextEditorInvocation[]
export declare const TYPERT: {
  readonly package: 'context-editor-deepseek-harness'
  readonly face: 'host'
  readonly schemas: readonly []
  readonly model: unknown
  readonly invocations: readonly ContextEditorInvocation[]
}
export default TYPERT
