<#
.SYNOPSIS
  Click at a screen coordinate inside the VM from the HOST, with no agent in the guest.

.DESCRIPTION
  Uses Msvm_SyntheticMouse (SetAbsolutePosition + ClickButton). Together with vm-screenshot.ps1 this
  closes the loop: read a coordinate off a screenshot, click it.

  This replaces counting Tab presses, which is not viable here. The left navigation scrolls and its
  length depends on the signed-in principal's permissions - a Super User sees the Administration
  group, so a tab count calibrated on one screen overshoots on another. Coordinates read from the
  actual screenshot do not have that problem.

  Hyper-V's absolute pointer space is 0..65535 on both axes, independent of guest resolution, so the
  caller passes ordinary pixel coordinates plus the resolution those pixels were measured at
  (the screenshots are 1024x768).

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [Parameter(Mandatory = $true)][int] $X,
  [Parameter(Mandatory = $true)][int] $Y,
  [int] $ScreenWidth = 1024,
  [int] $ScreenHeight = 768,
  [ValidateSet("Left", "Right", "Middle")][string] $Button = "Left",
  [switch] $MoveOnly,
  [int] $Scroll = 0
)

$ErrorActionPreference = "Stop"

$vm = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$VMName'"
if (-not $vm) { throw "VM not found: $VMName" }
$mouse = Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_SyntheticMouse
if (-not $mouse) { throw "synthetic mouse not available (is the VM running?)" }

# Map pixels to the absolute pointer space, which is 0..32767 - NOT 0..65535.
#
# Measured on this host: any value above 32767 returns 32773 while 32767 and below return 0, i.e.
# the coordinate is treated as SIGNED 16-bit even though the MOF declares uint16. Scaling to 65535
# does not error for small coordinates, it silently lands at roughly double the intended position -
# which is why an earlier scroll aimed at the sidebar did nothing: the pointer was over the content.
$MAX_ABS = 32767
$absX = [uint16][Math]::Round(($X / [double]$ScreenWidth) * $MAX_ABS)
$absY = [uint16][Math]::Round(($Y / [double]$ScreenHeight) * $MAX_ABS)

# SetAbsolutePosition intermittently returns 32773 even with a healthy device (EnabledState 2,
# HealthState 5) - the very next identical call succeeds. Retry rather than fail the step.
$move = $null
for ($attempt = 1; $attempt -le 5; $attempt++) {
  $mouse = Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_SyntheticMouse
  $move = Invoke-CimMethod -InputObject $mouse -MethodName SetAbsolutePosition -Arguments @{
    horizontalPosition = $absX
    verticalPosition   = $absY
  }
  if ($move.ReturnValue -eq 0) { break }
  Start-Sleep -Milliseconds 400
}
if ($move.ReturnValue -ne 0) { throw ("SetAbsolutePosition failed after 5 attempts: " + $move.ReturnValue) }
Start-Sleep -Milliseconds 250

if ($Scroll -ne 0) {
  # Positive scrolls up, negative down. Delta is in wheel units.
  $r = Invoke-CimMethod -InputObject $mouse -MethodName SetScrollPosition -Arguments @{ ScrollPositionDelta = [int]$Scroll }
  if ($r.ReturnValue -ne 0) { throw ("SetScrollPosition failed: " + $r.ReturnValue) }
  Start-Sleep -Milliseconds 200
}

if (-not $MoveOnly -and $Scroll -eq 0) {
  # The parameter is ButtonIndex (not "button"), and it is ONE-BASED: index 0 returns 32773, while
  # 1/2/3 succeed. Both facts were measured on this host; neither is obvious from the MOF.
  $buttonCode = @{ Left = 1; Right = 2; Middle = 3 }[$Button]
  $click = Invoke-CimMethod -InputObject $mouse -MethodName ClickButton -Arguments @{ ButtonIndex = [uint32]$buttonCode }
  if ($click.ReturnValue -ne 0) { throw ("ClickButton failed: " + $click.ReturnValue) }
}

Write-Output ("mouse {0} at ({1},{2}) -> abs ({3},{4})" -f $(if ($MoveOnly) { "moved" } else { "clicked" }), $X, $Y, $absX, $absY)
