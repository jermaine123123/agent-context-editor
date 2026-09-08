# Agent Context Editor v0.3.1

Date: 2026-09-09

This release adds linked Answer/Reasoning context control to the Pi TUI and
DeepSeek Harness adapters. It is pinned to DeepSeek Harness commit
`141eb6fef83422698aef7a981029e843e8161534` / `@deepseek-ai/dsh@0.1.0-rc.8`.

## Packages

- `pi-context-editor@0.5.1` for Pi `0.84.2`
- `context-editor-deepseek-harness@0.3.1` for the tested DeepSeek Harness rc.8 boundary

## What changed

- Editing a complete unsigned Answer with same-turn reasoning offers linked
  exclusion of that reasoning by default. User messages and Answers without
  associated reasoning keep the normal editor.
- Pi TUI presents the linked-impact confirmation after its native multiline
  editor. DeepSeek Harness presents the same choice in the browser dialog.
- The Core associates units by logical `turnId`, including Answers spanning
  multiple assistant roots. Signed reasoning can expand the exclusion closure
  to its paired tool chain; the preview lists the added units and requires an
  explicit confirmation.
- One `operationId` covers the replacement and linked exclusion. Retries are
  idempotent, incomplete writes fail closed, and whole-operation undo restores
  only exclusions introduced by that edit. Restore-original changes text only.
- Effective text is used consistently by list, search and provider projection;
  original Surface nodes, history events and Session data remain unchanged.

## Verification boundary

The full local suite passed, as did TypeScript checks, sensitive-data and i18n
scans, DeepSeek/Pi Core and client builds, package validation, isolated package
loading, and release checksum verification.

The DeepSeek package was installed into the isolated
`deepseek-harness-latest` web profile. The installed Host fixture returned an
editable Answer with its associated Reasoning unit, and an in-process rc.8
commit/undo smoke confirmed the derived payload and unchanged Surface/history.

Browser automation could not start because the local CUA sandbox failed to
initialize. A real DeepSeek request was not run because no credential was
supplied; no key or private prompt is recorded in this repository.

See `docs/PI_ANSWER_REASONING_ACCEPTANCE.md` and
`docs/DEEPSEEK_HARNESS_ANSWER_REASONING_ACCEPTANCE.md` for the detailed
acceptance boundaries.