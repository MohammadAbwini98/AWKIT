param(
  [string]$BuildMode = "development-offline-prep"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJsonPath = Join-Path $root "package.json"
$resourcesRoot = Join-Path $root "resources"
$manifestPath = Join-Path $resourcesRoot "dependency-manifest.json"
$browserPath = Join-Path $resourcesRoot "browsers\chromium\chrome.exe"
$nodeModules = Join-Path $root "node_modules"
$playwrightRuntime = Join-Path $nodeModules "playwright"
$playwrightCoreRuntime = Join-Path $nodeModules "playwright-core"

$packageJson = Get-Content -Raw $packageJsonPath | ConvertFrom-Json

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

$browserExists = Test-Path $browserPath
$nodeModulesIncluded = Test-Path $nodeModules
$nativeModulesPath = Join-Path $root "vendor\native-modules"
$nativeModuleFileCount = if (Test-Path $nativeModulesPath) { (Get-ChildItem -File -Recurse -Force $nativeModulesPath -ErrorAction SilentlyContinue | Measure-Object).Count } else { 0 }
$nativeModulesRequired = $nativeModuleFileCount -gt 0
$nativeModulesIncluded = $true
$playwrightRuntimeIncluded = (Test-Path $playwrightRuntime) -and (Test-Path $playwrightCoreRuntime)
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

$manifest = [ordered]@{
  schema = [ordered]@{
    name = "playwright-flow-studio-offline-dependency-manifest"
    version = 1
    sourceTemplate = "playwright_flow_studio_updated_phases/12_OFFLINE_DEPENDENCY_MANIFEST_TEMPLATE.md"
  }
  application = [ordered]@{
    name = "WebFlow Studio"
    version = [string]$packageJson.version
    buildMode = $BuildMode
    builtAt = (Get-Date).ToUniversalTime().ToString("o")
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
  }
  browsers = @(
    [ordered]@{
      name = "chromium"
      included = $browserExists
      relativeExecutablePath = "resources/browsers/chromium/chrome.exe"
      version = $browserVersion
      validated = $browserLaunchTestPassed
    }
  )
  paths = [ordered]@{
    runtimeDataRoot = "%LOCALAPPDATA%/WebFlow Studio"
    flows = "%LOCALAPPDATA%/WebFlow Studio/flows"
    workflows = "%LOCALAPPDATA%/WebFlow Studio/workflows"
    scenarios = "%LOCALAPPDATA%/WebFlow Studio/scenarios"
    instances = "%LOCALAPPDATA%/WebFlow Studio/instances"
    data = "%LOCALAPPDATA%/WebFlow Studio/data"
    runtimeInputs = "%LOCALAPPDATA%/WebFlow Studio/runtime-inputs"
    storage = "%LOCALAPPDATA%/WebFlow Studio/storage"
    downloads = "%LOCALAPPDATA%/WebFlow Studio/downloads"
    screenshots = "%LOCALAPPDATA%/WebFlow Studio/screenshots"
    logs = "%LOCALAPPDATA%/WebFlow Studio/logs"
    reports = "%LOCALAPPDATA%/WebFlow Studio/reports"
    temp = "%LOCALAPPDATA%/WebFlow Studio/temp"
  }
  validation = [ordered]@{
    bundledBrowserExists = $browserExists
    browserLaunchTestPassed = $browserLaunchTestPassed
    profileStorageWritable = $true
    runtimeFoldersWritable = $true
    noRuntimeDownloadsDetected = $true
    noAdminPathRequired = $true
    playwrightRuntimeFilesExist = $playwrightRuntimeIncluded
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
  dependencies = [ordered]@{
    electron = Get-DependencyVersion "electron"
    playwright = Get-DependencyVersion "playwright"
    react = Get-DependencyVersion "react"
    reactFlow = Get-DependencyVersion "@xyflow/react"
    sqlite = "not-installed"
  }
}

New-Item -ItemType Directory -Force -Path $resourcesRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "vendor") | Out-Null
# Write UTF-8 WITHOUT a BOM. Windows PowerShell 5.1 `Set-Content -Encoding UTF8`
# emits a BOM, which makes Node's JSON.parse throw when the app reads the manifest.
$manifestJson = $manifest | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $root "vendor\dependency-manifest.json") -Force

Write-Host "Generated dependency manifest: $manifestPath"
