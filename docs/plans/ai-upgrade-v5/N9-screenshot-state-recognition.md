# N9 — Screenshot State Recognition (`awkit-vra.11`)

- **Status:** IN PROGRESS, 2026-10-31. Decisions NS-0 to NS-4 RATIFIED (DECISIONS 2026-10-31). Contract
  `awkit-vra-phase-n-completion-1031`.
- **Scope:** deterministic, advisory evidence about what a failed step's page looked like (`loading`, `empty`,
  `error`, `ready` or `unknown`). It goes into the N5 Visual Failure Diagnosis record as codes only, with effect
  `none`.

## 1. Ratified boundaries (NS-0 to NS-4)

| ID | Rule | How this plan meets it |
|---|---|---|
| NS-0 | Legacy `.3` edge removal accepted | No edge work. The `.3` state-recognition obligation lands here (legacy coverage matrix) |
| NS-1 | Deterministic only, no model | Integer pixel features and fixed rules in `src/visual/state/`. No model, OCR or network |
| NS-2 | N5 diagnosis evidence only | Runs only inside an observed N5 diagnosis (`VisualFailureDiagnosis`), after the N5 verdict is decided. Adds one `visual-state-*` code to the record's observations. Smart Wait, the step, its error, retries, branches and the run outcome are untouched |
| NS-3 | Zero false `ready` on loading fixtures; false-`error` ceiling, positive-coverage floor and p95 budget pre-declared; no vacuous all-`unknown` pass | § 5, frozen in § 6 before the qualifying campaign |
| NS-4 | No N7 dependency | N9 never calls the OCR text signal and works with OCR off or absent |

Inherited and not re-decided:
- the N0 protected boundary, enforced in the strict capture window;
- I5 handoff fail-closed;
- the N5 eligibility, sensitive and coalescing rules;
- codes only (no pixels, text or coordinates persisted);
- offline;
- `verify:visual-isolation`.

## 2. Architecture

- **Pure library (`src/visual/state/visualState.ts`), exported through `src/visual/index.ts`.**
  - `measureVisualStateFrame(image)` returns integer features of one viewport image, plus an in-memory motion plane
    (a downsampled luma grid).
  - `measureVisualMotion(a, b)` compares two motion planes.
  - `decideVisualState({ frame, motion }, policy)` returns `{ state, cues }`.
  - It has no I/O, no Playwright and no clock.
- **No new isolation edge (NR-2/NS-2 reuse).** The N5 adapter `src/runner/visualDiagnosis/VisualFailureDiagnosis.ts`,
  the third approved edge, is the only caller. `verify:visual-isolation` stays at five edges.
- **Enablement.**
  - `AWKIT_VISUAL_STATE=on` turns it on, and only with `AWKIT_VISUAL_DIAGNOSIS=on`. Any other value, or no value, is
    off.
  - `ExecutionEngine` reads the flag (`visualStateMode()` in `visualDiagnosisContract.ts`). The runner passes
    `stateRecognition: true` to the lazily loaded adapter.
  - Off means no feature code runs, no extra frame is taken, the deadline is unchanged, and the record is
    byte-identical to N5's.
- **Frames (design point NS-D1, recorded here because it touches the N5 VD-3 one-frame rule).**
  - With the flag off, VD-3 holds unchanged.
  - With it on, the state uses N5's own guarded frame (features computed before N5 releases it), plus at most ONE
    further guarded N0 viewport frame for motion.
  - Both frames go through `captureVisualFrame` under the runner's screenshot limiter, with the same protected,
    handoff and abort rules, and are released on every path, including late arrival.
  - Motion is the only reliable deterministic cue for spinners and shimmer. Without a second frame, `ready` is never
    claimed (see § 3).
- **Deadline (NS-D2).**
  - With the flag on, the diagnosis deadline is `VISUAL_DIAGNOSIS_DEADLINE_MS + VISUAL_STATE_EXTRA_MS`. The extra
    budget is frozen in § 6.
  - The state step runs only when at least `VISUAL_STATE_MIN_REMAINING_MS` is left. Otherwise it records
    `visual-state-skipped`.
  - A deadline cut keeps N5's existing `budget-exhausted` behaviour.
  - The diagnosis runs after the final attempt failed, so the extra time only delays the report of a failure that has
    already happened. It never changes it.
