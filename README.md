# Agent Context Editor

A cross-agent conversation manager for long Coding Agent sessions—searchable,
filterable, hideable, reversible, and built to preserve the original Session.

Long-running Agent sessions accumulate user instructions, model reasoning,
older answers, and tool output. Agent Context Editor builds an independent,
structured management view over the existing Session so you can search the
whole conversation, filter User, AI, and Tool messages, select individual or
multiple items, and hide, restore, or undo view changes. Hidden state is stored
separately; the original Session is never deleted or rewritten.

The long-term goal is to provide the same conversation-editing workflow across
Agent hosts: keep long sessions focused, quickly return to the information you
chose to retain, control what participates in future model context, and ask AI
to condense a selected range or the entire session.

## Developer Preview

The first phase is available today for Pi and DeepSeek Harness. It provides an
independent Context Editor view with:

- full-session text search, occurrence counts, and previous/next navigation;
- User, AI, and Tool type filters, including combined filters;
- single, contiguous, and batch selection;
- reversible visual hiding, restore, reset, and undo;
- sidecar persistence without deleting or rewriting the original Session;
- independent reasoning and final-answer units in DeepSeek Harness.

Visual hiding currently changes only the Context Editor view. It does not edit
the host's main chat timeline, remove messages from future model input, or
reduce token usage. Pi TUI acceptance testing is still in progress.

The repository currently ships two adapter packages and one desktop fork:

| Adapter | Package / app | Current scope |
| --- | --- | --- |
| Pi extension | `pi-context-editor@0.4.0-alpha.1` | `/ctx` in Pi TUI and Pi Desktop; shared unit editor with visual-only state |
| DeepSeek Harness | `context-editor-deepseek-harness@0.1.1` | Context Editor tab with independent reasoning/answer units |
| Pi Context Desktop | `jermaine123123/pi-app` `context-editor-v0.1.4` | Windows x64 community desktop build |

中文说明：[README.zh-CN.md](README.zh-CN.md)

## How it works today

The DeepSeek Harness adapter reads the durable Session event log and projects
user, AI and tool records into a separate Context Editor view. Reasoning and
answer blocks in one AI turn are independent view units: you can search, filter
by type, select individually or in batches, hide, restore and undo either unit
without hiding the other. Hide, restore, reset and undo events are stored in a
`context_editor` sidecar.

The original Harness Session log and model input are not rewritten. Hiding is a
view operation in this release and does not reduce model token usage. The Pi
TUI uses the same Record/Unit Core as the other adapters. Pi TUI view events
and preferences are stored in an atomic
`<sessionFile>.context-editor.json` sidecar; Desktop/RPC may keep writing
host-native CustomEntry events. Neither path replaces Tool Output or registers
a context hook, so the model receives the same messages before and after a
visual edit.

This is an independent community project. It is not affiliated with, endorsed
by or sponsored by DeepSeek, Pi, or their maintainers.

## Product roadmap

The next stages are intentionally separated from the visual editor already
available:

1. Adapt the main conversation timeline and add more Agent hosts where their
   extension APIs allow it.
2. Add reversible context exclusion so a user can manually remove selected
   messages from future model input without destroying the stored Session.
3. Add AI-assisted session cleanup: analyze a whole conversation, propose what
   to keep or exclude, and summarize a selected range or the full session.
4. Allow an approved summary to replace the original range in the visible
   conversation, the model-context projection, or both, while keeping the
   source recoverable and every change undoable.

These context-removal, AI-condensation, and summary-replacement capabilities
are planned work; they are not included in the current release.

## Install

### Pi extension

