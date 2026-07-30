<#
.SYNOPSIS
  Execute runbook section 3 ("Exact offline setup steps") against the clean VM, and record it.

.DESCRIPTION
  Section 3 is the preparation procedure the rest of the runbook assumes. It had never been executed
  as written - earlier sittings staged the artifacts at C:\AWKIT-Artifacts and seeded over PowerShell
  Direct, which is equivalent in effect but is NOT what section 3 says. This script performs the
  steps in the runbook's own order so the result is a real execution rather than a claim that
  automated provisioning "subsumed" them.

  Steps, mapped to the runbook:

    1  Snapshot the clean VM                      -> Checkpoint-VM (see the note below)
    2  Confirm every section 1 constraint         -> 1.1 - 1.7, each measured in the guest
    3  Go offline and confirm no connectivity     -> adapter count + a real connectivity attempt
    4  Two working folders on the standard user's desktop, one artifact in each
    5  Verify both hashes ON the machine under test
    6  Prepare the upgrade-profile seed           -> delegated to seed-upgrade-profile.ps1, which
                                                     MUST run before first launch

  Step 1 needs manual checkpoints, which provision-vm.ps1 used to forbid outright
  (-CheckpointType Disabled). That is fixed there; a VM provisioned before that fix cannot be
  snapshotted and this script will say so rather than silently skip it.

  Nothing is installed in the guest: PowerShell Direct plus built-in Windows commands only, so
  constraints 1.2-1.4 still hold.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [string] $GuestAdmin = "awkitadmin",
  [string] $GuestPassword = "Awkit!CleanVM2026",
  [string] $GuestUser = "awkituser",
  [string] $SnapshotName = "clean-before-validation",
  [switch] $SkipSnapshot
)

$ErrorActionPreference = "Stop"
$cred = New-Object System.Management.Automation.PSCredential($GuestAdmin, (ConvertTo-SecureString $GuestPassword -AsPlainText -Force))
function Write-Step { param([string]$m) Write-Output ("==> " + $m) }

# ---- Step 1: snapshot the clean VM ------------------------------------------------------------
Write-Step "3.1 Snapshot the clean VM"
if ($SkipSnapshot) {
  Write-Output "  SKIPPED by -SkipSnapshot"
} else {
  $type = (Get-VM -Name $VMName).CheckpointType
  if ($type -eq "Disabled") {
    Write-Output "  BLOCKED: this VM has CheckpointType=Disabled, so no manual snapshot can be taken."
    Write-Output "           Reprovision with the current provision-vm.ps1 (CheckpointType=Standard)."
  } else {
    $existing = Get-VMSnapshot -VMName $VMName -Name $SnapshotName -ErrorAction SilentlyContinue
    if ($existing) {
      Write-Output ("  snapshot already exists: " + $existing.Name + " (" + $existing.CreationTime + ")")
    } else {
      Checkpoint-VM -Name $VMName -SnapshotName $SnapshotName
      $snap = Get-VMSnapshot -VMName $VMName -Name $SnapshotName
      Write-Output ("  created: " + $snap.Name)
      Write-Output ("  id     : " + $snap.Id)
      Write-Output ("  created: " + $snap.CreationTime)
    }
  }
}

