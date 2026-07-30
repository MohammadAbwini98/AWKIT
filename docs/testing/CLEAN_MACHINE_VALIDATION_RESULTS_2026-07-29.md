# Clean-machine validation — execution record, 2026-07-29

Results of running `CLEAN_MACHINE_VALIDATION_RUNBOOK.md` against a purpose-built, offline Windows 11
VM. This is the runbook's §12 result template, filled in.

**Disposition: FULLY EXECUTED on a single artifact, 2026-07-30 — every section 1-8 run against the
runbook's own numbering. 0 FAIL. Five rows are BLOCKED for reasons that no re-run can change
(§4.4, §4.9 and half of §4.5 by hard licensing on an unlicensed clean machine; §4.6 because the
Import Flow feature does not exist), and §6.2 / §7.1.8 are PARTIAL for the same licensing reason.**

The runbook as a whole is still **not claimed as PASSED**: a BLOCKED row is not a passed row, and
§4 as written is not completable on a clean machine under the enforcement policy now in force.

> **Correction (2026-07-30).** An earlier version of this line claimed sections 4 and 7 were
> "executed in full". They were not. The §4 and §7 tables below use a **bespoke 4.1-4.5 / 7.1-7.4
> numbering of their own**, which does not correspond to the runbook's §4 (rows 4.1-**4.12**) or §7
> (rows 7.1.1-7.1.8, 7.2.1-7.2.3, 7.3.1-7.3.3). Concretely: this record's "4.4 first-run setup UI"
> is not the runbook's 4.4 (bundled-Chromium run), and the whole of runbook §7.2 — upgrade over a
> previous build, including the FNV-grant-across-upgrade check — was never attempted. The matching
> numbers made partial coverage read as complete. A full single-artifact re-run is in progress
> (`awkit-3zr`); this section will be replaced by its result.

Sections 1, 2, 5, 6 and 8 were executed in full and every check passed. Sections 4 and 7 were
partially covered as described above, and section 3 — the manual offline-setup steps, waved through
as "subsumed by automated provisioning" — was **not executed**. The run-based checks (5.4, 5.8, 6.3, 8.1, 8.2) were executed on a second, reprovisioned
VM (fifth sitting); the migration ceremony (8.7–8.11) followed in the sixth, with 8.10 and 8.11
running against a rebuilt, separately hash-verified artifact for the reason recorded there. Per the
runbook's own §9 a FAIL is blocking and there were none — but
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

### Still not executed after the fifth sitting

| # | Why |
|---|---|
| 3 | Offline setup steps - subsumed by automated provisioning |
| 8.7-8.11 | Migration preview / backup-before-change / apply+report / restart-then-undo / undo refusal - multi-step UI ceremony, not attempted |

8.7-8.11 were executed in the sixth sitting, below. Only section 3 remains.

---

## Sixth sitting: the migration ceremony (8.7-8.11)

| # | Check | Result | Evidence |
|---|---|---|---|
| 8.7 | Migration preview lists each schema change; nothing written | **PASS** | dialog *"Apply 1 safe fix?"* listing `e1.conditional.operator : NotEquals -> notEquals` with its rationale and *"Errors: 1 -> 0"*. After opening it: flow hash unchanged, **no `validation\backups` directory existed at all**, migrations still only the seeded `old-record.json` |
| 8.8 | Backup written first, untouched copy of the original | **PASS** (see caveat) | `backups\seed-fixable-operator.2026-07-29T22-58-40-081Z.json`, id-bound to the migration record. It still holds the **broken** `NotEquals` while the live flow holds the fixed `notEquals` |
| 8.9 | Apply + report; old migration record preserved | **PASS** | record carries `beforeHash`, `afterHash`, the exact fix, `skipped: []`, `beforeErrorCount: 1 -> afterErrorCount: 0`; the seeded `old-record.json` sits alongside it untouched |
| 8.10 | Restart, then undo; flow restored byte-for-byte | **PASS** | after a full app exit the banner was re-offered from the durable record, undo stamped `undoneAt: 2026-07-30T07:14:16.103Z`, and the flow became **byte-identical** to the backup - the original `NotEquals` restored and the *Not runnable* banner back. The backup was **kept**, not consumed |
| 8.11 | Undo refused after a post-migration edit | **PASS** | *"Flow seed-fixable-operator was edited after this migration - undo would destroy those changes. Restore manually from …\backups\seed-fixable-operator.2026-07-30T07-15-33-415Z.json if intended."* Record left with no `undoneAt`, the later edit preserved, backup retained |

