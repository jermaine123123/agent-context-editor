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

The editor resolves its UI language automatically. Chinese (`zh-*`) hosts use
Chinese labels; other hosts use English labels. TUI and native `/ctx` dialogs
resolve the system locale when the command opens. Conversation content is
displayed as-is and is never translated.

This adapter is one part of the cross-agent project. See the repository root
README for the support matrix and current limitations.
