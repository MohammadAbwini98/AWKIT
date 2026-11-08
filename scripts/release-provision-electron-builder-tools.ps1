<#
.SYNOPSIS
  Owner-side, non-destructive provisioning of electron-builder 25.1.8's three Windows build tools (winCodeSign 2.6.0,
  nsis 3.0.4.1, nsis-resources 3.4.1) into the app-builder cache, from SHA-512-verified archives only.

.DESCRIPTION
  Run it MANUALLY in your own terminal; agents never run it. It needs no administrator rights and changes nothing in the
  repository. It is safe to rerun: a verified staged archive or a verified cache folder is reused, everything else that
  already exists is left exactly as it is.

  For each tool:
    1. Find the source archive(s) named exactly <name>-<version>.7z under -SourceCache and verify each SHA-512 against
       the pin in scripts\verify-packaging-host.mjs (H3c), which H3c also checks against the installed toolchain.
    2. Stage it in %LOCALAPPDATA%\SpecterStudio\release-inputs\electron-builder-tools (outside Git, resources and
       app.asar): copy to a unique .partial name, verify the copy, rename it to <name>-<version>.7z without overwriting,
       verify again. An existing staged archive is reused only if it verifies.
    3. Inspect the archive inventory with the bundled 7za: no absolute or ".." paths, and the only symbolic links allowed
       are the pinned macOS-only links (winCodeSign darwin\10.12\lib\libcrypto.dylib and libssl.dylib, which Windows
       cannot create without the symlink privilege and Windows packaging never reads).
    4. If the cache folder already exists, verify it with H3c and reuse it only on PRESENT AND VERIFIED; otherwise report
       it and leave it untouched.
    5. Extract into a NEW unique work folder outside the electron-builder cache, excluding exactly the listed pinned links.
       Only 7za exit code 0 is accepted.
    6. Validate the work folder with H3c (every archive file, size and CRC32; no extra files).
    7. Promote with a same-volume, no-overwrite directory rename into
       <cache>\<name up to the first "-">\<name>-<version>, then verify in place with H3c. If that final check fails, the
       folder is moved back out of the cache into the work area so nothing unverified is left where app-builder reads.
  Nothing is deleted except empty work folders this run created. Source archives are only read.

  The cache is ELECTRON_BUILDER_CACHE when set, else %LOCALAPPDATA%\electron-builder\Cache, as app-builder reads it.

.PARAMETER SourceCache
  Folder holding the candidate .7z archives (searched recursively for exact file names), for example an older
  electron-builder cache: X:\Backup\Users\moham\AppData\Local\electron-builder\Cache

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-provision-electron-builder-tools.ps1 -SourceCache "X:\Backup\Users\moham\AppData\Local\electron-builder\Cache"

.NOTES
  Final line: RESULT PASS (exit 0), RESULT FAIL (exit 1, a mismatch or failed step) or RESULT BLOCKED (exit 2, a
  missing input or prerequisite).
#>
[CmdletBinding()]
param(
  [string]$SourceCache
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# The only archive entries that may be left unextracted; must equal MACOS_ONLY_LINKS in scripts\verify-packaging-host.mjs.
$MacOsOnlyLinks = @{
  'winCodeSign-2.6.0' = @('darwin/10.12/lib/libcrypto.dylib', 'darwin/10.12/lib/libssl.dylib')
}
$RequiredTools = @(
  @{ Name = 'winCodeSign'; Version = '2.6.0' },
  @{ Name = 'nsis'; Version = '3.0.4.1' },
  @{ Name = 'nsis-resources'; Version = '3.4.1' }
)

function Write-Step([string]$text) { Write-Host "  $text" }

function Invoke-Native([string]$exe, [string[]]$argv) {
  # Windows PowerShell turns native stderr into error records; capture it as text with a local Continue so a diagnostic
  # line is shown, never thrown away, and the exit code alone decides success.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $lines = @(& $exe @argv 2>&1 | ForEach-Object { "$_" })
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  return [pscustomobject]@{ Code = $code; Output = $lines }
}

function Get-Sha512Base64([string]$path) {
  $hex = (Get-FileHash -LiteralPath $path -Algorithm SHA512).Hash
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) { $bytes[$i] = [Convert]::ToByte($hex.Substring($i * 2, 2), 16) }
  return [Convert]::ToBase64String($bytes)
}

