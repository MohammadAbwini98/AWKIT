# L4b — AI-generated technical evaluation of the 15 unreviewed answers (2026-09-25)

> **This is an AI-generated technical evaluation, not a human review.** It was written by the implementing
> agent (Claude Opus 5.5) at the owner's request of 2026-09-25 ("perform the technical evaluation
> autonomously… do not impersonate a human reviewer, use my reviewer label `MA`, or record AI-generated
> judgments as human verdicts"). **Nothing here was written to `reviews.json`.** It does not count toward
> criterion 1 or criterion 4 of the adopted quality target, both of which require a *person*
> (`QUALITY_TARGET`, `scripts/ai-harness/authoringQualityReview.ts`; L4 › "Explanation quality target").

## Scope and method

- **Store:** `%LOCALAPPDATA%/SpecterStudio/ai-quality-review/authoring`. The current request is
  `instructionsSha256` `a84c7660…`, the hash of today's `INSTRUCTIONS` in `src/ai/authoringExplanation.ts`
  (confirmed by `npm run verify:ai-authoring-review`: "4 of the current request"). The four captures are
  `adbc14` and `f36c94` (part 1, runs 1 and 2) and `992ea9` and `840178` (part 2, runs 1 and 2). No
  current capture reads differently under today's judge.
- **The 15:** the 16 screen-clear answers (`judged.category === "unverified"`) minus
  `…adbc14/casing/i0`, which the owner reviewed as `MA` on 2026-09-23. This set was derived by hand from
  the capture files with the evaluator's own rule, and it matches the evaluator's count ("15 of 16 screen-clear").
- **The facts behind each verdict:** each case's flow in `scripts/ai-harness/authoringQualitySet.ts`. The
  real validator's report for each labelled case is audited by `verify:ai-authoring` §11: codes, fixability
  and blocking as labelled, **272/272 at `8739247c` on 2026-09-25**. Each product action was read from
  `correctiveStep` (`src/ai/authoringExplanation.ts`), and blocking from `isExecutionBlocking`
  (`src/validation/FlowValidator.ts`: an error on the run path).
- **The criteria, as the owner defined them (L4 › decision 3):**
  - correct: true about this issue;
  - actionable: the explanation the person sees, with the product's corrective action shown beside it,
    tells them what to do;
  - grounded: every statement is supported by the evidence line;
  - unsupported claim: any fact, value, cause, location or step the evidence does not support.

## The 15 assessments

In every case below, the product's corrective action shown beside the answer is exactly the "Action:"
part of its evidence line.

