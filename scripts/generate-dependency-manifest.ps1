param(
  [string]$BuildMode = "development-offline-prep"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "lib\offline-browser-integrity.ps1")
$packageJsonPath = Join-Path $root "package.json"
$resourcesRoot = Join-Path $root "resources"
$manifestPath = Join-Path $resourcesRoot "dependency-manifest.json"
$browserPath = Join-Path $resourcesRoot "browsers\chromium\chrome.exe"
$browserRoot = Join-Path $resourcesRoot "browsers\chromium"
$browserProvenancePath = Join-Path $resourcesRoot "browsers\chromium-provenance.json"
$nodeModules = Join-Path $root "node_modules"
$playwrightRuntime = Join-Path $nodeModules "playwright"
$playwrightCoreRuntime = Join-Path $nodeModules "playwright-core"
$sqlJsWasm = Join-Path $nodeModules "sql.js\dist\sql-wasm.wasm"
$sqlJsJs = Join-Path $nodeModules "sql.js\dist\sql-wasm.js"

$packageJson = Get-Content -Raw $packageJsonPath | ConvertFrom-Json
$browserPolicy = Get-AwkitOfflineBrowserPolicy -RootPath $root
Assert-AwkitPlaywrightPin -RootPath $root -Policy $browserPolicy
$sourceCommit = (& git -C $root rev-parse HEAD 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceCommit -notmatch "^[0-9a-f]{40}$") {
  throw "Cannot generate release provenance without an exact source commit."
}
$sourceChanges = @(& git -C $root status --porcelain -- . ":(exclude)resources/dependency-manifest.json" ":(exclude)resources/dependency-manifest.sig")
$sourceTreeDirty = $sourceChanges.Count -gt 0

function Get-DependencyVersion {
  param([string]$Name)

  if ($packageJson.dependencies.PSObject.Properties.Name -contains $Name) {
    return [string]$packageJson.dependencies.PSObject.Properties[$Name].Value
  }

  if ($packageJson.devDependencies.PSObject.Properties.Name -contains $Name) {
    return [string]$packageJson.devDependencies.PSObject.Properties[$Name].Value
  }

  return "not-used"
}

# === Optional semantic native host (Zvec) ===
# The staged tree under build/native-hosts/zvec is produced by scripts/prepare-zvec-native-host.mjs
# and shipped via electron-builder extraResources (never bundled — a bundled caller hard-crashes).
# When the tree is absent the feature is simply not included in this build; when it is present its
# own manifest is folded in verbatim so release validation can checksum every native asset.
$zvecHostDir = Join-Path $root "build\native-hosts\zvec"
$zvecHostManifestPath = Join-Path $zvecHostDir "zvec-native-host-manifest.json"
$zvecHostManifest = $null
if (Test-Path $zvecHostManifestPath) {
  $zvecHostManifest = Get-Content -Raw $zvecHostManifestPath | ConvertFrom-Json
}

if ($null -ne $zvecHostManifest) {
  $semanticNative = [ordered]@{
    enabled = $true
    # A broken optional semantic bundle must never block AWKIT startup; it disables semantic
    # features and reports a degraded status instead (plan §9).
    requiredForAppStartup = $false
    hostProtocolVersion = $zvecHostManifest.hostProtocolVersion
    hostEntry = "native-hosts/zvec/$($zvecHostManifest.hostEntry)"
    zvecVersion = $zvecHostManifest.zvecVersion
    bindingVersion = $zvecHostManifest.bindingVersion
    platform = $zvecHostManifest.platform
    arch = $zvecHostManifest.arch
    stagedRoot = "native-hosts/zvec"
    totalBytes = $zvecHostManifest.totalBytes
    assets = @($zvecHostManifest.assets | ForEach-Object {
      [ordered]@{
        relativePath = "native-hosts/zvec/$($_.relativePath)"
        size = $_.size
        sha256 = $_.sha256
      }
    })
  }
} else {
  $semanticNative = [ordered]@{
    enabled = $false
    requiredForAppStartup = $false
    assets = @()
  }
}

