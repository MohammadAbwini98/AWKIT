# N6 — Visual Assertions

Status: **PLANNED 2026-10-21, planning only; revised the same day for an independent review.** Contracts
`awkit-vra-n6-plan-1021` (plan) and `awkit-vra-n6-plan-review-1021` (review corrections). Owner decisions VA-0 to
VA-15 below are **proposed and not ratified**. Nothing in this document authorizes implementation, a schema change, a
new `src/visual` edge, a dependency, a UI component or any runtime behavior until the owner approves the decisions.

Baseline: `main` at `8121991d` (2026-10-21). Acceptance environment: the owner-approved Windows 11 ARM64 Parallels
machine (DECISIONS 2026-10-19); that is a waiver of a separate clean-VM or x64 run, not a claim that one was executed.

## Review corrections (2026-10-21)

An independent, fresh-context QC review returned **CHANGES REQUIRED** with 15 findings. Every one is accepted and
applied here; each was re-checked against the source before applying.

| # | Severity | Finding | Change |
|---|---|---|---|
| 1 | Medium | An unknown `assertionType` is already rejected by the validator (`AssertionStepContract.ts:154`, severity error); only the executor falls back to text | *Today's baseline* and VA-2 restated |
| 2 | Medium | There is no `FLOW_EDIT`; the permission is `WORKFLOW_EDIT` (`Permissions.ts:30`) | VA-10 names `WORKFLOW_EDIT` plus the existing `requireFreshReauth` (`app/main/security/sessionContext.ts:91`) |
| 3 | Low | N0 records only `isMainFrame` and `depth`, not the frame origin | *Frames* corrected |
| 4 | Low | N3.2's cross-launch losses are all headless DPR 1 (6/12 baseline, 5/12 drift); every other cell is 12/12 | *Measured facts* restated |
| 5 | Low | A new store breaks FD-4 ("evidence persisted in one place", `visualEvidence.ts:9`) | VA-5 now amends FD-4 explicitly |
| 6 | High | Approval had no way to get a live page in the production conditions | New **VA-13**, approval from an observe run's pending candidate |
| 7 | High | Position, sub-pixel offset, clipping, hover/focus, animation, browser build, OS build, locale and timezone were missing from the conditions | Envelope extended, new codes, new **VA-15** capture policy, residuals stated |
| 8 | High | Enforce with `onInconclusive: pass` is silently bypassed by deleting baselines or a browser update; records had no integrity | Enforce defaults to `fail`; run-level *unverified* count; new **VA-14** integrity |
| 9 | Medium | Observe vs `onInconclusive: fail` and flag-off outcomes contradicted each other; `disabled` was missing | *Step outcome matrix* added; `disabled` added |
| 10 | Medium | An all-cells calibration criterion would deny enforce everywhere because of headless DPR 1 | VA-12 grants enforce **per cell**; N6.5 and N6.7 now follow N6.6; observe-usefulness metric added |
| 11 | Medium | Retries, `onFailure`, loops, branches and child flows were unspecified | `assertVisual` is non-retryable; *Execution semantics* added |
| 12 | Medium | Keying on the binding digest orphans baselines; copy, rename and id reuse were unspecified | Per-step index, orphan and retention policy |
| 13 | Medium | The default 24 px context crop and the 16x16 grids store surrounding content; the grid is a thumbnail; the digest confirms guesses | No context crop; grid stated as a thumbnail; displayed-value exclusion in VA-6 |
| 14 | Low | Several N0 codes had no mapping | Full mapping table |
| 15 | Low | Per-user storage and the Recorder, workflow builder, random generator and fragments were not addressed | *Compatibility and out of scope* added |

## Objective

Let a flow author add a **visual assertion** step: "this element should still look the way I approved it". On each run
the step captures the element through the protected-guarded N0 capture, compares it with an author-approved baseline
recorded under **proven, equal conditions**, and produces a step result.

