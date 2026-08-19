# Pi Context Editor

`pi-context-editor` adds the `/ctx` command to Pi TUI and Pi Desktop. It
provides a full-screen, keyboard-first context editor with shared
record/unit projection, search, independent reasoning/answer visibility,
batch selection, restore and undo.

Install the published tarball with Pi's package manager, then restart Pi
before using `/ctx`. The TUI stores V2 hide/restore/undo events and
preferences in an atomic `<sessionFile>.context-editor.json` sidecar. The
Desktop/RPC path reads and preserves legacy V1 visual CustomEntry state for
compatibility. Neither path rewrites the original session messages, replaces
Tool Output, or changes model input.

This release does not exclude context, replace Tool Output, or filter Pi's
main chat timeline.

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
