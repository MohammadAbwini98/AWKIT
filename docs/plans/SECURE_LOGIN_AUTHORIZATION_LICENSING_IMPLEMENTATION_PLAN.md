# Secure Login, Authorization & Machine-Licensing — Implementation Plan

**Product:** AWKIT / SpecterStudio (offline Electron + React + TypeScript desktop app)
**Status:** DESIGN / PLANNING ONLY — no production code is changed by this document.
**Author role:** Principal Security Architect · Senior Electron/TS Engineer · IAM Specialist · Licensing Engineer
**Date:** 2026-07-18
**Tracking issue:** `awkit-bn2`

> This plan is grounded in an inspection of the real codebase (paths and symbols cited inline). It is
> written so another agent can implement it phase-by-phase without redesigning the architecture. Every
> new concern is layered onto AWKIT's existing Electron security posture, `sql.js` durable store,
> DPAPI secret store, JSON profile stores, splash/startup coordinator, state-machine router, and
> Hologram design tokens — none of which are weakened.

---

## 1. Executive Summary

AWKIT will gain a **local-first authentication, RBAC authorization, Super-User administration, and
per-machine signed-license** subsystem that runs entirely offline, requires no administrator rights,
and preserves the portable/NSIS packaging model. The subsystem is three **separate architectural
concerns** — Authentication, Authorization, Licensing — sharing one trusted main-process boundary and
one audited storage layer.

Key decisions (justified in later sections):

1. **All trust lives in the Electron main process.** The renderer is untrusted; it never decides auth,
   never grants permissions, never mutates license state. This matches the existing global sender guard
   (`app/main/ipc/senderGuard.ts`) and `will-navigate` lockdown (`app/main/windowManager.ts`).
2. **Passwords:** hashed with **scrypt** (Node built-in `node:crypto`, per-user random salt) — zero
   native ABI, consistent with the repo's deliberate `sql.js` "no native module" philosophy. Argon2id
   is documented as an optional upgrade if a wasm/native dep is later accepted.
3. **Licenses:** **Ed25519-signed payloads** (Node built-in). The AWKIT client ships **only the public
   key** and verifies; the private signing key lives in a **separate internal license-generation
   utility** (Model 2). This is the recommended model for offline deployment.
4. **First Super User:** created via a **secure first-run bootstrap** that is *one-time* and
   *irreversible* — once any user exists, the bootstrap route is permanently closed in the trusted
   layer (guarded by a persisted `provisioned` flag, not renderer state).
5. **Startup order:** `Splash → Security/License init (main) → Login → Auth + License gate → App`.
   The main window stays hidden behind the splash (it already does — `createMainWindow({ show:false })`)
   and the renderer boots into a **locked shell** that renders *only* the login/failure surfaces until
   the main process confirms a valid session. Protected pages are never mounted pre-auth, so they
   cannot flash.
6. **Storage:** a new `security.sqlite` (same `sql.js` engine + versioned-migration framework as
   `SqliteRuntimeStore`) holds users/roles/permissions/sessions/audit/license-metadata. Password
   hashes and the signed-license blob are additionally wrapped with **DPAPI** (`safeStorage`, already
   used by `app/main/secretStore.ts`) so a copied database file is not directly usable.
7. **Active Directory** ships **visible-but-disabled** behind an `AuthenticationProvider` abstraction
   (`LocalVirtualUserProvider` active; `ActiveDirectoryProvider` a documented future boundary). No mock
   AD logic, no alternate path, not enable-able from the renderer.

**Realistic security boundary (stated plainly):** an offline client cannot be made mathematically
unbreakable. A determined local attacker with the machine can, in principle, patch the binary. The
design raises cost through signature verification, DPAPI-wrapped secrets, machine binding, fail-closed
validation, tamper/rollback detection, and audit — and it keeps the **private signing key off the
client entirely**, which is the single most important control.

---

## 2. Current Codebase Assessment

### 2.1 Startup path (real)
`app/main/main.ts` › `bootstrap()`:
1. `ensureRuntimeFolders()` (`app/main/appPaths.ts`) creates `%LOCALAPPDATA%/SpecterStudio/…`.
2. `passesOfflineStartupGate()` — in packaged/offline mode blocks on missing runtime assets
   (`evaluateOfflineStartupGate`), else shows a fatal dialog and `app.exit(1)`. **This is the natural
   insertion point for security/license *pre-window* initialization.**
3. `registerIpcHandlers()` (`app/main/ipc/index.ts`).
4. `createSplashWindow()` (frameless, sandboxed, no preload) + `createMainWindow({ show:false })`.
5. Splash plays one ~11.8 s round; main window revealed on `ready-to-show` **after** the round
   (`revealApp()` requires `mainReady && roundDone`). Hard cap 30 s.

**Implication:** the main window is already created hidden behind the splash. The login gate is a
*renderer* concern layered on top — the app must boot the renderer into a locked state.

### 2.2 Routing (real)
`app/renderer/App.tsx` is a **state-machine router**, not react-router: `activeRouteId` state +
`routes` array in `app/renderer/routes.tsx` (26 routes). `changeRoute()` mutates state and persists
`lastRouteId` to settings. On mount, `App` restores `settings.lastRouteId` and renders
`AppShell` → `ActivePage` **immediately**. There is **no gate today** — this is the flash risk to close.

### 2.3 Preload / IPC boundary (real)
- `app/main/preload.ts` exposes exactly one bridge object `window.playwrightFlowStudio` via
  `contextBridge.exposeInMainWorld` (**do NOT rename** — internal contract). Every method is a thin
  `ipcRenderer.invoke(channel, …)`. No `ipcRenderer` leaked to the page.
- `app/main/ipc/index.ts` › `installGlobalSenderGuard()` monkey-patches `ipcMain.handle` so **every**
  channel is rejected unless `isTrustedSender(event)` (`app/main/ipc/senderGuard.ts`): sender frame URL
  must start with the dev-server URL or `file://` (or empty early-load). `assertTrustedSender` adds an
  explicit per-handler guard on privileged channels.
- `app/main/windowManager.ts`: `webPreferences = { contextIsolation:true, nodeIntegration:false,
  sandbox:false, preload }`; `setWindowOpenHandler` denies in-app windows and hands http(s) to the OS
  browser; `will-navigate`/`will-redirect` block navigation off the own bundle. Splash window:
  `sandbox:true`, no preload.

**Assessment: the Electron trust boundary is already strong.** The plan extends it, it does not rebuild it.

### 2.4 Storage layers (real)
- **JSON profile stores** — `src/storage/ProfileStore.ts` (`JsonProfileStore`): one file per profile,
  atomic-rename writes, serialized write chain. Used for flows/workflows/data sources/sessions.
- **SQLite durable store** — `src/runner/store/SqliteRuntimeStore.ts` on `sql.js` (WASM, real `.sqlite`
  file, zero native ABI; in-memory + debounced atomic-rename persistence; **single-writer**;
  cross-process mutex via `src/runner/store/DurableLockStore.ts`). **Versioned migration framework**
  already exists: `RUNTIME_STORE_MIGRATIONS` in `src/runner/store/RuntimeStoreSchema.ts`
  (`{ version, name, statements[] }`) applied idempotently in `migrate()`. **Reuse this pattern.**
- **Encrypted secret store** — `app/main/secretStore.ts` + `src/secrets/SecretStore.ts`: Windows DPAPI
  via Electron `safeStorage`, base64 ciphertext in `secrets.json`, **values never returned to the
  renderer**. This is the OS-protected, admin-free credential store the plan needs.
- **Root:** `getRuntimeDataRoot()` = `%LOCALAPPDATA%/SpecterStudio` (`app/main/appPaths.ts`).

### 2.5 Machine identity (real, partial)
`src/runner/concurrency/MachineCapabilityDetector.ts`:
- `loadOrCreateMachineId(runtimeRoot)` → **random UUID** persisted to `machine-id.json`. **Copyable**;
  weak as a license anchor on its own.
- `computeCapabilityFingerprint(caps)` → `sha256(platform|arch|os|cpu|memGb).slice(0,16)` — a *stable
  hardware-shape* fingerprint (coarse; excludes hostname/patch level). **Good building block**, but not
  unique per machine (two identical PCs collide). Must be augmented for licensing.

### 2.6 Settings (real)
`app/main/uiSettings.ts` — deep-partial `UiSettings` persisted via serial write queue; renderer reads
via `settings:get`, writes via `settings:update`. Suitable for *non-sensitive* UI prefs only. Security
state must **not** live here.

### 2.7 Packaging (real)
`electron-builder.json`: `portable` + `nsis` targets; `nsis.perMachine:false`,
`allowElevation:false` → **per-user, no admin**. `extraResources` copies `resources/` + `vendor/`.
`app.isPackaged`/`isProductionOffline()` is the dev-vs-packaged discriminator — **the anchor for the
"no packaged bypass" rule**.

### 2.8 Theme / UI (real)
`app/renderer/styles/global.css` — Hologram tokens (`--awkit-*`, `--brand-*`, `--space-*`,
`--radius-*`, motion/shadow), light default + `[data-theme="dark"]`. Custom frame:
`app/renderer/layout/AppFrame.tsx` + `WindowControls.tsx`. `framer-motion` + `lucide-react` available.
Appearance persisted to settings and mirrored in `localStorage("awkit-appearance")`.

