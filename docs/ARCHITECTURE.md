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
           V1/V2 view + replacement sidecar events
                                │
                                ▼
                    native context/projection log
```

The DeepSeek adapter reads finalized `user/message`, `assistant/message`,
`tool/call` and `tool/result` events. Stream chunks, summaries and request
headers are not editable records. View events are appended to the
`context_editor` storage-domain table and are fenced by Session lifecycle
identity (`id`, `createdAt`, and `cwd`). A changed atom fingerprint fails open
to `show`. Replacement records are accepted only when their `eventId` matches
the adapter-owned native projection operation; a sidecar prewrite without a
matching native event is ignored on read.

The DeepSeek model input is composed in a fixed order: canonical Surface
message, then the active replacement for an eligible User or complete unsigned
Answer, then context exclusion. Exclusion therefore wins over replacement.
Answer text spanning multiple assistant roots is removed from every original
root and inserted once at the final text position; reasoning, tool calls,
results and event order remain intact. The canonical Surface log is never
rewritten—only a native `context/projection` event is appended.

The Pi TUI uses the shared V2 record/unit contract and persists view events in
a sidecar beside the active Session file. Its Desktop/RPC compatibility path
still reads and writes visual V1 CustomEntry state. Existing
`context-editor-state` entries are read only for visual migration, and legacy
context-state actions are ignored. No Pi path projects Tool Output replacements
into model messages. The DeepSeek replacement capability is enabled for
eligible User/Answer units in the tested rc.8 adapter; later Harness commits
require a fresh acceptance run.

The Pi Context Desktop fork uses the same contract but remains a separate
Electron repository so upstream history and binaries do not become part of the
adapter package.
