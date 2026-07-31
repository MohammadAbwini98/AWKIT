# Recorder Ambiguity-Resolution & Recorded-Flow Replayability — Implementation Plan

**Status:** PLANNED — not implemented. No product code changed. This document + the linked `bd`
epic are the definition of done. Stop-for-review gate applies before any product-code edit.

**Defect:** `AWKIT-REC-030` (see `docs/testing/comprehensive-validation/DEFECTS.md`).
**Epic:** see `bd` epic *"Recorder ambiguity-resolution & recorded-flow replayability"*.

---

## 1. Problem statement (verified, not assumed)

A recording of `youtube.com → Shorts → scroll button` saved a flow whose **`Click Shorts`** step
carried `role=link "Shorts"` with `quality.isUnique = false, matchCount = 2`. AWKIT let the user
**finish, save, and keep** that step, then the flow **predictably failed at replay**. The safety
*mechanisms* worked; the *feature* did not deliver a replayable flow or a way to fix it.

### Corrected classification (do NOT summarise the Recorder as an overall pass)

| Area | Verdict |
|---|---|
| Recorder action capture | PASS |
| Locator quality detection | PASS |
| Runner strict-mode protection | PASS |
| **Recorded-flow replayability** | **FAIL** |
| **Ambiguous-locator recovery UX** | **NOT IMPLEMENTED** |
| **Preflight validation of unresolved steps** | **NOT IMPLEMENTED** (runtime-only today) |
| Hover-dependent control handling | PARTIAL / INCONCLUSIVE |
| Shadow-DOM locator support | PARTIAL |

### Root-cause evidence (file:line)

- **No preflight quality gate.** `FLOW_VALIDATION_RULES` has only `missingRequiredLocator`
  ("requires *a* locator", not a *unique* one) — `src/validation/FlowValidator.ts:114,451`. An
  `isUnique:false` step validates clean and saves.
- **Ambiguity enforced runtime-only.** `StepExecutor.guardLocatorQuality`
  (`src/runner/StepExecutor.ts:397-428`) throws only after the browser launches — and it *defers*
  when the step has `alternatives`/`context` (`:422`), so the real replay error comes from
  `LocatorFactory.resolve` exhausting candidates (`src/runner/LocatorFactory.ts:265`). Either way it
  is *post-launch*.
- **Interaction context is discarded at capture.** `recorderInitScript.ts` click handler uses
  `event.target → interactiveTarget → generate` (`src/recorder/recorderInitScript.ts:1098-1113`).
  It never records `composedPath()`, pointer coordinates, or *which candidate actually matched* — so
  nothing is stored that could later disambiguate the two "Shorts" twins.
- **Container scoping too narrow.** `detectContainer` covers only dialog/tableRow/card/listItem
  (`src/recorder/recorderInitScript.ts:573-607`); there is no `<nav>` / `getByRole('navigation')`
  ancestor-scope strategy in `buildCandidates` (`:466-534`).
- **Positional fallback has no approval path.** Positional selectors stay ranked alternatives only;
  there is no user-approved-fallback state (`StepLocator`, `src/profiles/FlowProfile.ts:108-115`).
- **Hover not modeled.** No pre-action hover behavior exists; the probe click only worked via
  leftover pointer state.

---

## 2. Design principles

1. **Never auto-guess** a positional selector as primary (keep current behavior).
2. **Every recorded interactive step has an explicit resolution state** — no silent "saved but
   known-broken".
3. **Backward compatible**: all new fields optional; legacy flows deserialize and run unchanged
   (an absent `resolution` is treated as `resolved` for legacy steps — see §3.3).
4. **Offline-first**: no new network, no new dependencies; all validation is static + live-DOM at
   record time only.
5. **Preflight is static** (no live page), so it can only act on stored state (`resolution`), not on
   whether an alternative *would* resolve — which is why the state model is required.
6. **Evidence preserved**: alternatives, quality, and approval metadata survive every round trip.

---

## 3. Resolution-state model (foundational — Increment 1)

### 3.1 Schema (`src/profiles/FlowProfile.ts`, `StepLocator`)

```ts
export type LocatorResolution =
  | "resolved"              // primary is unique (record-time) OR user confirmed
  | "needs-review"          // recorder could not find a stable unique locator
  | "user-approved-fallback"// user explicitly accepted a positional/lower-resilience locator
  | "invalid";              // user marked unusable / left unresolved on purpose

export interface StepLocator extends LocatorCandidate {
  quality?: LocatorQuality;
  alternatives?: LocatorCandidate[];
  context?: LocatorContext;
  resolution?: LocatorResolution;        // NEW — optional; absent === legacy "resolved"
  resolvedBy?: "recorder" | "user";      // NEW — provenance for audit/UX
  approvedFallbackReason?: string;       // NEW — set only for user-approved-fallback
}
```

