# Clean-Machine Validation Runbook — SpecterStudio (AWKIT) 0.1.0

> ## ⚠ Owner-approved development waiver — 2026-07-23
>
> On 2026-07-23, the project owner explicitly waived the portable rebuild, artifact-verification, and
> clean-machine validation prerequisites **for continued backend development**. These activities were
> **not executed** and are **not considered passed**. The waiver authorizes **Backend Tranche 0**
> implementation but does **not** provide release, packaging, offline-operation, or clean-machine
> acceptance evidence. The original validation work remains open as **release debt**.
>
> | Gate | Status |
> |---|---|
> | Portable rebuild | **NOT EXECUTED — OWNER-APPROVED WAIVER** |
> | Portable/NSIS artifact verification | **NOT EXECUTED — OWNER-APPROVED WAIVER** |
> | Clean-machine validation | **NOT EXECUTED — OWNER-APPROVED WAIVER** |
> | Evidence-based promotion of `61f6099` | **NOT COMPLETED — OWNER-APPROVED DEVELOPMENT WAIVER** |
> | Backend Tranche 0 | **EXPLICITLY AUTHORIZED** |
>
> This waiver does not alter any check below: every item remains `☐ Not Executed` and no pass is
> claimed. Release/promotion still requires the full runbook to be executed on a qualifying machine.

**Purpose.** Execute the outstanding **clean offline Windows environment** acceptance gate for the
Flow Validation Engine (Tranche 2). This runbook is written for a human tester or an agent with
access to a qualifying Windows VM or physical test machine. The developer machine **cannot** satisfy
these constraints, so every result below is currently **Not Executed**.

**Authoritative status before this runbook is executed:**
- `Tranche 2: IMPLEMENTED AND VERIFIED ON THE DEVELOPER MACHINE — CLEAN-MACHINE ACCEPTANCE PENDING`
- `Product promotion: NOT YET APPROVED`
- `Remaining acceptance gate: clean offline Windows environment validation`

> **This runbook makes no pass claims.** Every check is a `☐ Not Executed` item until a tester runs
> it on a qualifying machine and records the outcome in the §12 result template. Do **not** edit this
> document to mark checks passed; record results in a copy or in the result template only. Nothing
> here has been performed on a clean machine.

> **Prior evidence is NOT clean-machine evidence.** The source, Electron-development,
> packaged-runtime, portable-build, SHA-256, authorization, migration, concurrency, and 1,000-flow
> scale evidence already collected was produced **on the developer machine** and is accepted **only**
> as developer-machine evidence. It does not substitute for any step in this runbook.

---

## 1. Required environment and standard-user constraints

The target machine MUST meet all of the following. Record each in §12.

| # | Constraint | How to confirm |
|---|---|---|
| 1.1 | Clean Windows 10/11 x64 (fresh VM, Windows Sandbox with a mapped folder, or a reimaged physical machine). | `winver`; VM snapshot id / image name. |
| 1.2 | **No project source tree** present. | No AWKIT/SpecterStudio repo checkout anywhere on the machine. |
| 1.3 | **No development server** and no `npm`/`electron-vite` process running or required. | Task Manager shows no `node.exe` from a dev server. |
| 1.4 | **No globally installed Node.js** that the app relies on. Node may be absent entirely; if present, it must not be on `PATH` for the app to work. | `where node` → "not found" is ideal; if found, note it and confirm the app still runs. |
| 1.5 | **No existing AWKIT / SpecterStudio profile.** | `%LOCALAPPDATA%\SpecterStudio` does **not** exist; `%LOCALAPPDATA%\Programs\specterstudio` does not exist. |
| 1.6 | **No internet access during validation.** | Disconnect the vNIC / enable an offline profile. Verify with `Test-NetConnection 8.8.8.8 -Port 53` → fails, or `ping 8.8.8.8` → 100% loss. Keep offline for the entire run. |
| 1.7 | A **standard (non-administrator)** Windows user account for the **portable** test. | `whoami /groups \| findstr /i "S-1-5-32-544"` shows the Administrators group is **not** enabled (deny-only or absent). |
| 1.8 | For the **NSIS** test: the same standard user (the installer is per-user, no elevation). If a UAC prompt appears, that is a **finding** — record it. | See §7. |

**Note on SmartScreen.** Both artifacts are **unsigned** (see §2). Windows SmartScreen will warn on
first launch ("Windows protected your PC"). Choosing *More info → Run anyway* is expected and is
itself a finding to record — it is not a failure of the app.

---

