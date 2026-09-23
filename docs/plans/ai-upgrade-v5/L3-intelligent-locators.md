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
so in practice a pending candidate still only exists in a verifier. **§10 UX is built** (`src/ai/locatorStatus.ts`,
the Flow Designer's `LocatorUpgradeSection`), proven by `verify:ai-locator-status` (85/85, pure) and in real
Electron by `verify:ai-locator-upgrade-gui` (65/65). **§8 runtime repair is built** (2026-09-21):
`resolveRepairAnchor`/`proveRepairCandidate`/`proveRepairPlan` in `src/runner/locatorProof.ts`,
`isLocatorRepairEligible` and `mode: "repair"` on the §7 loop, and the repair branch of
`promoteLocatorUpgrade`, proven in real Chromium by `verify:ai-locator-repair` (85/85, four mutations
caught) on the new `lu-repair` mock-site fixture. **§9 flow health sweep is built** (`src/ai/locatorSweep.ts`,
`verify:ai-locator-sweep` 60/60 pure, three mutations caught): the durability audit and the bounded,
idle-gated job queue. **`verify:ai-locator-quality-live` is built** (2026-09-22, `858ffd17`): the real
Qwen3.5-0.8B's plans for six labelled cases, proven by §4/§8 in real Chromium and judged by the page, 14/0
with false-target 0 (details and results in the L1 plan). §9's model-free **durability report** is shown
on the Flow Library since 2026-09-23 (see §9). **Since the owner's limited L1 GO (2026-09-23), §7 has its
first production caller:** Element Spy's on-demand proposal (see "§1 Element Spy trigger as built"). Still
not built, and outside that GO's scope: the automatic trigger on Recorder finalization, the §8 runtime
repair trigger, and §9's queue and idle scheduler.

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

### §1 Element Spy trigger as built (2026-09-23)

Built under the owner's limited L1 GO: on demand, browser-proven before use, never auto-promoted.

- **Where:** Recorder › Element Spy, **Find stronger locator with AI** under the inspection result
  (`ElementSpyAi` in `Recorder.tsx`, on the shared `useAiAssistJob`). A new inspection abandons and
  cancels the job in flight.
- **Channel:** `ai:proposeInspectionLocator` needs AI_USE plus the Spy's own pair (Recorder page,
  `recorder.elementSpy`). It carries only a request id. Main reads its own live inspection through
  `RecorderService.getInspectionTarget()`, which returns the inspection, its page and the values typed
  earlier in the recording.
- **The job is the product's own chain:** `proposeInspectionLocator` in `app/main/ai/aiAssist.ts` runs
  `runLocatorUpgradeAttempts` with `userRequested: true`, the capture context and those typed values.
  `proveLocatorPlan` proves on the Spy's page. The inspected element is judged for T3 as a click on it
  would be, so a sensitive name is refused before any model call. Cancel goes through the loop's signal
  (`abortInspectionLocator`).
- **Only `capture-proven` is shown.** An `unprovable-now` candidate is storable for a saved step, where
  replay settles it. The Spy has no replay, so it answers `NOT_PROVEN` instead.
- **Nothing is written.** The loop's `annotate` holds the candidate for the answer only. No flow, draft or
  Spy candidate changes, so using a proposal stays a person's separate act. Applying it through
  "Use in action" with provenance and audit is not built. It would need a decision on how a draft step
  carries AI provenance before it is saved.
- **An answer belongs to its document (fixed 2026-09-23, found end to end).** Navigation does not clear
  an inspection, and the proof runs on whatever the page holds when the answer arrives. A reload while
  the model was answering therefore showed the old inspection's answer as "proven … it is the inspected
  one", and asking again proved it on the new document. Now the Recorder counts Playwright's
  `framenavigated` per frame and pins the count when an element is inspected. `getInspectionTarget()`
  returns null once that frame has navigated or detached. `proposeInspectionLocator` re-reads the target
  before it shows an accepted answer, and answers `NOT_FOUND` unless it is the same inspection. Ceiling:
  same-document navigations count too, so a SPA route change also asks for a fresh inspection.
- **Close, then reopen (fixed 2026-09-23, found end to end).** Close Spy fired the liveness watch, which
  started a second, un-awaited `closeBrowser()`. When it finished after Open Element Spy, it reset the new
  session, leaving its browser without an owner and the Spy reading "closed". `closeBrowser()` now resets
  state only while the fields still hold the handles it closed.
