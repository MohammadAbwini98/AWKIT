# Machine Fingerprint — Design Specification (no-admin, multi-claim, versioned)

**Scope:** Refines §14 of
[`SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md`](SECURE_LOGIN_AUTHORIZATION_LICENSING_IMPLEMENTATION_PLAN.md)
(the `MachineIdentityService` in Phase 5). **Design only — no production code is written by this
document.** It specifies how AWKIT collects a versioned, multi-claim machine fingerprint from the
Electron **main** process, without administrator privileges, tolerating missing/restricted/placeholder
identifiers, hashing before persistence, matching by weight, exposing only a safe request code to the
renderer, and failing closed with a recovery path when trust is insufficient.

**Tracking:** bead created this session (see TASK_LOG). **Supersedes** the thinner §14.2 fingerprint
sketch and the reliance on `machine-id.json`'s copyable random UUID as an identity anchor.

---

## 0. Requirements traceability

| Requirement (from prompt) | Section |
|---|---|
| Versioned, multi-claim fingerprint | §2, §3 |
| No administrator privileges, from Electron main | §1, §4 |
| Primary claims: SMBIOS UUID, BIOS serial, MachineGuid, system disk serial | §4 |
| Tolerate missing/restricted identifiers | §3, §6, §8 |
| Reject placeholder values | §5 |
| Hash identifiers before persistence | §7 |
| Weighted matching, not all-identical | §8 |
| Renderer gets only request code + status, never raw | §9, §10 |
| Fail closed when insufficient trustworthy claims | §8.3, §11 |
| Manual activation / administrator recovery workflow | §11 |

---

## 1. Verified feasibility (this real machine, non-elevated)

Measured on the target platform (Windows 10, **`IsInRole(Administrator) = False`**), values redacted —
raw identifiers were never printed or persisted:

| Claim | Source used | Available | Placeholder | Notes |
|---|---|---|---|---|
| SMBIOS system UUID | `Win32_ComputerSystemProduct.UUID` (CIM) | yes (36 ch) | no | WMI, ~0.3–1 s cold |
| BIOS serial | `Win32_BIOS.SerialNumber` (CIM) | yes (12 ch) | no | WMI |
| Windows MachineGuid | `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` | yes (36 ch) | no | **registry, ~instant, no WMI** |
| System disk serial | `Win32_DiskDrive(Index=0).SerialNumber` (CIM) | yes (17 ch) | no | WMI |
| Baseboard serial (aux) | `Win32_BaseBoard.SerialNumber` | yes | no | low-weight aux |
| C: volume serial (aux) | `cmd /c vol C:` / `Win32_LogicalDisk.VolumeSerialNumber` | yes (8 ch) | no | **cheap, no WMI**; changes on reformat |

**Cost budget (measured):** registry MachineGuid ≈ 0.17 s, `vol` ≈ 0.04 s, three CIM classes warm
≈ 0.31 s (cold ~0.9 s). **Consequence:** collection MUST run **asynchronously, off the window-reveal
critical path** (see §4.4). `wmic` exists but is deprecated — do **not** depend on it.

---

## 2. Versioning

Every fingerprint carries `fingerprintVersion` so the collection algorithm, claim set, weights, and
normalization can evolve without invalidating deployed licenses.

```ts
export const FINGERPRINT_VERSION = 1 as const;
```

- Licenses record the `fingerprintVersion` they were bound under.
- The validator can compute **both** the license's version and the current version; a license bound
  under v1 is validated with the v1 algorithm even after the client ships v2.
- A version bump (new claim / changed weight / changed normalization) requires: (a) keep the old
  algorithm available for validation, (b) a documented **re-binding** path (§11), (c) a migration note.
- The persisted fingerprint record is `{ fingerprintVersion, claims[], computedAt }`.

---

## 3. Claim model

