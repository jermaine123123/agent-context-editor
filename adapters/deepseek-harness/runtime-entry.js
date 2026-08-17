// This entry is bundled into core-runtime.js by build-core.mjs. Keeping the
// imports here small makes the DeepSeek artifact consume the canonical Core
// projection and search implementation without requiring a workspace path at
// runtime.
export { projectRecords } from '../../packages/context-editor-core/src/records.ts'
export { searchRecords } from '../../packages/context-editor-core/src/search.ts'