### 2.9 Naming collision to avoid (important)
`app/main/ipc/auth.ipc.ts` + `src/auth/OAuthHandoffService` and `session.ipc.ts` +
`src/session/SessionCaptureService` already exist — but they mean **browser-automation OAuth handoff**
and **captured login sessions for target sites**, *not* app login. The `window.playwrightFlowStudio.auth`
and `.session` namespaces are taken. **The new app-identity subsystem must use distinct namespaces:**
`security`, `identity`/`account`, `authz`, `license`.

### 2.10 Verification harness (real)
`npm run build` = `tsc --noEmit && electron-vite build`. Pure-logic verifiers run via `tsx`
(`scripts/verify-*.mts`) with a pass/fail counter (see `scripts/verify-security.mts`,
`verify-ipc-contract.mts`, `verify-secrets.mts`). GUI verifiers drive real Electron
(`scripts/verify-*-gui.mjs`). No `lint`/`test` npm script. `@playwright/test` is available (dev dep).

---

## 3. Existing Reusable Components

| Need | Reuse |
|---|---|
| Versioned DB + migrations | `SqliteRuntimeStore` + `RUNTIME_STORE_MIGRATIONS` pattern (`src/runner/store/`) |
| Cross-process single-writer safety | `DurableLockStore` (`src/runner/store/DurableLockStore.ts`) |
| OS-encrypted at-rest secrets (DPAPI, no admin) | `SecretStore` / `safeStorage` (`app/main/secretStore.ts`) |
| Atomic-rename write helper | `writeFileAtomic` pattern (MachineCapabilityDetector / SecretStore / ProfileStore) |
| Hardware fingerprint building block | `computeCapabilityFingerprint`, `loadOrCreateMachineId` |
| IPC trust guard | `installGlobalSenderGuard`, `assertTrustedSender` (`app/main/ipc/`) |
| Navigation lockdown | `will-navigate`/`will-redirect` + `setWindowOpenHandler` (`windowManager.ts`) |
| Startup pre-window gate | `passesOfflineStartupGate()` (`app/main/main.ts`) |
| Design tokens / custom frame | `global.css`, `AppFrame`, `WindowControls`, `framer-motion` |
| Serialized settings/write queue | `app/main/writeQueue.ts` (`createSerialQueue`) |
| Path confinement | `src/utils/pathSafety.ts` (`isPathInside`, `isReadableDataSourceFile`) |
| Node built-in crypto | `node:crypto` — `scrypt`, `randomBytes`, `randomUUID`, Ed25519 `sign/verify`, `timingSafeEqual` |

---

## 4. Identified Security Gaps

| # | Gap | Consequence today | Closed by |
|---|---|---|---|
| G-1 | No app authentication at all | Anyone opening the app has full access | Phase 2 |
| G-2 | Renderer mounts app on boot with no gate | Protected pages render before any check (flash) | Phase 6 |
| G-3 | No authorization model | All 26 routes/IPC actions unrestricted | Phase 3 |
| G-4 | No per-machine licensing | App runs on any machine indefinitely | Phase 5 |
| G-5 | `machine-id.json` is a copyable random UUID | Trivial machine spoof if used as license anchor | Phase 5 (augmented fingerprint) |
| G-6 | No security audit trail | Privileged actions/failures unrecorded | Phase 4 |
| G-7 | Settings store is renderer-writable & unsigned | Cannot hold auth/authz/license state | Phase 1 (dedicated trusted store) |
| G-8 | No tamper/clock-rollback detection | Expired licenses bypassable via clock | Phase 7 |
| G-9 | IPC payloads not schema-validated (args passed through) | Crafted args reach services | Phase 1 (Zod-free schema validators) |

---

## 5. Functional Requirements

FR-1 Login page appears immediately after splash; no protected page renders pre-auth.
FR-2 Local virtual-user auth: provisioning, registration, username rules, password policy + confirm,
scrypt hashing w/ unique salt, activate/deactivate, failed-login tracking, temporary lockout,
Super-User password reset, forced password change, last-login & password-changed timestamps,
sessions, expiration, logout, post-logout reuse prevention.
FR-3 AD option visible, labelled "Coming Soon", disabled, no logic, not renderer-enableable.
FR-4 Super User: full user/role/permission administration, license management, audit review;
enforced in trusted layer; reauth for sensitive ops.
FR-5 RBAC + permission registry enforced at navigation, route, UI-control, IPC, and service layers.
FR-6 Per-machine signed license: create (external), import, replace, revoke, machine binding,
expiration to the minute (UTC stored, local displayed), status, actors, audit.
FR-7 Fail-closed generic failure screen (`Something went wrong. Please contact your system
administrator.`) with safe differentiation + safe actions only.
FR-8 First Super User via one-time irreversible bootstrap.
FR-9 Super-User license recovery/replace without exposing the full app.

## 6. Non-Functional Requirements

NFR-1 Fully offline; no network for local login/licensing.
NFR-2 No administrator privileges; portable + NSIS per-user.
NFR-3 Preserve `window.playwrightFlowStudio` identifier and existing IPC.
NFR-4 Hologram theme tokens only; light/dark; custom frame; keyboard-accessible.
NFR-5 No new native module unless justified (prefer Node built-ins / wasm). `sql.js` reused.
NFR-6 Fail-closed everywhere; no packaged bypass; secrets never logged.
NFR-7 `tsc --noEmit` clean; new `verify:*` scripts green.
NFR-8 Migrations forward-only, versioned, idempotent, safe on empty DB.

---

## 7. Proposed Architecture

```
                          ELECTRON MAIN (trusted)
 ┌───────────────────────────────────────────────────────────────────────┐
 │  SecurityKernel (bootstrapped in main.ts, before window reveal)        │
 │   ├─ SecurityStore  (sql.js: users, roles, permissions, sessions,     │
 │   │                  failed_logins, lockouts, audit, license_meta)     │
 │   │      + DurableLockStore mutex   + DPAPI-wrapped sensitive columns  │
 │   ├─ AuthenticationService ── AuthenticationProviderRegistry           │
 │   │        ├─ LocalVirtualUserProvider (active)                        │
 │   │        └─ ActiveDirectoryProvider  (disabled, future)              │
 │   ├─ SessionManager (main-owned; maps webContentsId → principal)      │
 │   ├─ AuthorizationService (permission registry; requirePermission)    │
 │   ├─ MachineIdentityService (augmented fingerprint + request code)    │
 │   ├─ LicenseValidationService (Ed25519 verify, binding, expiry,       │
 │   │        rollback detection; fail-closed)                            │
 │   └─ AuditLogger (append-only, hash-chained)                          │
 └───────────────────────────────────────────────────────────────────────┘
        ▲  IPC (allowlisted, schema-validated, sender-guarded, session-checked)
        │  channels: security:*  authz:*  license:*   via window.playwrightFlowStudio.security/.license
        ▼
                        PRELOAD (contextBridge)  — adds .security / .license only
        ▲
        ▼
                          RENDERER (untrusted)
 ┌───────────────────────────────────────────────────────────────────────┐
 │  <App> → SecurityGate                                                  │
 │     state = uninitialized | firstRun | login | forcedPwChange |        │
 │             licenseFailure | authed                                    │
 │     • uninitialized/login/failure  → LockedShell (login/failure only)  │
 │     • authed                       → existing AppShell + guarded routes │
 │  PermissionContext (snapshot of principal.permissions) drives UI hints │
 └───────────────────────────────────────────────────────────────────────┘

                 SEPARATE, OFFLINE — not shipped in client
 ┌───────────────────────────────────────────────────────────────────────┐
 │  awkit-license-tool (internal CLI): holds Ed25519 PRIVATE key,        │
 │  turns a machine request code → signed license file (.awlic)          │
 └───────────────────────────────────────────────────────────────────────┘
```

**Three separate concerns, one kernel:** `AuthenticationService` (who you are),
`AuthorizationService` (what you may do), `LicenseValidationService` (may this machine run at all) are
independent classes with independent stores/tables and independent failure modes, composed by a thin
`SecurityKernel`.

---

## 8. Startup & Routing Flow

### 8.1 Target sequence
```
app launch → bootstrap() → ensureRuntimeFolders
  → passesOfflineStartupGate (existing)
  → SecurityKernel.init()            [NEW, main, pre-window]
       • open SecurityStore, run migrations
       • MachineIdentityService.resolve()
       • LicenseValidationService.validateCurrentMachineLicense()  → cache result
       • detect provisioned? (any user exists)
  → registerIpcHandlers (existing + security/authz/license)
  → splash + main window (show:false)  [existing]
  → renderer boots into SecurityGate = "uninitialized"
       • calls security:getBootState  → { provisioned, licenseState, sessionResumable }
       • routes to: firstRun | login | licenseFailure
  → user authenticates → security:login → main creates session, returns principal snapshot
  → SecurityGate = "authed" → mount existing AppShell + guarded router
```

### 8.2 Ordering: license vs auth
- **Hard license failures** (missing/invalid-signature/machine-mismatch/revoked/tamper/rollback) gate
  **before** login → `licenseFailure` screen. Rationale: an unlicensed machine should not present a
  login form implying it will work. **Exception:** the failure screen exposes *only* license
  import/activation + retry + copy-request-code + exit (so a Super User can recover). Importing a
  license does **not** require login (chicken-and-egg on a fresh machine); the import handler is
  guarded by signature verification, not by session.
