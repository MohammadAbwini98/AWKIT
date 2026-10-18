# N5 — Visual Failure Diagnosis

Shared rules and the Phase N boundary: `ROADMAP.md` › *Phase N — Visual Recognition and Automation* ›
*Canonical milestone map*. Epic `awkit-vra`. N5 follows N2 (`awkit-vra.12`, closed shadow-only 2026-10-13), N3
(`awkit-vra.4`, closed shadow-only 2026-10-13) and N4 (`awkit-vra.13`, closed 2026-10-19 after independent QC at
`2b13bda3`). The tracker home for N5 is the new bead **`awkit-vra.14`**, with children `awkit-vra.14.1`-`.14.7`. The
legacy 2026-09-22 workstream `awkit-vra.5` ("Visual assertions and failure evidence") is **not** reused: its scope is
split between canonical N5 (this plan) and canonical N6 (Visual Assertions), and it keeps its original title as a
planning record, as the N4 plan did for `awkit-vra.6` and `.8`.

**Status (2026-10-19): PLANNED. Zero implementation. Owner decisions VD-0 to VD-10 are proposed and not ratified.**
Contract `awkit-vra-n5-plan-1019`. No product source, schema, IPC, preload, UI, verifier or dependency changes with
this plan. N5 implementation waits for N5.1 (the owner's decision record) and an explicit owner authorization.

## Objective

When an automation step has **finally** failed, record an **advisory, image-free, codes-only visual diagnosis** of
the step's target beside the evidence the run already keeps (the L5a failure events and cause baseline, the B2
screenshot, DOM, accessibility and meta files, and the locator recovery trace). The diagnosis answers questions a
person reading the failure would otherwise answer by squinting at the screenshot:

- Did the element the step's own DOM locator names still look like its last-known-good appearance?
- Did it look different (restyled, a different state, a different theme)?
- Was it outside the viewport, zero-sized, or covered by another element at its centre?
- Was the viewport almost uniform (blank or not yet painted)?
- Was a DOM-named competitor identical to the reference, and was that identity unique or shared by twins?
- Could no comparison be made, and why (no reference, conditions changed, protected page, budget)?

Concretely, and nothing wider:

> After the retry policy has declined a further attempt for an eligible element step, and only when the feature is
> on, the runner takes at most one protected-guarded N0 viewport frame of the failed page, crops only the elements
> the DOM has already named (the step locator's own matches and the recovery stage's existing contenders), compares
> them through the N1 fingerprint against the step's last-known-good reference read **read-only** from the N2 store
> (runtime first, then the N4 recorded key under the N4 flag), adds a small set of read-only DOM geometry facts, and
> stores a closed set of codes in the instance report. Nothing it produces names, ranks, chooses, repairs, retries,
> proves or fails anything.

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
up: "The element the step targets looks the same as when it last passed. It was covered by another element at its
centre." or "No element matched the step's locator. One other element on the page looks identical to the step's
last-known-good appearance; another identical element also exists, so no single element can be named." Each line
states its basis (which reference, which conditions) and its limits. Nothing the operator reads can make a run click
somewhere different, and nothing in it is offered as an action.

## Today's baseline (as built, `2b13bda3`)

