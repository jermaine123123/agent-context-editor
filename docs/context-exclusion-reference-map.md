# Context exclusion reference map

This document records the upstream designs inspected for the Pi context-exclusion MVP. The
repositories are references only; no third-party source or dependency is vendored into this
project.

## Frozen references

| Project | Reviewed revision | License | Relevant source/design |
| --- | --- | --- | --- |
| [a-Fig/Accordion](https://github.com/a-Fig/Accordion) | `e3eb9bbb9db64aa3db741387bf5f501424ebfb1f` | [MIT](https://github.com/a-Fig/Accordion/blob/e3eb9bbb9db64aa3db741387bf5f501424ebfb1f/LICENSE) | [`core/agentView.ts`](https://github.com/a-Fig/Accordion/blob/e3eb9bbb9db64aa3db741387bf5f501424ebfb1f/core/agentView.ts), provider-safe folding and restoration; [`docs/adr/0014-naive-compaction-conductor.md`](https://github.com/a-Fig/Accordion/blob/e3eb9bbb9db64aa3db741387bf5f501424ebfb1f/docs/adr/0014-naive-compaction-conductor.md), compaction boundary rationale |
| [HaShiShark/context-editor-agent](https://github.com/HaShiShark/context-editor-agent) | `1fa77953267ce9c239aec9d29cb5b353e9ca28ae` | [GPL-3.0](https://github.com/HaShiShark/context-editor-agent/blob/1fa77953267ce9c239aec9d29cb5b353e9ca28ae/LICENSE) | Context Workbench and the working-snapshot / atomic-commit / revision workflow described in [`README.md`](https://github.com/HaShiShark/context-editor-agent/blob/1fa77953267ce9c239aec9d29cb5b353e9ca28ae/README.md) |

## Invariant mapping

| Upstream invariant | Local implementation | Local proof |
| --- | --- | --- |
| Accordion keeps authoritative content separate from the model-facing wire projection. | Pi Session JSONL remains immutable; projection events live in a separate sidecar and are applied only in the `context` hook. | Session SHA-256 is unchanged before and after exclude/restore; provider payload changes only at selected atoms. |
| Accordion restores from authoritative content rather than from a digest. | `restore` re-reads the current branch and replays projection events; no excluded text is persisted. | Exclude → append new turn → restore returns the exact original blocks. |
| Tool-call boundaries must remain provider-safe. | Tool Call and matching Tool Result are an atomic closure; signed reasoning is retained with the related tool chain. | Core closure fixtures and Pi payload validation reject orphan pairs. |
| Accordion protects a recent working tail. | The MVP keeps the chosen soft policy: selecting the latest logical turn produces a stronger confirmation warning, but is not hard-blocked. | TUI confirmation test asserts warning text and still permits a confirmed mutation. |
| Hashcode separates proposal/preview from commit. | Core exposes a projection preview with effective targets and auto-expansions; TUI confirms before sidecar append. | Preview/commit tests verify no write occurs before confirmation. |
| Hashcode checks revision and applies edits atomically. | Projection sidecar uses composite branch revision, source fingerprints, file lock, temp-file write and rename. | Stale revision, changed fingerprint and concurrent append tests fail closed. |
| Hashcode provides reversible revision history. | The MVP uses append-only `exclude`/`restore` events rather than rewriting the canonical transcript or storing full snapshots. | Event replay tests prove deterministic state and exact restoration. |

## License boundary

The implementation is a clean-room reimplementation of the mapped behavior. Accordion's MIT
license permits reuse with attribution, but no Accordion source is copied in this MVP. Hashcode's
GPL-3.0 code is not copied, linked, vendored or used as a runtime dependency; only publicly
observable behavior, workflow concepts and test invariants are used.
