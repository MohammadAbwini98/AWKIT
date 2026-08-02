# SpecterStudio Licensing — Architecture, Security, and Operations

Per-machine, offline, cryptographically-signed licensing. **Independent of authentication and RBAC.**

- **Authentication** identifies the current user.
- **Authorization / RBAC** decides what that user may do.
- **Licensing** decides whether *this installation on this machine* may execute licensed capabilities.

Licensing failure never mutates authentication or RBAC data, and no module under `src/licensing/**`
imports from `src/security/**`.

---

## 1. Architecture

| Concern | Module |
|---|---|
| Domain types, statuses, entitlements, policy | `src/licensing/LicenseTypes.ts` |
| Machine fingerprint (multi-signal, hashed) | `src/licensing/MachineFingerprint.ts` |
| Canonical signed bytes + activation request | `src/licensing/LicenseCanonical.ts` |
| Trusted **public** keys (embedded) | `src/licensing/crypto/TrustedKeys.ts` |
| Ed25519 verify (app) / sign (issuer only) | `src/licensing/crypto/LicenseSignature.ts` |
| Status decision (signature/time/machine) | `src/licensing/LicenseValidator.ts` |
| Adaptive storage (atomic, corruption-aware) | `src/licensing/store/LicenseStore.ts` |
| Orchestration API | `src/licensing/LicenseService.ts` |
| Main-process runtime + run gate | `app/main/licensing/licenseRuntime.ts` |
| Trusted IPC (RBAC + reauth + audit) | `app/main/ipc/licensing.ipc.ts` |
| Admin UI page | `app/renderer/pages/admin/LicensingPage.tsx` |
| Issuer contracts + trusted signing service | `src/licensing/issuer/**` |
| Issuer main-process runtime + exact-role IPC | `app/main/licensing/issuerRuntime.ts`, `app/main/ipc/issuer.ipc.ts` |
| Issuer-only UI page | `app/renderer/pages/admin/LicenseIssuerPage.tsx` |
| Optional issuer CLI (NOT shipped) | `tools/license-issuer/**` |

**Validation & enforcement sequence:** renderer → `licensing:*` IPC (sender-guarded, RBAC-checked) →
`LicenseService` → `LicenseStore.load()` (integrity check) → `validateLicense()` (schema → signature →
machine fingerprint → revocation → clock integrity → time window). For a **run**, `execution.ipc.ts`
calls `evaluateRunGate()` before `executionEngine.startRun` (real runs only; validation/dry-run always
proceed so diagnostics and reports stay available).

**Trusted boundaries:** verification and enforcement run in the Electron **main process**. The renderer
holds only display hints; manipulating renderer state cannot enable a run because the gate is server-side,
and every `licensing:*` handler re-checks permission and license state.

---

## 2. Security / threat model

- **Why not IP address / hostname / MAC alone:** IPs change with network; a single hostname or MAC is
  trivially spoofed or duplicated across VMs. The fingerprint combines **multiple** normalised signals
  (Windows MachineGuid, CPU model/count, memory, platform, first stable MAC, hostname) and hashes them, so
  no single weak signal decides identity and raw values never leave the machine.
- **Why signals are normalised and hashed:** determinism (same machine → same hash) and privacy (only the
  SHA-256 hash and the list of *which* signal categories were present are stored or displayed).
- **Why private keys are never distributed:** the app package embeds only **public** verification keys
  (`TrustedKeys.ts`). The private key is provisioned separately on the issuer workstation and read from
  an external path only by exact-role, reauth-gated main-process IPC — never from the renderer and never
  stored in source control, `resources/`, `.env`, SQLite, or the package. The package contains issuer
  logic, but no signing authority without that external key.
- **Untrusted input:** an imported license file and the on-disk `license.dat` are treated as untrusted —
  the store checksums envelopes (corruption/tamper detection) and the validator re-verifies the signature
  and machine binding on **every** load. A modified payload fails the signature; a copied license fails
  `MACHINE_MISMATCH` regardless of which directory holds it.
- **Clock rollback:** best-effort only. The store keeps a monotonic high-water mark; a `now` earlier than
  that (beyond tolerance) yields `CLOCK_INTEGRITY_WARNING` and blocks new runs when enforcement is on. This
  is a mitigation, not a guarantee against a determined local attacker.
- **Redaction:** audit records and logs never contain signatures, keys, or raw hardware values — only safe
  reason codes, the license id, and the fingerprint hash.
- **Audit:** every licensing action (export request, import, replace, revoke, remove, validate, issue)
  is written to the shared audit trail with the acting user, timestamp, result, and reason code. Issuance
  also appends a secret-free `issuance-history.jsonl` next to the external key.

---

## 3. User & administrator guidance

1. **View the machine code / confidence:** Administration → Licensing → *Machine activation*.
2. **Export an activation request:** *Export activation request* downloads
   `specterstudio-activation-request.json` (no personal data — only the hashed fingerprint). Send it to
   your license issuer.
3. **Provision the Issuer account once:** the Super User creates a user and assigns the built-in
   `Issuer` role. The role is exclusive and may belong to only one stored user.
