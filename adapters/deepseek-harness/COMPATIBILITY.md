# Compatibility

| Field | Value |
| --- | --- |
| Package | `context-editor-deepseek-harness@0.2.0` |
| DeepSeek Harness | `141eb6fef83422698aef7a981029e843e8161534` |
| Harness CLI | `@deepseek-ai/dsh@0.1.0-rc.8` |
| Release channel | Stable adapter release; host remains Developer Preview rc.8 |
| Node | `24.14.1` (the locked test toolchain) |
| Build | Prebuilt JavaScript package; no install-time build hook |
| Independent units | Reasoning and answer units, hierarchical AI filters, centered search navigation, and native context projection in `0.2.0` |
| Persistence | `context_editor` storage-domain sidecar; Session log append-only; context/projection is a required non-surface event |
| UI language | `zh-*` Chinese; all other browser locales English |
| Recorded at | `2026-08-25` |

The adapter intentionally does not claim compatibility with later Harness
commits until the same acceptance flow is repeated.  Context exclusion is implemented as the native Session `context/projection` event; the rc.8 Host capability is now advertised as `contextExclusion: true` after the Host/Browser/provider acceptance matrix, request-capture regressions, and a real DeepSeek smoke request passed.
