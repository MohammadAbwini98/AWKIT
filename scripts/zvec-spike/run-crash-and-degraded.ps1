<#
  Phase 0D SC - crash isolation with the FULL app running (not a host-only harness).
  Phase 0D SD - degraded mode with a damaged Zvec asset, on a disposable full-package copy.
#>
$ErrorActionPreference = "Continue"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $root

$rep = Join-Path $env:LOCALAPPDATA "SpecterStudio\zvec-phase-0\reports"
function Kill-App { Get-Process SpecterStudio -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue; Start-Sleep -Seconds 3 }

# --------------------------- C. CRASH ISOLATION ---------------------------
Write-Host "=== C. NEW-HOST CRASH ISOLATION (full app alive) ==="
Kill-App
Get-ChildItem $rep -Filter 'app-mode-native-host-crash-host-*.json' -EA SilentlyContinue | Remove-Item -Force

$env:AWKIT_ZVEC_SPIKE_HOST     = "native-host-crash"
$env:AWKIT_ZVEC_SPIKE_WITH_APP = "1"
$env:AWKIT_ZVEC_SPIKE_DELAY_MS = "20000"
Start-Process -FilePath "dist\SpecterStudio 0.1.0.exe" | Out-Null

$dl = (Get-Date).AddSeconds(240); $r = $null
while ((Get-Date) -lt $dl) {
  $r = Get-ChildItem $rep -Filter 'app-mode-native-host-crash-host-*.json' -EA SilentlyContinue | Select-Object -First 1
  if ($r) { break }
  Start-Sleep -Seconds 3
}

if ($r) {
  $j = Get-Content $r.FullName -Raw | ConvertFrom-Json
  Write-Host "report ok = $($j.ok)"
  foreach ($s in $j.steps) { Write-Host ("   {0,-6} {1,-34} {2}" -f $s.ok, $s.label, $s.detail) }
  Write-Host "measurements: $($j.measurements | ConvertTo-Json -Compress)"
} else {
  Write-Host "NO CRASH-ISOLATION REPORT PRODUCED"
}

# The decisive question: is the APPLICATION still alive after the native abort?
Start-Sleep -Seconds 3
$procs = @(Get-Process SpecterStudio -EA SilentlyContinue)
$win = $procs | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
Write-Host "`nAFTER CRASH: app processes = $($procs.Count) (expect > 0)"
Write-Host "AFTER CRASH: main window   = $(if($win){"'$($win.MainWindowTitle)'"}else{'NONE'})"
Write-Host "AFTER CRASH: responding    = $(if($win){$win.Responding}else{'n/a'})"
Kill-App
Remove-Item Env:AWKIT_ZVEC_SPIKE_HOST -EA SilentlyContinue
Remove-Item Env:AWKIT_ZVEC_SPIKE_WITH_APP -EA SilentlyContinue
Remove-Item Env:AWKIT_ZVEC_SPIKE_DELAY_MS -EA SilentlyContinue

# --------------------------- D. DEGRADED MODE ---------------------------
Write-Host "`n=== D. DAMAGED-HOST DEGRADED MODE (disposable package copy) ==="
$disposable = Join-Path $env:TEMP "awkit-degraded-test"
if (Test-Path $disposable) { Remove-Item -LiteralPath $disposable -Recurse -Force }

Write-Host "copying dist\win-unpacked -> $disposable ..."
robocopy "dist\win-unpacked" $disposable /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with $LASTEXITCODE" }
$global:LASTEXITCODE = 0

$binding = Join-Path $disposable "resources\native-hosts\zvec\node_modules\@zvec\bindings-win32-x64\zvec_node_binding.node"
if (Test-Path $binding) {
  # Corrupt in place, preserving size, so only a checksum/load failure can reveal it.
  $fs = [IO.File]::Open($binding, 'Open', 'ReadWrite')
  $fs.Position = 1024
  $b = [byte[]](1..64 | ForEach-Object { 0 })
  $fs.Write($b, 0, $b.Length)
  $fs.Close()
  Write-Host "corrupted packaged binding (size preserved)"
}

$exe = Join-Path $disposable "SpecterStudio.exe"
Start-Process -FilePath $exe | Out-Null
Start-Sleep -Seconds 45
$procs = @(Get-Process SpecterStudio -EA SilentlyContinue)
$win = $procs | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
Write-Host "D3 app reaches main window   : $(if($win){"PASS ('$($win.MainWindowTitle)')"}else{'FAIL - no window'})"
Write-Host "D3 process count             : $($procs.Count)"
Write-Host "D7 window responding         : $(if($win){$win.Responding}else{'n/a'})"

Kill-App
Remove-Item -LiteralPath $disposable -Recurse -Force -EA SilentlyContinue
Write-Host "D8 disposable copy discarded : $(-not (Test-Path $disposable))"
