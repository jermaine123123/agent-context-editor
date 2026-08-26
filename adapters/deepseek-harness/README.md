# Context Editor for DeepSeek Harness

Agent Context Editor first provides two model-context controls: exclude selected
units from subsequent provider input, and manually edit eligible plain-text User
or complete unsigned Answer units with restore, undo and original-text
comparison. It also adds a searchable, hideable, and reversible management view
while preserving the original Session. Reasoning, older answers, and tool output
remain available through search, filters, selection, hide, restore, and undo in
the separate Context Editor tab.

This adapter targets the official DeepSeek Harness Developer Preview commit
`141eb6fef83422698aef7a981029e843e8161534` and installs as one bundle. The
package adds a `Context Editor` tab beside the normal `Chat` view for the same
Session; it never creates a second conversation.

Version `0.3.0` targets Harness rc.8 and adds the migrated User/Answer replacement path. Plain-text User messages and complete unsigned Answers expose a multiline editor; replacement, restore, and per-unit LIFO undo events are persisted in the `context_editor` sidecar and materialized as matching native `context/projection` events. The original Surface nodes and history remain unchanged. Reasoning, Tool, structured User content, signed Answers, and batch replacement remain unsupported.

The replacement path is enabled in the stable package for the tested rc.8
boundary. Automated Core/Host fixtures, isolated package installation, local
provider-payload composition, and rc.8 web profile startup checks passed. The
Harness host itself remains a Developer Preview; later Harness commits require
a fresh acceptance run.

The browser view resolves `navigator.languages` when it opens: `zh-*` locales
use Chinese labels and all other locales use English. Only editor controls and
status messages are translated; Session content remains unchanged.

Search defaults to User messages and AI final answers. Use the scope button
beside the search box to temporarily include reasoning, Tool Call and Tool
Output atoms. The scope is window-local and is not written to localStorage or
the `context_editor` sidecar; User/AI/Tool type filters remain the upper bound.

## Install the tarball

From this directory, create the package and install the resulting file into a
Harness profile:

```sh
node ./scripts/build-core.mjs
node ./scripts/build-client.mjs
npm pack --ignore-scripts
dsh plugin --profile <profile> add ./context-editor-deepseek-harness-0.3.0.tgz
```

On Windows, `dsh` may not be on `PATH` even when Harness is installed.  Use
the profile's bundled launcher explicitly from PowerShell:

```powershell
$env:DSH_HOME = '<harness-root>\.dsh'
& '<harness-root>\node_modules\.bin\dsh.cmd' plugin --profile web add '<package-path>\context-editor-deepseek-harness-0.3.0.tgz'
```

On Windows, if either the repository path or Harness path contains spaces and
the CLI reports `ENOENT` for a truncated `editor\adapters\...` path, first
copy the tarball to a path without spaces (for example
`D:\context-editor-deepseek-harness-0.3.0.tgz`) and pass that path to the same
command. The package itself remains installed in the selected Harness profile.

If the launcher reports that `pnpm` is missing, add the Harness-provided pnpm
directory to `PATH` for that PowerShell process, or install pnpm before running
the official `dsh plugin` command.  For a same-version replacement, remove the
existing package from the profile before adding the new tarball so pnpm does
not retain an old hard-linked copy.

The supported acceptance command is the official `dsh plugin --profile
<profile> add <package>` flow.  During local iteration, a profile may instead
use the package's `cordis.patch.yml` through the Harness `--patch` option.

## Host boundary

The Host reads complete persisted Session history and projects:

- `user/message` → `user`;
- reasoning and answer blocks from one turn → one `ai` record with separate
  `#reasoning` and `#answer` editable units;
- `tool/call` + `tool/result` by `callId` → one `tool` record.

Stream chunks, system/request headers, summaries and compaction events do not
become editable records in this phase.  Reasoning and answer units can be
selected and hidden independently; old record-level view events remain
compatible. Hide/restore/reset/undo events are
stored in the `context_editor` storage-domain sidecar, fenced by Session
`createdAt`/`cwd`. Session event logs remain append-only; model requests use the projected history.

## Current scope

Search (dialogue scope by default, with temporary full-scope toggle), literal
match counts, navigation, filters, placeholders, selection,
Shift-selection, persistence and CAS/revision handling are included.  While a
Session is running the Host remains readable/searchable, while mutations are
rejected until the settled log can be projected again. Native context exclusion
previews closure expansion and token deltas, rechecks the rc.8 revision in Agent
maintenance, appends one atomic `context/projection` event, and flushes before
success. Compressed or inactive roots are unavailable; visual hiding remains
independent. Replacement uses the same canonical-message composer as exclusion,
so the provider order is always original text → replacement → exclusion
(exclusion wins). Search and preview use `effectiveText`; restoring an exclusion
later reveals the edited text. The native path is enabled with
`contextExclusion: true` and `contextReplacement: true` for eligible
User/Answer units. Keep this adapter on the pinned rc.8 commit; older rc.6
readers do not understand `context/projection`.

The generated `core-runtime.js` is bundled from the canonical Core sources in
`packages/context-editor-core`. Rebuild it after changing Core and run the root
verification command before publishing.
