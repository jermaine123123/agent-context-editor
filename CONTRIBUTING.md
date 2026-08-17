# Contributing

Contributions are welcome, especially host compatibility reports and adapter
fixtures.

## Before opening a pull request

1. Run `npm ci` and `npm run verify` from the repository root.
2. If Core behavior changes, rebuild the DeepSeek artifacts and include the
   resulting generated files.
3. Add or update a fixture for reasoning/answer unit behavior, record-level
   selectors, fingerprints or revision conflicts as appropriate.
4. Scan the diff for absolute paths, tokens, session content and generated
   binaries.

Keep host-specific code inside `adapters/<host>`. Do not change the original
Session log format or silently broaden a peer-version range. Please use the
issue templates for bugs, host compatibility requests and new adapter ideas.
