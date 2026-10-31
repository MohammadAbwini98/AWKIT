# N8 — Visual Row/Grid Intelligence (`awkit-vra.10`)

- **Status:** IN PROGRESS, 2026-10-31. Decisions NR-0 to NR-5 RATIFIED (DECISIONS 2026-10-31). Contract
  `awkit-vra-phase-n-completion-1031`.
- **Scope:** deterministic, advisory evidence about the repeated row structure around a failed step's DOM-named
  candidates:
  - whether the rows look alike;
  - whether each candidate visually sits inside its own DOM row;
  - whether some rows were not examined.

  It goes into the N5 diagnosis record as codes only, with effect `none`.

## 1. Ratified boundaries

| ID | Rule | How this plan meets it |
|---|---|---|
| NR-0 | Legacy edge removal accepted | No edge work |
| NR-1 | No N7 dependency | No OCR call. Pixels and DOM geometry only |
| NR-2 | Reuse existing visual infrastructure | It runs inside the existing N5 adapter edge (`VisualFailureDiagnosis`), on N5's own guarded frame. **No new frame, no new adapter, no new isolation edge.** The pure code lives in `src/visual/rows/` behind the public index |
| NR-3 | N2 shadow and N5 codes only, effect `none` | N5 codes only. The N2 shadow stage is **not** wired in this milestone: the ratified rule bounds where evidence may surface and does not require both surfaces. Nothing selects, acts, recovers, branches, retries or changes a result |
| NR-4, NR-5 | Separate measured baseline, then criteria frozen before qualification; zero false row-association claims on adversarial fixtures; ambiguous and unmounted rows stay inconclusive or not examined | § 5 to § 7 |

## 2. Architecture

- **DOM proves the structure; vision only corroborates.**
  - From the first examined main-frame candidate's handle, the adapter reads (no interaction):
    - the closest row element (`tr`, `[role=row]`, `li` or `[role=listitem]`);
    - its parent as the container;
    - the container's row children, at most 64 boxes (`getBoundingClientRect`);
    - the candidate's row index;
    - a declared size (`aria-rowcount` or `aria-setsize`), if any.
  - Each other examined candidate is placed in the same container by DOM ancestry, or marked outside it.
  - There are no page scans, and no container without a DOM row ancestor.
- **Pixels:**
  - one crop of the container from N5's existing frame (in memory, released with the frame);
  - the rows mapped into it;
  - per-band 9 × 8 difference hashes, for the look-alike class;
  - per-candidate checks: the candidate box lies inside its own band and in no other; the band's boundary pixel rows
    are quiet across the candidate's span (no ink crosses the row edge); the candidate's own pixels show ink (it is
    actually visible).
- **Pure decision:** `decideVisualRows(input, policy)` in `src/visual/rows/visualRows.ts` (no I/O, clock or model).
- **Enablement:** `AWKIT_VISUAL_ROWS=on`, only together with `AWKIT_VISUAL_DIAGNOSIS=on` (`visualRowsMode()`).
  - Off means no DOM read and no crop, and the record is byte-identical to N5's.
  - No extra deadline is added: the work is DOM reads and in-memory pixels.
  - It yields to timers before its synchronous work, and is skipped with less than `VISUAL_ROWS_MIN_REMAINING_MS`
    left.
- **Staleness:** the container box is re-measured after the frame. If it moved, every row code becomes inconclusive.
- **Codes:** at most three, appended after N5's (8-observation cap).
  - Structure:
    - `rows-look-alike` (every examined band has a near-identical band);
    - `rows-distinct` (none has);
    - `rows-mixed`;
    - `rows-inconclusive` (fewer than two rows examined, overlapping rows, or a stale container);
    - `rows-not-examined` (no DOM row structure).
  - Association: `row-association-consistent` (every examined candidate in the container passes every check) or
    `row-association-inconclusive`.
  - Coverage: `rows-partly-examined` (declared rows exceed the mounted rows, rows lie outside the viewport, or the
    64-row cap was hit). Unmounted rows are never inferred.

## 3. Test Lab

`/visual-intelligence/rows`, title "Visual Rows Lab", 800 × 600:

- `window.__rowsLab.show(id, variant)`;
- the fixture table at `/visual-intelligence/rows-fixtures.json`;
- variant `a` is development; `b`, `c` and `d` are held out (row heights, counts, palette, target row, font size).

Each fixture marks its target with `data-testid="rw-target"`. A multi-match fixture names every row's action with
`data-testid="rw-action"`.