- **Expiring/expired but present** license: allow login, then show a blocking in-app banner and route
  the Super User to License Management; ordinary users get the failure screen.
- Re-validation points: startup (after splash); before privileged ops; periodically during long
  sessions (default 15 min); before each workflow execution start; on detected system-time change; on
  machine-identity change; on new-license import.

### 8.3 No-flash guarantee
`App.tsx` is refactored so the **only** thing it can render before `authed` is `LockedShell`
(login/first-run/failure). `routes.tsx` components are never imported/mounted until `authed`. Because
the main window is already hidden until `ready-to-show` fires *after* the splash round, the first
painted frame the user sees is the login page — never a protected route. A verifier asserts this
(`verify:auth-no-flash`).

---

## 9. Authentication-Provider Design

```ts
// src/security/auth/AuthenticationProvider.ts
export type ProviderId = "local" | "activeDirectory";

export interface AuthenticationProvider {
  readonly id: ProviderId;
  readonly displayName: string;
  isEnabled(): boolean;            // trusted-layer truth; AD returns false in this release
  authenticate(input: CredentialInput): Promise<ProviderAuthResult>;
}

export interface CredentialInput { username: string; password: string; }
export type ProviderAuthResult =
  | { ok: true; providerUserKey: string; displayName?: string }
  | { ok: false; reasonCode: AuthReasonCode };   // never a free-text leak
```

- `LocalVirtualUserProvider` (active) verifies scrypt hash from `SecurityStore`.
- `ActiveDirectoryProvider` (future) — a stub whose `isEnabled()` returns `false` and whose
  `authenticate()` throws `NOT_IMPLEMENTED`. **The registry never registers it as enabled**, and the
  login IPC rejects any `providerId` whose `isEnabled()` is false — so DevTools flipping the disabled
  button cannot select AD. Its integration boundary (LDAP/Kerberos, credential-less SSO, group→role
  mapping) is documented in §30, not built.
- **Enablement is a trusted-layer decision.** `security:getLoginOptions` returns
  `[{ id, displayName, enabled }]`; the renderer renders AD greyed with a "Coming Soon" chip. The main
  process ignores any attempt to authenticate against a disabled provider.

---

## 10. Virtual-User Authentication Design

### 10.1 Account model
```ts
interface UserAccount {
  id: string;                    // randomUUID
  username: string;              // unique, case-insensitive normalized
  displayName: string;
  status: "active" | "disabled";
  passwordHash: string;          // scrypt, DPAPI-wrapped column
  passwordSalt: string;          // 16-byte random, per user
  passwordAlgo: "scrypt";        // versioned for future migration
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: string | null;    // ISO UTC
  lastLoginAt: string | null;    // ISO UTC
  passwordChangedAt: string;     // ISO UTC
  isProtectedSuperUser: boolean; // original SU: cannot be deleted/deactivated
  createdAt: string; createdBy: string;
  updatedAt: string; updatedBy: string;
}
```

### 10.2 Username rules
3–32 chars, `^[A-Za-z0-9._-]+$` (mirrors existing `SECRET_NAME_PATTERN` style), normalized to
lowercase for uniqueness, cannot start/end with `.`/`-`, reserved names blocked (`system`, `admin`
allowed only for the bootstrap SU if chosen). Enforced in the trusted layer, not just the form.

### 10.3 Password policy
- ≥ 12 chars; must include 3 of 4 classes (upper/lower/digit/symbol); max 200.
- Reject the username, obvious sequences, and a small bundled common-password denylist (offline file
  under `resources/`, not network).
- Confirmation field must match (renderer UX + trusted re-check).
- **Hashing:** `scrypt(password, salt, 64, {N:2^15, r:8, p:1})` via `node:crypto.scryptSync`
  (main process, async wrapper). Compare with `timingSafeEqual`. Salt = `randomBytes(16)`.
  Parameters stored via `passwordAlgo` version so cost can be raised later with a rehash-on-login path.
- Argon2id documented as optional upgrade (needs `@node-rs/argon2` native or wasm) — not default.

### 10.4 Lockout / failed-login
- Track `failedLoginCount`; after N=5 consecutive failures set `lockedUntil = now + 15 min`
  (exponential backoff on repeat lockouts, capped). Successful login resets count.
- Login response is **uniform** whether username is unknown, password wrong, or account
  disabled/locked → single `INVALID_CREDENTIALS` reason externally, with distinct **audit** reason
  codes internally. (Locked accounts may optionally surface "temporarily locked" without confirming
  existence — decision O-3.)

### 10.5 Sessions (see §13 for full lifecycle)
On success: create a main-owned session, bind to the calling `webContents`, return a **principal
snapshot** (id, displayName, roleIds, effective permissions, `mustChangePassword`, license summary).
The renderer stores nothing authoritative — a `sessionRef` opaque id only, used for subsequent IPC.

### 10.6 Password lifecycle
- `mustChangePassword` forces a change screen post-login before the app mounts.
- Super User reset: sets a new temp password (or generates one shown once) + `mustChangePassword=true`.
- Self-service change requires current password + reauth.
- `passwordChangedAt` updated on every change; `lastLoginAt` on every success.

### 10.7 Anti-manipulation
- The renderer cannot mint a session, cannot set `status`, `roleIds`, or `mustChangePassword`.
- `security:login` is the only path to a session; it runs entirely in main; the returned snapshot is
  **read-only informational** — authorization is always re-checked server-side per IPC call, never
  trusting the snapshot.

---

## 11. Super User Design

- **Provisioning:** created only by the one-time first-run bootstrap (§18). Exactly one **protected**
  Super User (`isProtectedSuperUser=true`) is created and can never be deleted or deactivated (trusted
  invariant). Additional Super Users **are supported** (assign the `SuperUser` role) but are ordinary
  deletable accounts.
- **Password security:** same policy as all users; bootstrap enforces a strong password (no default,
  no universal password — hard constraint).
- **Recovery strategy:** if the protected SU password is lost, recovery is a **documented offline
  procedure** using a **recovery code** generated at bootstrap (a random secret shown once, its hash
  stored DPAPI-wrapped). Entering the recovery code on the login screen forces a SU password reset and
  is fully audited. If the recovery code is also lost, the fallback is a support-assisted reset that
  requires the internal license tool to issue a signed `reset-token` bound to the machine request code
  (keeps the private key off the client). No silent backdoor.
- **Separation:** authentication (identity) ≠ roles/permissions (authorization) ≠ licensing. A Super
  User is just a user holding the `SuperUser` role; license actions require both the `LICENSE_MANAGE`
  permission **and** a fresh reauth.
- **Reauth for sensitive ops:** create/reset/deactivate user, assign SU role, import/replace/revoke
  license, edit security config → require password re-entry within the last 5 minutes (main-tracked
  `lastReauthAt` per session).
- **Audit:** every privileged change writes an audit event (§23) with actor, target, action, result,
  reason code, session id, app version, machine-hash, correlation id.

---

## 12. Roles & Permissions Design

### 12.1 Permission registry (single source of truth)
`src/security/authz/Permissions.ts` — a frozen enum-like constant map. **No permission string is
hardcoded in UI components**; components import `Permission.*`.

```ts
export const Permission = {
  // page-level
  PAGE_DASHBOARD: "page.dashboard",
  PAGE_WORKFLOW_BUILDER: "page.workflowBuilder",
  PAGE_FLOW_DESIGNER: "page.flowDesigner",
  PAGE_DATA_SOURCES: "page.dataSources",
  PAGE_INSTANCES: "page.instances",
  PAGE_REPORTS: "page.reports",
  PAGE_SETTINGS: "page.settings",
  PAGE_USER_MANAGEMENT: "page.userManagement",
  PAGE_LICENSE_MANAGEMENT: "page.licenseManagement",
  // feature/action
  WORKFLOW_VIEW: "workflow.view",   WORKFLOW_CREATE: "workflow.create",
  WORKFLOW_EDIT: "workflow.edit",   WORKFLOW_DELETE: "workflow.delete",
  WORKFLOW_EXECUTE: "workflow.execute", WORKFLOW_STOP: "workflow.stop",
  REPORT_EXPORT: "report.export",
  SETTINGS_EDIT: "settings.edit",
  DATASOURCE_MANAGE: "datasource.manage",
  CONFIG_VIEW_SENSITIVE: "config.viewSensitive",
  USER_MANAGE: "user.manage",
  LICENSE_MANAGE: "license.manage",
  AUDIT_VIEW: "audit.view",
} as const;
export type Permission = typeof Permission[keyof typeof Permission];
```
A **route→permission map** (`RoutePermissions`) associates each `RouteId` in `routes.tsx` with a
required page permission (unmapped routes default-deny for non-SU).

### 12.2 Roles
- Ship **protected built-in roles** in v1 (recommendation: defer custom role *creation* to v2 to
  reduce attack surface): `SuperUser` (all permissions incl. `USER_MANAGE`/`LICENSE_MANAGE`),
  `Administrator` (all except user/license management), `Operator` (view/execute/stop workflows,
  reports, data sources), `Viewer` (view-only). Built-in roles are immutable; the SU assigns them and
  may apply **direct per-user permission overrides** (grant/deny) if enabled.