4. **Issue a license:** the Issuer signs in, opens *Administration → License Issuer*, selects the
   activation-request JSON, chooses the license type/duration/entitlements, and selects *Issue and save
   license*. After password confirmation, the signed `.dat` is written automatically to
   `%LOCALAPPDATA%\SpecterStudio\issuer-output\`.
5. **Return the license:** for a different offline machine, transfer that `.dat` back to the requesting
   machine. Automatic remote installation is intentionally unavailable because SpecterStudio has no
   network licensing service or trusted cross-machine transport.
6. **Import / replace:** *Import license…* (or *Replace license…*) and select the signed `.dat`/`.json`.
   Sensitive — you'll be asked to confirm your password. Invalid signature, wrong machine, wrong product,
   or unsupported version are rejected **before** anything is stored.
7. **Revoke / remove:** removes the per-user license (a machine-wide *provisioned* license is read-only and
   must be removed by whoever provisioned it).
8. **Status messages** map to actions: `NOT_ACTIVATED`, `VALID`, `EXPIRING_SOON`, `EXPIRED`,
   `INVALID_SIGNATURE`, `MACHINE_MISMATCH`, `NOT_YET_VALID`, `REVOKED`, `CORRUPTED`,
   `CLOCK_INTEGRITY_WARNING`, `UNSUPPORTED_VERSION`.
9. **Corrupted storage:** re-import the original signed license file.
10. **Machine replacement / major hardware change:** the fingerprint changes → request a new license for the
   new machine.
11. **What stays available when a license is invalid:** the app itself, the Licensing page, diagnostics,
   reports, and safe data export. Only **new licensed runs** are blocked (and only when enforcement is on).
12. **Global attention:** permitted Super Users see a compact status-bar item only for states that need
    action. A healthy `VALID` license stays silent. Status is revalidated every 15 minutes and when the
    app regains focus/visibility; selecting the item opens Administration → Licensing.

### Storage locations (adaptive, admin-free)

- **Primary (per-user, no admin):** `%LOCALAPPDATA%\SpecterStudio\Licensing\license.dat` — all normal
  writes.
- **Optional (machine-wide, read-only):** `%PROGRAMDATA%\SpecterStudio\Licensing\license.dat` — used only
  when an administrator/deployment has provisioned it. The app never elevates, never creates/overwrites it.
- **Read precedence:** a valid provisioned (ProgramData) license wins over a per-user one; when both are
  present the UI shows a conflict notice. **Machine binding is enforced by the signed fingerprint, not by
  the directory** — copying `license.dat` elsewhere fails `MACHINE_MISMATCH`.

---

## 4. Developer reference

- **Permissions** (`src/security/authz/Permissions.ts`, Super-User-only): `license.view`,
  `license.export_request`, `license.import`, `license.replace`, `license.revoke`, `license.audit.view`,
  plus `page.license`. `import`/`replace`/`revoke` are in `SENSITIVE_PERMISSIONS` (require fresh reauth).
- **Issuer authorization:** `page.licenseIssuer` + `license.issue` belong to the built-in `Issuer` role.
  `license.issue` requires fresh reauth, and trusted IPC also checks that Issuer is the account's sole role;
  direct permission grants and Super User's broad permission set cannot cross the signing boundary.
- **License schema** (`LicenseDocument`, `schemaVersion` = 1): `licenseId`, `serialNumber`, `product`,
  `machineFingerprintHash`, `issuedAtUtc`, `validFromUtc`, `expiresAtUtc`, `licenseType`, `entitlements`,
  `issuer`, `signingKeyId`, `signatureAlgorithm` (`Ed25519`), `signature` (base64 over the canonical
  payload = every field except `signature`).
- **Activation request schema** (`ActivationRequest`): product, appVersion, fingerprint algorithm version +
  hash, available signals, confidence, request id, timestamp. No secrets.
- **Storage:** envelope `{ storeVersion, license, meta, checksum }`; `meta` holds `importedAtUtc`,
  `lastValidatedUtc`, `clockHighWaterUtc`, `locallyRevoked`. Writes are atomic (temp + rename).
- **Key rotation:** add a new `{ keyId, algorithm, publicKeySpkiB64 }` to `TRUSTED_KEYS`, start issuing with
  the new `signingKeyId`; keep old keys until every license they signed has expired. Generate with
  `npx tsx tools/license-issuer/keygen.mts --keyId <id>` (writes the private key outside the repo, prints
  the public entry).
- **Adding entitlements:** extend the `Entitlement` union and check them in the trusted layer — no coupling
  to authentication/RBAC.
- **Enforcement:** ON by default since 2026-07-29 (`awkit-1cc`). There is no production toggle. A
  packaged build has no bypass at all — `app.isPackaged` is checked first, so no environment variable,
  flag, setting or IPC call can reach the bypass branch. Automated tests and development composition
  roots use `AWKIT_TEST_LICENSE_BYPASS=1`, which is inert in a packaged application.
- **Main-process enforcement cadence:** startup evaluates immediately; the main process then
  revalidates every 15 minutes and on `browser-window-focus`, independently of renderer permissions.
  Renderer-triggered revalidation and every license mutation use the same synchronous enforcer.
- **Latch and dispatch semantics:** every `cancel-pending` evaluation re-sweeps queued/pending work,
  while audit rows are transition-gated (`LICENSE_ENFORCEMENT_ENGAGED` / `_CLEARED`) with a null actor
  and the trigger in structured detail. `ExecutionEngine` consults the injected latch before queue
  promotion, immediately before the running transition, and before `repeatInstance`; a throwing gate
  fails closed. The cache refreshes after at most 30 seconds. Bare non-Electron harnesses default to
  admission, but application bootstrap refuses to start unless the named gate was registered.
- **Test commands:** `npm run verify:licensing` (183 assertions — issuer/key/output, domain, RBAC, attention, full
  run-gate table, enforcement-latch transitions, and migration grace),
  `npm run verify:license-dispatch-gate` (real queue loop without Chromium plus production wiring), `npm run verify:avatar`
  (24), `npm run build` (tsc + bundles).

---

## 5. Migration & compatibility

- The old Licensing "planned for a later release" placeholder is removed; the route description no longer
  says "placeholder".
- **Upgrade without an existing license:** status is `NOT_ACTIVATED`, and enforcement is on, so new
  runs would be blocked — except that an installation which already held user data before its first
  enforcing launch receives a **one-time 14-day migration window**. During it, saved workflows keep
  executing and the Licensing page persistently shows the deadline plus the activation action. Existing
  users, roles, permissions, workflows, reports, and settings are untouched.
- **A fresh installation gets no window.** Grace exists to protect continuity, not to hand every new
  install a free fortnight. The classification is made ONCE, from whether the profile already held
  `ui-settings.json` or saved flows/workflows at the moment the anchor was written, and is never
  recomputed.
- **The window is never granted to an integrity failure.** `INVALID_SIGNATURE`, `MACHINE_MISMATCH`,
  `CORRUPTED`, `REVOKED`, `NOT_YET_VALID`, `UNSUPPORTED_VERSION` and `CLOCK_INTEGRITY_WARNING` block
  immediately and additionally cancel work that has not started executing. `EXPIRED` blocks new runs
  but lets an in-flight run finish, and is not graced.
- **Grace durability, stated honestly.** The anchor is written per-user and mirrored (best effort,
  never elevated) to `%PROGRAMDATA%\SpecterStudio\Licensing`, namespaced per profile. The earliest
  anchor wins, `consumed` is sticky, and the observed-clock high-water mark means moving the clock
  backwards closes the window rather than extending it. That defeats casual tampering — deleting one
  copy, or winding the clock — but **not** a user with full filesystem access who deletes every copy.
  Offline, with no trusted time source, no construction can. Grace is a courtesy window; the security
  control is the signed license itself.
- Licensing storage is separate from the security DB, so a licensing failure or rollback cannot corrupt
  authentication/RBAC data.

---

## 6. Validation matrix (Phase 6)

| Requirement | Evidence | Result |
|---|---|---|
| Login shows official logo, light/dark, high-DPI, missing-asset fallback | `LoginScreen.tsx` + Playwright screenshot | ✅ |
| Admin pages share one design language (shell/badges/states) | 5 pages refactored to `AdminUi` kit + screenshot | ✅ |
| Initials: MA/SK/MO/M, Arabic, combining, whitespace, punctuation, email, missing | `verify:avatar` | ✅ 24/24 |
| Deterministic avatar background | `avatarPaletteIndex` test | ✅ |
| Signature: valid / invalid / modified payload / unknown key | `verify:licensing` | ✅ |
| Schema + algorithm unsupported | `verify:licensing` | ✅ |
| Machine match / mismatch | `verify:licensing` + real-key E2E | ✅ |
| Fingerprint missing-signal tolerance + confidence + stability | `verify:licensing` | ✅ |
| Exact valid-from / expiry boundaries, expiring-soon | `verify:licensing` | ✅ |
| Revoked / corrupted storage / atomic import+replace / precedence | `verify:licensing` | ✅ |
| Activation request export (no secrets) | `verify:licensing` | ✅ |
| RBAC: Super-User-only; import/replace/revoke reauth-gated | `verify:licensing` (8 RBAC) | ✅ |
| Singleton/exclusive Issuer role + exact-role route boundary | `verify:authz` | ✅ 92/92 |
| External-key match, bounded request, atomic `.dat`, secret-free history | `verify:licensing` | ✅ 183/183 |
| Direct-IPC / renderer bypass blocked | main-process gate + RBAC in `licensing.ipc.ts` (design) | ✅ (by construction) |
| No private key in package; public key only; external key required to issue | trusted-key match + packaging allowlist | ✅ |
| Typecheck + bundles | `npm run build` | ✅ |

**Not run here:** real-Electron issuance with a provisioned production private key, the clean-machine
offline VM walkthrough, and a rebuilt packaged NSIS/portable issuer run. The Issuer page/role boundary and
missing-key state ran in real Electron; signing/output used an ephemeral Ed25519 key in the domain verifier.
