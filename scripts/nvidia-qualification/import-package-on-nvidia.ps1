<#
.SYNOPSIS
  NVIDIA MACHINE: install the package exported by export-package-for-nvidia.ps1 so the awkit-djnl.15
  GPU checks can run here without the release signing key or Visual Studio.

.DESCRIPTION
  1. Reads the export (.zip or folder) and moves this checkout to the commit it was built at.
  2. Verifies every file against SHA256SUMS.txt. One changed or missing file fails the import.
  3. Mirrors dist\win-unpacked and build\native-hosts into this checkout and copies in the signed
     manifest pair. Both trees are generated output; anything else in them is replaced.
  4. Runs npm ci when Electron is missing, with a portable Node 22 first on PATH when present. Node
     18.16.0 cannot run node-llama-cpp's install script (docs/NVIDIA_QUALIFICATION_SETUP.md).

  Run from Windows PowerShell 5.1 (the blue one, not PowerShell 7) in C:\src\AWKIT:

    powershell -ExecutionPolicy Bypass -File scripts\nvidia-qualification\import-package-on-nvidia.ps1 -TransferPath <path to the .zip or folder>

  After the GPU checks, put the committed manifest pair back:
    git restore resources/dependency-manifest.json resources/dependency-manifest.sig

.PARAMETER TransferPath
  The .zip or the export folder written by export-package-for-nvidia.ps1.

.PARAMETER NodeDir
  Folder holding a Node 22 node.exe for npm ci. Skipped with a warning if it does not exist.

.PARAMETER SkipNpmCi
  Do not run npm ci even when Electron is missing.
#>
param(
  [Parameter(Mandatory = $true)][string]$TransferPath,
  [string]$NodeDir = "C:\src\tools\node-v22.23.3-win-x64",
  [switch]$SkipNpmCi
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Step([string]$text) { Write-Host ""; Write-Host "== $text" -ForegroundColor Cyan }
function Fail([string]$text) { Write-Host "FAIL: $text" -ForegroundColor Red; throw $text }

# Not Get-FileHash: it is missing when Windows PowerShell inherits a PowerShell 7 module path.
function Get-Sha256([string]$path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($path)
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace("-", "").ToLowerInvariant() }
  finally { $stream.Dispose(); $sha.Dispose() }
}