### 3.2 Who sets it

- **`buildRecordedFlow`** (`src/recorder/buildRecordedFlow.ts:32-44`) sets the default per step:
  `quality?.isUnique === false → "needs-review"`, else `"resolved"` (`resolvedBy: "recorder"`).
  Pure + unit-tested via `verify:recorder-flow`.
- **User** flips `needs-review → resolved | user-approved-fallback | invalid` via the resolution UX
  (Increment 3/4), stamping `resolvedBy: "user"`.

### 3.3 Migration / backward compatibility

- New fields are optional; no on-disk migration needed for reading.
- **Interpretation rule** (single source, in `FlowValidator`): `resolution === undefined` ⇒ treat as
  `resolved` (legacy/hand-authored steps never block). Only an *explicit* `needs-review`/`invalid`
  blocks. This is what keeps every existing saved flow runnable.
- Optional **SafeFix** (`src/validation/SafeFixApplier.ts`): none — resolution is a human decision,
  so it must never be auto-fixed (consistent with the "absence of `safeFix` = needs a human"
  contract, `FlowValidator.ts:135-148`).

### 3.4 Preflight gate (execution refuses before launch)

- Add validation code `locatorNeedsReview` (severity `error`) to `FlowValidationCode` +
  `FLOW_VALIDATION_RULES` (`src/validation/FlowValidator.ts:102-123`), emitted for any on-active-path
  interactive step whose `locator.resolution ∈ {needs-review, invalid}`.
- Because `runWorkflow` already returns `status:"validationFailed"` on `!validation.valid`
  **before** the license gate and any browser launch (`app/main/ipc/execution.ipc.ts:267-269`), a new
  blocking error is enforced pre-launch automatically. No new gate code in the runner.
- The Flow Designer already surfaces validation issues; the new code renders there with a
  "Resolve locator" affordance (Increment 3).

### 3.5 Round-trip integrity

- `buildRecordedFlow` copies the new fields into `step.locator` (extend `:32-44`).
- Import/export path `app/main/ipc/flow.ipc.ts:57` (validate on import) — plain JSON, fields
  preserved; add explicit round-trip assertions to `verify:recorder-flow`.
- DTO surfaces that project `step.locator` (validation DTO `app/main/ipc/validation.ipc.ts`,
  designer types `app/renderer/components/workflow/flowDesignerTypes.ts`) must carry the new fields.

---

## 4. Increments (independently deliverable, dependency-ordered)

> Each increment ships with: build passing (`npm run build`), its verifier green, docs/memory
> updated, and the roadmap sources reconciled ("Sources agree").

### Increment 1 — Resolution-state schema + round-trips + execution preflight  *(foundational)*
- **Goal:** a known-ambiguous flow **fails preflight before the browser launches**, and resolution
  state survives save/reload/export/import.
- **Files:** `src/profiles/FlowProfile.ts` (schema), `src/recorder/buildRecordedFlow.ts` (defaults),
  `src/validation/FlowValidator.ts` (`locatorNeedsReview` rule + legacy-undefined interpretation),
  `app/main/ipc/validation.ipc.ts` + `app/renderer/components/workflow/flowDesignerTypes.ts` (DTO
  carry-through). No change to `execution.ipc.ts` (existing gate suffices).
- **IPC contract:** unchanged channel signatures; DTO **adds optional** `resolution`, `resolvedBy`,
  `approvedFallbackReason`. Additive only.
- **UX states:** validation panel shows a blocking issue "Step X has an unresolved locator".
- **Verifier:** extend `verify:recorder-flow` (unit) — default-state mapping, legacy-undefined =
  runnable, round-trip preservation; add a `FlowValidator` case that `locatorNeedsReview` blocks.
- **Mock-site:** none (unit-level).
- **Acceptance:** covers spec test points 1 (state recorded), 6 (preflight blocks), 9 (metadata
  round-trips).
- **Risk:** a mis-set default could block legacy flows. **Mitigation:** undefined = resolved;
  regression asserting an all-legacy flow validates clean.
- **Rollback boundary:** revert 4 files; fields are additive so partial rollback cannot corrupt
  stored flows.

### Increment 2 — Capture enrichment + smarter candidate strategies
- **Goal:** auto-resolve cases the current engine gives up on (the two "Shorts" links, repeated row
  buttons) so fewer steps ever reach `needs-review`.
