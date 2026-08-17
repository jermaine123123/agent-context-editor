# Context Editor Core

Host-neutral context records and view-state replay for Pi Context Desktop.

This package deliberately has no React, Electron, Pi Desktop Store, or Worker
imports. Adapters turn a host session into `ContextAtom[]`; the Pi adapter lives
in `src/worker/context-editor-pi.ts`. The package is kept inside the app tree so
it can later be used by a CLI/TUI/OpenCode/Codex adapter without a local
`file:..` dependency or symlink.