| Fixture | Truth: association | Truth: structure |
|---|---|---|
| `table-uniform` | consistent | look-alike |
| `table-zebra` | consistent | look-alike |
| `table-distinct` (each row a different colour and layout) | consistent | distinct |
| `list-cards` (`ul > li` cards with gaps) | consistent | look-alike |
| `grid-roles` (`div[role=grid] > div[role=row]`) | consistent | look-alike |
| `no-separators` | consistent | look-alike |
| `multi-match` (every row's action matched) | consistent | look-alike |
| `nested-grid` (the target in an inner table) | consistent (inner rows) | any |
| `rowspan`† (the target centred in a two-row merged cell) | **inconclusive** | any |
| `displaced`† (the target translated into the next row) | **inconclusive** | any |
| `overlay`† (a banner across the target row's edge) | **inconclusive** | any |
| `ghost`† (the target at opacity 0) | **inconclusive** | any |
| `overlapping-rows`† (negative margins) | **inconclusive** | inconclusive |
| `virtualized` (`aria-rowcount` 500, 12 mounted) | consistent + `rows-partly-examined` | any |
| `below-fold` (rows past the viewport) | consistent + `rows-partly-examined` | any |
| `no-rows` (the target outside any row) | none + `rows-not-examined` | not examined |
| `protected` (a password form) | refusal, zero frames | — |

† adversarial.

## 4. Acceptance contract (structure pre-declared; numbers frozen in § 5 before qualification)

| ID | Criterion |
|---|---|
| R-1 | **Zero** `row-association-consistent` on adversarial (†) trials, in every cell |
| R-2 | `row-association-consistent` on ≥ `F_assoc` of consistent-truth trials |
| R-3 | `rows-look-alike` on ≥ `F_alike` of look-alike-truth trials; `rows-look-alike` on ≤ `C_alike` of distinct-truth trials |
| R-4 | `rows-partly-examined` on every virtualized and below-fold trial; `rows-not-examined` on every no-rows trial |
| R-5 | Row-work p95 ≤ `B` ms; zero late records |
| R-6 | Flag off: no row code, byte-identical N5 record, no DOM row read (verifier) |
| R-7 | Protected, handed-off and sensitive: zero frames, no row code (verifier) |
| R-8 | `verify:visual-isolation` unchanged at five edges |
| R-9 | Independent QC and security review |

A missed criterion is recorded NOT MET, and its codes are pruned from exposure. Thresholds are not relaxed after
qualification. R-1 is a hard gate.

## 5. Baseline and frozen criteria (2026-10-31, before any qualification trial)

`npm run benchmark:visual-rows`: development variant `a`, headless at DPR 1, 1.25 and 2, two trials each, 108 trials,
through the real N5 adapter, N0 capture and Chromium. Evidence: `evidence/N8-baseline.json`.

**First passes found two defects (development data only):**
1. Every diagnosis came back `capture-failed`. The page-side DOM read used a named inner arrow function, which the
   `tsx` bundler wraps in a `__name` helper that the page does not have. Fixed: no named inner functions in
   page-side code. A failed row read is also now `rows-not-examined`, and can never break N5's own record.
2. The 9 × 8 difference hash called both `distinct` fixtures look-alike. Replaced with a 32 × 4 luma grid: two bands
   look alike when at most one cell differs by ≥ 96.

**Final development pass (the frozen policy):**

| Measure | Result |
|---|---|
| Adversarial association claims | **0 of 30** (rowspan and displaced: `crosses-row-edge`; overlay: `covered`; ghost: `no-ink`; overlapping-rows: `rows-overlap`) |
| Consistent-truth claimed | 66 of 66 |
| Look-alike recall | 36 of 36 |
| Look-alike on distinct | 0 of 12 (`table-distinct` → `rows-mixed`, `cards-distinct` → `rows-distinct`) |
| Partly examined (virtualized, below-fold) | 12 of 12 |
| Not examined (no-rows) | 6 of 6 |
| Protected | 6 trials, zero frames, no code |
| Row-work p95 | 29 ms (max 44 ms) |

**Frozen (code: `MEASURED_VISUAL_ROWS_POLICY` in `src/visual/rows/visualRows.ts`, `N8_FROZEN_CRITERIA` in
`scripts/lib/visual-rows-criteria.mts`):**

| ID | Frozen number |
|---|---|
| R-1 | 0 `row-association-consistent` on adversarial trials, in every cell |
| R-2 | consistent on ≥ 800‰ of consistent-truth trials |
| R-3 | look-alike recall ≥ 800‰; look-alike on distinct ≤ 100‰ |
| R-4 | 100 % `rows-partly-examined` on partly-truth trials and `rows-not-examined` (with no association code) on no-rows trials |
| R-5 | row-work p95 ≤ 150 ms, zero late records |

Policy: edge tolerance 2 CSS px, minimum row 8 CSS px, look-alike cell delta 96 with at most 1 cell, quiet range 40,
ink range 48. No deadline is added: the N5 deadline stays 1000 ms with only `AWKIT_VISUAL_ROWS=on`.

## 6. Qualification results (2026-10-31, frozen policy and criteria, commit `4de011e`)

`npm run benchmark:visual-rows:qualify-headless` and `:qualify-headed` ran held-out variants `b`, `c` and `d`, two
trials each: 648 trials, 612 scored and 36 protected, with every cell RAN. Evidence:
`evidence/N8-qualification-headless.json` and `evidence/N8-qualification-headed.json`.

| Cell | R-1 | R-2 | R-3 (alike / on distinct) | R-4 | R-5 |
|---|---|---|---|---|---|
| headless@1 | MET (0/30) | MET 66/66 | MET 36/36, 0/12 | MET | MET (p95 24 ms) |
| headless@1.25 | MET | MET 66/66 | MET | MET | MET (p95 23 ms) |
| headless@2 | MET | MET 66/66 | MET | MET | MET (p95 107 ms) |
| headed@1 | MET | MET 66/66 | MET | MET | MET (p95 40 ms) |
| headed@1.25 | MET | MET 66/66 | MET | MET | MET (p95 54 ms) |
| headed@2 | MET | MET 66/66 | MET | **NOT MET** (not-examined 5/6) | **NOT MET** (p95 50 ms, **1 late**) |

- **R-1 holds everywhere: 0 association claims in 180 adversarial trials.** Each was withheld for its designed
  reason: `crosses-row-edge` (rowspan, displaced), `covered` (overlay), `no-ink` (ghost) and `rows-overlap`.
- Over all 612 scored trials:
  - association claimed on 396 of 396 consistent-truth trials;
  - look-alike on 216 of 216 look-alike-truth trials;
  - look-alike on 0 of 72 distinct-truth trials;
  - partly-examined on 72 of 72;
  - zero frames and no code in 36 protected trials.
- **NOT MET (headed@2, one trial):** a `no-rows` diagnosis was cut by N5's own 1000 ms deadline and settled 61 ms
  late, with no row code. N8's work had not run in it (`rowMs` null; for `no-rows` it is one async DOM read). The
  lateness is the pre-existing N5 synchronous frame processing on this ARM64 host emulating x64, the defect class N9's
  campaign 1 exposed. No threshold is changed. As declared in § 4, `rows-not-examined` joins
  `VISUAL_DIAGNOSIS_PRUNED_CODES` (shown as `inconclusive`). R-5 has no code of its own. The N5 deadline-lateness
  defect is filed as a follow-up. Re-qualification after that fix is the path to MET.
- **Scope:** the qualification holds on the Visual Rows Lab's synthetic fixtures at 800 × 600 in this environment.
  N2 shadow wiring is not part of this milestone (§ 1, NR-3).

**Verification (final state):**
- `verify:visual-rows` 45/0;
- `verify:visual-diagnosis-report` 63/0 (pruned set pinned at two);
- `verify:visual-diagnosis-runtime` 65/0;
- `verify:visual-state-runtime` 26/0;
- `verify:visual-isolation` 117/0, five edges unchanged;
- `verify:mock-site` 378/378;
- `verify:verifier-classification` reconciled;
- `npm run build` PASS.

R-6, R-7 and R-8 are met. R-9, the independent QC and security review, is in § 7.

## 7. Independent QC and security review (2026-10-31)

Verdicts: **QC CHANGES REQUIRED**, **security APPROVED WITH FINDINGS**. The reviewer was read-only and did not
review the verifiers' mutation sensitivity, the lab pages or the N9 plan text.

**Fixed after review** (`verify:visual-rows` 48/0, with runtime cases for findings 1 and 4):
1. A stale member makes the rows stale.
2. A member that reaches past its row sideways is withheld.
3. An opacity-0 or hidden member is never on top.
4. `rowFacts` checks the abort signal between page reads.
5. Rows are decided before the frame is released.

**Corrections to § 6:**
- The claim that N8's work "had not run" in the late trial is unsupported: the row DOM read runs before the frame,
  and `rowMs` is null for every cut record. R-5 is NOT MET. The p95 excludes cut trials.
- The benchmarks counted a record as late only after deadline + 50 ms. That grace was **not pre-declared**. Strictly,
  N9 campaign 2 also had one record at 1602 ms (headless@2), so N9 S-5 is NOT MET in that cell.

**Consequence:** the qualification evidence predates these fixes. N8 and N9 both need a fresh qualification campaign
after the N5 deadline-lateness fix (NOT RUN). Neither milestone closes. Finding 5 is also open: the N9 code can be
dropped by the 8-observation cap when both flags are on, and the two were never qualified together.

## 8. Remediation and joint qualification (2026-11-01)

**Recovered:** the staged QC fixes were inspected and committed as `9184fee`. The reviewed diff matched findings 1, 3,
4, 6 and 7.

**N5 deadline fix** (`f5860d1`, `bfd09ef`; `verify:visual-diagnosis-deadline` 23/0):
- The adapter settles at a work budget of `deadline − min(100 ms, deadline / 4)`.
- A result finished past the budget is never published: the monotonic clock decides, and it becomes
  `budget-exhausted`.
- N5's own whole-frame chunk starts only behind a checkpoint. The checkpoint yields to timers, checks the abort
  signal, and requires the budget left to cover the chunk's measured cost (200 ns per device pixel,
  `benchmark:visual-sync-cost`). Otherwise the record is `budget-exhausted`.
- The N8 and N9 extras degrade instead: rows are withheld (no pixels), and motion is left unmeasured.
- Finding 5 is fixed: the N9 code keeps one observation slot, and row codes are trimmed structure-first.
- The verifier reproduces the original defect with margin 0 (back at 1467 ms against a 1400 ms deadline). It proves
  the remedy under the same synchronous block, under background contention, with abort during frame work, with a late
  second frame, and with N8 and N9 together.

**Joint campaigns** (`benchmark:visual-joint`, both features on, deadline 1600 ms). The strict accounting was declared
in commit `32ffca2` before any joint trial: any overrun of the hard deadline is late, and a cut trial counts at the
full deadline in the work-time p95.
- **Campaign 1 (`32ffca2`, evidence `evidence/joint/`):** NOT MET.
  - All headless cells were MET.
  - The headed cells had 20 to 27 N9 cuts on animated loading fixtures: S-3 loading, S-4 (headed@2) and S-5 NOT MET.
  - One disabled control (N5 alone, headed@2) overran its 1000 ms deadline by 62.7 ms.
  - Diagnosed once:
    - The harness kept both labs open in one headed window, and Chromium throttles the background tab.
    - Whole-frame fingerprints cost up to about 216 ms at DPR 2, more than the fixed 50 ms reserve plus the 100 ms
      margin.
- **Campaign 2 (`bfd09ef`, evidence `evidence/joint/c2/`):** the page under test is brought to the front, and the
  reserve is cost-scaled. **PASS: every N8 and N9 criterion is MET in all six cells.**

| Pooled (6 cells) | Result |
|---|---|
| Trials | 972 state, 648 rows, 60 disabled controls |
| Hard-deadline overruns | **0** (record duration p50 460 ms, p95 705 ms, max 1194 ms against 1600) |
| Deadline cuts | 0 |
| N8 R-1 | 0 association claims in 180 adversarial trials |
| N8 R-2 / R-3 / R-4 | 396/396; look-alike 216/216 and 0/72 on distinct; partly 72/72, not-examined 36/36 |
| N8 R-5 | row-work p95 88 ms (cell maximum 118 ms, headed@2) |
| N9 S-1 / S-2 | 0 false `ready` in 324 loading trials; 0 false `error` in 792 non-error trials |
| N9 S-3 / S-4 / S-5 | loading 814‰, empty 1000‰, error 694‰, ready 864‰; 991‰ decided; state-work p95 378 ms |
| Protected | 72 trials, refused, zero frames, no codes |
| Disabled controls | no N8/N9 code, at most one frame, none late |

- `rows-not-examined` is exposed again: R-4 is now met everywhere.
- **Residual risk (recorded, not hidden):** the deadline guarantee rests on measured synchronous costs on this host.
  A stop-the-world pause longer than the 100 ms margin can still delay a settlement, as the 349 ms isolated
  fingerprint outlier at headed@1 shows. If that recurs, the architecture change would be moving whole-frame pixel
  work into a worker thread. It was not needed to pass and is not adopted.
- **Scope:** synthetic lab fixtures at 800 × 600 on this host only. N2 shadow wiring stays out of scope (NR-3).

R-9 is the fresh independent QC and security review, recorded in § 9.

## 9. Fresh independent review at `8bc11df` (2026-11-01) — N8 and N9 stay OPEN

Verdicts: **security CHANGES REQUIRED**, **QC APPROVED WITH FINDINGS**. Neither is unconditional, so R-9 and S-9 are
NOT MET and neither milestone closes. Both reviews were read-only: the reviewers' Bash was blocked by the lease guard,
so they ran no verifiers.

The original QC finding numbers from § 7: 1 stale members, 2 R-5 attribution, 3 sideways overreach, 4 hidden members,
5 observation cap, 6 abort in the row read, 7 crop lifetime, 8 undeclared grace. All eight were re-checked as fixed. 5,
6 and 7 have no behavioural test (QC F6).

| Finding | Severity | Disposition |
|---|---|---|
| S1: a refused record (N0 refused the frame) still gains N7.7, N8 and N9 codes derived from a page N0 just refused, and the renderer shows them as unreadable | medium | **OPEN, fix BLOCKED this session.** Fix: no advisory extra when `verdict.outcome === "refused"`, plus a verifier case. The edit to `VisualFailureDiagnosis.ts` was refused three times by the lease guard while a `.beads/**` tracker lease was held, which made the gate TERMINAL for this session |
| S2: no fresh protected scan right before the N8 DOM row read | low | Reviewer proposes accept. N0 re-checks around each screenshot, and with S1 fixed nothing from such a page is persisted. Optional hardening: re-scan before `rowFacts` |
| S3: container crops may hold card, CVV or token inputs of other rows | info | Reviewer proposes accept as a decision: N0 refuses any page with a password, OTP, webauthn or captcha element; the same pixels are already held by the whole-viewport crop; only fixed codes leave. **Owner decision needed** |
| S4: `occluded()` read failure is fail-open for the row association | info | **OPEN, fix BLOCKED (same file).** Fix: a fail-closed hit test for row facts |
| F1: per-member crop and evidence are not cost-scaled; a viewport-sized match at DPR 2 can overrun the hard deadline | major | **OPEN, fix BLOCKED (same file).** Fix: reserve `visualDiagnosisSyncReserveMs(crop pixels)` per member |
| F2: at 200 ns/px, a 1920×1080 DPR 1.5 viewport (4.7 Mpx) needs about 933 ms, more than N5's 900 ms budget, so core N5 diagnoses become `budget-exhausted` | major | **OPEN, NOT MEASURED.** Qualification ran at 800 × 600 only. Needs N5 coverage measured at realistic viewports, then an owner decision: accept the limit, or move whole-frame pixel work into a worker thread (an architecture change) |
| F3: p95 dropped non-cut trials with no work time | minor | **Fixed** in the harness. Re-aggregated campaign 2 under the stricter rule: still PASS (no such trial) |
| F4: opacity is checked per ancestor, not multiplied | minor | **OPEN, fix BLOCKED (same file)** |
| F5: lateness compared on durations rounded to 0.1 ms | nit | **Fixed** in the harness for later campaigns. Campaign 2's maximum was 1193.7 ms against 1600, so no outcome changes |
| F6: no behavioural tests for findings 5, 6 and 7 | minor | **OPEN** |
| F7: § 7 numbering; re-exposing `rows-not-examined` had no pre-declared rule | nit | Numbering clarified above. The re-exposure stands, and the owner may revert it |

**Consequence:** the joint campaign-2 PASS stays valid evidence for the code at `bfd09ef`. Any product fix above
changes that code, so a fresh joint campaign and a fresh review are required before N8 or N9 can close.

## 10. Review fixes, joint campaign 3 and N5 coverage (2026-11-01)

**Fixes** (`3a83c0f`; no tracker lease held while editing; frozen policies and criteria unchanged):
- **S1:** no N7.7, N8 or N9 code is added when the verdict is `refused`. Verifier case: a password form injected at the
  `before-frame` hold. The record is exactly `["protected-surface"]`, with zero frames and no row or state code.
- **S4:** the row facts' hit test fails closed: a read error or a missing view counts as covered. N5's own target fact
  is unchanged.
- **F1:** each member's crop and evidence run behind a checkpoint that reserves
  `visualDiagnosisSyncReserveMs(element + padded context device pixels)`, not the fixed 50 ms.
- **F4:** opacity is multiplied up the ancestor chain. An unreadable value fails closed. Verifier case: 0.2 × 0.2.
- **F6:** behavioural tests for:
  - finding 5: `appendAdvisoryCodes` (the state slot, structure-first trim, cap, no repeats);
  - finding 6: a cut while the page is busy inside the first row read. A new abort check means exactly one row read
    reaches the page;
  - finding 7: a verifier-only `onRowCrop` probe shows the crop dropped before the frame is released, also after a
    cut while the frame is held.
- **Red proof:** with S1, F4 and the abort check reverted, `verify:visual-rows` failed exactly those three new checks
  (52/3). S1 leaked `row-association-inconclusive`, `rows-inconclusive` and `visual-state-skipped` onto a refused
  record.

**Verification (final code):** build PASS. `verify:visual-rows` 55/0, `verify:visual-diagnosis-deadline` 27/0,
`verify:visual-state-runtime` 26/0, `verify:visual-diagnosis-runtime` 65/0, `verify:visual-isolation` 117/0.

**Joint campaign 3** (`3a83c0f`, evidence `evidence/joint/c3/`, the same strict accounting and frozen criteria):
**PASS: every N8 and N9 criterion is MET in all six cells.**

| Cell | Record p95 / max (ms) | N9 S-3 loading / empty / error / ready | S-4 | S-5 p95 | R-5 p95 |
|---|---|---|---|---|---|
| headless@1 | 483 / 685 | 777 / 1000 / 666 / 851‰ | 986‰ | 252 ms | 42 ms |
| headless@1.25 | 618 / 962 | 851 / 1000 / 666 / 888‰ | 1000‰ | 344 ms | 41 ms |
| headless@2 | 866 / 1131 | 833 / 1000 / 750 / 851‰ | 986‰ | 418 ms | 51 ms |
| headed@1 | 731 / 1046 | 777 / 1000 / 666 / 870‰ | 986‰ | 443 ms | 36 ms |
| headed@1.25 | 459 / 1007 | 777 / 1000 / 666 / 888‰ | 1000‰ | 250 ms | 31 ms |
| headed@2 | 864 / 1358 | 851 / 1000 / 750 / 851‰ | 986‰ | 463 ms | 54 ms |

- Pooled: 972 state, 648 rows and 60 control trials. **0 hard-deadline overruns, 0 cuts.** Record p50 496 ms, p95
  734 ms, max 1358 ms against 1600.
- N8: R-1 0 claims in 180 adversarial trials; R-2 396/396; R-3 216/216 and 0/72 on distinct; R-4 72/72 and 36/36;
  R-5 p95 47 ms.
- N9: S-1 0 false `ready` in 324; S-2 0 false `error` in 792; S-3 811 / 1000 / 694 / 867‰; S-4 991‰; S-5 p95 395 ms.
- Protected: 72 trials refused, zero frames, no codes. Disabled controls: no N8/N9 code, at most one frame, none late.

**F2, N5 coverage at 1920 × 1080** (`benchmark:visual-coverage`, `3a83c0f`, evidence `evidence/n5-coverage/`, 48 trials
per cell over six lab fixtures; `budget-exhausted` count):

| Mode | DPR 1, off | DPR 1, on | DPR 1.5, off | DPR 1.5, on |
|---|---|---|---|---|
| headless | 0/48 | 0/48 | **48/48** | 0/48 |
| headed | 2/48 | 0/48 | **48/48** | 1/48 |

- "Off" is N5 alone at its 1000 ms deadline (900 ms work budget). "On" is N8 + N9 at 1600 ms. No trial overran its
  hard deadline.
- An earlier uncommitted run of the same code agreed: DPR 1.5 off 48/48 in both modes, and DPR 1.5 on 1/48 (headless)
  and 5/48 (headed).
- **Cause:** a 1920 × 1080 frame at DPR 1.5 is 4.67 Mpx. At the measured 200 ns/px, its whole-frame chunk needs a
  933 ms reserve, more than N5's 900 ms work budget. So N5 alone never examines it and always reports
  `budget-exhausted`. At DPR 1 (2.07 Mpx, 415 ms) it fits.
- **Owner decision needed (not made here):** accept that N5 alone does not diagnose frames above about 4.5 Mpx, or
  move whole-frame pixel work into a worker thread (an architecture change). Thresholds and deadlines are not changed.

**Fresh reviews of `3af7ba1`:**
- **Verdicts:** **QC APPROVED WITH FINDINGS** and **security APPROVED WITH FINDINGS**.
- **Consequence:** neither verdict is unconditional, so R-9 and S-9 stay NOT MET, and `awkit-vra.10` and
  `awkit-vra.11` stay open. No tracker lease was taken and no tracker state was changed.
- **What the reviewers confirmed:** S1, S4, F1, F4 and F6 are fixed as described. No frozen value changed.
- **How the reviews ran:** both were read-only and ran no verifiers.
- **Fixing the new findings would change product code** after campaign 3. That needs a fresh joint campaign and a
  fresh review under § 9's rule, so none were applied this session.

| Finding | Severity | Disposition |
|---|---|---|
| QC 1: no abort check between the `covered` and `hidden` rounds in `rowFacts`; after a cut during the hit tests, N more page reads start | minor | **OPEN.** Fix: `if (signal.aborted) return null` between them, plus a blocking test inside `elementFromPoint` |
| QC 2: the F4 ancestor walk stops at a shadow root (`parentElement`), so a fading host's opacity is skipped | minor | **OPEN.** Fix: continue through `getRootNode().host` |
| QC 3: `memberCropPixels` is pinned only by a regex | minor | **OPEN.** Fix: export it and test a large DPR-2 member and a member clipped at the edge |
| QC 4: S1 has a behavioural test only for a refusal before the frame | nit | OPEN |
| QC 5: `appendAdvisoryCodes` reserves the state slot even when that code is already present | nit | OPEN (unreachable today) |
| Sec 1: a frame refused as `CAPTURE_STALE` (a protected-window trip during a navigation) is not terminal, so the verdict stays `observed` and gains advisory codes | low | **OPEN.** Fix: also require `shot.ok` in the `advisory` gate. No protected-page data enters the record |
| Sec 2: a protected refusal of N9's second frame keeps the N7.7 and N8 codes, and only shows `visual-state-skipped` | low | **OPEN.** Fix: drop every advisory code in that case, or the owner accepts the residual risk |
| Sec 3 (part of S2): no handoff re-check right before the N8 DOM read | info | Reviewer recommends a free synchronous `handedOff` check |
| S2 / S3 | low / info | Reviewer recommends **accept**. S3 is an owner decision |
| F2 coverage (above) | major | **Owner decision**: accept the limit or move pixel work into a worker |

## 11. Final remediation and joint campaign 4 (2026-11-01)

**Fixes** (`6ac690d`; no tracker lease held while editing; frozen policies, criteria, thresholds and deadlines unchanged):
- **One advisory refusal boundary (security S1, Sec 1, Sec 2).** `ADVISORY_REFUSALS` = `PROTECTED_SURFACE`,
  `CAPTURE_STALE`, `PAGE_CLOSED`. Every N7.7, N8 and N9 code of a diagnosis is withdrawn when any of these holds:
  - the verdict is `refused`;
  - N5's frame, or any crop of it (the viewport, a member or the row container), comes back with one of those codes;
  - N7.7 reports its own refusal (`protected-surface`, `handoff-active`, `page-closed` or `capture-stale`);
  - N9's second frame, or its crop, is refused or stale (`state()` returns `null`);
  - the handoff is active once the advisory work is done.

  N5's own verdict, codes and refusal reporting are unchanged.
- **Sec 3 (S2): handoff recheck.** The cheap `handedOff` check now runs right before N8's DOM row read. If a handoff
  became active, the result is `protected-surface`, the same refusal as at the start. N0's protected checks stay the
  authority for every frame. No parallel policy was added.
- **S3: masked-field containers.** A row container that holds a masked field is never cropped or examined, and gets no
  row code (`rowFacts` returns `undefined`).
  - "Masked" is the N4.2 rule, read from attributes only and never from a value. N5's `masked()` check and this check
    now share it (`MASKED_AUTOCOMPLETE` and `MASKED_DESCRIBED`).
  - Example: a `cc-number` field in a different row of the same container.
- **QC 1:** an abort check between the hit-test and visibility rounds.
- **QC 2:** the visibility walk follows the flat tree, through `assignedSlot` and every open shadow host, nested, up to
  the document.
  - Opacity compounds along the way.
  - It fails closed on a read error, an unreadable opacity, or a chain that does not reach the document.
  - `checkVisibility({ opacityProperty, visibilityProperty })` covers what page script cannot walk, such as the inside of
    a closed root.
- **QC 3:** `memberCropPixels` is exported and tested behaviourally.
- **QC 4:** S1 is now tested with refusals after the frame is taken:
  - N9's second frame becomes protected after the row work;
  - a handoff becomes active while the frame is held;
  - the page navigates while either frame is held.
- **QC 5:** `appendAdvisoryCodes` reserves no slot for a state code the record already has.
- **Verifier-only probe:** `heldFrame(1 | 2)` holds each frame before its crops, so the navigation tests are
  deterministic. Production passes no probe.

**New regression coverage, and red proof.** The eight fixes were mutated back to the broken behaviour in the working
tree; the committed fixes were never reverted.
- `verify:visual-rows` failed exactly the 11 targeted checks (57/11):
  - the hit-test cut, counted as a started visibility read in the Playwright client, because the cut's handle disposal
    already stops the read reaching the page;
  - nested-shadow opacity 0.2 × 0.2, with a full-opacity positive control that stays consistent;
  - an unreadable shadow-internal ancestor;
  - the handoff active by the row read (3 DOM row reads happened without the fix);
  - N9's second frame refused as protected after the row work (`row-association-consistent`, `rows-look-alike` and
    `visual-state-skipped` leaked without the fix);
  - a handoff after the frame;
  - navigation while N5's frame is held, and while N9's second frame is held;
  - the masked-field container (it was cropped and given `row-association-consistent` without the fix);
  - the two wiring pins.
