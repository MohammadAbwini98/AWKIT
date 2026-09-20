# L3 — Intelligent Locators (semantic upgrade, replay proof, auto-promotion, repair)

Shared rules, architecture and decisions: `ROADMAP.md`. Depends on L1 go/no-go PASS and L2.
**Source of truth for locator AI.**

**Status (2026-09-20): OPEN, waiting on the L1 go/no-go.** The model-independent core is built ahead of it:
§2 plan DSL + trusted compiler and §3 intent guard in `src/ai/locatorPlan.ts`, proven by `verify:locator-plan`
(53/53, pure, no model or browser). **§4, §5, §6 and §7 are built** (`src/runner/locatorProof.ts`,
`src/ai/pendingUpgrade.ts`, the `StepExecutor` replay hook, `src/ai/locatorPromotion.ts`,
`src/ai/locatorUpgradeAttempts.ts`), proven in real Chromium by `verify:locator-upgrade-proof` (75/75),
`verify:ai-locator-upgrade` (78/78) and `verify:ai-locator-attempts` (87/87) on
`/recorder-lab/locator-upgrade` and in real Electron by `verify:ai-locator-upgrade-gui` (24/24), with plan text
from a deterministic fake provider parsed by the real output contract. §7 completes the model-independent
chain — a job now runs eligibility → provider → contract → compiler → intent → proof → pending — but **nothing
in production queues one**: the caller that hands it a live page and a capture context is the L1-gated piece,
so in practice a pending candidate still only exists in a verifier. Not built: §8 repair, §9 sweep, §10 UX
(§6 ships the minimum panel that makes an approved promotion reachable and an applied one revertible — the
full badge vocabulary stays §10), and `verify:ai-locator-repair` / `verify:ai-locator-quality-live`.

§7 as built:
- **One bounded job.** `runLocatorUpgradeAttempts` is the whole loop. Every iteration either returns or
  consumes exactly one attempt, so the budget is finite by construction — there is no path that asks the
  provider again without spending it. It never throws: every outcome is a `LocatorAttemptResult`.
- **What consumes an attempt** is only a real rejection: a malformed or schema-refused answer, a compiler or
  intent refusal, a browser rejection, or a repeat of a candidate already refused. What produced no candidate
  does not: a disabled provider, a missing runtime, a timeout, a host crash, a cancellation. Those are
  terminal — retrying them is not synthesis. `unprovable-now` is not a rejection either (§5): it is stored.
- **Two refusals are terminal even though they spend the attempt.** A `T3_*` proof refusal (a protected-login
  surface) ends the job rather than earning another proposal, and so does a capture context that expired
  mid-flight. "Ask again with feedback" is exactly the retry §1 forbids.
- **Feedback is structured and deterministic:** stage, code and the compiler's field PATH, plus one
  product-authored sentence per code. No page text, model text, candidate value or typed value, ever.
- **A repeat cannot buy a second opinion.** The orchestrator compiles each answer itself (through the same
  `evaluateLocatorPlan` the proof re-runs) to get the candidate digest: a digest already seen spends the
  attempt and never reaches the browser again.
- **Bound data is dropped before the prompt, not caught after it.** `contextFields` omits every L2 capture
  field the marker pass flagged, and sends the flagged field PATHS as ids so the model knows which slots are
  data-bound without being shown the data. The baseline's own fragile value is never sent — only its
  strategy and quality class.
- **Eligibility (§1)** is `isLocatorUpgradeEligible`: T3 first and unconditionally, then a locator whose L2
  class is `guarded-positional` or `review-required`. An explicit user request (Element Spy) is its own
  trigger and skips only the weakness gate — it can never lift T3.
- **Mutation-tested.** Removing the budget cap, the duplicate guard, the post-proof cancellation re-check or
  the T3-terminal return each failed the verifier (78/85, 83/85, 85/87, 85/87). A fifth mutation — deleting
  the cancellation re-check that sat immediately after the provider call — was NOT caught, and the check was
  deleted rather than papered over: any abort `AiService` owns returns `cancelled` itself, and any later one
  is caught after the proof, which is always awaited before a write.