- **Files:** `src/recorder/recorderInitScript.ts` — capture `composedPath()` host chain, pointer
  coords, and the matched-candidate index in the click/change/input handlers; add a
  `getByRole('navigation')` / nearest-landmark ancestor-scope strategy and an `href`-scoped strategy
  to `buildCandidates`/`detectContainer`; `src/recorder/RecorderTypes.ts` (carry new capture fields);
  `src/runner/LocatorFactory.ts` (build landmark-scoped locators on replay).
- **IPC contract:** `RecordedActionLocator` gains optional `interaction` metadata (composedPath host
  tags, coords) — additive.
- **UX states:** none directly (feeds Increment 3).
- **Verifier:** `verify:recorder` / `verify:recorder-locator` (real-browser) — add landmark/href
  scoping cases; assert `href`+ancestor promoted only when **verified unique & stable** at record
  time.
- **Mock-site:** extend `/recorder-lab` `duplicate-controls` with a nav-landmark twin (two links same
  name in different landmarks) mirroring the YouTube case.
- **Acceptance:** spec test point 2 (ancestor scoping attempted first), 3 (stable unique scope →
  replay hits same candidate).
- **Risk:** landmark scoping could over-match. **Mitigation:** promote only when scoped count === 1
  at record time; keep positional as ranked alternative.
- **Rollback boundary:** capture fields are optional; reverting leaves Increment 1 intact.

### Increment 3 — Ambiguity-resolution Recorder UX
- **Goal:** when auto-resolution fails, the Recorder **pauses** and lets the user resolve before the
  step is committed.
- **Files:** `src/recorder/RecorderService.ts` (pause/emit candidate set, like the protected-login
  handoff pattern `:694`), new `recorder:resolveAmbiguity` IPC in `app/main/ipc/recorder.ipc.ts`
  (permission-gated `PAGE_RECORDER`), preload `window.playwrightFlowStudio` addition,
  `app/renderer/pages/Recorder.tsx` (candidate list: highlight, pick, choose ancestor scope, approve
  fallback, cancel, leave-unresolved). Highlighting reuses the capture script to outline candidates.
- **IPC contract:** new channel `recorder:resolveAmbiguity(sessionId, stepDraftId, choice)`; choice ∈
  {selectCandidate, scopeToAncestor, approveFallback, cancel, deferUnresolved}. Sender-permission +
  the single-active-recorder invariant (`verify:recorder-authz`).
- **UX states:** `Resolved` / `Needs locator review` / `User-approved fallback` / `Invalid` badges on
  the step chip; a resolution drawer with the a11y contract (focus containment — see memory
  `a11y-contract-per-concept`).
- **Verifier:** `verify:recorder-gui` (real-Electron) — pause fires, each choice yields the right
  state, chosen candidate is validated before continue.
- **Mock-site:** drive `/recorder-lab` `duplicate-controls`.
- **Acceptance:** spec points 2, 3, 4, 5 (user can pick / scope / approve / cancel / defer; choice
  validated).
- **Risk:** UX complexity / focus traps. **Mitigation:** reuse ConfirmDialog focus contract; a11y
  verifier.
- **Rollback boundary:** feature-flaggable; without it, Increment 1 still blocks unresolved flows at
  preflight (safe degrade).

### Increment 4 — Explicit positional-fallback approval
- **Goal:** allow a positional selector **only** through observable, opt-in approval.
- **Files:** resolution UX (Increment 3) sets `user-approved-fallback` + `approvedFallbackReason`;
  `StepExecutor.guardLocatorQuality` (`:404-414`) already blocks positional for
  dangerous/external-commit steps — extend so an *approved* fallback is permitted for
  non-dangerous steps and still refused (or re-confirmed) for sensitive ones; replay diagnostics
  (`src/runner/LocatorFactory.ts` emit) state "positional, user-approved, lower resilience".
- **IPC contract:** none new (rides Increment 3 choice).
- **UX states:** "User-approved fallback (lower resilience)" badge + evidence retained.
- **Verifier:** `verify:recorder-locator` — approved positional runs; approved positional on a
  dangerous step still blocked.
- **Mock-site:** `/recorder-lab` `duplicate-controls` (approve the second card).
- **Acceptance:** spec point 5.
- **Risk:** weakening the sensitive-step guard. **Mitigation:** keep dangerous/external-commit
  refusal absolute; only relax non-dangerous.
- **Rollback boundary:** revert the guard branch; approvals then simply behave as `resolved` primary.

### Increment 5 — Hover-dependency capture
- **Goal:** controls actionable only after hover replay reliably.
- **Files:** `src/recorder/recorderInitScript.ts` (detect hover-gated visibility around the target),
  a `hover` pre-action on the click node or an explicit `hover` step in `buildRecordedFlow` +
  `FlowProfile` step type/config; `src/runner/StepExecutor.ts` (perform the pre-action hover
  transparently, reported in run logs).
