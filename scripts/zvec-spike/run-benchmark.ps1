<#
  Phase 0D SE - repeated benchmark.
  The in-app driver collects host/operation percentiles; this wrapper samples total application
  RSS externally, because a parent process cannot read a utilityProcess child's RSS via Node APIs.
#>
$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

$rep = Join-Path $env:LOCALAPPDATA "SpecterStudio\zvec-phase-0\reports"
$MB = 1048576

Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep -Seconds 3
Get-ChildItem $rep -Filter 'app-mode-native-host-benchmark-host-*.json' -EA SilentlyContinue | Remove-Item -Force

$env:AWKIT_ZVEC_SPIKE_HOST = "native-host-benchmark"
Start-Process -FilePath "dist\SpecterStudio 0.1.0.exe" | Out-Null

$samples = New-Object System.Collections.Generic.List[double]
$report = $null
$deadline = (Get-Date).AddSeconds(900)

while ((Get-Date) -lt $deadline) {
  $procs = @(Get-Process SpecterStudio -EA SilentlyContinue)
  if ($procs.Count -gt 0) {
    $sum = ($procs | Measure-Object WorkingSet64 -Sum).Sum
    $samples.Add([math]::Round(($sum / $MB), 1))
  }
  $report = Get-ChildItem $rep -Filter 'app-mode-native-host-benchmark-host-*.json' -EA SilentlyContinue | Select-Object -First 1
  if ($report) { break }
  Start-Sleep -Seconds 5
}

Write-Host "benchmark report : $(if($report){$report.Name}else{'NONE'})"
if ($samples.Count -gt 0) {
  $arr = $samples.ToArray()
  $sorted = $arr | Sort-Object
  Write-Host ("external total-app RSS (MB): n={0} min={1} p50={2} max={3}" -f `
    $arr.Count, $sorted[0], $sorted[[int][math]::Floor($sorted.Count * 0.5)], $sorted[$sorted.Count - 1])
}

Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Remove-Item Env:AWKIT_ZVEC_SPIKE_HOST -EA SilentlyContinue
Write-Host "orphans after: $(@(Get-Process SpecterStudio -EA SilentlyContinue).Count)"
