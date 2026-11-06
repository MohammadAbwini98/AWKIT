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


## 12. Recovery: owner dispositions, S3/NEW-2 hardening, campaign-5 diagnosis, campaigns 6 and 7 (2026-11-01)

Owner prompt "AWKIT — Phase N Final Qualification Recovery" (DECISIONS 2026-11-01), contract
`awkit-vra-phase-n-recovery-1101`, baseline `20e93347`.

**Owner dispositions (DECISIONS 2026-11-01):**
- **S2:** conditionally accepted, subject to explicit security confirmation.
- **S3/NEW-2:** hardening required, with no blanket risk acceptance.
- **F2:** a documented limitation with an independently tracked follow-up; not qualified.
- **Repeatability:** two complete campaigns (6 and 7) on one final revision. A failed campaign 6 stops the sequence.

**Campaign-5 diagnosis:** **INCONCLUSIVE.**
- The run was the separately identified `c5-headed2-d1`, lease-authorized and never qualification. Evidence and
  reading: `evidence/joint/diagnostic/c5-headed2-d1/ANALYSIS.md`.
- **Campaign 5's burst:**
  - post-frame work (frames taken, no state result);
  - all phases about 2.7× slower for about 37 consecutive trials;
  - not bound to any fixture or lab transition.
- **The instrumented run:**
  - It did not reproduce that burst.
  - It cut every animated state fixture with no frame taken: probably an effect of the instrumentation (not isolated; QC review).
  - N5 still settled on time (37 cuts, 0 late).
- No cause is demonstrated, and the burst is not called a flake.
- Product finding, moved into the F2 follow-up: the fixed 200 ns/px synchronous reserve does not adapt to a slower
  host.

**S3/NEW-2 hardening** (`af1deab3`):
- Before the optional crop, `rowFacts` classifies everything the crop could show:
  - the container's subtree;
  - every nested open shadow root;
  - whatever paints over the container's visible box (a bounded 3 × 3 `elementFromPoint`).
- It refuses the row observation (no crop, no row code) on any of:
  - a masked `input`, `textarea` or `select` (the shared N4.2 rule, attributes only);
  - a `contenteditable` region;
  - an `iframe`, `frame`, `object`, `embed`, `fencedframe` or `portal`;
  - an autonomous custom element with no open root (it may hold a closed root that page script cannot read);
  - more than `VISUAL_ROWS_MAX_SCAN_NODES` (4000) elements.
- The work is bounded: no document-wide content scan (since `b1f6ce37` one fixed-selector document query, matches capped), no new screenshot, no persisted pixels or text. No value, text or pixel is
  read, and protected steps are refused before the scan.
- **Remaining limits, for security review:**
  - a closed shadow root on a built-in element (for example a `div`) cannot be detected by page script;
  - `pointer-events: none` overlays are invisible to the hit test;
  - visible sensitive text outside any control (S3 residual 1) is still copied into the transient crop;
  - the scan runs before the frame, like the earlier masked check.
- **Tests:** `verify:visual-rows` **78/0**. Each new case places the content in a row other than the target's: a masked
  `select`, `contenteditable`, a hosted-card `iframe`, a card field two open shadow roots deep, a closed root, and the
  scan bound. One more case overlays a hosted-card `iframe` from outside the container. Positive controls (an ordinary
  `select`, plain text in nested shadow roots) still crop.
- **Red proof:** reverting the scan to the old light-DOM, `input`/`textarea`-only rule failed exactly the 6 new
  refusal cases, the overlay case and the shifted hit-test count (8 checks, 70/8). The controls stayed green.

**Campaigns 6 and 7: pre-declaration** (committed before either runs, with the scripts that run them):
- **Revision:** both run on the commit that contains this section, with a clean tracked tree (`treeClean: true` in
  each cell file). Product source is as of `af1deab3`. Any product change after campaign 6 voids the sequence.
- **Environment:**
  - the approved Windows 11 ARM64 Parallels host, x64 Node, bundled Chromium;
  - the six cells run one after another, in one shell, with no instrumentation;
  - no build, verifier or other benchmark runs in parallel, and the VM is not used interactively during a cell.
- **What runs:**
  - all six cells (headless and headed at DPR 1, 1.25 and 2) with N5, N8 and N9 on;
  - held-out variants b, c and d, two repeats each;
  - the protected and disabled-mode controls;
  - `npm run benchmark:visual-joint:<cell>` then `:aggregate` writes `evidence/joint/c6/`, and the `c7-` scripts write
    `evidence/joint/c7/`.
- **Criteria:** `N8_FROZEN_CRITERIA` R-1 to R-5 and `N9_FROZEN_CRITERIA` S-1 to S-5, unchanged.
  - Strict accounting: any overrun of the 1600 ms hard deadline is late.
  - A cut counts at the full deadline.
  - No trial is excluded.
  - Every protected trial refused with zero frames and no code.
  - Disabled controls carry no N8/N9 code, take at most one frame, and none is late.
- **A campaign passes** only when every criterion is MET in every cell.
- **Sequence:**
  - campaign 6 first;
  - if it fails, it is recorded and the sequence stops, so campaign 7 does not run;
  - N8 and N9 qualify on this revision only if campaigns 6 and 7 **both** pass.
- The harness refuses to overwrite any existing cell file.

