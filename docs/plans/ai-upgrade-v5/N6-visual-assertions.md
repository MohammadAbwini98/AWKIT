# N6 — Visual Assertions

Status: **PLANNED 2026-10-21, planning only.** Contract `awkit-vra-n6-plan-1021`. Owner decisions VA-0 to VA-12
below are **proposed and not ratified**. Nothing in this document authorizes implementation, a schema change, a new
`src/visual` edge, a dependency, a UI component or any runtime behavior until the owner approves the decisions.

Baseline: `main` at `d04275c8` (2026-10-21). Acceptance environment: the owner-approved Windows 11 ARM64 Parallels
machine (DECISIONS 2026-10-19); that is a waiver of a separate clean-VM or x64 run, not a claim that one was executed.

## Objective

Let a flow author add a **visual assertion** step: "this element should still look the way I approved it". On each run
the step captures the element through the protected-guarded N0 capture, compares it with an author-approved baseline
recorded under **proven, equal conditions**, and produces a step result.

N6 is the first Phase N feature whose output is meant to change a run, so its central rule is that a visual assertion
may only fail a step when the difference is **proven**. Everything it cannot prove is `inconclusive`, never a silent
pass and never a guessed failure.

## User-visible purpose

- A Flow Designer node, *Visual assertion*, on an element step target, with a baseline status
  (`none`, `approved`, `approved for other conditions`) and an *Approve current appearance* action.
- A run result per assertion: `passed`, `failed` or `inconclusive`, with a fixed, image-free reason code, in the step
  row and the report drawer.
- Regression detection for stable UI: a logo, a status badge, a rendered chart frame, a button that must not restyle.

## Distinct from N5, N7, N9 and N10

| Question | N5 Visual Failure Diagnosis | N6 Visual Assertions | N7 OCR | N9 Screenshot State | N10 Vision model |
|---|---|---|---|---|---|
| When does it run? | After a step finally fails | As an authored step, every run | On demand | Its own | Only with an approved model |
| Can it change a run? | Never | **Yes, when enforced and proven** | Its own decision | Its own decision | Never without approval |
| Output | Observation codes | A step result | Text | A state label | Model claims |
| Reference | Runtime/recorded N2/N4 store, read-only | **Its own author-approved baseline** | — | — | — |
| Needs a model? | No | No | No | No | Yes |

N6 never reads text from pixels (N7), never classifies a screen state (N9), never uses a model (N10), and never
writes to, reads from or reinterprets the N2/N4 reference store.

## Today's baseline (as built, `d04275c8`)

| Capability | Where | What N6 can rely on |
|---|---|---|
| Guarded element capture | `captureElement` (`src/visual/internal/captureCore.ts`) | Strict protected window, in-memory pixels, fixed refusal codes (`awkit-3gtj`, `awkit-2het`) |
| Fingerprint | `fingerprintVisualImage` (`src/visual/fingerprint.ts`, `awkit-vfp-1`) | Size, luma and edge grids, dHash, `contentDigest` |
| Comparison | `compareVisualFingerprints` (`src/visual/compare.ts`) | `identical` (byte equality), distances, an **advisory** score with **no threshold and no decision** |
| Evidence | `buildVisualEvidence` (v1, ≤ 4096 bytes, image-free) | Viewport, frame, bounds, fingerprint |
| Reference store | `VisualReferenceStore` (`visual-references/`) | Atomic writes, corruption reads, rate limit; **N6 does not use it** (see VA-5) |
| Assertions | `assertText` / `assertVisible` steps, `executeAssertion` (`StepExecutor.ts:2863`) | Text, value, count, url, attribute, storage |
| Unknown step type | `executeStep` default (`StepExecutor.ts:2297`) | Throws `Unsupported step type`: an older build fails closed |
| Unknown `assertionType` | `executeAssertion` (`StepExecutor.ts:2871`) | **Falls through to a text comparison**: an older build would run the wrong check |

**Measured facts that constrain N6.**

- **Headed versus headless is never byte-identical.** N4.5: a headed reference never matched a headless crop.
- **Headless bytes depend on position.** N3.2: headless Chromium rendered identical icons with position-dependent
  bytes, so byte identity is not stable even within one mode when layout shifts.
- **Cross-launch identity is not guaranteed in one mode.** N3.2 cross-launch recall was 66/72 on the unchanged
  baseline and 65/72 under drift.
- **No similarity threshold is calibrated.** N2.3 found no separation between look-alikes and real contradictions, so
  the N1 score has no threshold and N2 ships shadow-only.
