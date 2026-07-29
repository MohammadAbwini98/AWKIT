# Clean-machine validation — execution record, 2026-07-29

Results of running `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` against a purpose-built, offline Windows 11
VM. This is the runbook's §12 result template, filled in.

**Disposition: PARTIALLY EXECUTED — 39 PASS / 0 FAIL. Section 3 and the migration ceremony
(8.7–8.11) NOT EXECUTED.**

Read that precisely. Sections 1, 2, 4, 5, 6 and 7 were executed in full and every check passed, as
was section 8 apart from 8.7–8.11. Section 3 and the migration ceremony were **not executed**. The
run-based checks (5.4, 5.8, 6.3, 8.1, 8.2) were executed on a second, reprovisioned VM — see the
fifth sitting. Per the runbook's own §9 a FAIL is blocking and there were none — but
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

## Tooling defect found after the run

The provisioner's documented readiness signal was wrong. `FirstLogonCommands` runs as the STANDARD
user, which cannot write to the root of `C:\`, so the `C:\awkit-vm-ready.txt` marker never appeared
and a readiness poller waited the full 40 minutes for a file that was never going to exist — while
the VM had in fact been ready almost immediately. It cost nothing here because the VM state was
confirmed directly instead, but anyone reusing the tooling would have read that timeout as a
provisioning failure. The marker now writes into the user's own profile, and the script documents
polling the logged-on user over PowerShell Direct, which is the check that actually worked.

---

## Section 5 / 6 attempt, 2026-07-29 (second sitting)

The upgrade profile from section 5.1 was seeded **before first launch**, as required: 24 flows (20
valid, 2 off-path-only, 1 active-path-broken, 1 fixable with a mis-cased `NotEquals` operator), 24
matching workflows, the pre-hardening FNV-era grant (unprefixed 16-hex `contentHash`), and a
historical migration record. Seeder: `scripts/clean-machine/seed-upgrade-profile.ps1`.

| # | Check | Result | Evidence |
|---|---|---|---|
| 5.1 | Launch; the seeded library appears | **PASS** | Workflows page reports **24 saved workflows**, listing all four named test workflows (`s5-library.png`) |
| 6.1 | No installation and no admin rights required | **PASS** | portable ran from a folder as `awkituser`; process owner confirmed |
| 6.2 | Offline throughout; no network prompts or failures | **PASS** | 0 network adapters; library loads, shell fully functional, AD provider correctly reports "Not configured" |
| 5.2-5.9 | Inventory scan, Legacy pill, grant lifecycle | **NOT EXECUTED** | see below |
| 6.3 | Hard-kill mid-run, recovery panel | **NOT EXECUTED** | requires a run in flight |
| 8.1-8.12 | Validation, grants, migration, backup, undo | **NOT EXECUTED** | see below |

### Why 5.2-5.9 and 8.x are not executed

`ensureInventoryScan()` is called from exactly one place - `app/main/ipc/execution.ipc.ts` during a
run request. Launching the app does **not** trigger it, and the renderer never calls
`validation:runInventoryScan`. So every remaining section 5 check, and the grant-related section 8
checks, are gated behind starting a real workflow run in the UI.

Measured directly at the end of the attempt: `validation\inventory-scans\` contains **0** records,
the seeded FNV grant is still present, and it is **not** revoked - all consistent with no scan
having run. Nothing about grant retirement is claimed either way.

Driving the UI is done from the host with synthetic keyboard input plus console screenshots
(`vm-send-keys.ps1`, `vm-focus-app.ps1`, `vm-screenshot.ps1`) - deliberately, because a UI-automation
harness inside the guest needs Node and would violate constraints 1.2-1.4. That loop works: it typed
the whole first-run form, ticked the recovery-code box, signed in, and navigated the left nav. But
reaching a Run control means traversing a long scrolling sidebar one Tab at a time with a screenshot
round-trip per step, and it was not completed. This is a limitation of the driver, not a product
finding.

### Third sitting: the inventory scan was triggered, and 5.2 / 5.3 / 8.12 passed

`validation:runInventoryScan` had existed and been permission-gated since the validation subsystem
landed, but **nothing in the application had ever called it** - the scan happened only as a side
effect of a workflow run. A "Re-scan Library" action was added to the Flow Library, carrying the same
`WORKFLOW_EDIT` permission the handler already enforces. This deliberately makes an already-gated
capability reachable rather than adding a bypass: the scan issues grants that let otherwise-blocked
flows run, so an unauthenticated CLI trigger was rejected as a genuine privilege hole.

| # | Check | Result | Evidence |
|---|---|---|---|
| 5.2 | Library shows per-flow status | **PASS** | VALIDATION column reads **Runnable** for the valid flows and **Not runnable** for the broken and off-path ones, across all 24 |
| 5.3 | Pre-hardening grant is RETIRED, not honoured | **PASS** | the seeded FNV grant now carries `revokedAt` and `revokedReason: "digestFormatRetired"` |
| 8.12 | FNV-era retirement on upgrade | **PASS** | scan record: `grantsRetiredLegacyDigest: 1`, `grantsIssued: 0`, `digestAlgorithm: "sha256"` |

The scan record is unambiguous - the pre-hardening grant was retired, **not** honoured, and **not**
re-granted, which is exactly what section 5.3 demands.

### Seed fixtures were wrong twice, and the product caught both

The first scan classified all 24 flows `immediately-blocked` and issued no grants. Cause: a `goto`
node needs `url` **and** a `valueSource`; `config.url` alone fails the step-requirements contract with
`missingRequiredValue` **on the active path**, which blocks the whole flow. That is the same contract
that produced defect `HARNESS-004`. Separately, the "off-path only" flows carried a detached `click`
with no locator - itself an error, so those flows were blocked rather than off-path-only, and no
Legacy grant could ever be issued for them. The detached node is now a `screenshot`, which is valid
in itself and merely unreachable.

After the fix the library classifies correctly (Runnable vs Not runnable, above), but the scan has
**not** been re-run against the corrected fixtures, so no grant has yet been issued. Sections 5.4-5.9
and 8.3-8.6 therefore remain NOT EXECUTED rather than failed - nothing is claimed about grant
issuance, persistence or invalidation.

### Why this stopped short

Reaching the "Re-scan Library" action costs one screenshot round-trip per Tab, and the count is not
stable: the table scrolls as focus moves, each row carries about four focusables, and the sidebar's
length varies with the signed-in principal's permissions. The action was reached and fired once
successfully; repeating it reliably needs either a stable focus anchor or working pointer input.

Pointer input is not usable on this host. `Msvm_SyntheticMouse` accepts positions and reports success,
but the clicks do not land where the coordinates say - a hover over a known button produced no hover
state, and two stray clicks hid the application window. Hyper-V's absolute pointer appears to need an
active console session to be honoured, which a headless host-side driver does not have.

### Host-side pointer input: two undocumented facts, both measured

A second attempt added synthetic mouse control (`vm-click.ps1`) to replace Tab-counting, which is not
viable here - the sidebar scrolls and its length depends on the signed-in principal's permissions, so
a count calibrated on one screen overshoots on another. Two things about `Msvm_SyntheticMouse` are
not evident from its MOF and cost real time:

- **The absolute coordinate space is 0..32767, not 0..65535.** Any value above 32767 returns error
  `32773`; 32767 and below return 0. The field is declared `uint16` but behaves as signed 16-bit.
  Scaling to 65535 does not fail for small coordinates - it silently lands at roughly double the
  intended position, which is why an early scroll aimed at the sidebar did nothing: the pointer was
  over the content pane the whole time.
- **`ClickButton`'s `ButtonIndex` is one-based.** Index 0 returns `32773`; 1 / 2 / 3 succeed as
  left / right / middle.

Both are now encoded in `vm-click.ps1`. Probing button indices blindly also fired clicks at whatever
the pointer happened to be over, which shifted and then hid the application window - a reminder that
this input path has no undo and should always be preceded by a screenshot.

### Two findings from the attempt

**1. Unparseable profile JSON is quarantined, not lost - and that behaviour is now evidenced.**
The first seed wrote its JSON with `Set-Content -Encoding utf8`, which in Windows PowerShell 5.1
emits a UTF-8 BOM (`EF BB BF`). Node's `JSON.parse` rejects a leading BOM. The application moved all
24 affected workflow files to `<name>.json.corrupt-<timestamp>` and logged the parse error, rather
than deleting them or failing the page. That is `ProfileStore.quarantineCorrupt`, and the user's data
survived a malformed-profile encounter intact. Worth recording as a genuine positive: it was observed
by accident, on a clean machine, at a 24-file scale.

**2. The BOM trap was self-inflicted and is already documented in this repository.**
`scripts/generate-dependency-manifest.ps1` carries the identical warning, for the identical reason.
The seeder now writes UTF-8 without a BOM via `System.Text.UTF8Encoding($false)` and clears any
leftover quarantine, so a re-run starts from an unambiguous state.

---

## Fourth sitting: the Legacy grant lifecycle, end to end

Precise pointer control was finally achieved by issuing the click from **inside** the guest -
`SetCursorPos` + `mouse_event` via user32, run as the logged-on standard user through a scheduled
task (`vm-guest-click.ps1`). Hyper-V's own `Msvm_SyntheticMouse` is unusable on this host: it accepts
`SetAbsolutePosition`, reports success, and never moves the pointer, so the following `ClickButton`
fires wherever the real cursor sits. Measured at three different coordinates, all landing on the same
wrong target, and **opening a VMConnect console did not change it**. The guest-side click reported
its landing position back (`at:204,634`) and hit its target first time. It uses only PowerShell and
user32 - both part of Windows - so nothing is installed and constraints 1.2-1.4 still hold.

| # | Check | Result | Evidence |
|---|---|---|---|
| 5.2 | Library shows Runnable / Not runnable / **Legacy** pill | **PASS** | all three states present; `seed-orphan-secondary` shows a dashed **Legacy - until 2…** pill |
| 5.3 | Pre-hardening grant retired, not honoured; new grant `sha256:`-bound | **PASS** | primary: `revokedReason: "digestFormatRetired"`, **not** re-granted, shows *Not runnable*. secondary: new grant `sha256:1507327c…`, 30-day deadline |
| 5.5 | Grant persists across restart with the same deadline | **PASS** | identical `contentHash` and `expiresAt` before and after a full app restart |
| 5.6 | Executable edit voids the grant; flow blocks; pill gone | **PASS** | added a node -> digest recomputed to `sha256:5de90218…`, grant bound to `1507327c…` -> flow shows **Not runnable**, Legacy pill gone |
| 5.7 | Description-only edit retains the grant | **PASS** | description changed, re-scanned, digest **unchanged**, grant intact with no revocation |
| 5.9 | Re-scan extends nothing, revives nothing, duplicates nothing | **PASS** | 4 scan records; deadline byte-identical; retired record still `digestFormatRetired`; still exactly 2 grant files |
| 8.3 | Grant issued (SHA-256 bound), Legacy pill with deadline | **PASS** | `grantsIssued: 1`, `sha256:1507327c…`, expires 2026-08-28 |
| 8.4 | Grant persistence across restart | **PASS** | same as 5.5 |
| 8.5 | Grant invalidation on executable edit | **PASS** | same as 5.6 |
| 8.6 | Grant retention on description-only edit | **PASS** | same as 5.7 |
| 8.12 | FNV-era retirement on upgrade | **PASS** | `grantsRetiredLegacyDigest: 1`, `grantsIssued: 0` on that flow |

Scan classification after the fixtures were corrected: `valid=21, temporarily-compatible=2,
immediately-blocked=1` - exactly the intended mix.

### The grant record is not stamped "revoked" on edit, and that is correct

Worth recording because it looks alarming at first. After the executable edit the grant file still
holds the OLD hash with no `revokedAt`/`revokedReason`, and the scan entry still classifies the flow
`temporarily-compatible`. That is not a stale record: `evaluateGrant` returns the standing
**`edited`** whenever `grant.contentHash !== currentDigest`, so the standing is DERIVED live from the
digest comparison rather than persisted. The user-visible result is correct - the flow blocks and the
Legacy pill disappears - and deriving it is sounder than stamping a revocation, which would go stale
if the edit were reverted. `temporarily-compatible` classifies the flow's *shape* (off-path-only, so
grant-eligible); it is not a statement that a grant currently applies.

### Why the run-based checks cannot be executed on this machine

5.4, 5.8, 6.3, 8.1 and 8.2 all require starting a workflow run. On this VM every run is refused by
**licensing**, not by validation, so asserting "blocked" would record a pass for the wrong reason and
"runs" is impossible. The migration-grace anchor reads:

```
installationKind: "fresh", consumed: true, firstEnforcedLaunchUtc: 2026-07-29T17:32:24Z
```

That classification dates from the section 4 run, before the upgrade profile was ever seeded - and it
**survived every wipe of the per-user profile**, because the per-profile-namespaced mirror under
`%PROGRAMDATA%\SpecterStudio\Licensing\migration-grace-6ee2f5c5dab1ce70.json` restored it. That is
the anti-tamper property working exactly as designed, demonstrated independently on a clean machine:
**deleting the per-user copy did not restart or reopen the migration window.** The side effect is
that this VM is permanently `fresh + consumed`, so it gets no grace, and unlicensed runs stay blocked.

To execute those five checks, either import a real signed licence into the VM, or provision a fresh
VM and seed the upgrade profile before its very first launch so it classifies as `upgraded`.

### Still not executed after the fourth sitting

| # | Why |
|---|---|
| 3 | Offline setup steps - subsumed by automated provisioning |
| 5.4, 5.8, 8.1, 8.2 | Require a workflow run; licensing blocks all runs on this VM (above) |
| 6.3 | Hard-kill mid-run needs a run in flight |
| 8.7-8.11 | Migration preview / backup / apply / undo / undo-refusal - multi-step UI ceremony, not attempted |

All five run-based checks were executed on a **second VM** in the fifth sitting, below. 8.7-8.11
remain not executed.

---

## Fifth sitting: the run-based checks, on a second VM (`AWKIT-CleanMachine`, reprovisioned)

The previous VM was permanently `fresh + consumed`, so it could never admit a run. Rather than import
a signing key into the lab, the VM was **torn down and reprovisioned**, and the upgrade profile was
seeded **before the application's very first launch**. That is the whole trick: `detectInstallationKind()`
looks for an existing profile, so seeding first is what makes the install classify as an upgrade.

First launch wrote the anchor that made every later check possible:

```json
{ "installationKind": "upgraded", "consumed": false,
  "firstEnforcedLaunchUtc": "2026-07-29T22:02:35.779Z",
  "graceEndsAtUtc":        "2026-08-12T22:02:35.779Z" }
