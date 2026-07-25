<#
  Phase 0D SB steps 9-13 - uninstall verification.

  Split out after the first matrix run left the app installed: Find-UninstallEntry used `return`
  inside a ForEach-Object block, which does NOT return from the enclosing function, so the entry
  came back as an array and Test-Path rejected it. The registry data itself was always correct.
#>
$ErrorActionPreference = "Continue"
$userData = Join-Path $env:LOCALAPPDATA "SpecterStudio"
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$steps = @()

function Step($name, $ok, $detail) {
  $script:steps += [pscustomobject]@{ step = $name; result = $(if ($ok) { "PASS" } else { "FAIL" }); detail = "$detail" }
  Write-Host ("  {0,-4} {1} - {2}" -f $(if ($ok) { "PASS" } else { "FAIL" }), $name, $detail)
}

# Single-value lookup: capture into a variable instead of relying on `return` inside a pipeline.
$entry = $null
$entryKey = $null
foreach ($k in (Get-ChildItem "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" -EA SilentlyContinue)) {
  $p = Get-ItemProperty $k.PSPath -EA SilentlyContinue
  if ($p.DisplayName -like "*SpecterStudio*") { $entry = $p; $entryKey = $k.PSChildName; break }
}

if (-not $entry) { Write-Host "No SpecterStudio uninstall entry found - nothing to remove."; return }

Write-Host "=== Phase 0D B (9-13): uninstall ==="
Write-Host "entry: $($entry.DisplayName)  key=$entryKey"

# Correct settings location, confirmed on disk: storage\ui-settings.json (not the profile root).
$settings = Join-Path $userData "storage\ui-settings.json"
Step "userDataPresentBeforeUninstall" (Test-Path $settings) "$settings"
$filesBefore = (Get-ChildItem $userData -Recurse -File -EA SilentlyContinue | Measure-Object).Count

$installDir = Join-Path $env:LOCALAPPDATA "Programs\SpecterStudio"
$exe = Join-Path $installDir "SpecterStudio.exe"
$uninstaller = Join-Path $installDir "Uninstall SpecterStudio.exe"
Step "uninstallerLocated" (Test-Path $uninstaller) "$uninstaller"

Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep -Seconds 2

# /currentuser /S is the installer's own per-user silent uninstall; no security prompt is bypassed.
$u = Start-Process -FilePath $uninstaller -ArgumentList "/currentuser", "/S" -PassThru -Wait
Start-Sleep -Seconds 8
Step "uninstallerExitCode" ($u.ExitCode -eq 0) "exit=$($u.ExitCode)"
Step "installedExeRemoved" (-not (Test-Path $exe)) "SpecterStudio.exe gone"
Step "installDirectoryRemoved" (-not (Test-Path $installDir)) "$installDir"

$shortcutsAfter = @(Get-ChildItem $startMenu -Recurse -Filter "SpecterStudio*.lnk" -EA SilentlyContinue)
Step "shortcutsRemoved" ($shortcutsAfter.Count -eq 0) "$($shortcutsAfter.Count) remaining"

$entryAfter = $null
foreach ($k in (Get-ChildItem "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" -EA SilentlyContinue)) {
  $p = Get-ItemProperty $k.PSPath -EA SilentlyContinue
  if ($p.DisplayName -like "*SpecterStudio*") { $entryAfter = $p; break }
}
Step "uninstallRegistryEntryRemoved" ($null -eq $entryAfter) "HKCU uninstall key cleared"
Step "noProcessRemains" (@(Get-Process SpecterStudio -EA SilentlyContinue).Count -eq 0) "0 SpecterStudio processes"

$filesAfter = if (Test-Path $userData) { (Get-ChildItem $userData -Recurse -File -EA SilentlyContinue | Measure-Object).Count } else { 0 }
Step "userDataSurvivesByDesign" ((Test-Path $userData) -and (Test-Path $settings)) "$filesAfter files retained (was $filesBefore); ui-settings.json intact"

Write-Host "`n=== UNINSTALL SUMMARY ==="
$steps | Format-Table -AutoSize | Out-String -Width 200 | Write-Host
$rep = Join-Path $env:LOCALAPPDATA "SpecterStudio\zvec-phase-0\reports"
$out = Join-Path $rep "nsis-uninstall-$(Get-Date -Format yyyyMMdd-HHmmss).json"
$steps | ConvertTo-Json -Depth 5 | Set-Content -Path $out -Encoding utf8
Write-Host "Report: $out"
$fails = @($steps | Where-Object { $_.result -eq "FAIL" }).Count
Write-Host $(if ($fails -eq 0) { "UNINSTALL VERIFICATION PASSED" } else { "UNINSTALL VERIFICATION: $fails FAILED" })
