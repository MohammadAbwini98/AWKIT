# CURRENT_STATE

## E2E follow-ups CLOSED — Oracle IPC authz gate + live ReauthDialog GUI test (2026-07-19, later session)

Closed the two remaining E2E-assessment follow-ups (bd `awkit-b3w` + `awkit-2d8`); the whole four-bead cluster
(`awkit-64x`/`awkit-b92`/`awkit-b3w`/`awkit-2d8`) is now CLOSED. **On a feature branch — commit/PR pending.**
- **awkit-b3w — Oracle data-source IPC authorization:** `app/main/ipc/oracle.ipc.ts` `oracle:dataSources:save`/
  `delete`/`refreshSnapshot` now call `assertSenderPermission(event, DATASOURCE_MANAGE)` (previously a
  trusted-sender check only), closing a bypass where a direct preload call skipped the DataSourceManager UI
  gate. Mirrors the JSON `dataSources:*` surface. `verify:e2e-rbac` gained two Viewer-denied Oracle checks → **51/51**.
- **awkit-2d8 — live ReauthDialog GUI test:** new `scripts/verify-e2e-reauth-gui.mjs` + `verify:e2e-reauth`
  alias — a dedicated Electron launch with a short `AWKIT_REAUTH_WINDOW_MS` drives the real dialog: a sensitive
  admin op (create user) after the window lapses pops ReauthDialog and holds the action; a wrong password keeps
  it open with an error (no apply); the correct password closes it and the held create is applied. **9/9**.
- **Verification:** `npm run build` clean; `verify:e2e-rbac` **51/51**; `verify:e2e-reauth` **9/9**. GUI-verifier
  gotcha: orphaned `electron.exe` from prior launches makes `_electron.launch` fail with "Target … closed" — kill
  stale `electron.exe` before a run (see `docs/ai/KNOWN_ISSUES.md`).

## E2E-assessment defects FIXED — sender-bound IPC authorization + first-run seed removal (2026-07-19, later session)

Implemented the plan to close the open E2E-QA findings (bd **`awkit-64x`** + **`awkit-b92`**,
both CLOSED). **Merged to `main` @ `79e9999` via PR #22.**
- **awkit-64x (DEF-003) — first-run seeding removed:** `app/main/profileStores.ts` `seedFolder` dropped (flows +
  workflows); `dataSource.ipc.ts` `ensureDefaultDataSource` + `runtimeInput.ipc.ts` `ensureDefaultRuntimeInputs`
  deleted (stores return `store.list()`). A fresh profile now shows empty states; samples remain in `resources/`
  via `npm run seed:mock-fixtures`. `verify:e2e-sweep` flipped to assert empty states.
- **awkit-b92 (DEF-004/005) — sender-bound trusted authorization:** new `app/main/security/sessionContext.ts`
  binds `event.sender.id → sessionRef` (on login/change-password/validate; unbound on logout/destroy/expiry).
  `assertSenderPermission(event, perm)` fail-closed-gates the non-admin IPC surface — `execution:*` (EXECUTE/STOP),
  flow/workflow CRUD (CREATE/EDIT/DELETE), data-source CRUD (DATASOURCE_MANAGE), substantive `settings.update`/
  reset/import (SETTINGS_EDIT). Renderer per-action gating via `usePermissions().can()` disables Create/Edit/
  Delete/Clone/Run/Stop/Save across libraries, designers, DataSource pages, InstanceMonitor (`NodeOptionsMenu`/
  `WorkflowRunCard` gained `disabled` props). Footer nav permission-filtered (Settings hidden without
  `page.settings`; Help Center universal).
- **OBS-001/002:** StatusBar chips now read "Active flows/browsers"; `AWKIT_REAUTH_WINDOW_MS` dev/test override
  wired through `SecurityKernelOptions.reauthWindowMs`.
- **Verification (all green):** `npm run build` clean; new `verify:session-context` **11/11**; `verify:e2e-rbac`
  **49/49** (Viewer `settings.update` + real run now DENIED, footer filtered); `verify:e2e-sweep` 13/13;
  regression `verify:e2e-auth` 30 · `verify:e2e-licensing` 22 · `verify:runner` 82 · `verify:authz` 40 ·
  `verify:auth` 49 · `verify:security` 39 · `verify:licensing` 56 · `verify:ipc-contract` 4 · `verify:auth-gui`
  18 · `verify:admin-gui` 11 · `verify:avatar` 24.
- **Residual (follow-ups):** `oracle.ipc.ts` backend not yet sender-gated (its UI is gated) — bd `awkit-b3w`
  (P2); live ReauthDialog GUI automation — bd `awkit-2d8` (P3). Pattern saved: `bd remember` key
  `sender-bound-authz`.

## E2E QA assessment — auth/RBAC/licensing/route-sweep suites EXECUTED GREEN (2026-07-19, later session)

