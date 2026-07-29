<#
.SYNOPSIS
  Provision the clean, OFFLINE Windows 11 VM that CLEAN_MACHINE_VALIDATION_RUNBOOK.md requires.

.DESCRIPTION
  Creates a Generation 2 Hyper-V VM, installs Windows 11 Pro unattended from a local ISO, and leaves
  it with no network, no development tooling, no project source tree and no SpecterStudio profile:
  the section 1 environment the runbook mandates.

  Requires membership in "Hyper-V Administrators" (NOT full local admin). The owner authorised the
  licence acceptance and local-account creation inside this throwaway VM on 2026-07-29; both live in
  autounattend.xml beside this script.

  The answer file is delivered on a small ISO built with IMAPI2FS, so no Windows ADK / oscdimg is
  needed. Windows Setup finds autounattend.xml at the root of any attached volume.

  Deliberately offline: the adapter is REMOVED (not merely disconnected) before first boot, so
  constraint 1.6 holds for the entire life of the VM and cannot be undone by a stray DHCP lease.

  ASCII only on purpose. Windows PowerShell 5.1 reads .ps1 as ANSI when there is no BOM, so a
  stray em dash turns the file into a parse error.

.NOTES
  Teardown: .\provision-vm.ps1 -Remove
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [string] $IsoPath = "C:\MyDataFiles\Downloads History Part I\Win11_24H2_EnglishInternational_x64.iso",
  [int64]  $MemoryBytes = 6GB,
  [int64]  $DiskBytes = 64GB,
  [int]    $CpuCount = 4,
  [switch] $Remove
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
# NOT under %LOCALAPPDATA%. The Hyper-V worker process runs as NT VIRTUAL MACHINE\<vm-guid> and
# cannot traverse a user profile, so an ISO or VHDX parked there fails to attach with
# "Attachment ... not found" even though the file plainly exists. A folder at the volume root is
# readable by the worker and creatable by a standard user.
$vmRoot = "C:\AWKIT-CleanMachineVM"
$vhdPath = Join-Path $vmRoot ("{0}.vhdx" -f $VMName)
$answerIso = Join-Path $vmRoot "autounattend.iso"

function Write-Step { param([string]$m) Write-Output ("==> " + $m) }

if ($Remove) {
  Write-Step ("Removing " + $VMName + " and its disks")
  $vm = Get-VM -Name $VMName -ErrorAction SilentlyContinue
  if ($vm) {
    if ($vm.State -ne 'Off') { Stop-VM -Name $VMName -TurnOff -Force }
    Remove-VM -Name $VMName -Force
  }
  if (Test-Path $vmRoot) { Remove-Item $vmRoot -Recurse -Force }
  Write-Output "Removed."
  return
}

if (-not (Test-Path $IsoPath)) { throw ("Windows ISO not found: " + $IsoPath) }
$localIso = Join-Path $vmRoot "win11.iso"
if (Get-VM -Name $VMName -ErrorAction SilentlyContinue) {
  throw ("VM '" + $VMName + "' already exists. Run with -Remove first if you want a fresh one.")
}

New-Item -ItemType Directory -Force -Path $vmRoot | Out-Null

# Stage the install ISO beside the VM. The Hyper-V worker process cannot traverse a user profile, so
# an ISO left in %LOCALAPPDATA% or a personal folder fails to attach or fails to boot.
if (-not (Test-Path $localIso)) {
  Write-Step "Staging the Windows ISO beside the VM (a few GB, one-off)"
  Copy-Item $IsoPath $localIso -Force
}

# 1. Build the answer-file ISO.
Write-Step "Building autounattend ISO"
$answerSrc = Join-Path $here "autounattend.xml"
if (-not (Test-Path $answerSrc)) { throw "autounattend.xml not found beside this script" }