- **Proven:**
  - **End to end in real Electron, `verify:ai-assist-gui` 159/0 (was 102).** The Recorder page opens the
    Recorder's own Chromium on the Feature Test Lab. A trusted click inspects through that browser's own
    Playwright connection: the verifier wraps `chromium.launch` in main before the Spy opens, never a
    second browser, and no product code knows about it. The request crosses the real preload and IPC,
    and the loop, compiler, intent guard and proof run on the live page. The scripted provider replaces
    only the transport. Covered: a proven proposal (labelled, applied nowhere); a wrong-element plan
    refused in the browser; T3 refused before any model call; Cancel, and a new inspection, each releasing
    the job in main with no late answer painted; a reload while pending and after; AI off; a protected
    page never inspected; Close Spy and closing the page while pending. Flows, fragments, reports and
    drafts on disk are unchanged. Red first: the two reload checks failed on the unfixed source (50/3,
    with the reopen race as the third failure). Mutations were caught and reverted: dropping the final
    same-inspection check (158/1), and dropping the renderer's stale-result token (157/2 — no older check
    caught it).
  - `verify:element-spy` 120/0 (was 114). Section H adds the reload cases, and a close-then-reopen check,
    which was red with the close guard removed (118/2).
  - The E section checks the IPC gates and wiring; the F section renders the panel's states. The mutation
    dropping `userRequested` was caught at 107/7.
  - `verify:ai-permissions` 96/0 and `verify:ai-fallback` 38/0 admit the channel in their exact rosters.
    `verify:recorder-gui` 205/0/0 after the `closeBrowser()` change.
  - **Not shown by any of this:** real-model quality. The live 0.8B evidence stays in the L1 plan.
- **On the real 0.8B (2026-09-23, `verify:ai-spy-live`): functional and safety PASS, proposal correctness
  INCONCLUSIVE.** The same path, with the pinned pack answering through the production AiService, ran
  32/0 (exit 2). T3 was refused before any call, a real inference was cancelled and released in 1.1 s,
  both asked jobs settled inside their deadlines and released the host, and nothing was written. **No
  proposal was shown:** every real plan was refused, correctly. The Edit button in the INV-2002 row was
  proposed as `role button "Edit"` twice; it matched both rows' Edit buttons, and the second attempt
  repeated the first. The request carried the row container and its text, but the instructions say
  "never by row content", and position is refused, so this fixture has no discriminator the contract
  steers the model toward. Save profile was proposed twice as `css` with a `data-testid=` engine prefix,
  a `SCRIPT` refusal. The request offered `testId` (1 match), which would have compiled. Neither refusal
  is a product defect; details in the L1 plan, "Element Spy on the real 0.8B".

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
Built: `proveRepairCandidate` / `proveRepairPlan` / `resolveRepairAnchor` in `src/runner/locatorProof.ts`,
`isLocatorRepairEligible` and `mode: "repair"` in `src/ai/locatorUpgradeAttempts.ts`, the repair branch of
`promoteLocatorUpgrade`, and `verify:ai-locator-repair` (85/85, real Chromium). See "§8 as built" below.

### §8 as built (2026-09-21)

- **Two gates are the whole difference from §7, and both are measured rather than claimed.**
  - **Gate E — the baseline must be observed FAILING.** A "repair" of a locator that still resolves
    uniquely is an unproven replacement of working behavior, so it is refused `BASELINE_HEALTHY`. The
    observation runs on the page through a memoryless `LocatorFactory`, so no caller can assert it.
  - **Gate C — identity, not DOM node equality.** There is no live baseline to compare against; that is
    the premise. The candidate's single match is re-fingerprinted through `LocatorFactory.fingerprintOne`
    and compared with a SAVED identity at `LocatorFactory.GUARD_MATCH_THRESHOLD`. Both were made public
    rather than copied: a second definition of "same element" would let a repair accept an element the
    guarded-positional path refuses.
- **The identity anchor is chosen, never invented.** `resolveRepairAnchor` takes the step's positional
  `guard` first (capture-time, in the profile, with its own `exact`/`high` confidence), then a
  caller-supplied blueprint element, then the runtime recovery memory's fingerprint. With none of them
  the repair is refused `NO_IDENTITY_ANCHOR` — terminal, because waiting does not create one. The
  blueprint is passed in rather than looked up because the deterministic recovery that §8 runs *after*
  has already resolved the page key, frame and document fingerprint to find it.
