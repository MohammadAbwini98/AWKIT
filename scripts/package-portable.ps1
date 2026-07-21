<#
.SYNOPSIS
  Build the SpecterStudio Windows portable .exe (single-file, offline-capable).

.DESCRIPTION
  Runs the full offline-correct portable pipeline:
    1. npm run build                                            (tsc --noEmit + electron-vite bundles)
    2. generate-dependency-manifest.ps1 -BuildMode production-offline   (skipped with -SkipValidation)
    3. validate-offline-bundle.ps1 -Strict                             (skipped with -SkipValidation)
    4. electron-builder --win portable   ->   dist\SpecterStudio <version>.exe

  electron-builder defaults to "maximum" compression (7-Zip -mx=9), which OOMs on ~16 GB hosts
  (see docs/ai/KNOWN_ISSUES.md, observed 2026-07-06). Pass -Compression normal (or store) to pack
  reliably on those machines. The level is injected into a throwaway copy of electron-builder.json,
  so the committed config is never modified.

.PARAMETER Compression
  electron-builder compression level: store | normal | maximum. Default: maximum (release parity).
  Use "normal" or "store" if the pack runs out of memory.

.PARAMETER SkipValidation
  Skip the offline dependency-manifest + strict validation steps. Faster for a quick local build;
  NOT recommended for a distributable artifact.

.EXAMPLE
  # Memory-safe build on a 16 GB machine (recommended here):
  powershell -ExecutionPolicy Bypass -File scripts/package-portable.ps1 -Compression normal
#>
param(
  [ValidateSet("store", "normal", "maximum")]
  [string]$Compression = "maximum",
  [switch]$SkipValidation
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

Write-Host "==> [1/4] Building app (tsc --noEmit + electron-vite)..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }

if (-not $SkipValidation) {
  Write-Host "==> [2/4] Generating offline dependency manifest..." -ForegroundColor Cyan
  powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "production-offline"
  if ($LASTEXITCODE -ne 0) { throw "dependency-manifest generation failed (exit $LASTEXITCODE)" }

  Write-Host "==> [3/4] Validating offline bundle (strict)..." -ForegroundColor Cyan
  powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -Strict
  if ($LASTEXITCODE -ne 0) { throw "offline-bundle validation failed (exit $LASTEXITCODE)" }
}
else {
  Write-Host "==> [2-3/4] Skipping offline validation (-SkipValidation)." -ForegroundColor Yellow
}

Write-Host "==> [4/4] Packaging portable .exe (compression=$Compression)..." -ForegroundColor Cyan

# Inject the chosen compression into a throwaway copy of the builder config rather than editing the
# committed electron-builder.json. Relative asset paths (resources/, vendor/, out/, icon) still
# resolve against the project directory, so the temp config can live at the repo root.
$baseConfig = Join-Path $repoRoot "electron-builder.json"
$tempConfig = Join-Path $repoRoot "electron-builder.portable.tmp.json"
$raw = Get-Content $baseConfig -Raw
$brace = $raw.IndexOf('{')
$merged = $raw.Substring(0, $brace + 1) + "`n  `"compression`": `"$Compression`"," + $raw.Substring($brace + 1)
Set-Content -Path $tempConfig -Value $merged -Encoding utf8

# Give electron-builder's app-builder (Node) pass extra heap headroom on top of the compression fix.
$env:NODE_OPTIONS = "--max-old-space-size=4096"

try {
  npx electron-builder --win portable --config $tempConfig
  # $ErrorActionPreference="Stop" does NOT trip on a native-exe non-zero exit; check explicitly so a
  # failed pack (e.g. the 7-Zip OOM) can't masquerade as success and leave a stale EXE on disk.
  if ($LASTEXITCODE -ne 0) { throw "electron-builder (portable) failed with exit code $LASTEXITCODE" }
}
finally {
  Remove-Item $tempConfig -ErrorAction SilentlyContinue
}

$exe = Get-ChildItem -Path (Join-Path $repoRoot "dist") -Filter "*.exe" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike "*Setup*" } |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

if ($exe) {
  $sizeMb = [math]::Round($exe.Length / 1MB, 1)
  Write-Host ""
  Write-Host "Portable package created:" -ForegroundColor Green
  Write-Host "  $($exe.FullName)  ($sizeMb MB)" -ForegroundColor Green
}
else {
  Write-Host "electron-builder reported success but no portable .exe was found under dist\." -ForegroundColor Yellow
}
