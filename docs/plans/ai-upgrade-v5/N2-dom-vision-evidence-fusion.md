# N2 — DOM + Vision Evidence Fusion

Shared rules and the Phase N boundary: `ROADMAP.md` › *Phase N — Visual Recognition and Automation* ›
*Canonical milestone map*. Beads `awkit-vra.12` (epic `awkit-vra`), blocked by N0 `awkit-vra.1` and N1
`awkit-vra.3.1`, both closed after the independent re-QC PASS at `222b04d3`.

**Status (2026-10-12): PLAN DELIVERED, zero implementation.** This document is the N2 implementation
plan. It authorizes no runtime, schema, settings, UI, dependency, model or service change.
Implementation starts only after two things happen:

- the owner records decisions FD-1 to FD-9 below in `docs/ai/DECISIONS.md`;
- the owner authorizes N2 implementation, with work items N2.1 onward filed as Beads children of
  `awkit-vra.12`.

## Objective

> Combine existing DOM/accessibility/structural evidence with advisory visual evidence under a
> fail-closed confidence/contradiction policy. Visual evidence may strengthen or veto a semantic
> candidate but must not independently identify an action or cause a click. No coordinate-only
> execution. No visual-score-only recovery. No model requirement.

Success statement:

- **Fusion off (the default).** Locator resolution, recovery, retries and reports are exactly as
  today, decision for decision.
- **Fusion on.** A DOM-chosen recovery winner whose appearance contradicts the step's last-known-good
  appearance is refused with a named reason. Otherwise it proceeds as today, and the run's provenance
  says whether the winner was visually corroborated, contested, contradicted or not visually checked.
- **Never.** No element is acted on that the DOM layers did not already choose. Visual evidence never
  produces a selector, an index or a coordinate.

## Non-goals and hard exclusions

| Excluded from N2 | Owner |
|---|---|
| Visual search for a target the DOM layers did not find; any change that turns a DOM refusal into an action | N3 Visual Locator Recovery |
| Recorder-time visual capture and reference seeding | N4 Recorder Visual Intelligence |
| Failure-diagnosis UI and image attachments | N5 Visual Failure Diagnosis |
| Screenshot assertions and visual regression | N6 Visual Assertions |
| OCR or text in images | N7 (`awkit-vra.9`) |
| Row and grid intelligence | N8 (`awkit-vra.10`) |
| Page-state recognition | N9 (`awkit-vra.11`) |
| Any vision or language model | N10 Optional Local Vision Model |

Also excluded:

- coordinate-based or mouse-based interaction of any kind;
- persisting or transmitting pixels (N2 stores only image-free `VisualEvidence`, at most 4096 bytes per
  record);
- capture on a protected-login, MFA, OTP, CAPTCHA, passkey or approval surface, or during a
  protected-login, secure-login, session-reuse or manual-handoff step;
- any new npm dependency;
- any change to the recovery thresholds (0.86 score, 0.08 margin, 0.5 ancestry) or to the provider
  agreement rule.

## Today's baseline (as built, `718b8d5f`)

### DOM evidence: the decision owners N2 must not redefine

| Owner | Facts |
|---|---|
| `src/runner/recoverySnapshot.ts` `gateRecovery` / `rankLocalRecovery` | The single recovery gate: score ≥ 0.86, margin ≥ 0.08 over the runner-up, ancestry ≥ 0.5, step-type compatibility. It refuses rather than choosing between near-ties. |
| `decideProviderAgreement` | L12 `agreed`: AWKIT's best candidate, refused only on score or margin, that the DOM-intelligence provider independently ranks first with a clear lead. This is the **only** existing precedent for a second evidence source affecting execution, and it is DOM evidence. |
| `recheckSnapshotWinner` / `elementPin` | Every winner is re-proven and pinned before the step acts. |
| `LocatorFactory.recover()` (`src/runner/LocatorFactory.ts`) | Layers run in order local → blueprint → provider. Every winner passes the same veto chain before it is returned: `distinct` (twin veto, L12.23/25), `insideContainer` (L12.24), `requireActionable` (L11.F). A veto rewrites the last `LocatorRecoveryStage` to `refused` with a reason and the step falls back to its recorded locator's own auto-wait. **This chain is N2's insertion point.** |
| `LocatorRecoveryStore` `LocatorRecoveryRecord` | Winner memory per scenario step: fingerprint, route, twin digests, scan key. Shared by every instance and run of the step, with a serialized read-modify-write (`update`, L12.30). |
| `emitTrace` → `recovery-trace` | One bounded event per recovery attempt, with stages, suggestion and context. This is where N2's verdict is reported. |

