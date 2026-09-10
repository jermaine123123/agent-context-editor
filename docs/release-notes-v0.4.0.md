# Agent Context Editor v0.4.0

Date: 2026-09-11

This release adds AI-powered condensation and reversible replacement for
selected conversation context in both Pi TUI and DeepSeek Harness.

## Packages

- `pi-context-editor@0.6.0` for Pi `0.84.2`
- `context-editor-deepseek-harness@0.4.0` for the tested DeepSeek Harness
  `@deepseek-ai/dsh@0.1.0-rc.8` boundary

## AI condensation

- Select one or more context units and generate a shorter candidate summary
  with a configured model.
- Review the selected source, estimated token reduction and tool-related risks,
  then edit the candidate before applying it.
- A single selected Answer can optionally include its same-turn AI reasoning
  and tool output. The option is off by default; it is disabled for other
  selections so the explicit selection remains unchanged.
- Generation can be cancelled or regenerated. Late cancelled results, stale
  revisions, changed source fingerprints, unsafe structures and overlapping
  active condensations are rejected.
- Applying a candidate changes only the derived model context. The original
  Session remains intact, and the applied summary can be excluded, restored,
  inspected, or replaced with its original source again.
- Active summaries survive reopening through the projection sidecar, and
  repeated commits are idempotent.

## Host experience

### Pi TUI

- `c`: generate and review condensation for the current selection.
- `C`: exclude or restore the active summary.
- `D`: restore the original selected context.
- `O`: expand or collapse the summary source.
- Space multi-selection and Shift+Arrow range selection are preserved while
  navigating and after returning from the editor.

### DeepSeek Harness

- The Context Editor tab supports model selection, optional prefix reuse,
  streaming generation, cancellation, editable preview, apply and restore.
- Unselected reasoning and tool blocks sharing a native message are preserved.
- Summary state is persisted in the `context_editor` sidecar and activated
  only by matching native `context/projection` events.

## Fixes included

- Fixed Pi TUI becoming stuck when linked reasoning/tool condensation was
  selected.
- Fixed normal cursor movement clearing earlier multi-selection.
- Fixed restored historical condensations incorrectly blocking a new operation
  with `CONTEXT_EDITOR_CONDENSATION_OVERLAP`.
- Condensation failures are now shown in the active setup window instead of
  being hidden behind it.

## Verification

- `npm run verify` passed: 23 test files and 110 tests.
- TypeScript checks, sensitive-data scan, i18n scan, Pi and DeepSeek builds,
  client bundle build and package allowlist validation passed.
- A real Pi 0.84.2 run using the configured DeepSeek model completed the full
  generate → review → apply → summary exclude/restore → source restore flow.
- In the recorded smoke, the selected content was reduced from an estimated
  244 tokens to 97 tokens (60%) while retaining paths, commands, error codes
  and remaining tasks.
- DeepSeek host fixtures cover generation, restart recovery, application,
  restore, summary exclusion and projection behavior. A browser-level request
  using real DeepSeek credentials was not performed for the Harness adapter.

The release is GitHub-only; no npm package is published.
