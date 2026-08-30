# Agent Context Editor

Agent Context Editor is a cross-agent plugin for manually excluding and editing AI conversation context. It also supports searching, filtering, selecting, hiding, restoring, and undoing conversation changes while preserving the original Session.

It provides a consistent, reversible, and user-controlled context-management option across supported Agent hosts, complementing prompt steering and automatic context compaction rather than replacing them.

中文说明: [README.zh-CN.md](README.zh-CN.md)

## Usage guidance

Long-running Agent sessions can suffer from **context rot**: as the context grows—especially when failed attempts, stale conclusions, and irrelevant Tool output accumulate—the model may become less reliable at finding and correctly applying important information even before the context window is full.

For most tasks, prompt steering and automatic context compaction are usually sufficient. Manual context exclusion and editing are optional controls for cases where the automatic result is not what you want, rather than something users need to manage continuously. They can be useful when compaction drops details worth preserving or when failed attempts and irrelevant history occupy too much of the context.

> **Prompt-cache impact:** Excluding or editing context changes the model-input prefix. Cached prompt content after the earliest changed position may no longer be reusable, so changes near the end of a Session usually affect less cached context than changes near the beginning. Exact behavior depends on the Agent host, model, and provider. The original Session remains preserved.

## Features

- Manually exclude selected context and restore it later
- Edit User messages and AI Answers with restore and undo
- Search conversations and navigate between matches
- Filter User, AI, Reasoning, Answer, and Tool content
- Select individual items, continuous ranges, or multiple items
- Hide, restore, reset, and undo visual changes
- Manage AI Reasoning and final Answers independently
- Save changes without overwriting the original Session
- Automatically use a Chinese or English interface

## Supported hosts

| Feature | Pi TUI | Pi Desktop/RPC | DeepSeek Harness |
| --- | ---: | ---: | ---: |
| Search and filters | Yes | Yes | Yes |
| Single, range, and batch selection | Yes | Yes | Yes |
| Independent Reasoning and Answer units | Yes | Yes | Yes |
| Visual hide, restore, reset, and undo | Yes | Yes | Yes |
| Manual context exclusion | Yes | No | Yes |
| Manual User/Answer editing | Yes | No | Yes |
| Original Session preserved | Yes | Yes | Yes |
| Chinese and English UI | Yes | Yes | Yes |

Manual context exclusion and text editing are currently available in Pi TUI and DeepSeek Harness. Editable content is limited to plain-text User messages and complete unsigned Answers.

The separate [Pi Context Desktop](https://github.com/jermaine123123/pi-app) community build provides visual conversation management for Windows x64.

## Install

### Pi extension

Download `pi-context-editor-0.5.0.tgz` from the [release assets](https://github.com/jermaine123123/agent-context-editor/releases). Pi `0.84.2` installs a local package directory rather than a `.tgz` file. Extract the archive so that `package.json` is at the package directory root, then run:

```sh
pi install ./pi-context-editor-0.5.0
```

When working directly from this repository:

```sh
pi install ./adapters/pi-extension
```

For Pi Desktop registration, run `adapters/pi-extension/scripts/install-desktop.ps1` with PowerShell. The script accepts `-PiPath` and `-DesktopExePath` for non-standard installations. Fully restart Pi Desktop after installation.

### DeepSeek Harness

Download `context-editor-deepseek-harness-0.3.0.tgz` from the release assets and install it with the official Harness CLI:

```sh
dsh plugin --profile <profile> add ./context-editor-deepseek-harness-0.3.0.tgz
```

The adapter targets DeepSeek Harness Developer Preview commit `141eb6fef83422698aef7a981029e843e8161534` and `@deepseek-ai/dsh@0.1.0-rc.8`. See [COMPATIBILITY.md](adapters/deepseek-harness/COMPATIBILITY.md) for the tested host boundary.

## Usage

### Pi TUI

Enter `/ctx` to open the full-screen Context Editor. The primary controls are `x` for context exclusion or restoration, `e` for editing, `E` for restoring original text, `h` and `r` for visual hiding and restoration, and `s` for switching the search scope. Press `?` for the complete shortcut reference.

### Pi Desktop/RPC

Enter `/ctx` to open the native Context Editor dialogs. This path supports search, filters, selection, and visual hide/restore operations. It does not currently support model-context exclusion or User/Answer editing.

### DeepSeek Harness

Open the `Context Editor` tab beside the normal Chat view. The tab manages the same Session and provides context exclusion, User/Answer editing, search, filters, selection, visual hiding, restoration, and undo.

## How it works

Agent Context Editor reads the existing Session and presents User, AI, Reasoning, Answer, and Tool content in an independent management view. Reasoning and final Answers from the same AI turn remain separately manageable, while related Tool Calls and Tool Results remain paired.

Visual changes and model-context changes are stored separately. Visual hiding only changes the Context Editor view. Confirmed context exclusion and supported text edits change the derived input sent to the model without overwriting the original Session or the host's main chat timeline.

## Current limitations

- The plugin does not edit or hide content directly in the host's main chat timeline.
- Pi Desktop/RPC does not support model-context exclusion or text editing.
- Reasoning, Tool, System, attachment, structured User, and signed Answer content cannot be edited.
- Batch text replacement is not supported.
- Visual hiding does not change model input or reduce token usage.
- There is no separate hide-all operation; restore-all is available.
- AI-assisted cleanup, selected-range summaries, and summary replacement are not yet available.
- DeepSeek Harness compatibility is limited to the tested rc.8 host boundary.

## Current release

The current stable project release is `v0.3.0`:

- Pi extension: `pi-context-editor@0.5.0`
- DeepSeek Harness adapter: `context-editor-deepseek-harness@0.3.0`
- Pi Context Desktop community build: `context-editor-v0.1.4`

See the [v0.3.0 release notes](docs/release-notes-v0.3.0.md) for detailed changes and verification results.

## Roadmap

- Support more Agent hosts
- Add reversible summary generation and replacement

### Future exploration

- Explore a per-prompt Conversation Context Router: before each request, evaluate how the current task relates to conversation history and assemble a minimal, dependency-safe working set. Routing would affect only the derived model input for that request, never rewrite the original Session, and remain previewable, explainable, overridable, with a full-context fallback.

## Development

Requirements: Node.js 22.19 or later. Node 24 was used for the recorded local acceptance run.

```sh
npm ci
npm run verify
```

`npm run verify` builds both adapters, runs TypeScript checks and automated tests, scans the packages, and verifies the release archives.

Contributions and host compatibility reports are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Please report security issues according to [SECURITY.md](SECURITY.md).

## Repository layout

```text
agent-context-editor/
|-- adapters/
|   |-- pi-extension/          Pi /ctx adapter
|   `-- deepseek-harness/      DeepSeek Harness adapter
|-- packages/context-editor-core/
|-- docs/
|-- assets/
|-- scripts/
`-- test/
```

`pi-app/` remains a separate Git repository and is not included in this repository.

## Project status

Agent Context Editor is an independent community project. It is not affiliated with, endorsed by, or sponsored by Pi, DeepSeek, or their maintainers.


## License

MIT. See [LICENSE](LICENSE).
