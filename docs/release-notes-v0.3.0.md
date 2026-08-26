# Agent Context Editor v0.3.0

This is a stable, non-preview release of the shared Core and its Pi TUI and
DeepSeek Harness adapters.

## Packages

- `pi-context-editor@0.5.0` for Pi `0.84.2`
- `context-editor-deepseek-harness@0.3.0` for the tested
  `@deepseek-ai/dsh@0.1.0-rc.8` boundary

## Manual model-context controls

- Manually exclude selected units from subsequent model input and restore them
  later. Exclusion is previewed and confirmed, keeps Tool Call/Result closure,
  and never rewrites the canonical Session.
- Manually edit eligible plain-text User and complete unsigned Answer units.
  Restore the canonical text, undo the latest change per unit (LIFO), and
  compare against the original. Replacement is reversible and exclusion takes
  precedence.
- Pi TUI uses the projection sidecar and context hook. DeepSeek Harness uses
  the native `context/projection` event path.

## Conversation management

The independent Context Editor view supports search, User/AI/Tool filters,
independent reasoning and final-answer units, contiguous or batch selection,
hide/restore/reset, and undo. Visual state is stored separately; the original
Session and surface history remain intact.

Structured User, signed or replay-bound Answer, reasoning, Tool, System,
attachment, and batch replacement remain protected. Main-chat timeline editing,
AI condensation, and summary replacement are not included.

## Verification and compatibility

The repository's existing local verification passed: 20 test files and 89
tests, TypeScript and sensitive-data/i18n scans, Pi and DeepSeek builds,
package allowlist checks, isolated package installation, local provider-payload
composition, and rc.8 Web startup (HTTP 200). No external DeepSeek API request
was made because no credentials were available; the DeepSeek host remains a
Developer Preview and this release states the tested rc.8 boundary explicitly.

Download the two tarballs and `SHA256SUMS.txt` from the GitHub Release assets.
This project is independent and is not affiliated with DeepSeek or Pi.