N6 is the first Phase N feature whose output is meant to change a run, so its central rule is that a visual assertion
may only fail a step when the difference is **proven**. Everything it cannot prove is `inconclusive`, never a silent
pass and never a guessed failure, and an enforced assertion never turns an unproven state into a pass by default.

## User-visible purpose

- A Flow Designer node, *Visual assertion*, on an element target, with a baseline status per conditions
  (`none`, `pending candidate`, `approved`, `approved for other conditions`).
- An *Approve* action on a pending candidate from an observe run (VA-13).
- A run result per assertion: `passed`, `failed` or `inconclusive`, with a fixed, image-free reason code, in the step
  row and the report drawer, and a run-level count of *unverified* enforced assertions.

## Distinct from N5, N7, N9 and N10

| Question | N5 Visual Failure Diagnosis | N6 Visual Assertions | N7 OCR | N9 Screenshot State | N10 Vision model |
|---|---|---|---|---|---|
| When does it run? | After a step finally fails | As an authored step, every run | On demand | Its own | Only with an approved model |
| Can it change a run? | Never | **Yes, when enforced and proven, per calibrated cell** | Its own decision | Its own decision | Never without approval |
| Output | Observation codes | A step result | Text | A state label | Model claims |
| Reference | N2/N4 store, read-only | **Its own approved baseline** | — | — | — |
| Needs a model? | No | No | No | No | Yes |

N6 never reads text from pixels (N7), never classifies a screen state (N9), never uses a model (N10), and never
writes to, reads from or reinterprets the N2/N4 reference store.

## Today's baseline (as built, `8121991d`)

| Capability | Where | What N6 can rely on |
|---|---|---|
| Guarded element capture | `captureElement` (`src/visual/internal/captureCore.ts`) | Strict protected window, in-memory pixels, fixed refusal codes (`awkit-3gtj`, `awkit-2het`); a default 24 px context crop (`:120`, `:428`); partly visible targets cropped with `wasClipped`, never scrolled (`:383-385`); `page.screenshot` without `animations` or `caret` options |
| Fingerprint | `fingerprintVisualImage` (`awkit-vfp-1`) | Size, a **16x16** luma grid and edge grid (`VISUAL_FINGERPRINT_GRID = 16`), dHash, `contentDigest` |
| Comparison | `compareVisualFingerprints` (`src/visual/compare.ts`) | `identical` (byte equality), distances, an **advisory** score with **no threshold and no decision** |
| Evidence | `buildVisualEvidence` (v1, ≤ 4096 bytes, image-free) | Persisted in one place since FD-4 (`visualEvidence.ts:9`) |
| Frame info | `VisualFrameInfo` | `isMainFrame` and `depth` only |
| Assertions | `assertText` / `assertVisible`, `executeAssertion` (`StepExecutor.ts:2863`) | Text, value, count, url, attribute, storage |
| Unknown `assertionType` | Validator: `AssertionStepContract.ts:154` (error). Executor: falls back to text (`StepExecutor.ts:2900`) | Refused by the validator; an executor path that skips validation would run the wrong check |
| Unknown step type | Validator error (`FlowValidator.ts:573`); executor throws `Unsupported step type` (`StepExecutor.ts:2297`) | Fails closed at both layers |
| Permissions and re-auth | `WORKFLOW_EDIT` (`Permissions.ts:30`); `requireFreshReauth` via `sensitive` (`sessionContext.ts:91`) | Existing primitives for approval |

**Measured facts that constrain N6.**

- **Headed versus headless is never byte-identical.** N4.5: headless recall of a headed reference 0/9.
- **Headless DPR 1 re-renders across launches.** N3.2: cross-launch, every miss was headless DPR 1 (6 of 12 lost on
  baseline, 5 of 12 under drift); every other cell 12/12; same-launch 72/72. Approval and runs are always different
  launches.
- **Headless bytes depend on position.** N3.2: identical icons rendered with position-dependent bytes.
- **No similarity threshold is calibrated.** N2.3 found no separation between look-alikes and real contradictions.
- **Stored N2/N4 conditions are partly unprovable** (N5 provenance audit); VD-11 stays deferred for that store.