- **`mode: "repair"` is a parameter on the §7 loop, not a second loop.** The budget, the duplicate
  digest guard, the structured feedback, the cancellation handling and the compare-and-swap write are
  identical; a fork would have meant re-proving that a second loop terminates. What the parameter
  changes: the feature id (`locatorRepair`, so the audit and the policy tier are attributed correctly),
  the prompt's one sentence, the eligibility rule and what may be stored.
- **Eligibility is deliberately NOT §1's weakness gate.** A *strong* semantic locator breaks too, and
  that is the case repair exists for. T3 is still first and unconditional, and a `needs-review` baseline
  is still refused — a locator the user has not accepted is not something to repair into place.
- **Only a proven repair is stored.** §7 stores `unprovable-now` and lets replay settle it. §8 must not:
  replay proves a candidate against the element the saved locator resolves to, and a repair exists
  precisely because it resolves to nothing, so a parked repair could never be confirmed or retired. A
  new terminal outcome, `unprovable`, says so instead of pretending an attempt was refused.
- **Promotion takes the repair proof as its evidence and asks for no replay tally**, which would be
  unsatisfiable by construction. It stays safe because the proof it does require is stricter where it
  matters: gate E plus a saved-identity match. `locatorRepair`'s T1 ceiling means `mode: "auto"` can
  never be granted, so a repair is always a person's decision; the audit record carries
  `feature: "locatorRepair"`, `proof.result: "repair-proven"` and **no replay counts** — reporting `0`
  would read as an unmet threshold rather than an inapplicable one. Provenance is
  `source: "ai-repair"`, `proof: "repair-proven"`, and the whole previous locator is the revert target.
- **§10 reports what happened.** The badge reads *AI semantic (repair-proven)* and the sentence names
  the broken locator instead of borrowing "verified on enough runs"; the replay row reads *Not
  applicable* with the reason; the identity row names which recorded identity matched and its measured
  similarity, rather than claiming the candidate "reached the same element as the saved one".
- **Mutation-tested, four for four:** removing gate E → 80/83; weakening gate C's threshold to 0.5 →
  79/83; treating a repair as a semantic upgrade in promotion → 64/69; storing an unprovable repair →
  83/85. The third mutation *shortened* the run (the promotion block sits behind `if (promotion.ok)`),
  which reads as "mostly fine" rather than as a failure — so the suite now asserts that the promotion
  and revert sections were reached at all.
- **Still not built: the production trigger,** and it is gated by an architectural decision rather than
  by effort. `verify:ai-fallback` proves that *no module the execution tree can reach, at any depth,
  reaches the model*; `AiService` lives in the main process and the runner has no handle on it. Wiring a
  repair job into `StepExecutor`'s failure path would break that green guard, which is the same L1-gated
  boundary §7 recorded. `runLocatorUpgradeAttempts` still has no production caller in either mode.

## 9. Flow health sweep

Idle-only, yields immediately to runs: scan saved flows for weak locators, queue upgrade jobs (capped per sweep),
surface a durability report. Proposals still go through §3–§6.
Built: `src/ai/locatorSweep.ts` (`planFlowHealthSweep`), `verify:ai-locator-sweep` (60/60, pure).

### §9 as built (2026-09-21)

- **Two answers with different costs, kept apart.** The **durability report** is free — it is
  `classifyLocatorQuality` over saved profiles plus the upgrade lifecycle already on each step, with no
  model, browser, page or admission needed. The **queue** is what would cost a model call, so it alone
  is gated and capped. Collapsing them would make "how durable are my flows" depend on how many jobs
  happened to fit, which is a different question with a worse answer.
- **Idleness is `decideAiAdmission`, not a second notion of "quiet".** The sweep runs only when one
  inference would be admitted right now, so an active *or queued* run holds it at `RUNS_ACTIVE` — a
  queued run matters because the sweep must not race a run that is about to start. Host pressure, a
  dispatch refusal, low memory and no weighted headroom hold it too. No second scheduler exists.
