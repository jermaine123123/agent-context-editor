# Context Editor for DeepSeek Harness

Agent Context Editor adds a searchable, hideable, and reversible management
view for long DeepSeek Harness conversations while preserving the original
Session. Long-running Coding Agent sessions accumulate reasoning, older
answers, and tool output; this adapter keeps those records available while
providing search, type filters, batch selection, hide, restore, and undo in a
separate view.

This adapter targets the official DeepSeek Harness Developer Preview commit
`141eb6fef83422698aef7a981029e843e8161534` and installs as one bundle. The
package adds a `Context Editor` tab beside the normal `Chat` view for the same
Session; it never creates a second conversation.

Version `0.2.0` targets Harness rc.8 and adds native same-Session context projection. The hierarchical AI filters and centered search navigation remain supported; reasoning and answer units can still be searched, selected, hidden, restored and persisted separately. Visual hiding remains in the `context_editor` sidecar, while context exclusion appends one durable `context/projection` event and changes only the model-derived message history. The original Surface events and normal chat display remain unchanged.

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
dsh plugin --profile <profile> add ./context-editor-deepseek-harness-0.2.0.tgz
```

On Windows, `dsh` may not be on `PATH` even when Harness is installed.  Use
the profile's bundled launcher explicitly from PowerShell:

```powershell
$env:DSH_HOME = '<harness-root>\.dsh'
& '<harness-root>\node_modules\.bin\dsh.cmd' plugin --profile web add '<package-path>\context-editor-deepseek-harness-0.2.0.tgz'
```

On Windows, if either the repository path or Harness path contains spaces and
the CLI reports `ENOENT` for a truncated `editor\adapters\...` path, first
copy the tarball to a path without spaces (for example
`D:\context-editor-deepseek-harness-0.2.0.tgz`) and pass that path to the same
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
independent.
The native path is enabled with `contextExclusion: true`.  The complete rc.8
Host/Browser/provider acceptance matrix, request-capture regressions, and a
real DeepSeek smoke request have passed.  Keep this adapter on the pinned rc.8
commit; older rc.6 readers do not understand `context/projection`.

The generated `core-runtime.js` is bundled from the canonical Core sources in
`packages/context-editor-core`. Rebuild it after changing Core and run the root
verification command before publishing.
