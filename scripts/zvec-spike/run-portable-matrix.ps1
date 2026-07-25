<#
  Phase 0D SA - portable application validation.
  Two launches of the SAME portable EXE sharing one generation, so restart persistence is proven
  across process lifetimes rather than only across a close/reopen inside one run.
#>
$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

$rep = Join-Path $env:LOCALAPPDATA "SpecterStudio\zvec-phase-0\reports"
$gen = Join-Path $env:LOCALAPPDATA "SpecterStudio\semantic-index\generations\gen-persist"
$exe = "dist\SpecterStudio 0.1.0.exe"

function Kill-App { Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue; Start-Sleep -Seconds 3 }
function Clear-Reports { Get-ChildItem $rep -Filter 'app-mode-native-host-host-*.json' -EA SilentlyContinue | Remove-Item -Force }

Kill-App
if (Test-Path $gen) { Remove-Item -LiteralPath $gen -Recurse -Force }
Clear-Reports

function Run-Launch([string]$label, [string]$keep) {
  $env:AWKIT_ZVEC_SPIKE_HOST = "native-host"
  $env:AWKIT_ZVEC_GENERATION_NAME = "gen-persist"
  $env:AWKIT_ZVEC_KEEP_GENERATION = $keep
  Start-Process -FilePath $exe | Out-Null
  $dl = (Get-Date).AddSeconds(240)
  $r = $null
  while ((Get-Date) -lt $dl) {
    $r = Get-ChildItem $rep -Filter 'app-mode-native-host-host-*.json' -EA SilentlyContinue | Select-Object -First 1
    if ($r) { break }
    Start-Sleep -Seconds 3
  }
  Start-Sleep -Seconds 5
  $orphans = @(Get-Process SpecterStudio -EA SilentlyContinue).Count
  Write-Host "`n--- $label ---"
  Write-Host "report   : $(if($r){$r.Name}else{'NONE'})"
  Write-Host "orphans  : $orphans (expect 0)"
  if ($r) {
    $j = Get-Content $r.FullName -Raw | ConvertFrom-Json
    $ok = @($j.steps | Where-Object { $_.ok }).Count
    $all = @($j.steps).Count
    Write-Host "ok       : $($j.ok)  steps $ok/$all"
    foreach ($s in $j.steps) {
      if ($s.label -match 'Generation|persist|Persistence|hostSpawn|helloHandshake|Confinement') {
        Write-Host ("   {0,-6} {1,-38} {2}" -f $s.ok, $s.label, ($s.result | ConvertTo-Json -Compress))
      }
    }
    Write-Host "shutdown : $($j.measurements.gracefulShutdownMs) ms"
    Rename-Item $r.FullName ("$label-" + $r.Name)
  }
  Kill-App
  return $r
}

Write-Host "=== A4-A7: LAUNCH 1 (create gen-persist, keep it) ==="
$null = Run-Launch -label "launch1" -keep "1"

Write-Host "`n=== A8-A9: LAUNCH 2 (must REOPEN gen-persist non-empty) ==="
$null = Run-Launch -label "launch2" -keep "0"

Write-Host "`n=== A11: network / listening ports opened by the app ==="
Write-Host "host source network imports:"
Select-String -Path "native-hosts\zvec\zvec-host.cjs" -Pattern "require\(`"node:(net|http|https|dgram|tls)" -EA SilentlyContinue | ForEach-Object { $_.Line }
Write-Host "(no output above = no network modules required by the host)"