§6 as built:
- **One authorized path.** `promoteLocatorUpgrade` is the only way a `pendingUpgrade` becomes the saved
  locator. It runs inside `JsonProfileStore.updateWith` and re-derives every precondition from the profile it
  is handed: the exact candidate named by `createdAt` (else `SUPERSEDED`), the step binding (`STALE`), a
  `resolution` of `resolved`/absent (`BASELINE_NOT_PROMOTABLE`), T3 first and unconditionally, then eligibility
  and the tier. A caller supplies no evidence and no `eligible` flag.
- **Evidence is selected, not supplied.** `selectReplayEvidence` picks the tally for this flow+step whose
  candidate and binding digests match the step as it is now. A tally is per SCENARIO, so counts are never
  summed across scenarios, and one refusal in any matching tally disqualifies the candidate outright.
- **Seeded thresholds do not authorize an unattended replacement.** `LOCATOR_UPGRADE_REPLAY_POLICY.committed`
  is `false`, so mode `auto` is refused with `THRESHOLDS_PROVISIONAL`; a user who reviews the same evidence and
  applies it is a separate authorization, recorded as **T1** so a later revert cannot self-demote the feature
  for a decision a person made. L7 flips `committed`.
- **What changes:** `strategy`/`value`/`name`/`exact`, the scope `context` (exactly the one the proof used),
  `quality` (rewritten to what the proof established, which also stops the new semantic primary being
  classified positional), and the positional `guard` is dropped. Everything else on the step and its locator is
  carried through, unknown keys included. The whole pre-change locator goes to `locatorProvenance.previous`.
- **Audit ordering:** the locator write commits first; the `AiActionRecord` is appended after. A crash between
  them leaves a promotion with no audit entry — visible, and still revertible from the step — rather than an
  audit entry for a change that never happened.
- **Editor coordination:** the Flow Designer reports its open flow and dirty state (`ai:setEditorState`), and
  promotion is refused with `EDITOR_DIRTY` while that flow is dirty, because the editor's next save writes its
  whole document and would undo the promotion. This is data integrity, not authorization. Dirtiness is
  deliberately NOT folded into the cached `listUpgrades` view: it changes faster than the view is fetched, so
  the renderer combines its own state with main's answer, and main enforces its own view at the write.
- **Codes:** `EDITOR_DIRTY`, `STEP_NOT_FOUND`, `NO_LOCATOR`, `NO_PENDING`, `SUPERSEDED`, `STALE`,
  `BASELINE_NOT_PROMOTABLE`, `PROOF_NOT_SATISFIED`, `REPLAY_REJECTED`, `THRESHOLDS_PROVISIONAL`,
  `POLICY_REFUSED`, `T3_*`.

§4–§5 as built:
- **Proof result** (`LocatorProofResult`): `proven` / `rejected` / `unprovable-now`, a stable code, gates
  policy·buildable·unique·sameElement, scope compatibility, match counts, a candidate digest, and
  `pendingEligible`. It never carries candidate text, page text or typed values.
- **Gate D runs first:** `AiAutonomyPolicy` T3 (sensitive step, protected-login step), then the Recorder's
  DOM-signal protected-login detector (the one Element Spy refuses on), then an exact frame-chain + shadow scope
  match with the step. The baseline is the step's own locator through `LocatorFactory.resolve`, which re-proves
  a guarded position. A factory with no memory is used, so nothing is recorded or recovered. **C** is DOM
  node identity (`a === b` in one JS context).