- `effectivePermissions(user) = union(role.permissions for role in user.roles) with overrides applied`.
  Computed in the trusted layer.

### 12.3 Enforcement at every layer (defense in depth)
1. **Navigation** — `LeftNavigation` filters items by `PermissionContext.can(pagePerm)` (UI hint only).
2. **Route/page** — `SecurityGate`/router refuses to mount a route whose page permission is absent
   (direct `navigateTo` and restored `lastRouteId` both re-checked); falls back to Dashboard or a
   "not authorized" panel.
3. **UI control** — action buttons disabled/hidden via `can(perm)` (hint only; never the boundary).
4. **IPC** — every mutating handler calls `AuthorizationService.requirePermission(principal, perm)`
   **after** session validation; unauthorized → throw with a safe reason code. This is the real
   boundary. A crafted `ipcRenderer`-style call (or DevTools) fails here even if the button was forced.
5. **Service/domain** — services accept a `principal` and re-assert critical permissions
   (belt-and-suspenders for internally-reused code paths).
6. **DB operation** — destructive store methods (user delete, license write) additionally assert the
   `isProtectedSuperUser`/actor invariants.

> **Hiding a button is never authorization.** Every restricted action has a matching main-process
> `requirePermission` check, and Phase 8 tests invoke the IPC channel directly (bypassing the UI) to
> prove denial.

---

## 13. Session-Management Design

- **Identifier:** `randomBytes(32).toString("base64url")`, generated in main. Renderer receives an
  opaque `sessionRef`; the real session record (principal, timestamps) lives in main + `SecurityStore`.
- **Storage:** session rows in `SecurityStore` (`sessions` table) for restart-resume decisions; the
  live binding `webContentsId → sessionId` is in-memory in `SessionManager`. **Never in localStorage.**
- **Expiration:** idle timeout (default 30 min, configurable), absolute timeout (default 12 h). Renewal
  slides the idle window on validated activity but never past absolute.
- **Validation:** every IPC call resolves the session for its `webContents`; expired/absent → the call
  returns `SESSION_EXPIRED` and the renderer drops to the login screen.
- **Logout:** `security:logout` deletes the session record + in-memory binding; the `sessionRef` is
  immediately invalid (reuse-after-logout returns `SESSION_EXPIRED`). Tombstone kept briefly for audit.
- **App restart:** sessions do **not** silently resume by default (fresh login required). Optional
  "resume within N minutes" is a decision (O-5); if enabled, resume is gated on unchanged machine
  fingerprint + valid license + non-expired absolute timeout.
- **Lock screen:** idle lock re-prompts for password without full logout (session preserved), then
  reauth continues.
- **Multiple windows:** each `webContents` binds to the same underlying user session; logout in one
  invalidates all. New windows created while unauthenticated open into `LockedShell`.
- **Renderer cannot create sessions:** only `security:login`/recovery paths mint sessions in main.
- **Permission snapshot vs refresh:** the renderer holds a snapshot for UI hints; the trusted layer
  re-reads live permissions per IPC (so a mid-session permission/role change or deactivation takes
  effect on the next call). On deactivation or license expiry mid-session, the next validated call
  fails closed and the renderer is bounced to login/failure.
- **Sensitive-op reauth:** `security:reauth(password)` refreshes `lastReauthAt`; sensitive handlers
  require it fresh (≤5 min).
- **Credential storage:** password hashes via DPAPI (`safeStorage`); no plaintext token/password ever
  in `localStorage`/`sessionStorage`.

---

## 14. Machine-Identity Design

> **Detailed companion spec:** the versioned, multi-claim, no-admin fingerprint (SMBIOS UUID, BIOS
> serial, MachineGuid, system disk serial), placeholder rejection, hash-before-persist, weighted
> matching, safe request code, and fail-closed/recovery behaviour are fully specified in
> [`MACHINE_FINGERPRINT_DESIGN.md`](MACHINE_FINGERPRINT_DESIGN.md). §14 below is the summary; that
> document is authoritative for Phase 5's `MachineIdentityService` and supersedes the sketch here.

### 14.1 Attributes usable without admin (Windows, per-user)
- OS/arch/CPU-count/total-RAM band — already via `MachineCapabilityDetector` (no admin).
- **`HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`** — readable (not writable) without admin via
  `reg query` / registry read; stable across reboots, changes on OS reinstall.
- **Primary volume serial number** (`C:` `VolumeSerialNumber`) — readable without admin; changes on
  disk reformat/replace.
- **Machine `os.hostname()`** — weak (user-changeable), used as low-weight signal only.
- Persisted install id (`machine-id.json`) — copyable, so **low weight**, used to detect *folder copy*,
  not as identity.

> Avoid MAC addresses as a primary signal (change with adapters/VMs/docking) — include at most as a
> low-weight optional signal. Never require WMI/admin-only calls.

### 14.2 Composite fingerprint (privacy-conscious)
```ts
interface MachineFingerprint {
  version: 1;
  primary: string;   // sha256(MachineGuid | volumeSerial | os | arch)  → hex
  weighted: Array<{ signal: string; hash: string; weight: number }>;   // hashed, never raw
  requestCode: string; // short human-readable, derived from primary (for support)
}
```
- **Store only hashes** (`sha256`), never raw GUID/serial. Reuse `computeCapabilityFingerprint` as one
  weighted signal.
- **Binding match** = primary matches **OR** a weighted quorum (≥ threshold weight) matches — tolerates
  a single legitimate change (e.g., RAM upgrade) without false rejection, but rejects a wholesale
  different machine.
- **`version`** allows a future fingerprint-algorithm migration: old licenses validated under v1, new
  issued under v2, with a documented re-binding path.

### 14.3 Scenario handling
| Scenario | Effect | Recovery |
|---|---|---|
| RAM/GPU upgrade | weighted signal changes, quorum still holds | none needed |
| Disk replaced/reformatted | volume serial changes → below quorum | reactivate (new request code) |
| OS reinstall | MachineGuid changes → mismatch | reactivate |
| VM clone | fingerprint identical to source → both bound → detected as clone via install-id + license-single-use | revoke + reissue; audit `MACHINE_MISMATCH`/clone |
| Network adapter change | no effect (MAC low/omitted) | none |
| Server/headless | same signals available; hostname weight low | normal |
| Legit hardware change | quorum tolerance; if exceeded → clear failure + reactivation | Super User re-imports license |

**False-rejection mitigation:** quorum tolerance + a grace re-validation window + clear reactivation
flow. Machine binding failures are **audited** and produce the generic failure screen with the
license-import path available.

---

## 15. Signed-License Design

### 15.1 Canonical payload
```ts
interface LicensePayloadV1 {
  schema: 1;
  licenseId: string;              // uuid
  machineBinding: { version: 1; primary: string; quorum: string[] }; // hashes only
  issuedAt: string;               // ISO UTC
  activatesAt: string;            // ISO UTC
  expiresAt: string;              // ISO UTC (single canonical instant)
  status: "active" | "revoked";
  seat: { product: "AWKIT"; edition: string };
  metadata?: Record<string, string>;   // optional, non-sensitive
  issuer: { keyId: string };            // which public key verifies this
}
interface SignedLicense { payload: LicensePayloadV1; signature: string; } // Ed25519 over canonical JSON
```
- **Canonical serialization:** deterministic JSON (sorted keys, no whitespace, explicit field order)
  so the signed bytes are reproducible. A shared `canonicalize()` used by both the tool and the client.
- **Expiration UI vs storage:** UI edits **year/month/day/hour/minute** (local tz); the tool composes a
  single `expiresAt` UTC instant. The client stores/validates only `expiresAt` and converts to local tz
  for display. No separate day/month/year columns internally.
- **Displayed serial** = a human-readable id derived from `licenseId`/`keyId` (masked in UI). It is
  **cosmetic**; authorization depends on the **signature + binding + expiry**, never the visible string.

### 15.2 Verification (client, main process)
```
importSignedLicense(bytes):
  parse → validate schema/version (unsupported → fail-closed)
  verify Ed25519 signature with bundled public key(s)   [reject on fail]
  verify machineBinding quorum against MachineIdentityService
  verify activatesAt ≤ now ≤ expiresAt (with rollback guard, §16)
  verify status !== revoked (+ local revocation list if present)
  → persist SignedLicense (DPAPI-wrapped) + license_meta row + audit
validateCurrentMachineLicense(): re-runs verify against stored blob; cached with TTL; fail-closed.
```
- **Public key** shipped in `resources/license/awkit-license-pub.ed25519` (+ optional key-rotation set
  with `keyId`). **No private key anywhere in the client or repo.**

### 15.3 Where licenses are created — model comparison
| Model | Private key location | Verdict |
|---|---|---|
| **M1** Local SU generates full signed license | **inside client** | ✗ Rejected — shipping the private key means any user can mint licenses; defeats the scheme. |
| **M2** Separate internal license-generation utility | on a controlled build/admin machine, **never** in client | ✓ **Recommended.** Client verifies with public key only. SU exports a machine **request code**; the tool issues a signed `.awlic`; SU imports it. Fully offline (files can be emailed/USB-transferred). |
| **M3** Enterprise licensing service | central server | Future option; violates current offline/no-network constraint for issuance. Documented as later evolution; validation stays client-side. |

