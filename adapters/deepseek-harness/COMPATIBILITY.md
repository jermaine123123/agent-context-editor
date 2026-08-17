# Compatibility

| Field | Value |
| --- | --- |
| Package | `context-editor-deepseek-harness@0.1.1` |
| DeepSeek Harness | `47f943859bef60e4160492346772ded9b24f765a0` |
| Harness CLI | `@deepseek-ai/dsh@0.1.0-rc.6` |
| Release channel | Developer Preview |
| Node | `24.14.1` (the locked test toolchain) |
| Build | Prebuilt JavaScript package; no install-time build hook |
| Independent units | Reasoning and answer units supported in `0.1.1` |
| Persistence | `context_editor` storage-domain sidecar; Session log unchanged |
| Recorded at | `2026-08-18 00:51:39 +08:00` |

The adapter intentionally does not claim compatibility with later Harness
commits until the same acceptance flow is repeated.  Context exclusion is not
part of this package; the advertised Host capability is `contextExclusion: false`.