- **Codes:** `unprovable-now` = `TARGET_MISSING`, `BASELINE_IDENTITY_CHANGED`, `BASELINE_UNRESOLVED`,
  `PAGE_UNAVAILABLE`. Rejections = compiler/intent codes, `T3_*`, `FRAME_CONTEXT_MISMATCH`, `NOT_BUILDABLE`,
  `CANDIDATE_NO_MATCH`, `CANDIDATE_NOT_UNIQUE`, `WRONG_ELEMENT`, `CONTEXT_EXPIRED` (the L2 context is past its
  10-minute TTL), `NO_PENDING`, `STALE_PENDING`.
- **Pending lifecycle:** proposed → compiler/intent rejected (nothing stored) → browser `rejected` (nothing
  stored) or `capture-proven` / `unprovable-now` → `pendingUpgrade` written by `annotatePendingUpgrade`, a
  compare-and-swap in the flow store's lane. It refuses T3, a stale binding and an older proposal
  (`SUPERSEDED`); a newer one replaces it. The save boundary (`invalidateStaleLocatorApproval` →
  `invalidateStaleAiLocatorFields`) drops a pending candidate or provenance whose binding no longer matches.
- **Replay:** before a step with a pending candidate acts, `StepExecutor` re-compiles the stored candidate
  (`planFromCandidate`), re-runs the intent guard with the run's bound values (current row, inputs, the step's
  value), and runs gates D–C. A refusal is tallied at once. A proof counts only after the step **passes**, with
  a hashed data-row key. The tally lives in `LocatorRecoveryStore` runtime memory (`upgrade-proofs/`), keyed by
  candidate digest + binding digest and serialized per key.
- **States** (`evaluatePendingUpgrade`): `none` · `stale` · `pending-replay` · `replay-rejected` (any refused
  replay) · `eligible` (≥ 3 passing replays over ≥ 2 distinct rows; seeded values, committed in L7). `eligible`
  is only the `proofSatisfied` input of `AiAutonomyPolicy`; nothing replaces the saved locator until §6.
Compiler decisions: css is limited to one stable `#id` selector; XPath needs `allowXPath`; a closed-shadow target
(`shadow.instrumented`) is refused because the bridge resolves it by its own target signature; the intent guard
rejects any text that contains a bound value (length ≥ 2, the L2 marker rule) rather than parameterizing it; a new
`hasText` scope, or a text target over a positional baseline, sets `meaningChange`.

## Goal

Automatically turn runnable-but-fragile locators into proven semantic locators, and repair failing saved locators,
without ever executing an unproven candidate or changing what a step means.

## 1. Trigger

A job is queued when a finalized locator's L2 class is `guarded-positional` or below `acceptable-semantic`, when a
saved locator fails at runtime and deterministic recovery finds no strong replacement, when the user asks from Element
Spy, or by the idle **flow health sweep**. Never for strong semantic locators, and never for sensitive-action or
protected-login steps (T3). The current locator stays authoritative.

## 2. Locator plan DSL → trusted compiler

Model returns a versioned plan (no code) mapped onto existing `LocatorCandidate` + `LocatorContext.containers`:
strategies role/label/placeholder/text/test-id/approved stable id-css; XPath only under explicit policy; container
kinds dialog/tableRow/card/listItem/landmark/form/section; captured frame/shadow context only;
`MAX_LOCATOR_CONTAINER_CHAIN` respected. Reject scripts, unknown operations, invented frame access, unguarded positional.
One compiler is the only path from model output to a candidate.

## 3. Intent guard (before any proof)

Using L2 bound-value markers: reject or parameterize any scope/target text equal to a bound data value, `valueSource`
value, data-source column value, or earlier-step value. A scope-kind change (position → text) sets `meaningChange`,
which blocks auto-apply (T2 → T1).

## 4. Proof gates (deterministic)

A buildable · B unique under recorder policy · C resolves to the **same element** as the identity-proven guarded
baseline (and matches `ElementIdentityContract`/fingerprint) · D no protected-login/sensitive/guard policy weakened.

## 5. Capture-time vs replay-time