**Consequence.** Byte identity is a usable pass rule in some cells (headed, headless DPR > 1) and not in others
(headless DPR 1). N6 therefore keys baselines by conditions, grants enforcement **per cell** after calibration, and
stays observe-only where calibration fails.

## Scope

- One new step type, an element-scoped visual assertion, observe and enforce modes.
- A pure verdict policy over two fingerprints, two condition envelopes and two geometry records.
- A new, separate, integrity-protected baseline store with a per-step index.
- Baselines approved by a person from a pending candidate an observe run produced in the production conditions.
- A runner adapter (a fourth allow-listed `src/visual` edge), a codes-only report block, a text-only drawer section,
  a Designer node, a calibration lab and its verifiers.

## Non-goals

- Viewport or full-page assertions, regions, masks, diff images.
- Tolerance-based passes (VA-7); only byte identity passes until a separate decision after N6.6.
- Auto-updating baselines from runs, or approving without a person.
- Persisting any image bytes (VA-6); the approval preview is transient (VA-13).
- Any change to locator resolution, recovery, retries of other steps, fusion, agreement, diagnosis or the N2/N4 store.
- OCR, state labels, model calls.

## Owners

| Area | Owner | Files (expected) |
|---|---|---|
| Pure verdict policy and vocabulary | software, with qa | new `src/visual/assertion/decideVisualAssertion.ts`, exported through `src/visual/index.ts` |
| Baseline store, index, integrity | data-persistence, security (review) | new `src/runner/visualAssertion/VisualBaselineStore.ts` (`visual-baselines/`) |
| Capture policy option (VA-15) | software, with qa | `src/visual/internal/captureCore.ts` (an option used only by N6) |
| Step type, validator, runner adapter, budget | backend | `src/profiles/FlowProfile.ts`, `src/validation/FlowValidator.ts`, `StepExecutor.ts` (dispatch only), new `src/runner/visualAssertion/VisualAssertionStep.ts` |
| Pending candidates and approval channel | backend, security (review) | an IPC handler, preload entry, main-process candidate holder |
| Designer node and drawer section | frontend, with ui-designer authority | Flow Designer node config, report drawer, `global.css` tokens |
| Report record and sanitizer | data-persistence | `src/reports/ExecutionReport.ts`, a sanitizer beside `visualDiagnosisRecord.ts` |
| Mock-site, verifiers, mutations, calibration | qa, recorder-playwright | `mock-site/`, `scripts/verify-visual-assertion*.mts`, `scripts/benchmark-visual-assertion.mts` |
| Independent review | qc, security | — |
| Beads, state docs, dashboard | project-state | `.beads/`, `docs/ai/`, `scripts/verify-roadmap-dashboard.mjs` |

## Architecture and data flow

```
Run (observe or enforce): StepExecutor dispatch ──► VisualAssertionStep (fourth src/visual edge, lazy)
   1. eligibility (step type, protected/handoff/sensitive, flag, cell)      → refusal codes, no capture
   2. resolve the locator to exactly one visible element (DOM, read-only)   → target codes
   3. read-only state: :hover / :focus on the target, element CSS box        → geometry and state facts
   4. captureElement (guarded, VA-15 policy, no context crop, 2000 ms)       → capture refusal codes
   5. current envelope (below)
   6. baseline read (index, then record; integrity-checked)                  → baseline facts
   7. decideVisualAssertion(...)  ── pure ──► passed | failed | inconclusive + code
   8. step status from the outcome matrix
   9. on no-baseline / baseline-other-conditions in an eligible run: keep a pending candidate (VA-13)
  10. codes-only record ──► InstanceReport.visualAssertions (sanitized) ──► drawer section
Approve (person, WORKFLOW_EDIT + fresh re-auth, audited) ──► pending candidate ──► signed baseline record
```

No pixels leave step 4 except the transient approval preview (VA-13). The record carries codes, versions and the
conditions comparison, never an image, crop, digest, selector, URL or page text.

## Conditions envelope and geometry (VA-4)

