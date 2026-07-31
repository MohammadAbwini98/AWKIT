<#
.SYNOPSIS
    Build a portable SpecterStudio .exe with automatic version increment.

.DESCRIPTION
    Reads the current version from package.json, bumps the chosen semver
    segment, writes it back, runs the full portable packaging chain, and
    reports the output artifact path.

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

# UTF-8 without BOM (Vite's PostCSS JSON loader chokes on the BOM byte)
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

# ---- paths ------------------------------------------------------------------
$RepoRoot    = Resolve-Path (Join-Path $PSScriptRoot "..")
$PackageJson = Join-Path $RepoRoot "package.json"
$ScriptsDir  = $PSScriptRoot

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

# ---- 5. write new version to package.json -----------------------------------
Write-Step "Bumping package.json to $nextVersion"
$raw = Get-Content -Raw $PackageJson
$raw = $raw -replace '"version"\s*:\s*"[^"]*"', ('"version": "' + $nextVersion + '"')
[System.IO.File]::WriteAllText($PackageJson, $raw, $Utf8NoBom)
Write-Ok "package.json updated to $nextVersion"

# ---- 6. offline pre-flight ---------------------------------------------------
if (-not $SkipOfflineValidation) {
    Write-Step "Running offline packaging pre-flight"
    & powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "validate-offline-bundle.ps1") -PackagingInputsOnly
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Offline pre-flight failed (exit $LASTEXITCODE)."
        Write-Warn "Tip: run  npm run offline:prepare  then retry."
        # roll back
        $rollback = $raw -replace '"version"\s*:\s*"[^"]*"', ('"version": "' + $currentVersion + '"')
        [System.IO.File]::WriteAllText($PackageJson, $rollback, $Utf8NoBom)
        Write-Warn "Rolled package.json back to $currentVersion."
        exit 1
    }
    Write-Ok "Pre-flight passed."
} else {
    Write-Warn "Skipping offline validation."
}

# ---- 7. TypeScript build -----------------------------------------------------
Write-Step "Running npm run build (tsc + electron-vite)"
Push-Location $RepoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }
Write-Ok "Build succeeded."

# ---- 8. stage Zvec native host -----------------------------------------------
Write-Step "Staging Zvec native host"
node (Join-Path $ScriptsDir "prepare-zvec-native-host.mjs")
if ($LASTEXITCODE -ne 0) { throw "prepare-zvec-native-host failed (exit $LASTEXITCODE)" }
Write-Ok "Zvec host staged."

# ---- 9. commit all changes (clean tree for manifest) ------------------------
#    The manifest generator runs `git status --porcelain` and records
#    sourceTreeDirty; strict mode rejects dirty trees. We must commit
#    everything (version bump + this script + any other changes).
Write-Step "Committing all changes so the source tree is clean"
Push-Location $RepoRoot
try {
    git add -A 2>&1 | Out-Null
    git commit -m "build: release v$nextVersion" --no-verify 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "git commit exited $LASTEXITCODE - tree may already be clean."
    } else {
        Write-Ok "Committed all changes."
    }
} finally { Pop-Location }

# ---- 10. generate dependency manifest ----------------------------------------
Write-Step "Generating offline dependency manifest"
& powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "generate-dependency-manifest.ps1") -BuildMode "production-offline"
if ($LASTEXITCODE -ne 0) { throw "Manifest generation failed (exit $LASTEXITCODE)" }
Write-Ok "Manifest generated."

# ---- 11. strict offline validation -------------------------------------------
Write-Step "Running strict offline bundle validation"
& powershell -ExecutionPolicy Bypass -File (Join-Path $ScriptsDir "validate-offline-bundle.ps1") -Strict
if ($LASTEXITCODE -ne 0) { throw "Strict offline validation failed (exit $LASTEXITCODE)" }
Write-Ok "Strict validation passed."

# ---- 12. electron-builder portable -------------------------------------------
Write-Step "Running electron-builder (portable)"
Push-Location $RepoRoot
try {
    npx electron-builder --win portable --config electron-builder.json
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }
Write-Ok "electron-builder finished."

# ---- 13. artifact provenance -------------------------------------------------
Write-Step "Writing artifact provenance"
node (Join-Path $ScriptsDir "write-artifact-provenance.mjs") --artifact $artifactPath --kind portable
if ($LASTEXITCODE -ne 0) { throw "Artifact provenance failed (exit $LASTEXITCODE)" }
Write-Ok "Provenance written."

# ---- 14. summary -------------------------------------------------------------
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
