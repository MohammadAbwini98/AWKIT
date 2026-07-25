<#
.SYNOPSIS
  Phase 0D SB - real per-user NSIS install / launch / relaunch / uninstall matrix.

.DESCRIPTION
  Runs the authorized matrix against the built NSIS installer using the CURRENT standard user
  account. electron-builder is configured perMachine=false + allowElevation=false, so a per-user
  install must complete with no UAC prompt at all.

  Security prompts are NOT bypassed programmatically. `/S` selects the installer's own silent
  per-user mode; it does not suppress, auto-answer, or circumvent a UAC/SmartScreen dialog. If
  Windows were to demand elevation, the install would fail here rather than be forced through -
  and that failure is the reportable result.
#>
param(
  [string]$Installer = "dist\SpecterStudio Setup 0.1.0.exe"
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

$reportDir = Join-Path $env:LOCALAPPDATA "SpecterStudio\zvec-phase-0\reports"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$userData = Join-Path $env:LOCALAPPDATA "SpecterStudio"
$steps = @()

function Step($name, $ok, $detail) {
  $script:steps += [pscustomobject]@{ step = $name; result = $(if ($ok) { "PASS" } else { "FAIL" }); detail = "$detail" }
  Write-Host ("  {0,-4} {1} - {2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $detail)
}

function Get-Elevation {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Find-UninstallEntry {
  foreach ($hive in @("HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")) {
    Get-ChildItem $hive -EA SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath -EA SilentlyContinue
      if ($p.DisplayName -like "*SpecterStudio*") { return $p }
    }
  }
  return $null
}

if (-not (Test-Path $Installer)) { throw "Installer not found: $Installer" }

Write-Host "=== Phase 0D B: NSIS per-user matrix ==="
Write-Host "Running elevated: $(Get-Elevation)  (expect False)"

# Snapshot pre-existing user data so we can prove it survives uninstall by design.
$userDataBefore = if (Test-Path $userData) { (Get-ChildItem $userData -Recurse -File -EA SilentlyContinue | Measure-Object).Count } else { 0 }
Step "runningAsStandardUser" (-not (Get-Elevation)) "elevated=$(Get-Elevation); user data files before = $userDataBefore"

# -- 1-3. Install without elevation --
$before = Get-Date
$proc = Start-Process -FilePath $Installer -ArgumentList "/S" -PassThru -Wait
Step "installerExitCode" ($proc.ExitCode -eq 0) "exit=$($proc.ExitCode)"

$entry = Find-UninstallEntry
$installDir = $null
if ($entry) { $installDir = $entry.InstallLocation }
if (-not $installDir) { $installDir = Join-Path $env:LOCALAPPDATA "Programs\specterstudio" }

Step "installDirectoryExists" (Test-Path $installDir) "$installDir"
Step "installedPerUser" ($installDir -like "$env:LOCALAPPDATA*") "per-user location (no admin path)"
Step "noElevationRequired" (-not (Get-Elevation)) "install completed while unelevated; allowElevation=false, perMachine=false"
Step "uninstallRegistryEntryPresent" ($null -ne $entry) "$(if($entry){$entry.DisplayName + ' ' + $entry.DisplayVersion})"

$exe = Join-Path $installDir "SpecterStudio.exe"
Step "installedExeExists" (Test-Path $exe) "$exe"

# Shortcuts
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$shortcuts = @(Get-ChildItem $startMenu -Recurse -Filter "SpecterStudio*.lnk" -EA SilentlyContinue)
Step "startMenuShortcutCreated" ($shortcuts.Count -gt 0) "$($shortcuts.Count) shortcut(s)"

# -- 4-6. Launch installed app + packaged Zvec host health/CRUD --
if (Test-Path $exe) {
  Get-ChildItem $reportDir -Filter 'app-mode-native-host-*.json' -EA SilentlyContinue | Remove-Item -Force
  $env:AWKIT_ZVEC_SPIKE_HOST = "native-host"
  $p = Start-Process -FilePath $exe -PassThru
  $dl = (Get-Date).AddSeconds(180); $rep = $null
  while ((Get-Date) -lt $dl) {
    $rep = Get-ChildItem $reportDir -Filter 'app-mode-native-host-*.json' -EA SilentlyContinue | Select-Object -First 1
    if ($rep) { break }
    Start-Sleep -Seconds 3
  }
  Start-Sleep -Seconds 4
  if ($rep) {
    $j = Get-Content $rep.FullName -Raw | ConvertFrom-Json
    $okSteps = @($j.steps | Where-Object { $_.ok }).Count
    $allSteps = @($j.steps).Count
    Step "installedAppZvecHealthAndCrud" ($j.ok -eq $true) "$okSteps/$allSteps steps from installed location"
    Step "collectionUnderLocalAppData" ($j.generationPath -like "$env:LOCALAPPDATA*") "$($j.generationPath)"
  } else {
    Step "installedAppZvecHealthAndCrud" $false "no report produced"
  }
  Remove-Item Env:AWKIT_ZVEC_SPIKE_HOST -EA SilentlyContinue

  # -- 7-8. Close and relaunch, confirm persistence of user data --
  Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
  Start-Sleep -Seconds 3
  Step "noProcessAfterClose" (@(Get-Process SpecterStudio -EA SilentlyContinue).Count -eq 0) "0 processes"

  $p2 = Start-Process -FilePath $exe -PassThru
  Start-Sleep -Seconds 25
  $alive = @(Get-Process SpecterStudio -EA SilentlyContinue).Count -gt 0
  $win = $null
  if ($alive) { $win = (Get-Process SpecterStudio -EA SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1) }
  Step "relaunchReachesWindow" ($null -ne $win) "$(if($win){"title='$($win.MainWindowTitle)'"}else{'no titled window'})"
  Step "userDataPersisted" (Test-Path (Join-Path $userData "ui-settings.json")) "ui-settings.json present after relaunch"
  Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
  Start-Sleep -Seconds 3
}

# -- 9-13. Uninstall --
$uninstaller = $null
if ($entry -and $entry.UninstallString) {
  $uninstaller = ($entry.UninstallString -replace '"','')
} elseif (Test-Path (Join-Path $installDir "Uninstall SpecterStudio.exe")) {
  $uninstaller = Join-Path $installDir "Uninstall SpecterStudio.exe"
}

if ($uninstaller -and (Test-Path $uninstaller)) {
  $u = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru -Wait
  Start-Sleep -Seconds 6
  Step "uninstallerExitCode" ($u.ExitCode -eq 0) "exit=$($u.ExitCode)"
  Step "installDirectoryRemoved" (-not (Test-Path $exe)) "SpecterStudio.exe removed"
  $shortcutsAfter = @(Get-ChildItem $startMenu -Recurse -Filter "SpecterStudio*.lnk" -EA SilentlyContinue)
  Step "shortcutsRemoved" ($shortcutsAfter.Count -eq 0) "$($shortcutsAfter.Count) remaining"
  Step "uninstallRegistryEntryRemoved" ($null -eq (Find-UninstallEntry)) "HKCU uninstall key cleared"
  Step "noProcessRemains" (@(Get-Process SpecterStudio -EA SilentlyContinue).Count -eq 0) "0 SpecterStudio processes"
  $userDataAfter = if (Test-Path $userData) { (Get-ChildItem $userData -Recurse -File -EA SilentlyContinue | Measure-Object).Count } else { 0 }
  Step "userDataSurvivesByDesign" (Test-Path $userData) "$userDataAfter files retained under %LOCALAPPDATA%\SpecterStudio"
} else {
  Step "uninstallerLocated" $false "no uninstall string found"
}

# -- 14. Defender --
try {
  $mp = Get-MpComputerStatus -EA Stop
  Step "defenderActiveDuringMatrix" ($mp.RealTimeProtectionEnabled) "RTP=$($mp.RealTimeProtectionEnabled) AV=$($mp.AntivirusEnabled) sigs=$($mp.AntivirusSignatureVersion)"
  $threats = @(Get-MpThreatDetection -EA SilentlyContinue | Where-Object { $_.InitialDetectionTime -gt $before })
  Step "noDefenderDetections" ($threats.Count -eq 0) "$($threats.Count) detections since install started"
} catch {
  Step "defenderStatusReadable" $false "$($_.Exception.Message)"
}

Write-Host "`n=== NSIS MATRIX SUMMARY ==="
$steps | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$fails = @($steps | Where-Object { $_.result -eq "FAIL" }).Count
$outFile = Join-Path $reportDir "nsis-matrix-$(Get-Date -Format yyyyMMdd-HHmmss).json"
$steps | ConvertTo-Json -Depth 5 | Set-Content -Path $outFile -Encoding utf8
Write-Host "Report: $outFile"
Write-Host $(if ($fails -eq 0) { "NSIS MATRIX PASSED" } else { "NSIS MATRIX: $fails FAILED" })