### Visual evidence: N0/N1, closed

| Owner | Facts |
|---|---|
| `src/visual/capture.ts` `captureElement` | Captures one viewport screenshot, then crops it. Bounds are measured before and after (a moved target is `TARGET_STALE`); a non-unique target is `TARGET_NOT_UNIQUE`; the target is never scrolled into view (`TARGET_OFFSCREEN`); a DPR or zoom mismatch is refused; the protected guard runs before and after capture. Defaults: 5000 ms budget, 24 px context crop. |
| `src/visual/fingerprint.ts` / `compare.ts` | Deterministic fingerprints of about 942 bytes. `compareVisualFingerprints` is **advisory**: it returns no match decision and no threshold, and only pixel-identical images score 1. |
| `src/visual/visualEvidence.ts` | Image-free `VisualEvidence` v1, at most 4096 bytes. **Module-only**: no run record, report, profile or IPC payload carries it. |
| `verify:visual-isolation` | Nothing reachable from `app/main`, the runner, the orchestrator, preload or the renderer may import `src/visual`. `src/visual` may not use the network, the filesystem, page interaction, input devices or navigation. |

### Measured facts that constrain the policy

From the N1 fixtures at `222b04d3`:

| Pair | Score |
|---|---|
| Approve vs Reject (look-alike controls) | 0.9434 |
| Unrelated controls | 0.7307 |
| The **same** control, restyled | 0.6705 |

The absolute similarity score is **not monotone in identity**. A look-alike outscores the true element
after a restyle. Three consequences are binding on N2:

1. **No absolute positive threshold.** A high score never means "this is the element". Corroboration
   therefore never changes a decision, which is what FD-3 records.
2. **No absolute negative threshold.** A low score alone never vetoes, or every theme or CSS change
   would veto the true target.
3. **Contradiction must be relative and calibrated.** It compares the DOM winner against the DOM's own
   competitors, under the same capture conditions, and its margins come from measurement (N2.3), never
   from inference.

Timing: viewport capture has a median of 51.7 ms at DPR 1 and 149.9 ms at DPR 2; fingerprinting a
viewport takes 17.9 ms and 70.2 ms; a compare takes under 0.1 ms. An element crop is fingerprinted much
faster than a viewport, but the screenshot cost is per capture.

## Policy

### Inputs and output (pure, in `src/visual/fusion/`)

```text
FusionInput
  dom:        { layer: "local" | "blueprint" | "provider-agreed",
                winner: { score, ancestry },             // the gated winner (already pinned)
                competitors: { score }[],                 // gated-out DOM candidates, same pruned set, ≤ K
                margin }                                  // winner − runner-up DOM score
  reference:  VisualEvidence | unavailable(reason)        // the step's last-known-good element evidence
  winner:     VisualEvidence | unavailable(reason)        // the DOM winner, captured now
  competitors: (VisualEvidence | unavailable)[]           // the same DOM competitors, captured now
  conditions: { dprMatch, viewportMatch, frameDepthMatch, sizeRatio }

FusionVerdict
  version: 1
  outcome: "unchecked" | "dom-only" | "corroborated" | "contested" | "contradicted"
  effect:  "none" | "veto"                                // NO "act", NO locator, NO index, NO coordinate
  reason:  FusionReason                                   // bounded code, never page content
  evidence: { winnerScore?, bestCompetitorScore?, visualMargin?, identical? }   // rounded, advisory
```

`FusionVerdict` has no field that can name an element. That is invariant I1, and it is enforced by
type and by verifier.

### Decision table

`effect` is `veto` in exactly one row:

