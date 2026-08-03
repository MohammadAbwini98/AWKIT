<#
.SYNOPSIS
    Build a portable SpecterStudio .exe with automatic version increment.

.DESCRIPTION
    Requires a clean main branch, bumps package.json and package-lock.json
    together, commits only those version files, runs the guarded portable
    packaging chain, commits the signed release manifest pair, and reports
    the output artifact path.

    Version bump strategy (choose one via -BumpType):
      patch  -- 1.0.0 -> 1.0.1  (default)
      minor  -- 1.0.1 -> 1.1.0  (resets patch)
      major  -- 1.1.0 -> 2.0.0  (resets minor + patch)

.PARAMETER BumpType
    Which semver segment to increment. Defaults to "patch".

.PARAMETER DryRun
    Print what would happen (new version, artifact name) but make no
    changes to package.json and do not run the build.

.PARAMETER SkipOfflineValidation
    Skip the offline-bundle pre-flight check.

.PARAMETER Force
    Do not prompt for confirmation before proceeding.

.EXAMPLE
    .\scripts\release-portable.ps1

.EXAMPLE
    .\scripts\release-portable.ps1 -BumpType minor

.EXAMPLE
    .\scripts\release-portable.ps1 -DryRun
#>

[CmdletBinding(SupportsShouldProcess)]
param (
    [ValidateSet("patch", "minor", "major")]
    [string] $BumpType = "patch",

    [switch] $DryRun,
    [switch] $SkipOfflineValidation,
    [switch] $Force
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ---- helpers ----------------------------------------------------------------
function Write-Step  ([string]$msg) { Write-Host "[STEP]  $msg" -ForegroundColor Cyan   }
function Write-Ok    ([string]$msg) { Write-Host "[OK]    $msg" -ForegroundColor Green  }
function Write-Warn  ([string]$msg) { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Fail  ([string]$msg) { Write-Host "[FAIL]  $msg" -ForegroundColor Red    }

# ---- paths ------------------------------------------------------------------
$RepoRoot    = Resolve-Path (Join-Path $PSScriptRoot "..")
$PackageJson = Join-Path $RepoRoot "package.json"
$PackageLock = Join-Path $RepoRoot "package-lock.json"
$ScriptsDir  = $PSScriptRoot

function Restore-GeneratedReleaseFiles {
    & git -C $RepoRoot restore -- "resources/dependency-manifest.json" "resources/dependency-manifest.sig"
    if ($LASTEXITCODE -ne 0) { throw "Could not restore generated release files after a failed package." }
}

# ---- 0. release workspace guard --------------------------------------------
Write-Step "Checking clean main-branch release workspace"
$branch = (& git -C $RepoRoot branch --show-current).Trim()
if ($LASTEXITCODE -ne 0 -or $branch -ne "main") {
    Write-Fail "Portable releases must run from the main branch."
    exit 1
}
$initialChanges = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw "Could not inspect the release workspace." }
if ($initialChanges.Count -gt 0) {
    Write-Fail "Portable release requires a clean working tree; no files were changed."
    $initialChanges | ForEach-Object { Write-Host "  $_" }
    exit 1
}

# ---- 1. read current version ------------------------------------------------
Write-Step "Reading current version from package.json"
$pkg            = Get-Content -Raw $PackageJson | ConvertFrom-Json
$currentVersion = $pkg.version

if ($currentVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Fail "Unexpected version format: $currentVersion (expected X.Y.Z)"
    exit 1
}

[int]$vMajor, [int]$vMinor, [int]$vPatch = $currentVersion -split '\.'

# ---- 2. compute next version ------------------------------------------------
switch ($BumpType) {
    "major" { $vMajor++; $vMinor = 0; $vPatch = 0 }
    "minor" { $vMinor++; $vPatch = 0 }
    "patch" { $vPatch++ }
}

$nextVersion  = "$vMajor.$vMinor.$vPatch"
$artifactName = "SpecterStudio $nextVersion.exe"
$artifactPath = Join-Path (Join-Path $RepoRoot "dist") $artifactName

Write-Host ""
Write-Host "  Current version : $currentVersion"
Write-Host "  Next version    : $nextVersion"
Write-Host "  Bump type       : $BumpType"
Write-Host "  Output artifact : dist\$artifactName"
Write-Host ""

# ---- 3. dry-run exit --------------------------------------------------------
if ($DryRun) {
    Write-Warn "DryRun -- no files modified, no build executed."
    exit 0
}

# ---- 4. confirm -------------------------------------------------------------
if (-not $Force) {
    $answer = Read-Host "Proceed? Bump to $nextVersion and build portable EXE [Y/n]"
    if ($answer -and $answer -notmatch '^[Yy]') {
        Write-Warn "Aborted by user."
        exit 0
    }
}

# ---- 5. offline pre-flight ---------------------------------------------------
if (-not $SkipOfflineValidation) {
    Write-Step "Running offline packaging pre-flight"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "validate-offline-bundle.ps1") -PackagingInputsOnly
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Offline pre-flight failed (exit $LASTEXITCODE)."
        Write-Warn "Tip: run  npm run offline:prepare  then retry."
        exit 1
    }
    Write-Ok "Pre-flight passed."
} else {
    Write-Warn "Skipping the early pre-flight; package-portable.ps1 still enforces its release gates."
}