**Recommendation: M2 now, M3-compatible later.** The `awkit-license-tool` is a small internal CLI
(kept out of `electron-builder.json` `files`), documented in §29/§30.

---

## 16. License Lifecycle & Tamper Resistance

```
Unlicensed → (request code exported) → license issued by internal tool
  → imported/activated in client → signature verified → machine binding verified
  → expiration verified → ACTIVE → periodically revalidated
  → { expires | revoked | machine-changed | replaced } → back to Unlicensed/failure
```

**Tamper & rollback controls:**
- Ed25519 signature over canonical payload — any field edit invalidates it.
- License blob + password hashes stored **DPAPI-wrapped** → copying `security.sqlite` to another
  machine yields undecryptable blobs (DPAPI is per-user/per-machine).
- **Clock rollback:** persist a monotonic **`lastKnownGoodTime`** (max observed validated time,
  DPAPI-wrapped, updated on each successful validation + periodically). If `now < lastKnownGoodTime -
  skew` → treat as suspicious rollback → fail-closed + audit `SUSPICIOUS_TIME_ROLLBACK`. Combine with
  OS boot-time sanity to reduce false positives from legit clock fixes (surfaced to SU as a warning
  when ambiguous).
- **Restored old DB with valid license:** the current fingerprint + `lastKnownGoodTime` + license
  `licenseId` single-use tracking detect stale reuse; expiry still applies.
- Fail-closed: any exception, parse failure, or unknown state → invalid → generic failure screen.

**Honest boundary statement (required):** these controls raise cost and detect casual tampering; they
do **not** make a local offline client unbreakable. The private-key-off-client design is what preserves
integrity even against a fully compromised client.

---

## 17. Secure-Storage Design

| Data | Location | Protection |
|---|---|---|
| Users, roles, permissions, user-role maps, overrides | `security.sqlite` (sql.js) | DB file; sensitive columns DPAPI-wrapped |
| Password hashes + salts | `security.sqlite` | **DPAPI-wrapped** column |
| Sessions, failed-logins, lockouts | `security.sqlite` | DB file |
| Audit events | `security.sqlite` (`audit` table) | hash-chained rows |
| License metadata | `security.sqlite` (`license_meta`) | DB file |
| Signed license blob (`.awlic`) | `security/license.blob` | **DPAPI-wrapped** file |
| Machine fingerprint hashes | `security.sqlite` / `security/machine.json` | hashes only, never raw |
| `lastKnownGoodTime`, recovery-code hash | `security/security-state.blob` | **DPAPI-wrapped** |
| Public verify key | `resources/license/*.ed25519` | read-only bundled asset |
| Security config | `security.sqlite` (`security_config`) | DB file |

- New root: `getRuntimeDataRoot()/security/` (created in `ensureRuntimeFolders`).
- **Single-writer** `SecurityStore` guarded by a dedicated `DurableLockStore` lock (reuse pattern);
  atomic-rename persistence (reuse `SqliteRuntimeStore` mechanics).
- **DPAPI caveat:** `safeStorage` is per-Windows-user. Consequences (all handled in §18/§28):
  copied DB → hashes/license undecryptable (good, anti-theft); **multiple Windows users on one machine**
  → each Windows user gets separate DPAPI scope, so security data must be per-Windows-user (it already
  is, under `%LOCALAPPDATA%`), or the plan chooses machine-scope DPAPI where shared install is required
  (decision O-6). **Portable copy to a new machine** → security state won't decrypt → treated as
  unprovisioned/unlicensed (fail-closed, correct).
- Backup/restore: a backup of `security/` restores only on the same Windows-user+machine (DPAPI).
  Cross-machine restore intentionally fails closed.

---

## 18. Database Schema & Migrations

New store `SecurityStore` on `sql.js`, its own migration array `SECURITY_STORE_MIGRATIONS`
(`{version,name,statements[]}`), applied by the same idempotent `migrate()` loop as
`SqliteRuntimeStore`. Forward-only. Migration 1 (initial):

```sql
CREATE TABLE security_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, appliedAt TEXT NOT NULL);
CREATE TABLE users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, usernameNorm TEXT NOT NULL UNIQUE,
  displayName TEXT NOT NULL, status TEXT NOT NULL,
  passwordHash BLOB NOT NULL, passwordSalt BLOB NOT NULL, passwordAlgo TEXT NOT NULL,
  mustChangePassword INTEGER NOT NULL DEFAULT 0,
  failedLoginCount INTEGER NOT NULL DEFAULT 0, lockedUntil TEXT,
  lastLoginAt TEXT, passwordChangedAt TEXT NOT NULL,
  isProtectedSuperUser INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL, createdBy TEXT NOT NULL, updatedAt TEXT NOT NULL, updatedBy TEXT NOT NULL);
CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, builtIn INTEGER NOT NULL, description TEXT);
CREATE TABLE role_permissions (roleId TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY(roleId,permission));
CREATE TABLE user_roles (userId TEXT NOT NULL, roleId TEXT NOT NULL, PRIMARY KEY(userId,roleId));
CREATE TABLE user_permission_overrides (userId TEXT NOT NULL, permission TEXT NOT NULL, effect TEXT NOT NULL, PRIMARY KEY(userId,permission));
CREATE TABLE sessions (
  id TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL,
  lastActivityAt TEXT NOT NULL, absoluteExpiresAt TEXT NOT NULL, lastReauthAt TEXT, revokedAt TEXT);
CREATE TABLE license_meta (
  licenseId TEXT PRIMARY KEY, status TEXT NOT NULL, issuedAt TEXT, activatesAt TEXT, expiresAt TEXT,
  keyId TEXT, machinePrimaryHash TEXT, createdBy TEXT, lastModifiedBy TEXT,
  importedAt TEXT, revokedAt TEXT, revokedReason TEXT, metadataJson TEXT);
CREATE TABLE audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actorUserId TEXT, actorName TEXT,
  eventType TEXT NOT NULL, targetType TEXT, targetId TEXT, result TEXT NOT NULL, reasonCode TEXT,
  sessionId TEXT, appVersion TEXT, machineHash TEXT, correlationId TEXT, detailJson TEXT,
  prevHash TEXT, rowHash TEXT NOT NULL);       -- hash chain
CREATE TABLE security_config (key TEXT PRIMARY KEY, valueJson TEXT NOT NULL);
CREATE TABLE provisioning (id INTEGER PRIMARY KEY CHECK (id=1), provisioned INTEGER NOT NULL, provisionedAt TEXT, recoveryCodeHash BLOB);
```

- **First-run bootstrap safety (G-2/FR-8):** `provisioning.provisioned` starts `0`. The bootstrap IPC
  creates the protected SU **inside a transaction** that flips `provisioned=1`; the handler refuses if
  `provisioned=1` **or** any `users` row exists. This makes SU creation **one-time and irreversible** —
  an ordinary user cannot silently create an unrestricted admin after provisioning.
- **Existing installations with no security tables:** on first launch after upgrade, `security.sqlite`
  is absent → migrations create empty tables → `provisioned=0` → app routes to first-run bootstrap.
  Existing flows/workflows/data sources/reports (separate JSON stores + `runtime.sqlite`) are
  **untouched and remain accessible after login** — no data migration of feature data.

---

## 19. Electron Trust Boundaries

| Boundary | Trusted? | May it… |
|---|---|---|
| Main process | ✓ trusted | decide auth, grant permissions, mutate license, read hashes/keys, DB writes |
| Preload (`preload.ts`) | ✓ (bridge only) | expose allowlisted `invoke` wrappers; no logic, no secrets |
| Renderer | ✗ **untrusted** | render UI, request actions via allowlisted IPC only |
| `security.sqlite` / blobs | data | never read/written by renderer |
| Workflow engine | trusted (main-side) | receives `principal`; re-checks `WORKFLOW_EXECUTE` + license before run |
| Auth/Authz/License services | trusted | main-only singletons |
| License-gen utility | out-of-band | holds private key; not shipped |
| OS APIs (DPAPI/registry) | trusted | main-only |

**The renderer must not:** decide auth validity, self-grant permissions, mutate license, generate
serials, access password hashes/private keys, or run privileged DB writes. Enforced by: contextIsolation
+ no nodeIntegration (existing), global sender guard (existing), per-handler session+permission checks
(new), and the fact that all state lives in main.

---

## 20. IPC Security Design

### 20.1 New namespaces (avoid the `auth`/`session` collision, §2.9)
`window.playwrightFlowStudio.security` and `.license` (added to `preload.ts` alongside existing
namespaces; **no rename** of the root object).

```
security:getBootState                 → { provisioned, licenseState, sessionResumable }
security:getLoginOptions              → [{ id, displayName, enabled }]
security:bootstrapSuperUser(input)    → { ok } | { error }        (one-time; provisioned-guard)
security:login({providerId,username,password}) → { ok, principalSnapshot } | { error:reasonCode }
security:logout()                     → void
security:validateSession()            → { valid, principalSnapshot? }
security:reauth({password})           → { ok }
security:changePassword({current,next}) → { ok } | { error }
security:recoverSuperUser({recoveryCode,newPassword}) → { ok } | { error }
authz:getEffectivePermissions()       → string[]     (snapshot; UI hint)
// admin (require SuperUser/USER_MANAGE + reauth):
security:admin:listUsers / createUser / updateUser / setStatus / resetPassword / forcePwChange /
         assignRoles / setOverrides / listRoles / getEffective(userId)
security:admin:listAudit(filter)      (require AUDIT_VIEW)
license:getStatus()                   → masked view
license:getRequestCode()              → string
license:import(bytes)                 (require LICENSE_MANAGE + reauth, or unauth on failure screen)
license:replace(bytes) / revoke() / getAuditHistory()
```

