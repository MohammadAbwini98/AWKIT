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
ranked** (see "Corrective action, unsupported claims and fix priority, measured"). **Since `97996c48`
the owner's four decisions are implemented** (a corrective step in the request, a blocking-first fix
order, a local redacted human review, the target adopted provisionally). On two runs the 0.8B reaches
6/17 and 5/17 actionable by proxy, so **the target is NOT MET**, and no person has reviewed an answer
yet (see "The owner's L4b decisions, implemented and measured"). L4b stays `in_progress`.

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

### Explanation quality target (adopted provisionally by the owner, 2026-09-22)

Proposed on 2026-09-22 and adopted the same day as proposed, **thresholds unchanged**; they are not
lowered to fit a result. `verify:ai-authoring-review` evaluates it (`QUALITY_TARGET` in
`scripts/ai-harness/authoringQualityReview.ts`).

1. No confirmed unsupported claim of any kind, and no misattributed explanation. It stays `PENDING`
   while any answer the target sends to a person is unread, because a person can still confirm a claim
   the screens missed. A person marking an answer ungrounded counts as a confirmed claim.
2. At least 90 % on subject by proxy, **in every complete run**.
3. At least 80 % of issues get a corrective action in the explanation a person sees, **in every complete
   run**. It is either the product's corrective action shown beside the answer or the model's own. An
   answer with a screen hit or a misattribution does not count.
   - *Revised by the owner on 2026-09-23 (option B).* Until then it measured the model's own text alone.
   - The model's own rate is still reported beside it, and it is never credited with the product's
     action. See "Owner decision record: criterion 3".
4. A person reads every screen-clear explanation, and judges at least 80 % correct and actionable. With
   nothing screen-clear it is NOT MET, never vacuously met.
5. When the model ranks, no order violation. **An empty fix order is acceptable** (owner decision 4).
6. At least two complete runs. Run *k* is each case's *k*-th measurement, so two parts make one run.

`PENDING` is never `MET`. An undelivered answer still counts its sent issues, so a failure lowers a rate
instead of vanishing from it.

The 3e37f2c1 measurement against it: (1) one unconfirmed hit; (2) met; (3) and (4) not met, at 0/17
with nothing to review; (5) not exercised; (6) one run. The current measurement is in the next section.

### The owner's L4b decisions, implemented and measured (2026-09-22, `97996c48`)

**The decisions (owner, 2026-09-22):**

1. **Quality target:** adopt the proposal above provisionally, with its exact thresholds. Record any
   unresolved criterion explicitly.
2. **Corrective action:** require concise, evidence-grounded corrective guidance when the validation
   information supports it. Never invent node names, selectors, values, connections or unsupported
   automatic fixes.
3. **Human review:** a privacy-safe, locally stored review of the labelled set, in which a reviewer
   judges real answers for correctness, actionability, grounding and unsupported claims. Redact before
   persistence. Never expose credentials or protected authentication information.
4. **Fix order:** an empty order is allowed when ordering does not apply or cannot be justified. Where
   issues have a documented priority, blocking issues come first. Never invent dependencies, and never
   modify a flow automatically.

**What changed:**

- **The request** (`src/ai/authoringExplanation.ts`). The instruction asks for "what is wrong, then the
  step the person should take in the editor, starting with a verb such as add, set, connect, remove or
  change". The step rests only on that issue. When the issue gives too little for a specific step, the
  model says what to check. It must never invent issues, ids, rules, step names, selectors, values or
  connections, or say the application can fix an issue that is not marked fixable. Fixes on the run path
  are ranked first. The old ban on describing any repair is gone, because it forbade the corrective step
  itself. The schema, the 192-token cap, the 160-character limit and the deadline are unchanged.
- **The output contract.** `parseAuthoringAnswer` withholds a fix order that breaks the one documented
  priority: every fix for an issue that blocks the run (`isExecutionBlocking`) comes before any fix that
  can wait, and none is left out ahead of one. This rule is `rankingKeepsPriority`, now shared with the
  judge.
  - The order is withheld as `rankingWithheld: "PRIORITY_VIOLATION"`, with the explanations kept. It is
    **never re-sorted**, because a re-sorted order would present the product's order as the AI's.
  - Two equally urgent fixes keep any order, since no priority between them is invented. An empty order
    is an accepted answer.
  - The designer shows no fix order for a withheld one; no renderer change was needed.
