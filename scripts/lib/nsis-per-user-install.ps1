<#
  Canonical NSIS per-user silent-install arguments and outcome classification.

  Electron-builder's assisted installer is configured for both current-user and all-users modes.
  Bare /S leaves that choice implicit and has crashed in the NSIS System.dll plug-in on a clean
  standard-user Windows 11 session. /currentuser must precede /S so the mode is selected before
  silent execution begins.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>

function Get-AwkitNsisPerUserSilentArguments {
  [CmdletBinding()]
  param([switch] $AsString)

  $arguments = @("/currentuser", "/S")
  if ($AsString) { return ($arguments -join " ") }
  return $arguments
}

function Test-AwkitNsisInstallOutcome {
  [CmdletBinding()]
  param(
    [long] $ExitCode,
    [bool] $Installed
  )

  $normalized = [uint32]([uint64]($ExitCode -band 0xFFFFFFFFL))
  $accessViolation = [Convert]::ToUInt32("C0000005", 16)

  [pscustomobject]@{
    ExitCode        = $normalized
    ExitCodeHex     = ("0x{0:X8}" -f $normalized)
    Installed       = $Installed
    SystemDllCrash  = ($normalized -eq $accessViolation)
    Success         = ($normalized -eq 0 -and $Installed)
  }
}