### 20.2 Controls on every channel
1. **Sender guard** (existing global) — untrusted frame rejected.
2. **Session resolution** — resolve `webContents → session`; expired/absent → `SESSION_EXPIRED`
   (except `getBootState`/`getLoginOptions`/`login`/`bootstrap`/`recover`/license-failure-import).
3. **Schema validation** — hand-written type-guard validators (no new dep; matches repo style) reject
   malformed payloads before any service call. Arbitrary/unknown channels don't exist → rejected.
4. **Permission check** — `requirePermission(principal, perm)` for mutating/admin channels.
5. **Reauth check** — sensitive channels require fresh `lastReauthAt`.
6. **Fail-closed + safe errors** — thrown errors carry reason codes only; details go to audit, never
   to the renderer (§22). No password/hash/key/path ever crosses the bridge.

### 20.3 Contract test
Extend `scripts/verify-ipc-contract.mts` to assert every `security:*`/`license:*` channel exists in
main, is in the preload allowlist, and rejects untrusted sender + malformed payload.

---

## 21. UI & UX Design

### 21.1 Component structure (new, renderer)
```
app/renderer/security/
  SecurityGate.tsx            // top-level state machine; wraps <App> content
  LockedShell.tsx             // frame + centered card, pre-auth chrome (custom AppFrame reused)
  screens/
    FirstRunSetup.tsx         // create protected Super User (one-time)
    LoginScreen.tsx           // provider tabs (Local active, AD disabled), username/password
    ForcedPasswordChange.tsx
    LicenseFailureScreen.tsx  // generic message + safe actions
    LockScreen.tsx            // idle re-prompt
  components/
    PasswordField.tsx         // show/hide, Caps-Lock indicator, no value in logs
    ProviderTabs.tsx          // AD tab shows "Coming Soon", disabled
  admin/                      // authed-only pages (registered as new routes, permission-gated)
    UserManagement.tsx  RolePermissionPanel.tsx  LicenseManagement.tsx  AuditLog.tsx
  PermissionContext.tsx       // snapshot + can(perm) hook
```

### 21.2 Login page requirements (all satisfied)
- Hologram tokens only (`--awkit-*`, `--brand-*`, `--space-*`, `--radius-*`); light + dark via
  `[data-theme]`; custom `AppFrame` at top; SpecterStudio wordmark/brand consistent.
- `framer-motion` for restrained entrance (respect `usePrefersReducedMotion`, already in shared).
- Keyboard accessible; visible focus rings; `aria-label`s; loading + disabled states; duplicate-submit
  guard (disable button + in-flight flag); **generic** `INVALID_CREDENTIALS` (never reveals whether the
  username exists); Caps-Lock indicator; safe show/hide password; **password never logged** (no
  console, no audit detail).
- AD option rendered as a disabled tab with a "Coming Soon" chip — visually present, non-interactive.
- License-failure screen shows the generic message + safe actions only; no implementation detail.

### 21.3 New routes
Add `userManagement`, `roles`, `licenseManagement`, `auditLog` to `routes.tsx` with `Permission.*`
mappings; hidden from `LeftNavigation` unless permitted.

---

## 22. Error-Handling Strategy

- **User-facing default:** `Something went wrong. Please contact your system administrator.`
- **Safe differentiation** (coarse, non-revealing) where it helps the user act:
  `License not activated` · `License expired` · `Machine authorization failed` ·
  `Application access unavailable` · `Account temporarily unavailable` · `Invalid credentials`.
- **Reason-code enum** crosses the bridge; **detailed context** (which signal mismatched, validation
  step, fingerprints) is written **only** to the protected audit/diagnostic log.
- **Never exposed to renderer/logs:** crypto material, full machine fingerprints, password hashes,
  sensitive file paths, signing keys, internal validation logic.
- Safe actions on the failure screen: Retry validation · Import/activate license (when permitted) ·
  Copy non-sensitive support/request code · Exit. No path to protected pages.

---

## 23. Audit-Logging Strategy

- **Append-only, hash-chained** `audit` table: each row stores `rowHash = sha256(prevHash + canonical(row))`.
  Tampering (row edit/delete) breaks the chain; a `verifyAuditChain()` check surfaces it to the SU and
  logs a meta-event. (Honest limit: a local attacker can rewrite the whole chain; chaining detects
  *partial* edits and raises cost — documented.)
- **Events:** login success/failure, lockout, logout, password reset/change, user create/modify/
  activate-deactivate, role assignment, permission change, license import/replace/revoke/validation-
  failure/expiration, machine mismatch, suspicious time rollback, SU admin action, security-config
  change, first-run provisioning, recovery use.
- **Fields:** timestamp(UTC), actor id+name, target type/id, action, result, safe reason code, session
  id, app version, machine-hash, correlation id, redacted detail JSON.
- **Redaction:** passwords, hashes, tokens, raw fingerprints, keys never stored in `detailJson`.
- SU reviews via `AuditLog.tsx` (requires `AUDIT_VIEW`); export is permission-gated and redacted.

---

## 24. Threat Model

Likelihood/Impact are L/M/H. "Remaining" = honest residual risk.

| # | Threat | Risk | L | I | Prevention | Detection | Recovery | Remaining |
|---|---|---|---|---|---|---|---|---|
| T-1 | Edit `security.sqlite` directly | Grant self perms / clear lockout | M | H | DPAPI-wrapped hashes; hash-chained audit; single-writer lock | audit chain break; startup integrity check | fail-closed; SU re-provision | Full DB replace still possible locally |
| T-2 | Copy another machine's DB | Import their users/license | M | H | DPAPI is per-user/machine → blobs won't decrypt; machine binding | license validation fails closed | reactivate on this machine | — |
| T-3 | Copy entire portable folder | Run elsewhere | H | M | machine binding + DPAPI + `lastKnownGoodTime` | binding mismatch audited | reactivation | Copy to *same* user/machine works (intended) |
| T-4 | Modify license file | Extend expiry/rebind | M | H | Ed25519 signature over canonical payload | signature verify fails | re-import valid license | Needs private key to forge (off-client) |
| T-5 | Modify system clock | Defeat expiry | H | M | `lastKnownGoodTime` monotonic guard; boot-time sanity | rollback audited, fail-closed | SU resets after real time fix | Forward clock jump within validity still works |
| T-6 | Invoke protected IPC manually / DevTools | Do restricted action | H | H | session + `requirePermission` + reauth on every handler | denial audited | — | — |
| T-7 | Enable disabled AD via DevTools | Alt login path | M | M | provider `isEnabled()` trusted-side; login rejects disabled provider | rejected attempt audited | — | — |
| T-8 | Manipulate renderer state/snapshot | Fake authz | H | H | snapshot is UI-hint only; authz re-checked server-side | server denial | — | — |
| T-9 | Replace preload script | Widen bridge | L | H | packaged asar integrity; per-user install; will-navigate lockdown | build integrity check (Phase 7) | reinstall | Local file replacement possible if attacker has FS + rebuild |
| T-10 | Extract signing key | Mint licenses | L | H | **key never in client**; only public key ships | n/a | key rotation (`keyId`) | — |
| T-11 | Reuse expired session | Access after timeout | M | M | main-owned sessions; idle+absolute timeout; logout tombstone | `SESSION_EXPIRED` | re-login | — |
| T-12 | Brute-force passwords | Guess creds | M | M | scrypt cost + lockout + uniform errors | failed-login audit; lockout | SU reset | Offline hash cracking if DB+DPAPI-user compromised |
| T-13 | Read application logs | Learn secrets | M | M | redaction; no secrets/hashes/keys/paths logged | log review | rotate creds | — |
| T-14 | Restore old backup with valid license | Revert revocation/expiry | M | M | `lastKnownGoodTime`; license single-use `licenseId`; expiry still applies | anomaly audit | reissue license | Restoring within validity window works |
| T-15 | Clone a VM | Duplicate seat | M | M | binding + install-id; single-use license per machine | duplicate-use anomaly | revoke+reissue | Identical clones bind identically |
| T-16 | Super User compromised | Full admin | L | H | reauth, audit, protected-SU invariant, strong password policy | SU action audit | rotate SU creds; recovery flow | SU is inherently powerful by design |
| T-17 | Legit hardware change | False rejection | M | M | weighted quorum tolerance | binding-degraded audit | SU reactivates | Enough simultaneous changes → reactivation |

---

## 25. Phased Implementation Plan

For each phase: Goal · Findings · Create · Modify · DB · Interfaces · UI · Electron · Security · Tests
· Dependencies · Migration · Risks · Acceptance · Verify · DoD.

### Phase 0 — Codebase & Security Audit  *(this document)*
- **Goal:** ground the design. **DoD:** this plan committed under `docs/plans/`; tracking issue open.

### Phase 1 — Security Foundations
- **Goal:** trusted `SecurityStore` (sql.js + migrations), IPC schema-validation utility, error/reason-
  code taxonomy, DPAPI wrap/unwrap helper, `SecurityKernel` skeleton wired into `bootstrap()`.