- **The review store** (`scripts/ai-harness/authoringQualityReview.ts`). Each run part of
  `verify:ai-authoring-quality-live` writes one capture, `capture-<id>.json`. Every case the model was
  asked is captured, delivered or not.
  - **Location:** `%LOCALAPPDATA%/SpecterStudio/ai-quality-review/authoring`, or `AWKIT_AI_REVIEW_DIR`.
    It is local, outside the repository, never committed and never sent anywhere.
  - **What an item holds:** the product's own Issues line for that issue (product constants), the
    model's text after `SemanticRedactor` with the canary as a sensitive term, and the proxy reading.
  - **What is refused:** a text in which a residual secret or the canary survives redaction is not
    written at all. No flow, name, value, selector, nonce or path is stored. A reviewer's label and note
    are redacted, and refused if a secret survives.
  - **Scope:** captures are keyed to a SHA-256 of the instructions, so a capture of another request is
    listed and ignored.
- **The review.** `npm run verify:ai-authoring-review -- --pending` lists each unread answer with its
  evidence and proxy reading. `-- --record <item> --correct yes|no --actionable yes|no --grounded yes|no
  --unsupported yes|no --reviewer <label> [--note <text>]` stores one verdict; a second verdict replaces
  the first. A person records verdicts. **An agent never does.**

**Proven without a model** (`verify:ai-authoring` §12, 239/239, was 179):

- each instruction clause is present, and the repair ban is gone;
- priority: a blocking-first order is kept, a reversed order or one leaving the blocking fix out is
  withheld and never re-sorted, equal fixes keep any order, no order is accepted, and the adapter shows
  no fix order for a withheld one;
- privacy: the capture holds no canary, email, token, URL, user path or flow data, a surviving private
  key block is withheld, and an undelivered case is kept;
- verdicts: unknown, withheld and malformed verdicts are refused, a note is redacted, and an unreadable
  file is reported;
- the evaluator can say MET, and says PENDING or NOT MET at each boundary: 13/17 and 14/17 actionable,
  15/17 and 16/17 on subject, 27/34 correct, one run, an unconfirmed, dismissed or confirmed hit, an
  ungrounded answer, a misattribution, an order violation, an undelivered answer, nothing screen-clear.
- **Mutations caught, each run once and reverted,** out of 238 checks: priority withholding removed
  (233), unreviewed answers counted correct (236), the capture written unredacted (231), undelivered
  issues dropped from the rate (237). Reverting the instruction was not run as a mutation; its checks
  assert the text directly.

**Real Qwen3.5-0.8B:** two complete runs, each in two parts: run 1 `-part1` 9/0 and `-part2` 8/0, run 2
9/0 and 8/0.

