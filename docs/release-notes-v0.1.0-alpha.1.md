# Agent Context Editor v0.1.0-alpha.1

This alpha publishes:

- `pi-context-editor@0.4.0-alpha.1` for Pi TUI/Desktop;
- `context-editor-deepseek-harness@0.1.1` for DeepSeek Harness Developer
  Preview (`@deepseek-ai/dsh@0.1.0-rc.6`);
- prebuilt GitHub tarballs only; no npm registry release.

DeepSeek reasoning and answer units can be searched, hidden, restored and
persisted independently. Pi TUI reasoning and answer units use the same shared
Core and write visual events to a Session sidecar. Hiding is a view operation
and does not reduce tokens or alter model input; Pi Desktop's compatibility
path may append its legacy visual CustomEntry.

The Context Editor controls now follow the host language automatically:
`zh-*` locales use Chinese labels and all other system/browser locales use
English. Session content is never translated.

Known limits: context exclusion, Harness Tool Output replacement, token
compression, signed desktop binaries and additional hosts are not included.