Adapted full E2E QA of `main` @ `0a4500f` (bd `awkit-xyo`; the generic web-app template was adapted to
Electron with owner approval). New assets: coverage matrix + reports under `docs/testing/`
(`E2E_COVERAGE_MATRIX.md`, `E2E_EXECUTION_REPORT.md`, `E2E_DEFECTS.md`), specs under `specs/e2e/`,
shared drivers `scripts/lib/e2e-qa-lib.mjs`, and four executable suites — `verify:e2e-auth` **30/30**,
`verify:e2e-rbac` **42/42**, `verify:e2e-licensing` **22/22**, `verify:e2e-sweep` **13/13** (all real
Electron, isolated fresh profiles). Healed two silently-broken existing suites (`verify:auth-gui` →
18/18, `verify:admin-gui` → 11/11 — stale post-PR-#21 selectors). Regression rerun green:
`verify:licensing` 56, `verify:avatar` 24, `verify:ipc-contract` 4, `verify:authz` 40, `verify:auth` 49.
**Product findings (both since FIXED — see the section above):** bd **`awkit-64x`** — fresh install
seeds bundled samples as real user records (RULES.md violation); bd **`awkit-b92`** (pre-existing) —
`settings:update`/`execution:*` IPC carry no per-role check, and the footer Settings/Help Center nav
is not permission-filtered (route guard holds). Evidence: `test-artifacts/2026-07-19-e2e-qa/`. This
assessment session changed no production code (the fixes landed in the follow-on session above).

## Admin/Licensing package — login branding, admin UI kit, profile avatar, per-machine licensing (2026-07-19)

Implements the external `specterstudio-admin-licensing-phases` (8-phase) package on branch
`feature/superuser-admin-rbac` (NOT committed). Frontend UI built with the `apple-design` skill; token-only
theming. Full write-up in **`docs/LICENSING.md`**.
- **Login branding (Phase 1):** official `specter-violet` logo (`app/renderer/assets/brand/specter-logo.svg`)
  on the login card, vector (high-DPI sharp), `onError` fallback to the built-in glyph. `LoginScreen.tsx`.
- **Admin UI kit (Phase 2):** shared `pages/admin/components/AdminUi.tsx` — `AdminPage`, `AdminBanner`,
  `AdminStatusBadge` (one 13-state vocabulary, icon+text, theme-aware), `AdminLoading`, `AdminEmpty`. All 5
  admin pages compose it; audit "Refresh" moved into the canonical `TopHeader` via `usePageChrome`. Route
  authorization was already enforced and is preserved.
- **Profile avatar (Phase 3):** `lib/initials.ts` (Unicode/`Intl.Segmenter` Teams-style initials + FNV
  deterministic palette), `components/shared/UserAvatar.tsx` + `AccountMenu.tsx`; `AppFrame` now shows the
  rounded avatar + name + role + Sign out. `verify:avatar` = 24/24.
- **Licensing core (Phase 4):** new `src/licensing/**` bounded context — Ed25519 signed licenses, multi-signal
  hashed **machine fingerprint** (no IP), 11-status validator with exact-timestamp expiry, adaptive store
  (LocalAppData primary / ProgramData optional-read, atomic + checksum), activation-request export. Separate
  offline issuer `tools/license-issuer/**` (NOT bundled; private key external). App ships **public key only**.
- **Licensing integration (Phase 5):** granular Super-User-only permissions (`license.*`), trusted
  main-process `licenseRuntime` + `licensing.ipc.ts` (RBAC + reauth + audit), preload `licensing.*`,
  full `LicensingPage.tsx` (replaces placeholder). **Enforcement is OPT-IN, default OFF**
  (`SPECTER_LICENSE_ENFORCE=true`); the run gate sits in `execution.ipc.ts` before `startRun`.
- **Verification:** `npm run build` (tsc) clean; `verify:licensing` = 56/56 (domain + RBAC); `verify:avatar`
  = 24/24; real-key issuer→app E2E (VALID here, MACHINE_MISMATCH elsewhere); no private key in repo/package.
  External gates unchanged (clean-machine offline, packaged EXE, live Electron GUI walkthrough — see
  `docs/LICENSING.md` §6).

## Super User administration + RBAC authorization IMPLEMENTED & verified (Phase 3, 2026-07-19)

Adds the authorization/administration layer on top of the auth trusted core (design plan Phase 3/11/12).
On branch `feature/superuser-admin-rbac` (NOT committed to `main`).
- **RBAC core (`src/security/authz/`):** `Permissions.ts` — the single permission registry + immutable
  built-in roles (**SuperUser / Administrator / Operator / Viewer**) + `effectivePermissions`. Decisions:
  scrypt (O-1), built-in roles only (O-2), roles-only v1 (O-4), fresh-login-after-restart (O-5);
  recovery codes deferred.
- **Enforcement (`AuthorizationService`) is the real boundary:** every mutating IPC handler calls
  `requirePermission(sessionRef, perm)` **after** session validation (deny-by-default); sensitive ops also
  require a fresh **re-auth within 5 min** (`requireFreshReauth`, `security:reauth`). Hiding a UI control is
  never the check — proven by tests that drive the IPC path directly.
- **User management (`UserAdminService`):** create/update/enable/disable/archive(soft-delete)/reset-password/
  revoke-sessions, with **final-active-Super-User protection**, protected-SU immutability (no delete/disable/
  demote), no privilege escalation (USER_MANAGE is SuperUser-only), **session invalidation** on disable /
  role-change / password-reset, and a full audit trail. Admin-created users are forced to change password.
- **Schema migration v2:** per-user `roles` JSON column (protected SU backfilled with `SuperUser`) + an
  `archived` status. `PrincipalSnapshot` now carries `roles` + effective `permissions` (UI hints).
- **IPC + preload:** 9 authorization-enforced, schema-validated `security:admin:*` + `security:reauth`
  handlers; `.security.admin.*` preload namespace.
- **Renderer:** `usePermissions().can()` + `RoutePermissions` gate the nav (`LeftNavigation` hides
  unpermitted items/groups) and the route mount (`App` shows `NotAuthorized` for a disallowed route).
  New **Super User Administration** area: **Users** (full CRUD + role editor + reauth modal), **Roles**,
  **Permissions** (matrix), **Audit Log**, **Licensing** (placeholder — machine licensing deferred, kept
  separate from authz). Token-only `.awkit-admin-*` CSS, light/dark.
- **Verify:** new **`verify:authz` 40/40** (permission enforcement, privilege-escalation denial, final-SU
  protection, disable/role-change/reset session revocation, reauth gating, audit) + new **`verify:admin-gui`
  10/10** (real Electron: SU sees admin nav, create user, Roles/Permissions/Audit/Licensing render, 0 console
  errors). `verify:auth` **49/49**, `npm run build` clean. Screenshot `reports/security-admin/`.
- **Remaining (follow-ups):** SU recovery codes; per-user permission overrides + custom roles (v2); machine
  licensing (Phase 5); Active Directory provider; deeper per-action button gating on non-admin pages.


## Secure Login + Oracle driver-settings MERGED to `main`; release-readiness audit run (2026-07-18)

**State correction (read first):** the two entries below, and the older `HANDOFF.md` notes, describe the
Secure Login work (trusted core + login UI) and the Oracle user-selected-Java/direct-JDBC work as living on
feature branches / "NOTHING COMMITTED". **That is now stale.** Both shipped to `main` on 2026-07-18:
- **PR #14** (`79e20a5`) — Oracle: user-selected Java runtime + direct JDBC (UCP removed).
- **PR #15** (`93162d6`, current `main` HEAD) — Secure Login: trusted core + login UI.

`main` is at `93162d6`; the working tree is clean apart from this audit's own doc/tracker edits. Where the
entries below say "on branch `feature/secure-login-auth`" or "Nothing committed", read "merged to `main`".

**Release-readiness audit (`fullstack-webapp-testing` skill), decision `CONDITIONAL GO` for `main` as a
dev/integration checkpoint — explicitly NOT a production-ship verdict.** Report + evidence under
`test-artifacts/2026-07-18-release-readiness-audit/`. Fresh safe-test evidence on `93162d6`: `npm run build`
clean; `verify:ipc-contract` 4/4 (172 handlers); `verify:security` 39/39; `verify:secrets` 16/16;
`verify:auth` 41/41; `verify:auth-gui` 13/13 (real Electron); `verify:profile-store` 13/13;
`verify:write-queue` 7/7; `verify:mock-site` 39/39; `verify:runner` 82/82 (real Chromium core E2E). Manual
secret-leakage scan of tracked source clean (only mock/test fixtures + one enum constant match); `.env`
gitignored; no key/cert files tracked. No P0/P1 defects in anything tested. Un-run (scope/time, not failures):
the Oracle 350+-check suite, concurrency/stress/soak, packaging/offline validation, Recorder/Smart-Wait/
popup/canvas-perf/chromium-hardening, automated a11y (none wired in this repo), and the standing external
gates (clean-machine offline VM walkthrough, signed packaged EXE, Oracle live perf/soak) — all unchanged by
this audit.

**GUI-verifier regression fixed across the general verifiers (bd `awkit-gmn`; 2026-07-19 sweep).** Root
cause is two-part: the branding splash breaks `app.firstWindow()` (returns the bridge-less splash, which
self-closes), **and** PR #15's `SecurityGate` now gates every route — the real `<App/>` shell never mounts
pre-auth. Fixed with a shared harness `scripts/lib/gui-verify-harness.mjs` (`resolveMainWindow` +
`signInFirstRun` + `isolatedLaunchEnv`): **verify:reports 31/31** (original reference), **capacity-settings
12/12**, **instance-monitor-gui 12/12**, **runtime-analytics-gui 36/36** (all four seeded states), **workflow-builder
20/20** (seeds flows+workflow), **flow-designer 24/24** (seeds a flow; launches + signs in + every
behaviour check passes). `verify:settings-persistence` is **3/3 unchanged** (pure preload IPC, never gated).
All counts re-verified independently 2026-07-19. **flow-designer's 5 stale geometry assertions modernized
(bd `awkit-9p6`, CLOSED):** rewritten from the old docked-column model (`canvasEngineRight <= panelLeft`,
`panelRight <= canvasRight`) to the actual floating-overlay invariants — the flow engine keeps the full
canvas width and the fixed-width drawer floats over its right edge (measured: ~1.8px right overhang, panel
below the action bar, collapsed rail = 48px = CSS `calc(space-5*2)`); the collapse measurement now waits for
the 240ms glide to settle instead of racing it (was flaky at 220ms). **`verify-oracle-drivers-gui` made
self-contained + gate-threaded (bd `awkit-xjv`, CLOSED): 30/30** — now launches on an isolated empty
`%LOCALAPPDATA%`, **copies** the validation stores (`java-runtimes` + `oracle-drivers`) from the source
profile into it (machine-global `java.exe` path + the bundle's own managed jar → same ids), signs in past
the SecurityGate, and reaches Settings via nav clicks (no session-dropping reload); the real bridge still
launches Java + loads the real ojdbc driver end-to-end (`driverAvailable=true driver=23.26.2.0.0`). It only
reads the source profile, so it is non-destructive; needs `build:oracle-bridge` + the real java.exe/ojdbc
jar present (override the source with `AWKIT_GUI_SOURCE_LOCALAPPDATA`). One idempotency defect found + fixed
during re-verification (bd `awkit-7ek`,
CLOSED): `runtime-analytics-gui` uses persisted `.fixtures-observability/<state>` dirs, so a re-run left a
provisioned Super User behind and hit the login form (0/4); `walkState` now clears
`<state>/SpecterStudio/security` before each launch — proven idempotent (36/36 twice, no re-seed).

**Secure Login hardening landed (2026-07-19): `awkit-ekd.6` + `awkit-ekd.7` CLOSED.**
- **Session rotation (ekd.7):** `changePassword` now revokes every *other* active session for the user
  (keeps the current one) — `SessionManager.revokeOthersForUser` → `SecurityStore.revokeSessionsForUserExcept`.
  `verify:auth` is now **45/45** (added 4 Session-rotation checks).
- **Single-instance guard (ekd.6):** `app/main/main.ts` acquires `app.requestSingleInstanceLock()`; a second
  launch focuses the running window (`second-instance`) and quits before opening any window/store, so two
  processes can't race on `security.sqlite`/ui-settings per profile. New **verify:single-instance 3/3**.
  The finer DurableLockStore-around-writes remains optional defense-in-depth (`awkit-ekd.8` P3 still open).

## SecurityStore debounced persistence (2026-07-19, `awkit-ekd.8`)

`SecurityStore` previously exported + atomic-renamed the whole DB on **every** mutation (a login was ~4
full writes; the new idle-lock heartbeat's `touchSession` fsynced on every validate). It now mirrors
`SqliteRuntimeStore`'s **debounced + persist-on-critical-transition + flush-on-close** model:
- **Critical (immediate, awaited flush):** `setProvisioned`, `insertUser`, `updateUser`, and all three
  `revoke*` — security correctness (a provisioned/changed/revoked credential must survive a crash).
- **Debounced (300 ms, coalesced):** `insertSession`, `touchSession`, `appendAudit`. A burst collapses to
  one write; any critical flush sweeps up whatever is pending (the whole in-memory DB is exported); a
  crash before the debounce window is fail-closed (re-login / slightly-stale idle window / a missing
  forensic row). `close()` (app quit → `disposeSecurityKernel`) force-flushes the trailing write, and
  `open()` still forces the initial schema write.
- **Verify:** `verify:auth` **49/49** (+4: burst does 0 synchronous writes → coalesces to 1; critical
  revoke flushes immediately; `close()` flushes the trailing debounced write, via a test-only
  `persistWriteCountForTest()`). `verify:auth-gui` **18/18** (real Electron, DPAPI + real close-on-quit),
  `verify:security` **39/39**, `verify:single-instance` **3/3**, build clean. Closes `awkit-ekd.8`.

## Proactive idle-lock UI + dark-mode login pass (2026-07-19, `awkit-l6h`)

The login gate previously re-validated only on window focus/visibility (server idle/absolute timeouts still
enforced). It now **locks proactively on user inactivity** and passes a dark-mode visual check.
- **Renderer activity tracking (`SecurityGate`):** while authenticated, an activity heartbeat
  (pointer/keyboard/wheel/scroll/touch) drives a poll that (a) **locks after the idle window** without
  waiting for a focus event — returning to the login screen with a *"You were signed out after N minutes of
  inactivity."* notice (`.awkit-login-notice`, info-toned, theme-aware), and (b) while the user is genuinely
  active, **refreshes the server's sliding idle window** (`validateSession`) so a continuously-used,
  never-blurred window isn't logged out at the timeout, and catches server-side invalidation (absolute
  expiry, deactivation, revoke-on-password-change). Tick + refresh cadence scale off the idle window.
- **Idle window surfaced to the renderer:** `SecurityKernel.getBootState()` now returns `idleTimeoutMs`
  (from `SessionManager.idleTimeoutMs`); the Electron binding honors an optional numeric
  `AWKIT_SESSION_IDLE_MS` override (dev/test only — production uses `DEFAULT_SESSION_POLICY`, 30 min).
- **Verify:** `verify:auth-gui` **18/18** (was 13/13) — added dark-mode login (`data-theme=dark` when dark
  appearance is selected; screenshot `reports/security-login/login-dark.png`) and a real proactive-lock test
  (a 4s `AWKIT_SESSION_IDLE_MS` window → idle → bounced to login with the inactivity notice, no focus event;
  screenshot `login-idle-locked.png`). `verify:auth` **45/45**, `npm run build` clean. Files:
  `SecurityGate.tsx`, `screens/LoginScreen.tsx`, `global.css` (`.awkit-login-notice`),
  `src/security/{SecurityKernel,session/SessionManager}.ts`, `app/main/{security/securityKernel,preload}.ts`,
  `scripts/verify-auth-gui.mjs`.

## Secure Login — trusted core + login UI IMPLEMENTED & verified (real Electron); authz/licensing pending (2026-07-18)

The **login UI (Phase 6)** is now built on top of the trusted core, on branch `feature/secure-login-auth`.
`app/renderer/main.tsx` renders a new `SecurityGate` (`app/renderer/security/`) that mounts **only** the
sign-in surfaces until the trusted main process confirms a session — the real `<App/>` and every protected
route are never mounted before auth, so **protected pages cannot flash** (asserted by the GUI verifier).
Surfaces: `LockedShell` (reuses the custom `AppFrame`), `LoginScreen` (Virtual User active; **Active
Directory a disabled "Coming soon" tab**), `FirstRunSetup` (one-time Super-User provisioning → auto sign-in),
`ForcedPasswordChange`, `SecurityUnavailable` (fail-closed), `PasswordField` (show/hide + Caps-Lock),
`SessionContext` + a title-bar user chip & sign-out in `AppFrame`. Styling is token-only in `global.css`
(`.awkit-login-*`), light/dark, reduced-motion-aware, keyboard-accessible.
- **Verify:** `npm run verify:auth-gui` → **13/13 in real Electron** (isolated temp `%LOCALAPPDATA%`):
  no-flash, first-run → app shell, session chip + sign-out → login, AD disabled/coming-soon, re-login,
  zero console errors. Screenshots in `reports/security-login/`. `npm run build` + `verify:auth` (41/41) +
  `verify:ipc-contract` (4/4) green. Follow-up bead `awkit-l6h` (proactive idle-lock + dark-mode visual pass).

## Secure Login — trusted auth core IMPLEMENTED + headless-verified; UI pending (2026-07-18)

On branch `feature/secure-login-auth` (epic `awkit-ekd`), the **Phase 1+2 backend trusted core** for
local virtual-user authentication is implemented and verified headless — **no login UI yet** (deliberate:
"prove the core before the UI"). New code (all under `src/security/**` + `app/main/security/**` +
`app/main/ipc/security.ipc.ts`, distinct `security:*` IPC namespace — the existing `auth:*`/`session:*`
are automation-only and untouched):
- `SecurityStore` (sql.js + versioned migrations, single-writer atomic-rename persistence, `passwordSecret`
  column wrapped by an injected `ColumnCrypto` — Windows DPAPI `safeStorage` in main, passthrough in tests).
- scrypt password hashing (`node:crypto`, per-user salt, `timingSafeEqual`, rehash-on-login) + password
  policy + username rules.
- `AuthenticationService` (one-time first-run Super-User bootstrap, login with uniform errors, failed-login
  counting, temporary lockout, sessions with idle+absolute timeout, logout invalidation, self-service +
  forced password change, audit) + `AuthenticationProvider` abstraction (Local active; **Active Directory
  a disabled inert stub**) + `SessionManager` + `SecurityKernel` facade.
- `security.ipc.ts` (sender-guarded, schema-validated, fail-closed reason codes) + `.security` preload
  namespace; kernel lazily opened, disposed on quit.
- **Verify:** `npm run verify:auth` → **41/41** (bootstrap one-time, login success/uniform-failure, lockout,
  disabled account, sessions/logout/idle/absolute, password policy/change/forced-change, migrations,
  persistence, no-plaintext-on-disk). `npm run build` + `tsc --noEmit` clean; `verify:ipc-contract` 4/4,
  `verify:secrets`/`verify:security` unaffected.
- **Self-reviewed;** 5 findings — 2 fixed (fail-closed on kernel-open failure; dead-branch simplification),
  3 filed as follow-up beads: `awkit-ekd.6` cross-process single-writer lock (DurableLockStore +
  requestSingleInstanceLock), `awkit-ekd.7` revoke other sessions on password change, `awkit-ekd.8`
  debounced persistence.
- **Remaining (future phases):** authorization/RBAC, Super-User admin UI, machine licensing, and the login
  UI (SecurityGate/LockedShell/LoginScreen + no-flash startup integration). Design authority:

A full implementation-ready design exists at
[`docs/plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md`](../plans/SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md)
for adding local virtual-user authentication, RBAC authorization, Super-User administration, and per-machine
Ed25519-signed licensing — all offline, no admin, preserving packaging/theme. **No production code has been
written.** The plan reuses the `sql.js` migration framework, DPAPI `safeStorage`, the global IPC sender guard,
and Hologram tokens; it introduces new `security`/`license` IPC namespaces (the existing `auth`/`session`
namespaces are automation-only and are left untouched). Startup gains a `SecurityGate` so the login page
follows the splash with no protected-page flash. 10 open decisions (O-1..O-10) must be confirmed before Phase 1.
Tracking bead `awkit-bn2`. Not started; nothing committed.

## Oracle: user-selected Java runtime + direct JDBC, UCP removed → PRODUCTION-CANDIDATE (2026-07-18)

Epic `awkit-kzo` (branch `feature/oracle-jdbc-driver-settings`) is complete and verified. **Specter no
longer bundles Java or UCP.** The user selects a Java runtime and imports an Oracle JDBC driver in
**Settings → Database Drivers**; Oracle runs through the isolated bridge via **direct JDBC** (one
connection per query, no pool). UCP is removed entirely (ucp import rejected; `OracleUcpQueryExecutor`
deleted; no dormant path). Specter stays usable with no Java configured — non-Oracle workflows, JSON, and
Oracle **Snapshot** Data Sources need no Java. Full write-up:
[`ORACLE_USER_SELECTED_JAVA_REMOVE_UCP_REPORT.md`](ORACLE_USER_SELECTED_JAVA_REMOVE_UCP_REPORT.md).

- **Live 7/7** (`verify:oracle-live`, real Oracle 19c) via the Settings Java-runtime + driver-bundle path
  (`Local-JDK-17` Java 17.0.8 + `Oracle-ojdbc17-local-19c-validation` ojdbc17 23.26.2.0.0). Deterministic
  cancellation via a ~8.5M-row cross-join query. Ephemeral `SPECTER_READER` provisioned out-of-band + retired.
- **GUI 30/30** (`verify:oracle-drivers-gui`, real Electron): both Database Drivers cards render; **selected
  Java launches the bridge + loads the real ojdbc driver**; deletion guard; no secrets; 0 console errors.
  Screenshots under `reports/oracle-validation/`.
- **Verifiers**: 13 non-GUI Oracle suites **350/350**; `verify:oracle-direct-jdbc` 23/23, `-java-runtime`
  48/48, `-driver-bundle` 47/47, `-packaging` 23/23, `-offline-bundle` 11/11 (rejects bundled JRE/driver),
  `-runtime-prep` 14/14. `npm run build` clean; `validate:offline` clean (bridge-only bundle).
- **Regression** cross-cutting green (ipc-contract, settings-persistence, profile-store, secrets,
  data-editor, concurrency, cancellation). Found + fixed a pre-existing **branding-splash** regression that
  broke `firstWindow()`-based Electron GUI verifiers (bd bug filed for the rest).
- **Soak** ≥30 min direct-JDBC (`benchmark:oracle-jdbc`, live path): latency P50/P95, cancellation latency,
  bridge+Node RSS, teardown invariants, no pool metrics — see the report §12 + `oracle-soak.json`.
- **Packaging**: only the bridge jar is bundled (`prepare:oracle-runtime`); the offline validator now
  **rejects** any bundled JRE or driver jar. `electron-builder.json` unchanged. `.gitignore` ignores the
  whole generated `resources/oracle-jdbc/`.
- **Remaining external gates**: packaged-EXE build (dev host OOMs on `electron-builder`) + clean-machine
  walkthrough; sustained real-world soak. **Nothing committed** (conservative git profile, ephemeral branch).

## Oracle `verify:oracle-live` gate PASSED against a real local Oracle 19c (2026-07-18)

The **authorized read-only Oracle run** external gate is now met — via the existing local Oracle 19c
(not Docker). On branch `feature/oracle-jdbc-driver-settings`, `npm run verify:oracle-live` ran **7/7 in
real mode** against `jdbc:oracle:thin:@//localhost:1521/ORCLPDB` as least-privilege `SPECTER_READER`,
resolving the driver from the Settings-managed bundle (`ojdbc17.jar` 23.26.2.0.0, JDBC-only). Steps:
testConnection, select-small, truncation, type-conversion, policy-blocks-dml (`SQL_POLICY_VIOLATION`),
permission-or-missing-object (`DRIVER_ERROR`), cancellation (`CANCELLED`). Bridge `executionMode=real`,
Java 17.0.8. Redacted artifact `reports/oracle-validation/oracle-live.json` (gitignored) excludes
credentials / binds / row content.

- **Fixture mismatch resolved additively.** The harness expects `id`/`name` + 50+ rows, but the downloaded
  pack made `CUSTOMERS`(3 rows)/`TYPE_SAMPLES`(1) with different column names. Provisioned the canonical
  `SPECTER_FIXTURE.AWKIT_TYPES_TEST` (204 rows) via new `scripts/oracle/local-19c-awkit-types-fixture.sql`
  (idempotent, OS-auth `sqlplus / as sysdba`), `GRANT SELECT` + private synonym
  `SPECTER_READER.AWKIT_TYPES_TEST` created **as SYS** (reader never granted CREATE SYNONYM). Existing
  `CUSTOMERS`/`TYPE_SAMPLES`/`V_ACTIVE_CUSTOMERS` left untouched. Ran with
  `AWKIT_ORACLE_LIVE_TEST_TABLE=SPECTER_FIXTURE.AWKIT_TYPES_TEST` (schema-qualified SELECT is allowed by the
  read-only SQL policy — tokenizer splits on `.`).
- **Ephemeral credential, then retired.** Minted a strong random dev-only `SPECTER_READER` password via
  OS-auth, stored **only** in a user-scoped scratchpad file (never printed to chat/logs/history/artifact);
  used it for the single run; then rotated to a discarded random password + **ACCOUNT LOCK** and securely
  deleted the secret file. Re-running the fixture SQL `UNLOCK`s the account for a future run.
- **Regression:** `npm run build` clean (tsc + 3 bundles); `verify:oracle-driver-bundle` 43/43.
- **Status stays `INTEGRATION-CANDIDATE`.** This clears one of the four external gates. Still open: the
  **UCP pooled executor is unvalidated** (no UCP jar → the live run used the non-pooled JDBC executor,
  `ucpVersion=unavailable`); the bundled private-JRE `prepare:oracle-runtime` + **packaged-EXE clean-machine
  walkthrough**; and **real perf/soak**. Part B tooling (Docker orchestration, `import-driver-bundle.mts`,
  the `verify-oracle-live.mts` bundle wiring, and this fixture SQL) remains **uncommitted** on the branch.

## Local Oracle fixture provisioned and read-only account verified (2026-07-18)

The downloaded Specter Oracle fixture pack was run successfully against the existing local Oracle 19c
instance (`ORCLPDB`, port 1521). It created/opened `SPECTER_FIXTURE` and `SPECTER_READER`, valid
`CUSTOMERS` / `TYPE_SAMPLES` tables and `V_ACTIVE_CUSTOMERS` view, with deterministic counts 3 / 1 / 2.
Direct grant inspection confirms the reader has only `CREATE SESSION` plus non-grantable `SELECT` on the
three fixture objects and no roles; the supplied verifier also proved `INSERT` is rejected. The downloaded
setup required one external-only idempotency correction because it attempted to open an already-open PDB.
No credentials were persisted or documented. This proves the fixture pack, not yet SpecterStudio's
`verify:oracle-live` application path, so release status remains `INTEGRATION-CANDIDATE`.

## Oracle pending-phase run — 5 of 12 executed, 7 blocked on verified-absent artifacts (2026-07-17)

Ran the 12-phase "pending implementation" plan against merged `main` (`b6e473d`). **Status unchanged:
`INTEGRATION-CANDIDATE`.** Oracle now **226/226** across 10 verifiers (was 218).

- **Executed:** 01 baseline (build + verifiers green, all 3 fail-closed layers present); 04 fail-closed
  revalidation (4 of 5 truth-table rows + the plan's Required Product Behavior); **07 lazy behavior — a real
  gap the plan caught**; 08 full regression; 12 report + summary block.
- **07 is the substantive change:** the lazy suite used to count an *injected stub*. It now drives the
  **real Java bridge process** and counts actual `executeQuery` **RPCs at the wire** (12 → 20 checks). The
  strongest proofs are negative — a Snapshot source and an unreferenced Runtime source leave the Java
  process **never started** (`manager.isRunning() === false`). Also proves single-flight (3 parallel
  consumers → 1 RPC), one-query-per-run, and failed-attempt cache eviction → retry re-executes.
  It additionally covers "runtime unavailable → JSON + Snapshot keep working, Runtime fails safely with
  `DRIVER_UNAVAILABLE`, no crash".
- **Blocked (02, 03, 05, 06, 09, 10, 11) — probed, not assumed:** no `ojdbc*/ucp*.jar` anywhere
  (`~/.m2`/Downloads/Desktop), Maven Central **HTTP 000**, no Docker, no `AWKIT_ORACLE_LIVE_*` creds, no
  clean Windows box. All seven fail at the same first step — acquiring the artifacts. Evidence table +
  per-phase unblock steps in `ORACLE_JDBC_VALIDATION_GATES.md`.
- **Plan assumptions corrected, not obeyed:** it targets "the committed Oracle feature branch" (merged +
  deleted; baseline is `main`) and expects "rebrand/splash absent" (present **by design** — the rename is
  an Oracle dependency). Its `ORACLE_RUNTIME_UNAVAILABLE` token maps to the existing `DRIVER_UNAVAILABLE`
  category; not renamed for cosmetics.
- **Known non-regression:** `verify:durable-store` **9/2** (SQLite migration checks) fails **identically at
  `dee283e`**, pre-Oracle (proven in an isolated worktree). Not ours; left alone.

## Shipped to `main` — Oracle JDBC + SpecterStudio rename + launch splash (2026-07-17)

`main` is at `b6e473d`, CI green. Everything below is **merged and no longer local-only**:

- **PR #11** (`476dc29`) — `chore:` rename WebFlow Studio / playwright-flow-studio → **SpecterStudio**
  (38 files, renames only) + `feat(oracle):` the Oracle JDBC feature (79 files). The rename shipped with
  Oracle because the Oracle work is SpecterStudio-native (`com.specterstudio.*` Java packages,
  `com.specterstudio.app` appId, `%LOCALAPPDATA%/SpecterStudio/`), so shipping Oracle alone would have
  left the rename half-applied.
- **PR #12** (`b6e473d`) — `feat(branding):` launch splash (`app/renderer/splash.html`, a frameless,
  offline, canvas-only window with **no preload/node access**), the new SpecterStudio logo + regenerated
  icons (`icon-source.png` 5.1MB→51KB, `icon.png` 1.4MB→51KB, `icon.ico` 372KB→27KB), the sidebar brand
  mark, and a `generate-app-icon.mjs` rewrite that drops `png-to-ico` (its DIB writer mis-computed
  multi-frame ICO offsets — see KNOWN_ISSUES). `logos/specter-violet/` is the tracked design source of
  truth; the superseded pre-rename families are gitignored.

Verified on merged `main`: `npm run build` clean (emits `splash.html`), Oracle **218/218** across 10
verifiers, `verify:runner` 82/82, `verify:recorder` 72/72, GitHub Actions "Typecheck & Build" success.

**Release status is still `INTEGRATION-CANDIDATE`** — merging shipped the code, not the validation. The
four external gates are unchanged (see `ORACLE_JDBC_VALIDATION_GATES.md`).

> CI gotcha: `.github/workflows/ci.yml` triggers only on `push`/`pull_request` to `main`, so a **stacked**
> PR based on another branch gets **no CI at all**. PR #12 merged without CI having run on it (verified
> locally instead; CI then passed on `main`). Verify stacked PRs locally or retarget before relying on CI.

## Oracle JDBC — status corrected to INTEGRATION-CANDIDATE; fail-closed production, real UCP executor authored, SQL hardening, live/lazy/packaging harnesses (2026-07-17)

Response to a supplied 10-phase **validation & release** track (distinct numbering from the original 14
implementation phases). Its core correction: the prior `PRODUCTION-CANDIDATE` label was **over-stated** —
the real executor had never compiled and no authorized Oracle had ever been used. Release status is now
**INTEGRATION-CANDIDATE**. **218 Oracle checks green across 10 verifiers** (was 120/5); `npm run build`,
`verify:runner` 82/82, `verify:security` 39/39, `verify:secrets` 16/16, `verify:ipc-contract` 4/4 clean.

- **Fail-closed production (Phase 01) — fixed a LIVE mock leak.** `app/main/oracleService.ts` previously
  forced `AWKIT_ORACLE_BRIDGE_MOCK=1` whenever the driver jars were absent, **with no packaged-mode
  guard** — a packaged build with a driverless bundle would have silently served synthetic rows. Now
  `OracleRuntimeResolver` owns the policy (`mockAllowed`/`requireRealDriver`), baking
  `AWKIT_ORACLE_REQUIRE_REAL=1` into packaged launches and the mock only into dev; packaged + missing
  driver ⇒ **feature unavailable** (Snapshot Data Sources still work — they never launch the bridge).
  The Java bridge honors `AWKIT_ORACLE_REQUIRE_REAL` by ignoring any mock flag and selecting the new
  `DriverUnavailableExecutor` (every query → `DRIVER_UNAVAILABLE`) instead of `MockQueryExecutor`; the
  bridge manager independently rejects a non-`real` handshake (`requireRealDriver`). `hello` now reports
  `executionMode`/`ucpVersion`/`javaVersion`.
- **Real UCP executor authored (Phase 03).** `oracle-jdbc-bridge/src/main/java-oracle/.../OracleUcpQueryExecutor.java`
  now exists (it never did — a prior memory claim was false): UCP pool-per-compatibility-key, prepared
  statements, typed binds, query timeout, `Statement.cancel()` via `CancellationToken.onCancel`, result
  metadata + Oracle type conversion (precision-preserving NUMBER, ISO timestamps, capped CLOB), and safe
  ORA→category error mapping that never leaks ORA text/SQL/binds. It compiles only against vendored jars
  (external gate) but `verify:oracle-bridge-real-build` **stub-compiles it against the real JDK
  `java.sql`** on every run, so its JDBC usage stays validated. This caught a real defect: `BridgeException`
  had no `(category, message, retriable)` constructor the executor needed.
- **SQL policy hardened (Phase 04), TS↔Java parity proven.** `WITH FUNCTION`/`WITH PROCEDURE` (inline
  PL/SQL, 12c+) previously **passed** both gates — `WITH` is a legal lead keyword and `FUNCTION`/
  `PROCEDURE` weren't forbidden. Now rejected, along with database links (`@`) and `UTL_`/`DBMS_`/`OWA_`
  package calls (a read-only SELECT can still invoke a stored function → SSRF/file access).
  `verify:oracle-sql-policy` runs one 30-case adversarial corpus through the TS mirror **and** the
  authoritative Java gate (via the real Dispatcher) requiring identical decisions — including
  false-positive guards (an email in a literal is not a dblink).
- **New commands:** `prepare:oracle-runtime` (reproducible, offline, fail-closed bundle staging against a
  locked manifest — verifies sha256/arch/Java-version/licenses, builds the bridge, regenerates
  `checksums.json`; skips cleanly with no staged artifacts), `verify:oracle-{bridge-real-build,
  runtime-prep,sql-policy,live,lazy-resolution,offline-bundle}`. `verify:oracle-live` is credential-gated,
  never falls back to mock, and writes a redacted `reports/oracle-validation/oracle-live.json`.
- **Packaging (Phase 08):** `validate-offline-bundle.ps1` gained an Oracle section (checksums, layout,
  real driver required, no secrets/wallets, size report) backed by the shared `auditOracleOfflineBundle`;
  `electron-builder.json` excludes any `.env`/wallet/key under `oracle-jdbc/`.
- **New docs:** `ORACLE_JDBC_RUNTIME_MATRIX.md` (compatibility/licensing/acquisition),
  `ORACLE_JDBC_DB_ACCOUNT_RUNBOOK.md` (least-privilege account — the *primary* read-only boundary),
  `ORACLE_JDBC_VALIDATION_GATES.md` (exact procedure for the external gates).
- **External gates (unchanged, cannot run here):** vendor real `ojdbc`/`ucp` jars + a private JRE
  (build-time network blocked) → real-jar compile; authorized read-only Oracle run (Phase 06, no DB/Docker);
  packaged-EXE clean-machine walkthrough (Phase 09); real perf/soak (Phase 10). Status advances to
  PRODUCTION-CANDIDATE only after Phase 06, and PRODUCTION-READY only after 09+10.

## Oracle JDBC — DS renderer UI, defensive result limits, packaging checksums, final report (Phases 05, 11, 12, 14) (2026-07-17)

Continuation of the same-day increment below. Closes the renderer UI gap, hardens Phase 11's result
limits, adds Phase 12 checksum-validation infrastructure, and writes the Phase 14 final report. Still
database-free / mock-bridge verifiable; live JDBC + real Oracle remain external gates.

- **Phase 05 renderer UI (done, GUI-verified live):** `OracleDataSourceModal.tsx` (create/edit form —
  name/mode/description/connection-profile/SQL/binds/limits) wired into `DataSourceManager.tsx` via an
  "Add Oracle Source" toolbar button + a `oracleModal` state slot. Verified in the real Electron window
  (not just build/bundle-inclusion): modal opens, fields bind correctly, and client-side validation
  blocks `Create` with "Select an Oracle connection profile." when none exists — zero DevTools console
  errors. See [[electron-gui-verify-workflow]] for the DPI-awareness automation fix this uncovered.
- **Phase 11 hardening:** `OracleTypeConversion.enforceResultLimits` previously declared `maxCellBytes`
  in its interface but never checked it, and `OracleQueryService` never passed `maxColumns`/
  `maxSerializedBytes` from any real caller — all three were dead limits. Now `OracleQueryService`
  applies defensive built-in defaults (`DEFAULT_MAX_COLUMNS=200`, `DEFAULT_MAX_CELL_BYTES=1_000_000`,
  `DEFAULT_MAX_SERIALIZED_BYTES=25_000_000`) even when a node/Data Source doesn't set its own, and
  `enforceResultLimits` now actually walks each row's string cells against `maxCellBytes`.
- **Phase 12 packaging:** new `OracleBundleChecksums.validateOracleBundleChecksums` — reads an optional
  `resources/oracle-jdbc/checksums.json` (sha256 per bundle-relative file); absent = nothing to validate
  (lazy availability preserved), present = every file must exist and match or the bundle is rejected.
  Wired into `OracleRuntimeResolver`'s bundled-runtime branch so production **fails closed** on a
  corrupted/tampered/incomplete bundle instead of launching it. The actual jar/JRE vendoring into
  `resources/oracle-jdbc/` and the `electron-builder.json` `extraResources` entry are still not done —
  network is blocked at build time here (external gate); the validation *logic* is complete and tested
  against synthetic fixtures.
- **Phase 14:** migration needs no code — the `jsonArray | oracle` union already treats a missing
  `type` field as `jsonArray`, so pre-Oracle profile JSON on disk loads unchanged. Wrote
  [`ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md`](ORACLE_JDBC_DATA_SOURCE_NODE_REPORT.md) (17-section final
  report): ~~PRODUCTION-CANDIDATE~~ — **superseded: corrected to INTEGRATION-CANDIDATE on 2026-07-17**
  (the real executor had never compiled and no authorized Oracle was ever used); exact blockers listed
  (vendor jars/JRE, real-Oracle validation, packaged-EXE rebuild, real-latency performance check).
- **Verification:** `npm run build` clean; new `verify:oracle-packaging` **11/11**; `verify:oracle-runtime`
  **27/27** (+5: result-limit coverage); `verify:oracle-bridge` **32/32**, `verify:oracle-profiles`
  **22/22**, `verify:oracle-data-source` **28/28**, `verify:runner` **82/82** (no regression). 120 total
  Oracle checks green. (Merged to `main` 2026-07-17 via PR #11 — see the top entry.)

## Oracle JDBC — node + Data-Source execution wiring & snapshot capture (Phases 06, 08–10) (2026-07-17)

Builds on the 01–04 + 07 foundation below. The Oracle **node** (Phases 08/09) and its **workflow
execution wiring** (Phase 10) are complete, and Oracle **Data Sources** now execute end-to-end
(runtime + offline snapshot). Still database-free / mock-bridge verifiable; live JDBC + real Oracle
remain external gates.

- **Oracle node (Phases 08/09):** `oracle` `StepType` + `OracleNodeSection` panel (connection source =
  profile | Data Source, SQL, binds, return-type mapping) + `OracleNodeExecution` (bind resolve →
  runner → `OracleResultMapper`). `execution.ipc` sets the main-process node runner
  (`getOracleNodeRunner`) which owns the JDBC bridge via `OracleQueryService`.
- **Data-Source execution wiring (Phase 10, DS-side):** `resolveWorkflowDataSources` now branches on the
  discriminator — jsonArray keeps its eager file/path path; **Oracle sources resolve through
  `DataSourceResolver`** (snapshot = stored rows; runtime = single-flight per-run lazy loader backed by
  `runOracleDataSourceQuery`). A workflow-bound Oracle source is **materialized eagerly** so row-count
  loops (`dataRows`) work; `FlowExecutor`/`StepExecutor` loop consumers use the new
  `materializeDataSourceRows` helper so a lazy runtime source is loaded on demand.
- **DS bind resolution:** new `OracleDataSourceBinds.resolveDataSourceBinds` — Data-Source queries bind
  only resolution-time sources (`static` / `env` / `workflowInput`); per-row / previous-output / flow
  binds are rejected with a clear message (they belong on the node, which runs in step context).
- **Snapshot capture (Phase 06):** `refreshOracleDataSourceSnapshot(id)` executes the query once,
  normalizes to an array of JSON objects, and **atomically persists** it (`store.update` = temp+rename)
  with `queryHash` + `connectionFingerprint` for staleness; on failure it keeps the last good rows
  (offline safety) and records a **secret-safe** `error` summary (category only, never SQL/values).
- **Oracle Data-Source IPC/preload (Phase 05 backend):** `oracle:dataSources:{list,get,save,delete,
  refreshSnapshot}` (mutations sender-guarded) + preload `oracle.{listDataSources,getDataSource,
  saveDataSource,deleteDataSource,refreshSnapshot}`. `saveOracleDataSource` validates read-only SQL up
  front and preserves any existing snapshot across edits. **Renderer DS-management UI is still todo.**
- **Verification (this increment):** `npm run build` clean; `verify:oracle-data-source` **28/28**
  (+8: DS binds + `materializeDataSourceRows`); `verify:runner` **82/82**; `verify:oracle-bridge`
  **32/32**, `verify:oracle-profiles` **22/22**, `verify:oracle-runtime` **22/22**.
- **Remaining:** Phase 05 **renderer** UI (create/edit Oracle Data Sources + snapshot refresh button in
  `DataSourceManager`), 11 (extra hardening), 12 (packaging + checksum validation + `validate:offline`),
  13 (real-Oracle external gate), 14 (final report). (Merged to `main` 2026-07-17 via PR #11.)

## Oracle JDBC Data Source & Node — backend foundation (Phases 01–04 + 07) (2026-07-16)

First tranche of the Oracle JDBC feature (plan: [`ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md`](ORACLE_JDBC_DATA_SOURCE_NODE_PLAN.md)).
Adds Oracle database support via a **bundled private Java bridge** (framed JSON-RPC over stdio — no
network port), reusing AWKIT's Data Source, secret, IPC, and packaging systems. **Read-only** initial
release. All work is **offline-verifiable with a database-free mock executor**; the live JDBC path,
vendored ojdbc/ucp jars + private JRE, and real-Oracle validation are **external gates**.

- **Java bridge (`oracle-jdbc-bridge/`):** zero-dependency pure-JDK **core** (JSON codec, 4-byte
  length framing, dispatch + cancellation registry, authoritative read-only SQL policy, database-free
  `MockQueryExecutor`) compiles/runs with a **pinned JDK 17** and no network. `Main` reserves stdout
  for frames and reflectively loads the real Oracle UCP executor when jars are vendored, else falls back
  to the mock (like a dev checkout lacking Chromium). Build: `npm run build:oracle-bridge`.
- **TS bridge client (`src/oracle/`):** `OracleJdbcBridgeManager` (lazy spawn, `hello` handshake +
  protocol-version check, request correlation, per-request timeout, AbortSignal→`cancelQuery`
  propagation, bounded restart after crash, orphan-free `dispose`) + `OracleBridgeProtocol`
  (envelope/framing/error categories). Disposed on app `before-quit`.
- **Connection profiles + secrets (Phase 03):** `OracleConnectionProfile` (JDBC-URL builder,
  credential redaction, pool fingerprint, validation) + pure `OracleProfileService` (CRUD; inline
  passwords routed into the existing **by-name DPAPI `SecretStore`** as `oracle.<id>.password`;
  `testConnection` via bridge; error-category→safe-message). `app/main/oracleService.ts` +
  `ipc/oracle.ipc.ts` (7 sender-guarded channels) + preload `oracle` domain. Renderer only ever gets
  `hasPassword` — never a secret value. New `oracle-profiles` runtime folder.
- **Data Source model + resolver (Phase 04):** `DataSourceProfile` is now a backward-compatible
  `jsonArray | oracle` union (legacy profiles + all existing `dataSource.ipc` behavior unchanged).
  Authoritative pure **`DataSourceResolver`** normalizes every type to one `ResolvedDataSource`
  array-of-objects contract: JSON = unchanged lazy file read; Oracle snapshot = stored offline rows;
  Oracle **runtime = single-flight per-run-cached lazy loader** (failed attempts not cached).
  `ResolvedDataSource` gained optional `loadRows()`/`type`/`oracleMode`; `ValueResolver` honors it.
- **Runtime query service (Phase 07):** `OracleQueryService` is the **single query authority** (SQL
  gate → descriptor/secret resolution → typed binds → bridge `executeQuery` → normalize + defensive
  limits → timeout/cancel/transient-retry/bounded-concurrency/telemetry). Node executors and the
  resolver call this, never the bridge directly. Deterministic bind/type conversion keeps
  high-precision numbers as strings.
- **Verification:** `npm run build` clean (tsc + bundles); `verify:ipc-contract` **4/4** (143 handlers);
  `verify:oracle-bridge` **32/32**, `verify:oracle-profiles` **22/22**, `verify:oracle-data-source`
  **20/20**, `verify:oracle-runtime` **22/22** — all driving the **real Java mock bridge**, no DB.
  Orphan-Java check clean.
- **Remaining (not yet done):** Phase 05 (Data Source UI), 06 (snapshot execution + atomic persist),
  08/09 (Oracle node + result mapping), 10 (wire the resolver/query-service into
  `resolveWorkflowDataSources`), 11 (extra hardening/observability), 12 (packaging + `OracleRuntimeResolver`
  checksum validation + `validate:offline`), 13 (tests + **real-Oracle external gate**), 14 (final
  report). (Merged to `main` 2026-07-17 via PR #11.)

## Splash hold-on-brief + concept-1c icon + simplified sidebar brand (2026-07-16)

- **Splash launch contract (revised):** the splash now always plays exactly ONE round and settles on
  the resolved frame that shows the app brief (`HOLD_T = 11.70s` in `app/renderer/splash.html` — the reel
  no longer loops). Then `app/main/main.ts` reveals the app at `max(one-round, ready-to-show)`:
  if the main window is ready by the time the round finishes it dissolves the splash immediately; if the
  app still needs time, the splash **holds on the brief frame and shows a small bottom-right spinner**
  (`window.__splashHold()`, triggered from main via `executeJavaScript` — the splash stays preload-free)
  until `ready-to-show`. A 30s hard cap prevents any hang. Constants: `ONE_ROUND_MS = 11_800`,
  `HARD_CAP_MS = 30_000`.
- **Application icon → concept "1c" (spectral edge):** `resources/icon-source.png` / `icon.png` / `icon.ico`
  regenerated (via `scripts/generate-app-icon.mjs`) from a near-black continuous-corner squircle with an
  off-white brick-form "S" whose trailing (bottom-left) brick carries a subtle blue→violet→pink spectrum
  gradient. Matches `UI Samples/Application icon design/Spectr Icon.dc.html` id 1c. Transparent corners,
  RGBA, all seven ICO frames valid.
- **Sidebar brand simplified:** `LeftNavigation.tsx` gained an inline `SpecterAppIcon` SVG (the same 1c
  mark, `useId`-namespaced defs) that replaces the old violet `Workflow` glyph in the brand tile, and the
  `Automation workbench` subtitle was removed so the brand shows **just the app icon + "SpecterStudio"**.
  New `.brand-app-icon` rule in `global.css`. The footer workspace chip and the top `AppFrame` wordmark are
  unchanged.
- **Validation:** `npm run build` passed (tsc + bundles; `splash.html` 20.12 kB). Verified by (1) rendering
  the built splash at the brief timestamp with the spinner shown (bundled-Chromium screenshot), (2) viewing
  `resources/icon.png`, and (3) launching the real Electron app and screen-capturing the running window —
  sidebar shows the new mark + "SpecterStudio" only, and the splash handed off cleanly ("Electron shell:
  Online", "IPC bridge: Connected"). **Not run:** packaged EXE rebuild (taskbar icon) / clean-machine
  walkthrough.

## Product rename → SpecterStudio (2026-07-16)

- **What:** the product/application identity was renamed from **WebFlow Studio** to **SpecterStudio**
  everywhere it is the app's own name — window/dialog/HTML titles, renderer UI (app frame, left nav,
  Settings "Application name"), packaging (`electron-builder.json` `productName` + `appId`
  `com.specterstudio.app`), npm `name`/`productName` in `package.json`(+lock), and every user-facing
  message string in `app/**` and `src/**` (IPC guards, `ProtectedLoginDetector`, `StepExecutor`,
  `urlPolicy`, `SessionCaptureService`, `ProjectContract`).
- **Runtime data root:** `RUNTIME_DATA_FOLDER` in `app/main/appPaths.ts` is now `"SpecterStudio"`, so data
  lives under `%LOCALAPPDATA%/SpecterStudio/`. The offline chain was kept consistent: `resources/
  dependency-manifest.json` (`application.name` + all `paths`), `resources/offline-runtime.json`,
  `src/offline/DependencyManifest.ts` validator, and both PS scripts (`generate-dependency-manifest.ps1`,
  `validate-offline-bundle.ps1`) all agree on `SpecterStudio` / `%LOCALAPPDATA%/SpecterStudio`. Seed/verify
  tooling that locates the runtime folder or packaged EXE was updated to match (`seed-mock-fixtures`,
  `seed-observability-fixtures`, `reset-ui-state`, `verify-instance-monitor-gui`, `verify-settings-
  persistence`, `verify-packaged-runtime`, `verify-packaged-walkthrough`, `packaged-process-tree`,
  `benchmark/electron-stub`).
- **Deliberately NOT changed:** the `window.playwrightFlowStudio` preload API identifier (internal
  contract), the `--awkit-*` CSS design tokens, the `AWKIT_*` env-var names / `awkitRssMb` data field
  (functional identifiers — only their user-facing display labels became "SpecterStudio"), the
  `playwright-flow-studio-offline-dependency-manifest` manifest *schema* name, and dated historical records
  (DECISIONS.md rename entry, `OFFLINE_STANDALONE_PACKAGING.md` + phase walkthroughs that reference the
  already-built `WebFlow Studio 0.1.0.exe`/`Setup` artifacts). Live project-identity files were updated
  (`README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/00-project.mdc`,
  `.cursor/rules/30-storage-ipc.mdc`, `ci.yml` comment).
- **Migration note:** existing installs keep data under the old `%LOCALAPPDATA%/WebFlow Studio/` folder; the
  renamed build reads/writes the new `SpecterStudio` folder and will not auto-migrate prior data.
- **Validation:** `npm run build` passed (tsc + bundles); `npm run validate:offline` passed (development
  mode, no failures) with the manifest name/path checks satisfied. **Not run:** packaged EXE/NSIS rebuild
  (artifacts would gain the new name) and clean-machine GUI walkthrough.

## Specter Studio launch splash screen (2026-07-16)

- **What:** an offline, frameless launch splash that recreates the reference "flexible logo" motion reel
  (`UI Samples/SplashScreen.mp4`) rebranded to **Specter Studio**. New file `app/renderer/splash.html` —
  fully self-contained (inline CSS+JS, canvas-rendered, CSP `default-src 'none'`, no remote assets/fonts).
- **Animation:** a single parametric layout (two display words, two modular grids, counter, tagline, body
  paragraph, credits) driven through scene keyframes on a **13.716667s loop** matching the source's beats:
  wide 10×3 Format A → collapse to a minimal 2×2 grid (~3s) → **isolated 2×2 pivots 90° clockwise through
  the 45° diamond and settles upright while type fades (~3–4.3s)** → portrait column (~5.4s) → wide
  snap-back 8×3 (~7.3s) → resolved layout with body copy fading in (~8.4–9s) → **dead-still hold ~9.8–11.7s**
  → loop wind-up → seamless return to Format A. Grid `cols/rows` interpolate via a rounded lerp to reproduce
  the responsive cell-count reflow; `pivotRotation(t)` handles the diamond spin; each word's baseline sits
  just above its grid. `window.__renderAt(t)` exposes deterministic rendering for frame extraction/compare.
- **Look:** strict high-contrast monochrome — crisp white grid + near-white uppercase wordmark
  (**SPECTER / STUDIO**) on the Hologram near-black `#0e1016`, with a **whisper** of project violet
  (subtle top-left `rgba(124,58,237,0.08)` radial glow + violet `1.0.7` counter).
  Copy, credits (Year 2026 / Mohammad Abwini / Arab Bank — Limited / Version 1.0.7), and the
  `VISUAL AUTOMATION PLATFORM` tagline are the user-supplied Specter Studio text.
- **Integration:** `windowManager.ts` adds `createSplashWindow()` (760×570, frameless, alwaysOnTop, no
  preload/node, `backgroundColor #0e1016`) and `fadeOutAndClose()`; `createMainWindow()` gained a
  `{ show }` option. `main.ts` shows the splash, boots the main window hidden, and on `ready-to-show`
  (min 2.4s display, 8s hard fallback) shows the main window and dissolves the splash. `splash.html` is a
  second renderer input in `electron.vite.config.ts` → builds to `out/renderer/splash.html`.
- **Validation:** `npm run build` passed (tsc + bundles; splash emitted at 17.36 kB, self-contained
  verified — no external `src`/`href`). Recreation validated by extracting the source clip's real frames
  (Playwright + bundled Chromium, `requestVideoFrameCallback`) and comparing side-by-side at matched
  timestamps. **Not run:** live packaged-EXE GUI launch walkthrough (no clean-machine run here).

## AWKIT application icon refresh — Specter segmented S (2026-07-16)

- **Design:** new transparent application icon under `logos/specter-violet/`; the selected Specter mark is
  a bold five-segment geometric S inside a restrained lavender ring. The front-facing 318/512px
  (**62.109%**) squircle uses the Hologram palette (`#0e1016`, `#7c3aed`, `#8b5cf6`, `#a78bfa`,
  `#f3f1f8`, `#f3f0ff`) with top-left glass sheen, internal violet bloom, dark corner depth, and no
  visible text or unrelated hues.
- **Production assets:** `resources/icon-source.png` is the square 1024px alpha source;
  `resources/icon.png` is the generated 1024px master; `resources/icon.ico` contains 32-bit-alpha frames
  at **256/128/64/48/32/24/16px**. Editable SVG, 16–2048px PNG exports, three concept directions,
  light/dark embedded-ICO size evidence, and a preview page live in `logos/specter-violet/`.
- **Exporter hardening:** `scripts/generate-app-icon.mjs` no longer uses `png-to-ico` 2.1.0. That packer
  excluded its AND-mask bytes from ICO entry lengths/offsets, allowing later directory entries to point
  into prior frame data. The script now writes standards-compliant PNG-compressed ICO entries directly
  and validates every frame's offset, dimensions, 32-bit declaration, RGBA color type, and PNG signature
  before writing.
- **Validation:** `npm run icon:generate` passed; all seven embedded ICO frames independently decode with
  RGBA alpha and transparent corners; SVG/XML and no-visible-text checks passed; true-size visual checks
  passed at 16–256px on light and dark backgrounds; `npm run build` passed;
  `npm run validate:offline` passed (development mode).

## Runtime Observability & Historical Analytics — full phase set (2026-07-16)

Extends the EXISTING durable telemetry stack (one SQLite store, one contract, one IPC surface) with a
complete observability/analytics layer — **no second database**. Report:
[`RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md`](RUNTIME_OBSERVABILITY_ANALYTICS_REPORT.md) (16 sections).

- **Data model (migration v4 `observability-analytics`, additive/nullable):** per-run dimensions
  (`headed`/`resourceProfile`/`isolationClass`/`workloadWeight`/`pressureStateAtRun`) + per-run
  ENVIRONMENTAL observation summary (`obs*` CPU/mem/Chromium-RSS/AWKIT-RSS mean/P95 over the run window —
  correlation, NOT per-workflow ownership under a shared pool); new bounded tables `runtime_capacity_buckets`,
  `runtime_admission_buckets`, `runtime_browser_lifecycle_buckets`, `runtime_anomalies`. v1/v2/v3 upgrade in
  place; pre-v4 rows read NULL.
- **Collection (reuses the existing ProcessTreeSampler tick — no new loop):** pure
  `RuntimeObservationCollector` accumulates per-run summaries + 30s capacity buckets
  (`AWKIT_OBSERVABILITY_BUCKET_MS`); normalized admission-delay reasons recorded from the REAL dispatch loop
  (`AdmissionReason` enum, single free-text→enum mapping); browser close-reason deltas. All best-effort —
  never fails a run. Node heap added to the sample.
- **Read models (store-side, windowed):** per-workflow historical stats + trend (hour/day/week auto) +
  run-vs-history + rankings (`observabilityAggregation.ts`); capacity/queue effectiveness
  (adaptive-target & capacity utilization, admission-reason breakdown, failure-at-pressure, pool
  effectiveness) — explainable, no opaque score.
- **Anomaly/regression (deterministic, no AI — `AnomalyDetector.ts`):** run-level vs 30-day history (min 8
  runs) + regression recent-7d-vs-prev-7d (min 10/window) with configurable thresholds, info/warning/critical,
  dedup/cooldown/recovery. Fired after each run finalizes + throttled regression per workflow.
- **UI (existing Runtime Analytics page, no redesign):** live Current-runtime strip + Capacity & queue
  effectiveness panel + Anomalies panel (token-only). 7 additive `telemetry:*` IPC channels + preload.
- **Retention (per-table):** raw samples 24h; observability buckets 14d; anomalies 90d (all env-tunable).
- **Verification:** `npm run build` clean; new **`verify:observability` 65/65**; `verify:telemetry` **61/61**
  (strengthened to assert v4 in-place upgrade); regression `verify:runner` 82/82, `verify:concurrency` 78/78,
  `verify:concurrency-defaults` 18/18, `verify:shared-browser-pool` 19/19, `verify:browser-isolation` 27/27;
  bounded Config-D real-engine soak (1.5 min) 299 completed / 0 failed / teardown CLEAN / durable=live MATCH.
- **Final production-validation (2026-07-16) — decision `PRODUCTION-CANDIDATE`** (report §17): controlled A/B
  overhead (`benchmark:observability-ab`, 3A+3B) → per-tick negligible (event-loop P95 +0.5 ms), throughput
  ~1.5–2.5 %, RSS unresolvable vs drift; **full 30-min soak** (`AWKIT_SOAK_MS=1800000`) 4661 completed / 0
  failed / teardown CLEAN / 4666 run-summaries==4666 terminal / leak-free (`soak-30min.json`); **storage/query**
  (`benchmark:observability-storage`, 5k/25k/50k) ~465 B/run, ~3.1 MB/day uncapped (retention-bounded), analytics
  queries tens-to-~500 ms (NOT sub-ms), retention boundaries validated; **UI walkthrough**
  `verify:runtime-analytics-gui` **36/36** across normal/empty/migration/high-data (real `out/` Electron, 7 IPC
  channels + malformed inputs, screenshots). Corrected the report's overhead/query/storage/"Experimental: none"
  claims. Fixed 2 soak-harness accounting bugs (cancelled-run count; NaN event-loop peak). **Remaining gate:**
  fresh packaged-EXE build + walkthrough on a higher-memory host (dist/ EXE is pre-observability; re-package OOMs).

## Concurrency closing task — enforced pool→A8 dependency + proven durable root cause (2026-07-15)

Closes the three remaining concurrency validation gaps. Report: [`EXECUTION_ENGINE_CAPACITY_REPORT.md`](EXECUTION_ENGINE_CAPACITY_REPORT.md)
§13–§20. Changes are **not committed** (GitHub intentionally untouched).

- **Shared-Pool → A8 dependency now ENFORCED (`ConcurrencyConfig.ts`):** this was a genuine gap — an explicit
  `AWKIT_WORKLOAD_WEIGHTS=true` could still recreate the harmful Config C while the pool was OFF. New
  `resolveWeightedAdmission` forces weights OFF whenever the pool is OFF (even when explicitly requested) and
  emits one searchable diagnostic (`AWKIT_WORKLOAD_WEIGHTS=true ignored because Shared Browser Pool is
  disabled…`). `weights=false` while the pool is ON is still honoured. Enforced on the final merged values —
  the single place the app resolves pool/weights. `verify:concurrency-defaults` **18/18** (was 12/12).
- **Durable `~3822 vs 495` root cause PROVEN (not "likely"):** `SqliteRuntimeStore.queryRunHistory` hard-clamps
  a page to `Math.min(500, …)`; the soak counted `rows` of one `{ limit: 200000 }` page (≤500) against a live
  in-memory counter (~3822). NOT lost/unflushed/pruned/overwritten writes (in-memory sql.js is synchronous; a
  reopened on-disk store returns every row; retention 5000 never triggered; `instanceId` is the PRIMARY KEY).
- **Read-model hardened:** added `countRunsByStatus` (unbounded `GROUP BY status` aggregate) + keyed `getRun`
  to the store; `queryOverview` counts now use the aggregate (was a ≤5000 materialized read — latent under-count
  once >5000 runs land in a window); `getTelemetryRunDetail` uses `getRun`; new `getTelemetryStatusCounts` +
  `persistDurableNow`; benchmark harness/soak paginate via `readAllRunHistory` (live-vs-durable reconciliation
  logged). No UI redesign.
- **Durable accuracy verifier (`verify:durable-accuracy`, N=600):** real engine, 600 OK + 40 fail + 40 cancelled,
  explicit drain. **27/27** — submitted 680 = 600+40+40; expected persisted 648 = actual 648; clamp reproduced
  (500 < 648); no dup/missing IDs; disk-reopen sees all; retention deterministic. Artifact
  `reports/browser-performance/durable-accuracy.json`.
- **Verification:** build ✅; `verify:concurrency-defaults` 18/18, `verify:telemetry` 61/61 (new Part I),
  `verify:durable-accuracy` 27/27, `verify:concurrency` 78/78, `verify:runner` 82/82,
  `verify:shared-browser-pool` 19/19, `verify:browser-isolation` 27/27.

## Shared pool + A8 ON by default, reserve-formula change, close-reason telemetry, 30-min soak (2026-07-15)

Follow-up to the capacity benchmark below — applies the measured recommendation and resolves four completion
items. Report: [`EXECUTION_ENGINE_CAPACITY_REPORT.md`](EXECUTION_ENGINE_CAPACITY_REPORT.md).

- **Production defaults flipped (`ConcurrencyConfig.ts`):** `useSharedBrowserPool` now defaults **ON**;
  `workloadWeights` defaults to the **resolved pool state** (ON with the pool, never independently — Config C
  is harmful). Explicit `AWKIT_SHARED_BROWSER_POOL` / `AWKIT_WORKLOAD_WEIGHTS` env always win. Proven by
  `verify:concurrency-defaults` (12/12).
- **CapacityPlanner memory reserve changed (Model C):** a replay across 4–128 GB × low/med/high pressure
  (`benchmark:capacity-reserve`) showed the old formula double-counted the OS (%-of-total subtracted from
  already-current available) → a 128 GB host with 23 GB free got usable=0 / capacity 1. Now the OS reserve is
  a **ceiling** (`min(available, total−OS%)`), plus an absolute 1024 MB app baseline + a bounded machine-
  relative growth reserve + a safety cushion off available. Small/pressured machines unchanged (still floor to
  1). `verify:capacity-planner` 35/35 (added anti-pathology + `usable ≤ available` checks).
- **Browser close-reason telemetry (`SharedBrowserPool`):** every retirement is now attributed to an exact
  reason (`CONTEXT_COUNT_RECYCLE | MEMORY_THRESHOLD | IDLE_DRAIN | UNHEALTHY | CRASH | POOL_SHUTDOWN |
  LAUNCH_FAILURE | OTHER`), exposed on the snapshot as `closeReasons` + `launchFailures`. Resolves the report
  contradiction: soak relaunches are routine `CONTEXT_COUNT_RECYCLE` + `IDLE_DRAIN`, `MEMORY_THRESHOLD`=0
  (memory recycling stays inert — no PID on Playwright 1.61).
- **30-min soak (Config D, MIXED, conc 6):** ≈3822 completed (~127/min), 0 failed / 0 retries / 0 crashes;
  JS heap flat (172→170 MB), handles flat, browsers/contexts bounded (≤4/≤5); AWKIT RSS mild +55 MB native
  drift (bounded); 80 relaunched = 80 closed, all `CONTEXT_COUNT_RECYCLE`(77)+`IDLE_DRAIN`(3),
  `MEMORY_THRESHOLD`=0; teardown **CLEAN** (active/leased/stale/orphan-contexts/orphan-pages/orphan-Chromium
  all 0). Leak-free by the load-bearing signals (report §9).
- **Headed Production Anchor (Phase 01, `benchmark:engine-headed`):** headed Config A vs D at F=6, 50 s each,
  real ExecutionEngine. D beats A by **+122 % throughput** (116.6 vs 52.5/min), **−63.5 % P95 duration**
  (2394 vs 6554 ms), **−16 % CPU P95** (83.8 vs 99.7 — A pins the CPU with 6 dedicated headed browsers), and
  **−52 % RSS peak** (1065 vs 2215 MB); median Chromium RSS +4.9 % (a wash). 0 failures/crashes, teardown
  clean both. **Confirms the pool + A8 defaults — the win is larger headed than headless.**
- **Verification:** `npm run build` clean; concurrency-defaults 12/12, capacity-planner 35/35, capacity-modes
  10/10, machine-capabilities 20/20, benchmark-planner 36/36, shared-browser-pool 19/19, browser-isolation
  27/27, runner 82/82, concurrency 78/78, shared-browser-live 5/5.

## Real-ExecutionEngine capacity benchmark + shared-pool race fix + Phase 6–10 (2026-07-15)

Drove real workflow instances through the full `ExecutionEngine.startRun` dispatch path (queue → adaptive →
backpressure → weighted admission → limiters → worker pool → isolation resolver → `BrowserContextFactory` →
`SharedBrowserPool` → `PlaywrightRunner`) under sustained concurrent load — the first benchmark that exercises
the **complete production scheduler**, not just the context factory. Full write-up:
[`docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md`](EXECUTION_ENGINE_CAPACITY_REPORT.md).

- **Real defect found + fixed (SharedBrowserPool):** a check-then-act race in `selectOrLaunch` (read count →
  `await launch()` → register) over-launched browsers under concurrent dispatch (`maxBrowsers=2, conc=6` → 6
  browsers). Fixed by reserving the browser+context slot **atomically under the pool mutex**, creating the
  context outside the lock, rolling back on failure. Peak browsers 6 → 2; guarded by a new regression test.
  The prior context-factory benchmark created contexts serially and never hit it — only the real engine did.
- **A/B/C/D result (MIXED, 45 s holds):** at equal load (F=6) Config D (pool ON + A8 weights ON) vs baseline A:
  Chromium procs −50 % (10 vs 20), RSS −56 % (727 vs 1656 MB), throughput +12.7 %, P95 duration −34 %; and
  **stable concurrency +50 %** (D=9 vs A=6, 0 failures through F=9). Weighting-ALONE (C) is a net negative
  (stable drops to 3) — it only pays off *with* the pool.
- **Phase 6 weight calibration:** the WAITING workflow runs 5.3× longer than LIGHT but uses ~0 CPU and less
  RAM → the feature-based (duration-agnostic) weight correctly does not over-charge it. Weight seeds kept
  unchanged (validated, not inaccurate); phase-aware weighting deliberately NOT added (no measured value).
- **Phase 7 CapacityPlanner:** the fixed 1024 MB AWKIT reserve is correct precisely because it's absolute (app
  footprint is machine-independent) and already complemented by 20 % OS + 10 % safety percentage reserves that
  scale with the machine. Formula reviewed, documented, unchanged.
- **Phase 8 browser memory recycling:** fully wired (`SharedBrowserPool.applyMemorySamples` moving-window
  drain + `BrowserProcessSampler` Windows subtree walk + throttled engine evaluator) but **inert on this
  stack** — Playwright 1.61's launched `Browser` exposes no `process()`, so no per-browser root PID → empty
  samples → no-op. Kept wired + documented per the task's "disable-with-evidence" instruction; lights up
  unchanged if a PID-bearing launch path appears. Default path unaffected.
- **Phase 9 soak (Config D, MIXED, 10 min local):** 497 completed / 0 failed / 0 retries; Chromium RSS
  1082→558 MB (−48 %), AWKIT RSS 232→228 MB (flat), heap 125→137 MB; shared browsers steady at 3–4;
  teardown **CLEAN** (active=0, leased=0, stale=0, orphan contexts/pages=0). Leak-free under real sustained load.
- **Recommendation (Phase 10):** enable BOTH the shared pool and A8 weighted admission by default (Config D);
  never weighting-only. Shipped default flags left unchanged pending owner sign-off (one-line follow-up).
- **Verification:** `npm run build` clean; `verify:shared-browser-pool` 19/19 (new race regression),
  `verify:browser-isolation` 27/27, `verify:runner` 82/82, `verify:concurrency` 78/78.

## Shared-browser capacity — authoritative isolation resolver + launch-arg-aware compatibility key (2026-07-15)

Hardens the A5 shared Chromium pool so it can be enabled safely for higher concurrency. **No default-path
behaviour change** (shared pool stays flag-OFF; `balanced` profile → one stable compatibility key → sharing
is byte-for-byte as before). Proven from code + runtime before touching anything; A5 reused, not rewritten.

- **Traced + confirmed A5:** `execution.ipc → ExecutionEngine.processQueue (500 ms dispatch tick) →
  AdaptiveController (A7, hysteresis) + BackpressureController + [A8 weighted] admission → isSharedEligible?
  `acquireContextSlot` (virtual, bounded by `maxActiveFlows`) : `tryAcquireSlot` (real browser semaphore) →
  PlaywrightRunner → BrowserContextFactory.create`. A5 leases a **fresh isolated `BrowserContext` per
  instance** on a shared `Browser`, spreads across browsers before packing (crash isolation), drops crashed
  browsers on `disconnected`, recycles after N contexts (drain→close), `drainIdle` at run end. Dynamic
  machine-aware admission (A7), workload cost (A8), and the machine-aware memory reserve (A2 `CapacityPlanner`)
  already exist — the task's Phases 7–13 were largely present.
- **Gap fixed (latent correctness):** the shared launch key was only `browser:headed/headless`, ignoring the
  per-instance resolved `launchArgOverrides`. With the pool ON **and** a non-`balanced` profile, instances
  with divergent launch flags (gpu/webgl/cache / throttle drops) could reuse one browser carrying only the
  first leaser's flags. Now closed.
- **New (`src/runner/browser/BrowserIsolationResolver.ts`):** THE authoritative resolver — classifies every
  instance into `SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER` with a
  `{decision,value,source}` diagnostic per rule (precedence: persistent profile > mid-run browser swap >
  shared-flag > catch-all dedicated), plus `sharedCompatibilityKey(config, launchArgOverrides)` folding the
  **browser-level** launch config (headed/headless + resolved launch-arg deltas) into the key. Context-level
  options (viewport, device scale, storageState, request routing) stay isolated per `BrowserContext` and are
  deliberately excluded. Delimited + collision-safe, no hash dependency; pure/framework-agnostic.
- **Wiring:** `browserSharing.isSharedEligible` delegates to the resolver (single source of truth — the
  dispatch loop and the factory can't drift); `BrowserContextFactory` shared launcher keys on
  `sharedCompatibilityKey(config, launchArgOverrides)` so incompatible launch configs get their own process;
  `ExecutionEngine.runInstanceInner` logs the isolation class + diagnostics **only when the shared pool is
  enabled** (silent on the default path). `sharedLaunchKey` kept as a legacy human-readable diagnostic.
- **Verified (no regression):** `npm run build` clean; new `verify:browser-isolation` **27/27** (four-class
  classification, precedence, shareability, `isSharedEligible` parity, key folds launch args but NOT
  context-level diffs, pool honours the key); `verify:shared-browser-pool` **18/18**,
  `verify:shared-browser-live` **5/5** (real Chromium — 4 contexts on 2 processes preserved), `verify:runner`
  **82/82**, `verify:concurrency` **78/78**, `verify:workload-weights` **53/53**, `verify:resource-routing`
  **42/42**, `verify:chromium-hardening` **13/13**, `verify:browser-resource-profile` **51/51**,
  `verify:adaptive-concurrency` **14/14**, `verify:operation-limiters` **10/10**, `verify:telemetry` **54/54**.
- **Measured (new `benchmark:shared-pool`, drives the REAL factory + pool, headless, i7/12c/16GB):** Model A
  browser-per-workflow vs Model B shared browser + one isolated context each, subtree process/RSS medians,
  per-context cookie isolation held in every cell. Sharing kicks in above `maxBrowsers` (spread-first keeps
  ≤ N dedicated at low N): **N=4 → −37.5% processes / −27% RSS** (16→10 procs, 906→661 MB); **N=8 → −56%
  processes / −39% RSS** (32→14 procs, 1807→1108 MB). The saving is **RAM + process count**, not CPU
  (per-page render CPU is unchanged by process sharing) — so the pool raises the *memory-bound* ceiling.
- **Baseline `benchmark:concurrency` (this machine, competing load, one-browser-per-instance — flag inert
  here):** highest sustainable **7**, production-approved **5**, stop at 8 on **P95 CPU 96.5% > 95%** (i.e.
  this machine is CPU-bound, so the pool's RAM saving wouldn't lift *this* stop; it lifts RAM-bound hosts).
- **Not done / external gate:** the shared pool remains **default OFF** (owner decision D4). A full flag-ON
  run *through `ExecutionEngine` dispatch* under sustained load on a clean machine + the default flip are the
  remaining gate; the factory+pool lease itself is now measured. Reuse Session / Auto Secure Login / Manual
  Handoff / persistent-profile / popup / parallel-isolated-page behaviour is unchanged.

## Browser Resource Optimization — deep benchmark evidence + throttling removed (2026-07-15)

Follow-up to the profile/resolver work below: 20/20/15-rep experiments replaced the initial 3-rep run and
**corrected the headline**. Harness: `scripts/benchmark/lib.mts` + `benchmark-workloads.mts` /
`benchmark-ablation.mts` / `benchmark-occlusion.mts` (full mean/median/p95/max/stddev; server-side network;
Win32 subtree CPU/RAM). Details + tables in `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md` §7.

- **Occlusion (20 reps, genuinely minimized headed window + background tab):** re-enabling the 3 Playwright
  background-throttle switches (individually + combined, via selective `ignoreDefaultArgs`) gives **no CPU
  reduction** — minimizing already floors CPU at ~1.5% (compositor stops frames, rAF 60→1/s) and page timers
  never throttle because Playwright keeps automated pages `visibilityState:visible`. Behaviour 100%
  (waitForResponse/popup/click/timers). **→ Removed background throttling from the low-resource default**
  (`BrowserResourceProfile.ts` low-resource `backgroundThrottling.enabled=false`); mechanism kept for
  `custom`. Verifier updated (now asserts low-resource does NOT re-enable throttling + a Custom-throttling
  mechanism test) → `verify:browser-resource-profile` **51/51**.
- **Ablation (20 reps, image-heavy):** the profile's RAM/network win is **almost entirely image blocking**
  (−5.98% RAM, −98.95% network); fonts add ~0.7%; media/analytics/reduced-motion/SW/device-scale/throttling
  are within noise. COMBINED low-resource ≈ image-blocking alone.
- **Workload matrix (15 reps, Balanced vs Low-Resource, 8 workloads):** RAM saving is **workload-dependent**
  — image-heavy pages −7…13% (multitab −12.7%, image-heavy −7.3%, spa −4.7%), image-light ~0% (form/table).
  Network −~99% wherever sub-resources exist. **Duration unchanged; behaviour 100%** (download/popup/multitab/
  form all pass under Low-Resource — capability overrides validated live).
- **Correction:** the earlier **21% RAM was 3-rep noise**; stable figure is ~6% (image-heavy) and workload-
  dependent. The big reliable win is **network (~99%)**, not RAM/CPU.
- **Recommendation:** keep `balanced` default; use `low-resource` for unattended/image-heavy runs (safe,
  capability-guarded). Multi-instance RAM estimate ~24–45 MB/instance on image-heavy (LABELLED estimate —
  not multi-instance-benchmarked). Full 11-point recommendation in the doc §9.
- **Verified (no regression):** build clean; `verify:browser-resource-profile` 51/51, `verify:runner` 82/82,
  `verify:chromium-hardening` 13/13, `verify:lean-mode` 12/12, `verify:resource-routing` 42/42,
  `verify:concurrency` 78/78, `verify:workload-weights` 53/53, `verify:telemetry` 54/54. Artifacts in
  `reports/browser-performance/` (workloads.json, ablation.json, occlusion.json + logs).

## Browser Resource Optimization — per-instance Chromium profiles + authoritative resolver (2026-07-15)

Reduces the CPU/RAM/network/disk cost of ONE running Chromium automation instance while preserving
workflow behaviour. **Default is `balanced` == today's exact behaviour** (proven byte-for-byte); every
optimization is additive, env-gated, and relaxed by workflow capabilities so it can't break a run. See
`docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md` for the full lifecycle trace, launch audit, and benchmark.

- **New pure core (`src/runner/browserProfile/`):** `BrowserResourceProfile.ts` (declarative profile +
  4 presets: maximum-compatibility / balanced / low-resource / custom; maps blocking onto the existing
  `ResourceProfile` — no duplication), `WorkflowCapabilities.ts` (static analysis reusing
  `WorkloadWeights.extractWorkloadFeatures` — needsImages/downloads/serviceWorkers/multiplePages/…; hint
  escape hatches; capabilities only ever RELAX), `BrowserRuntimeConfigurationResolver.ts` (THE authoritative
  resolver — deterministic, records a `{setting,value,source}` diagnostic per decision, `explainResolution`),
  `resolveForRun.ts` (env entry, default balanced).
- **Wiring (default-preserving):** `BrowserContextFactory` gained `launchArgOverrides` (extra switches +
  selective `ignoreDefaultArgs`, NEVER `true`); `ChromiumHardening.buildChromiumHardeningArgs` gained
  `omitBackgroundTimerThrottlePin` so low-resource can RE-ENABLE Chromium background throttling (drops the
  pin + Playwright's 3 throttle switches); `PlaywrightRunner` threads `traceMode`/`resourceRouting`;
  `ExecutionEngine.runInstance` resolves once per instance (machine-aware) and logs non-default resolutions.
- **low-resource profile:** lean routing (image/media/font) + analytics-host URL blocking + block service
  workers + reduced motion + device-scale 1 + background throttling ON + production artifacts (trace off) +
  bounded 64 MB disk cache + page cleanup. Selected via `AWKIT_BROWSER_RESOURCE_PROFILE` (default balanced).
- **Measurement fix:** `ProcessTreeSampler` now also counts `chrome-headless-shell.exe` (Playwright's
  headless binary) — the Chrome Consumption dashboard previously undercounted headless instances.
- **Benchmark (`npm run benchmark:browser-resource`, `scripts/benchmark-browser-resource.mts`):** one
  instance, resolver-derived options, blank→navigate→idle→form, server-side network bytes + Chromium-subtree
  RAM/CPU, 3 reps. On i7-8750H/12c/16GB, low-resource vs balanced: **network −100% bytes / −96.8% req**;
  RAM **−8% avg headless**, **−21% avg headed** (headed holds decoded image bitmaps in the compositor — and
  headed is AWKIT's default run mode); navigate CPU −20.6% headless. CPU is a wash overall (rAF canvas +
  compositor dominate; a single foreground window/page is never background-throttled). Artifacts in
  `reports/browser-performance/` (+ `*.headed.json`).
- **Verified:** `npm run build` clean; new `verify:browser-resource-profile` **49/49** (balanced==today
  invariant, capability relaxations, throttle-pin toggle, mode parsing); regression `verify:runner` **82/82**,
  `verify:chromium-hardening` **13/13**, `verify:lean-mode` **12/12**, `verify:resource-routing` **42/42**,
  `verify:concurrency` **78/78**, `verify:workload-weights` **53/53**, `verify:telemetry` **54/54**.
- **Not done / follow-ups:** headed/occluded throttling win not yet measured (display-dependent);
  GPU/WebGL/renderer-limit stay Custom-only pending clean-machine benchmark; Settings UI + per-workflow
  `WorkflowProfile` capability hints (env hints exist today); adopting low-resource as default is an owner
  decision needing the headed benchmark.

## Workflows library + Workflow Builder header/toolbar cleanup (2026-07-14)

- **Create Workflow now names-then-opens (points 6/7).** Both the Workflows library **Create Workflow**
  buttons and the Workflow Builder toolbar **New** (`#sb-new`) open the shared `PromptDialog` for a name,
  then persist a Start→End workflow via the new `createBlankWorkflowProfile(name)` factory
  (`src/profiles/WorkflowProfile.ts`) and open it in the builder (library navigates with
  `selectedBuilderWorkflowId`; the builder loads it in place via `createNamedWorkflow`). One source of truth
  for the blank scaffold shared by both entry points.
- **Workflow Builder header** (`ScenarioBuilder.tsx` `usePageChrome`) now exposes **only Save** — New and
  Run removed; the dead `runWorkflow` handler was deleted. The toolbar **Reload** button, **Mode** select,
  and **Parallel** input are `disabled` (kept visible for context).
- **Workflows table** (`WorkflowsLibrary.tsx`) is one line per row: the **Max Parallel** column
  (header/body/colgroup + adapter accessor + its two advanced-filter fields) and the grey `<small>{id}</small>`
  sub-line are gone; every cell clips to one line with the full value in a `title` tooltip
  (`.wl-table-workflows` token CSS). Per-row action buttons collapsed into a single `.wl-kebab`
  (`MoreVertical`) that opens the existing `NodeOptionsMenu` — Open in Builder / Clone / Export JSON /
  Delete (danger). Delete now confirms through `ConfirmDialog` instead of the old inline Confirm/Cancel.
- **Verification:** `npm run build` clean (tsc + 3 bundles); `verify:workflow-builder` **20/20** (section 3
  updated to drive the New name modal); throwaway `_electron` Workflows-library walkthrough **7/7** (no Max
  Parallel header, no id sub-line, single kebab per row → 4-action menu, Create opens the modal, no console
  errors). `verify:workflow-builder` now leaves one blank "GUI New …" workflow per run (New persists by
  design).

## New Flow now names-then-opens in the Flow Designer (2026-07-14)

- **Change:** the **New Flow** action on the Flows page (`FlowLibrary.tsx`) no longer silently creates a
  flow literally named "New Flow" and leaves the user on the library. All three triggers (page-chrome
  action, toolbar button, empty-state button) now open a name-input dialog first.
- **Dialog:** new reusable `app/renderer/components/shared/PromptDialog.tsx` — single-field, app-styled
  modal reusing the `.modal-overlay`/`.modal-dialog` shell. Autofocuses + selects the field, Enter
  confirms, Escape/overlay cancels, and the Create button stays disabled until the name has
  non-whitespace content. Token-only CSS added (`.modal-icon.create`, `.modal-field`) — no hardcoded
  hex/px.
- **After confirm:** `createFlow(name)` creates the flow with the entered name and the unchanged
  Start→End scaffold (only a `start` and `end` node + one `always` edge), then reuses `openFlow(profile)`
  to persist `lastSelectedFlowId` and navigate to `flowChart`, so the flow opens immediately in the
  Flow Designer.
- **Verification:** `npm run build` clean (tsc + 3 bundles). Live GUI walkthrough not run (the Electron
  renderer can't be driven from the Browser pane; `window.playwrightFlowStudio` IPC is absent there).

## Security-audit hardening — all findings fixed (2026-07-14)

Full security audit (`docs/security/FULL_SECURITY_AUDIT.md`) plus remediation of every finding. **No
runtime contract/route/schema change; behavior tightened at existing sinks.** New helpers:
`src/runner/urlPolicy.ts` (navigation allowlist), `src/utils/pathSafety.ts` (`isPathInside`),
`app/main/ipc/senderGuard.ts` (`assertTrustedSender`), `src/profiles/FlowValidation.ts`
(`normalizeFlowBounds`).

- **Navigation (F-02):** `page.goto`/`routeChange` now go through `assertNavigableUrl` — `file:`/`chrome*`/
  `devtools:`/`javascript:` blocked; http(s)/about/data allowed (internal/localhost still allowed).
- **Upload (F-01):** `StepExecutor.assertUploadAllowed` blocks `setInputFiles` into AWKIT sessions/logs/
  reports/screenshots/traces (+ traversal); general user files still uploadable.
- **Workflow bounds (F-03):** `normalizeFlowBounds` clamps timeouts/retries/loop iterations + caps
  alternatives/waits arrays at `FlowExecutor.executeFlow` (lenient — legacy flows still load).
- **Filesystem (F-04/F-05):** data-source writes confined to the workspace; `saveSession` folder confined
  to the sessions root; `system:openPath` confined to app data folders + executable-extension block.
- **Electron (F-06/F-09):** `will-navigate`/`will-redirect` lockdown; `assertTrustedSender` on
  `execution:runWorkflow`, `dataSources:writeJson/createFromScratch`, `session:startCapture`,
  `system:openPath`.
- **Recorder (F-07):** value redaction extended to OTP/one-time-code/card/CVV/PIN/SSN/token fields.
- **Downloads (F-08) / session capture (F-11):** site-suggested filenames sanitized; capture rejects
  non-http(s) targets.
- **Secret store (§15):** DPAPI-backed encrypted local secret store (`src/secrets/SecretStore.ts` +
  `app/main/secretStore.ts` via Electron `safeStorage`; `secrets.ipc.ts` manages by NAME only — no channel
  returns a value). Steps reference secrets by name (`valueSource.type = "secret"`); the runner resolves them
  per-run in the main process (`ExecutionEngine.setSecretResolver` → `InstanceExecutionContext.secrets`) and
  masks the literals in logs/reports. Managed from **Settings → Secrets** (add/update/delete, keystore-
  unavailable banner). Keeps credentials out of workflow JSON and `.env`.
- **Data-source read (§14):** every JSON data-source read goes through `readJsonFileGuarded`
  (`dataSource.ipc.ts`) — a 25 MB size cap + `isReadableDataSourceFile` (`src/utils/pathSafety.ts`) that
  refuses runtime-internal files (sessions/profiles/secret store/logs/reports) while allowing external user
  files and the workspace.
- **Verified:** `npm run build` clean; `verify:security` **39/39** (incl. data-source read confinement),
  `verify:secrets` **16/16**; regression `verify:runner` **82/82**, `verify:recorder` **72/72**,
  `verify:ipc-contract` **4/4** (129 handlers), `verify:data-editor` **27/27**, `verify:waits` **21/21**,
  `verify:protected-login` **16/16** + **34/34**. Settings → Secrets card verified in a token-faithful HTML
  harness (light + dark, no horizontal overflow). (Stale note corrected 2026-07-17: this work **is**
  committed — see `c99eaea` "feat: DPAPI secret store + IPC/security-audit hardening".)
- **Residual (P2):** `assertTrustedSender` is applied globally via `installGlobalSenderGuard`; optional
  `sandbox:true` still deferred (ESM-preload-under-sandbox). Remaining audit follow-ups: code signing (§20),
  offline hash validation (§19), artifact retention (§22).

## Custom AWKIT application frame (2026-07-14)

The main window is **frameless** (`windowManager.ts` `frame: false`, security prefs unchanged) with an
application-owned title bar. `AppShell` wraps the shell in `.app-window` and renders `layout/AppFrame.tsx`
(brand mark + wordmark + active-area context, draggable via `-webkit-app-region: drag`, double-click →
maximize toggle) above `layout/WindowControls.tsx` (minimize / maximize↔restore / close; icon + aria label
follow the **real** window state). Window ops go through a minimal preload `appWindow` domain
(minimize/toggleMaximize/close/isMaximized + `onMaximizedChange`) backed by `ipc/window.ipc.ts`
(`registerWindowIpc`, sender-scoped, multi-window-safe); the main process pushes `window:maximizedChanged`
on maximize/unmaximize/full-screen so the control never drifts. Layout: `--titlebar-height: 36px` is folded
into `--shell-chrome`, and `.app-shell`/`.left-navigation`/legacy `calc(100vh - …)` designer heights subtract
it, so canvas sizing is unchanged (`verify:flow-designer` 24/24, `verify:canvas-perf` 13/13). Frame styling is
token-only, theme-aware, hover gated to fine pointers, close-hover = danger, press feedback instant
(`review-animations` → Approve). Playwright automation browsers are unaffected.


**Last updated:** 2026-07-15 (Claude — Browser Resource Optimization: per-instance Chromium profiles
(maximum-compatibility / balanced / low-resource / custom) + workflow-capability guards + one authoritative
`BrowserRuntimeConfigurationResolver`; default balanced == today; measured network −100%/RAM −8%/navigate
CPU −20.6% on low-resource. See the top section + `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`. Prior:
custom AWKIT application frame: native window frame removed,
app-owned title bar + secure window-control IPC; see the section directly below. Prior:
Concurrency Capacity plan: PR-CAP-1 [A1–A4] + shared browser
pool [A5, flag-guarded] + operation limiters [A6] + adaptive controller [A7] + workload weights
[A8, flag-guarded] + resource-reduction profiles [A9] + machine-relative benchmark harness [A10] landed.
Concurrency workstream A complete; reporting workstream B complete — B1 read-model + B2 IPC + B3
comparison UI + B4 live-vs-history run card all landed.)

## Live-vs-history on the execution report — plan phase B4 (2026-07-13)

The per-instance **Execution Report** (opened from Instance Monitor) now shows the run's elapsed time
against the workflow's historical **per-run** avg/p95, scoped to the current machine. Renderer + verifier
only — consumes the existing B2 telemetry channels; no IPC/preload/schema/InstanceMonitor change.

- **Pure helper (`components/instances/executionReportModel.ts`):** `compareElapsedToHistory(elapsedMs,
  baseline, live)` → `{ tone, label }`. Live runs (partial elapsed) only flag once over avg (`"N% over
  avg"`) and otherwise report progress (`"at N% of avg"`); finished runs report the final over/under
  (`"N% faster/slower than avg"`, `"about average"` within ±5%). Returns undefined with no usable baseline.
  New `WorkflowHistoryBaseline`/`HistoryComparison` types.
- **Modal (`components/instances/LiveExecutionReportModal.tsx`):** fetches the workflow's baseline once via
  `telemetry.workflowComparison("all", { machineId })` (machineId from `system.capacityPreview`), **falling
  back to all-machines** when the current machine has no history (e.g. only pre-v3 runs). The elapsed is
  compared apples-to-apples (single-instance elapsed vs per-run history). Shows a `vs history: avg … · p95 …`
  banner line with a tone chip (`ahead`/`behind`/`neutral`) + scope/run-count caption, and `History avg` /
  `History p95` stat cards + a delta hint on the Elapsed card.
- **Styling (`global.css`):** `.report-history-vs`, `.report-vs-chip.tone-{ahead,behind,neutral}` (token-only).
- **Verified:** `npm run build` clean; `verify:instance-monitor` **43/43** (adds 8 `compareElapsedToHistory`
  cases: no/zero baseline, live under/over avg, finished faster/slower, ±5% about-average); real Electron
  capture (3-run history) showed the machine-scoped `vs history: avg 4s · p95 4s · 18% slower than avg ·
  this machine · 3 runs` line + stat cards with **0 console errors**; `verify:instance-monitor-gui` **12/12**
  (real 4-instance run, no renderer errors).
- **Note:** the baseline is blank for a workflow with no completed runs on the current machine (and, absent
  any history at all, hidden entirely).

## Workflow Reports comparison UI + machine filters — plan phase B3 (2026-07-13)

Surfaces the B1/B2 machine-aware read-model in the renderer. Renderer + verifier only — no route, IPC,
preload, runner, or schema change (consumes the B2 channels that already existed).

- **UI (`app/renderer/pages/ReportsWorkflows.tsx`):** the Workflow Reports table now loads
  `telemetry.workflowComparison(range, machineFilter)` (was `telemetry.workflows`), so each row carries its
  **previous-window comparison**. New per-metric **delta chips** (▲/▼ vs the previous window) on Runs /
  Success / Avg / p95, colored by *goodness* (higher success = green, lower duration = green; Runs is
  neutral); a **trend glyph** (up/down/flat/`new`) beside the workflow name; a per-row **success-rate
  sparkline** (lazily queries `telemetry.workflowTrend` per workflow, reusing `MetricSparkline`); and a
  compact **machine-context caption** (mode · pool · class · cores · short machineId) under each name when
  the run carried machine context (NULL for pre-v3 runs).
- **Machine filter bar:** Machine / Mode / Browsers (pool) / Workload selects, options built from
  `telemetry.machines(range)`; a "This machine" shortcut resolved from `system.capacityPreview()`
  (`capabilities.machineId`). Filters flow into the comparison, trend, and recent-runs queries so a
  cross-machine set is never silently averaged.
- **Compare mode:** a toggle adds a checkbox column; picking 2–4 workflows renders a side-by-side card grid
  (per-workflow sparkline + Runs/Success/Avg/p95 with the same delta chips + machine context).
- **Styling (`global.css`):** new token-only classes (`.awkit-report-filters`, `.awkit-filter-field/-toggle`,
  `.awkit-delta-chip.is-{up,down,neutral}`, `.awkit-trend-{up,down,flat}`, `.awkit-trend-badge.is-new`,
  `.awkit-wf-name/-machine`, `.awkit-compare-grid/-card/-stats`, select/checkbox cells); new columns stay
  inside `.awkit-table-wrap`; `prefers-reduced-motion` honored.
- **Verified:** `npm run build` clean; `verify:reports` (GUI) **31/31** (adds filter-bar renders 4 selects,
  filter select interactive + page stable, Compare toggle present/clickable + valid post-toggle state, no
  telemetry/undefined console errors); real Electron capture visually confirmed delta chips + sparkline +
  trend glyph render with live data. Regression `verify:ipc-contract` **4/4**, `verify:telemetry` **54/54**.
- **Not yet done:** B4 (optional live-vs-history on the Instance Monitor run card). Machine-context captions
  stay blank until v3 runs accrue (historical runs predate the machine columns).

## Machine-aware report IPC + preload — plan phase B2 (2026-07-13)

Exposes the B1 read-model to the renderer. Additive channels only; existing telemetry channels untouched.

- **IPC (`telemetry.ipc.ts`):** new `telemetry:workflowComparison(preset, machineFilter?)`,
  `telemetry:workflowTrend(scenarioId, preset, machineFilter?)` (bucket count derived per preset via
  `trendBucketsForPreset`), and `telemetry:machines(preset)` → delegate to new
  `ExecutionEngine.getTelemetryWorkflowComparison` / `getTelemetryWorkflowTrend` / `getTelemetryMachines`.
- **Preload (`preload.ts`):** `telemetry.workflowComparison` / `workflowTrend` / `machines` exposed on the
  bridge; the renderer's `window.playwrightFlowStudio` type derives from the preload export automatically.
- **Verified:** `npm run build` clean; `verify:ipc-contract` **4/4** (121 handlers / 98 exposed / 23
  backend-only — the 3 new channels each have exactly one handler AND are exposed).
- **Not yet done:** B3 (Workflow Reports comparison UI + machine filters), B4 (optional live-vs-history run card).

## Machine-aware report read-model — plan phase B1 (2026-07-13)

Runs now carry their **machine context** so reports can be filtered and compared BY machine (cross-machine
runs are never silently averaged together), plus a per-workflow **current-vs-previous-window** comparison
and a **run-over-run trend**. Read-model + persistence only — no IPC/UI yet (B2/B3).

- **Migration v3 (`RuntimeStoreSchema.ts`):** additive nullable columns on `runtime_runs` — `machineId`,
  `logicalCpuCount`, `totalMemoryMb`, `availableMemoryMbAtStart`, `executionMode`, `browserPoolMode`,
  `configuredConcurrency`, `observedPeakConcurrency`, `workloadClass`, `capacityRecommendationAtRun` + an
  `idx_runs_machine` index. v1/v2 DBs upgrade in place; pre-v3 rows read the columns as `undefined`
  ("Unknown"). `DurableRunRecord` + `upsertRun` extended to persist them.
- **Contracts (`TelemetryContracts.ts`):** `MachineRunContext`, `MachineFilter`, `WorkflowComparisonRow`
  (= `WorkflowReportRow` + `previous`/`delta`/`trend`/`machineContext`), `WorkflowTrend`/`WorkflowTrendPoint`,
  `MachineSummary`; `RunHistoryFilter` now extends `MachineFilter`; `machineContextFromRun` helper.
- **Store (`SqliteRuntimeStore.ts`):** `queryWorkflowComparison(range, machineFilter?)` (half-open windows
  — current `[since, now)` vs previous `[since−len, since)`; all-time → no prior window, `trend: "new"`;
  deltas are `current − previous`, undefined not NaN when a side is missing), `queryWorkflowTrend(scenarioId,
  range, buckets, machineFilter?)`, `listRunMachines(range?)`; `queryRunHistory` honors machine/mode/pool/
  class filters. Workflow aggregation refactored into a shared `aggregateWorkflows`. `RuntimeStore`
  interface + `NullRuntimeStore` stubs added.
- **Write path (`ExecutionEngine` + `capacityService` + `execution.ipc`):** `setMachineRunContext` (pushed
  by the main process, which owns machine detection via `buildMachineRunContext`) is stamped onto each run
  at the run-start `upsertRun` seam (with live pool mode / configured cap / available memory); the run's
  peak simultaneous instance count is tracked in `processQueue` and written at run end. Best-effort — an
  unset/failed context just leaves the machine columns NULL.
- **Verified:** `npm run build` clean; `verify:telemetry` **54/54** (v1→v2→v3 in-place upgrade, machine
  columns NULL for pre-v3 rows, comparison window split + delta signs + trend + empty→`new`/no-NaN, machine
  filter scoping, trend buckets, `listRunMachines`, run-history machine/mode/class/pool filters); regression
  `verify:runner` **82/82** (run write path unregressed).
- **Follow-ups (now):** B2 IPC/preload landed (see section above). B3 (Workflow Reports comparison UI +
  machine filters), B4 (optional live-vs-history on the run card) remain.

## Machine-relative benchmark harness — plan phase A10 (2026-07-13)

## Machine-relative benchmark harness — plan phase A10 (2026-07-13)

Calibrates THIS machine's real sustainable capacity by ramping concurrency through **machine-relative
stages** (scaled from the detected recommendation `R` and safety ceiling — never a fixed 4→32 sequence),
holding each stage under real Chromium load, and stopping at the first stage that trips a health stop
condition. Heavy + **opt-in** — behind an explicit npm script, never automatic.

- **`src/runner/concurrency/BenchmarkPlanner.ts` (pure, unit-tested):** `generateBenchmarkStages(R,
  ceiling)` → distinct ascending integers in `[1, ceiling]` (ramp 0.25/0.5/0.75/1.0×R, 1.25×R overshoot,
  then gradual growth up to the ceiling; small machines run `1→2→3→4`, larger run higher — all computed);
  `evaluateStopConditions(sample, thresholds)` trips on sustained/P95 CPU, free-memory reserve, memory %,
  event-loop delay, error rate, browser/renderer crashes, queue delay, and P95-latency regression, and
  **ignores missing telemetry** (partial signals still benchmark); `productionApprovedCapacity` keeps a
  margin BELOW the highest sustainable stage; `summarizeBenchmark` takes the **contiguous** sustainable
  run (first failure ends the ramp — a later lucky pass can't inflate it); `applyBenchmarkToProfile`
  adopts the measured capacity/estimates, records the benchmark id, and clears `requiresRecalibration`.
- **`scripts/benchmark-concurrency.mts` (heavy driver, `npm run benchmark:concurrency`):** detects the
  machine, plans R + ceiling + stages, drives N concurrent mock-site navigation loops per stage, samples
  host health (`ResourceSampler`), evaluates stop conditions, writes a JSON artifact under
  `<runtimeRoot>/runtime/benchmarks/` and folds the result into the machine capacity profile
  (`benchmarkTestedCapacity`, `productionApprovedCapacity`, per-instance estimates). A
  `AWKIT_BENCHMARK_PLAN_ONLY=1` / `--plan` dry-run prints the machine + planned stages without launching
  browsers.
- **Verified:** `npm run build` clean; new `verify:benchmark-planner` **36/36** (stage scaling +
  normalization + ceiling clamp + maxStages bound, each stop threshold, missing-telemetry no-stop,
  production margin, contiguous-sustainable summary, profile application); plan-only harness smoke on a
  12-CPU/16-GB host printed machine-relative stages. **Not run: the full live benchmark — a true
  production cap requires a clean-machine run (external gate).**
- **Not yet done:** consume `benchmarkTestedCapacity`/`productionApprovedCapacity` in Auto mode + the
  Settings capacity preview; wire per-instance measured estimates back into the planner seed overrides.

## Resource-reduction profiles — plan phase A9 (2026-07-13)

Per-run knobs to cut per-instance cost without changing defaults: request-blocking **resource profiles**
(Normal / Lean / Ultra-Lean) plus formal **artifact profiles** (Production / Balanced / Debug / Full).
**Default is Normal + Balanced = today's exact behaviour** (images are NEVER blocked by default).

- **`src/runner/ResourceRoutingPolicy.ts` (pure + live-tested):** `decideRequest(resourceType, url, cfg)`
  aborts sub-resources per profile — Lean drops image/media/font, Ultra-Lean also drops stylesheet — with
  precedence URL-allow > URL-block > type-block (profile defaults ∪ extra, minus allow-list). `*`-glob URL
  matching; `resolveContextOptions` yields deterministic context options (blocked service workers, reduced
  motion, fixed device-scale, download opt-out in Ultra-Lean); `loadResourceRoutingConfig(env)` reads
  `AWKIT_RESOURCE_PROFILE` (+ allow/block-list, service-worker, downloads, device-scale, debug overrides);
  `installResourceRouting(context, cfg)` installs `context.route` only when active (best-effort — a routing
  failure lets the request proceed). Images blocked only when a Lean profile is explicitly chosen; an app
  can force-allow a needed asset by URL pattern.
- **`src/runner/artifacts/ArtifactProfile.ts` (pure):** `resolveArtifactSettings(profile)` maps Production→
  trace off, Balanced→trace onFailure (today's default), Debug→trace always, Full→trace always + video;
  all keep failure screenshots. `loadTraceMode()` now falls back to this (default Balanced → onFailure, so
  the historical default is unchanged); an explicit `AWKIT_TRACE_MODE` still wins.
- **Wiring (`BrowserContextFactory`):** resolves the routing config once (env when unset), folds the
  profile's context options into all three context paths (persistent / shared-pool / dedicated isolated)
  via `buildContextOptions`, and installs request routing on each created context. Normal profile = the
  historical `{ acceptDownloads: true, viewport }` + no `context.route`.
- **Verified:** `npm run build` clean; new `verify:resource-routing` **42/42** (decisions, precedence,
  overrides, glob, context options, env parsing, artifact mapping) + `verify:lean-mode` **12/12** (real
  Chromium: Normal loads all, Lean aborts image, Ultra-Lean aborts image+stylesheet, DOM text intact,
  allow-list rescue); regression `verify:runner` **82/82** (Normal path unregressed), `verify:concurrency`
  **78/78**.
- **Not yet done:** a dedicated Mock Site Lean/downloads scenario (the live proof uses a self-contained
  temp server); Settings UI to pick resource/artifact profiles per run; wiring the `video`/`screenshotOn
  Failure` artifact-profile fields beyond trace (trace is wired; the others are resolved but not yet
  consumed).

## Workload-aware capacity + scheduler weights — plan phase A8 (2026-07-13)

Admission stops treating every instance as one identical "flow". Each instance gets a relative **weight**
(a persistent-profile / headed / download / parallel-branch / trace-video flow costs more than a plain
isolated context), and — when enabled — dispatch is admitted against a **weighted budget**
(`maxActiveFlows × budgetPerFlow`) instead of a raw active count, so a few heavy instances weigh as much
as several light ones. **Experimental, gated by `AWKIT_WORKLOAD_WEIGHTS` (default OFF); flag-off is the
exact count-based admission as before.**

- **`src/runner/concurrency/WorkloadWeights.ts` (pure, unit-tested):** `extractWorkloadFeatures(config,
  flows, ctx)` reads static signals (headed, persistent profile, browser-swap nodes, navigation/download/
  upload/screenshot counts, full-page shot, popups, parallel branches, nested flows, loops, node count,
  trace/video); `computeWorkloadWeight` is additive from a `baseWeight` of 1.0, monotonic, clamped to
  `[base, maxWeight]`; `classifyWorkload` maps weight → `light|medium|heavy`, **rounding UP on ambiguity**
  (never under-classify a costly flow); `weightedBudget` + `canAdmitWeighted` drive admission and **never
  deadlock** (an idle host always admits ≥ 1 instance even if it alone exceeds budget). All seeds live in
  one `DEFAULT_WORKLOAD_WEIGHT_CONFIG` (configurable, superseded by measurement in A10). Weight is an
  ADMISSION concept, kept separate from the A5 physical context budget (no double counting).
  `buildWorkloadRecommendation` tags per-class recommendations `unmeasured → estimated → benchmarked`.
- **Wiring:** `ConcurrencyConfig` gained `workloadWeights` (bool, `AWKIT_WORKLOAD_WEIGHTS`, default OFF) +
  `workloadWeightBudgetPerFlow` (`AWKIT_WORKLOAD_WEIGHT_BUDGET_PER_FLOW`, default 1.0). `ExecutionEngine`
  caches a per-instance weight (`instanceWeights`, dropped when the runner settles) and, in the dispatch
  loop only when the flag is on, gates each candidate on `canAdmitWeighted(activeWeightedCost, candidate,
  budget)` before acquiring a browser/context slot; a blocked candidate stays pending and is retried next
  tick. No change to the browser-slot semaphore or the A5/A6/A7 paths.
- **Verified:** `npm run build` clean; new `verify:workload-weights` **53/53** (extraction, weight
  monotonicity + clamp, classification boundaries + round-up, budget math, admission incl. no-deadlock,
  confidence transitions); regression `verify:concurrency` **78/78**, `verify:adaptive-concurrency`
  **14/14**, `verify:operation-limiters` **10/10**.
- **Not yet done:** per-class capacity surfaced in the Settings preview / IPC (the recommendation builder
  exists but is not yet consumed by the UI); history-driven weight/class calibration (A10 benchmark feed).

## Adaptive concurrency controller — plan phase A7 (2026-07-13)

Lowers the live active-flow target under REAL host pressure (CPU / memory / event-loop delay / crash
rate — including load from OTHER apps) and recovers gradually. **Purely protective: with no pressure the
target sits at the configured cap, so steady-state behavior is unchanged** (no slow-ramp surprise).

- **`src/runner/concurrency/AdaptiveController.ts`:** maintains a target in `[1, ceiling]`; classifies
  `healthy`/`stable`/`pressure`/`critical` from an injected health sample; **grows slowly** (step 1,
  only when there is queued work AND positive healthy evidence) and **shrinks fast** (step 2) under
  critical pressure; `pressure` freezes growth; a cooldown between changes prevents oscillation.
  `setCeiling()` jumps the target to a new cap immediately (an operator reconfig is not pressure). Pure +
  unit-tested. Missing samples → hold (never grow without evidence).
- **Event-loop signal (`ResourceSampler.ts`):** added `eventLoopDelayMs` (passive `monitorEventLoopDelay`
  histogram, unref'd) to the sample — a main-thread-saturation indicator feeding pressure/critical.
- **Wiring:** `ConcurrencyConfig` gained `adaptiveConcurrency` (default ON, `AWKIT_ADAPTIVE_CONCURRENCY`)
  + grow/shrink/cooldown + healthy/critical CPU-mem-eventloop thresholds (pressure thresholds reuse the
  existing `maxCpuPercent`/`maxSystemMemoryPercent`/`minFreeMemoryMb`). `BackpressureController.admit`
  takes an optional `effectiveMaxFlows` (the adaptive target, clamped ≤ `maxActiveFlows`); `CapacitySnapshot`
  gained `adaptiveTarget`/`adaptiveState` (additive → surfaced in `getRuntimeStatus`). `ExecutionEngine`
  owns the controller, evaluates it each dispatch tick with the live sample + crash count + queue depth,
  passes the target to `admit`, and re-seeds the ceiling in `configureConcurrency`. It never touches the
  browser-slot semaphore (idle-only resize preserved).
- **Verified:** `npm run build` clean; new `verify:adaptive-concurrency` **14/14** (grow/hold/shrink,
  cooldown, `[1,ceiling]` bounds, recover-after-spike, event-loop + crash → critical, empty-queue no-grow,
  setCeiling jump, unknown-sample hold); regression `verify:concurrency` **78/78**, `verify:resource-sampling`
  **14/14**, `verify:runtime-status` **15/15**, `verify:operation-limiters` 10/10, `verify:runner` 82/82.
- **Follow-up:** Instance Monitor strip could show `adaptiveState`/`adaptiveTarget` (fields are already in
  the status; UI wiring deferred).


## Operation limiters — plan phase A6 (2026-07-13)

Independent, configurable caps on how many of each EXPENSIVE operation run at once across ALL instances,
so peak concurrency ≠ peak simultaneous spikes (the guide's "stagger expensive operations"). Active by
default (no flag) with conservative caps; adds no behavior change beyond staggering.

- **`src/runner/concurrency/OperationLimiters.ts`:** five `Semaphore`-backed kinds — `browserLaunch` (2),
  `contextCreation` (4), `navigation` (8), `download` (3), `screenshot` (2). `run(kind, fn)` holds a
  permit only around the raw Playwright call (released in `finally` — never across a wait/handoff, so no
  deadlock). `configure()` swaps a kind's semaphore; in-flight ops finish on their old instance, so a
  resize is safe any time. All caps env-overridable (`AWKIT_MAX_CONCURRENT_*`) — none machine-specific.
- **Wiring:** `ConcurrencyConfig` gained the five `maxConcurrent*` fields; `BrowserContextFactory` wraps
  `launch`/`launchPersistentContext` (browserLaunch) + `newContext` (contextCreation) for shared AND
  dedicated paths; `StepExecutor` wraps the two `goto` sites (navigation), `download.saveAs` (download),
  and both `takeScreenshot` calls (screenshot) via a `limitOp` helper (15th ctor param, threaded from
  `PlaywrightRunner` at both StepExecutor construction sites). `ExecutionEngine` owns one `OperationLimiters`,
  sizes it live in `configureConcurrency`, and passes it to every runner. **Sequential mode pins all five
  to 1** (`applyRuntimeConcurrencyFromSettings`), so parallel branches within one instance also serialize.
- **Verified:** `npm run build` clean; new `verify:operation-limiters` **10/10** (per-kind cap never
  exceeded under a 12-op burst, kind independence, finally-release on throw, live reconfigure, Sequential
  serializes); regression: `verify:runner` **82/82** (real Chromium — wrapped goto/screenshot/download
  unregressed), `verify:waits` **21/21**, `verify:concurrency` **78/78**, shared-pool 18/18 + live 5/5.


## Shared Chromium browser pool — plan phase A5 (2026-07-13, experimental, default OFF)

Lets many isolated `browserContext` instances share a few Chromium processes instead of one process per
instance. **Gated by `AWKIT_SHARED_BROWSER_POOL` (default off) → flag-off behavior is byte-for-byte
identical** (proven: browser-pool 25/25, concurrency 78/78, runner 82/82 all unregressed).

- **`src/runner/browser/SharedBrowserPool.ts`:** owns shared `Browser` objects, leases isolated
  contexts, spreads across browsers (crash isolation) up to `maxBrowsers` then packs to a hard
  per-browser context limit, selects least-loaded healthy browsers, drops+replaces crashed browsers,
  recycles a browser after N contexts (drain then close), `drainIdle`/`closeAll`, snapshot. Injectable
  launcher → unit-testable without Chromium.
- **`src/runner/browser/browserSharing.ts`:** `isSharedEligible` = flag on + `browserContext` isolation
  + no persistent profile/captured session + no browser-swap node (`autoSecureLogin`/`reuseSession`/
  `protectedLoginHandoff`). Those **dedicated** instances always keep their own browser. `sharedLaunchKey`
  keeps headed/headless on separate processes.
- **Wiring:** `ConcurrencyConfig` gained `useSharedBrowserPool` + recycle/hard-limit fields (env-overridable);
  `BrowserContextFactory` leases from the pool for the `browserContext` path when a pool is supplied;
  `BrowserWorkerPool` gained non-semaphore **context slots** (`acquireContextSlot`) so shared instances are
  bounded by `maxActiveFlows` (+ the pool's browser cap), not by `maxBrowsersPerHost`, and are excluded
  from the pool-saturation check; `ExecutionEngine` constructs one `SharedBrowserPool` (sized live in
  `configureConcurrency`), routes eligible instances to context slots + the pool, and `drainIdle`s at run
  end. `PlaywrightRunner` passes the pool through unchanged. The generation-scoped expected-close/crash
  logic is preserved (shared context close only closes the context; the browser stays warm).
- **Verified:** `npm run build` clean; new `verify:shared-browser-pool` **18/18** (packing 16→4 browsers,
  least-loaded reuse, hard-limit + exhaustion, crash health, recycle+drain, launch-key isolation,
  eligibility); new `verify:shared-browser-live` **5/5** (REAL Chromium: 4 leased contexts share exactly
  2 processes, usable, drain closes both); flag-off parity green (browser-pool/concurrency/runner).
- **Remaining (external gate / follow-ups):** a full flag-ON multi-instance run *through the engine
  dispatch* against the mock site (heavy; the clean-machine gate) is not yet done — the mechanism + factory
  lease are proven with real Chromium and flag-off is unregressed. The runtime-status "browsers X/Y" gauge
  still counts only real (dedicated) slots, not shared browsers (add shared count next). Default stays OFF
  until the live multi-instance run passes (owner decision D4).



## Machine-aware Runtime Concurrency modes — plan phase A4 (2026-07-13)

Wires the capacity core (A1–A3, below) into real dispatch + the Settings UI. This is the first slice that
**changes run behavior**: `Settings → Runtime Concurrency` now chooses **Sequential / Auto / Manual**.

- **Settings schema (`app/main/uiSettings.ts`):** `runtime` gained `capacityMode` (`manual` default for
  back-compat), `workloadClass`, `administratorMaximumConcurrency`, `absoluteSafetyMaximum` (64),
  `capacitySafetyFactor` (0.75), `reservedLogicalCpuCount` (1) alongside the legacy `maxBrowsers`/
  `maxActiveFlows`. Legacy files migrate on read (absent `capacityMode` → `manual`, old numbers preserved
  as the Manual values). Main + client validation extended.
- **Mapping (`app/main/capacityService.ts` + `src/runner/concurrency/CapacityContracts.ts`):** the pure
  `resolveEffectiveConcurrency()` turns a mode into concrete host caps — **sequential** → 1 browser / 1
  active flow (fully serializes, any machine); **manual** → the explicit numbers; **auto** → the detected
  machine's benchmark value if present else the conservative recommendation, with a pre-benchmark ceiling
  for un-benchmarked server-grade hosts (`DEFAULT_UNBENCHMARKED_AUTO_CEILING`). **Every** mode is clamped
  to the administrator max + absolute safety ceiling (Manual is never unbounded).
- **Apply seam (`app/main/ipc/execution.ipc.ts`):** `applyRuntimeConcurrencyFromSettings()` now calls
  `computeEffectiveConcurrency()` (Auto detects the host + refreshes the per-machine profile) → the same
  `ExecutionEngine.configureConcurrency` seam as before (still startup / on settings save / before each
  run; browser-slot resize still idle-only).
- **IPC (`app/main/ipc/system.ipc.ts` + `preload.ts`):** new read-only `system:capacityPreview(workloadClass?)`
  → `CapacityPreview` (machine specs, recommendation, binding constraint, category, auto vs effective
  target, recalibration flag). Does not persist the profile. `verify:ipc-contract` green (118/95/23).
- **UI (`app/renderer/pages/Settings.tsx` + `global.css`):** the Runtime Concurrency card is now a
  Sequential/Auto/Manual selector with a live "this machine" readout, Auto workload-class picker, Manual
  inputs + an "exceeds recommended" warning, and an Advanced safety-limits group. Token-only styling.
- **Verified:** `npm run build` clean; `verify:capacity-modes` **10/10**; `verify:ipc-contract` **4/4**;
  `verify:settings-persistence` **3/3**; new `verify:capacity-settings-gui` **12/12** (real Electron: live
  detection on a 12-CPU/16-GB host, all three modes end-to-end, card render, no console errors);
  `verify:concurrency` **78/78** (unregressed).
- **Not yet done (next phases):** concurrency workstream A (A1–A10) is complete; the reporting workstream
  B (B1–B4: per-workflow comparison + machine-context history) remains. A5–A10 have since landed (see
  sections above).

## Machine-agnostic capacity core — plan phases A1–A3 (2026-07-13)

First execution slice of `docs/ai/CONCURRENCY_CAPACITY_AND_REPORTS_PLAN.md`. **Pure `src/` core only —
no ExecutionEngine/IPC/renderer wiring, no run-behavior change yet.** Everything is hardware-agnostic:
capacity is detected/configured/measured, never hardcoded to any machine shape.

- **`src/runner/concurrency/MachineCapabilityDetector.ts` (A1):** `MachineCapabilities` snapshot from an
  injectable `OsProbe` (never throws); coarse capability **fingerprint** (stable across reboot and
  available-memory drift; changes on logical-CPU count / total-RAM GB band / platform / OS type);
  `capabilitiesChanged()` reasons; `loadOrCreateMachineId(runtimeRoot)` → atomic `machine-id.json`
  (locally generated UUID; no hardware serials/MACs).
- **`src/runner/concurrency/CapacityPlanner.ts` (A2):** pure `planCapacity()` = conservative
  `min(memoryEstimate, cpuEstimate, adminMax, absoluteCeiling)` after OS/AWKIT/safety reserves, reserved
  cores, and live background-CPU load; `CapacityTuning` holds every seed/bound in one place
  (`DEFAULT_CAPACITY_TUNING`); `resolveReserveMb` precedence = more-protective of absolute vs percentage;
  config-driven `bootstrapCategories`; measured per-instance overrides supersede seeds; seven distinct
  capacity terms. High RAM alone never inflates the number (stays CPU-bound). `planWorkloadCapacities()`
  gives per-class (light/medium/heavy) recommendations.
- **`src/runner/concurrency/MachineCapacityProfileStore.ts` (A3):** per-machine `MachineCapacityProfile`
  persisted atomically at `<runtimeRoot>/runtime/machine-profiles/<machineId>.json`;
  `reconcileMachineProfile()` — new machine → fresh conservative profile; same hardware → refresh but keep
  measured benchmark/estimate values + administrator `configuredCapacity`; changed hardware → flag
  `requiresRecalibration`, drop stale benchmark values, **preserve** the manual configured value; profiles
  isolated per `machineId`.
- **Verified:** `tsc --noEmit` clean; `npm run verify:machine-capabilities` **20/20**;
  `npm run verify:capacity-planner` **29/29**; `npm run verify:machine-profile` **15/15**.
- **A4 (done):** these modules are now wired into Settings/IPC/engine — see the A4 entry above.

## Runtime concurrency caps configurable in Settings (2026-07-12)

The host browser/flow caps that were env-only (`AWKIT_MAX_BROWSERS` / `AWKIT_MAX_ACTIVE_FLOWS`) are now
editable in **Settings → Runtime Concurrency** and drive the Chrome Consumption gauge denominators.

- **Schema (`app/main/uiSettings.ts`):** new `runtime: { maxBrowsers, maxActiveFlows }` section
  (defaults 2 / 4, matching `ConcurrencyConfig`); hydrate/mergePatch/validate updated (bounds: browsers
  1–16, flows 1–64).
- **Engine (`src/runner/ExecutionEngine.ts` + `src/runner/browser/BrowserWorkerPool.ts`):** new
  `ExecutionEngine.configureConcurrency(overrides)` → `BrowserWorkerPool.reconfigure(overrides)`. The
  shared `limits` object is mutated in place so `maxActiveFlows` (and other soft caps) take effect
  immediately for the next admission; the browser-slot `Semaphore` is rebuilt **only when the pool is
  idle** (`slots.size === 0`) so an in-flight release can't corrupt permits — `limits.maxBrowsersPerHost`
  never drifts from the live semaphore capacity (gauge stays honest). `src/` never reads app settings;
  the main process pushes them in.
- **Wiring (`app/main/ipc/execution.ipc.ts` + `settings.ipc.ts`):** `applyRuntimeConcurrencyFromSettings()`
  pushes the settings into the engine at **startup**, after every **settings save/reset/import**, and
  before **each run** (so a run always honours the latest caps; a browser-cap change lands when idle).
- **UI (`app/renderer/pages/Settings.tsx`):** a Runtime Concurrency card (Max browsers / Max active
  flows) with client+main validation and a hint that a live browser-count change applies when no run is
  in progress.
- **Verified:** `npm run build` clean; `verify:browser-pool` **25/25** (new Part G: live `maxActiveFlows`,
  guarded/deferred `maxBrowsers` resize); `verify:settings-persistence` **3/3**; `verify:reports` 26/26;
  `verify:ipc-contract` 4/4.

## Chrome Consumption gauges: fixed distortion + live idle sampling (2026-07-12)

Two fixes for the Chrome Consumption (reportsChrome) page.

- **RPM gauge distortion (renderer, `app/renderer/components/reports/RadialGauge.tsx`):** the colored
  band segments rendered as a cusped/distorted swoosh instead of a clean semicircle. `bandArc` used SVG
  arc **sweep-flag 0**, which is only unambiguous for the full 0→100 arc (chord === diameter → a single
  possible circle). For the shorter band sub-arcs (0–60/60–85/85–100) flag 0 resolves to the *mirrored*
  circle centre, so each segment bulged the wrong way. Changed to **sweep-flag 1** (always the top
  semicircle). Verified by rasterizing the exact SVG with `sharp`: flag 0 reproduced the reported
  distortion; flag 1 renders clean gauges (needle left at 0%, into red at 90%, neutral arc when
  unavailable).
- **Memory/CPU gauges stuck on "sampling…" (core, `src/runner/ExecutionEngine.ts`):** the
  `ResourceSampler` was started only inside `startRun`, so with no active run the system RAM/CPU gauges
  never got a sample. `getRuntimeStatus()` now calls the idempotent `this.sampler.start()` (primes the
  first sample synchronously, unref'd timer), so system RAM shows immediately and CPU within one poll
  even at idle. Process-tree metrics (Chromium count/memory) still populate during runs.
- **Gauge caps are now configurable in Settings** (see next entry) — no longer env-only.
- **Verified:** `npm run build` clean; `npm run verify:reports` **26/26** (real Electron; gauges render,
  no console errors). Gauge geometry proven via `sharp` raster comparison.

## Reports tables now fill full width + scroll inside bounded cards (2026-07-12)

Renderer/CSS-only fix (`app/renderer/styles/global.css`) for a reported Workflow Reports layout bug; no
route/IPC/runner/schema change. `.awkit-table` is used only by the reports pages/components.

- **Root cause (full-width):** the global `table { display: block; overflow-x: auto }` rule (used to make
  the wide Instance Monitor table horizontally scrollable) applied to **every** `<table>`, so `.awkit-table`
  — which sets `width: 100%` expecting a real table box — rendered as a block whose inner columns
  shrink-to-fit and cluster on the left, leaving the right half of each report card empty.
- **Fix (full-width):** `.awkit-table` now sets `display: table` (overriding the global block rule) so
  `width: 100%` actually stretches the columns to fill the card. Horizontal scroll on narrow widths is
  still handled by `.awkit-table-wrap { overflow-x: auto }`.
- **Fix (bounded height + scroller):** `.awkit-report-page .awkit-table-wrap` gets `max-height: 46vh` +
  `overflow-y: auto`, and its `thead th` is `position: sticky; top: 0`, so long run lists scroll inside a
  fixed-height card (with a pinned header) instead of pushing the page down.
- **Verified:** `npm run build` clean; `npm run verify:reports` **26/26** (real Electron — all report
  routes render/resolve, no console errors). The width/scroll is a visual CSS change; the GUI verifier
  confirms no functional regression across every report route.

## Load Session (A7) — accepted as a roadmap stub (2026-07-12)

Owner decision during audit remediation Phase 4: the Protected Login Handoff `useSavedSession`
("Load Session") and `useTestSession` modes are **kept as-is** — no code change. They are already
honestly disabled (validation note in `flowNodeRegistry.ts:167`, capability flags `false` in
`src/auth/OAuthHandoffService.ts`, disabled button in `ProtectedLoginHandoffPanel.tsx`) and are
redundant with the fully-working `Reuse Session` (persistent-profile swap) and `Auto Secure Login`
nodes. Reclassified in `docs/audit/` from a defect to an intentional roadmap stub; revisit only if
Load Session is prioritized as a real feature.

## Electron/IPC surface hygiene (2026-07-12)

Closes audit findings A5/A6 from `docs/audit/`. No route/runner/schema/packaging change; no channel was
added, removed, or re-wired — the renderer↔main contract is unchanged, only guarded.

- **A5 — external-open scheme guard:** `app/main/windowManager.ts` `setWindowOpenHandler` now opens the
  target via `shell.openExternal` **only for `http(s)`** (was: any scheme). A `file:`/other-scheme
  `window.open` is denied without launching the OS handler. Mirrors the guard already in
  `auth.ipc.ts` `openExternal`.
- **A6 — IPC contract guard:** new `npm run verify:ipc-contract`
  (`scripts/verify-ipc-contract.mts`, 4/4, static, no Electron) parses `app/main/ipc/*` +
  `app/main/preload.ts` and enforces: (1) every preload-invoked channel has a handler (no broken
  renderer→main call), (2) no channel registered twice, (3) every registered handler is either exposed
  in preload **or** in a documented `BACKEND_ONLY` allowlist, (4) the allowlist has no stale entries.
  The **23 registered-but-unexposed** channels (`instances:*`/`runtimeInputs:*` CRUD, `reports:create/
  delete/export`, legacy singular/plural `list` aliases, `scenario:get/save`) are now documented in that
  allowlist rather than deleted — they are unreachable from the renderer (no preload bridge), so this is
  a maintainability/contributor-clarity fix, and the guard fails the build if a NEW unexposed handler
  appears. Current tally: 117 handlers, 94 exposed, 23 backend-only.
- **Verified:** `npm run build` clean; `verify:ipc-contract` **4/4**.

## Isolated browser teardown no longer orphans the process (2026-07-12)

Core-only change (`src/runner/BrowserContextFactory.ts`); no route/IPC/preload/schema/packaging change,
and browser-context semantics are otherwise identical. Closes audit finding A4 from `docs/audit/`.

- **Symptom (A4):** the `browserContext`-isolation close path was `await isolatedContext.close(); await
  browser.close();` with no `try/finally`. If `context.close()` rejected (e.g. the target already
  crashed), `browser.close()` was skipped and the Chromium process leaked inside the long-running
  Electron host. The persistent-context path was already correct (try/finally around the profile lease).
- **Fix:** new exported `closeIsolatedRuntime(context, browser)` closes the context in `try` and the
  browser in `finally` (a failing `browser.close()` is swallowed so it can't mask the original context
  error, which still propagates). The isolated `create()` close closure now delegates to it.
- **Verifier:** `verify:browser-pool` Part F (now **20/20**, was 16) asserts the browser is closed when
  `context.close()` rejects, the context error still propagates, the happy path is clean, and a failing
  browser close is swallowed when the context closed cleanly.
- **Verified:** `npm run build` clean; `npm run verify:browser-pool` **20/20**.

## Profile store data-integrity hardening (2026-07-12)

## Profile store data-integrity hardening (2026-07-12)

Core-only change (`src/storage/ProfileStore.ts`); no route/IPC/preload/runner/schema/packaging change,
and the on-disk format (one JSON file per profile) is unchanged. Closes audit findings A1/A2/A3 (+S1)
from `docs/audit/`. The profile store persists **flows, workflows, data sources, reports, runtime
inputs, instances** and previously wrote non-atomically and silently dropped corrupt files — the
settings store had already been hardened, the document store had not.

- **Atomic writes (A1):** `writeProfile` now serializes to `${path}.<pid>.<ts>.<rand>.tmp` then
  `rename()`s over the target (Windows `MOVEFILE_REPLACE_EXISTING`), so a crash/power-loss mid-write can
  never truncate a saved document; on rename failure the temp file is cleaned up. Mirrors the existing
  `uiSettings.writeSettings` pattern (but self-contained — `src/` must not import `app/`).
- **Serialized mutations (S1):** every write/delete for a store instance runs through an in-instance
  FIFO promise chain, so overlapping saves to the same folder can't physically interleave.
- **Corrupt-file quarantine (A2):** a file that fails `JSON.parse` is renamed to a `.corrupt-<ts>`
  sibling (outside the `.json` scan) and logged loudly, instead of being silently returned as `null`
  and vanishing from the library. The bytes survive for recovery; the original is never destroyed.
  A missing file is still a normal "not found".
- **Crash-safe id rename (A3):** `update()` with an id change now writes the new file *before* deleting
  the old one — a crash between them leaves a recoverable duplicate, never zero files.
- **Verifier:** new `npm run verify:profile-store` (`scripts/verify-profile-store.mts`, 13/13, pure
  `tsx`, no Electron) proves atomic writes / no `.tmp` residue, 40 concurrent creates + updates,
  quarantine-not-drop with preserved bytes, and lossless id rename.
- **Verified:** `npm run build` clean; `verify:profile-store` **13/13**; `verify:data-editor` **27/27**
  (store consumer, unregressed); `verify:write-queue` 7/7; `verify:workflow-sentinels` 4/4. Not run:
  live/GUI verifiers and packaged/offline (no behavior in those paths changed).

## Instance Monitor workflow summaries and bulk stop (2026-07-12)

Renderer/monitor aggregation and verification only; the existing `execution:stopAll` IPC and hard-cancel
engine path are reused unchanged. No profile schema, runner contract, routing, or packaging change.

- **Stop Pending & Running:** the monitor toolbar now exposes an explicit destructive bulk action for
  `pending`, `queued`, `starting`, `running`, paused, and manual-handoff instances. It is enabled when any
  cancellable work exists (including pending-only batches), requires confirmation, calls the real backend
  `executions.stopAll()`, and reports the affected count. The compact page-header action uses the same path.
- **Workflow run records:** live pool rows are grouped by globally unique `executionId`, keeping concurrent
  and repeated runs of the same workflow separate. Active/attention/queued runs sort ahead of terminal
  history. Each record shows workflow identity, run status, active/pending/completed/failed counts,
  progress, total instances, and duration.
- **All-instance modal:** selecting a workflow record opens an accessible Escape/backdrop-close modal with
  total/active/pending/failed/completed/cancelled metrics and every instance's status, current flow/step,
  data row, browser/mode/isolation, timing, retries, and link to the existing live execution report.
- **Mock lab:** `/designer-lab` documents and exercises the workflow-record → all-instance-modal contract.
- **Files:** `app/renderer/pages/InstanceMonitor.tsx`,
  `app/renderer/components/instances/WorkflowInstancesModal.tsx`, `app/renderer/styles/global.css`,
  `src/instances/instanceCardLogic.ts`, `scripts/verify-instance-monitor.mts`,
  `scripts/verify-instance-monitor-gui.mjs`, mock-site docs/fixture/verifier, `package.json`.
- **Verified:** `npm run build` clean; `npm run verify:instance-monitor` **35/35**;
  `npm run verify:instance-monitor-gui` **12/12** against an isolated four-instance real Electron run
  (two running + two queued, all four cancelled); `npm run verify:mock-site` **39/39**. The real Electron
  workflow modal was captured and visually inspected in light mode.

## Flow Designer inspector canvas bounds fixed (2026-07-12)

Renderer layout only; no profile schema, routing, IPC, runner, recorder, or packaging change.

- **Symptom:** opening the Flow Designer right properties inspector placed it in a separate outer grid
  column beyond the canvas and action-toolbar right edge. The first repair only corrected its vertical
  height and did not address this horizontal overflow.
- **Fix:** the designer canvas and action toolbar now retain the full layout width. The inspector slot is
  absolutely bounded inside that canvas, below the measured action-toolbar height, while the usable node
  canvas reserves an internal strip of the same width so the inspector does not cover nodes/connectors.
  The collapsed rail uses the same contained geometry and returns the reserved canvas width.
- **Regression coverage:** the real Electron Flow Designer walkthrough asserts full four-edge inspector
  containment, full-width toolbar alignment, and non-overlap with the usable canvas at the default,
  compact **1024×768**, and reported **1936×1290** viewports.
- **Files:** `app/renderer/styles/global.css`, `scripts/verify-flow-designer-gui.mjs`.
- **Verified:** `npm run build` clean; `npm run verify:flow-designer` **24/24**;
  `npm run verify:mock-site` **35/35**; the captured 1936×1290 Electron frame visually confirms the
  panel is inside the canvas from toolbar bottom to canvas bottom.

## Backpressure crash-rate false positive fixed (2026-07-11)

Runner/orchestrator only; no route, IPC, preload, profile-schema, or packaging change.

- **Symptom:** a large concurrent run (e.g. 50 instances) stalled with `Crashes 5`, `Browsers 0/2`, and
  the banner "browser crash rate high (5 crashes in window) — pausing new dispatch" while ~46 instances
  sat `Pending` — even though CPU/memory were low. Backpressure was firing on phantom crashes.
- **Root cause:** in `browserContext` isolation (default; "Context" in the monitor) the runtime owns a
  real Playwright `Browser`, so its **normal** end-of-instance `browser.close()` emits `disconnected`.
  `PlaywrightRunner.executeScenario` closes the runtime in its own `finally` **before** returning, so the
  engine's `releaseSlot(slot)` had not run and `slot.released` was still `false` when
  `BrowserWorkerPool`'s `disconnected` handler ran — scoring every completed instance (pass or fail) as a
  crash. Past `maxRecentCrashes` (default 3, 5-min window) `BackpressureController.admit` paused all new
  dispatch. Persistent-context runs were immune (no `Browser` object).
- **Fix:** the runner announces intentional teardown via a new `onRuntimeClosing` option (fired in
  `closeRuntime` — covers end-of-run, hard cancel, and Reuse Session swap); the engine wires it to
  `BrowserWorkerPool.markExpectedClose(slot, generation)`, and the pool's `disconnected` handler skips
  crash-counting when `slot.expectedCloseGeneration === generation`. Genuine crashes still count
  (unsignalled mid-run disconnect, page `crash` event, and the engine's explicit `browser-crash`
  classification); the signal is **generation-scoped** so a real crash of a later generation after a swap
  is still counted.
- **Files:** `src/runner/browser/BrowserWorkerPool.ts`, `src/runner/PlaywrightRunner.ts`,
  `src/runner/ExecutionEngine.ts`, `scripts/verify-browser-pool.mts` (Part E regression).
- **Verified:** `npm run build` clean; `verify:browser-pool` **16/16** (new Part E); `verify:concurrency`
  **78/78**; `verify:runner` **82/82**. Not run: clean-machine offline GUI walkthrough / live 50-instance
  repro (the fix is proven at the unit-ordering level that produced the miscount).

## Compound / tree locators for non-unique elements (2026-07-11)

Recorder + runner + Flow Designer. Fixes the reported case where a recorded step showed
"Locator warning: matches 2 elements" (e.g. two `checkbox` controls sharing accessible name
`0796713928`) because the recorder only tried *single-strategy* locators and fell back to an
ambiguous `role`/positional selector. Schema is additively extended (one optional field); the runner
already resolved `css`/container/`alternatives`, so no runtime contract changed.

- **Phase 1 — compound "tree" builder** (`src/recorder/recorderInitScript.ts`): new
  `compoundSelector` combines the element's meaningful features (stable attributes + rare,
  non-utility classes, ranked by document frequency) with the **fewest distinguishing ancestors**
  (descendant combinators, skipping wrapper noise) until `count === 1` — e.g.
  `[data-testid="package-pro"] button.pkg-select`. `anchoredStructural` (nearest unique
  id/testid ancestor + positional tail) and the existing whole-document positional path remain the
  guaranteed-unique last resorts. Utility/layout classes (`flex`, `items-center`, …), state
  prefixes, and hashed css-modules/emotion/styled classes are never used.
- **Phase 2a — semantic container scoping** (`recorderInitScript.ts`): when the primary would be a
  raw compound/positional selector, a readable semantic locator (role+name/label/placeholder/text)
  scoped to a stable container that **isolates the exact element** (verified in-page against the real
  ancestor node) is preferred and saved as `context.container`. New `quality.disambiguation`
  (`compound`/`container`/`positional`) drives a neutral Node-Properties readout instead of the red
  warning; `LocatorQuality.disambiguation?` added to `src/profiles/FlowProfile.ts` (optional,
  back-compatible).
- **Phase 2b — edit-safe designer round-trip** (`app/renderer`): recorded `alternatives`/`context`
  were silently dropped when a flow was opened and re-saved in the Flow Designer. Added
  `FlowDesignerNodeData.locatorAlternatives`/`locatorContext` (`flowDesignerTypes.ts`) and threaded
  them through `fromFlowStep`/`toFlowStep` (`pages/FlowChartDesigner.tsx`). Panel
  (`components/workflow/FlowNodePropertiesPanel.tsx`) now shows "Unique · … · scoped to container /
  compound selector / positional fallback".
- **Phase 3 — runtime self-healing** (`src/runner/LocatorFactory.ts`): when a saved step matches
  several elements, `pickSingle`/`narrowToActionable` pick the single *visible* → *enabled* →
  *in-viewport* match. If two+ remain equally actionable it **does not guess** and fails with the
  existing friendly diagnostic. Heals legacy non-unique flows without re-recording. It only converts
  would-be failures into successes — it never changes which element an unambiguous step resolves to.
- **Mock site:** `/recorder-lab` gains a `duplicate-controls` scenario (two package cards with a
  shared checkbox accessible name + `Select package` button, plus a customer table repeating an
  `Edit` button per row) for compound + container reproduction.
- **Verified:** `npm run build` clean; `verify:recorder` **72/72** (adds CR1–CR4: duplicate role+name
  → unique locator + correct element; compound CSS; disabled-twin self-heal; equal-twins fail
  cleanly); `verify:runner` **82/82**; `verify:mock-site` **35/35**; `verify:flow-designer` **21/21**;
  `verify:recorder-flow` **13/13**; `verify:recorder-draft` **17/17**. Not run: clean-machine offline
  GUI walkthrough.

## Flow/Workflow Designer inspector no longer overflows the toolbar (2026-07-12)

- **Symptom:** on flush designers (Flow/Workflow), the right inspector drawer's top edge rose above the
  canvas into the in-canvas action bar when the window was narrow.
- **Root cause:** the flush drawer slot cleared the action bar with a fixed `padding-top` (~76px, a
  single-row assumption). `.flow-action-bar` wraps (`flex-wrap: wrap`), reaching ~106px at narrower
  widths, so the fixed offset was too small.
- **Fix:** `DesignerCanvasLayout` measures the live `.flow-action-bar` height (`ResizeObserver`) and sets
  `--awkit-action-bar-h` on the layout section; the drawer `padding-top` reads that var (old 76px kept as
  pre-paint fallback). Token-only, no markup changes.
- **Verified:** `npm run build` clean; Electron GUI check with the bar forced to wrap (106px) confirmed
  drawer top == action-bar bottom and drawer bottom == canvas bottom (no toolbar overflow).

## Flow Designer full-height canvas repair (2026-07-11)

- **Symptom:** with no properties inspector open, the graph canvas occupied only the upper half of the
  designer and left a large inert background below it.
- **Root cause:** `DesignerCanvasLayout` always rendered `.designer-right-drawer-slot`, even when its
  `rightPanel` was `null`. The no-panel layout has one grid column, so CSS auto-placed that empty second
  child into an implicit second row and stretched both auto rows equally. A stale `right-collapsed` class
  also reserved an unused 56px column when no panel existed.
- **Fix:** resolve the optional panel first, render the drawer slot only when a panel exists, and apply
  `right-collapsed` only to a populated panel. Default Form Designer properties remain supported when
  `rightPanel` is omitted; explicit `null` now produces a true single-child canvas layout.
- **Regression coverage:** the real Electron Flow Designer verifier clears selection and requires zero
  drawer slots plus canvas width/height equal to the complete designer rectangle.
- **Verified:** `npm run build`; `verify:flow-designer` **21/21**; `verify:canvas-perf` **13/13**;
  `verify:mock-site` **29/29**. At a 2048×1098 renderer viewport, designer and canvas both measure
  **1808×1002**, the engine reaches the bottom edge, and no renderer console errors occur.

## Critical Flow / Workflow Designer defect closure (2026-07-11)

Renderer and GUI-verifier only; no route, IPC, preload, runner, persisted-schema, or packaging change.

- **`originX` crash root-caused and fixed.** `FlowCanvas`'s pane pointer-move queued a React state
  updater that dereferenced mutable `panState.current`; pointer-up could clear the gesture before the
  updater ran. Pointer-move now captures the immutable gesture snapshot before scheduling state.
- **Fast node-drop race fixed.** Pointer-up could run before the last `setDrag` render, leaving the
  drop handler without a final position. The latest computed position now lives in the gesture ref and
  is consumed directly on pointer-up. This makes drag-to-connect independent of React commit timing.
- **Inspector no longer covers the graph.** A populated Flow Designer inspector owns a real layout
  column; the canvas viewport shrinks instead of rendering underneath it. If the selected node/edge is
  clipped by the narrower viewport, the engine pans only the required distance and restores that exact
  accommodation when the inspector closes. The collapsed state is wired to a 48px compact rail.
- **Connection confirmation matches the supplied reference.** The connect variant uses the branch icon,
  wide two-column content layout, curly-quote wording, and Cancel / Connect ordering while other shared
  confirmation dialogs retain their warning presentation.
- **Workflow toolbar is truly compact.** A legacy `.scenario-toolbar > div` selector was overriding the
  group flex layout and produced a measured 220px toolbar. The final cascade now keeps all four groups in
  one horizontally scrollable row; the real Electron measurement is 59px.
- **Verified:** `npm run build`; real Electron `verify:flow-designer` **20/20** (rapid pane lifecycle,
  hit-tested node drag, dialog geometry, inspector non-overlap and compact rail included);
  `verify:workflow-builder` **20/20**; `verify:canvas-perf` **13/13**; `verify:mock-site` **29/29**;
  `verify:settings-persistence` **3/3**. Canvas performance remains bounded: zoom = 0 node/edge
  rerenders, drag = dragged node only, static edge layer = one recomputation.

## Canvas UI fix pass — 9 reported issues (2026-07-11)

Renderer-only. No route/IPC/preload/runner/schema/packaging change. Reference for parity is the local
`Workflow` (flowforge) project. All verified on the real built Electron app.

1. **White screen (critical) — fixed.** There was **no error boundary**, so any render exception blanked
   the whole window. New `app/renderer/components/shared/ErrorBoundary.tsx` wraps `<ActivePage>` (keyed by
   route) — a crash now shows a readable fallback + Try again / Reload instead of a blank page, and logs
   the stack. This is a safety net; if a specific crash trigger is found later, fix it too.
2. **Edge insert "+" not working — fixed (real root cause).** The `.awkit-flow-nodes` container
   (`inset:0; z-index:2`, transparent) sat **above** the edge `+`/label overlay and silently ate the
   click (you could see the `+` through it). A **real** pointer click timed out; synthetic dispatch (used
   by the verifier) bypassed hit-testing, hiding the bug. Fix: `.awkit-flow-nodes { pointer-events: none }`
   + `.awkit-flow-node { pointer-events: auto }` — empty gaps let clicks reach the affordances beneath.
3. **Edge label text clipped — fixed.** The branch label and the `+` rendered at the same midpoint, so
   the `+` split the text ("If true" → "I…e"). `SmoothEdge` now offsets the label 18px above the line
   when an insert button is present.
4. **Drag-to-connect — implemented (flowforge parity).** The engine's `onNodeDragStop` now computes the
   largest-overlap node from the FINAL drop position and fires a new `onNodeConnect(source, target)`.
   Both designers show a **Connect these steps?** `ConfirmDialog`, skip already-linked pairs, orient
   top→bottom, and add the edge on confirm. Handlers read live nodes/edges from **refs** so the callback
   stays stable (else it re-creates each edit and re-renders every node wrapper — guarded by canvas-perf).
5. **Node size — fixed to 320px.** `.action-flow-node` / `.scenario-flow-node` were `width:100%` of an
   auto-width wrapper (content-driven, variable). Pinned to a fixed **320px** to match the reference.
6. **Parallel connector color — distinct.** New `--awkit-connector-parallel` (teal `#0ea5a4` light /
   `#2dd4bf` dark); `connectorStyle.ts` maps `parallel` to it (was the default violet).
7. **Right drawer covering nodes — fixed (Flow Designer).** Superseded by the critical defect closure
   above: the inspector now owns a real layout column and cannot overlay the canvas; a bounded pan reveals
   a selected item only when the resized viewport would clip it.
8. **(see #1).**
9. **Sidebar nav group animation — smoothed.** `.nav-group-items` switched from a fixed `max-height`
   (overshoots → looked abrupt) to the `grid-template-rows: 0fr→1fr` accordion (animates to exact content
   height); requires the added `.nav-group-items-inner` wrapper.

Toolbar (Issue 2 continued): the Workflow Builder toolbar is now a single low row — inline labels +
`overflow-x` scroll instead of tall wrapping.

- **Verified (real Electron):** build clean; edge `+` opens the picker on a **real** click; drag start→end
  shows the confirm dialog and creates the edge on confirm; no white screen (root renders). Regression:
  `verify:flow-designer` 14/14, `verify:workflow-builder` 18/18, `verify:canvas-perf` 13/13 (a mid-run
  perf regression from a non-stable connect callback was found and fixed via refs).

## Workflow Builder UI functionality/organization pass (2026-07-11)

## Workflow Builder UI functionality/organization pass (2026-07-11)

Renderer-only follow-up on the two node editors + one measurement script. No route/IPC/preload/
runner/schema/packaging change; saved documents and connector runtime semantics unchanged. Focus:
the reported Add-menu, toolbar, selection, and connector-drag issues in the Workflow Builder /
Workflow Designer.

- **Add menu now has a "Flow Logic" section** (`app/renderer/pages/ScenarioBuilder.tsx`): the
  contextual picker (blank right-click, edge `+`, leaf `+`, toolbar **Add**) lists **Conditional
  Branch / Parallel Branch / Loop** above **Saved Flows** — previously it only listed saved flows
  (the Flow Designer already had a Logic group; the Workflow Builder did not). These map onto AWKIT's
  existing connector kinds via new `applyWorkflowLogic()`: Conditional/Parallel branch the **selected**
  flow to up to two available saved flows with `conditional`/`parallel` connectors (labels If true/
  If false · Branch A/Branch B; the new connector opens in the drawer for editing); Loop toggles the
  node's self-loop connector (same edit as the kebab). A valid source flow is required — otherwise a
  toast guides the user and **no invalid/disconnected graph is created**.
- **Toolbar reorganized into labeled groups** (`.sb-toolbar-group` + `.sb-toolbar-sep` in `global.css`):
  **Workflow** (select · name · New · Reload · Settings · Export) │ **Add** │ **Execution** (mode ·
  parallel) │ **Layout** (Auto-arrange) │ right-aligned **status** (validation chip · save state).
  Save/Run stay in the top app header; zoom/fit stay in the canvas zoom pill (no duplicates). Stale
  Auto-arrange tooltip fixed ("top-to-bottom", matching the actual `direction: "TB"` layout).
- **On-canvas selection is now visible (both designers).** `ScenarioBuilder` and `FlowChartDesigner`
  never set `CanvasNode.selected`/`CanvasEdge.selected`, so clicking a node/connector opened the
  properties drawer but **never applied the `.selected` / `.is-selected` highlight** (the CSS existed).
  Both now fold selection into the node identity signature (so only the affected cards rebuild) and set
  `edge.selected`. Canvas-perf guard still green (editing one node = 3 card re-renders).
- **Connector-drag (Issue 1) revalidated + measurement harness fixed.** The `DraggingEdgeLayer`
  edge-follow was already correct; `scripts/measure-large-graphs.mjs` now **fits the view and drags the
  visible middle node nearest the canvas center** (was: first `n-*` in DOM order, which could be
  off-screen). Measured real Electron 40/100/200/500: drag re-renders **only the dragged node (20 for
  20 moves) and recomputes the static edge layer once** at every size (O(1) in graph size); zoom = 0
  re-renders; load 0.31/0.55/0.70/1.33 s; heap flat 21 MB (no leak, DOM 5779→5779).
- **Workflow Designer is intentionally read-only** (confirmed from code: `nodesDraggable={false}`,
  "read-only overview" copy, "Edit workflows in the Workflow Builder"). It exposes no misleading edit
  buttons and correctly has no Add menu — left as-is.
- **Verified:** `npm run build` clean; `verify:workflow-builder` **18/18** (adds Flow Logic section +
  Conditional/Parallel/Loop reachability + selection-highlight + Loop-creates-self-loop checks);
  `verify:flow-designer` 14/14; `verify:canvas-perf` 13/13; `verify:write-queue` 7/7;
  `verify:settings-persistence` 3/3; `verify:reports` 26/26; large-graph measurement green.

## UI performance — Phase 2 (2026-07-11)

## UI performance — Phase 2 (2026-07-11)

Follow-up to the Phase 1 canvas pass (below). Renderer changes plus `app/main/uiSettings.ts` +
`app/main/writeQueue.ts` + `app/main/main.ts`. No route/IPC/preload/runner/schema/packaging change;
saved documents and connector runtime semantics unchanged.

- **Node-edit re-render fix (biggest remaining win):** the designers derived the canvas node array with
  a plain `.map`, rebuilding every node's wrapper on any edit → editing one node re-rendered the whole
  graph. New `app/renderer/components/canvas/identityMap.ts` (`mapWithIdentity`) preserves per-node
  output identity (per-id cache keyed by source ref + a derived signature, pruned each pass, version-busted
  when shared callbacks change). Both designers use it. **Editing one node's name on a 40-node flow: 120 →
  3 card re-renders.**
- **Edges follow the dragged node again** (they snapped on drop after the React Flow removal): `FlowCanvas`
  tracks the live drag position (rAF-batched) and draws ONLY the dragged node's edges in a
  `DraggingEdgeLayer` overlay; the memoized `EdgeLayer` recomputes once at drag start (not per frame) and
  skips those edges. Cost is O(edges touching the dragged node), independent of graph size.
- **Settings persistence is now crash-safe and shutdown-safe:** the serial queue lives in the testable
  `app/main/writeQueue.ts` (`createSerialQueue`; FIFO, a failed write never poisons the next, `flush()`);
  `writeSettings` writes to a temp file then atomically renames over the target (Windows-safe); and
  `flushSettingsWrites()` runs on Electron `before-quit` (bounded 2s, guarded against re-entry/deadlock)
  so an edit made just before closing the window is not lost.
- **Large-graph glide guard:** the auto-arrange/load "glide" animates every node's `left`/`top`; above
  `GLIDE_MAX_NODES` (120, `app/renderer/lib/motion.ts`) it is skipped so large graphs snap instead of
  thrashing layout.
- **Measured on real Electron (40/100/200/500 nodes):** zoom re-renders **0 at every size**; load
  ~0.30/0.48/0.70/1.23 s (linear — measurement is O(N), not O(N²)); save 10–45 ms; a 10× in-session
  Flow⇆Workflow navigation leak check held heap 14→14 MB and DOM 5645→5645 (no accumulation). Tool:
  `scripts/measure-large-graphs.mjs`.
- **Regression guards added:** `npm run verify:write-queue` (7/7, unit `tsx`), `npm run
  verify:settings-persistence` (3/3, real Electron: 40 concurrent patches all persist, no leftover tmp
  files, before-quit flush), and `verify:canvas-perf` extended to 13/13 (adds node-edit-identity and
  edge-follow assertions).
- **Panels/listeners audit (no code change needed beyond the above):** the Node Palette picker unmounts
  when closed and memoizes its filter; Node/Connector Properties panels unmount when nothing is selected
  and collapse to a cheap rail; every `setInterval`/`ResizeObserver`/`addEventListener` has matching
  cleanup — no leaks found.
- **Verified:** build clean; write-queue 7/7; settings-persistence 3/3; canvas-perf 13/13;
  flow-designer 14/14; workflow-builder 14/14; reports 26/26; waits 21/21; data-editor 27/27;
  recorder 57/57; runner 82/82; instance-monitor 22/22; mock-site 29/29; ai:memory pass.

## Canvas UI performance pass (2026-07-11)

Renderer-only (plus one main-process file) optimization of the in-house canvas engine. No route,
IPC, preload API, runner/runtime, profile schema, or storage/packaging change; saved document shape
and all connector runtime semantics are unchanged.

- **Symptom:** panning, zooming, node interactions, and even typing a flow/workflow name felt laggy
  on non-trivial graphs.
- **Root cause (measured on a 40-node flow via a render probe):** the engine re-rendered **every**
  node card + edge layer on **every** viewport frame — zoom of 20 wheel ticks = 800 NodeContainer +
  800 card + 20 EdgeLayer renders — and typing 16 chars in the Flow Name field = 1280 node + 1280
  card renders. `NodeContainer`/`EdgeLayer` were unmemoized, and the designers passed inline
  callbacks to `<FlowCanvas>` (new refs every render defeated any memo).
- **Fixes:** `FlowCanvas.tsx` now memoizes `NodeContainer` (renders the node component internally,
  not via `children`, and reads zoom from `viewportRef` — so viewport-only changes never invalidate
  the memo) and `EdgeLayer`; `FlowChartDesigner.tsx` and `ScenarioBuilder.tsx` pass **stable**
  `useCallback` handlers; `app/main/uiSettings.ts` serializes all settings writes through a promise
  queue (no more racing read-modify-write on the many fire-and-forget `settings.update` calls).
- **After (same measurements):** zoom = 0/0/0, typing = 0/0/0, dragging one node re-renders only that
  node (20 for 20 moves, not 800) and never the edge layer during motion.
- **Regression guard:** opt-in `app/renderer/components/canvas/renderProbe.ts` +
  `npm run verify:canvas-perf` (`scripts/verify-canvas-perf.mjs`, 10/10) — structural (not timing)
  assertions, robust across machines.
- **Verified:** `npm run build` clean; `verify:canvas-perf` 10/10; `verify:flow-designer` 14/14;
  `verify:workflow-builder` 14/14; `verify:reports` 26/26.

## Canvas engine — React Flow removed (2026-07-11)

The three canvases no longer use React Flow (`@xyflow/react`). They render on a small **in-house canvas
engine** at `app/renderer/components/canvas/` (see `index.ts` barrel). Renderer-only change — no route,
IPC, preload API, runner/runtime, profile schema, or storage/packaging behavior changed. The saved
document shape and all connector *runtime* semantics (kinds/config, `validateConnectorStructure`,
orchestration) are unchanged; only the rendering layer was replaced.

- **Engine:** `FlowCanvas.tsx` provides viewport pan/zoom (CSS transform), node drag (position measured
  from the DOM via `ResizeObserver`), an SVG smooth-step edge layer (`geometry.ts` is a faithful port of
  React Flow's `getSmoothStepPath`/`getViewportForBounds` math), a dotted `Background`, fit-view, and
  screen↔flow mapping. `useCanvas()`/`useViewport()` hooks + a `FlowCanvasHandle` imperative ref
  (`fitView`/`zoomTo`/`screenToFlowPosition`) replace the old `useReactFlow`/`useViewport`. Edge labels
  and the insert `+` render through `BaseEdge`/`EdgeLabelRenderer` portaling into an in-transform HTML
  overlay. The flow runs **top→bottom**: every edge leaves a node's bottom-center and enters the next
  node's top-center; a self-loop is `source === target` and draws via `LoopEdge`.
- **DOM (for verifiers / future work):** node cards are `.awkit-flow-node[data-id]` (wrapping the
  existing `.action-flow-node`/`.scenario-flow-node`/`StepNode` markup); connectors are
  `g.awkit-flow-edge[data-source][data-target]` with `path.awkit-flow-edge-path`; the insert affordance
  is `.awkit-edge-add`; the pane is `.awkit-flow-canvas`. There is **no** `.react-flow__*` DOM, no
  handles/ports, and no `data-handleid`.
- **Intentionally removed** (user chose "adopt flowforge nodes as-is"): node resize (`NodeResizer`),
  branch-port dragging + the two-port branch model, edge reconnect, and port-drag-to-connect.
  Connections are made via the `+` insert / leaf append / Logic picker; loop is toggled from the node
  kebab menu. `connectorStyle.ts` still exports the old port helpers (`computePortFlags`,
  `reconcileBranchConnectors`, `portHandlesForKind`, `branchSourceHandle`, `portPositions`,
  `ConnectorPortFlags`) but they are now **unused** by the canvases (safe future cleanup).
- **Deleted files:** `shared/TemplateSmoothEdge.tsx`, `shared/SelfLoopEdge.tsx`,
  `shared/ConnectorPorts.tsx`, `workflow/CanvasZoomControl.tsx`. `@xyflow/react` removed from
  `package.json` (still present in `package-lock.json` + `node_modules` until `npm install` is run).
- **Verified:** `tsc --noEmit` clean; `electron-vite build` clean (renderer bundle 1,589 → 1,235 kB,
  ~355 kB smaller); real-Electron `verify:flow-designer` **14/14** and `verify:workflow-builder`
  **14/14** (both rewritten against the new DOM).
- **Supersedes** the renderer half of the "Structured connectors (Checkpoint B)" section below: its
  descriptions of visible ports, `useUpdateNodeInternals`, branch-pair handles, `SelfLoopEdge`, and
  `.react-flow__*` rendering are now historical. The connector *runtime* behavior it documents still holds.

## Workflow.rar UI migration (2026-07-11, Phases 0-6)

## Workflow.rar UI migration (2026-07-11, Phases 0-6)

Completed the local `AWKIT-Workflow-UI-Migration-Prompt-Pack` pass against the verified
`Workflow.rar` source (SHA-256 `9b3320b609e12da1032a94d4e156389e06f0e4315bc6983e0e76b18909795946`).
The existing Hologram reskin already covered most non-editor pages; this pass closed the remaining
structural and interaction gaps.

- **Shell:** expanded sidebar 240px, header 64px, exact reference canvas/theme tokens, collapsible
  navigation groups, and pre-paint theme bootstrap via a persisted local mirror.
- **Flow Designer:** permanent Node Palette unmounted. The shared 340px searchable picker opens from
  blank-canvas right-click, edge `+`, leaf `+`, and Add Node; all real non-sentinel catalog types remain.
  Existing node/connector forms render in the 400px overlay drawer. New empty flow state is `Start -> End`.
- **Workflow Builder:** permanent Workflow Definition/rails unmounted. The contextual picker adds real
  saved flows through blank canvas, edge insertion, leaf append, and Add Flow, retaining Load More.
  New workflows persist structural Start/End nodes plus their default edge. Flow, connector, and workflow
  settings use the overlay drawer.
- **Compatibility/runtime:** `WorkflowProfile.nodes` is a backward-compatible union of flow references
  and structural sentinels. Runtime conversion filters sentinels/boundary edges, so only real flows reach
  orchestration. Existing workflows load unchanged. IPC, preload, recorder, waits/locators, sessions,
  instances/reports, and packaging contracts are unchanged.
- **Evidence:** 32 route screenshots (8 routes x light/dark x 1600x1000/1366x768) plus light/dark picker
  and drawer states under `docs/ai/ui-reskin-template-plan/mockups/screenshots/workflow-migration-*`.
- **Verified:** build; Flow Designer 24/24; Workflow Builder 21/21; workflow sentinels 4/4;
  mock site 29/29; Recorder 57/57;
  recorder draft 17/17; recorder flow 13/13; Smart Wait 21/21; runner 82/82; data editor 27/27;
  instance monitor 22/22; Reports 26/26; offline validator pass. Final GUI counts are recorded in the
  completion report. Clean offline VM install/uninstall and code signing remain external release gates.

## Workflow/FlowForge visual parity (2026-07-10, Phases 0-5)

Renderer/CSS-only adoption of the Workflow/FlowForge ("Hologram") reference style + animations
(plan: `docs/plan-workflow-visual-parity.md`). No runner/orchestrator, IPC, preload API, or
profile-schema change. The two apps are siblings (same violet `#7c3aed`, same `[data-theme]`
theming), so most parity pre-existed — the work was targeted gaps plus a motion library.

- **framer-motion** `11.18.2` added (dep + offline manifest line). New motion primitives live in
  `app/renderer/lib/motion.ts` (springs, variants, `hoverTap`/`hoverLift`, `usePrefersReducedMotion`,
  `useFlowGlide`); all motion is reduced-motion aware (framer gated + the global CSS neutralizer).
- **Tokens:** `--awkit-edge`/`-strong`, `--awkit-shadow-node`/`-hover` added to both themes.
- **Canvas:** auto-layout **glide** (`.flow-animating`) in both node editors. Handles stay **visible**
  (AWKIT's deliberate ConnectorPorts design — not hidden like the reference).
- **Nodes:** `ActionFlowNode`/`ScenarioFlowNode` are `motion.article` (spring mount + hover-lift);
  hover-reveal kebab; elevation via the new shadow tokens. Old CSS node mount-fade removed (framer owns it).
- **Chrome:** animated sidebar collapse (`grid-template-columns` transition). Sidebar pill, theme
  toggle, page-enter, drawer slide-ins, button feedback already existed.
- **Pages:** card-grid **stagger** on `.page-grid` (`awkit-card-rise`, `backwards` fill so hover survives).
- **Verified:** `npm run build` ✅; GUI verifiers **58/58** (`verify:flow-designer` 19, `verify:workflow-builder`
  13, `verify:reports` 26). Renderer JS 1.29→1.54 MB (framer-motion DOM engine). Not run: clean-machine
  offline GUI walkthrough; manual reduced-motion/dark-theme eyeball still worthwhile.

## Canvas UX pass (2026-07-10, SRS-CANVAS-UX-001)

Renderer/CSS-only follow-up on the two node editors (spec: `docs/SRS_CANVAS_UX.md`). No runner/
orchestrator, IPC, preload, or profile-schema change; loop **runtime** semantics untouched.

- **Auto-layout (anti-stacking):** `app/renderer/components/shared/graphLayout.ts` — dependency-free
  cycle-safe layered layout. Both editors auto-arrange on load **only** when node positions are missing/
  stacked (fixes flows saved without positions collapsing onto `{280,120}`); manual layouts are preserved
  and persisted zoom survives normal loads (`fitView` runs only when a rearrange happened). A manual
  **Auto-arrange** toolbar button (TB in Flow Designer, LR in Workflow Builder) force-runs it.
- **Connector "+":** the inline midpoint add button (`TemplateSmoothEdge`) now works in **both** editors.
  Workflow Builder splices the first unused saved flow onto the clicked edge (`insertFlowOnEdge`) via a
  display-only `edgesForCanvas` map (never serialized). Button restyled to the reference art (always-
  visible white circle, subtle border, violet "+").
- **Dotted canvas:** light `--awkit-canvas-dot` darkened to `#c7c0d6` so the grid is perceptible.
- **Motion:** opacity-only mount fade for node cards + edges (never transform the measured RF wrapper),
  `:active` press on toolbar/icon buttons; all under the existing reduced-motion neutralizer.
- **Verified:** `npm run build` (tsc + bundles). Not run: `verify:runner`/mock-site (no runner change),
  clean-machine GUI walkthrough — visual conformance of branch connectors still to eyeball in-app.

## UI re-skin initiative — CLOSED (Phases 01-15, 2026-07-09)

The Hologram UI/UX re-skin initiative (downloaded prompt pack `01`–`15`) is complete. It was a
**renderer/CSS-only** program — no route, IPC, preload API (`window.playwrightFlowStudio`), runner/
runtime, profile schema, storage contract, or offline/packaging behavior was changed at any point.

**New UI/CSS architecture (for future agents):**
- **Single design-token system** in `app/renderer/styles/global.css`: a complete light token set under
  `:root`/`[data-theme="light"]` with a full `[data-theme="dark"]` override. All color/spacing/radius/
  shadow/motion resolve through tokens — `var(--awkit-*)` (surfaces, text, accent family incl.
  `--awkit-accent-rgb`, status ×soft/muted, canvas bg/dot, node, overlay, focus ring), `--space-*`,
  `--radius-{sm,md,lg,pill}`, `--awkit-shadow-{soft,card,float,hover}`, and motion
  `--awkit-motion-*`/`--awkit-dur-*`/`--awkit-ease-out`. The theme attribute is applied to `<html>` by
  `App.tsx` from the persisted `UiSettings.appearance` (`theme.tsx` context, OS-sync in system mode).
- **App shell** is a fixed grid: `.app-shell` = `260px minmax(0,1fr)` (76px collapsed) wrapping the
  full-height left `LeftNavigation` + `.app-main` (`60px 1fr 32px` → header / scrolling content /
  status bar). **Do not modify `.app-shell`/`.app-main` grids without explicit permission.**
- **React Flow** surfaces are theme-driven: dotted `BackgroundVariant.Dots` colored via
  `--awkit-canvas-dot`, RF `--xy-*` vars set for minimap/controls, node cards / connectors / floating
  config drawer / bottom zoom pill all tokenized. Visual changes to RF components must use the
  established classes/tokens in `global.css`; never animate node width/height/left/top (canvas
  coordinate + perf invariant).
- **Reusable base components** (do not build parallel systems): global `input/select/textarea`,
  `.toolbar-button` (primary/secondary + `:active`), `.awkit-table` + legacy `.wl-table`/
  `.instance-table` (uppercase muted headers, row hover), `.modal-overlay`/`.modal-dialog` (blurred
  backdrop, float shadow, `awkit-fade-in`/`awkit-pop-in` entrance), `MetricCard`, `EmptyState`,
  `SkeletonCard`, `StatusBadge`. Motion is transform/opacity-only and sits above a last-in-cascade
  `@media (prefers-reduced-motion: reduce)` neutralizer.
- **Enforced rules** (added this phase): `docs/ai/RULES.md` › UI now mandates token use (no hardcoded
  hex / arbitrary px), the app-shell-grid lock, and the a11y/focus/semantic-HTML rules; `AGENTS.md`
  carries the summary. New-component reviewers should check these.

**Phase 13 (Dark mode + a11y) — verified, no code change needed.** Audit + dark-mode screenshot
walkthrough (Dashboard, Reports, Flow Designer) confirmed the `[data-theme="dark"]` block already
meets the phase standards: deep slate `--awkit-bg #0e0d12` (not pure black), elevated surfaces
(`#16151c`→`#201f28`), off-white text `#f3f1f8` (not pure white), brighter accent `#8b5cf6`, inverted
canvas dots. Focus rings present via global `:focus-visible` (box-shadow ring alternative to
`outline`); interactive controls use semantic `<button>`. No token edits were warranted.

**Phase 14 (Visual QA) — golden snapshots captured.** 8 light + 8 dark baseline screenshots via
`scripts/capture-ui-screenshots.mjs` in
`docs/ai/ui-reskin-template-plan/mockups/screenshots/{golden,golden-dark}/`; a manual QA checklist +
the light/dark capture recipe were added to `docs/ai/TESTING.md`. No `toHaveScreenshot` regression
tests were added (no `npm test` script; `@playwright/test` Node caveat; dynamic data → flaky) —
documented rationale in TESTING.md.

**Phase 15 (Handoff/doc sync) — this entry** plus `TASK_LOG.md` consolidated entry and the new
`RULES.md`/`AGENTS.md` UI rules. Initiative officially closed; the codebase is ready for future
feature work on top of the token system.


## Phase 09-12 gap-based UI polish (2026-07-09)

Executed the downloaded `09_INSTANCES_AND_WORKFLOW_CARDS.md`, `10_REPORTS_AND_ANALYTICS_UI.md`,
`11_FORMS_TABLES_MODALS_AND_EMPTY_STATES.md`, and `12_MOTION_AND_MICRO_INTERACTIONS.md` prompts as a
**gap-based polish pass** (audit-first; close only genuine gaps; reuse existing tokens/classes; no
parallel systems). Renderer CSS-only; no route, IPC, preload API, runner/runtime, schema, state, or
persistence behavior changed. Audit found the repo already ~95% satisfies all four phases from prior
re-skin passes (motion tokens, reduced-motion neutralizer, focus-visible rings, modal overlay/dialog
with `awkit-fade-in`/`awkit-pop-in` entrance, tokenized SVG charts/gauges with no hardcoded hex,
semantic status badges, tokenized `input/select/textarea`, uppercase primary-table headers,
`MetricCard`/`EmptyState`/`SkeletonCard`).

- **Four small `global.css` edits:** `.workflow-card:hover/:focus-within` now adds
  `transform: translateY(-2px)` (Phase 09 subtle lift; transform-only, no grid reflow, reduced-motion
  snaps it); `.modal-overlay` gains `backdrop-filter: blur(3px)` for a blurred backdrop across
  ConfirmDialog / UnsavedChangesDialog / LiveExecutionReportModal (Phase 09/11); `.modal-dialog`
  radius `10px → var(--radius-lg)` (Phase 11 token alignment; `.report-modal` inherits it);
  `.awkit-table th` (report tables) now `text-transform: uppercase` + `letter-spacing` + soft-bg to
  match the established `.wl-table`/`.instance-table` header convention (Phase 10/11 consistency).
- **Deliberately not done (documented):** no new `.awkit-input/.awkit-select/.awkit-button` classes
  (global element rules + `.toolbar-button` already cover forms/buttons — adding them would be a
  parallel/dead system); no rewrite of the duration-based reduced-motion neutralizer to
  `transition:none` (existing approach is intentional and working). Noted for future cleanup: the
  `.workflow-run-card` selectors (~lines 7615/7626) appear unused — the component renders
  `.workflow-card`.
- **Verified:** `npm run build` pass (tsc --noEmit + electron-vite bundles); `verify:reports` 26/26;
  `verify:instance-monitor` 22/22 (both after `node scripts/helpers/reset-ui-state.mjs`).
  `verify:runner` not run (no runner/runtime logic touched). All edits use theme-aware tokens
  (light/dark correct); the new hover transform is auto-covered by the last-in-cascade reduced-motion
  block.

## Phase 03-08 UI execution pass (2026-07-09)

Executed the downloaded `03_APP_SHELL_AND_NAVIGATION.md` through `08_RECORDER_UI_REDESIGN.md` prompts in
order. Renderer/UI-only pass; no route, IPC, preload API, recorder service, runner, profile schema,
storage contract, dependency, or build-process behavior changed.

- **Shell/navigation:** preserved the existing `AppShell`, `LeftNavigation`, and `TopHeader` structure while
  pinning the sidebar to full viewport height, routing nav hover/active states through neutral/lavender
  tokens, and switching the bottom-center zoom pill to the tokenized soft shadow.
- **Canvas/node/inspector/library surfaces:** React Flow dot backgrounds now use the requested subtle
  `gap={24}` / `size={1}` across Flow Designer, Workflow Builder, and Workflow Designer. Existing node-card
  anatomy, connector handles, `NodeResizer`, right inspector/property panels, AI/palette search, work panels,
  tables, and empty-state behavior were preserved.
- **Recorder UI:** `Recorder.tsx` is now a tokenized, class-based control-center layout with a sticky
  recorder control bar, grouped switches, active recording status, disabled URL/flow-name inputs while
  recording, protected-login handoff panel styling, an auto-scrolling action timeline with per-action
  icon/tone/locator/value/smart-wait details, inline save feedback, and a restyled recorded-URLs section.
  Existing recorder IPC calls, polling, protected-login handoff handlers, URL history, and
  `recorder.saveFlow()` behavior were preserved.
- **Verified:** `npm run typecheck` pass; `npm run build` pass; `verify:flow-designer` 19/19 after the
  documented `node scripts/helpers/reset-ui-state.mjs flowChart false` state reset (the first raw run timed
  out waiting for `.action-flow-node` because persisted UI state opened Workflow Builder with the sidebar
  collapsed); `verify:workflow-builder` 13/13 after reset; `verify:recorder` 57/57; `verify:recorder-flow`
  13/13. `verify:runner` was not run because runner/runtime automation logic was untouched.

## Phase 01/02 UI audit + token foundation compatibility pass (2026-07-09)

Executed the downloaded `01_REPO_UI_AUDIT.md` then `02_DESIGN_TOKENS_AND_THEME.md` prompts against the
current repo state. Renderer/CSS-only follow-up; no route, IPC, schema, runner, automation, dependency,
or build-process behavior changed.

- **Phase 01 audit result:** current source is already past the original baseline prompt. `global.css` is
  a large single stylesheet with a complete Hologram-style light token block and dark override; `AppShell`
  keeps the full-height left sidebar plus `.app-main` header/content/status grid; Flow Designer,
  Workflow Builder, and Workflow Designer use React Flow `BackgroundVariant.Dots`, `Controls`, and the
  shared connector/zoom/template-edge components. This pass did not alter the existing React Flow
  background configuration.
- **Phase 02 token pass:** added the missing compatibility tokens requested by the prompt while preserving
  the existing `--awkit-*` system: `--radius-md: 12px`, new `--radius-lg: 16px`, light/dark
  `--awkit-lavender-soft`, light/dark `--awkit-shadow-soft` with `--shadow-soft` alias, and
  `--awkit-node-selected-bg` now resolves through the lavender token.
- **Verified:** `npm run build` pass; `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13.
  `verify:runner` was not run because runtime automation logic was untouched.

## Flow/Workflow canvas dots matched to attachment (2026-07-08)

Renderer/UI-only dot-grid follow-up; no route/IPC/schema/runner automation behavior changed. Flow Designer
and Workflow Builder now use the attached sparse lavender dot field: React Flow `BackgroundVariant.Dots`
is `gap={44}` / `size={2.4}`, the two light-mode canvas containers scope `--awkit-canvas-bg: #f4f1f8`
and `--awkit-canvas-dot: #cac5d3`, and `.react-flow__pane` is transparent so the SVG background dots are
actually visible. The earlier Form-Designer-style framed-card experiment remains reverted.

Verified: `npm run build` pass, `verify:flow-designer` 19/19 (stable local `login-flow` selection; current
`test-mock` local flow made the drag branch check flaky), `verify:workflow-builder` 13/13, `ai:memory`
pass. Refreshed after-screenshots:
`ui-reskin-template-plan/mockups/screenshots/after/02-flow-designer.png` and `04-workflow-builder.png`.

## Template UI — Codex completion evidence + token/status polish (2026-07-08)

Codex completed the requested local-template implementation pass against `UI Samples/sample_01.png`, the
attached matching image, the three local mp4 references (present; fresh extraction attempted but blocked by
missing `ffmpeg`/media libraries and a Chrome seek timeout), and the reachable Dribbble text pages. Report:
`ui-reskin-template-plan/19_CODEX_TEMPLATE_COMPLETION_REPORT.md`; implementation plan:
`ui-reskin-template-plan/18_CODEX_TEMPLATE_IMPLEMENTATION_PLAN.md`.

Renderer/UI-only changes; no route/IPC/schema/runner/automation behavior changed. Verified:
`npm run typecheck` pass, `npm run build` pass, `verify:flow-designer` 19/19, `verify:workflow-builder`
13/13, `verify:reports` 26/26, `verify:instance-monitor` 22/22, `verify:data-editor` 27/27,
`verify:recorder` 57/57, `ai:memory` pass. Fresh after-screenshots captured in
`ui-reskin-template-plan/mockups/screenshots/after/` including a direct hidden-route
`05-workflow-designer.png` and optional `10-dark-flow-designer.png`.

- **Light template tokens aligned to the prompt:** `global.css` now uses the requested Hologram-style
  light palette (`--awkit-bg: #f6f4f9`, `--awkit-bg-canvas: #f3f0f8`, `--awkit-accent: #7c3aed`,
  text/muted/border/radius/shadow/motion aliases) while retaining dark-mode overrides.
- **Status bar no longer shows fake placeholders.** `StatusBar.tsx` polls real
  `executions.runtimeStatus()` and shows Flows/Browsers/Queue plus runtime nominal/backpressure/error
  status chips. The prior static `Active Instances: 0`, `Queue: 0`, `Last Error: None` placeholders are gone.
- **Loader/state utilities added:** `.awkit-spinner`, `.awkit-loader-dot`, `.loading-panel`,
  `.skeleton-card`, `.skeleton-shimmer`; all are covered by the existing last-in-cascade
  `prefers-reduced-motion` neutralizer.
- **Inline legacy border cleanup:** remaining UI-surface border hex values in `Recorder.tsx`,
  `SessionsManager.tsx`, and `RecoverableRunsPanel.tsx` now use `--awkit-*` tokens. Remaining TSX literal
  colors are intentional connector presets and the distinct Reports Failures chart palette.
- **Body overflow made explicit:** `html`, `body`, and `#root` are full-height with hidden overflow; canvas
  and page panels continue to scroll internally.

## Template UI — final visual acceptance + hardening (2026-07-07)

Strict acceptance pass over every template surface (report:
`ui-reskin-template-plan/17_FINAL_VISUAL_ACCEPTANCE_REPORT.md`). Renderer visual/CSS only; no
route/IPC/runner/schema/automation change. All areas pass with screenshot+code evidence; three safe
fixes applied. Verified: `npm run build` clean; `verify:flow-designer` **19/19 run twice** (via new
reset helper, from two different start states — proves state-independence), `verify:workflow-builder`
13/13, `verify:reports` 26/26, `verify:recorder` 57, `verify:instance-monitor` 22, `verify:data-editor`
27; `ai:memory` pass. Fresh after-screenshots for all 8 surfaces in
`ui-reskin-template-plan/mockups/screenshots/after/`.

- **Fix — floating drawer no longer covers the in-canvas action bar.** On flush designer pages (Flow
  Designer, Workflow Designer) the drawer's `top:18px` was measured from the whole `.designer-layout`,
  overlapping the action bar's right controls (Flow Name / Load / Delete / `N issues` / Workflow select).
  Added `.designer-layout.flush-layout .designer-right-drawer-slot { top: 62px }` so the drawer starts
  below the action bar (Form Designer, non-flush, keeps the 18px inset).
- **Fix — tokenized stray legacy borders.** `1px solid #dfe6ef` (×6) + `1px solid #e2e8f0` (×1) inline
  borders → `1px solid var(--awkit-border)` in `Recorder.tsx` and `SessionsManager.tsx` (now theme-aware).
- **New — verifier-only UI-state reset helper** `scripts/helpers/reset-ui-state.mjs`
  (`node scripts/helpers/reset-ui-state.mjs <routeId> <collapsed:true|false>`): resets only
  `ui-settings.json` `lastRouteId`/`sidebarCollapsed` before a GUI verifier so the documented
  route/collapse-state gotcha can't flake a run. Dev/verifier-only (no production/route/schema change);
  intentionally NOT wired into the green verifiers to avoid destabilizing them.
- **Proven:** display-only edge fields `showAddButton`/`onInsertNode` never serialize — absent from
  `src/` and from `FlowEdge` (`FlowProfile.ts`); `toFlowProfile` reads explicit connector fields only.
- **Deliberate gaps (unchanged):** Setup/**Test** tabs are visual (Test disabled — no fake runner);
  connector `+` inserts a default `Click` node (TODO type chooser); `ScenarioFlowNode` keeps its existing
  numbered-badge card (only its connectors use `templateSmooth`); the `workflow` (Workflow Designer)
  route is a read-only overview not present in the sidebar nav (pre-existing).



## Template UI completion pass — drawer / nodes / connectors / motion (2026-07-07)

Implemented the **structural Hologram-template details the earlier token-only + shell re-skin left
out** (spec pack under `docs/` + `docs/files/`; gap report `ui-reskin-template-plan/16_VISUAL_GAP_CLOSURE_REPORT.md`).
Renderer visual/markup + CSS only — no route/IPC/runner/schema/automation change; canvas coordinate
invariants preserved. Verified: `npm run build` clean; `verify:flow-designer` 19/19,
`verify:workflow-builder` 13/13, `verify:reports` 26/26, `verify:recorder` 57, `verify:instance-monitor`
22, `verify:data-editor` 27; `ai:memory` pass. After-screenshots in
`ui-reskin-template-plan/mockups/screenshots/after/`.

- **Floating config drawer (was a grid column):** `DesignerCanvasLayout` now wraps the right panel in a
  pointer-transparent `.designer-right-drawer-slot` that floats over the canvas (top/right/bottom 18px);
  `.designer-layout` collapsed to a single canvas column so the workflow surface keeps full width. React
  Flow re-fits on the resize (no mount transform — canvas invariant intact).
- **Config-drawer shell:** `FlowNodePropertiesPanel` + `ConnectionPropertiesPanel` are now
  `template-config-drawer`s — sticky header (icon tile + title + collapse/delete), **Setup/Test tab strip**
  (Test disabled — no fake test runner), a single scroll region `.properties-body`, and a sticky footer
  (`Done`; connector panel also shows a disabled `Run Test`). All existing fields/validation/locking
  preserved. Grid rows `auto auto 1fr auto` ⇒ only the body scrolls.
- **Template node-card anatomy:** `ActionFlowNode` renders icon tile + metadata row (catalog label + type
  badge) + bold title + description + kebab (`MoreHorizontal`, pointer/click-stopped so it never breaks
  drag/select). NodeResizer, ports, and the loop button are unchanged (verifier still 19/19; card keeps
  `overflow:hidden` — ports are siblings so never clipped).
- **Template connectors:** new `components/shared/TemplateSmoothEdge.tsx` (curved violet `BaseEdge` +
  `EdgeLabelRenderer` label pill + hover-revealed `+` insert button + running-flow dash animation).
  `connectorStyle.ts`: `connectorTypeColor` values are now **CSS-variable strings**
  (`--awkit-connector-*`, violet default; semantic red/green kept for real outcomes) and
  `buildConnectorVisual` remaps runtime edge `type` `smoothstep → templateSmooth` (**saved
  `EdgeVisualStyle.shape` is untouched**). Registered on Flow Designer, Workflow Builder
  (`ScenarioBuilder`), and Workflow Designer canvases. Flow Designer adds `insertNodeOnEdge` (splits an
  edge with a `Click` node) via a **display-only `edgesForCanvas`** memo — `showAddButton`/`onInsertNode`
  are never serialized (`toFlowProfile` reads connector fields explicitly; they were added as optional
  non-persisted fields on `FlowConnectionData`).
- **Zoom pill:** `CanvasZoomControl` buttons carry `canvas-zoom-button` + a `canvas-zoom-divider` before
  Fit; styled as a hover-lifting pill.
- **CSS:** one appended **TEMPLATE COMPLETION PASS** block in `global.css` (connector/motion tokens,
  drawer slot + single-column designer layout, drawer header/tabs/body/footer, node anatomy, connector
  label/add/flow, zoom-pill buttons, palette slide-in), placed **before** the last-in-cascade
  reduced-motion neutralizer so all added motion is disabled under `prefers-reduced-motion`.
- **Gotcha re-confirmed (not caused by this work):** the GUI verifiers depend on persisted route +
  sidebar-collapse state — `verify:flow-designer` needs an **expanded** sidebar + a matching route;
  `verify:workflow-builder` needs a **collapsed** sidebar (clicks `nav-item[title=…]`). Reset
  `%LOCALAPPDATA%/WebFlow Studio/storage/ui-settings.json` `lastRouteId`/`sidebarCollapsed` between runs.

## Missing-template design pack — structural shell re-skin (2026-07-07, Phases 1–5)

Completed the "Missing Template Design" prompt pack (`docs/ai/ui-reskin-template-plan/01..05`) — the
**structural** template work the earlier token-only re-skin left out. Visual/layout only; no
route/IPC/runner/schema changes; `window.playwrightFlowStudio`, React Flow handle IDs/edge schema,
and the canvas no-mount-transform rule preserved. Verified: `npm run build` clean;
`verify:flow-designer` 19/19, `verify:workflow-builder` 13/13, `verify:reports` 26/26,
`verify:instance-monitor` 22, `verify:recorder` 57/57, `verify:data-editor` 27/27.

- **Shell layout corrected (Phase 2):** the sidebar is now **full-height on the left** and the top
  header renders **only over the main content** (matches the Hologram template). `AppShell.tsx`:
  `.app-shell` is `grid-template-columns: 260px minmax(0,1fr)` (76px collapsed) wrapping
  `<LeftNavigation>` + a new `.app-main` (`grid-template-rows: 60px 1fr 32px` → header / content /
  status). The old full-width `.app-body` top-header layout is gone.
- **Sidebar re-skin (Phase 3):** brand **workspace tile** at top; Settings relocated from the System
  group into a pinned **footer utility area** (Settings nav + Dark Mode toggle + a non-interactive
  workspace identity row). Collapsed sidebar remains a polished 76px icon rail.
- **Header re-skin (Phase 3):** a real **"Unsaved changes" status chip** appears when the active
  editor is dirty (`chrome.dirty` threaded `App → AppShell → TopHeader`; `.header-status-chip`).
  No fake data/controls (honors RULES). Icon-square back button; purple primary CTA retained.
- **Shared polish (Phase 4):** template KPI-card hover-lift (`.metric-card`) + elevated purple CTA
  (`.toolbar-button.primary`), transform/shadow-only inside the reduced-motion neutralizer.
- **Canvas/drawer/motion (Phase 5):** confirmed already delivered by the token re-skin (dotted
  canvas, 16px node cards + type badge + purple/lavender selection + hover-lift, **floating** rounded
  properties drawer with float shadow + uppercase section labels, floating bottom-center zoom pill,
  reduced-motion). No structural drawer rewrite (would risk canvas coordinate stability).
- **New helper:** `scripts/capture-ui-screenshots.mjs [subdir]` — launches the built app and captures
  route screenshots for before/after evidence (`docs/ai/ui-reskin-template-plan/mockups/screenshots/`).
- **Gotcha (pre-existing, re-confirmed):** GUI verifiers navigate by nav **title** (workflow-builder —
  matches only when the sidebar is **collapsed**) vs. visible **text** (flow-designer — matches only
  when **expanded**); a collapsed sidebar + a restored non-matching route can time a verifier out.
  Reset the app's route/collapse state between runs. Not caused by this work.

## Hologram UI re-skin + theme system (2026-07-07)

- **Full visual re-skin to the user-provided Hologram template** (light SaaS style: off-white shell,
  white sidebar/cards, violet `#6d28d9` accent, 16px card radius, dotted canvas, floating right
  drawer + bottom zoom pill) implemented as a **token-only + CSS re-skin** — no route/IPC/runner
  changes. Template sources: `UI Samples/sample_01.png` + 3 mp4s (frames extracted via system
  Chrome; Playwright's bundled Chromium cannot decode H.264).
- **Design tokens:** `global.css` now has a complete light token set under `:root`/`[data-theme="light"]`
  and a full dark override under `[data-theme="dark"]` (surfaces, text, accent family incl.
  `--awkit-accent-rgb` triplet for rgba glows, status ×soft/muted, canvas bg/dot, node tokens, glass/
  overlay, shadows, focus ring). All ~548 hardcoded hex values in `global.css` and ~170 inline hex
  values in renderer TSX were replaced by `var(--awkit-*)` references (property-aware for `#fff`:
  `color:` → `--awkit-accent-contrast`, backgrounds → `--awkit-surface`). `ReportsFailures.tsx`
  keeps its 14-hue category palette literal (deliberate — distinct chart hues).
  `var()` in SVG presentation attributes verified working in Chromium (charts/minimap).
- **Theme persistence:** `UiSettings.appearance: "light" | "dark" | "system"` (default light,
  backward compatible via hydrate). Renderer `state/theme.tsx` (`ThemeContext`, `useTheme`,
  `resolveAppearance`) + App.tsx applies `data-theme` on `<html>` and follows OS changes live in
  system mode. Sidebar bottom gets a template-style **Dark Mode toggle** (LeftNavigation);
  Settings > Application gets an **Appearance** select (applies immediately, persists; reset syncs).
- **Canvas:** all three React Flow canvases use the dotted `BackgroundVariant.Dots` grid colored via
  CSS (`.react-flow__background circle` → `--awkit-canvas-dot`); RF v12 `--xy-*` variables set for
  minimap/controls theming. Node cards (`.action-flow-node`, `.scenario-flow-node`): 16px radius,
  no left color bar (validation now = amber/red border+ring; selection = purple border + lavender
  `--awkit-node-selected-bg` + ring; selection wins over validation). Scenario execution-mode tint
  moved to the order badge. `connectorTypeColor` retuned (always/parallel → violet family; semantic
  green/red/amber kept); `CanvasZoomControl` is now a bottom-center floating pill.
  **Canvas invariants preserved and GUI-verified:** `verify:flow-designer` 19/19,
  `verify:workflow-builder` 13/13 (needs seeded fixtures + `lastRouteId`/collapsed-sidebar nav —
  see KNOWN gotcha: the verifier clicks `nav-item[title="Workflow Builder"]`, which matches only
  when the sidebar is collapsed since expanded items use description titles).
- **Shell:** sidebar nav items (36px, purple soft active pill, hover), uppercase group labels,
  brand block, top header buttons (10px radius, purple primary with hover), themed scrollbars,
  global `:focus-visible` ring, `::selection`, `color-scheme` per theme.
- **Motion:** button/nav/switch transitions, node hover lift, modal fade+pop entrance — all
  transform/opacity, inside the existing last-in-cascade reduced-motion neutralizer.
- **Verified this pass:** `npm run build` clean ×5; `verify:flow-designer` 19/19;
  `verify:workflow-builder` 13/13; `verify:reports` 26/26; plus screenshot walkthrough of
  Dashboard/Flow Designer/Workflow Builder/Recorder/Instances/Settings in BOTH themes via
  Playwright `_electron` (light + dark render correctly; minimap dark fix applied).
  `verify:instance-monitor`, `verify:data-editor`, `verify:recorder` run at end of task (see
  TASK_LOG). Settings **import** does not live-refresh the theme context (appearance applies on
  next launch) — minor known gap.

## Git-cycle verification (2026-07-07)

- User explicitly requested committing and pushing all current project changes on
  `feature/smart-wait-engine` (overriding the prior handoff's "do not push unless explicitly asked"
  caution).
- Fresh local verification before staging: `npm run build` pass; `npm run verify:runner` 82/82;
  `npm run verify:recorder` 57/57; `npm run verify:telemetry` 39/39; `npm run verify:reports` 26/26;
  `npm run verify:waits` 21/21; `npm run verify:mock-site` 28/28; `npm run validate:offline` pass;
  `npm run verify:concurrency` 78/78.
- No new product behavior was introduced by the Git-cycle task itself; it preserves and publishes the
  already-documented local workset.

## Phase 5.1 verification (2026-07-07)

- **Chromium no-egress hardening validated end-to-end.** `src/runner/ChromiumHardening.ts`
  (`buildChromiumHardeningArgs`) is wired into the runner (`BrowserContextFactory`) and both recorder
  launch paths, and is deliberately NOT applied to the user's real Chrome (`SessionCaptureService`).
  It builds background-service switches + a `--disable-features` **superset of Playwright 1.61's list**
  (verified against the installed `playwright-core` bundle — last-wins replace, so the superset is
  required) + `--host-resolver-rules` mapping Google service hosts to loopback + gaia/search redirect
  switches, plus four pinned Playwright behavioral defaults (`--disable-popup-blocking` etc.). Toggle:
  `AWKIT_CHROMIUM_OFFLINE_HARDENING` (default on) + `AWKIT_CHROMIUM_EXTRA_ARGS`.
  - `npm run verify:chromium-hardening` **13/13** (machine ONLINE): the bundled Chromium under the
    hardened args made **ZERO non-loopback TCP connections** over a 20 s idle window, AND navigation
    to external sites (incl. `google.com`, whose SERVICE hosts are loopback-mapped) still worked.
  - `npm run verify:packaged-walkthrough` re-run with **`AWKIT_WALKTHROUGH_STRICT_NET=1`** → **70/70**:
    the strict check (bundled Chromium makes no non-loopback connections) now **PASSES** — the Phase 5
    Google-service burst is eliminated in the packaged app. App processes stayed loopback-only; teardown
    left no zombie app/Chromium. **This resolves the Phase 5 egress WARNING** (see KNOWN_ISSUES #3).
- **Packaged-process teardown proven.** `scripts/helpers/packaged-process-tree.mts` captures the
  launcher-stub PID and the real Electron main PID (`app.evaluate(() => process.pid)`), tree-kills the
  real main on cleanup (including failure paths), and asserts no zombie app/Chromium remain — used by
  `verify:packaged-runtime` (**25/25**) and `verify:packaged-walkthrough` (**70/70**), both of which
  reported a fully-terminated process tree.
- **Packaging finding (this machine): max-compression packaging OOMs.** The default
  `npm run package:portable` / `package:nsis` (7-Zip `-mx=9` over the ~1.2 GB payload) failed with
  `Can't allocate required memory!` on this 16 GB machine, so the **shippable** max-compressed EXEs
  could not be produced here. `electron-builder` did rebuild `dist/win-unpacked` (the shared app
  payload — now **hardened**), and one-off `-c.compression=store` builds produced **hardened**
  validation-grade EXEs: portable `WebFlow Studio 0.1.0.exe` (~1.23 GB) + NSIS
  `WebFlow Studio Setup 0.1.0.exe` (~376 MB) + a regenerated `latest.yml` whose sha512 was
  re-verified against the new installer (MATCH). These are uncompressed-payload artifacts for
  validation only; produce the max-compressed + signed distributables on a higher-memory machine.
  The `package-portable.ps1` / `package-per-user-installer.ps1` wrappers were **fixed** to fail on a
  non-zero `electron-builder` exit (they previously printed success and left a stale EXE — see
  KNOWN_ISSUES). All packaged verifiers run against `dist/win-unpacked`, which is hardened.
- **Full re-verification green** (2026-07-07): build clean; `validate:offline` pass;
  `verify:chromium-hardening` 13; `verify:packaged-runtime` 25; `verify:packaged-walkthrough`
  (strict) 70; durable-store 11; durable-locks 17; cancellation 12; safety-policy 17;
  dynamic-origin-claims 14; resource-sampling 14; startup-recovery 10; concurrency 78; locks 15;
  browser-pool 13; watchdog 13; artifacts 13; runtime-status 15; runner 82; waits 21;
  protected-login 16; recorder 57; mock-site 28; stress:concurrency 13; stress:cancellation 8;
  stress:locks 10; stress:artifacts 7; soak:runtime 8; `ai:memory` pass. `npm test` / `npm run lint`
  still do not exist.
- **Release-candidate decision remains `PASS WITH WARNINGS`.** Egress is now hardened and proven, but
  the remaining human gates are unchanged: the clean/offline Windows VM walkthrough
  (`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3), the NSIS install/uninstall cycle (integrity sha512
  verified only), producing signed + max-compressed distributable EXEs on a higher-memory machine, and
  code-signing (EXEs are unsigned).

**Last updated:** 2026-07-06 (Claude Fable 5 — Phase 5 Release-Candidate Gate, on top of Phase 4
Release Hardening. NEW: `npm run verify:packaged-walkthrough` (**68/68**) drives the REAL packaged
EXE (`dist/win-unpacked`, the exact portable/NSIS payload) with a **fresh empty LOCALAPPDATA
root** — clean first-run simulation: first-run init + folders + sample-only content, full workflow
run to `completed` with artifacts, hard cancellation (run ends `cancelled`, Chromium tree gone,
slot/locks freed), 4-instance run never exceeds the 2-browser OS-level cap, recorder start/cancel,
hard kill of the REAL main pid → startup recovery surfaces the run `orphaned`/recoverable, the
Recoverable Runs panel renders and markReviewed clears it, `runtime.sqlite` reads externally, the
ACTUAL portable EXE boots a second fresh profile, NSIS sha512 matches `latest.yml`, and the app's
own processes made ZERO non-loopback TCP connections (bundled-Chromium per-launch Google-service
burst documented as a WARNING — see KNOWN_ISSUES "Phase 5 packaged-walkthrough findings", which
also records the launcher-stub pid gotcha, `dryRun:false` requirement, and instance-id decoration).
Release-candidate decision: **PASS WITH WARNINGS** — the packaged build is validated on the dev
machine with a clean profile, but the true clean/offline Windows VM walkthrough
(`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3) has NOT been performed (no VM available to the
agent) and remains the final human gate; EXEs are unsigned. Phase 5J full re-verification, all
green: build clean, `validate:offline` pass, `verify:packaged-runtime` 24, `verify:durable-store`
11, `verify:durable-locks` 17, `verify:cancellation` 12, `verify:safety-policy` 17,
`verify:dynamic-origin-claims` 14, `verify:resource-sampling` 14, `verify:startup-recovery` 10,
`verify:concurrency` 78, `verify:locks` 15, `verify:browser-pool` 13, `verify:watchdog` 13,
`verify:artifacts` 13, `verify:runtime-status` 15, `verify:runner` 82, `verify:waits` 21,
`verify:protected-login` 16, `verify:recorder` 57, `verify:mock-site` 28, `ai:memory` pass.
`npm test` / `npm run lint` still do not exist. See `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md`.)

## What currently works (Confirmed)

- **Build & typecheck:** `npm run build` (`tsc --noEmit` + electron-vite main/preload/renderer) passes.
- **AI memory handoff/takeoff:** `docs/ai/HANDOFF.md` is the active generic handoff note for Claude Code,
  Codex, Gemini, Antigravity, future agents, and human developers. `/HANDOFF` command/workflow files
  prepare the repo for the next agent; `/TAKEOFF` command/workflow files resume from the handoff by reading
  memory and inspecting actual repo state before editing. The AI memory checker requires `HANDOFF.md` and
  warns if important handoff sections are missing.
- **AI agent architecture:** Shared source of truth is `AGENTS.md` + `docs/ai/` (indexed by
  `docs/ai/README.md`); Claude Code uses `CLAUDE.md`, `.claude/commands`, and `.claude/skills`
  (`ai-memory-maintainer`, `codebase-review`, `feature-implementation`, `bug-fix`,
  `test-and-verify`, `docs-sync`, `refactor-safe`, `pr-review`, `mock-site-maintainer`);
  Codex/Antigravity/future agents use `.agents/skills` + `.agents/workflows` (including
  `mock-site-maintainer`); Gemini uses `.gemini/commands` and `.gemini/skills/mock-site-maintainer`;
  Cursor uses `.cursor/rules`.
  A cross-agent **`git-full-cycle`** skill (safe Git lifecycle: status, dirty-tree handling, branching,
  commit, push, PRs, protected `main`, stacked PRs) is mirrored byte-identically under
  `.claude/skills/`, `.codex/skills/`, `.gemini/skills/`, and a canonical `docs/ai/skills/` copy, and is
  referenced from `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`.
  `node scripts/ai-memory/check-memory.mjs` validates required memory files and warns for optional
  adapter/skill gaps.
- **Offline packaging:** `npm run package:portable` and `npm run package:nsis` produce
  `dist/WebFlow Studio 0.1.0.exe` (portable, ~310 MB) and `dist/WebFlow Studio Setup 0.1.0.exe`
  (per-user NSIS, ~357 MB) — both rebuilt 2026-07-06 with the `sql.js` durable-runtime dependency
  (WASM inside app.asar; unsigned; test-fixtures excluded). Strict offline validation
  (`validate:offline`) passes and now also requires the sql.js dist files + manifest flags;
  bundled Chromium at `resources/browsers/chromium/chrome.exe`; dependency manifest is BOM-free,
  valid, and declares `sqlJsRuntimeIncluded`/`sqlJsWasmIncluded`/`dependencies.sqlJs`. The packaged
  runtime is smoke-verified by `npm run verify:packaged-runtime` (24/24 — real EXE launch, durable
  store init, `%LOCALAPPDATA%` paths, external SQLite read).
- **Offline startup gate:** packaged app validates required assets before opening a window
  (`app/main/main.ts` + `evaluateOfflineStartupGate`); shows a styled blocking dialog if missing.
- **Runner execution (live-verified, `npm run verify:runner` → 82/82):** goto, click, fill
  (+clearBeforeFill), select (single/multiple), check/uncheck/radio, wait (time/selector/
  navigation/networkIdle/textVisible), assertion (visible/text/value/count/url × operators),
  scroll (direction/element), screenshot (full-page/element), upload, download, loop
  (fixed/elements/dataRows with guard), runFlow with recursion guard (direct/indirect/max-depth),
  **routeChange** (switchToUrl / switchToLatestTab / waitForNewTab / navigateCurrentPage — switches
  the active page so later steps target the new tab), **saveSession** (writes Playwright `storageState`
  — cookies + localStorage/origins — to `<runtimeRoot>/sessions/<name>.json`; never logs secret values),
  and manual/protected-login handoff pause/resume (the runner stays alive and continues the next browser
  step after `ManualHandoffController.resume`).
- **Multi-Window / Popup Flow Handling (live-verified, `npm run verify:popup` → 12/12):** `StepExecutor` handles steps with `pageAlias` by resolving the target window from a `PageRegistry`. Click steps with `opensPopup` wait for the new page event and register it. Explicit `switchToPopup`, `switchToMainPage`, and `closePopup` nodes mutate the active context for subsequent steps. Flow Designer canvas shows visual context badges.
- **Connector routing (live-verified):** flow-level success/failure/conditional/always; workflow-level
  link routing (success/failure/conditional/always) with strict traversal + linear fallback.
- **Structured connectors (Checkpoint B, live-verified):** every connector has a `kind` —
  `normal` / `conditional` / `parallel` / `loop` — with structured config on `FlowEdge`
  (`conditional`/`parallel`/`loop`). **Conditional** connectors (`ConditionalConnectorConfig`) route by a
  `sourceField` (outcome / status / errorCode / variable / dataSourceValue) + operator (equals, contains,
  exists, greaterThan, truthy, …) + `expectedValue`, with `priority` breaking ties (highest wins; no match
  → safe stop). **Parallel** connectors (`ParallelConnectorConfig`) honor `joinMode` (waitAll/waitAny) and
  `failMode` (failFast/collectErrors) plus an **`isolation`** mode: `sharedPage` (default) runs branches as
  sequential fan-out on the current page (safe, no concurrent UI mutation); `isolatedPage` runs branches
  **concurrently**, each on its own page in the shared browser context (shared session, independent DOM),
  bounded by `maxConcurrency`. **Loop**
  connectors (`LoopConnectorConfig`) are **self-loops only** — source and target must be the same node
  (Point 4) — and repeat that node in `count` / `staticList` / `dataSource` / `whileCondition` mode, bounded
  by `maxIterations` (hard cap 1000), injecting the loop value under `parameterName` (read via a
  `runtimeInput` value source); the node's own (Conditional-only, Point 3) exit edge then continues the flow.
  Evaluation lives in `src/runner/ConnectorConditionEvaluator.ts`; routing in `FlowExecutor`
  (`executeFlow` detects a self-loop edge on the current node and runs the whole loop in place via
  `executeLoopConnector` before any exit routing). The legacy `loopBack` edge type (Enhanced Connectors,
  Phase 1) remains an intentional **cross-node** back-edge and is exempt from the self-loop rule. Legacy
  edges (no `kind`) derive a kind from their `type` and keep executing via the expression-based paths (fully
  backward compatible). **Connector-structure safeguards (AWKIT points 1–5):** `validateConnectorStructure`
  (`src/profiles/FlowProfile.ts`) — reused by `FlowExecutor.executeFlow` as a runtime guard and mirrored by
  `connectorStructureIssues`/`scenarioConnectorStructureIssues` in the Flow Designer/Workflow Builder — blocks
  execution/Save when: a loop connector doesn't return to the same node; a node has more than one standard
  (non-conditional/non-parallel) outgoing connector; or a node with a self-loop has a non-Conditional
  additional outgoing connector. Both canvases' kind/link-type selectors disable the disallowed options with
  explanatory helper text. **Branch-pair ports (Rules 3/4):** the source (right) side is a single centered
  `normal-out` port by default; once a **conditional** or **parallel** connector leaves the node it becomes
  a two-port **branch pair** — exactly two same-kind ports `<kind>-out-0/1` (evenly centered via
  `portPositions(2)`), so each of the (max 2) branch connectors aligns to its own port instead of sharing
  one handle (`ConnectorPortFlags.sourceKind`, `branchSourceHandle`, `reconcileBranchConnectors` in
  `connectorStyle.ts`). `reconcileBranchConnectors` slots each pair and, on deletion (`revertSources`),
  reverts a lone surviving branch connector back to **Normal** (single centered port). `ActionFlowNode` and
  `ScenarioFlowNode` call `useUpdateNodeInternals` when `portFlags` change so newly rendered dynamic handles
  are draggable, not only visible. Target (left) side
  keeps a `normal-in` port plus a `conditional-in`/`parallel-in` port for incoming branch connectors. Ports
  render as **siblings of the node card** (not children) so React Flow positions them against the
  un-clipped `.react-flow__node` wrapper (the card's `overflow: hidden` would otherwise clip the
  edge-hugging handles). **Kind changes only in the properties panel (Rule 1):** a `normal` connector's
  kind list offers Normal/Conditional/Parallel (Loop shown disabled — it's created only by the node's loop
  button); once conditional/parallel, the kind **and** type selects are **locked** until a connector is
  removed. `onConnect` in both `FlowChartDesigner.tsx`/`ScenarioBuilder.tsx` caps branch connectors at 2
  and reconciles; if the source already has a self-loop, a new connector is forced to Conditional.
  **Loop connector creation:** a small circular loop button
  (top-right of each node, `ActionFlowNode.tsx`/`ScenarioFlowNode.tsx`) is an **add/remove toggle** —
  clicking it creates the self-loop edge (source=target=that node, kind/type `loop`, circular shape), and
  once a loop exists the button turns filled and removes it on click (the loop is also selectable +
  deletable as a normal edge). **Top loop port + semicircle:** loop connectors attach to a dedicated
  `loop-out`/`loop-in` handle pair on the node's **top** edge (`ConnectorLoopPort`, always present so the
  edge attaches immediately, visible only when a loop exists — `.connector-port-loop.active`); the shared
  `SelfLoopEdge.tsx` detects a self-loop via `source === target` (node identity, not coordinates) and draws
  a visible **semicircle arcing above** the node. **Circular shape:** `EdgeVisualStyle.shape` includes
  `"circular"`, rendered by `SelfLoopEdge` (registered edge type `circular`, also used as the general
  "curved" option for distinct-node edges); loop connectors default to it automatically. The Flow Designer
  Connection Properties panel has a **kind selector + per-kind fields** (incl. a **data-source dropdown** for
  loop `dataSource` mode); `validateFlow` checks conditional expected-value/variable, loop bounds/config,
  ambiguous same-priority conditionals, and the connector-structure rules above. Connector routing also emits
  **live-report timeline events** (conditional matched, parallel fan-out, loop iteration, Auto Secure Login
  restart) via the `RunnerProgressReporter` — no secrets. **Workflow Builder runtime guard:** the same
  connector-structure rules now run through `FlowDependencyResolver` / `ScenarioOrchestrator.createExecutionPlan`
  before workflow execution, so a saved or externally edited invalid workflow graph that bypasses the
  renderer Save gate is blocked at runtime (verified by `verify:runner`).
- **Enhanced Connectors (Phase 1, live-verified):** new flow edge types `outcome` (routes on the step's
  own result via `${stepResult.*}` scope), `loopBack` (controlled back-edge gated by `maxLoopCount`,
  default 2; exhaustion falls through to success/always instead of erroring), and `parallel` (sequential
  fan-out to multiple targets, then converge). `resolveNext` in `FlowExecutor` orders outcome →
  conditional → conditional loopBack → success → always → unconditional loopBack → legacy `next`.
  Workflow-level `chooseNextFlow` also honors `outcome` links. Colors/animations and the Connection
  Properties panels (Flow Designer + Workflow Builder) expose all new types. Backward compatible.
- **Auto Secure Login node:** `autoSecureLogin` reuses a saved session for the target URL when one is
  ready — matched by **normalized origin** (protocol+host+port), so different paths on the same site reuse
  the same login (`outcome: sessionAlreadyExists`). Otherwise it closes the automation browser, launches the
  user's real Chrome via `SessionCaptureService.startCapture(..., "autoSecureLogin")`, waits for the manual
  login, then relaunches Playwright with a `persistentContext` bound to the captured profile
  (`outcome: sessionCaptured`, `restartRequired: true`). Enabled by a `BrowserRestarter` callback in
  `PlaywrightRunner` (mutable browser holder that re-points the live `StepExecutor` at the new page) +
  `sessionService` injected from `ExecutionEngine`. **Restart:** two mechanisms — the engine-level guard in
  `FlowExecutor` restarts the flow from Start on `restartRequired` (bounded by `MAX_AUTO_LOGIN_RESTART = 1`,
  fails safely with a clear message if the session still can't be reused), AND a user-drawable `outcome`/
  `loopBack` edge back to Start still works for explicit flows.
- **Reuse Session node:** `reuseSession` loads a previously-captured session profile and restarts the
  automation browser on its `userDataDir` (`outcome: sessionLoaded`, marks the session used). Two modes:
  **Auto detect** (default) resolves a ready session by normalized origin from the node's optional Target
  URL or the current page URL; **Selected** uses a specific session chosen from a `SearchableSelect` of ready
  sessions. No-match in auto-detect fails safely with `outcome: sessionNotFound`. The browser swap is now a
  generation-guarded two-phase relaunch: launch and verify the new persistent context/page, publish the new
  runtime, re-point the active `StepExecutor`, close the old generation with an explicit reason, and verify
  the new runtime remains alive for at least 2 seconds. Old page/context/browser close or disconnect events
  are ignored by generation guard, duplicate swaps are blocked by a per-instance mutex, locked session
  profiles fail clearly before `Navigate`, and every step runs a browser/page liveness check first. Real
  Electron verification of `Smart-Rec-Chatgpt` on 2026-07-05 showed `Reuse Session` succeeded and
  `Navigate to https://chat.openai.com` succeeded without `Target page, context or browser has been closed`.
- **Session registry metadata:** `SessionProfile` now carries `origin`, `loginUrl`, and `source`
  (`autoSecureLogin` | `manual` | `imported`); `SessionCaptureService.list()` backfills `origin`/`source`
  for legacy profiles. Sessions Manager shows a **Source** column + origin subtitle. Sessions live under a
  dedicated automation profile dir `%LOCALAPPDATA%/WebFlow Studio/profiles/<id>` (never the user's daily
  Chrome profile); session artifacts are git-ignored.
- **UI:** Flows & Workflows tables with pagination + advanced search/filter (persisted);
  Flow Designer with node registry/type-specific properties, node resizing, zoom % control,
  collapsible Node Palette/Properties; Workflow Builder with resizable Workflow Definition panel
  and collapsible sections; styled unsaved-changes dialog; full Settings screen.
- **Resize handles only on selected node:** the `NodeResizer` uses `isVisible={selected}`, and a
  CSS rule (`.react-flow__node:not(.selected) .react-flow__resize-control { display:none }` in
  `app/renderer/styles/global.css`) guarantees unselected nodes never show resize handles/lines.
  Selecting another node moves the handles; clearing selection hides them. Resize + persistence
  still work.
- **Protected Login Handoff:** the runner detects protected/automation-blocked login pages
  (`src/security/ProtectedLoginDetector.ts` — Google/Microsoft/Okta/Auth0/Duo URLs + Google
  "browser may not be secure"/CAPTCHA/MFA/security-check text) after navigation steps. In workflow runs with
  session lifecycle services available, detection now **pauses**, closes the Playwright automation browser,
  launches the user's normal Chrome/Edge at the detected login URL via `SessionCaptureService.startCapture`
  (`manualChromeHandoff`), waits for the user to complete login and close that browser, validates captured
  profile data, relaunches Playwright on the captured persistent profile, marks the session used, and
  continues the same workflow. Capture uses the Protected Login Handoff timeout (`handoffTimeoutMs`, where
  `0` disables the timeout for explicit nodes) and never inherits a triggering navigation/action timeout, so
  auto-detected protected login after `goto` leaves the normal browser open for the human login window. This
  mirrors the recorder secure-login handoff; no protected page is automated or scraped. If no session-capture
  service is available, it falls back to the existing manual
  `waitingForManualAction` pause. The explicit `protectedLoginHandoff` Flow Designer node uses the same
  capture path when possible. OAuth foundation
  (`src/auth/OAuthHandoffService.ts` + `auth.*` IPC) is capability-gated via `WFS_OAUTH_*` env and uses
  `shell.openExternal`; no bypass, no fake tokens, no secrets logged. See
  `docs/PROTECTED_LOGIN_HANDOFF.md`.
- **Session Capture Browser (manual login workaround):** a Sessions Manager page
  (`app/renderer/pages/SessionsManager.tsx`, route `sessions` in the Data nav group) lets users
  capture login sessions by launching the system's **real Chrome or Edge browser** via
  `child_process.spawn` with a custom `--user-data-dir` — no Playwright, no CDP, no automation
  flags. The core service (`src/session/SessionCaptureService.ts`) detects installed browsers at
  standard Windows paths, creates named profile directories under `%LOCALAPPDATA%/WebFlow Studio/
  profiles/`, monitors the browser process, and saves metadata to `session-profiles.json`. IPC:
  `session.ipc.ts` (`session:list`, `session:startCapture`, `session:getStatus`, `session:delete`,
  `session:rename`, `session:detectBrowser`, `session:stopCapture`, `session:getById`,
  `session:markUsed`); preload `session.*`. When a workflow run includes a `sessionProfileId`,
  `execution.ipc.ts` resolves the profile directory and forces `persistentContext` isolation mode
  (`BrowserContextFactory.launchPersistentContext` with the session's `userDataDir`). This lets
  automation runs reuse the full login state (cookies, IndexedDB, Service Workers, localStorage)
  without triggering automation detection. Build & runner verified: `npm run build` clean,
  `npm run verify:runner` → 44/44.
- **Shared connector visuals + style customization:** `components/shared/connectorStyle.ts`
  (`buildConnectorVisual`) is the single source for edge visuals in both the Flow Designer and Workflow
  Builder, so connectors look identical. A shared `ConnectorStyleEditor` in both Connection Properties
  panels customizes color/line-style/thickness/shape/arrowhead; the style persists on `FlowEdge`/
  `WorkflowEdge` (`EdgeVisualStyle`) and reloads. Legacy connectors (no style) render with type defaults.
- **Flow Designer UX:** Node Palette has a search box (filter by label/type/description/category); long
  node-property dropdowns (JSON Data Source, Target flow, Saved Flow) use a searchable combobox
  (`SearchableSelect`). Clicking a Flows-table row opens that flow in the Flow Designer.
- **Flow Designer Smart Wait editing (2026-07-04):** saved steps preserve `beforeWaits`/`afterWaits`.
  Node Properties shows a Smart Waits section when a selected node has waits, split by before/after phase,
  with type/condition/reason details plus timeout editing, per-wait remove, and clear-list controls.
- **Route Change node (Flow Designer):** palette item + Route Change properties section (mode, URL
  match, URL value, wait-until) with mode-aware validation (incl. invalid-regex). At run time
  `StepExecutor` keeps a mutable `activePage` (+`setActivePage`) and `LocatorFactory.setPage` so later
  steps target the switched tab/page.
- **Workflow Builder navigation + resize + search:** double-clicking a workflow flow node opens that
  flow in the Flow Designer (persists `selections.lastSelectedFlowId` + `selectedBuilderWorkflowId`,
  navigates via the unsaved-changes guard; Back restores the workflow). Workflow nodes are resizable
  (`NodeResizer`, size persisted in `WorkflowFlowNode.size`). Saved Flows list has a name search and a
  10-at-a-time "Load More".
- **Save success/failure toasts:** Flow Designer and Workflow Builder show an app-styled `Toast`
  (`components/shared/Toast.tsx`) on save ("… saved successfully: <name>" / "Failed to save changes").
  The Data Source Editor uses its existing success/error banner.
- **Instance Monitor (Concurrent Instance Monitor):** Clear Completed removes terminal instances from the
  backend pool (so the 1s poll can't re-add them); per-instance + toolbar controls all map to real
  `executionEngine` methods; file/artifact buttons (Logs/Screenshots) are enabled ONLY for `failed`
  instances that have a path (disabled for completed/others, with status-specific tooltips). A per-instance
  **Repeat** button (`executionEngine.repeatInstance`) re-runs a finished instance from its retained
  run context (enabled only for terminal instances).
- **Workflow cards grid (primary run UX):** the monitor shows saved workflows as an enterprise-styled card
  grid (`components/instances/WorkflowRunCard.tsx`). Each card shows status (Active/Inactive/Invalid),
  flows/connectors/mode/data-source/updated, and reveals per-card run parameters on hover/keyboard focus
  (independent per workflow, seeded from `settings.execution`, persisted to `settings.workflowRunCards`).
  Run launches that workflow; **multiple workflows can run concurrently** (instance ids are globally unique
  per execution). Search filters by name/description; the grid **always renders every card** and, once the
  cards exceed two rows, becomes a two-row-tall internal scroller (no "Load More" button). The old
  dropdown form is collapsed behind an "Advanced / Classic run form". The instance table has a **Workflow
  column** (resolves `scenarioId` → name; deleted/unknown handled). Card `isolationMode`/`stopOnError` are
  passed through to the run; screenshot-on-failure is shown disabled (it's a per-step flow setting).
  The instance table's **Live Report** button (replacing the open-JSONL button) opens a human-readable
  `LiveExecutionReportModal`: live banner + heartbeat, connected horizontal **per-step process flow** with
  numbered status nodes, real progress bar, statistics cards, and a masked activity timeline. Failed steps
  show a friendly end-user message in the node, with masked technical details available only via hover/focus
  tooltip. Active/running/waiting/manual-action nodes animate; terminal runs show a stable final update time
  instead of an endlessly advancing "Updated" counter. **Live progress is now real:** `StepExecutor` emits per-step events via a
  `RunnerProgressReporter`; `ExecutionEngine` folds them into a bounded `InstanceRuntimeState.liveProgress`
  snapshot (≤500 steps / ≤200 events), which the renderer's 1s poll renders live. Once finished, the stored
  report (`reports.get(executionId)`) supplies the per-step detail. JSONL/report generation and execution
  behavior are unchanged.
  Cards are **equal-height** (fixed `min-height`) on a stable **3-column grid**
  (`repeat(3, minmax(0,1fr))`; 2 cols ≤1080px, 1 col ≤680px) so cards-per-row and dimensions stay the same
  before/after Load More. They use a **two-layer cross-fade** (summary ⇄ params) on hover/focus that does
  **not** change card height (no grid reflow). Search bar and Load More button are full content width.
- **Snapshot-based unsaved-changes detection:** Flow Designer (`FlowChartDesigner.tsx`) and
  Workflow Builder (`ScenarioBuilder.tsx`) compute `isDirty` by comparing an order-independent
  JSON serialization of the *saveable* document against a baseline captured on load and on save
  (`serializeFlowDoc` / `serializeWorkflowDoc`). The dialog appears ONLY for real document changes
  (node add/remove/move/resize, property edit, connector add/remove/change, metadata/data-source/
  execution-settings change). It does NOT appear on open, selection, zoom/pan, React Flow's initial
  node measurement, or after a successful save (baseline is reset to the saved doc).
- **Settings & state persistence:** `app/main/uiSettings.ts` store under
  `%LOCALAPPDATA%/WebFlow Studio/storage/ui-settings.json`; persists route, sidebar, panels,
  widths, zoom, selections (node/connector/flow/workflow/data source), table state, run defaults,
  paths, lastLaunchedAt. Custom paths are consumed by writers (flows/workflows/data sources/
  reports/screenshots/downloads/logs).
- **Recorder & runner** launch the **bundled Chromium** in production-offline mode.
- **Recorder AWKIT extensions (2026-07-04):** (1) **Capture waiting time** toggle in Recorder Controls
  (default OFF, persisted `settings.recorder.captureWaitTime`) — when ON, `RecorderService` measures
  think-time between distinct actions and inserts `wait` actions for pauses ≥ 500 ms (capped 60 s), saved
  as fixed-time wait steps (`config.waitType:"time"`, `timeoutMs`). (2) Recorded flows always open with
  default **Start** and **End** nodes and actions wired between them (`Start → action… → End`, or
  `Start → End` when empty) via the pure `src/recorder/buildRecordedFlow.ts` (unit-verified). (3) **Reusable
  saved-URL history** now lives in its own deduped/canonicalized `recorder-urls.json` (survives
  save/cancel/restart, separate from the transient action draft); `recorder:saveUrl` IPC + a "Save URL"
  button persist a typed URL, and clicking a saved URL row fills the Controls URL field. Verified by
  `npm run verify:recorder-draft` (17/17) and `npm run verify:recorder-flow` (13/13). (4) **Smart Wait
  observation** (default ON via `settings.recorder.captureSmartWaits`, visible Recorder toggle) passively
  observes loaders, fetch/XHR completion, URL changes, table/list/card data growth, enabled controls,
  toasts, and fixed-delay fallback windows, then stores high-confidence `afterWaits` on the preceding
  recorded action. It records method + URL path/status/timing only for network signals; never headers,
  bodies, cookies, query tokens, or response contents. The Recorder action list summarizes captured Smart
  Wait types. Verified as part of `npm run verify:recorder` (57/57).
- **Designer empty-canvas collapse (2026-07-04):** Clicking empty canvas in the Flow Designer and Workflow
  Builder collapses the app side menu (`navigation.collapseSidebar()`), Node Palette / Workflow Definition,
  and Node Properties / Selected Connector panels (collapse-only, idempotent, persisted). Node selection
  still auto-opens the properties panel; connector selection opens the connector panel (Workflow Builder
  expands its right panel on edge click). Last-opened flow/workflow restore now clears a stale reference
  when the saved flow/workflow was deleted.
- **Instances two-row card scroller (2026-07-04):** The workflow-card grid always renders every card; the
  "Load More workflows" button was removed. Once the cards exceed two rows
  (`filteredWorkflows.length > visibleCardCount(gridColumns, 2)`), the grid becomes a **two-row internal
  scroller** (measured height + `.workflow-card-grid.is-scrolling`) so the rest of the Instances page stays
  put; at two rows or fewer it renders at natural height with no scroller.
- **Recorder unique locators + Smart Wait observation (live-verified, `npm run verify:recorder` → 57/57):** the injected capture
  script (`src/recorder/recorderInitScript.ts`) generates ranked candidate locators (role/label/
  placeholder/text/testId → stable attributes → id → scoped → positional fallback — never utility/layout
  classes like `flex`/`items-center`), validates uniqueness against the live DOM, and saves the best
  `count === 1` candidate with `LocatorQuality` metadata (`isUnique`/`matchCount`/`confidence`/`warning`/
  `candidateCount`) + an `exact` flag for role/text. The positional fallback (`structuralSelector`) is
  itself guaranteed unique: it walks up prepending one `:nth-child` segment per ancestor and stops at the
  shortest path that resolves to a single element (or an id-anchored path), so it no longer emits floating
  child-chains like `div > div > … > svg` that match many subtrees. Human-readable step names ("Click Log
  in"); password values are never stored. Node Properties shows locator quality and won't mark a non-unique
  node valid.
- **Smart Locator runtime fallback + context scoping (live-verified, part of `verify:recorder` 57/57):**
  `FlowStep.locator` is a structured `StepLocator` (`src/profiles/FlowProfile.ts`) with the primary plus
  optional `alternatives: LocatorCandidate[]` (ranked runtime fallbacks) and `context` (container/frame
  scope). The recorder emits both: up to 3 alternatives and a `context` for the nearest **visible dialog**
  (`visibleOnly`), **table row** (role=row + row text), **card/list item** (testId/role + `hasText`), or
  **iframe** (`frameLocator` selector, same-origin). At run time `LocatorFactory.resolve(step)` builds a
  scoped root from `context`, then tries primary → alternatives, returning a **single** element per
  candidate — a unique match wins, else the one *visible* match when several exist (**visibility
  disambiguation**, the fix for a hidden modal template + a visible modal). It auto-waits on the primary
  when nothing is present yet, and throws an actionable diagnostic (per-candidate count/visibleCount +
  context) when genuinely ambiguous. `StepExecutor` routes single-target actions through `resolve` (count
  assertions / element loops / `waitFor` keep the plain `create`); `guardLocatorQuality` defers to the
  resolver when a step has `context`/`alternatives`. Fully backward compatible — legacy steps (primary
  only) resolve unchanged. Playwright is 1.49 (no `filter({ visible })`); visibility is probed via
  `nth(i).isVisible()`. Not yet surfaced in the UI (no locator-quality badge / debug candidates table /
  manual override editor).
- **Data Source visual table editor:** edit root-array JSON data sources as a table
  (cells/rows/columns), create from scratch, save real files to the configured data-sources path
  (bundled samples migrate on save). Logic verified by `npm run verify:data-editor` (27/27) incl. a
  real file read→edit→save round-trip; GUI not exercised here.
- **Mock Site Feature Test Lab (2026-07-04):** `mock-site/` is the mandatory local offline test surface for
  Recorder, Runner, Smart Wait, Flow Designer, Workflow Builder, Instance Monitor, locator, node, wait, and
  execution work. Stable URLs: `/` (scenario index), `/login`, `/form`, `/details`, `/success`,
  `/smart-waits`, `/recorder-lab`, `/designer-lab`, and `/api/delay?ms=...`. New/changed scenarios must
  document title/description/expected behavior/related feature/stable selectors in `mock-site/README.md`
  and be covered by `npm run verify:mock-site` or a focused feature verifier. Current verifier:
  `npm run verify:mock-site` -> 28/28.
- **Test-only mock fixtures** (new): `npm run seed:mock-fixtures` imports 10 flows, 3 workflows, and
  1 data source (all `mock-` prefixed) that target the offline mock-site into the runtime userData
  folders. Source fixtures live in `resources/test-fixtures/mock-site/` (excluded from packaged
  builds). They do NOT auto-load — a fresh install still shows empty Flows/Workflows/Data Sources.
  See `resources/test-fixtures/mock-site/README.md`.

- **Recorder secure-login browser handoff (2026-07-04):** while recording, `RecorderService` watches
  every page/popup load via `detectRecorderProtectedLogin` (`src/security/ProtectedLoginDetector.ts` —
  conservative stable DOM signals `input[type=password]`, `input[autocomplete=one-time-code]`,
  `iframe[src*=recaptcha|hcaptcha|turnstile]`, `[aria-label*=captcha|verification]`, passkey/webauthn +
  provider/text patterns incl. verification-code/OTP/MFA/passkey/digital-signature/external-approval). On
  the first detection it **pauses** recording, preserves the draft, stores secret-free handoff metadata
  (source alias, origin, reason, signals, timestamp, draft id, resume URL), and **closes the automation
  browser** — it never automates or scrapes the protected page. The Recorder page shows a handoff panel
  (`data-testid="protected-handoff-panel"`) with **Continue using normal browser** (launches the user's real
  Chrome via `SessionCaptureService.startCapture(..., "manualChromeHandoff")` at the detected URL, app-owned
  scoped profile under `%LOCALAPPDATA%/WebFlow Studio/profiles/<id>` — never the user's daily Chrome
  profile), **Capture Session & Resume** (validates captured session via `hasCapturedData`, optional name,
  inserts `Auto Secure Login` + `Reuse Session` nodes at the front of the draft with the session id linked to
  Reuse Session — deduped, then relaunches Playwright with `launchPersistentContext` on the saved profile,
  navigates to the safe resume URL, and resumes recording), and **Cancel**. No secrets (passwords, OTPs,
  CAPTCHA values, cookies, tokens) are captured or logged. New IPC: `recorder:getHandoff`,
  `recorder:continueWithNormalBrowser`, `recorder:captureSessionAndResume`, `recorder:cancelHandoff`
  (+ preload `recorder.*`). `buildRecordedFlow` serializes `autoSecureLogin` (target URL → `step.value`) and
  `reuseSession` (`config.reuseSessionMode="selected"` + `reuseSessionId`). Mock Site scenarios
  `/mock/protected-login`, `/mock/protected-popup-login`, `/mock/protected-popup-captcha`,
  `/mock/protected-popup-otp`, `/mock/session-reuse`. Verified: `npm run verify:protected-login-recorder`
  (34/34), `verify:protected-login` (16/16), `verify:recorder` (57/57), `verify:mock-site` (28/28),
  `verify:popup` (12/12), `verify:runner` (76/76), `npm run build` clean. Detection reuses the same signals
  as the runner-side Protected Login Handoff; runtime replay of the inserted nodes uses the existing
  Auto Secure Login / Reuse Session runner behavior.

- **Concurrency & stability layer (2026-07-06, verified `npm run verify:concurrency` → 78/78):**
  `src/runner/concurrency/` (ResourceLockManager — exclusive/shared/semaphore locks with TTL leases,
  monotonic fencing versions, atomic multi-acquire, stale sweep, debug snapshot; Semaphore;
  ConcurrencyConfig with `AWKIT_*` env overrides; BackpressureController + CapacitySnapshot),
  `src/runner/browser/BrowserWorkerPool.ts` (bounded browser slots — one browser runtime per running
  instance, default cap 2 per host, health/crash-window tracking, refuses work when saturated),
  `src/runner/runtime/` (FlowRunStatus/NodeStatus state machines with recorded transitions, NodeAttempt
  log, ErrorClassifier, RetryPolicy, InstanceHeartbeat, WatchdogService), `src/runner/artifacts/`
  (RunLogger — masked JSONL to the per-instance `paths.logs` file that was previously never written;
  RunStateArtifacts — `flow-state.json`/`node-attempts.json`/`capacity.json`/`locks.json` under
  `<instance storage>/state`), and `src/profiles/ProfileLockManager.ts`. Enforced rules: a persistent
  profile (`userDataDir`) is an exclusive locked resource (`BrowserContextFactory` acquires before
  `launchPersistentContext`, releases in the close path — plus the existing on-disk `Singleton*` check
  for external browsers); instance dispatch passes backpressure admission (pool saturation, active-flow
  cap, host free-memory floor, crash rate) and queues with a logged reason instead of overloading the
  host; step retries are classification-gated (transient navigation/timeout/locator/download only,
  exponential backoff; submit/approve/delete/send/pay/confirm-looking mutations and dead
  browser/context/page failures never auto-retry); isolated parallel branches are clamped by
  `maxActiveNodesPerFlow`; every progress event heartbeats `InstanceRuntimeState.runtime` (additive —
  UI `status` values unchanged); the watchdog (15s, unref'd) marks orphaned instances failed, notes
  stale heartbeats, and sweeps expired locks. Existing behavior preserved: `verify:runner` 82/82 and
  `verify:waits` 21/21 pass unchanged.
  **Phase 2 (2026-07-06, review in `docs/ai/CONCURRENCY_PHASE2_REVIEW.md`):** per-step **failure
  traces** (`TraceService` chunks; failed engine-run steps save `traces/<stepId>-<ts>.zip` before any
  cleanup; success discards; `AWKIT_TRACE_MODE` off/onFailure/always; armed only when
  `instance.paths.traces` is provided, so verify scripts/direct runners have zero overhead);
  **failure screenshots default on** (`onFailure.screenshot: false` opts out, best-effort);
  **origin/account dispatch semaphores** (`DispatchClaims`: `origin:<host>` from baseUrl/first goto,
  `account:<envFile>`; `AWKIT_MAX_PER_ORIGIN`=2, `AWKIT_MAX_PER_ACCOUNT`=1; a saturated key queues
  only instances targeting it); heartbeat refresh on `resumeInstance`/`retryHandoff` (no stale-note
  false positives after manual handoff); **runtime status surface**: `execution:runtimeStatus` IPC →
  `executions.runtimeStatus()` preload → read-only Instance Monitor strip (browsers/flows/pages/
  queued/locks incl. stale, crashes, backpressure reason, last watchdog action), backed by
  `getRuntimeStatus`/`getLockSnapshot`/`getBrowserPoolSnapshot`/`getWatchdogSnapshot`. Node attempts
  now carry `tracePath` + sanitized `currentUrl`. New deterministic verifiers: `verify:locks` (15),
  `verify:browser-pool` (13), `verify:watchdog` (13), `verify:artifacts` (13, live Chromium),
  `verify:runtime-status` (15). Locks/pool/watchdog remain **single-Electron-main-process** only;
  cross-process profile safety is the on-disk `Singleton*` check.
  **Phase 3 (2026-07-06, `docs/ai/PHASE3_DURABLE_RUNTIME.md`, verified — 95 new checks):**
  durable runtime under `<runtime root>/runtime/`: `runtime.sqlite` (real SQLite file via
  `sql.js` WASM — runs, node attempts, heartbeats, cancellations, watchdog events, artifacts,
  capacity snapshots; versioned migrations; single-writer with atomic-rename persistence,
  ≤300ms loss window on hard kill) + `locks/` (atomic wx-file **cross-process** locks with
  fencing versions, TTL/dead-pid stale quarantine — two AWKIT app processes can no longer share
  a persistent profile; `ProfileLockManager.acquireDurable` enforces both layers).
  **Hard cancellation:** Stop/stopAll → durable cancellation record → handoff wake → token
  cancel → the runner closes the live browser generation; in-flight actions reject in seconds,
  `cancelled` error class never retries, run ends `cancelled` with slot/claims/profile locks
  released and artifacts written. **Safety metadata:** optional `FlowStep.safety`
  (`sideEffectLevel`, `retryable`, idempotency-key requirements) is authoritative; node-type
  defaults classify legacy/recorder steps; keyword heuristic is fallback-only; unknown custom
  types are conservative (no auto-retry). **Dynamic origin claims:** cross-origin navigation
  mid-flow acquires the new `origin:*` semaphore (in-memory + durable) before releasing the old,
  bounded by `AWKIT_ORIGIN_CLAIM_TIMEOUT_MS`; saturation fails only that step (retryable).
  **Resource sampling:** system/process memory + CPU deltas gate dispatch
  (`AWKIT_MAX_SYSTEM_MEMORY_PERCENT`/`AWKIT_MAX_PROCESS_MEMORY_MB`/`AWKIT_MAX_CPU_PERCENT`) and
  render in the Instance Monitor strip. **Startup recovery:** interrupted prior-instance runs
  are marked orphaned/recoverable (safe to re-run) or failed/manual-review (dangerous node in
  flight — never auto-resumed); recoverable runs + stale durable locks appear in runtime status.
  `AWKIT_DURABLE_STORE=0` disables durability (tests/dev).
  **Phase 4 Release Hardening (2026-07-06, `docs/ai/PHASE4_RELEASE_HARDENING.md`):** explicit
  sql.js WASM resolution (`src/runner/store/SqlJsLoader.ts` — module resolution + `locateFile`,
  path exposed for diagnostics; works in dev/tsx/app.asar); durable runtime initialized at **app
  startup** via `registerExecutionIpc` so recovery is visible right after restart;
  `RuntimeStatusSnapshot.environment` diagnostics (appMode/runtimeRoot/sqlitePath/artifactsRoot/
  sqlJsWasmPath/durableStoreEnabled) logged once at init and asserted by the packaged smoke
  verifier; **Recoverable Runs panel** in the Instance Monitor (`RecoverableRunsPanel.tsx`) with
  per-run Details (last node/safety level/last URL/error class/trace/screenshot), Open artifacts
  (`system:openPath`), Re-run workflow (safe runs only), Mark reviewed / Mark abandoned (IPC
  `execution:recoveryDetails`/`execution:recoveryAction`, engine `getRecoveryDetails`/
  `applyRecoveryAction`, durable statuses `reviewed`/`abandoned`); packaging config + offline
  manifest + validators require the sql.js runtime/WASM; portable + NSIS rebuilt and the packaged
  runtime smoke-verified (`verify:packaged-runtime` 24/24); five deterministic stress/soak
  verifiers added (46 checks, tunable via `AWKIT_STRESS_*`); `DurableLockStore` hardened against
  the Windows EPERM/EBUSY wx-create race (found by `verify:stress:locks`).

## Partially implemented / to verify

- **Both connector canvases are GUI-VERIFIED in the real app (2026-07-03).** The un-clipped ports,
  top loop port, semicircle self-loop, add/remove loop toggle, conditional-lock, and real second-branch
  drag/delete survivor-revert path were driven in the **real running Electron app** via
  `npm run verify:flow-designer` (Flow Designer, 19/19) and `npm run verify:workflow-builder` (Workflow
  Builder `.scenario-flow-node`, 13/13, on saved "Mock — Data-Driven Workflow") — both Playwright
  `_electron` scripts. `npm run build` (clean), `npm run verify:runner` (76/76), and
  `npm run validate:offline` also pass. The `npm run dev` launch blocker was root-caused and fixed (it was
  `ELECTRON_RUN_AS_NODE=1` in the agent env, not a version mismatch — see below).
- **Clean/offline Windows VM walkthrough not yet performed (Phase 5 gate).** The dev-machine half is
  now automated and green — `npm run verify:packaged-walkthrough` 68/68 drives the real packaged EXE
  on a fresh empty profile (first run, workflow run, cancellation, kill+recovery incl. the real UI
  panel, browser bound, portable boot, NSIS hash, loopback-only app traffic) — but it still executes
  on the dev machine. The human checklist in `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 (offline
  VM, no dev toolchain) remains the final gate; no VM/Windows Sandbox was available to the agent
  (`WindowsSandbox.exe` absent). The NSIS installer's install/uninstall cycle has never been
  exercised anywhere (sha512 integrity vs `latest.yml` verified only).
- **Bundled Chromium startup egress (Phase 5 WARNING).** Every bundled-Chromium launch emits a short
  burst of Google-service TCP connections (path-attributed; app processes stay loopback-only; plain
  Playwright launch options). Harmless offline (attempts fail), but a hard no-egress guarantee would
  need explicit Chromium kill-switch flags in `BrowserContextFactory.createLaunchOptions` — see
  KNOWN_ISSUES "Phase 5 packaged-walkthrough findings" §3.
- **EXEs are unsigned** — Windows SmartScreen will warn on first launch (no code-signing configured).
- **`@playwright/test` runner** cannot load the TS/ESM config on Node 18.16 (needs Node ≥18.19);
  the committed `tests/runner.mocksite.spec.ts` runs there, but live verification here uses the
  `tsx` script `scripts/verify-runner.mts` instead.

## What must NOT be broken

- Offline-first guarantees (no runtime internet, no global Node/Playwright/Chromium, no writes to
  `resources/`/`app.asar`).
- The `window.playwrightFlowStudio` preload API contract (used across the renderer).
- The dependency-manifest must stay valid + BOM-free and reference `WebFlow Studio` paths, or the
  packaged startup gate / strict validation will fail.
- Bundled-Chromium resolution (`BundledBrowserResolver` → `resources/browsers/chromium/chrome.exe`).

## Current technical debt

- Renderer bundle is large (~900 KB JS) — no code-splitting.
- No automated lint; no unit-test suite beyond the runner verification script.
- Historical product spec docs (`playwright_flow_studio_updated_phases/`, some `change_requests/`)
  still say "Playwright Flow Studio".
- Runtime data root renamed to `WebFlow Studio`; data under the old `PlaywrightFlowStudio` folder
  is not migrated (acceptable pre-1.0).

## Next logical steps

0. **In-progress initiative (2026-07-07):** UI/UX refactor + reports/analytics. Enhanced execution
   pack in `docs/ai/ui-reports-refactor/` (`09_EXECUTION_PLAN.md` = 14 phases). Theme decided:
   **light-first**. Git/Phase 0 skipped per user instruction (work stays on
   `feature/smart-wait-engine`).
   - **Phase 2 DONE (design-system foundation):** added the `--awkit-*` light-first token block to
     `app/renderer/styles/global.css` (surfaces/text/accents/status/bands/depth/motion/z — additive,
     existing hard-coded colors untouched); new `awkit-`-namespaced shared primitives in
     `app/renderer/components/shared/`: `StatusBadge`, `SectionHeader`, `SkeletonCard`, `EmptyState`,
     `TrendDelta`, `AnimatedCounter`, and the `usePrefersReducedMotion` hook; extended `MetricCard`
     additively (`trend`/`tone`/`loading` optional props; `value` widened to `ReactNode`); global
     `prefers-reduced-motion` block (last in the cascade). Verified: `npm run build` clean;
     `verify:flow-designer` 19/19; `verify:workflow-builder` 13/13 (the WB verifier needs a workflow
     loaded on the Builder canvas — seed via `npm run seed:mock-fixtures` and set persisted
     `selections.selectedBuilderWorkflowId`; the empty-canvas timeout is an environment/persisted-state
     dependency, not a code regression). Primitives are not yet consumed by any page (that starts at
     Phase 5).
   - **Phase 3 DONE (telemetry read-model):** additive **migration v2** (`reporting-extensions`) in
     `src/runner/store/RuntimeStoreSchema.ts` — nullable `runtime_runs` columns (scenarioName,
     triggerType, queueWaitMs, durationMs, retryCount, recoveryCount, reportCategory), new
     `runtime_process_samples` table, + read indexes; v1 databases upgrade **in place** (proven).
     `SqliteRuntimeStore` gained `recordProcessSample`/`listProcessSamples`/`sweepRetention`
     (bounded time+run retention over DB rows only — never user artifacts; interrupted/recoverable
     runs always kept) and extended `upsertRun` (v2 columns preserved across REPLACE via the
     existing merge-read). New pure `src/reports/ReportCategories.ts` maps the existing
     `ErrorClassifier` classes → report taxonomy (no second classifier). New
     `src/runner/runtime/ProcessTreeSampler.ts` (Windows CIM, own-subtree Chromium count+memory,
     throttled, never-throws, `AWKIT_PROCESS_SAMPLING` gate). `RuntimeStatusSnapshot.processes?`
     added (additive). `ExecutionEngine` now writes run-summary fields at the existing start/end
     seams (queueWait from run enqueue→dispatch; duration; retryCount from node attempts;
     reportCategory from errorClass), starts the process sampler + persists history rows (≤1/15s),
     and runs the retention sweep on durable init (`AWKIT_REPORT_RETENTION_HOURS`/`_RUNS`).
     Verified: `npm run build` clean; **new `npm run verify:telemetry` 21/21** (v1→v2 in-place
     upgrade, run-summary round-trip incl. REPLACE-preservation, process-sample write/read,
     retention time+run cap, taxonomy mapping, sampler tolerance); `verify:durable-store` 11/11
     (assertions updated for v2); `verify:runtime-status` 15/15; `verify:runner` 82/82;
     `verify:cancellation` 12/12; `verify:concurrency` 78/78. No IPC query layer yet (Phase 4) and
     no report pages yet (Phase 5).
   - **Phase 4 DONE (telemetry query IPC + preload):** shared read-model types in
     `src/reports/TelemetryContracts.ts`; 5 read-only aggregate query methods on the `RuntimeStore`
     interface (`queryOverview`/`queryWorkflows`/`queryRunHistory`/`queryFailures`/
     `queryRuntimeSeries`) implemented in `SqliteRuntimeStore` (SQL SELECT + bounded JS aggregation;
     windowed/paginated; ≤5–10k row caps; percentiles/durationStats in JS) and as empty +
     `storeEnabled:false` in `NullRuntimeStore`; engine `getTelemetry*` delegators (+ `getTelemetryRunDetail`
     reusing run/attempts/artifacts, `getTelemetryProcessHistory`). New `app/main/ipc/telemetry.ipc.ts`
     (7 channels `telemetry:overview/workflows/runHistory/runDetail/failures/runtimeSeries/processHistory`;
     range preset → `sinceIso` + bucketMs resolved server-side), registered in `ipc/index.ts`, and a
     typed `telemetry` group on `window.playwrightFlowStudio` (`app/main/preload.ts`). Existing
     `reports:*`/`execution:*` channels untouched. Verified: `npm run build` clean;
     `npm run verify:telemetry` **37/37** (now incl. Part G: overview counts/rates/duration/queue-wait,
     workflow grouping, run-history pagination, failure categorization + top-workflow, runtime-series
     bucketing, deterministic range filtering, empty-DB + NullRuntimeStore(`storeEnabled:false`));
     `verify:durable-store` 11/11; `verify:runtime-status` 15/15. Execution paths unchanged from
     Phase 3 (read-only additions only), so runner/concurrency were not re-run. No report pages yet.
   - **Phase 5 DONE (reports nav shell + Overview — first rendered report UI):** new `reportsOverview`
     route (`app/renderer/routes.tsx`) + a new **"Reports" nav group** in `LeftNavigation.tsx`; the
     existing `reports` route was relabeled **"Run Artifacts"** (id unchanged — `ExecutionReports`
     still lists stored run reports). New `app/renderer/components/reports/` scaffold:
     `useTelemetryQuery` (loading/error/data, stale-request cancel, manual refetch — no polling),
     `ReportPage` (SectionHeader + `TimeRangeSelector` + refresh + page-enter), and hand-rolled SVG
     chart primitives `MetricSparkline`/`BarChart`/`DonutChart` (zero chart deps, point-capped,
     text/aria fallbacks). New `pages/ReportsOverview.tsx` consumes `telemetry.overview` + a one-shot
     `executions.list()` for live counts, with full loading/error/store-disabled/empty/ready states.
     Report CSS added to `global.css` (all `awkit-` namespaced; reduced-motion block still last).
     App.tsx already guards an unknown `lastRouteId` (falls back to `routes[0]`), so up/downgrade is
     safe. Verified: `npm run build` clean; **new `npm run verify:reports` 8/8** (real Electron —
     nav→page render, header, resolves to a valid non-loading state [empty "No runs in this range"
     on the dev profile], 5-button range selector + range change + refresh, zero telemetry/undefined
     console errors); `verify:flow-designer` 19/19 (shared CSS, no canvas regression);
     `verify:telemetry` 37/37 (data correctness). The real-data GUI path (populated metrics) wasn't
     exercised because the dev profile has no in-range runs — the query aggregates are proven by
     `verify:telemetry` and the empty→ready state machine by `verify:reports`.
   - **Phase 6 DONE (workflow & instance reports + run drill-down):** additive `RunHistoryFilter`
     (scenarioId/status) threaded through `queryRunHistory` (contract→store→engine→IPC→preload;
     parameterized SQL, back-compatible). New `pages/ReportsWorkflows.tsx` (client-side sortable
     per-workflow table from `telemetry.workflows`; row click → scenarioId-filtered recent-runs
     panel; run → drawer) and `pages/ReportsInstances.tsx` (live status distribution via a 2s
     `executions.list()` poll cleared on unmount + paginated `telemetry.runHistory` history; run →
     drawer). Shared `components/reports/RunDetailDrawer.tsx` (run metadata + node-attempts table +
     artifact "Open folder" via `system.openPath`) and `statusTone.ts` (status→tone + duration/time
     formatters). Both routes added to the Reports nav group. Report table/drawer/distribution CSS
     added (all `awkit-` namespaced). Verified: `npm run build` clean; **`npm run verify:reports`
     13/13** (real Electron: all 3 report routes render + resolve to valid states, live-status section
     on Instances, zero telemetry/undefined console errors); **`npm run verify:telemetry` 39/39**
     (+scenarioId/status filter checks); `verify:flow-designer` 19/19 (no canvas regression). The
     populated-data GUI path (tables with rows + drawer content) wasn't exercised (dev profile has no
     in-range runs) — covered by `verify:telemetry` aggregates/filters + build-time binding types.
   - **Phase 7 DONE (live Chrome consumption + RPM gauges):** new `pages/ReportsChrome.tsx`
     (route `reportsChrome`, in the Reports nav group) driven by a `useRuntimeStatus` 2s poll of
     `executions.runtimeStatus()` (which carries the Phase 3 `processes` sample + `capacity` +
     `browserPool`). Four hand-rolled SVG **RPM gauges** (`RadialGauge` — 180° dial, colored bands
     0–60/60–85/85–100, CSS-rotated needle [reduced-motion safe], `undefined`→neutral "—"):
     browser-pool saturation (activeBrowsers/maxBrowsers), concurrency (activeFlows/maxActiveFlows),
     memory pressure (systemMemoryPercent), CPU (cpuPercent); each `RpmGaugeCard` carries a mandatory
     source/formula tooltip + high-band pulse. Plus process metric cards (Chromium processes/memory,
     active/queued instances), a `LiveProcessStrip` (per-slot contexts/pages/health, NULL-tolerant),
     an `AvailabilityNotice` (only mentions access when the reason is access-related; core metrics stay
     live), and a backpressure banner (`dispatchBlocked`). Gauge/notice/strip CSS added (all `awkit-`
     namespaced). Verified: `npm run build` clean; **`npm run verify:reports` 18/18** (real Electron:
     Chrome route renders 4 gauges — idle shows pool/concurrency 0% and memory/CPU "—" because the
     `ResourceSampler` only starts on the first run, so system metrics are legitimately unavailable
     while idle: the graceful-degradation path — process-detail section present, stable across a poll
     tick, zero telemetry/undefined console errors); `verify:flow-designer` 19/19 (no canvas
     regression).
   - **Phase 8 DONE (consumption history + concurrency analytics):** new `pages/ReportsRuntime.tsx`
     (route `reportsRuntime`, "Runtime Analytics" in the Reports nav group) consuming
     `telemetry.runtimeSeries` + `telemetry.processHistory` (both server-bucketed, Phase 4). New
     `components/reports/ConsumptionTimeline.tsx` — hand-rolled multi-series SVG line chart (shared
     time x-domain, y auto-scaled, gaps for undefined points, aria summary, empty-safe). Four
     timelines (concurrency: active browsers/flows/queue; host: memory %/CPU %; Chrome process count;
     Chrome memory: chromium + electron main) + an analytical summary (busiest window, peak active
     browsers, peak system memory %, peak Chromium memory/process count). Timeline CSS added
     (`awkit-` namespaced). Retention sweep for both sample tables was already proven in
     `verify:telemetry` Part D. Verified: `npm run build` clean; **`npm run verify:reports` 21/21**
     (real Electron: Runtime route renders + resolves to a clean empty state — dev profile has no
     in-range samples — zero telemetry/undefined console errors); `verify:flow-designer` 19/19 (no
     canvas regression).
   - **Phase 9 DONE (failure/success + server-performance analytics):** new `pages/ReportsFailures.tsx`
     (route `reportsFailures`) — failure-category donut + bar (from `telemetry.failures`), top failing
     workflows, a **workflow reliability ranking** with a flakiness score
     (`min(100, round(failureRate×60 + retryRate×40))`, ≥5-run threshold, tooltip-documented,
     timeouts folded into failure rate), and **deterministic evidence-based insight strings** (no AI/
     network). New `pages/ReportsServer.tsx` (route `reportsServer`) — memory/CPU/Chromium cards +
     a **storage-usage** bar chart + availability + backpressure banners + a "never auto-deletes
     artifacts" note. New additive `telemetry:server` channel (contract `ServerReport`/`StorageUsage`,
     preload `telemetry.server`): computed in the **IPC layer** (keeps the `src/` boundary) via
     `getConfiguredPaths` + a bounded (≤20k-entry) never-throwing directory walk cached 60s, plus
     `getRuntimeStatus` capacity/process fields. Both routes in the Reports nav group; CSS added
     (`awkit-` namespaced). Verified: `npm run build` clean; **`npm run verify:reports` 26/26** (real
     Electron: all 7 report routes render + resolve; Failure Analytics resolves; Server Performance
     shows 4 metric cards + a real storage-usage section from actual dev-profile folder sizes; zero
     telemetry/undefined console errors); `verify:flow-designer` 19/19 (no canvas regression). The
     Reports section is now complete: Overview, Workflow, Instance, Chrome, Runtime, Failure, Server
     + the existing Run Artifacts.
   - **Phase 10 DONE (Flow Designer / Workflow Builder visual refactor — CSS-only):** token-based
     polish of the node cards in `global.css` — `.action-flow-node` + `.scenario-flow-node` now use
     `--awkit-surface`/`--awkit-border`/`--awkit-blue` accent + `--awkit-shadow-card` + a smooth
     box-shadow/border transition + a slightly rounder 10px radius; `.selected` uses a purple token
     ring (`color-mix`) + float shadow; node icon → surface-inset + purple; scenario order badge →
     `--awkit-blue`. **No TSX, serializer, connectorStyle, or DOM/geometry changes** — node geometry
     (grid/overflow/size), the port-sibling structure, the `NodeResizer` selected-only visibility
     rule, and saved `EdgeVisualStyle` precedence are all untouched; connector **semantic** colors
     (success=green/failure=red/conditional=amber/parallel=violet) were deliberately kept (flat
     purple/blue would regress clarity). Verified: `npm run build` clean; `verify:flow-designer`
     **19/19** and `verify:workflow-builder` **13/13** (all port/loop/resize/conditional-lock
     invariants intact with the restyled nodes). `verify:runner`/`verify:recorder` not re-run — they
     run headlessly against the runner core and never load `global.css`, so a CSS-only diff cannot
     affect them.
   - **Phase 11 DONE (motion pass + reduced-motion audit):** added a **route-content fade** to the
     shell — `AppShell` keys `<main>` by `activeRouteId` (re-triggers on navigation) and applies
     `main-surface-animated` (opacity + 4px translateY, `--awkit-dur-med`) to **non-canvas routes
     only** (CANVAS_ROUTES = flowChart/scenarioBuilder/workflow/formDesigner are excluded so no
     mount-transform perturbs React Flow measurement). Centralized the fade there and dropped the now
     redundant `awkit-page-enter` from `ReportPage`. **Audit findings** (in
     `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md`): reduced motion fully handled (global CSS media block
     neutralizes all animation/transition; `AnimatedCounter` checks `usePrefersReducedMotion`;
     no other JS animation); compositor-friendly (transform/opacity/background-position) except a
     bounded one-shot `width` transition on `.awkit-bar-fill` (accepted); no idle always-running
     animations (gauge pulse only ≥85%, shimmer only while loading, spin only while refreshing); all
     one-shot transitions use motion tokens. Verified: `npm run build` clean; `verify:flow-designer`
     19/19, `verify:workflow-builder` 13/13 (the `<main>` key change doesn't disturb the canvases),
     `verify:reports` 26/26 (route fade doesn't break report rendering).
   - **Phase 12 DONE (mapping/binding regression audit — verdict PASS):** full Section-C pass over all
     37 files changed in Phases 2–11, recorded in `08_MAPPING_BINDING_DEPENDENCY_AUDIT.md` §C. All 8
     checks PASS: rendering map (unique route ids, unknown-`lastRouteId` fallback), props/state (tsc
     clean), store/IPC (8/8 `telemetry:*` channel parity, all intervals/listeners cleaned up),
     persistence (v1→v2 in-place, empty-DB, `AWKIT_DURABLE_STORE=0` disabled state, old reports
     load), runtime safety (`verify:runner` 82/82 + `verify:cancellation` 12/12 with telemetry
     active — never-throw writers, exited-PID tolerance), dependencies (**zero new npm deps**),
     accessibility (aria labels, chart text fallbacks, color+label), performance (paginated,
     point-capped, poll budget). Fresh evidence this pass: telemetry 39/39, durable-store 11/11,
     runtime-status 15/15, runner 82/82, cancellation 12/12 (+ flow-designer 19/19, workflow-builder
     13/13, reports 26/26 from Phase 11). Open non-blocking items: `TrendDelta` primitive not yet
     consumed (documented), populated-data report GUI path not exercised on the empty dev profile,
     10-min heap soak + OS reduced-motion toggle are manual gates.
   - **Phase 13 DONE (final QA + packaging + handoff — the initiative is COMPLETE, verdict PASS):**
     final report at `docs/ai/ui-reports-refactor/FINAL_REPORT.md`. Fresh sweep: build clean;
     `validate:offline` pass; `verify:mock-site` 28/28; rebuilt `dist/win-unpacked` via
     `electron-builder --dir` (avoids the documented max-compression OOM) and `verify:packaged-runtime`
     **25/25** against the real EXE (packaged app boots with all changes; durable/telemetry init +
     migration v2 on a fresh runtime.sqlite; external SQLite read OK). `ARCHITECTURE.md` +
     `FEATURES.md` updated with the reporting/telemetry + design-system surfaces. Standing pre-existing
     gates (unchanged by this initiative): max-compression signed EXEs (16 GB OOM), clean/offline VM
     walkthrough, code-signing. The 70-check packaged walkthrough was not re-run — it exercises
     workflow-run/cancellation/recovery paths this read-only+UI initiative doesn't touch, and
     `verify:packaged-runtime` 25/25 already proves a clean packaged boot with the changes.
   - **Net:** the UI/UX refactor + reports initiative (Phases 1–13) is implemented, verified, and
     documented, entirely additive, zero new npm deps. Nothing committed/pushed (git skipped per user).
   - **NEXT INITIATIVE PLANNED (2026-07-07, docs only): full-app DARK premium re-skin.** User pivoted
     the theme decision (light → dark premium SaaS, full-app scope). Implementation-ready plan in
     `docs/ai/ui-reskin-template-plan/` (14 files; phases R1–R12 in `10_IMPLEMENTATION_PHASES.md`;
     Phase R1 prompt in `13_NEXT_IMPLEMENTATION_PROMPT.md`). Core strategy: redefine `--awkit-*`
     token VALUES to dark + retire all 130 remaining hardcoded hex colors in `global.css` by
     value-substitution inside existing rules (selectors/specificity unchanged), then premium
     treatments on the shared classes (`.work-panel`×38, `.toolbar-button`×70, …), page passes,
     canvas/nodes/connectors (invariant-preserving; `connectorStyle.ts` values-only), motion,
     simplification (zero functionality loss), audits. The 4 Dribbble templates were inaccessible
     (blocked/empty via WebFetch) — recorded honestly; design proceeds from the stated dark target.
     No application code changed in the planning pass. Awaiting approval to start Phase R1.
1. Human clean/offline VM walkthrough per `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 (incl. the
   NSIS install/uninstall cycle) — then upgrade the RC decision from PASS WITH WARNINGS to PASS.
2. Optional hardening: explicit Chromium no-egress flags; code-signing for the installer/exe.
3. Then: remote-runner-host roadmap (deliberately NOT started — see `docs/ai/PHASE3_DURABLE_RUNTIME.md`).
4. Optional: `lastSelectedNodeId/Connector` restore-on-open, renderer code-splitting.

## Unknown / Needs Verification

- Real behavior on a clean offline Windows VM (untested here — dev-machine fresh-profile walkthrough
  is green, but the VM checklist in `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 is unperformed).
- NSIS installer install/uninstall cycle (only sha512 integrity verified).
