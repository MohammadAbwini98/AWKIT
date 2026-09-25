# L4b acceptance — decision record (2026-09-25)

> **Engineering record by the implementing agent (Claude Opus 5.5), not a human review.** It consolidates
> the evidence already measured. Nothing here is a verdict, and nothing was written to `reviews.json`. The
> adopted target, its thresholds, cases and denominators are unchanged.

**Evidence base:**
- **The captures:** the four R2 captures (`3bc349`, `f409c9`, `6155eb`, `78eafe`), two complete runs of 17
  issues on the pinned Qwen3.5-0.8B (sha256 `f5b14da9…`), 34 displayed answers. They are replayed verbatim
  as `R2_DISPLAYED_ANSWERS`.
- **The AI evaluation:** `L4b-ai-technical-evaluation-2026-09-25-after-R1-R2.md`.
- **The R4 gate:** L4 › R4 (`a89a14bd`, `a1bcdd06`).
- **The target:** `verify:ai-authoring-review`.

## 1. Raw model-output quality (preserved; it does not change whatever is decided below)

| Measure | Run 1 | Run 2 |
|---|---|---|
| On subject by proxy, every answer counted | 17/17 | 17/17 |
| Corrective action in the model's own text (proxy) | 9/17 | 7/17 |
| Correct and grounded (AI evaluation, not a person) | 13/17 | 13/17 |
| Unsupported cause, consequence or location (AI evaluation) | **4/17** | **4/17** |

- **Six request versions** have been measured since 2026-09-23. Each removed the defect it targeted, and
  the model's own paraphrase invented another.
- **The limit is this model at this size,** not the wording. No further prompt iteration and no larger
  model without separate authorization.

## 2. What a person sees after R4

| For the 34 issues | Result |
|---|---|
| The validator's finding, its actual severity and the product's corrective action | 34/34 (deterministic) |
| AI text shown | 24/34 |
| …judged correct and grounded (AI evaluation, not a person) | 24/24 |
| …carrying an unsupported claim (AI evaluation) | 0/24 |
| AI text withheld, with a product sentence naming why | 10/34: all 8 unsupported, plus 2 correct restatements (#22, #33) |
| AI unavailable or off | no AI text; the deterministic findings and actions unchanged |

- **Criterion 3,** as computed and unchanged, reads 17/17 and 16/17.
- **The one issue it does not credit (run 2, #34):** it excludes any answer a screen hit, even though since
  R4 that one is withheld and the person sees only the product's action. That exclusion is conservative,
  and was left as it is.

## 3. The safety fallback: effectiveness and limits

- **On the 34 (the set it was designed against):**
  - it caught 8/8 of the unsupported answers;
  - it over-withheld 2 of the 26 correct ones (7.7 %).
  - This matched the prediction written before the gate existed.
- **Beyond the 34:** the held-out wording controls pass (`verify:ai-authoring` §14, 305/305).
  - They withhold unseen causes and consequences ("fails at once", "skips", "loop forever", "due to").
  - They show the product's own evidence when it is copied as its own sentence.
  - They leave severity to the existing screens.
- **Not measured:**
  - precision and recall on model output the gate has never seen;
  - a mutation run of §14, which the environment's permission classifier denied twice. It is BLOCKED,
    not passed. *Done later on 2026-09-25 without editing product source:* `verify:ai-display-gate-mutations`
    gave 38/0, 15 of 15 killed, after one survivor got a new control (L4 › R4). That measures the checks, not
    the gate's recall on unseen model output, which stays unmeasured.
- **Known limits** (L4 › R4, 9 listed):
  - a closed English vocabulary for consequences, and a list of connectives for causes;
  - wording outside them is shown ("prevents", "ends up empty");
  - correct paraphrases are withheld;
  - positions and values are checked against the whole request.
- **Independent review:** one read-only AI QC reviewer, which is not a person's sign-off.
  - First pass: PASS WITH FINDINGS. F1–F3 were fixed and F4–F6 recorded.
  - Second pass: two more evidence rules were fixed red first (a pronoun, and a framing colon or
    semicolon; `56d845b5`).
  - Re-check of those fixes: PASS.

## 4. Mandatory human review (unchanged, not satisfied)

- **Criterion 1:** a person must read 26 answers (1 screen hit, 16 screen-clear, 9 other causal claims).
  So far 0 have been read.
- **Criterion 4:** a person must judge the 16 screen-clear answers, at least 80 % correct and actionable.
  So far 0 have been judged.
- **The AI evaluation satisfies neither.** The agent records no verdicts and never records under the
  owner's identity.
- **Formal status:** `verify:ai-authoring-review` reads **TARGET NOT MET**, because criterion 2 counts no
  withheld answer (13/17 and 11/17). Criteria 1 and 4 are PENDING.

## The one decision needed from the owner

**Which measure accepts L4b?**

- **A. The adopted target, over the model's output (no change).**
  - L4b stays **NOT MET**.
  - It can only move with R5 (clarify three rule summaries: a request change, fresh runs and L1.8) or R6
    (a larger model: a pin change). Each needs separate authorization, and a person's review after it.
- **B. Add a delivered-experience measure for acceptance, with §1's raw result kept on record as NOT MET.**
  The measure:
  - every issue shows the validator's finding and corrective action (today 34/34);
  - no displayed AI text carries an unsupported claim;
  - the withheld rate is reported against a cap the owner sets (today 4/17 = 24 % and 6/17 = 35 %).

  Under B, the owner also states who establishes "no displayed AI text carries an unsupported claim":
  - a person reads the displayed AI texts (24 today); or
  - the owner accepts the AI evaluation for them. Only the owner can make that call.

**Recommendation: B, with a person reading the 24 displayed texts.**
- On the 34 it was designed against, R4 withheld all 8 unsupported answers, and the deterministic guidance is
  complete. R4 does not guarantee that every unsupported statement is detected (L4 › R4, limits 1–9). *Corrected
  2026-09-25: this line first said R4 "guarantees" it.*
- **Superseded for the decision itself by `L4b-owner-decision-proposal-2026-09-25.md`.** That file states B
  precisely as criteria DX-0 to DX-5: fresh unseen runs, a person's reading, and a 25 % withholding cap.
- The raw-model shortfall stays visible and tracked.
- Without an owner decision, L4b stays NOT MET, and L6 (blocked only by L4b) cannot close.
