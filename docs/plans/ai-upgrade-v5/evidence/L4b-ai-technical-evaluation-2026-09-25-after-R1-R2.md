# L4b — AI-generated technical evaluation of every displayed answer after R1 and R2 (2026-09-25)

> **This is an AI-generated technical evaluation, not a human review.** It was written by the implementing
> agent (Claude Opus 5.5) under the owner's instruction of 2026-09-25: "Continue using AI-generated technical
> assessments as engineering evidence, without impersonating a human reviewer or entering automated verdicts
> under my identity." **Nothing here was written to `reviews.json`.** It does not count toward criterion 1
> or criterion 4 of the adopted quality target, both of which require a *person*.

## What changed before these runs (owner-authorized R1 and R2, 2026-09-25)

- **R1, the harness** (`d6ad5762`, plus the issue-id screen of this evaluation):
  - `SEVERITY_OVERSTATED` now reads a validation failure given to a non-blocking issue ("failed validation",
    "validation fails"), and "blocks the run" said of one.
  - `SEVERITY_UNDERSTATED` reads "does not block the run" said of a blocking error.
  - `FABRICATED_LITERAL` reads a step position the request never gives: an ordinal ("the first step"), a
    number ("step 2"), or, since this evaluation, an issue id given as a step ("at step i0").
  - Criterion 1 stays PENDING while any displayed answer that makes a causal claim is unread, not only
    screen hits and screen-clear answers.
  - Regression coverage: the seven answers of `L4b-ai-technical-evaluation-2026-09-25.md`, verbatim.
- **R2, the request** (`51987cca`):
  - The task sentence was "You explain why an automation flow failed validation…". It is now "You explain
    each issue that validation found in an automation flow, for the person editing it."
  - Each issue's line states "blocks the run" or "does not block the run", taken from `isExecutionBlocking`.
  - Nothing else in the request changed.
- **Unchanged:** thresholds, cases, privacy rules, limits, model pin (Qwen3.5-0.8B-Q4_K_M, sha256
  `f5b14da9…`) and autonomy policy.

## Scope and method

- **Captures:** the four of the new request, two complete runs.
  - Run 1: `2026-09-25T12-49-18-727Z-3bc349` (part 1) and `…12-53-27-612Z-f409c9` (part 2).
  - Run 2: `…12-58-39-077Z-6155eb` (part 1) and `…13-02-55-697Z-78eafe` (part 2).
  - All four parts passed live: 9/0, 8/0, 9/0 and 8/0.
- **Every displayed answer is read, 34 of 34.** This covers screen hits, screen-clear answers, causal
  claims and the optional rest. The Flow Designer shows all of them, labelled as AI interpretation beside
  the product's action.
- **The facts:** each case's flow in `scripts/ai-harness/authoringQualitySet.ts` and the validator's rules
  (`FLOW_VALIDATION_RULES`, `isExecutionBlocking`). `verify:ai-authoring` §11 audits the validator's report
  for each case.
- **The criteria (owner, L4 › decision 3):**
  - correct: true about this issue;
  - actionable: the explanation the person sees, with the product's corrective action beside it, tells
    them what to do;
  - grounded: every statement is supported by the evidence line;
  - unsupported claim: any fact, value, cause, location or step the evidence does not support.
- **Proxy:** today's judge on each item, as `verify:ai-authoring-review` re-reads it. "Causal" means a
  causal claim that needs a person under R1.

## The 34 assessments

A "yes" in the Actionable column counts the product's corrective action, which is shown beside every
answer. "(cut)" means the character limit cut the model's text and the product kept only its complete
sentences.

