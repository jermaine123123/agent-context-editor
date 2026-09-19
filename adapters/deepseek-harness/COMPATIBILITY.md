# DeepSeek Harness compatibility and acceptance

The current candidate is **0.4.10**. The added target is official npm **0.1.5-rc.1**, with all DSH component versions pinned in its installation lockfile. Existing alpha.1 source commit `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` retains regression coverage. Neither host requires source changes. This does not certify rc.2 or alpha.2. No scheduled version scan is added.

0.4.10 fixes a further case missed by 0.4.9: mid-turn injected messages split the UI record adjacency while the grouped answer continues across later tools. Checkpoints now close over active Surface positions plus turn/call identities, expose intervening inputs in the confirmation, and use the same closure for stale-draft validation. Tests exercise both answer-only and answer-plus-thought selection with interleaved plugin input and multiple tool steps.

0.4.9 adds the previously missing selective answer/thought checkpoint case: the Surface path expands to complete turns/tool chains before generation and displays the additional source units before Apply. It checks Surface continuity before the model call and again during commit. This does not enable arbitrary block deletion or change the legacy projection path.

## 0.4.8 rc.1 scope

The standard Surface/request path does not require custom message-projection registration. The reader adapts standalone `deriveEventMessage` plus `replaceGeneration` to the same effective-context behavior as the newer Surface methods. Existing seeded sessions use the restore contract introduced in 0.4.7, preserving the exact inherited prefix.

The published-host fixture uses only installed rc.1 runtime packages, actual packed plugin files, synthetic data and local fixed HTTP. It exercises edits, exclusion, model selection, restart, titles, checkpoint/native compaction, repeated branch recovery, interrupted commits and mixed Chat Completions messages. rc.1's official DeepSeek adapter does not implement the newer Messages protocol; signed-thinking Messages acceptance remains scoped to alpha.1. Final archive hashes and results live in the delivery evidence, not in the interface-only self-test.

## Existing 0.4.6+ alpha.1 acceptance scope

The candidate suite covers actual panel editing/exclusion/restoration and checkpoint recovery, normal model selection, packed-plugin HTTP requests, original-event preservation, known signed reasoning, closed tool pairs, image text, default native compaction, restart, four process interruption points, stale competing edits, and 0.4.5 profile read/restore. A 100,000-event synthetic history checks paging, incremental append, search, and a subsequent real Agent request. Local fixed HTTP responses are used; external-model smoke is recorded separately and is not implied by these checks.

`HostHistoryView` uses the official incremental Surface engine and all registered projections when that contract is available; older contracts retain detached Session replay. `HistoryIndex` normalizes appended events and updates affected records. Unchanged pages reuse the same durable projection. Context fingerprints still hash effective messages; they do not claim constant time with respect to the effective request size.

Capabilities are operation-specific. Known signed thoughts remain unchanged; answer bodies can be edited. Unknown replay contracts fail explicitly for affected operations. Image text editing preserves the attachment and its host projection; image-containing condensation is not enabled. Only default inherited-route native compaction is in scope. Independent third-party repackaging of original messages is not certified.

Model selection is resolved to a persisted Context Editor Provider selection, preventing a pending ordinary selection from bypassing the profile on restart. Restoration records an explicit released state when replay permits it. Profile format 1 remains immutable and readable; new writes use format 2. Missing/unknown/corrupt configurations are never silently migrated.

Runtime checks remain `interface-recognized`, not automatic persistence certification. Exact candidate SHA-256, runtime build fingerprint, test outputs, remaining limitations and installation status belong to the accompanying release evidence. Historical claims below apply only to their stated older artifacts.

## Historical 0.4.5 request-profile repair

The plugin registers a Provider and persists immutable transformation profiles in `context_editor_requests`. Known `request/header` events select those profiles. Original session events, roles, and message IDs are preserved. Full plain-text messages may be removed from downstream requests; edited Assistant messages remain Assistant messages. A changed message's old replay payload is omitted from the forwarded copy. Signed/reasoning/tool/image messages cannot be selected for these edits.

