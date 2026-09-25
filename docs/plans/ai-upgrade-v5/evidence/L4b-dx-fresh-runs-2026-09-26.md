# L4b DX: the fresh runs (2026-09-26)

> **Result: DX NOT MET.** DX-4 fails on labelled run 1: 5 of 17 issues had no displayed AI text, and the cap is
> 4 of 17 per run, never averaged. Under the owner's ruling (proposal §0), L4b stays open and no criterion is
> adjusted. DX-3 is PENDING: no person has read any of the 52 fresh texts. No verdict was recorded by anyone.

This file keeps the reading blind. It gives per-run counts and the gate's reason tallies, never which item the
gate withheld. The model's texts stay in the local review store, which `npm run verify:ai-authoring-dx-pending`
lists in item-id order.

## Identities (DX-0 MET on every capture and on the tree)

| Input | Value |
|---|---|
| Model pack | Qwen3.5-0.8B Q4_K_M, sha256 `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec` |
| Runtime | `node-llama-cpp@3.21.1+llama.cpp@v0.4.0` |
| Request instructions | sha256 `ab4b891fa050b9c0fbc85f6c04c93ff9b8effdc77167cbafbef0f7d35a9a3fa5` |
| DX-0 blobs | `AiModelManifest.ts` `a6f2472e`, `authoringClaimScreen.ts` `3c3204fa`, `authoringExplanation.ts` `c4376ccc`, `aiAssist.ts` `74180291`: unchanged since `335a0a7c` |
| Held-out corpus | sha256 `0db8a5814eee3e08a2a1fc3d8bcb72826af584e48ea8062fd4461ad716ac09d3`, committed at `cef94893` |
| Held-out selection | rule `f73fcd6b`, eligibility `7dc00699` (548 candidates, 24 eligible), seed `72fccdd8d871b8ce6aa7c30011e7de75b6824c238bd5d1506eafa51df6f2e042` |
| Evaluator at the runs | `authoringDx.ts` `ca0a6a99`, `authoringQualityReview.ts` `1350dc59`, `authoringQualityLive.ts` `8301d8c6`, `verify-ai-explanation-live.mts` `bfa72737`, `verify-ai-authoring-review.mts` `97d8885a` (tree `88f89850`, before the first run) |

The host is the owner's Windows development machine (i7-8750H, 4 inference threads), on the production path:
`explainFlowValidation`, the production `AiService` with the feature's 125 s deadline, and the real `ai-host.cjs`
in a utility process.

## The runs (the plan: two labelled runs and one held-out run, all taken, none beyond it)

The capture ids are UTC. The session's local date is 2026-09-26.

| Run | Parts (capture ids) | Issues sent | Delivered | Displayed | Withheld by the gate | Secret | Undelivered | Inference (min–max) |
|---|---|---|---|---|---|---|---|---|
| labelled 1 | `…23-04-37-401Z-863dfd`, `…23-09-49-917Z-0c02f6` | 17 (9 flows) | 9/9 | 12 | **5** | 0 | 0 | 59.8–84.0 s |
| held-out 1 | `…23-15-28-304Z-cf59cb`, `…23-21-21-926Z-85ce6d`, `…23-23-00-270Z-c91547` | 18 (11 flows) | 11/11 | 15 | 3 | 0 | 0 | 49.7–78.7 s |
| labelled 2 | `…23-30-14-063Z-c4d7d4`, `…23-35-34-390Z-b4f574` | 17 (9 flows) | 9/9 | 13 | 4 | 0 | 0 | 58.7–88.3 s |

- Every answer arrived within its deadline. None was refused or timed out, and there was no leak: no canary and
  no residual secret.
- Each part's harness checks passed: 9/0, 8/0, 9/0, 9/0, 5/0, 9/0 and 8/0.
- The gate's reasons:
  - Labelled, all 9 withheld texts: `UNESTABLISHED_CAUSE` + `UNESTABLISHED_CONSEQUENCE`.
  - Held-out: 2 texts `UNESTABLISHED_CONSEQUENCE`, and 1 `FABRICATED_LITERAL`.

## DX, criterion by criterion (`npm run verify:ai-authoring-dx`, exit 1)

| Criterion | Status | Detail |
|---|---|---|
| DX-0 frozen inputs | MET | 7 fresh captures, all on DX-0, and the working tree matches |
| DX-1 deterministic guidance | holds on its own gates | `verify:ai-authoring` §14 (363/363 today) and `verify:ai-assist-gui` 185/0 on the `62aab2dc` build. No product source has changed since. |
| DX-2 fresh evidence | MET | 2 complete labelled runs and 1 complete held-out run, none incomplete |
| DX-3 read and correct | **PENDING** | 0 of 52 texts read by a person (40 displayed, 12 withheld) |
| DX-4 at most 1 in 4 undisplayed, per run | **NOT MET** | labelled 1: 5/17 (over the cap). labelled 2: 4/17. held-out: 3/18. |
| DX-5 raw result visible | MET | model's own on subject: 17/17, 17/17, 8/18. Own actionable: 8/17, 10/17, 6/18. |

**Overall: NOT MET** (DX-4). The adopted target (§1 of the proposal) stays NOT MET too.

## Root cause of DX-4

- **Mechanism.** The gate withholds a text that states a cause or a run-time consequence the product's evidence
  does not. On the labelled set the 0.8B does this for 4 to 6 issues in 17. Across the four labelled runs taken
  with the final request and gate, the counts are:
  - 4 and 6 in the two design runs of 2026-09-25;
  - 5 and 4 in today's fresh runs.

  The 25 % cap allows 4. So the model's rate sits on the cap, and whether a run passes depends on run-to-run
  variation.
- **Not a product defect.** The gate did what R4 specifies: it fails closed, and every withholding names its
  reason. Whether each withheld text was really unsupported, or a correct paraphrase withheld too, is the
  false-withholding rate. Only a person's reading measures it (DX-3/DX-4 reporting).
- **Legitimate remedies.** Each changes a DX-0 input, so each voids these runs and needs the owner's own
  authorization, a new held-out set and fresh runs:
  - R5: clarify the rule summaries (the request);
  - R6: a larger model (a pin change; the 2B needs a download the owner must authorize);
  - relaxing R4: this reverses the owner's fail-closed decision.

  The owner's stop rule (2026-09-25) and the brief both forbid changing the model, request or gate merely to
  pass. None was changed.

## Held-out observations (reported, not judged)

- **The proxy judge covers only 8 of the 18 held-out issues.** Three of the held-out codes are ones the
  labelled set never sends: `missingFlowReference` (6 issues), `connectorStructure` (3) and `invalidLoopBounds`
  (1). The judge's `SUBJECT` table has no rule for them, so it reads every text on them as off subject.
  - The held-out DX-5 figure of 8/18 is therefore 8 of 8 on the codes the judge covers, and 0 of 10 not
    judgeable.
  - No rule was added after seeing the outputs: that would change the rubric.
- A person reads those 10 texts under DX-3 like the rest. They are displayed unless withheld.

## What would close L4b

- The owner decides a remedy (R5, R6, or another) in their own words.
- A new held-out set is committed, and a fresh three-run plan is taken on the new DX-0.
- Every run is within the cap, and a person reads every fresh text with no confirmed escape and at least 80 %
  correct and actionable.
- These runs, whatever a reading of them shows, cannot close L4b: labelled run 1 is over the cap.