```ts
export type ClaimType =
  | "smbiosUuid" | "biosSerial" | "machineGuid" | "systemDiskSerial"   // primary
  | "baseboardSerial" | "systemVolumeSerial";                          // auxiliary (low weight)

export type ClaimStatus = "present" | "missing" | "restricted" | "placeholder" | "malformed";

export interface CollectedClaim {
  type: ClaimType;
  status: ClaimStatus;
  weight: number;          // static per type (§8.1); 0 contribution unless status==="present"
  strong: boolean;         // strong anchor? (smbiosUuid, machineGuid)
  hash?: string;           // set only when status==="present" — sha256, see §7. NEVER the raw value.
  // rawNormalized is computed in-memory during collection and DISCARDED — never stored, never logged.
}

export interface MachineFingerprint {
  fingerprintVersion: 1;
  claims: CollectedClaim[];   // one entry per attempted claim type (incl. missing/placeholder)
  computedAt: string;         // ISO UTC
  trust: { weightPresent: number; strongPresentCount: number; sufficient: boolean };
}
```

- A claim is **always** represented (even when missing) so diagnostics and weighted matching can reason
  about *why* a claim is absent (`missing` vs `restricted` vs `placeholder`).
- `restricted` = the source responded but access/policy denied a usable value (e.g., WMI blocked by
  policy); distinct from `missing` (source absent) — surfaced only in the protected diagnostic log.

---

## 4. Collection architecture (main process only)

### 4.1 Placement
`src/security/machine/MachineIdentityService.ts` (pure logic + collector orchestration) with the
platform collectors in `src/security/machine/collectors/` and the Electron/Node execution binding in
`app/main/security/machineCollectors.ts` (mirrors how `app/main/secretStore.ts` binds the pure
`SecretStore`). Collectors run **only** in main; the renderer has no path to them.

### 4.2 Collector interface
```ts
export interface ClaimCollector {
  type: ClaimType;
  weight: number;
  strong: boolean;
  collect(signal: AbortSignal): Promise<{ status: ClaimStatus; rawNormalized?: string }>;
}
```

### 4.3 Concrete collectors (Windows, no admin)
| Collector | Mechanism | Why (no-admin, robustness) |
|---|---|---|
| `machineGuid` | read `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` via `reg query` (or a registry read); **no WMI** | fastest, always readable by a normal user; changes only on OS reinstall |
| `smbiosUuid` | `Get-CimInstance Win32_ComputerSystemProduct` → `UUID` | strong hardware anchor; readable non-elevated |
| `biosSerial` | `Get-CimInstance Win32_BIOS` → `SerialNumber` | secondary anchor |
| `systemDiskSerial` | `Get-CimInstance Win32_DiskDrive` where `Index=0` → `SerialNumber` | tracks the physical system disk |
| `systemVolumeSerial` (aux) | `cmd /c vol C:` parse, or `Win32_LogicalDisk.VolumeSerialNumber` | cheap; low weight (changes on reformat) |
| `baseboardSerial` (aux) | `Get-CimInstance Win32_BaseBoard` → `SerialNumber` | low weight; often duplicates disk serial on some OEMs |

Implementation notes:
- **One batched PowerShell invocation** collects all CIM claims in a single child process (emit a small
  JSON blob) to pay the WMI/PowerShell start-up cost **once**, not per claim. MachineGuid and volume
  serial use their cheap non-WMI paths and can run first/independently.
- Use `child_process.execFile` with an explicit **timeout** (e.g., 4 s) and `AbortSignal`; a hung or
  slow collector yields `status: "restricted"`/`"missing"` rather than blocking. Never `shell:true`;
  fixed argument arrays only (no string interpolation of external input — there is none here anyway).
- Prefer CIM (`Get-CimInstance`) over deprecated `wmic`. If PowerShell is unavailable/blocked, the
  claim degrades to `missing`/`restricted`; the fingerprint still forms from whatever remains (§8).
- **Cross-platform stub:** non-Windows returns all-`missing` (product is Windows-only per `AGENTS.md`),
  keeping the module import-safe in `tsx` verifiers.

### 4.4 Lifecycle & caching
- Collected **once per app launch**, lazily and **asynchronously** after the window is revealed (not on
  the splash critical path). Result cached in-memory for the process lifetime.
- A hashed snapshot is persisted (DPAPI-wrapped, §7/§17 of the master plan) so subsequent launches can
  validate a stored license immediately, then refresh the live fingerprint in the background and
  re-validate. Re-collection is also triggered on: new-license import, resume-after-sleep, and the
  periodic re-validation tick.

