# Clean-machine validation — execution record, 2026-07-29

Results of running `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` against a purpose-built, offline Windows 11
VM. This is the runbook's §12 result template, filled in.

**Disposition: PARTIALLY EXECUTED — 20 PASS / 0 FAIL / 3 sections NOT EXECUTED.**

Read that precisely. Sections 1, 2, 4 and 7 were executed and every check in them passed. Sections 5,
6 and 8 were **not executed**. Per the runbook's own §9 a FAIL is blocking and there were none — but
this record does **not** claim the runbook as a whole passed, and the gate's overall execution status
is therefore not "PASSED". The 2026-07-24 owner policy already makes clean-machine validation
optional and non-blocking; nothing here changes that policy, it only replaces "never executed" with
"partially executed, no failures".

---

## Environment

| Item | Value |
|---|---|
| Host | Windows 10 Enterprise 19045, standard user in `Hyper-V Administrators` (not local admin) |
| Guest | Microsoft Windows 11 Pro **10.0.26100** x64, installed unattended from a local ISO |
| VM | `AWKIT-CleanMachine`, Hyper-V **Generation 1**, 6 GB RAM, 4 vCPU, 64 GB dynamic VHDX |
| Network | **No adapter exists.** Removed before first boot, not merely disconnected |
| Test account | `awkituser` — local **standard** user, auto-logged-on, never in Administrators |
| Orchestration | Hyper-V PowerShell Direct (works with zero network) as a separate admin account |
| Evidence capture | Host-side `Msvm_VirtualSystemManagementService` thumbnails — **no agent in the guest** |
| Artifacts under test | Portable `0934866d…`, NSIS `4ba8c55f…`, both built 2026-07-29 from a clean tree |

Tooling: `scripts/clean-machine/{provision-vm.ps1,autounattend.xml,attach-artifacts.ps1,run-runbook.ps1,vm-screenshot.ps1}`.

## Deviations — recorded, not hidden

1. **Generation 1 (BIOS) VM, so no UEFI, no Secure Boot, no TPM.** Hyper-V's Gen 2 UEFI firmware
   refuses this ISO's boot loader ("The boot loader failed") with Secure Boot both on and off, with
   the ISO staged locally and uncontended. The identical ISO boots its BIOS El Torito entry first
   time, and the media is provably sound — its UEFI entry is a valid FAT12 image with a correct
   `0x55AA` signature. The fault is in the Gen 2 boot path, not the media.
2. **Windows Setup's hardware gate was relaxed** with `LabConfig` `BypassTPMCheck` /
   `BypassSecureBootCheck` / `BypassRAMCheck`, which follows from (1).

Neither deviation touches what this runbook validates. §1.1 asks for "clean Windows 10/11 x64" and
says nothing about firmware; §1.2–§1.8 are all fully satisfied; and an offline Electron application's
behaviour does not depend on the firmware type. Recorded here so a reader can judge that for
themselves rather than take it on trust.

3. **Licence terms and local accounts.** The owner explicitly authorised accepting the Microsoft
   Software Licence Terms and creating local accounts inside this throwaway VM on 2026-07-29. The
   product key in `autounattend.xml` is Microsoft's published generic Pro key, which selects an
   edition during setup and does not activate Windows.

---

## §1 — Required environment and standard-user constraints

| # | Constraint | Result | Evidence |
|---|---|---|---|
| 1.1 | Clean Windows 10/11 x64, fresh VM | **PASS** | Windows 11 Pro 10.0.26100 64-bit |
| 1.2 | No project source tree present | **PASS** | no `AWTKIT` / `package.json` / `node_modules` on any volume |
| 1.3 | No development server running | **PASS** | 0 `node.exe` processes |
| 1.4 | No global Node.js on PATH | **PASS** | `where node` → not found |
| 1.5 | No existing AWKIT/SpecterStudio profile | **PASS** | neither `LocalAppData\SpecterStudio` nor `Programs\specterstudio` existed |
| 1.6 | No internet access | **PASS** | **0 network adapters**; `ping 8.8.8.8` fails |
| 1.7 | Standard (non-administrator) account | **PASS** | Administrators = `Administrator`, `awkitadmin` only — `awkituser` absent |
| 1.8 | NSIS test uses the same standard user | **PASS** | see §7 |

## §2 — Artifact hashes verified ON the test machine

| # | Check | Result | Evidence |
|---|---|---|---|
| 2.copy | Delivered on read-only media | **PASS** | read-only UDF DVD (`AWKITREL`); PowerShell Direct cannot carry 200 MB |
| 2.a | Portable SHA-256 matches | **PASS** | `0934866d4a2bf04d…`, 212,827,189 bytes |
| 2.b | NSIS SHA-256 matches | **PASS** | `4ba8c55f812af05f…`, 244,263,870 bytes |
| 2.sig | Signing status recorded | **PASS** | Authenticode **NotSigned** — expected, not a failure |

## §4 — Clean-profile portable test (standard user, empty profile)

| # | Check | Result | Evidence |
|---|---|---|---|
| 4.1 | Portable launches and stays up | **PASS** | 4 `SpecterStudio` processes |
| 4.2 | Runs as the STANDARD user, not elevated | **PASS** | process owner = `awkituser` |
| 4.3 | Runtime profile created under LocalAppData | **PASS** | 21 folders incl. `runtime`, `security`, `Licensing`, `semantic-index` |
| 4.4 | First-run setup UI renders, no white screen | **PASS** | `s4-portable-launch.png` |
| 4.5 | SmartScreen behaviour | **PASS** | **no blocking prompt** — reached first-run setup unattended |

`s4-portable-launch.png` shows the "Set up SpecterStudio" first-run screen on the clean desktop.

## §7 — NSIS per-user install, launch and uninstall

| # | Check | Result | Evidence |
|---|---|---|---|
| 7.1 | Installs per-user with no elevation | **PASS** | `…\AppData\Local\Programs\specterstudio` |
| 7.2 | No UAC consent prompt | **PASS** | 0 `consent.exe` processes |
| 7.3 | Installed build launches as standard user | **PASS** | `s7-installed-launch.png` — branded splash + desktop shortcut |
| 7.4 | Uninstall removes the installation | **PASS** | `REMOVED` |

## Not executed

| Section | Why |
|---|---|
| §3 | Offline setup steps — subsumed by the automated provisioning, not separately walked |
| §5 | Upgrade-profile procedure (pre-populated profile) — not automated by this driver |
| §6 | Portable application summary gate — not automated by this driver |
| §8 | Validation, grants, migration, backup, restart and undo scenarios — not automated |

These are the obvious next increment: the driver already has guest command execution, interactive
GUI launch and host-side capture, so §5 and §6 mostly need fixture seeding plus assertions.

## Machine-readable record

`docs/testing/clean-machine-evidence/runbook-results.json` — every check with its status and detail,
as emitted by the driver.