**Campaign 6** (`e6f67806`, `treeClean: true` in every cell, evidence `evidence/joint/c6/`, committed `6d22b317`):
**NOT MET.** Five cells meet every N8 and N9 criterion. In **headed@2**, N9 **S-5 is NOT MET** (p95 631 ms against the
600 ms budget, and 1 record after the 1600 ms hard deadline). Recorded unchanged: nothing excluded, re-scored or rerun.

| Cell | Record p95 / max (ms) | Late | Cuts | S-3 loading / empty / error / ready (‰) | S-5 p95 | R-5 p95 | False assoc. / ready / error |
|---|---|---|---|---|---|---|---|
| headless@1 | 377 / 591 | 0 | 0 | 778 / 1000 / 667 / 852 | 214 ms | 31 ms | 0 / 0 / 0 |
| headless@1.25 | 473 / 700 | 0 | 0 | 852 / 1000 / 667 / 889 | 269 ms | 43 ms | 0 / 0 / 0 |
| headless@2 | 756 / 996 | 0 | 0 | 815 / 1000 / 750 / 852 | 381 ms | 44 ms | 0 / 0 / 0 |
| headed@1 | 400 / 572 | 0 | 0 | 778 / 1000 / 667 / 852 | 243 ms | 35 ms | 0 / 0 / 0 |
| headed@1.25 | 596 / 1513 | 0 | 1 | 815 / 1000 / 667 / 889 | 278 ms | 52 ms | 0 / 0 / 0 |
| **headed@2** | 1160 / 1643 | **1** (`spinner`/b, +42.8 ms) | 3 | 815 / 1000 / 750 / 870 | **631 ms** | 69 ms | 0 / 0 / 0 |

- **Pooled:**
  - R-1: 0 consistent claims in 180 adversarial trials;
  - 72/72 protected trials refused, with zero frames and no code;
  - disabled controls: no N8/N9 code, at most one frame, none late;
  - S-5 pooled is NOT MET (p95 401 ms, but 1 late).
- **What the failure looks like:**
  - The late record is the cell's very first diagnosis.
  - The 3 cuts are animated state fixtures (`spinner`, `partial-skeleton`). Every cut and late trial had N5's frame,
    so the time went into post-frame work.
  - The whole cell ran slower than campaign 4's headed@2 (block medians 680 to 950 ms, against about 500 to 580 ms).
  - The S3/NEW-2 scan does not run on state-lab trials (their target is missing, so there are no row members).
  - Like campaign 5, the time went into post-frame work on the heaviest frames (headed, DPR 2). A plausible but unproven
    mechanism is synchronous work exceeding the fixed per-pixel reserve; the cause stays INCONCLUSIVE (F2 follow-up).
- **Repeat rule:** campaign 6 failed, so the sequence **stops**. Campaign 7 was **not run**. N8 and N9 are **not
  qualified** on this revision.
- **Next:** a product change to the synchronous reserve and scheduling is needed before any new sequence. That change
  voids this revision's sequence, and a new campaign pair must be pre-declared for the new revision.

**Fresh independent reviews of `af1deab3` to `6d22b317`** (read-only; verdicts recorded as returned):
- **Security: CHANGES REQUIRED.**
  - **S2: CONFIRMED.** The handoff-only recheck is an acceptable residual risk while the four owner limits stay
    enforced by tests. With that confirmation, the owner's S2 conditional acceptance is satisfied.
  - Required:
    1. slotted light-DOM content was not scanned;
    2. the 3 × 3 overlay sampling missed small or under-layer overlays;
    3. the scan ran only before the frame (time-of-check).
  - Low: the benchmark's wildcard `safe.directory`.
  - Governance: the product commits were made with no lease held. `lease-guard` allows "unleased-routine" writes,
    which contradicts `MULTI_AGENT_ARCHITECTURE.md` § 191. Recorded here, not changed.
  - Acceptable residuals: closed roots on built-in elements; sensitive text, canvas or images outside controls.
- **QC: CHANGES REQUIRED.**
  - The iframe tests raced N0's strict frame window (the QC run gave 76/2).
  - The overlay gap (as security found).
  - The custom-element closed-root heuristic costs recall on custom-element tables (`mat-table`), unmeasured on the
    labs.
  - The scan built the whole subtree before checking the cap.
  - A brittle hit-count pin.
  - Overclaims in `ANALYSIS.md` and in this section.
  - Confirmed:
    - campaign 6 NOT MET, recomputed independently;
    - the pre-declaration was committed before the run;
    - stopping before campaign 7 is correct;
    - no protected-capture, stale-frame, offline or disabled-mode regression;
    - no harness behaviour change without `--diagnostic`.
- **Fixes (`b1f6ce37`):**
  - one shared page function `rowContainerSensitive` runs before the frame and again after the crop while the frame
    is held; a hit drops the crop and every row code;
  - slot-assigned elements are scanned;
  - every embedded frame, form control or `[contenteditable]` whose box meets the container's visible box is
    classified. This is a fixed-selector document query with matches capped at 4000 and no content read;
  - a `TreeWalker` stops at the cap;
  - the iframe tests wait for their frames to load;
  - the benchmark's Git calls trust only the exact checkout root, with `core.fsmonitor=false`;
  - the overclaims are corrected.
- **Tests and red proof:**
  - `verify:visual-rows` **82/0 in two consecutive runs**;
  - a mutant without the three fixes gives 79/3: exactly the slotted card, the 12 × 8 px pointer-events-none frame,
    and the late-mounted field;
  - deadline 31/0, state-runtime 26/0, diagnosis-runtime 65/0, protected-diagnosis 75/0, security 61/0, isolation
    117/0, build PASS.
