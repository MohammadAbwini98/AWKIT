# Clean-machine release validation — 2026-08-29

## Disposition

**21 PASS / 0 FAIL / 3 NOT EXECUTED.** This is a qualifying offline Windows 11 Pro Hyper-V guest,
not the development checkout. It validates the fresh 0.1.21 portable and NSIS packaging/installer
path. It does not claim the three runbook sections the existing driver explicitly omits.

## Environment

- VM: `AWKIT-CleanMachine`, restored from `clean-before-validation`.
- Guest: Microsoft Windows 11 Pro 10.0.26100 x64.
- Account under test: `awkituser`, standard/non-administrator.
- Network adapters: 0; ping to 8.8.8.8: false.
- Development dependencies: no source tree, Node process or global Node executable.
- Initial product state: no SpecterStudio LocalAppData profile or per-user installation.
- Delivery: read-only `AWKITREL` DVD made by `scripts/clean-machine/attach-artifacts.ps1`.
- Host evidence: `dist/clean-machine-evidence-2026-08-29-release/` (ignored release evidence).

## Exact artifacts

| Artifact | Bytes | SHA-256 | Guest match |
|---|---:|---|---|
| `SpecterStudio 0.1.21.exe` | 236,657,420 | `a9ef0eeab1c6e38d53936fc019761a7cd0bb3efb96fc4ee4de8ceb77d85bc560` | PASS |
| `SpecterStudio Setup 0.1.21.exe` | 263,872,975 | `0c4168d1d8dd70ab7a94b566dbf56f60f4e1331d0ff82e2900f36f08f176d012` | PASS |

Source provenance: clean commit `9768d6fa38439e91af2a3369a1271c4114c6dd6b`, application 0.1.21.
The detached dependency manifest is Ed25519-signed and strict offline validation passed. Windows
Authenticode status on the guest was `NotSigned`.

## Executed observations

- Environment constraints 1.1–1.7: 7 PASS.
- Read-only delivery, guest portable/installer hashes and recorded signing status: 4 PASS.
- Portable cold launch, standard-user process ownership, LocalAppData runtime profile and rendered
  first-run UI: 5 PASS.
- NSIS per-user install exit `0x00000000`, no historical `0xC0000005` crash, no UAC prompt,
  installed-build launch and uninstall removal: 5 PASS.

The LocalAppData profile contained the expected mutable runtime roots, including `flows`, `workflows`,
`logs`, `reports`, `runtime`, `profiles`, `screenshots`, `security`, `storage` and `temp`.

## Explicitly not executed

- `5.x` upgrade-profile procedure.
- `6.x` portable application summary gate.
- `8.x` validation/grant/migration/backup/restart/undo scenarios.

These three rows are NOT EXECUTED, not PASS or BLOCKED. Packaged real-Oracle execution, licensed
installed-Chrome workflow execution and sustained multi-day soak are also outside this run and remain
tracked separately.