---

## 5. Placeholder rejection & normalization

### 5.1 Normalization (before hashing/comparison)
`normalizeClaim(type, raw)`:
1. `trim()`, collapse internal whitespace to single spaces.
2. Uppercase (identifiers are case-insensitive across sources).
3. For UUID-shaped claims: strip `{}` and `-`, canonicalize to a bare hex form (sources differ in
   dashing). Reject if not 32 hex chars after stripping.
4. Strip surrounding quotes and control chars.
5. Empty after normalization → `missing`.

### 5.2 Placeholder denylist (exact, case-insensitive, post-normalize)
Reject (→ `status: "placeholder"`) known OEM/firmware defaults, including:
`TO BE FILLED BY O.E.M.`, `DEFAULT STRING`, `SYSTEM SERIAL NUMBER`, `SYSTEM PRODUCT NAME`,
`NOT APPLICABLE`, `NOT SPECIFIED`, `NONE`, `INVALID`, `O.E.M.`, `123456789`, `0`, `00000000`,
SMBIOS UUID sentinels `00000000-0000-0000-0000-000000000000`,
`FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF`, and the infamous board default
`03000200-0400-0500-0006-000700080009`.

### 5.3 Placeholder heuristics (catch unseen defaults)
Also reject when, after normalization, the value is:
- all-zero or all-`F` (any length),
- a single repeated character (e.g., `AAAAAAAA`, `11111111`),
- shorter than a per-type minimum (e.g., serial < 4 chars, UUID ≠ 32 hex),
- pure punctuation/whitespace.

Denylist + heuristics live in `src/security/machine/placeholders.ts` and are covered by a table-driven
verifier (§12). A placeholder claim contributes **zero** weight and is treated as untrustworthy.

---

## 6. Missing / restricted tolerance

- The fingerprint forms from **whatever trustworthy claims exist**; no single identifier is mandatory.
- Each collector failure is isolated (its claim → `missing`/`restricted`), never aborting the batch.
- Diagnostics (which claim, why) go **only** to the protected audit/diagnostic log — never to the
  renderer, never with raw values.

---

## 7. Hashing before persistence

- Raw identifiers exist **only** transiently in main during collection and are discarded immediately
  after hashing. They are never persisted, never logged, never sent to the renderer.
- `claimHash = base64url( sha256( PEPPER ‖ ":" ‖ claimType ‖ ":" ‖ normalizedValue ) )`.
  - `PEPPER` is a fixed build-time constant string that **namespaces** the hashes (prevents trivial
    rainbow-table lookup of common serials and keeps AWKIT hashes distinct from any other product). It
    is not a secret in the cryptographic sense — integrity comes from the Ed25519 license signature —
    so shipping it in the client is acceptable and, critically, keeps hashing **deterministic** so the
    same machine reproduces the same hashes across launches and across app versions of the same
    `fingerprintVersion`.
  - Determinism requirement: identical `(fingerprintVersion, PEPPER, normalization, claimType, value)`
    ⇒ identical hash on every launch. This is what makes weighted matching work over time.
- Only `claimHash` values are stored (DPAPI-wrapped at rest per master §17) and only hashes are carried
  in the request code and the signed license binding.
- Truncation: the license binding and request code may carry a **truncated** hash (e.g., first 128
  bits / 26 base32 chars) to keep the request code short; collision risk at 128 bits is negligible for
  this purpose. Full hash retained locally for tamper checks.

---

## 8. Weighted matching (not all-identical)

### 8.1 Default weights (v1)
| Claim | Weight | Strong |
|---|---|---|
| `smbiosUuid` | 0.35 | ✓ |
| `machineGuid` | 0.30 | ✓ |
| `systemDiskSerial` | 0.20 | — |
| `biosSerial` | 0.15 | — |
| `systemVolumeSerial` (aux) | 0.05 | — |
| `baseboardSerial` (aux) | 0.05 | — |

Primary claims sum to 1.00; auxiliaries are additive tie-breakers (they can lift a borderline score but
are not required). Weights are versioned with the algorithm.

### 8.2 Inputs & match quantities

