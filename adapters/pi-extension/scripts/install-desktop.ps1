[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [string]$PiPath,
  [string]$DesktopExePath
)

$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $packageRoot 'package.json'
$adapterSource = Join-Path $packageRoot 'desktop\pi-context-editor.adapter.json'
$settingsPath = Join-Path $env:USERPROFILE '.pi\agent\settings.json'
$adapterDirectory = Join-Path $env:USERPROFILE '.pi\desktop\adapters'
$adapterTarget = Join-Path $adapterDirectory 'pi-context-editor.adapter.json'
function Get-PiCommandPath {
  param([string]$ExplicitPath)
  if ($ExplicitPath) {
    if (-not (Test-Path -LiteralPath $ExplicitPath)) { throw "Pi CLI was not found at $ExplicitPath." }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }
  $command = Get-Command pi -ErrorAction SilentlyContinue
  if ($command -and $command.Source) { return $command.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Pi\pi.ps1'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Pi\pi.ps1'),
    (Join-Path $env:USERPROFILE '.local\bin\pi.ps1'),
    (Join-Path $env:USERPROFILE 'bin\pi.ps1')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  if ($candidates.Count -gt 0) { return (Resolve-Path -LiteralPath $candidates[0]).Path }
  throw 'Pi CLI was not found. Install Pi CLI or pass -PiPath <path>.'
}

function Find-PiDesktopPath {
  param([string]$ExplicitPath)
  if ($ExplicitPath) { return $ExplicitPath }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Pi Desktop\Pi Desktop.exe'),
    (Join-Path $env:LOCALAPPDATA 'Pi Desktop\Pi Desktop.exe'),
    (Join-Path $env:ProgramFiles 'Pi Desktop\Pi Desktop.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
  return $candidates | Select-Object -First 1
}

function Resolve-InstalledPackage {
  if (-not (Test-Path -LiteralPath $settingsPath)) { return $false }
  $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  $packages = @($settings.packages)
  $resolvedRoot = (Resolve-Path -LiteralPath $packageRoot).Path
  foreach ($package in $packages) {
    $source = if ($package -is [string]) { [string]$package } else { [string]$package.source }
    if (-not $source) { continue }
    try {
      if ((Resolve-Path -LiteralPath $source -ErrorAction Stop).Path -eq $resolvedRoot) {
        return $true
      }
    } catch {
      if ($source -eq $packageRoot) { return $true }
    }
  }
  return $false
}

function Assert-Adapter {
  if (-not (Test-Path -LiteralPath $adapterTarget)) { return $false }
  $adapter = Get-Content -LiteralPath $adapterTarget -Raw | ConvertFrom-Json
  $matchPropertyName = 'm' + 'atch'
  $matchObject = $adapter | Select-Object -ExpandProperty $matchPropertyName
  $commands = @($matchObject.commands)
  return (($adapter.id -eq 'pi-context-editor') -and ($commands -contains '/ctx'))
}

if (-not (Test-Path -LiteralPath $packageJsonPath)) {
  throw ('package.json missing: {0}' -f $packageJsonPath)
}
if (-not (Test-Path -LiteralPath $adapterSource)) {
  throw ('Pi Desktop adapter missing: {0}' -f $adapterSource)
}

$piPath = Get-PiCommandPath -ExplicitPath $PiPath
$piVersion = ((& $piPath --version | Select-Object -Last 1).ToString()).Trim()
$desktopExe = Find-PiDesktopPath -ExplicitPath $DesktopExePath

if ($CheckOnly) {
  Write-Host ('Pi CLI: {0} ({1})' -f $piPath, $piVersion)
  Write-Host ('Package registered: {0}' -f (Resolve-InstalledPackage))
  Write-Host ('Adapter installed: {0}' -f (Assert-Adapter))
  if ($desktopExe -and (Test-Path -LiteralPath $desktopExe)) {
    $version = (Get-Item -LiteralPath $desktopExe).VersionInfo.ProductVersion
    Write-Host ('Pi Desktop: {0} ({1})' -f $desktopExe, $version)
  } else {
    Write-Host 'Pi Desktop not found automatically; pass -DesktopExePath to check it.'
  }
  if (-not (Resolve-InstalledPackage)) { exit 2 }
  if (-not (Assert-Adapter)) { exit 3 }
  exit 0
}

New-Item -ItemType Directory -Path $adapterDirectory -Force | Out-Null
if (Test-Path -LiteralPath $adapterTarget) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupTarget = '{0}.{1}.bak' -f $adapterTarget, $stamp
  Copy-Item -LiteralPath $adapterTarget -Destination $backupTarget -Force
}
Copy-Item -LiteralPath $adapterSource -Destination $adapterTarget -Force

# Register the local package through Pi so Pi owns the settings format.
& $piPath install $packageRoot
if ($LASTEXITCODE -ne 0) {
  throw ('Pi package installation failed with exit code {0}.' -f $LASTEXITCODE)
}

if (-not (Resolve-InstalledPackage)) {
  throw 'Pi install completed but settings.json does not contain this package.'
}
if (-not (Assert-Adapter)) {
  throw ('Adapter validation failed: {0}' -f $adapterTarget)
}

$scriptPath = $MyInvocation.MyCommand.Path
Write-Host 'Installation complete. Fully quit and reopen Pi Desktop, then enter /ctx.'
Write-Host ('Diagnostic command: powershell -ExecutionPolicy Bypass -File {0} -CheckOnly' -f $scriptPath)