| Path | Evidence on local alpha.1 source host |
| --- | --- |
| Packed plugin, Web RPC, Assistant edit and User exclusion | Passed with the official Provider and captured local HTTP request after process restart |
| Restore and second restart | Passed through Web RPC and captured HTTP requests |
| Plugin absent | Saved Web model route rejects the request; zero HTTP requests in the fixture |
| Default native compaction | Real Agent/official Provider fixture consumes edited context; persistent recovery branch resumes with the earlier edits and exclusion |
| Checkpoint condensation | Real Agent fixture generates from effective text, preserves only the checkpoint in subsequent requests, and restores the exact pre-checkpoint profile through a branch after restart |
| Failure/idempotency | Unit coverage for pending-only, append-before-result, identical retries, mismatched ID reuse, stale source, duplicate IDs, and corrupt profiles; full process-kill fault matrix remains outstanding |

Use `scripts/accept-deepseek-request-web.mjs` with an isolated temporary home containing the installed archive, a profile name, and the local pnpm JS entry. It launches the supported `pnpm dsh --profile ...` command, uses synthetic sessions, restores its manifest, and stops its test processes. `scripts/accept-deepseek-request-transform.mjs <host-root>` runs independent real-Agent processes; set `CE_PLUGIN_ROOT` to the installed candidate directory to test its exact runtime code. Set `CE_PROBE_STAGE` to `write,native,native-restart,recover,recovered` or `write,condense,condense-restart,checkpoint-recover,recovered` for compaction checks.

The tested host is the source checkout at `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`, not an official release archive. The temporary profile installs the actual plugin archive but obtains zod 4.4.3 from the local dependency directory, so this is not a clean online installation test. No external-model smoke or browser-driven panel interaction was run. The separate evidence report records the final archive SHA-256 and code fingerprint.

Limitations: default BasicCompactionEngine with inherited session model only; no custom summarization Provider or policies. Raw host Surface/token estimates are unchanged. The stored plugin route is required even after edits are restored; model switching and generated session titles are restricted. Disabling the plugin and explicitly choosing a different model can bypass the saved route and expose original history. Other plugins that independently repackage original history are outside this request-profile guarantee. Missing or corrupt profile data fails explicitly. Back up and retain both session logs and plugin storage together.

Runtime contract checks stay marked `interface-recognized`; they do not promote themselves to persistence or HTTP acceptance. `pluginBuildFingerprint` identifies the actual runtime files independently of the package version.

## Recorded 0.4.3 acceptance on official alpha.2

| Feature | alpha.2 status | Evidence and limit |
| --- | --- | --- |
| History, search, and paging | Implemented | The client requests snapshot metadata plus one page, loads more on demand, and uses indexed `getRecord` lookup when search navigates to an unloaded item, marking the skipped history gap. It falls back to paging with older hosts. The host reads history through async pages, caches it, and reads only an appended tail after the first scan. A 100,000-event host benchmark is still outstanding. |
| Hide, restore, and undo in the editor view | Available | Stored as view state; this does not change model context. Covered by project regression checks. |
| Replace one plain-text User message | Available for this scope | The packed-plugin test verifies persistence, a clean host restart, operation-status reconstruction from durable history, a normal Session Agent request sent through the official Provider adapter to a local fixed-response server, and restore after restart. Structured User content is not covered. |
| Exclude/remove a context message | Unsupported | alpha.2 retains an empty User message on the model Surface. The commit RPC returns an explicit unsupported error; the acceptance test confirms the session log is unchanged. |
| Replace an Assistant message | Unsupported | Direct Assistant Surface replacement fails alpha.2 source-reference validation. The commit RPC rejects it; the acceptance test confirms no session-log write. |
| Multi-message condensation | Implemented as a User checkpoint | The supported path replaces contiguous complete plain-text turns with a standard User checkpoint and keeps the original events. The packed-plugin acceptance captures the condensation request through the official Provider adapter, verifies the durable checkpoint after replay, preserves an unselected prefix, and creates a recovery branch from the exact pre-checkpoint prefix. The exercised fixture selects two complete User/Assistant turns; tool-chain selections need additional acceptance. |
| Recovery after native compaction | Plugin RPC and UI path integrated | The test runs alpha.2's official compaction engine, writes and replays its checkpoint, then verifies a persistent recovery branch after restart. Browser-driven panel navigation and continuing a model request in that branch are not yet covered. |