- **Left open:**
  - QC 4: the closed-root heuristic stays, under the owner's "refuse when uncertain". CDP-pierce reuse would be a
    larger design change.
  - QC 6: the coordinate assertion for the hit-count pin.
- **Qualification:** `b1f6ce37` is a product change after campaign 6, so no campaign qualifies it. A new pair must be
  pre-declared for the next final revision, after the heavy-frame reserve work (`awkit-vra.18`).

**Delta reviews of `b1f6ce37`** (one bounded round; verdicts recorded as returned):
- **Security: APPROVED WITH FINDINGS.**
  - **S2 CONFIRMED** again.
  - Slotted content, overlays and the time-of-check gap: RESOLVED.
  - The wildcard `safe.directory`: RESOLVED. The unleased commits: accepted as record-only; the gap between the
    governance doc and the guard is left for the owner.
  - Open low and info items:
    - the slotted-card test can also be caught by the box pass, so add a slot-only case;
    - iterate the NodeList directly instead of `Array.from`;
    - frames and controls inside *other* open shadow trees are seen only by the hit test;
    - the rescan finds the container again from the anchor instead of reusing the original handle.
- **QC: APPROVED WITH FINDINGS.**
  - Its own `verify:visual-rows` run: 82/0.
  - QC1, QC3, QC5 and QC7 RESOLVED; QC2 resolved as far as one run shows.
  - QC4 (the closed-root heuristic and its unmeasured recall cost on custom-element tables) and QC6 (the hit-count
    coordinate assertion) stay OPEN, as recorded.
  - New, low to medium:
    - the box pass is a document query run twice per diagnosis, and its cost is unmeasured on the heavy-frame path;
    - other shadow trees are not searched (as security found);
    - content that appears and disappears between the two scans is not caught, since this scan has no mutation sentinel.
- **Consequence:** neither review is an unconditional approval, and no campaign covers `b1f6ce37`. **N8 `awkit-vra.10`
  and N9 `awkit-vra.11` stay IN PROGRESS.**
- **To close:**
  1. the heavy-frame reserve work (`awkit-vra.18`) plus the open review items;
  2. a newly pre-declared campaign 6/7 pair on that final revision, both passing;
  3. a review round that approves.

**`awkit-vra.18` started (2026-11-01): measured mechanism and fix design** (`benchmark:visual-sync-cost`, now also timing
the raw PNG decode, N9 state features and the motion plane; diagnostic only, no evidence file).
- **Measured on this host** (8 runs per cell; maxima):

  | Phase | Max ns/px | Max ms |
  |---|---|---|
  | N0 capture + decode | — | 662 (headed@1), 649 (headed@2) |
  | Raw PNG decode | 92 (DPR 2) | — |
  | Crop + fingerprint | 281 | — |
  | N9 state features | **331** (headless@1.25), 312 (headed@1) | — |
  | Motion plane | — | 84 |

- **Defect 1: one constant that is not an upper bound.** One constant, `VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL = 200`,
  gates every synchronous phase. The state-feature phase and the fingerprint exceed it on this host even without a
  slowdown, so either can start with less budget left than it needs.
- **Defect 2: an undecoded second frame.** N9's second capture gets `timeoutMs = remaining − 50`. N0 then decodes the
  PNG synchronously with no check of the time left (`src/visual/internal/captureCore.ts:294`). A screenshot arriving
  just inside the timeout decodes past the 1600 ms deadline.
  - This fits every late record in campaigns 5 and 6: `frames: 1` (the second frame never reported `taken`) and no
    state result.
  - Under a host slowdown the decode (up to 92 ms, normally) also exceeds the 100 ms settle margin.