From the **signed license** (bound at issuance, all values are hashes per §7):
- `boundClaims` — map `type → boundHash` for each claim bound into the license.
- `boundWeightTotal = Σ weight(t)` over `t ∈ boundClaims`.
- `bindingStrength = |{ t ∈ boundClaims : strong(t) }|` — the count of **strong anchors** (`smbiosUuid`,
  `machineGuid`) bound at issuance, ∈ `{1, 2}`. Guaranteed ≥ 1 by the §8.4 issuance gate; the
  ≥2-total-claims guardrail guarantees at least one corroborating non-strong claim. **`bindingStrength`
  is written into the license payload** so the match rule below is reproducible by any client version
  validating that license.

From the **current machine** (recompute claim hashes, §7):
- `matched(t)`        = `t ∈ boundClaims` ∧ `currentHash(t) === boundHash(t)`
- `contradicted(t)`   = `t ∈ boundClaims` ∧ `status(t) === "present"` ∧ `currentHash(t) !== boundHash(t)`
  — present **but different** (positive evidence of change), deliberately distinct from a claim that is
  now `missing`/`restricted` (unreadable, no evidence either way).
- `score = Σ weight(t) over matched(t)  /  boundWeightTotal`
- `strongMatched      = |{ t : strong(t) ∧ matched(t) }|`
- `strongContradicted = |{ t : strong(t) ∧ contradicted(t) }|`

### 8.3 Adaptive binding decision (normative — tolerant + fail-closed)

The decision **adapts to `bindingStrength`**: one uniform rule set yields more fault-tolerance on
machines that bound two strong anchors, and stricter identity on machines that could only bind one.
Evaluate in order; **first match wins**:

| # | Condition | Result |
|---|---|---|
| 1 | `strongMatched ≥ 1` ∧ `score ≥ BIND_THRESHOLD` (0.60) | **bound** |
| 2 | `strongMatched ≥ 1` ∧ `score ≥ DEGRADED_FLOOR` (0.40) | **degraded** |
| 3 | `strongMatched == 0` ∧ `strongContradicted == bindingStrength` | **mismatch** |
| 4 | otherwise | **degraded** |

Emergent adaptivity (this falls out of the rules above — it is not extra bookkeeping):

- **`bindingStrength = 2`** — losing *one* strong anchor entirely (OS reinstall changes `machineGuid`,
  or a board/SMBIOS swap changes `smbiosUuid`) still leaves `strongMatched ≥ 1`, so the machine binds
  via rule 1/2. Rule 3 only hard-fails when **both** strong anchors are present-and-different
  (`strongContradicted == 2`), so a single legitimate major change never evicts the machine. When
  exactly one strong anchor is contradicted while the other matches, the machine **binds** but the
  event is audited `strong-anchor-drift` (possible motherboard swap / OS reinstall) for detection.
- **`bindingStrength = 1`** — the single bound strong anchor must hold:
  - it is **contradicted** (present, changed) → `strongContradicted == 1 == bindingStrength` → rule 3 →
    **mismatch** (confidently a different machine);
  - it is merely **unavailable now** (e.g., WMI got policy-blocked after issuance, so the anchor is
    `restricted`/`missing` rather than changed) → not contradicted → rule 4 → **degraded**
    (reactivation), never a hard mismatch, because identity cannot be confirmed either way.

Non-strong changes are absorbed by the score alone: e.g., with both strong anchors bound (weight
0.65) plus disk (0.20) + bios (0.15), replacing the disk drops `score` to `0.80` — still ≥ 0.60 → bound.

**Outcomes are fail-closed:** `bound` grants access; `degraded` and `mismatch` both deny run access.
`degraded` surfaces an in-place Super-User **reactivation** prompt; `mismatch` shows the generic failure
screen with the license-import / administrator-recovery path (master §11, §22). `BIND_THRESHOLD`,
`DEGRADED_FLOOR`, and the strong-anchor set are named constants in
`src/security/machine/MachineMatchPolicy.ts`, unit-tested against synthetic claim sets: single-change
tolerance at strength 2, single-strong-loss → `mismatch` (contradicted) vs `degraded` (unavailable),
`strong-anchor-drift` audit at strength 2, clone identical-pass, all-placeholder rejection.

### 8.4 Issuance trust gate (fail-closed) — sets `bindingStrength`