| # | Item | Issue | Answer shown (verbatim) | Proxy | Correct | Actionable | Grounded | Unsupported claim |
|---|---|---|---|---|---|---|---|---|
| 1 | `3bc349/casing/i0` | `unsupportedOperator`, blocks, fixable | "The operator is not a known operator. Action: Review and apply the offered safe fix, which corrects the operator's casing to a listed value." | screen-clear | yes | yes | yes | none |
| 2 | `3bc349/casing/i1` | `unsupportedConfiguration`, blocks, fixable | "A configuration literal is outside its permitted set. Action: Review and apply the offered safe fix, which corrects this setting's casing to a listed value." | screen-clear | yes | yes | yes | none |
| 3 | `3bc349/locator-orphan/i0` | `missingRequiredLocator`, blocks | "The step has no locator, and its type needs one. Action: Add a locator to this step so that it knows which element to act on." (cut) | screen-clear | yes | yes | yes | none |
| 4 | `3bc349/locator-orphan/i1` | `unreachableNode`, error off the run path, does not block | "Node cannot be reached from Start. Action: Connect this step from a step that runs, or delete it if it is not needed." (cut) | screen-clear | yes | yes | yes | none |
| 5 | `3bc349/branch/i0` | `incompleteBranchPair`, blocks | "The conditional connector is the only way out of the step, so the runner ignores the condition and runs the branch twice." (cut) | causal | **no** | yes | **no** | **yes**: the line gives the effects as alternatives ("ignores the condition *or* runs the branch twice", the second a parallel connector's); a conditional connector's branch does not run twice |
| 6 | `3bc349/branch/i1` | `incompleteCondition`, warning | "The condition needs a comparison value or a variable path that is not set. Action: Set the condition's comparison value, or the variable path it reads." | screen-clear | yes | yes | yes | none |
| 7 | `3bc349/cycle/i0` | `unguardedCycle`, blocks | "The connector that closes the cycle is not a Loop Back connector, so the flow stops at the end of the run path." (cut) | causal | **no** | yes | **no** | **yes**: following the cycle stops the run *with a runtime-cycle error*; "stops at the end of the run path" reads as a normal finish |
| 8 | `3bc349/cycle/i1` | `connectorFromEndNode`, warning | "The connector leaves an End node, so the flow finishes at End and never runs." (cut) | causal | **no** | yes | **no** | **yes**: the *connector* never runs; the flow runs and finishes at End |
| 9 | `3bc349/values/i0` | `missingRequiredValue`, blocks | "The step has no value, and its type needs one. Action: Set the value this step needs in its settings, or bind a value source to it." (cut) | screen-clear | yes | yes | yes | none |
| 10 | `3bc349/values/i1` | `incompleteValueSource`, warning | "A bound value source is missing the key it reads; it resolves to an empty value or fails the run." (cut: the action was trimmed away) | optional | yes | yes | yes | none (the rule summary, verbatim) |
| 11 | `f409c9/duplicate-timeout/i0` | `duplicateEdgeId`, blocks, fixable | "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id." (cut) | screen-clear | yes | yes | yes | none |
| 12 | `f409c9/duplicate-timeout/i1` | `highTimeout`, warning | "highTimeout (warning, does not block the run, on the run path, at a node) — Timeout is unusually high." (cut) | optional | yes | yes | yes | none (a copy of the raw line) |
| 13 | `f409c9/priority/i0` | `unsupportedOperator`, blocks, fixable | as #1 | screen-clear | yes | yes | yes | none |
| 14 | `f409c9/priority/i1` | `duplicateEdgeId`, off the run path, does not block, fixable | "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id." | screen-clear | yes | yes | yes | none |
| 15 | `f409c9/warnings/i0` | `highTimeout`, warning (warnings-only flow) | "The step has a high timeout that does not block the run, which is flagged as a warning on the run path at a node. This is a highTimeout issue." (cut) | optional | yes | yes | yes | none |
| 16 | `f409c9/warnings/i1` | `deadEndNode`, warning | "A reachable step has no way out; the run stops there and reports success without reaching End. This is a deadEndNode issue." (cut) | optional | yes | yes | yes | none |
| 17 | `f409c9/single/i0` | `invalidTimeout`, blocks | "The validation error indicates that the timeout value is zero, negative, or not a finite number, which causes the step to fail immediately." (cut) | causal | **no** | yes | **no** | **yes**: the issue blocks the run, so the step never runs; "fails immediately" is an invented consequence |
| 18 | `6155eb/casing/i0` | `unsupportedOperator`, blocks, fixable | "unsupportedOperator…" | optional | yes (a bare rule code) | yes | yes | none; explains nothing |
| 19 | `6155eb/casing/i1` | `unsupportedConfiguration`, blocks, fixable | "unsupportedConfiguration…" | optional | yes (a bare rule code) | yes | yes | none; explains nothing |
| 20 | `6155eb/locator-orphan/i0` | as #3 | as #3 (cut) | screen-clear | yes | yes | yes | none |
| 21 | `6155eb/locator-orphan/i1` | as #4 | as #4 (cut) | screen-clear | yes | yes | yes | none |
| 22 | `6155eb/branch/i0` | `incompleteBranchPair`, blocks | "The conditional connector is missing a matching branch or fallback connector from the same step, causing the runner to ignore the condition and run the branch…" (cut) | causal | yes, as displayed | yes | yes | none. "Conditional" narrows the line's "conditional or parallel" but is true of this connector; the cut hides whether "twice" followed |
| 23 | `6155eb/branch/i1` | `incompleteCondition`, warning | "The condition's comparison value or variable path is not set, which causes the condition to fail and not block the run…" (cut) | causal | **no** | yes | **no** | **yes**: "causes the condition to fail" is not in the evidence, which says only what is missing ("not block the run" is the line's own) |
| 24 | `6155eb/cycle/i0` | `unguardedCycle`, blocks | "The connector that closes the cycle is not a Loop Back connector, so the flow stops at the end of the run path. This causes a runtime-cycle error." (cut) | causal | **no** | yes | **no** | **yes**: as #7; the second sentence is right, so the answer contradicts itself |
| 25 | `6155eb/cycle/i1` | `connectorFromEndNode`, warning | "The connector leaves an End node, so the flow finishes at the End step and never runs." (cut) | causal | **no** | yes | **no** | **yes**: as #8 |
| 26 | `6155eb/values/i0` | as #9 | as #9 (cut) | screen-clear | yes | yes | yes | none |
| 27 | `6155eb/values/i1` | as #10 | as #10 (cut) | optional | yes | yes | yes | none |
| 28 | `78eafe/duplicate-timeout/i0` | as #11 | as #11 | screen-clear | yes | yes | yes | none |
| 29 | `78eafe/duplicate-timeout/i1` | `highTimeout`, warning | "Timeout is unusually high. Action: Lower this step's timeout unless the step really needs to wait that long." | screen-clear | yes | yes | yes | none |
| 30 | `78eafe/priority/i0` | as #13 | as #1 | screen-clear | yes | yes | yes | none |
| 31 | `78eafe/priority/i1` | as #14 | as #14 | screen-clear | yes | yes | yes | none |
| 32 | `78eafe/warnings/i0` | `highTimeout`, warning (warnings-only flow) | "The step has a high timeout that is not blocking the run, but the rule indicates it should be lowered unless the step truly needs to wait that long." | optional | yes | yes (its own text too) | yes | none. The proxy misses its action ("lowered" is not a base-form verb); it is not credited either way |
| 33 | `78eafe/warnings/i1` | `deadEndNode`, warning | "The step is a dead end node because a reachable step has no way out, causing the run to stop at that node and report success without reaching the End." | causal | yes | yes | yes | none. The causal clause is the rule's own summary; the wording is circular |
| 34 | `78eafe/single/i0` | `invalidTimeout`, blocks | "The validation found an issue in the automation flow at step i0. The rule code is 'invalidTimeout'." (cut) | screen hit (`FABRICATED_LITERAL`, since this evaluation) | **no** | yes | **no** | **yes**: "i0" is the issue's id, not a step; the answer says nothing about what is wrong |

## Result (AI assessment)

| Measure | Run 1 | Run 2 | Both |
|---|---|---|---|
| Correct | 13/17 | 13/17 | 26/34 |
| Actionable, with the product's action beside the answer | 17/17 | 17/17 | 34/34 |
| Grounded | 13/17 | 13/17 | 26/34 |
| Unsupported claim | **4/17** | **4/17** | **8/34** |
| Screen-clear answers correct and actionable | 8/8 | 8/8 | 16/16 |

### Where the 8 unsupported claims sit

- **All 8 are in a set a person must read** under R1: 7 are causal claims, and 1 is a screen hit (#34).
- **None is screen-clear, and none is optional.** R1's goal holds on fresh captures: no displayed
  unsupported claim escapes the target's reading requirement.
- #34 did escape at first. It makes no causal claim, and the position screen did not read an issue id as
  a step. It was added red-first: `verify:ai-authoring` 279/280, then 280/280.

### What R2 changed

- **Failed validation given to a non-blocking issue:** 0 of 34 answers, against 7 of 34 on the a84c7660
  request.
- **Answers opening with "failed validation":** 0 of 34.
- **The new task sentence was echoed once** (#34, "The validation found an issue…"). The echo is true now,
  but it is empty.
- **The blocking fact appears in 4 answers** (#12, #15, #23, #32), and all 4 state it correctly.

### What R2 did not change

- **The unsupported-claim rate is the same:** 7 of 34 before R2, 8 of 34 after. Only their kind changed.
- **5 of the 8 distort a rule summary's consequence clause:**
  - `incompleteBranchPair`: "or" becomes "and" (#5);
  - `unguardedCycle`: "stops the run with a runtime-cycle error" becomes "stops at the end of the run
    path" (#7, #24);
  - `connectorFromEndNode`: "the flow finishes at End, so it never runs" is read with the flow as "it"
    (#8, #25).
- **2 invent a consequence where the summary gives none:** `invalidTimeout` (#17) and
  `incompleteCondition` (#23).
- **1 invents a location** (#34).

### Against the adopted target (AI reading; the formal status is `verify:ai-authoring-review`'s)

| Criterion | Formal status | AI reading |
|---|---|---|
| 1. No confirmed unsupported claim | PENDING (26 answers await a person: 1 hit, 16 clear, 9 causal) | **would be NOT MET** once a person confirms any of the 8 |
| 2. On subject, ≥ 90 % per run | MET, 17/17 and 17/17 | agrees |
| 3. Corrective action seen, ≥ 80 % per run | MET, 17/17 and 16/17 | agrees |
| 4. A person reads the screen-clear, ≥ 80 % correct and actionable | PENDING (0 of 16 read by a person) | would be MET, 16/16 |
| 5. No order violation | MET (nothing ranked) | agrees |
| 6. ≥ 2 complete runs | MET | agrees |

**By this assessment, the model still fails the approved target on criterion 1.** 4 of 17 displayed answers
per run carry an unsupported consequence or location. Formally the target is PENDING until a person reads
the 26 required answers. No threshold, denominator or verdict was changed.

## The limitation

- **Prompt variants measured:** six versions of the request have been measured on the pinned
  Qwen3.5-0.8B since 2026-09-23:
  - the five of 2026-09-23: the "Step:" label, action first, no task sentence, the corrective task
    sentence, and `ddcfc35b`, whose instructions are the a84c7660 request;
  - R2.
- **The pattern across them:** each request change removes the defect it targets, and the model's own
  paraphrase then invents something else. About 4 answers per run of 17 carry an unsupported claim.
- **The request cannot prevent a paraphrase** of its own consequence clauses. The limitation is the model
  at this size, not the wording.
- **Performance is not the limit:**
  - L1.8 on the new request is GO: 62,383 ms at the output cap against 120,000, with 357 prompt tokens;
  - `verify:ai-explanation-live` passes 5/0.

## Proposed bounded remediation (each needs the owner; none was applied)

1. **R4, recommended: a deterministic display gate in the product.**
   - **What it does:** the Flow Designer withholds the AI text of an answer that makes a causal claim or
     names a step position. The same lexical rules are applied in product code, and the gate fails
     closed. The product's rule summary and corrective action stay beside the issue, exactly as now.
   - **Measured on these 34 captures, before any model run:**
     - it would withhold 10 answers: the 8 unsupported ones plus 2 correct restatements (#22, #33);
     - it would show 24, and by this assessment none of them carries an unsupported claim;
     - criterion 3 is unchanged, because the product's action is shown for every issue.
   - **What it does not touch:** no prompt, model, threshold or denominator.
   - **What it needs:**
     - a product decision on what the designer shows;
     - `verify:ai-authoring` controls;
     - a capture field that records a withheld text, so the target still counts it.
2. **R5: clarify three rule summaries' consequence clauses.**
   - The changes:
     - `connectorFromEndNode`: "so it never runs" becomes "so this connector never runs";
     - `incompleteBranchPair`: split the effect by connector kind;
     - `unguardedCycle`: make the error the subject.
   - **Evidence:** 5 of the 8 unsupported claims distort exactly these clauses.
   - **Cost:** it changes product text and the request, so it needs two fresh runs, an L1.8 re-measure and
     a person's review.
   - It is another request change, so it is only proposed here.
3. **R6: a larger model.** The Qwen3.5-2B pack is already an L1.8 candidate (`benchmark:ai-model-2b`).
   Measuring the labelled set on it would change the model pin, which is the owner's decision.
4. **R3, unchanged:** a person reads the 26 required answers (`npm run verify:ai-authoring-review --
   --pending`) and records verdicts under their own label.

## Status

- **L4b:** NOT ACCEPTED.
  - Target: **PENDING** (criteria 1 and 4 await a person).
  - AI reading: **NOT MET on criterion 1** (8 unsupported claims in 34 displayed answers).
- **R1 and R2:** implemented and measured, as authorized.
- **Unchanged:** the 80 % target, the cases, privacy, the inference limits, the model pin and the autonomy
  policy.