- **Fix design** (the deadline, margin and criteria are unchanged):
  1. **Per-phase measured rates.** Fingerprint, state features, motion plane, member crop and PNG decode each get a
     rate of about 1.25 × its measured maximum.
  2. **A host factor.** It is learned from the first whole-frame chunk of each diagnosis:
     `factor = max(1, observed ns/px ÷ rate)`. It is carried as the recent maximum across the last few diagnoses in the
     process and multiplies every later reserve.
  3. **N9's second capture timeout** becomes `remaining − max(50, decode reserve of frame 1's pixels × factor)`, so
     the bytes arrive early enough for the decode to finish in budget.
  4. **Verifier-only probes** (production passes none):
     - a per-phase synchronous cost injector, to simulate a slower host deterministically;
     - a capture-timeout observer.
     - New `verify:visual-diagnosis-deadline` cases with a red proof: a 3× slow host gives no late record; the
       second-frame timeout leaves the decode reserve.
- **After the fix:** it is a product change, so it needs a newly pre-declared campaign pair (campaigns 8 and 9, since
  the harness refuses to overwrite `c6`) and a review round. Fewer late records may come at the cost of more cuts.
  Cuts count at the full deadline in the S-5 p95, so whether headed@2 S-5 then passes is unknown until measured.

**`awkit-vra.18` deadline-safety fix (2026-11-01, `7a0a9227`)** (this part only: the worker-thread study and subsampling
stay open on `awkit-vra.18`, outside Phase N closure).
- **Fresh measurement** (`benchmark:visual-sync-cost`, now also timing the motion plane per pixel and one member's crop
  plus evidence; 8 runs per cell; diagnostic only, no evidence file). Maxima, with the earlier § 12 run:

  | Phase | This run, max ns/px (cell) | Earlier run | Rate (≈ 1.25 × max) |
  |---|---|---|---|
  | Whole crop + fingerprint | 290 (headless@1, a pause; p50 there 92) | 281 | **365** |
  | N9 state features | 345 (headed@1) | 331 | **435** |
  | Second frame's whole crop + motion plane | 127 + ≤ 15 (headed@1) | — | **180** |
  | Member crop + evidence | 414 (headless@1, one 281 ms pause; p50 there 88) | — | **520** |
  | PNG decode | 84 (headless@1.25) | 92 | **115** |

  The maxima include host pauses on purpose: the rate is an upper bound, not a typical cost.
- **What changed** (`src/runner/visualDiagnosis/visualDiagnosisContract.ts`, `VisualFailureDiagnosis.ts`; nothing in
  `src/visual`):
  1. `VISUAL_DIAGNOSIS_SYNC_NS_PER_PIXEL` is now one rate per phase (table above). The row container crop takes the
     member-crop rate. The row decision over that crop is unmeasured, so it takes the largest whole-image rate (state
     features).
  2. **Host factor.** The first whole-frame chunk of each diagnosis (whole crop plus fingerprint) is timed whole:
     `factor = max(1, observed ns/px ÷ 365)`. The process keeps the last `VISUAL_DIAGNOSIS_HOST_FACTOR_WINDOW` (8)
     diagnoses' factors and carries their maximum into the next diagnosis. Within a diagnosis the factor is the carried
     one, raised by its own chunk. It multiplies every later reserve: state features, member crops, row crop and
     decision, the second capture's decode reserve, and the motion plane.
  3. **N9's second capture** gets `timeoutMs = remaining − max(50, frame 1's pixels × 115 ns × factor)`, so N0's
     synchronous decode of the bytes still fits in the work budget.
  4. **Verifier-only probes** (production passes none): `syncCost(phase, pixels)`, called synchronously inside each
     timed chunk (and right after each frame arrives, for `decode`), and `onCaptureTimeout`, the second capture's
     timeout, work budget left and decode reserve.
- **Unchanged:** the N5 and N9 deadlines, `VISUAL_DIAGNOSIS_SETTLE_MARGIN_MS`, the 50 ms floor, every frozen criterion in
  `scripts/lib/visual-*-criteria.mts`, all evidence.
- **Tests** (`verify:visual-diagnosis-deadline`, 31 → 45 checks):
  - **D8:** a host 3× slower than every reserved rate (the probe busy-waits 2 × the phase's rate per pixel in every
    phase, decode included), 8 whole N8+N9 diagnoses started at offsets 0 to 700 ms. None returns after the 1600 ms hard
    deadline. The factor is learned (≥ 2) and carried, and it decays after 8 ordinary diagnoses.
  - **D9:** the second capture's observed timeout leaves the decode reserve, checked on the verifier's own clock. Then a
    DPR-2 frame on a host 3× slower in the fingerprint and decode phases has its second screenshot delivered 10 ms
    before that timeout ends. The decode still finishes by the hard deadline (6000 ms test deadline, so the slow host
    still reaches frame 2).
  - Pins for the per-phase reserve, the factor arithmetic and the timeout; the earlier pins were moved to the new names.
  - **Red proof:** in the working tree, the adapter was put back to the single 200 ns/px reserve with no host factor and
    a `remaining − 50` timeout: **39/6**. It failed D8 (2 of 8 diagnoses late, 1646 and 1690 ms), both D9 timeout
    checks, D9's late decode (6299 ms against 6000), and the two new pins. Every earlier check stayed green. Restored
    byte-identically (SHA-256 `3a7dacda…ad846` before and after).
- **Verifiers on `7a0a9227`:** build PASS; `typecheck:scripts` PASS; `verify:visual-diagnosis-deadline` 45/0 (three runs); `verify:visual-rows` 82/0, then 81/1, then 82/0 on one retry (the 81/1 run's `virtualized` case returned no row code at N5's 1000 ms deadline; a record cut as budget-exhausted, more likely with the larger fingerprint reserve, fits, but that record was not printed and 12 targeted runs all passed in 190 to 549 ms against the 900 ms budget, so the cause is INCONCLUSIVE); `verify:visual-state` 48/0; `verify:visual-state-runtime` 26/0; `verify:visual-diagnosis-runtime` first aborted in its own setup (N0's `captureElement` refused the verifier's reference seed as `PROTECTED_SURFACE`, before any adapter call), then 65/0 on one retry; `verify:protected-diagnosis` 75/0; `verify:security` 61/0; `verify:visual-isolation` 117/0; `verify:ocr-text-signal` 49/0; `verify:mock-site` 378/378; `verify:verifier-classification` reconciled.
- **Residuals** (for the owner and the review round):
  - N5's first capture still gets `timeoutMs = remaining`, and its decode is not reserved. It is taken at the start of
    the budget, so it only matters on a page whose first screenshot is itself near the deadline.
  - The rates come from this one host. On a slower host the factor learns the difference, but only from the
    fingerprint chunk, so a host that is slow in one phase only is not seen.
  - A pause inside the fingerprint chunk raises the factor for up to 8 diagnoses: more cuts, never a late record.
  - **The expected trade-off:** fewer late records may mean more cuts. Cuts count at the full deadline in the S-5 p95,
    so whether headed@2 S-5 passes is unknown until campaign 8 is run.
  - The QC delta item on the box pass's cost on the heavy-frame path is still unmeasured, and the open review items
    (slot-only test, NodeList iteration, other shadow trees, rescan by the original handle, QC 4, QC 6) are not part of
    this fix.

**Campaigns 8 and 9: pre-declaration** (committed before either runs, with the scripts that run them; under the frozen
repeat rule, DECISIONS 2026-11-01):
- **Revision:** the product source as of `7a0a9227`. Both campaigns run at the tip of `main` once this pre-declaration is
  committed, with a clean tracked tree (`treeClean: true` in each cell file, which also records the revision). No
  commit after this pre-declaration may change product source, the joint harness, the labs or the frozen criteria
  (`src/**`, `app/**`, `mock-site/**`, `scripts/benchmark-visual-joint.mts`, `scripts/lib/visual-*-criteria.mts`, or
  the `benchmark:visual-joint:*` scripts in `package.json`). Any such change, or any product change after campaign 8,
  voids the sequence.
- **Environment:**
  - the approved Windows 11 ARM64 Parallels host, x64 Node, bundled Chromium;
  - the six cells run one after another, in one shell, with no instrumentation (no `--diagnostic`);
  - no build, verifier or other benchmark runs in parallel, and the VM is not used interactively during a cell.
- **What runs** (unchanged from campaigns 6 and 7):
  - all six cells (headless and headed at DPR 1, 1.25 and 2) with N5, N8 and N9 on;
  - held-out variants b, c and d, two repeats each;
  - the protected and disabled-mode controls;
  - `npm run benchmark:visual-joint:<cell>` then `:aggregate` writes `evidence/joint/c8/`, and the `c9-` scripts write
    `evidence/joint/c9/`.
- **Criteria:** `N8_FROZEN_CRITERIA` R-1 to R-5 and `N9_FROZEN_CRITERIA` S-1 to S-5, unchanged.
  - Strict accounting: any overrun of the 1600 ms hard deadline is late.
  - A cut counts at the full deadline.
  - No trial is excluded.
  - Every protected trial refused with zero frames and no code.
  - Disabled controls carry no N8/N9 code, take at most one frame, and none is late.
- **A campaign passes** only when every criterion is MET in every cell.
- **Sequence:**
  - campaign 8 first;
  - if it fails, it is recorded and the sequence stops, so campaign 9 does not run;
  - N8 and N9 qualify on this revision only if campaigns 8 and 9 **both** pass, followed by a review round that
    approves.
- The harness refuses to overwrite any existing cell file. Campaigns 6 and 7's scripts are replaced by these; `c6`
  evidence is unchanged.
- **Status:** NOT RUN. The owner decides when to run them on an idle host.

**Campaign 8 (2026-11-02, `1c7f8b57`, product source of `7a0a9227`): NOT MET; campaign 9 NOT RUN** (evidence
`evidence/joint/c8/`, committed unchanged in `233734a4`; analysis `evidence/joint/c8/ANALYSIS.md`).
- **Cells:**
  - **MET:** headless@2 and headed@2. headed@2 has 0 late and 0 cuts; record p95 715 ms against 1160 in campaign 6,
    and state p95 344 ms against 548.
  - **NOT MET:**
    - headless@1: S-5 p95 783 ms, 1 late;
    - headless@1.25: S-5 p95 624 ms, 2 late;
    - headed@1: a disabled N5-only control late by +126.1 ms;
    - headed@1.25: R-5, 1 late (+321.4 ms).
  - Pooled: 0 false association, 0 false `ready` or `error`, and 72/72 protected refusals with 0 frames.
- **Diagnosis (once):**
  - **The `awkit-vra.18` mechanism did not recur.** No late record ran N8 or N9 pixel work, and four took no frame.
  - **The late records sit in N5's first-capture phase.** That is residual 1 above: `timeoutMs = remaining`, with N0's
    decode not reserved. The harness counts no `late-released` frame and records no phase timing, so this is not shown.
  - **headed@1.25: VM suspension.** Its late record coincides with a VM suspension the System log demonstrates: a
    15.5-minute clock jump at 01:59:22 from 01:43:55.
  - **headless@1 and headless@1.25 ran slower on the same work** (state p50 1.2 to 1.6× and p95 2 to 2.3× campaign 6).
  - **Cause:** INCONCLUSIVE, except the suspended record. No product correction is made.
- **Intermittent verifier incidents on `7a0a9227` (classification, 2026-11-02):** neither verifier printed what would
  tell the candidates apart, so both stay **INCONCLUSIVE**, and the earlier failures are kept.
  - **`verify:visual-rows`, `virtualized` (81/1).**
    - The check prints only the codes, and the run had none. "No row code" is produced only by fail-closed paths:
      1. a cut, at a checkpoint or by the deadline timer. At factor 1 the reserves after the frame are about 540 ms
         against the 900 ms budget (fingerprint 175, row crop about 200, row decision about 167), so about 360 ms of
         pre-frame time, or a factor carried at about 2 or more, cuts the record;
      2. the post-crop rescan dropping the crop and `rowFacts`, on a hit, an error or a missing handle.
    - Neither emits a wrong code. No assertion, deadline or retry was changed.
  - **`verify:visual-diagnosis-runtime`, reference seed.**
    - The verifier throws only `captured.code`, not N0's message, which names the reason.
    - The lab has no protected field, so a `protected-field` reason would recur deterministically. A transient
      `frame-unscannable` fits better: N0 fails closed when its strict window cannot open or finish, or when a frame
      scan exceeds `PROTECTED_FRAME_SCAN_TIMEOUT_MS` (1500 ms) on a cold first capture. Neither is shown.
    - N0's boundary was not touched.
  - **Follow-up (not done here; QA-owned verifier files, outside this project-state lease):** print the record's
    outcome and observations, and N0's refusal message, on these failures.
- **Next:** owner decision. Either a harness change (record `late-released` frames and the phase running at the
  deadline) and/or N5 first-capture decode reservation, then a new pre-declared campaign pair; and host controls
  against VM suspension. Each is a new revision.

**Joint-harness accounting (2026-11-02, `aa54a586`; owner choice after campaign 8).** Contract
`awkit-vra-joint-harness-accounting-1102`.
- **What `benchmark:visual-joint` now records,** passively, in every trial (`acct`):
  - the adapter's probe marks, in ms from the diagnosis start: `inspect`; frames taken, released or late-released;
    each synchronous phase as it starts (`sync-decode`, `sync-fingerprint`, `sync-stateFeatures`,
    `sync-memberCrop`, `sync-motionPlane`); and `capture-2`;
  - the late-released frame count;
  - Node event-loop utilization and process CPU, both read outside the timed window;
  - the wall clock beside the monotonic one.
- **Per cell:** wall and monotonic elapsed time, and their skew.
- **Aggregate:** for every late or cut trial, controls included, the aggregate prints the mark in force when the
  deadline passed, the next mark, the late-released frames, ELU, CPU and the skew so far.
- **Unchanged:** the frozen criteria, the strict accounting, the labs and the product. No CDP domain, timer or page call
  is added.
- **Limit:** the first capture's start has no probe of its own. A deadline found at `inspect` covers the DOM
  inspection and the first capture together.
- **Smoke run** (`evidence/joint/diagnostic/acct-smoke-1102/`, never qualification):
  - **Attempt 1 crashed** on an unhandled `page.screenshot` timeout of 25 ms, in N0's first capture. This is
    **`awkit-kv3n`**: `Budget.race` builds its step before `check()`, so a screenshot started on an already-aborted
    capture is orphaned.
  - **Attempt 2 completed:** 280 trials, all marks present, clock skew −5 ms, 0 late-released frames.
- **Campaigns 10 and 11 are not pre-declared yet.** `awkit-kv3n` is a product change in `src/visual`, and a crash in a
  campaign cell would lose that cell. The owner decides whether it is fixed first, so that the pre-declaration covers the
  fixed revision.

**`awkit-kv3n` fixed (2026-11-05, `e60b890b`).** `Budget.race` (N0, `src/visual/internal/captureCore.ts`) now takes a
start function: the budget is checked before the step starts, so a cancelled or exhausted capture starts no screenshot,
guard or read; an abort raised while the step starts is re-checked; the started step's settlement is always observed (a
late rejection is absorbed, a late element handle disposed); `measureElement` keeps CANCELLED / BUDGET_EXHAUSTED.
`verify:visual-capture` red-first 341/7, green 348/0; mutations M1 342/6, M2+M3 345/3. Independent QC and security
review: both APPROVED WITH FINDINGS (the shared finding, `measureElement`'s `.catch(() => false)`, is fixed in
`e60b890b`; QC finding 2, the process-wide timer count, is pinned by a comment that the section runs first).

