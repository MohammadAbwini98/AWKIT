# N6 — Visual Assertions

Status: **PLANNED, planning only; revised for an independent review, for the owner's N6.1 AMEND decision, and for
three focused review rounds of those amendments (2026-10-21).** Contracts `awkit-vra-n6-plan-1021` (plan),
`awkit-vra-n6-plan-review-1021` (first review) and `awkit-vra-n6-amend-1021` (owner amendments and their focused
review). The owner accepted VA-1, VA-2, VA-3, VA-7, VA-10 and VA-15 and amended the rest; **N6.1 is not approved**.
VA-0 to VA-16 below are amended proposals awaiting explicit ratification; VA-2's text changed as a consequence of A1
and VA-16 is new, so both need the owner's confirmation. Nothing here authorizes implementation, a schema change, a
new `src/visual` edge, a dependency, a UI component or any runtime behavior.

Baseline: `main` at `594f5ea7` (2026-10-21). Acceptance environment: the owner-approved Windows 11 ARM64 Parallels
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

## Objective

Let a flow author add a **visual assertion** step: "this element should still look the way I approved it". On each run
the step captures the element through the protected-guarded N0 capture and checks it against an approved baseline
recorded under **proven, equal conditions**.

Rules: a visual assertion may only report a **mismatch** when the difference is proven; an **enforced** assertion
passes only when equality is proven in a qualified, currently valid environment; every other enforced outcome
**fails closed** as *unverified*. Observe mode never changes a step outcome.

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
run-produced pending candidates approved by a person; environment-bound grants issued by the calibration harness; a
fourth `src/visual` edge; a codes-only report block and drawer section; a Designer node; calibration and verifiers.

**Non-goals:** viewport, page or region assertions; masks; diff images; tolerance passes; auto-updated baselines;
persisted image bytes, grids, dHash or raw digests; baseline export; an in-app machine qualification (VA-16); OCR,
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
   8. enforcement gate (step mode, flag, cell grant valid for this environment) → step status (outcome matrix)
   9. eligible no-baseline / binding-changed / other-conditions → pending candidate (memory only)
  10. codes-only record ──► InstanceReport.visualAssertions (sanitized) ──► drawer section
Flag off: no capture, no candidate; observe steps inert, enforce steps fail unverified/disabled.
Flow store, new flow-only pre-write option, inside the flow folder lane, BEFORE the flow write (no key needed):
   invalidate the flow = new random epoch token + delete its indexes and records (create, clone, import, Recorder
   save, delete, id rename, update over a missing file), or delete the index and records of removed/changed
   assertVisual steps (update, updateWith). Quarantine invalidates without taking the lane. Store, key and grants
   are separated by app mode (packaged / dev).
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
  that the assertions accept. **VA-16:** in N6 the harness runs inside the main process of a **non-packaged
  acceptance build** on the owner's machine, and enforcement is reachable only in that build (lab-only). The
  packaged app ships no harness, and its enforcement gate **never reads grants**, so its enforce-mode steps fail
  `visual-unverified/cell-not-qualified`. An in-app *Qualify this machine* action is out of scope and needs its own
  decision.
- **Build-mode separation.** Packaged and non-packaged builds share one runtime root (`appPaths.ts:9-11`) and one
  `secrets.json` (`secretStore.ts:30`). N6 therefore keys its folder (`visual-baselines/<mode>/`), its master-key
  secret and every grant by `getAppMode()` (`appPaths.ts:50-56`), and a grant binds the mode. Neither build reads
  the other's files or key, so neither sees the other's key as lost, and approvals do not carry between builds.
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

## Verdict and status vocabulary (proposed; fixed in N6.2)

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

**Enforcement status codes** (set by the gate, not by the policy): `disabled` (flag `off`), `enforce-not-enabled`
(flag `observe`), `cell-not-qualified`, `grant-invalidated`, `grant-expired`.

**N0 mapping** (`errors.ts:9-40`): `TARGET_STALE`, `CAPTURE_STALE` → `capture-stale`; `TARGET_NOT_UNIQUE` →
`target-not-unique`; `TARGET_OFFSCREEN` → `target-offscreen`; `INVALID_BOUNDS` → `target-hidden`;
`FRAME_MAPPING_FAILED`, `CAPTURE_UNAVAILABLE`, `FINGERPRINT_FAILED`, `IMAGE_DECODE_FAILED`, unknown →
`capture-unavailable`; `UNSUPPORTED_FINGERPRINT_VERSION` → `baseline-unreadable`; `PAGE_CLOSED` → `page-closed`;
`BUDGET_EXHAUSTED` → `budget-exhausted`; `CANCELLED` → `cancelled`; `PROTECTED_SURFACE` → `protected-surface`.

