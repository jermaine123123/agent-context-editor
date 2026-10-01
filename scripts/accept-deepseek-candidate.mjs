import { spawnSync } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { join } from 'node:path'
import {verifyCandidate} from './deepseek-acceptance-artifact.mjs'
const [hostRoot, archive, output] = process.argv.slice(2)
if (!hostRoot || !archive || !output || !process.env.CE_PLUGIN_ROOT) throw new Error('Pass host root, candidate archive, output JSON and set CE_PLUGIN_ROOT to the installed candidate.')
const candidate=await verifyCandidate(archive,process.env.CE_PLUGIN_ROOT)
const groups = [
  ...(process.env.CE_DESKTOP_RUNTIME ? [['auto-tool-repair', 'write', { CE_PROBE_AUTO_TOOL: '1' }]] : []),
  ...(process.env.CE_DESKTOP_RUNTIME ? [['missing-config', 'write,missing-config']] : []),
  ['plain', 'write,restart,absent,restore,restored'],
  ['title', 'write,title,restore,restored'],
  ['concurrency', 'write,concurrency'],
  ['large', 'write,large'],
  ['native', 'write,native,native-restart,recover,recovered'],
  ['checkpoint', 'write,condense,condense-restart,checkpoint-recover,recovered'],
  ['continued-recovery-branch', 'write,condense,checkpoint-recover,branch-condense,branch-condense-restart,branch-recover,recovered,branch-condense,branch-condense-restart'],
  ...['pending', 'appended', 'flushed', 'result'].map(point => ['fault-' + point, `write,fault-${point},fault-recover`]),
  ['mixed', 'write,restart,restore,restored', { CE_PROBE_MIXED: '1' }],
  ['failed-tool', 'write,restart,restore,restored', { CE_PROBE_MIXED: '1', CE_PROBE_TOOL_FAIL: '1', CE_PROBE_NO_IMAGE: '1' }],
  ['structured-checkpoint', 'write,condense,condense-restart', { CE_PROBE_MIXED: '1', CE_PROBE_NO_IMAGE: '1' }],
  ['answer-reasoning-checkpoint', 'write,condense,condense-restart,condense-recover,condense-recovered', { CE_PROBE_MIXED: '1', CE_PROBE_NO_IMAGE: '1', CE_PROBE_AI_SELECTION: '1' }],
  ...['both', 'answer'].map(selection => ['interleaved-' + selection, 'write,condense,condense-restart,condense-recover,condense-recovered', { CE_PROBE_MIXED: '1', CE_PROBE_NO_IMAGE: '1', CE_PROBE_AI_SELECTION: '1', CE_PROBE_INTERLEAVED: '1', ...(selection === 'answer' ? { CE_PROBE_ANSWER_ONLY: '1' } : {}) }]),
  ['individual-restore', 'write,restore-A,restart-A,edit-restored,recondense,restore-B,restart-B', { CE_PROBE_INDEPENDENT: '1' }],
  ['individual-covered', 'write,cover', { CE_PROBE_INDEPENDENT: '1' }],
  ['individual-native-after-restore', 'write,restore-A,cover-restored', { CE_PROBE_INDEPENDENT: '1' }],
  ...['pending', 'appended', 'flushed', 'result'].map(point => ['individual-fault-' + point, `write,fault-${point},fault-recover,restart-A`, { CE_PROBE_INDEPENDENT: '1' }]),
  ['individual-mixed', 'write,condense,inline-restore,inline-restart', { CE_PROBE_MIXED: '1', CE_PROBE_NO_IMAGE: '1', CE_PROBE_AI_SELECTION: '1', CE_PROBE_INTERLEAVED: '1' }],
]
const identity = process.env.CE_DESKTOP_RUNTIME
  ? { ...JSON.parse(await readFile(join(dirname(process.env.CE_DESKTOP_RUNTIME),'../identity.json'),'utf8')), runtime: process.env.CE_DESKTOP_RUNTIME }
  : process.env.CE_PUBLISHED_HOST
  ? { hostVersion: JSON.parse(await readFile(join(hostRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version, packageLockSha256: createHash('sha256').update(await readFile(join(hostRoot, 'package-lock.json'))).digest('hex') }
  : { hostCommit: '0d1f50007f9bca3f52b06e1c3074fa14d5fb0720' }
const report = { testedAt: new Date().toISOString(), ...candidate, ...identity, externalModel: false, groups: [] }
for (const [name, stages, extras] of groups) {
  if (process.env.CE_PROBE_GROUPS && !process.env.CE_PROBE_GROUPS.split(',').includes(name)) continue
  const env = { ...process.env }
  for (const key of ['CE_PROBE_ROOT', 'CE_PROBE_MIXED', 'CE_PROBE_NO_IMAGE', 'CE_PROBE_AI_SELECTION', 'CE_PROBE_INTERLEAVED', 'CE_PROBE_ANSWER_ONLY', 'CE_PROBE_INDEPENDENT', 'CE_PROBE_TOOL_FAIL', 'CE_PROBE_AUTO_TOOL', 'CE_PROBE_MIGRATED', 'CE_PROBE_SESSION_ID']) delete env[key]
  Object.assign(env, extras, { CE_PROBE_STAGE: stages })
  const result = spawnSync(process.execPath, ['scripts/accept-deepseek-request-transform.mjs', hostRoot], { env, encoding: 'utf8', timeout: 240000, windowsHide: true })
  const entries = result.stdout.split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line))
  report.groups.push({ name, passed: result.status === 0, entries })
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ group: name, passed: result.status === 0 }))
  if (result.status !== 0) { process.stderr.write(result.stderr); process.stderr.write(result.stdout); process.exitCode = 1; break }
}
