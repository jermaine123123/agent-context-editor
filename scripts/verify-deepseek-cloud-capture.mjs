// Re-evaluate retained request evidence without consuming another model call.
// An Assistant can quote the original User marker; assert only the edited User role.
import assert from 'node:assert/strict'
import {readFile,writeFile,copyFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {verifyCandidate} from './deepseek-acceptance-artifact.mjs'
const root=resolve(process.argv[2]??'.compat-desktop-026')
const candidate=await verifyCandidate(process.argv[3]??'release/context-editor-deepseek-harness-0.6.0.tgz',join(root,'home/profiles/desktop/node_modules/context-editor-deepseek-harness'))
const path=join(root,'home/cloud-evidence.json')
const raw=JSON.parse(await readFile(path,'utf8'))
assert.equal(raw.archiveSha256,candidate.archiveSha256)
const budget=JSON.parse(await readFile(join(root,'cloud-budget.json'),'utf8'))
assert.ok(budget.attempts<=8)
const edit=raw.outcomes.find(value=>value.action==='edit-user')
assert.equal(edit.commit.commit.status,'persisted-and-verified')
// This archived assertion was reached after the script stopped/restarted the
// official host, sent AFTER_RESTART and waited for the Agent to finish.
const messages=JSON.parse(edit.error)
assert.ok(Array.isArray(messages))
const users=messages.filter(value=>value.role==='user')
assert.ok(JSON.stringify(users).includes('EDITED_TEXT'))
assert.ok(JSON.stringify(users).includes('AFTER_RESTART_edit-user'))
assert.ok(!JSON.stringify(users).includes('WEB_ORIGINAL_USER'))
assert.ok(messages.some(value=>value.role==='assistant'))
assert.ok(budget.requests.every(value=>value.httpStatus===200&&value.completed))
await copyFile(path,join(root,'cloud-original-assertion-evidence.json'))
await writeFile(join(root,'cloud-captured-messages.json'),JSON.stringify(messages,null,2))
const reviewed={...candidate,passed:true,externalModel:true,scope:'user-edit-save-restart-normal-request',
  cumulativeAttempts:budget.attempts,limit:8,historicalUnacceptedAttempts:budget.historicalAttempts,
  finalArtifactHttp200Completed:budget.requests.length,
  correctedAssertion:'Original User marker echoed by the unchanged Assistant is allowed; the edited User role contains only EDITED_TEXT.',
  sourceEvidence:'cloud-original-assertion-evidence.json',capturedMessages:'cloud-captured-messages.json',reverificationUsesNetwork:false}
await writeFile(join(root,'cloud-reviewed-evidence.json'),JSON.stringify(reviewed,null,2))
console.log(JSON.stringify(reviewed))