### The seed's "fixable" fixture had never worked

It set `condition = @{ source; operator; value }`, which matches no part of
`ConditionalConnectorConfig` - the field is `conditional`, and it needs `kind` plus `sourceField`.
The object was therefore ignored outright: the flow validated as fully **Runnable with zero issues**,
no safe fix was ever offered, and 8.7-8.11 had nothing to act on. Rather than guess a third time the
real shape was measured against the live validator before being written: `kind: "conditional"` +
`conditional: { sourceField: "outcome", operator: "NotEquals", expectedValue: "x" }` yields
`unsupportedOperator` carrying a `normalizeEnumCasing` safeFix. Third seed-fixture defect this
campaign; the product caught all three.

### 8.10 was not executable against the shipped build - a real gap, now fixed

`validation:migrations` had **zero renderer callers**. The only thing that could populate the
designer's "Undo migration" banner was `confirmApplyFixes` setting component state in the same
session, and `loadProfile` clears it - so the undo was unreachable after a restart, or even after
loading another flow, even though the record, the backup and the permission-gated
`validation:undoMigration` handler all survived on disk. Fixed on `main` (`fa87fc8`): the designer
reads the durable record on load and re-offers the newest not-yet-undone migration, deliberately
leaving the *safety* decision to main so 8.11's refusal stays observable.

**8.10 and 8.11 therefore ran against a REBUILT portable artifact**, sha256
`f442f2c3b998fe033324c0b0d9336fddbba6f5cfc95e4f6ed4d58a3e231bca91`, delivered on a fresh read-only
DVD and **hash-verified on the machine under test** by §2's own procedure before launch. Sections 1,
2, 4, 7 and everything through 8.9 pertain to the earlier artifact
(`4EBAC142CD2A0BE4…`); that is recorded rather than smoothed over, because introducing a new binary
mid-gate means the earlier results do not describe the binary that ran the last two checks. The
restart in 8.10 was consequently an **upgrade**, which is a stronger test than the runbook asks for:
the migration record and its backup survived replacing the application itself.

### Two caveats, neither a failure

**"Byte-identical" does not hold literally for the backup (8.8).** The ceremony writes
`JSON.stringify(flow, null, 2)` - a re-serialization of the parsed profile, not a byte copy - so
indentation and key order can differ from whatever wrote the original file. The parsed content is
identical and nothing is lost, and 8.10's restore *is* byte-for-byte against that backup. Read 8.8's
wording as "an untouched copy of the original content".

**The refusal toast leaks the IPC channel name.** 8.11's message is correct, specific and actionable,
but it reaches the user wrapped as *"Error invoking remote method 'validation:undoMigration': Error:
…"*. The domain sentence should be surfaced without the Electron remote-method preamble. Cosmetic;
filed rather than fixed here.

### Still not executed

| # | Why |
|---|---|
| 3 | Offline setup steps - subsumed by automated provisioning |


---

# Seventh sitting: full single-artifact gate run (`awkit-3zr`), 2026-07-30

One freshly provisioned VM, **one** portable artifact
(`f442f2c3b998fe033324c0b0d9336fddbba6f5cfc95e4f6ed4d58a3e231bca91`), executed section by section as
written — including the runbook's own numbering, which the earlier sittings quietly replaced with
tables of their own. That substitution is what let §4 and §7 read as complete when most of their rows
had never run.

Passes are separated by snapshot restores because the sections have mutually exclusive preconditions
(§4 needs an empty profile, §7 needs no prior install, §5/§8 need a profile seeded *before* first
launch).

## §3 — Exact offline setup steps — **EXECUTED, all steps pass**

