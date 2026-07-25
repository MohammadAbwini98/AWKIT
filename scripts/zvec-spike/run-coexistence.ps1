<#
.SYNOPSIS
  Phase 0D SF - Playwright coexistence matrix.

.DESCRIPTION
  Runs AWKIT's real runner verifier (scripts/verify-runner.mts - spawns its own mock-site and
  drives real Playwright/Chromium) under five conditions:

    1. baseline   - no Zvec activity
    2. fts        - continuous full-text queries
    3. upsert     - bounded incremental upserts
    4. batch      - throttled larger indexing batches
    5. host-crash - Zvec host hard-aborts mid-workflow

  The workflow is the measured subject; Zvec is the disturbance.

  Two design rules learned from a first run that produced a FALSE "no impact" result:
   * The Zvec load must OUTLIVE the workflow but still finish and write its counters, otherwise
     "no impact" cannot be distinguished from "no load ever ran".
   * Sampling must happen in the FOREGROUND while the workflow runs as a tracked process. A
     Start-Job sampler accumulates output and emits only on completion, so stopping it discarded
     every sample and reported 0 MB everywhere.
#>
param(
  [int]$LoadSeconds = 75
)

$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

$MB = 1048576
$rep = Join-Path $env:LOCALAPPDATA "SpecterStudio\zvec-phase-0\reports"
New-Item -ItemType Directory -Force -Path $rep | Out-Null
$tmp = Join-Path $env:TEMP "awkit-coexistence"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Kill-App {
  Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
  Start-Sleep -Seconds 3
}

function Sample-Now {
  $u = 0; $uc = 0; $m = 0
  try {
    foreach ($w in (Get-CimInstance Win32_Process -Filter "Name='SpecterStudio.exe'" -EA SilentlyContinue)) {
      $p = Get-Process -Id $w.ProcessId -EA SilentlyContinue
      if (-not $p) { continue }
      # Electron tags children with --type=<role>; the untagged one is the main process.
      if ($w.CommandLine -like "*--type=utility*") { $u += $p.WorkingSet64; $uc++ }
      elseif ($w.CommandLine -notlike "*--type=*") { $m += $p.WorkingSet64 }
    }
  } catch { }
  $chrome = Get-Process chrome -EA SilentlyContinue
  [pscustomobject]@{
    mainRss = $m
    utilityRss = $u
    utilityCount = $uc
    browserRss = if ($chrome) { ($chrome | Measure-Object WorkingSet64 -Sum).Sum } else { 0 }
    browserCount = @($chrome).Count
  }
}

$scenarios = @(
  @{ name = "1-baseline";   profile = $null },
  @{ name = "2-fts";        profile = "fts" },
  @{ name = "3-upsert";     profile = "upsert" },
  @{ name = "4-batch";      profile = "batch" },
  @{ name = "5-host-crash"; profile = "crash" }
)

$results = @()

