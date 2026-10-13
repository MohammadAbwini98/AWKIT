# N3 — Visual Locator Recovery

Shared rules and the Phase N boundary: `ROADMAP.md` › *Phase N — Visual Recognition and Automation* ›
*Canonical milestone map*. Epic `awkit-vra`. N3 follows N2 (`awkit-vra.12`, closed 2026-10-13, shadow-only). The
legacy workstream `awkit-vra.4` ("Visual locator fallback") is the tracker home for N3 (VR-9), retitled
"N3: Visual Locator Recovery" with children `awkit-vra.4.1`-`.4.6`.

**Status (2026-10-13): CLOSED SHADOW-ONLY.** N3.6 recorded the close (contract `awkit-vra-4-6-n3-state-1013`), and
the independent QC review of N3.1 and N3.3 (closure criterion 5) returned APPROVED WITH FINDINGS; its four findings
are closed (contract `awkit-vra-4-qc-n3-1013`), so all six closure criteria are met. The owner then removed the
legacy 2026-09-22 `blocks` edge from `awkit-vra.3` that had kept `bd close` from accepting it, and the epic bead
`awkit-vra.4` is **closed** (contract `awkit-vra-4-close-1013`). N3.4 and N3.5 stay deferred (`awkit-vra.4.4`/`.4.5`
blocked). See *Closure gates* below.
History: the owner approved VR-0 to VR-9 as recommended and authorized N3 (DECISIONS
2026-10-13, contract `awkit-vra-4-n3-start-1013`). N3.1 is done: `decideVisualAgreement` in
`src/visual/fusion/decideVisualAgreement.ts`, proven by `verify:visual-agreement` 258/0. N3.2 is done and its
acceptance **failed**: 28 `twins` decisions reached `agreed` in headless, because headless Chromium renders identical
icons with position-dependent bytes (`N3.2-agreement-calibration.md`). By the fallback fixed below, **N3 closes
shadow-only**: N3.4 and N3.5 are deferred. N3.3 is done (`verify:visual-agreement-runtime` 68/0, contract
`awkit-vra-4-3-runner-shadow-1013`); N3.6 is done. The three preconditions below were the plan-time
gates, kept for the record. All three are now met:

- the owner **amends the 2026-10-12 directive** in `docs/ai/DECISIONS.md`, which today says "Visual similarity must
  never cause a click, a fill, a selector replacement or a locator recovery" (VR-0). Without that amendment N3 cannot
  ship any execution-affecting behavior, and only N3.1-N3.3 (policy, calibration, shadow) may proceed;
- the owner records decisions VR-1 to VR-9 below in `docs/ai/DECISIONS.md`;
- the owner authorizes N3 implementation, with work items N3.1 onward filed as Beads children of the N3 bead.

## Objective

N2 FD-3 deferred "execution-affecting strengthening" to N3 under the L12 `agreed` template. N3 is that step, and
nothing wider:

> When the DOM recovery layers refuse **only because their own best candidate scored below threshold**, and that
> candidate still leads every other DOM candidate by the full recovery margin, a **pixel-identical** match between
> the candidate's current appearance and the step's last-known-good appearance, with no identical look-alike among
> the captured DOM competitors, may let that DOM candidate proceed through the unchanged veto chain. Visual evidence
> never names, ranks, searches for or breaks a tie between elements.

Success statement:

- **Recovery off (the default).** Locator resolution, recovery, retries and reports are exactly as today, decision
  for decision, including the N2 shadow observation.
- **Recovery shadow.** The trace records whether visual agreement *would* have proceeded. Nothing else changes.
- **Recovery enforce.** A `below-threshold` refusal whose DOM best candidate meets every condition in *Policy* is
  re-proven, pinned and acted on, through layer `visual-agreed`. Every other refusal is unchanged.
- **Never.** An element the DOM did not rank first; a candidate chosen among DOM near-ties; a selector, index or
  coordinate produced from pixels; a similarity threshold that grants identity.

## Why the scope is this narrow