**Campaigns 10 and 11: pre-declaration** (committed before either runs, with the scripts that run them; same frozen
repeat rule as campaigns 8 and 9, DECISIONS 2026-11-01):
- **Revision:** the product source as of `e60b890b` (the `awkit-kv3n` fix, on top of the joint-harness accounting
  `aa54a586`). Both campaigns run at the tip of `main` once this pre-declaration is committed, with a clean tracked tree
  (`treeClean: true` in each cell file, which records the revision). No commit after this pre-declaration may change
  `src/**`, `app/**`, `mock-site/**`, `scripts/benchmark-visual-joint.mts`, `scripts/lib/visual-*-criteria.mts`, or the
  `benchmark:visual-joint:*` scripts in `package.json`. Any such change, or any product change after campaign 10, voids
  the sequence. Campaigns 1 to 9 and every diagnostic evidence folder stay unchanged.
- **Environment:**
  - the approved Windows 11 ARM64 Parallels host, x64 Node, bundled Chromium;
  - the six cells run one after another, in one shell, with no instrumentation (no `--diagnostic`);
  - no build, verifier or other benchmark runs in parallel, and the VM is not used interactively during a cell;
  - **new precondition (campaign 8's headed@1.25 suspension):** before campaign 10 starts, the owner confirms on the
    Mac that neither macOS sleep nor Parallels can suspend or pause the VM for the whole run (Mac sleep disabled on
    power, Parallels "pause when idle / no apps" off, no scheduled suspend), and records it with the start time. The
    passive accounting's wall-versus-monotonic skew per trial and per cell is the clock-consistency record; a suspension
    it or the System log shows is reported as such, never as a product PASS, and the affected results are kept.
- **What runs** (unchanged from campaigns 8 and 9):
  - all six cells (headless and headed at DPR 1, 1.25 and 2) with N5, N8 and N9 on;
  - held-out variants b, c and d, two repeats each;
  - the protected and disabled-mode controls;
  - passive accounting (`acct`) in every trial: phase marks, late-released frames, ELU, CPU and clock skew;
  - `npm run benchmark:visual-joint:<cell>` then `:aggregate` writes `evidence/joint/c10/`, and the `c11-` scripts write
    `evidence/joint/c11/`.
- **Criteria:** `N8_FROZEN_CRITERIA` R-1 to R-5 and `N9_FROZEN_CRITERIA` S-1 to S-5, unchanged.
  - Strict accounting: any overrun of the 1600 ms hard deadline is late (zero grace).
  - A cut counts at the full deadline, and every cut and late record is listed.
  - No trial is excluded.
  - Every protected trial refused with zero frames and no code.
  - Disabled controls carry no N8/N9 code, take at most one frame, and none is late.
- **A campaign passes** only when every criterion is MET in every cell.
- **Sequence:** campaign 10 first; if it fails it is recorded NOT MET and campaign 11 does not run. N8 and N9 qualify on
  this revision only if campaigns 10 and 11 **both** pass, followed by an independent N8/N9 review round that approves.
- **Status:** NOT RUN. Execution is BLOCKED on the host precondition above: suspension settings live on the Mac host and
  cannot be read from the guest, and this session's guest-side power and event-log reads were refused by the lease guard.

**Campaign 10 (2026-11-06, `bdb235c6`, product source of `e60b890b`): NOT MET; campaign 11 NOT RUN** (evidence
`evidence/joint/c10/`, committed unchanged).
- **Host precondition:** the owner confirmed on 2026-11-06, before the run, that neither macOS sleep nor Parallels could
  suspend or pause the VM. Cells ran one after another in one shell, with a clean tracked tree.
- **Clock consistency:** per-cell wall-against-monotonic skew −10 to +6 ms, and within one trial at most 8 ms. No sign of
  suspension.
- **Cells:**
  - **MET (every criterion):** headless@1, headless@1.25, headless@2, headed@1 and headed@1.25. headless@2's S-5 p95 is
    598 ms against the 600 ms budget, with 2 cuts.
  - **NOT MET:** headed@2, **S-5 only**: state-work p95 1600 ms against 600 ms, with 0 late records. Every other headed@2
    criterion is MET.
  - **Pooled:** 0 late records in 1680 trials, 3 cuts; 0 false association, 0 false `ready` or `error`; 72/72 protected
    refusals with 0 frames; disabled controls carry no N8/N9 code and none is late. The pooled S-5 p95 is 426 ms
    (MET), but a campaign passes only when every cell does.
- **Why headed@2 S-5 fails (diagnosed once):** a state trial whose N9 work did not run counts at the full 1600 ms deadline
  (QC F3). 9 of headed@2's 156 state runs did not run: 1 cut (`spinner-paused/c`), 7 `visual-state-skipped`
  (`spinner/b`, `ready-red-accent/b`, `skeleton-shimmer/d` twice, `skeleton-static/d`, `partial-skeleton/d`,
  `ready-table/d`) and 1 with no state code. That puts the 95th percentile on the deadline. A skipped trial's marks show
  why, for example `skeleton-shimmer/d`: `inspect` at 43 ms, N5's first frame taken at 617 ms, fingerprint until 866 ms,
  then no reserve left in the work budget for N9's second capture, so N9 skips (fail closed, never a wrong code, never
  late).
