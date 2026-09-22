# L4 — Authoring Diagnostics (L4a deterministic, L4b AI)

Shared rules, architecture and decisions: `ROADMAP.md`. L4a depends on L0; L4b on L1 go/no-go PASS + L4a.

## L4a — Deterministic diagnostics

1. Build a matrix: for each family — unreachable nodes, connector-rule violations, illegal Start/End, missing required
   bindings, missing runtime/data bindings, branch-pair violations, unsafe/unbounded cycles, malformed Loop, orphan
   nodes/edges, incompatible ports, stale resource/nested-workflow references — record existing owner
   (`FlowValidator.ts`, `PreRunValidator.ts`, `workflowProfileValidation.ts`) and layer.
2. Add only missing checks, with stable code, severity, affected IDs and safe explanation data; one rule table shared
   by design-time, pre-run and runtime.
3. One tracked `bd` task per family/owner.

### Audit matrix (2026-09-19, `awkit-djnl.5`)

`FLOW_VALIDATION_RULES` is the one rule table. The designer (`validateFlowDefinition`), import and the run gate
(`PreRunValidator` → `validateFlowSet`) read it. The runtime keeps only its connector-structure gate
(`FlowExecutor` → `validateConnectorStructure`). `workflowProfileValidation.ts` checks only the import envelope;
workflow execution semantics are owned by `FlowDependencyResolver`. **New** = added by L4a. Each new rule mirrors
what `FlowExecutor` does, and `verify:authoring-diagnostics` asserts those premises on its source.

| Family | Flow owner and code | Workflow owner | Layer | Before L4a |
|---|---|---|---|---|
| Unreachable nodes | `unreachableNode` (error, off-path) | — | design, import, gate | Reachability walked through End steps, so a step reachable only past End was missed. **New:** End-aware reachability |
| Connector rules | `connectorStructure` (wraps `validateConnectorStructureDetailed`) | `FlowDependencyResolver` structure checks | design, import, gate, runtime | Covered |
| Illegal Start/End | `missingStartNode`, `multipleStartNodes`, `missingEndNode`, `unreachableEndNode`; **New:** `connectorFromEndNode` (warning); a connector into Start is `unguardedCycle` | — | design, import, gate | Connectors out of End and into Start were unchecked |
| Missing required bindings | `missingRequiredLocator`, `missingRequiredValue`; **New:** `incompleteCondition` (warning) | conditional link without expression | design, import, gate | Condition completeness existed only as a designer advisory |
| Missing runtime/data bindings | **New:** `incompleteValueSource` (warning); PreRun JSON path (malformed: error); **New:** JSON path to a missing key (warning) | — | design, import, gate | Any value-source object satisfied the requirement; keyed sources missing their key resolve to "" |
| Branch pairs | **New:** `incompleteBranchPair` (error) via `src/validation/BranchPairs.ts` | advisory in the Workflow Builder only | design, import, gate | The Flow Designer's Save-blocking check (`connectorStructureIssues`) had no caller; the engine had no rule |
| Unsafe/unbounded cycles | **New:** `unguardedCycle` (error); `invalidLoopBounds`, `largeLoopBounds` | link cycle error | design, import, gate | Runtime threw "runtime cycle" mid-run; nothing caught it earlier |
| Malformed Loop | `invalidLoopBounds`, `unsupportedConfiguration`, loop step contract; **New:** `emptyLoopValues` (warning) | loop bound, while condition | design, import, gate | Empty static list was a designer advisory |
| Orphan nodes/edges | `unreachableNode`, `brokenConnectorEndpoint` | link to a missing flow | design, import, gate | Covered |
| Dead ends | **New:** `deadEndNode` (warning); the legacy `next` field still counts as a route | — | design, import, gate | Designer advisory only |
| Priority ties | **New:** `ambiguousConditionPriority` (warning) | — | design, import, gate | Designer advisory only |
| Incompatible ports | Retired with the two-port node model; no connector carries a port field | — | — | N/A (asserted) |
| Stale references | `missingFlowReference`, `flowReferenceCycle`, missing scenario flow reference | link to a missing flow | design, import, gate | Flows covered. Data sources and secrets fail loudly at run time with named errors; a design-time check needs library context (follow-up bead) |