## Step outcome matrix (VA-0, VA-8, VA-9; owner amendment A1)

Two failure classes, recorded separately in the step result, the report and the run summary: **`visual-mismatch`**
(a proven difference) and **`visual-unverified`** (enforcement requested but equality not proven).

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
  value never returns to a previous one, and the records of an old epoch are deleted with it. At N6's first start,
  inside the flow folder lane, every existing flow gets a token, so no flow is ever without one.
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
| Import (`flows:import`, `WORKFLOW_CREATE`) | **Keeps the id, overwrites** an existing flow (`ProfileStore.ts:119-123`) | Invalidate the flow, even for a re-import of identical content |
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

**Authorization residual.** Import needs only `WORKFLOW_CREATE` (`flow.ipc.ts:50`), so a user who may create but not
edit can import over an existing flow; under N6 that also invalidates its approvals and makes its enforced
assertions fail `unverified`. That import can overwrite a flow without `WORKFLOW_EDIT` is a **pre-existing**
authorization gap, recommended for separate tracking.

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

**Key:** one 256-bit master key per Windows user, created at the first approval or the first grant issuance,
whichever comes first, stored through the existing
DPAPI-backed `secretStore` behind `getSecretStorageCapability()`; `K_mac` and `K_commit` derived with HKDF; a key
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
| Packaged build meets non-packaged files, key or grants | Never read: folder, key and grants are separated by app mode, and the packaged gate reads no grants |
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
| Export / import | Not exported; import invalidates |
| Recorder | Does not record `assertVisual`; its save invalidates (create) |
| Workflow builder | No change |
| Random generator (`src/testing/random`) | Never generates `assertVisual` |
| Fragments | `assertVisual` rejected in fragments |
| Older builds | Validator refuses the unknown type; dispatch throws |
| Machine qualification in the packaged app | Out of scope (VA-16) |

## Performance budgets (VA-9)

One capture per assertion per run (non-retryable), 2000 ms deadline, one read-only state read, two HMACs.

## Accessibility and UI

Text-only results distinguishing *mismatch* from *unverified*; the cell's grant status in the Designer; a live region
for approval; focus management; reduced motion; Hologram tokens; the preview has a text alternative and states it is
not stored.

## Owner decisions (amended proposals; N6.1 not approved)

| ID | Decision | Owner status | Amended proposal |
|---|---|---|---|
| VA-0 | Authority | **Amended (A1)** | Only enforce mode can change an outcome: passes only on proven equality in a qualified, valid cell; proven difference fails `visual-mismatch`; every other enforce outcome fails `visual-unverified`. Observe never changes an outcome. Amends VR-0 by one execution-affecting result. |
| VA-1 | Isolation | Accepted | Fourth allow-listed edge, lazy, public index only; four-edge isolation verifier. |
| VA-2 | Step shape | **Accepted; text changed by A1 — reconfirm** | New non-retryable `assertVisual` step type with `mode`; the `onInconclusive` option the owner accepted is removed by A1. |
| VA-3 | Scope | Accepted | One element resolved to exactly one visible element. |
| VA-4 | Conditions | **Amended (A2)** | Conditions key and geometry/state rules; the environment fields also bind grants. |
| VA-5 | Store | **Amended (A3, A4)** | Separate store: per-flow unsigned random epoch tokens, signed per-step indexes, commitment records; FD-4 stands; a flow-only pre-write option on the shared store invalidates first, without the key, inside the flow folder lane on every writer (quarantine outside it). |
| VA-6 | Retention and privacy | **Amended (A4)** | Length-prefixed keyed equality commitment only; residuals as stated. |
| VA-7 | Pass rule | Accepted | Exact pixel equality only. |
| VA-8 | Outcomes | **Amended (A1)** | Outcome matrix; two failure classes; `onFailure` unchanged; no `onInconclusive`. |
| VA-9 | Enablement | **Amended (A1)** | Flag `off` (default, no capture) / `observe` / `enforce`; enforce steps fail `visual-unverified` unless the flag is `enforce` and the cell is qualified; 2000 ms. |
| VA-10 | Approval permission | Accepted | `WORKFLOW_EDIT` + `requireFreshReauth`, audited. |
| VA-11 | Export | **Amended (A3)** | Not exported; create, import, clone, quarantine, delete and id rename invalidate. |
| VA-12 | Calibration and grants | **Amended (A2)** | Per-cell signed grants bound to the environment and key generation, 30-day expiry, issued only after ≥ 300 passed and zero failed trials over three sessions; independence an assumption; unqualified cells observe-only, enforce fails closed. |
| VA-13 | Baseline source | **Amended (A5)** | Bound (incl. epoch and key generation), single-use, 30-minute, memory-only candidates; permission and fresh re-auth before preview and approval; any authorized approver, both users recorded. |
| VA-14 | Integrity | **Amended (A6)** | DPAPI-held master key created at the first approval or grant, HKDF keys, key generation in an unsigned key-state marker cleared only by reset, signed index/record/grant, unsigned epoch token with a start-up sweep, store, key and grants separated by app mode, the failure table, explicit reset, stated limits. |
| VA-15 | Capture policy | Accepted | `animations: "disabled"`, `caret: "hide"`, `contextPaddingCss: 0`, no pointer or focus change. |
| VA-16 | Grant issuance | **New — needs decision** | In N6 grants come only from the calibration harness running inside the main process of a non-packaged acceptance build on the owner's machine (lab-only enforce); store, key and grants are separated by app mode and the packaged gate never reads grants, so packaged enforce steps fail `visual-unverified` and observe is the only useful mode there; an in-app qualification action needs its own decision. Alternative: ship an in-app, permission-gated, re-authenticated qualification (about 300 launches per cell). |