- **Classification:** product timing. N5's first capture at headed DPR 2 is slow enough to starve N9's reserve; this is
  the open first-capture residual of `awkit-vra.18`. Not environment (no suspension evidence), not harness, and not
  `awkit-kv3n` (its fix changes only the cancelled and timed-out paths). Whether this is run-to-run variance against
  campaign 8's headed@2 MET or a regression is INCONCLUSIVE: campaign 8 recorded no phase marks to compare.
- **Sequence:** campaign 10 failed, so campaign 11 is not run, as pre-declared. N8 and N9 do not qualify on this revision.
- **Next (owner decision):** a product change to N5's first-capture budget or to N9's reserve at high DPR
  (`awkit-vra.18`), then a new revision and a new pre-declared campaign pair. Each such change voids `c10`/`c11` as a
  qualifying pair.
- **Correction found on 2026-11-06:** the `c11-` scripts committed with this pre-declaration (`bdb235c6`) read
  `--campaign 11--cell` (a missing space), so campaign 11 could not have run as written. It never ran, and no evidence
  is affected. The `c13-` scripts below are checked.

**N9 state-features reserve fixed (2026-11-06, `3e7f884b`; owner choice "fix it here").** The skip in campaign 10 was
not N9's second capture: the state-features gate reserved `stateFeatures` at 435 ns/px over every **device** pixel
(836 ms at DPR 2), but `measureVisualStateFrame` analyses every second pixel at DPR 1.75 and above (a quarter).
`benchmark:visual-sync-cost` re-measured on this host: state features max 299 ns/px at DPR 1, 125 at 1.25, and 108 ms
at DPR 2 (56 ns per device pixel, about 225 per analysed pixel), all within 435 ns per analysed pixel. The gate now
reserves `visualStateAnalysisPixels(...)` (209 ms at DPR 2); rates, criteria and deadlines are unchanged; the motion
plane keeps its device-pixel reserve (conservative: it also crops at full resolution, and only gates motion).
`verify:visual-diagnosis-deadline` D10 (DPR-2 first frame held to 700 ms): red-first `visual-state-skipped`, green
`visual-state-ready`; 51/0. Independent QC: APPROVED WITH FINDINGS (probe pixel count, a moved doc comment), both fixed
in `3e7f884b`.