## 2. Portable and NSIS artifact hashes

Copy these two files to the test machine (e.g. via read-only USB or a mapped read-only share). **Do
not** copy the source tree or `node_modules`. Verify the hashes **on the test machine** before use.

### Portable
```
File    : SpecterStudio 0.1.0.exe
Size    : 325,296,994 bytes  (310.2 MiB)
Built   : 2026-07-22T00:32:12+03:00
SHA-256 : 129833754870f5fa2663efa48b979aaecaf1532831f20805a5b3f6537264c1fb
Signing : NotSigned  (Authenticode status: NotSigned — do NOT claim signed)
```

### NSIS installer
```
File    : SpecterStudio Setup 0.1.0.exe
Size    : 373,904,285 bytes  (356.6 MiB)
Built   : 2026-07-22T01:40:27+03:00
SHA-256 : 74950020d105af9b5f188d09a467d1ad297fbfc064b12cabe9931f1c4e6e2a5a
SHA-512 : IeuFo2FgJUPMUrVdB+KlqGyY6K9ZPgvDDU2vm+qvZyWiCFxdhMRAb8A4SLual4+t0SZsiEdRe8wXN98+4VRcvQ==  (base64; matches dist/latest.yml)
Signing : NotSigned  (Authenticode status: NotSigned — do NOT claim signed)
```

**Verify on the test machine (PowerShell):**
```powershell
Get-FileHash ".\SpecterStudio 0.1.0.exe"        -Algorithm SHA256 | Format-List
Get-FileHash ".\SpecterStudio Setup 0.1.0.exe"  -Algorithm SHA256 | Format-List
# Confirm signing status (expected: NotSigned for both):
Get-AuthenticodeSignature ".\SpecterStudio 0.1.0.exe"       | Select-Object Status, SignerCertificate
Get-AuthenticodeSignature ".\SpecterStudio Setup 0.1.0.exe" | Select-Object Status, SignerCertificate
```
Record computed hashes and signing status in §12. **Any hash mismatch aborts the run** — the artifact
is not the validated build.

---

## 3. Exact offline setup steps

1. **Snapshot** the clean VM (so it can be restored between the portable and installer passes). Record
   the snapshot id in §12.
2. Confirm every §1 constraint. Record results.
3. **Go offline** (§1.6) and confirm no connectivity. Keep offline until the run is complete.
4. Create two working folders on the desktop of the standard user:
   - `C:\Users\<user>\Desktop\awkit-portable\` — copy the **portable** EXE here.
   - `C:\Users\<user>\Desktop\awkit-installer\` — copy the **NSIS** EXE here.
5. Verify both hashes (§2). Record.
6. Prepare the **upgrade-profile seed** (used in §5). On the test machine, create the folder tree and
   copy in a realistic flow library plus the legacy fixtures described in §5.1. Do this **before**
   first launch of the relevant pass.

**Data locations the app uses** (all under the user profile; no admin, no `Program Files`):
```
%LOCALAPPDATA%\SpecterStudio\                     ← runtime data root
  flows\  workflows\  logs\  screenshots\  reports\  downloads\  instances\  storage\  temp\
  validation\
    legacy-grants\        ← one JSON per Legacy Compatibility grant
    inventory-scans\      ← one JSON per inventory scan
    migrations\           ← one JSON per applied migration
    backups\              ← untouched pre-migration flow backups
