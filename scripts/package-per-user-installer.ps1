$ErrorActionPreference = "Stop"

npm run build
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "production-offline"
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -Strict
npx electron-builder --win nsis --config electron-builder.json
# $ErrorActionPreference="Stop" does NOT trip on a native-exe non-zero exit; check explicitly so a
# failed pack (e.g. the 7-Zip "-mx=9" OOM observed on low-memory machines) can't masquerade as
# success and leave a stale installer on disk. Observed 2026-07-06.
if ($LASTEXITCODE -ne 0) { throw "electron-builder (nsis) failed with exit code $LASTEXITCODE" }

Write-Host "Per-user installer created under dist/."