Every boundary below comes from measured N1/N2 evidence, not preference.

| Measured fact | Source | Consequence for N3 |
|---|---|---|
| A look-alike outscores the true element after a restyle (0.9434 vs 0.6705) | N1 fixtures, `222b04d3` | No similarity score may grant identity. N3 uses **pixel identity** (`identical`, equal `contentDigest`) only |
| F1 restyle leads reach 3118 bp; F2 swap leads are 323-619 bp | `N2.3-fusion-calibration.md` | Relative margins cannot tell a restyle from a swap, so visual evidence must never choose between DOM candidates |
| F3 twins lead by 0 and are pixel-identical | N2.3 | Identity alone is not uniqueness. Any identical competitor refuses |
| A real headed Ctrl+zoom is refused by capture | N2.3, `DECISIONS.md` 2026-10-12 | Zoomed pages degrade to the DOM-only decision |
| Shadow stage p50 160-259 ms, p95 under 400 ms in every cell | `N2-overhead-matrix.json` | The FD-5 400 ms budget is usable unchanged |
| References are written only by `AWKIT_VISUAL_FUSION=shadow` passing resolves, at most once per 60 s per step | N2.4b | Without N4 seeding, N3 helps only steps that previously passed with the shadow observation on |

The `ambiguous-margin` refusal is excluded on purpose. In that case the DOM itself cannot tell two candidates apart,
and letting appearance decide is exactly the F2 swap hazard: the neighbour now carrying the remembered icon would be
picked. VR-3 records this, and reopening it requires a separate owner decision backed by new measurements.

## Today's baseline (as built, `16cf6fb6`)

| Owner | Facts N3 must not redefine |
|---|---|
| `src/runner/recoverySnapshot.ts` `gateRecovery` | Score ≥ 0.86 (`RECOVERY_SCORE_THRESHOLD`), margin ≥ 0.08 (`RECOVERY_MARGIN`), ancestry ≥ 0.5 (`RECOVERY_MIN_ANCESTRY`). Refusals are checked in that order, so a `below-threshold` decision may also lack the margin. `RecoveryDecision` exposes `best`, `runnerUp` and up to 3 `contenders`. |
| `decideProviderAgreement` | The L12 `agreed` template: AWKIT's best, refused only on score or margin; best score ≥ 0.6 (`AGREEMENT_MIN_IDENTITY`); ancestry veto; provider top equal to AWKIT's best with a clear lead; a score refusal must still hold AWKIT's margin. N3 copies this shape and narrows it. |
| `LocatorFactory.recover()` / `proveSnapshotWinner` | Layers local → blueprint → provider-agreed. A refused decision is recorded in `proveSnapshotWinner` and returns `undefined`; that refused decision, with `best` / `runnerUp` / `contenders`, is N3's input. Every winner passes `distinct` → `insideContainer` → `requireActionable`, then `recheckSnapshotWinner` pins it. |
| `src/runner/visualFusion/VisualFusionStage.ts` | The single allowed edge into `src/visual` (FD-2). Shadow observation only, after every veto, in `recover()`'s `finally`. Single-capture fan-out, 400 ms budget, I9-only trace fields. |
| `src/runner/visualFusion/VisualReferenceStore.ts` | One versioned, bounded sidecar per step scopeKey; corrupt reads R1, other versions R2; 60 s refresh, digest-change only. |
| `src/visual/compare.ts` | `identical` means equal `contentDigest`; only identical images score 10000 bp. |

## Policy

### Inputs and output (pure, in `src/visual/fusion/`)

```text
VisualAgreementInput
  dom:        { refusal: RecoveryRefusal,                 // must be "below-threshold"
                best: { score, ancestry },                // AWKIT's own best candidate
                margin,                                   // best − runner-up DOM score (1 when no runner-up)
                competitorCount }                         // DOM candidates in the pruned set, excluding best
  reference:  VisualEvidence | unavailable(reason)        // last-known-good, from VisualReferenceStore
  best:       VisualEvidence | unavailable(reason)        // the DOM best, captured now
  competitors: (VisualEvidence | unavailable)[]           // runner-up + contenders, same capture frame
  conditions: { dprMatch, viewportMatch, frameDepthMatch }

VisualAgreementVerdict
  version: 1
  outcome: "not-eligible" | "unavailable" | "refused" | "agreed"
  reason:  bounded code                                   // never page content
  // NO locator, NO index, NO selector, NO coordinate. "agreed" only lets the DOM best proceed.
```