%LOCALAPPDATA%\Programs\specterstudio\            ← NSIS per-user install target (created in §7)
```
The runtime SQLite database path is reported by the app itself (Instance Monitor → runtime status,
field `sqlitePath`); use that rather than assuming a fixed subpath.

---

## 4. Clean-profile test procedure (PORTABLE, empty profile)

Restore the clean snapshot. Confirm `%LOCALAPPDATA%\SpecterStudio` does **not** exist. Launch
`SpecterStudio 0.1.0.exe` **as the standard user** (double-click; accept the SmartScreen warning).

| # | Step | Expected result | Result |
|---|---|---|---|
| 4.1 | First launch. | Window renders (no white screen); no admin prompt. | ☐ Not Executed |
| 4.2 | First-run account creation (display name, username, password ≥12 chars). | Account created; app shell loads. | ☐ Not Executed |
| 4.3 | Confirm `%LOCALAPPDATA%\SpecterStudio\` and its runtime folders were created. | Folder tree present (§3). | ☐ Not Executed |
| 4.4 | Bundled Chromium launches: open Flow Designer, build `start → goto(mock or data URL) → end`, run it. | Run completes; a bundled-Chromium process appears and exits; no global Chrome used. | ☐ Not Executed |
| 4.5 | Create a flow, **Save**, reopen it from the library, run it. | Round-trips cleanly; runs. | ☐ Not Executed |
| 4.6 | Import a flow JSON (a valid one) via the app's import. | Imports; shows Runnable. | ☐ Not Executed |
| 4.7 | Build an **invalid** flow (a Click with no locator). **Save**. | Save **succeeds as a Draft**; chip reads `Draft — not runnable`; the graph is unchanged (nothing auto-fixed). | ☐ Not Executed |
| 4.8 | Attempt to **run** the invalid flow's workflow. | **Blocked** ("validation failed") with a specific active-path message; browser does not launch. | ☐ Not Executed |
| 4.9 | Confirm artifact writes after a real run: `logs\<...>.jsonl`, `screenshots\`, `reports\`, `runtime.sqlite`. | Files present; JSONL parses; secrets masked. | ☐ Not Executed |
| 4.10 | Confirm no `runnable`/`validated` verdict is written into any flow JSON on disk. | Flow JSON contains only its own fields (id/name/version/nodes/edges/timestamps). | ☐ Not Executed |
| 4.11 | Close the app; confirm no leftover bundled-Chromium process and no `.tmp` files under `validation\`. | Process tree gone; no partial writes. | ☐ Not Executed |
| 4.12 | Relaunch (returning-user sign-in); confirm the flows and data persist. | Sign-in works; data intact. | ☐ Not Executed |

---

## 5. Upgrade-profile test procedure (PORTABLE, pre-populated profile)

This exercises the paths that break on real upgrades: an existing library with mixed validity, a
**pre-hardening (FNV-era) grant**, an old migration record, and prior run history.

### 5.1 Seed the upgrade profile (before launch)

Under `%LOCALAPPDATA%\SpecterStudio\`, create:

- `flows\` — a realistic library (≥ 20 flows) that includes at least:
  - several **valid** flows,
  - at least one **off-path-only** flow (a reachable graph plus an extra node with no incoming
    connector — an "orphan"),
  - at least one **active-path-broken** flow (e.g. a Click with no locator on the main path),
  - at least one **fixable** flow (a conditional connector whose operator is mis-cased, e.g.
    `"NotEquals"` instead of `notEquals`).
- `workflows\` — one workflow per named flow above, each referencing exactly that flow.
- `validation\legacy-grants\<orphanFlowId>.json` — a **pre-hardening** grant record for the off-path
  flow, with an **unprefixed 16-hex** content hash (FNV-era format), unexpired, e.g.:
  ```json
  {
    "id": "<orphanFlowId>",
    "contentHash": "9f4c1a2b3d5e6f70",
    "grantedAt": "2026-01-01T00:00:00.000Z",
    "expiresAt": "2099-01-01T00:00:00.000Z",
    "validatorVersion": 3,
    "issueCodes": ["unreachableNode"],
    "runsUnderCompatibility": 7
  }
  ```
- `validation\migrations\old-record.json` — a plausible historical migration record (any prior fix).

Record the exact seed contents / a copy of the seed folder in §12.

### 5.2 Checks (launch as the standard user)

| # | Step | Expected result | Result |
|---|---|---|---|
| 5.1 | Launch; sign in (or first-run if the seed omitted the account). | App loads; the seeded library appears. | ☐ Not Executed |
| 5.2 | The first inventory scan runs (on first gated action / first run request). Open the Flow Library. | Library shows per-flow status: Runnable / Not runnable / **Legacy** pill. | ☐ Not Executed |
| 5.3 | The **off-path-only** flow shows a dashed **`Legacy · until <date>`** pill, and a fresh (SHA-256) grant exists — BUT the pre-hardening seeded grant is **retired**, not honored. | Library shows Legacy with a deadline; `validation\legacy-grants\` shows the seeded record now `revokedReason: "digestFormatRetired"`, and the flow's live grant (if newly eligible) is `sha256:`-bound. | ☐ Not Executed |
| 5.4 | Run the granted (off-path-only) flow's workflow. | **Runs**, and the run report/notice states it ran under Legacy Compatibility (not silent). | ☐ Not Executed |
| 5.5 | Restart the app. | The grant **persists** with the same deadline; the Legacy pill still shows. | ☐ Not Executed |
| 5.6 | Make an **executable edit** to the granted flow (add a node) and save. | The grant **voids immediately** (standing `edited`); the flow now **blocks**; the Legacy pill is gone. | ☐ Not Executed |
| 5.7 | Make a **description-only** edit to a *different* granted flow and save. | The grant is **retained** (description is not executable content). | ☐ Not Executed |
| 5.8 | Run the **active-path-broken** flow's workflow. | **Blocked** with a specific message; never permitted by any grant. | ☐ Not Executed |
| 5.9 | Re-run the inventory scan (trigger another gated action). | No deadline is **extended**; no retired record is revived; no duplicate grant files. | ☐ Not Executed |

---

## 6. Portable application checks (summary gate)

All of §4 and §5 above, on the standard-user offline machine, using the **portable** EXE. Additionally:

| # | Step | Expected result | Result |
|---|---|---|---|
| 6.1 | The app requires **no installation** and **no admin rights** to run. | Runs from the desktop folder as the standard user. | ☐ Not Executed |
| 6.2 | **Offline throughout**: no network prompts, no failures attributable to missing internet. | Fully functional offline. | ☐ Not Executed |
| 6.3 | Restart / shutdown recovery: hard-kill the app mid-run, relaunch. | The orphaned run surfaces as recoverable (not auto-resumed); recovery panel renders. | ☐ Not Executed |

---

## 7. NSIS install, upgrade, and uninstall checks

Restore the **clean** snapshot first (so the installer runs against a machine with no prior app data
or install). Run `SpecterStudio Setup 0.1.0.exe` **as the standard user**.

### 7.1 Install
| # | Step | Expected result | Result |
|---|---|---|---|
| 7.1.1 | Launch the installer. | Assisted installer UI appears (not one-click). **No UAC / elevation prompt** (per-user). If elevation is requested, record as a **finding**. | ☐ Not Executed |
| 7.1.2 | Choose the install directory (dir is user-selectable). | Installs to `%LOCALAPPDATA%\Programs\specterstudio\` (or the chosen dir), no admin. | ☐ Not Executed |
| 7.1.3 | Confirm shortcuts. | Start-menu shortcut "SpecterStudio" created; desktop shortcut per installer config. Record which were created. | ☐ Not Executed |
| 7.1.4 | Confirm the HKCU uninstall entry. | `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\` contains a SpecterStudio entry (per-user). | ☐ Not Executed |
| 7.1.5 | First launch from the Start-menu shortcut. | App launches; first-run account creation; runtime data created under `%LOCALAPPDATA%\SpecterStudio`. | ☐ Not Executed |
| 7.1.6 | Offline launch after installation. | Launches and functions with the network still disconnected. | ☐ Not Executed |
| 7.1.7 | Installed-file integrity: capture the installed-file inventory (§10) and confirm the app.asar + bundled Chromium are present. | Inventory captured; payload intact. | ☐ Not Executed |
| 7.1.8 | Run the §4 and §5 validation scenarios in the **installed** app. | Same results as the portable pass. | ☐ Not Executed |

### 7.2 Upgrade over a previous build
| # | Step | Expected result | Result |
|---|---|---|---|
| 7.2.1 | With the installed app carrying user data (flows, settings, grants, reports, migration backups), run the **same** installer again (or a newer build if provided) to upgrade in place. | Upgrade completes without admin; app relaunches. | ☐ Not Executed |
| 7.2.2 | Confirm **user data preservation**: flows, settings, Legacy Compatibility grants, reports, and migration backups all survive. | All present and unchanged. | ☐ Not Executed |
| 7.2.3 | Confirm a **pre-hardening (FNV-era) grant** carried across the upgrade is **retired**, not honored and not silently re-granted; its flow blocks until repaired. | Retired record present; flow blocked. | ☐ Not Executed |

### 7.3 Uninstall
| # | Step | Expected result | Result |
|---|---|---|---|
| 7.3.1 | Uninstall via Settings → Apps (or the Start-menu uninstaller), as the standard user. | Uninstalls without admin; app and shortcuts removed; HKCU uninstall entry removed. | ☐ Not Executed |
| 7.3.2 | Confirm the documented **user-data policy** on uninstall. **The policy must be stated before testing** (does uninstall remove `%LOCALAPPDATA%\SpecterStudio` user data, or preserve it?). Record what the installer actually did versus the documented policy. | Behavior matches the documented policy; any divergence is a **finding**. | ☐ Not Executed |
| 7.3.3 | Confirm no orphaned processes, services, or scheduled tasks remain. | Nothing left running. | ☐ Not Executed |

> **If the user-data-on-uninstall policy is not yet documented, that is itself a release finding** —
> record it in §12 and do not guess the intended behavior.

---

## 8. Validation, grants, migration, backup, restart, and undo scenarios

These are the Tranche 2 subsystem confirmations that automated dev-machine runs cannot stand in for.
Run them in **both** the portable and installed apps (reference: they mirror
`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3b).