| Fact | Source | Consequence for N5 |
|---|---|---|
| On every failing attempt, before the retry decision, `FlowExecutor` calls `StepExecutor.captureFailureEvidence` when `step.onFailure.screenshot` (or the run default) is on. It writes a full-page PNG, masked DOM HTML, a masked aria snapshot and masked meta (URL, title) under `screenshots/<exec>/<inst>/<flow>/evidence/`, each bounded at 5 s, path-confined, through the screenshot limiter | `src/runner/FlowExecutor.ts:490-552`, `src/runner/StepExecutor.ts:1681-1809` | N5 does not change, reuse or re-read these files. Its own capture is a separate in-memory N0 frame with the N2 options, so digests stay comparable with the reference store |
| The B2 capture path consults no protected-surface guard in the code read for this plan. Whether a protected-login step or handoff can reach it is **not verified** here | `StepExecutor.captureFailureEvidence` | N5.2 audits it and reports the result. A confirmed gap is filed as its own defect and is **not** fixed inside N5 (no production change outside N5's own path) |
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
| Calibration facts that bound what pixels can say: N2.3 found no separation between look-alikes and real contradictions; N3.2 saw 28 false `agreed` on headless twins (position-dependent bytes); N4.5 saw a headed recording never byte-identical to a headless crop (recall 0/36) | `N2.3-fusion-calibration.md`, `N3.2-agreement-calibration.md`, N4 plan › N4.5 | Twins, swap and restyle must degrade to `ambiguous` or `inconclusive`. Cross-mode comparison is refused (VD-9). N5.6 recalibrates every code before the UI shows it (VD-10) |
| Mock-site labs `/visual-intelligence` (frames, popup, account, protected injection) and `/visual-intelligence/fusion` (`vf-tool-0..3`, baseline, restyle, swap, twins, theme, drift, `wide`, `injectProtected`, `vf-offscreen-tool`) | `mock-site/` | N5 extends these labs; it adds failure states, not new pages, where it can |

## Reusable capabilities versus N5 gaps

| Need | Already exists (reuse unchanged) | N5 gap |
|---|---|---|
| Failure moment and kind | `FlowExecutor` retry loop, `RunnerFailureKind`, L5a `runner.failure` | A hook **after** the final retry decision that cannot reach the decision |
| Page-derived failure evidence | B2 screenshot/DOM/a11y/meta, L5a events and cause baseline | None. N5 adds no new page text or file |
| Protected / handoff exclusion | `pageHandedOff`, N0 `checkProtectedSurface` before and after, protected-login step types | Wiring them into the N5 path, with an audit of the B2 path (report only) |
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
- Fixing an unrelated B2 protected-capture gap if N5.2 confirms one (it is filed separately).

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
4. **DOM facts (read-only, no action).** The step's own locator through its frame chain: match count (0, 1, many,
   capped), and for each DOM-named target (the step's matches up to the cap, then the recovery decision's existing
   contenders if the failure came from recovery): in-viewport, zero-size, and whether `elementsFromPoint` at its
   centre returns the target or one of its descendants (`occluded` otherwise). No hover, focus, scroll, click or
   evaluate that mutates.
5. **One capture.** If any DOM-named target is in the viewport and conditions match the reference (VD-9), one N0
   frame with the N2 runtime options, then crops of those targets only, then N1 fingerprints. N0 re-checks the
   protected surface after capture; a hit discards everything and answers `protected-surface`. The frame is released
   immediately; no pixels outlive the call.
6. **Decide.** `decideVisualDiagnosis(input)` is pure: input is the reference presence and conditions, the
   per-target comparison outcomes and geometry facts, and the viewport uniformity statistic; output is
   `{ version, observations: Code[], referenceSource, conditions, basis }` with **no** element index, locator,
   score detail beyond bucketed similarity, or effect.
7. **Record.** The adapter returns the verdict; the executor attaches it to the failure; the report writer stores a
   sanitized copy as `InstanceReport.diagnostics.visualDiagnosis[]` (one entry per finally failed step, capped).
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
             DOM facts: count, in-viewport, zero-size, occluded (read-only)
             N0 frame (protected before + after) -> crops of DOM-named targets -> N1 fingerprints
             decideVisualDiagnosis (pure) -> codes
        -> attached to the failure record (never to status, error, retry, cause)