function Get-Sha256Hex([string]$path) {
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ArchiveListing([string]$archive) {
  $run = Invoke-Native $script:SevenZip @('l', '-slt', $archive)
  if ($run.Code -ne 0) { throw "7za could not list $archive (exit $($run.Code)): $($run.Output -join ' | ')" }
  $parts = ($run.Output -join "`n") -split "`n----------`n", 2
  if ($parts.Count -ne 2) { throw "unexpected 7za listing format for $archive" }
  $entries = New-Object System.Collections.Generic.List[object]
  foreach ($block in ($parts[1] -split "`n\s*`n")) {
    $fields = @{}
    foreach ($line in ($block -split "`n")) {
      if ($line -match '^(\w[\w ]*?) = (.*)$') { $fields[$Matches[1]] = $Matches[2] }
    }
    if (-not $fields.ContainsKey('Path')) { continue }
    # Attributes = "<Windows letters>[ <unix mode>]", for example "A_ -rw-r--r--", "D_ drwxr-xr-x", "A_ lrwxr-xr-x".
    $attributes = if ($fields.ContainsKey('Attributes')) { [string]$fields['Attributes'] } else { '' }
    $attributeParts = $attributes -split ' ', 2
    $win = $attributeParts[0]
    $unix = if ($attributeParts.Count -gt 1) { $attributeParts[1] } else { '' }
    $folder = if ($fields.ContainsKey('Folder')) { [string]$fields['Folder'] } else { '' }
    $entries.Add([pscustomobject]@{
        Rel  = ([string]$fields['Path']) -replace '\\', '/'
        Dir  = ($win -cmatch 'D') -or $unix.StartsWith('d') -or ($folder -eq '+')
        Link = ($unix -cmatch '^l[rwxsStT-]{9}$')
      })
  }
  return , $entries
}

function Test-H3c([string]$id, [string]$cacheRoot, [string]$expectedFolder) {
  # The H3c comparison in scripts\verify-packaging-host.mjs is the single acceptance rule; it is read-only. The cache
  # root is always passed explicitly, and the PASS line must name the exact folder this script means.
  $argv = @($script:Verifier, '--tool-archives', $script:Stage, '--builder-cache', $cacheRoot)
  $run = Invoke-Native 'node' $argv
  $escaped = [regex]::Escape($id)
  $controls = @($run.Output | Where-Object { $_ -match 'H3c Tool-cache inventory comparison negative controls' })
  $controlsOk = ($controls.Count -eq 1) -and ($controls[0] -match '^\s*PASS\s+H3c ')
  $toolLines = @($run.Output | Where-Object { $_ -match "H3c $escaped(\.7z archive| in the electron-builder cache)" })
  $line = @($toolLines | Where-Object { $_ -match 'in the electron-builder cache' }) | Select-Object -First 1
  $ok = $controlsOk -and ($null -ne $line) -and ($line -match '^\s*PASS\s+H3c ') -and ($line -match 'PRESENT AND VERIFIED: ') -and ($line.IndexOf("$expectedFolder,", [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
  # On failure show what the verifier said about this tool, or its last lines when it produced none (a crash).
  $detail = if ($toolLines.Count -gt 0) { $controls + $toolLines } else { @($run.Output | Select-Object -Last 15) }
  return [pscustomobject]@{ Ok = $ok; Detail = @($detail | ForEach-Object { $_.Trim() }); Code = $run.Code }
}

function Write-Detail($check) {
  Write-Step "  verifier exit $($check.Code)"
  $check.Detail | ForEach-Object { Write-Step "  verifier: $_" }
}

function Test-Inside([string]$child, [string]$parent) {
  $c = [System.IO.Path]::GetFullPath($child).TrimEnd('\') + '\'
  $p = [System.IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
  return $c.StartsWith($p, [System.StringComparison]::OrdinalIgnoreCase)
}

function Remove-EmptyFolder([string]$path) {
  # Only ever removes an EMPTY folder this run created; anything with content is kept.
  if (-not (Test-Path -LiteralPath $path -PathType Container)) { return }
  if (@(Get-ChildItem -LiteralPath $path -Force).Count -gt 0) { return }
  try { [System.IO.Directory]::Delete($path, $false) } catch { Write-Step "note: could not remove the empty work folder $path ($($_.Exception.Message))" }
}

function Invoke-Tool([hashtable]$tool) {
  $id = "$($tool.Name)-$($tool.Version)"
  $pin = $script:Pins[$id]
  $sub = if ($tool.Name.Contains('-')) { $tool.Name.Substring(0, $tool.Name.IndexOf('-')) } else { $tool.Name }
  $dest = Join-Path $script:Cache (Join-Path $sub $id)
  Write-Host ""
  Write-Host "[$id]"

  # 1. Source archive(s): exact name, verified by SHA-512, never trusted by name. On a rerun without the source, an
  #    already staged archive is used only if it verifies.
  $staged = Join-Path $script:Stage "$id.7z"
  $candidates = @(Get-ChildItem -LiteralPath $script:SourceCacheFull -Recurse -File -Filter "$id.7z" -ErrorAction Stop | Where-Object { $_.Name -ceq "$id.7z" })
  if ($candidates.Count -eq 0) {
    if ((Test-Path -LiteralPath $staged) -and ((Get-Sha512Base64 $staged) -ceq $pin)) { Write-Step "source: none under $script:SourceCacheFull; the staged archive verifies and is used" }
    else { Write-Step "BLOCKED: no $id.7z under $script:SourceCacheFull and no verified staged copy"; return 'BLOCKED' }
  } else {
    $source = $null
    foreach ($candidate in $candidates) {
      $match = (Get-Sha512Base64 $candidate.FullName) -ceq $pin
      Write-Step ("source {0}: {1}, {2} bytes, SHA-256 {3}" -f $(if ($match) { 'VERIFIED' } else { 'CHECKSUM MISMATCH' }), $candidate.FullName, $candidate.Length, (Get-Sha256Hex $candidate.FullName))
      if ($match -and $null -eq $source) { $source = $candidate.FullName }
    }
    if ($null -eq $source) { Write-Step "FAIL: no source archive matches the pinned SHA-512"; return 'FAIL' }
  }

  # 2. Staged copy outside Git, verified twice, never overwritten.
  if (Test-Path -LiteralPath $staged) {
    if ((Get-Sha512Base64 $staged) -cne $pin) { Write-Step "FAIL: existing staged $staged does not match the pinned SHA-512; preserved for inspection, nothing extracted"; return 'FAIL' }
    Write-Step "staged VERIFIED (existing, reused): $staged"
  } else {
    $partial = "$staged.partial-$script:Stamp"
    Copy-Item -LiteralPath $source -Destination $partial -ErrorAction Stop
    if ((Get-Sha512Base64 $partial) -cne $pin) { Write-Step "FAIL: staged copy $partial does not match the pinned SHA-512; preserved for inspection"; return 'FAIL' }
    [System.IO.File]::Move($partial, $staged)
    if ((Get-Sha512Base64 $staged) -cne $pin) { Write-Step "FAIL: $staged changed after staging; preserved for inspection"; return 'FAIL' }
    Write-Step "staged VERIFIED: $staged, SHA-256 $(Get-Sha256Hex $staged)"
  }

  # 3. Archive inventory: path safety and the pinned-link exception, from the archive's own listing.
  $listing = Get-ArchiveListing $staged
  $unsafe = @($listing | Where-Object { $_.Rel -match '^(?:[A-Za-z]:|/)' -or (($_.Rel -split '/') -contains '..') })
  if ($unsafe.Count -gt 0) { Write-Step "FAIL: unsafe archive paths: $(@($unsafe | ForEach-Object { $_.Rel }) -join ', ')"; return 'FAIL' }
  $allowed = if ($MacOsOnlyLinks.ContainsKey($id)) { @($MacOsOnlyLinks[$id]) } else { @() }
  $links = @($listing | Where-Object { $_.Link } | ForEach-Object { $_.Rel })
  $unexpected = @($links | Where-Object { $allowed -notcontains $_ })
  if ($unexpected.Count -gt 0) { Write-Step "FAIL: symbolic links outside the pinned macOS-only list: $($unexpected -join ', ')"; return 'FAIL' }
  $fileCount = @($listing | Where-Object { -not $_.Dir }).Count
  Write-Step ("inventory: {0} files, {1} folders, symbolic links {2}" -f $fileCount, @($listing | Where-Object { $_.Dir }).Count, $(if ($links.Count) { ($links -join ', ') + ' (pinned macOS-only, excluded from extraction)' } else { 'none' }))

  # 4. An existing cache folder is reused only if H3c verifies it; otherwise it is reported and left untouched.
  if (Test-Path -LiteralPath $dest) {
    $check = Test-H3c $id $script:Cache $dest
    if ($check.Ok) { Write-Step "cache PRESENT AND VERIFIED (existing, left unchanged): $dest"; return 'PASS' }
    Write-Step "FAIL: existing cache folder $dest is not verified; preserved for inspection, nothing extracted"
    Write-Detail $check
    return 'FAIL'
  }

  # 5. Extract into a new work folder outside the cache; only exit code 0 is accepted.
  $workTool = Join-Path $script:WorkRoot (Join-Path $sub $id)
  New-Item -ItemType Directory -Path $workTool -ErrorAction Stop | Out-Null
  $argv = @('x', $staged, "-o$workTool", '-y', '-bd') + @($links | ForEach-Object { '-x!' + ($_ -replace '/', '\') })
  $extract = Invoke-Native $script:SevenZip $argv
  $extract.Output | Where-Object { $_.Trim() } | ForEach-Object { Write-Step "  7za: $_" }
  if ($extract.Code -ne 0) { Write-Step "FAIL: 7za exit $($extract.Code); incomplete output kept outside the cache at $workTool"; return 'FAIL' }

  # 6. Validate the complete inventory before promotion.
  $work = Test-H3c $id $script:WorkRoot $workTool
  if (-not $work.Ok) { Write-Step "FAIL: extracted folder not verified; kept outside the cache at $workTool"; Write-Detail $work; return 'FAIL' }
  Write-Step "extracted folder PRESENT AND VERIFIED (work area)"

  # 7. Same-volume, no-overwrite promotion, then verification in place.
  New-Item -ItemType Directory -Path (Join-Path $script:Cache $sub) -Force -ErrorAction Stop | Out-Null
  if (Test-Path -LiteralPath $dest) { Write-Step "FAIL: $dest appeared during the run; verified copy kept at $workTool"; return 'FAIL' }
  [System.IO.Directory]::Move($workTool, $dest)
  $final = Test-H3c $id $script:Cache $dest
  if (-not $final.Ok) {
    try {
      [System.IO.Directory]::Move($dest, $workTool)
      Write-Step "FAIL: in-place verification failed; folder moved back out of the cache to $workTool"
    } catch {
      Write-Step "FAIL: UNVERIFIED FOLDER LEFT IN CACHE: $dest - remove it before packaging ($($_.Exception.Message))"
    }
    Write-Detail $final
    return 'FAIL'
  }
  Remove-EmptyFolder (Join-Path $script:WorkRoot $sub)
  Write-Step "cache PRESENT AND VERIFIED (promoted): $dest"
  return 'PASS'
}

# ---- Prerequisites (any gap is BLOCKED) -----------------------------------------------------------------------------
Write-Host "electron-builder tool-cache provisioning (owner-side, non-destructive)"
$blockedReasons = New-Object System.Collections.Generic.List[string]
$repo = Split-Path -Parent $PSScriptRoot
$script:Verifier = Join-Path $repo 'scripts\verify-packaging-host.mjs'
if (-not $SourceCache) { $blockedReasons.Add('-SourceCache <folder holding the .7z archives> is required') }
elseif (-not (Test-Path -LiteralPath $SourceCache -PathType Container)) { $blockedReasons.Add("source folder not found: $SourceCache") }
if (-not $env:LOCALAPPDATA) { $blockedReasons.Add('LOCALAPPDATA is not set') }
if ($env:ELECTRON_BUILDER_CACHE -and $env:ELECTRON_BUILDER_CACHE -notmatch '^(?:[A-Za-z]:\\|\\\\)') { $blockedReasons.Add("ELECTRON_BUILDER_CACHE is not an absolute path ($env:ELECTRON_BUILDER_CACHE)") }
if (-not (Test-Path -LiteralPath $script:Verifier -PathType Leaf)) { $blockedReasons.Add("verifier not found: $script:Verifier") }
# The same 7za build the verifier lists with: node_modules\7zip-bin\win\<node's process.arch>.
$script:SevenZip = ''
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $blockedReasons.Add('node is not on PATH') }
else {
  $archRun = Invoke-Native 'node' @('-p', 'process.arch')
  $nodeArch = if ($archRun.Code -eq 0 -and $archRun.Output.Count -gt 0) { $archRun.Output[0].Trim() } else { '' }
  $script:SevenZip = Join-Path $repo "node_modules\7zip-bin\win\$nodeArch\7za.exe"
  if (-not $nodeArch -or -not (Test-Path -LiteralPath $script:SevenZip -PathType Leaf)) { $blockedReasons.Add("bundled 7za not found for node arch '$nodeArch': $script:SevenZip (run npm install in the repository)") }
}

$script:Pins = @{}
if (Test-Path -LiteralPath $script:Verifier -PathType Leaf) {
  $verifierText = [System.IO.File]::ReadAllText($script:Verifier)
  foreach ($m in [regex]::Matches($verifierText, '\{ name: "([^"]+)", version: "([^"]+)", sha512: "([A-Za-z0-9+/]{86}==)" \}')) {
    $script:Pins["$($m.Groups[1].Value)-$($m.Groups[2].Value)"] = $m.Groups[3].Value
  }
  foreach ($tool in $RequiredTools) {
    if (-not $script:Pins.ContainsKey("$($tool.Name)-$($tool.Version)")) { $blockedReasons.Add("no SHA-512 pin for $($tool.Name)-$($tool.Version) in $script:Verifier") }
  }
  if ($script:Pins.Count -ne $RequiredTools.Count) { $blockedReasons.Add("expected exactly $($RequiredTools.Count) tool pins in $script:Verifier, found $($script:Pins.Count)") }
}

if ($blockedReasons.Count -eq 0) {
  $script:SourceCacheFull = (Resolve-Path -LiteralPath $SourceCache).ProviderPath
  $script:Cache = if ($env:ELECTRON_BUILDER_CACHE) { [System.IO.Path]::GetFullPath($env:ELECTRON_BUILDER_CACHE) } else { Join-Path $env:LOCALAPPDATA 'electron-builder\Cache' }
  $script:Stage = Join-Path $env:LOCALAPPDATA 'SpecterStudio\release-inputs\electron-builder-tools'
  $script:Stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
  $script:WorkRoot = Join-Path $env:LOCALAPPDATA "SpecterStudio\release-inputs\electron-builder-work\$script:Stamp"
  foreach ($p in @($script:Cache, $script:Stage, $script:WorkRoot)) {
    if (Test-Inside $p $repo) { $blockedReasons.Add("$p is inside the repository; refusing") }
  }
  foreach ($p in @($script:Stage, $script:WorkRoot)) {
    if ((Test-Inside $p $script:Cache) -or (Test-Inside $script:Cache $p)) { $blockedReasons.Add("$p overlaps the electron-builder cache $script:Cache; refusing") }
  }
  if ([System.IO.Path]::GetPathRoot($script:Cache) -ne [System.IO.Path]::GetPathRoot($script:WorkRoot)) {
    $blockedReasons.Add("the cache ($script:Cache) and the work area ($script:WorkRoot) are on different volumes, so promotion could not be a single rename")
  }
}

if ($blockedReasons.Count -gt 0) {
  $blockedReasons | ForEach-Object { Write-Host "  BLOCKED: $_" }
  Write-Host ""
  Write-Host "RESULT BLOCKED"
  exit 2
}

Write-Host "  source  $script:SourceCacheFull"
Write-Host "  staging $script:Stage"
Write-Host "  work    $script:WorkRoot"
Write-Host "  cache   $script:Cache"

# ---- Per tool ---------------------------------------------------------------------------------------------------------
$results = [ordered]@{}
try {
  New-Item -ItemType Directory -Path $script:Stage -Force -ErrorAction Stop | Out-Null
  New-Item -ItemType Directory -Path $script:WorkRoot -ErrorAction Stop | Out-Null
} catch {
  Write-Host "  BLOCKED: could not create the staging or work folder: $($_.Exception.Message)"
  Write-Host ""
  Write-Host "RESULT BLOCKED"
  exit 2
}
foreach ($tool in $RequiredTools) {
  $id = "$($tool.Name)-$($tool.Version)"
  try {
    $results[$id] = Invoke-Tool $tool
  } catch {
    Write-Step "FAIL: $($_.Exception.Message)"
    $results[$id] = 'FAIL'
  }
}
Remove-EmptyFolder $script:WorkRoot
Remove-EmptyFolder (Split-Path -Parent $script:WorkRoot)

Write-Host ""
foreach ($key in $results.Keys) { Write-Host ("  {0,-8} {1}" -f $results[$key], $key) }
$overall = if (@($results.Values | Where-Object { $_ -eq 'FAIL' }).Count -gt 0) { 'FAIL' } elseif (@($results.Values | Where-Object { $_ -eq 'BLOCKED' }).Count -gt 0) { 'BLOCKED' } else { 'PASS' }
if ($overall -ne 'PASS' -and (Test-Path -LiteralPath $script:WorkRoot)) { Write-Host "  work area kept for inspection: $script:WorkRoot" }
Write-Host ""
Write-Host "RESULT $overall"
exit $(switch ($overall) { 'PASS' { 0 } 'FAIL' { 1 } default { 2 } })
