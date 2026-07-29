<#
.SYNOPSIS
  Click at an exact screen coordinate INSIDE the guest, driven from the host.

.DESCRIPTION
  Hyper-V's synthetic pointer is unusable on this host: Msvm_SyntheticMouse accepts
  SetAbsolutePosition and reports success, but the guest pointer never moves, so the subsequent
  ClickButton fires wherever the real cursor happens to sit. Measured three times at three different
  coordinates, each producing the same wrong result (the app window's title-bar controls), and
  opening a VMConnect console did not change it.

  So the click is issued from inside the guest instead, via user32 SetCursorPos + mouse_event, run as
  the logged-on standard user through a scheduled task (PowerShell Direct lands in session 0 and
  cannot reach the interactive desktop).

  This uses only PowerShell and user32, both part of Windows. Nothing is installed, so constraints
  1.2-1.4 (no source tree, no dev server, no global Node) remain satisfied and the machine under test
  stays clean - the same reasoning that already applies to vm-focus-app.ps1.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [string] $GuestAdmin = "awkitadmin",
  [string] $GuestPassword = "Awkit!CleanVM2026",
  [string] $GuestUser = "awkituser",
  [Parameter(Mandatory = $true)][int] $X,
  [Parameter(Mandatory = $true)][int] $Y,
  [switch] $MoveOnly,
  [int] $Scroll = 0
)

$ErrorActionPreference = "Stop"
$cred = New-Object System.Management.Automation.PSCredential($GuestAdmin, (ConvertTo-SecureString $GuestPassword -AsPlainText -Force))

$result = Invoke-Command -VMName $VMName -Credential $cred -ScriptBlock {
  param($user, $px, $py, $moveOnly, $scroll)

  $snippet = @'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Ptr {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public struct POINT { public int X; public int Y; }
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP   = 0x0004;
  public const uint WHEEL    = 0x0800;
}
"@
[Ptr]::SetCursorPos(__X__, __Y__) | Out-Null
Start-Sleep -Milliseconds 200
$p = New-Object Ptr+POINT
[Ptr]::GetCursorPos([ref]$p) | Out-Null
if (__SCROLL__ -ne 0) {
  # One wheel notch is 120 units; positive scrolls up (away from the user).
  #
  # mouse_event takes dwData as a SIGNED delta but the P/Invoke signature is uint32, and
  # [uint32](-120) THROWS in PowerShell ("Value was either too large or too small") - it does not
  # wrap. That threw inside the scheduled task, so every scroll-down was silently a no-op: the task
  # died before the marker file was written, yet the marker from the preceding move still existed,
  # so the caller saw a plausible "at:x,y" and no error. Wrap to two's complement explicitly.
  $delta = __SCROLL__ * 120
  $dw = if ($delta -lt 0) { [uint32](4294967296 + $delta) } else { [uint32]$delta }
  [Ptr]::mouse_event([Ptr]::WHEEL, 0, 0, $dw, [IntPtr]::Zero)
} elseif (__CLICK__) {
  [Ptr]::mouse_event([Ptr]::LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [Ptr]::mouse_event([Ptr]::LEFTUP, 0, 0, 0, [IntPtr]::Zero)
}
"at:$($p.X),$($p.Y)" | Set-Content -Encoding ascii "$env:LOCALAPPDATA\awkit-click.txt"
'@
  $snippet = $snippet.Replace("__X__", "$px").Replace("__Y__", "$py").Replace("__SCROLL__", "$scroll").Replace("__CLICK__", $(if ($moveOnly) { '$false' } else { '$true' }))

  $path = "C:\Users\$user\AppData\Local\awkit-click.ps1"
  Set-Content -Path $path -Value $snippet -Encoding ascii
  $marker = "C:\Users\$user\AppData\Local\awkit-click.txt"
  Remove-Item $marker -Force -ErrorAction SilentlyContinue

  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"" + $path + "`"")
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName "AwkitGuestClick" -Action $action -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName "AwkitGuestClick"

  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 400
    if (Test-Path $marker) { return (Get-Content $marker -Raw).Trim() }
  }
  return "no-result"
} -ArgumentList @($GuestUser, $X, $Y, [bool]$MoveOnly, $Scroll)

Write-Output ("guest pointer " + $(if ($MoveOnly) { "moved" } else { "clicked" }) + " -> " + $result)
