# Architecture

The project keeps host-specific I/O at the adapter boundary and shares record,
unit, search and view-event rules through `packages/context-editor-core`.

```text
host session log
      │
      ▼
adapter normalization ──► ContextAtom[]
      │                         │
      │                         ▼
      └──────────────► canonical Core projection/search
                                │
                                ▼
                    records + reasoning/answer units
                                │
                                ▼
                    V1/V2 sidecar view events
```

The DeepSeek adapter reads finalized `user/message`, `assistant/message`,
`tool/call` and `tool/result` events. Stream chunks, summaries and request
headers are not editable records. View events are appended to the
`context_editor` storage-domain table and are fenced by Session lifecycle
identity (`id`, `createdAt`, and `cwd`). A changed atom fingerprint fails open
to `show`.

The Pi TUI uses the shared V2 record/unit contract and persists view events in
a sidecar beside the active Session file. Its Desktop/RPC compatibility path
still reads and writes visual V1 CustomEntry state. Existing
`context-editor-state` entries are read only for visual migration, and legacy
context-state actions are ignored. No Pi path projects Tool Output replacements
into model messages.
The Pi Context Desktop fork uses the same contract but remains a separate
Electron repository so upstream history and binaries do not become part of the
adapter package.
