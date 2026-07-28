param(
  [switch]$InstallChromium
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$resourcesBrowserRoot = Join-Path $root "resources\browsers"
$targetChromium = Join-Path $resourcesBrowserRoot "chromium"
$targetProvenance = Join-Path $resourcesBrowserRoot "chromium-provenance.json"
$vendorBrowserRoot = Join-Path $root "vendor\browsers"

New-Item -ItemType Directory -Force -Path $resourcesBrowserRoot | Out-Null
New-Item -ItemType Directory -Force -Path $vendorBrowserRoot | Out-Null

if ($InstallChromium) {
  Write-Host "Installing Chromium on the development machine through Playwright..."
  npx playwright install chromium
}

$cacheRoots = @(
  (Join-Path $env:LOCALAPPDATA "ms-playwright"),
  (Join-Path $env:USERPROFILE ".cache\ms-playwright")
) | Where-Object { $_ -and (Test-Path $_) }

$chromeCandidates = @()
foreach ($cacheRoot in $cacheRoots) {
  $chromeCandidates += Get-ChildItem -Path $cacheRoot -Recurse -Filter "chrome.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "chromium" -or $_.FullName -match "chrome-win" }
}

if (-not $chromeCandidates.Count) {
  Write-Warning "No Playwright Chromium cache was found. Run: npm run offline:prepare -- -InstallChromium"
  powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "development-missing-browser"
  exit 0
}

$chrome = $chromeCandidates | Sort-Object FullName -Descending | Select-Object -First 1
$chromeRoot = Split-Path $chrome.FullName -Parent

if (Test-Path $targetChromium) {
  Remove-Item -LiteralPath $targetChromium -Recurse -Force
}

Copy-Item -LiteralPath $chromeRoot -Destination $targetChromium -Recurse -Force

$packageJson = Get-Content -Raw (Join-Path $root "package.json") | ConvertFrom-Json
$installedPlaywrightPackage = Join-Path $root "node_modules\playwright\package.json"
$installedPlaywrightVersion = if (Test-Path -LiteralPath $installedPlaywrightPackage) {
  [string]((Get-Content -Raw -LiteralPath $installedPlaywrightPackage | ConvertFrom-Json).version)
} else {
  "unavailable"
}
$cacheEntry = Split-Path (Split-Path $chromeRoot -Parent) -Leaf
$provenance = [ordered]@{
  source = "Playwright browser cache entry $cacheEntry"
  requestedPlaywrightVersion = [string]$packageJson.dependencies.playwright
  installedPlaywrightVersion = $installedPlaywrightVersion
  stagedAt = (Get-Date).ToUniversalTime().ToString("o")
  sourceExecutableLastWriteTimeUtc = $chrome.LastWriteTimeUtc.ToString("o")
}
$provenanceJson = $provenance | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText($targetProvenance, $provenanceJson, (New-Object System.Text.UTF8Encoding($false)))

if (Test-Path (Join-Path $vendorBrowserRoot "chromium")) {
  Remove-Item -LiteralPath (Join-Path $vendorBrowserRoot "chromium") -Recurse -Force
}
Copy-Item -LiteralPath $targetChromium -Destination (Join-Path $vendorBrowserRoot "chromium") -Recurse -Force
Copy-Item -LiteralPath $targetProvenance -Destination (Join-Path $vendorBrowserRoot "chromium-provenance.json") -Force

Write-Host "Bundled Chromium copied from: $chromeRoot"
Write-Host "Bundled Chromium copied to:   $targetChromium"

powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "production-offline-prep"