| # | Item | Issue (validator) | AI answer shown to the person (verbatim) | Validator fact checked | Correct | Actionable | Grounded | Unsupported claim |
|---|---|---|---|---|---|---|---|---|
| 1 | `2026-09-22T21-04-43-654Z-adbc14/casing/i1` | `unsupportedConfiguration`: error, run path, connector, fixable (`normalizeEnumCasing`) | "A configuration literal is outside its permitted set. Action: Review and apply the offered safe fix, which corrects this setting's casing to a listed value." | connector `e4` has `sourceField: "Outcome"`, which is outside the listed values by casing | yes | yes | yes | none |
| 2 | `…adbc14/locator-orphan/i0` | `missingRequiredLocator`: error, run path, node | "The step has no locator, and its type needs one. Action: Add a locator to this step so that it knows which element to act on. Rule: missingRequiredLocator." | step `a` is a `click` with no locator, on Start→a→b→End | yes | yes | yes | none |
| 3 | `…adbc14/locator-orphan/i1` | `unreachableNode`: error, off the run path, node, not blocking | "Node cannot be reached from Start. Action: Connect this step from a step that runs, or delete it if it is not needed. Rule: unreachableNode." | step `x` has no incoming connector | yes | yes | yes | none |
| 4 | `…adbc14/branch/i0` | `incompleteBranchPair`: error, run path, connector | "Add the matching branch or a fallback connector from the same step, or change this connector to a standard one." | the conditional `e2` is `a`'s only way out | yes | yes | yes | none |
| 5 | `…adbc14/branch/i1` | `incompleteCondition`: warning, run path, connector | "Set the condition's comparison value, or the variable path it reads." | `e2` compares `equals` against `""` | yes | yes | yes | none |
| 6 | `…adbc14/values/i0` | `missingRequiredValue`: error, run path, node | "The step has no value, and its type needs one. Action: Set the value this step needs in its settings, or bind a value source to it." | fill step `a` has no value and no value source | yes | yes | yes | none |
| 7 | `2026-09-22T21-16-39-589Z-992ea9/duplicate-timeout/i0` | `duplicateEdgeId`: error, run path, connector, fixable (`regenerateId`) | "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id." | two connectors carry id `e1` | yes | yes | yes | none |
| 8 | `…992ea9/duplicate-timeout/i1` | `highTimeout`: warning, run path, node | "Timeout is unusually high. Action: Lower this step's timeout unless the step really needs to wait that long." | step `b` has `timeoutMs` 3,600,000 | yes | yes | yes | none |
| 9 | `2026-09-22T21-27-55-308Z-f36c94/locator-orphan/i0` | as #2 | "The step has no locator, and its type needs one. Action: Add a locator to this step so that it knows which element to act on." | as #2 | yes | yes | yes | none |
| 10 | `…f36c94/locator-orphan/i1` | as #3 | "Node cannot be reached from Start. Action: Connect this step from a step that runs, or delete it if it is not needed." | as #3 | yes | yes | yes | none |
| 11 | `…f36c94/values/i0` | as #6 | "The step has no value, and its type needs one. Action: Set the value this step needs in its settings, or bind a value source to it." | as #6 | yes | yes | yes | none |
| 12 | `2026-09-22T21-32-39-054Z-840178/duplicate-timeout/i0` | as #7 | "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id." | as #7 | yes | yes | yes | none |
| 13 | `…840178/duplicate-timeout/i1` | as #8 | "highTimeout (warning, on the run path, at a node) — Timeout is unusually high. Action: Lower this step's timeout unless the step really needs to wait that long." | as #8 | yes | yes | yes | none |
| 14 | `…840178/priority/i0` | `unsupportedOperator`: error, run path, connector, fixable (`normalizeEnumCasing`) | "The operator is not a known operator. Action: Review and apply the offered safe fix, which corrects the operator's casing to a listed value." | conditional `e2` has operator `NotEquals` | yes | yes | yes | none |
| 15 | `…840178/priority/i1` | `duplicateEdgeId`: error, OFF the run path, connector, fixable, not blocking | "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id." | two off-path connectors carry id `d1`; the answer does not claim it blocks | yes | yes | yes | none |

**Result, AI assessment:** 15 of 15 correct and actionable, 15 of 15 grounded, 0 unsupported claims.
With the owner's one verdict (`…adbc14/casing/i0`, correct and actionable), that would be 16 of 16
(100 %) against the 80 % threshold. **This is not criterion 4's result.** Criterion 4 counts a person's
verdicts only, so it stays at **1 of 16 reviewed, PENDING**.

**Observations that are not failures under the four criteria:**
- All 15 are near-verbatim restatements of the product's own evidence line. The rule summary and the
  product action are copied, in the order the line gives them.
- #4 and #5 contain no explanation of what is wrong, only the product's action.
- #13 echoes the raw request line, including the rule code and the "(warning, on the run path, at a
  node)" metadata. #2 and #3 append "Rule: <code>".
- The value these answers add beyond the product's own text is small. That matches the model's own
  actionable rate, which is reported and never credited: 9 of 17 and 7 of 17, every one repeating the
  product's action.

## A finding outside the 15: the answers no person is asked to read

The target requires a person to read the screen-clear answers (and screen hits). The other 18 answers of
the current request are `notActionable` by proxy. `--pending` lists them as *optional*, but **the
Flow Designer still shows them to the user**, labelled as AI interpretation beside the product's action.
Read under the same four criteria, **7 of those 18 carry a claim the evidence does not support**:

| Run | Item | Issue | Claim not supported by the evidence |
|---|---|---|---|
| 1 | `…adbc14/cycle/i1` | `connectorFromEndNode` (warning) | "The automation flow failed validation because a connector leaves an End node, causing the flow to finish at End and never run." The failure is the cycle error's, not this warning's, and the rule says the *connector* never runs, not the flow. |
| 1 | `…992ea9/warnings/i0` | `highTimeout` (warning; a warnings-only flow) | "…failed validation because the timeout for the first step was set to an unusually high value, causing the flow to fail validation before the…" Nothing in this flow fails validation, and "the first step" is an invented location: it is step `b`, and the request gives no position. |
| 1 | `…992ea9/warnings/i1` | `deadEndNode` (warning; warnings-only) | "The automation flow failed validation because a reachable step had no way out…". Nothing in this flow fails validation. |
| 2 | `…f36c94/branch/i1` | `incompleteCondition` (warning) | "…failed validation because the condition needs a comparison value…, causing the runner to fail validation…". It attributes the failure to a warning. |
| 2 | `…f36c94/cycle/i1` | `connectorFromEndNode` (warning) | the same misattribution as `adbc14/cycle/i1` ("…so the flow finishes at End and never runs") |
| 2 | `…840178/warnings/i0` | `highTimeout` (warning; warnings-only) | the same as `992ea9/warnings/i0`, "the first step" included |
| 2 | `…840178/warnings/i1` | `deadEndNode` (warning; warnings-only) | the same as `992ea9/warnings/i1` |

**Why the proxy did not flag them (an evaluation-harness gap).** `SEVERITY_OVERSTATED` (`BLOCKS_RUN` in
`authoringQualitySet.ts`) matches phrasings such as "the flow cannot run" and "before it can start". It does
not match "failed validation because <a warning>". `FABRICATED_LITERAL` matches quoted names, values,
numbers of 3 or more, and selectors, but not an ordinal position such as "the first step". Because
optional answers need no person, criterion 1 ("no confirmed unsupported claim of any kind") cannot see
these claims.

**Effect, computed by hand from the captures (nothing was changed):**
- Suppose the screen treated "failed validation" attributed to a non-blocking issue as severity
  overstated, which is its documented intent. These 7 answers would become screen hits, and a screen hit
  "does not count" toward criterion 3. Criterion 3 would then read run 1 **14/17 (82 %, MET)** and run 2
  **13/17 (76 %, NOT MET)**.
- Criterion 1 would also stay PENDING until a person read the 7 answers, and NOT MET if a person
  confirmed any of them.
- On the current captures, then, the target would be **NOT MET** whatever the 15 human verdicts say.

**Classification:**
- **Model-quality limitation (primary).** The 0.8B echoes the request's task sentence as a cause,
  applies it to warnings, and invents a position.
- **Product contributor.** The request itself begins "You explain why an automation flow failed
  validation". That presupposition is false for a warnings-only report, such as the `warnings` case, and
  for any warning beside an error. The `INSTRUCTIONS` comment already records that the model echoes this
  sentence (2026-09-23).
- **Evaluation-harness gap.** The screen blind spot above, and optional review of answers that are shown
  to users.

No product behaviour is wrong in the deterministic sense. The validator, the safe fixes and the product's
corrective action are all correct in every one of the 34 answers.

## Remediation (recommended; each changes an owner-adopted artifact, so none was applied)

1. **Harness (R1).** Extend `SEVERITY_OVERSTATED` to a non-blocking issue described as failing
   validation, and `FABRICATED_LITERAL` to an ordinal step position the request never gave. Prove both
   red-first against these 7 captures, and require a person to read every displayed answer that makes a
   causal claim, not only screen-clear ones. **Effect:** the target reads NOT MET on criterion 3 (run 2)
   at today's captures. It is stricter and truthful, and it changes the result of an owner-adopted target,
   so it needs the owner's go-ahead.
2. **Product request (R2).** Replace the presupposing task sentence ("why an automation flow failed
   validation") with one that holds for warnings. This is a prompt change, so it needs:
   - owner authorization;
   - two fresh complete live runs (`verify:ai-authoring-quality-live-part1` and `-part2`, each twice);
   - an L1.8 re-benchmark of the explanation scenario, whose fingerprint would change;
   - a person's review of the new captures.
   It is not uncontrolled iteration: one sentence, one defect.
3. **Acceptance (R3).** Criterion 4 requires a person, so this AI evaluation cannot close it. There are
   two ways forward: the owner records their own verdicts, or the owner explicitly amends the acceptance
   contract. Amending it to accept an AI evaluation is **not recommended**. The screens can only prove an
   answer wrong, never right, so a person is the only check of correctness the target has.

## Status

- **L4b:** NOT ACCEPTED, and still blocked on a person's review (criteria 1 and 4 PENDING, 1 of 16 read).
- **Beyond the review:** the 7 unsupported claims above mean the target is unlikely to be MET on the
  current captures without R1 and R2.
- **Unchanged:** no threshold, denominator, judge, prompt, capture or verdict was changed.