- **Stored conditions are partly unprovable.** The N2/N4 records cannot prove render mode, browser build, colour scheme
  or zoom separately from DPR (N5 plan, *Reference-condition provenance*). The envelope that would (VD-11) was deferred.

**Consequence.** A naive "fail when the fingerprint differs" assertion would fail on every headed/headless switch, on a
browser update, after a font change and on roughly one fresh launch in twelve. N6 must therefore (1) record its own
baselines with a provenance envelope, (2) compare only under proven-equal conditions, (3) ship observe-only first and
(4) unlock enforcement only through a calibration gate, the pattern N2, N3 and N5 used.

## Scope

- One new step type, an element-scoped visual assertion, observe and enforce modes.
- A pure verdict policy over two fingerprints and two condition envelopes.
- A new, separate baseline store with an additive provenance envelope.
- Baseline approval by a person, never by a run.
- A runner adapter (a fourth, allow-listed `src/visual` edge), a codes-only report block and a text-only drawer
  section, a Designer node, a calibration lab and its verifiers.

## Non-goals

- Viewport or full-page assertions (VA-3): dynamic regions need masking, which the fingerprint cannot express.
- Ignore regions, masks, per-pixel diffs or diff images.
- Tolerance-based passes in v1 (VA-7): only byte identity passes until calibration proves a threshold.
- Auto-updating baselines from runs ("self-healing"), or approving a baseline from a failed run without a person.
- Persisting screenshots or image bytes for baselines (VA-6).
- Any change to locator resolution, recovery, retries, fusion, agreement, diagnosis or the N2/N4 store.
- OCR, state labels or model calls.

## Owners

| Area | Owner | Files (expected) |
|---|---|---|
| Pure verdict policy and vocabulary | software, with qa | new `src/visual/assertion/decideVisualAssertion.ts`, exported through `src/visual/index.ts` |
| Baseline store and provenance envelope | data-persistence | new `src/runner/visualAssertion/VisualBaselineStore.ts` (`visual-baselines/`) |
| Step type, validator, runner adapter, budget | backend | `src/profiles/FlowProfile.ts`, `src/validation/FlowValidator.ts`, `src/runner/StepExecutor.ts` (dispatch only), new `src/runner/visualAssertion/VisualAssertionStep.ts` |
| Baseline approval channel, permission, audit | backend, security (review) | an IPC handler beside `recorder.ipc.ts`/`execution.ipc.ts`, preload entry |
| Designer node and drawer section | frontend, with ui-designer authority | Flow Designer node config, `FailureEvidenceSection.tsx` sibling, `global.css` tokens |
| Report record and sanitizer | data-persistence | `src/reports/ExecutionReport.ts`, a sanitizer beside `visualDiagnosisRecord.ts` |
| Protected boundary, privacy | security (review) | — |
| Mock-site, verifiers, mutations, calibration | qa, recorder-playwright | `mock-site/`, `scripts/verify-visual-assertion*.mts`, `scripts/benchmark-visual-assertion.mts` |
| Independent review | qc, security | — |
| Beads, state docs, dashboard | project-state | `.beads/`, `docs/ai/`, `scripts/verify-roadmap-dashboard.mjs` |

## Architecture and data flow

```
Designer: author picks an element step target ──► VisualAssertion node (config only, no image)
                                                   │
Approve (person, permission-gated, audited) ──────►│ capture via N0 captureElement (strict window)
                                                   │ fingerprint (N1) + provenance envelope ──► visual-baselines/
Run: StepExecutor dispatch ──► VisualAssertionStep (fourth src/visual edge, lazy)
   1. eligibility (step type, protected/handoff/sensitive, flag)          → refusal codes
   2. resolve the step's locator to exactly one visible element (DOM)     → target codes
   3. captureElement (guarded, budgeted)                                  → capture refusal codes
   4. current envelope (render mode, browser major, DPR, viewport, colour scheme, forced colours, fingerprint version)
   5. baseline read (read-only) for flow + step + binding digest + conditions key
   6. decideVisualAssertion(current, baseline)  ── pure ──►  passed | failed | inconclusive + code
   7. mode: observe → step outcome unchanged, verdict recorded; enforce → failed fails the step
   8. codes-only record ──► InstanceReport.visualAssertions (sanitized) ──► drawer section
```

No pixels leave step 3. The record carries codes, versions and the conditions comparison, never an image, crop,
digest, selector, URL or page text.

## Verdict vocabulary (proposed; fixed in N6.2, pruned by N6.6)

