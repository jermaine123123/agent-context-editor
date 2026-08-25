# Pi Context Editor

`pi-context-editor` adds the `/ctx` command to Pi TUI and Pi Desktop. It
provides a full-screen, keyboard-first context editor with shared
record/unit projection, search, independent reasoning/answer visibility,
batch selection, restore and undo.

Pi `0.84.2` installs a local package directory, not a `.tgz` archive. Extract
the published tarball so `package.json` is at the package directory root, or
install `adapters/pi-extension` directly from this repository. Then restart Pi
before using `/ctx`. The TUI stores V2 hide/restore/undo events and
preferences in an atomic `<sessionFile>.context-editor.json` sidecar. Pi TUI
model-context exclude/restore events use the independent
`<sessionFile>.context-editor.projection.json` sidecar. The Desktop/RPC path
reads and preserves legacy V1 visual CustomEntry state for compatibility.
Projection changes never rewrite the original session messages or replace Tool
Output; they affect only the next provider payload.

This release does not filter Pi's main chat timeline or generate summary
replacements. In Pi TUI, press `x` to preview and confirm model-context
exclusion/restoration; the confirmation stays inside `/ctx` (`Enter`/`y` to
confirm, `Esc`/`n` to cancel); visual `h`/`r` operations remain independent.

Search defaults to User messages and AI final answers. Press `s` outside the
search input to temporarily include reasoning and Tool Call/Output content;
the scope is reset to dialogue when `/ctx` is reopened and is never written to
the sidecar or preferences. The User/AI/Tool type filters still apply.

In the TUI, `Enter` is a temporary expand/collapse action, while `h` and `r`
write reversible hide/restore events. Search selects the first occurrence,
centers and highlights it, and `n`/`N` cycles through occurrences. Hidden
matches remain protected until the user toggles hidden-content display with
`v`.

The editor resolves its UI language automatically. Chinese (`zh-*`) hosts use
Chinese labels; other hosts use English labels. TUI and native `/ctx` dialogs
resolve the system locale when the command opens. Conversation content is
displayed as-is and is never translated.

This adapter is one part of the cross-agent project. See the repository root
README for the support matrix and current limitations.