- **IPC contract:** none new.
- **UX states:** the flow model shows the hover prerequisite explicitly (no hidden pointer state).
- **Verifier:** new mock-site scenario + `verify:runner`/`verify:recorder`.
- **Mock-site:** new `/recorder-lab` sub-scenario: a button visible only on hover of a container.
- **Acceptance:** spec point 8.
- **Risk:** false hover detection. **Mitigation:** only when the target is non-actionable pre-hover
  and actionable post-hover at record time.
- **Rollback boundary:** independent; revert leaves other increments intact.

### Increment 6 — Shadow-DOM capture via composedPath
- **Goal:** honest, Playwright-compatible locators across open shadow roots; explicit unsupported
  state for closed roots.
- **Files:** `src/recorder/recorderInitScript.ts` (use `event.composedPath()` to walk host
  boundaries instead of only the retargeted `event.target`; preserve host boundaries in metadata),
  `src/runner/LocatorFactory.ts` (reconstruct pierced locators; Playwright CSS already pierces open
  roots). Closed roots ⇒ `resolution: "needs-review"` with reason "closed shadow root".
- **Verifier:** `verify:recorder-locator` shadow-DOM cases (open → unique; closed → manual state).
- **Mock-site:** new `/recorder-lab` open- and closed-shadow-root controls.
- **Acceptance:** shadow-DOM PARTIAL → resolved for open roots; honest state for closed.
- **Risk:** composedPath cross-origin frames. **Mitigation:** guard as existing frame code does
  (`:613-629`).
- **Rollback boundary:** independent of 3/4/5.

### Increment 7 — Acceptance regression `verify:recorder-ambiguity`
- **Goal:** the spec's 9-point regression, wired into the verifier registry.
- **Files:** new `scripts/verify-recorder-ambiguity.mts`; register in
  `scripts/lib/verifier-classification.ts` (`VERIFIER_CLASSIFICATION`, class `real-browser`) +
  `package.json` script; extend `/recorder-lab` `duplicate-controls` if needed.
- **Acceptance:** all 9 spec points (see §5), each an independent check.
- **Risk:** flakiness on real DOM. **Mitigation:** use the deterministic mock-site, not YouTube.
- **Rollback boundary:** test-only; never blocks product rollback.

### Dependency order (blocks edges)

```
Inc1 ──blocks──▶ Inc2 ──blocks──▶ Inc3 ──blocks──▶ Inc4
  │                  └──blocks──▶ Inc6
  ├──blocks──▶ Inc5
  └──blocks──▶ Inc7  (Inc7 grows as 2–6 land)
```

Inc1 is the only hard prerequisite for everything; Inc5 and Inc7-core depend on Inc1 alone.

---

## 5. Acceptance test mapping (spec's 9 points → increments)

| # | Requirement | Increment |
|---|---|---|
| 1 | Clicking the 2nd of two identical links records the actual selected candidate | Inc2 (capture chosen candidate) + Inc1 (state) |
| 2 | Builder attempts stable ancestor scoping first | Inc2 |
| 3 | Stable unique scope → replay clicks the same candidate | Inc2 |
| 4 | No stable unique locator → action enters review-required state | Inc1 + Inc3 |
| 5 | User can explicitly approve a positional fallback | Inc4 |
| 6 | A flow with unresolved ambiguity fails preflight before execution | Inc1 |
| 7 | User-resolved flow survives save/reload/edit/re-save/export/import/replay | Inc1 + Inc3 |
| 8 | Hover-required controls capture their prerequisite behavior | Inc5 |
| 9 | Alternatives, confidence, warning, uniqueness, approval metadata survive all round trips | Inc1 |

---

## 6. Global risks & rollback boundaries

- **Risk: blocking legacy flows.** Absent `resolution` = `resolved`; an all-legacy regression proves
  no existing flow becomes unrunnable. This is the single highest-impact risk and is gated in Inc1.
- **Risk: dashboard drift.** All progress recorded in `bd` + `DEFECTS.md` (sources), never in
  `tools/roadmap/`. Run `npm run verify:roadmap-dashboard` after each increment.
- **Risk: sensitive-step safety regression (Inc4).** Dangerous/external-commit positional refusal
  stays absolute.
- **Rollback:** every increment is additive and independently revertible; Inc1's fields are optional,
  so reverting any later increment cannot corrupt flows saved by an earlier one.

## 7. Explicit non-claim

Ambiguity **detection** and strict-mode **protection** working does **not** make the Recorder
feature complete. Until Increments 1–7 land, the Recorder's overall verdict is **not "pass"** — it
can still save a flow it knows cannot replay, without a supported way to resolve it.