| Verdict | Code | When |
|---|---|---|
| `passed` | `identical-to-baseline` | Conditions `equal-proven` and `contentDigest` equal |
| `failed` | `differs-from-baseline` | Conditions `equal-proven`, digests differ, and the difference is outside the calibrated envelope (v1: any difference, VA-7) |
| `failed` | `size-differs-from-baseline` | Conditions `equal-proven` and the element's CSS size differs |
| `inconclusive` | `no-baseline` | No approved baseline for this step and binding |
| `inconclusive` | `baseline-other-conditions` | A baseline exists, but not for the current conditions key |
| `inconclusive` | `conditions-unproven` | A required envelope field is missing on either side |
| `inconclusive` | `binding-changed` | The step's locator binding digest no longer matches the baseline's |
| `inconclusive` | `baseline-unreadable` | Corrupt, version-mismatched or oversized record |
| `inconclusive` | `target-not-found` / `target-not-unique` / `target-hidden` / `target-offscreen` | DOM resolution facts |
| `inconclusive` | `protected-surface` / `handoff-active` / `sensitive-step` | Refused before any capture |
| `inconclusive` | `capture-stale` / `capture-unavailable` / `budget-exhausted` | N0 refusals and the deadline |

`failed` is only reachable under `equal-proven`. No code claims uniqueness, identity of anything other than the
step's own target, or the cause of a difference.

## Conditions envelope (VA-4)

Recorded with every baseline and computed for every run:

| Field | Source | Proven by |
|---|---|---|
| `renderMode` | the runner's launch options (`headless` true/false) | the runner itself, at both ends |
| `browserMajor` | `browser.version()` major | the runner |
| `devicePixelRatio`, `cssWidth`, `cssHeight` | N0 viewport metrics | N0 |
| `colorScheme`, `forcedColors`, `reducedMotion` | `matchMedia` read in the target frame | a read-only evaluate |
| `frameDepth`, `isMainFrame` | N0 frame info | N0 |
| `fingerprintVersion`, `evidenceVersion` | constants | N1 |

The **conditions key** is a digest over every field except the element geometry. A baseline answers only for its own
key. Several baselines per step (one per key) are allowed, each approved separately. Older N2/N4 records are never
read, so the N5 `unproven` status does not apply here; N6 records are envelope-complete by construction.

## Persistence (VA-5, VA-6)

- A new folder `visual-baselines/` under the runtime root, beside `visual-references/`, one sidecar per
  `sha256(flowId, stepId, bindingDigest, conditionsKey)`, written atomically with the same EPERM/EBUSY retry the
  reference store uses.
- Record: `version`, the key parts, the envelope, `VisualEvidence` v1 (image-free, ≤ 4096 bytes), `approvedAt`,
  `approvedBy` (local user id), and the approving app version.
- **Never** inside the FlowProfile or its export; the flow stays byte-identical. Moving a flow to another machine
  yields `no-baseline` until a person approves there (VA-11 covers export).
- No image bytes, crops or screenshots are stored (VA-6). The person sees the existing, guarded B2 failure screenshot
  for context on a `failed` step.
- Runs never write baselines. Approval is the only writer.

## Step shape (VA-2)

A new step type `assertVisual`, not a new `assertionType` on `assertText`: an older build that meets the new type
throws `Unsupported step type` and fails closed, while an unknown `assertionType` would silently run a text check.
Config: the element locator (the existing `StepLocator`), `mode` (`observe` | `enforce`, default `observe`) and
`onInconclusive` (`pass` | `fail`, default `pass` in observe and enforce alike, VA-8). The validator requires an
element locator, refuses a protected-login or value-bearing target, and rejects the step inside a fragment the audit
marks sensitive.

## Security, privacy and the protected-auth boundary

- The capture is N0's `captureElement` only, inside the strict protected window; any protected refusal is
  `inconclusive/protected-surface` and is never retried into a pass.
- Protected-login step types, handed-off pages and value-bearing or masked targets are refused before any capture
  (the same eligibility as N4/N5).
- Baselines are image-free. Approval is permission-gated (VA-10) and audited; a renderer can name a step, never send
  evidence, a digest or a key.
- The report block is codes-only and passes a sanitizer with a key allowlist, as N5.4 did.

## Headed and headless

Baselines are keyed per render mode. A headless run against a headed-only baseline is
`inconclusive/baseline-other-conditions`. The calibration (N6.6) runs both modes and a cross-mode replay.

## Frames, popups and shadow roots

The target may be in a frame (N0 maps depth and origin) or an open shadow root (the locator resolves it). A target in
a popup is asserted on the popup page the step names. Closed shadow roots stay out of scope, as in N0.

