import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { rolldown } from "rolldown"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const input = resolve(root, "adapters/pi-extension/src/index.ts")
const output = resolve(root, "adapters/pi-extension/dist/index.js")
const coreFiles = [
  "packages/context-editor-core/src/types.ts",
  "packages/context-editor-core/src/projection.ts",
  "packages/context-editor-core/src/fingerprint.ts",
  "packages/context-editor-core/src/records.ts",
  "packages/context-editor-core/src/search.ts",
  "packages/context-editor-core/src/state.ts",
  "packages/context-editor-core/src/service.ts",
  "packages/context-editor-core/src/prefs.ts",
  "packages/context-editor-core/src/protocol.ts",
]
const digest = createHash("sha256")
for (const file of coreFiles) digest.update(await readFile(resolve(root, file)))

const bundle = await rolldown({
  input,
  external: [
    /^node:/,
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ],
})
const generated = await bundle.generate({ format: "esm", exports: "default", sourcemap: false })
await bundle.close()
const chunk = generated.output.find((item) => item.type === "chunk")
if (!chunk || chunk.type !== "chunk") throw new Error("Pi extension build produced no JavaScript chunk")

await mkdir(dirname(output), { recursive: true })
await writeFile(output, [
  "/* GENERATED FILE - rebuild with npm run build:pi. */",
  `/* Canonical Core source digest: ${digest.digest("hex")} */`,
  chunk.code.trim(),
  "",
].join("\n"), "utf8")
console.log(`Built ${output}`)