| Row | Condition | Outcome | Effect |
|---|---|---|---|
| R1 | Fusion off, step not eligible (FD-6), or no reference | `unchecked` | none |
| R2 | Any input `unavailable`: protected, budget, stale, offscreen, DPR/zoom mismatch, frame mapping, version mismatch, or capture failed | `dom-only` | none |
| R3 | Conditions differ from the reference (DPR, viewport class, frame depth) | `dom-only` (`conditions-changed`) | none |
| R4 | Winner pixel-identical to the reference (`identical`) | `corroborated` | none |
| R5 | No DOM competitors were captured | `dom-only` (`no-competitors`) | none |
| R6 | Winner is the visual leader over every competitor by ≥ `CORROBORATE_MARGIN` | `corroborated` | none |
| R7 | Mixed: the winner is not a clear leader and no competitor clearly leads | `contested` | none |
| R8 | One competitor leads the winner by ≥ `CONTRADICT_MARGIN`, **and** the DOM margin is below `DOM_DECISIVE_MARGIN`, **and** the size ratio is within bounds for both | `contradicted` | **veto** |

R8 means a visual veto needs both of these:

- a visible look-alike that resembles the remembered target clearly better than the element the DOM
  picked;
- a DOM decision that was not decisive in the first place.

A page-wide restyle moves the winner and its competitors together, so the relative rule does not fire
for it. R8 is the only row that changes anything, and all it can do is remove an action.

### Hard invariants

Each invariant is asserted by verifier and mutation-tested.

| ID | Invariant |
|---|---|
| I1 | **No visual identification.** Fusion receives only DOM-chosen candidates and returns no locator, index, selector or coordinate. |
| I2 | **Monotone safety.** Over every generated input, the set of actions taken with fusion is a subset of the set taken without it. N2 has no strengthening path that executes. |
| I3 | **Neutrality.** With fusion off, unavailable or failed, every `LocatorRecoveryStage` and the step outcome are identical to a fusion-free run. Measured on the runtime lab by an A/B run, not inferred. |
| I4 | **No coordinate execution and no input devices.** The existing `src/visual` forbidden-API scan is extended to `src/visual/fusion/` and to the runner adapter. |
| I5 | **Protected and sensitive.** No capture on a protected surface (the N0 guard), on `PROTECTED_LOGIN_STEP_TYPES`, or on a handed-off page. Sensitive guarded-positional steps follow FD-6. |
| I6 | **No model, no network, no files** in fusion. Reference persistence lives in the runner adapter's store only. |
| I7 | **Determinism.** Identical inputs give an identical verdict: integer basis-point arithmetic, as in `compare.ts`. |
| I8 | **Bounded.** The visual stage has a hard wall-clock budget (FD-5) and captures at most K competitors (FD-7). Exhaustion gives R2, never a delay of the step beyond the budget. |
| I9 | **Privacy.** Provenance carries only the verdict, a reason code and rounded scores. Never pixels, digests of page text, selectors or URLs. |

### "Strengthen" in N2

Corroboration (R4 and R6) raises the **reported** confidence of a winner the DOM already proved. It
never:

- turns a refusal into an action;
- lowers a DOM threshold;
- breaks a DOM near-tie;
- substitutes for the twin, container or actionability vetoes.

Any execution-affecting strengthening belongs to N3 and must follow the L12 `agreed` template: DOM
best candidate, refused only on score or margin, all other vetoes passing, re-proven and pinned (FD-3).

## Architecture

```text
LocatorFactory.recover()
  local / blueprint / provider-agreed winner
      → distinct (twins) → insideContainer → requireActionable          (unchanged)
      → visualVeto(stage)                                               (NEW, last in the chain)
             │ fusion off / absent option → return winner unchanged (no import executed)
             ▼
  src/runner/visualFusion/VisualFusionStage.ts      ← the ONLY runner module allowed to import src/visual
      reference = VisualReferenceStore.get(scopeKey)          (runner-owned, atomic writes)
      captures  = captureElement(winner, competitors ≤ K)     (N0, protected guard, budget)
      verdict   = decideFusion(FusionInput)                   (pure, src/visual/fusion)
      shadow  → record verdict only
      enforce → R8 rewrites the stage: refused / "visual-contradiction"
  passing resolve (primary or recovered) → refresh reference (rate-limited, like observeTwins)
```

### Isolation boundary change