- **T3 first, and counted twice on purpose.** A sensitive or protected-login step is excluded before
  weakness, before the lifecycle and before the cap, because it is excluded for what it *is*. The report
  counts it as **both** `forbidden` and `weak`: counting it only as forbidden would understate the flow's
  fragility, and counting it only as weak would imply AI will eventually get to it.
- **A stale proposal does not shield a step.** A pending candidate whose binding no longer matches will
  be dropped at the next save, so the step is genuinely unproposed; treating it as in-flight would leave
  it permanently unswept behind a candidate that can never apply.
- **The cap bounds the queue, never the audit.** `LOCATOR_SWEEP_MAX_JOBS` is 5 — a sweep is background
  work behind locators that already run, and one job costs a model call per attempt, so a large flow
  must not turn an idle-time courtesy into a workload. A caller may lower the cap but never raise it.
  `deferred` reports exactly what the cap left behind, which is the number that says whether sweeping
  again would find more.
- **Mutation-tested three for three:** un-clamping the cap → 59/60; removing the T3 exclusion → 54/60;
  treating any pending candidate as in-flight → 58/60.
- **A real fixture defect the suite caught on its first run.** `resolveStepSafety`'s keyword fallback
  treats "approve" as a dangerous mutation, so steps innocently named "Approve row" were T3 and five
  sections were asserting nothing. §0 now audits every fixture name against `decideAiAction` in both
  directions, so a name that quietly becomes sensitive fails loudly instead of voiding a section.
- **Not built: the scheduler that calls it on idle,** and the job queueing itself — both need the
  production AI caller that L1 gates (see §8).

### §9's durability report on the Flow Library (2026-09-23)

The report half had no caller either, although it needs no model, browser, page or admission. It is
now shown on its own. The queue and its idle gate are unchanged and still have no caller.

- **One scan, two entry points.** `buildLocatorDurabilityReport(flows)` in `src/ai/locatorSweep.ts` and
  `planFlowHealthSweep` share one private scan. The report and the queue therefore classify every step
  the same way. Only the sweep checks `decideAiAdmission`.
- **Where:** a one-line summary under the Flow Library's "Saved flows" heading
  (`data-testid="flow-locator-durability"`). The renderer computes it from the flows it already lists,
  with no new IPC and no new permission. It shows counts per class and the weak count, never a locator
  value, and it shows with AI off.
- **Not shown on purpose:** the T3, pending and already-upgraded counts. Those are AI-lifecycle numbers,
  and they belong with the sweep's queue once it has a caller. The report still computes them.
- **Proven:**
  - `verify:ai-locator-sweep` 64/64 (was 60). Section 8 checks the standalone report equals the sweep's
    report, exists while a run holds the sweep, and is not capped. A mutation dropping a flow from the
    standalone report was caught at 62/64 and reverted.
  - `verify:flow-library` 30/30 in real Electron (was 19). It seeds two flows, audits their locator
    classes, and checks the page's counts against a tally made with the L2 classifier over the app's own
    `flows.list()`, for Super User and Viewer. Red first: with the render removed, the first durability
    check timed out.
  - `verify:ai-fallback` 38/0, `verify:design-tokens` 35/35, build PASS.
  - `verify:failure-capture-overhead` (the structural index names it for `src/ai`): its two zero-AI
    run-path checks PASS. Its timing medians are INCONCLUSIVE as before, 15 passed, 0 failed,
    3 inconclusive (run 9 appended to its evidence file). The owner accepted that state for L5a.
- `awkit-djnl.4` stays `in_progress`: this closes no L3 acceptance item.

## 10. UX

Badges: Semantic · Guarded · AI suggestion pending proof · AI semantic (capture-/replay-proven) · Suggestion rejected ·
Auto-promoted (revert). Evidence on demand: original quality reason, proposed scope, proof location, match count,
identity result, retained guarded locator (revert target), provenance. No raw prompts or reasoning.
Built: `src/ai/locatorStatus.ts` + `LocatorUpgradeSection`, `verify:ai-locator-status` (85/85),
`verify:ai-locator-upgrade-gui` (65/65).

§10 as built:
- **One table, four axes kept apart.** `resolveLocatorStatus` maps locator **quality** (L2's
  `classifyLocatorQuality`), upgrade **lifecycle**, AI runtime **availability** and **authorization** onto the
  six badges. Collapsing any two is how a badge comes to claim what the product never established, so each is
  derived separately: a proposal is never "verified" because it compiled, capture proof is not replay
  eligibility, replay eligibility is not authorization, and AI absence is never a locator or Runner fault.
