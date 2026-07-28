Set-StrictMode -Version Latest

function Get-AwkitOfflineBrowserPolicy {
  param([Parameter(Mandatory = $true)][string]$RootPath)

  $policyPath = Join-Path $RootPath "resources\offline-browser-policy.json"
  if (-not (Test-Path -LiteralPath $policyPath -PathType Leaf)) {
    throw "Offline browser policy is missing: $policyPath"
  }

  try {
    $policy = Get-Content -Raw -LiteralPath $policyPath | ConvertFrom-Json
  } catch {
    throw "Offline browser policy is invalid JSON: $policyPath"
  }

  if ($policy.schemaVersion -ne 1) {
    throw "Offline browser policy schemaVersion must be 1."
  }

  return $policy
}

function Get-AwkitPayloadTreeDigest {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string[]]$ExcludedRelativePaths = @("debug.log")
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "Browser payload directory is missing: $Path"
  }

  $resolvedRoot = (Resolve-Path -LiteralPath $Path).Path.TrimEnd("\")
  $normalisedExclusions = @($ExcludedRelativePaths | ForEach-Object { ([string]$_).Replace("\", "/") })
  $files = @(Get-ChildItem -LiteralPath $resolvedRoot -File -Recurse -Force |
    Where-Object {
      $relative = $_.FullName.Substring($resolvedRoot.Length + 1).Replace("\", "/")
      $normalisedExclusions -notcontains $relative
    } |
    Sort-Object { $_.FullName.Substring($resolvedRoot.Length + 1).Replace("\", "/") })
  $lines = New-Object System.Text.StringBuilder
  [long]$totalBytes = 0

  foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($resolvedRoot.Length + 1).Replace("\", "/")
    $fileHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    [void]$lines.Append($relativePath)
    [void]$lines.Append("`0")
    [void]$lines.Append([string]$file.Length)
    [void]$lines.Append("`0")
    [void]$lines.Append($fileHash)
    [void]$lines.Append("`n")
    $totalBytes += $file.Length
  }

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $digestBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($lines.ToString()))
    $digest = -join ($digestBytes | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha256.Dispose()
  }

  return [ordered]@{
    algorithm = "sha256-tree-v1"
    sha256 = $digest
    fileCount = $files.Count
    totalBytes = $totalBytes
    excludedRelativePaths = $normalisedExclusions
  }
}

function Assert-AwkitPlaywrightPin {
  param(
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][object]$Policy
  )

  $expectedVersion = [string]$Policy.playwright.version
  if ($expectedVersion -notmatch "^\d+\.\d+\.\d+$") {
    throw "Offline browser policy must declare an exact Playwright version."
  }

  $packageJson = Get-Content -Raw -LiteralPath (Join-Path $RootPath "package.json") | ConvertFrom-Json
  foreach ($dependencyName in @("playwright", "@playwright/test")) {
    $declared = if ($packageJson.dependencies.PSObject.Properties.Name -contains $dependencyName) {
      [string]$packageJson.dependencies.PSObject.Properties[$dependencyName].Value
    } elseif ($packageJson.devDependencies.PSObject.Properties.Name -contains $dependencyName) {
      [string]$packageJson.devDependencies.PSObject.Properties[$dependencyName].Value
    } else {
      $null
    }

    if ($declared -ne $expectedVersion) {
      throw "$dependencyName must be pinned exactly to $expectedVersion (found '$declared')."
    }
  }

  foreach ($packageName in @("playwright", "playwright-core")) {
    $installedPath = Join-Path $RootPath "node_modules\$packageName\package.json"
    if (-not (Test-Path -LiteralPath $installedPath -PathType Leaf)) {
      throw "Installed $packageName package is missing: $installedPath"
    }
    $installedVersion = [string]((Get-Content -Raw -LiteralPath $installedPath | ConvertFrom-Json).version)
    if ($installedVersion -ne $expectedVersion) {
      throw "Installed $packageName must be $expectedVersion (found $installedVersion)."
    }
  }

  $browserMetadataPath = Join-Path $RootPath ([string]$Policy.playwright.browserMetadataPath -replace "/", "\")
  $browserMetadata = Get-Content -Raw -LiteralPath $browserMetadataPath | ConvertFrom-Json
  $chromium = $browserMetadata.browsers | Where-Object { $_.name -eq [string]$Policy.browser.name } | Select-Object -First 1
  if ($null -eq $chromium) {
    throw "Installed Playwright metadata has no '$($Policy.browser.name)' browser."
  }
  if ([string]$chromium.revision -ne [string]$Policy.browser.revision -or
      [string]$chromium.browserVersion -ne [string]$Policy.browser.version) {
    throw "Playwright browser metadata does not match the approved revision/version $($Policy.browser.revision)/$($Policy.browser.version)."
  }
}

function Assert-AwkitBrowserArchive {
  param(
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [Parameter(Mandatory = $true)][object]$Policy
  )

  if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "Approved browser archive is missing: $ArchivePath"
  }

  $archive = Get-Item -LiteralPath $ArchivePath
  if ($archive.Length -ne [long]$Policy.browser.archive.size) {
    throw "Browser archive size mismatch: expected $($Policy.browser.archive.size), found $($archive.Length)."
  }

  $actualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne [string]$Policy.browser.archive.sha256) {
    throw "Browser archive SHA-256 mismatch; acquisition is not approved."
  }
}

function Assert-AwkitBrowserTree {
  param(
    [Parameter(Mandatory = $true)][string]$BrowserRoot,
    [Parameter(Mandatory = $true)][object]$Policy
  )

  $executable = Join-Path $BrowserRoot ([string]$Policy.browser.relativeExecutablePath -replace "/", "\")
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "Approved browser executable is missing: $executable"
  }

  $versionInfo = (Get-Item -LiteralPath $executable).VersionInfo
  $actualVersion = [string]$versionInfo.ProductVersion
  if ([string]::IsNullOrWhiteSpace($actualVersion)) {
    $actualVersion = [string]$versionInfo.FileVersion
  }
  $actualVersion = $actualVersion.Trim()
  if ($actualVersion -ne [string]$Policy.browser.version) {
    throw "Browser version mismatch: expected $($Policy.browser.version), found $actualVersion."
  }

  $executableHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($executableHash -ne [string]$Policy.browser.executableSha256) {
    throw "Browser executable SHA-256 mismatch; payload is not approved."
  }

  $actualTree = Get-AwkitPayloadTreeDigest -Path $BrowserRoot -ExcludedRelativePaths @($Policy.browser.payload.excludedRelativePaths)
  if ($actualTree.algorithm -ne [string]$Policy.browser.payload.algorithm -or
      $actualTree.sha256 -ne [string]$Policy.browser.payload.sha256 -or
      $actualTree.fileCount -ne [int]$Policy.browser.payload.fileCount -or
      $actualTree.totalBytes -ne [long]$Policy.browser.payload.totalBytes) {
    throw "Browser payload tree digest mismatch; payload is incomplete, modified, or not approved."
  }

  return $actualTree
}
