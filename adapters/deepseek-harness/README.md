# Context Editor for DeepSeek Harness

This is the first cross-agent adapter for Context Editor.  It targets the
official DeepSeek Harness Developer Preview commit
`47f943859bef60e4160492346772ded9b24f765a0` and installs as one bundle.  The
package adds a `Context Editor` tab beside the normal `Chat` view for the same
Session; it never creates a second conversation.

Version `0.1.1` supports independent `reasoning` and `answer` units: each can
be searched, selected, hidden, restored and persisted separately. The original
Harness Session log and model input are not rewritten. View state is kept in
the `context_editor` storage-domain sidecar, and hiding currently does not
reduce token usage.

## Install the tarball

From this directory, create the package and install the resulting file into a
Harness profile:

```sh
node ./scripts/build-core.mjs
node ./scripts/build-client.mjs
npm pack --ignore-scripts
dsh plugin --profile <profile> add ./context-editor-deepseek-harness-0.1.1.tgz
```

On Windows, `dsh` may not be on `PATH` even when Harness is installed.  Use
the profile's bundled launcher explicitly from PowerShell:

```powershell
$env:DSH_HOME = '<harness-root>\.dsh'
& '<harness-root>\node_modules\.bin\dsh.cmd' plugin --profile web add '<package-path>\context-editor-deepseek-harness-0.1.1.tgz'
```

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
`createdAt`/`cwd`.  Session event logs and model input are never rewritten.

## Current scope

Search, literal match counts, navigation, filters, placeholders, selection,
Shift-selection, persistence and CAS/revision handling are included.  While a
Session is running the Host remains readable/searchable, while mutations are
rejected until the settled log can be projected again.  Context exclusion,
Tool Output replacement, summaries, token budgets and request rewriting are
deliberately deferred to the next phase.

The generated `core-runtime.js` is bundled from the canonical Core sources in
`packages/context-editor-core`. Rebuild it after changing Core and run the root
verification command before publishing.