**Campaigns 12 and 13: pre-declaration** (committed before either runs; same frozen repeat rule):
- **Revision:** the product source as of `3e7f884b`. Both run at the tip of `main` once this pre-declaration is committed,
  with a clean tracked tree. No later commit may change `src/**`, `app/**`, `mock-site/**`,
  `scripts/benchmark-visual-joint.mts`, `scripts/lib/visual-*-criteria.mts`, or the `benchmark:visual-joint:*` scripts;
  any such change, or any product change after campaign 12, voids the sequence. Campaigns 1 to 11 and every diagnostic
  folder stay unchanged.
- **Environment:** as for campaigns 10 and 11, including the owner's confirmation before campaign 12 that neither macOS
  sleep nor Parallels can suspend or pause the VM, cells one after another in one shell, no parallel work, the passive
  accounting's clock skew as the consistency record, and a suspension never counted as a product PASS.
- **What runs:** all six cells with N5, N8 and N9 on; held-out variants b, c and d, two repeats each; the protected and
  disabled-mode controls; passive accounting in every trial. `benchmark:visual-joint:<cell>` then `:aggregate` write
  `evidence/joint/c12/`; the `c13-` scripts write `evidence/joint/c13/`.
- **Criteria:** `N8_FROZEN_CRITERIA` R-1 to R-5 and `N9_FROZEN_CRITERIA` S-1 to S-5, unchanged; strict 1600 ms hard
  deadline with zero grace; every cut and late record listed and counted at the full deadline; no trial excluded;
  protected trials refused with zero frames and no code; disabled controls with no N8/N9 code, at most one frame, none
  late.
