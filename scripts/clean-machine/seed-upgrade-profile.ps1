<#
.SYNOPSIS
  Seed the section 5.1 "upgrade profile" inside the offline VM, before the app is ever launched.

.DESCRIPTION
  Section 5 exercises the paths that break on real upgrades: an existing library with mixed validity,
  a PRE-HARDENING (FNV-era) grant, an old migration record, and prior run history. All of it has to
  exist before first launch, because the inventory scan classifies what it finds.

  Seeds under %LOCALAPPDATA%\SpecterStudio for the standard user:
    flows\           24 flows: valid, off-path-only (orphan), active-path-broken, and fixable
    workflows\       one workflow per flow, referencing exactly that flow
    validation\legacy-grants\<orphan>.json   pre-hardening grant, UNPREFIXED 16-hex contentHash
    validation\migrations\old-record.json    a plausible historical migration record

  The FNV-era grant is the point of the exercise: on scan it must be RETIRED
  (revokedReason "digestFormatRetired"), never honoured, and never re-granted.

  Files are generated on the HOST and delivered over PowerShell Direct. They are small JSON, so the
  socket handles them fine - unlike the 200 MB artifacts, which need the DVD.

  ASCII only: Windows PowerShell 5.1 parses .ps1 as ANSI when there is no BOM.
#>
[CmdletBinding()]
param(
  [string] $VMName = "AWKIT-CleanMachine",
  [string] $GuestAdmin = "awkitadmin",
  [string] $GuestPassword = "Awkit!CleanVM2026",
  [string] $GuestUser = "awkituser"
)

$ErrorActionPreference = "Stop"
$secure = ConvertTo-SecureString $GuestPassword -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential($GuestAdmin, $secure)

# ---- Build the seed on the host ---------------------------------------------------------------
$stamp = "2026-01-15T09:00:00.000Z"
$flows = @()
$workflows = @()

function New-Flow {
  param([string]$Id, [string]$Name, [string]$Kind)
  $nodes = @(
    @{ id = "start"; type = "start"; name = "Start" }
  )
  $edges = @()

  switch ($Kind) {
    "valid" {
      $nodes += @{ id = "goto"; type = "goto"; name = "Open page"; config = @{ url = "http://localhost:4321/login" } }
      $nodes += @{ id = "end"; type = "end"; name = "End" }
      $edges += @{ id = "e0"; source = "start"; target = "goto"; type = "success" }
      $edges += @{ id = "e1"; source = "goto"; target = "end"; type = "success" }
    }
    "orphan" {
      # Reachable graph PLUS an extra node with no incoming connector. Off-path only: the main path
      # is sound, so this is exactly the class a Legacy grant is meant to keep running.
      $nodes += @{ id = "goto"; type = "goto"; name = "Open page"; config = @{ url = "http://localhost:4321/login" } }
      $nodes += @{ id = "end"; type = "end"; name = "End" }
      $nodes += @{ id = "orphanClick"; type = "click"; name = "Detached step"; config = @{} }
      $edges += @{ id = "e0"; source = "start"; target = "goto"; type = "success" }
      $edges += @{ id = "e1"; source = "goto"; target = "end"; type = "success" }
    }
    "broken" {
      # Click with NO locator, ON the active path. Must never be permitted by any grant.
      $nodes += @{ id = "click"; type = "click"; name = "Click with no locator"; config = @{} }
      $nodes += @{ id = "end"; type = "end"; name = "End" }
      $edges += @{ id = "e0"; source = "start"; target = "click"; type = "success" }
      $edges += @{ id = "e1"; source = "click"; target = "end"; type = "success" }
    }
    "fixable" {
      # Conditional connector with a MIS-CASED operator ("NotEquals" instead of "notEquals").
      $nodes += @{ id = "goto"; type = "goto"; name = "Open page"; config = @{ url = "http://localhost:4321/login" } }
      $nodes += @{ id = "end"; type = "end"; name = "End" }
      $edges += @{ id = "e0"; source = "start"; target = "goto"; type = "success" }
      $edges += @{ id = "e1"; source = "goto"; target = "end"; type = "conditional"; condition = @{ source = "text"; operator = "NotEquals"; value = "x" } }
    }
  }

  [pscustomobject]@{
    id          = $Id
    name        = $Name
    description = ("Seeded " + $Kind + " flow for clean-machine section 5")
    version     = 1
    createdAt   = $stamp
    updatedAt   = $stamp
    nodes       = $nodes
    edges       = $edges
  }
}

# 24 flows: 20 valid + orphan + broken + fixable + a second orphan for the description-only case.
for ($i = 1; $i -le 20; $i++) {
  $flows += New-Flow -Id ("seed-valid-{0:D2}" -f $i) -Name ("Seeded Valid Flow {0:D2}" -f $i) -Kind "valid"
}
$flows += New-Flow -Id "seed-orphan-primary" -Name "Seeded Off-Path Flow (primary)" -Kind "orphan"
$flows += New-Flow -Id "seed-orphan-secondary" -Name "Seeded Off-Path Flow (secondary)" -Kind "orphan"
$flows += New-Flow -Id "seed-broken-activepath" -Name "Seeded Active-Path-Broken Flow" -Kind "broken"
$flows += New-Flow -Id "seed-fixable-operator" -Name "Seeded Fixable Flow (mis-cased operator)" -Kind "fixable"