`verify:visual-isolation` changes from "nothing imports `src/visual`" to the rule below. This is a
deliberate change to a closed N0/N1 gate, so it needs owner approval (FD-2).

| Rule | Mutation control |
|---|---|
| Exactly one allow-listed runner module (`src/runner/visualFusion/VisualFusionStage.ts`) may import `src/visual`, and only through `@src/visual/fusion` and the capture/evidence entry points | A second importer is caught |
| `app/main`, IPC handlers, preload, the orchestrator and the renderer still reach `src/visual` only through that adapter's injected option | An adapter import of `fingerprint` internals is caught |
| The adapter itself passes the forbidden-API scan, except the filesystem access its reference store needs (atomic writes only) | An adapter `click(` or `mouse.` is caught |

The adapter is injected the way `domIntelligence` is (`LocatorFactoryOptions.visualFusion?`). With
the option absent, `recover()` takes the identical code path it takes today.

### Reference: last-known-good element evidence

Records ship without visual references until N4, so N2's reference is runtime "last known good":

- **Written** after a passing resolve, primary or recovered, of an eligible step. At most once per
  `REFERENCE_REFRESH` interval, and only if the element evidence changed (`contentDigest`).
- **Stored** in a runner-owned sidecar, `visual-references/<scopeKey>.json`, under the runtime data
  root. It is **not** a new field on `LocatorRecoveryRecord`; FD-4 explains why.
- **Bounded:** one `VisualEvidence` (≤ 4096 bytes), version-gated (a version mismatch gives R2), atomic
  tmp+rename with EPERM/EBUSY retry (`app/main/atomicReplace.ts` pattern), and corruption gives R1
  (unchecked), never a throw.
- **Never written** from a protected, handed-off or ineligible step, or from a capture whose conditions
  were refused.

### Reporting

`recovery-trace` gains an optional, bounded `visual` block:

```text
{ mode, outcome, reason, ms, winnerScore?, competitorScore? }
```

The new stage refusal reason is `visual-contradiction`, added to the `LocatorRecoveryStage.reason`
union.

- Older readers ignore the block: it is an optional field, which the integration-specialist must confirm
  on the run-history and report paths.
- Report UI changes are N5. N2 only shows the outcome in the existing recovery-trace rendering if it
  already lists stage reasons generically.

## Owner decisions before implementation

| ID | Decision | Recommendation |
|---|---|---|
| FD-1 | Modes | `off` (default) / `shadow` / `enforce-veto`. Ship shadow first; enforce only after N2.6 acceptance. |
| FD-2 | Relax `verify:visual-isolation` to one allow-listed runner adapter | Approve, with the mutation controls in *Isolation boundary change*. |
| FD-3 | Meaning of "strengthen" in N2 | Reporting only (R4/R6). Execution-affecting strengthening is deferred to N3 under the L12 `agreed` template. |
| FD-4 | Where references live | A runner-owned sidecar store, not a `LocatorRecoveryRecord` field. An older build that rewrites a record would silently drop an unknown field, and every reference write would contend with the twin-history read-modify-write. |
| FD-5 | Visual stage budget | 400 ms per recovery attempt, wall clock, including captures. Exhaustion gives R2. Revisit after N2.3 measurements. |
| FD-6 | Eligible steps | Recovery winners of element steps (click-like, fill, select, check, radio), from all three layers. **Not** the primary-locator path in N2 (that path is observed in shadow mode only). Sensitive guarded-positional steps: shadow only, never enforce. |
| FD-7 | Competitors captured (K) | Up to 3 gated-out DOM candidates with the highest DOM score, in viewport only (capture never scrolls). |
| FD-8 | Enablement surface | A run option plus `AWKIT_VISUAL_FUSION` env for N2. A persisted Settings key waits until enforce is accepted, because `retainKnownKeys` drops unknown settings groups on older builds. |
| FD-9 | Margins `CORROBORATE_MARGIN`, `CONTRADICT_MARGIN`, `DOM_DECISIVE_MARGIN`, size-ratio bounds and `REFERENCE_REFRESH` | Set from N2.3 measurements with an explicit safety gap. If the lab shows no separation, R8 is disabled and N2 ships shadow-only. |