- **Record.** At most one code, appended after N5's and N7.7's codes within the 8-observation cap:
  - `visual-state-loading`, `-empty`, `-error`, `-ready` or `-unknown`;
  - `visual-state-skipped` when it could not run.

  The N5 sanitizer already admits these (code pattern). Codes whose criterion is NOT MET in § 7 join
  `VISUAL_DIAGNOSIS_PRUNED_CODES`, so viewers see `inconclusive`. The raw code stays stored for recalibration.
- **Renderer.** `VisualDiagnosisSection.tsx` gets fixed text for the six codes. No page content is shown.

## 3. Deterministic classifier (v1)

All integers. The image is the N5 whole-viewport crop (device pixels).

- **Background:** the most frequent luma bucket (64 buckets of 4).
- **Per pixel:**
  - *hard ink:* |luma − background| ≥ 96;
  - *soft ink:* 12 ≤ |luma − background| < 64, with low colour spread (max − min of R, G, B ≤ 24);
  - *edge:* Sobel energy (`edgePlane`, /8 scale) ≥ 40;
  - *red:* R is the largest channel, spread ≥ 64, and |G − B| × 3 ≤ spread (hue within about ±20° of red).
- **Grid:** 8 × 6 cells over the viewport. Each cell is classified as:
  - *text:* edge share ≥ the text threshold;
  - *skeleton:* soft share high, with little edge and hard ink;
  - *red text:* red pixels form most of the cell's hard ink, with text-like edges;
  - *red fill:* a large red share (a red block: a button, brand bar or toast, never an error cue alone);
  - *blank.*
- **Motion:**
  - each frame is downsampled to a luma grid of about 8 × 8 device-pixel cells;
  - a motion cell differs by ≥ 8 between the frames;
  - the cue is motion cells as a share of all cells. A different viewport size means motion is unmeasured.
- **Rules, in order (first match wins):**
  1. Motion measured, with some motion cells:
     - more than the widespread share → `unknown` (`motion-widespread`, a re-render, scroll or navigation);
     - otherwise → `loading` (`motion`).
  2. Skeleton cells ≥ the minimum and ≥ the text cells → `loading` (`skeleton`).
  3. Red-text cells ≥ 1 and red share of all edge ink ≥ the minimum → `error` (`error-colour`).
  4. No text, skeleton or red cell → `unknown` (`blank`).
  5. Text cells ≤ the empty maximum, all within one compact cluster → `empty` (`sparse-content`).
  6. Motion not measured → `unknown` (`motion-unmeasured`). **`ready` is never claimed without a static second
     frame.**
  7. Text cells ≥ the ready minimum → `ready` (`dense-content`).
  8. Otherwise → `unknown`.

`unknown` is the default. The thresholds start at the values in `DEVELOPMENT_VISUAL_STATE_POLICY`. The baseline (§ 6)
may adjust them on development fixtures only. They are then frozen as `MEASURED_VISUAL_STATE_POLICY` before
qualification and not changed afterwards.

## 4. Test Lab

`/visual-intelligence/state`, title "Visual State Lab", sized for 800 × 600:

- `window.__stateLab.show(id, variant)` renders one fixture deterministically, waits two animation frames, and sets
  `st-stage[data-shown]`.
- The fixture table is served at `/visual-intelligence/state-fixtures.json`.
- Variant `a` is development only. Variants `b`, `c` and `d` are held out for qualification. They differ in palette,
  sizes, positions and counts, drawn from fixed tables (no randomness).
