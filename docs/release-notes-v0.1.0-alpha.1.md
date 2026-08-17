# Agent Context Editor v0.1.0-alpha.1

This alpha publishes:

- `pi-context-editor@0.3.0` for Pi TUI/Desktop;
- `context-editor-deepseek-harness@0.1.1` for DeepSeek Harness Developer
  Preview (`@deepseek-ai/dsh@0.1.0-rc.6`);
- prebuilt GitHub tarballs only; no npm registry release.

DeepSeek reasoning and answer units can be searched, hidden, restored and
persisted independently. Both adapters keep the original host Session log and
model input unchanged. Hiding is a view operation and does not reduce tokens.

Known limits: context exclusion, Harness Tool Output replacement, token
compression, signed desktop binaries and additional hosts are not included.