- **Findings:** reuse `SqliteRuntimeStore`/`RUNTIME_STORE_MIGRATIONS`/`DurableLockStore`/`safeStorage`.
- **Create:** `src/security/store/SecurityStore.ts`, `SecurityStoreSchema.ts` (migration 1),
  `src/security/kernel/SecurityKernel.ts`, `src/security/ipc/validate.ts` (type-guard validators),
  `src/security/errors/ReasonCodes.ts`, `app/main/security/securityStore.ts` (DPAPI binding, mirrors
  `secretStore.ts`), `app/main/security/dpapi.ts`.
- **Modify:** `app/main/main.ts` (call `SecurityKernel.init()` after `passesOfflineStartupGate`);
  `app/main/appPaths.ts` (add `security/` runtime folder).
- **DB:** migration 1 (all tables §18), `provisioning` seeded `provisioned=0`.
- **Electron:** none to security posture (already strong); add store lock.
- **Tests:** `scripts/verify-security-store.mts` (migrations idempotent, DPAPI round-trip, single-writer).
- **Risks:** DPAPI unavailable on some hosts → fail-closed with clear diagnostic (mirror SecretStore).
- **Acceptance:** store opens, migrates on empty DB, wraps/unwraps a value; kernel init logs state.
- **Verify:** `npm run build`, `npm run verify:security-store`. **DoD:** green + no renderer changes.

### Phase 2 — Local Virtual-User Authentication
- **Goal:** user model, scrypt hashing, first-run bootstrap, login/logout, lockout, password lifecycle,
  sessions.
- **Create:** `src/security/auth/{AuthenticationProvider,LocalVirtualUserProvider,AuthenticationService,
  PasswordPolicy,PasswordHasher}.ts`, `src/security/session/SessionManager.ts`,
  `app/main/ipc/security.ipc.ts`.
- **Modify:** `app/main/ipc/index.ts` (register), `app/main/preload.ts` (`.security` namespace).
- **DB:** uses Phase-1 tables; provisioning transaction.
- **Security:** scrypt+salt+timingSafeEqual; uniform errors; lockout; provisioned-guard; sessions
  main-owned; passwords never logged.
- **Tests:** `verify-auth.mts` (valid/invalid/disabled/locked/expired/reset/forced-change/brute-force/
  logout-invalidation/restart/bootstrap-one-time).
- **Risks:** scrypt cost vs UX → tune N; async to avoid blocking.
- **Acceptance:** create SU once; login/logout; lockout after 5; reuse-after-logout fails.
- **Verify:** `npm run build`, `npm run verify:auth`. **DoD:** green; login works headless via IPC.

### Phase 3 — Authorization
- **Goal:** permission registry, roles, effective-permission computation, enforcement at all 6 layers.
- **Create:** `src/security/authz/{Permissions,Roles,AuthorizationService,RoutePermissions}.ts`;
  `app/renderer/security/PermissionContext.tsx`.
- **Modify:** `app/main/ipc/*.ipc.ts` mutating handlers → add `requirePermission`; `security.ipc.ts`
  admin channels; renderer `LeftNavigation`/router guards; `App.tsx` route-mount guard.
- **DB:** seed built-in roles + role_permissions in a migration.
- **Security:** IPC is the boundary; UI hints only; default-deny unmapped routes.
- **Tests:** `verify-authz.mts` (page/route/IPC denial for ordinary users; SU-only rejects; deactivated
  loses access; permission change takes effect).
- **Acceptance:** ordinary user blocked from `user.manage` IPC even when button forced.
- **Verify:** `npm run build`, `npm run verify:authz`. **DoD:** direct-IPC denial test passes.

### Phase 4 — Super User Administration + Audit
- **Goal:** user/role/permission admin, reauth, audit logging + hash chain.
- **Create:** `src/security/audit/{AuditLogger,AuditChain}.ts`; renderer `admin/UserManagement.tsx`,
  `RolePermissionPanel.tsx`, `AuditLog.tsx`.
- **Modify:** `security.ipc.ts` (admin + audit channels + reauth gate); `routes.tsx` (+ permissioned
  routes); preload.
- **DB:** `audit` writes; `security_config`.
- **Tests:** `verify-audit.mts` (chain integrity, redaction, tamper detection), admin GUI verifier.
- **Acceptance:** SU creates/edits/deactivates users; every action audited & redacted; reauth enforced.
- **Verify:** `npm run build`, `npm run verify:audit`. **DoD:** green; audit chain verifies.

### Phase 5 — Machine Identity & Signed Licensing
- **Goal:** augmented fingerprint, request code, Ed25519 verify, import/replace/revoke, expiry, binding;
  internal license tool.
- **Create:** `src/security/machine/MachineIdentityService.ts` (augments `MachineCapabilityDetector`),
  `src/security/license/{LicenseValidationService,LicenseCanonical,LicenseSchema}.ts`,
  `app/main/ipc/license.ipc.ts`, `tools/awkit-license-tool/` (CLI, private key; **excluded from build**),
  `resources/license/awkit-license-pub.ed25519`.
- **Modify:** `preload.ts` (`.license`), `ipc/index.ts`, `appPaths.ts`; `electron-builder.json` (bundle
  public key under `extraResources`; ensure `tools/**` and private key never packaged).
- **DB:** `license_meta` writes.
- **Security:** public-key-only client; DPAPI-wrapped blob; `lastKnownGoodTime`; fail-closed.
- **Tests:** `verify-license.mts` (valid/invalid-sig/modified/wrong-machine/expired/missing/corrupt/
  replaced/copied-DB/copied-folder/clock-rollback/hw-change-tolerance/unsupported-version/expiry-during-
  use); `verify-machine-identity.mts`.
- **Risks:** fingerprint false-rejection → quorum tuning + reactivation flow; registry read cross-host.
- **Acceptance:** tool issues license for a request code; client imports & validates; tampered license
  rejected; wrong-machine rejected.
- **Verify:** `npm run build`, `npm run verify:license`, `npm run verify:machine-identity`.
- **DoD:** green; **grep proves no private key in `out/`/`dist`/`resources`**.

### Phase 6 — Startup & Login UI Integration
- **Goal:** `SecurityGate`, `LockedShell`, login/first-run/forced-change/license-failure screens;
  no-flash guarantee; theme/AD-disabled.
- **Create:** `app/renderer/security/SecurityGate.tsx`, `LockedShell.tsx`, `screens/*`,
  `components/{PasswordField,ProviderTabs}.tsx`.
- **Modify:** `app/renderer/App.tsx` (wrap content in `SecurityGate`; mount routes only when `authed`);
  `main.tsx` if needed.
- **Electron:** boot renderer into locked state; `getBootState` drives routing.
- **Tests:** Playwright UI (`verify-auth-ui`/`.spec`): splash→login, validation, AD disabled, theme
  light/dark, keyboard nav, focus, loading, error, license-failure; `verify-auth-no-flash.mts`.
- **Acceptance:** first painted frame is login; no protected route mounts pre-auth; theme consistent.
- **Verify:** `npm run build`, GUI/Playwright verifier. **DoD:** no-flash + theme tests pass.

### Phase 7 — Hardening
- **Goal:** tamper/rollback detection, build-integrity check, packaged guardrails, recovery flows,
  security logging.
- **Create:** `src/security/integrity/{TimeGuard,BuildIntegrity}.ts`, recovery screen/flow.
- **Modify:** `main.ts` (integrity + time guard at startup), `LicenseValidationService` (rollback),
  packaging validator `scripts/validate-offline-bundle.ps1` (+ security asset checks).
- **Security:** ensure **no packaged bypass** — any dev-only bypass gated on `!app.isPackaged` **and**
  an explicit env flag, verified absent in packaged build by a test.
- **Tests:** `verify-tamper.mts`, `verify-no-packaged-bypass.mts`.
- **Acceptance:** clock rollback fails closed; bypass impossible when `app.isPackaged`.
- **Verify:** `npm run build`, `npm run validate:offline`, tamper verifiers. **DoD:** green.

### Phase 8 — Testing & Validation
- **Goal:** complete unit/integration/Playwright/packaging/migration/abuse-case suites (§27).
- **Create:** all remaining `scripts/verify-*.mts` + `*.spec.ts`; wire into a `verify:security-all`
  aggregate script.
- **Acceptance:** every §27 case has a test; all green. **DoD:** aggregate verifier green in CI-less run.

### Phase 9 — Documentation & Release
- **Goal:** provisioning, admin, license issuance/import, recovery, backup, migration, AD-future docs.
- **Create/Modify:** `docs/ai/SECURITY.md` (extend), `docs/SECURE_LOGIN_ADMIN_GUIDE.md`,
  `docs/LICENSE_GENERATION_RUNBOOK.md`, `docs/ai/CURRENT_STATE.md`, `TASK_LOG.md`, `FEATURES.md`,
  `DECISIONS.md`. **DoD:** docs complete; feature marked *implemented* only after Phase 8 green.

---

## 26. File-by-File Change Map

