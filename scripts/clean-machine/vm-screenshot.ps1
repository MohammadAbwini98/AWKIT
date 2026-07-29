<#
.SYNOPSIS
  Capture the VM's console as a PNG, without any agent inside the guest.

.DESCRIPTION
  Uses Msvm_VirtualSystemManagementService.GetVirtualSystemThumbnailImage over WMI, which reads the
  synthetic video framebuffer from the host side. That matters for this gate: the clean machine must
  stay clean, so anything that required installing a capture tool in the guest would contaminate the
  very environment under test (constraint 1.2/1.3).

  The framebuffer is RGB565. Resolution is whatever the guest is currently driving; during Windows
  Setup that is typically 1024x768.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [Parameter(Mandatory = $true)][string] $OutPath,
  [int] $Width = 1024,
  [int] $Height = 768
)

$ErrorActionPreference = "Stop"

$vm = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$VMName'"
if (-not $vm) { throw "VM not found: $VMName" }

$settings = Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_VirtualSystemSettingData |
  Where-Object { $_.VirtualSystemType -like "Microsoft:Hyper-V:System:Realized*" }
if (-not $settings) {
  $settings = Get-CimAssociatedInstance -InputObject $vm -ResultClassName Msvm_VirtualSystemSettingData | Select-Object -First 1
}

$svc = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_VirtualSystemManagementService
$result = Invoke-CimMethod -InputObject $svc -MethodName GetVirtualSystemThumbnailImage -Arguments @{
  TargetSystem  = $settings
  WidthPixels   = [uint16]$Width
  HeightPixels  = [uint16]$Height
}

if ($result.ReturnValue -ne 0) { throw ("GetVirtualSystemThumbnailImage failed: " + $result.ReturnValue) }
$raw = $result.ImageData
if (-not $raw -or $raw.Length -eq 0) { throw "thumbnail returned no data (is the VM running?)" }

Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format16bppRgb565)
$rect = New-Object System.Drawing.Rectangle(0, 0, $Width, $Height)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, $bmp.PixelFormat)
try {
  [System.Runtime.InteropServices.Marshal]::Copy($raw, 0, $data.Scan0, [Math]::Min($raw.Length, $data.Stride * $Height))
} finally {
  $bmp.UnlockBits($data)
}

$dir = Split-Path -Parent $OutPath
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("screenshot: " + $OutPath + " (" + $Width + "x" + $Height + ", " + $raw.Length + " bytes raw)")
