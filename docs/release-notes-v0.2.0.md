# Agent Context Editor v0.2.0

This is the first stable GitHub release of the cross-agent Context Editor.
It adds reversible model-context exclusion to both released host adapters while
preserving the canonical conversation history.

## Included packages

- `pi-context-editor@0.4.0` for Pi `0.84.2`
- `context-editor-deepseek-harness@0.2.0` for DeepSeek Harness
  `@deepseek-ai/dsh@0.1.0-rc.8` at commit
  `141eb6fef83422698aef7a981029e843e8161534`

## What changed

- Pi TUI `/ctx` can preview, confirm, restore, and persist model-context
  exclusion with `x`. Projection events live in a separate sidecar and are
  applied by a fail-closed `context` hook.
- DeepSeek Harness uses the native same-Session `context/projection` event.
  Preview/commit, restore, idempotency, revision checks, maintenance, flush,
  and real API smoke validation are included.
- Tool Call/Result closures and signed reasoning chains remain provider-safe.
- Reasoning and final-answer units remain independently searchable, filterable,
  hideable, restorable, and undoable.
- Visual hiding remains separate from context exclusion. Hiding alone does not
  reduce token usage.
- Pi Desktop/RPC remains a visual Context Editor path; it does not receive
  model-context projection in this release.
- Chinese (`zh-*`) hosts use the Chinese UI; other locales use English.
- The original Pi Session JSONL, Harness Surface events, and conversation
  display are not rewritten. Context exclusion changes only derived provider
  messages.

## Known limits

- The active host chat timeline is not rewritten or filtered in place.
- AI-assisted condensation, selected-range summaries, summary replacement, and
  Tool Output replacement are not included.
- Pi context projection fails closed when the projection sidecar is corrupt,
  stale, ambiguous, or structurally unsafe.
- DeepSeek Harness `rc.6` and earlier do not understand the native
  `context/projection` event; use the pinned rc.8 boundary.

## Verification

The release was rebuilt from the shared Core and checked with TypeScript,
Core/adapter fixtures, i18n checks, Pi and DeepSeek bundle builds, tarball
allowlists, projection closure tests, CAS/fingerprint conflict tests, and a
real DeepSeek API smoke request. Release assets include SHA-256 checksums.

This is an independent community project and is not affiliated with DeepSeek,
Pi, or their maintainers. No npm publication is part of this release.