foreach ($s in $scenarios) {
  Write-Host "`n=== SCENARIO $($s.name) ==="
  Kill-App
  Get-ChildItem $rep -Filter 'app-mode-native-host-load-host-*.json' -EA SilentlyContinue | Remove-Item -Force

  if ($s.profile) {
    $env:AWKIT_ZVEC_SPIKE_HOST     = "native-host-load"
    $env:AWKIT_ZVEC_SPIKE_WITH_APP = "1"
    $env:AWKIT_ZVEC_SPIKE_DELAY_MS = "3000"
    $env:AWKIT_ZVEC_LOAD_PROFILE   = $s.profile
    $env:AWKIT_ZVEC_LOAD_SECONDS   = "$LoadSeconds"
    Start-Process -FilePath "dist\SpecterStudio 0.1.0.exe" | Out-Null
    # Wait until the utility host is actually up, so the workflow genuinely overlaps real Zvec work.
    $up = $false
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Seconds 1
      if ((Sample-Now).utilityCount -gt 0) { $up = $true; break }
    }
    Write-Host "  zvec utility host up before workflow: $up"
  }

  $stdout = Join-Path $tmp "runner-$($s.name).log"
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $proc = Start-Process -FilePath "npx" -ArgumentList "tsx", "scripts/verify-runner.mts" `
            -RedirectStandardOutput $stdout -RedirectStandardError "$stdout.err" `
            -NoNewWindow -PassThru

  $peakMain = 0; $peakUtil = 0; $peakBrowser = 0; $maxUtil = 0; $maxBrowserProcs = 0; $n = 0
  while (-not $proc.HasExited) {
    $x = Sample-Now
    if ($x.mainRss -gt $peakMain) { $peakMain = $x.mainRss }
    if ($x.utilityRss -gt $peakUtil) { $peakUtil = $x.utilityRss }
    if ($x.browserRss -gt $peakBrowser) { $peakBrowser = $x.browserRss }
    if ($x.utilityCount -gt $maxUtil) { $maxUtil = $x.utilityCount }
    if ($x.browserCount -gt $maxBrowserProcs) { $maxBrowserProcs = $x.browserCount }
    $n++
    Start-Sleep -Milliseconds 750
  }
  $sw.Stop()
  $exit = $proc.ExitCode
  $out = Get-Content $stdout -Raw -EA SilentlyContinue

  $passed = 0; $failed = 0
  if ($out -match '(\d+)\s+passed,\s+(\d+)\s+failed') { $passed = [int]$Matches[1]; $failed = [int]$Matches[2] }

  # Wait for the load driver to finish and publish its counters - this is the evidence that the
  # disturbance was real. Without it, a "no impact" result is meaningless.
  $loadReport = $null
  if ($s.profile) {
    $dl = (Get-Date).AddSeconds($LoadSeconds + 60)
    while ((Get-Date) -lt $dl) {
      $loadReport = Get-ChildItem $rep -Filter 'app-mode-native-host-load-host-*.json' -EA SilentlyContinue | Select-Object -First 1
      if ($loadReport) { break }
      Start-Sleep -Seconds 2
    }
  }

  $lc = $null
  if ($loadReport) {
    $lj = Get-Content $loadReport.FullName -Raw | ConvertFrom-Json
    $lc = $lj
    Rename-Item $loadReport.FullName ("$($s.name)-" + $loadReport.Name) -EA SilentlyContinue
  }

  $results += [pscustomobject]@{
    scenario         = $s.name
    zvecProfile      = if ($s.profile) { $s.profile } else { "none" }
    workflowExit     = $exit
    workflowPassed   = $passed
    workflowFailed   = $failed
    durationSec      = [math]::Round($sw.Elapsed.TotalSeconds, 2)
    rssSamples       = $n
    peakMainRssMB    = [math]::Round($peakMain / $MB, 1)
    peakUtilityRssMB = [math]::Round($peakUtil / $MB, 1)
    utilityProcs     = $maxUtil
    peakBrowserRssMB = [math]::Round($peakBrowser / $MB, 1)
    browserProcs     = $maxBrowserProcs
    zvecFts          = if ($lc) { $lc.counters.ftsQueries } else { 0 }
    zvecVec          = if ($lc) { $lc.counters.vectorQueries } else { 0 }
    zvecUpserts      = if ($lc) { $lc.counters.upserts } else { 0 }
    zvecBatches      = if ($lc) { $lc.counters.batches } else { 0 }
    zvecDocs         = if ($lc) { $lc.counters.docsWritten } else { 0 }
    zvecErrors       = if ($lc) { $lc.counters.errors } else { 0 }
    hostExited       = if ($lc) { $lc.hostExited } else { $null }
    hostExitCode     = if ($lc) { $lc.hostExitCode } else { $null }
    loopP95Ms        = if ($lc) { $lc.mainEventLoopDelayMs.p95 } else { $null }
    loopMaxMs        = if ($lc) { $lc.mainEventLoopDelayMs.max } else { $null }
  }

  Write-Host ("  exit={0} passed={1} failed={2} dur={3}s | zvec fts={4} ups={5} batch={6} docs={7} err={8} | mainRss={9}MB utilRss={10}MB browserRss={11}MB (n={12})" -f `
    $exit, $passed, $failed, [math]::Round($sw.Elapsed.TotalSeconds,2), `
    $(if($lc){$lc.counters.ftsQueries}else{0}), $(if($lc){$lc.counters.upserts}else{0}), `
    $(if($lc){$lc.counters.batches}else{0}), $(if($lc){$lc.counters.docsWritten}else{0}), `
    $(if($lc){$lc.counters.errors}else{0}), `
    [math]::Round($peakMain/$MB,1), [math]::Round($peakUtil/$MB,1), [math]::Round($peakBrowser/$MB,1), $n)

  Kill-App
  foreach ($v in @("AWKIT_ZVEC_SPIKE_HOST","AWKIT_ZVEC_SPIKE_WITH_APP","AWKIT_ZVEC_SPIKE_DELAY_MS","AWKIT_ZVEC_LOAD_PROFILE","AWKIT_ZVEC_LOAD_SECONDS")) {
    if (Test-Path "Env:$v") { Remove-Item -LiteralPath "Env:$v" }
  }
}

Write-Host "`n=== COEXISTENCE MATRIX ==="
$results | Format-Table -AutoSize | Out-String -Width 250 | Write-Host

$baseline = $results | Where-Object { $_.scenario -eq "1-baseline" } | Select-Object -First 1
if ($baseline -and $baseline.durationSec -gt 0) {
  Write-Host "Workflow duration vs baseline ($($baseline.durationSec)s):"
  foreach ($r in ($results | Where-Object { $_.scenario -ne "1-baseline" })) {
    $delta = [math]::Round($r.durationSec - $baseline.durationSec, 2)
    $pctv = [math]::Round(($delta / $baseline.durationSec) * 100, 1)
    Write-Host ("  {0,-14} {1,8}s  ({2}%)" -f $r.scenario, $delta, $pctv)
  }
}

$outFile = Join-Path $rep "coexistence-$(Get-Date -Format yyyyMMdd-HHmmss).json"
$results | ConvertTo-Json -Depth 6 | Set-Content -Path $outFile -Encoding utf8
Write-Host "`nReport: $outFile"