Download `pi-context-editor-0.4.0-alpha.1.tgz` from the
[release assets](https://github.com/jermaine123123/agent-context-editor/releases),
then install it with the Pi package manager:

```sh
pi install ./pi-context-editor-0.4.0-alpha.1.tgz
```

For Pi Desktop registration, run `adapters/pi-extension/scripts/install-desktop.ps1`
with PowerShell. The script auto-discovers Pi and accepts `-PiPath` and
`-DesktopExePath` when an installation is non-standard. Fully restart Pi
Desktop before entering `/ctx`.

### DeepSeek Harness

Download `context-editor-deepseek-harness-0.1.1.tgz` and install it into a
Harness profile using the official CLI:

```sh
dsh plugin --profile <profile> add ./context-editor-deepseek-harness-0.1.1.tgz
```

The adapter targets Harness Developer Preview commit
`47f943859bef60e4160492346772ded9b24f765a0` and CLI `@deepseek-ai/dsh@0.1.0-rc.6`.
See [COMPATIBILITY.md](adapters/deepseek-harness/COMPATIBILITY.md) for the
tested host boundary.

## Language behavior

The Context Editor follows the host language automatically. Chinese locales
(`zh-*`) use the Chinese UI; all other system/browser locales use English.
Pi Context Desktop follows its existing app language setting when one is
available, and otherwise uses the system locale. Pi TUI, Pi's native `/ctx`
dialogs and the DeepSeek Harness view resolve the locale when they open. This
only translates editor controls and status messages; session content is never
translated.

## Support matrix

| Capability | Pi extension 0.4.0-alpha.1 | DeepSeek Harness 0.1.1 | Pi Context Desktop 0.1.4 |
| --- | ---: | ---: | ---: |
| Inspect user / AI / tool records | Yes | Yes | Yes |
| Filter user / AI / tool records | Yes | Yes | Yes |
| Search and occurrence counts | Yes | Yes | Yes |
| Independent reasoning / answer units | Yes | Yes | Yes |
| Hide / restore / reset | Yes | Yes | Yes |
| Undo and revision conflict handling | TUI: V2 sidecar; Desktop/RPC: V1 reset | V2 sidecar | V2 sidecar |
| Session log preserved | Yes | Yes | Yes |
| Context exclusion from model input | No | No | No |
| Token reduction | No (visual-only) | No | No |
| AI full-session condensation | No | No | No |
| AI selected-range summary | No | No | No |
| Summary replacement | No | No | No |
| Automatic zh/en UI | Yes | Yes | Yes |

## Repository layout

```text
agent-context-editor/
├─ adapters/
│  ├─ pi-extension/          Pi /ctx adapter 0.4.0-alpha.1
│  └─ deepseek-harness/      DeepSeek Harness adapter 0.1.1
├─ packages/
│  └─ context-editor-core/   host-neutral TypeScript Core and tests
├─ docs/                     architecture, compatibility and security notes
├─ assets/                   sanitized demo frames and social preview
├─ scripts/                  build, pack and release checks
├─ test/                     adapter regression tests
├─ README.md                 English project home
├─ README.zh-CN.md           Chinese project guide
├─ CONTRIBUTING.md
└─ SECURITY.md
```

`pi-app/` is intentionally excluded from this repository. It remains a
separate Git repository and fork so its upstream history, Electron sources and
large build outputs do not become a dependency of the adapters.

## Development

Requirements: Node.js 22.19+ (Node 24 is used by the recorded acceptance
run) and npm.

```sh
npm ci
npm run verify
```

`npm run verify` regenerates the Pi adapter's vendored Core and bundled
`dist/index.js`, type-checks the Pi adapter and Core, runs all unit and adapter
fixtures, rebuilds the DeepSeek Core/client artifacts, and checks both npm
tarballs for unexpected files. Generated Core copies and bundles must not be
edited directly.

## Known limits

The alpha release does not rewrite the active conversation, remove items from
model context, compress tokens, generate AI summaries, replace original content
with a summary, replace Tool Output, or support additional Agent hosts. Hiding
is strictly a Context Editor view operation; it is not a model-context control.

Please report reproducible host compatibility issues with the relevant host
version, adapter version and sanitized logs. Do not attach session logs that
contain prompts, secrets or personal data.

## License

MIT. See [LICENSE](LICENSE).