| # | Scenario | Expected result | Result |
|---|---|---|---|
| 8.1 | **Draft save** of an active-path-invalid flow. | Saves as Draft, unchanged; not runnable. | ☐ Not Executed |
| 8.2 | **Active-path blocking** at run time. | Run blocked with a specific message. | ☐ Not Executed |
| 8.3 | **Legacy grant creation** for an off-path-only flow (inventory scan). | Grant issued (SHA-256-bound); Legacy pill with deadline. | ☐ Not Executed |
| 8.4 | **Grant persistence** across restart. | Grant + deadline survive restart. | ☐ Not Executed |
| 8.5 | **Grant invalidation** on an executable edit. | Grant voids immediately (`edited`); flow blocks. | ☐ Not Executed |
| 8.6 | **Grant retention** on a description-only edit. | Grant retained. | ☐ Not Executed |
| 8.7 | **Migration preview** on a fixable flow. | Lists each schema change; nothing written yet. | ☐ Not Executed |
| 8.8 | **Backup before change**: confirm an untouched backup appears under `validation\backups\` **before** the flow changes. | Backup written first; byte-identical to the original. | ☐ Not Executed |
| 8.9 | **Migration apply + report**. | Flow normalized; a migration record written; the old migration record preserved alongside the new one. | ☐ Not Executed |
| 8.10 | **Restart, then Undo** the migration. | Flow restored byte-for-byte from the backup. | ☐ Not Executed |
| 8.11 | **Undo refusal** after a post-migration edit. | Undo is refused (would destroy the later edit). | ☐ Not Executed |
| 8.12 | **FNV-era retirement** on upgrade (from §5.3 / §7.2.3). | Pre-hardening grant retired, not honored, not re-granted. | ☐ Not Executed |

---

## 9. Expected pass/fail results

- **PASS** requires **every** check in §4–§8 to meet its Expected result, on a machine satisfying
  **all** §1 constraints, entirely offline.
- **FAIL / BLOCKER**: any of —
  - the app requires admin to run or install (per-user installer prompting for elevation),
  - any hash mismatch (§2),
  - a granted flow runs **silently** (no compatibility notice),
  - a **pre-hardening (FNV-era) grant is honored** or silently re-granted,
  - a flow is **auto-modified** on open or save,
  - a migration writes **before** its backup, or a backup is missing/overwritten,
  - **undo** destroys later edits or fails to restore byte-for-byte,
  - user data is lost on **upgrade**, or removed on **uninstall** contrary to the documented policy,
  - any functional failure attributable to being offline / having no global Node.
- **FINDING (non-blocking, record and triage)**: SmartScreen warning on unsigned EXEs; the
  user-data-on-uninstall policy being undocumented; max-compression not applied; cosmetic issues.

> **Signing.** Both artifacts are **unsigned** (§2). Do **not** record them as signed under any
> circumstance. A SmartScreen warning is expected and is a FINDING, not a step failure.

---

## 10. Evidence to collect

Collect into a dated evidence folder (e.g. `clean-machine-evidence-<date>\`) and attach to the result
template:

1. **Screenshots**: first-run window; account creation; a successful flow run; the `Draft — not
   runnable` chip; the run-blocked message; the Flow Library showing Runnable / Not-runnable / Legacy
   pill; the migration preview dialog; the undo control; the undo-refusal message; the installer UI
   (no-elevation); Start-menu shortcut; the uninstall dialog.
2. **Logs**: a run's `logs\<executionId>\<instanceId>.jsonl`; confirm secrets masked.
3. **Reports**: a generated run report.
4. **Validation records**: copies of `validation\legacy-grants\*.json`,
   `validation\inventory-scans\*.json`, `validation\migrations\*.json`, and one
   `validation\backups\*.json`. Confirm every issued grant's `contentHash` matches `^sha256:[0-9a-f]{64}$`
   and the retired FNV record shows `revokedReason: "digestFormatRetired"`.
5. **Hashes**: the §2 verification output (SHA-256 for both EXEs) computed on the test machine, plus
   the `Get-AuthenticodeSignature` status for both.
6. **Timestamps**: start and end time of the run; per-major-step timestamps where practical; the
   first inventory-scan duration (from the app or from folder mtimes).
7. **Installed-file inventory**: a recursive listing of the install directory after §7.1, e.g.
   ```powershell
   Get-ChildItem -Recurse "$env:LOCALAPPDATA\Programs\specterstudio" |
     Select-Object FullName, Length, LastWriteTime |
     Export-Csv installed-file-inventory.csv -NoTypeInformation
   ```
8. **Registry**: export the HKCU uninstall entry before uninstall and confirm its removal after.
9. **Network proof**: evidence the machine was offline for the duration (e.g. a failing
   `Test-NetConnection` before and after).

---

## 11. Notes for the tester

- Keep the machine **offline** for the entire run. If any step needs a URL, use a local `data:` URL
  or a locally hosted mock — never the internet.
- Run the **portable** pass and the **installer** pass from **separate clean snapshots** so neither
  contaminates the other.
- If a step cannot be executed (e.g. no newer build available for the upgrade test), mark it
  **Not Executed** with the reason — do **not** mark it passed or skipped-as-pass.
- Do not edit this runbook to record outcomes. Fill in §12 (or a copy).

---

## 12. Result template

> All fields below are **Not Executed** until a tester completes this runbook on a qualifying machine.

```
CLEAN-MACHINE VALIDATION RESULT — SpecterStudio (AWKIT) 0.1.0
============================================================
Runbook version .............: CLEAN_MACHINE_VALIDATION_RUNBOOK.md @ <git short SHA>
Build under test ............: portable + NSIS 0.1.0
  Portable SHA-256 (verified): __________________________  (expect 129833754870f5fa2663efa48b979aaecaf1532831f20805a5b3f6537264c1fb)
  NSIS SHA-256 (verified) ...: __________________________  (expect 74950020d105af9b5f188d09a467d1ad297fbfc064b12cabe9931f1c4e6e2a5a)
  Portable signing ..........: __________  (expect NotSigned)
  NSIS signing ..............: __________  (expect NotSigned)

