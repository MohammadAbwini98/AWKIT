<#
.SYNOPSIS
  Send keystrokes to the VM from the HOST, with no agent inside the guest.

.DESCRIPTION
  Uses Msvm_Keyboard on the Hyper-V synthetic keyboard. Combined with vm-screenshot.ps1 this gives a
  complete drive-and-observe loop without installing anything in the machine under test, which is the
  whole point of a clean-machine gate: a UI-automation harness in the guest would violate constraints
  1.2-1.4 and invalidate the result.

  Keyboard-only navigation is viable here because the application's keyboard reachability is itself
  verified elsewhere (REC-029 and SET-021 both audit full keyboard reach and visible focus).

  -Text  types a literal string.
  -Keys  types named keys in order: TAB ENTER ESC SPACE DOWN UP LEFT RIGHT HOME END BKSP DEL.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [string] $Text,
  [string[]] $Keys,
  [int] $DelayMs = 120
)

$ErrorActionPreference = "Stop"

$vm = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$VMName'"
if (-not $vm) { throw "VM not found: $VMName" }
$kb = Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_Keyboard
if (-not $kb) { throw "synthetic keyboard not available (is the VM running?)" }

$codes = @{
  TAB = 0x09; ENTER = 0x0D; ESC = 0x1B; SPACE = 0x20
  DOWN = 0x28; UP = 0x26; LEFT = 0x25; RIGHT = 0x27
  HOME = 0x24; END = 0x23; BKSP = 0x08; DEL = 0x2E
  F5 = 0x74; F10 = 0x79
}

if ($Text) {
  # TypeText handles the shift state for mixed case and symbols; typing char-by-char with TypeKey
  # would lose capitalisation and mangle a password.
  Invoke-CimMethod -InputObject $kb -MethodName TypeText -Arguments @{ asciiText = $Text } | Out-Null
  Start-Sleep -Milliseconds $DelayMs
}

if ($Keys) {
  foreach ($k in $Keys) {
    $name = $k.ToUpperInvariant()
    if (-not $codes.ContainsKey($name)) { throw ("unknown key: " + $k) }
    Invoke-CimMethod -InputObject $kb -MethodName TypeKey -Arguments @{ keyCode = [uint32]$codes[$name] } | Out-Null
    Start-Sleep -Milliseconds $DelayMs
  }
}