## Offline and AI independence

No network, model, service or new dependency. The verdict is a pure function of two fingerprints and two envelopes.
With the flag off, `assertVisual` steps are `inconclusive/disabled`. Flows without the step are untouched.

## Performance budgets (VA-9)

One element capture per assertion per attempt, bounded by a 2000 ms deadline inside the step timeout. The capture
already pays the strict-window cost (`benchmark:visual-diagnosis` p95 759 ms for a framed diagnosis after
`6ff6327`). A deadline cut is `inconclusive/budget-exhausted`, never a pass. No visual work happens for flows without
the step.

## Accessibility and UI

Text-only result, no image, no colour-only status, a live region for the approval result, focus returns to the
trigger, reduced motion respected, Hologram tokens only. Proven by a GUI verifier in real Electron, run from the
owner terminal per KNOWN_ISSUES 2026-10-19.

## Owner decisions before implementation (proposed, not ratified)

### VA-0 — Authority boundary

- **Decision:** may a visual result fail a step?
- **Recommended:** yes, but only `failed` under `equal-proven` conditions in `enforce` mode after the N6.6 calibration
  gate is MET; observe mode never changes a step outcome. This amends the 2026-10-13 directive (VR-0), under which
  `agreed` is the only execution-affecting visual result, by adding exactly one more: an authored assertion's
  `failed`. Visual evidence still never drives a click, fill, selector, retry or recovery.
- **Alternatives:** (a) observe-only forever; (b) let the advisory score fail steps.
- **Why needed:** without it N6 is report-only, and it is the widest authority Phase N has asked for.

### VA-1 — Isolation amendment

- **Decision:** a fourth allow-listed edge into `src/visual`, the runner's `VisualAssertionStep`, loaded lazily,
  through the public index only.
