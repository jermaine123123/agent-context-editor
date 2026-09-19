# Context Editor for DeepSeek Harness

Context Editor adds a searchable view for the current Harness session. Each open view keeps its own search, selection, and summary draft. Views of the same session share committed edits and refresh after a write.

## 0.4.10: interrupted-turn checkpoint selection

Checkpoint ranges follow active Surface order and close over complete turn/tool identities. A plugin or user message inserted during a long AI turn no longer stops discovery of the remaining tool results. Intervening messages appear in the expanded-source confirmation, with a scrollable list for long tool chains. Generation and commit use the same closure algorithm; old incomplete drafts must be regenerated.

## 0.4.9: answer/thought checkpoint selection

Checkpoint previews close selected answers/thoughts over their complete turn and tool chain before calling the summary model. Extra units are listed in the dialog and confirmed by Apply. This fixes the late non-contiguous Surface error when the displayed answer/thought spans tool steps; unselected neighboring turns remain intact. Legacy projection selection behavior is unchanged.

## 0.4.8: official 0.1.5-rc.1 adapter

The standard Surface/request adapter also supports the official 0.1.5-rc.1 package set. Optional message-projection registration is no longer a prerequisite for the standard-event path. The history reader handles both the older standalone message projection/replace generation and the newer Surface instance API. Actual contracts select the path; version numbers are diagnostic.

The rc.1 target uses its official Chat Completions adapter. User/Assistant edits, exclusion, complete-turn checkpoints, restart, native compaction and recovery branches are exercised with local fixed responses. Known reasoning, closed tool groups and image text are tested with that protocol; this is not acceptance of Messages signed-thinking support on rc.1. Existing alpha.1 receives separate regression coverage. P4 remains deferred.

## Everyday use and mixed messages

The existing layout is retained. Technical status lives under **More → Diagnostics**, repeated limitations are collapsed, and recovery explains the new branch at confirmation. The panel owns its scroll area so host resize handles cannot cover its buttons.

The request adapter supports User text, Assistant answer text with unchanged known signed reasoning, complete tool pairs, and the text of image-bearing User messages. Image attachments stay intact; visual condensation is excluded. Checkpoint condensation and native-compaction recovery retain their branch semantics. Editing a thought or unknown replay format directly remains restricted.

Normal model selection preserves committed changes. Recognized official title requests are rebuilt from effective input. Fully excluded or unknown title input sends no model request; the title provider may report an auxiliary no-output result, without failing the chat. After full restoration, the route is released only when there is no remaining replay dependency. Explicitly choosing another Provider with the plugin absent is still outside plugin control.

New immutable request profiles use format 2; format 1 from 0.4.5 is still read without rewriting it. Keep session logs and both plugin storage domains together. Never downgrade an active format-2 session to 0.4.5. Roll back using a complete pre-upgrade profile backup in a separate directory.

Windows targets and evidence scopes are recorded in [COMPATIBILITY.md](./COMPATIBILITY.md). `scripts/accept-deepseek-current.ps1` retains the pinned alpha.1 regression; the published-host runner additionally verifies the explicitly requested rc.1 package set. These isolated runs capture official Provider requests and exercise restarts and fault recovery. Automatic isolation checks (P4) remain deferred.

## Historical 0.4.5 repair scope on alpha.1

The plugin now implements whole plain-text User/Assistant exclusion and text replacement through a registered **Context Editor Provider**, without modifying Harness. It keeps the original messages and roles in the session log. An ordinary persisted model selection references an immutable plugin profile; requests forwarded to the original Provider contain the edited messages. Restore selects another persisted profile.

The candidate has passed isolated packed-plugin Web RPC checks for Assistant replacement, User exclusion, process restart, actual official-Provider HTTP requests, restore, and a second restart. Separate real-Agent tests cover default native compaction, complete-turn checkpoint condensation, and recovery branches retaining the pre-compaction edits. Responses are local fixed fixtures, not external model outputs. See [COMPATIBILITY.md](./COMPATIBILITY.md) for the precise evidence boundary.

This first repair supports complete **plain-text messages only**. A message containing reasoning, tool calls, images, or signed blocks is not editable through this path. Unselected structured messages remain unchanged. Default native compaction must inherit the session model; custom compaction Providers/policies are unsupported. The host's raw Surface and token estimate still describe the original messages; the transformed downstream request is the behavior being verified.

Keep the plugin and its `context_editor_requests` storage installed while these sessions are in use. In the tested Web restore flow, disabling the plugin causes the stored Context Editor model route to reject requests instead of sending original context. Explicitly selecting another Provider while the plugin is absent is outside that protection. The profile route remains necessary even after restoring edits, and model switching plus automatic title generation are limited in this candidate. Do not remove the storage domain or downgrade to 0.4.4 while continuing a session that references these profiles. Back up the complete profile before upgrading; to roll back, keep the new profile intact and use a separate profile containing the pre-upgrade backup.

## Recorded 0.4.3 scope on alpha.2