Tester ......................: __________________________
Date ........................: __________________________
Machine (VM/physical, id) ...: __________________________
Windows version (winver) ....: __________________________
Account privilege ...........: standard / admin  (must be STANDARD)
Internet during test ........: OFFLINE confirmed?  yes / no
Clean snapshot id(s) ........: __________________________
Start time ..................: __________________________
End time ....................: __________________________

ENVIRONMENT CONSTRAINTS (§1)
  1.2 no source tree .......: pass / fail / not executed
  1.3 no dev server ........: pass / fail / not executed
  1.4 no global Node relied on: pass / fail / not executed
  1.5 no existing profile ..: pass / fail / not executed
  1.6 offline ..............: pass / fail / not executed
  1.7 standard user ........: pass / fail / not executed

SECTION RESULTS  (pass / fail / not executed — attach evidence)
  §4  Clean-profile portable ...........: ____
  §5  Upgrade-profile portable .........: ____
  §6  Portable app checks ..............: ____
  §7.1 NSIS install ...................: ____
  §7.2 NSIS upgrade ...................: ____
  §7.3 NSIS uninstall .................: ____
  §8  Validation/grants/migration/undo : ____

BLOCKERS (§9) ...............: __________________________________________
FINDINGS (non-blocking) .....: __________________________________________
  (e.g. SmartScreen warning on unsigned EXE; uninstall data-policy undocumented)

EVIDENCE ATTACHED (§10)
  screenshots [ ]  logs [ ]  reports [ ]  validation records [ ]  hashes [ ]
  timestamps [ ]  installed-file inventory [ ]  registry export [ ]  network proof [ ]

FINAL RECOMMENDATION (circle one):
  ( ) ACCEPT — clean-machine acceptance gate PASSED. Promote:
        Tranche 2: COMPLETE
        Product:   INTEGRATION-CANDIDATE
      (Broader production-ready designation remains subject to the project's other release gates —
       signing, max-compression, sustained soak, etc.)
  ( ) REJECT — blockers above; do NOT promote.
  ( ) INCOMPLETE — steps Not Executed; gate not satisfied; do NOT promote.

Signature / handle ..........: __________________________
```

---

## 13. What promotion this runbook unlocks (and what it does not)

A successful execution in a qualifying environment allows updating the status to:
- `Tranche 2: COMPLETE`
- `Product: INTEGRATION-CANDIDATE`

It does **not** by itself make the product production-ready. Independent release gates remain and are
out of scope for this runbook: **code signing** of both artifacts, **max-compressed** distributables,
**sustained soak**, and any other project release criteria.