ExecutionReport -> InstanceReport.diagnostics.visualDiagnosis[] (sanitized, codes only)
reports:get [PAGE_REPORTS] -> FailureEvidenceSection -> "Visual diagnosis" (text only)
```

## Diagnosis vocabulary (proposed; final set fixed in N5.2, pruned by N5.6)

Observation codes are facts about the moment of failure, never causes and never instructions.

| Code | Meaning | Basis |
|---|---|---|
| `reference-unavailable` | No last-known-good reference for this step | store `missing`, `corrupt` or `version-mismatch` |
| `conditions-changed` | A reference exists but cannot be compared: DPR, zoom, viewport or render mode differs | VD-9, N0 conditions, N4.5 |
| `target-not-in-dom` | The step's locator matched no element | DOM count 0 |
| `target-not-unique` | The step's locator matched more than one element | DOM count > 1 |
| `target-offscreen` | The DOM-named target is outside the viewport | bounding box |
| `target-zero-size` | The DOM-named target has no area | bounding box |
| `target-occluded` | Another element is topmost at the target's centre | `elementsFromPoint` |
| `target-appearance-unchanged` | The single DOM-named target is identical to the reference | N1 identical |
| `target-appearance-changed` | The single DOM-named target differs from the reference | N1 not identical |
| `reference-seen-on-other-element` | Exactly one **other** DOM-named element is identical to the reference, and the step's own target is absent or different | N1 identical, uniqueness proven among DOM-named crops |
| `reference-seen-ambiguous` | Two or more DOM-named elements are identical to the reference (twins) | N1, N3.2 twins hazard |
| `viewport-uniform` | The viewport fingerprint is near-uniform (blank or unpainted) | N1 luma statistics, threshold from N5.6 |
| `inconclusive` | A comparison ran but no calibrated code applies, or a code was pruned by N5.6 | VD-10 |

Refusal codes (no capture ran): `not-eligible`, `sensitive`, `handoff-active`, `protected-surface`, `page-closed`,
`coalesced`, `budget-exhausted`, `capture-failed`. An unknown code maps to `capture-failed`, never to an observation.

`reference-seen-on-other-element` is the one code that could be read as "the right element is over there". It is
never accompanied by an index, selector, coordinate or highlight, its fixed text says no element can be named for
action, it is suppressed whenever the comparison is not same-mode and same-conditions, and N5.6 must show zero false
attributions on swap, restyle and twins before the UI may show it (VD-10).

## Persistence

- **Location:** `InstanceReport.diagnostics.visualDiagnosis?: VisualDiagnosisRecord[]` in the existing run report,
  optional and additive. Old reports load unchanged; the field is absent when the feature is off or nothing failed.
- **Record:** `{ version: 1, stepId, attempt, failureKind, referenceSource, conditions: code, observations: code[],
  similarity?: "identical" | "near" | "far", ms }`. Bounded: at most 8 observations per record and at most a capped
  number of records per instance (fixed in N5.4).
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
- **B2 audit.** N5.2 reports whether the existing B2 full-page failure screenshot can capture a protected surface.
  N5 does not change B2. A confirmed gap becomes its own defect bead and KNOWN_ISSUES entry for an owner decision.

## Headed and headless

A comparison is only made when the reference's recorded conditions (DPR, zoom, viewport, render mode) equal the
failed page's. Otherwise the code is `conditions-changed` and no similarity is reported. N4.5 showed a headed
recording is never byte-identical to a headless crop, and N3.2 showed headless twins render with position-dependent
bytes, so identity-based codes are the ones most at risk; N5.6 measures each code headed and headless at DPR 1, 1.25
and 2 on fresh launches. If the reference record lacks a field needed to prove equal conditions, N5.2 records it and
the comparison is refused for that field (never assumed equal).

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
- **Final failure:** one reference read pair (runtime, then recorded), one DOM probe, at most one N0 frame and
  `VISUAL_FANOUT_MAX_CANDIDATES` crops, under a per-failure deadline. Provisional ceiling **1000 ms**, fixed from N5.6
  measurement (VD-8); overrun answers `budget-exhausted` and never delays teardown beyond the deadline.
- **Concurrency:** through the existing screenshot limiter. A per-execution cap per signature (flow, step, failure
  kind) bounds a data-driven run that fails the same way 500 times; the remainder record `coalesced`.
- **Disk:** a few hundred bytes per finally failed step, inside the report.

## Accessibility and UI

- A fourth section in the drawer, titled *Visual diagnosis*, after *Captured evidence* and before *AI analysis*,
  shown only when the report carries the block. Never merged with the other sections.
- Each observation is a sentence of fixed text plus an `aria-hidden` icon, never colour alone. The section states its
  basis ("compared with the reference from the last passing run" / "…from the Recorder" / "no reference").
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
- **Recommended:** the reference read **read-only** with N4.6 precedence (runtime, then recorded under
  `AWKIT_VISUAL_RECORDER=manual` for the current binding); one fresh N0 frame with the N2 runtime options; crops of
  **DOM-named** targets only (the step locator's matches, then the recovery decision's existing contenders), capped
  at `VISUAL_FANOUT_MAX_CANDIDATES`. No page-wide search. N5 never writes, refreshes or deletes a reference.
- **Alternatives:** (a) template-search the whole screenshot for the reference, which locates a target by pixels
  and reproduces the twins hazard; (b) decode the existing B2 full-page PNG instead of a fresh frame, which has
  different capture options (digests not comparable) and is not protected-guarded; (c) let a passing comparison
  refresh the runtime reference, which writes from a failure path.
- **Consequence:** N5 says nothing about elements the DOM did not name.
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
  from N5.6 measurement; captures through the existing screenshot limiter; a per-execution cap per (flow, step,
  failure kind) signature, provisional 20, after which entries record `coalesced`.
- **Alternatives:** (a) no cap, so a 500-row failing run captures 500 times; (b) share the FD-5 400 ms attempt
  budget, which would make N5 compete with J9 inside an attempt.
- **Consequence:** bounded, measured, and never on the happy path.
- **Why needed:** it is a runtime-cost commitment on every failing run.

### VD-9 — Conditions and render mode

- **Decision:** when a comparison is allowed.
- **Recommended:** only when DPR, zoom, viewport and render mode (headed/headless) equal the reference's; otherwise
  `conditions-changed` with no similarity. Never infer across modes.
- **Alternatives:** (a) compare across modes with a looser threshold, which N3.2 and N4.5 showed produces false
  identity or no recall.
- **Consequence:** less coverage, no false identity from rendering differences.
- **Why needed:** it fixes the trust model for identity codes.

### VD-10 — Calibration gate and fallback

- **Decision:** what must be measured before the UI shows a code.
- **Recommended:** N5.6 runs every code headed and headless at DPR 1, 1.25 and 2 on fresh launches over the
  mock-site failure states. Pre-agreed criterion: **zero** false `reference-seen-on-other-element` on swap, restyle
  and twins; **zero** observations on protected, handoff and sensitive fixtures; geometry codes agree with the
  fixture truth in every cell; p95 cost within the VD-8 deadline; zero visual work on passing runs. A code that
  fails is pruned to `inconclusive` before N5.5 exposes it. If identity codes all fail, N5 closes **geometry and
  refusal codes only**; if geometry codes also fail, N5 closes **report-only** (no UI).
- **Alternatives:** (a) ship the vocabulary uncalibrated; (b) block N5 entirely on any failed code.
- **Consequence:** the same fallback pattern N2, N3 and N4 used.
- **Why needed:** it fixes the acceptance rule before any measurement.

## Work breakdown

| Item | Bead | Owner | Depends on | Delivers | Acceptance |
|---|---|---|---|---|---|
| N5.1 Owner decisions | `awkit-vra.14.1` | owner | — | VD-0 to VD-10 recorded in DECISIONS, the isolation amendment, N5 authorization | DECISIONS entry naming each VD approved, amended or rejected. Plan status updated |
| N5.2 Pure diagnosis policy and baseline audit | `awkit-vra.14.2` | software, qa | N5.1 | `decideVisualDiagnosis` with its closed vocabulary; the reference-conditions field audit; the B2 protected-capture audit report | New `verify:visual-diagnosis` with a mutation contract (twins as other-element, conditions check skipped, an index or selector field added, unknown code as observation). Build |
| N5.3 Runner adapter, hook and isolation | `awkit-vra.14.3` | backend, qa, recorder-playwright | N5.2 | `VisualFailureDiagnosis` (third edge), the final-attempt hook, read-only reader, DOM facts, refusals, budget, cap, mock-site failure states | New `verify:visual-diagnosis-runtime` (real Chromium): runner A/B identical on/off, zero work on passing steps and non-final attempts, protected/handoff/sensitive refusals with zero captures, store bytes unchanged, mutation contract. `verify:visual-isolation` exact three edges, fourth-edge mutation red. `verify:mock-site`. Build |
| N5.4 Report record and sanitizer | `awkit-vra.14.4` | data-persistence, backend | N5.3 | The additive `visualDiagnosis` block, sanitizer, caps | Old reports load; key allowlist; run history unchanged; FlowProfile and export byte-identical; `verify:recovery-provenance`, `verify:ai-error-analysis` (L5b request bytes unchanged). Build |
| N5.5 Report section | `awkit-vra.14.5` | frontend, ui-designer | N5.4, N5.6 | The *Visual diagnosis* drawer section for calibrated codes only | New `verify:visual-diagnosis-gui` (real Electron: text, focus, absence, reduced motion), `verify:ai-assist-gui` unchanged. Build. **Report-only if N5.6 prunes everything** |
| N5.6 Calibration | `awkit-vra.14.6` | qa, recorder-playwright | N5.3 | Informational `benchmark:visual-diagnosis`: every code headed and headless, DPR 1/1.25/2, fresh launches; cost | VD-10 criterion reported as met or not per code; pruned codes recorded |
| N5.7 State, docs, QC, closure | `awkit-vra.14.7` | project-state, qc, security (review) | N5.5 | State docs, ARCHITECTURE, DECISIONS outcome, independent QC, security review, dashboard repin | QC APPROVED with findings closed. Sources agree. Build |

### Dependency chain

```text
awkit-vra.12 (N2, closed) --+
awkit-vra.4  (N3, closed) --+--> awkit-vra.14 (N5)
awkit-vra.13 (N4, closed) --+
N5.1 --> N5.2 --> N5.3 --+--> N5.4 --+
                         |           +--> N5.5 --> N5.7
                         +--> N5.6 --+
