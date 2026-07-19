# E2E-RBAC — Per-role authorization: nav, route mount, direct IPC (real Electron GUI)

Executable: `scripts/verify-e2e-rbac-gui.mjs` · Roles: all four ·
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
| 9 | SuperUser control pass | Same calls succeed (or fail only for domain reasons, e.g. license NOT_FOUND status is returned, not FORBIDDEN) |
| 10 | Sensitive-op reauth UI | With a stale reauth window, a sensitive admin action pops ReauthDialog; wrong password keeps it; correct password applies the action |
| 11 | Console watch per role session | 0 renderer console errors |