| Step | Result | Evidence |
|---|---|---|
| 3.1 | **PASS** | snapshot `clean-before-validation`, id `3b53c9d7-24c3-4e84-a96a-dfc8b654bf99` |
| 3.2 (§1) | **PASS** | 1.1 Windows 11 Pro 10.0.26100 x64 · 1.2 no `package.json` anywhere on `C:` · 1.3 no node/npm/electron processes · 1.4 `where node` not found · 1.5 no `SpecterStudio` profile, no `Programs\specterstudio`, **no ProgramData licensing mirror** · 1.7 `awkituser` **not** in Administrators |
| 3.3 | **PASS** | 0 network adapters; `Test-Connection 8.8.8.8` false |
| 3.4 | **PASS** | `Desktop\awkit-portable\` and `Desktop\awkit-installer\`, one artifact each |
| 3.5 (§2) | **PASS** | verified **on the machine**: portable `f442f2c3…` 212,828,748 B; NSIS `4ba8c55f…` 244,263,870 B; both match the DVD manifest. Authenticode **NotSigned** (expected) |
| 3.6 | **PASS** | second snapshot `staged-artifacts-preseed`, id `ff381a04-6a4f-438f-a854-2a755f9e0937` |

**§3 step 1 had never been executable.** `provision-vm.ps1` created every lab VM with
`-CheckpointType Disabled`, which forbids *manual* checkpoints, not just automatic ones — so the
snapshot the step depends on could not be taken on any VM this lab has ever produced. Fixed to
`Standard` (automatic checkpoints stay off, since an implicit checkpoint on every start would alter
the machine under test).

**§3's step order also contradicted §4, §7 and §11.** The snapshot sat at step 1, *before* the
artifacts are staged at steps 4-5, yet §4 and §7 each say to restore that snapshot and then launch an
artifact, and §11 says to run the two passes "from separate clean snapshots". Restoring a step-1
snapshot discards the staged artifacts, leaving nothing to launch. §3 now takes a second snapshot
after staging and hash-verification, and that is the one §4/§7 restore.

`scripts/clean-machine/setup-offline.ps1` performs steps 1-6 and reports every measurement, so §3 is
executed rather than waved through as "subsumed by provisioning".

## §4 — Clean-profile portable pass, against the runbook's **actual** 12 rows

| # | Result | Evidence |
|---|---|---|
| 4.1 | **PASS** | window renders fully, no white screen; **0** `consent.exe` — no elevation prompt |
| 4.2 | **PASS** | account `cleanadmin` created (display name, ≥12-char password), recovery code shown, shell loads as Super User |
| 4.3 | **PASS** | 21 runtime folders created under `%LOCALAPPDATA%\SpecterStudio` |
| 4.4 | **BLOCKED (licensing)** | run refused: *"Clean Pass Workflow: Export an activation request and import a signed license to activate this machine."* 0 active / 0 completed, `Browsers 0/2`, **no Chromium process ever started** |
| 4.5 | **PARTIAL** | create + save + reopen-from-library round-trip **PASS** (flow reappears under SAVED FLOWS and reloads as Runnable); the "run it" half **BLOCKED** by the same gate as 4.4 |
| 4.6 | **BLOCKED (not implemented)** | the **Import Flow button is `disabled`**, titled *"Import from disk will use the import channel after file picker support is added."* Clicks are correctly ignored; there is no import path to exercise |
| 4.7 | **PASS** | chip reads exactly **`Draft — not runnable (1)`**; on disk the click node still has **no** locator — nothing auto-fixed |
| 4.8 | **PASS** | *"Validation failed: Step Click (click) requires a locator."* — a specific active-path message, no browser launched |
| 4.9 | **BLOCKED** | depends on a real run; 0 reports, 0 instances, 0 logs, 0 screenshots (`runtime.sqlite` exists, created at startup rather than by a run) |
| 4.10 | **PASS** | flow JSON holds only `id,name,description,version,nodes,edges,createdAt,updatedAt` — no `runnable`/`validated`/`validationStatus` verdict persisted |
| 4.11 | **PASS** | after closing: 0 app processes, 0 Chromium, **0 `.tmp` anywhere in the profile** |
| 4.12 | **PASS** | returning-user sign-in works; the flow and its Draft state persist |

### A clean machine cannot run anything, by design — and §4 predates that

4.4, 4.5's run half, and 4.9 are **not failures**. An empty profile classifies as `installationKind:
"fresh"`, so its migration-grace anchor is born `consumed: true`, there is no grace, status is
`NOT_ACTIVATED`, and the run gate refuses — exactly the owner-decided table. The refusal names the
remedy, which is good behaviour. But it means **runbook §4 as written cannot be completed on a
genuinely clean machine under hard enforcement**, and no amount of re-running will change that. Per
the standing rule for the packaged walkthrough ("report BLOCKED, not silently skip or pass"), they
are recorded blocked rather than dodged by pre-seeding a profile, which would no longer be §4.

### Validation is evaluated *before* licensing

Worth recording because I predicted the opposite. On a machine where every run is licence-blocked,
running an **invalid** flow still produces the *validation* message ("Step Click (click) requires a
locator"), not the licensing one. The specific, actionable defect wins over the generic gate, which
is the better ordering and means 4.8 remains fully meaningful on an unlicensed machine.

### §6.1 / §6.2 (portable summary gate)

| # | Result | Evidence |
|---|---|---|
| 6.1 | **PASS** | ran from `Desktop\awkit-portable\` as a standard user, no install, no admin |
| 6.2 | **PARTIAL** | offline throughout, no network prompts and no failure attributable to missing internet; "fully functional offline" cannot be claimed in full only because runs are licence-blocked, which is unrelated to connectivity |

### SmartScreen did not appear, and the reason matters

The artifact carries **no `Zone.Identifier` stream** — it arrived on read-only media, not a download —
so Mark-of-the-Web is absent and SmartScreen has nothing to trigger on. The earlier record's "no
blocking prompt — PASS" was true but read as though SmartScreen had assessed and allowed the binary.
It never evaluated it at all.

## §7 — NSIS per-user install / upgrade / uninstall, against the runbook's **actual** 14 rows

Pass C began by restoring `staged-artifacts-preseed`. The restore itself is worth recording: the
profile, **and the ProgramData licensing mirror**, were both gone, while the staged artifacts
remained — exactly the precondition §7 asks for, and the first time the runbook's
restore-between-passes mechanism has ever been exercised.

| # | Result | Evidence |
|---|---|---|
| 7.1.1 | **PASS** | assisted UI ("Choose Installation Options"), **not** one-click; all-users option greyed out and labelled *(must run as admin)*; "Only for me (awkituser)" preselected; **0** `consent.exe` sightings over 60 s |
| 7.1.2 | **PASS** | directory user-selectable with Browse; default `%LOCALAPPDATA%\Programs\SpecterStudio`; 576 files installed, no admin |
| 7.1.3 | **PASS** | Start-menu **and** desktop shortcuts, both per-user |
| 7.1.4 | **PASS** | `SpecterStudio 0.1.0` under `awkituser`'s hive, `UninstallString … /currentuser`; **nothing in HKLM**. *Minor:* `InstallLocation` and `Publisher` are empty, so Apps & Features shows neither |
| 7.1.5 | **PASS** | launched from the Start-menu shortcut → `…\Programs\SpecterStudio\SpecterStudio.exe`; first-run account created; runtime data created under `%LOCALAPPDATA%\SpecterStudio` |
| 7.1.6 | **PASS** | launched and functioned with 0 network adapters |
| 7.1.7 | **PASS** | `resources\app.asar` present; bundled `chrome.exe` present; 576-file payload |
| 7.1.8 | **PARTIAL** | the §5 validation scenarios reproduce **identically** in the installed app (scan, FNV retirement, sha256 grant issuance, per-flow classification); the run-based scenarios are blocked by the **same** licensing gate and with the same message as the portable pass — parity confirmed in both directions |
| 7.2.1 | **PASS** | same installer re-run over the existing install; upgrade completed in place, **0** UAC prompts |
| 7.2.2 | **PASS** | user data **byte-for-byte identical** across the upgrade — 25 flows, 25 workflows, 1 grant, 1 migration record, 1 backup, 1 report, verified by a per-file path+size fingerprint taken before and after |
| 7.2.3 | **PASS** | after the upgrade the scan reported `digestAlgorithm=sha256`, `grantsIssued=1`, `grantsRetiredLegacyDigest=1`; the FNV-era grant carried across is **retired** (`revokedReason: "digestFormatRetired"`), not honoured and **not** re-granted |
| 7.3.1 | **PASS** (with residue) | payload, Start-menu shortcut, desktop shortcut and the HKCU uninstall entry all removed, no elevation. **The install directory itself remains** — `%LOCALAPPDATA%\Programs\SpecterStudio`, **0 files and 0 subdirectories**. Cosmetic residue, not data |
| 7.3.2 | **PASS** | user data **byte-for-byte preserved** (62 files). This matches the configured policy — see below |
| 7.3.3 | **PASS** | 0 app processes, 0 Chromium, 0 services, 0 scheduled tasks matching `*Specter*` |

### 7.3.2's "documented policy" is not documented anywhere

The runbook requires the uninstall data policy to be **stated before testing**. There is no prose
statement of it in `docs/`. The policy exists only implicitly: `electron-builder.json` does not set
`deleteAppDataOnUninstall`, and electron-builder's default for it is `false`, so user data is
preserved. Measured behaviour matches that default exactly. Recorded as a documentation gap — the
check passes on behaviour, but the "state it first" precondition could not be satisfied from the
repository.

### The Flow Library's "Re-scan Library" action did not render in the installed app

In Pass B (same artifact, portable, Super User) the action sat beside "New Flow". In Pass C
(installed, also Super User) it was **absent** — "New Flow" had shifted right into its place, and it
stayed absent across a navigate-away-and-back, so it is not a first-render race. The scan was
therefore triggered by the runbook's other documented route, a run request, which worked. Flagged for
investigation rather than diagnosed here; it did not block any §7 row.

## §5 / §6.3 / §8 — upgrade-profile pass (Pass D), on the same artifact — **COMPLETE**

Pass D restored `staged-artifacts-preseed`, seeded the upgrade profile **before first launch**, and
got the precondition the whole of §5 depends on:

```json
{ "installationKind": "upgraded", "consumed": false,
  "firstEnforcedLaunchUtc": "2026-07-30T08:53:45.492Z",
  "graceEndsAtUtc":        "2026-08-13T08:53:45.492Z" }
