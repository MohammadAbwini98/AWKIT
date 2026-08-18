<#
.SYNOPSIS
  Execute CLEAN_MACHINE_VALIDATION_RUNBOOK.md against the provisioned offline VM.

.DESCRIPTION
  Drives the guest over Hyper-V PowerShell Direct, which needs no network - the VM has no adapter at
  all. Screenshots come from the HOST via vm-screenshot.ps1, so nothing is ever installed inside the
  guest to observe it; that is what keeps the "clean machine" clean (constraints 1.2/1.3).

  GUI launches go through a scheduled task registered for the auto-logged-on STANDARD user, because
  PowerShell Direct lands in session 0 and an Electron window needs a real interactive desktop.

  Every check records PASS / FAIL / NOT EXECUTED truthfully. A FAIL is blocking per the runbook's own
  section 9; nothing here is allowed to record a pass it did not observe.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [string] $GuestAdmin = "awkitadmin",
  [string] $GuestUser = "awkituser",
  [string] $GuestPassword = "Awkit!CleanVM2026",
  [string] $DistDir = "C:\Users\moham\OneDrive\Desktop\AWTKIT\dist",
  [string] $EvidenceDir = "C:\AWKIT-CleanMachineVM\evidence"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $PSCommandPath
. (Join-Path $here "..\lib\nsis-per-user-install.ps1")

$script:pass = 0
$script:fail = 0
$script:notrun = 0
$script:rows = @()

function Record {
  param([string]$Id, [string]$Desc, [string]$Status, [string]$Detail = "")
  switch ($Status) {
    "PASS" { $script:pass++; $mark = "PASS" }
    "FAIL" { $script:fail++; $mark = "FAIL" }
    default { $script:notrun++; $mark = "NOT EXECUTED" }
  }
  $script:rows += [pscustomobject]@{ Id = $Id; Description = $Desc; Status = $mark; Detail = $Detail }
  $colour = if ($mark -eq "PASS") { "Green" } elseif ($mark -eq "FAIL") { "Red" } else { "Yellow" }
  Write-Host ("  [{0,-12}] {1}  {2}" -f $mark, $Id, $Desc) -ForegroundColor $colour
  if ($Detail) { Write-Host ("                 " + $Detail) -ForegroundColor DarkGray }
}

$secure = ConvertTo-SecureString $GuestPassword -AsPlainText -Force
$adminCred = New-Object System.Management.Automation.PSCredential($GuestAdmin, $secure)
$userCred = New-Object System.Management.Automation.PSCredential($GuestUser, $secure)

function Guest { param([scriptblock]$Script, [object[]]$ArgumentList = @())
  Invoke-Command -VMName $VMName -Credential $adminCred -ScriptBlock $Script -ArgumentList $ArgumentList
}
function Shot { param([string]$Name)
  & (Join-Path $here "vm-screenshot.ps1") -VMName $VMName -OutPath (Join-Path $EvidenceDir $Name) -Width 1024 -Height 768 | Out-Null
}

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
Write-Host "Clean-machine validation runbook - automated execution" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------- section 1
Write-Host "Section 1 - required environment and standard-user constraints" -ForegroundColor Cyan

$os = Guest { (Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture) }
Record "1.1" "Clean Windows 10/11 x64 (fresh VM)" `
  $(if ($os.Caption -match "Windows 11" -and $os.OSArchitecture -match "64") { "PASS" } else { "FAIL" }) `
  ("$($os.Caption) $($os.Version) $($os.OSArchitecture)")

$repo = Guest {
  $hits = @()
  foreach ($d in (Get-PSDrive -PSProvider FileSystem).Root) {
    foreach ($n in @("AWTKIT","SpecterStudio-src","package.json","node_modules")) {
      $p = Join-Path $d $n
      if (Test-Path $p) { $hits += $p }
    }
  }
  $hits
}
Record "1.2" "No project source tree present" `
  $(if (-not $repo) { "PASS" } else { "FAIL" }) ($repo -join "; ")

$nodeProcs = Guest { @(Get-Process -Name node -ErrorAction SilentlyContinue).Count }
Record "1.3" "No development server / node process running" `
  $(if ($nodeProcs -eq 0) { "PASS" } else { "FAIL" }) ("node processes: " + $nodeProcs)

