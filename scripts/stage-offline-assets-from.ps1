<#
.SYNOPSIS
  Copies already-prepared offline assets (bundled Chromium, vendor tree, Oracle bridge) from an
  existing AWKIT checkout into this one.

.DESCRIPTION
  Phase 0C support script. `npm run prepare:offline` downloads Chromium; when another checkout on
  the same machine has already staged those assets, this copies them locally instead — no network,
  no re-download. Used to give an isolated spike worktree production-parity offline assets.

  Robocopy exit codes are BITMASKS, not conventional status codes: 0-7 are success variants
  (1 = files copied, 2 = extra files, 4 = mismatched files) and only 8+ indicates a genuine
  failure. Treating any non-zero value as an error makes every successful copy look broken, which
  is exactly what happened when this was first run inline.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/stage-offline-assets-from.ps1 -SourceRoot C:\path\to\AWKIT
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot
)

$ErrorActionPreference = "Stop"

$destRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceRoot = Resolve-Path $SourceRoot

if ($sourceRoot.Path -eq $destRoot.Path) {
  throw "SourceRoot and destination are the same checkout ($destRoot)."
}

# Only these three trees are offline-prep outputs; nothing else is copied between checkouts.
$assets = @("resources\browsers", "vendor", "resources\oracle-jdbc")

foreach ($asset in $assets) {
  $from = Join-Path $sourceRoot $asset
  $to = Join-Path $destRoot $asset

  if (-not (Test-Path $from)) {
    Write-Warning "Source asset not present, skipping: $asset"
    continue
  }

  Write-Host "Staging $asset ..."
  New-Item -ItemType Directory -Force -Path (Split-Path $to) | Out-Null

  robocopy $from $to /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  $code = $LASTEXITCODE

  # 0-7 = success (bit 0 files copied, bit 1 extra files, bit 2 mismatched); 8+ = failure.
  if ($code -ge 8) {
    throw "Robocopy failed for '$asset' with exit code $code."
  }

  $measure = Get-ChildItem $to -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
  "  {0}: {1:N0} files, {2:N1} MB (robocopy code {3})" -f $asset, $measure.Count, ($measure.Sum / 1MB), $code | Write-Host
}

# $LASTEXITCODE still holds robocopy's bitmask here; clear it so callers chaining on exit status
# do not mistake a successful staging run for a failure.
$global:LASTEXITCODE = 0

$chromium = Join-Path $destRoot "resources\browsers\chromium\chrome.exe"
if (Test-Path $chromium) {
  Write-Host "Offline assets staged. Bundled Chromium present."
} else {
  throw "Staging completed but bundled Chromium is missing: $chromium"
}