**Conditions key fields** (a baseline answers only for its own key):

| Field | Source |
|---|---|
| `renderMode` | the runner's launch options |
| `browserVersion` (full) | `browser.version()` |
| `appVersion` | the application version |
| `osBuild` | `os.release()` |
| `devicePixelRatio`, `cssWidth`, `cssHeight` | N0 viewport metrics |
| `colorScheme`, `forcedColors`, `reducedMotion` | `matchMedia` in the target's frame |
| `locale`, `timeZone` | the browser context options |
| `frameDepth`, `isMainFrame` | N0 frame info |
| `capturePolicy` | the VA-15 policy version |
| `fingerprintVersion`, `evidenceVersion` | constants |

**Geometry and state facts** (compared, not keyed):

| Fact | Rule |
|---|---|
| Target CSS box `x`, `y`, `width`, `height` (exact, including fractions) | `x`/`y` differ → `inconclusive/position-changed`; size differs with position equal → `failed/size-differs-from-baseline` |
| `wasClipped` on either side | `inconclusive/target-clipped` |
| `:hover` or `:focus` on the target | differs from the baseline → `inconclusive/interaction-state-changed` |

**Unprovable residuals, stated.** Installed fonts, the GPU or software raster path and driver updates on the same
machine are not keyed and cannot be proven. A change there under otherwise equal conditions can produce a false
`failed`. Baselines are per machine and per Windows user (they live under `%LOCALAPPDATA%`), which bounds this, and the
calibration measures it per cell but cannot rule it out.

## Verdict vocabulary (proposed; fixed in N6.2, pruned by N6.6)

| Verdict | Code | When |
|---|---|---|
| `passed` | `identical-to-baseline` | Conditions `equal-proven`, geometry and state equal, digests equal |
| `failed` | `differs-from-baseline` | `equal-proven`, geometry and state equal, digests differ |
| `failed` | `size-differs-from-baseline` | `equal-proven`, position equal, CSS size differs |
| `inconclusive` | `disabled` | `AWKIT_VISUAL_ASSERTIONS=off` |
| `inconclusive` | `enforce-unavailable` | Enforce requested in a cell N6.6 did not grant; evaluated as observe |
| `inconclusive` | `no-baseline` | No approved baseline for this step |
| `inconclusive` | `baseline-other-conditions` | Baselines exist, none for the current conditions key |
| `inconclusive` | `binding-changed` | The index holds baselines only for another binding digest |
| `inconclusive` | `baseline-unreadable` | Corrupt, version-mismatched, oversized or **integrity-failed** record |
| `inconclusive` | `position-changed` / `target-clipped` / `interaction-state-changed` | Geometry and state rules above |
| `inconclusive` | `target-not-found` / `target-not-unique` / `target-hidden` / `target-offscreen` | DOM resolution facts |
| `inconclusive` | `protected-surface` / `handoff-active` / `sensitive-step` | Refused before any capture |
| `inconclusive` | `capture-stale` / `capture-unavailable` / `budget-exhausted` / `cancelled` / `page-closed` | N0 refusals (mapping below) |

**N0 code mapping** (every member of `VisualErrorCode`, `src/visual/errors.ts:9-40`): `TARGET_STALE` (the target
moved, resized or vanished during capture) and `CAPTURE_STALE` → `capture-stale`; `TARGET_NOT_UNIQUE` →
`target-not-unique`; `TARGET_OFFSCREEN` → `target-offscreen`; `INVALID_BOUNDS` → `target-hidden`;
`FRAME_MAPPING_FAILED`, `CAPTURE_UNAVAILABLE`, `FINGERPRINT_FAILED`, `IMAGE_DECODE_FAILED` and any unknown code →
`capture-unavailable`; `UNSUPPORTED_FINGERPRINT_VERSION` (a baseline from another fingerprint version) →
`baseline-unreadable`; `PAGE_CLOSED` → `page-closed`; `BUDGET_EXHAUSTED` → `budget-exhausted`; `CANCELLED` →
`cancelled`; `PROTECTED_SURFACE` → `protected-surface`.