```

A 14-day migration window, open - so runs are admitted while the machine holds no licence. This is
the owner-decided upgrade-grace path being exercised on a real clean machine for the first time, and
it is exercised **as itself**: no licence was minted, so nothing here overlaps the packaged
walkthrough's licensing gate.

The 74 evidence files from the first VM were preserved to `dist/clean-machine-evidence-vm1` before
teardown.

| # | Check | Result | Evidence |
|---|---|---|---|
| 5.4 | Granted off-path flow runs, and the run is attributed to Legacy Compatibility | **PASS** | run `245da2f4-3abb-4c65-8121-81814cf8424a` reached `status: "passed"`; the grant for `seed-orphan-secondary` went `runsUnderCompatibility` 0 -> 1 with `lastRunAt: 2026-07-29T22:18:11.326Z`, 14 ms before the run's own start stamp. The retired FNV grant was **not** used |
| 5.8 | Active-path-broken flow is blocked, with a specific message | **PASS** | *"Seeded Active-Path-Broken Flow Workflow: Validation failed: Step Click with no locator (click) requires a locator."* - no instance started |
| 8.2 | No grant may permit an active-path break | **PASS** | after the refusal: still exactly 2 grant files (both orphan flows), 1 report, 1 instance directory. The blocked attempt produced nothing |
| 6.3 | Hard-kill mid-run; orphaned run surfaces as recoverable | **PASS** | killed all 4 processes with the 120 s wait in flight (`Flows 1/4`, `Pages 1`), no stranded Chromium. On relaunch the durable store held `orphaned` + *"Interrupted by app exit with no side-effect node in flight - safe to re-run"* and exactly one `startupRecovery` event; the UI showed **Recoverable 1 prior run(s)**, *"Interrupted prior runs - 1 found by startup recovery"*, and the panel row with **Re-run workflow / Open artifacts / Mark reviewed / Mark abandoned** |
| 8.1 | Draft save of an active-path-invalid flow: saves as Draft, unchanged, not runnable | **PASS** | designer subtitle went *Loaded profile* -> **Saved draft**, Draft chip and *"Not runnable - 1 issue(s) block execution"* both persisted; library still shows **Not runnable** at version 1; no grant was created. See the note below on what the save did change |

### 5.4's attribution lives on the grant, not in the run report

The runbook says the run must be attributed to Legacy Compatibility. It is - but not where you would
first look. `reports/<id>.json` and `reports/<id>/report.json` contain no `legacy`/`compatibility`/
`grant` token at all; the attribution is the audit write in
`flowValidationService.recordRunUnderCompatibility`, which increments `runsUnderCompatibility` and
stamps `lastRunAt` on the grant. That is a durable, per-grant audit trail and it is sufficient to
prove the run went through the grant, so 5.4 passes. But an operator reading a run report cannot
tell that the run only executed because of a compatibility grant. Recorded as an observability gap,
not a defect: the gate itself behaved correctly.

### What the draft save changed, precisely

8.1 says "unchanged", so the flow file was hashed before and after. The graph did change, and the
change is worth stating exactly rather than waving at:

```
PRE   [{"name":"Start",...},{"config":{},"name":"Click with no locator",...},{"name":"End",...}]
POST  [{"id":"start",...,"position":{"x":80,"y":80}},{"id":"click",...,"position":{"x":80,"y":232}},...]
```

Two differences: each node gained a default `position`, and the click node's empty `config: {}` was
dropped. Both are attributable to the seed, which omitted canvas layout - a flow saved from the
designer always carries positions. **The defect itself is untouched**: the click node still has no
locator, the flow is still not runnable, and no grant was issued for it. Nothing was silently
repaired, which is what 8.1 actually protects.

### A scroll that could never have worked

`vm-guest-click.ps1 -Scroll` had been a no-op for downward scrolls since it was written, and it
failed *silently*. `mouse_event` takes `dwData` as a signed delta while the P/Invoke declares
`uint32`, and PowerShell's `[uint32](-120)` **throws** rather than wrapping. The throw happened
inside the scheduled task, so the caller saw no error - and because the marker file from the
preceding pointer move still existed, it read back a perfectly plausible `at:x,y`. Fixed by wrapping
to two's complement explicitly. This is the failure-open shape again: the observable signal came from
a different step than the one that failed.

### Still not executed

| # | Why |
|---|---|
| 3 | Offline setup steps - subsumed by automated provisioning |
| 8.7-8.11 | Migration preview / backup-before-change / apply+report / restart-then-undo / undo refusal - multi-step UI ceremony, not attempted |


## Machine-readable record

`docs/testing/clean-machine-evidence/runbook-results.json` — every check with its status and detail,
as emitted by the driver.