## Work breakdown

Proposed Beads children of `awkit-vra.12`. They are filed only on authorization.

| Item | Scope | Risk | Owner agents | Verification |
|---|---|---|---|---|
| N2.1 | Prerequisite debt: move the `internals` test seam off the exported `captureViewport`/`captureElement` (a module-private seam or a verifier-only entry), and correct the `png.ts` colour-chunk comment (only `tRNS` is refused). | 1 | software, qa | `verify:visual-capture` (the seam mutations must still be reachable), isolation, build |
| N2.2 | Pure policy `src/visual/fusion/decideFusion.ts` and `FusionVerdict` types. No I/O. | 1 | software, qa | New `verify:visual-fusion`: the exhaustive decision table, property-based I2 over generated inputs, I7 determinism, cardinality guards on every collection |
| N2.3 | Calibration lab and measurement. Extend `mock-site/public/visual-intelligence*.html` with the scenarios below, measure score distributions at DPR 1, 1.25 and 2, headed and headless, and record FD-9 values with the raw distributions. Also performs the **real headed Ctrl+zoom** check that is NOT RUN for N0. | 1 | qa, recorder-playwright | `verify:mock-site`, a new `benchmark:visual-fusion` (informational) |
| N2.4 | **Re-scoped by the owner (2026-10-12):** single-capture candidate fan-out. One immutable `VisualCaptureFrame` per visual decision cycle is cropped for every candidate, with `CAPTURE_STALE` invalidation and no recapture. See `N2.4-capture-fanout.md`. | 1 | software, qa, performance | `verify:visual-capture-fanout`, `benchmark:visual-fusion` against FD-5 |
| N2.4b (to be filed) | The former N2.4: `VisualReferenceStore` (runner-owned sidecar, atomic, versioned, bounded, corruption-tolerant) and the passing-resolve refresh hook. It must block N2.5. | 2 | data-persistence, backend | `verify:visual-fusion-runtime` store cases: corrupt, oversized, wrong version, EPERM retry, concurrent instances |
| N2.5 | `VisualFusionStage` adapter, the `LocatorFactoryOptions.visualFusion` injection and **shadow** mode. Update `verify:visual-isolation` per FD-2. | 2 | backend, integration (review), qa | `verify:visual-fusion-runtime` (shadow: stage outcomes byte-identical to off, A/B), `verify:visual-isolation`, `verify:runner`, `verify:locator-guard`, existing recovery suites |
| N2.6 | **enforce-veto** mode: R8 rewrites the stage to `refused` / `visual-contradiction`; add the reason to the union. | 2 | backend, qa, qc-reviewer | Runtime lab: the contradiction scenario vetoes; restyle, twin and protected scenarios do not; false-veto count 0 on the lab |
| N2.7 | Provenance: the `recovery-trace` `visual` block; the run-history and report contract check. | 2 | backend, integration (review) | The relevant report/run-history verifiers, build |
| N2.8 | State and docs: `CURRENT_STATE`, `TASK_LOG`, `ARCHITECTURE` (the new boundary), `DECISIONS` (FD-1 to FD-9), the verifier registry, the dashboard. | 0 | project-state | `verify:verifier-classification`, `verify:roadmap-dashboard` |

Dependency order:

```text
N2.1 → N2.2 → N2.3 → N2.4 (fan-out) → (N2.4b store ∥ N2.7-contract) → N2.5 → N2.6 → N2.8
```

N2.6 may be deferred by FD-9 without blocking N2's shadow-mode closure.

**N2.3 outcome (2026-10-12).** The lab showed no separation between F1 restyles and the F2 swap, so R8 is disabled
(`MEASURED_FUSION_POLICY`), N2 ships shadow-only and N2.6 is deferred. Four element captures exceeded the FD-5 budget
(median 499 ms), so N2.4/N2.5 should crop one viewport screenshot. A real headed Ctrl+zoom is refused by capture. See
`N2.3-fusion-calibration.md`.

**N2.4 outcome (2026-10-12).** The single-capture fan-out takes 1 screenshot per evaluation instead of 4. The
measured median is 171 ms and the p95 237 ms, so FD-5 is a **PASS** against the unchanged 400 ms budget. The largest
remaining phase is per-candidate resolve (32%), which N2.5 should remove by reusing the DOM recovery's resolved
candidates. N2 stays shadow-only. See `N2.4-capture-fanout.md`.

