# Security notes

Context Editor is a local developer tool. It handles prompts, tool arguments,
tool results and model reasoning, so treat its logs and sidecars as sensitive.

- The DeepSeek adapter does not append to or rewrite the original Session log.
- View state and replacement history are stored in a separate `context_editor`
  sidecar and are fenced by Session lifecycle identity.
- A replacement event is only active after a matching adapter-owned native
  `context/projection` event is present. A crash between the sidecar prewrite
  and native append therefore fails closed on the next read.
- Replacement text exists in the sidecar and in the appended native projection
  payload by design. Both are local sensitive data; neither is uploaded by the
  plugin. The canonical Surface event and normal chat timeline remain intact.
- Atom fingerprints protect against applying a stale hide/restore operation to
  changed content; they are integrity checks, not cryptographic secrecy.
- User replacement is limited to non-empty plain text, and Answer replacement
  is limited to complete unsigned text-only blocks. Reasoning, Tool and
  structured/signed content are rejected to avoid producing invalid provider
  protocol messages.
- No telemetry, remote upload or token is required by this repository.
- Do not commit Session files, screenshots with prompts, API keys, cookies or
  private workspace paths.

Report security issues privately to the repository owner before opening a
public issue. See [SECURITY.md](../SECURITY.md) for the disclosure contact.
