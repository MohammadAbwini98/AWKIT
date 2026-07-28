param(
  [switch]$InstallChromium,
  [string]$ArchivePath
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "lib\offline-browser-integrity.ps1")

$policy = Get-AwkitOfflineBrowserPolicy -RootPath $root
Assert-AwkitPlaywrightPin -RootPath $root -Policy $policy

$resourcesBrowserRoot = Join-Path $root "resources\browsers"
$targetChromium = Join-Path $resourcesBrowserRoot "chromium"
$targetProvenance = Join-Path $resourcesBrowserRoot "chromium-provenance.json"
$vendorBrowserRoot = Join-Path $root "vendor\browsers"
$vendorChromium = Join-Path $vendorBrowserRoot "chromium"
$temporaryRoot = $null
$downloadedArchive = $null

New-Item -ItemType Directory -Force -Path $resourcesBrowserRoot | Out-Null
New-Item -ItemType Directory -Force -Path $vendorBrowserRoot | Out-Null

try {
  if (-not [string]::IsNullOrWhiteSpace($ArchivePath)) {
    $resolvedArchive = (Resolve-Path -LiteralPath $ArchivePath).Path
    Assert-AwkitBrowserArchive -ArchivePath $resolvedArchive -Policy $policy
    $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("awkit-browser-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $temporaryRoot
    $sourceChromium = Join-Path $temporaryRoot ([string]$policy.browser.archiveRoot)
    $sourceDescription = "approved offline archive $resolvedArchive"
  } elseif ($InstallChromium) {
    $temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("awkit-browser-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    $downloadedArchive = Join-Path $temporaryRoot "chrome-for-testing.zip"
    Write-Host "Downloading the pinned Chrome for Testing archive..."
    Invoke-WebRequest -UseBasicParsing -Uri ([string]$policy.browser.archive.url) -OutFile $downloadedArchive
    Assert-AwkitBrowserArchive -ArchivePath $downloadedArchive -Policy $policy
    Expand-Archive -LiteralPath $downloadedArchive -DestinationPath $temporaryRoot
    $sourceChromium = Join-Path $temporaryRoot ([string]$policy.browser.archiveRoot)
    $sourceDescription = "pinned archive $($policy.browser.archive.url)"
  } else {
    $cacheRoot = Join-Path $env:LOCALAPPDATA "ms-playwright"
    $sourceChromium = Join-Path (Join-Path $cacheRoot ([string]$policy.browser.cacheDirectory)) ([string]$policy.browser.archiveRoot)
    $sourceDescription = "exact Playwright cache entry $($policy.browser.cacheDirectory)"
  }

  $verifiedTree = Assert-AwkitBrowserTree -BrowserRoot $sourceChromium -Policy $policy

  if (Test-Path -LiteralPath $targetChromium) {
    Remove-Item -LiteralPath $targetChromium -Recurse -Force
  }
  Copy-Item -LiteralPath $sourceChromium -Destination $targetChromium -Recurse -Force
  $stagedTree = Assert-AwkitBrowserTree -BrowserRoot $targetChromium -Policy $policy

  $policyPath = Join-Path $root "resources\offline-browser-policy.json"
  $policyHash = (Get-FileHash -LiteralPath $policyPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $provenance = [ordered]@{
    approvalPolicy = "resources/offline-browser-policy.json"
    approvalPolicySha256 = $policyHash
    source = "approved Chrome for Testing payload"
    sourceUrl = [string]$policy.browser.archive.url
    sourceArchiveSha256 = [string]$policy.browser.archive.sha256
    sourceArchiveSize = [long]$policy.browser.archive.size
    requestedPlaywrightVersion = [string]$policy.playwright.version
    installedPlaywrightVersion = [string]$policy.playwright.version
    browserRevision = [string]$policy.browser.revision
    browserVersion = [string]$policy.browser.version
    executableSha256 = [string]$policy.browser.executableSha256
    stagedAt = $null
    sourceTimestamp = [string]$policy.browser.archive.sourceLastModifiedUtc
    sourceTimestampBasis = "Pinned archive Last-Modified recorded in offline-browser-policy.json"
    hash = $stagedTree
  }
  $provenanceJson = $provenance | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($targetProvenance, $provenanceJson, (New-Object System.Text.UTF8Encoding($false)))

  if (Test-Path -LiteralPath $vendorChromium) {
    Remove-Item -LiteralPath $vendorChromium -Recurse -Force
  }
  Copy-Item -LiteralPath $targetChromium -Destination $vendorChromium -Recurse -Force
  Copy-Item -LiteralPath $targetProvenance -Destination (Join-Path $vendorBrowserRoot "chromium-provenance.json") -Force
  Copy-Item -LiteralPath $policyPath -Destination (Join-Path $vendorBrowserRoot "offline-browser-policy.json") -Force

  Write-Host "Approved Chromium source: $sourceDescription"
  Write-Host "Approved Chromium version: $($policy.browser.version) (revision $($policy.browser.revision))"
  Write-Host "Approved Chromium payload: $($verifiedTree.sha256)"
  Write-Host "Bundled Chromium copied to: $targetChromium"
} finally {
  if ($null -ne $temporaryRoot -and (Test-Path -LiteralPath $temporaryRoot)) {
    $resolvedTemporaryRoot = (Resolve-Path -LiteralPath $temporaryRoot).Path
    $systemTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\")
    if (-not $resolvedTemporaryRoot.StartsWith($systemTempRoot + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "Refusing to remove a temporary directory outside the system temp root: $resolvedTemporaryRoot"
    }
    Remove-Item -LiteralPath $resolvedTemporaryRoot -Recurse -Force
  }
}

powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "production-offline-prep"
if ($LASTEXITCODE -ne 0) {
  throw "generate-dependency-manifest failed with exit code $LASTEXITCODE"
}