# ---- Steps 2, 3, 4, 5 --------------------------------------------------------------------------
$result = Invoke-Command -VMName $VMName -Credential $cred -ScriptBlock {
  param($user)

  $out = [ordered]@{}

  # -- Step 2: section 1 constraints ------------------------------------------------------------
  $os = Get-CimInstance Win32_OperatingSystem
  $out["1.1 Windows"] = ($os.Caption + " " + $os.Version + " " + $os.OSArchitecture)

  # 1.2 no project source tree. Look for the marker files a checkout would have, not for a folder
  # name - a folder called "AWTKIT" holding artifacts is not a source tree.
  $srcHits = @()
  foreach ($root in @("C:\")) {
    $srcHits += @(Get-ChildItem $root -Recurse -Depth 4 -Filter "package.json" -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notlike "*\AppData\Local\Temp\*" } | Select-Object -First 5 -ExpandProperty FullName)
  }
  $out["1.2 source tree"] = if ($srcHits.Count -eq 0) { "none (no package.json anywhere on C:)" } else { "FOUND: " + ($srcHits -join "; ") }

  # 1.3 no dev server
  $node = @(Get-Process -Name node, npm, electron -ErrorAction SilentlyContinue)
  $out["1.3 dev server"] = if ($node.Count -eq 0) { "no node/npm/electron processes" } else { "FOUND: " + (($node | Select-Object -ExpandProperty Name) -join ",") }

  # 1.4 no global Node on PATH
  $where = & cmd /c "where node 2>nul"
  $out["1.4 node on PATH"] = if ([string]::IsNullOrWhiteSpace($where)) { "not found" } else { "FOUND: " + $where }

  # 1.5 no existing profile
  $profileRoot = "C:\Users\$user\AppData\Local\SpecterStudio"
  $installRoot = "C:\Users\$user\AppData\Local\Programs\specterstudio"
  $out["1.5 app profile"] = ("SpecterStudio=" + (Test-Path $profileRoot) + " Programs\specterstudio=" + (Test-Path $installRoot))
  $out["1.5 ProgramData"] = ("Licensing mirror=" + (Test-Path "C:\ProgramData\SpecterStudio\Licensing"))

  # 1.7 standard (non-administrator) user
  $admins = @(Get-LocalGroupMember -Group "Administrators" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
  $out["1.7 standard user"] = ("$user in Administrators = " + [bool](@($admins | Where-Object { $_ -like "*\$user" }).Count) + " ; members: " + ($admins -join ","))

  # -- Step 3: offline ---------------------------------------------------------------------------
  $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue)
  $ping = try { Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet -ErrorAction Stop } catch { $false }
  $out["3 adapters"] = $adapters.Count
  $out["3 reaches 8.8.8.8"] = $ping

  # -- Step 4: two working folders on the standard user's desktop --------------------------------
  $desktop = "C:\Users\$user\Desktop"
  $portDir = Join-Path $desktop "awkit-portable"
  $instDir = Join-Path $desktop "awkit-installer"
  New-Item -ItemType Directory -Force -Path $portDir, $instDir | Out-Null

  $dvd = $null
  foreach ($d in @("D:", "E:", "F:")) { if (Test-Path "$d\SHA256SUMS.txt") { $dvd = $d; break } }
  if (-not $dvd) { throw "artifacts DVD not found - run attach-artifacts.ps1 first" }
  $out["4 source DVD"] = $dvd

  Copy-Item "$dvd\SpecterStudio 0.1.0.exe" (Join-Path $portDir "SpecterStudio 0.1.0.exe") -Force
  Copy-Item "$dvd\SpecterStudio Setup 0.1.0.exe" (Join-Path $instDir "SpecterStudio Setup 0.1.0.exe") -Force
  $out["4 portable folder"] = $portDir
  $out["4 installer folder"] = $instDir

  # The folders belong to the standard user, who must be able to launch from them.
  foreach ($d in @($portDir, $instDir)) {
    $acl = Get-Acl $d
    $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule("$user", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")))
    Set-Acl $d $acl
  }

  # -- Step 5: verify both hashes ON the machine under test --------------------------------------
  $lines = Get-Content "$dvd\SHA256SUMS.txt"
  $verify = foreach ($line in $lines) {
    $parts = $line -split "\|"
    $name = $parts[0]
    $expected = $parts[1]
    $local = if ($name -like "*Setup*") { Join-Path $instDir $name } else { Join-Path $portDir $name }
    $actual = (Get-FileHash -Algorithm SHA256 $local).Hash.ToLower()
    ("{0} expected={1} actual={2} match={3} bytes={4}" -f $name, $expected.Substring(0, 16), $actual.Substring(0, 16), ($expected -eq $actual), (Get-Item $local).Length)
  }
  $out["5 hash verification"] = ($verify -join " || ")

  [pscustomobject]$out
} -ArgumentList @($GuestUser)

Write-Output ""
Write-Step "3.2 - 3.5 measured in the guest"
$result | Format-List | Out-String | Write-Output

# Section 3 puts the snapshot at step 1, before the artifacts are staged - so restoring it discards
# steps 4-6 as well, and the "restore between the portable and installer passes" it promises would
# mean re-staging every time. Take a SECOND checkpoint here: artifacts present and hash-verified, no
# app profile yet, nothing launched. That is the state both section 4 and section 7 actually start
# from. The step-1 snapshot is still taken, unmodified, because it is what the runbook says.
if (-not $SkipSnapshot -and (Get-VM -Name $VMName).CheckpointType -ne "Disabled") {
  $stagedName = "staged-artifacts-preseed"
  if (-not (Get-VMSnapshot -VMName $VMName -Name $stagedName -ErrorAction SilentlyContinue)) {
    Checkpoint-VM -Name $VMName -SnapshotName $stagedName
    $s = Get-VMSnapshot -VMName $VMName -Name $stagedName
    Write-Step ("extra checkpoint for the section 4 / section 7 passes: " + $s.Name + " (" + $s.Id + ")")
  }
}

Write-Step "3.6 Upgrade-profile seed"
Write-Output "  Run scripts/clean-machine/seed-upgrade-profile.ps1 NEXT, and BEFORE the app's first"
Write-Output "  launch. detectInstallationKind() classifies the install by what it finds on disk, so"
Write-Output "  seeding after a launch produces 'fresh' and the section 5 upgrade paths cannot run."
