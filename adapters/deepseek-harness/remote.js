/**
 * Client-facing Remote contribution.  The official Harness client mounts this
 * descriptor table through `ctx.remote.$mount()`; no browser code reaches the
 * Host by importing the Host service.
 */
import { descriptors, PACKAGE_NAME } from './typert.js'

export const contextEditorRemote = Object.freeze({
  package: PACKAGE_NAME,
  descriptors,
})

export default contextEditorRemote
