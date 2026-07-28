param(
  [switch]$Strict,
  [switch]$PackagingInputsOnly,
  [string]$RootPath
)

$ErrorActionPreference = "Stop"

$root = if ([string]::IsNullOrWhiteSpace($RootPath)) {
  Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
  Resolve-Path $RootPath
}
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

if ($PackagingInputsOnly) {
  if (-not (Test-Path -LiteralPath $browser -PathType Leaf)) {
    throw "Offline packaging refused before build. Missing required input: $browser"
  }

  if ((Get-Item -LiteralPath $browser).Length -le 0) {
    throw "Offline packaging refused before build. Incomplete required input (empty file): $browser"
  }

  Write-Host "Offline packaging input preflight passed: $browser"
  return
}

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

foreach ($section in @("application", "offline", "runtime", "browsers", "paths", "validation", "startupChecklist", "dependencies", "semanticNative")) {
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
  if ($manifestJson.application.name -ne "SpecterStudio") {
    $failures.Add("Manifest application name must be SpecterStudio.")
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
    if (-not (Test-Property $manifestJson.paths $pathName) -or -not ([string]$manifestJson.paths.$pathName).StartsWith("%LOCALAPPDATA%/SpecterStudio")) {
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

# === Oracle JDBC bridge bundle (optional feature, user-selected-Java model) ===
# Specter bundles ONLY its own bridge jar; the Java runtime + Oracle driver are user-selected in
# Settings and are never bundled. When present, the bundle MUST be checksum-valid, contain the bridge
# jar (+ manifest), carry NO private JRE, NO driver jars, and NO secrets/wallets. When absent, Oracle
# is simply an un-bundled optional feature (a warning, not a fail).
$oracleDir = Join-Path $root "resources\oracle-jdbc"
if (Test-Path $oracleDir) {
  Write-Host "Validating bundled Oracle JDBC runtime..."
  $oracleChecksums = Join-Path $oracleDir "checksums.json"
  if (-not (Test-Path $oracleChecksums)) {
    $failures.Add("Oracle bundle present but checksums.json is missing (cannot verify integrity).")
  } else {
    $sums = Get-Content -Raw $oracleChecksums | ConvertFrom-Json
    foreach ($prop in $sums.PSObject.Properties) {
      $rel = $prop.Name
      $expected = ($prop.Value -replace '^sha256:', '').ToLower()
      $abs = Join-Path $oracleDir ($rel -replace '/', '\')
      if (-not (Test-Path $abs)) {
        $failures.Add("Oracle bundle: checksums.json lists a missing file: $rel")
      } else {
        $actual = (Get-FileHash -Algorithm SHA256 $abs).Hash.ToLower()
        if ($actual -ne $expected) {
          $failures.Add("Oracle bundle: checksum mismatch for $rel (corrupted or tampered).")
        }
      }
    }
  }
  foreach ($required in @("manifest.json", "bridge\awkit-oracle-jdbc-bridge.jar")) {
    if (-not (Test-Path (Join-Path $oracleDir $required))) {
      $failures.Add("Oracle bundle: missing required file: $required")
    }
  }
  # Selection model: the bundle must NOT ship a private JRE or Oracle driver jars — both are chosen by
  # the user in Settings -> Database Drivers.
  if (Test-Path (Join-Path $oracleDir "runtime\bin\java.exe")) {
    $failures.Add("Oracle bundle: must not ship a private JRE (found runtime\bin\java.exe); Java is user-selected.")
  }
  $libDir = Join-Path $oracleDir "lib"
  if (Test-Path $libDir) {
    $libJars = @(Get-ChildItem -Path $libDir -Filter *.jar -ErrorAction SilentlyContinue)
    if ($libJars.Count -gt 0) {
      $failures.Add("Oracle bundle: must not ship Oracle driver jars (found lib\*.jar); drivers are user-selected.")
    }
  }
  $forbidden = @(Get-ChildItem -Path $oracleDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '\.(env|pem|p12|sso|jks|key)$' -or $_.Name -ieq 'tnsnames.ora' -or $_.Name -ieq 'sqlnet.ora'
  })
  foreach ($f in $forbidden) {
    $failures.Add("Oracle bundle: forbidden secret/wallet artifact present: $($f.Name)")
  }
  $oracleSize = (Get-ChildItem -Path $oracleDir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  # Report KB below 1 MB. A bridge-only bundle is tens of KB by design, and rounding that to "0 MB"
  # has already been mis-recorded once as a zero-megabyte *driver bundle* warning — it is not a
  # warning at all, it is the expected user-selected-driver layout. A genuinely missing or empty
  # bridge jar is caught by the required-file and checksum checks above, not by this line.
  $oracleSizeText = if ($oracleSize -ge 1MB) {
    "$([math]::Round(($oracleSize / 1MB), 1)) MB"
  } else {
    "$([math]::Round(($oracleSize / 1KB), 1)) KB"
  }
  Write-Host "Oracle bundle size: $oracleSizeText (bridge jar only, as expected; Java + Oracle driver are user-selected)"
} else {
  $warnings.Add("Oracle JDBC bridge not bundled (optional feature). Run 'npm run prepare:oracle-runtime' to stage Specter's bridge jar. Java + Oracle drivers are always user-selected in Settings.")
}

# === Optional semantic native host (Zvec) ===
# Release validation must fail when a build CLAIMS the semantic native host is included but its
# assets are missing or checksum-mismatched. The feature itself stays optional: when it is not
# included at all, that is a warning, not a failure, and AWKIT startup is unaffected (plan §9).
if (Test-Property $manifestJson "semanticNative") {
  $semantic = $manifestJson.semanticNative

  if ($semantic.enabled -eq $true) {
    Write-Host "Validating semantic native host (Zvec)..."

    if ($semantic.requiredForAppStartup -ne $false) {
      $failures.Add("Semantic native host must declare requiredForAppStartup=false (it is an optional subsystem).")
    }
    if ($semantic.platform -ne "win32" -or $semantic.arch -ne "x64") {
      $failures.Add("Semantic native host must target win32/x64 (got $($semantic.platform)/$($semantic.arch)).")
    }
    if ([string]::IsNullOrWhiteSpace([string]$semantic.zvecVersion) -or [string]::IsNullOrWhiteSpace([string]$semantic.bindingVersion)) {
      $failures.Add("Semantic native host must record both zvecVersion and bindingVersion.")
    }
    if ($semantic.zvecVersion -ne $semantic.bindingVersion) {
      $failures.Add("Semantic native host zvecVersion ($($semantic.zvecVersion)) and bindingVersion ($($semantic.bindingVersion)) must match.")
    }

    $assetPaths = @($semantic.assets | ForEach-Object { $_.relativePath })

    # The .node needs real filesystem loading and the jieba dictionaries must resolve adjacent to
    # it, so all of these are mandatory whenever the feature is declared included.
    $mandatory = @(
      "native-hosts/zvec/zvec-host.cjs",
      "native-hosts/zvec/node_modules/@zvec/bindings-win32-x64/zvec_node_binding.node",
      "native-hosts/zvec/node_modules/@zvec/bindings-win32-x64/jieba_dict/jieba.dict.utf8",
      "native-hosts/zvec/node_modules/@zvec/bindings-win32-x64/jieba_dict/hmm_model.utf8"
    )
    foreach ($required in $mandatory) {
      if ($assetPaths -notcontains $required) {
        $failures.Add("Semantic native host manifest does not list a mandatory asset: $required")
      }
    }

    $stagedManifest = Join-Path $root "build\native-hosts\zvec\zvec-native-host-manifest.json"
    if (-not (Test-Path $stagedManifest)) {
      $failures.Add("Semantic native host is declared included but its staged manifest is missing: build/native-hosts/zvec/zvec-native-host-manifest.json (run 'npm run prepare:zvec-host').")
    }

    $checked = 0
    foreach ($asset in $semantic.assets) {
      $abs = Join-Path $root ("build\" + ($asset.relativePath -replace '/', '\'))
      if (-not (Test-Path $abs)) {
        $failures.Add("Semantic native host asset is missing from the staged tree: $($asset.relativePath)")
        continue
      }
      $actualSize = (Get-Item $abs).Length
      if ($actualSize -ne $asset.size) {
        $failures.Add("Semantic native host asset size mismatch for $($asset.relativePath): manifest $($asset.size), on disk $actualSize.")
        continue
      }
      $actualHash = (Get-FileHash -Algorithm SHA256 $abs).Hash.ToLower()
      if ($actualHash -ne ([string]$asset.sha256).ToLower()) {
        $failures.Add("Semantic native host asset checksum mismatch for $($asset.relativePath) (corrupted or tampered).")
        continue
      }
      $checked++
    }
    Write-Host "Semantic native host: $checked/$(@($semantic.assets).Count) assets checksum-verified (zvec $($semantic.zvecVersion))."
  } else {
    $warnings.Add("Semantic native host (Zvec) is not included in this build. Run 'npm run prepare:zvec-host' to stage it; semantic search is an optional feature and AWKIT starts normally without it.")
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