- `verify:visual-diagnosis-deadline` failed the 3 new checks (28/3): a duplicate state slot, a DPR-2 member (699 904
  px counted instead of 2 799 616) and an edge-clipped member.
- The two S3 checks for "no value or string in the record" pass even with the fixes reverted. That guarantee never
  depended on the container scan, and the checks pin it.

**Verification on the final source:** all PASS.
- build PASS;
- `verify:visual-rows` 68/0;
- `verify:visual-diagnosis-deadline` 31/0;
- `verify:visual-state-runtime` 26/0 (case D now expects no state code, not `skipped`, per Sec 2);
- `verify:visual-diagnosis-runtime` 65/0;
- `verify:visual-isolation` 117/0;
- `verify:mock-site` 378/378;
- `verify:protected-diagnosis` 75/0;
- `verify:security` 61/0.

**Joint campaign 4** (`9bda9ee`, evidence `evidence/joint/c4/`; N5, N8 and N9 all on; held-out variants b, c and d;
the unchanged frozen criteria; strict accounting with no grace; campaigns 1 to 3 untouched):
**PASS: every N8 and N9 criterion is MET in all six cells.**

| Cell | Record p95 / max (ms) | N9 S-3 loading / empty / error / ready | S-4 | S-5 p95 | R-5 p95 |
|---|---|---|---|---|---|
| headless@1 | 636 / 787 | 777 / 1000 / 666 / 851‰ | 986‰ | 394 ms | 34 ms |
| headless@1.25 | 438 / 702 | 814 / 1000 / 666 / 888‰ | 1000‰ | 253 ms | 33 ms |
| headless@2 | 733 / 977 | 814 / 1000 / 750 / 851‰ | 986‰ | 355 ms | 54 ms |
| headed@1 | 408 / 620 | 777 / 1000 / 666 / 851‰ | 986‰ | 229 ms | 35 ms |
| headed@1.25 | 457 / 760 | 796 / 1000 / 666 / 888‰ | 1000‰ | 246 ms | 34 ms |
| headed@2 | 714 / 1082 | 851 / 1000 / 750 / 851‰ | 986‰ | 349 ms | 49 ms |

