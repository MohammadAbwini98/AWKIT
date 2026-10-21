# N6 — Visual Assertions

Status: **RATIFIED / IMPLEMENTATION AUTHORIZED (2026-10-22).** The owner accepted C1–C5 and ratified VA-0 to VA-16
as amended (DECISIONS 2026-10-22, contract `awkit-vra-15-n6-start-1022`). These are ratified **design decisions,
not verified implementation**. The final closure review stays on record as **CHANGES REQUIRED**, not APPROVED, and
the independent implementation and security QC under N6.8 remains mandatory. N6.1 is closed. **N6.2 is implemented**
(`src/visual/assertion/decideVisualAssertion.ts`, `verify:visual-assertion`); N6.3 to N6.9 are not started.
Earlier contracts: `awkit-vra-n6-plan-1021` (plan), `awkit-vra-n6-plan-review-1021` (first review),
`awkit-vra-n6-amend-1021` (owner AMEND and three focused reviews), `awkit-vra-n6-final-1021` (final owner amendments
and the closure review).

Baseline: `main` at `181c13e2` (2026-10-22). Acceptance environment: the owner-approved Windows 11 ARM64 Parallels
machine (DECISIONS 2026-10-19); that is a waiver of a separate clean-VM or x64 run, not a claim that one was executed.

## Owner amendments (N6.1 AMEND, 2026-10-21)

| # | Owner requirement | Applied in | Source re-checked |
|---|---|---|---|
| A1 | Enforcement fails closed; mismatch separate from unverified; `onFailure` preserved | VA-0, VA-8, VA-9, *Step outcome matrix* | `onFailure` (`FlowProfile.ts:825-828`); `handleFailure` routes on `onFailure.action` only (`FlowExecutor.ts:607-631`) |
| A2 | Grants bound to the tested environment, invalidated on change, stronger confidence, unqualified cells observe-only, no silent downgrade | VA-4, VA-12, VA-16, *Enforcement grants* | — |
| A3 | Lifecycle verified against real copy, import, export, delete, restore, locator change, step-id reuse; no unintended inheritance | VA-5, VA-11, *Baseline lifecycle* | `ProfileStore.ts:43-129, 163-212`; `profileStores.ts:26-34`; `flow.ipc.ts:29-65`; `recorder.ipc.ts:247`; `fragment.ipc.ts:117`; `flowValidationService.ts:323, 352-363`; `buildRecordedFlow.ts:182` |
| A4 | Keyed equality commitment instead of grids, dHash, raw digest; exact equality; precise residuals | VA-6, *Persistence* | `sha256Digest` hashes width, height and RGBA (`fingerprint.ts:124-129`) |
| A5 | Candidates immutably bound; permission and fresh re-auth before preview and approval; expired, consumed, stale rejected | VA-13, *Pending candidates* | `requireFreshReauth` (`sessionContext.ts:91`), `WORKFLOW_EDIT` (`Permissions.ts:30`) |
| A6 | Keystore, key loss, corrupt index, restore, replay, failed checks; fail closed; local-HMAC limits stated | VA-14, *Integrity and failure modes* | `SecretStorageCapability` (`app/main/secretStorageCapability.ts`), `secretStore.ts` |

## Final owner amendments (2026-10-21)

| # | Owner decision | Applied in | Source re-checked |
|---|---|---|---|
| F1 | **VA-2 reconfirmed:** dedicated non-retryable `assertVisual`, `observe` and `enforce`, no `onInconclusive`, existing failure routing preserved | VA-2, *Step outcome matrix* | `FlowExecutor.ts:607-631` |
| F2 | **VA-16 amended, staged scope:** observe-only in packaged production; experimental enforcement only in the non-packaged acceptance environment; enforce not offered by the packaged Designer; a saved or imported enforce request fails closed as `visual-unverified` with an explicit reason; offline, AI-independent, protected-auth boundary unchanged; production qualification and enforcement a separate future milestone | Objective, *Production and experimental capabilities*, VA-0, VA-9, VA-12, VA-16, outcome matrix, acceptance, completion | `getAppMode()` (`appPaths.ts:50-56`); one runtime root for both builds (`appPaths.ts:9-11`) |
| F3 | **VA-11 amended:** importing over an existing flow requires `WORKFLOW_EDIT` before any modification or baseline invalidation; creating a new flow keeps its create authorization; race-safe; a security dependency before production enforcement | VA-11, *Import authorization*, *Baseline lifecycle*, N6.9 | `flows:import` checks only `WORKFLOW_CREATE` (`flow.ipc.ts:49-50`); `import` overwrites without a lane-held check (`ProfileStore.ts:119-123, 203-205`); `assertSenderPermission` (`sessionContext.ts:64`) |

## Review history

- **First independent review** (CHANGES REQUIRED, 15 findings, all applied): validator and permission facts, envelope
  with geometry and interaction state, outcome matrix, per-cell calibration, non-retryable execution, indexed store
  without a context crop, full N0 mapping, compatibility rows, VA-13 to VA-15.
- **Focused review of the owner amendments** (CHANGES REQUIRED, 13 findings, all verified and applied):

| # | Sev. | Finding | Change |
|---|---|---|---|
| 1 | High | No production path to a grant: per-machine 300-launch calibration after every update and every 30 days | New **VA-16**: in N6 grants are issued only by the calibration harness (lab-only enforce); in-app qualification deferred |
| 2 | High | No `create` or quarantine hook: a recreated flow with positional ids inherits old approvals | Epoch invalidated on **every** create, import, clone, Recorder save and quarantine |
| 3 | High | Hook ordering and atomicity undefined: approval/update race, crash windows, keystore-down import | Invalidate-first inside the same folder lane; keyless invalidation; approvals take the same lane |
| 4 | Medium | Epoch kept inside per-step indexes resets on purge | One per-flow **random** epoch (reworked in R1 as an unsigned token) |
| 5 | Medium | "No in-app restore" was false | `undoMigration` and AI revert listed as update writers |
| 6 | Medium | `mode` in the step content digest breaks observe-to-enforce promotion | `mode` removed from the digest |
| 7 | Medium | `bindingDigest` undefined; no key generation; approver rule missing | Single step content digest; key generation bound; approver rule stated |
| 8 | Medium | Zero failures alone can qualify an all-inconclusive cell; trial unit and independence undefined; bound scope | ≥ 300 **passed** required; trial unit defined; independence stated as an assumption; scope stated |
| 9 | Medium | VA-2 text changed but marked accepted | VA-2 flagged for reconfirmation |
| 10 | Low | Missing integrity rows; clock rollback | Rows added; clock rollback stated |
| 11 | Low | Unverified codes missing from the vocabulary; flag-off capture unclear | Codes added; flag `off` does no capture |
| 12 | Low | Ambiguous `‖` encoding; wrong citation | Length-prefixed canonical encoding; citation fixed |
| 13 | Low | Import needs only `WORKFLOW_CREATE` yet purges approvals (`flow.ipc.ts:50`) | Stated residual; the pre-existing import-overwrite authorization gap noted for separate tracking |

- **Focused re-review of those changes** (CHANGES REQUIRED: findings 5–13 resolved, 1–4 partly; six new findings,
  all verified against the source and applied):

| # | Sev. | Finding | Change |
|---|---|---|---|
| R1 | High | Deleting only the epoch record left records behind: the flow stayed `baseline-unreadable` for good, and restoring the epoch file brought stale approvals back | Invalidation writes a new **unsigned random epoch token** and deletes the flow's indexes and records; a missing or unreadable token means `no-baseline` |
| R2 | Medium | A flow with no approval had no epoch, so an identical re-import between run and approval went undetected | The token exists from the flow's first create or import; candidates bind to it |
| R3 | Medium | The create hook could run before the existence check, so a failed duplicate-id create wiped approvals | The hook runs after the check, immediately before the write |
| R4 | Medium | `JsonProfileStore` has no hook; wrapping it in `runExclusive` self-deadlocks (`ProfileStore.ts:207-212`); quarantine runs outside the lane (`:47-61, 163-180`) | A new flow-only pre-write option on the shared store (N6.3); quarantine invalidation stated as outside the lane; update over a missing file invalidates |
| R5 | Medium | Purging a step from a signed index needs the key | A purge deletes that step's index and records; keystore-down update and `updateWith` tested |
| R6 | Medium | A harness outside the packaged app cannot sign grants the app accepts (`safeStorage`, `secretStore.ts:21-25`); key creation before a grant undefined | Harness runs in the app's main process in a non-packaged acceptance build; the packaged app has no grants; key created at the first approval or grant |