### Decision table

`agreed` is reachable in exactly one row, and every earlier row wins:

| Row | Condition | Outcome | Reason |
|---|---|---|---|
| A1 | Mode off, step not eligible (VR-5), or refusal ≠ `below-threshold` | `not-eligible` | `mode-off` / `ineligible-step` / `refusal-not-eligible` |
| A2 | `best.score` < 0.6, ancestry < 0.5, or DOM margin < 0.08 | `refused` | `dom-floor` |
| A3 | No reference, or reference version/corruption (R1/R2) | `unavailable` | `no-reference` / `reference-invalid` |
| A4 | Any capture unavailable: protected, budget, stale, offscreen, DPR/zoom mismatch, frame mapping, page closed | `unavailable` | the capture code |
| A5 | Conditions differ from the reference (DPR, viewport class, frame depth) | `unavailable` | `conditions-changed` |
| A6 | More DOM competitors than were captured (VR-4) | `refused` | `competitors-uncaptured` |
| A7 | Best is **not** pixel-identical to the reference | `refused` | `not-identical` |
| A8 | Any captured competitor is pixel-identical to the reference, or to the best | `refused` | `identical-competitor` |
| A9 | Otherwise | `agreed` | `identical-unique` |

`agreed` is necessary, never sufficient: the candidate then passes the unchanged `distinct`, `insideContainer` and
`requireActionable` vetoes and `recheckSnapshotWinner` pin. A veto there rewrites the stage to `refused` exactly as
for the other layers.

### Hard invariants

Each invariant is asserted by verifier and mutation-tested. N2's I3-I9 carry over unchanged.

| ID | Invariant |
|---|---|
| J1 | **DOM-chosen only.** The only element that can proceed is `RecoveryDecision.best`. The policy has no input that could name another element, and its output names none. |
| J2 | **Narrow refusal set.** Only `below-threshold` with the DOM margin, ancestry and 0.6 floors holding. `ambiguous-margin`, `ancestry-veto`, `no-candidate` and every snapshot failure are never rescued. |
| J3 | **Identity, not similarity.** `agreed` requires equal `contentDigest`. No similarity score, margin or threshold can produce `agreed`. |
| J4 | **Uniqueness.** Any identical competitor refuses, and an uncaptured competitor refuses. |
| J5 | **Same veto chain.** `distinct`, `insideContainer`, `requireActionable` and the pin run after `agreed` with no bypass. |
| J6 | **Monotone over off and shadow.** With recovery off or shadow, every stage and step outcome equals a run without N3 (A/B on the runtime lab, not inferred). Enforce adds actions only in row A9. |
| J7 | **No laundering.** A `visual-agreed` recovery never refreshes the visual reference and never writes winner memory that a later run could use to skip the DOM gate. |
| J8 | **Protected and sensitive.** Never on a protected surface, a protected-login, secure-login, session-reuse or manual-handoff step, or a sensitive guarded-positional step. |
| J9 | **Bounded.** The whole visual decision shares the FD-5 400 ms budget; exhaustion is `unavailable`, never a delay. |

## Architecture

```text
LocatorFactory.recover()
  local layer: proveSnapshotWinner(decision)
      winner                    → existing path (unchanged)
      refused "below-threshold" → visualAgreement(decision)                 (NEW, enforce or shadow)
             │ option absent / mode off → return undefined (no import executed, identical path)
             ▼
  VisualFusionStage.agree(page, decision, reference)     ← still the ONLY runner edge into src/visual
      one capture frame: best + runner-up + contenders (single-capture fan-out, N2.4)
      verdict = decideVisualAgreement(input)              (pure, src/visual/fusion)
      shadow  → record verdict in trace.visual only
      enforce → "agreed": return best as layer "visual-agreed"
                → distinct → insideContainer → requireActionable → recheckSnapshotWinner (unchanged)
```