## Evidence levels

The **Recheck host capabilities** action is a synthetic in-memory contract check. It does not write a session, read user data, use a provider credential, or prove persistence. The report keeps interface recognition separate from plugin integration and acceptance evidence; in particular, `persistenceTested` remains false for that self-test.

The packed-host acceptance installs the actual `.tgz` artifact into an isolated alpha.2 profile and uses synthetic sessions plus a local fixed-response HTTP service. It verifies durable replay, actual Session Agent request construction for the User edit, provider request capture for condensation, and recovery branch storage. It is not a real-model smoke test: no external model call or user credential is used.

## Repeat the alpha.2 acceptance

```powershell
$env:DSH_HOST_ROOT = '<path-to-official-alpha.2-installation>'
$env:DSH_EXPECTED_HOST_VERSION = '0.1.6-alpha.2'
$env:DSH_PLUGIN_TARBALL = '<path-to-context-editor-deepseek-harness-tarball>'
node scripts/accept-deepseek-harness-alpha2.mjs
npm test -- test/deepseek-harness-alpha2.test.ts
```

The script rejects a host package whose version differs from the requested exact version. It starts only that host release; it does not download or test other Harness versions. CI maintains one locked alpha.2 host job.

The exact-package acceptance covers startup and RPC loading, metadata-only snapshots, record pages and indexed single-record lookup, User edit persistence, operation-status recovery after restart, idempotent retry, a normal fixed-provider Agent request, restore across restart, explicit no-write rejection for exclusion and Assistant replacement, checkpoint condensation, and condensation/native-compaction recovery branches. The separate contract test covers alpha.2 replay behavior, projection boundaries, tool-call identity, and official compaction APIs.

On 2026-09-18, the final 0.4.3 candidate passed the exact-package alpha.2 acceptance. Its SHA-256 and the command output are recorded in `release/deepseek-alpha2-candidate-2026-09-18/ACCEPTANCE.md` in the workspace; that evidence file is kept outside the plugin archive so the archive hash is stable.

## Local alpha.1 source-checkout probe

The user-selected `D:\deepseek-harness` checkout reports root version `0.1.6-alpha.1` at commit `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720`. This is a source build, not the official alpha.1 release package. The 0.4.3 plugin was copied into an isolated profile after package-manager resolution stalled on `zod`; this run does not count as a clean installation test.

The earlier 0.4.3 isolated run verified a plain-text User edit and restore across restarts, a complete-turn checkpoint through a local fixed-response Provider request, and native-compaction recovery branch contents after restart. The 0.4.4 startup probe loaded the candidate and called `getCompatibility` and `runCompatibilityCheck`: the host reported `0.1.6-alpha.1`, the plugin reported `0.4.4`, both blocked features stayed disabled with version-independent reasons, and the synthetic checks reproduced empty User retention and Assistant source-reference rejection. Context exclusion and Assistant replacement therefore still have no durable or actual-request acceptance. No external-model smoke or browser-driven panel regression was run.

The 0.4.4 source fixes the version-independent diagnostic reasons and admits the tested alpha.1 prerelease component versions in package peer ranges. Its feature status remains pending. The archive checksum is recorded outside the package so repacking the documentation does not change the documented checksum.

The plugin runtime dependency on `zod` is pinned to `4.4.3`, matching the alpha.1 workspace and its ESM entry. This prevents profile refresh from selecting an incompatible copy that makes the bundle fail during import.

## Remaining acceptance work

- Exercise the panel's load-more and search-to-unloaded-record behavior in the host UI.
- Benchmark a synthetic history of at least 100,000 events and verify incremental tail reads.
- Inject process interruption before host append, after append, after flush, and before operation-result return; verify operation reconciliation after restart.
- Browser-test the panel's local operation recovery and paused-write message after a dropped response.
- Verify recovery branch navigation and a subsequent request through that branch in the actual client.
- Run one external-model smoke only when a separate synthetic-session credential is available; otherwise report it as not run.