`failed` is only reachable under `equal-proven` with equal geometry and state. No code claims uniqueness, identity of
anything other than the step's own target, or the cause of a difference.

## Step outcome matrix (VA-8)

| Flag | Mode (effective) | Verdict | Step status |
|---|---|---|---|
| `off` | any | `inconclusive/disabled` | **passed** (the step is inert; reported as disabled). Runs without the step are byte-identical; runs with it differ only by the disabled record |
| `observe` | observe | any | **passed**, always; the verdict is recorded |
| `enforce` | enforce (granted cell) | `passed` | passed |
| `enforce` | enforce (granted cell) | `failed` | **failed** (normal `onFailure` handling) |
| `enforce` | enforce (granted cell) | `inconclusive` | `onInconclusive`: default **fail**; `pass` must be chosen per step |
| `enforce` | not granted → observe | `inconclusive/enforce-unavailable` | passed, and counted *unverified* |

`onInconclusive` exists only in enforce. Every enforced assertion that did not pass (failed, or inconclusive under
`pass`) adds to a run-level *unverified enforced assertions* count shown in the report header.

## Execution semantics (finding 11)

- `assertVisual` is **non-retryable**: the validator rejects a `retry` on it, and the retry loop never re-runs it. A
  failure cannot be retried into a coincidental match.
- `onFailure` (`stop`, `continue`, `goToFailureEdge`, `manualHandoff`) applies unchanged to a `failed` step.
- Loops: every iteration evaluates against the same step's baseline; a target whose content changes per iteration
  will not pass, and authors are told so in the node help.
- Parallel branches assert on their own page. Child flows: the baseline key uses the child flow's own id and step id.
- Popups: the step asserts on the page its `pageAlias` names.

## Persistence (VA-5, VA-6, VA-14)

- A new folder `visual-baselines/` under the runtime root, **amending FD-4** (evidence in one place) to two places,
  each with one writer: the N2/N4 store (runtime refresh and Recorder save) and this store (approval only).
- **Index:** one file per `sha256(flowId, stepId)` listing the `(bindingDigest, conditionsKey)` pairs that have
  baselines. It is what makes `binding-changed` and `baseline-other-conditions` reachable.
- **Record:** one sidecar per `sha256(flowId, stepId, bindingDigest, conditionsKey)`: version, key parts, envelope,
  geometry and state facts, `VisualEvidence` v1 **without a context fingerprint**, approval metadata, and an
  integrity tag (VA-14). Atomic writes with the existing EPERM/EBUSY retry.
- **Lifecycle:** a flow copy gets a new `flowId` → `no-baseline`. A locator edit changes the binding digest →
  `binding-changed` until re-approved. A reused step id after delete → `binding-changed`. Deleting a flow or step
  removes its index and records. Old bindings' records are kept for 30 days then purged by a bounded maintenance pass.
- Never inside the FlowProfile or its export; the flow stays byte-identical.
- No image bytes persisted. The fingerprint's 16x16 luma and edge grids **are a coarse thumbnail** of the element, and
  the `contentDigest` lets someone confirm a guessed rendering; both are stated as accepted residuals in VA-6.

## Step shape (VA-2)

A new step type `assertVisual`. Both an unknown step type and an unknown `assertionType` are refused by today's
validator; the new type is still preferred because the executor's assertion path falls back to text for an unknown
kind (`StepExecutor.ts:2900`), while an unknown step type throws at dispatch as well (`:2297`), so any path that skips
validation still fails closed. Config: the element locator, `mode` (`observe` | `enforce`), `onInconclusive`
(enforce only, default `fail`). The validator requires an element locator, rejects `retry`, refuses protected-login,
value-bearing and sensitive targets, and rejects the step in fragments (see *Compatibility*).

## Security, privacy and the protected-auth boundary

- Capture through N0's `captureElement` only, inside the strict window, with `contextPaddingCss: 0`. Any protected
  refusal is `inconclusive/protected-surface`, never retried into a pass, and never a candidate.
