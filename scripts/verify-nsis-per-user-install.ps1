<#
  NSIS per-user install regression verifier (awkit-9yc).

  Exercises the production PowerShell helper with the exact 0xC0000005 result observed from the
  clean Windows 11 guest, then guards both installed-layout drivers against returning to bare /S.

  What regression makes this fail? Reordering/removing /currentuser, treating a crash or missing
  install as success, removing the crash sentinel, or bypassing the canonical helper in a driver.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
. (Join-Path $PSScriptRoot "lib\nsis-per-user-install.ps1")

$script:passed = 0
$script:failed = 0
function Check([string] $Name, [bool] $Condition) {
  if ($Condition) {
    $script:passed++
    Write-Host ("  PASS " + $Name)
  } else {
    $script:failed++
    Write-Host ("  FAIL " + $Name) -ForegroundColor Red
  }
}

$arguments = @(Get-AwkitNsisPerUserSilentArguments)
Check "canonical arguments explicitly select current user before silent mode" `
  ($arguments.Count -eq 2 -and $arguments[0] -eq "/currentuser" -and $arguments[1] -eq "/S")
Check "scheduled-task argument string preserves canonical order" `
  ((Get-AwkitNsisPerUserSilentArguments -AsString) -eq "/currentuser /S")

$crash = Test-AwkitNsisInstallOutcome -ExitCode 3221225477 -Installed $false
Check "0xC0000005 is rejected" (-not $crash.Success)
Check "0xC0000005 is classified as the System.dll crash sentinel" `
  ($crash.SystemDllCrash -and $crash.ExitCodeHex -eq "0xC0000005")

$signedCrash = Test-AwkitNsisInstallOutcome -ExitCode -1073741819 -Installed $false
Check "signed process form of 0xC0000005 is classified identically" `
  ($signedCrash.SystemDllCrash -and $signedCrash.ExitCodeHex -eq "0xC0000005")

$missing = Test-AwkitNsisInstallOutcome -ExitCode 0 -Installed $false
Check "exit zero without an installed executable is rejected" (-not $missing.Success)
$success = Test-AwkitNsisInstallOutcome -ExitCode 0 -Installed $true
Check "exit zero with installed executable is accepted" ($success.Success -and -not $success.SystemDllCrash)

$localDriver = Get-Content -Raw (Join-Path $root "scripts\zvec-harness\run-installed-live.ps1")
$vmDriver = Get-Content -Raw (Join-Path $root "scripts\clean-machine\run-runbook.ps1")
Check "installed-live driver uses canonical silent arguments" `
  ($localDriver -match 'Get-AwkitNsisPerUserSilentArguments' -and $localDriver -match 'Test-AwkitNsisInstallOutcome')
Check "clean-machine driver uses canonical silent arguments and outcome classifier" `
  ($vmDriver -match 'Get-AwkitNsisPerUserSilentArguments -AsString' -and $vmDriver -match 'Test-AwkitNsisInstallOutcome')
Check "installed-live driver reports the crash sentinel" ($localDriver -match 'installerNoSystemDllCrash')
Check "clean-machine driver reports the crash sentinel" ($vmDriver -match '7\.1\.crash')
Check "neither install driver contains a bare installer /S action" `
  ($localDriver -notmatch 'Start-Process[^\r\n]+-ArgumentList\s+["'']?/S["'']?' -and `
   $vmDriver -notmatch 'New-ScheduledTaskAction\s+-Execute\s+\$setup\s+-Argument\s+["'']?/S["'']?')

Write-Host ""
Write-Host ($script:passed.ToString() + " passed, " + $script:failed.ToString() + " failed")
if ($script:failed -gt 0) { exit 1 }
Write-Host "NSIS per-user install regression verifier passed"