# Windows PowerShell's file cmdlets fail on paths over 260 characters; robocopy does not. Empty the
# tree with a mirror of an empty folder, then remove what is left, which is now shallow.
function Remove-Tree([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $empty = Join-Path ([System.IO.Path]::GetTempPath()) ("awkit-empty-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Path $empty | Out-Null
  robocopy $empty $path /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  Remove-Item -LiteralPath $path -Recurse -Force
  Remove-Item -LiteralPath $empty -Force
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $root
$source = (Resolve-Path -LiteralPath $TransferPath).Path
$extract = $null

# The first version extracted under %TEMP%, whose long prefix pushed the deepest package files past
# 260 characters, and then could not delete them either. Remove those leftovers (about 1 GB each).
Get-ChildItem -LiteralPath ([System.IO.Path]::GetTempPath()) -Directory -Filter "awkit-xfer-*" |
  Where-Object { $_.Name -match '^awkit-xfer-[0-9a-f]{32}$' } |
  ForEach-Object { Write-Host "removing leftover $($_.FullName)"; Remove-Tree $_.FullName }

try {
  Step "Read the export"
  if ((Get-Item -LiteralPath $source).PSIsContainer) {
    $bundle = $source
  } else {
    # Extract next to the checkout (C:\src\awkit-xfer-xxxxxxxx), a short prefix that keeps every
    # package path under 260 characters, which %TEMP% does not.
    $extract = Join-Path (Split-Path $root -Parent) ("awkit-xfer-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
    New-Item -ItemType Directory -Path $extract | Out-Null
    Write-Host "extracting $source ..."
    tar.exe -x -f $source -C $extract
    if ($LASTEXITCODE -ne 0) { Fail "could not extract $source (tar exited $LASTEXITCODE)." }
    $bundle = $extract
  }
  $recordPath = Join-Path $bundle "transfer-record.json"
  $sumsPath = Join-Path $bundle "SHA256SUMS.txt"
  $payload = Join-Path $bundle "payload"
  foreach ($path in @($recordPath, $sumsPath, $payload)) {
    if (-not (Test-Path -LiteralPath $path)) { Fail "$path is missing. This is not an export from export-package-for-nvidia.ps1." }
  }
  $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
  Write-Host "built at commit $($record.commit), $($record.createdAt), $($record.files) files"

  Step "Git: match the package's commit"
  git merge-base --is-ancestor $record.commit HEAD
  if ($LASTEXITCODE -ne 0) {
    git pull --ff-only origin main
    if ($LASTEXITCODE -ne 0) { Fail "git pull --ff-only origin main exited $LASTEXITCODE." }
    git merge-base --is-ancestor $record.commit HEAD
    if ($LASTEXITCODE -ne 0) { Fail "this checkout does not contain the package's commit $($record.commit)." }
  }
  $head = (git rev-parse HEAD).Trim()
  # Later commits are accepted only when they touch nothing but these transfer scripts, so the source
  # the GPU checks run is the source the package was built from.
  $outside = @(git diff --name-only $record.commit HEAD | Where-Object { -not $_.StartsWith("scripts/nvidia-qualification/") })
  if ($outside.Count -gt 0) { Fail ("HEAD $head differs from the package's commit $($record.commit) outside scripts/nvidia-qualification/:`n" + ($outside -join "`n")) }
  Write-Host "HEAD $head (package built at $($record.commit))"

  Step "Verify every file against SHA256SUMS.txt"
  $lines = @([System.IO.File]::ReadAllLines($sumsPath) | Where-Object { $_.Trim() })
  $longest = ($lines | ForEach-Object { $_.Length - 66 } | Measure-Object -Maximum).Maximum
  if ($payload.Length + 1 + $longest -gt 259) {
    Fail "the export sits too deep ($payload); its longest file would exceed 260 characters. Extract or copy it to a shorter folder such as C:\x and pass that folder."
  }
  $bad = 0
  foreach ($line in $lines) {
    $hash = $line.Substring(0, 64)
    $relative = $line.Substring(66)
    $file = Join-Path $payload ($relative.Replace("/", "\"))
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { Write-Host "  missing: $relative"; $bad++; continue }
    if ((Get-Sha256 $file) -ne $hash) { Write-Host "  changed: $relative"; $bad++ }
  }
  $present = @(Get-ChildItem -LiteralPath $payload -Recurse -File -Force).Count
  if ($present -ne $lines.Count) { Write-Host "  the export holds $present files but SHA256SUMS.txt lists $($lines.Count)"; $bad++ }
  if ($bad -gt 0) { Fail "the export did not arrive intact. Copy it again." }
  Write-Host "OK $($lines.Count) files match"

  Step "Install into $root"
  foreach ($tree in @("dist\win-unpacked", "build\native-hosts")) {
    robocopy (Join-Path $payload $tree) (Join-Path $root $tree) /MIR /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy $tree exited $LASTEXITCODE." }
    Write-Host "  $tree"
  }
  foreach ($file in @("resources\dependency-manifest.json", "resources\dependency-manifest.sig")) {
    $target = Join-Path $root $file
    Copy-Item -LiteralPath (Join-Path $payload $file) -Destination $target -Force
    Write-Host "  $file"
  }
  if ((Get-Sha256 (Join-Path $root "resources\dependency-manifest.json")) -ne $record.dependencyManifestSha256) { Fail "the installed dependency-manifest.json does not match the export record." }
} finally {
  if ($null -ne $extract) { Remove-Tree $extract }
}

Step "Dependencies"
$electron = Join-Path $root "node_modules\electron\dist\electron.exe"
if (-not (Test-Path -LiteralPath $electron) -and -not $SkipNpmCi) {
  if (Test-Path -LiteralPath (Join-Path $NodeDir "node.exe")) {
    $env:Path = "$NodeDir;$env:Path"
  } else {
    Write-Host "WARNING: $NodeDir has no node.exe; using the Node on PATH." -ForegroundColor Yellow
  }
  Write-Host "node $((node --version).Trim()), npm $((npm --version).Trim())"
  npm ci
  if ($LASTEXITCODE -ne 0) { Fail "npm ci exited $LASTEXITCODE. A dropped download is the usual cause; run this script again." }
}
if (-not (Test-Path -LiteralPath $electron)) { Fail "electron.exe is still missing: Electron's install script did not run." }
Write-Host "electron.exe present"

Write-Host ""
Write-Host "DONE. Package from $($record.commit) is installed. Tell Claude: imported" -ForegroundColor Green