A fingerprint may only be used to **issue a request code / bind a license** when
`weightPresent ≥ 0.60`, `strongPresentCount ≥ 1`, **and** ≥ 2 trustworthy claims total (never a
single-claim bind). At issuance, `bindingStrength := strongPresentCount` and is written into the
license payload (consumed by §8.3). Otherwise `trust.sufficient = false` → §11 manual / administrator
recovery path. This prevents binding to an untrustworthy, mostly-placeholder machine.

---

## 9. Renderer contract (safe surface only)

The renderer (untrusted) receives **only**:
```ts
interface MachineStatusView {
  requestCode: string;                 // safe, non-sensitive (see §10)
  fingerprintVersion: 1;
  trust: "sufficient" | "insufficient";
  bindingState: "bound" | "unbound" | "degraded" | "mismatch";
  // NO raw identifiers, NO hashes, NO per-claim serials, NO diagnostic reasons.
}
```
IPC (added under the master plan's `license` namespace — not `auth`/`session`):
- `license:getRequestCode()` → `string`
- `license:getMachineStatus()` → `MachineStatusView`

Both are guarded by the existing global sender guard + session/permission checks. Raw claims, hashes,
and collector diagnostics never cross the bridge.

---

## 10. Machine request code (safe, human-readable)

- Purpose: what a user copies and sends to the license issuer (§11 / Model 2 tool) to obtain a signed
  license. Must be **safe to display, copy, email** — it carries only hashes + metadata, never raw
  identifiers.
- Structure (conceptual): `AWK1-<ver>-<truncatedClaimHashes>-<crc>` encoded in **Crockford base32**,
  grouped in 5-char blocks for legibility, with a checksum block to catch transcription errors.
- Encodes: `fingerprintVersion`, the set of **present** claim types + their truncated hashes, and which
  were strong. Does **not** encode missing/placeholder raw context.
- The issuing tool verifies the checksum, reads the hashes, and signs a license binding exactly those
  hashes with their weights — so issuance never needs the raw machine values either.
- Length target: ≤ ~120 chars; if the full present-set is large, include the strong claims + highest-
  weight primaries and drop aux from the code (aux still contributes locally to matching).

---

## 11. Fail-closed behaviour & recovery workflows

When `trust.sufficient === false` (too few trustworthy claims — e.g., a locked-down VDI where WMI is
policy-blocked and only a placeholder MachineGuid remains) **or** binding is `mismatch`/`degraded`:

1. **Fail closed** — the app does not grant licensed access; it shows the generic failure screen
   (master §22): *"Something went wrong. Please contact your system administrator."* with a safe
   differentiator (`Machine authorization failed` / `License not activated`).
2. **Manual license activation** — the failure/license screen lets an authorized user **import a signed
   license file** (`.awlic`) directly (verified by Ed25519 signature + binding, master §15). Import
   does not require a prior session (chicken-and-egg on a fresh machine) — the signature is the gate.
3. **Administrator recovery** — for a machine that genuinely cannot produce enough trustworthy claims,
   the internal license tool (private key off-client) can issue:
   - a **signed override/reset token** bound to the current (weak) request code, which the client
     verifies and accepts as an explicit administrator decision, fully audited; or
   - a license bound to a **reduced claim set** with a raised issuance note, at the administrator's
     discretion.
4. Every fail-closed event, manual activation, and recovery-token use is **audited** (master §23) with
   reason codes; raw identifiers are never included.

This satisfies "fail closed + provide a manual license-activation or administrator recovery workflow"
without ever weakening to an open default and without shipping the private key.

---

## 12. Tests (design)

Pure-logic verifier `scripts/verify-machine-identity.mts` (tsx, pass/fail counter, repo convention):

- **Normalization:** dashed vs braced vs bare UUID → same canonical hash; case-insensitivity;
  whitespace collapse.
- **Placeholder rejection:** every denylist entry, all-zero/all-F, repeated-char, too-short, empty →
  `placeholder`/`missing`; a genuine-looking value → `present`.
- **Hashing:** deterministic across runs; different `claimType` with same value → different hash;
  raw value never appears in the record; truncation stable.
- **Weighted matching:** identical machine → score 1.0 bound; single primary changed (disk / bios) →
  still bound (≥0.60, strong intact); both strong changed → `mismatch`; all-placeholder → issuance
  `insufficient`; aux-only collision without strong → not bound; degraded band routes to reactivation.
- **Tolerance/version:** v1 license validates under v1 algorithm after a simulated v2 bump.
- **Request code:** round-trips (encode→decode) hashes + version; checksum catches a flipped char;
  contains no raw identifier substring.
- **Collector isolation (mocked):** one collector throwing/timing out → its claim `missing`/`restricted`,
  others still collected; batch never rejects.

GUI/integration (Phase 5/6): real Electron confirms `license:getMachineStatus`/`getRequestCode` return
only the safe view (no raw values in the IPC payload — asserted by scanning the serialized response),
and that collection runs off the splash critical path.

---

## 13. Security & privacy notes

- **No admin, ever** — all sources verified readable by a normal user (§1); never call elevation-only
  APIs. If a value needs admin, treat as `restricted` and degrade.
- **Data minimization** — store only salted hashes; raw identifiers live only transiently in main.
- **No renderer exposure** — request code + status only; enforced by the IPC contract test.
- **VM/clone reality (documented limit):** a VM clone that duplicates SMBIOS UUID + disk serial +
  MachineGuid will fingerprint identically to its source — matching cannot distinguish perfect clones;
  the license `licenseId` single-use + duplicate-use anomaly audit (master §16/§24, T-15) is the
  compensating control, not the fingerprint.
- **False-rejection budget:** the 0.60 threshold + strong-anchor rule + degraded reactivation band are
  tuned to tolerate one legitimate hardware change; multi-component changes intentionally require
  Super-User reactivation.
- **Honest boundary:** a determined local attacker can spoof WMI/registry responses to a patched
  client; fingerprinting raises cost and detects casual movement/cloning. Integrity ultimately rests on
  the **off-client private signing key**, not on the fingerprint.

---

## 14. Open decisions (fingerprint-specific)

- **F-O-1** Bind threshold (0.60 proposed) and degraded band (0.40–0.60) — confirm.
- **F-O-2** Include auxiliary claims (baseboard/volume) in v1, or primaries-only?
- **F-O-3** Request-code truncated-hash length (128-bit proposed) vs full-hash (longer code)?
- **F-O-4** Issuance trust gate: require ≥1 vs ≥2 strong anchors present to bind?
  **RECOMMENDED DEFAULT → ≥1 strong anchor**, with two guardrails: (a) also require
  `weightPresent ≥ 0.60` **and** ≥2 trustworthy claims total (never a single-claim bind); (b) record
  `bindingStrength = strongPresentCount` in the license and let the match rule adapt — when strength=2,
  either strong anchor may carry the match (stronger clone/move resistance on capable hardware) — so
  strong machines get strong binding without fail-closing WMI-restricted VDI/VM/whitebox machines onto
  the manual-activation path. Rationale: MachineGuid (registry, near-universal, no-admin) vs SMBIOS UUID
  (WMI — policy-blocked in VDI, placeholder on many VMs) are not equally available, so ≥2 penalizes
  legitimate users, not attackers; residual single-anchor clone risk is covered by single-use
  `licenseId` + duplicate-use audit + the off-client signing key. Flip to ≥2 only for per-physical-seat
  licensing where cloning is the primary threat and all targets expose a real SMBIOS UUID. Tunable via
  `MachineMatchPolicy.ts`. **Status: the adaptive `bindingStrength` match rule is now normative in
  §8.3** (no longer a deferred option); the only open sub-items are the numeric thresholds
  (`BIND_THRESHOLD` 0.60 / `DEGRADED_FLOOR` 0.40 — see F-O-1) and the ≥1-vs-≥2 issuance gate for the
  per-physical-seat/anti-clone deployment case.
- **F-O-5** Registry MachineGuid read mechanism: `reg query` child process vs a registry-read module —
  confirm no new native dependency (prefer `reg query`, consistent with the no-native-ABI philosophy).

---

*End of specification. Design only; implementation lands in Phase 5 of the master plan after the open
decisions above and O-1..O-10 in the master plan are confirmed.*