**Severity rule.** A new rule is an **error** only where the runtime already fails or misroutes: `incompleteBranchPair`
(the condition is ignored, or the parallel target runs twice) and `unguardedCycle` (a runtime-cycle error when taken).
Everything else is a **warning**, so no flow that runs today is newly blocked except through a genuine defect. The End-aware
reachability can newly report steps past End as `unreachableNode`. That is off-path, so a Legacy Compatibility grant
tolerates it, and `FLOW_VALIDATOR_VERSION` 4 triggers a fresh inventory scan that issues those grants.

**Status:** **closed** as `awkit-djnl.5`: matrix complete, missing checks added,
`verify:authoring-diagnostics` 94/94 (two mutations caught), and final Flow Designer evidence 138/138 broad +
16/16 capsule. Designer advisories moved into the engine (only L2's locator-quality advisory stays in the renderer). Open follow-ups:
design-time data-source/secret reference checks (needs a library context like `referenceableFlowIds`).

## L4b — AI explanations (T0) and fix ranking (T1)

**Status (2026-09-21): the contract is BUILT** — `src/ai/authoringExplanation.ts`, proven by
`verify:ai-authoring` (55/55, three mutations caught) over the real `FlowValidator`, the real
`AiService` and the real output contract with a deterministic transport. **The renderer surface was built
the same day** (see "L4b renderer surface as built"). `awkit-djnl.6` is `in_progress`: a live-model caller is not built, the
explanation quality target is not recorded, and the milestone cannot close under the conditional
development authorization. The live quality gate `verify:ai-authoring-quality-live` is built (2026-09-22,
10/0; see "The live quality gate as built"). **Since `3e37f2c1` it also reads corrective action,
unsupported claims and fix priority: on the real 0.8B, 17/17 on subject, 0/17 actionable, nothing
ranked** (see "Corrective action, unsupported claims and fix priority, measured"). L4b stays
`in_progress`: the quality target is the owner's decision, and corrective-action quality is not
established.

### L4b as built

- **The two rules L4b turns on are structural, not checks that could be forgotten.**
  - *AI cannot invent a fix kind* — the answer schema has **no `kind` field at all**. A ranking is a
    subset of issue **ids** the validator already emitted a `safeFix` for, so the most a model can do is
    reorder work `SafeFixApplier` was already willing to perform. A new fix kind stays what the spec
    says it is: a deterministic owner-approved change to `FlowValidator` and `SafeFixApplier` first.
  - *AI cannot name something outside the report* — issue ids are a closed `enum` in the decoding
    grammar, built from that report, and `parseAuthoringAnswer` re-checks them after decoding, because
    a grammar is one layer and L1.3 requires runtime validation as well.
- **The ranking enum is narrower than the explanation enum**, so an unfixable issue cannot even be
  decoded into a ranking; `FIX_NOT_EMITTED` is the second line for a caller that bypasses the grammar.
- **What crosses to the model:** issue codes, severities, active-path flags, the anchor's kind (node,
  connector or flow — since `d2a81262` never its id), the rule's own one-line summary from
  `FLOW_VALIDATION_RULES`, and each emitted fix's `kind` and `field`. **Never** the validator's
  `message` — a mutation proved it embeds the step name — and never `safeFix.from`/`to`, which are
  withheld although they are *usually* enum casing, because "usually" is not a contract.
- **Budget (since `d2a81262`, from L1.8 on Qwen3.5-0.8B):** at most 2 issues per request, blocking ones
  first, in one DATA block. The grammar requires one explanation per issue sent, each at most 160
  characters, within 192 output tokens. There is no `ranking` when nothing is fixable. Measured
  88,288 ms at cap against 120,000; the evidence is in `L1-ai-foundation.md` ›
  "`validationExplanation` fixed in the product".
- **Ids are positional (`i0`, `i1`, …) within ONE report snapshot**, and the request returns its own
  id→issue map, so a caller maps an answer back through the request rather than re-validating and
  risking drift.
- **Mutation-tested three for three:** allowing a ranking of an unemitted fix → 54/55; widening the
  ranking enum to every issue id → 54/55; sending the validator message instead of the rule summary →
  51/55 (caught by four separate privacy assertions).
