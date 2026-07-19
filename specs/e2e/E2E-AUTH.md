# E2E-AUTH — Authentication lifecycle (real Electron GUI)

Executable: `scripts/verify-e2e-auth-gui.mjs` · Roles: SuperUser + one admin-created user ·
Setup: `isolatedLaunchEnv` (fresh `%LOCALAPPDATA%`), `AWKIT_SESSION_IDLE_MS=4000` for the idle-lock case.
Data: unique usernames per run; passwords generated in-process, never persisted to any file.

| # | Step | Expected |
|---|---|---|
| 1 | Launch app on empty profile; FirstRunSetup: submit mismatched confirm password | Field error; account NOT created (still on setup) |
| 2 | Submit weak password (e.g. `short`) | Policy error listed; still gated |
| 3 | Submit valid SU creds | Auto signed in; `.app-shell` mounts |
| 4 | Users page: create `opuser` (Operator role) with weak temp password | Rejected with policy message; user absent from list |
| 5 | Create `opuser` with compliant temp password (double-click Create) | Exactly one `@opuser` row, `must reset` badge shown |
| 6 | Create `opuser` again (duplicate username) | Rejected with message; still one row |
| 7 | AccountMenu → Sign out | Login screen returns |
| 8 | Login as `opuser` with WRONG password | Generic error; stays on login |
| 9 | Login as unknown user `ghost` | Same generic error (no user enumeration) |
| 10 | Login as `opuser` with temp password | ForcedPasswordChange screen (not shell) |
| 11 | Forced change: mismatched new passwords | "Passwords do not match"; still gated |
| 12 | Forced change: non-compliant new password | Policy errors listed; still gated |
| 13 | Forced change: compliant new password | Shell mounts as `opuser` |
| 14 | Idle: wait past `AWKIT_SESSION_IDLE_MS` with no input | App locks to login with idle notice |
| 15 | Re-login with the NEW password (temp password must fail) | New password works; temp password rejected |
| 16 | Sign out; login as SU; disable `opuser`; sign out; login as `opuser` | Login refused for disabled account |
| 17 | SU: reset `opuser` password (modal) then `opuser` login with reset temp | ForcedPasswordChange again (reset revokes + forces change) |
| 18 | Console watch (whole run) | 0 renderer console errors |