```

N5.5 depends on N5.4 and N5.6. If N5.6 prunes every code, N5.5 is recorded as deferred and N5.7 may close N5
report-only.

## Verification and independent QC matrix

| Gate | Item | Type | What it proves | Mutations that must be observed red |
|---|---|---|---|---|
| `verify:visual-diagnosis` (new) | N5.2 | pure | Closed vocabulary; twins give `reference-seen-ambiguous`; conditions mismatch gives `conditions-changed`; no reference gives `reference-unavailable`; output has no index, locator, coordinate or effect | twins reported as `reference-seen-on-other-element`; conditions check removed; an index field added; unknown code mapped to an observation |
| `verify:visual-diagnosis-runtime` (new) | N5.3 | real Chromium, mock-site | A/B identical: step status, error, attempts, retries, `nextStepId`, run status, L5a cause and evidence ids, B2 files; zero captures on passing steps and non-final attempts; refusals with zero captures on protected, handoff, sensitive; store files byte-identical; recorded reference read only under the N4 flag; budget and cap | diagnose passing steps; diagnose before the retry decision; skip the after-capture protected check; pass `allowProtected`; write or refresh a reference; let the verdict change status or cause; drop the cap |
| `verify:visual-isolation` | N5.3 | static walk | Exactly three edges; renderer walk clean | a fourth edge; the report types importing `src/visual` |
| Report contract checks | N5.4 | unit + real store | Additive field; old reports load; sanitizer; key allowlist; caps; run history columns unchanged; FlowProfile/export bytes unchanged; L5b request bytes unchanged | a pixel/digest/selector key admitted; sanitizer bypassed; field written into the FlowProfile |
| `verify:visual-diagnosis-gui` (new) | N5.5 | real Electron | Section text and basis, caveat, absence when the field is absent, focus by containment with real `Tab`, reduced motion, no image element | section rendered with no data; colour-only status; an `<img>` or canvas in the section |
| `benchmark:visual-diagnosis` (new, informational) | N5.6 | real Chromium | Per-code truth table headed/headless × DPR; cost; VD-10 criterion | — (benchmarks are never release gates) |
| Existing, must stay green | N5.3-N5.7 | — | `verify:visual-capture`, `verify:visual-fingerprint`, `verify:visual-fusion`, `verify:visual-fusion-runtime`, `verify:visual-agreement`, `verify:visual-agreement-runtime`, `verify:recorded-visual-fallback`, `verify:runner`, `verify:locator-guard`, `verify:recovery-provenance`, `verify:twin-pool-safety`, `verify:ai-error-analysis`, `verify:ai-assist-gui`, `verify:mock-site`, `typecheck:scripts`, `npm run build`; `validate:offline` once if a bundle boundary moves | — |
| Independent QC | N5.7 | fresh-context `awkit-qc-reviewer` | Criteria 1-10 below, with focus on authority (VD-0), the protected boundary and the A/B neutrality proof | — |
| Security review | N5.7 | `awkit-security-engineer` (review) | Protected-login, handoff, sensitive exclusion, redaction, no pixel IPC, B2 audit disposition | — |

Every new `verify:*` and `benchmark:*` script is registered in `scripts/lib/verifier-classification.ts` in the item
that adds it. Mutation contracts are written **after** each mutation is run and its observed result recorded.
Rules carried from earlier phases: pair every `.every()` with a cardinality assertion; never use
`waitForFunction(async …)` or `isVisible({ timeout })` as a wait; assert the precondition before what it gates;
`page.evaluate` bodies avoid named inner functions; capture only installs on a real navigation, not `setContent`.

**Mock-site.** Extend `/visual-intelligence/fusion` rather than adding pages, with failure states that each have a
stable URL, title, expected behaviour and `data-testid` selectors: target detached after the reference pass,
target restyled, swapped, twins, an overlay covering the target, target scrolled offscreen, a zero-size target, a
uniform (blank) viewport, and the existing protected injection. Each is covered by `verify:mock-site` and listed in
the mock-site docs.

## Completion criteria

N5 closes when every item holds, or is truthfully recorded as deferred:

1. VD-0 to VD-10 are recorded by the owner, and N5 was authorized before any code landed.
2. `verify:visual-isolation` passes with exactly the approved edges, and its fourth-edge mutation is red.
3. `verify:visual-diagnosis` passes with its mutation contract.
4. `verify:visual-diagnosis-runtime` proves runner A/B neutrality, zero visual work on passing steps and non-final
   attempts, every protected, handoff and sensitive refusal on a fixture, and an unchanged reference store.
5. No FlowProfile, export, run-history column, L5a event, L5a cause, L5b request, reference record or IPC payload
   carries N5 data beyond the codes-only report block, proven by byte-identity and allowlist checks.
6. N5.6 measurements are recorded and the VD-10 criterion is reported per code; pruned codes are recorded.
7. The report section passes its GUI verifier, or is deferred with N5 closing report-only.
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
| An operator reads `reference-seen-on-other-element` as "use that element" | No index or highlight; fixed caveat text; VD-10 zero-false-attribution gate; pruned to `inconclusive` if it fails |
| Headless position-dependent rasterization (N3.2) makes twins look unique | `reference-seen-ambiguous` requires uniqueness only among DOM-named crops; N5.6 twins cells headed and headless |
| Headed references never match headless crops (N4.5) | VD-9 refuses cross-mode comparison as `conditions-changed` |
| The diagnosis slows down failing data-driven runs | Final-attempt only, deadline, limiter, per-signature cap, measured in N5.6 |
| A capture on a page that became protected after the check | N0 after-capture check discards the frame and answers `protected-surface` |
| The B2 path may capture protected pages today (unverified) | Audited in N5.2 and filed separately; N5 does not widen it and never reads its files |
| Failure state changes between the final attempt and the diagnosis (late network, animations) | The diagnosis runs immediately after the decision; it reports what it saw with `ms`; animations are not disabled (RV-7 precedent) |
| Isolation amendment widens drift | Exact-set pinning with a fourth-edge mutation |
| Reference records lack a field needed to prove equal conditions | N5.2 audit; refuse rather than assume |

## Exact next implementation task (pending owner approval)

1. **Owner:** record VD-0 to VD-10 (approved, amended or rejected) and authorize N5. That closes N5.1
   (`awkit-vra.14.1`).
2. **Then, and only then, N5.2 (`awkit-vra.14.2`):** add the pure `src/visual/diagnosis/decideVisualDiagnosis.ts`
   with its closed vocabulary, exported through `src/visual/index.ts`, with no runner, recorder, IPC, report or UI
   change; add `verify:visual-diagnosis` (pure, mutation contract observed red), register it in
   `scripts/lib/verifier-classification.ts`, and record two audits in this plan: the reference record's
   condition fields (VD-9) and whether the B2 failure screenshot can capture a protected surface. Gates:
   `verify:visual-diagnosis`, `verify:visual-isolation` (unchanged at two edges, since no adapter lands in N5.2),
   `typecheck:scripts`, `npm run build`, `verify:verifier-classification`, `verify:roadmap-dashboard`.