- **Recommended:** approve, with `verify:visual-isolation` pinning exactly four edges and the adapter's own
  no-act/no-write scan (writes only through the baseline store's approval path, never at run time).

### VA-2 — Step shape

- **Recommended:** a new `assertVisual` step type (fails closed on older builds), element-scoped, with `mode` and
  `onInconclusive`. **Alternative:** `assertionType: "visual"` on `assertText`, rejected because older builds would run
  a text comparison.

### VA-3 — Target scope

- **Recommended:** a single element resolved by the step's own locator to exactly one visible element. No viewport,
  full page or region assertions in N6.

### VA-4 — Conditions envelope and comparison rule

- **Recommended:** the envelope above, a conditions key per baseline, three statuses (`different`, `unproven`,
  `equal-proven`); only `equal-proven` can yield `passed` or `failed`.

### VA-5 — Baseline store

- **Recommended:** a new `visual-baselines/` store with the envelope. The N2/N4 store is not read, written, migrated or
  extended. **Alternative:** VD-11's envelope inside the N2/N4 store, rejected because it changes two existing writers.
- **Note:** this resolves N5's VD-11 for N6's own data only; VD-11 for the N2/N4 store stays deferred.

### VA-6 — Image retention

- **Recommended:** image-free baselines and results; no diff images. **Alternative:** store baseline PNGs for visual
  review, which is a privacy expansion needing its own retention, redaction and export policy.

### VA-7 — Pass rule and tolerance

- **Recommended:** v1 passes only on byte identity. A tolerance envelope (dHash, grid and edge distances) may be
  proposed after N6.6 with its own decision; until then near-identical results under `equal-proven` are `failed` in
  enforce and recorded in observe. **Alternative:** ship an uncalibrated threshold, rejected by N2.3's evidence.

### VA-8 — Inconclusive handling

- **Recommended:** `onInconclusive: pass` by default (the run is not blocked by missing baselines or condition
  changes), with the verdict visible; authors may choose `fail` per step.

### VA-9 — Enablement and budget

- **Recommended:** `AWKIT_VISUAL_ASSERTIONS` = `off` (default) | `observe` | `enforce`; `enforce` is accepted only
  after N6.6 is MET and is otherwise downgraded to `observe` with a logged code. Deadline 2000 ms per assertion.

### VA-10 — Baseline approval

- **Recommended:** a person approves from the Designer (or a run result) with a dedicated permission
  (`FLOW_EDIT` plus re-authentication is the alternative), audited with flow, step, conditions key and user. Approval
  captures fresh at approval time; it never promotes a stored run result.

### VA-11 — Export and import

- **Recommended:** baselines are not exported with flows in N6. An imported flow reports `no-baseline` until approved.
  A later decision may add a signed baseline bundle.

### VA-12 — Calibration gate

- **Recommended:** N6.6 runs headed and headless at DPR 1, 1.25 and 2 on fresh launches over mock-site fixtures
  (unchanged, restyle, swap, text change, size change, twins, protected, sensitive), with a criterion fixed before
  measuring:
  - **zero** `failed` on unchanged fixtures under `equal-proven`, across at least 20 fresh launches per cell;
  - **every** restyle, swap, text and size change `failed` or `size-differs` under `equal-proven`;
  - **zero** captures on protected, handoff and sensitive fixtures;
  - cross-mode always `baseline-other-conditions`;
  - p95 within the VA-9 deadline.

  If the unchanged criterion fails (N3.2's 66/72 suggests it may), `enforce` stays unavailable and N6 closes
  **observe-only**, tracked like N2 and N3.

## Work breakdown

| Item | Title | Depends on |
|---|---|---|
| N6.1 | Owner decisions VA-0 to VA-12 | — |
| N6.2 | Pure `decideVisualAssertion` policy, vocabulary and conditions rule; `verify:visual-assertion` with mutants | N6.1 |
| N6.3 | `VisualBaselineStore` with the envelope; `verify:visual-baseline-store` (atomic, corruption, versions, concurrency) | N6.1 |
| N6.4 | `assertVisual` step type, validator, runner adapter (fourth edge), observe mode, mock-site fixtures; `verify:visual-assertion-runtime`, `verify:visual-isolation` at four edges | N6.2, N6.3 |
| N6.5 | Baseline approval channel, permission, audit and Designer node; `verify:visual-assertion-gui` | N6.4 |
| N6.6 | Calibration lab and the enforce gate; `benchmark:visual-assertion` | N6.4 |
| N6.7 | Codes-only report block, sanitizer and drawer section; `verify:visual-assertion-report` | N6.4 |
| N6.8 | Independent QC and security review, closure | N6.5, N6.6, N6.7 |

## Verification and independent QC matrix

| Claim | Gate |
|---|---|
| Verdicts follow the table and `failed` needs `equal-proven` | `verify:visual-assertion` (pure), mutants per rule |
| Baselines are atomic, versioned, corruption-safe and image-free | `verify:visual-baseline-store` |
| Observe never changes a step outcome; enforce fails only on `failed` | `verify:visual-assertion-runtime` A/B against the flag off |
| No capture on protected, handoff or sensitive targets | runtime cases plus `verify:b2-protected-capture` unchanged |
| Exactly four `src/visual` edges | `verify:visual-isolation` |
| Older builds fail closed on the step | runtime case against the unknown-type path |
| Report block is codes-only | `verify:visual-assertion-report` with sanitizer mutants |
| UI is accessible and text-only | `verify:visual-assertion-gui` |
| Enforcement is earned | `benchmark:visual-assertion` against VA-12 |
| Regression | `verify:runner`, `verify:visual-capture`, `verify:visual-diagnosis-runtime`, `verify:recorder-visual-capture`, `verify:mock-site`, build |

## Completion criteria

1. VA-0 to VA-12 approved (or amended) and recorded in DECISIONS.
2. N6.2 to N6.7 closed with their gates green and mutants red.
3. N6.6 measured against VA-12; enforce available only if MET, otherwise observe-only recorded.
4. Flows without the step, and every run with the flag off, are byte-identical in outcome and report.
5. Independent QC and security review APPROVED.
6. State docs updated and the dashboard reads "Sources agree".

## Rollback and disable

`AWKIT_VISUAL_ASSERTIONS=off` makes every `assertVisual` step `inconclusive/disabled` with `onInconclusive` applied.
Deleting `visual-baselines/` loses only baselines; flows are unaffected.

## Risks

| Risk | Mitigation |
|---|---|
| False failures from rendering noise | Byte-identity pass only under `equal-proven`; observe first; VA-12 gate |
| Authors read `inconclusive` as passing | Visible verdict and code; `onInconclusive: fail` option |
| Baseline sprawl across conditions | One baseline per key, shown in the Designer; approval is explicit |
| Privacy | Image-free store and report; guarded capture; approval permission |
| Performance on long flows | One capture per assertion, deadline, no work without the step |
| Scope creep into masks and tolerance | Non-goals; separate decisions after N6.6 |

## Exact next task (pending owner approval)

N6.1: the owner reviews VA-0 to VA-12. On approval, N6.2 (the pure policy) and N6.3 (the baseline store) can start in
parallel; nothing else may start before them. Recommended before approval: an independent review of this plan, as N5
had.
