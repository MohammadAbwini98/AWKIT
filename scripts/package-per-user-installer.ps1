$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -PackagingInputsOnly
if ($LASTEXITCODE -ne 0) { throw "offline packaging preflight failed with exit code $LASTEXITCODE" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed with exit code $LASTEXITCODE" }
# Stage the raw, unbundled utility hosts BEFORE the manifest is generated, so their checksums
# describe the exact trees electron-builder will ship via extraResources: the Zvec host, and the
# local-AI host with its pinned CPU runtime (Phase L L7; the model pack is never bundled).
node (Join-Path $PSScriptRoot "prepare-zvec-native-host.mjs")
if ($LASTEXITCODE -ne 0) { throw "prepare-zvec-native-host failed with exit code $LASTEXITCODE" }
node (Join-Path $PSScriptRoot "prepare-ai-native-host.mjs")
if ($LASTEXITCODE -ne 0) { throw "prepare-ai-native-host failed with exit code $LASTEXITCODE" }
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "production-offline"
if ($LASTEXITCODE -ne 0) { throw "dependency manifest generation failed with exit code $LASTEXITCODE" }
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -Strict
if ($LASTEXITCODE -ne 0) { throw "strict offline validation failed with exit code $LASTEXITCODE" }
. (Join-Path $PSScriptRoot "lib\set-packaging-compression.ps1")
npx electron-builder --win nsis --config electron-builder.json
# $ErrorActionPreference="Stop" does NOT trip on a native-exe non-zero exit; check explicitly so a
# failed pack can't masquerade as success and leave a stale installer on disk.
if ($LASTEXITCODE -ne 0) { throw "electron-builder (nsis) failed with exit code $LASTEXITCODE" }

$packageJson = Get-Content -Raw (Join-Path $PSScriptRoot "..\package.json") | ConvertFrom-Json
$artifact = Join-Path $PSScriptRoot "..\dist\SpecterStudio Setup $($packageJson.version).exe"
node (Join-Path $PSScriptRoot "write-artifact-provenance.mjs") --artifact $artifact --kind nsis
if ($LASTEXITCODE -ne 0) { throw "NSIS artifact provenance failed with exit code $LASTEXITCODE" }

Write-Host "Per-user installer created under dist/."
