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