- Target still present and compatible: run A–D now → `capture-proven`.
- Target removed/re-rendered/navigated/frame changed: **`UNPROVABLE_NOW`** (not a rejection, no attempt consumed) →
  store in `locator.pendingUpgrade` (never `alternatives`; `LocatorFactory` never reads it; never enters
  remembered-winner memory).
- Replay: after the guarded baseline resolves and passes its own guard, compile the pending candidate and run A–D
  against the same element; record the result in `LocatorRecoveryStore` runtime memory. No model call, no profile write.
  If the baseline fails its guard, no proof is recorded.

## 6. Promotion (autonomy policy)

T2 auto-promotion requires all: replay-proven on ≥ N replays across ≥ 2 distinct data rows (N committed after
baseline; capture proof alone never auto-promotes); no `meaningChange`; feature tier T2. Otherwise → T1 suggestion.
Sensitive-action steps are T3: no proposal at all.
Promotion is a **single-writer job** through the profile save path (`ProfileLockManager`, version check, skipped while
the flow has unsaved editor changes), sets semantic primary, keeps the whole guarded locator in
`locatorProvenance.previous` as the revert target (never in `alternatives`; the runner never executes it), writes
`locatorProvenance` + `AiActionRecord`, one-click revert. Field shapes: `docs/ai/DECISIONS.md` (2026-09-19).

## 7. Attempts

Max 2 synthesis attempts per job, consumed only by real rejections (malformed, unsupported, non-unique, wrong identity,
safety, intent). Structured deterministic feedback between attempts; no page dumps; no loops.
Built: `src/ai/locatorUpgradeAttempts.ts`, `verify:ai-locator-attempts` (87/87). See "§7 as built" above.

## 8. Runtime repair (T1)

Saved locator fails → existing deterministic recovery → if weak, same DSL/compiler/guard/proof against saved
identity/blueprint → before/after evidence → user approval → save/undo path → revalidate.

## 9. Flow health sweep

Idle-only, yields immediately to runs: scan saved flows for weak locators, queue upgrade jobs (capped per sweep),
surface a durability report. Proposals still go through §3–§6.

## 10. UX

Badges: Semantic · Guarded · AI suggestion pending proof · AI semantic (capture-/replay-proven) · Suggestion rejected ·
Auto-promoted (revert). Evidence on demand: original quality reason, proposed scope, proof location, match count,
identity result, retained guarded locator (revert target), provenance. No raw prompts or reasoning.

## Labelled quality set

Repeated row/card/dialog; generated ids/classes; section/heading scope; nested frame; shadow; identical twins
(impossible); row removed by click; dialog closes; navigation; re-render; capture-proof; replay-proof; replay-proof
failure; **data-bound row text (must not promote)**; position→text meaning change; protected-login; runtime repair.
Metrics: upgrade rate, capture/replay proof rates, rejection reasons, latency, auto-promotion revert rate,
**false-target promotion = 0**.

## Verifiers

`verify:ai-locator-upgrade` (built, 78/78; fake provider) covers all four required cases: pending present +
primary misses ⇒ pending never tried (in `verify:locator-upgrade-proof`); data-bound scope rejected; concurrent
promotions ⇒ one write; unsaved editor ⇒ promotion deferred. `verify:ai-locator-upgrade-gui` (built, 24/24)
covers the same deferral and the one-click revert in real Electron. `verify:ai-locator-attempts` (built, 87/87)
covers §7: the budget, repeats, every refusal stage, protected login, expired context, cancellation,
supersession, concurrency, and runs that pass unchanged with the provider timed out, crashed or absent.
Still to build:
`verify:ai-locator-repair`, live `verify:ai-locator-quality-live`. Existing: recorder/locator suites from L2,
`verify:blueprint-recovery-browser`, `verify:profile-store`, `verify:runner`, `verify:mock-site`, `npm run build`.

## Acceptance

Guarded baseline always runnable; pending candidates never execute; promotion only after proof + intent guard +
policy; single-writer, audited, revertible; impossible cases stay honestly guarded; AI absence changes nothing.