The historical acceptance below used the official `@deepseek-ai/dsh@0.1.6-alpha.2` prerelease and plugin 0.4.3. It does not certify 0.4.5 on alpha.2. The adapter selects behavior from detected contracts; the version string is diagnostic and does not enable a capability by itself.

- History, search, and record paging are available. The client loads an initial page, offers a load-more action, and retrieves an unloaded search result by indexed single-record lookup while marking the skipped history gap. It keeps sequential paging as a fallback for older hosts.
- Hide, restore, and undo change the Context Editor view state. They do not remove content from model context.
- A single plain-text User message can be edited, restored, or undone. The plugin appends a standard Surface replacement, waits for persistence, and reads the durable session back before reporting success. The alpha.2 acceptance also captures a normal Agent request after the edit.
- `getOperation` can reconstruct the User edit's commit status from the plugin operation record and the durable Surface event after a disconnect or host restart.
- Before an edit, restore, or undo write, the panel saves only the operation ID and target in session-scoped local storage. On reopen it queries `getOperation`; verified results are cleared, pending writes can reuse the same operation ID, and unverified results pause further context writes.
- In 0.4.3, context exclusion and Assistant replacement were disabled because the tested Surface projection path could not persist them. This did not establish that every pure-plugin approach was impossible; 0.4.5 uses the different Provider path described above.
- Multi-message condensation uses a standard User checkpoint to replace contiguous complete plain-text turns. Original events remain in the log. Restore creates a new branch at the exact pre-checkpoint boundary; later messages stay in the original session.
- The native-compaction recovery action creates a branch from a verified pre-compaction boundary. The original session remains available.

The currently exercised condensation fixture selects two complete User/Assistant turns, preserves an earlier unselected turn, and verifies the exact-prefix recovery branch. Tool-chain selections still need acceptance. The exact package test covers recovery RPCs and persisted branch contents; browser-driven navigation and continuing an Agent request on a recovery branch remain outstanding.

## Compatibility report

The **Recheck host capabilities** control runs a synthetic in-memory contract check. It does not touch user conversations or credentials, and it does not prove persistence. Only operations that have an implemented adapter path are exposed. Unsupported exclusion and Assistant replacement cannot become enabled just because a future host happens to expose a matching method.

The packed alpha.2 acceptance uses synthetic sessions and a local fixed-response Provider endpoint. It verifies the actual User edit in a normal Agent request, plus durable checkpoint and recovery behavior. No external-model call has been made; a real-model smoke remains unrun unless a separate synthetic-session credential is supplied.

## Build and install

From the repository root:

```powershell
npm run build:deepseek
npm run build:client
New-Item -ItemType Directory -Force .\release | Out-Null
npm pack --workspace adapters/deepseek-harness --pack-destination .\release
```

Install the generated `context-editor-deepseek-harness-0.4.5.tgz` into a disposable profile for host acceptance:

```powershell
$env:DSH_HOME = '<isolated-harness-home>'
& '<harness-root>\node_modules\.bin\dsh.cmd' plugin --profile <profile> add '<absolute-path-to-tarball>'
```

## Architecture and history loading

The shared Core owns search, selection rules, summary validation, and view state. The Harness adapter owns Session discovery, async history reads, Surface writes, persistence checks, recovery branches, and client view registration.

New clients request snapshot metadata without an embedded record list and fetch records through `listRecords`. Older clients that omit `includeRecords: false` keep receiving the complete snapshot. Search retrieves a distant matched record through indexed `getRecord` and leaves the intervening history unloaded; older host pairings can fall back to sequential pages. The host currently builds its session projection from the cached event history; it reads the initial log in pages and fetches only a new tail after that cache is established. A 100,000-event host benchmark remains to be run.

Session history stays append-only. A successful User edit or checkpoint is reported as applied only after persistence readback matches the effective model projection. View-state operations are stored separately and are not described as model-context writes.

## Verification

Run project checks with `npm run verify`. The following is the historical 0.4.3 alpha.2 acceptance command; its direct-Surface assumptions do not certify the 0.4.5 Provider path. For 0.4.5 use the request-profile scripts in [COMPATIBILITY.md](./COMPATIBILITY.md).

```powershell
npm run verify
$env:DSH_HOST_ROOT = '<path-to-official-alpha.2-installation>'
$env:DSH_EXPECTED_HOST_VERSION = '0.1.6-alpha.2'
$env:DSH_PLUGIN_TARBALL = (Resolve-Path .\release\context-editor-deepseek-harness-0.4.3.tgz).Path
node .\scripts\accept-deepseek-harness-alpha2.mjs
npm test -- test/deepseek-harness-alpha2.test.ts
```

The host script installs the exact packed artifact in an isolated profile, rejects a different host version, tests metadata-only snapshots, record pages, indexed single-record lookup, starts the packaged panel/RPC host, captures the official Session Agent's request through a local fixed-response Provider, and verifies edit, restore, condensation, and recovery behavior across process restarts. It also verifies that unsupported exclusion and Assistant replacement do not alter the source session. It does not contact an external model or test other Harness releases.

The remaining acceptance list and evidence levels are in [COMPATIBILITY.md](./COMPATIBILITY.md).