foreach ($f in $flows) {
  $workflows += [pscustomobject]@{
    id          = ($f.id + "-wf")
    name        = ($f.name + " Workflow")
    description = "Seeded workflow referencing exactly one flow."
    version     = 1
    createdAt   = $stamp
    updatedAt   = $stamp
    nodes       = @(@{ id = $f.id; type = "flowRef"; flowId = $f.id; alias = $f.id; order = 1; required = $true; inputBindings = @{}; retryPolicy = @{ count = 0; delayMs = 1000 }; failurePolicy = "stop"; position = @{ x = 140; y = 180 } })
    edges       = @()
    runtimeInputs = @()
    execution   = @{ mode = "sequential"; maxConcurrentInstances = 1; stopOnRequiredFlowFailure = $true }
  }
}

# Pre-hardening (FNV-era) grant: UNPREFIXED 16-hex contentHash, unexpired. Must be retired on scan.
$legacyGrant = [pscustomobject]@{
  id                     = "seed-orphan-primary"
  contentHash            = "9f4c1a2b3d5e6f70"
  grantedAt              = "2026-01-01T00:00:00.000Z"
  expiresAt              = "2099-01-01T00:00:00.000Z"
  validatorVersion       = 3
  issueCodes             = @("unreachableNode")
  runsUnderCompatibility = 7
}

$oldMigration = [pscustomobject]@{
  id      = "old-record"
  flowId  = "seed-fixable-operator"
  at      = "2026-02-01T12:00:00.000Z"
  fixes   = @(@{ code = "legacyOperatorCase"; detail = "historical record seeded for the upgrade test" })
  backupPath = "validation\backups\seed-fixable-operator-20260201.json"
}

$payload = [pscustomobject]@{
  Flows        = $flows
  Workflows    = $workflows
  LegacyGrant  = $legacyGrant
  OldMigration = $oldMigration
} | ConvertTo-Json -Depth 12 -Compress

Write-Output ("seed built on host: " + $flows.Count + " flows, " + $workflows.Count + " workflows")

# ---- Write it inside the guest ----------------------------------------------------------------
$result = Invoke-Command -VMName $VMName -Credential $cred -ScriptBlock {
  param($json, $user)
  $data = $json | ConvertFrom-Json
  # Windows PowerShell 5.1 `Set-Content -Encoding utf8` emits a BOM, and Node's JSON.parse rejects a
  # leading BOM - the app then (correctly) quarantines the file as `.corrupt-<ts>` and the seeded
  # library silently vanishes from the UI. scripts/generate-dependency-manifest.ps1 already carries
  # this same warning. Write UTF-8 WITHOUT a BOM.
  $noBom = New-Object System.Text.UTF8Encoding($false)
  function Write-Json { param($Object, $Path)
    [System.IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 12), $noBom)
  }

  $root = "C:\Users\$user\AppData\Local\SpecterStudio"
  foreach ($d in @("flows", "workflows", "validation\legacy-grants", "validation\migrations")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $root $d) | Out-Null
  }
  foreach ($f in $data.Flows) {
    Write-Json -Object $f -Path (Join-Path $root ("flows\" + $f.id + ".json"))
  }
  foreach ($w in $data.Workflows) {
    Write-Json -Object $w -Path (Join-Path $root ("workflows\" + $w.id + ".json"))
  }
  Write-Json -Object $data.LegacyGrant -Path (Join-Path $root ("validation\legacy-grants\" + $data.LegacyGrant.id + ".json"))
  Write-Json -Object $data.OldMigration -Path (Join-Path $root "validation\migrations\old-record.json")

  # Clear any quarantine left by a previous BOM-afflicted seed, so the library state is unambiguous.
  foreach ($sub in @("flows", "workflows")) {
    Get-ChildItem (Join-Path $root $sub) -Filter "*.corrupt-*" -ErrorAction SilentlyContinue | Remove-Item -Force
  }

  # The seeded profile must be OWNED by the standard user, or the app cannot write to it.
  $acl = Get-Acl $root
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule("$user", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow")
  $acl.SetAccessRule($rule)
  Set-Acl $root $acl

  [pscustomobject]@{
    Flows      = (Get-ChildItem (Join-Path $root "flows") -Filter *.json).Count
    Workflows  = (Get-ChildItem (Join-Path $root "workflows") -Filter *.json).Count
    Grants     = (Get-ChildItem (Join-Path $root "validation\legacy-grants") -Filter *.json | Select-Object -ExpandProperty Name) -join ","
    Migrations = (Get-ChildItem (Join-Path $root "validation\migrations") -Filter *.json | Select-Object -ExpandProperty Name) -join ","
  }
} -ArgumentList @($payload, $GuestUser)

$result | Format-List | Out-String | Write-Output
Write-Output "Upgrade profile seeded. Do NOT launch the app before this point in the runbook."