**New (main / core):**
`src/security/store/SecurityStore.ts`, `SecurityStoreSchema.ts` ·
`src/security/kernel/SecurityKernel.ts` ·
`src/security/auth/AuthenticationProvider.ts`, `LocalVirtualUserProvider.ts`,
`ActiveDirectoryProvider.ts` (stub), `AuthenticationService.ts`, `PasswordPolicy.ts`, `PasswordHasher.ts` ·
`src/security/session/SessionManager.ts` ·
`src/security/authz/Permissions.ts`, `Roles.ts`, `AuthorizationService.ts`, `RoutePermissions.ts` ·
`src/security/audit/AuditLogger.ts`, `AuditChain.ts` ·
`src/security/machine/MachineIdentityService.ts` ·
`src/security/license/LicenseValidationService.ts`, `LicenseCanonical.ts`, `LicenseSchema.ts` ·
`src/security/integrity/TimeGuard.ts`, `BuildIntegrity.ts` ·
`src/security/errors/ReasonCodes.ts` · `src/security/ipc/validate.ts` ·
`app/main/security/securityStore.ts`, `dpapi.ts` ·
`app/main/ipc/security.ipc.ts`, `license.ipc.ts` ·
`tools/awkit-license-tool/**` (excluded from packaging) ·
`resources/license/awkit-license-pub.ed25519`.

**New (renderer):** `app/renderer/security/**` (§21.1).

**Modified:** `app/main/main.ts` (kernel init) · `app/main/appPaths.ts` (`security/` folder) ·
`app/main/ipc/index.ts` (register 2 modules) · `app/main/preload.ts` (`.security`/`.license`) ·
mutating `app/main/ipc/*.ipc.ts` (+`requirePermission`; notably `execution.ipc.ts` for
`WORKFLOW_EXECUTE`+license before run) · `app/renderer/App.tsx` (SecurityGate) ·
`app/renderer/routes.tsx` (+admin routes + RoutePermissions) ·
`app/renderer/layout/LeftNavigation.tsx` (permission filter) · `electron-builder.json` (public key in,
tools/private key out) · `scripts/validate-offline-bundle.ps1` (security-asset checks) ·
`package.json` (new `verify:*` scripts) · `docs/ai/SECURITY.md`, `CURRENT_STATE.md`, `TASK_LOG.md`.

**Explicitly NOT modified:** the `window.playwrightFlowStudio` identifier; existing `auth.ipc.ts`/
`session.ipc.ts` semantics; `SqliteRuntimeStore`; feature JSON stores; splash mechanics.

---

## 27. Test Strategy

- **Authentication** (`verify:auth`): valid/invalid-username/invalid-password/disabled/locked/expired-
  session/password-reset/forced-change/brute-force/logout-invalidation/restart.
- **Authorization** (`verify:authz`): page blocked, direct-route blocked, hidden action not invocable
  via IPC, permission change effect, deactivated user loses access, SU-only rejects ordinary.
- **License** (`verify:license`): valid/invalid-sig/modified/wrong-machine/expired/missing/corrupt/
  replaced/copied-DB/copied-folder/clock-rollback/hw-change-tolerance/unsupported-version/expiry-during-use.
- **Electron security** (`verify:security` extend + Playwright): renderer no Node APIs, arbitrary IPC
  rejected, invalid payload rejected, AD-disabled can't authenticate, renderer state doesn't grant
  perms, protected pages don't flash.
- **UI** (Playwright): splash→login, validation, AD disabled, theme light/dark, keyboard nav, focus,
  loading, error, permission-controlled nav, license-failure.
- **Migration**: empty-DB bootstrap, idempotent re-run, upgrade from no-security-tables install.
- **Aggregate**: `verify:security-all` runs the suite; report pass counts (repo convention).

---

## 28. Migration Strategy

- **Existing installs (no security tables):** migrations create empty tables; `provisioned=0` → first-
  run bootstrap on next launch. Feature data (flows/workflows/data sources/reports/`runtime.sqlite`)
  untouched and available post-login.
- **First SU:** one-time provisioning transaction; irreversible (§18).
- **Versioning:** `SECURITY_STORE_MIGRATIONS` forward-only; each release adds a numbered migration.
- **Rollback:** DB is forward-only; "rollback" = restore a pre-upgrade backup of `security/`
  (documented); app tolerates absent security DB by re-provisioning.
- **Portable installs:** per-user DPAPI scope → security state is machine+user-bound; a copied portable
  folder is unprovisioned/unlicensed on a new machine (fail-closed).
- **License import for existing users:** export request code → internal tool issues → import.
- **Dev vs packaged:** dev may set an env-gated seed SU for testing; **impossible in packaged**
  (`app.isPackaged` guard + `verify:no-packaged-bypass`).
- **Test isolation:** verifiers use a temp `security/` root (temp dir) with a fake DPAPI crypto (mirror
  `SecretStore` test backend) and a **test-only** Ed25519 key pair — never the production key, never
  real user/license data.

---

## 29. Recovery Procedures

- **Forgotten SU password:** login-screen "Recovery" → enter the one-time recovery code (hash-verified)
  → forced SU password reset → audited. If recovery code lost → support issues a machine-bound signed
  `reset-token` from the internal tool (private key stays off client) → client verifies signature +
  binding → allows SU reset.
- **Invalid/expired license (SU present):** license-failure screen exposes import/activate + copy
  request code + retry + exit; SU imports a fresh license without full app access.
- **Corrupted `security.sqlite`:** fail-closed; restore backup (same user/machine) or re-provision
  (feature data intact); event audited.
- **Machine changed legitimately:** reactivation flow — new request code → new license → import.
- **DPAPI unavailable:** clear diagnostic; app refuses to persist secrets (mirrors SecretStore) rather
  than storing in plaintext.

---

## 30. Future Active Directory Integration (boundary only — not built)

- `ActiveDirectoryProvider` implements `AuthenticationProvider`; enabled via trusted security config
  (never renderer). Integration surface: LDAP/LDAPS bind or Windows SSPI/Kerberos for credential-less
  SSO; map AD groups → AWKIT roles; optional periodic group refresh. Offline caveat: AD requires
  network to the DC — so AD login is inherently online and must degrade gracefully (fall back to local
  provider). No AD code, mocks, or config ship in this release; the disabled tab and the provider stub
  are the only footprint. When implemented, no rewrite of AuthN/AuthZ/session is needed — only the
  provider body + a config toggle + role-mapping table.

---

## 31. Risks & Limitations

- Offline client cannot be made unbreakable; a local attacker with FS + rebuild capability can patch
  the binary. Mitigated by keeping the **private key off-client** and fail-closed design.
- DPAPI ties security state to Windows-user+machine — deliberate (anti-theft) but affects shared-PC and
  backup/restore UX (§17, O-6).
- Fingerprint false-rejection risk on major hardware changes → quorum tolerance + reactivation.
- Clock-forward (not rollback) within a valid window can't be prevented offline.
- Audit hash chain detects partial edits, not a full local rewrite.
- scrypt (no native dep) is strong but a determined offline cracker with the DB + DPAPI-user could
  attempt hashing; lockout + cost + policy mitigate online guessing.

---

## 32. Acceptance Criteria (subsystem-level)

1. Fresh install → splash → **first-run SU setup** → login; no protected page ever renders pre-auth.
2. Provisioned install → splash → login; wrong creds give uniform error; 5 failures lock 15 min.
3. Ordinary user cannot invoke `user.manage`/`license.manage` IPC even via DevTools/crafted calls.
4. AD tab visible, disabled, "Coming Soon"; cannot authenticate even if DOM-enabled.
5. Tampered/wrong-machine/expired license → generic failure screen + safe actions only; SU can import
   a new license from that screen; details only in audit.
6. License validates via **public key only**; **no private key** anywhere in `out/`/`dist`/`resources`.
7. Logout invalidates the session (reuse fails); idle/absolute timeouts enforced.
8. All privileged actions audited & redacted; audit chain verifies; tamper detected.
9. `tsc --noEmit` clean; `verify:security-all` green; `validate:offline` green; no admin required;
   portable + NSIS still build; `window.playwrightFlowStudio` unchanged; existing features work.
10. No packaged-build bypass exists (test-proven).

---

## 33. Recommended Implementation Order

Phase 0 (done) → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Phases 2–5 are independently testable via IPC
before the UI (Phase 6) lands, so the trusted core is proven headless first. Phase 5's internal license
tool can be built in parallel with Phase 3/4 since it shares only the canonical schema.

---

## 34. Open Decisions Requiring Confirmation

- **O-1** Password hashing: scrypt (built-in, recommended) vs Argon2id (adds native/wasm dep)?
- **O-2** Custom role *creation* in v1, or built-in roles only (recommended) until v2?
- **O-3** Lockout error: reveal "temporarily locked" or keep fully uniform with invalid-credentials?
- **O-4** Direct per-user permission overrides in v1, or roles-only?
- **O-5** Session resume after app restart (within N min) or always require fresh login (recommended)?
- **O-6** DPAPI scope: per-Windows-user (default, recommended) vs machine-scope for shared installs?
- **O-7** Idle/absolute timeout defaults (30 min / 12 h proposed)?
- **O-8** Recovery-code UX: show once at bootstrap (recommended) vs SU-generated later?
- **O-9** License edition/seat model fields — confirm required `metadata` and `edition` values.
- **O-10** Is workflow *execution* license-gated (recommended) in addition to app entry?

---

*End of plan. Implementation must not begin until the open decisions above are confirmed; each phase
has its own Definition of Done and verification command listed in §25.*