- **Volume:** 280 trials ran per cell, with no harness errors. Pooled: 972 state, 648 rows and 60 control trials.
- **Deadline:** **0 hard-deadline overruns (late records), 0 cuts.** Record p50 427 ms, p95 635 ms, max 1082 ms against
  1600.
- **False positives:**
  - N8: 0 false associations in 396; R-1 0 consistent claims in 180 adversarial trials; R-3 0 of 72 `look-alike` on
    distinct rows.
  - N9: S-1 0 false `ready` in 324; S-2 0 false `error` in 792.
- **Recall:**
  - N8: R-2 396/396; R-3 216/216; R-4 72/72 `partly-examined` and 36/36 `not-examined`.
  - N9: S-3 805 / 1000 / 694 / 864‰; S-4 991‰ (892 of 900).
- **Performance:** S-5 state work p95 339 ms (budget 600); R-5 row work p95 45 ms (budget 150).
- **Protected control:** 72 trials refused, zero frames, no codes.
- **Disabled control:** 60 trials, no N8/N9 code, at most one frame, none late.

**S3: the sensitive-container data path, proven.** Owner disposition is still required for the residual risk below.

| Guarantee | Where it holds | Proof |
|---|---|---|
| No additional screenshot for N8 | The container crop is `cropFromVisualFrame` of N5's own N0 frame | `verify:visual-rows` "still exactly one frame"; S3 "one frame" |
| Crops are transient and released with the guarded frame | `dropRowPixels()` after `decideRows` and in the `finally` before `releaseVisualFrame` | F6 finding 7 event order; S3 sensitive-string case: `frame-taken`, `crop-taken`, `crop-dropped`, `frame-released` |
| No raw pixels, field values or sensitive strings reach persistence, IPC, reports, logs or audit | The record is codes only (`visualDiagnosisRecord`). The runner sends records only to `onVisualDiagnosis` and logs none. Probes are verifier-only (production passes none, `PlaywrightRunner.ts`) | `verify:visual-diagnosis-runtime` codes-only keys and no log; S3 record checks: no card number or SSN, codes match `^[a-z][a-z0-9-]*$` |
| Protected surfaces and forbidden authentication steps stay unread | N0 scan before any inspection; N0 checks before and after every frame; the handoff recheck before the row read; handoff steps refused first; masked-field containers never cropped | R-7 protected and handed-off cases; Sec 3 case; S1 cases; S3 masked-field case; campaign 4: 72 protected trials with zero frames |
| Row evidence never controls actions | Codes are added after the N5 verdict and change no step status, locator or retry | `verify:visual-isolation`: the diagnosis adapter "observes and never acts"; `verify:visual-state-runtime` E: A/B neutrality; `verify:visual-rows`: no click, key, focus or scroll |

