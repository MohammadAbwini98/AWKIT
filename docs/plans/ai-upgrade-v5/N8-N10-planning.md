# N8, N9 and N10 — planning baseline (dependencies, boundaries, acceptance, owner decisions)

- **Status:** PLANNING ONLY, 2026-10-25. No decision below is ratified, nothing is implemented, and nothing is
  authorized. Each milestone gets its own technical plan (as N6 and N7 did) before ratification.
- **Phase N:** in progress. N0–N6 are closed. N7 is planned (`N7-ocr-text-in-image.md`, OC-0 to OC-12 awaiting
  ratification). `awkit-vra.16` (production visual enforcement) is a separate open milestone and is untouched here.

## Shared rules (inherited from N0–N7, not re-decided)

- **DOM-first, evidence only.** No milestone here picks a target, makes or replaces a locator, clicks, types,
  navigates, retries or changes a step's outcome. Output feeds the N2 shadow observation (effect `none`), N5-style
  codes-only diagnosis, or an observe-only assertion.
- **Protected boundary.** Every capture goes through the N0 guard in the strict protected window, with the N6.8
  sensitive-container rule. Protected, handed-off and sensitive surfaces are refused with zero captures.
- **Offline.** No cloud, CDN or runtime download. Assets are pinned, checksummed and in the signed dependency
  manifest.
- **Disabled means today's behavior.** Each feature has a default-off flag, a lazily loaded adapter, and zero
  overhead when off.
- **Codes only.** No pixels, recognized text or page content persisted; sanitized report blocks are allowlisted on
  write and read.
- **`src/visual` isolation.** Any new adapter edge is an explicit owner decision, and `verify:visual-isolation` is
  moved to match.
- **Measured, fail-closed.** Calibration per render-mode × DPR cell (the N6.6 method); a cell that misses its
  criteria stays observe-only and is never relabelled.

## Dependency graph (tracker state 2026-10-25)

| Milestone | Beads | Canonical prerequisites | Tracker edges | Notes |
|---|---|---|---|---|
| N7 OCR | `awkit-vra.9` | N0, N1, N3 (`awkit-vra.4`) | `.4` | Legacy `.3` edge already absent |
| N8 Row/Grid | `awkit-vra.10` | N0, N1, N2, N3 (`.4`); **optionally N7** for row text cues | `.4` | Legacy `.3` edge already absent. The N7 edge is decided in NR-1, not assumed |
| N9 Screenshot state | `awkit-vra.11` | N0, N1, N2, N3 (`.4`); N5 diagnosis; **optionally N7** for state text | `.4` | As N8 |
| N10 Local vision model | `awkit-vra.17` (filed 2026-10-25) | N2 (`awkit-vra.12`), N3 (`.4`); the L7 local-AI runtime and GPU backend pack (Phase L, existing) | `.12`, `.4` | Never a prerequisite of N0–N9 or of core automation |

The legacy `awkit-vra.3` ("Deterministic image recognition") is an open pre-canonical planning record. Its scope was
split into canonical N1 (fingerprints, closed) and N3 (`awkit-vra.4`, closed), and the owner already removed its
edge from `awkit-vra.4`.

Reconciled 2026-10-25: the live database and the re-exported `.beads/issues.jsonl` show no `.3` edge on `.9`, `.10`
or `.11`. They were removed outside the agent, so NR-0 and NS-0 are already satisfied, and no removal is pending.

## N8 — Visual Row/Grid Intelligence (`awkit-vra.10`)

- **Purpose.** Recognize repeated visual structure (table rows, cards, list items) from a guarded capture of a
  DOM-proven container. The result is evidence about which row a DOM candidate visually belongs to, and whether rows
  look uniform, for diagnosis and N2 shadow corroboration.
- **Builds on:** N0 element and container capture, N1 fingerprints and dHash per row band, the N2 observation, and
  N5 codes.
- **Boundaries:**
  - The container must be resolved by its DOM locator to exactly one visible element; no full-page scans.
  - The output is row count, band geometry relative to the container, and the per-row fingerprint similarity class:
    codes and counts only.
  - Never chooses a row to act on.
  - Virtualized lists: only mounted rows are seen; an unmounted row is `not-examined`, never inferred.