### Feature Test Lab scenarios (N2.3)

Each scenario gets a stable URL, title, expected behaviour and `data-testid` selectors, and is
documented in `mock-site/README.md`.

| Scenario | Expected |
|---|---|
| F1 Restyle: the same target, theme/CSS changed, DOM unchanged | DOM proves it; fusion gives `contested` or `corroborated`; **never veto** |
| F2 Look-alike swap: icon-only buttons with the same role, name and ancestry, where the remembered icon now sits on the runner-up | DOM wins narrowly on the wrong one; fusion gives `contradicted`; enforce vetoes |
| F3 True twins: visually and structurally identical | DOM refuses (twin or margin); fusion is never consulted, nothing rescues it |
| F4 Page-wide restyle with look-alikes present | No veto: winner and competitors move together |
| F5 Protected surface appears before capture | R2; the step is unchanged |
| F6 Offscreen winner and competitor | R2 or R5; the page is never scrolled |
| F7 DPR 1.25 and 2, a frame target, a popup page | Conditions recorded; a mismatch against the reference gives R3 |
| F8 Fusion off | A/B identical to a fusion-free run (I3) |

### Mutation contract

Write each failure count **after** running the mutation, never predicted. Every mutation must fail at
least one check, and must be restored before the change is committed.

1. `decideFusion` always returns `corroborated`.
2. R8 is disabled, so a veto is never produced.
3. `unavailable` maps to veto, which breaks I3.
4. Corroboration lets a refused DOM candidate act, which breaks I2.
5. Absolute-score veto: a score below X vetoes. F1 must catch this.
6. The budget is ignored.
7. The reference is read for the wrong `scopeKey`.
8. A second runner module imports `src/visual`.
9. The competitor collection is capped at one (the `.first()` trap).
10. An empty scenario set (the cardinality guard).

## Acceptance criteria for closing `awkit-vra.12`

1. N2.1 to N2.5, N2.7 and N2.8 are complete. N2.6 is complete, or deferred by a recorded FD-9 outcome.
2. `verify:visual-fusion` and `verify:visual-fusion-runtime` pass. Every mutation in the contract above
   was observed failing and restored. Both are registered in `scripts/lib/verifier-classification.ts`.
3. These existing gates pass against the final state: `verify:visual-capture`,
   `verify:visual-fingerprint`, `verify:visual-isolation` (updated), `verify:runner`,
   `verify:locator-guard`, the L11/L12 recovery suites, `verify:mock-site` and `npm run build`.
4. The I3 A/B neutrality run on the lab is identical with fusion off and with fusion absent.
5. The headed Ctrl+zoom capture check has been executed and recorded, or is still truthfully NOT RUN.
6. An independent QC review (qc-reviewer) covers the isolation-boundary change and the enforce path.
7. Measured on the lab, at DPR 1 and 2, headed and headless:
   - the recovery-attempt overhead with fusion on, as p50 and p95;
   - the reference-refresh overhead on a passing resolve;
   - with fusion off, an overhead within noise of the baseline.

## Risks

| Risk | Mitigation |
|---|---|
| A false veto on a legitimately restyled UI blocks recovery a run used to get | Relative-only rule; F1 and F4 must be non-vetoing; shadow first; FD-9 may disable R8 |
| Recovery latency, since capture is screenshot-bound (~50–150 ms per viewport) | One viewport screenshot per attempt, crops in memory; K ≤ 3; 400 ms hard budget; recovery path only |
| A stale reference after a legitimate redesign | Refresh on every passing resolve; a condition change gives R3; a contradiction needs a DOM near-tie as well |
| An isolation-gate regression lets visual code leak into execution elsewhere | Single allow-listed adapter, the mutation controls above, renderer and preload still at zero |
| The persisted reference contends with run concurrency | Sidecar per `scopeKey`, atomic writes with retry, no shared read-modify-write with twin history |
| Protected-surface exposure | The N0 guard before and after capture, a step-type exclusion, no capture on handed-off pages |