**S3 residual risk, for explicit owner disposition (not self-approved):**
1. **Visible sensitive text.** Text outside a masked field (for example an SSN printed in a cell) is copied into one
   transient in-memory crop. The crop comes from the same N0 frame N5 already holds, and is reduced to codes and dropped
   before the frame is released.
2. **The masked-field scan has limits.** It reads `input` and `textarea` in the container's own tree only. Fields inside
   a shadow root within the container, and `contenteditable` regions, are not scanned. N0's protected scan still covers
   password, one-time-code and the other protected surfaces there.
3. **Closed shadow roots.** The opacity walk cannot see inside one; only the engine's `checkVisibility` (opacity 0,
   visibility) covers it.

**F2: high-DPI N5 performance** (owner direction 2026-11-01; recorded as a **proposal pending owner approval**).
- **Known limitation, unchanged:**
  - 1920 × 1080 at DPR 1.5 with N5 alone is **not qualified and not successfully diagnosed**.
  - The recorded result stays **48/48 `budget-exhausted`** in each mode.
  - The 1000 ms deadline is preserved.
  - No acceptance gate that needs this configuration is closed or waived.
- **Proposed follow-up** (a separate task, not started):
  1. measure where the whole-frame chunk's ~200 ns/px goes, and cut that cost;
  2. chunk the whole-frame crop and fingerprint behind yield-and-budget checkpoints;
  3. bound the processed pixels (for example a fixed-size subsampled plane for the viewport fingerprint), measured
     against the frozen criteria before any adoption;
  4. a worker-thread feasibility study (transfer cost, packaging, offline runtime).