- **Acceptance (proposed):**
  - deterministic Lab fixtures: uniform tables, zebra striping, merged cells, virtualized lists, nested grids,
    look-alike rows;
  - zero false "candidate is in row k" claims on look-alike fixtures; ambiguity gives `inconclusive`;
  - disabled overhead zero; p95 cost within a budget set in NR-4;
  - `verify:visual-isolation` updated if a new edge is ratified;
  - independent QC and security review.
- **Owner decisions:**
  - **NR-0:** remove the legacy `.3` edges. Already satisfied: the edges are absent.
  - **NR-1:** whether N8 consumes N7 text, which makes N7 a hard prerequisite.
  - **NR-2:** a new `src/visual` edge, or reuse of the N5 adapter.
  - **NR-3:** where results surface (N2 shadow and N5 codes only, or also an observe-only assertion).
  - **NR-4:** the performance budget.
  - **NR-5:** calibration criteria.

## N9 — Screenshot State Recognition (`awkit-vra.11`)

- **Purpose.** Classify a page region's visual state (`loading`, `empty`, `error`, `ready`, `unknown`) from a guarded
  capture, as evidence for diagnosis and for observe-only waits or assertions. It complements Smart Wait's DOM
  signals and never replaces them.
- **Builds on:** N0 viewport and element capture, N1 features, N5 failure diagnosis (a "page looked like an error"
  observation), the mock-site Async Results and Runner labs for fixtures, and optionally N7 for error and empty text.
- **Boundaries:**
  - Never inspects protected authentication surfaces.
  - The classification is deterministic (feature rules over fingerprints, uniformity and spinner motion) unless N10
    is ratified to add a model.
  - The state is advisory: Smart Wait completion and step outcomes stay DOM-decided.
  - `unknown` is the default; a state is reported only above calibrated thresholds.
- **Acceptance (proposed):**
  - fixtures for skeletons, spinners, empty states, inline errors, toasts, partial loads and protected pages;
  - no protected capture;
  - false `ready` rate 0 on loading fixtures; false `error` rate ≤ the NS-3 bound;
  - disabled overhead zero;
  - independent QC and security review.
- **Owner decisions:**
  - **NS-0:** remove the legacy `.3` edge. Already satisfied: the edge is absent.
  - **NS-1:** a deterministic-only classifier versus an optional N10 assist.
  - **NS-2:** where state evidence surfaces (N5 diagnosis, an observe-only `assertVisualState` step, or a Smart Wait
    advisory trace).
  - **NS-3:** calibration criteria and the error/ready bounds.
  - **NS-4:** whether N7 text is used.

## N10 — Optional Local Vision Model (`awkit-vra.17`)

- **Purpose.** An optional, offline local vision model as a further advisory evidence source, for example a
  description or classification of a guarded element crop that strengthens or vetoes N2/N9 evidence. It never
  selects or acts.
- **Hardware-adaptive, never required:**
  - Reuse the existing L7 local-AI utility-process host and its runtime policy, rather than a second ML stack:
    - CPU fallback always available;
    - compatible NVIDIA acceleration when the signed GPU backend pack is installed and qualified (Automatic and
      CPU & RAM modes, generic NVIDIA detection; DECISIONS 2026-10-03);
    - no NVIDIA requirement, and no model in the base package.
  - Model packs are user-imported, signed and checksummed, like the L7 model pack; no runtime download.
  - Core automation, Recorder, Runner and N0–N9 work identically with the model absent, disabled, failing or slow.
- **Boundaries:**
  - The input is only guarded, protected-refused crops of DOM-proven elements.
  - Output is bounded codes and scores. No free text is persisted; any text shown to the user is transient and
    gated like the N6.5 preview.
  - The work runs under a deadline with cancellation; a slow model yields `budget-exhausted`, never a blocked step.
  - The model output can never pass an assertion or recover a locator on its own.
- **Acceptance (proposed):**
  - absent, disabled and failing model: byte-identical runs and reports;
  - CPU-only and NVIDIA paths both measured; the GPU path is never required;
  - no network, ever (packaged verifier);
  - calibration of any decision the model influences, with fail-closed thresholds;
  - memory and latency budgets enforced;
  - independent QC and security review.