- **Eleven states behind six badges,** so the finer distinctions stay legible without inventing badges:
  `no-upgrade` · `proposed-unproven` · `capture-proven` · `replay-partial` · `replay-rejected` · `stale` ·
  `eligible` · `deferred-editor-dirty` · `blocked` · `applied` · `forbidden`. Every one is reachable from a
  real profile, which the verifier asserts by cardinality rather than by example.
- **T3 first, as in §6.** A sensitive or protected-login step reports `forbidden` ahead of anything about the
  proposal, because no amount of proof makes it applicable. Apply is **hidden** for a "never" refusal (T3,
  rejected, stale) and shown **disabled** for a "not yet" (more replays, dirty editor, policy off). The
  disabled control is never the guarantee: main refuses a direct IPC call for the same reasons.
- **Evidence has a source or says it has none.** `PendingLocatorUpgrade.proofEvidence` (optional, additive)
  persists the proof's code, candidate/baseline match counts, the gate-C identity verdict and scope
  compatibility. Absent ⇒ rendered *not recorded*, never as a passed gate. The disclosure is read-only: no
  navigation, no AI call, no run, no write.
- **Privacy by source choice.** The view carries the two locators being compared (compiler-validated, already
  in the saved flow), codes, counts and hashed-row *counts* — never a prompt, model text, page text, a typed
  value, a named secret or a data-row key. The verifier asserts each of those absences on a fixture that
  carries them.
- **Async identity.** The fetched view is per FLOW and the loader re-runs per flow, so a flow change discards
  the view and any in-flight response (monotonic request token) while a step change resets only transient UI.
  Clearing the view on a step change instead left it null forever — a real defect the GUI verifier caught.

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
`verify:ai-locator-status` (built, 85/85, pure) covers §10: every badge and lifecycle state reachable from a
real profile through `describeFlowLocatorUpgrades`, T3 outranking proof, absent evidence rendered unavailable,
each refusal keeping its own sentence, and no typed value, secret, prompt or data-row key in a view.
`verify:ai-locator-upgrade-gui` (extended to 65/65) covers it in real Electron: the badge for a step with no
proposal, the collapsed keyboard-operable disclosure, an unproven candidate, a forbidden step, step and flow
switching, light/dark token resolution, and the AI-unavailable line.
`verify:ai-locator-repair` (built, 85/85, `real-browser`) covers §8: gate E refusing a healthy baseline,
gate C proving against a saved identity written by a REAL run, a unique buildable look-alike refused as
the wrong element, a missing anchor refused rather than guessed, only a proven repair stored, promotion
refused for `auto` and accepted for a user with an empty replay tally, the audit attributed to
`locatorRepair`, the promoted locator passing a run on the page that broke it, revert, and the §10
wording. `verify:ai-locator-sweep` (built, 60/60, `unit`) covers §9: the sweep held by an active or
queued run and by every other admission hold, the durability report complete for every scanned step,
T3 counted as both forbidden and weak, the lifecycle exclusions, and the cap bounding the queue without
truncating the audit. `verify:ai-locator-quality-live` (built, 14/0, `real-browser`, real 0.8B) covers six
cases of the labelled set on `/recorder-lab/locator-upgrade`:

- a unique element;
- a guarded baseline whose CSS matched twice;
- a region-scoped duplicate (`lu-scope`);
- a broken saved locator through repair;
- a list re-rendered while the job runs (`lu-dynamic`);
- identical twins (impossible).

Each accepted candidate must be the recorded element on a fresh page: one match, its `data-lu`, replay or
repair proof again, and the click. False-target is 0 over every accepted candidate. Five scripted controls
show that a bypassed gate B or C, a stubbed proof and a second attempt without the real refusal are each
caught. The cases it does not cover (frames, shadow, rows, protected login, replay across rows) stay with
the scripted suites. Existing: recorder/locator suites from L2,
`verify:blueprint-recovery-browser`, `verify:profile-store`, `verify:runner`, `verify:mock-site`, `npm run build`.

## Acceptance

Guarded baseline always runnable; pending candidates never execute; promotion only after proof + intent guard +
policy; single-writer, audited, revertible; impossible cases stay honestly guarded; AI absence changes nothing.
