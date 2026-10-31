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
