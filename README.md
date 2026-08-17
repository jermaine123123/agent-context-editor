# Agent Context Editor

Cross-agent context inspection and view-state controls for coding agents.

The project currently ships two adapters:

| Adapter | Package / app | Stable scope |
| --- | --- | --- |
| Pi extension | `pi-context-editor@0.3.0` | `/ctx` in Pi TUI and Pi Desktop; shared unit editor with visual-only state |
| DeepSeek Harness | `context-editor-deepseek-harness@0.1.1` | Context Editor tab with independent reasoning/answer units |
| Pi Context Desktop | `jermaine123123/pi-app` `context-editor-v0.1.4` | Windows x64 community desktop build |

中文说明：[README.zh-CN.md](README.zh-CN.md)

## What it does

The DeepSeek Harness adapter reads the durable Session event log and projects
user, AI and tool records into a separate Context Editor view. Reasoning and
answer blocks in one AI turn are independent editable units: you can search,
select, hide, restore and persist either unit without hiding the other. Hide,
restore, reset and undo events are stored in a `context_editor` sidecar.

The original Harness Session log and model input are not rewritten. Hiding is a
view operation in this release and does not reduce model token usage. The Pi
extension uses the same Record/Unit Core in its TUI; the Desktop/RPC path keeps
the established Tool Output safety behavior. Pi TUI view events and
preferences are stored in an atomic `<sessionFile>.context-editor.json`
sidecar.

This is an independent community project. It is not affiliated with, endorsed
by or sponsored by DeepSeek, Pi, or their maintainers.

## Install

### Pi extension

Download `pi-context-editor-0.3.0.tgz` from the
[v0.1.0-alpha.1 release](https://github.com/jermaine123123/agent-context-editor/releases/tag/v0.1.0-alpha.1),
then install it with the Pi package manager:

```sh
pi install ./pi-context-editor-0.3.0.tgz
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

## Support matrix

| Capability | Pi extension 0.3.0 | DeepSeek Harness 0.1.1 | Pi Context Desktop 0.1.4 |
| --- | ---: | ---: | ---: |
| Inspect user / AI / tool records | Yes | Yes | Yes |
| Search and occurrence counts | Yes | Yes | Yes |
| Independent reasoning / answer units | Yes | Yes | Yes |
| Hide / restore / reset | Yes | Yes | Yes |
| Undo and revision conflict handling | V2 sidecar | V2 sidecar | V2 sidecar |
| Session log preserved | Yes | Yes | Yes |
| Context exclusion from model input | No | No | No |
| Token reduction | Tool Output replacement only | No | No |

## Repository layout

```text
agent-context-editor/
├─ adapters/
│  ├─ pi-extension/          Pi /ctx adapter 0.3.0
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

## Known limits and roadmap

The alpha release deliberately does not rewrite the active conversation, remove
items from model context, compress tokens, replace arbitrary Tool Output in
Harness, or add more hosts. Next steps are a real context-exclusion contract,
additional host adapters, signed desktop distributions and a broader fixture
suite.

Please report reproducible host compatibility issues with the relevant host
version, adapter version and sanitized logs. Do not attach session logs that
contain prompts, secrets or personal data.

## License

MIT. See [LICENSE](LICENSE).