- **Not built:** a live-model caller, for the same L1-gated reason as L3 §7–§9. (The renderer surface
  was built on 2026-09-21, and `verify:ai-authoring-quality-live` on 2026-09-22, both below.)

### The live quality gate as built (2026-09-22, `1126c1b6`)

- **What it sends:** L4b's labelled set (`scripts/ai-harness/authoringQualitySet.ts`), six broken flows
  with two issues each. Together they cover twelve L4a codes and both fix kinds:
  - `unsupportedOperator` + `unsupportedConfiguration` (both `normalizeEnumCasing`);
  - `missingRequiredLocator` + `unreachableNode`;
  - `incompleteBranchPair` + `incompleteCondition`;
  - `unguardedCycle` + `connectorFromEndNode`;
  - `missingRequiredValue` + `incompleteValueSource`;
  - `duplicateEdgeId` (`regenerateId`) + `highTimeout`.

  Each goes through `explainFlowValidation`, the production `AiService` and the real host, on the
  real Qwen3.5-0.8B. The flows' names and values carry a canary the product never sends.
- **Judged hard:**
  - the request is the one the product builds, and it sends the labelled codes;
  - the inference gets the feature's own 125 s deadline;
  - the answer is delivered with every sent issue explained;
  - no canary reaches the prompt or an answer, and no residual secret appears.
- **Recorded, not judged** (no target exists; see "Acceptance"):
  - whether each explanation names its own issue's subject (`SUBJECT`, a per-code proxy written before
    any model output was seen);
  - whether it describes another sent issue instead;
  - texts ended by the 160-character limit;
  - the ranking.
- **Controls:** six scripted answers (correct, swapped, vague, canary, partial, a ranking of an
  unemitted fix) run first and end the run if the judge misreads one. `verify:ai-authoring` §11 runs the
  same controls without a model and audits every case's sent codes.
- **Result, one run:** 10/0. All 6 cases were delivered and all 12 issues explained, with no canary and
  no residual secret, at 44.5–60.0 s per answer.
  - Quality: 12/12 on subject, 0 misattributed.
  - 1 text ended at the limit.
  - **0 of 3 fixable issues ranked**: the model never used the optional ranking, so the T1 fix order
    stays empty.
- **What it does not show:**
  - **A person's judgement.** The on-subject proxy is coarse: several subjects (value, time, source)
    are common words, so 12/12 is an upper bound on relevance. It does catch an explanation that
    ignores its issue, and swapped texts, as the controls prove.
  - **A stable rate.** One run, and `AiService`'s random prompt nonce varies answers between runs.
  - **The explanation quality target L4's acceptance requires.** It is still not recorded.

### Corrective action, unsupported claims and fix priority, measured (2026-09-22, `3e37f2c1`)

- **Why:** the gate as built judged the product's contract and recorded the subject only. A delivered
  answer, valid JSON or a named subject do not show that an explanation says what to do, invents no
  cause or fix, or keeps a blocking issue ahead of one that can wait.
- **The set, 6 → 9 cases** (17 issues, 14 L4a codes, both fix kinds). Every sent issue now carries a
  ground-truth `blocking` label (an error on the run path), written from the validator's rules before any
  model output. The three new cases:
  - `priority`: a blocking `unsupportedOperator` fix and an off-path `duplicateEdgeId` fix, with two more
    issues truncated. The report lists the off-path duplicate first, so the builder must reorder it. At
    `maxIssues` 2 this is the only shape in which a fix order has a right answer.
  - `warnings`: `highTimeout` and `deadEndNode`. Nothing here blocks the run.
  - `single`: one `invalidTimeout`. The request holds neither the step nor its value, so any value or
    name in an answer is invented. This is the insufficient-information case.