- **Narrow re-review of R1–R6** (CHANGES REQUIRED: R2, R3, R5 resolved, R1 nearly, R4 and R6 partly; six new
  findings, verified and applied):

| # | Sev. | Finding | Change |
|---|---|---|---|
| S1 | High | The runtime root is the same for packaged and non-packaged builds (`appPaths.ts:9-11`, `secretStore.ts:30`), so lab grants could reach the packaged app, or the two builds could each see the other's key as lost | Store, key and grants separated by `getAppMode()` (`appPaths.ts:50-56`); grants bind the mode; the packaged gate never reads grants |
| S2 | Medium | Quarantine is also reached inside the lane (`create` check `:68`, `updateWith` `:99`, the option's own re-read); delete and the rename half of `update` are not writes | Quarantine invalidation never takes the lane; a separate pre-delete call point; A3 cases |
| S3 | Low | Restoring an old token before leftovers are deleted could revive them | Startup sweep and every flow-store write delete other-epoch files; residual stated |
| S4 | Low | After key loss, keyless deletions could make the store look like first use | An unsigned key-state marker, cleared only by Reset, holds the key generation |
| S5 | Low | A first approval made every other "none"-bound candidate stale | Tokens created for all existing flows at N6's first start; no "none" |
| S6 | Low | DECISIONS wording | Aligned |

- **Final closure review** (contract `awkit-vra-n6-final-1021`; one bounded round as the owner required; CHANGES
  REQUIRED; scope items 3 and 4 sound, 1, 2 and 5 with issues). All five findings were verified against the code
  and applied. **They were not re-reviewed**, so no APPROVED verdict exists:

| # | Sev. | Finding | Change |
|---|---|---|---|
| C1 | High | A master key in the general secret store could be read by a flow that names it (`ExecutionEngine.ts:608-616`), listed, overwritten or deleted through `secrets:*` with app permissions (`secrets.ipc.ts:17-29`) | The key lives in a **private** N6 key file encrypted with the same `safeStorage` backend, never in the general store; A6 cases and mutants |
| C2 | Medium | Epoch tokens split by mode while both builds share one flows folder (`appPaths.ts:9-11`, `storagePaths.ts:58`): a flow replaced in one build left the other build's approvals alive | Epoch tokens are **shared by both modes**, written by both builds; signed files, key, marker and grants stay per mode; A3 case |
| C3 | Low | A flow copied in, or a changed flows path, could lack a token or inherit one; a missing token at capture was undefined | Tokens keyed by the resolved flows folder as well as the flow id; a missing token is created inside the lane at capture, before a candidate binds it |
| C4 | Low | The packaged Designer made an enforce step's mode read-only, yet authors were told to switch it to observe | Packaged: enforce → observe allowed, observe → enforce never offered |
| C5 | Low | Quarantine after an authorized overwrite was ambiguous against I6 | Stated: allowed only after authorization |

## Objective

Let a flow author add a **visual assertion** step: "this element should still look the way I approved it". On each run
the step captures the element through the protected-guarded N0 capture and checks it against an approved baseline
recorded under **proven, equal conditions**.

Rules: a visual assertion may only report a **mismatch** when the difference is proven; an **enforced** assertion
passes only when equality is proven in a qualified, currently valid environment; every other enforced outcome
**fails closed** as *unverified*. Observe mode never changes a step outcome.

**Staged scope (VA-16).** N6 delivers **observe-only** visual assertions in the packaged production app. Enforcement
exists in N6 only as an **experimental** capability of the non-packaged acceptance build. In the packaged app an
enforce request, however it arrived, never passes: it fails `visual-unverified/enforce-unavailable-in-production`.
Production qualification and enforcement are the separate future milestone `awkit-vra.16`, which N6 neither
implements nor closes.

## Production and experimental capabilities

| Capability | Packaged production (N6) | Non-packaged acceptance build (N6, experimental) | Future milestone `awkit-vra.16` |
|---|---|---|---|
| `assertVisual` in observe mode | **Delivered**: capture, verdict, report, candidates, approval | Same | — |
| Designer mode choice | Observe only; enforce never offered; an existing enforce step shown as unavailable in production, with the reason, and switchable to observe | Observe and enforce, enforce labelled experimental | Enforce offered once qualified |
| Feature flag | `off` (default) / `observe`; an `enforce` value is treated as `observe` | `off` / `observe` / `enforce` | — |
| Enforce-mode step (saved, imported or hand-edited) | **Fails `visual-unverified/enforce-unavailable-in-production`**, never passes | Outcome matrix with grants | Outcome matrix with production grants |
| Grants | None issued, none read | Issued by the N6.6 harness in this build only, dev-mode | In-app qualification (separate decision) |
| Baselines and key | Packaged-mode folder and key | Dev-mode folder and key | — |
| Prerequisite | — | — | N6 closed, including N6.9 import authorization |

All of it runs offline, needs no AI model, and keeps the protected-authentication boundary: protected-login steps,
handed-off pages and sensitive targets are refused before capture in every build.

## Distinct from N5, N7, N9 and N10

| Question | N5 Visual Failure Diagnosis | N6 Visual Assertions | N7 OCR | N9 Screenshot State | N10 Vision model |
|---|---|---|---|---|---|
| When does it run? | After a step finally fails | As an authored step, every run | On demand | Its own | Only with an approved model |
| Can it change a run? | Never | **Yes, enforce mode only, fail-closed** | Its own decision | Its own decision | Never without approval |
| Output | Observation codes | A step result | Text | A state label | Model claims |
| Reference | N2/N4 store, read-only | **Its own approved commitment** | — | — | — |
| Needs a model? | No | No | No | No | Yes |

## Today's baseline (as built, `594f5ea7`)

| Capability | Where | What N6 can rely on |
|---|---|---|
| Guarded element capture | `captureElement` (`src/visual/internal/captureCore.ts`) | Strict protected window, in-memory pixels; default 24 px context crop (`:120`, `:428`); clipped targets `wasClipped` (`:383-385`); no `animations`/`caret` options (`:281`) |
| Fingerprint | `fingerprintVisualImage` (`awkit-vfp-1`) | `contentDigest` = SHA-256 over width, height and RGBA (`fingerprint.ts:124-129`) |
| Comparison | `compareVisualFingerprints` | `identical` = equal digests; advisory score, no threshold |
| Evidence persistence | `VisualEvidence` v1 | One place since FD-4 (`visualEvidence.ts:9`) |
| Assertions, dispatch | `executeAssertion` (`StepExecutor.ts:2863`); dispatch default (`:2297`) | Unknown kinds/types rejected by the validator (`AssertionStepContract.ts:154`, `FlowValidator.ts:573`) |
| `onFailure` | `FlowProfile.ts:825-828`; `FlowExecutor.ts:607-631` | Routing depends on the action only |
| Flow store | `JsonProfileStore` (`ProfileStore.ts`), one folder lane via `runExclusive` (`:43-45`); `createFlowProfileStore` (`profileStores.ts:26`) | Single factory for every flow writer |
| Content binding precedent | `sha256FlowDigest` (`app/main/validation/contentDigest.ts`) | SHA-256 of canonical content |
| Keystore | `getSecretStorageCapability()`, `secretStore.ts` | DPAPI via `safeStorage`; unavailable branch injectable only in non-packaged test roots |
| Permissions | `WORKFLOW_CREATE` (create, clone, import), `WORKFLOW_EDIT` (update), `WORKFLOW_DELETE` (`flow.ipc.ts:29-50`); `requireFreshReauth` | Existing primitives |

**Measured facts.** Headed vs headless never byte-identical (N4.5, 0/9). Cross-launch byte identity lost only in
headless DPR 1 (N3.2: 6/12 baseline, 5/12 drift; other cells 12/12). Headless bytes depend on position (N3.2). No
calibrated similarity threshold (N2.3).

## Scope and non-goals

**Scope:** one non-retryable `assertVisual` step (observe, enforce); a pure verdict policy; a keyed-commitment store
with per-flow epoch tokens, per-step signed indexes and integrity; a flow-only pre-write option on the shared
`JsonProfileStore` for invalidate-first lifecycle hooks;
run-produced pending candidates approved by a person; experimental environment-bound grants issued by the
calibration harness in the acceptance build; the packaged enforce-unavailable rule; import-over-existing
authorization (N6.9); a fourth `src/visual` edge; a codes-only report block and drawer section; a Designer node;
calibration and verifiers.

**Non-goals:** production enforcement and in-app machine qualification (future milestone `awkit-vra.16`); viewport,
page or region assertions; masks; diff images; tolerance passes; auto-updated baselines;
persisted image bytes, grids, dHash or raw digests; baseline export; OCR,
state labels, models; any change to locators, recovery, other steps' retries, fusion, agreement, diagnosis or the
N2/N4 store.

## Architecture and data flow

```
Run (flag observe or enforce): StepExecutor dispatch ──► VisualAssertionStep (fourth src/visual edge, lazy)
   1. eligibility (protected/handoff/sensitive)                     → refusal codes, no capture
   2. resolve the locator to exactly one visible element (DOM, read-only)
   3. read-only state: :hover / :focus, CSS box
   4. captureElement (guarded, VA-15 policy, contextPaddingCss 0, 2000 ms)
   5. conditions key, step content digest
   6. baseline read: epoch token → step index → record (integrity, epoch, generation, key generation)
   7. decideVisualAssertion(...) ── pure ──► verdict + code   (equality: constant-time commitment compare)
   8. enforcement gate (app mode, step mode, flag, cell grant valid for this environment) → step status
      (outcome matrix; packaged: enforce steps fail enforce-unavailable-in-production, grants never read)
   9. eligible no-baseline / binding-changed / other-conditions → pending candidate (memory only)
  10. codes-only record ──► InstanceReport.visualAssertions (sanitized) ──► drawer section
Flag off: no capture, no candidate; observe steps inert, enforce steps fail unverified (disabled, or
   enforce-unavailable-in-production in the packaged build).
Flow store, new flow-only pre-write option, inside the flow folder lane, BEFORE the flow write (no key needed):
   invalidate the flow = new random epoch token + delete its indexes and records (create, clone, import, Recorder
   save, delete, id rename, update over a missing file), or delete the index and records of removed/changed
   assertVisual steps (update, updateWith). Quarantine invalidates without taking the lane. Signed files, key and
   grants are separated by app mode (packaged / dev); epoch tokens are shared, so both builds invalidate both.
Approve (WORKFLOW_EDIT + fresh re-auth, audited, single-use), inside the same flow folder lane ──► signed index + record.
```

## Conditions envelope and geometry (VA-4)

**Conditions key:** `renderMode`, full `browserVersion`, `appVersion`, `osBuild`, `devicePixelRatio`, `cssWidth`,
`cssHeight`, `colorScheme`, `forcedColors`, `reducedMotion`, `locale`, `timeZone`, `frameDepth`, `isMainFrame`,
`capturePolicy`, `fingerprintVersion`, `assertionPolicyVersion`.

**Geometry and state:** exact CSS box; `x`/`y` differ → `inconclusive/position-changed`; size differs with position
equal → `failed/size-differs-from-baseline`; `wasClipped` → `inconclusive/target-clipped`; `:hover`/`:focus` differ →
`inconclusive/interaction-state-changed`.

**Unprovable residuals:** installed fonts, GPU or software raster path, driver updates.

## Enforcement grants (VA-12, VA-16; owner amendment A2)

- **Cell:** `renderMode` × `devicePixelRatio`.
- **Grant:** the cell; the environment binding (app mode, `browserVersion`, `appVersion`, `osBuild`, `capturePolicy`,
  `fingerprintVersion`, `assertionPolicyVersion`, calibration suite version); the evidence file digest; the issue
  time; a 30-day expiry; the key generation; signed with `K_mac`; per machine and Windows user.
- **Issued only by** the N6.6 calibration harness after the cell met every criterion below, never by hand, by a run
  or by the renderer. Grants are signed with `K_mac`, whose master key is held through Electron `safeStorage`
  (`secretStore.ts:21-25`), so only code in the app's own main process with the same runtime root can issue grants
  that the assertions accept. **VA-16 (staged scope):** in N6 the harness runs inside the main process of a
  **non-packaged acceptance build** on the owner's machine, and enforcement is an experimental capability of that
  build only. The packaged app ships no harness, and its enforcement gate **never reads grants**: every enforce-mode
  step there fails `visual-unverified/enforce-unavailable-in-production`. Production qualification is the future
  milestone `awkit-vra.16`.
- **Build-mode separation.** Packaged and non-packaged builds share one runtime root (`appPaths.ts:9-11`) and,
  through the shared settings, one flows folder (`storagePaths.ts:58`). N6 therefore keys its **signed** files
  (`visual-baselines/<mode>/`), its private master-key file, its key-state marker and every grant by `getAppMode()`
  (`appPaths.ts:50-56`), and a grant binds the mode. Neither build reads the other's signed files or key, so neither
  sees the other's key as lost, and approvals do not carry between builds. The **epoch tokens are shared** by both
  modes (`visual-baselines/epochs/`) and written by both builds, so a flow replaced, deleted or quarantined in
  either build invalidates the approvals of both.
- **Invalid when** any bound field changed, the grant expired, the grant is missing, unreadable or integrity-failed,
  or the key generation changed (a reset). Invalid ⇒ the cell is **not qualified**.
- **Unqualified cells are observe-only.** An enforce-mode step in an unqualified cell **fails**
  `visual-unverified/cell-not-qualified` (or `grant-invalidated`, `grant-expired`); never a pass, never silently
  treated as observe.

**Confidence criterion (fixed before measuring), per cell.**

- **Trial unit:** one fresh browser launch, comparing one designated primary unchanged fixture against a baseline
  approved in a separate launch. Other unchanged fixtures in the same launch are recorded but are not counted as
  independent trials.
- **Qualification requires, in that cell:**
  1. at least **300 trials** spread over at least three separate app sessions, of which **at least 300 are `passed`**
     and **zero** are `failed` (an `inconclusive` trial counts toward neither, so a cell that only reaches
     `inconclusive` cannot qualify);
  2. every restyle, swap, text and size change `failed` in at least 30 launches each;
  3. moved, clipped and interaction-state fixtures always `inconclusive`;
  4. zero captures on protected, handoff and sensitive fixtures;
  5. p95 within the 2000 ms deadline.
- **What the bound means.** With 0 failures in 300 trials the one-sided 95 % upper bound on the per-launch
  false-mismatch probability is 1 − 0.05^(1/300) ≈ 0.994 % (Clopper-Pearson). This **assumes** launches are
  independent; launches within a session may be correlated, which is why three sessions are required, but
  independence is not proven. The bound covers the calibration fixtures on that machine and environment only, not
  authors' pages.

## Verdict and status vocabulary (fixed in N6.2)

**As implemented (N6.2, `src/visual/assertion/decideVisualAssertion.ts`).** The policy returns only `version`,
`verdict` and `code`, and each code may carry only one verdict. It reads facts the caller supplies: its own refusals,
the N0 outcome, the store's baseline status, both conditions envelopes, both CSS boxes with clipping and hover/focus,
and two precomputed commitments. It never sees a key, a digest or an image. Precedence:

1. malformed input or an unsupported input version;
2. a caller refusal, even when a capture is supplied;
3. the N0 failure code (an unknown code is `capture-unavailable`);
4. an invalid current observation or unsupported current versions;
5. a clipped current target, which outranks every baseline fact, so a clipped capture never becomes a candidate;
6. the baseline status;
7. an invalid or clipped baseline record, or unsupported baseline versions (`baseline-unreadable`);
8. conditions equality;
9. hover/focus;
10. position;
11. size;
12. a constant-time exact commitment comparison.

`fingerprintVersion` is the N1 identifier `awkit-vfp-1`.

**Verdicts** (`decideVisualAssertion`):

| Verdict | Code | When |
|---|---|---|
| `passed` | `identical-to-baseline` | `equal-proven` conditions, equal geometry and state, equal commitments |
| `failed` | `differs-from-baseline` | `equal-proven`, equal geometry and state, commitments differ |
| `failed` | `size-differs-from-baseline` | `equal-proven`, position equal, size differs |
| `inconclusive` | `no-baseline` / `baseline-other-conditions` / `binding-changed` | Baseline facts |
| `inconclusive` | `baseline-unreadable` | Corrupt, version-mismatched, oversized, integrity-failed, generation- or key-generation-mismatched index or record, or listed in the index but missing (a record of another epoch is ignored: `no-baseline`) |
| `inconclusive` | `integrity-unavailable` | Keystore unavailable or key lost |
| `inconclusive` | `position-changed` / `target-clipped` / `interaction-state-changed` | Geometry and state |
| `inconclusive` | `target-not-found` / `target-not-unique` / `target-hidden` / `target-offscreen` | DOM resolution |
| `inconclusive` | `protected-surface` / `handoff-active` / `sensitive-step` | Refused before capture |
| `inconclusive` | `capture-stale` / `capture-unavailable` / `budget-exhausted` / `cancelled` / `page-closed` | N0 refusals |

**Enforcement status codes** (set by the gate, not by the policy): `enforce-unavailable-in-production` (packaged
build, any flag; takes precedence over the others), `disabled` (flag `off`), `enforce-not-enabled` (flag
`observe`), `cell-not-qualified`, `grant-invalidated`, `grant-expired`. Each code carries a fixed plain-text reason
shown in the step result and the drawer.

**N0 mapping** (`errors.ts:9-40`): `TARGET_STALE`, `CAPTURE_STALE` → `capture-stale`; `TARGET_NOT_UNIQUE` →
`target-not-unique`; `TARGET_OFFSCREEN` → `target-offscreen`; `INVALID_BOUNDS` → `target-hidden`;
`FRAME_MAPPING_FAILED`, `CAPTURE_UNAVAILABLE`, `FINGERPRINT_FAILED`, `IMAGE_DECODE_FAILED`, unknown →
`capture-unavailable`; `UNSUPPORTED_FINGERPRINT_VERSION` → `baseline-unreadable`; `PAGE_CLOSED` → `page-closed`;
`BUDGET_EXHAUSTED` → `budget-exhausted`; `CANCELLED` → `cancelled`; `PROTECTED_SURFACE` → `protected-surface`.

## Flag, step mode and build availability (VA-9 clarification, 2026-10-22)

Three independent inputs decide a step's status. None of them rewrites another.

| Input | Who sets it | What it controls | What it never does |
|---|---|---|---|
| **Feature flag** (`off` / `observe` / `enforce`) | The operator, per installation | Whether any visual assertion captures at all (`off` captures nothing), and in the acceptance build whether enforcement may run | Never changes an authored step's mode. Never turns an enforce step into a passing step |
| **Step mode** (`observe` / `enforce`) | The flow author, saved in the flow | What the author asked for | Never changed by the runner, the flag or the build. Only the author edits it (in the packaged Designer: enforce → observe only) |
| **Build availability** (`getAppMode()`) | The build | Whether enforcement exists at all: packaged = no; non-packaged acceptance build = experimental, with a valid grant | Never read from a setting, a flow or an environment variable |

Consequences:

- **Packaged production:**
  - An authored `enforce` step, whether saved, imported or hand-edited, **always fails** with failure class
    `visual-unverified` and reason `enforce-unavailable-in-production`, whatever the flag.
  - It is never silently run as a passing observe step. Experimental grants are never read.
  - A flag value of `enforce` only behaves like `observe` for `observe` steps. It cannot make an enforce step run or
    pass.
  - The Designer never offers enforce as a mode.
- **Non-packaged acceptance build:**
  - An `enforce` step may pass only with flag `enforce`, a valid grant for the cell and a `passed` verdict.
  - A `failed` verdict fails as `visual-mismatch`. Everything else fails as `visual-unverified` with its reason.
- **Routing:** `onFailure` routing is unchanged in both builds.
- **Where this lives:** the N6.2 policy decides only the verdict. The mapping to a step status is N6.4.

## Step outcome matrix (VA-0, VA-8, VA-9, VA-16; owner amendments A1, F2)

Two failure classes, recorded separately in the step result, the report and the run summary: **`visual-mismatch`**
(a proven difference) and **`visual-unverified`** (enforcement requested but equality not proven).

**Packaged production build** (`getAppMode() === "packaged"`; the flag accepts `off`/`observe`; a stored `enforce`
flag value acts as `observe` for observe steps only and never makes an enforce step run or pass; grants are never
read):

| Step mode | Flag | Capture and verdict | Step status |
|---|---|---|---|
| observe | `off` | none (no capture, no candidate) | passed (inert, reported `disabled`) |
| observe | `observe` | evaluated and recorded | **passed** |
| enforce (saved, imported or hand-edited) | `off` | none | **failed — `visual-unverified/enforce-unavailable-in-production`** |
| enforce (saved, imported or hand-edited) | `observe` | evaluated and recorded for diagnosis | **failed — `visual-unverified/enforce-unavailable-in-production`** |

**Non-packaged acceptance build** (experimental enforcement):

| Step mode | Flag | Cell grant | Capture and verdict | Step status |
|---|---|---|---|---|
| observe | `off` | — | none (no capture, no candidate) | passed (inert, reported `disabled`) |
| observe | `observe`/`enforce` | any | evaluated and recorded | **passed** |
| enforce | `off` | — | none | **failed — `visual-unverified/disabled`** |
| enforce | `observe` | — | evaluated and recorded for diagnosis | **failed — `visual-unverified/enforce-not-enabled`** |
| enforce | `enforce` | not qualified / invalid / expired | evaluated and recorded for diagnosis | **failed — `visual-unverified/cell-not-qualified`** (`grant-invalidated`, `grant-expired`) |
| enforce | `enforce` | valid | `passed` | passed |
| enforce | `enforce` | valid | `failed` | **failed — `visual-mismatch`** |
| enforce | `enforce` | valid | `inconclusive` | **failed — `visual-unverified/<verdict code>`** |

- The validator accepts `mode: "enforce"` in every build, so a flow saved or imported with enforce stays loadable and
  editable. In the packaged build it is flagged as unavailable in production, and it fails closed when run.

- No `onInconclusive` option: nothing enforced can be configured to pass without proof.
- A failed step follows its existing `onFailure` action unchanged; routing reads the action only
  (`FlowExecutor.ts:607-631`), so the failure class is carried as data without new routing.
- Non-retryable (VA-2); loops evaluate every iteration against the same baseline; branches use their own page; child
  flows use their own ids; popups use `pageAlias`.

## Persistence (VA-5, VA-6; owner amendment A4)

New folder `visual-baselines/` under the runtime root. No `VisualEvidence` is persisted, so **FD-4 stands**.

- **Flow epoch token** (one per `flowId`): an **unsigned** random 128-bit value, written by the flow's first create or
  import and rewritten with a fresh random value by every invalidation, which also deletes the flow's indexes and
  records. It needs no key, so invalidation works with the keystore down. It is unsigned on purpose: every signed
  index and record includes the epoch, so a changed, missing or corrupt token makes approvals unreachable. A random
  value never returns to a previous one, and the records of an old epoch are deleted with it. Tokens are shared by
  both app modes and keyed by **the resolved flows folder and the flow id**, so changing the Settings flows path never
  lets same-id flows in another folder inherit tokens or approvals. At N6's first start every existing flow gets a
  token inside the flow folder lane. A flow copied in from outside the app, or any other flow found without a
  token, gets one **inside the lane at capture, before a candidate binds it**; a run never binds a missing token.
- **Key-state marker** (one per app mode): unsigned, holding the key generation and the fact that a key was created.
  Written when the key is created, rewritten only by *Reset visual baselines*, never deleted by invalidation.
- **Step index** (one per `(flowId, stepId)`): the flow epoch it belongs to, a monotonically increasing
  `generation`, and the current `approvalId` per `(stepContentDigest, conditionsKey)`; signed.
- **Record** (one per approval): key parts, `epoch`, `generation`, `approvalId`, key generation, the conditions
  envelope, the CSS box and interaction state, image width and height, the **commitment**, approval metadata (approver,
  run user, run id, time, app version); signed.
- **Commitment:** `HMAC-SHA256(K_commit, enc("awkit-n6-commit-v1", flowId, stepId, stepContentDigest, conditionsKey,
  epoch, width, height, contentDigest))`, where `enc` is a canonical encoding that prefixes each field with its
  4-byte big-endian length, so no field boundary is ambiguous. A run recomputes it from the current `contentDigest` and
  compares in constant time: equality is **exact pixel equality** (`fingerprint.ts:124-129`). Key parts and epoch make
  commitments unlinkable across steps, conditions and epochs.
- **Not persisted:** grids, dHash, raw `contentDigest`, any image, crop or context.
- **Step content digest:** SHA-256 (via the `contentDigest.ts` boundary) over the canonical `assertVisual` step
  **excluding `mode` and the display name**: type, locator and alternatives, `pageAlias`, frame chain. Promoting a step
  from observe to enforce keeps its approval; any targeting change is `binding-changed`.

**Privacy residuals.** Without `K_commit` (other users, other machines, copied or synced files, support bundles) a
record reveals the element's CSS box, the conditions and the approval metadata, nothing about the pixels. With
`K_commit` (code running as the same user can unwrap it through DPAPI) an attacker can test a guessed byte-exact
rendering. The approval preview (VA-13) is the only time pixels leave the capture.

## Baseline lifecycle (verified against source; VA-5, VA-11; owner amendment A3)

All flow-store writes run in one folder lane (`ProfileStore.ts:43-45`). `JsonProfileStore` has no hook today, and
a wrapper that called `runExclusive` around a store method would self-deadlock (`ProfileStore.ts:207-212`). N6.3
therefore adds optional callbacks to the shared store, set only by `createFlowProfileStore`; other stores are
unaffected. The store calls them from its unlocked internals, and none of them acquires the lane (that would
self-deadlock):

- **before write**: inside the lane, after any existence check, immediately before `writeProfileUnlocked`;
- **before delete**: inside the lane, immediately before `deleteUnlocked` (`delete`, and the rename half of `update`);
- **on quarantine**: from `readProfileFile` before the rename aside, wherever it runs. That is outside the lane for
  `list()` and `get()`, and inside it for `create`'s existence check (`ProfileStore.ts:68`), `updateWith` (`:99`)
  and the before-write callback's own read of the previous file.

*Invalidate the flow* = write a new random epoch token, then delete the flow's indexes and records. *Purge a step* =
delete that step's index and records. Neither needs the key.

| Event (writer) | Real behavior today | N6 action before the write |
|---|---|---|
| `create` (`flows:create` `WORKFLOW_CREATE`; Recorder save `recorder.ipc.ts:247`) | Refuses an existing id inside the lane (`ProfileStore.ts:63-73`) | After the existence check: **invalidate the flow** (a flow deleted outside the app and recreated never inherits). A refused duplicate-id create changes nothing |
| Clone (`flows:clone`) | New id, **step ids unchanged** (`ProfileStore.ts:111-117`, `profileStores.ts:29-33`) | Through `create` ⇒ invalidate the new id |
| Import (`flows:import`, `WORKFLOW_CREATE`; overwrite also `WORKFLOW_EDIT` per N6.9) | **Keeps the id, overwrites** an existing flow (`ProfileStore.ts:119-123`) | New id: as create. Existing id: only after the in-lane overwrite authorization passes (*Import authorization*), invalidate the flow, even for a re-import of identical content. A refused import changes nothing |
| Update (`flows:update`, validation repair `flowValidationService.ts:323`, `undoMigration` restore `:352-363`) | Write, then delete the old id on rename (`ProfileStore.ts:75-88`) | Id rename: invalidate both ids. Previous file missing or unreadable: invalidate the flow. Otherwise purge every `assertVisual` step removed or whose step content digest changed (the option reads the previous file inside the lane) |
| `updateWith` (AI revert `aiRuntime.ts:588`, locator upgrade `locatorUpgradeService.ts:123`, fragment instantiate `fragment.ipc.ts:117`) | Read-modify-write in the lane (`ProfileStore.ts:96-105`) | Same as update |
| Delete (`flows:delete`, `WORKFLOW_DELETE`) | `rm` (`ProfileStore.ts:107-109`) | Invalidate the flow |
| Quarantine of a corrupt file | Renamed aside from `readProfileFile`, reached outside the lane by `list()`/`get()` and inside it by `create`, `updateWith` and the callback's own read (`ProfileStore.ts:47-61, 68, 99, 163-198`) | Invalidate the flow from the on-quarantine callback, without taking the lane. Fail-safe either way: the flow is absent until a create, import or update, each of which invalidates |
| Export (`flows:export`) | Returns the profile (`ProfileStore.ts:125-129`) | Nothing exported (VA-11) |
| External file edit or restore | Outside the app | Run-time checks: step content digest, epoch, generation; a consistent restore of the whole baselines folder is the VA-14 residual |
| Step-id reuse | Recorder ids are positional (`buildRecordedFlow.ts:182`) | A new flow invalidates on create; within a flow, a removed step is purged on removal; a reused id with different content is `binding-changed`; identical content in the same save is the same assertion |

**Keyless invalidation.** Invalidation and purge only write a random token and delete files, so with the keystore
down flow writes still proceed and invalidate. The token is written **first**, so a crash part-way through the
deletions leaves records whose epoch no longer matches: they are ignored (`no-baseline`) and deleted by a sweep at
app start and by every later flow-store write or approval for that flow. A missing or unreadable token likewise means
`no-baseline`, and the next approval writes a new token after deleting any leftover files. Residual: restoring the
old token by hand before the sweep runs would make those leftovers match again; that is a same-user file restore
(VA-14 limit).

**Crash windows.** Invalidation precedes the flow write, so a crash between them can only lose approvals (fail-safe),
never keep stale ones. An id rename invalidates the new id before writing it and the old id before deleting it.

**Approval ordering.** An approval acquires the same flow folder lane, re-reads the current flow and re-checks
staleness inside it, so it can never land after an update that removed or changed its step.

## Cross-process safety (mandatory N6.3 implementation gate, 2026-10-22)

**Why.** `folderWriteCoordinator.ts` serializes writes per resolved folder **inside one process** only: its lanes
are an in-memory map. The packaged and non-packaged builds share one runtime root (`appPaths.ts:9-11`) and, through
the shared settings, one flows folder (`storagePaths.ts:58`). N6 shares epoch tokens across both builds (C2). So the
lane-held ordering this plan relies on (invalidate before write, approval re-checks inside the lane, import
authorization inside the lane) does **not** hold between two processes. N6.3 must not be closed until this is solved.

**Required.** N6.3 adopts, documents and proves one of:

1. **Cross-process coordination** with an architecture-compatible mechanism. The existing `DurableLockStore`
   (`src/runner/store/DurableLockStore.ts`: atomic `wx` lock files, fencing versions, dead-pid stale handling) is
   the first candidate; no parallel persistence architecture is added. The lock must be keyed by the resolved
   flows folder.
2. **A verified single-writer ownership rule** that prevents a second process from mutating the shared flow and
   baseline storage at all while another holds it, enforced at the mutation points rather than by convention.

**Either way it must cover:**

- flow create, update, `updateWith`, import, clone, delete and rename;
- epoch-token creation, invalidation and the start-up sweep;
- baseline approval and candidate staleness validation;
- concurrent packaged and non-packaged operation;
- crash recovery, including orphaned lock or ownership state;
- read/write consistency when the Settings flows path changes while a writer is active.

**Rules:**

- No arbitrary sleeps.
- No lock stealing from a live holder. A TTL alone is never grounds to take over a lock whose process is alive;
  recovery needs a provably dead holder, with the fencing version checked before the next write.
- No silent retries: a refused or timed-out acquisition is a typed, reported failure.
- No new persistence architecture.
- A failure to coordinate fails closed: no write, no invalidation skipped, no approval.

**Deterministic two-process verification** (`verify:visual-baseline-cross-process`, new in N6.3): two real Node
processes against one temporary flows folder, synchronized by explicit handshakes (barrier files or IPC
messages, never timing):

| # | Case | Expected |
|---|---|---|
| X1 | Process A holds the coordination point mid-invalidation; process B attempts a flow write | B waits or is refused (typed); never interleaves |
| X2 | A approves while B updates the same flow (both orders) | Never a stale approval |
| X3 | A imports over a flow while B creates the same id | Never an overwrite without authorization |
| X4 | A and B both create the missing epoch token for a flow | Exactly one token wins; no candidate binds a lost token |
| X5 | A is killed while holding the coordination point | B recovers only after proving A dead, with fencing; no write from A lands afterwards |
| X6 | A is alive past any TTL | B never takes over |
| X7 | The flows path changes in A while B writes the old folder | Each process coordinates on its own resolved folder; no cross-folder token or approval |
| X8 | One process runs packaged mode, the other dev mode | Shared tokens are coordinated; per-mode signed files stay separate |

Mutants that must turn red: remove the cross-process coordination (in-process lane only), allow TTL takeover of a
live holder, skip the fencing check, swallow an acquisition failure, key the lock by the configured instead of the
resolved folder.

## Import authorization (VA-11; owner amendment F3; N6.9)

**Today.** `flows:import` checks only `WORKFLOW_CREATE` (`flow.ipc.ts:49-50`), and `JsonProfileStore.import` takes
the lane and writes without checking whether the id exists (`ProfileStore.ts:119-123, 203-205`). So a user who may
create but not edit can overwrite any flow. `flow.ipc.ts:55` is the only caller of the flow store's `import`.

**Required (N6.9, before production enforcement):**

1. The `WORKFLOW_CREATE` entry gate stays. A new id imports exactly as today (a create).
2. Overwriting an existing id additionally requires `WORKFLOW_EDIT`.
3. **Race-safe decision.** The flow store's `import` gains a flow-only overwrite authorizer. Inside the folder lane
   it (a) checks existence by `stat` of the target path, so an unparseable file counts as existing and is **not**
   read or quarantined, and (b) if the file exists, calls the authorizer. The authorizer re-evaluates `WORKFLOW_EDIT`
   for the same sender at that moment, never takes the lane and has a bounded deadline, and a timeout counts as a
   denial. Only then do the before-write callback (N6 invalidation) and the write run. A create racing the import
   therefore cannot slip in between the check and the write. After an **authorized** overwrite, the callback's own
   read of an unparseable previous file may quarantine it; I6 and the mutants forbid quarantine only before
   authorization.
4. **Refusal** is a typed, audited `FLOW_IMPORT_OVERWRITE_FORBIDDEN` with a plain-text message. It happens before any
   write, quarantine or baseline invalidation, so the existing file, its epoch token, indexes and records are
   byte-identical afterwards.
5. The flow store's `import` refuses to overwrite when no authorizer is supplied (fail closed). Other stores'
   `import` is unchanged.

**Regression cases** (`verify:flow-import-authorization`, real `JsonProfileStore` and the IPC handler):

| # | Case | Expected |
|---|---|---|
| I1 | `WORKFLOW_CREATE` only, new id | Imported; epoch token created |
| I2 | `WORKFLOW_CREATE` only, existing id | Refused; file, token, indexes and records unchanged; one audit entry |
| I3 | `WORKFLOW_CREATE` + `WORKFLOW_EDIT`, existing id | Overwritten; flow invalidated |
| I4 | `WORKFLOW_EDIT` without `WORKFLOW_CREATE` | Refused at the entry gate (unchanged) |
| I5 | `WORKFLOW_CREATE` only, new id, racing a `flows:create` of the same id (both orders, held lane) | Never an overwrite: whichever lands second is refused |
| I6 | `WORKFLOW_CREATE` only, an unparseable file at the target path | Refused; the file is not quarantined |
| I7 | `WORKFLOW_EDIT` revoked while the import waits for the lane | Refused (decided inside the lane) |
| I8 | Authorizer timeout | Refused |
| I9 | Store `import` without an authorizer, existing id | Refused |

Mutants that must turn red: check existence outside the lane; read the file with `get()` instead of `stat`; invalidate
before authorizing; skip the authorizer when the file is unparseable; treat an authorizer timeout as allow; check the
permission only at handler entry.

**Residual.** A user holding `WORKFLOW_CREATE` and `WORKFLOW_EDIT` can still replace a flow, and with it its
approvals, by import. That is the intended authority.

## Pending candidates (VA-13; owner amendment A5)

- **Produced** by a run with flag `observe` or `enforce` for `no-baseline`, `binding-changed`,
  `baseline-other-conditions` or `baseline-unreadable`, only after a successful guarded capture of an eligible step
  and only while the key is available. Flag `off` produces none. Approving one for an unreadable baseline audits the
  failure and then replaces it (a new generation; the unreadable record is deleted), so a damaged step never needs a
  global reset.
- **Immutably bound** to: a 128-bit random `candidateId`, `executionId`, `instanceId`, `flowId`, `stepId`, the flow
  epoch token read at capture (every flow has one; any invalidation, including an identical re-import, changes it),
  the app mode, the step
  content digest, the conditions key, the key generation, the user who started the run, and
  `createdAt`/`expiresAt` (30 minutes). In main-process memory only with the raw `contentDigest`, geometry and a
  transient PNG preview; at most 20; dropped at app exit.
- **Preview** (`visualAssertion:previewCandidate`): `WORKFLOW_EDIT` **and** fresh re-authentication, audited; the
  renderer never receives a digest, commitment or key.
- **Approve or reject:** `WORKFLOW_EDIT` **and** fresh re-authentication, audited with approver, run user, flow, step,
  conditions key and decision. Rejected when expired, already consumed (single-use, consumed atomically), or **stale**:
  the current flow epoch, step content digest or key generation differs from the candidate's, the flow or step no
  longer exists, or the keystore is unavailable.
- **Approver rule:** any user holding `WORKFLOW_EDIT` who passes fresh re-authentication may approve, including a user
  other than the one who started the run; both are recorded.
- **Approval writes** a new generation for that `(flowId, stepId)` inside the flow folder lane.

## Integrity and failure modes (VA-14; owner amendment A6)

**Key:** one 256-bit master key per Windows user and app mode, created at the first approval or the first grant
issuance, whichever comes first. It is held in a **private N6 key file** (`visual-baselines/<mode>/master-key`),
encrypted with the same `safeStorage` backend as the general store (`secretStore.ts:21-25`), and **never** placed
in the general secret store. The general store is reachable by any flow that names a secret (`ExecutionEngine.ts:608-616`)
and by `secrets:list`/`set`/`delete` (`secrets.ipc.ts:17-29`), and none of those paths can reach the private file.
Availability is still decided by the existing `getSecretStorageCapability()`. `K_mac` and `K_commit` are derived with
HKDF; a key
generation counter incremented by every reset. No plaintext fallback, environment override or setting.

| Failure | Behavior |
|---|---|
| Keystore unavailable | No approvals or grants; lookups `integrity-unavailable`; enforce fails `visual-unverified` |
| First use vs key lost | Decided by the key-state marker, not by which files remain: **no** marker ⇒ first use, create the key and the marker; a marker exists but the key is missing or unreadable ⇒ key lost, even after invalidations have deleted every signed file |
| Key-state marker deleted by hand | Looks like first use, so a new key is created; old signed files then fail their MAC (`baseline-unreadable`). Same-user action (stated limit) |
| Leftover files of another epoch | Ignored (`no-baseline`); deleted by the start-up sweep and the next write or approval for the flow |
| Key lost | Same as unavailable; a key is **never** regenerated silently. Only *Reset visual baselines* (permission, fresh re-auth, audited) purges all files and grants, creates a new key and increments the key generation |
| Epoch token missing, unreadable or changed | `no-baseline` for the flow; signed files of another epoch are ignored and deleted by the next approval |
| Epoch token restored alone | Nothing matches once the old epoch's files are deleted (at invalidation, or by the sweep after a crash); restoring it inside that window is the same-user residual |
| Packaged build meets non-packaged files, key or grants | Never read: signed files, key and grants are separated by app mode, and the packaged gate reads no grants; only the unsigned epoch tokens are shared, so either build's invalidation reaches both |
| A flow names the key, or `secrets:list`/`set`/`delete` targets it | Unreachable: the key is not in the general secret store under any name |
| Private key file deleted or replaced by hand | Key lost (marker present): `integrity-unavailable`, approvals unreachable, only Reset recovers. Same-user action (stated limit) |
| Corrupt or integrity-failed index | `baseline-unreadable` for that step; no rebuild from records; an approved candidate replaces it |
| Index lists an approval whose record is missing | `baseline-unreadable` (not `no-baseline`) |
| Integrity-failed record | `baseline-unreadable/integrity-failed`, audited once per record per run, never auto-deleted; only an approved candidate or a reset replaces it |
| Record replayed onto another flow, step, conditions key, epoch or key generation | Fails (MAC and commitment cover them) |
| Older record restored alone | Fails (generation or `approvalId` differs from the signed index) |
| Index and records restored together, epoch unchanged | **Not detectable locally** (residual) |
| Grant restored or copied | Fails if any bound field or the key generation differs; otherwise the same rollback residual |
| System clock set back | Can defeat the 30-day grant expiry (residual) |

**Stated limit.** A local HMAC keyed through the user's own DPAPI protects against other users, other machines,
copied or synced files and accidental corruption. It does **not** prevent forgery, replay or rollback by code running
as the same Windows user (including restoring an old epoch token before the sweep, or deleting the key-state
marker), a consistent restore of the whole folder, or clock rollback.

## Security and protected-auth boundary

Capture through N0's `captureElement` only, strict window, `contextPaddingCss: 0`. Protected-login step types,
handed-off pages, value-bearing, masked and sensitive targets are refused before capture and never become candidates.
The report block is codes-only behind a key-allowlist sanitizer and never carries a commitment, digest, image,
selector, URL or page text.

## Compatibility and out of scope

| Area | N6 behavior |
|---|---|
| Storage | Per Windows user, per machine (`%LOCALAPPDATA%`) |
| Export / import | Not exported; import of a new id is a create; import over an existing id needs `WORKFLOW_EDIT` (N6.9) and invalidates; an imported enforce step fails closed in the packaged build |
| Recorder | Does not record `assertVisual`; its save invalidates (create) |
| Workflow builder | No change |
| Random generator (`src/testing/random`) | Never generates `assertVisual` |
| Fragments | `assertVisual` rejected in fragments |
| Older builds | Validator refuses the unknown type; dispatch throws |
| Machine qualification and enforcement in the packaged app | Out of scope; future milestone `awkit-vra.16` (VA-16) |

## Performance budgets (VA-9)

One capture per assertion per run (non-retryable), 2000 ms deadline, one read-only state read, two HMACs.

## Accessibility and UI

Text-only results distinguishing *mismatch* from *unverified*, each with its plain-text reason. In the packaged
Designer the mode control never offers enforce; an existing enforce step shows "Enforce is not available in this
production build" as text (not color alone), and the author may switch it to observe (approval kept) but never back. In the acceptance build, enforce is labelled
experimental and the cell's grant status is shown. A live region
for approval; focus management; reduced motion; Hologram tokens; the preview has a text alternative and states it is
not stored.

## Owner decisions (ratified 2026-10-22 as design decisions; implementation QC under N6.8)

Every row below is **ratified** as written. The status column records how each row reached ratification.

| ID | Decision | Owner status | Ratified decision |
|---|---|---|---|
| VA-0 | Authority | **Amended (A1, F2)** | Only enforce mode can change an outcome, and in N6 only in the non-packaged acceptance build (experimental): passes only on proven equality in a qualified, valid cell; proven difference fails `visual-mismatch`; every other enforce outcome fails `visual-unverified`. In packaged production an enforce step never passes and fails `visual-unverified/enforce-unavailable-in-production`. Observe never changes an outcome. Amends VR-0 by one execution-affecting result. |
| VA-1 | Isolation | Accepted | Fourth allow-listed edge, lazy, public index only; four-edge isolation verifier. |
| VA-2 | Step shape | **Reconfirmed (F1)** | Dedicated non-retryable `assertVisual` step type with `mode` `observe` or `enforce`, no `onInconclusive`, existing failure routing preserved. |
| VA-3 | Scope | Accepted | One element resolved to exactly one visible element. |
| VA-4 | Conditions | **Amended (A2)** | Conditions key and geometry/state rules; the environment fields also bind grants. |
| VA-5 | Store | **Amended (A3, A4)** | Separate store: per-flow unsigned random epoch tokens (shared by both app modes, keyed by the resolved flows folder), signed per-step indexes, commitment records; FD-4 stands; a flow-only pre-write option on the shared store invalidates first, without the key, inside the flow folder lane on every writer (quarantine outside it). |
| VA-6 | Retention and privacy | **Amended (A4)** | Length-prefixed keyed equality commitment only; residuals as stated. |
| VA-7 | Pass rule | Accepted | Exact pixel equality only. |
| VA-8 | Outcomes | **Amended (A1)** | Outcome matrix; two failure classes; `onFailure` unchanged; no `onInconclusive`. |
| VA-9 | Enablement | **Amended (A1, F2), clarified 2026-10-22** | Flag, step mode and build availability are independent and never rewrite each other (see *Flag, step mode and build availability*). Packaged: flag `off` (default, no capture) / `observe`; a stored `enforce` flag acts as `observe` for observe steps only; an authored enforce step always fails `visual-unverified/enforce-unavailable-in-production` and is never run as a passing observe step. Acceptance build: `off` / `observe` / `enforce`, enforce steps fail `visual-unverified` unless the flag is `enforce` and the cell is qualified. 2000 ms. |
| VA-10 | Approval permission | Accepted | `WORKFLOW_EDIT` + `requireFreshReauth`, audited. |
| VA-11 | Export and import | **Amended (A3, F3)** | Not exported; create, import, clone, quarantine, delete and id rename invalidate. Importing over an existing flow requires `WORKFLOW_EDIT`, decided race-safely inside the folder lane before any write or invalidation (N6.9); a new id keeps the create authorization. A security dependency before production enforcement. |
| VA-12 | Calibration and grants | **Amended (A2, F2)** | Experimental only: per-cell signed grants bound to the environment, app mode and key generation, 30-day expiry, issued only by the harness in the non-packaged acceptance build after ≥ 300 passed and zero failed trials over three sessions; independence an assumption; unqualified cells observe-only, enforce fails closed. No production grants in N6. |
| VA-13 | Baseline source | **Amended (A5)** | Bound (incl. epoch and key generation), single-use, 30-minute, memory-only candidates; permission and fresh re-auth before preview and approval; any authorized approver, both users recorded. |
| VA-14 | Integrity | **Amended (A6)** | Master key in a private N6 key file encrypted with `safeStorage` (never in the general secret store), created at the first approval or grant, HKDF keys, key generation in an unsigned key-state marker cleared only by reset, signed index/record/grant, unsigned shared epoch token with a start-up sweep, signed files, key and grants separated by app mode, the failure table, explicit reset, stated limits. |
| VA-15 | Capture policy | Accepted | `animations: "disabled"`, `caret: "hide"`, `contextPaddingCss: 0`, no pointer or focus change. |
| VA-16 | Staged scope and grant issuance | **Amended (F2)** | N6 delivers observe-only visual assertions in packaged production. Enforcement is experimental and exists only in the non-packaged acceptance build, with grants from the harness in that build. The packaged Designer never offers enforce. A saved or imported enforce request in the packaged build fails `visual-unverified/enforce-unavailable-in-production`. Store, key and grants are separated by app mode. Offline, AI-independent, and the protected-auth boundary is unchanged. Production qualification and enforcement are the separate future milestone `awkit-vra.16`, not implemented or closed by N6. |

## Acceptance criteria and deterministic verification

| Area | Acceptance criterion | Deterministic verification (fixed inputs, injected clock, mutants required red) |
|---|---|---|
| A1 | Each outcome-matrix row of both build tables gives exactly the listed status and class; no enforce path passes without a valid grant and proven equality; flag `off` captures nothing; `onFailure` routing unchanged | `verify:visual-assertion-runtime` table-driven per row and per `onFailure` action; mutants: drop the grant check, map `inconclusive` to pass, merge the classes, capture with flag `off` |
| F2 staged scope | Packaged mode: every enforce step (saved, imported, hand-edited JSON, flag `off`/`observe`/stored `enforce`) fails `visual-unverified/enforce-unavailable-in-production` and never passes, even with a valid dev-mode grant and identical pixels present; grants are never read; observe works; the packaged Designer offers no enforce option and shows an existing enforce step as unavailable; protected-login, handoff and sensitive fixtures produce no capture in both modes; no network or AI call | `verify:visual-assertion-runtime` with the app mode injected (packaged and dev) and a request recorder for network and AI; `verify:visual-assertion-gui` for the Designer in packaged mode; mutants: let packaged read grants, let packaged honour the `enforce` flag, offer enforce in the packaged Designer, report packaged enforce as `disabled` instead of the explicit reason |
| F3 import | Cases I1–I9 of *Import authorization* | `verify:flow-import-authorization` (new, N6.9) with a held lane and an injected authorizer delay; mutants as listed there |
| A2 | Grants bind every listed field and the key generation, expire at 30 days, come only from a qualifying harness run; invalid grant fails closed | `verify:visual-assertion-grants`: each bound field changed, expiry, tamper, hand-written grant, non-qualifying evidence (incl. all-`inconclusive` trials), key-generation change, no issuance path in the packaged build, a dev-mode grant presented to the packaged gate and a packaged-mode file presented to the dev store (both refused); mutants: read grants in packaged mode, drop the mode from the grant or the folder, skip a field, ignore expiry, accept unsigned, count `inconclusive` as passed |
| A3 | No approval survives create, clone, import (incl. identical re-import), quarantine, delete, id rename, step removal, step-content change, undoMigration restore, AI revert, locator upgrade, fragment instantiate; update over a missing file, a corrupt file met during `create`, `updateWith` or `list()`; a refused duplicate-id create leaves approvals intact; no callback deadlocks; promotion observe→enforce keeps the approval; an approval racing an update never lands stale; a crash between invalidation and write, or part-way through the deletions, never keeps or revives a stale approval; keystore-down import, update and `updateWith` still invalidate or purge; a flow deleted, recreated, imported or quarantined in one build leaves no approval alive in the other build; changing the flows path makes no same-id flow inherit a token or approval; a missing token at capture is created inside the lane before the candidate binds; other stores are unaffected by the option | `verify:visual-baseline-lifecycle` on a real `JsonProfileStore` and IPC handlers with injected crash points and a held lane; mutants: remove each hook, run the hook after the write, run the create hook before the existence check, drop the before-delete call on the rename half of `update`, acquire the lane from the on-quarantine callback, run the approval outside the lane, require the key to invalidate or purge, delete records before writing the token, include `mode` in the digest, key tokens by app mode, drop the flows folder from the token key, bind a candidate to a missing token |
| A4 | Files hold no grid, dHash, raw digest or image; equality exact; commitments unlinkable; encoding unambiguous | `verify:visual-baseline-store`: byte scan, one-pixel-change fixture, identical images on two steps, ambiguous-id pair (`ab`+`c` vs `a`+`bc`); mutants: store the raw digest, drop a key part, concatenate without lengths |
| A5 | Preview and approval need permission and fresh re-auth; expired, consumed, stale (epoch token, content, key generation, deleted flow or step) rejected, including a never-approved flow re-imported with identical content between run and approval; a candidate from before a reset rejected; never persisted | `verify:visual-assertion-candidates` with an injected clock; mutants: skip re-auth, skip consumption, skip each staleness field, skip the key-generation check, treat a missing token as matching any token |
| A6 | Each row of the failure table behaves as listed; no plaintext or regenerated key | `verify:visual-baseline-integrity` with the injected unavailable `SecretStorageCapability` (non-packaged root): unavailable keystore, first use vs key lost (incl. key lost after every signed file was invalidated), marker deleted by hand, first grant before any approval, missing/corrupt/changed/restored epoch token, leftovers after a crash removed by the start-up sweep, tokens created for pre-existing flows at first start, corrupt index, missing record, tampered, moved, older restored record, unreadable baseline replaced by an approved candidate, reset, a flow naming the key's file or any guessed secret name resolves nothing from it, `secrets:list`/`set`/`delete` neither show nor touch it; mutants: store the key in the general secret store, regenerate the key when the marker exists, decide first use from remaining files, skip the sweep, treat missing record as `no-baseline`, rebuild the index, accept records of another epoch |
| Calibration | Every criterion reported per cell | `benchmark:visual-assertion` (a measurement gate, not a deterministic test) writes per-cell trials, passes, failures, the bound and observe usefulness |

## Work breakdown

| Item | Title | Depends on |
|---|---|---|
| N6.1 | Owner ratification of VA-0 to VA-16 (as amended) | — |
| N6.2 | **Done 2026-10-22.** Pure `decideVisualAssertion`: verdicts, conditions, geometry, commitment compare; `verify:visual-assertion` | N6.1 |
| N6.3 | `VisualBaselineStore`: epoch tokens, signed indexes, commitment records, key and failure modes; the flow-only pre-write option on `JsonProfileStore` and the invalidate-first hooks; **the mandatory cross-process gate**; `verify:visual-baseline-store`, `verify:visual-baseline-integrity`, `verify:visual-baseline-lifecycle`, `verify:visual-baseline-cross-process` | N6.1 |
| N6.4 | `assertVisual` step, validator, VA-15 capture option, runner adapter (fourth edge), both outcome matrices and classes, the packaged enforce-unavailable rule, grant gate, candidates, random-generator exclusion, fixtures; `verify:visual-assertion-runtime`, `verify:visual-assertion-grants`, `verify:visual-isolation` | N6.2, N6.3 |
| N6.6 | Calibration harness in the main process of the non-packaged acceptance build, and experimental grant issuance (VA-16); `benchmark:visual-assertion` | N6.4 |
| N6.5 | Candidate preview and approval, reset action, Designer node (observe only in packaged mode); `verify:visual-assertion-candidates`, `verify:visual-assertion-gui` | N6.4, N6.6 |
| N6.7 | Report block with both classes and reasons, sanitizer, drawer section; `verify:visual-assertion-report` | N6.4, N6.6 |
| N6.9 | Import over an existing flow requires `WORKFLOW_EDIT`, race-safe (VA-11); `verify:flow-import-authorization` | N6.1 |
| N6.8 | Independent QC and security review, closure | N6.5, N6.6, N6.7, N6.9 |
| `awkit-vra.16` | **Not N6:** future milestone, production qualification and enforcement; needs its own owner decision | The N6 epic (closure includes N6.9) |

## Completion criteria

1. VA-0 to VA-16, as amended, explicitly ratified and recorded in DECISIONS.
2. N6.2 to N6.7 and N6.9 closed with every gate in the acceptance table green and its mutants red.
3. Packaged production delivers **observe-only** visual assertions. Every packaged enforce request fails closed
   with the explicit reason, and the packaged Designer offers no enforce option.
4. Enforcement exists only as an experimental capability of the non-packaged acceptance build. Grants are issued
   only for cells meeting VA-12, and unqualified cells are documented observe-only.
5. N6's closure does not claim production enforcement. `awkit-vra.16` stays open.
6. Flows without the step are byte-identical in outcome and report.
7. Independent QC and security review APPROVED.
8. State docs updated and the dashboard reads "Sources agree".

## Rollback and disable

Flag `off`: no capture; observe steps inert; enforce steps **fail** `visual-unverified/disabled` (in the packaged build
`enforce-unavailable-in-production`), so disabling is visible. Authors who want to run without enforcement switch steps to observe (their approvals are kept, since `mode`
is not in the digest). *Reset visual baselines* purges everything, rotates the key and increments the key generation.

## Risks (remaining)

| Risk | Status |
|---|---|
| Enforcement only reachable in a non-packaged acceptance build on the owner's machine in N6 (VA-16) | Intended staged scope; production enforcement is the future milestone `awkit-vra.16` |
| Flows authored with enforce in the acceptance build fail when run in the packaged app | Intended fail-closed behavior, explicit reason; authors switch the step to observe (approval kept) |
| N6.3 changes the shared `JsonProfileStore` (a new optional pre-write option) | Flow-only; other stores unaffected and covered by the lifecycle verifier |
| Two processes (packaged and dev builds) write the shared flows folder and epoch tokens; the folder lane is process-local | Open: mandatory N6.3 cross-process gate with cases X1–X8 |
| Quarantine invalidation never takes the folder lane (it is reached both inside and outside it) | Fail-safe: the flow is absent until a create, import or update, each of which invalidates |
| Approvals made in a dev build do not carry to the packaged build, or back | Intended (build-mode separation) |
| Restoring an old epoch token before the sweep removes leftovers; deleting the key-state marker | Same-user residuals |
| Unkeyed font, GPU or driver change gives a false `visual-mismatch` in a qualified cell | Reduced (30-day expiry, environment binding); not eliminated |
| Calibration trials not independent | Stated assumption; three sessions required |
| Same-user forgery, replay or rollback; consistent folder restore; clock rollback | Accepted and stated |
| Guessed byte-exact rendering confirmed by a same-user attacker | Stated |
| CSS box, conditions and approval metadata stored in clear | Accepted, low sensitivity |
| A `WORKFLOW_CREATE`-only user can import over a flow today (pre-existing) | Closed by N6.9 before N6 closure; a security dependency of `awkit-vra.16` |
| Enforce-mode flows fail where the feature is off or the cell is unqualified | Intended fail-closed behavior |
| Approval preview exposes page pixels to an authorized user | Permission, fresh re-auth, audit, memory only, 30 minutes |

## Exact next task

N6.1 is ratified and closed, and N6.2 is done (2026-10-22). Two items are now dependency-ready:

- **N6.3** `VisualBaselineStore`, including the mandatory cross-process gate. It is the critical path, because N6.4
  needs both N6.2 and N6.3.
- **N6.9** import authorization. It is independent, and N6.8 needs it.

N6.4 to N6.8 stay blocked by their dependencies. `awkit-vra.16` stays open.
