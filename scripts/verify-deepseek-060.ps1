param(
  [string]$Root = '.compat-desktop-026',
  [string]$Version = '0.2.0-rc.2',
  [string]$Archive = 'release/context-editor-deepseek-harness-0.6.0.tgz',
  [string]$Extractor,
  [string]$LegacyHarness,
  [string]$Playwright,
  [switch]$OfflinePrepare,
  [switch]$DesktopWindow,
  [switch]$CloudSmoke
)
$ErrorActionPreference = 'Stop'
$taskRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Root)
$taskArchive = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Archive)
Remove-Item Env:CE_CLOUD_SMOKE,Env:CE_DESKTOP_WINDOW,Env:CE_PANEL,Env:CE_PANEL_INDIVIDUAL,Env:CE_PUBLISHED_HOST -ErrorAction SilentlyContinue
function Invoke-CheckedNode {
  param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Arguments)
  & node @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Verification failed: $($Arguments[0]) ($LASTEXITCODE)" }
}
if ($OfflinePrepare) { $env:CE_PREPARE_OFFLINE = '1' } else { Remove-Item Env:CE_PREPARE_OFFLINE -ErrorAction SilentlyContinue }
if ($Extractor) { $env:CE_7ZIP = $Extractor }
Invoke-CheckedNode scripts/prepare-deepseek-desktop.mjs $Version $taskRoot
$env:CE_INSTALL_ONLINE='1'
$env:CE_DESKTOP_HOME=Join-Path $taskRoot 'home'
Invoke-CheckedNode scripts/install-deepseek-desktop-candidate.mjs $taskRoot $taskArchive
$env:CE_DESKTOP_RUNTIME=Join-Path $taskRoot 'desktop/DeepSeek Harness.exe'
$env:CE_PLUGIN_ROOT=Join-Path $taskRoot 'home/profiles/desktop/node_modules/context-editor-deepseek-harness'
Remove-Item Env:CE_PROBE_GROUPS -ErrorAction SilentlyContinue
Invoke-CheckedNode scripts/accept-deepseek-candidate.mjs (Join-Path $taskRoot 'desktop/resources/app.asar/dsh') $taskArchive (Join-Path $taskRoot 'candidate-acceptance.json')
Invoke-CheckedNode scripts/verify-deepseek-v4-contract.mjs $taskRoot $taskArchive
Invoke-CheckedNode scripts/verify-deepseek-optional-contract.mjs $taskRoot $taskArchive
Invoke-CheckedNode scripts/scan-sensitive.mjs $env:CE_PLUGIN_ROOT
Remove-Item Env:CE_DESKTOP_RUNTIME -ErrorAction SilentlyContinue
if ($LegacyHarness) {
  $taskLegacyVersion=(Get-Content -LiteralPath (Join-Path $LegacyHarness 'node_modules/@deepseek-ai/dsh/package.json') -Raw | ConvertFrom-Json).version
  if($taskLegacyVersion -ne '0.1.5-rc.1'){throw 'Legacy regression requires official 0.1.5-rc.1'}
  $taskLegacyCandidate=Join-Path $taskRoot 'legacy-candidate'
  New-Item -ItemType Directory -Force -Path $taskLegacyCandidate | Out-Null
  & tar -xzf $taskArchive -C $taskLegacyCandidate
  if ($LASTEXITCODE -ne 0) { throw 'Legacy candidate extraction failed' }
  $env:CE_PUBLISHED_HOST='1'
  $env:CE_PLUGIN_ROOT=Join-Path $taskLegacyCandidate 'package'
  Invoke-CheckedNode scripts/accept-deepseek-candidate.mjs $LegacyHarness $taskArchive (Join-Path $taskRoot 'legacy-acceptance.json')
  Remove-Item Env:CE_PUBLISHED_HOST -ErrorAction SilentlyContinue
}
if ($DesktopWindow) {
  if (!$Playwright) { throw 'Pass an installed Playwright module path with -Playwright' }
  $env:CE_PLAYWRIGHT_ENTRY=$Playwright
  $env:CE_DESKTOP_HOME=Join-Path $taskRoot 'home-ui'
  Invoke-CheckedNode scripts/install-deepseek-desktop-candidate.mjs $taskRoot $taskArchive
  $env:CE_DESKTOP_WINDOW='1'
  $env:CE_PANEL='1'
  $env:CE_PANEL_INDIVIDUAL='1'
  $env:CE_DESKTOP_ACTIONS='edit-user,model'
  Invoke-CheckedNode scripts/accept-deepseek-desktop.mjs $taskRoot $taskArchive
  Remove-Item Env:CE_DESKTOP_WINDOW,Env:CE_PANEL,Env:CE_PANEL_INDIVIDUAL -ErrorAction SilentlyContinue
}
if ($CloudSmoke) {
  # The persistent ledger includes earlier attempts and refuses requests after eight.
  $env:CE_DESKTOP_HOME=Join-Path $taskRoot 'home'
  $taskBudget=Join-Path $taskRoot 'cloud-budget.json'
  if(Test-Path -LiteralPath $taskBudget){
    $taskBudgetState=Get-Content -LiteralPath $taskBudget -Raw | ConvertFrom-Json
    if(($taskBudgetState.limit-$taskBudgetState.attempts)-lt 3){throw 'Insufficient remaining cloud budget for a new smoke; use retained evidence for offline review.'}
  }
  $env:CE_CLOUD_SMOKE='1'
  $env:CE_DESKTOP_ACTIONS='edit-user'
  Invoke-CheckedNode scripts/accept-deepseek-desktop.mjs $taskRoot $taskArchive
  Remove-Item Env:CE_CLOUD_SMOKE -ErrorAction SilentlyContinue
}
