$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -PackagingInputsOnly
if ($LASTEXITCODE -ne 0) { throw "offline packaging preflight failed with exit code $LASTEXITCODE" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed with exit code $LASTEXITCODE" }
# Stage the raw, unbundled Zvec utility host BEFORE the manifest is generated, so its checksums
# describe the exact tree electron-builder will ship via extraResources.
node (Join-Path $PSScriptRoot "prepare-zvec-native-host.mjs")
if ($LASTEXITCODE -ne 0) { throw "prepare-zvec-native-host failed with exit code $LASTEXITCODE" }
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "production-offline"
if ($LASTEXITCODE -ne 0) { throw "dependency manifest generation failed with exit code $LASTEXITCODE" }
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -Strict
if ($LASTEXITCODE -ne 0) { throw "strict offline validation failed with exit code $LASTEXITCODE" }
npx electron-builder --win portable --config electron-builder.json
# $ErrorActionPreference="Stop" does NOT trip on a native-exe non-zero exit; check explicitly so a
# failed pack (e.g. the 7-Zip "-mx=9" OOM observed on low-memory machines) can't masquerade as
# success and leave a stale EXE on disk. Observed 2026-07-06.
if ($LASTEXITCODE -ne 0) { throw "electron-builder (portable) failed with exit code $LASTEXITCODE" }

$packageJson = Get-Content -Raw (Join-Path $PSScriptRoot "..\package.json") | ConvertFrom-Json
$artifact = Join-Path $PSScriptRoot "..\dist\SpecterStudio $($packageJson.version).exe"
node (Join-Path $PSScriptRoot "write-artifact-provenance.mjs") --artifact $artifact --kind portable
if ($LASTEXITCODE -ne 0) { throw "portable artifact provenance failed with exit code $LASTEXITCODE" }

Write-Host "Portable package created under dist/."
