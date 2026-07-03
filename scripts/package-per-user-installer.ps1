$ErrorActionPreference = "Stop"

npm run build
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "production-offline"
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -Strict
npx electron-builder --win nsis --config electron-builder.json

Write-Host "Per-user installer created under dist/."
