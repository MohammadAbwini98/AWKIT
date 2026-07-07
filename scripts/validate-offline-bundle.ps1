param(
  [switch]$Strict
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$manifest = Join-Path $root "resources\dependency-manifest.json"
$browser = Join-Path $root "resources\browsers\chromium\chrome.exe"
$offlineRuntime = Join-Path $root "resources\offline-runtime.json"
$playwrightRuntime = Join-Path $root "node_modules\playwright"
$playwrightCoreRuntime = Join-Path $root "node_modules\playwright-core"
$sqlJsWasm = Join-Path $root "node_modules\sql.js\dist\sql-wasm.wasm"
$sqlJsJs = Join-Path $root "node_modules\sql.js\dist\sql-wasm.js"
$sampleFlows = Join-Path $root "resources\sample-flows"
$sampleWorkflows = Join-Path $root "resources\sample-workflows"
$sampleScenarios = Join-Path $root "resources\sample-scenarios"
$sampleData = Join-Path $root "resources\sample-data"

if (-not (Test-Path $manifest)) {
  Write-Error "Missing dependency manifest: $manifest"
  exit 1
}

$manifestJson = Get-Content -Raw $manifest | ConvertFrom-Json
$failures = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Add-Problem {
  param([string]$Message, [bool]$IsStrictFailure)

  if ($IsStrictFailure) {
    $failures.Add($Message)
  } else {
    $warnings.Add($Message)
  }
}

function Test-Property {
  param(
    [object]$Object,
    [string]$Name
  )

  return $null -ne $Object -and ($Object.PSObject.Properties.Name -contains $Name)
}

function Require-Section {
  param([string]$Name)

  if (-not (Test-Property $manifestJson $Name)) {
    $failures.Add("Manifest is missing required section: $Name")
  }
}

function Require-Boolean {
  param(
    [object]$Object,
    [string]$Name,
    [bool]$Expected,
    [string]$Message
  )

  if (-not (Test-Property $Object $Name) -or $Object.$Name -ne $Expected) {
    $failures.Add($Message)
  }
}

foreach ($section in @("application", "offline", "runtime", "browsers", "paths", "validation", "startupChecklist", "dependencies")) {
  Require-Section $section
}

if (-not (Test-Path $offlineRuntime)) {
  $failures.Add("Missing offline runtime config: $offlineRuntime")
}

if (-not (Test-Path $browser)) {
  Add-Problem "Bundled Chromium is not present: $browser" $Strict
}

if (-not (Test-Path $playwrightRuntime) -or -not (Test-Path $playwrightCoreRuntime)) {
  $failures.Add("Playwright runtime files are missing from node_modules.")
}

# Durable runtime store driver (sql.js WASM SQLite): both dist files must be present so the
# packaged app can load the WASM offline (bundled into app.asar's node_modules).
if (-not (Test-Path $sqlJsJs) -or -not (Test-Path $sqlJsWasm)) {
  $failures.Add("sql.js runtime files are missing from node_modules (dist/sql-wasm.js + dist/sql-wasm.wasm).")
}

foreach ($path in @($sampleFlows, $sampleWorkflows, $sampleScenarios, $sampleData)) {
  if (-not (Test-Path $path)) {
    $failures.Add("Missing bundled resource folder: $path")
  }
}

if (Test-Property $manifestJson "application") {
  if ($manifestJson.application.name -ne "WebFlow Studio") {
    $failures.Add("Manifest application name must be WebFlow Studio.")
  }
  if ([string]::IsNullOrWhiteSpace([string]$manifestJson.application.version)) {
    $failures.Add("Manifest application version is required.")
  }
  if ([string]::IsNullOrWhiteSpace([string]$manifestJson.application.buildMode)) {
    $failures.Add("Manifest build mode is required.")
  }
  if ([string]::IsNullOrWhiteSpace([string]$manifestJson.application.builtAt)) {
    $failures.Add("Manifest build timestamp is required.")
  }
}

if (Test-Property $manifestJson "offline") {
  Require-Boolean $manifestJson.offline "internetRequired" $false "Manifest must declare internetRequired=false."
  Require-Boolean $manifestJson.offline "runtimeDownloadsAllowed" $false "Manifest must declare runtimeDownloadsAllowed=false."
  Require-Boolean $manifestJson.offline "adminPermissionRequired" $false "Manifest must declare adminPermissionRequired=false."
  Require-Boolean $manifestJson.offline "globalNodeRequired" $false "Manifest must declare globalNodeRequired=false."
  Require-Boolean $manifestJson.offline "globalPlaywrightRequired" $false "Manifest must declare globalPlaywrightRequired=false."
  Require-Boolean $manifestJson.offline "globalBrowserRequired" $false "Manifest must declare globalBrowserRequired=false."
}

if (Test-Property $manifestJson "runtime") {
  Require-Boolean $manifestJson.runtime "electronIncluded" $true "Manifest must confirm Electron is included."
  Require-Boolean $manifestJson.runtime "nodeRuntimeIncluded" $true "Manifest must confirm Node runtime is included."
  Require-Boolean $manifestJson.runtime "productionNodeModulesIncluded" $true "Manifest must confirm production node_modules are included."
  Require-Boolean $manifestJson.runtime "nativeModulesIncluded" $true "Manifest must confirm native modules are included or not required."
  Require-Boolean $manifestJson.runtime "playwrightRuntimeIncluded" $true "Manifest must confirm Playwright runtime files are included."
  Require-Boolean $manifestJson.runtime "sqlJsRuntimeIncluded" $true "Manifest must confirm the sql.js runtime is included."
  Require-Boolean $manifestJson.runtime "sqlJsWasmIncluded" $true "Manifest must confirm the sql.js WASM asset is included."
}

if (Test-Property $manifestJson "browsers") {
  $chromiumManifest = $manifestJson.browsers | Where-Object { $_.name -eq "chromium" } | Select-Object -First 1
  if ($null -eq $chromiumManifest) {
    $failures.Add("Manifest must include a Chromium browser entry.")
  } else {
    if ($chromiumManifest.relativeExecutablePath -ne "resources/browsers/chromium/chrome.exe") {
      $failures.Add("Manifest Chromium relativeExecutablePath must be resources/browsers/chromium/chrome.exe.")
    }
    if ($chromiumManifest.included -ne (Test-Path $browser)) {
      $failures.Add("Manifest Chromium included flag does not match the browser executable on disk.")
    }
    if ($Strict -and $chromiumManifest.validated -ne $true) {
      $failures.Add("Strict mode requires the bundled Chromium entry to be validated.")
    }
  }
}

if (Test-Property $manifestJson "paths") {
  foreach ($pathName in @("runtimeDataRoot", "flows", "workflows", "scenarios", "instances", "data", "downloads", "screenshots", "logs", "reports")) {
    if (-not (Test-Property $manifestJson.paths $pathName) -or -not ([string]$manifestJson.paths.$pathName).StartsWith("%LOCALAPPDATA%/WebFlow Studio")) {
      $failures.Add("Manifest path must use the user profile runtime root: $pathName")
    }
  }
}

if (Test-Property $manifestJson "validation") {
  Require-Boolean $manifestJson.validation "noRuntimeDownloadsDetected" $true "Manifest validation must confirm no runtime downloads."
  Require-Boolean $manifestJson.validation "noAdminPathRequired" $true "Manifest validation must confirm no admin path is required."
  Require-Boolean $manifestJson.validation "profileStorageWritable" $true "Manifest validation must confirm profile storage is writable."
  Require-Boolean $manifestJson.validation "runtimeFoldersWritable" $true "Manifest validation must confirm runtime folders are writable."
  Require-Boolean $manifestJson.validation "playwrightRuntimeFilesExist" $true "Manifest validation must confirm Playwright runtime files exist."

  if ($manifestJson.validation.bundledBrowserExists -ne (Test-Path $browser)) {
    $failures.Add("Manifest bundledBrowserExists flag does not match the browser executable on disk.")
  }
  if ($Strict -and $manifestJson.validation.browserLaunchTestPassed -ne $true) {
    $failures.Add("Strict mode requires browserLaunchTestPassed=true.")
  }
}

if (Test-Property $manifestJson "startupChecklist") {
  Require-Boolean $manifestJson.startupChecklist "manifestExists" $true "Startup checklist must confirm manifest exists."
  Require-Boolean $manifestJson.startupChecklist "productionNodeModulesAvailable" $true "Startup checklist must confirm production node_modules are available."
  Require-Boolean $manifestJson.startupChecklist "nativeModulesLoadSuccessfully" $true "Startup checklist must confirm native modules load successfully or are not required."
  Require-Boolean $manifestJson.startupChecklist "runtimeDataRootWritable" $true "Startup checklist must confirm runtime data root is writable."
  Require-Boolean $manifestJson.startupChecklist "downloadsScreenshotsLogsReportsWritable" $true "Startup checklist must confirm downloads/screenshots/logs/reports are writable."
  Require-Boolean $manifestJson.startupChecklist "noInternetDownloadAttempted" $true "Startup checklist must confirm no internet download was attempted."
  Require-Boolean $manifestJson.startupChecklist "noAdminOnlyPathRequired" $true "Startup checklist must confirm no admin-only path is required."

  if ($manifestJson.startupChecklist.bundledBrowserExecutableExists -ne (Test-Path $browser)) {
    $failures.Add("Startup checklist bundledBrowserExecutableExists flag does not match the browser executable on disk.")
  }
}

foreach ($warning in $warnings) {
  Write-Warning $warning
}

if ($failures.Count -gt 0) {
  foreach ($failure in $failures) {
    Write-Host "ERROR: $failure" -ForegroundColor Red
  }
  exit 1
}

Write-Host "Offline bundle validation completed."
if ($Strict) {
  Write-Host "Strict mode: passed."
} else {
  Write-Host "Development mode: warnings do not fail validation."
}
