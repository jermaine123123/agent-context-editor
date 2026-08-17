# Security notes

Context Editor is a local developer tool. It handles prompts, tool arguments,
tool results and model reasoning, so treat its logs and sidecars as sensitive.

- The DeepSeek adapter does not append to or rewrite the original Session log.
- View state is stored in a separate `context_editor` sidecar and is fenced by
  Session lifecycle identity.
- Atom fingerprints protect against applying a stale hide/restore operation to
  changed content; they are integrity checks, not cryptographic secrecy.
- No telemetry, remote upload or token is required by this repository.
- Do not commit Session files, screenshots with prompts, API keys, cookies or
  private workspace paths.

Report security issues privately to the repository owner before opening a
public issue. See [SECURITY.md](../SECURITY.md) for the disclosure contact.
