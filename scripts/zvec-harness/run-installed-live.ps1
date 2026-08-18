<#
  Phase 1A: verify the Zvec native host in the INSTALLED (NSIS) layout, driven through
  ZvecUtilityHostManager.

  The installed tree is a different layout from dist/win-unpacked, so it is verified separately:
  install per-user (no elevation), run the manager-based live suite against the installed host,
  then uninstall and confirm the tree is gone.

  `/currentuser /S` explicitly selects the installer's supported silent per-user mode. No security
  prompt is bypassed, suppressed, or auto-answered; if Windows demanded elevation the install would
  fail here and that failure is the reportable result.
#>
param(
  # Empty by default and resolved from package.json below, so the harness installs the version this
  # repository actually builds. A pinned default silently exercised a July 0.1.0 installer.
  [string]$Installer = ""
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if (-not $Installer) {
  $appVersion = (Get-Content -Raw (Join-Path $root "package.json") | ConvertFrom-Json).version
  $Installer = "distSpecterStudio Setup $appVersion.exe"
}
Set-Location $root
. (Join-Path $root "scripts\lib\nsis-per-user-install.ps1")

$steps = @()
function Step($name, $ok, $detail) {
  $script:steps += [pscustomobject]@{ step = $name; result = $(if ($ok) { "PASS" } else { "FAIL" }); detail = "$detail" }
  Write-Host ("  {0,-4} {1} - {2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $detail)
}
function Elevated {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Find-Entry {
  $found = $null
  foreach ($k in (Get-ChildItem "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" -EA SilentlyContinue)) {
    $p = Get-ItemProperty $k.PSPath -EA SilentlyContinue
    if ($p.DisplayName -like "*SpecterStudio*") { $found = $p; break }
  }
  return $found
}

if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }
Write-Host "=== Zvec live verification in the INSTALLED layout ==="
Step "runningUnelevated" (-not (Elevated)) "elevated=$(Elevated)"

# ── install ──
$installArguments = Get-AwkitNsisPerUserSilentArguments
$proc = Start-Process -FilePath $Installer -ArgumentList $installArguments -PassThru -Wait

$installDir = Join-Path $env:LOCALAPPDATA "Programs\SpecterStudio"
$installedHost = Join-Path $installDir "resources\native-hosts\zvec\zvec-host.cjs"
$installOutcome = Test-AwkitNsisInstallOutcome -ExitCode $proc.ExitCode -Installed (Test-Path $installedHost)
Step "installerExitCode" $installOutcome.Success ("exit=" + $installOutcome.ExitCodeHex + "; installed=" + $installOutcome.Installed)
Step "installerNoSystemDllCrash" (-not $installOutcome.SystemDllCrash) ("exit=" + $installOutcome.ExitCodeHex + "; 0xC0000005 is the observed NSIS System.dll crash")
Step "installedPerUser" ($installDir -like "$env:LOCALAPPDATA*") $installDir
Step "installedHostPresent" (Test-Path $installedHost) $installedHost
Step "installedBindingOutsideAsar" (Test-Path (Join-Path $installDir "resources\native-hosts\zvec\node_modules\@zvec\bindings-win32-x64\zvec_node_binding.node")) "binding present in the installed tree"

# ── live suites against the INSTALLED host ──
# Three suites, because they prove different things. The native-contract suite runs the shared
# SemanticStore contract through the installed host; the manager suite covers host lifecycle,
# degraded assets and the circuit breaker; the rebuild suite covers the generation runtime — real
# candidate build, activation, retarget, restart and rollback. The installed tree is a DIFFERENT
# layout from dist/win-unpacked, so none of those results carries over from the packaged run.
$suites = @(
  @{ name = "installedNativeContract"; script = "scripts/verify-semantic-zvec-native-contract.mts" },
  @{ name = "installedLiveSuite"; script = "scripts/verify-zvec-packaged-live.mts" },
  @{ name = "installedRebuildSuite"; script = "scripts/verify-semantic-rebuild-live.mts" }
)
foreach ($suite in $suites) {
  if (Test-Path $installedHost) {
    $env:AWKIT_ZVEC_LIVE_HOST_PATH = $installedHost
    $out = & npx tsx $suite.script 2>&1 | Out-String
    $code = $LASTEXITCODE
    Remove-Item Env:AWKIT_ZVEC_LIVE_HOST_PATH -EA SilentlyContinue
    Write-Host $out
    $m = [regex]::Match($out, '(\d+)\s+passed,\s+(\d+)\s+failed')
    $p = if ($m.Success) { [int]$m.Groups[1].Value } else { 0 }
    $f = if ($m.Success) { [int]$m.Groups[2].Value } else { -1 }
    Step $suite.name ($code -eq 0 -and $f -eq 0) "$p passed, $f failed"
  } else {
    Step $suite.name $false "installed host missing; suite not run"
  }
}

# ── uninstall ──
$entry = Find-Entry
$uninstaller = Join-Path $installDir "Uninstall SpecterStudio.exe"
if (Test-Path $uninstaller) {
  Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
  Start-Sleep -Seconds 2
  $u = Start-Process -FilePath $uninstaller -ArgumentList "/currentuser", "/S" -PassThru -Wait
  Start-Sleep -Seconds 8
  Step "uninstallerExitCode" ($u.ExitCode -eq 0) "exit=$($u.ExitCode)"
  Step "installedHostRemoved" (-not (Test-Path $installedHost)) "native host tree gone"
  Step "uninstallRegistryEntryRemoved" ($null -eq (Find-Entry)) "HKCU key cleared"
  # An empty install directory is known cosmetic NSIS residue; remove it so the machine is left clean.
  if ((Test-Path $installDir) -and (@(Get-ChildItem $installDir -Recurse -File -EA SilentlyContinue).Count -eq 0)) {
    Remove-Item -LiteralPath $installDir -Recurse -Force -EA SilentlyContinue
  }
  Step "installDirectoryClean" (-not (Test-Path $installDir)) "empty-dir residue removed"
} else {
  Step "uninstallerLocated" $false "uninstaller not found at $uninstaller"
}

Write-Host "`n=== SUMMARY ==="
$steps | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$fails = @($steps | Where-Object { $_.result -eq "FAIL" }).Count
$rep = Join-Path $env:LOCALAPPDATA "SpecterStudio\zvec-phase-0\reports"
New-Item -ItemType Directory -Force -Path $rep | Out-Null
$steps | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $rep "installed-live-$(Get-Date -Format yyyyMMdd-HHmmss).json") -Encoding utf8
Write-Host $(if ($fails -eq 0) { "INSTALLED LIVE VERIFICATION PASSED" } else { "INSTALLED LIVE VERIFICATION: $fails FAILED" })
exit $(if ($fails -eq 0) { 0 } else { 1 })
