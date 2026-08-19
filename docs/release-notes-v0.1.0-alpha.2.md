# Agent Context Editor v0.1.0-alpha.2

This release synchronizes the latest Pi TUI and DeepSeek Harness validation
updates. It is a GitHub-only Developer Preview; no npm registry publication is
made.

## Included adapters

- `pi-context-editor@0.4.0-alpha.2`
  - Pi TUI occurrence-level search with `n`/`N` navigation, automatic
    expansion, centering and active-hit highlighting;
  - temporary `Enter` expand/collapse and reversible `h`/`r` hide/restore;
  - hidden-content protection, Tool-name search, help view and resize-aware
    layout;
  - dialogue-scope search by default, with temporary full-history scope.
- `context-editor-deepseek-harness@0.1.4`
  - independent reasoning and final-answer units, including hierarchical AI
    filters and legacy filter migration;
  - dialogue-scope search by default, temporary full-history search, literal
    occurrence counts, previous/next navigation and centered active-hit
    positioning below sticky controls;
  - user/AI/Tool filtering, batch hide/restore, restore-all, undo, sidecar
    persistence, revision/CAS conflict checks and hidden-content protection;
  - Chinese UI for `zh-*` locales and English UI for other browser locales.

Both adapters preserve the original Session log and model input. Visual hiding
does not exclude context or reduce token usage. Context exclusion, AI
condensation and summary replacement remain outside this release.

## Validation

`npm run verify` passed with 15 test files and 65 tests, including TypeScript,
sensitive-data and i18n scans, generated bundles, and package-content checks.

The DeepSeek package was verified against Harness Developer Preview commit
`47f943859bef60e4160492346772ded9b24f765a0` and CLI
`@deepseek-ai/dsh@0.1.0-rc.6`.
