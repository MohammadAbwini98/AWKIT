# E2E Defects — 2026-07-19 assessment (main @ `0a4500f`)

Companion to `docs/testing/E2E_EXECUTION_REPORT.md` and `docs/testing/E2E_COVERAGE_MATRIX.md`.
Every entry below was reproduced against the real Electron app on an isolated fresh profile before
being recorded (exploratory observations that could not be reproduced are listed separately at the
end). Evidence lives under `test-artifacts/2026-07-19-e2e-qa/`.

---

## E2E-DEF-001 — verify:auth-gui silently broken by PR #21 (stale selectors) — TEST DEFECT, FIXED

- **Severity / confidence:** High (a security-suite verifier could not run) / Confirmed · deterministic
- **Role / area:** n/a (test infrastructure) · `scripts/verify-auth-gui.mjs`
- **Preconditions:** main @ `0a4500f` (PR #21 merged)
- **Repro:** `npm run verify:auth-gui` → failed at "title-bar session chip shows the display name"
- **Expected:** the auth GUI suite runs green against the current shell
- **Actual:** the suite targeted `.app-frame-user` / `.app-frame-logout`, which PR #21 replaced with
  the `AccountMenu` (`.awkit-account-trigger` → popover menuitem *Sign out*). PR #21's verification
  ran `verify:licensing`/`verify:avatar`/`verify:ipc-contract` but not `verify:auth-gui`.
- **Resolution:** selectors updated to the AccountMenu; suite green **18/18**.
- **Lesson recorded:** GUI verifiers asserting shell chrome must be re-run when `AppFrame` changes.

## E2E-DEF-002 — verify:admin-gui asserted the deleted licensing placeholder — TEST DEFECT, FIXED

- **Severity / confidence:** Medium / Confirmed · deterministic
- **Role / area:** test infrastructure · `scripts/verify-admin-gui.mjs`
- **Repro:** `npm run verify:admin-gui` → failed at "Licensing placeholder renders"
- **Actual:** the check expected the pre-PR-#21 placeholder text (*not yet implemented*); the real
  `LicensingPage` replaced it.
- **Resolution:** check now asserts the real page (License status card + *Not activated* badge on a
  fresh profile); suite green **11/11**.

## E2E-DEF-003 — Fresh install seeds bundled samples as REAL user records — PRODUCT DEFECT, FIXED (bd `awkit-64x`)

- **Severity / confidence:** Medium / Confirmed · deterministic
- **Role:** every role (first impression of every fresh install)
- **Preconditions:** brand-new profile (empty `%LOCALAPPDATA%`), first sign-in
- **Repro steps:** first-run provisioning → open **Workflows**, **Flows**, **Data Sources**
- **Expected (RULES.md › UI):** "No demo/seed data presented as real user records — use empty states."
- **Actual:** Workflows lists **“Customer Onboarding Workflow”** (Active, "1 saved workflow"), Flows
  lists **“Login Flow”**, Data Sources lists **`customers.json`** (`resources/sample-data/`) — all
  presented exactly like user-created records with no sample/demo marking.
- **Probable code area:** `app/main/profileStores.ts` (`seedFolder: resources/sample-workflows` et
  al.), `app/main/ipc/dataSource.ipc.ts:283`; related hardcoded sample content in
  `app/main/ipc/runtimeInput.ipc.ts` ("Customer Onboarding Inputs"),
  `app/renderer/pages/RuntimeInputPanel.tsx`, `app/renderer/components/reports/sampleReports.ts`.
- **Evidence:** `screenshots/e2e-sweep/route-{workflowsLibrary,flowLibrary,dataSources}.png`
- **Resolution (2026-07-19):** first-run seeding removed — `profileStores.ts` `seedFolder` dropped
  (flows + workflows) and the `ensureDefaultDataSource` / `ensureDefaultRuntimeInputs` first-run
  injectors deleted (stores now return `store.list()`). Samples stay in `resources/` via
  `npm run seed:mock-fixtures`. `verify:e2e-sweep` flipped to assert empty states — **13/13 green**.

## E2E-DEF-004 — Non-security IPC has no per-role authorization — PRODUCT GAP, FIXED (bd `awkit-b92`)

- **Severity / confidence:** Medium / Confirmed · deterministic
- **Role:** Viewer (weakest role) — verified by direct preload-IPC calls from a signed-in Viewer
- **Repro:** as Viewer, call `window.playwrightFlowStudio.settings.update({...})` (patch applies)
  and `executions.runWorkflow({workflowId})` (reachable; fails only as not-found)
- **Expected (eventually):** action-level IPC enforcement (`workflow.execute`, settings mutation)
  per the deny-by-default model
- **Actual:** `settings:*` and `execution:*` handlers are sender-guarded but carry no session/role
  check; enforcement exists today only at route-mount + nav level for these areas. `security.admin.*`
  and `licensing.*` ARE fully enforced (all direct-IPC denials returned `NOT_AUTHORIZED`).
- **Resolution (2026-07-19):** the full non-admin IPC surface (`settings:*`, `execution:*`, flow/
  workflow/data-source CRUD) is now authorization-enforced by a main-owned, **sender-bound session
  context** (`app/main/security/sessionContext.ts`): each handler calls `assertSenderPermission(event,
  perm)`, deriving the acting session from `event.sender` (never renderer-supplied) and failing closed.
  Substantive `settings.update` (paths/runtime/execution/designerDefaults) requires `SETTINGS_EDIT`; a
  real run (`dryRun:false`) requires `WORKFLOW_EXECUTE` (validation/dry-run stays open).
  `verify:e2e-rbac` flipped to assert denial — **49/49 green**; new `verify:session-context` **11/11**.

## E2E-DEF-005 — Footer "Settings" / "Help Center" nav not permission-filtered — PRODUCT UX, FIXED (bd `awkit-b92`)

- **Severity / confidence:** Low / Confirmed · deterministic (route guard holds — no data exposure)
- **Role:** Viewer, Operator
- **Repro:** sign in as Viewer → the pinned footer shows **Settings** and **Help Center** although
  the role lacks `page.settings` → clicking lands on **NotAuthorized**
- **Expected (RULES.md › UI):** "No fake/no-op controls: every enabled control must do something
  real, or be disabled" — group nav items ARE permission-filtered; the pinned footer is not
- **Probable code area:** `app/renderer/layout/LeftNavigation.tsx` footer block (no `can()` filter)
- **Resolution (2026-07-19):** footer **Settings** wrapped in `can(PAGE_SETTINGS)` (hidden for
  Operator/Viewer); **Help Center** made universal — `projectContract` dropped from `RoutePermissions`
  and from the "System" nav group, so it mounts for every role from the footer instead of dead-ending
  at NotAuthorized. `verify:e2e-rbac` asserts the footer + Help-Center behavior.

---

## Exploratory observations (not reproduced as defects)

- **OBS-001 — status-bar label clarity — FIXED (2026-07-19):** the chips counted *running* flows/
  browsers but read `Flows:` / `Browsers:`. Relabelled to `Active flows:` / `Active browsers:` in
  `app/renderer/layout/StatusBar.tsx`.
- **OBS-002 — ReauthDialog reauth-window override — FIXED (2026-07-19):** added `AWKIT_REAUTH_WINDOW_MS`
  (dev/test only, mirrors `AWKIT_SESSION_IDLE_MS`) — `SecurityKernelOptions.reauthWindowMs` threaded
  into `AuthorizationService`. The reauth contract stays covered by `verify:authz` (40/40); automating
  the live GUI dialog is tracked as bd `awkit-2d8`.