| Measure | 3e37f2c1 (old request) | Run 1 | Run 2 |
|---|---|---|---|
| Responses | 9 accepted | 9 accepted, 0 rejected, 0 inconclusive | 9 accepted, 0 rejected, 0 inconclusive |
| On subject (proxy) | 17/17 | 17/17 | 16/17 (`warnings`' `deadEndNode`) |
| Misattributed | 0 | 0 | 0 |
| **Actionable (proxy)** | **0/17** | **6/17 (35 %)** | **5/17 (29 %)** |
| Screen hits | 1, unconfirmed | 0 | 0 |
| Screen-clear, for a person | 0 | 6 | 5 |
| Ranked | 0 of 5 fixable | 0 of 5 | 0 of 5 |
| Orders withheld | – | 0 | 0 |
| Texts ended at 160 characters | 4 | 7 | 5 |
| Inference per answer | 37.7–65.1 s | 53.7–86.1 s | 51.4–79.3 s |

`verify:ai-authoring-review` over both runs gives **TARGET: NOT MET**:

| Criterion | Status | Detail |
|---|---|---|
| (1) no confirmed claim, no misattribution | PENDING | 0 misattributed, 0 confirmed; 11 screen-clear answers unread |
| (2) ≥ 90 % on subject, every run | MET | 17/17, 16/17 |
| (3) ≥ 80 % actionable, every run | **NOT MET** | 6/17, 5/17 |
| (4) a person reads every screen-clear answer, ≥ 80 % correct and actionable | PENDING | 0 of 11 reviewed |
| (5) no order violation when the model ranks | MET | nothing ranked; an empty order is acceptable |
| (6) ≥ 2 runs | MET | 2 |

- **Reading it:**
  - *Corrective action rose from 0/17 to 5–6/17 by proxy,* far below 80 %. Where it lands is uneven:
    `cycle` 2/2 in both runs, while `casing`, `duplicate-timeout`, `warnings` and `single` stay at 0.
  - *Engineering observations from the capture, not review verdicts:*
    - several answers restate the rule summary and give no step;
    - the two casing issues get "check the … definition", which is the insufficient-information
      fallback, although the request marks them fixable;
    - 12 of 34 texts end at the 160-character limit, some just before or inside the step.
  - *The proxy is only a proxy.* An answer saying a step "does not specify a required value" reads as
    actionable, because "specify" is a corrective verb. That is exactly why a person must read every
    screen-clear answer, and why none counts as correct unread. The screens were not tuned after the
    result.
  - *Nothing was fabricated* by any screen: no invented fix, off-domain remedy, quoted name, selector or
    value, including on `single`.
  - *Fix order:* the model ranked nothing in either run, so no order was ever withheld. Criterion 5 is
    met only because an empty order is now acceptable.
  - *Privacy:* no canary in any prompt, answer or capture, no residual secret, and nothing withheld.
  - *Two runs.* The prompt nonce still varies answers between runs.

### The corrective action made the product's, measured (2026-09-23, `ddcfc35b`)

**Starting evidence (the owner's review of the 11 screen-clear answers at `97996c48`, in chat, not yet
recorded):** 6/11 correct and actionable against 80 %. Wrong corrections for a lone conditional
connector, a connector leaving End and a duplicate connector id; "requires a value and has none" read
twice as the value not being required; steps cut off by the 160-character limit.

**Root causes, from the captures:**

1. **The request held no remedy.** Each line carried a rule summary, which says what is wrong, never what
   to do. The 0.8B guessed the step, and guessed wrong where the obvious-sounding verb is the wrong one
   (add a connector *into* End, add a condition "to the runner", remove the duplicate connector).
2. **The step came last.** The instruction asked for what is wrong, then the step. The model restates
   the summary first, so the 160-character grammar limit cut the step, and the product showed the cut
   sentence ("The person should check the configuration definition to").
3. **The value summary was ambiguous.** "Step type requires a value and has none" reads as "the step
   type does not specify a required value" to the 0.8B.
4. **The proxy counted wrong steps.** "Specify" is a corrective verb, so the inverted reading counted as
   actionable. That was recorded, not tuned, at `97996c48`.

**What changed (`ddcfc35b`):**

- **A product-authored corrective action per rule** (`correctiveStep`, `src/ai/authoringExplanation.ts`).
  - Every one of the 33 rules has one, by an exhaustive `Record`, so a new rule does not type-check
    without one.
  - It is tied to "this step" or "this connector" and rests on the rule alone. Where the validator's own
    message names a remedy (branch pair, cycle, condition priority, ignored binding), it is that remedy.
  - A safe fix is named only where the validator emitted one, and then only through its preview:
    "Review and apply the offered safe fix, which gives this connector a new id." No other action names a
    fix (`verify:ai-authoring` §13).
- **It travels in the request.** Each issue's line ends `Action: <the action>`, replacing the fix
  kind/field/summary parenthetical. The instruction asks for that action first and as given, and no
  other. It is 616 characters against 875, so the benchmark prompt fell from 395 to 340 tokens.
  - The label is "Action", never "Step". Labelled "Step:", the 0.8B read the action as a step's *name*
    ("The step 'Add a locator to this step' is missing a locator") in 3 of 10 answers.
- **It travels in the answer, beside the model's text,** never taken from the model: the answer schema
  has no field for it. The designer shows it under each finding, labelled "Corrective action", apart from
  the "AI interpretation" (`verify:ai-assist-gui` 101/0). So what the person is told to do never rests on
  model wording alone. With AI off, nothing changes.
- **Complete sentences only** (`endAtCompleteSentence`). An unfinished tail is dropped, never completed
  or rewritten. A text with no complete sentence keeps its fragment, marked with an ellipsis.
- **The two "requires … and has none" summaries** now name their subject first: "The step has no value,
  and its type needs one."
- **The judge got stricter, never looser:**
  - a `WRONG_REMEDY` screen per rule where the wrong direction is unambiguous: a connector into End, the
    value or locator rule inverted, a condition added "to the runner", a connector or id removed for a
    duplicate id, a high timeout raised;
  - the action given as a step's name counts as a fabricated name;
  - neither is ever actionable, and only a complete sentence can be.
  These screens were written **after** the answers were read, as regression screens at the owner's
  request. They can only lower a rate. The `CORRECTIVE` and `REMEDY` patterns are unchanged.
- **Regression controls** (`correctiveControlFailures`): the reviewed failures replayed as scripted
  answers the judge must refuse, each beside a correct twin, plus every product action restated as the
  whole answer, which must be judged actionable and screen-clear for all 14 labelled codes.

**Proven without a model** (`verify:ai-authoring` 257/257, was 239). Mutations, each run once and
reverted: the trim removed, 255/257; the wrong-remedy screen disabled, 256/257.

**Three request variants on the real 0.8B** (one part each, 10 issues, before the final runs):

| Variant | Actionable (proxy) | What the text showed |
|---|---|---|
| "Step:" after the summary | 8/10 | 3 answers read the action as a step's name |
| **"Action:" after the summary (final)** | **7/10** | every answer read correctly |
| "Action:" before the summary, instruction to match | 2/10 | the raw line copied, or the action dropped |
| no opening sentence, "word for word" | 2/10 | answers collapsed to bare labels ("Unsupported Operator…") |

**The final request, two complete runs** (`-part1` 9/0, `-part2` 8/0, twice):

| Measure | `97996c48` run 1 · run 2 | `ddcfc35b` run 1 · run 2 |
|---|---|---|
| On subject (proxy) | 17/17 · 16/17 | 17/17 · 17/17 |
| **Actionable (proxy)** | **6/17 · 5/17** | **9/17 · 7/17** |
| Misattributed · screen hits | 0 · 0 | 0 · 0 |
| Screen-clear, for a person | 11 | 16 |
| Ranked | 0 of 5 · 0 of 5 | 0 of 5 · 0 of 5 |
| Inference | 51.4–86.1 s | 43.3–74.6 s |

The `97996c48` column was judged by the looser judge. Under the new one, its two inverted value answers
and its two duplicate-id removals are no longer actionable, so the true gain is larger than it reads.

`verify:ai-authoring-review` over the final request: **TARGET NOT MET.**

| Criterion | Status | Detail |
|---|---|---|
| (1) no confirmed claim, no misattribution | PENDING | 0 misattributed, 0 screen hits; 16 screen-clear answers unread |
| (2) ≥ 90 % on subject, every run | MET | 17/17, 17/17 |
| (3) ≥ 80 % actionable, every run | **NOT MET** | 9/17, 7/17 |
| (4) a person reads every screen-clear answer, ≥ 80 % correct and actionable | PENDING | 0 of 16 reviewed |
| (5) no order violation when the model ranks | MET | nothing ranked |
| (6) ≥ 2 runs | MET | 2 |

**Reading the captured text, not the proxy** (an agent's engineering reading, not a review verdict):

- **Every answer that states the action states the right one**, because it is the product's. No wrong
  correction, inverted rule, invented fix or fabricated value appears in either run. The failures the
  owner found are gone from these captures.
- **What is still missing is the action itself, not its correctness.** The 18 answers that are not
  actionable take three shapes:
  - the answer opens by echoing the instruction ("The automation flow failed validation because…") and
    restates the summary, and the character limit cuts it before the action;
  - the answer is the summary alone, with no action;
  - the answer is the bare rule code ("unsupportedOperator…", "Unsupported Operator…").
- **Run-to-run variance is large.** The same request gave 7/10 and 3/10 on the same five cases, because
  the prompt nonce varies.
- **Cause of the criterion 3 shortfall:** the 0.8B does not reliably follow an instruction about the
  order or content of its own sentence. Prose-level ordering (three variants) moved the rate between
  2/10 and 8/10, never to 80 %. The product now guarantees the corrective action the person sees; the
  model's own sentence contains it about half the time.

**Owner decision needed on criterion 3.** Every delivered explanation now carries the product's
validated corrective action, so the explanation a person reads is actionable 17/17 by construction.
Criterion 3 was written when the model's text was the whole explanation, and it still measures that
text alone. Whether it should measure the delivered explanation instead is a change to what the target
measures, so it is the owner's to make; it was **not** changed here. The alternatives are a different
model, or accepting the shortfall.

**Performance:** L1.8 re-measured, GO on all 8. The explanation request is 340 prompt tokens and takes
83,345 ms at cap against 120,000. At this host's slowest rates (prompt 9.4 tok/s, decode 2.55 tok/s)
it projects to about 111.5 s, so the margin is 8.5 s, up from 2.7 s. The 192-token cap, the
160-character limit, the 120 s ceiling and the 125 s deadline are unchanged.

### One corrective change, measured (2026-09-23, `d2f9721f`)

**Why the `ddcfc35b` answers omit the action.** The 18 answers not actionable in the final runs, read
one by one. This is an agent's engineering reading, not a review verdict:

| Cause | Answers | What the text shows |
|---|---|---|
| The task sentence echoed as a cause, then cut at 160 characters | 6 | "The automation flow failed validation because a reachable step had no way out, causing the run to…" (`warnings` ×2 runs, `branch` in run 2) |
| The task sentence echoed as a cause, complete, no action | 6 | "…because connectors form a cycle with no Loop Back connector, causing a runtime-cycle error." (`cycle` ×2 runs, `single` ×2) |
| The rule code copied from after the id, then stopped | 4 | "unsupportedOperator…", "Duplicate Edge ID…". The Issues line reads `i0: unsupportedOperator (…`, so the code is what follows the id |
| The summary copied, and the action trimmed away by the limit | 2 | `values`' `incompleteValueSource` ×2: the summary alone. The later captures, which record cuts, show the identical text marked cut |

- **No wrong action, no misread rule.** Every miss omits the action; none states a wrong one.
- **No judge false negative.** None of the 18 texts holds a corrective action. None of the 16 counted
  actionable states a wrong one. One copies the raw issue line whole ("highTimeout (warning, …) —"),
  which is correct but reads poorly.
- **The echo is the task sentence.** It opened 16 of the 2026-09-23 captured answers, and none of
  them was actionable. It disappears when the sentence is removed.
- **A structural limit the earlier diagnosis missed.** For 5 of the 14 labelled codes, the summary plus
  " Action: " plus the action run past 160 characters: `connectorFromEndNode` 171, `incompleteValueSource`
  173, `deadEndNode` 179, `unguardedCycle` 220, `incompleteBranchPair` 242. The other 9 fit, up to 156.
  - An answer in the line's own order (summary, then action) cannot carry the action for those 5; the
    product then trims the cut action away.
  - Only an action-first answer fits, which the instruction asks for and the 0.8B rarely gives.
  - Those 5 issues were actionable **1/10** across both runs; the other 12 were **15/24**.
- **A measurement gap, now closed.** The capture kept only the trimmed text, so an action cut by the
  limit looked like one never written. Each capture item now records `cut`.

**The one change: the task sentence asks for the correction.** "You explain why an automation flow
failed validation, for the person editing it." became "You tell the person editing an automation flow
how to correct each validation issue." Nothing else changed: action after the summary, the "Action"
label, the full instruction, the model, the display, redaction, the cap and the limit. It is distinct
from the three rejected variants: it reorders nothing, relabels nothing and removes nothing.

**Real Qwen3.5-0.8B, two complete runs** (`-part1` 9/0 and `-part2` 8/0, twice):

| Measure | `ddcfc35b` run 1 · run 2 | Corrective task sentence, run 1 · run 2 |
|---|---|---|
| On subject (proxy) | 17/17 · 17/17 | 17/17 · 17/17 |
| **Actionable (proxy)** | **9/17 · 7/17** | **8/17 · 8/17** |
| Misattributed · screen hits | 0 · 0 | 0 · 0 |
| Answers opening with the echo | 5 · 7 | 0 · 0 |
| Texts cut by the 160-character limit | not recorded | 10 · 10 |
| The 5 over-limit issues actionable | 1 · 0 | 1 · 1 |
| Answers carrying the model's own action, not the product's | 0 · 0 | 1 · 3 |
| Inference | 43.3–74.6 s | 52.7–92.3 s |

`verify:ai-authoring-review` over the changed request: **TARGET NOT MET**, criterion 3 at 8/17 and 8/17,
criteria 1 and 4 PENDING on 16 screen-clear answers.

**Reading the text (an agent's reading, not a review verdict):**

- The echo ended (0/34, was 12/34), but the answers it freed did not gain an action:
  - they became descriptions cut at the limit (`cycle`, `warnings`' `deadEndNode`, `values`'
    `incompleteValueSource`, 8 answers);
  - or copies of the issue line from its rule code (`priority`, run 1's `casing`, 6);
  - or a complete description with no action (`single`, 2).
- **A new failure: the task sentence's verb came back as the model's own action.**
  - Run 2's `casing` gave "Correct the operator casing to 'operator'." and "Correct the configuration
    value to 'true'.": invented values, against the instruction.
  - The proxy files both as not actionable, not as defects, because its fabricated-literal screen reads
    double quotes only. So neither would reach a person. That is a judge gap (KNOWN_ISSUES), fixed at
    `721077ab`: see "The fabricated-literal screen reads every quotation style" below.
  - Both runs' `warnings`' `highTimeout` answers count as actionable by proxy, but they are the model's
    own words, "Reduce the timeout value…", with an unsupported claim that the flow will "hang". One also
    ends mid-phrase ("…to a reasonable duration for the current.").
  - The keyword match is not proof: by this reading, 7/17 per run hold a correct action.
- **Why it was restored:** criterion 3 did not move (16/34 either way), and grounding got worse.
  - Every `ddcfc35b` action is the product's own. The change brought back model-authored actions and
    invented values, which the owner's decision 2 forbids.
  - The instruction is restored byte for byte. The variant is recorded beside it in
    `authoringExplanation.ts`.

**Kept, proven without a model** (`verify:ai-authoring` 258/258, was 257):

- the capture's `cut` flag (§12);
- negative controls from these captures, each with its correct twin:
  - the echo given back as the cause;
  - a corrective task sentence echoed with no action, and the same echo leading into the action;
  - the echo cut by the limit;
  - a bare rule code;
  - summary then action past the limit (trimmed, not actionable), beside the action first (actionable).
- **Mutations**, run once together while the variant was in place, then reverted: 257/259, each failing
  exactly its own check. The two were "correct" added to the corrective verbs, and the capture's `cut`
  dropped.

**Performance:** the production request is byte-identical to `ddcfc35b`'s, so L1.8 had nothing to
re-measure. `benchmark:ai-model-0-8b` reports 7/7 scenarios current and GO on all 8, with 83,345 ms at
cap against 120,000; only its `evaluatedAt` was rewritten. The variant itself was never L1.8-measured,
because it never shipped: its live requests were 276–361 prompt tokens, the `ddcfc35b` range.
`verify:ai-explanation-live` 5/0 (336 prompt tokens, 53.2 s and 73.0 s of inference, a cancel in 74 ms).

**Conclusion:** at the request level, no evidence-backed correction remains that is not already
measured. Five variants have been measured at this stage:

- "Step:" label: 8/10 on one part, 3 misreadings;
- action before the summary: 2/10;
- no task sentence: 2/10;
- corrective task sentence: 8/17 and 8/17;
- `ddcfc35b`: 9/17 and 7/17.

The five over-limit rules cap an answer in the line's order at 12/17 (71 %) per run, below 80 %. Prompt
experimentation stops here, as the task's stop condition requires.

### The fabricated-literal screen reads every quotation style (2026-09-23, `721077ab`)

A judge-only correction. The production prompt, model, limits, corrective actions and Flow Designer are
unchanged, so neither a real-model run nor L1.8 was needed.

**Reproduced on the captured text.** Run 2 of the corrective task sentence (capture
`2026-09-23T07-19-08-685Z-3d074e`, `casing`) gave "The operator casing is incorrect. Action: Correct the
operator casing to 'operator'." and "The configuration value is outside its permitted set. Action: Correct
the configuration value to 'true'.". Both were read `notActionable` with no screen hit, so neither was a
defect and neither would reach a person. Replayed verbatim against the unfixed judge, `verify:ai-authoring`
went 261/262, and every invented form in the table below failed.

**Root cause: two defects in `fabricatesLiteral`, not one.**

- `QUOTED` read double quotes and backticks only, so a single-quoted literal, straight or curly, was never
  examined. That is why `'true'` passed.
- A quoted literal counted as held when its letters occurred anywhere in the request (`includes`).
  "operator" is a word of the request, and "unsupported" occurs inside the rule codes, so `"operator"` and
  `` `operator` `` cleared the screen too. The earlier "double quotes only" diagnosis was incomplete:
  `operator` would have passed in any quotation style.
- The opposite error, found by the same controls: a backslash-escaped quote of the request's own words
  (`\"Loop Back\"`) was flagged as invented, because the backslash became part of the literal. No captured
  answer contains an escaped quote.

**The correction, in `fabricatesLiteral` only:**

- single quotes, straight and curly, open only after a non-letter and close only before one, so
  apostrophes ("step's", "steps'", "connector’s") stay prose;
- an escaped quotation mark reads as a plain one;
- a quoted literal is held only as a whole phrase of the request;
- a **value** is held only where the request gives that same target ("to a listed value", "to a Loop Back
  connector"). A value is a literal given as what something is changed or set to: quoted ("…to
  'operator'"), or an unquoted boolean, null or code-like name ("to true", "to notEquals").

**Controls** (`literalControlFailures`, one check in `verify:ai-authoring` §11):

| Must be `FABRICATED_LITERAL`, a defect | Must stay clear |
|---|---|
| the two captured answers, verbatim | the captured `'invalidTimeout'` and `'on the run path'` (`97996c48`) |
| the same, double-quoted, curly-quoted, back-quoted and escaped | an issue id and its rule code, single-quoted |
| unquoted: "to true", "to notEquals" | the given action's own target quoted as a value: "to 'a listed value'", "to “Loop Back”" |
| a name the request holds only inside a longer word ("Unsupported", "Supported") | escaped quotes around the request's own words; apostrophes, straight and curly |

**Mutations**, in two rounds, each reverted, each failing exactly its own checks:

- 259/262: single quotes dropped, substring support restored, escape normalization dropped, the re-read
  writing into the capture, the re-read's code guard dropped;
- 260/262: the value rule dropped, a capture's instructions always treated as retained.

**Re-evaluating the captures.** `verify:ai-authoring-review` now re-reads every captured explanation with
today's judge, in memory (`rereadCapture`):

- against the capture's own Issues lines, plus the instructions only when its hash is today's, since an
  earlier request's instructions are not retained;
- a case whose ids carry other codes today keeps its captured reading;
- the target is evaluated on today's reading, and each changed reading is listed. No capture file, model
  text or verdict is rewritten.

| | Unfixed judge | Fixed judge |
|---|---|---|
| Explanations re-read | 132 of 132 | 132 of 132 |
| Read differently from their capture | 12, all in earlier requests' captures, from the screens added at `ddcfc35b`: 6 `WRONG_REMEDY` and 3 no longer actionable (`97996c48`), 3 action-as-name (the "Step:" variant) | the same 12, **plus the reported 2** (the variant's run 2, `casing`): `notActionable` → `defect [FABRICATED_LITERAL]` |
| The current request, 4 captures | 9/17 and 7/17 actionable, 16 screen-clear, 0 screen hits | **unchanged** |

**Impact on the L4b measurements:** none on the current request. Criterion 3 stays at 9/17 and 7/17 (NOT
MET), criteria 1 and 4 stay PENDING on the same 16 screen-clear answers, and there are 0 screen hits. No
`ddcfc35b` answer quotes a value. The restored variant, which the target ignores, now has 2 screen hits in
its run 2, so under that request those two answers would have gone to a person.

**Still out of lexical reach, by design:** an unquoted plain word given as a value ("Correct the operator
casing to operator.") reads like prose ("change the casing to lowercase"), and screening it would reject
legitimate answers. A person's review (criteria 1 and 4) remains the check for it.

### Owner decision record: criterion 3 (prepared 2026-09-23; **option B adopted by the owner** the same day)

The thresholds, the proxy, the 192-token cap, the 160-character limit, the 120 s ceiling and the 125 s
deadline are unchanged in both options. Criteria 1 and 4, a person's review, stay exactly as they are in
both. The owner's confirmation of the 11 `97996c48` verdicts is separate.

| | **A. Keep criterion 3 as written** | **B. Measure the complete visible explanation** |
|---|---|---|
| What it measures | Whether the model's own text holds a correct corrective action, in ≥ 80 % of issues per complete run | Whether the explanation a person sees holds one: the model's text plus the product's corrective action shown beside it |
| Today's result | 9/17 and 7/17: **NOT MET** | 17/17 in every run, by construction: **MET** |
| L4b acceptance | Blocked on criterion 3 with the 0.8B. Reaching 80 % needs the action first on at least 2 of the 5 over-limit issues per run (measured: 1/10 and 2/10), or something outside L4b: another model (L1 go/no-go), a longer limit (fixed by L1.8), or shorter product texts for those rules | Rests on criteria 1 and 4: a person reads every screen-clear answer, and no unsupported claim is confirmed. Criterion 3 then tests the product's table, already proven without a model (§13) and on screen (`verify:ai-assist-gui`) |
| Quality reporting | The criterion stays a model-capability measure; L1's go/no-go reads "7–9/17 actionable in the model's text" | The model's own rate must still be reported beside it, labelled the model's, so the product's action is never credited to the model. The model's contribution is then the interpretation: on subject (criterion 2), grounded and correct (criteria 1 and 4) |
| Follow-on questions | None new | Whether criterion 4's "correct and actionable" judges the visible explanation too, and whether the model should still restate the action, which uses characters the explanation could have |
| Risk | L4b can stay open indefinitely on a model limit that users never see, since they always see the product's action | A model that adds nothing still passes criterion 3, so criteria 1, 2 and 4 carry the model-quality signal alone |

**The owner's decision (2026-09-23): option B.** The owner's requirements:

- the 80 % threshold is kept;
- the model's own corrective-action rate is reported independently, including 9/17 and 7/17;
- a deterministic corrective action is never credited to the model;
- a person still reviews correctness, actionability, grounding and unsupported claims;
- neither L4b nor L1 is accepted merely because the visible explanation holds an action;
- the model stays optional, and validation is unchanged when AI is unavailable.

**Its limit, recorded as the owner required:** option B shows that the product gives the person correct
corrective guidance. It does **not** show that the 0.8B can produce remediation on its own.

- At the current request, **0 of 34** answers carry a correction the model wrote itself.
- All 9 and 7 answers actionable in the model's own text repeat the product's action word for word.
- The other 18 carry no step.
- Model-specific quality is judged by criteria 1, 2 and 4 and by L1's go/no-go (L1 › "Still owed" item
  2, which reads "7–9/17 actionable in the model's own text"). L4 has no other model-specific
  acceptance.

### Criterion 3 as option B, implemented (2026-09-23, `289b9b71`)

The change is in the evaluator only (`evaluateQualityTarget`). The judge, the prompt, the model, the
limits, the corrective actions and the Flow Designer are unchanged.

- **What counts.** An issue counts when the explanation a person sees holds a corrective action. That is
  the product's action, attached to every accepted answer by `correctiveStep` and never taken from the
  model (`step`), or an actionable answer of the model's own. Three things never count:
  - an answer with a screen hit, because it puts other guidance beside the product's;
  - a misattributed answer, for the same reason;
  - an undelivered answer. It has no item, so its sent issues still count against the rate.
- **Reported beside it, never credited:** `actionable`, the model's own text by proxy as before, and
  `repeatsProductAction`, those of them that repeat the product's action word for word.
  `verify:ai-authoring-review` prints both on every run line and in criterion 3's detail.
- **Proven without a model:** `verify:ai-authoring` §12 is now 268/268, was 262.
  - With the product's action beside every answer, criterion 3 is MET while the model's own text reads
    0/17.
  - With a screen hit beside it, 4 of 17 fails and 3 of 17 meets. A misattribution beside it does not
    count.
  - An undelivered answer counts against the rate (13 of 17).
  - A word-for-word repetition is reported as one.
  - Criterion 3 MET leaves the target PENDING until a person reviews.
- **Mutations,** each run once and reverted, each failing exactly its own checks:
  - criterion 3 read on the model's text again: 266/268;
  - the screen-hit and misattribution exclusion dropped: 266/268.

`verify:ai-authoring-review` over the current request's captures now gives **TARGET: PENDING**, exit 1:

| Criterion | Status | Detail |
|---|---|---|
| (1) no confirmed claim, no misattribution | PENDING | 0 misattributed, 0 confirmed; 15 of 16 screen-clear answers unread |
| (2) ≥ 90 % on subject, every run | MET | 17/17, 17/17 |
| (3) ≥ 80 % with a corrective action a person sees, every run | **MET** | 17/17, 17/17. The model's own text, reported and not credited: 9/17 and 7/17, every one repeating the product's action |
| (4) a person reads every screen-clear answer, ≥ 80 % correct and actionable | PENDING | 16 screen-clear, 1 "reviewed" |
| (5) no order violation when the model ranks | MET | nothing ranked |
| (6) ≥ 2 runs | MET | 2 |

**The one verdict in the store is not a person's review.** Item
`2026-09-22T21-04-43-654Z-adbc14/casing/i0` carries `reviewer: "YOUR_LABEL"` and `note: "optional"`, the
documented example values, recorded at 2026-09-23T08:27Z. The evaluator counts it as reviewed, but it is
not an assessment. Recording a verdict on the same item replaces it. It was not edited here.

### What L4b acceptance still needs

- **Criterion 3:** MET under option B, 17/17 in each run. The model's own rate (9/17 and 7/17, 0/34
  written by the model) is reported beside it, never credited.
- **A person's review.** Two sets are unread:
  - the 11 screen-clear answers of `97996c48`. The owner's review found 6/11 correct and actionable. Its
    per-answer verdicts are proposed in the 2026-09-23 HANDOFF and await the owner's confirmation and
    recording. They count only for that earlier request, which is ignored by the evaluation;
  - the 16 screen-clear answers of the final request (criteria 1 and 4), including a real verdict to
    replace the placeholder above. Run `npm run verify:ai-authoring-review -- --pending`, then
    `-- --record` for each.
- The target is provisional; the owner may confirm it or change it.

Until the target is MET, L4b stays `in_progress`. Even then, a MET target does not by itself accept L4b
or declare L1 GO. Both remain the owner's, with the model's own rate on the record.

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
`-part1` 9/0 and `-part2` 8/0; since `97996c48` each part writes a redacted local review capture; since
`ddcfc35b` the capture holds the corrective action shown beside each answer),
`verify:ai-authoring-review` (the adopted target over captured runs and a person's verdicts: NOT MET at `97996c48`
and at `ddcfc35b`, criterion 3; since `289b9b71` criterion 3 reads the explanation a person sees (option B),
MET, and the target is PENDING on a person's review);
existing validation, legacy-compat and profile-store gates; `npm run build`.

## Acceptance

Validators remain the single source of truth; SafeFixApplier remains the only mutation authority; AI never adds a fix
kind; explanation quality target recorded and met before release. **Recorded** (adopted provisionally, 2026-09-22);
**not met**: PENDING.
- Criterion 3 is MET under the owner's option B, 17/17 in each run. The model's own text reaches 9/17 and
  7/17, reported and never credited.
- Criteria 1 and 4 await a person.
- Since `ddcfc35b` the corrective action a person sees is the product's, never model text.