- Protected-login step types, handed-off pages, value-bearing and masked targets, and sensitive steps are refused
  before capture, as in N4/N5.
- Baselines are integrity-tagged (VA-14); a record that fails its check is `baseline-unreadable`, so tampering cannot
  force a pass, and in enforce it fails by default.
- Approval needs `WORKFLOW_EDIT` and fresh re-authentication, is audited (flow, step, conditions key, user, time) and
  the renderer can only name a candidate id, never send evidence, a digest or a key.
- The approval preview is a transient, guarded PNG held in main-process memory only (VA-13).
- The report block is codes-only and passes a key-allowlist sanitizer.

## Headed and headless

Baselines are keyed per render mode, so headless runs need a headless candidate; VA-13's observe-run candidate is
taken in the run's own mode. Enforcement is granted per cell by N6.6; headless DPR 1 is expected to stay observe-only
given N3.2.

## Frames, popups and shadow roots

The target may be in a frame (N0 records depth and the main-frame flag) or an open shadow root (the locator resolves
it). A popup target is asserted on its own page. Closed shadow roots stay out of scope, as in N0.

## Compatibility and out of scope (finding 15)

| Area | N6 behavior |
|---|---|
| Storage location | Per Windows user, per machine (`%LOCALAPPDATA%`); other users and machines see `no-baseline` |
| Export / import | Not exported (VA-11); imported flows report `no-baseline` |
| Recorder | Does not record `assertVisual` in N6; authors add it in the Designer |
| Workflow builder | No change; it references flows, not steps |
| Random configuration generator (`src/testing/random`) | Must never generate `assertVisual`; an exclusion and a check are part of N6.4 |
| Fragments | `assertVisual` is rejected in fragments in N6, because instantiation creates new step ids with no baseline |
| Older builds | The validator refuses the unknown step type; dispatch throws if validation is skipped |

## Offline and AI independence

No network, model, service or new dependency. The verdict is a pure function. Flows without the step are untouched.

## Performance budgets (VA-9)

One element capture per assertion per run (non-retryable), bounded by 2000 ms inside the step timeout, plus one
read-only state read. The strict window already costs about p95 759 ms for a framed diagnosis (after `6ff6327`).
A deadline cut is `inconclusive/budget-exhausted`.

## Accessibility and UI

Text-only results, no colour-only status, a live region for approval, focus returns to the trigger, reduced motion,
Hologram tokens only. The approval preview has a text alternative stating what it shows and that it is not stored.
Proven by a GUI verifier in real Electron from the owner terminal.

## Owner decisions before implementation (proposed, not ratified)

### VA-0 — Authority boundary
- **Recommended:** a visual result may fail a step only as `failed` (proven, equal conditions, equal geometry and
  state) in enforce mode, in a cell N6.6 granted. Observe never changes a step outcome. This amends VR-0 by adding one
  execution-affecting result. Visual evidence still never drives a click, fill, selector, retry or recovery.
- **Alternatives:** observe-only forever; let the advisory score fail steps.
- **Consequence:** the widest authority Phase N has asked for, bounded per cell.

### VA-1 — Isolation amendment
- **Recommended:** a fourth allow-listed edge (`VisualAssertionStep`), lazy, public index only;
  `verify:visual-isolation` pins four edges plus a no-act and no-write scan of the adapter.

### VA-2 — Step shape
- **Recommended:** a new non-retryable `assertVisual` step type with `mode` and enforce-only `onInconclusive`.
- **Alternative:** `assertionType: "visual"` on `assertText`, rejected because the executor falls back to text.

### VA-3 — Target scope
- **Recommended:** one element, resolved to exactly one visible element. No viewport, page or region assertions.

### VA-4 — Conditions envelope and comparison rule
- **Recommended:** the key fields, geometry and state rules above; only `equal-proven` with equal geometry and state
  can pass or fail; fonts, raster path and drivers are stated residuals.