- No credential field outside the protected fixture. No external asset.
- Stable selectors: `st-stage`, `st-missing-target` (never rendered, the failing step's target), and
  `data-testid`s per region.

Fixture classes (truth label, in brackets; † marks adversarial negatives):

- **loading:**
  - `spinner`, `spinner-overlay` (a spinner over rendered rows), `skeleton-shimmer`, `skeleton-static`;
  - `partial-skeleton` (two real rows, then shimmer rows), `progress-indeterminate`, `loading-dots`;
  - `skeleton-dark`† (darker static skeleton blocks that look content-like);
  - `spinner-paused`† (`animation: none`, the reduced-motion case).
- **empty:** `empty-illustration`, `empty-text`, `empty-table` (a header row and a "no records" line).
- **error:** `error-banner`, `error-inline` (a form with red field-error text), `error-page`, `error-toast` (a solid
  red toast over rows).
- **ready:**
  - `ready-table`, `ready-cards`, `ready-form`, `ready-article`;
  - `ready-red-accent`† (red Delete buttons), `ready-red-brand`† (a red brand bar), `ready-red-amounts`† (a few red
    figures in a table), `ready-gray-media`† (static gray image placeholders), `ready-live-badge`† (a pulsing "Live"
    dot).
- **unknown:** `blank` (a white page).
- **refusal:** `protected` (one password form: protected-surface, zero frames).

## 5. Acceptance contract (structure pre-declared; numbers frozen in § 6 before qualification)

| ID | Criterion | Measured on |
|---|---|---|
| S-1 | **Zero** `ready` on any loading-truth trial, including † loading fixtures | Qualification, every cell |
| S-2 | False `error` (truth ≠ error, decided `error`) ≤ the ceiling `E` over non-error trials, **and** no single non-error fixture decided `error` in more than one third of its trials | Qualification, every cell |
| S-3 | Positive-coverage floor: for each state in {loading, empty, error, ready}, recall ≥ the floor `F_state` | Qualification, pooled per cell |
| S-4 | Not vacuous: non-`unknown` decisions ≥ `F_any` of positive-truth trials. The all-`unknown` classifier fails S-3 and S-4 by construction (checked by the verifier) | Qualification |
| S-5 | p95 of the time the state work adds to a diagnosis (frame-1 features, the interval wait, the second frame and its motion plane, timed inside the adapter) ≤ budget `B` ms, and no record arriving after the deadline | Qualification |
| S-6 | Protected, handed-off and sensitive cases: zero frames, no state code | Verifier (zero-capture counters) |
| S-7 | Flag off: byte-identical N5 record, one frame at most, unchanged deadline; step result, error, attempts and page untouched (A/B) | Verifier |
| S-8 | `verify:visual-isolation` passes unchanged at five edges; no new dependency, asset or network | Verifier |
| S-9 | Independent QC and security review | Review |

A state whose S-2 or S-3 criterion is missed is recorded **NOT MET**. Its code is pruned from exposure, and the
threshold is not relaxed after qualification. S-1 is a hard gate: a single violation is NOT MET for the whole
milestone, and every state code is pruned until a fixed policy passes a fresh qualification.

Cells: headless and headed × DPR 1, 1.25 and 2. A cell that cannot run (no display for headed) is BLOCKED and not
counted as passing.

## 6. Baseline and frozen criteria (2026-10-31, before any qualification trial)

The baseline ran `npm run benchmark:visual-state`: development variant `a`, headless at DPR 1, 1.25 and 2, two trials
each, 162 trials, through the real N5 adapter, N0 capture and Chromium. Evidence: `evidence/N9-baseline.json`.

**First pass (plan § 3 starting policy).** It found four defects:
- Header text broke every `empty` fixture (0/18).
- Red Delete buttons were decided `error` (6/6), a false error.
- Gray image placeholders read as a skeleton (4/6, false loading).
- Feature extraction at full device resolution cost a p95 of 795 ms.

**Revision (development data only).** Five changes:
- a chrome band (the top 12.5 %) excluded from the content counts;
- an 8 × 8 grid;
- content text *lines* (bands of edge ink) as the empty/ready discriminator;
- red text counted only as thin strokes (`redCore × 4 ≤ redStroke`, strokes ≥ half the cell's ink), so solid red
  blocks are never an error cue;
- features taken at about CSS resolution (every second pixel at DPR ≥ 1.75), and the second frame computing only
  its motion plane.

`ready` still needs a measured, static second frame.

**Second pass (the frozen policy).**

| Truth | Trials | Decided correctly | Other decisions |
|---|---|---|---|
| loading | 54 | 45 (833‰) | `empty` 9 (`loading-dots` 3, `spinner-paused` 6), **`ready` 0** |
| empty | 18 | 18 (1000‰) | — |
| error | 24 | 18 (750‰) | `ready` 6 (`error-toast`: a solid red block is deliberately not an error cue) |
| ready | 54 | 48 (888‰) | `loading` 6 (`ready-live-badge`: its pulsing dot is motion) |
| unknown (`blank`) | 6 | 6 | — |

- False `error`: 0 of 132 non-error trials.
- Protected: 6 trials, zero frames and no state code.
- State work: p95 471 ms (max 1047 ms). The whole diagnosis p95 is 894 ms against the 1600 ms deadline.

Known limits accepted at freeze:
- An animated element on a ready page reads `loading`. Any motion is `loading`, which is the zero-false-`ready` side.
- A solid red toast is not detected.
- A paused spinner reads `empty`.

**Frozen (code: `MEASURED_VISUAL_STATE_POLICY` in `src/visual/state/visualState.ts`, `N9_FROZEN_CRITERIA` in
`scripts/lib/visual-state-criteria.mts`):**

| ID | Frozen number |
|---|---|
| S-1 | 0 `ready` on loading-truth trials, in every cell |
| S-2 | false `error` ≤ 20‰ of non-error trials, and ≤ 333‰ for any single non-error fixture |
| S-3 | recall floors: loading ≥ 700‰, empty ≥ 600‰, error ≥ 600‰, ready ≥ 700‰ |
| S-4 | non-`unknown` decisions ≥ 750‰ of positive-truth trials |
| S-5 | state-work p95 ≤ 600 ms (= `VISUAL_STATE_EXTRA_MS`), zero late records |

Deadline: `VISUAL_DIAGNOSIS_DEADLINE_MS + VISUAL_STATE_EXTRA_MS` = 1600 ms with the flag on.
`VISUAL_STATE_MIN_REMAINING_MS` = 200 ms and `VISUAL_STATE_INTERVAL_MS` = 120 ms. An all-`unknown` classifier fails
S-3 and S-4 (proven by `verify:visual-state`).

## 7. Qualification results

### Campaign 1 (2026-10-31, frozen policy and criteria, commit `bb7e786`)

`npm run benchmark:visual-state:qualify-headless` and `:qualify-headed` ran held-out variants `b`, `c` and `d`, two
trials each: 972 trials, 936 scored and 36 protected, with every cell RAN. Evidence:
`evidence/N9-qualification-headless.json` and `evidence/N9-qualification-headed.json`.

| Cell | S-1 | S-2 | S-3 loading / empty / error / ready | S-4 | S-5 |
|---|---|---|---|---|---|
| headless@1 | MET (0/54) | MET (0/132) | 777 / 1000 / 666 / 851‰ MET | 986‰ MET | MET (p95 260 ms) |
| headless@1.25 | MET | MET | 888 / 1000 / 666 / 888‰ MET | 1000‰ MET | MET (p95 570 ms) |
| headless@2 | MET | MET | 814 / 1000 / 750 / 907‰ MET | 986‰ MET | **NOT MET** (p95 684 ms > 600) |
| headed@1 | MET | MET | 740 / 1000 / 666 / 851‰ MET | 980‰ MET | **NOT MET** (p95 604 ms, 1 late) |
| headed@1.25 | MET | MET | 833 / 1000 / 666 / 888‰ MET | 1000‰ MET | **NOT MET** (2 late) |
| headed@2 | MET | MET | 814 / 1000 / 750 / 851‰ MET | 966‰ MET | **NOT MET** (2 late) |

- Pooled over 936 scored trials:
  - **0 false `ready`** in 324 loading-truth trials;
  - **0 false `error`** in 792 non-error trials;
  - zero frames and no code in 36 protected trials.
- `error-toast` is missed by design: 0 of 36.
- `ready-live-badge` reads `loading`: 33 of 36.
- **S-5 is NOT MET in 4 of 6 cells.** The thresholds are not changed:
  - five records came back 51 to 102 ms after the 1600 ms deadline;
  - four headed trials were cut by the deadline (`budget-exhausted`, no state code);
  - headless@2 exceeded the 600 ms p95 budget.
- **Cause, diagnosed once.** The synchronous pixel work (N5's fingerprint and crops, and N9's frame-1 features) blocks
  the deadline timer on this ARM64 host, which runs the x64 Node build under emulation. A record can therefore settle
  after its deadline. That breaks N5's own "settles at or before the deadline" contract, so it is a defect, not a
  tuning question.
- **Fix (scheduling only; the policy and criteria are unchanged).** The adapter now yields one macrotask before each
  synchronous state phase, so a due deadline fires first. Frame-1 state features are skipped when less than
  `VISUAL_STATE_MIN_REMAINING_MS` is left. Campaign 2 re-qualifies from scratch.

### Campaign 2 (2026-10-31, after the scheduling fix; same frozen policy and criteria, commit `78864d6`)

The same held-out variants, cells and repeats: 972 trials, 936 scored and 36 protected, with every cell RAN. Evidence:
`evidence/N9-qualification-headless-c2.json` and `evidence/N9-qualification-headed-c2.json`.

| Cell | S-1 | S-2 | S-3 loading / empty / error / ready | S-4 | S-5 |
|---|---|---|---|---|---|
| headless@1 | MET (0/54) | MET (0/132) | 777 / 1000 / 666 / 851‰ | 986‰ | MET (p95 252 ms, 0 late) |
| headless@1.25 | MET | MET | 888 / 1000 / 666 / 888‰ | 1000‰ | MET (p95 478 ms, 0 late) |
| headless@2 | MET | MET | 796 / 1000 / 750 / 851‰ | 980‰ | **NOT MET** (p95 521 ms; 1 record at 1602 ms, 2 ms past the 1600 ms deadline — see the correction below) |
| headed@1 | MET | MET | 777 / 1000 / 666 / 851‰ | 986‰ | MET (p95 246 ms, 0 late) |
| headed@1.25 | MET | MET | 851 / 1000 / 666 / 888‰ | 1000‰ | MET (p95 435 ms, 0 late) |
| headed@2 | MET | MET | 888 / 1000 / 750 / 851‰ | 986‰ | MET (p95 470 ms, 0 late) |

- **Correction (2026-11-01): campaign 2 does NOT fully qualify N9.** The benchmark counted a record as late only
  after the deadline + 50 ms. That grace was never declared in § 5 or § 6, which say "no record arriving after the
  deadline". Read strictly, one headless@2 trial (`skeleton-shimmer`, variant `b`, a deadline cut with no state code)
  returned at 1602 ms: **S-5 is NOT MET in headless@2**. The evidence file is unchanged; only its reading is
  corrected. S-1 to S-4 are MET in all six cells, and S-5 in the other five. N9 stays open for a fresh qualification
  with strict accounting (§ 7, campaign 3) and independent QC.
- Pooled:
  - 0 false `ready` in 324 loading-truth trials;
  - 0 false `error` in 792 non-error trials;
  - 1 record after the strict deadline (+2 ms);
  - one headless deadline cut, with no state code;
  - zero frames and no code in 36 protected trials.
- No code is pruned from exposure.

**What this does and does not claim:**
- The qualification holds on the Visual State Lab's synthetic fixtures and held-out variants, at 800 × 600, in this
  environment (Windows 11 ARM64 in Parallels, approved 2026-10-19).
- No accuracy is claimed for arbitrary production pages.
- Known misses are visible in the table and in § 6: solid red toasts, animated content on ready pages, and paused
  spinners.
- Campaign 1's NOT MET is kept above, and its evidence files are committed beside campaign 2's.

**Verification (final state):**
- `verify:visual-state` 48/0, with a decision mutant (no second-frame guard) red;
- `verify:visual-state-runtime` 26/0;
- `verify:visual-isolation` 117/0, five edges unchanged;
- `verify:visual-diagnosis-runtime` 65/0;
- `verify:ocr-text-signal` 49/0;
- `verify:mock-site` 370/370.

S-8 is met. S-9, the independent QC and security review, is in § 8.

### Campaign 3: joint with N8 (2026-11-01, strict accounting, unchanged frozen policy and criteria)

This ran after the N5 deadline fix (see the N8 plan § 8 for the fix, the strict accounting declared in `32ffca2`, and
the full matrix).
- **Joint campaign 1:** headless cells MET. In the headed cells, S-3 loading, S-4 (headed@2) and S-5 were NOT MET,
  because of background-tab throttling in the harness. Evidence: `evidence/joint/`.
- **Joint campaign 2:** **S-1 to S-5 MET in all six cells**, with N8 enabled at the same time. Evidence:
  `evidence/joint/c2/`.
  - 0 false `ready` in 324 loading trials and 0 false `error` in 792 non-error trials.
  - Recall: loading 814‰, empty 1000‰, error 694‰, ready 864‰. Decided 991‰.
  - State-work p95 378 ms. **0 records after the 1600 ms hard deadline**, with no grace, and 0 cuts.
  - Protected: 72 trials refused with zero frames. Disabled controls clean.
- The earlier NOT MET results (campaign 1 S-5, and the campaign 2 headless@2 strict overrun of +2 ms) stay on record.
  N9 closes only after the fresh independent QC and security review (S-9).
- **Joint campaign 3 (2026-11-01, `3a83c0f`, after the review fixes in the N8 plan § 10):** **S-1 to S-5 MET in all
  six cells.** Evidence: `evidence/joint/c3/`.
  - The fixes that touch N9: a refused record gains no state code (security S1), the state code keeps its
    observation slot (now a behavioural test), and each member crop reserves its measured cost (QC F1).
  - 0 false `ready` in 324 loading trials and 0 false `error` in 792 non-error trials.
  - Recall: loading 811‰, empty 1000‰, error 694‰, ready 867‰. Decided 991‰ (892 of 900).
  - State-work p95 395 ms (cell maximum 463 ms, headed@2). **0 records after the 1600 ms hard deadline, 0 cuts.**
  - Protected: 72 trials refused with zero frames and no code. Disabled controls clean.
  - N5 coverage at 1920 × 1080 (QC F2) is recorded in the N8 plan § 10: with N8 and N9 on, 0 to 5 of 48 trials are
    `budget-exhausted` at DPR 1.5. N5 alone is 48 of 48. That is an owner decision.
- **S-9 (fresh reviews of `3af7ba1`): NOT MET.**
  - QC returned APPROVED WITH FINDINGS and security returned APPROVED WITH FINDINGS. Neither is unconditional, so N9
    stays open.
  - The findings that touch N9: a protected refusal of the second frame keeps the N7.7 and N8 codes (security 2,
    low), and a `CAPTURE_STALE` frame is not treated as a refusal (security 1, low).
  - The full list and dispositions are in the N8 plan § 10.
- **Joint campaign 4 (2026-11-01, `9bda9ee`, after the final remediation in the N8 plan § 11):** **S-1 to S-5 MET in
  all six cells.** Evidence: `evidence/joint/c4/`; campaigns 1 to 3 are untouched.
  - The fixes that touch N9:
    - one advisory refusal boundary: a second frame refused as protected, stale or closed, or one N7.7 refusal,
      withdraws every N7.7, N8 and N9 code of the diagnosis. Before, only the state code became `skipped`;
    - the handoff is rechecked once the advisory work is done;
    - `appendAdvisoryCodes` reserves no slot for a state code the record already has.
  - `verify:visual-state-runtime` case D now expects no state code at all and the N5 record kept.
  - 0 false `ready` in 324 loading trials and 0 false `error` in 792 non-error trials.
  - Recall: loading 805‰, empty 1000‰, error 694‰, ready 864‰. Decided 991‰ (892 of 900).
  - State-work p95 339 ms (cell maximum 394 ms, headless@1). Record p95 635 ms, max 1082 ms. **0 records after the
    1600 ms hard deadline, 0 cuts.**
  - Protected: 72 trials refused with zero frames and no code. Disabled controls: no N8/N9 code, at most one frame,
    none late.
- **Joint campaign 5 (2026-11-01, `c4e91fc`, the final source after the NEW-1 fix in the N8 plan § 11): NOT MET.**
  Evidence: `evidence/joint/c5/`.
  - **N9 results:**
    - five cells meet S-1 to S-5;
    - in **headed@2**, S-3 ready (648‰) and S-5 (2 records after the 1600 ms hard deadline) are NOT MET;
    - the pooled S-5 is NOT MET (p95 387 ms, but 2 late).
  - **What the failure looks like:** all 7 overruns and 32 cuts of that cell fall in one contiguous block of variant-c
    trials. That points to a time-local host slowdown, which is unproven.
  - **What held:** S-1 0 false `ready` in 324; S-2 0 false `error` in 792; protected 72/72 refused.
  - **Handling:** recorded unchanged, with no trial removed and no rerun.
  - The final source is **not** qualified until a fresh full campaign passes.
- **S-9:** NOT MET.
  - Both fresh reviews of `280d9ab`, and both delta reviews of `8f87d15`, returned APPROVED WITH FINDINGS.
  - Before N9 can close: a pre-declared campaign 6 on the final source, the owner's repeat rule, and owner decisions
    on S2, S3 and F2 (N8 plan § 11).
- **Recovery (2026-11-01, N8 plan § 12; DECISIONS 2026-11-01):**
  - the owner's repeat rule needs campaigns 6 **and** 7 on one final revision;
  - the campaign-5 diagnosis is INCONCLUSIVE (`evidence/joint/diagnostic/c5-headed2-d1/`);
  - **joint campaign 6 (`e6f67806`): NOT MET.** headed@2 S-5 fails (p95 631 ms over the 600 ms budget, and 1 record
    after the 1600 ms hard deadline on the cell's first trial, +42.8 ms); the other five cells meet S-1 to S-5;
  - S-1 shows 0 false `ready` and S-2 0 false `error`; protected trials are 72/72 refused;
  - campaign 7 was not run. **N9 stays IN PROGRESS.**
- **Final revision `3e7f884b` (2026-11-06/07; N8 plan § 12):**
  - Campaign 10 NOT MET on headed@2 S-5 only: N9 was skipped when the state-features reserve counted every device
    pixel, while the features analyse every second pixel at DPR 1.75 and above. Fixed in `3e7f884b`.
  - **Campaigns 12 and 13 both PASS S-1 to S-5 in all six cells.** headed@2 S-5 p95 was 417 and 409 ms, with
    0 skipped, 0 late, 0 false `ready` and 0 false `error`. **Technical qualification: PASS.**
  - **S-9: NOT MET.** Security APPROVED (unconditional); QC APPROVED WITH FINDINGS. Findings 1 and 2 are documentation
    corrections. Finding 3 (DPR-2 N5 disabled-control budget exhaustion) and finding 4 (single ARM64 VM, emulated
    x64 Node) are limitations kept under `awkit-vra.18`.
  - N9 closes only after the owner disposes of findings 3 and 4 and QC gives a policy-compliant disposition.
    **N9 stays IN PROGRESS.**
  - **joint campaign 8 (2026-11-02, product source `7a0a9227`): NOT MET.** headless@1 S-5 (p95 783 ms, 1 late) and
    headless@1.25 S-5 (p95 624 ms, 2 late) fail; headed@2 S-5 is now MET (p95 349 ms, 0 late, 0 cuts). S-1 to S-4 are
    MET in every cell. Campaign 9 was not run (N8 plan § 12, `evidence/joint/c8/ANALYSIS.md`). **N9 stays IN PROGRESS.**