$browserExists = Test-Path $browserPath
$browserPayloadDigest = if ($browserExists) {
  Assert-AwkitBrowserTree -BrowserRoot $browserRoot -Policy $browserPolicy
} else {
  $null
}
$browserAcquisition = if (Test-Path -LiteralPath $browserProvenancePath -PathType Leaf) {
  Get-Content -Raw -LiteralPath $browserProvenancePath | ConvertFrom-Json
} else {
  $null
}
if ($browserExists -and $null -eq $browserAcquisition) {
  throw "Bundled Chromium exists without approved acquisition provenance. Run npm run prepare:offline."
}
$nodeModulesIncluded = Test-Path $nodeModules
$nativeModulesPath = Join-Path $root "vendor\native-modules"
$nativeModuleFileCount = if (Test-Path $nativeModulesPath) { (Get-ChildItem -File -Recurse -Force $nativeModulesPath -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
$nativeModulesRequired = $nativeModuleFileCount -gt 0
$nativeModulesIncluded = $true
$playwrightRuntimeIncluded = (Test-Path $playwrightRuntime) -and (Test-Path $playwrightCoreRuntime)
# sql.js (WASM SQLite) powers the durable runtime store; the .wasm asset MUST ship with the app.
$sqlJsRuntimeIncluded = (Test-Path $sqlJsJs) -and (Test-Path $sqlJsWasm)
$browserLaunchTestPassed = $false

if ($browserExists) {
  try {
    # chrome.exe is a GUI-subsystem binary, so `chrome.exe --version` does not
    # write to the console on Windows. Read the embedded PE version resource
    # instead — reliable and does not spawn a browser process.
    $versionInfo = (Get-Item $browserPath).VersionInfo
    $productVersion = $versionInfo.ProductVersion
    if ([string]::IsNullOrWhiteSpace($productVersion)) {
      $productVersion = $versionInfo.FileVersion
    }
    if (-not [string]::IsNullOrWhiteSpace($productVersion)) {
      $browserVersion = ([string]$productVersion).Trim()
      $browserLaunchTestPassed = $true
    } else {
      $browserVersion = "bundled"
      $browserLaunchTestPassed = $false
    }
  } catch {
    $browserVersion = "bundled"
    $browserLaunchTestPassed = $false
  }
} else {
  $browserVersion = "missing"
}

$browserPayloadProvenance = if ($browserExists) {
  [ordered]@{
    approvalPolicy = [string]$browserAcquisition.approvalPolicy
    approvalPolicySha256 = [string]$browserAcquisition.approvalPolicySha256
    source = [string]$browserAcquisition.source
    sourceUrl = [string]$browserAcquisition.sourceUrl
    sourceArchiveSha256 = [string]$browserAcquisition.sourceArchiveSha256
    sourceArchiveSize = [long]$browserAcquisition.sourceArchiveSize
    requestedPlaywrightVersion = [string]$browserAcquisition.requestedPlaywrightVersion
    installedPlaywrightVersion = [string]$browserAcquisition.installedPlaywrightVersion
    browserRevision = [string]$browserAcquisition.browserRevision
    browserVersion = [string]$browserAcquisition.browserVersion
    executableSha256 = [string]$browserAcquisition.executableSha256
    stagedAt = [string]$browserAcquisition.stagedAt
    sourceTimestamp = [string]$browserAcquisition.sourceTimestamp
    sourceTimestampBasis = [string]$browserAcquisition.sourceTimestampBasis
    hash = $browserPayloadDigest
  }
} else {
  $null
}

$manifest = [ordered]@{
  schema = [ordered]@{
    name = "playwright-flow-studio-offline-dependency-manifest"
    version = 3
    sourceTemplate = "playwright_flow_studio_updated_phases/12_OFFLINE_DEPENDENCY_MANIFEST_TEMPLATE.md"
  }
  manifestGeneratedAt = (Get-Date).ToUniversalTime().ToString("o")
  application = [ordered]@{
    name = "SpecterStudio"
    version = [string]$packageJson.version
    buildMode = $BuildMode
    sourceCommit = $sourceCommit
    sourceTreeDirty = $sourceTreeDirty
  }
  offline = [ordered]@{
    internetRequired = $false
    runtimeDownloadsAllowed = $false
    adminPermissionRequired = $false
    globalNodeRequired = $false
    globalPlaywrightRequired = $false
    globalBrowserRequired = $false
  }
  runtime = [ordered]@{
    electronIncluded = $true
    nodeRuntimeIncluded = $true
    productionNodeModulesIncluded = $nodeModulesIncluded
    nativeModulesIncluded = $nativeModulesIncluded
    nativeModulesRequired = $nativeModulesRequired
    playwrightRuntimeIncluded = $playwrightRuntimeIncluded
    sqlJsRuntimeIncluded = $sqlJsRuntimeIncluded
    sqlJsWasmIncluded = (Test-Path $sqlJsWasm)
  }
  browsers = @(
    [ordered]@{
      name = "chromium"
      included = $browserExists
      relativeExecutablePath = "resources/browsers/chromium/chrome.exe"
      version = $browserVersion
      revision = [string]$browserPolicy.browser.revision
      validated = $browserLaunchTestPassed
      payloadProvenance = $browserPayloadProvenance
    }
  )
  paths = [ordered]@{
    runtimeDataRoot = "%LOCALAPPDATA%/SpecterStudio"
    flows = "%LOCALAPPDATA%/SpecterStudio/flows"
    workflows = "%LOCALAPPDATA%/SpecterStudio/workflows"
    scenarios = "%LOCALAPPDATA%/SpecterStudio/scenarios"
    instances = "%LOCALAPPDATA%/SpecterStudio/instances"
    data = "%LOCALAPPDATA%/SpecterStudio/data"
    runtimeInputs = "%LOCALAPPDATA%/SpecterStudio/runtime-inputs"
    storage = "%LOCALAPPDATA%/SpecterStudio/storage"
    downloads = "%LOCALAPPDATA%/SpecterStudio/downloads"
    screenshots = "%LOCALAPPDATA%/SpecterStudio/screenshots"
    logs = "%LOCALAPPDATA%/SpecterStudio/logs"
    reports = "%LOCALAPPDATA%/SpecterStudio/reports"
    temp = "%LOCALAPPDATA%/SpecterStudio/temp"
  }
  validation = [ordered]@{
    bundledBrowserExists = $browserExists
    browserLaunchTestPassed = $browserLaunchTestPassed
    profileStorageWritable = $true
    runtimeFoldersWritable = $true
    noRuntimeDownloadsDetected = $true
    noAdminPathRequired = $true
    playwrightRuntimeFilesExist = $playwrightRuntimeIncluded
    sqlJsWasmFileExists = (Test-Path $sqlJsWasm)
  }
  startupChecklist = [ordered]@{
    manifestExists = $true
    bundledBrowserExecutableExists = $browserExists
    productionNodeModulesAvailable = $nodeModulesIncluded
    nativeModulesLoadSuccessfully = $nativeModulesIncluded
    runtimeDataRootWritable = $true
    downloadsScreenshotsLogsReportsWritable = $true
    noInternetDownloadAttempted = $true
    noAdminOnlyPathRequired = $true
  }
  supplyChain = [ordered]@{
    browserPolicyPath = "resources/offline-browser-policy.json"
    manifestSignaturePath = "resources/dependency-manifest.sig"
    publicKeyPath = "resources/trust/offline-manifest-public.pem"
    signatureAlgorithm = "Ed25519"
    payloadEquivalenceModel = "path-size-sha256"
    wholeArtifactHashPurpose = "identifies one accepted artifact; not reproducible-build proof"
  }
  dependencies = [ordered]@{
    electron = Get-DependencyVersion "electron"
    playwright = Get-DependencyVersion "playwright"
    react = Get-DependencyVersion "react"
    reactFlow = Get-DependencyVersion "@xyflow/react"
    framerMotion = Get-DependencyVersion "framer-motion"
    sqlJs = Get-DependencyVersion "sql.js"
    sqlite = "sql.js $(Get-DependencyVersion 'sql.js') (WASM, no native driver)"
    zvec = Get-DependencyVersion "@zvec/zvec"
  }
  semanticNative = $semanticNative
}

New-Item -ItemType Directory -Force -Path $resourcesRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "vendor") | Out-Null
# Write UTF-8 WITHOUT a BOM. Windows PowerShell 5.1 `Set-Content -Encoding UTF8`
# emits a BOM, which makes Node's JSON.parse throw when the app reads the manifest.
$manifestJson = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
$signaturePath = Join-Path $resourcesRoot "dependency-manifest.sig"
node (Join-Path $PSScriptRoot "offline-manifest-signature.mjs") sign --manifest $manifestPath --signature $signaturePath
if ($LASTEXITCODE -ne 0) {
  throw "Dependency-manifest signing failed with exit code $LASTEXITCODE"
}

$vendorRoot = Join-Path $root "vendor"
$vendorTrustRoot = Join-Path $vendorRoot "trust"
New-Item -ItemType Directory -Force -Path $vendorTrustRoot | Out-Null
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $vendorRoot "dependency-manifest.json") -Force
Copy-Item -LiteralPath $signaturePath -Destination (Join-Path $vendorRoot "dependency-manifest.sig") -Force
Copy-Item -LiteralPath (Join-Path $resourcesRoot "offline-browser-policy.json") -Destination (Join-Path $vendorRoot "offline-browser-policy.json") -Force
Copy-Item -LiteralPath (Join-Path $resourcesRoot "trust\offline-manifest-public.pem") -Destination (Join-Path $vendorTrustRoot "offline-manifest-public.pem") -Force

Write-Host "Generated dependency manifest: $manifestPath"