## Acceptance criteria and deterministic verification

| Area | Acceptance criterion | Deterministic verification (fixed inputs, injected clock, mutants required red) |
|---|---|---|
| A1 | Each outcome-matrix row gives exactly the listed status and class; no enforce path passes without a valid grant and proven equality; flag `off` captures nothing; `onFailure` routing unchanged | `verify:visual-assertion-runtime` table-driven per row and per `onFailure` action; mutants: drop the grant check, map `inconclusive` to pass, merge the classes, capture with flag `off` |
| A2 | Grants bind every listed field and the key generation, expire at 30 days, come only from a qualifying harness run; invalid grant fails closed | `verify:visual-assertion-grants`: each bound field changed, expiry, tamper, hand-written grant, non-qualifying evidence (incl. all-`inconclusive` trials), key-generation change, no issuance path in the packaged build, a dev-mode grant presented to the packaged gate and a packaged-mode file presented to the dev store (both refused); mutants: read grants in packaged mode, drop the mode from the grant or the folder, skip a field, ignore expiry, accept unsigned, count `inconclusive` as passed |
| A3 | No approval survives create, clone, import (incl. identical re-import), quarantine, delete, id rename, step removal, step-content change, undoMigration restore, AI revert, locator upgrade, fragment instantiate; update over a missing file, a corrupt file met during `create`, `updateWith` or `list()`; a refused duplicate-id create leaves approvals intact; no callback deadlocks; promotion observe→enforce keeps the approval; an approval racing an update never lands stale; a crash between invalidation and write, or part-way through the deletions, never keeps or revives a stale approval; keystore-down import, update and `updateWith` still invalidate or purge; other stores are unaffected by the option | `verify:visual-baseline-lifecycle` on a real `JsonProfileStore` and IPC handlers with injected crash points and a held lane; mutants: remove each hook, run the hook after the write, run the create hook before the existence check, drop the before-delete call on the rename half of `update`, acquire the lane from the on-quarantine callback, run the approval outside the lane, require the key to invalidate or purge, delete records before writing the token, include `mode` in the digest |
| A4 | Files hold no grid, dHash, raw digest or image; equality exact; commitments unlinkable; encoding unambiguous | `verify:visual-baseline-store`: byte scan, one-pixel-change fixture, identical images on two steps, ambiguous-id pair (`ab`+`c` vs `a`+`bc`); mutants: store the raw digest, drop a key part, concatenate without lengths |
| A5 | Preview and approval need permission and fresh re-auth; expired, consumed, stale (epoch token, content, key generation, deleted flow or step) rejected, including a never-approved flow re-imported with identical content between run and approval; a candidate from before a reset rejected; never persisted | `verify:visual-assertion-candidates` with an injected clock; mutants: skip re-auth, skip consumption, skip each staleness field, skip the key-generation check, treat a missing token as matching any token |
| A6 | Each row of the failure table behaves as listed; no plaintext or regenerated key | `verify:visual-baseline-integrity` with the injected unavailable `SecretStorageCapability` (non-packaged root): unavailable keystore, first use vs key lost (incl. key lost after every signed file was invalidated), marker deleted by hand, first grant before any approval, missing/corrupt/changed/restored epoch token, leftovers after a crash removed by the start-up sweep, tokens created for pre-existing flows at first start, corrupt index, missing record, tampered, moved, older restored record, unreadable baseline replaced by an approved candidate, reset; mutants: regenerate the key when the marker exists, decide first use from remaining files, skip the sweep, treat missing record as `no-baseline`, rebuild the index, accept records of another epoch |
| Calibration | Every criterion reported per cell | `benchmark:visual-assertion` (a measurement gate, not a deterministic test) writes per-cell trials, passes, failures, the bound and observe usefulness |

