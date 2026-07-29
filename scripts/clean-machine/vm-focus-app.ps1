<#
.SYNOPSIS
  Bring the SpecterStudio window to the foreground inside the guest, deterministically.

.DESCRIPTION
  Host-side synthetic keystrokes go to whatever window currently has focus. Without this, keys
  intended for the application land in the Windows shell - which is exactly what happened on the
  first attempt: a password was typed into the Start menu and opened the Widgets panel.

  Alt+Tab is not a fix: its ordering is not predictable. This calls SetForegroundWindow on the real
  window handle instead.

  It runs a short PowerShell snippet via a scheduled task in the logged-on user's session, because
  PowerShell Direct lands in session 0 and cannot manipulate a session 1 window. That snippet uses
  only PowerShell and user32.dll, both part of Windows - nothing is installed, so constraints 1.2-1.4
  (no source tree, no dev server, no global Node) are untouched.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [string] $GuestAdmin = "awkitadmin",
  [string] $GuestPassword = "Awkit!CleanVM2026",
  [string] $GuestUser = "awkituser",
  [string] $ProcessName = "SpecterStudio"
)

$ErrorActionPreference = "Stop"
$cred = New-Object System.Management.Automation.PSCredential($GuestAdmin, (ConvertTo-SecureString $GuestPassword -AsPlainText -Force))

$result = Invoke-Command -VMName $VMName -Credential $cred -ScriptBlock {
  param($user, $procName)

  $snippet = @'
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  public static IntPtr FindByTitle(string needle) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      string t = sb.ToString();
      if (t.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
# Enumerate TOP-LEVEL windows by title. Electron reports MainWindowHandle = 0 on every one of its
# processes here, so a Get-Process based lookup finds nothing even while the window is plainly on
# screen.
$h = [Fg]::FindByTitle("PROCNAME")
if ($h -ne [IntPtr]::Zero) {
  [Fg]::ShowWindow($h, 9) | Out-Null
  [Fg]::BringWindowToTop($h) | Out-Null
  [Fg]::SetForegroundWindow($h) | Out-Null
  "focused:$h" | Set-Content -Encoding ascii "$env:LOCALAPPDATA\awkit-focus.txt"
} else {
  "no-window" | Set-Content -Encoding ascii "$env:LOCALAPPDATA\awkit-focus.txt"
}
'@
  $snippet = $snippet.Replace("PROCNAME", $procName)
  $path = "C:\Users\$user\AppData\Local\awkit-focus.ps1"
  Set-Content -Path $path -Value $snippet -Encoding ascii

  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"" + $path + "`"")
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName "AwkitFocusApp" -Action $action -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName "AwkitFocusApp"
  Start-Sleep -Seconds 4
  $marker = "C:\Users\$user\AppData\Local\awkit-focus.txt"
  if (Test-Path $marker) { Get-Content $marker -Raw } else { "no-result" }
} -ArgumentList @($GuestUser, $ProcessName)

Write-Output ("focus: " + $result.Trim())
