# E2E-RBAC — Per-role authorization: nav, route mount, direct IPC (real Electron GUI)

Executable: `scripts/verify-e2e-rbac-gui.mjs` (step 10 lives in the companion
`scripts/verify-e2e-reauth-gui.mjs` — `npm run verify:e2e-reauth`, awkit-2d8) · Roles: all four ·
Setup: fresh profile; SU provisions `adminuser` (Administrator), `opuser` (Operator), `viewuser`
(Viewer) via the Users page; each completes forced password change on first login.
Hiding a control is never accepted as the check: every denial is also proven by a **direct
`window.playwrightFlowStudio.*` call** from the signed-in role's renderer (the desktop equivalent of
direct URL/API access).

Per role (Administrator → Operator → Viewer), after sign-in:

| # | Step | Expected |
|---|---|---|
| 1 | Read visible left-nav item labels | Exactly the permitted set: Viewer — no Recorder/Settings/Admin group; Operator — +Recorder, no Settings/Admin; Administrator — +Settings/Roadmap etc., **no Users, no Licensing** (Roles/Permissions/Audit per role.view/audit.view) |
| 2 | Force-mount an unpermitted route (set route state directly, not via nav) | `NotAuthorized` screen renders, page component does not |
| 3 | Direct IPC `security.admin.listUsers(sessionRef)` | Denied for all three (USER_MANAGE is SU-only); no user data returned |
| 4 | Direct IPC `security.admin.createUser(...)` | Denied; user count unchanged |
| 5 | Direct IPC `licensing.getStatus(sessionRef)` | Denied for Administrator too (licensing SU-only) |
| 6 | Direct IPC `licensing.import(...)` with dummy payload | Denied before any validation |
| 7 | Viewer only: direct IPC `settings.update` minor patch | Denied; settings unchanged (read back) |
| 8 | Viewer only: direct IPC `executions.runWorkflow` on a seeded workflow | Denied; no instance appears |
| 8b | Viewer only: direct IPC `oracle.refreshSnapshot` / `oracle.deleteDataSource` | Denied — the Oracle data-source mutators require DATASOURCE_MANAGE (awkit-b3w), matching the JSON data-source surface + the DataSourceManager UI gate (denied before the existence check) |
| 9 | SuperUser control pass | Same calls succeed (or fail only for domain reasons, e.g. license NOT_FOUND status is returned, not FORBIDDEN) |
| 10 | Sensitive-op reauth UI — **dedicated launch** (`verify:e2e-reauth`, short `AWKIT_REAUTH_WINDOW_MS`, awkit-2d8) | With the reauth window lapsed, a sensitive admin action (create user) pops the real ReauthDialog and holds the action; a wrong password keeps the dialog open with an error and applies nothing; the correct password closes it and the held action is retried + applied |
| 11 | Console watch per role session | 0 renderer console errors |