## Work breakdown

| Item | Title | Depends on |
|---|---|---|
| N6.1 | Owner ratification of VA-0 to VA-16 (as amended) | — |
| N6.2 | Pure `decideVisualAssertion`: verdicts, conditions, geometry, commitment compare; `verify:visual-assertion` | N6.1 |
| N6.3 | `VisualBaselineStore`: epoch tokens, signed indexes, commitment records, key and failure modes; the flow-only pre-write option on `JsonProfileStore` and the invalidate-first hooks; `verify:visual-baseline-store`, `verify:visual-baseline-integrity`, `verify:visual-baseline-lifecycle` | N6.1 |
| N6.4 | `assertVisual` step, validator, VA-15 capture option, runner adapter (fourth edge), outcome matrix and classes, grant gate, candidates, random-generator exclusion, fixtures; `verify:visual-assertion-runtime`, `verify:visual-assertion-grants`, `verify:visual-isolation` | N6.2, N6.3 |
| N6.6 | Calibration harness in the main process of a non-packaged acceptance build, and grant issuance (lab-only per VA-16); `benchmark:visual-assertion` | N6.4 |
| N6.5 | Candidate preview and approval, reset action, Designer node; `verify:visual-assertion-candidates`, `verify:visual-assertion-gui` | N6.4, N6.6 |
| N6.7 | Report block with both classes, sanitizer, drawer section; `verify:visual-assertion-report` | N6.4, N6.6 |
| N6.8 | Independent QC and security review, closure | N6.5, N6.6, N6.7 |

## Completion criteria

1. VA-0 to VA-16, as amended, explicitly ratified and recorded in DECISIONS.
2. N6.2 to N6.7 closed with every gate in the acceptance table green and its mutants red.
3. Grants issued only for cells meeting VA-12; unqualified cells documented observe-only; VA-16 scope respected.
4. Flows without the step are byte-identical in outcome and report.
5. Independent QC and security review APPROVED.
6. State docs updated and the dashboard reads "Sources agree".

## Rollback and disable

Flag `off`: no capture; observe steps inert; enforce steps **fail** `visual-unverified/disabled`, so disabling is
visible. Authors who want to run without enforcement switch steps to observe (their approvals are kept, since `mode`
is not in the digest). *Reset visual baselines* purges everything, rotates the key and increments the key generation.

## Risks (remaining)

| Risk | Status |
|---|---|
| Enforcement only reachable in a non-packaged acceptance build on the owner's machine in N6 (VA-16) | Intended; the packaged app stays observe-only until a separate decision |
| N6.3 changes the shared `JsonProfileStore` (a new optional pre-write option) | Flow-only; other stores unaffected and covered by the lifecycle verifier |
| Quarantine invalidation never takes the folder lane (it is reached both inside and outside it) | Fail-safe: the flow is absent until a create, import or update, each of which invalidates |
| Approvals made in a dev build do not carry to the packaged build, or back | Intended (build-mode separation) |
| Restoring an old epoch token before the sweep removes leftovers; deleting the key-state marker | Same-user residuals |
| Unkeyed font, GPU or driver change gives a false `visual-mismatch` in a qualified cell | Reduced (30-day expiry, environment binding); not eliminated |
| Calibration trials not independent | Stated assumption; three sessions required |
| Same-user forgery, replay or rollback; consistent folder restore; clock rollback | Accepted and stated |
| Guessed byte-exact rendering confirmed by a same-user attacker | Stated |
| CSS box, conditions and approval metadata stored in clear | Accepted, low sensitivity |
| A `WORKFLOW_CREATE`-only user can import over a flow and invalidate its approvals | Stated; the underlying import-overwrite gap is pre-existing and recommended for separate tracking |
| Enforce-mode flows fail where the feature is off or the cell is unqualified | Intended fail-closed behavior |
| Approval preview exposes page pixels to an authorized user | Permission, fresh re-auth, audit, memory only, 30 minutes |

## Exact next task

**Stop at the N6.1 owner-approval gate.** The owner ratifies, or further amends, VA-0 to VA-16, including the
reconfirmation of VA-2's changed text and the new VA-16. N6.2 and N6.3 must not begin until ratification is recorded.
