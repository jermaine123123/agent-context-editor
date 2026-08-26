# Compatibility

| Field | Value |
| --- | --- |
| Package | `context-editor-deepseek-harness@0.3.0` |
| DeepSeek Harness | `141eb6fef83422698aef7a981029e843e8161534` |
| Harness CLI | `@deepseek-ai/dsh@0.1.0-rc.8` |
| Release channel | Stable adapter release; host remains Developer Preview rc.8 |
| Node | `24.14.1` (the locked test toolchain) |
| Build | Prebuilt JavaScript package; no install-time build hook |
| Independent units | Reasoning and answer units, hierarchical AI filters, centered search navigation, native context projection, and User/Answer replacement in `0.3.0` |
| Persistence | `context_editor` storage-domain sidecar with optional `replacementEvents`; Session log append-only; matching `context/projection` is appended for model input |
| UI language | `zh-*` Chinese; all other browser locales English |
| Recorded at | `2026-08-26` |

The adapter is released as stable for the pinned rc.8 boundary. Context exclusion
and User/Answer replacement are implemented as native Session `context/projection`
events; automated fixtures, isolated package installation, local provider-payload
composition, and rc.8 web profile startup checks passed. The host remains a
Developer Preview and later Harness commits require a fresh acceptance run. No
API key is stored in this repository or acceptance materials.