- **Owner decisions:**
  - **NV-0:** the model family and licence (vision-language versus classifier), and the pack format.
  - **NV-1:** reuse of the L7 host versus a separate host.
  - **NV-2:** which N2/N9 decisions it may influence (shadow only first).
  - **NV-3:** hardware tiers and budgets (CPU baseline, NVIDIA qualification reuse).
  - **NV-4:** privacy of any transient text shown to the user.
  - **NV-5:** packaging (the model is never in the base package).

## Order and readiness

1. The owner ratifies N7 OC-0 to OC-12, then N7.1a feasibility, then N7.2 onward.
2. N8 and N9 technical plans are written next; each depends on NR-1/NS-4 (the N7 coupling) being decided.
3. The N10 technical plan comes last: it is optional, and its value depends on the N9 deterministic baseline.

No milestone here is implemented, closed or authorized by this document.

## Proposal for owner ratification (2026-10-31) — PROPOSED, NOT RATIFIED

These are recommended answers, not decisions. Nothing below authorizes implementation, and N8, N9 and N10 stay
planning-only and open until the owner ratifies each line.

| ID | Recommended answer | Why |
|---|---|---|
| NR-1, NS-4 | **No** hard dependency on N7 text. N7 OCR is unqualified (OC-10 NOT MET, DECISIONS 2026-10-28). | A dependency would import an unverified signal into new milestones. |
| NR-2 | Reuse an existing visual adapter only where `verify:visual-isolation` still passes unchanged; otherwise ask for an explicit new edge. | Keeps the approved five-edge isolation. |
| NR-3 | N2 shadow and N5 codes only first; no action, selection, branch or retry. | The same shadow-first path N2 to N6 took. |
| NR-4, NR-5 | Measure p95 and accuracy baselines on the N6.6-style cells **before** implementation, and pre-declare calibration criteria from them. | No figure is claimed before it runs. |
| NS-1 | Deterministic-only classifier: `loading`, `empty`, `error`, `ready`, `unknown`. Default `unknown`, `effect: none`. No N10 dependency. | Works with no model. |
| NS-2 | N5 diagnosis evidence only; no Smart Wait success, workflow control or retry effect. | Avoids a false-ready deciding a run. |
| NS-3 | Pre-declare false-ready and false-error ceilings and a performance budget before measuring. | Same discipline as OC-10. |
| NV-0 to NV-5 | Either (a) a bounded, separately qualified optional advisory model on the L-phase local runtime (CPU fallback, generic qualified NVIDIA acceleration, user-supplied and hash-pinned, never in the base package, no online service), or (b) an explicit owner-ratified transfer or deferral of N10 out of Phase N. | N10 must never be silently dropped or marked implemented without code. |

**Recommended order once ratified:**
1. N9 deterministic baseline.
2. N8 row/grid evidence.
3. N10: either (a) or (b).

N8 and N9 each start with a measured baseline and pre-declared criteria, then shadow/codes-only code, then
calibration.

## Phase N closure matrix (2026-10-31, source-verified)

Phase N closes only when every milestone in its ratified scope is closed on evidence, or has an explicit, recorded
owner-approved disposition. It stays IN PROGRESS.

| Milestone | Tracker | State | Blocking kind |
|---|---|---|---|
| N0–N6 | `.1`, `.3.1`, `.12`, `.4`, `.13`, `.14`, `.15` | closed (N2, N3 and N6 shadow/observe-only) | — |
| N3.4, N3.5 | `.4.4`, `.4.5` | blocked | new measurements and an owner decision |
| N6P | `.16` | open, a future milestone | owner decision: inside or outside Phase N closure |
| N7.1b, N7.8 | `.9.3`, `.9.9` | open, BLOCKED | environment (Visual Studio 2022 MSVC v143) and packaged evidence |
| N7.7 | `.9.8` | open, not started | code, after its design points (N7 plan § N7.7) are settled |
| N7.9 | `.9.10` | open | needs N7.7, N7.1b and N7.8 |
| N7.10 | `awkit-2shc` | open, independent | independent follow-up (A1 Option 1), outside Phase N closure |
| N8, N9, N10 | `.10`, `.11`, `.17` | open, planning only | owner decisions above |
| Legacy `.2`, `.3`, `.5`–`.8` | pre-canonical planning records | open | owner decision: close as superseded by the canonical milestones, or keep |

Roadmap consistency ("Sources agree") is separate from completion: the sources agree, and Phase N is not complete.