- The local layer is the only insertion point. Blueprint and provider-agreed refusals are not rescued in N3 (VR-6).
- No new runner module imports `src/visual`; `verify:visual-isolation` stays at one allowed edge.
- The `LocatorFactoryOptions.visualFusion` injection is reused; enforce is a mode, not a second option.

## Reporting

- `LocatorRecoveryStage.stage` and the provenance layer gain `visual-agreed`. The stage reason union gains the
  bounded codes from the decision table.
- The `recovery-trace` `visual` block gains `kind: "agreement"` and `effect: "none" | "proceed"`. `proceed` is the
  first non-`none` effect in Phase N, so `toRecoveryProvenance`'s allowlist and `verify:recovery-provenance` change
  with it.
- Report UI changes stay in N5.

## Owner decisions before implementation

| ID | Decision | Recommendation |
|---|---|---|
| VR-0 | Amend the 2026-10-12 directive ("Visual similarity must never cause … a locator recovery") | Amend to: "Visual similarity must never cause a click, a fill or a selector replacement. Pixel identity may let the DOM's own best candidate proceed under N3's agreement rule." Until this is recorded, N3 stops at shadow (N3.3). |
| VR-1 | Modes | `off` (default) / `shadow` / `enforce`. Shadow first; enforce only after N3.4 acceptance. |
| VR-2 | Identity evidence | Pixel identity only (`contentDigest`), with the default 24 px context crop so the neighbourhood is part of the identity. No similarity threshold. |
| VR-3 | Eligible refusals | `below-threshold` only, with margin ≥ 0.08, ancestry ≥ 0.5 and best ≥ 0.6. `ambiguous-margin` stays refused; reopening it needs a new decision and new measurements. |
| VR-4 | Competitor coverage | Every other candidate in the pruned snapshot must be captured, up to 8. More candidates, or any offscreen or failed capture, refuses (`competitors-uncaptured`). This widens FD-7's K = 3 for this path only, and N3.2 must show it fits FD-5. |
| VR-5 | Eligible steps | Element steps (click-like, fill, select, check, radio), not sensitive, not protected, not handed off. Sensitive guarded-positional steps never. |
| VR-6 | Layers | Local only in N3. Blueprint and provider refusals keep their current behavior. |
| VR-7 | Reference source | The existing N2.4b store. A `visual-agreed` recovery never refreshes it (J7). Recorder seeding is N4. |
| VR-8 | Enablement | Env `AWKIT_VISUAL_RECOVERY=shadow|enforce`, separate from `AWKIT_VISUAL_FUSION`. No persisted Settings key until enforce is accepted (the FD-8 reasoning). |
| VR-9 | Tracker | Retitle legacy `awkit-vra.4` to "N3: Visual Locator Recovery" (its acceptance text already matches J1/J4). File N3.1 onward as its children, blocked by `awkit-vra.12`. Keep its edges to `.6` and `.8`. |

## Work breakdown

Proposed Beads children of the N3 bead. They are filed only on authorization.

