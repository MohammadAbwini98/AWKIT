# E2E Coverage Matrix — AWKIT / SpecterStudio

Target: the **real Electron desktop app** (`main` @ `0a4500f`), launched via Playwright `_electron`
against an isolated, empty `%LOCALAPPDATA%` temp profile (never the developer's real profile, never
production — the app is offline/local-only; there is no production web target and no `E2E_BASE_URL`).

**Browser coverage note (adapted):** AWKIT is an Electron app — the only runtime is the bundled
Chromium/Electron shell. Firefox/WebKit projects from the generic web-app template are
`NOT APPLICABLE`. "Responsive" = window resize, not device emulation. `@playwright/test` cannot load
its TS config on this Node 18.16 environment (documented caveat), so executable tests follow the
repository's verifier convention: standalone `node`/`tsx` scripts using web-first Playwright
assertions (`scripts/verify-*.mjs|.mts`), per `tests/AGENTS.md` ("don't introduce a second test
framework").

**Roles under test:** `SuperUser` (all permissions), `Administrator` (all except `user.manage` +
`license.*`/`page.license`), `Operator` (build/run/stop + data sources + report export), `Viewer`
(read-only pages + `workflow.view`). Authorization is enforced **in the main process per IPC call**
(deny-by-default); hiding a nav item is never the check — every authorization row below includes a
**direct preload-IPC call** from an unauthorized role (the Electron equivalent of "direct URL / direct
API access").

**Status legend:** `COVERED(x)` = already verified by existing repo verifier `x` (pass count from the
latest green run) · `NEW(spec)` = implemented this assessment (spec under `specs/e2e/`) ·
`MANUAL-ONLY` = requires a human/GUI-external gate · `BLOCKED` = cannot run in this environment ·
`N/A` = not applicable to an offline Electron app.

> **Execution resolution (2026-07-19, end of assessment):** every `NEW(spec)` row below is now
> EXECUTED GREEN by its executable — `NEW(E2E-AUTH)` → `verify:e2e-auth` **30/30**,
> `NEW(E2E-RBAC)` → `verify:e2e-rbac` **42/42**, `NEW(E2E-LIC)` → `verify:e2e-licensing` **22/22**,
> `NEW(E2E-SWEEP)` → `verify:e2e-sweep` **13/13**. Exceptions and gaps: the §2 direct-IPC rows for
> `settings.update`/`runWorkflow` are documented KNOWN GAPS (bd `awkit-b92`, not denials today);
> the §6 fresh-profile empty-state row found product defect **bd `awkit-64x`** (bundled samples
> seeded as real records); the reauth-dialog GUI path stays domain-covered only (no test override
> for the 5-min window). Results + defects: `E2E_EXECUTION_REPORT.md` / `E2E_DEFECTS.md`.

---

## 1. Authentication

| Feature | Role | Preconditions | Scenario | Expected | Spec / Verifier | Status |
|---|---|---|---|---|---|---|
| First-run Super User provisioning | anonymous | empty profile | Positive: complete FirstRunSetup with valid creds | SU created, auto signed in, `.app-shell` mounts | harness `signInFirstRun` (all GUI verifiers) | COVERED(verify:auth-gui 13) |
| First-run validation | anonymous | empty profile | Negative: weak password / mismatch | Rejected with field errors, no account created | E2E-AUTH | NEW(E2E-AUTH) |
| Login | any user | provisioned profile | Positive: valid username+password | Session established, shell mounts, avatar shows initials | E2E-AUTH | NEW(E2E-AUTH) |
| Login | anonymous | provisioned profile | Negative: wrong password; unknown user; empty form | Generic error, no session, no user enumeration | E2E-AUTH + verify:auth (41) | NEW(E2E-AUTH) |
| Login — disabled account | disabled user | user disabled by SU | Negative: valid creds for disabled account | Login refused | E2E-AUTH | NEW(E2E-AUTH) |
| Logout (AccountMenu) | each role | signed in | Positive: Sign out | Returns to login screen; session revoked; back at login | E2E-RBAC (per-role cycle) | NEW(E2E-RBAC) |
| Forced password change | new user | admin-created user (`mustChangePassword`) | Positive: set compliant new password | Change accepted, shell mounts | E2E-AUTH | NEW(E2E-AUTH) |
| Forced password change | new user | same | Negative: non-compliant / mismatched new password | Rejected with errors; still gated | E2E-AUTH | NEW(E2E-AUTH) |
| Idle lock | signed-in user | `AWKIT_SESSION_IDLE_MS` short override | Boundary: no activity past idle window | App locks to login with notice; re-login works | E2E-AUTH | NEW(E2E-AUTH) |
| Session validation/rotation, sliding window | n/a (IPC) | provisioned store | rotation + expiry + revocation semantics | per SecurityStore contract | verify:auth | COVERED(verify:auth 41) |
| Re-auth for sensitive ops | SuperUser | stale reauth (>5 min) or fresh (<5 min) | Sensitive admin/licensing op prompts exactly when stale | REAUTH_REQUIRED then retry-after-reauth succeeds | verify:authz + E2E-RBAC (dialog path) | COVERED(verify:authz 40) |
| Password policy | all | — | Boundary: 12-char minimum, 3-of-4 classes | enforced at create/change/reset | verify:auth | COVERED(verify:auth 41) |

## 2. Authorization (RBAC) — nav, route mount, and direct IPC

Each row is exercised for **Administrator, Operator, Viewer** (and SuperUser as the positive
control) in one launch: SU provisions the three users → sign out → per-role sign-in.

| Surface | Scenario | Expected | Spec / Verifier | Status |
|---|---|---|---|---|
| Left nav visibility | Per role, nav shows exactly the permitted groups/items | Viewer: no Recorder/Settings/Admin; Operator: +Recorder, no Settings/Admin; Admin: +Settings, no Users/Licensing; SU: everything | E2E-RBAC | NEW(E2E-RBAC) |
| Route-mount guard ("direct URL") | Force-navigate to an unpermitted route id (renderer route state, not nav click) | `NotAuthorized` screen mounts, not the page | E2E-RBAC | NEW(E2E-RBAC) |
| Direct IPC — user administration | As Operator/Viewer/Admin call `security.admin.listUsers`/`createUser` via preload | Denied (`FORBIDDEN`-class reason), no data | E2E-RBAC (GUI-session) + verify:authz | NEW(E2E-RBAC) |
| Direct IPC — licensing | As Administrator call `licensing.getStatus`/`import` via preload | Denied — licensing is SuperUser-only incl. Administrator | E2E-RBAC + verify:licensing RBAC section | NEW(E2E-RBAC) |
| Direct IPC — settings mutation | As Viewer call `settings.update` patch | Denied; settings unchanged | E2E-RBAC | NEW(E2E-RBAC) |
| Direct IPC — workflow execute | As Viewer call `executions.runWorkflow` | Denied | E2E-RBAC | NEW(E2E-RBAC) |
| Privilege escalation | Non-SU grants themselves SuperUser via `admin.updateUser` | Denied (USER_MANAGE is SU-only) | verify:authz | COVERED(verify:authz 40) |
| Final-active-SU protection | Disable/demote the last active SU | Refused | verify:authz | COVERED(verify:authz 40) |
| Session invalidation on disable/role-change/reset | Affected user's live session revoked | next call fails; must re-login | verify:authz | COVERED(verify:authz 40) |
| Untrusted-sender IPC rejection | IPC from a non-AWKIT frame | Rejected by global sender guard | verify:security (39) | COVERED(verify:security 39) |

## 3. Super User administration (Users / Roles / Permissions / Audit)

| Feature | Scenario | Expected | Spec / Verifier | Status |
|---|---|---|---|---|
| Create user (each role) | Positive: username+temp password+role checkboxes | appears in list, `must reset` badge, USER_CREATE audited | E2E-RBAC (seed step) + verify:admin-gui | NEW(E2E-RBAC) |
| Create user | Negative: duplicate username; weak temp password | rejected with message; list unchanged | E2E-AUTH | NEW(E2E-AUTH) |
| Disable / enable / archive | State transitions incl. archived-immutability | badge updates; disabled cannot log in (§1) | E2E-AUTH (disable path) + verify:authz | PARTIAL → NEW(E2E-AUTH) |
| Reset password | Sets `mustChangePassword`, revokes sessions | user forced to change at next login (§1) | E2E-AUTH | NEW(E2E-AUTH) |
| Roles / Permissions matrix / Audit pages render | SU visits each | correct content, 0 console errors | verify:admin-gui | COVERED(verify:admin-gui 11) — stale licensing check REPAIRED (E2E-DEF-002) |
| Audit trail completeness | Privileged actions append audit entries | USER_CREATE etc. visible in Audit Log page | verify:admin-gui + verify:authz | COVERED |

## 4. Licensing (offline per-machine)

| Feature | Scenario | Expected | Spec / Verifier | Status |
|---|---|---|---|---|
| Domain: validator statuses (11), fingerprint, store precedence/corruption, signature | unit-level | exact status precedence | verify:licensing | COVERED(verify:licensing 56) |
| Licensing page — unlicensed state | SU opens Licensing on fresh profile | NOT_FOUND-style status, machine code shown + copy, import affordance, no crash | E2E-LIC | NEW(E2E-LIC) |
| Export activation request | SU exports request file | file written, contains machine hash, **no raw signals/secrets** | E2E-LIC | NEW(E2E-LIC) |
| Import invalid/corrupted license | SU imports garbage file | safe error status, page stays usable | E2E-LIC | NEW(E2E-LIC) |
| Enforcement default OFF | unlicensed profile, `SPECTER_LICENSE_ENFORCE` unset, run a workflow | run is **not** blocked | E2E-LIC | NEW(E2E-LIC) |
| Enforcement ON gate | `SPECTER_LICENSE_ENFORCE=true`, unlicensed, `runWorkflow` | `status:"licenseBlocked"`, actionable message, no throw; dry-run still allowed | E2E-LIC | NEW(E2E-LIC) |
| Non-SU access | Administrator: nav, route, and direct `licensing.*` IPC | all denied (§2) | E2E-RBAC | NEW(E2E-RBAC) |
| Real-key issue→import E2E | issuer keygen + issue on this machine | VALID here / MACHINE_MISMATCH elsewhere | prior session evidence (docs/LICENSING.md §6) | COVERED (2026-07-19) |

## 5. Core automation workflows (existing regression base)

| Feature | Verifier | Status |
|---|---|---|
| Runner node types, loops, connectors, protected-login pause/resume, Reuse Session, Save Session | verify:runner | COVERED(82) |
| Mock-site Feature Test Lab contract | verify:mock-site | COVERED(39) |
| Flow Designer GUI (canvas, palette, loop, dropdown) | verify:flow-designer | COVERED(24) |
| Workflow Builder GUI (scaffold, picker, splice, drawer) | verify:workflow-builder | COVERED(20) |
| Canvas render-count regression | verify:canvas-perf | COVERED(13) |
| Instance Monitor logic + GUI (grouping, bulk stop, modal focus trap) | verify:instance-monitor(-gui) | COVERED(35+12) |
| Reports Overview GUI | verify:reports | COVERED(31) |
| Runtime analytics GUI (seeded normal/empty/migration/high-data) | verify:runtime-analytics | COVERED(36) |
| Concurrency/locks/cancellation/recovery/watchdog/artifacts | verify:concurrency + phase 2–4 set | COVERED(78 + ~200) |
| Settings persistence (40 concurrent patches, atomic, flush-on-quit) | verify:settings-persistence | COVERED(3) |
| Profile store durability (atomic write, corrupt quarantine) | verify:profile-store | COVERED(13) |
| IPC contract (no broken/duplicate/undocumented channels) | verify:ipc-contract | COVERED(4) |
| Secrets handling (DPAPI, masking) | verify:secrets | COVERED(16) |
| Recorder locator/draft/flow + Smart Waits | verify:recorder(-draft,-flow) + verify:waits | COVERED(57+17+21) |
| Oracle driver settings + bridge (13 suites) | verify:oracle-* | COVERED(350) |

## 6. UI quality sweep (all routes)

| Check | Scenario | Expected | Spec | Status |
|---|---|---|---|---|
| Route render sweep | SU visits all 30 routes | each renders; **0 renderer console errors**; no blank screens | E2E-SWEEP | NEW(E2E-SWEEP) |
| Empty states | fresh profile, data-bearing routes | intentional empty states, never fake/seed data | E2E-SWEEP | NEW(E2E-SWEEP) |
| Theme toggle | light↔dark on representative routes | colors change, no layout shift, text legible | E2E-SWEEP | NEW(E2E-SWEEP) |
| Window resize (responsive) | 1280×800 → 1024×700 → small | no overlap/clipped shell; grids reflow | E2E-SWEEP | NEW(E2E-SWEEP) |
| Keyboard navigation | Tab across login + a main page | visible `:focus-visible` ring; forms submittable by keyboard | E2E-SWEEP | NEW(E2E-SWEEP) |
| Duplicate-click protection | double-click Create user / run controls | no duplicate records/runs | E2E-AUTH (create) / exploratory | NEW + exploratory |
| Reduced motion / a11y semantics | OS reduce-motion; roles/labels | motion neutralized; dialogs trap focus | manual checklist (docs/ai/TESTING.md) + verify:instance-monitor-gui (focus trap) | PARTIAL / MANUAL-ONLY |

## 7. API-failure / resilience states

| Check | Scenario | Expected | Status |
|---|---|---|---|
| Backend (main-process) failure surfaces | IPC rejection → UI error state | pages show error banners, not crashes | PARTIAL — exploratory pass + existing verifiers' error paths |
| Slow/failing network for automation targets | mock-site `/api/delay`, Smart Wait diagnostics | classified failures with sanitized diagnostics | COVERED(verify:waits 21) |
| App restart mid-run | hard kill → startup recovery | orphaned/recoverable classification, panel renders | COVERED(verify:packaged-walkthrough §; verify:startup-recovery 10) |
| Offline guarantee | no non-loopback egress | zero external TCP | COVERED(verify:chromium-hardening 13) — packaged re-check BLOCKED (OOM host) |

## 8. Explicitly out of scope / blocked (honest gaps)

- **Packaged NSIS/portable EXE run + clean-machine offline VM walkthrough** — `electron-builder`
  OOMs on this 15.9 GB host (KNOWN_ISSUES). BLOCKED; procedures in `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md` / `PHASE5_OFFLINE_VM_WALKTHROUGH.md`.
- **Firefox / WebKit / mobile-device projects** — N/A (Electron).
- **Screen-reader (NVDA/JAWS) audits, OS reduce-motion, long-translated-text/RTL** — MANUAL-ONLY.
- **Sustained multi-day soak with live browsers** — BLOCKED (needs dedicated machine; `awkit-cm8`).
- **Active Directory login** — feature not implemented (tab is `Coming soon`); N/A.
- **Destructive/load testing of shared infra** — none exists (offline app); N/A.

---

Generated 2026-07-19 as part of the adapted full E2E QA assessment (see
`docs/testing/E2E_EXECUTION_REPORT.md`). Specs: `specs/e2e/`. Executable tests:
`scripts/verify-e2e-*.mjs` (repo verifier convention). Evidence:
`test-artifacts/2026-07-19-e2e-qa/`.
