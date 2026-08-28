$ErrorActionPreference = "Stop"

# electron-builder 25.x hard-codes -mx=9 for the 7z payload used by both portable and NSIS
# targets unless this supported environment input is present. On the minimum supported 16 GiB
# release host, -mx=9 can exhaust the Windows commit limit while compressing the ~828 MiB offline
# payload. Level 5 changes compression ratio/time only: the staged files, ASAR integrity, signed
# dependency manifest, installer scope, and offline validation inputs remain unchanged.
#
# Keep this deterministic in the canonical wrappers. In particular, do not inherit an operator's
# shell value: two builds from the same source should use the same release compression policy.
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL = "5"
Write-Host "Packaging compression policy: electron-builder 7z level 5 (bounded-memory release mode)."