| Item | Scope | Risk | Owner agents | Verification |
|---|---|---|---|---|
| N3.1 | Pure policy `src/visual/fusion/decideVisualAgreement.ts` and its verdict type. No I/O. | 1 | software, qa | New `verify:visual-agreement`: exhaustive A1-A9 table, J1-J4 property tests over generated inputs (no input naming a non-best element can reach `agreed`), determinism, cardinality guards on every collection, mutations red |
| N3.2 | Calibration. Extend `/visual-intelligence/fusion` with a `drift` scenario (attributes and name changed so the DOM best leads but scores below 0.86, appearance unchanged), plus the existing swap/twins/restyle/theme. Measure at DPR 1, 1.25, 2, headed and headless, across fresh browser launches: identical recall for the true target, false-identical count, capture cost with up to 8 competitors. | 1 | qa, recorder-playwright, performance | `verify:mock-site`; a new informational `benchmark:visual-agreement`. Acceptance: false `agreed` = 0 on swap, twins and restyle; recall reported, not assumed |
| N3.3 | Runner shadow: `VisualFusionStage.agree`, the local-layer hook in `recover()`, the trace block. | 2 | backend, integration (review), qa | New `verify:visual-agreement-runtime` (real browser): off-vs-shadow A/B identical apart from `trace.visual` (J6); `verify:visual-isolation` still one edge; `verify:runner`, `verify:locator-guard`, `verify:twin-pool-safety`, `verify:recovery-provenance` |
| N3.4 | Enforce (needs VR-0): layer `visual-agreed`, the full veto chain and pin, J7 no-laundering. | 3 | backend, qa, qc-reviewer, security (review) | Runtime lab: `drift` proceeds and acts on the right element; swap, twins, restyle, protected, sensitive, zoomed and offscreen refuse; false-proceed count 0; mutations red for every J-invariant |
| N3.5 | Provenance: `visual-agreed` and `effect: proceed` in `toRecoveryProvenance` and its allowlist. | 2 | backend, integration (review) | `verify:recovery-provenance`, build |
| N3.6 | State and docs: `CURRENT_STATE`, `TASK_LOG`, `ARCHITECTURE`, `DECISIONS` (VR-0 to VR-9), verifier registry, dashboard. | 0 | project-state | `verify:verifier-classification`, `verify:roadmap-dashboard` |

Dependency order:

```text
N3.1 → N3.2 → N3.3 → (VR-0 recorded) → N3.4 → N3.5 → N3.6
```

If N3.2 shows any false `agreed`, or recall too low to be useful, N3 closes shadow-only, the same fallback N2 used
under FD-9.

**N3.2 outcome (2026-10-13): fallback applied.** Recall was useful (cross-launch 66/72 baseline, 65/72 drift; every
miss headless DPR 1), and no decision whose DOM best was not the true element agreed (0 of 4644), but `twins` gave 28
false `agreed`, all headless. N3.4 and N3.5 are deferred; the order is now N3.3 → N3.6.

**N3.3 outcome (2026-10-13): done, shadow only.** The verdict is recorded as a sibling `visualAgreement` trace block
rather than inside `trace.visual`, so the N2 block keeps its codes (only its timings differ) and J6 compares runs
with that key and the event-message suffix it appends dropped. `enforce` is decided as `shadow` with effect `none`.
Provenance is unchanged.

**N3.6 outcome (2026-10-13): done.** `CURRENT_STATE`, `HANDOFF`, `TASK_LOG`, `ARCHITECTURE` (agreement-layer
boundary), `DECISIONS` (VR-0 to VR-9 outcome), this plan, `ROADMAP` and `ImplementationRoadmap` record the
shadow-only close; both N3 verifiers are registered; `awkit-vra.4.6` is closed.

## Acceptance criteria for closing N3

1. N3.1-N3.6 complete, or N3.4/N3.5 deferred by a recorded N3.2 outcome.
2. `verify:visual-agreement` and `verify:visual-agreement-runtime` pass, are registered, and their mutation contract
   is observed red.
3. Existing gates pass at the final state: the N2 visual suites, `verify:runner`, `verify:locator-guard`, the L11/L12
   recovery suites, `verify:mock-site`, `npm run build`.
4. J6 A/B neutrality measured for off and shadow.
5. Independent QC review (Risk 3 for N3.4).
6. Overhead on the lab, DPR 1 and 2, headed and headless, within FD-5.

### Closure gates (recorded 2026-10-13, N3.6)