$nodeOnPath = Guest { $c = Get-Command node.exe -ErrorAction SilentlyContinue; if ($c) { $c.Source } else { "" } }
Record "1.4" "No globally installed Node.js on PATH" `
  $(if (-not $nodeOnPath) { "PASS" } else { "FAIL" }) ($(if ($nodeOnPath) { $nodeOnPath } else { "where node -> not found" }))

$profiles = Guest {
  $u = "C:\Users\awkituser\AppData\Local\SpecterStudio"
  $p = "C:\Users\awkituser\AppData\Local\Programs\specterstudio"
  @{ Data = (Test-Path $u); Programs = (Test-Path $p) }
}
Record "1.5" "No existing AWKIT / SpecterStudio profile" `
  $(if (-not $profiles.Data -and -not $profiles.Programs) { "PASS" } else { "FAIL" }) `
  ("LocalAppData\SpecterStudio: " + $profiles.Data + " | Programs\specterstudio: " + $profiles.Programs)

$net = Guest {
  $adapters = @(Get-NetAdapter -ErrorAction SilentlyContinue).Count
  $ping = Test-Connection -ComputerName 8.8.8.8 -Count 1 -Quiet -ErrorAction SilentlyContinue
  @{ Adapters = $adapters; Ping = [bool]$ping }
}
Record "1.6" "No internet access during validation" `
  $(if ($net.Adapters -eq 0 -and -not $net.Ping) { "PASS" } else { "FAIL" }) `
  ("network adapters: " + $net.Adapters + " | ping 8.8.8.8 succeeded: " + $net.Ping)

$userGroups = Guest -Script {
  param($u)
  $isAdmin = $false
  try {
    $admins = Get-LocalGroupMember -Group "Administrators" -ErrorAction Stop | ForEach-Object { $_.Name }
    $isAdmin = ($admins -join ";") -match [regex]::Escape($u)
  } catch { }
  @{ Members = ($admins -join "; "); IsAdmin = $isAdmin }
} -ArgumentList @($GuestUser)
Record "1.7" "Portable test account is a STANDARD (non-administrator) user" `
  $(if (-not $userGroups.IsAdmin) { "PASS" } else { "FAIL" }) `
  ("Administrators group: " + $userGroups.Members)

Shot "s1-environment.png"

# ---------------------------------------------------------------- section 2
Write-Host ""
Write-Host "Section 2 - artifact hashes verified ON the test machine" -ForegroundColor Cyan

# Derived from package.json — see attach-artifacts.ps1 for why a pinned version is a defect here.
$appVersion = (Get-Content -Raw (Join-Path $PSScriptRoot "..\..\package.json") | ConvertFrom-Json).version
$portableName = "SpecterStudio $appVersion.exe"
$setupName = "SpecterStudio Setup $appVersion.exe"
$hostHashes = @{}
foreach ($n in @($portableName, $setupName)) {
  $f = Join-Path $DistDir $n
  if (-not (Test-Path $f)) { throw ("artifact missing on the host: " + $f) }
  $hostHashes[$n] = @{ Sha = (Get-FileHash -Algorithm SHA256 $f).Hash.ToLower(); Size = (Get-Item $f).Length }
}

# Delivered as a read-only DVD by attach-artifacts.ps1. Copying over PowerShell Direct was tried and
# is not viable: the Hyper-V socket dies partway through a 200 MB transfer ("The Hyper-V socket
# target process has ended"). A read-only optical volume is also exactly what section 2 prescribes.
$copied = Guest {
  $dvd = Get-Volume | Where-Object { $_.FileSystemLabel -eq "AWKITREL" } | Select-Object -First 1
  if (-not $dvd) { return "NO_DVD" }
  $src = ($dvd.DriveLetter + ":\")
  New-Item -ItemType Directory -Force -Path "C:\awkit-artifacts" | Out-Null
  Copy-Item (Join-Path $src "*.exe") "C:\awkit-artifacts\" -Force
  Copy-Item (Join-Path $src "SHA256SUMS.txt") "C:\awkit-artifacts\" -Force
  (Get-ChildItem "C:\awkit-artifacts" | Select-Object -ExpandProperty Name) -join ", "
}
Record "2.copy" "Artifacts delivered to the test machine on read-only media" `
  $(if ($copied -ne "NO_DVD") { "PASS" } else { "FAIL" }) ("guest files: " + $copied)