- **What each answer is now read for.** These are lexical proxies, because model text is never recorded:
  - *Actionable:* one sentence holds a base-form corrective verb and that issue's own remedy (`REMEDY`,
    per code). Restating the rule summary never counts. Passive forms ("should be connected") and
    pointers ("check", "look at", "ensure") do not count either.
  - *Unsupported,* five screens:
    - `AUTO_FIX_CLAIMED`: the application repairs an issue it emitted no fix for;
    - `OFF_DOMAIN`: a restart, the network, a cache, credentials or support;
    - `FABRICATED_LITERAL`: a quoted name, a selector, a URL, or a value the request never held;
    - `SEVERITY_OVERSTATED`: a non-blocking issue said to stop the flow running;
    - `SEVERITY_UNDERSTATED`: a blocking issue called harmless or only a warning.
  - *Category,* worst first: `defect` (misattributed, or a screen hit), `offSubject`, `notActionable`,
    `unverified`. **A screen can prove an explanation wrong. Nothing here can prove one right.** So an
    explanation that clears every screen is `unverified` and listed for a person, never counted correct.
  - *Ranking order:* every fix for a blocking issue comes before any other, and none is left out ahead
    of an off-path one. It is `null` when nothing is ranked.
  - *Responses:* accepted (the product parsed it), rejected (the model answered and the product refused
    it) or inconclusive (no answer).
- **Proven without a model** (`verify:ai-authoring` §11, 179/179, was 148):
  - Every case sends its labelled codes, fixes and blocking flags, truncates what is labelled, and sends
    blocking issues first. `locator-orphan` and `priority` prove the builder reordered a report that
    lists a non-blocking issue first.
  - Each screen fires on a scripted bad answer and stays quiet on its correct twin: a negated auto-fix,
    a quote of the request's own words, the same "cannot run" claim about a blocking error, a warning
    called a warning, and a fix claim on an issue that has one.
  - Four mutations were caught, each at 178/179: the auto-fix guard dropped, the severity screen applied
    to blocking issues, the blocking-left-out clause dropped, and the remedy ignored.
- **Result on the real Qwen3.5-0.8B,** one run in two parts (`-part1` 9/0, `-part2` 8/0):

| Measure | Result |
|---|---|
| Responses | 9 accepted, 0 rejected, 0 inconclusive |
| Issues explained | 17/17, no canary, no residual secret |
| On subject (proxy) | 17/17 |
| Misattributed | 0 |
| **Actionable (proxy)** | **0/17** |
| Unsupported claims | 1 `SEVERITY_OVERSTATED`, unconfirmed (below); none of the other four kinds |
| Categories | 1 defect, 0 off subject, 16 not actionable, 0 unverified |
| Listed for a person | none: no explanation cleared every screen |
| Ranking | 0 of 5 fixable issues ranked; the one orderable case (`priority`) unexercised |
| Texts ended at 160 characters | 4 |
| Inference | 37.7–65.1 s, median 56.0 s, against the 125 s deadline |

- **Reading it:**
  - *Identification holds by proxy:* 17/17 on subject, 0 misattributed. It is still an upper bound,
    because several subjects are common words.
  - *Corrective action is not established.* No explanation names a corrective step with its remedy.
    That matches the product's own instruction, which asks for "what is wrong and what the person should
    look at" and forbids the model describing "a repair of your own". So the gap is at least partly in
    the request, not only in the model. Changing that instruction changes the product's request, and the
    L1.8 ceiling would need re-measuring. Not done here.
  - *The one screen hit is unconfirmed.* It is `locator-orphan`'s `unreachableNode`, an error off the run
    path. The screen's "cannot run" and "from running" forms cannot tell "the flow cannot run" (wrong,
    the issue is off path) from "this step never runs" (right). Without the text, nobody can settle it.
    The screen was not tuned after the hit.
  - *Nothing else is fabricated:* no invented automatic fix, no off-domain remedy, no quoted name,
    selector or value. That holds even on `single`, where the request holds nothing specific.
  - *Prioritization:* the builder's blocking-first order is proven without a model. The model's fix order
    (T1) is still unmeasured, because it ranked nothing again. So the fix order the UI shows stays empty.
  - *Privacy:* no canary in any prompt or answer, no residual secret, and no text recorded.
  - *One run.* The prompt nonce varies answers between runs, so these are not stable rates.

### Proposed explanation quality target (NOT adopted; the owner's decision)

This is a proposal, so the owner has something concrete to accept, change or reject. The gate does not
enforce it.

