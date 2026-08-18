<#
.SYNOPSIS
  Deliver the release artifacts into the offline VM as a read-only DVD.

.DESCRIPTION
  Section 2 of the runbook says to copy the two artifacts in "via read-only USB or a mapped read-only
  share". A read-only ISO mounted as a DVD is the same thing and works with zero network, which this
  VM has by construction.

  Copying them over Hyper-V PowerShell Direct was tried first and is NOT viable: the Hyper-V socket
  dies partway through a 200 MB transfer ("The Hyper-V socket target process has ended"). It is fine
  for commands and small files, not for release artifacts.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [string] $DistDir = "C:\Users\moham\OneDrive\Desktop\AWTKIT\dist",
  [string] $VmRoot = "C:\AWKIT-CleanMachineVM"
)

$ErrorActionPreference = "Stop"

# Derived from package.json, never hardcoded: a pinned version stages a stale build onto the clean
# machine, and the run then certifies software nobody is shipping.
$appVersion = (Get-Content -Raw (Join-Path $PSScriptRoot "..\..\package.json") | ConvertFrom-Json).version
$portable = "SpecterStudio $appVersion.exe"
$setup = "SpecterStudio Setup $appVersion.exe"
$stage = Join-Path $VmRoot "artifact-stage"
$iso = Join-Path $VmRoot "artifacts.iso"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
foreach ($n in @($portable, $setup)) {
  $src = Join-Path $DistDir $n
  if (-not (Test-Path $src)) { throw ("artifact missing: " + $src) }
  Copy-Item $src (Join-Path $stage $n) -Force
}
# Carry the expected hashes in with the payload so the guest verifies against what the host built,
# not against a value retyped by hand.
$manifest = foreach ($n in @($portable, $setup)) {
  $f = Join-Path $stage $n
  "{0}|{1}|{2}" -f $n, (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower(), (Get-Item $f).Length
}
Set-Content -Path (Join-Path $stage "SHA256SUMS.txt") -Value $manifest -Encoding ascii

if (-not ("AwkitIsoWriter" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class AwkitIsoWriter
{
    public static void Write(object comStream, string path)
    {
        IStream stream = (IStream)comStream;
        using (FileStream fs = new FileStream(path, FileMode.Create, FileAccess.Write))
        {
            byte[] buffer = new byte[1048576];
            IntPtr pcb = Marshal.AllocHGlobal(8);
            try
            {
                while (true)
                {
                    stream.Read(buffer, buffer.Length, pcb);
                    int read = Marshal.ReadInt32(pcb);
                    if (read <= 0) break;
                    fs.Write(buffer, 0, read);
                }
            }
            finally { Marshal.FreeHGlobal(pcb); }
        }
    }
}
'@
}

# A previously delivered artifacts.iso is still LOCKED by the running VM's DVD drive, so writing
# over it fails. Eject it first (and dismount any host-side mount, which once left the guest unable
# to boot from the DVD at all). Re-attached below.
# Keep plain coordinates, NOT the drive objects: ejecting invalidates the object handle, and
# reusing it later fails with "the object was not found" from the Hyper-V WMI layer.
$mounted = @(Get-VMDvdDrive -VMName $VMName | Where-Object { $_.Path -eq $iso } |
  ForEach-Object { [pscustomobject]@{ ControllerNumber = $_.ControllerNumber; ControllerLocation = $_.ControllerLocation } })
foreach ($d in $mounted) {
  Set-VMDvdDrive -VMName $VMName -ControllerNumber $d.ControllerNumber -ControllerLocation $d.ControllerLocation -Path $null
  Write-Output ("ejected prior artifacts DVD at {0}:{1}" -f $d.ControllerNumber, $d.ControllerLocation)
}
if (Test-Path $iso) {
  try { if ((Get-DiskImage -ImagePath $iso -ErrorAction Stop).Attached) { Dismount-DiskImage -ImagePath $iso | Out-Null } } catch { }
}

Write-Output "Building artifacts ISO (this takes a minute for ~450 MB)"
$fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
# UDF: ISO9660/Joliet cannot hold a file over 4 GB and truncates long names; UDF is what Windows
# install media itself uses.
$fsi.FileSystemsToCreate = 4
$fsi.UDFRevision = 0x102
$fsi.VolumeName = "AWKITREL"
$fsi.Root.AddTree($stage, $false)
$result = $fsi.CreateResultImage()
[AwkitIsoWriter]::Write($result.ImageStream, $iso)
Write-Output ("artifacts ISO: {0} ({1:N1} MB)" -f $iso, ((Get-Item $iso).Length / 1MB))

# Swap the answer-file DVD (setup is long finished) for the artifacts DVD. On a re-delivery there is
# no autounattend drive left, so prefer the drive we just ejected - otherwise every re-run bolts on
# another DVD drive and the guest ends up with several, only one of which is current.
$target = @($mounted)[0]
if (-not $target) { $target = Get-VMDvdDrive -VMName $VMName | Where-Object { $_.Path -like "*autounattend*" } | Select-Object -First 1 }
if (-not $target) { $target = Get-VMDvdDrive -VMName $VMName | Where-Object { -not $_.Path } | Select-Object -First 1 }
if ($target) {
  Set-VMDvdDrive -VMName $VMName -ControllerNumber $target.ControllerNumber -ControllerLocation $target.ControllerLocation -Path $iso
} else {
  Add-VMDvdDrive -VMName $VMName -Path $iso
}
Get-VMDvdDrive -VMName $VMName | Select-Object ControllerNumber, ControllerLocation, Path | Format-Table -AutoSize | Out-String | Write-Output
Write-Output "Artifacts are now available to the guest as a read-only DVD."