```

| # | Result | Evidence |
|---|---|---|
| 5.1 | **PASS** | app loads; the seeded library appears — 25 saved flows |
| 5.2 | **PASS** | all three states render: **Not runnable** (broken, fixable, orphan-primary), **Runnable** (long-wait), and the dashed **Legacy** pill (orphan-secondary) |
| 5.3 | **PASS** | scan: `digestAlgorithm=sha256`, `grantsIssued=1`, `grantsRetiredLegacyDigest=1`. Seeded FNV grant → `revokedReason: "digestFormatRetired"`, **not** honoured, **not** re-granted; the live grant is `sha256:7243e924…` with a 30-day deadline (2026-08-29) |
| 5.4 | **PASS** | granted off-path workflow **ran**, report `status: "passed"`; the grant recorded it — `runsUnderCompatibility` 0 → 1, `lastRunAt 2026-07-30T08:59:58.735Z` |
| 5.8 | **PASS** | *"Seeded Active-Path-Broken Flow Workflow: Validation failed: Step Click with no locator (click) requires a locator."* — `Browsers 0/2`, `Flows 0/4`, no browser launched |
| 8.2 | **PASS** | satisfied by 5.8: no grant permits an active-path break |
| 8.12 | **PASS** | satisfied by 5.3: FNV-era retirement on upgrade |

### Pass D completed

| # | Result | Evidence |
|---|---|---|
| 5.5 / 8.4 | **PASS** | grant **byte-identical** across a full restart, same `expiresAt` |
| 5.7 / 8.6 | **PASS** | flow description changed → re-scan → grant hash **and** deadline unchanged, no revocation |
| 5.6 / 8.5 | **PASS** | added a node → flow becomes 5 nodes/3 connectors and reads **Not runnable**; Legacy pill gone |
| 5.9 | **PASS** | third scan: still exactly **2** grant files, deadline byte-identical, retired record not revived |
| 8.1 | **PASS** | broken flow saves as **Draft**, still not runnable, **no locator added** |
| 8.3 | **PASS** | = 5.3 (sha256-bound grant issued with deadline) |
| 8.7 | **PASS** | preview lists `e1.conditional.operator: NotEquals → notEquals`, "Errors: 1 → 0"; **no backups dir existed** and only `old-record` was present afterwards |
| 8.8 | **PASS** | backup id-bound to the record, holding the **broken** `NotEquals` while the live flow holds `notEquals` |
| 8.9 | **PASS** | record with `beforeHash`/`afterHash`, errors 1 → 0, `skipped: 0`; seeded `old-record` preserved beside it |
| 8.10 | **PASS** | after restart the undo was re-offered from the durable record; `undoneAt` stamped, backup **kept**, flow **byte-for-byte** identical to the backup, `NotEquals` restored |
| 8.11 | **PASS** | after a later edit the undo is **refused** by name; record left un-undone, edit preserved, backup retained |
| 6.3 | **PASS** | 4 processes killed with the run in flight, **no stranded Chromium**; relaunch classified it `orphaned` + *"Interrupted by app exit"*, one `startupRecovery` event, `NOT auto-resumable` absent; panel showed **Recoverable — safe to re-run** with Re-run / Open artifacts / Mark reviewed / Mark abandoned, and no ghost active instance |

**§5 is complete (5.1–5.9). §8 is complete (8.1–8.12). §6 is complete.**

### 8.7 found a regression in the fix this campaign shipped

Opening the fixable flow offered **"Safe fixes applied … Undo migration"** in a session where no
migration had been applied. `fa87fc8` re-offers the newest migration whose `undoneAt` is absent — and
the seed's *historical* `old-record.json` satisfies that filter despite having **no `afterHash`** and
a `backupPath` pointing at a file that has never existed.

Clicking it **fails safe**: `undoMigration` compares the current digest against `record.afterHash`,
which is `undefined`, so it refuses and nothing is destroyed. But the affordance is offered when it
cannot work, and the refusal directs the user to *"Restore manually from
validation\backups\seed-fixable-operator-20260201.json"* — a file that does not exist. Filed as
**`awkit-o7r`** (P2): undoability must be derived in main (afterHash present **and** backup on disk
**and** digest matches) and returned as a flag, not guessed in the renderer from the absence of
`undoneAt`.

That this surfaced at all is the gate doing its job on code written earlier in the same campaign.

**Fixed the same day (`awkit-o7r` closed).** Undoability is now decided by one predicate in main,
`undoBlockedReason(record, current)`, used by **both** `undoMigration` (which throws that sentence)
and `migrationsForFlow` (which reports it as `undoable` / `undoBlockedReason`) — so what a surface
offers and what the operation permits cannot drift apart, which was the actual root cause rather
than the missing `afterHash`. It blocks on: already undone, flow gone, `afterHash` not a current
digest, digest mismatch, and **missing backup file** (previously an un-caught `ENOENT` mid-restore).
The renderer filters on `record.undoable`.

`verify-legacy-compat` went 138 → **152**. The new checks were mutation-tested: restoring the old
`!undoneAt` rule fails **6** of them, including the exact reported case. Two of them were initially
unreachable — their setup used a flow with no safe fixes, so the guard was skipped silently — and
that conditional was removed so a setup failure is now a hard failure.

### Rebuilt and re-verified after the fix

The portable was rebuilt from a clean tree at `53e3341` (which contains the fix) and is now
`f12e84eae3ba163cdab597edb5d1e9277beb7ddde366765dbb9fc2113ce8b5ba`.

- `verify-packaged-validation` **86/1 → 87/0** — the single prior failure was the artifact
  **freshness guard**, and it now reads *"the portable EXE is freshly built (2 min old, < 180)"*.
  That guard did exactly its job: it refused to let a stale binary be reported as verified.
- `verify:packaged-walkthrough` **25 passed / 0 failed / 1 BLOCKED**. Parts A–C pass in full
  (packaged payload newer than `src/` and `app/`, `appMode: "packaged"`, durable store on the fresh
  root, no developer paths, no dev leftovers). Part D confirms the packaged fresh profile starts
  `NOT_ACTIVATED`, carries **no** migration grace, has enforcement **ON**, and **refuses a real
  run** — then records **BLOCKED** for the four licensed runs because
  `AWKIT_PACKAGED_LICENSE_ISSUER_KEY` is not set on this machine. That is the owner-specified
  outcome, not a shortfall: the issuer key is deliberately confined to an authorized validation
  machine or CI runner, and the gate makes **no claim in either direction** about licensed packaged
  execution rather than skipping or passing. Evidence in `dist/phase5-evidence`.

**Scope note.** The single-artifact clean-machine gate above was executed against `f442f2c3…`, and
that record stands as written. `f12e84ea…` is a *newer* build containing the `awkit-o7r` fix and has
**not** been through the clean-machine gate; the lab VM is still running `f442f2c3…`.

### Two harness defects fixed mid-run, both failure-open

`vm-guest-click.ps1` read its result marker with a plain `Get-Content`, which throws
*"because it is being used by another process"* when the scheduled task still holds the file. The
click had already happened; only the confirmation read failed, and it aborted the caller. Now opened
`FileShare.ReadWrite` with a retry loop. Separately, a **nav group silently re-expanded** after a
run completed, so a later fixed-coordinate click landed on *Recorder* and the intended filter text
was typed into the Recorder's Target URL field — a reminder that coordinates measured on one render
are not valid after an async state change. Screenshot before every click sequence that follows a run.

## Machine-readable record

`docs/testing/clean-machine-evidence/runbook-results.json` — every check with its status and detail,
as emitted by the driver.