### VA-5 — Baseline store and FD-4
- **Recommended:** a new `visual-baselines/` store with an index, amending FD-4 to two stores with one writer each.
  The N2/N4 store is untouched; VD-11 stays deferred for it.

### VA-6 — Image retention and displayed values
- **Recommended:** no image bytes persisted, no context crop; the 16x16 grids and digest accepted as a coarse
  thumbnail and a guess-confirmer; targets the step-safety policy marks sensitive are refused.
- **Alternative:** store baseline PNGs, a privacy expansion needing its own retention and export policy.

### VA-7 — Pass rule
- **Recommended:** byte identity only; a tolerance needs its own decision after N6.6.

### VA-8 — Outcome matrix and inconclusive handling
- **Recommended:** the matrix above: observe always passes the step; enforce defaults `onInconclusive` to `fail`;
  a run-level *unverified* count.
- **Alternative:** `onInconclusive: pass` by default, rejected because it silently bypasses enforcement.

### VA-9 — Enablement and budget
- **Recommended:** `AWKIT_VISUAL_ASSERTIONS` = `off` (default) | `observe` | `enforce`; enforce acts only in granted
  cells; 2000 ms per assertion.

### VA-10 — Approval permission
- **Recommended:** `WORKFLOW_EDIT` plus `requireFreshReauth`, audited. **Alternative:** a new dedicated permission.

### VA-11 — Export
- **Recommended:** not exported in N6; a signed bundle may follow with its own decision.

### VA-12 — Calibration gate, per cell
- **Recommended:** N6.6 measures each cell (headed and headless × DPR 1, 1.25, 2) separately over mock-site fixtures
  (unchanged, restyle, swap, text, size, moved, clipped, hovered/focused, animated, twins, protected, sensitive) with
  at least 20 fresh launches against a baseline from a separate launch. A cell is **granted enforce** only with:
  - **zero** `failed` on unchanged fixtures;
  - **every** restyle, swap, text and size change `failed`;
  - moved, clipped and state-changed fixtures `inconclusive`, never `failed` or `passed`;
  - **zero** captures on protected, handoff and sensitive fixtures;
  - p95 within the deadline.

  Every cell also reports the observe usefulness rate (share of unchanged runs that pass). Expected: headless DPR 1
  not granted (N3.2). If no cell is granted, N6 closes observe-only.

### VA-13 — Baseline source (new)
- **Recommended:** a baseline comes from a **pending candidate** that an observe or enforce run produced for a
  `no-baseline`, `binding-changed` or `baseline-other-conditions` verdict, in that run's own conditions. The
  candidate holds the image-free evidence, envelope and geometry, plus a transient guarded PNG preview in
  main-process memory only (never written, at most 20 candidates, discarded after 30 minutes or at app exit). A person
  approves from the run report while the preview exists; after it is gone, the candidate must be re-produced by
  another run.
- **Alternatives:** (a) a dedicated approval run that pauses at the step, which also executes the earlier steps' side
  effects; (b) headed-only live approval, which cannot serve headless keys.

### VA-14 — Baseline integrity (new)
- **Recommended:** each record and index carries an HMAC over its canonical bytes with a per-user key protected by
  Electron `safeStorage` (Windows DPAPI). A failed check is `baseline-unreadable`. **Alternative:** record tampering
  as an accepted risk.

### VA-15 — Capture policy for assertions (new)
- **Recommended:** an N0 option used only by N6: `animations: "disabled"` and `caret: "hide"` on the screenshot, and
  `contextPaddingCss: 0`; no pointer movement or focus change by N6. Hover and focus left by earlier steps are read
  and compared (`interaction-state-changed`), not cleared.
- **Alternative:** a two-capture stability check, which doubles cost.

## Work breakdown

