# N5 — Visual Failure Diagnosis

Shared rules and the Phase N boundary: `ROADMAP.md` › *Phase N — Visual Recognition and Automation* ›
*Canonical milestone map*. Epic `awkit-vra`. N5 follows N2 (`awkit-vra.12`, closed shadow-only 2026-10-13), N3
(`awkit-vra.4`, closed shadow-only 2026-10-13) and N4 (`awkit-vra.13`, closed 2026-10-19 after independent QC at
`2b13bda3`). The tracker home for N5 is the new bead **`awkit-vra.14`**, with children `awkit-vra.14.1`-`.14.7`. The
legacy 2026-09-22 workstream `awkit-vra.5` ("Visual assertions and failure evidence") is **not** reused: its scope is
split between canonical N5 (this plan) and canonical N6 (Visual Assertions), and it keeps its original title as a
planning record, as the N4 plan did for `awkit-vra.6` and `.8`.

**Status (2026-10-19): IN PROGRESS. The owner approved VD-0 to VD-11 as recommended ("I approve VD-0 to VD-11 as
recommended, start N5"), recorded in DECISIONS 2026-10-19 (contract `awkit-vra-14-n5-start-1019`).**
- **N5.1 `awkit-vra.14.1`: closed.** VD-1 (the third edge) takes effect when N5.3 lands the adapter. VD-11 is
  deferred.
- **N5.2 `awkit-vra.14.2`: closed.** Delivered the pure `src/visual/diagnosis/decideVisualDiagnosis.ts`, exported
  through `src/visual/index.ts`:
  - the closed vocabulary;
  - the three-state rule, in which the input has no provenance field, so `equal-proven` is unreachable and
    `target-differs-from-reference` and `no-examined-identical` are never emitted for v1;
  - examined-scope counts with `truncated`, and no uniqueness field;
  - no index or effect key;
  - compile-time pins of the v1 evidence, viewport and frame keys;
  - `inconclusive` instead of an empty record.

  Gates: new `verify:visual-diagnosis` 82/0, with 13 mutants observed red; `verify:visual-isolation` 54/0, unchanged
  at two edges; `typecheck:scripts` and `npm run build` PASS. No runner, recorder, IPC, report or UI change.
- **Next: N5.3 `awkit-vra.14.3`**, the runner adapter, the final-attempt hook and the three-edge isolation pin.

*Before approval:* Contracts `awkit-vra-n5-plan-1019` (plan, `725b129c`) and `awkit-vra-n5-plan-review-1019` (the six
review corrections below). No product source, schema, IPC, preload or UI changed. The review added one security
reproduction verifier, `verify:b2-protected-capture`, which is test code only. N5 implementation waits for N5.1 (the
owner's decision record) and an explicit owner authorization.

## Review corrections (2026-10-19)

Six review findings were resolved in planning. Each correction is written into the sections it affects; this table
is the index.

| # | Finding | Evidence gathered | Correction | Where |
|---|---|---|---|---|
| 1 | VD-9 assumed stored references record render mode and zoom | Audit of `VisualEvidence` v1, `VisualViewportInfo`, `VisualFrameInfo`, the `VisualReferenceStore` envelope and both existing `sameConditions` rules | A field-by-field provable/unprovable table; a three-state, fail-closed condition rule; no migration or reinterpretation; a provenance envelope is a separate owner decision (VD-11) | *Reference-condition provenance*, VD-9, VD-11 |
| 2 | The B2 failure capture's protected-surface exposure was unverified | Caller trace plus the new real-Chromium reproduction `verify:b2-protected-capture`: 11 passed / 3 failed; all preconditions and controls green; three protected paths write screenshot, DOM and a11y files | **Confirmed reachable defect**, filed as `awkit-4b5y` with a KNOWN_ISSUES entry for a separate security remediation; N5 does not touch B2 | *B2 protected-capture finding* |
| 3 | Uniqueness was stated page-wide | The fan-out is capped (`VISUAL_FANOUT_MAX_CANDIDATES`), recovery contenders are capped, nothing outside the DOM-named set is examined, and headless renders twins with position-dependent bytes (N3.2) | Every identity code is scoped to the **examined** candidates, with counts and a truncation flag, and no code claims uniqueness. Truncation and omitted-contender negative controls added | Vocabulary, persistence, UI, matrix |
| 4 | `viewport-uniform` needed a frame that the conditional capture never took for targetless pages | Architecture step 5 captured only when a DOM-named target was in the viewport | One bounded, protected-guarded frame per diagnosis, taken whether or not a target exists (VD-3 recommended), with an explicit exclusion alternative | Architecture, VD-3 |
| 5 | The deadline had no cancellation or teardown semantics | N0 accepts `signal` and `timeoutMs`; a dispatched Playwright screenshot cannot be recalled | An abort-and-settle protocol: one abort signal, a single-assignment result slot closed at the deadline, release in `finally`, read-only probes, and proofs that late work changes nothing | *Deadline, cancellation and teardown* |
| 6 | Report-only fallback had no tracker procedure | Dashboard rules: a `deferred` prerequisite blocks its dependent (fail closed); N2 closed with `.12.6` deferred | Truthful states per outcome. `.14.7` gains direct edges on `.14.4` and `.14.6`, so deferring `.14.5` needs one owner-approved edge removal | *Conditional closure and tracking* |

## Objective

When an automation step has **finally** failed, record an **advisory, image-free, codes-only visual diagnosis** of
the step's target beside the evidence the run already keeps (the L5a failure events and cause baseline, the B2
screenshot, DOM, accessibility and meta files, and the locator recovery trace). The diagnosis answers questions a
person reading the failure would otherwise answer by squinting at the screenshot:

- Was the element the step's own DOM locator names byte-identical to its last-known-good appearance?
- Did it differ, where the capture conditions can be proven equal (see *Reference-condition provenance*)?
- Was it outside the viewport, zero-sized, or covered by another element at its centre?
- Was the viewport almost uniform (blank or not yet painted), even when no target exists?
- How many of the **examined** DOM-named candidates were byte-identical to the reference, and was the examined set
  truncated? N5 never claims an element is the only one, on the page or among the candidates.
- Could no comparison be made, and why (no reference, conditions changed or unproven, protected page, budget)?

Concretely, and nothing wider:

> After the retry policy has declined a further attempt for an eligible element step, and only when the feature is
> on, the runner takes at most one protected-guarded N0 viewport frame of the failed page (whether or not a target
> exists), crops only the elements the DOM has already named (the step locator's own matches and the recovery
> stage's existing contenders, up to the fan-out cap), compares them through the N1 fingerprint against the step's
> last-known-good reference read **read-only** from the N2 store (runtime first, then the N4 recorded key under the
> N4 flag) under the fail-closed condition rule, adds a small set of read-only DOM geometry facts and a viewport
> uniformity statistic, and stores a closed set of codes in the instance report. Nothing it produces names, ranks,
> chooses, repairs, retries, proves or fails anything.

Success statement:

- **Feature off (the default).** Execution, retries, failure evidence, the L5a cause baseline, L5b analysis, reports,
  run history and the UI are exactly as today, byte for byte. No capture, no file, no field.
- **Feature on.** A finally-failed eligible step gains one `visualDiagnosis` block in its instance report and one
  text-only *Visual diagnosis* section in the existing Failure Evidence drawer. Passing steps and non-final attempts
  do no visual work at all.
- **Never.** A selector, index, coordinate, candidate, ranking, retry, recovery, cause-code change, run-status
  change, assertion verdict, OCR text or model output produced from pixels. A pixel, thumbnail, fingerprint, digest,
  selector, URL or page text in the diagnosis record, over IPC or in an export. A capture from a protected,
  handed-off or sensitive surface.

## User-visible purpose

An operator opens a failed run in Execution Reports. Beside *Deterministic cause*, *Captured evidence* and *AI
analysis* (L5b), a fourth section, *Visual diagnosis*, says in words what the target looked like when the step gave
up: "The element the step targets is pixel-identical to its appearance when it last passed. It was covered by another
element at its centre." or "No element matched the step's locator. Of the 4 elements the run examined, 1 is
pixel-identical to the step's last-known-good appearance. Elements the run did not examine were not compared, so this
does not mean it is the only such element, and it does not identify an element to use." or "The page was almost
blank when the step failed." Each line states its basis (which reference, which conditions, how many elements were
examined, whether the set was cut short) and its limits. Nothing the operator reads can make a run click
somewhere different, and nothing in it is offered as an action.

## Today's baseline (as built, `2b13bda3`)

| Fact | Source | Consequence for N5 |
|---|---|---|
| On every failing attempt, before the retry decision, `FlowExecutor` calls `StepExecutor.captureFailureEvidence` when `step.onFailure.screenshot` (or the run default) is on. It writes a full-page PNG, masked DOM HTML, a masked aria snapshot and masked meta (URL, title) under `screenshots/<exec>/<inst>/<flow>/evidence/`, each bounded at 5 s, path-confined, through the screenshot limiter | `src/runner/FlowExecutor.ts:490-552`, `src/runner/StepExecutor.ts:1681-1809` | N5 does not change, reuse or re-read these files. Its own capture is a separate in-memory N0 frame with the N2 options, so digests stay comparable with the reference store |
| The B2 capture consults no protected-surface, handoff or sensitivity guard, and a protected-login page reaches it on three paths. **Confirmed 2026-10-19** by `verify:b2-protected-capture` (11 passed / 3 failed) | `FlowExecutor.ts:490-552`, `StepExecutor.ts:1681-1809` | Filed as `awkit-4b5y` for a separate security remediation. N5 does not change, read or rely on B2 (see *B2 protected-capture finding*) |
| `VisualEvidence` v1 stores the CSS viewport, DPR, scale and image size, frame depth and main-frame flag, bounds and fingerprints, and nothing about render mode, browser build, colour scheme or how DPR splits into device ratio and browser zoom. The store envelope adds only versions, the digest and `updatedAt`. N2 and N3 compare DPR, CSS width and height and frame depth only | `src/visual/visualEvidence.ts:24-34`, `internal/captureCore.ts:62-76`, `VisualReferenceStore.ts:35-42`, `decideFusion.ts:211-218`, `decideVisualAgreement.ts:156-163` | VD-9 is rewritten fail-closed around what the records prove (see *Reference-condition provenance*) |
| L5a `FailureEvidenceCollector` owns run-lifetime events (`ui.*`, `http.error`, `network.failed`, `page.error`, `console.error`, `page.errorDocument`, `runner.failure`), masked, capped, de-duplicated, with request provenance. Protected-login surfaces are excluded entirely, and `pageHandedOff(page)` answers the N2 I5 question before any visual capture | `src/runner/evidence/ExecutionEvidence.ts`, `FailureEvidenceCollector.ts:20-23`, `:484` | N5 asks the same `pageHandedOff` before capturing and re-checks with N0 after, exactly as N2 does |
| `deriveFailureCause` is a coded precedence table (13 `FailureCauseCode`s, direct evidence first, runner diagnosis next, `insufficient` last), always computed, no model | `src/runner/evidence/FailureCauseBaseline.ts:33-128` | N5 never adds a cause code, re-orders precedence or edits the baseline (VD-4) |
| L5b failure analysis is on demand, cites closed evidence ids, coalesces by signature, stores redacted analyses in `ConcurrentRunReport.diagnostics.analyses`, and its request bytes are measured by a live quality gate | `src/ai/failureAnalysis.ts`, `docs/plans/ai-upgrade-v5/L5-failure-evidence-and-analysis.md` › L5b | N5 does not feed L5b (VD-4). L5b's request stays byte-identical, proven by `verify:ai-error-analysis` |
| `InstanceReport.diagnostics?: InstanceDiagnostics` holds the L5a evidence and baseline. The report-level `diagnostics.analyses` holds L5b. Both are optional and additive, and old reports load | `src/reports/ExecutionReport.ts:5-65` | The N5 record is one more optional, additive field on the instance diagnostics (VD-5) |
| The Failure Evidence drawer has three never-merged sections (deterministic cause, captured evidence, AI analysis), read through PAGE_REPORTS-gated `reports:get` | `app/renderer/components/reports/FailureEvidenceSection.tsx` | N5 adds a fourth text-only section through the same read. No new channel or permission (VD-6) |
| The locator recovery trace carries the N2 `visual` block and the N3 `visualAgreement` block (codes, effect `none`, `referenceSource`). `toRecoveryProvenance` keeps a sanitized copy in `report.json` `data.locatorRecovery` **on recovered records only**; a failed step's visual observation reaches only the log line | `src/runner/LocatorFactory.ts:1454-1469`, `src/runner/domIntelligence/recoveryProvenance.ts:114`, `PlaywrightRunner.ts:855` | N5 is the first codes-only visual record attached to a **failed** step. It reuses the sanitizer style (`^[a-z][a-z0-9-]{0,39}$` or `invalid`) |
| `src/visual/index.ts` is the only entry into `src/visual`. `verify:visual-isolation` (54/0) pins exactly two edges: `VisualFusionStage.ts` (N2.5, FD-2) and `RecorderVisualCapture.ts` (N4.2, RV-1), with a third-edge mutation red | `src/visual/index.ts:1-9`, `scripts/verify-visual-isolation.mts` | A runner diagnosis adapter is a third edge and needs an owner amendment (VD-1) |
| N0 `captureViewport` / `captureVisualFrame` / `cropFromVisualFrame` never scroll, refuse DPR/zoom mismatch, and run `checkProtectedSurface` before and after. `captureCandidates` fans out up to `VISUAL_FANOUT_MAX_CANDIDATES` from one frame | `src/visual/capture.ts`, `src/visual/index.ts:14-36` | N5 reuses them unchanged: one frame, DOM-named crops only |
| N1 `fingerprintVisualImage`, `compareVisualFingerprints`, `buildVisualEvidence` (image-free, at most 4096 bytes) | `src/visual/fingerprint.ts`, `compare.ts`, `visualEvidence.ts` | The comparison is the existing deterministic one. No new similarity metric and no model |
| `VisualReferenceStore.get` answers found / missing / corrupt / version-mismatch. The runtime key is `scenarioId\0flowId\0stepId`; the N4 recorded key is `recordedVisualReferenceKey(flow, step, stepCandidatesDigest(step.locator))`, read only when `AWKIT_VISUAL_RECORDER=manual` and the runtime read is missing | `src/runner/visualFusion/VisualReferenceStore.ts`, `recordedVisualReferenceKey.ts`, N4 plan › N4.6 | N5 reads with the **same precedence** and **never writes, refreshes or deletes** any key (VD-3) |
| `VisualFusionStage` records `referenceSource` `runtime` / `recorded` / `none`, and `effectForReferenceSource` forces `none` for `recorded`. FD-5: 400 ms per attempt, shared by fusion and agreement (J9) | `src/runner/visualFusion/VisualFusionStage.ts:62-156` | The N5 budget is separate and runs only after the final attempt, so it never competes with J9 inside an attempt (VD-8) |
| Enablement today: `AWKIT_VISUAL_FUSION=shadow`, `AWKIT_VISUAL_RECOVERY=shadow|enforce`, `AWKIT_VISUAL_RECORDER=manual`; the store root is set only when fusion or agreement is on | `src/runner/ExecutionEngine.ts:1630-1634`, `:2233` | N5 adds its own environment flag and resolves the store root itself, read-only (VD-7) |
| Calibration facts that bound what pixels can say: N2.3 found no separation between look-alikes and real contradictions; N3.2 saw 28 false `agreed` on headless twins (position-dependent bytes); N4.5 saw a headed recording never byte-identical to a headless crop (recall 0/36) | `N2.3-fusion-calibration.md`, `N3.2-agreement-calibration.md`, N4 plan › N4.5 | No code claims uniqueness, and counts are lower bounds over the examined set. Records cannot prove render mode, so differences are suppressed (VD-9). N5.6 recalibrates every code before the UI shows it (VD-10) |
| Mock-site labs `/visual-intelligence` (frames, popup, account, protected injection) and `/visual-intelligence/fusion` (`vf-tool-0..3`, baseline, restyle, swap, twins, theme, drift, `wide`, `injectProtected`, `vf-offscreen-tool`) | `mock-site/` | N5 extends these labs; it adds failure states, not new pages, where it can |

## Reusable capabilities versus N5 gaps

| Need | Already exists (reuse unchanged) | N5 gap |
|---|---|---|
| Failure moment and kind | `FlowExecutor` retry loop, `RunnerFailureKind`, L5a `runner.failure` | A hook **after** the final retry decision that cannot reach the decision |
| Page-derived failure evidence | B2 screenshot/DOM/a11y/meta, L5a events and cause baseline | None. N5 adds no new page text or file |
| Protected / handoff exclusion | `pageHandedOff`, N0 `checkProtectedSurface` before and after, protected-login step types | Wiring them into the N5 path. The B2 audit is done: a confirmed defect, filed separately |
| Capture and crop | N0 frame, crop and fan-out | None |
| Fingerprint and comparison | N1 | None |
| Last-known-good reference | N2 runtime store and N4 recorded key | A read-only reader that cannot write |
| DOM-named candidates | The step locator, the recovery decision's contenders | Collecting them at failure time without a second resolve that could act |
| Geometry facts | Playwright bounding box, `elementsFromPoint` | A read-only probe with a deadline |
| Diagnosis policy | `decideFusion` / `decideVisualAgreement` patterns (pure, closed vocabulary, mutation-tested) | A pure `decideVisualDiagnosis` with its own closed code set and **no** effect field |
| Persisted record | `InstanceDiagnostics`, the `toRecoveryProvenance` sanitizer pattern | An additive optional `visualDiagnosis` block and its sanitizer |
| Report UI | `FailureEvidenceSection.tsx`, PAGE_REPORTS, `reports:get` | One text-only section |
| Isolation proof | `verify:visual-isolation` exact-set pin | A third edge, pinned, with a fourth-edge mutation red |

## Scope

- One pure diagnosis policy over N1 comparisons and geometry facts, with a closed vocabulary of observation codes.
- One runner adapter, the single new import edge into `src/visual` (if VD-1 is approved), invoked once per finally
  failed eligible step.
- A read-only reference read with N4.6 precedence.
- An additive, optional, codes-only `visualDiagnosis` block in the instance report.
- A text-only *Visual diagnosis* section in the existing Failure Evidence drawer.
- Mock-site failure states, an informational calibration benchmark, verifiers and mutation contracts.

## Non-goals

- Visual assertions, expected-state checks, visual regression or any pass/fail verdict from pixels (**N6**).
- Reading text from pixels, label extraction or text-in-image matching (**N7**).
- Row, grid or table recognition (**N8**).
- Semantic page-state classes such as "error dialog", "spinner" or "login page" (**N9**). N5's uniform-viewport fact
  is a fingerprint statistic, not a page-state classifier.
- Any vision or language model, including feeding visual codes to L5b (**N10**, and VD-4).
- Selecting, ranking or naming an element for action; locator edits, repair suggestions, blueprint or DOM-reference
  refresh; retries, recovery, reruns; changes to the retry policy, the cause baseline or the run outcome.
- Page-wide template search for the reference (a pixel-located target is coordinate authority).
- Writing, refreshing or deleting visual references; capturing on passing steps or non-final attempts.
- Any thumbnail, annotated screenshot, bounding-box overlay or other pixel exposure in the UI or over IPC.
- A Settings key, export or import of diagnoses, and any change to N3 (N3.4 and N3.5 stay blocked).
- Fixing the confirmed B2 protected-capture defect (`awkit-4b5y`). It is a separate security remediation with its own
  owner decision; N5 neither depends on it nor weakens any B2 capture.
- Any claim that an element is unique, on the page or among candidates.

## Distinct from N6, N7 and N10

| Question | N5 Visual Failure Diagnosis | N6 Visual Assertions | N7 OCR | N10 Optional vision model |
|---|---|---|---|---|
| When does it run? | Only after a step has finally failed | As an authored step, on every run | On demand where approved | Only when an approved model is installed |
| Who asks for it? | Nobody; a run flag | The flow author | The flow author or a later diagnosis | The owner, after separate acceptance |
| Can it change a run? | Never: no verdict, retry or cause | Yes: it is a pass/fail step | Depends on its own approval | Never without a separate decision |
| Output | Closed observation codes | A step result | Text | Model claims |
| Authoring surface | None | Designer node or step config | Its own | Its own |
| Needs a model? | No | No | No (deterministic OCR is its own decision) | Yes |

## Owners

| Area | Owner | Files (expected) |
|---|---|---|
| Pure diagnosis policy and vocabulary | software, with qa | new `src/visual/diagnosis/decideVisualDiagnosis.ts`, exported through `src/visual/index.ts` |
| Runner adapter, failure hook, budget | backend | new `src/runner/visualDiagnosis/VisualFailureDiagnosis.ts`, `src/runner/FlowExecutor.ts` (hook only), `src/runner/ExecutionEngine.ts` (flag) |
| Read-only reference reader | backend, data-persistence (review) | reuses `VisualReferenceStore.get` and `recordedVisualReferenceKey` unchanged |
| Report record and sanitizer | data-persistence | `src/reports/ExecutionReport.ts`, `src/runner/evidence/FailureEvidenceCollector.ts` types, a new sanitizer beside `recoveryProvenance.ts` |
| Report section | frontend, with ui-designer authority | `app/renderer/components/reports/FailureEvidenceSection.tsx`, `global.css` tokens |
| Protected boundary and privacy review | security (review) | — |
| Mock-site, verifiers, mutations, benchmark | qa, recorder-playwright | `mock-site/`, `scripts/verify-visual-diagnosis*.mts`, `scripts/benchmark-visual-diagnosis.mts`, `scripts/verify-visual-isolation.mts` |
| Independent review | qc | — |
| Beads, state docs, dashboard | project-state | `.beads/`, `docs/ai/`, `scripts/verify-roadmap-dashboard.mjs` |

No new subsystem. The capture is N0, the fingerprint is N1, the reference is the N2/N4 store, the failure moment is
the existing retry loop, the record rides the L5a instance diagnostics, and the UI is the L5b drawer.

## Architecture and data flow

1. **Hook.** In `FlowExecutor`'s attempt loop, **after** `retryPolicy.decide` returns no retry for a failed attempt
   (the final attempt) and after the B2 capture for that attempt, the executor calls
   `visualDiagnosis?.diagnose(step, context)` with a deadline. The call's result is attached to the step's failure
   record only; it never feeds `lastResult.status`, `error`, `nextStepId`, `outcome`, `failureDisposition` or the
   retry decision, which has already been taken. When the flag is off the loader is never evaluated.
2. **Refusals, in order, each a fixed code with no capture:** feature off (not invoked); step type not eligible
   (`not-eligible`); step sensitive (`sensitive`); protected-login step, manual handoff or `Reuse Session`
   (`handoff-active`); `pageHandedOff(page)` true (`protected-surface`); page closed (`page-closed`); per-run cap
   reached for this signature (`coalesced`); budget exhausted at any point (`budget-exhausted`).
3. **Reference read (read-only).** Runtime key first. Only if it is `missing` and `AWKIT_VISUAL_RECORDER=manual`,
   the recorded key for the step's **current** binding digest. Anything but `found` gives `referenceSource: none`.
   The adapter holds no handle that can call `refresh` (the reader interface exposes `get` only).
4. **DOM facts and the examined set (read-only, no action).** The step's own locator through its frame chain gives
   a match count (0, 1, many; counted up to a fixed cap). The **DOM-named set** is the step locator's matches followed
   by the recovery decision's existing contenders when the failure came from recovery, de-duplicated and in that
   fixed order. The **examined set** is the first `VISUAL_FANOUT_MAX_CANDIDATES` members of the DOM-named set that are
   in the viewport. The record keeps `domNamed` (capped count), `examined` (count) and `truncated` (true when the
   DOM-named set was larger than the cap, or when the recovery decision itself dropped contenders past its own cap).
   Nothing outside the DOM-named set is ever examined, so an element the DOM did not name is never compared. For each
   examined member the probe records in-viewport, zero-size, and whether `elementsFromPoint` at its centre returns it
   or a descendant (`occluded` otherwise). No hover, focus, scroll, click or mutating evaluate.
5. **One bounded frame (VD-3).** If the page is not handed off or protected (`pageHandedOff`, then N0's guard), the
   adapter takes **exactly one** N0 viewport frame with the N2 runtime options, **whether or not a target exists**.
   From that one frame it crops the examined members only and fingerprints the whole viewport for the uniformity
   statistic. N0 re-checks the protected surface after the screenshot. A hit discards the frame and every derived
   value and answers `protected-surface`. There is never a second frame, a retry, a scroll or a page change. The frame
   is released in `finally`, and no pixels outlive the call.
6. **Decide.** `decideVisualDiagnosis(input)` is pure. Its input is the reference presence, the three-state condition
   status (*Reference-condition provenance*), the per-member byte-identity outcomes, the examined, DOM-named and
   truncation facts, the geometry facts and the viewport statistic. Its output is
   `{ version, observations: Code[], referenceSource, conditions, examined, domNamed, truncated }`, with **no**
   element index, locator, coordinate, score detail or effect, and no word that asserts uniqueness.
7. **Settle and record.** The adapter's result is delivered through the single-assignment slot defined in
   *Deadline, cancellation and teardown*. The executor builds the failure record from the slot's value at settle time.
   The report writer stores a sanitized copy as `InstanceReport.diagnostics.visualDiagnosis[]` (one entry per finally
   failed step, capped).
8. **Read.** `reports:get` (PAGE_REPORTS, unchanged) returns the report; `FailureEvidenceSection` renders the
   section from the codes and fixed text. No new channel.

```text
FlowExecutor attempt loop
  attempt fails -> B2 captureFailureEvidence (unchanged) -> retryPolicy.decide
     retry          -> next attempt (no visual work)
     no retry (final)
        -> VisualFailureDiagnosis.diagnose (flag on only; the third and last src/visual edge)
             refusals: not-eligible / sensitive / handoff-active / protected-surface / page-closed / coalesced / budget
             reference: store.get(runtime) -> [flag] store.get(recorded, current binding)   (read-only)
             DOM facts: count, DOM-named set, examined set (capped, truncated flag), geometry (read-only)
             one N0 frame, target or not (protected before + after) -> examined crops + viewport statistic
             condition status: equal-proven / unproven / different (fail closed)
             decideVisualDiagnosis (pure) -> codes
             all under one abort signal and deadline; frame released in finally
        -> settle slot (closed at the deadline; late results dropped)
        -> attached to the failure record (never to status, error, retry, cause)
ExecutionReport -> InstanceReport.diagnostics.visualDiagnosis[] (sanitized, codes only)
reports:get [PAGE_REPORTS] -> FailureEvidenceSection -> "Visual diagnosis" (text only)
```

## Diagnosis vocabulary (proposed; final set fixed in N5.2, pruned by N5.6)

Observation codes are facts about the moment of failure, never causes and never instructions. Every identity code is
about **byte identity** (equal N1 `contentDigest`) among the **examined** set, never about visual sameness on the
page. The record always carries `examined`, `domNamed` and `truncated` beside the codes.

| Code | Meaning | Allowed when (condition status, see *Reference-condition provenance*) |
|---|---|---|
| `reference-unavailable` | No usable last-known-good reference | store `missing`, `corrupt`, `version-mismatch`, or evidence that fails shape validation |
| `conditions-changed` | A provable condition differs (DPR, CSS viewport, frame depth or main-frame flag, evidence or fingerprint version) | `different`; no comparison is reported |
| `conditions-unproven` | Provable conditions are equal, but the record cannot prove render mode, browser build or colour scheme | `unproven`; **every v1 record**; restricts the codes below |
| `target-not-in-dom` | The step's locator matched no element | always (DOM fact) |
| `target-multiple-matches` | The step's locator matched more than one element (a count, not a uniqueness claim) | always (DOM fact) |
| `target-offscreen` | The step's DOM-named target is outside the viewport | always (DOM fact) |
| `target-zero-size` | The step's DOM-named target has no area | always (DOM fact) |
| `target-occluded` | Another element is topmost at the target's centre | always (DOM fact) |
| `target-identical-to-reference` | The step's single DOM-named target is byte-identical to the reference | `unproven` or `equal-proven` (byte equality proves itself) |
| `target-differs-from-reference` | The step's single DOM-named target is not byte-identical | `equal-proven` only; under `unproven` a difference may be rendering, so it is suppressed |
| `other-examined-identical` | At least one examined member **other than** the step's target is byte-identical; the record adds `identicalOthers` as `1` or `2+` | `unproven` or `equal-proven`; never worded as "only" or "unique" |
| `no-examined-identical` | No examined member, target included, is byte-identical | `equal-proven` and `truncated: false` only; otherwise suppressed |
| `viewport-uniform` | The viewport fingerprint is near-uniform (blank or unpainted), with or without a target | always (no reference involved); threshold from N5.6 |
| `inconclusive` | A comparison ran but no allowed code applies, the code was pruned by N5.6, or nothing else applies (a record is never empty; N5.2 as built) | — |

Refusal codes (nothing captured): `not-eligible`, `sensitive`, `handoff-active`, `protected-surface`, `page-closed`,
`coalesced`, `budget-exhausted`, `capture-failed`. An unknown code maps to `capture-failed`, never to an observation.

**Scope rules (finding 3).**

- No code, field or copy asserts uniqueness. `identicalOthers: "1"` means one **examined** member matched. Elements
  past the cap, contenders the recovery decision dropped, and every element the DOM never named were not compared.
- `truncated: true` forbids `no-examined-identical` and makes the UI say that the examined set was cut short.
- Headless Chromium renders identical icons with position-dependent bytes (N3.2), so a visual twin can fail byte
  identity. Counts are therefore lower bounds on byte-identical members and say nothing about visual twins.
- `other-examined-identical` is never accompanied by an index, selector, coordinate or highlight. Its fixed text says
  it does not identify an element to use. N5.6 must show zero false identity on swap, restyle and twins, and correct
  `truncated` and omitted-contender behaviour, before the UI may show it (VD-10).

## Reference-condition provenance (finding 1, audited 2026-10-19)

**What a stored reference contains.** The envelope (`VisualReferenceRecord`, `VisualReferenceStore.ts:35-42`) holds
`version`, `scopeKey`, `evidenceVersion`, `contentDigest`, `evidence` and `updatedAt`. The evidence (`VisualEvidence`
v1, `visualEvidence.ts:24-34`) holds `kind`, `capturedAt`, `viewport` {`cssWidth`, `cssHeight`, `devicePixelRatio`,
`scaleX`, `scaleY`, `imageWidth`, `imageHeight`}, `frame` {`isMainFrame`, `depth`}, `bounds`, optional
`contextBounds`, `fingerprint` (version, size, luma and edge statistics, grids, dHash, `contentDigest`) and optional
`contextFingerprint`. N0 records `devicePixelRatio` from `window.devicePixelRatio` and refuses a pinch-zoomed page
(`captureCore.ts:202-216`).

| Condition | Provable from every v1 record? | Note |
|---|---|---|
| Evidence version, fingerprint version | Yes | A mismatch is `reference-unavailable` or N1's unsupported-version refusal |
| CSS viewport width and height | Yes | `viewport.cssWidth`, `cssHeight` |
| Effective device pixel ratio | Yes, as a product only | Chromium folds browser zoom into `devicePixelRatio`, so 125 % zoom at DPR 1 equals a DPR 1.25 display. Equal values prove equal effective scale, not equal zoom |
| Screenshot scale and image size | Yes | `scaleX`, `scaleY`, `imageWidth`, `imageHeight` |
| Pinch zoom | Yes, implicitly | N0 refused any pinch-zoomed capture, so every stored record was taken at visual scale 1 |
| Frame depth and main-frame flag | Yes | Not the frame's origin or chain |
| Element size at capture | Yes | `bounds.actualCss` |
| Render mode (headed or headless) | **No** | Absent. N4.5: a headed reference is never byte-identical to a headless crop |
| Browser build, OS, GPU, fonts | **No** | Absent |
| Colour scheme, forced colours, contrast, reduced motion | **No** | Absent |
| Browser zoom separately from device ratio | **No** | Folded into DPR |
| Page or frame origin | **No** (by design) | The record carries no URL |
| Writer (runtime or recorded) | Only from the key namespace | Not stored in the record; N5 does not infer conditions from it |

The existing N2 and N3 rules (`decideFusion.ts:211-218`, `decideVisualAgreement.ts:156-163`) compare DPR, CSS width
and height and frame depth only. N5 adopts that provable set and adds the main-frame flag and both versions.

**Fail-closed rule (proposed VD-9).** Each comparison gets one of three statuses:

1. `different`: a provable field differs. The code is `conditions-changed`, and no identity or difference is reported.
2. `unproven`: every provable field is equal, but render mode, browser build or colour scheme cannot be proven. This
   is the status of **every existing record**. Only self-evidencing positives are allowed: `target-identical-to-reference`
   and `other-examined-identical`, because byte equality proves itself. Differences, absences and counts that would
   need equal rendering (`target-differs-from-reference`, `no-examined-identical`) are suppressed, and the record
   carries `conditions-unproven`.
3. `equal-proven`: every provable field is equal **and** a provenance envelope proves the rest. No v1 record can
   reach it. It exists only if the owner approves VD-11.

**Backward compatibility.** Stored records are read as they are. N5 never migrates, rewrites, backfills, re-stamps or
deletes a reference, and never infers a missing condition, for example "a recorded key implies headed". A record that
fails shape validation is `reference-unavailable`. Older builds are unaffected because N5 writes nothing to the store.
The runner knows its own current render mode, but that cannot prove the reference side, so it does not lift a v1
record out of `unproven`.

**Consequence.** Against today's references, N5 can report byte identity of the target or of other examined members,
geometry, uniformity and refusals, but not "the target changed". That stays out until VD-11 provenance exists and
N5.6 calibrates it.

## B2 protected-capture finding (finding 2, confirmed 2026-10-19)

**Callers.** `StepExecutor.captureFailureEvidence` has one production caller, `FlowExecutor.executeWithRetry`
(`FlowExecutor.ts:534`). It runs on **every** failing attempt, before the retry decision, whenever
`step.onFailure.screenshot ?? screenshotOnFailureDefault` (the artifact profile's `screenshotOnFailure`, default
`true`) holds. It consults no protected-surface, handoff or sensitivity guard. It writes a full-page PNG, `page.content()`
HTML, an aria snapshot and meta (`StepExecutor.ts:1754-1807`). The text files are secret-masked; the PNG is not
maskable. The verifiers `verify:concurrency`, `verify:failure-screenshot-precedence`, `verify:failure-evidence` and
`verify:failure-evidence-live` call it through stubs or directly, not as product paths.

**Paths traced, and the reproduction.** `verify:b2-protected-capture` drives the real `FlowExecutor` retry loop over a
real `StepExecutor` in real Chromium against `mock-site/public/secure-login/protected-login.html`, served locally.
Preconditions: the runner's deep scan and the N0 guard both classify the fixture as protected. Result: **11 passed /
3 failed** (2026-10-19, ARM64 machine, x64 Node and Chromium emulated). Every precondition and control passed, and
each security assertion failed:

| Case | Path | Result |
|---|---|---|
| P1 | `protectedLoginHandoff` node pauses; the operator cancels; `Manual handoff was cancelled.` fails the step on the protected page | screenshot, DOM and a11y written: **defect** |
| P2 | `goto` lands on the page; title-first auto-detection pauses (`PROTECTED_LOGIN_AUTODETECT_STEPS`); the operator cancels | screenshot, DOM and a11y written: **defect** |
| P3 | an ordinary `click` fails on a protected page that no detector paused on. The fixture's own title has no protected wording, and auto-detection reads the body only for a suspicious title or URL (`ProtectedLoginDetector.ts:215-247`) | screenshot, DOM and a11y written: **defect** |
| C1 | the same click failure on an ordinary page | all four files written: the capture is intact and was not weakened |
| C2 | a value typed into an ordinary text field | not serialized into the DOM file (values are properties, not attributes) |

Traced statically, not run: popup detection (`StepExecutor.ts:1952-1966`) uses the same `waitForHandoffAction` and
reaches B2 the same way on cancel. A failure inside `captureProtectedLoginSession` after the automation browser was
closed gives page-closed notes, not files. **Sensitive steps: INCONCLUSIVE.** The DOM file does not carry typed
values (C2), but the full-page PNG renders whatever text-type inputs show, for example an OTP in a text field. No OCR
was used, so leakage into pixels is not measured. Password inputs render masking glyphs (browser behaviour, not
measured here).

**Disposition.** This is a reachable defect, filed as `awkit-4b5y` (P1, security, discovered from `awkit-vra.14`) with a
KNOWN_ISSUES entry, for a separate security remediation. The remediation needs its own owner decision on what B2 does
on a protected surface: skip page-derived files, keep meta only, or another option. N5 does not fix it, does not
weaken any capture, and never reads B2 files. `verify:b2-protected-capture` stays red until that remediation lands; it
is never relaxed to pass. N5's own path is proven separately, because N5.3 reuses the P1-P3 fixtures to show zero N5
captures.

## Deadline, cancellation and teardown (finding 5)

1. **One deadline, one abort signal.** On entry the adapter creates an `AbortController` and a timer for the
   per-failure deadline (VD-8). Every N0 call receives that `signal` and `timeoutMs` = the remaining budget (N0's
   `VisualCaptureOptions` already accepts both). Every DOM probe (`count`, `boundingBox`, the read-only
   `elementsFromPoint` evaluate) has a Playwright `timeout` no larger than the remaining budget, and is raced against
   the signal. The reference reads are raced the same way.
2. **Single-assignment settle slot.** The executor awaits `Promise.race([diagnosis, deadline])`. Whichever settles
   first writes the slot once: a verdict, or `budget-exhausted`. The slot is closed at that moment, and any later
   value is discarded. The executor builds the failure record from the slot. The adapter holds no reference to the
   step result, the report, the L5a buffer or any store writer (its reader exposes `get` only), so late work has
   nothing to write to.
3. **Cleanup in `finally`.** The adapter releases the frame (`releaseVisualFrame`), lets N0 detach its page watchers,
   clears its timer and removes its abort listener, on every exit path: success, refusal, abort or throw.
4. **What can still run after the deadline.** A screenshot already dispatched to the browser cannot be recalled. It is
   read-only, and its bytes land in a released or abandoned frame and are dropped. Playwright hides the text caret
   while it takes a screenshot (an existing N0/N2 property, not new in N5). No N5 operation clicks, focuses, hovers,
   scrolls or writes to the page, so a late operation cannot change page state either.
5. **Teardown.** The executor never waits past the deadline. Moving to the next step, ending the flow, closing the
   context or writing the report proceeds once the slot is settled. If the page or context closes while work is in
   flight, N0 answers `PAGE_CLOSED` or `CAPTURE_STALE` into the closed slot, where it is dropped. A per-instance
   in-flight counter is checked before the report is written: abandoned work is counted in a fixed-text debug count,
   never awaited.
6. **Proof (N5.3).** A verifier-only seam holds the N0 guard or the screenshot past the deadline. The cases:
   - the record says `budget-exhausted`;
   - after an extra wait the report record, the step result and the store bytes are byte-identical;
   - the frame-release seam (the N2.4 `onFrame` precedent) sees every frame released;
   - the page's DOM digest and scroll position are unchanged across the whole diagnosis;
   - a page closed mid-diagnosis yields a closed slot and no throw;
   - no timer or page listener is left behind.

   Mutations: write the late result after close; skip release; omit the signal from N0; await past the deadline.
   Each must be observed red.

## Persistence

- **Location:** `InstanceReport.diagnostics.visualDiagnosis?: VisualDiagnosisRecord[]` in the existing run report,
  optional and additive. Old reports load unchanged; the field is absent when the feature is off or nothing failed.
- **Record:** `{ version: 1, stepId, attempt, failureKind, referenceSource, conditions: "equal-proven" | "unproven" |
  "different" | "none", observations: code[], examined, domNamed, truncated, identicalOthers?: "1" | "2+", ms }`.
  Counts are small integers, capped. There is no similarity score: identity is byte equality, and near or far
  similarity is not reported. Bounded: at most 8 observations per record and a capped number of records per instance
  (fixed in N5.4).
- **Sanitized on write:** codes outside `^[a-z][a-z0-9-]{0,39}$` become `invalid`; unknown keys are dropped; no
  free text. A key allowlist test proves no pixel, fingerprint, digest, selector, URL, title or page text can appear.
- **Never in:** the FlowProfile, run history SQLite columns, flow export or import, the L5a events, the L5a cause
  baseline, L5b requests or analyses, the reference store, logs beyond fixed-text counts, or any new IPC payload.
- **Lifecycle:** lives and dies with its report, like L5b analyses (DECISIONS 2026-09-19 privacy policy).
- **Migration:** none. Older builds ignore the field.

## Security, privacy and the protected-auth boundary

- **No new trust boundary.** No new IPC channel, no new preload entry, no new permission. The report section reads
  through PAGE_REPORTS-gated `reports:get`. The `window.playwrightFlowStudio` identifier is unchanged.
- **What is never captured:**
  - any page while a protected-login step, manual handoff or real-Chrome handoff is active, or after protected
    detection marked the document (`pageHandedOff`);
  - any surface N0's `checkProtectedSurface` flags, before **or** after capture (an after-hit discards the frame);
  - sensitive steps (the N2 sensitivity rule, masked credential/OTP/PIN/card fields, guarded-positional sensitive
    steps) and `Reuse Session` nodes.
- **No escalation.** Never passes `allowProtected`, never uses the L12.17 Super User protected diagnosis.
- **Data minimisation.** Pixels exist only in memory for the duration of one call and are released in `finally`. The
  stored record is codes only. The existing B2 screenshot is neither read nor altered.
- **Redaction.** Fixed text only. No URL, selector, label, value or error message is logged by the N5 path.
- **B2 audit: done, defect confirmed.** The existing B2 failure capture photographs and serializes protected-login
  pages on three reproduced paths (*B2 protected-capture finding*). It is filed as `awkit-4b5y` for a separate remediation.
  N5 does not change B2, never reads its files, and proves its own path captures nothing on the same fixtures.
- **Targetless frames.** The one VD-3 frame may be taken when no target exists. It passes the same `pageHandedOff`
  and N0 before-and-after guards, and only a uniformity statistic of it is kept.

## Headed and headless

No stored reference records render mode (*Reference-condition provenance*), so every comparison against an existing
record is `unproven`. Only byte-identity positives are reported then, and a headed reference compared on a headless
replay simply produces no identity (N4.5: never byte-identical). It never produces a "changed" observation, because
that code is suppressed under `unproven`. N3.2's headless twins are handled by never claiming uniqueness and by
treating counts as lower bounds. N5.6 measures each code headed and headless at DPR 1, 1.25 and 2 on fresh launches,
including a headed reference replayed headless.

## Frames, popups and shadow roots

- **Frames:** targets are resolved through the step's recorded frame chain, as the runner does. N0 refusals for a
  frame pass through as codes.
- **Popups:** the step's `pageAlias` selects the page. A closed popup gives `page-closed`. N5 never falls back to
  another page (unlike B2's labelled fallback) because a comparison against the wrong page is a false observation.
- **Closed shadow:** the instrumented resolver is used through the normal locator path, read-only.

## Offline

No new dependency, network call, remote asset or model. TypeScript over N0/N1 (`node:crypto`, `node:zlib`). Nothing
is written into `resources/` or `app.asar`. `validate:offline` runs once in N5.3 if the adapter changes a bundle
boundary.

## AI independence and deterministic authority

- No model, OCR or learned threshold. Capture, fingerprint, comparison and geometry are deterministic.
- **The DOM/Playwright locator and the retry policy remain the only execution authority.** The diagnosis runs after
  the final decision and has no field that could carry an action.
- **N3 boundary.** N5 does not touch `decideVisualAgreement`, its thresholds or mode resolution, and creates no path
  that lifts N3.4/N3.5. **N4 boundary.** The recorded reference keeps effect `none`; N5 reads it and never writes it.

## Performance budgets

- **Passing steps and non-final attempts:** zero visual work (counted and proven by a capture spy).
- **Final failure:** one reference read pair (runtime, then recorded), one DOM probe, **exactly one** N0 frame
  (target or not) and at most `VISUAL_FANOUT_MAX_CANDIDATES` crops, under a per-failure deadline. Provisional ceiling
  **1000 ms**, fixed from N5.6 measurement (VD-8). An overrun answers `budget-exhausted` under the abort-and-settle
  protocol (*Deadline, cancellation and teardown*) and never delays teardown beyond the deadline.
- **Concurrency:** through the existing screenshot limiter. A per-execution cap per signature (flow, step, failure
  kind) bounds a data-driven run that fails the same way 500 times; the remainder record `coalesced`.
- **Disk:** a few hundred bytes per finally failed step, inside the report.

## Accessibility and UI

- A fourth section in the drawer, titled *Visual diagnosis*, after *Captured evidence* and before *AI analysis*,
  shown only when the report carries the block. Never merged with the other sections.
- Each observation is a sentence of fixed text plus an `aria-hidden` icon, never colour alone. The section states its
  basis ("compared with the reference from the last passing run" / "…from the Recorder" / "no reference") and, when
  `conditions` is `unproven`, says that the reference does not record how it was rendered, so only exact matches are
  reported.
- Identity copy always names the examined scope: "Of the *n* elements the run examined, *k* are pixel-identical…".
  When `truncated`, it adds "The run examined only the first *n* of the elements it found." It always ends with
  "Elements the run did not examine were not compared." The words "only", "unique" and "the element" are never used
  for an identity result. N5.5's GUI verifier asserts this copy.
- A visible caveat: "Advisory. This does not identify an element to use, and it does not change the run."
- No thumbnail, overlay, crop or digest (VD-6). Hologram tokens only; reduced motion respected; `.app-shell` and
  `.app-main` grids unchanged.
- The GUI verifier asserts focus order by containment and real `Tab`, heading structure, and that the section is
  absent when the field is absent.

## Owner decisions before implementation (proposed, not ratified)

Ordinary engineering details (names, key encodings, file names, verifier names, the exact code spelling) are **not**
owner decisions. Each decision below is needed because N5 would otherwise silently change a recorded invariant.

### VD-0 — Scope and authority boundary

- **Decision:** what N5 may change.
- **Recommended:** advisory diagnosis only. Codes in the report and a text section. Never selects, ranks, repairs,
  retries, re-runs, changes a locator, the retry policy, the cause baseline, L5b, the run status or any execution
  policy. Runs only after the final retry decision.
- **Alternatives:** (a) diagnosis-driven repair suggestions ("use element 2"), which makes pixels an authority and
  borders N3's blocked enforcement; (b) diagnosis feeding the retry policy (for example "retry when occluded"), which
  makes N5 execution-affecting.
- **Consequence:** N5 is reversible by unsetting a flag, and cannot change any run outcome.
- **Why needed:** "diagnosis" can be read as "recovery". The boundary must be fixed before any work.

### VD-1 — Isolation amendment

- **Decision:** whether, and how, the runner's failure path may reach `src/visual`.
- **Recommended:** exactly one new allowed edge, `src/runner/visualDiagnosis/VisualFailureDiagnosis.ts ->
  src/visual` (index only), loaded lazily. `verify:visual-isolation` pins exactly the three approved edges for the
  execution and renderer walks, and a fourth-edge mutation is red. The report types live in a pure file that does
  not import `src/visual`, so the renderer walk never meets the edge. Amends the 2026-10-12 isolation decision, FD-2
  and RV-1.
- **Alternatives:** (a) add `diagnose()` to `VisualFusionStage`, widening the existing edge's meaning and coupling
  diagnosis to the shadow stage's budget and enablement; (b) a trace-only N5 with no capture, built from the
  existing N2/N3 trace blocks and DOM facts only, which is the narrower fallback but gives no observation when
  fusion was off.
- **Consequence:** "two edges" becomes "three edges", still mechanically pinned and mutation-tested.
- **Why needed:** the current invariant is an owner decision.

### VD-2 — Trigger and eligible steps

- **Decision:** when a diagnosis runs, and for which steps.
- **Recommended:** only on the **final** failed attempt of a step (after the retry policy declined), only for the N2
  eligible element steps (click-like, fill, select, check, uncheck, radio) whose failure kind is `locator`,
  `timeout`, `assertion` or `other`. Excluded: sensitive steps, protected-login steps, manual handoff, `Reuse
  Session`, navigation-only and non-element steps, `cancelled` runs, and every passing step and non-final attempt.
- **Alternatives:** (a) every failed attempt, which multiplies captures and can race a navigating retry; (b) every
  step type including waits and assertions, which overlaps N6's authoring scope; (c) also on passing runs as a
  baseline, which turns N5 into continuous capture.
- **Consequence:** a failure that a retry later fixed gets no visual diagnosis; the B2 evidence still records it.
- **Why needed:** it decides the overhead model and the privacy surface.

### VD-3 — Visual evidence sources

- **Decision:** what pixels and references N5 may use.
- **Recommended:**
  - the reference is read **read-only** with N4.6 precedence (runtime, then recorded under
    `AWKIT_VISUAL_RECORDER=manual` for the current binding);
  - **exactly one** fresh N0 viewport frame per diagnosis with the N2 runtime options, taken **whether or not a target
    exists**, behind `pageHandedOff` and N0's before-and-after guard (finding 4);
  - from that frame, crops of the **examined** set only (*Architecture* step 4: the DOM-named set in fixed order,
    capped at `VISUAL_FANOUT_MAX_CANDIDATES`, with `truncated` recorded), plus the whole-viewport fingerprint
    statistic for `viewport-uniform`;
  - no second frame, no page-wide search, and no write, refresh or delete of any reference.
- **Alternatives:**
  - (a) template-search the whole screenshot for the reference, which locates a target by pixels and reproduces the
    twins hazard;
  - (b) decode the existing B2 full-page PNG, whose capture options differ (so digests are not comparable) and which
    is not protected-guarded (finding 2);
  - (c) let a passing comparison refresh the runtime reference, which writes from a failure path;
  - (d) **exclude targetless pages**: capture only when an examined member is in the viewport, and drop
    `viewport-uniform` for `target-not-in-dom`. This is a narrower privacy surface, but it loses the blank-page case,
    which is the one most likely to explain a missing target.
- **Consequence:** N5 says nothing about elements the DOM did not name. With the recommendation, a blank or unpainted
  page is reported even when the target is missing, and only a uniformity statistic of that frame is kept.
- **Why needed:** it fixes what may be photographed at failure and keeps the store single-writer.

### VD-4 — Relationship to L5a and L5b

- **Decision:** whether visual observations change the deterministic cause or the AI analysis.
- **Recommended:** neither. The L5a cause precedence, codes and evidence ids are unchanged; the drawer shows the
  diagnosis as its own section. L5b requests stay byte-identical (`verify:ai-error-analysis`). Feeding visual codes
  to L5b is a later decision with its own quality-gate measurement.
- **Alternatives:** (a) a new L5a cause code such as `targetOccluded`, which changes the measured 14/17 baseline and
  its precedence table; (b) add visual codes to the L5b request now, which changes the live quality gate's inputs.
- **Consequence:** an operator reads the visual section beside the cause; nothing re-ranks.
- **Why needed:** both L5a and L5b carry owner-accepted measurements.

### VD-5 — Persistence

- **Decision:** where the diagnosis lives.
- **Recommended:** an additive optional `visualDiagnosis` array on the instance diagnostics in the run report,
  codes only, sanitized on write, living and dying with the report. Never in the FlowProfile, run history, export,
  the reference store or L5a events.
- **Alternatives:** (a) a sidecar file per run beside `visual-references/`, which is a second lifecycle to clean up;
  (b) log-only, like the N3.3 trace line, which leaves the report UI nothing to read.
- **Consequence:** a persisted-shape change, additive, with no migration.
- **Why needed:** it is a report schema extension.

### VD-6 — UI exposure

- **Decision:** what the Reports UI may show.
- **Recommended:** text plus icon only, in the existing drawer, through the existing PAGE_REPORTS read. No pixels,
  thumbnail, crop, overlay or digest, and no new channel or permission.
- **Alternatives:** (a) a bounding-box overlay on the existing B2 screenshot, which needs pixel geometry in the
  record and reads as "click here"; (b) no UI, which leaves the record visible only in `report.json`.
- **Consequence:** operators get words, not pictures, from N5.
- **Why needed:** it decides whether visual geometry reaches the renderer for the first time.

### VD-7 — Enablement

- **Decision:** how N5 is switched on.
- **Recommended:** environment flag `AWKIT_VISUAL_DIAGNOSIS=on`, **default off**, independent of
  `AWKIT_VISUAL_FUSION`, with no Settings key until N5 closes (FD-8, VR-8, RV-6). The adapter resolves the store root
  itself, read-only.
- **Alternatives:** (a) tie it to `AWKIT_VISUAL_FUSION=shadow`; (b) a Settings toggle now (persisted-shape change
  before the feature is proven); (c) always on.
- **Consequence:** invisible until the owner chooses to expose it.
- **Why needed:** it sets the default user experience.

### VD-8 — Budget and concurrency

- **Decision:** the cost N5 may add to a failed run.
- **Recommended:** zero on passing steps and non-final attempts; a per-failure deadline, provisional 1000 ms, fixed
  from N5.6 measurement, enforced by the abort-and-settle protocol (*Deadline, cancellation and teardown*); captures
  through the existing screenshot limiter; a per-execution cap per (flow, step, failure kind) signature, provisional
  20, after which entries record `coalesced`.
- **Alternatives:** (a) no cap, so a 500-row failing run captures 500 times; (b) share the FD-5 400 ms attempt
  budget, which would make N5 compete with J9 inside an attempt.
- **Consequence:** bounded, measured, and never on the happy path.
- **Why needed:** it is a runtime-cost commitment on every failing run.

### VD-9 — Conditions and render mode

- **Decision:** when a comparison is allowed, given what stored references can prove (finding 1).
- **Recommended:** the three-state fail-closed rule in *Reference-condition provenance*:
  - any provable field differs: `conditions-changed`, and nothing is compared;
  - provable fields equal but render mode, build or colour scheme unproven (**every v1 record**): only byte-identity
    positives (`target-identical-to-reference`, `other-examined-identical`), with differences and absences suppressed;
  - `equal-proven` only with a VD-11 provenance envelope.

  Stored records are never migrated, rewritten or reinterpreted, and no condition is inferred from the key namespace.
- **Alternatives:**
  - (a) treat equal DPR and viewport as equal conditions, which reports headed-versus-headless rendering as "the
    target changed" (N4.5);
  - (b) compare across modes with a looser threshold, which N3.2 and N4.5 showed gives false identity or no recall;
  - (c) refuse every comparison until provenance exists, which loses the self-evidencing identity facts.
- **Consequence:** against today's references N5 never says "changed". It reports exact matches, geometry,
  uniformity and refusals.
- **Why needed:** it fixes the trust model for every identity code, and records cannot be fixed retroactively.

### VD-10 — Calibration gate and fallback

- **Decision:** what must be measured before the UI shows a code.
- **Recommended:** N5.6 runs every code headed and headless at DPR 1, 1.25 and 2 on fresh launches over the mock-site
  failure states, including a headed reference replayed headless. Pre-agreed criterion:
  - **zero** identity codes that disagree with byte truth on swap, restyle and twins;
  - **zero** uniqueness wording anywhere;
  - `truncated` is correct on the over-cap fixture, and an identical element beyond the cap is never counted;
  - an identical but un-named element (the omitted-contender fixture) is never counted;
  - **zero** observations on protected, handoff and sensitive fixtures;
  - **zero** `target-differs-from-reference` or `no-examined-identical` under `unproven`;
  - geometry and `viewport-uniform` agree with the fixture truth in every cell;
  - p95 cost within the VD-8 deadline, and zero visual work on passing runs.

  A code that fails is pruned to `inconclusive` before N5.5 exposes it. If every identity code fails, N5 closes with
  **geometry, uniformity and refusal codes only**. If those fail too, N5 closes **report-only** (no UI), tracked as in
  *Conditional closure and tracking*.
- **Alternatives:** (a) ship the vocabulary uncalibrated; (b) block N5 entirely on any failed code.
- **Consequence:** the same fallback pattern N2, N3 and N4 used.
- **Why needed:** it fixes the acceptance rule before any measurement.

### VD-11 — Reference provenance envelope (new, unresolved)

- **Decision:** whether stored references should start recording the conditions they cannot prove today.
- **Recommended:** **defer**. N5 ships with v1 semantics (`unproven` for every record). A later, separate milestone
  may add an optional, additive `provenance` envelope (render mode, browser major version, colour scheme, forced
  colours) to records **written after** it lands, by the two existing writers (the N2 refresh and the N4 Recorder
  save). It would come with its own owner decision, a store-format review and N2/N4 regression gates.
- **Alternatives:**
  - (a) add the envelope inside N5, which changes the N2 and N4 writers, outside N5's read-only boundary;
  - (b) backfill existing records, which is rejected because it reinterprets stored data;
  - (c) never add it, so `target-differs-from-reference` and `no-examined-identical` stay dormant.
- **Consequence:** with the recommendation, N5 cannot report "changed" until a later milestone, and old records
  stay `unproven` forever.
- **Why needed:** it is the only way to reach `equal-proven`, and it touches N2 and N4's persisted shape.

## Work breakdown

| Item | Bead | Owner | Depends on | Delivers | Acceptance |
|---|---|---|---|---|---|
| N5.1 Owner decisions | `awkit-vra.14.1` | owner | — | VD-0 to VD-11 recorded in DECISIONS, the isolation amendment, N5 authorization | DECISIONS entry naming each VD approved, amended, rejected or deferred. Plan status updated |
| N5.2 Pure diagnosis policy | `awkit-vra.14.2` | software, qa | N5.1 | `decideVisualDiagnosis` with its closed vocabulary, the three-state condition rule and the examined-scope rules; a pinned list of the `VisualEvidence` v1 fields the rule relies on. The two audits were completed in planning (findings 1 and 2) | New `verify:visual-diagnosis` with a mutation contract: a twin counted as unique; `truncated` ignored; a difference allowed under `unproven`; a condition inferred from the key namespace; an index or selector field added; an unknown code mapped to an observation; a new evidence field not reflected in the pin. Build |
| N5.3 Runner adapter, hook and isolation | `awkit-vra.14.3` | backend, qa, recorder-playwright | N5.2 | `VisualFailureDiagnosis` (third edge); the final-attempt hook; read-only reader; DOM facts and the examined set; one bounded frame, target or not; refusals; the abort-and-settle deadline; cap; mock-site failure states, including over-cap, omitted-contender and blank fixtures | New `verify:visual-diagnosis-runtime` (real Chromium): runner A/B identical on/off; zero work on passing steps and non-final attempts; zero N5 captures on the `verify:b2-protected-capture` P1-P3 fixtures and on sensitive steps; store bytes unchanged; the deadline proofs; truncation and omitted-contender controls; mutation contract. `verify:visual-isolation` pins exactly three edges, fourth-edge mutation red. `verify:mock-site`. Build |
| N5.4 Report record and sanitizer | `awkit-vra.14.4` | data-persistence, backend | N5.3 | The additive `visualDiagnosis` block, sanitizer, caps | Old reports load; key allowlist; run history unchanged; FlowProfile and export byte-identical; `verify:recovery-provenance`, `verify:ai-error-analysis` (L5b request bytes unchanged). Build |
| N5.5 Report section | `awkit-vra.14.5` | frontend, ui-designer | N5.4, N5.6 | The *Visual diagnosis* drawer section for calibrated codes only | New `verify:visual-diagnosis-gui` (real Electron: text, focus, absence, reduced motion), `verify:ai-assist-gui` unchanged. Build. **Report-only if N5.6 prunes everything** |
| N5.6 Calibration | `awkit-vra.14.6` | qa, recorder-playwright | N5.3 | Informational `benchmark:visual-diagnosis`: every code headed and headless, DPR 1/1.25/2, fresh launches; cost | VD-10 criterion reported as met or not per code; pruned codes recorded |
| N5.7 State, docs, QC, closure | `awkit-vra.14.7` | project-state, qc, security (review) | N5.5 (or its recorded deferral), N5.4, N5.6 | State docs, ARCHITECTURE, DECISIONS outcome, independent QC, security review, dashboard repin | QC APPROVED with findings closed. Sources agree. Build |

### Dependency chain

```text
awkit-vra.12 (N2, closed) --+
awkit-vra.4  (N3, closed) --+--> awkit-vra.14 (N5)
awkit-vra.13 (N4, closed) --+
N5.1 --> N5.2 --> N5.3 --+--> N5.4 --+--> N5.5 --> N5.7
                         |           |
                         +--> N5.6 --+
direct edges as well:  N5.4 --> N5.7,  N5.6 --> N5.7
```

N5.7 is blocked by N5.5, N5.4 and N5.6. The last two edges are redundant while N5.5 is pending, and they exist so
that a recorded deferral of N5.5 keeps N5.7 gated by the work that actually ran.

### Conditional closure and tracking (finding 6)

The dashboard treats a `deferred` prerequisite as blocking its dependent (fail closed), and N2 set the precedent of
an epic closing with a deferred child (`awkit-vra.12` with `.12.6`). States are recorded as follows:

| N5.6 outcome | N5.5 `awkit-vra.14.5` | N5.7 `awkit-vra.14.7` | Criterion 7 | Epic `awkit-vra.14` |
|---|---|---|---|---|
| All codes pass | Built and **closed** | Closes after QC | PASS | Closed when all ten criteria hold |
| Some codes pruned | Built for the surviving codes and **closed**; the pruned codes are listed in this plan and DECISIONS | Closes after QC | PASS (surviving codes) | Closed |
| Identity codes all pruned | Built with geometry, uniformity and refusal codes and **closed** | Closes after QC | PASS (reduced vocabulary) | Closed |
| Every code pruned (report-only) | **Not built.** Status `deferred`, with a note naming the N5.6 result; never `closed` | The owner approves one edge removal, `bd dep remove awkit-vra.14.7 awkit-vra.14.5`, inside a contract-backed project-state lease. N5.7 stays gated by `.14.4` and `.14.6`, then closes after QC | **DEFERRED (report-only)**, never PASS | Closed with `.14.5` deferred and open, as with N2.6 |
| N5.6 BLOCKED (environment) | `blocked`, not deferred | Stays blocked | NOT RUN | Stays open; N5 cannot close |

Rules: a deferred item is never closed as completed; no completion criterion is reported PASS for work that did not
run; the edge removal is the only tracker change that deferral needs, and it is made only after the owner records the
N5.6 outcome. The dashboard pins move to the measured counts in the same task.

## Verification and independent QC matrix

| Gate | Item | Type | What it proves | Mutations that must be observed red |
|---|---|---|---|---|
| `verify:b2-protected-capture` (added in planning, 2026-10-19) | separate remediation (`awkit-4b5y`) | real Chromium | The B2 capture writes no screenshot, DOM or a11y file of a protected page on P1-P3, and ordinary-page capture is intact (C1, C2) | none yet. It is a reproduction: **FAIL 11/3 today**, and it turns green only through the separate remediation, never by relaxing it |
| `verify:visual-diagnosis` (new) | N5.2 | pure | Closed vocabulary. The three-state condition rule: `different` gives `conditions-changed`; `unproven` admits only byte-identity positives; `equal-proven` is unreachable without provenance. Identity counts are scoped to the examined set, and `truncated` forbids `no-examined-identical`. No uniqueness field or wording. No index, locator, coordinate or effect. Pin of the v1 evidence fields | a difference allowed under `unproven`; a condition inferred from the key namespace; `truncated` ignored; `identicalOthers` read as uniqueness; an index field added; an unknown code mapped to an observation; an evidence field added without updating the pin |
| `verify:visual-diagnosis-runtime` (new) | N5.3 | real Chromium, mock-site | A/B identical: step status, error, attempts, retries, `nextStepId`, run status, L5a cause and evidence ids, B2 files. Zero captures on passing steps and non-final attempts. Zero N5 captures on the P1-P3 protected fixtures, handoff and sensitive steps. Store files byte-identical. Recorded reference read only under the N4 flag. Exactly one frame per diagnosis, target or not, released. **Truncation:** over-cap DOM-named set with the identical element past the cap, giving `truncated: true` and that element uncounted. **Omitted contender:** an identical element the DOM never named, and one dropped past the recovery contender cap, both uncounted. **Deadline:** the six proofs in *Deadline, cancellation and teardown*. Cap | diagnose passing steps; diagnose before the retry decision; skip the after-capture protected check; pass `allowProtected`; write or refresh a reference; let the verdict change status or cause; examine past the cap; search outside the DOM-named set; take a second frame; skip the frame when no target exists (with VD-3 as recommended); write a late result after close; skip release; omit the abort signal; await past the deadline; drop the cap |
| `verify:visual-isolation` | N5.3 | static walk | Exactly three edges; renderer walk clean | a fourth edge; the report types importing `src/visual` |
| Report contract checks | N5.4 | unit + real store | Additive field; old reports load; sanitizer; key allowlist; caps; run history columns unchanged; FlowProfile/export bytes unchanged; L5b request bytes unchanged | a pixel/digest/selector key admitted; sanitizer bypassed; field written into the FlowProfile |
| `verify:visual-diagnosis-gui` (new) | N5.5 | real Electron | Section text and basis; the `unproven` note; examined-scope and truncation copy; no "only", "unique" or "the element" in identity copy; the caveat; absence when the field is absent; focus by containment with real `Tab`; reduced motion; no image element | section rendered with no data; colour-only status; an `<img>` or canvas in the section; scope or truncation sentence dropped; a uniqueness word introduced |
| `benchmark:visual-diagnosis` (new, informational) | N5.6 | real Chromium | Per-code truth table headed/headless × DPR 1/1.25/2 on fresh launches, including a headed reference replayed headless, the over-cap, omitted-contender and blank fixtures; cost; the VD-10 criterion per code | — (benchmarks are never release gates) |
| Existing, must stay green | N5.3-N5.7 | — | `verify:visual-capture`, `verify:visual-fingerprint`, `verify:visual-fusion`, `verify:visual-fusion-runtime`, `verify:visual-agreement`, `verify:visual-agreement-runtime`, `verify:recorded-visual-fallback`, `verify:runner`, `verify:locator-guard`, `verify:recovery-provenance`, `verify:twin-pool-safety`, `verify:ai-error-analysis`, `verify:ai-assist-gui`, `verify:mock-site`, `typecheck:scripts`, `npm run build`; `validate:offline` once if a bundle boundary moves | — |
| Independent QC | N5.7 | fresh-context `awkit-qc-reviewer` | Criteria 1-10 below, with focus on authority (VD-0), the protected boundary and the A/B neutrality proof | — |
| Security review | N5.7 | `awkit-security-engineer` (review) | Protected-login, handoff, sensitive exclusion, the targetless frame, redaction, no pixel IPC, and that N5 neither reads nor depends on the B2 files (`awkit-4b5y` is reviewed in its own task) | — |

Every new `verify:*` and `benchmark:*` script is registered in `scripts/lib/verifier-classification.ts` in the item
that adds it. Mutation contracts are written **after** each mutation is run and its observed result recorded.
Rules carried from earlier phases: pair every `.every()` with a cardinality assertion; never use
`waitForFunction(async …)` or `isVisible({ timeout })` as a wait; assert the precondition before what it gates;
`page.evaluate` bodies avoid named inner functions; capture only installs on a real navigation, not `setContent`.

**Mock-site.** Extend `/visual-intelligence/fusion` rather than adding pages, with failure states that each have a
stable URL, title, expected behaviour and `data-testid` selectors: target detached after the reference pass,
target restyled, swapped, twins, an overlay covering the target, target scrolled offscreen, a zero-size target, a
uniform (blank) viewport with no target, an **over-cap** set (more DOM-named matches than `VISUAL_FANOUT_MAX_CANDIDATES`,
with the reference-identical element past the cap), an **omitted contender** (a reference-identical element the
step locator and recovery never name), and the existing protected injection. Each is covered by `verify:mock-site`
and listed in the mock-site docs. The N5.3 runtime verifier also reuses the `verify:b2-protected-capture` fixtures.

## Completion criteria

N5 closes when every item holds, or is truthfully recorded as deferred:

1. VD-0 to VD-11 are recorded by the owner, and N5 was authorized before any code landed.
2. `verify:visual-isolation` passes with exactly the approved edges, and its fourth-edge mutation is red.
3. `verify:visual-diagnosis` passes with its mutation contract, including the fail-closed condition rule and the
   examined-scope rules.
4. `verify:visual-diagnosis-runtime` proves:
   - runner A/B neutrality;
   - zero visual work on passing steps and non-final attempts;
   - every protected, handoff and sensitive refusal on a fixture, including the B2 P1-P3 fixtures;
   - an unchanged reference store;
   - the truncation and omitted-contender controls;
   - the deadline proofs.
5. No FlowProfile, export, run-history column, L5a event, L5a cause, L5b request, reference record or IPC payload
   carries N5 data beyond the codes-only report block, proven by byte-identity and allowlist checks.
6. N5.6 measurements are recorded and the VD-10 criterion is reported per code; pruned codes are recorded.
7. The report section passes its GUI verifier, or N5.5 is `deferred` with N5 closing report-only. In that case this
   criterion is recorded as **DEFERRED (report-only)**, never PASS (*Conditional closure and tracking*).
8. The N2, N3 and N4 suites, runner, locator-guard, recovery-provenance, twin-pool-safety, L5b, mock-site and build
   pass against the final state.
9. Independent QC and the security review are APPROVED, with findings closed.
10. `verify:roadmap-dashboard` reports Sources agree.

## Rollback and disable

- **Disable:** unset `AWKIT_VISUAL_DIAGNOSIS`. No capture, no field, no section.
- **Data:** the block lives in reports; deleting a report removes it. Old builds ignore it.
- **Code:** revert the N5 commits. There is no migration or Settings key to unwind; the isolation pin returns to two
  edges with the revert.

## Carry-over boundaries (unchanged by N5)

- N3 stays closed shadow-only. N3.4 and N3.5 stay blocked, and the 28 false `agreed` headless-twin result stands.
- N4 recorded references keep effect `none` and stay single-writer (the Recorder save).
- v0.1.53 release gates are untouched. Packaged licensed Parts D-J are BLOCKED on the unavailable
  `AWKIT_PACKAGED_LICENSE_ISSUER_KEY`.
- **Acceptance environment (owner decision, DECISIONS 2026-10-19):** Windows 11 ARM64 running in Parallels is the
  approved development and acceptance environment for N5, and a separate clean VM or physical x86/x64 machine is not
  required. Results are labelled ARM64-machine execution (x64 Node and Chromium emulated). This is a waiver, not
  verification: no clean-machine or native x64 run is claimed. Intel/AMD Windows x64 compatibility is preserved as a
  distribution target, and security, licensing and packaging gates keep their own requirements.

## Risks

| Risk | Mitigation |
|---|---|
| An operator reads `other-examined-identical` as "use that element" | No index or highlight; examined-scope and truncation copy; the caveat text; the VD-10 gate; pruned to `inconclusive` if it fails |
| Headless position-dependent rasterization (N3.2) hides visual twins from byte identity | No uniqueness claim exists; counts are lower bounds over the examined set; N5.6 twins cells headed and headless |
| A count is read as page-wide | Every identity record carries `examined`, `domNamed` and `truncated`, and the UI states the scope; over-cap and omitted-contender controls in N5.3 and N5.6 |
| Headed references never match headless crops (N4.5), and records do not say which mode they were taken in | Every v1 comparison is `unproven`: no "changed" code, only self-evidencing positives (VD-9) |
| The diagnosis slows down failing data-driven runs | Final-attempt only, deadline, limiter, per-signature cap, measured in N5.6 |
| A capture on a page that became protected after the check | N0 after-capture check discards the frame and answers `protected-surface` |
| The B2 path captures protected pages today (**confirmed**, finding 2) | Filed as `awkit-4b5y` for a separate remediation; N5 does not widen it, never reads its files, and proves zero N5 captures on the same fixtures |
| A targetless frame widens what is photographed | Same handoff and before-and-after protected guards; only a uniformity statistic is kept; the narrower alternative is VD-3 (d) |
| A diagnosis outlives its deadline | Abort-and-settle protocol: the slot closes at the deadline, late results are dropped, everything is read-only and released in `finally`, and six proofs with mutations |
| Failure state changes between the final attempt and the diagnosis (late network, animations) | The diagnosis runs immediately after the decision; it reports what it saw with `ms`; animations are not disabled (RV-7 precedent) |
| Isolation amendment widens drift | Exact-set pinning with a fourth-edge mutation |
| Reference records lack fields needed to prove equal conditions (**confirmed**, finding 1) | Fail-closed three-state rule; no migration or inference; VD-11 governs any future provenance |

## Unresolved owner decisions

None of these is ratified. An agent may not decide them.

| Decision | Recommended default | Unresolved because |
|---|---|---|
| VD-0 Scope and authority | Advisory codes only, after the final retry decision | Owner decision |
| VD-1 Isolation amendment | A third, single adapter edge | Amends the 2026-10-12 isolation decision, FD-2 and RV-1 |
| VD-2 Trigger | Final failed attempt, N2 eligible element steps | Overhead and privacy model |
| VD-3 Evidence sources | Read-only reference; exactly one guarded frame, target or not; examined set only | The targetless frame is a privacy choice (alternative (d) excludes it) |
| VD-4 L5a and L5b | Unchanged | Both carry owner-accepted measurements |
| VD-5 Persistence | Optional codes-only report block | Report schema extension |
| VD-6 UI | Text only, existing drawer and read | First visual result in the renderer |
| VD-7 Enablement | `AWKIT_VISUAL_DIAGNOSIS=on`, default off | Default user experience |
| VD-8 Budget | 1000 ms provisional, abort-and-settle, cap 20 per signature | Runtime cost on failing runs |
| VD-9 Conditions | Three-state fail-closed rule; v1 records `unproven` | Trust model for identity codes |
| VD-10 Calibration gate | Per-code criterion with pruning and the tracked fallbacks | Acceptance rule before measurement |
| VD-11 Provenance envelope | Defer to a later milestone | Changes N2/N4 persisted shape |
| B2 remediation (`awkit-4b5y`, outside N5) | Owner chooses B2's behaviour on a protected surface (skip page-derived files, meta only, or another option) | Security behaviour of an existing capture; not an N5 decision and not blocking N5 |

## Exact next implementation task (pending owner approval)

1. **Owner:** record VD-0 to VD-11 (approved, amended, rejected or deferred) and authorize N5. That closes N5.1
   (`awkit-vra.14.1`). Separately, and not blocking N5, prioritize the B2 remediation `awkit-4b5y`.
2. **Then, and only then, N5.2 (`awkit-vra.14.2`):**
   - add the pure `src/visual/diagnosis/decideVisualDiagnosis.ts` with its closed vocabulary, the three-state
     condition rule, the examined-scope rules and the v1 field pin, exported through `src/visual/index.ts`;
   - make no runner, recorder, IPC, report or UI change;
   - add `verify:visual-diagnosis` (pure, mutation contract observed red) and register it in
     `scripts/lib/verifier-classification.ts`.

   Gates: `verify:visual-diagnosis`, `verify:visual-isolation` (unchanged at two edges, since no adapter lands in
   N5.2), `typecheck:scripts`, `npm run build`, `verify:verifier-classification` and `verify:roadmap-dashboard`. The
   two audits N5.2 used to own were completed in planning.