# Stage ONLY the answer file. Pointing AddTree at this script's own directory would publish
# provision-vm.ps1 into the guest, putting project tooling on a machine whose whole purpose is
# having none, which breaks constraint 1.2.
$stage = Join-Path $vmRoot "answer-stage"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
Copy-Item $answerSrc (Join-Path $stage "autounattend.xml") -Force

# The IMAPI result is a COM IStream. PowerShell 5.1's type converter cannot cast the RCW to
# ComTypes.IStream ("Cannot convert System.__ComObject"), but C# can, because the cast goes through
# QueryInterface rather than PowerShell's converter. So do the copy in a tiny compiled helper.
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
            byte[] buffer = new byte[65536];
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

$fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
$fsi.FileSystemsToCreate = 3
$fsi.VolumeName = "UNATTEND"
$fsi.Root.AddTree($stage, $false)
$result = $fsi.CreateResultImage()
[AwkitIsoWriter]::Write($result.ImageStream, $answerIso)
Write-Step ("answer ISO: " + $answerIso + " (" + [math]::Round((Get-Item $answerIso).Length/1KB,1) + " KB)")

# 2. Create the VM.
Write-Step ("Creating VM " + $VMName)
New-VHD -Path $vhdPath -SizeBytes $DiskBytes -Dynamic | Out-Null
New-VM -Name $VMName -MemoryStartupBytes $MemoryBytes -Generation 1 -VHDPath $vhdPath | Out-Null
Set-VM -Name $VMName -ProcessorCount $CpuCount -AutomaticCheckpointsEnabled $false `
       -CheckpointType Disabled -AutomaticStartAction Nothing -AutomaticStopAction ShutDown
Set-VMMemory -VMName $VMName -DynamicMemoryEnabled $false

# Generation 1 (BIOS), NOT Generation 2. Hyper-V's UEFI firmware rejects this ISO's boot loader
# ("The boot loader failed") with Secure Boot both on and off, with the ISO local and uncontended;
# the identical ISO boots its BIOS El Torito entry first time. The media is sound - its UEFI entry is
# a valid FAT12 image with a correct 0x55AA signature - so the fault is in the Gen 2 boot path.
#
# Gen 1 costs UEFI, Secure Boot and the vTPM, and Windows 11 Setup's hardware gate is relaxed with
# LabConfig keys in autounattend.xml. That is a recorded DEVIATION, and it is immaterial to what this
# runbook validates: sections 1.2 to 1.8 (no source tree, no dev server, no global Node, no existing
# profile, no internet, standard user) are all still satisfied, and an offline Electron app's
# behaviour does not depend on the firmware type.
Write-Step "Attaching install media and the answer ISO (Generation 1 / BIOS)"
Set-VMDvdDrive -VMName $VMName -Path $localIso
Add-VMDvdDrive -VMName $VMName -Path $answerIso
Set-VMBios -VMName $VMName -StartupOrder @("CD", "IDE", "LegacyNetworkAdapter", "Floppy")

# 3. Offline by construction. REMOVE the adapter rather than disconnecting it: constraint 1.6
# requires no internet for the entire run, and a removed adapter cannot be reconnected by an errant
# setup step or a later default policy.
Write-Step "Removing the network adapter (constraint 1.6, offline for the whole run)"
Get-VMNetworkAdapter -VMName $VMName | Remove-VMNetworkAdapter
Write-Step ("adapters now: " + (Get-VMNetworkAdapter -VMName $VMName | Measure-Object).Count)

Write-Step "Starting the VM (unattended Windows 11 Pro install)"
Start-VM -Name $VMName

Write-Output ""
Write-Output ("VM '" + $VMName + "' is installing Windows unattended.")
Write-Output ("  disks : " + $vmRoot)
Write-Output ("  watch : Get-VM -Name " + $VMName + " | Select-Object Name,State,Uptime")
Write-Output "  ready : the guest writes C:\awkit-vm-ready.txt at first logon"
Write-Output "  note  : PowerShell Direct works without any network; that is how the runbook drives it."
