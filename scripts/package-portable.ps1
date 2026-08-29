$ErrorActionPreference = "Stop"

# Same [STEP] convention as release-portable.ps1: the roadmap dashboard parses these lines from the
# pipeline's stdout to drive its progress bar, so each stage must emit exactly one before it runs.
function Write-Step ([string]$msg) { Write-Host "[STEP]  $msg" }

# The portable target compresses the staged offline payload in a 7za.exe child. With the bounded
# level-5 policy below, the current ~828 MiB payload has been measured at about 654 MiB of private
# commit. Keep more than twice that amount available so 7za, makensis, electron-builder and Windows
# have deterministic headroom. This is Windows commit (RAM + pagefile), not free disk space.
$MinimumPackagingCommitHeadroomMiB = 1536

function Assert-PackagingCommitHeadroom {
    try {
        $operatingSystem = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    } catch {
        throw "Unable to query free Windows commit before portable packaging. Verify Windows Management Instrumentation and retry."
    }

    $availableMiB = [int64][Math]::Floor(([double]$operatingSystem.FreeVirtualMemory) / 1024)
    $commitLimitMiB = [int64][Math]::Floor(([double]$operatingSystem.TotalVirtualMemorySize) / 1024)
    if ($availableMiB -lt $MinimumPackagingCommitHeadroomMiB) {
        throw (
            "Insufficient free Windows commit for portable packaging: {0} MiB available of {1} MiB; " +
            "at least {2} MiB is required for the bounded-memory 7-Zip stage. Close memory-heavy " +
            "applications or services, or increase the Windows pagefile, then retry."
        ) -f $availableMiB, $commitLimitMiB, $MinimumPackagingCommitHeadroomMiB
    }

    Write-Host (
        "Packaging memory preflight: {0} MiB free Windows commit of {1} MiB " +
        "({2} MiB minimum)."
    ) -f $availableMiB, $commitLimitMiB, $MinimumPackagingCommitHeadroomMiB
}

Write-Step "Validating offline packaging inputs"
& (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -PackagingInputsOnly
if ($LASTEXITCODE -ne 0) { throw "offline packaging preflight failed with exit code $LASTEXITCODE" }

Write-Step "Building the application bundle"
npm run build
if ($LASTEXITCODE -ne 0) { throw "build failed with exit code $LASTEXITCODE" }

# Stage the raw, unbundled Zvec utility host BEFORE the manifest is generated, so its checksums
# describe the exact tree electron-builder will ship via extraResources.
Write-Step "Staging the Zvec utility host"
node (Join-Path $PSScriptRoot "prepare-zvec-native-host.mjs")
if ($LASTEXITCODE -ne 0) { throw "prepare-zvec-native-host failed with exit code $LASTEXITCODE" }

# A portable release must never inherit the developer's application/security database. Run after
# staging so the gate inspects the exact app + extraResources input trees that will be signed.
Write-Step "Checking portable fresh-state isolation"
npm run verify:portable-fresh-state
if ($LASTEXITCODE -ne 0) { throw "portable fresh-state gate failed with exit code $LASTEXITCODE" }

Write-Step "Generating the dependency manifest"
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "generate-dependency-manifest.ps1") -BuildMode "production-offline"
if ($LASTEXITCODE -ne 0) { throw "dependency manifest generation failed with exit code $LASTEXITCODE" }

Write-Step "Running strict offline validation"
powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-offline-bundle.ps1") -Strict
if ($LASTEXITCODE -ne 0) { throw "strict offline validation failed with exit code $LASTEXITCODE" }

Write-Step "Packaging the portable EXE"
. (Join-Path $PSScriptRoot "lib\set-packaging-compression.ps1")
Assert-PackagingCommitHeadroom
npx electron-builder --win portable --config electron-builder.json
# $ErrorActionPreference="Stop" does NOT trip on a native-exe non-zero exit; check explicitly so a
# failed pack can't masquerade as success and leave a stale EXE on disk.
if ($LASTEXITCODE -ne 0) { throw "electron-builder (portable) failed with exit code $LASTEXITCODE" }

Write-Step "Writing the artifact provenance"
$packageJson = Get-Content -Raw (Join-Path $PSScriptRoot "..\package.json") | ConvertFrom-Json
$artifact = Join-Path $PSScriptRoot "..\dist\SpecterStudio $($packageJson.version).exe"
node (Join-Path $PSScriptRoot "write-artifact-provenance.mjs") --artifact $artifact --kind portable
if ($LASTEXITCODE -ne 0) { throw "portable artifact provenance failed with exit code $LASTEXITCODE" }

Write-Host "Portable package created under dist/."