**Fresh reviews of `280d9ab`** (both read-only; each reviewer's verifier runs were BLOCKED by the lease guard):

**Verdicts:** **QC APPROVED WITH FINDINGS** and **security APPROVED WITH FINDINGS**. Neither is unconditional.
- **Resolved, as confirmed by the reviewers:** QC 1 to 5, Sec 1 (for the paths tested), Sec 2, Sec 3, S1, S4, F1, F4
  and F6.
- **S2:** security says ACCEPTED-RISK, owner decision needed. Only a handoff recheck runs before the row read, not a
  fresh N0 scan. QC says RESOLVED.
- **S3 and F2:** both reviewers say ACCEPTED-RISK, owner decision needed.
- **Security NEW-1 (low), and QC nit 1 (the same gap on N9's second frame).** Staleness was noticed only when a crop
  happened to see it. A navigation after the crops was then overwritten as `TARGET_STALE`, so the codes stayed.
- **Security NEW-2 (info, for S3).** The container scan does not see `select` elements or child iframes, such as hosted
  card fields. N0's protected scan does not cover card fields at all.
- **QC nits 2 and 3:** the evidence records the revision but not whether the tree was clean; the regex wiring pins are
  brittle.

**NEW-1 fix** (`8f87d15`):
- N0's stale mark is read with a 1-px crop right before N5's frame is released, and on N9's second frame before the
  time-left check.
- A refused crop is no longer overwritten as `TARGET_STALE`.
- New test, "navigation after the crops, before release". Red proof: with the release check disabled it failed
  (`row-association-inconclusive` and `rows-inconclusive` leaked).
- Verifiers on `8f87d15`: build PASS, `verify:visual-rows` 69/0, `verify:visual-state-runtime` 26/0,
  `verify:visual-diagnosis-deadline` 31/0, `verify:visual-diagnosis-runtime` 65/0, `verify:visual-isolation` 117/0.
  Mock-site, protected-diagnosis and security were not rerun, because their inputs did not change.

**Joint campaign 5** (`c4e91fc`, the final source, evidence `evidence/joint/c5/`, the same strict accounting and frozen
criteria): **NOT MET.**
- Five cells meet every criterion.
- **headed@2** had 7 hard-deadline overruns (+44 to +190 ms) and 32 cuts. As a result S-3 ready (648‰), S-5 (2 late),
  R-2 (727‰), R-3 recall (666‰) and R-5 (5 late) are NOT MET there.
- Every overrun and cut falls in **one contiguous block of about 40 variant-c trials** (cell file lines ~2687 to 3348).
  The block spans the end of the state lab and the start of the rows lab, and the other five cells kept their usual
  timings (record p95 390 to 744 ms).
- Classification, **unproven:** a time-local host slowdown, not a code path. The only product delta from campaign 4 is
  one 1-px crop per frame.
- Pooled: R-1 0 claims in 180 adversarial trials, 0 false associations, 0 false `ready` and 0 false `error`, 72/72
  protected refusals with zero frames and no codes, and clean disabled controls.
- The result is recorded unchanged: no trial was removed, nothing was tuned, and the cell was not rerun or overwritten.
  A diagnostic rerun under a separate id was BLOCKED by the lease guard (NOT RUN).
- **So the final source is not qualified.** Campaign 4 qualified `9bda9ee`, the code before the NEW-1 fix. A fresh full
  campaign under controlled host conditions is required before R-1 to R-5 and S-1 to S-5 can be claimed for the final
  source.

**Delta reviews of `8f87d15` and campaign 5** (both read-only, run by the same reviewers):

**Verdicts:** **security APPROVED WITH FINDINGS** and **QC APPROVED WITH FINDINGS**. Neither is unconditional.
- **NEW-1:** RESOLVED (both reviewers). **QC nit 1:** RESOLVED.
  - Remaining nit: no test covers the low-time branch of the second-frame check.
  - Security notes two limits, neither a security issue: a navigation after release is not seen, and a viewport change
    is detected only by N0's async check.
- **NEW-2:** ACCEPTED-RISK, owner decision needed (part of S3).
- **Campaign 5 (QC):** NOT MET, recorded truthfully. Campaign 4 cannot qualify the final source, under § 9's rule. The
  host-slowdown explanation is plausible but unproven, and must not be used to drop trials, add grace or waive the cell.
- **Campaign 5 (security):** no security relevance. Protected refusals and false-claim controls held in the failing
  cell.
- **Required to qualify** (QC):
  1. keep campaign 5 as recorded;
  2. pre-declare a fresh campaign 6 on the unchanged final source: all six cells, the frozen criteria, held-out
     variants, strict accounting and both controls;
  3. report campaigns 5 and 6 side by side;
  4. **the owner decides before the run** whether one pass after a recorded failure qualifies, or sets a repeat rule;
  5. optionally, run a lease-authorized headed@2 diagnostic under a separate id that never counts as qualification.
- **Consequence:** R-9 and S-9 stay NOT MET, and `awkit-vra.10` and `awkit-vra.11` stay IN PROGRESS.
- **Owner decisions pending:**
  - S2 (security: no fresh N0 scan before the row read);
  - S3 (residual risks 1 to 3, plus NEW-2);
  - F2 (the follow-up proposal);
  - the campaign 6 repeat rule.