| # | State | Evidence |
|---|---|---|
| 1 | MET | N3.1, N3.2, N3.3 and N3.6 done; N3.4 and N3.5 deferred by the recorded N3.2 outcome (`awkit-vra.4.4`/`.4.5` declared blocked). |
| 2 | MET | `verify:visual-agreement` 258/0 and `verify:visual-agreement-runtime` 68/0, both registered; mutation contracts observed red (N3.1 policy mutations; runtime M1-M4). |
| 3 | MET | At the N3.3 source state: `verify:visual-fusion` 271/0, `verify:visual-fusion-runtime` 145/0, `verify:visual-isolation` 40/0, `verify:runner` 138/0, `verify:locator-guard` 38/0, `verify:twin-pool-safety` 48/0, `verify:recovery-provenance` 46/0, `verify:similar-rows-safety` 68/0 (run at N3.6), `verify:mock-site` 307/307 (N3.2; inputs unchanged), `npm run build` PASS. |
| 4 | MET | `verify:visual-agreement-runtime` compares off, the N2 stage alone, shadow and enforce with only the `visualAgreement` key dropped. |
| 5 | MET | Independent QC review of N3.1/N3.3 (2026-10-13): APPROVED WITH FINDINGS, all four closed in the QC-close commit (contract `awkit-vra-4-qc-n3-1013`). See *QC findings* below. N3.4, the Risk-3 item, was not built, so no Risk-3 review was owed. |
| 6 | MET (shadow) | N3.2 measured the agreement read within the 400 ms FD-5 budget in every cell but one headless DPR 1 run, which the budget cuts (R2). FD-5 must be re-measured before any enforce work. |

Re-run at the QC-close source state: `verify:visual-agreement-runtime` 81/0 (mutation M5 observed red),
`verify:visual-agreement` 258/0, `verify:visual-fusion-runtime` 145/0, `verify:visual-isolation` 40/0,
`verify:runner` 138/0, `verify:locator-guard` 38/0, `verify:twin-pool-safety` 48/0, `verify:recovery-provenance`
46/0, `verify:similar-rows-safety` 68/0, `verify:dom-intelligence-coverage` 74/0, `npm run build` PASS.

### QC findings (independent review, 2026-10-13)

Verdict APPROVED WITH FINDINGS: no blocker, no safety defect; the shadow-only boundary, J7 and J8 held. The
reviewer did not read `DECISIONS.md`, so that cross-check is INCONCLUSIVE, not passed.

| ID | Severity | Finding | Closure |
|---|---|---|---|
| Q4-a | minor | A local refusal that a later layer recovered ran the N2 observation and the agreement back to back with 400 ms each, about 800 ms, against J9. | Fixed: `boundedVisualObservation` takes a budget and the agreement gets what the N2 observation left (none left is `budget-exhausted` without a capture). New J9 section (quick, partial, spent) in `verify:visual-agreement-runtime`; mutation M5 (a fresh 400 ms) is red on 3 checks. |
| Q8/Q9-a | minor | Docs and test overstated J6: the agreement also appends an event-message suffix, and the A/B dropped the whole N2 block. | Fixed: a new A/B keeps `visual` and strips only timings, `visualAgreement` and the suffix; `ARCHITECTURE` and this plan now state both differences. |
| Q8-b | nit | The sensitive-step check passed on an empty record set. | Fixed: asserts zero observations, records, reference reads and no trace block, because the factory refuses sensitive recovery before any layer scores. |
| Q8-c | nit | Retries on `no-reference`/`budget-exhausted` could hide an intermittent regression. | Dispositioned: a case whose every attempt is cut fails, never passes on the cut; the per-case retry count is printed. No suite-wide ceiling was added, because a loaded host measured 9 cuts in one run and 4 in the next with no code change (rationale in the verifier docblock). |

## Risks

- **Low recall.** Pixel identity breaks on font hinting, focus rings, hover, animation and caret. That fails closed,
  but may make N3 rarely useful. N3.2 measures it instead of assuming it.
- **Reference availability.** Without N4 seeding, only steps that passed with shadow fusion on have a reference.
- **Directive change.** VR-0 is the first Phase N decision that lets visual evidence affect execution. It should be
  reviewed against the N2 evidence above, not against intuition.