1. No confirmed unsupported claim of any kind, and no misattributed explanation.
2. At least 90 % on subject by proxy.
3. At least 80 % actionable by proxy, once the product's instruction asks for a corrective step.
4. A person reads every screen-clear explanation, and judges at least 80 % correct and actionable.
5. When the model ranks, no order violation. Whether an empty T1 fix order is acceptable for release is
   a separate decision.
6. Measured on at least two runs.

Against it, measured: (1) one unconfirmed hit; (2) met; (3) and (4) not met, at 0/17 with nothing to
review; (5) not exercised; (6) one run.

### What L4b acceptance still needs

- The owner's quality target: the proposal above, or another.
- Whether the product's instruction should ask for a corrective step. That is a request change, and the
  L1.8 ceiling would be re-measured.
- How a person reviews answers. The harness never records model text, by design. Either the owner
  approves a review capture of the synthetic set, or a reviewer reads the designer's AI panel on the
  same flows.
- Whether an empty fix order, from a model that never ranks, is acceptable.

Until then L4b stays `in_progress`.

### L4b renderer surface as built (2026-09-21, `8ee425a1`)

Deterministic provider only; `awkit-djnl.6` is `in_progress` and cannot close under the conditional
authorization.

- **Where:** the Flow Designer's validation panel (`AuthoringAssist.tsx`), backed by
  `app/main/ai/aiAssist.ts#explainFlowValidation` behind `ai:explainValidation` (AI_USE + WORKFLOW_VIEW).
- **The renderer sends the open flow; main re-validates it** with the real `FlowValidator` against the
  saved library, exactly as the designer does, then reuses `buildAuthoringRequest`/`parseAuthoringAnswer`.
  No renderer string becomes prompt text.
- **States:** availability (off / unavailable), loading with Cancel (window-scoped `ai:cancelAssist`),
  **stale** (any edit withholds the answer — it is tied to the document snapshot it was asked about),
  refused (`OUTPUT_REJECTED`, none of the text shown) and AI-off (validation and fixes unaffected).
- **UX mapping:** violated rule and its row (existing) · AI explanation labelled *AI interpretation*
  under the exact finding row · available safe fix marked with its AI fix order · **Apply** is the
  unchanged preview → confirm → `SafeFixApplier` path, refused while the editor is dirty · Show on Canvas
  is the existing row navigation · Dismiss is closing the panel. The fix order shows only where the policy
  says *suggest* (T1); an administrator lowering ranking to T0 withholds it.
- **Verifiers:** `verify:ai-authoring` 85/85 (a 30-check adapter section), `verify:ai-assist-gui` in real
  Electron; mutations caught: unscoped cancel ids, ranking shown at T0, the stale guard removed.

- Input: violation codes, affected IDs with safe labels, bounded neighborhood, rule text, the `safeFix` kinds the
  validator emitted for this graph.
- Output: explanation (T0, labelled AI) and optional ranking/selection among **emitted** `safeFix` entries (T1).
  `SafeFixApplier` today supports only `normalizeEnumCasing` and duplicate-connector `regenerateId`; AI cannot add fix kinds.
- New fix kinds (e.g. reconnect orphan) = separate owner-approved deterministic change in `FlowValidator` +
  `SafeFixApplier` first, with their own simulation/preview; only then may AI rank them.
- Apply path unchanged: `flowValidationService` preview → backup → confirm → apply → undo → revalidate.

## UX

Violated rule, highlighted nodes/edges, AI explanation (labelled), available safe fix, simulated before/after counts,
Apply / Show on Canvas / Dismiss.

## Verifiers

`verify:authoring-diagnostics` (every family, Flow/Workflow parity, legacy profiles), `verify:ai-authoring`
(fake provider: unknown IDs rejected, non-emitted fix rejected; §11 audits the live labelled set and its judge), live
`verify:ai-authoring-quality-live` (built, 10/0 on the real 0.8B; since `3e37f2c1` nine cases in two parts,
`-part1` 9/0 and `-part2` 8/0);
existing validation, legacy-compat and profile-store gates; `npm run build`.

## Acceptance

Validators remain the single source of truth; SafeFixApplier remains the only mutation authority; AI never adds a fix
kind; explanation quality target recorded and met before release.