# ---- 6. bump both package metadata files ------------------------------------
Write-Step "Bumping package.json and package-lock.json to $nextVersion"
Push-Location $RepoRoot
try {
    npm version $nextVersion --no-git-tag-version
    if ($LASTEXITCODE -ne 0) { throw "npm version failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }
$updatedPackage = Get-Content -Raw $PackageJson | ConvertFrom-Json
$updatedLock = Get-Content -Raw $PackageLock | ConvertFrom-Json
$updatedLockRootVersion = $updatedLock.packages.PSObject.Properties[""].Value.version
if ($updatedPackage.version -ne $nextVersion -or
    $updatedLock.version -ne $nextVersion -or
    $updatedLockRootVersion -ne $nextVersion) {
    & git -C $RepoRoot restore -- "package.json" "package-lock.json"
    throw "npm version did not synchronize package.json and package-lock.json."
}
Write-Ok "Package metadata updated to $nextVersion."

# ---- 7. commit only the version files ---------------------------------------
Write-Step "Committing the release version"
Push-Location $RepoRoot
try {
    git add -- package.json package-lock.json
    if ($LASTEXITCODE -ne 0) { throw "Could not stage release version files." }
    git commit -m "build(release): bump version to $nextVersion"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not commit release version $nextVersion."
    }
} finally { Pop-Location }
Write-Ok "Committed the release version."

$postVersionChanges = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw "Could not verify the version checkpoint." }
if ($postVersionChanges.Count -gt 0) {
    throw "Version checkpoint is not clean; refusing to generate a release manifest."
}

# ---- 8. run the canonical guarded packaging pipeline ------------------------
Write-Step "Running the guarded portable packaging pipeline"
& powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "package-portable.ps1")
if ($LASTEXITCODE -ne 0) {
    Restore-GeneratedReleaseFiles
    throw "Portable packaging failed (exit $LASTEXITCODE). Version $nextVersion remains committed for diagnosis."
}
Write-Ok "Portable packaging completed."

# ---- 9. commit only the signed release manifest -----------------------------
$releaseChanges = @(& git -C $RepoRoot status --porcelain --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw "Could not inspect generated release files." }
$unexpectedChanges = @($releaseChanges | Where-Object {
    $_ -notmatch '^ M resources/dependency-manifest\.(json|sig)$'
})
if ($unexpectedChanges.Count -gt 0) {
    throw "Unexpected files changed during packaging; refusing to stage them."
}
if ($releaseChanges.Count -ne 2) {
    throw "Packaging did not produce the expected signed manifest pair."
}

Write-Step "Committing the signed release manifest"
Push-Location $RepoRoot
try {
    git add -- resources/dependency-manifest.json resources/dependency-manifest.sig
    if ($LASTEXITCODE -ne 0) { throw "Could not stage the signed release manifest." }
    git commit -m "build(release): record portable v$nextVersion manifest"
    if ($LASTEXITCODE -ne 0) { throw "Could not commit the signed release manifest." }
} finally { Pop-Location }
Write-Ok "Committed the signed release manifest."

# ---- 10. summary -------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Ok   "Portable EXE released successfully!"
Write-Host "  Version  : $nextVersion" -ForegroundColor Green
Write-Host "  Artifact : $artifactPath" -ForegroundColor Green
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "    npm run verify:packaged-runtime"
Write-Host "    npm run verify:packaged-walkthrough"
Write-Host ""
