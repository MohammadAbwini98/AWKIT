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
| **Separate offline issuer (NOT shipped)** | `tools/license-issuer/**` |

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
- **Why private keys are never distributed:** the app ships only **public** verification keys
  (`TrustedKeys.ts`). The private signing key lives exclusively in the offline issuer, read from an
  external path — never in source control, `resources/`, `.env`, SQLite, or the packaged app
  (`electron-builder.json` ships only `out/**`; `tools/**` is not bundled).
- **Untrusted input:** an imported license file and the on-disk `license.dat` are treated as untrusted —
  the store checksums envelopes (corruption/tamper detection) and the validator re-verifies the signature
  and machine binding on **every** load. A modified payload fails the signature; a copied license fails
  `MACHINE_MISMATCH` regardless of which directory holds it.
- **Clock rollback:** best-effort only. The store keeps a monotonic high-water mark; a `now` earlier than
  that (beyond tolerance) yields `CLOCK_INTEGRITY_WARNING` and blocks new runs when enforcement is on. This
  is a mitigation, not a guarantee against a determined local attacker.
- **Redaction:** audit records and logs never contain signatures, keys, or raw hardware values — only safe
  reason codes, the license id, and the fingerprint hash.
- **Super User audit:** every licensing action (export request, import, replace, revoke, remove, validate)
  is written to the shared audit trail with the acting user, timestamp, result, and reason code.

---

## 3. User & administrator guidance

1. **View the machine code / confidence:** Administration → Licensing → *Machine activation*.
2. **Export an activation request:** *Export activation request* downloads
   `specterstudio-activation-request.json` (no personal data — only the hashed fingerprint). Send it to
   your license issuer.
3. **Issue a license** (issuer operator): see `tools/license-issuer/README.md`.
4. **Import / replace:** *Import license…* (or *Replace license…*) and select the signed `.dat`/`.json`.
   Sensitive — you'll be asked to confirm your password. Invalid signature, wrong machine, wrong product,
   or unsupported version are rejected **before** anything is stored.
5. **Revoke / remove:** removes the per-user license (a machine-wide *provisioned* license is read-only and
   must be removed by whoever provisioned it).
6. **Status messages** map to actions: `NOT_ACTIVATED`, `VALID`, `EXPIRING_SOON`, `EXPIRED`,
   `INVALID_SIGNATURE`, `MACHINE_MISMATCH`, `NOT_YET_VALID`, `REVOKED`, `CORRUPTED`,
   `CLOCK_INTEGRITY_WARNING`, `UNSUPPORTED_VERSION`.
7. **Corrupted storage:** re-import the original signed license file.
8. **Machine replacement / major hardware change:** the fingerprint changes → request a new license for the
   new machine.
9. **What stays available when a license is invalid:** the app itself, the Licensing page, diagnostics,
   reports, and safe data export. Only **new licensed runs** are blocked (and only when enforcement is on).

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
- **Enforcement toggle:** `SPECTER_LICENSE_ENFORCE=true` turns on hard enforcement (default **off**).
- **Test commands:** `npm run verify:licensing` (56 assertions — domain + RBAC), `npm run verify:avatar`
  (24), `npm run build` (tsc + bundles).

---

## 5. Migration & compatibility

- The old Licensing "planned for a later release" placeholder is removed; the route description no longer
  says "placeholder".
- **Upgrade without an existing license:** status is `NOT_ACTIVATED`. With enforcement **off** (default)
  the app runs exactly as before; with enforcement on, new licensed runs are blocked until a license is
  imported. Existing users, roles, permissions, workflows, reports, and settings are untouched.
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
| Direct-IPC / renderer bypass blocked | main-process gate + RBAC in `licensing.ipc.ts` (design) | ✅ (by construction) |
| No private key in package; public key only | `git grep` scan + `electron-builder.json` (`out/**` only) | ✅ |
| Typecheck + bundles | `npm run build` | ✅ |

**Not run here (external gates, unchanged by this work):** clean-machine offline VM walkthrough, packaged
NSIS/portable EXE run, live Electron GUI walkthrough of the admin/licensing flows (the Browser-pane preview
was unavailable this session; UI verified via Playwright screenshots against the real `global.css`).
