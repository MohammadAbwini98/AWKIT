<#
.SYNOPSIS
  DEVELOPMENT MACHINE: build the portable package and export what the NVIDIA machine needs for the
  awkit-djnl.15 GPU checks. The release signing key never leaves this machine.

.DESCRIPTION
  Packaging signs the dependency manifest here, with the key in
  %LOCALAPPDATA%\SpecterStudio\release-keys. The export holds only signed, non-secret output, so it may
  travel by any route (network share, OneDrive, cloud drive):

    payload\dist\win-unpacked\                  the packaged app the packaged GPU checks run
    payload\build\native-hosts\                 the staged AI host the source GPU checks run
    payload\resources\dependency-manifest.json  the manifest signed for exactly this package
    payload\resources\dependency-manifest.sig
    SHA256SUMS.txt, transfer-record.json        so the NVIDIA machine can prove nothing changed in transit

  The script refuses to run on a checkout with uncommitted tracked changes, so restoring the committed
  manifest pair afterwards can never discard your work.

  Run from Windows PowerShell 5.1 (the blue one, not PowerShell 7) in the AWKIT checkout:

    powershell -ExecutionPolicy Bypass -File scripts\nvidia-qualification\export-package-for-nvidia.ps1

  Then copy the printed .zip to the NVIDIA machine and run import-package-on-nvidia.ps1 there.

.PARAMETER OutDir
  Where the export is written. Defaults to %USERPROFILE%\awkit-xfer-<commit>.

.PARAMETER SkipPull
  Package the current HEAD without pulling origin/main first.

.PARAMETER NoZip
  Leave the export as a folder instead of also writing a .zip next to it.
#>
param(
  [string]$OutDir,
  [switch]$SkipPull,
  [switch]$NoZip
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step([string]$text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Fail([string]$text) { Write-Host "FAIL: $text" -ForegroundColor Red; throw $text }

# Get-FileHash is deliberately not used: it is missing when Windows PowerShell inherits a PowerShell 7
# module path, which is exactly how prepare:offline failed on the NVIDIA machine.
function Get-Sha256([string]$path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($path)
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $root
$manifestPair = @("resources/dependency-manifest.json", "resources/dependency-manifest.sig")
$trees = @("dist\win-unpacked", "build\native-hosts")

Step "Git"
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") { Fail "this checkout is on '$branch', not main." }
$dirty = @(git status --porcelain --untracked-files=no)
if ($dirty.Count -gt 0) {
  Fail ("tracked files have uncommitted changes. Commit them first; the package must be built from a clean commit:`n" + ($dirty -join "`n"))
}
if (-not $SkipPull) {
  git pull --ff-only origin main
  if ($LASTEXITCODE -ne 0) { Fail "git pull --ff-only origin main exited $LASTEXITCODE." }
}
$commit = (git rev-parse HEAD).Trim()
Write-Host "HEAD $commit"

Step "Prerequisites"
$keyPath = if ($env:AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY) { $env:AWKIT_OFFLINE_MANIFEST_PRIVATE_KEY } else { Join-Path $env:LOCALAPPDATA "SpecterStudio\release-keys\offline-manifest-private.pem" }
if (-not (Test-Path -LiteralPath $keyPath -PathType Leaf)) {
  Fail "the release signing key is not at %LOCALAPPDATA%\SpecterStudio\release-keys. Run this as the Windows account that holds it."
}
Write-Host "signing key present (this script never reads or copies it)"
if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules\electron\dist\electron.exe"))) {
  Fail "node_modules is incomplete (electron.exe is missing). Run npm ci first."
}
if ([string]::IsNullOrWhiteSpace($OutDir)) { $OutDir = Join-Path $env:USERPROFILE ("awkit-xfer-" + $commit.Substring(0, 8)) }
$OutDir = [System.IO.Path]::GetFullPath($OutDir)
$zipPath = "$OutDir.zip"
if (Test-Path -LiteralPath $OutDir) { Fail "$OutDir already exists. Move or delete it, or pass -OutDir." }
if (-not $NoZip -and (Test-Path -LiteralPath $zipPath)) { Fail "$zipPath already exists. Move or delete it, or pass -OutDir." }

try {
  Step "npm run package:portable (signs the manifest on this machine)"
  npm run package:portable
  if ($LASTEXITCODE -ne 0) { Fail "package:portable exited $LASTEXITCODE." }
  foreach ($item in $trees + $manifestPair) {
    if (-not (Test-Path -LiteralPath (Join-Path $root $item))) { Fail "$item was not produced by package:portable." }
  }

  Step "Export to $OutDir"
  $payload = Join-Path $OutDir "payload"
  foreach ($tree in $trees) {
    robocopy (Join-Path $root $tree) (Join-Path $payload $tree) /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy $tree exited $LASTEXITCODE." }
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $payload "resources") | Out-Null
  foreach ($file in $manifestPair) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $payload $file) -Force
  }

  Write-Host "hashing the export ..."
  $sums = New-Object System.Collections.Generic.List[string]
  $bytes = [long]0
  foreach ($file in Get-ChildItem -LiteralPath $payload -Recurse -File -Force) {
    $relative = $file.FullName.Substring($payload.Length + 1).Replace("\", "/")
    $sums.Add((Get-Sha256 $file.FullName) + "  " + $relative)
    $bytes += $file.Length
  }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines((Join-Path $OutDir "SHA256SUMS.txt"), $sums, $utf8)
  $record = [ordered]@{
    purpose = "awkit-djnl.15 NVIDIA qualification: package built and signed on the development machine, GPU checks run on the NVIDIA machine"
    commit = $commit
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    node = (node --version).Trim()
    files = $sums.Count
    bytes = $bytes
    dependencyManifestSha256 = Get-Sha256 (Join-Path $payload "resources\dependency-manifest.json")
    dependencyManifestSigSha256 = Get-Sha256 (Join-Path $payload "resources\dependency-manifest.sig")
  }
  [System.IO.File]::WriteAllText((Join-Path $OutDir "transfer-record.json"), ($record | ConvertTo-Json -Depth 4), $utf8)
  Write-Host ("{0} files, {1:N0} MB" -f $sums.Count, ($bytes / 1MB))
} finally {
  # Packaging re-signed the tracked pair; the committed pair is the release record. Safe to restore:
  # the clean-tree check above proved there was no uncommitted work in these files.
  Step "Restore the committed manifest pair"
  git restore -- $manifestPair
  if ($LASTEXITCODE -ne 0) { Write-Host "WARNING: git restore failed; restore resources/dependency-manifest.json and .sig yourself." -ForegroundColor Yellow }
}

if (-not $NoZip) {
  Step "Zip"
  if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
    Write-Host "tar.exe is not available; copy the folder $OutDir instead." -ForegroundColor Yellow
  } else {
    tar.exe -a -c -f $zipPath -C $OutDir payload SHA256SUMS.txt transfer-record.json
    if ($LASTEXITCODE -ne 0) { Fail "tar exited $LASTEXITCODE while writing $zipPath." }
    Write-Host ("{0} ({1:N0} MB)" -f $zipPath, ((Get-Item -LiteralPath $zipPath).Length / 1MB))
  }
}

Write-Host ""
Write-Host "DONE. Copy the export to the NVIDIA machine and run there:" -ForegroundColor Green
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\nvidia-qualification\import-package-on-nvidia.ps1 -TransferPath <path to the .zip or folder>"