| Item | Title | Depends on |
|---|---|---|
| N6.1 | Owner decisions VA-0 to VA-15 | — |
| N6.2 | Pure `decideVisualAssertion` policy, vocabulary, conditions, geometry and mapping; `verify:visual-assertion` with mutants | N6.1 |
| N6.3 | `VisualBaselineStore` with index, integrity and lifecycle; `verify:visual-baseline-store` | N6.1 |
| N6.4 | `assertVisual` step type, validator, VA-15 capture option, runner adapter (fourth edge), outcome matrix, pending candidates, random-generator exclusion, mock-site fixtures; `verify:visual-assertion-runtime`, `verify:visual-isolation` at four edges | N6.2, N6.3 |
| N6.6 | Calibration lab and the per-cell enforce gate; `benchmark:visual-assertion` | N6.4 |
| N6.5 | Approval channel, preview, permission, audit and Designer node; `verify:visual-assertion-gui` | N6.4, N6.6 |
| N6.7 | Codes-only report block, *unverified* count, sanitizer and drawer section; `verify:visual-assertion-report` | N6.4, N6.6 |
| N6.8 | Independent QC and security review, closure | N6.5, N6.6, N6.7 |

N6.5 and N6.7 follow N6.6 so the UI and report are built for the measured scope (finding 10).

## Verification and independent QC matrix

| Claim | Gate |
|---|---|
| Verdicts, geometry, mapping; `failed` needs `equal-proven` and equal geometry and state | `verify:visual-assertion`, mutants per rule |
| Baselines atomic, versioned, indexed, integrity-checked, image-free, no context fingerprint | `verify:visual-baseline-store`, tamper cases |
| Outcome matrix in every cell; observe never changes status; non-retryable | `verify:visual-assertion-runtime` A/B against flag off |
| No capture on protected, handoff or sensitive targets | runtime cases, `verify:b2-protected-capture` unchanged |
| Exactly four `src/visual` edges | `verify:visual-isolation` |
| Older-build and skipped-validation paths fail closed; random generator never emits the step | runtime and validator cases |
| Report block codes-only; *unverified* count correct | `verify:visual-assertion-report` with sanitizer mutants |
| Approval requires permission and fresh re-auth; preview never written | `verify:visual-assertion-gui`, IPC contract, file-system check |
| Enforcement earned per cell | `benchmark:visual-assertion` against VA-12 |
| Regression | `verify:runner`, `verify:visual-capture`, `verify:visual-capture-fanout`, `verify:visual-diagnosis-runtime`, `verify:recorder-visual-capture`, `verify:mock-site`, build |

## Completion criteria

1. VA-0 to VA-15 approved (or amended) and recorded in DECISIONS.
2. N6.2 to N6.7 closed with their gates green and mutants red.
3. N6.6 measured per cell against VA-12; enforce granted only in cells that met it; observe-only recorded otherwise.
4. Flows without the step are byte-identical in outcome and report; with the flag off, steps are inert and reported
   `disabled`.
5. Independent QC and security review APPROVED.
6. State docs updated and the dashboard reads "Sources agree".

## Rollback and disable

`AWKIT_VISUAL_ASSERTIONS=off` makes every `assertVisual` step inert (`inconclusive/disabled`, step passed). Deleting
`visual-baselines/` makes enforced assertions `no-baseline`, which fail by default in enforce, so the deletion is
visible rather than silent.

## Risks

| Risk | Mitigation |
|---|---|
| False failures from rendering noise | Byte identity only under `equal-proven`; geometry and state rules; per-cell VA-12 gate |
| Unkeyed font, raster or driver changes | Per-machine baselines; stated residual; re-approval path |
| Enforcement silently bypassed | Enforce defaults `onInconclusive: fail`; *unverified* count; integrity tag |
| Authors read `inconclusive` as passing | Visible verdict, code and count |
| Privacy of grids and digest | No context crop, sensitive targets refused, stated residual |
| Approval preview exposure | Guarded capture, memory only, capped, time-limited, permission and re-auth |
| Baseline sprawl and orphans | Index, lifecycle and 30-day purge |
| Performance on long flows | One capture per assertion, non-retryable, deadline |

## Exact next task (pending owner approval)

N6.1: the owner reviews VA-0 to VA-15. On approval, N6.2 (pure policy) and N6.3 (baseline store) can start in
parallel; nothing else may start before them.
