# Release checklist

1. Run `npm run verify` from a clean working tree.
2. Run `npm run release:assets` and inspect `release/v0.1.0-alpha.1`.
3. Verify every line in `SHA256SUMS.txt` locally before uploading.
4. Create the annotated tag `v0.1.0-alpha.1` and the GitHub Release only after
   CI is green.
5. For the separate Pi App fork, use `npm run release:desktop-assets -- --desktop`
   or the equivalent script from the root workspace, then upload only the
   Setup, Portable and checksum assets to the `context-editor-v0.1.4` Release.

The first release is GitHub-only. Do not publish npm packages or mass-post to
forums from automation. Share the release notes manually and disclose the
community, unsigned and Windows-only limitations of the desktop build.