- **A campaign passes** only when every criterion is MET in every cell. Campaign 12 first; if it fails it is recorded
  NOT MET and campaign 13 does not run. N8 and N9 qualify on this revision only if both pass, followed by an independent
  N8/N9 review round that approves.
- **Status (superseded below):** NOT RUN at pre-declaration. The owner confirms the host suspension settings before
  campaign 12.

**Campaigns 12 and 13 (2026-11-06): both PASS; N8 and N9 qualified on `3e7f884b`, review APPROVED WITH FINDINGS.**
- **Host precondition:** before campaign 12 the owner confirmed in the session ("Confirmed, run c12") that neither
  macOS sleep nor Parallels could suspend or pause the VM. Clock skew per cell stayed at most 12 ms (c12) and 6 ms
  (c13), and at most 13 ms within any trial.
- **Sequence:** campaign 12 ran at `0bcb28ae` (all six cells, then the aggregate) and PASSED. Its evidence was committed
  unchanged in `c12bbf2e` before campaign 13 started. Campaign 13 ran at `c12bbf2e` and PASSED; evidence in `891a1635`.
  No commit between the pre-declaration and the results touched product, harness, labs, criteria or scripts. Every cell
  file records `treeClean: true`.
- **Campaign 12** (`evidence/joint/c12/`): every frozen criterion MET in every cell. Pooled: 0 late in 1680 trials;
  2 enabled-trial cuts (c12 headless@1 `ready-red-amounts/b` and `ready-gray-media/b`, ELU 0.89, host load); 0 false
  association; 0 false `ready` or `error`; 72/72 protected refusals with 0 frames; state p95 416 ms; row p95 50 ms.
  headed@2 S-5 p95 417 ms with no `skipped` (campaign 10: 1600 ms).
- **Campaign 13** (`evidence/joint/c13/`): every frozen criterion MET in every cell. Pooled: 0 late and 0 enabled-trial
  cuts in 1680 trials; 0 false association; 0 false `ready` or `error`; 72/72 protected refusals; state p95 421 ms; row
  p95 49 ms.
- **Independent N8/N9 review: APPROVED WITH FINDINGS.** Integrity verified: revisions, `treeClean`, the order of the
  campaigns, criteria frozen 2026-10-31 and unchanged, no trial excluded, 0 overruns, every protected trial with
  0 frames and no code, disabled controls clean. Findings:
  1. (Low) The owner's suspension confirmation was not yet written down. Recorded above.
  2. (Low) The plan and project state were stale after the evidence commits. Updated with this section.
  3. (Low) "0 cut" in the commit messages covers enabled trials only. At DPR 2, N5-only disabled controls end
     `budget-exhausted` in 8/10 (c12 headless@2), 4/10 (c12 headed@2), 9/10 (c13 headless@2) and 7/10 (c13 headed@2).
     They meet the control criteria, but this is direct evidence of the N5 first-capture budget residual
     (`awkit-vra.18`).
  4. (Info) Every cell records `arch: x64`: Node under x64 emulation on the ARM64 VM. All timing evidence is specific to
     that setup.
- **Qualified:** N8 (`awkit-vra.10`) and N9 (`awkit-vra.11`) meet their pre-declared qualification sequence on
  `3e7f884b`, with the findings above. This is not an unconditional approval. Beads closure is BLOCKED on a tracker
  lease.
- **Stays open under `awkit-vra.18`:**
  - N5's first-capture budget at DPR 2 (finding 3);
  - checking the reserve calibration (435 ns/px per analysed pixel, one host's benchmark) on another host;
  - the `verify:visual-diagnosis-deadline` D6 margin (one 1604 ms run, INCONCLUSIVE);
  - a second-host replication (all qualification ran on one Windows 11 ARM64 Parallels VM under x64 emulation).
- **Phase N** stays IN PROGRESS: N7.1b, N7.8 and N7.9 are blocked on the Windows packaging host.