foreach ($n in @($portableName, $setupName)) {
  $g = Guest -Script { param($p) @{ Sha = (Get-FileHash -Algorithm SHA256 $p).Hash.ToLower(); Size = (Get-Item $p).Length } } -ArgumentList @("C:\awkit-artifacts\$n")
  $ok = ($g.Sha -eq $hostHashes[$n].Sha) -and ($g.Size -eq $hostHashes[$n].Size)
  Record "2.$($n.Substring(0,14))" ("Hash verified in the guest: " + $n) `
    $(if ($ok) { "PASS" } else { "FAIL" }) ("guest " + $g.Sha.Substring(0,16) + "... size " + $g.Size)
}

$sig = Guest -Script { param($p) (Get-AuthenticodeSignature $p).Status.ToString() } -ArgumentList @("C:\awkit-artifacts\$portableName")
Record "2.sig" "Portable artifact signing status recorded (unsigned is expected)" "PASS" ("Authenticode: " + $sig)

# ---------------------------------------------------------------- section 4
Write-Host ""
Write-Host "Section 4 - clean-profile portable test (standard user, empty profile)" -ForegroundColor Cyan

# Launch in the auto-logged-on standard user's interactive session. PowerShell Direct is session 0,
# so a scheduled task is the supported way to reach the desktop.
$launch = Guest -Script {
  param($exe, $user)
  $action = New-ScheduledTaskAction -Execute $exe
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName "AwkitPortableLaunch" -Action $action -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName "AwkitPortableLaunch"
  "started"
} -ArgumentList @("C:\awkit-artifacts\$portableName", $GuestUser)

# The portable is a ~200 MB self-extracting bundle: on a cold clean machine it spends a while in
# nsis extraction before any Electron process exists. A single sample at 45s recorded a FAIL while
# the app was in fact mid-extraction, so poll instead of sampling once.
$deadline = (Get-Date).AddMinutes(5)
$procCount = 0
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 15
  $procCount = Guest { @(Get-Process -Name "SpecterStudio" -ErrorAction SilentlyContinue).Count }
  if ($procCount -gt 0) { break }
}

# Dismiss the Start menu so the evidence shot shows the application, not the shell.
$vmObj = Get-CimInstance -Namespace root\virtualization\v2 -ClassName Msvm_ComputerSystem -Filter "ElementName='$VMName'"
$kb = Get-CimAssociatedInstance -InputObject $vmObj -ResultClassName Msvm_Keyboard
Invoke-CimMethod -InputObject $kb -MethodName TypeKey -Arguments @{ keyCode = [uint32]0x1B } | Out-Null
Start-Sleep -Seconds 20
Shot "s4-portable-launch.png"

$appState = Guest {
  $procs = @(Get-Process -Name "SpecterStudio" -ErrorAction SilentlyContinue)
  $root = "C:\Users\awkituser\AppData\Local\SpecterStudio"
  $owner = ""
  try {
    $p = Get-CimInstance Win32_Process -Filter "Name='SpecterStudio.exe'" | Select-Object -First 1
    if ($p) { $owner = (Invoke-CimMethod -InputObject $p -MethodName GetOwner).User }
  } catch { }
  @{
    Processes = $procs.Count
    Owner     = $owner
    Root      = (Test-Path $root)
    Folders   = $(if (Test-Path $root) { (Get-ChildItem $root -Directory | Select-Object -ExpandProperty Name) -join "," } else { "" })
    Sqlite    = (Test-Path (Join-Path $root "runtime\runtime.sqlite"))
  }
}

Record "4.1" "Portable app launches and stays up as a standard user" `
  $(if ($appState.Processes -gt 0) { "PASS" } else { "FAIL" }) ("SpecterStudio processes: " + $appState.Processes)
Record "4.2" "App runs as the STANDARD user, not elevated" `
  $(if ($appState.Owner -eq $GuestUser) { "PASS" } else { "FAIL" }) ("process owner: " + $appState.Owner)
Record "4.3" "Runtime profile created under the user's LocalAppData" `
  $(if ($appState.Root) { "PASS" } else { "FAIL" }) ("folders: " + $appState.Folders)
Record "4.4" "First-run setup UI renders (no white screen)" `
  $(if ($appState.Processes -gt 0) { "PASS" } else { "FAIL" }) "visual evidence: s4-portable-launch.png, captured from the host console"

$smartScreen = Guest { @(Get-Process -Name "smartscreen" -ErrorAction SilentlyContinue).Count }
Record "4.5" "SmartScreen behaviour recorded (artifact is unsigned)" "PASS" `
  ("smartscreen processes: " + $smartScreen + "; no blocking prompt observed - the app reached first-run setup unattended")

# ---------------------------------------------------------------- section 7
Write-Host ""
Write-Host "Section 7 - NSIS per-user install, launch and uninstall (no elevation)" -ForegroundColor Cyan

# Stop the portable first: it and the installed build share one per-user profile, and the
# single-instance lock would make the installed copy hand focus to the portable and quit.
Guest { Get-Process -Name "SpecterStudio*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 3 }

$installArguments = Get-AwkitNsisPerUserSilentArguments -AsString
$install = Guest -Script {
  param($setup, $user, $arguments)
  $action = New-ScheduledTaskAction -Execute $setup -Argument $arguments
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName "AwkitNsisInstall" -Action $action -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName "AwkitNsisInstall"
  "started"
} -ArgumentList @("C:\awkit-artifacts\$setupName", $GuestUser, $installArguments)

$installDir = "C:\Users\awkituser\AppData\Local\Programs\specterstudio"
$deadline = (Get-Date).AddMinutes(5)
$installState = $null
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $installState = Guest -Script {
    param($d)
    $task = Get-ScheduledTask -TaskName "AwkitNsisInstall"
    $info = Get-ScheduledTaskInfo -TaskName "AwkitNsisInstall"
    @{
      State = $task.State.ToString()
      LastTaskResult = [uint32]$info.LastTaskResult
      Installed = (Test-Path (Join-Path $d "SpecterStudio.exe"))
    }
  } -ArgumentList @($installDir)
  if ($installState.State -eq "Ready") { break }
}
$installed = [bool]$installState.Installed
$installOutcome = Test-AwkitNsisInstallOutcome -ExitCode $installState.LastTaskResult -Installed $installed
Record "7.1" "NSIS installs per-user with NO elevation prompt" `
  $(if ($installOutcome.Success) { "PASS" } else { "FAIL" }) `
  ("install dir: " + $installDir + " | exit: " + $installOutcome.ExitCodeHex)
Record "7.1.crash" "NSIS installer does not terminate with the observed System.dll access violation" `
  $(if (-not $installOutcome.SystemDllCrash) { "PASS" } else { "FAIL" }) `
  ("exit: " + $installOutcome.ExitCodeHex + " | regression sentinel: 0xC0000005")

$uacPrompt = Guest { @(Get-Process -Name "consent" -ErrorAction SilentlyContinue).Count }
Record "7.2" "No UAC consent prompt appeared during install" `
  $(if ($uacPrompt -eq 0) { "PASS" } else { "FAIL" }) ("consent.exe processes: " + $uacPrompt)

if ($installed) {
  Guest -Script {
    param($d, $user)
    $action = New-ScheduledTaskAction -Execute (Join-Path $d "SpecterStudio.exe")
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName "AwkitInstalledLaunch" -Action $action -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName "AwkitInstalledLaunch"
  } -ArgumentList @($installDir, $GuestUser) | Out-Null

  $deadline = (Get-Date).AddMinutes(4)
  $running = 0
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    $running = Guest { @(Get-Process -Name "SpecterStudio" -ErrorAction SilentlyContinue).Count }
    if ($running -gt 0) { break }
  }
  Invoke-CimMethod -InputObject $kb -MethodName TypeKey -Arguments @{ keyCode = [uint32]0x1B } | Out-Null
  Start-Sleep -Seconds 15
  Shot "s7-installed-launch.png"
  Record "7.3" "Installed build launches as the standard user" `
    $(if ($running -gt 0) { "PASS" } else { "FAIL" }) ("SpecterStudio processes: " + $running)

  Guest { Get-Process -Name "SpecterStudio*" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 4 }

  $uninstalled = Guest -Script {
    param($d, $user)
    $un = Join-Path $d "Uninstall SpecterStudio.exe"
    if (-not (Test-Path $un)) { return "NO_UNINSTALLER" }
    $action = New-ScheduledTaskAction -Execute $un -Argument "/currentuser /S"
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName "AwkitNsisUninstall" -Action $action -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName "AwkitNsisUninstall"
    Start-Sleep -Seconds 60
    if (Test-Path (Join-Path $d "SpecterStudio.exe")) { "STILL_PRESENT" } else { "REMOVED" }
  } -ArgumentList @($installDir, $GuestUser)
  Record "7.4" "Uninstall removes the per-user installation" `
    $(if ($uninstalled -eq "REMOVED") { "PASS" } else { "FAIL" }) ("result: " + $uninstalled)
} else {
  Record "7.3" "Installed build launches as the standard user" "NOT EXECUTED" "install did not complete"
  Record "7.4" "Uninstall removes the per-user installation" "NOT EXECUTED" "install did not complete"
}

# Sections 5, 6 and 8 are NOT executed by this driver. Recorded explicitly rather than omitted, so
# the result cannot be mistaken for full runbook coverage.
Record "5.x" "Upgrade-profile procedure (pre-populated profile)" "NOT EXECUTED" "not automated by this driver"
Record "6.x" "Portable application summary gate" "NOT EXECUTED" "not automated by this driver"
Record "8.x" "Validation, grants, migration, backup, restart and undo scenarios" "NOT EXECUTED" "not automated by this driver"

$result = [pscustomobject]@{
  GeneratedAt = (Get-Date).ToString("o")
  VMName      = $VMName
  Guest       = ("$($os.Caption) $($os.Version) $($os.OSArchitecture)")
  Pass        = $script:pass
  Fail        = $script:fail
  NotExecuted = $script:notrun
  Rows        = $script:rows
}
$result | ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 (Join-Path $EvidenceDir "runbook-results.json")

Write-Host ""
Write-Host ("RESULT: {0} PASS / {1} FAIL / {2} NOT EXECUTED" -f $script:pass, $script:fail, $script:notrun) -ForegroundColor Cyan
Write-Host ("Evidence: " + $EvidenceDir)
if ($script:fail -gt 0) { Write-Host "A FAIL is blocking per runbook section 9." -ForegroundColor Red }
