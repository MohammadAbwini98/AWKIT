# L4b DX revision 2 (R5): the fresh runs (2026-09-26)

> **Result: DX NOT MET.**
> - DX-4 fails in both labelled runs: 5/17 and 6/17 undisplayed, against a cap of 4.
> - DX-3 fails its 80 %: 22 of 39 displayed texts are correct and actionable (56 %), with 0 displayed escapes.
>
> R5 is a genuine fresh acceptance failure. Under the owner's decision (`docs/ai/DECISIONS.md`, 2026-09-26 (latest,
> final)), R6 follows on Qwen3.5-2B, after it qualifies under L1.8. L4b stays open.

The decision record and revision 2's frozen identities are in `L4b-owner-decision-proposal-2026-09-25.md`
("Revision 2"). The model's texts stay in the local review store. This file gives counts, reasons and patterns
by issue type, never a model text.

## Identities (DX-0 MET on every capture and on the tree)

| Input | Value |
|---|---|
| Model pack | Qwen3.5-0.8B Q4_K_M, sha256 `f5b14da9…93bfec` (unchanged) |
| Runtime | `node-llama-cpp@3.21.1+llama.cpp@v0.4.0` (unchanged) |
| Request (R5) | instructions sha256 `abea5095fad32abbf71f58f1dd2aac5cdca76221e0d493a92bd21c3389de310c` |
| Display gate (R4) | `authoringClaimScreen.ts` `b8142e0b`: the one proven false positive fixed |
| Held-out corpus | `0db8a581…`, confirmed by the owner, unchanged |
| Frozen at | `dc3d0c18` (code) and `193d2028` (record), pushed before the first run |
| Evaluator | as recorded in the proposal's revision 2 table; DX-3 automated (`dx3Reading`) |

L1.8 before the runs, for the changed request: `benchmark:ai-model-0-8b` GO on all 8 (`02e50da6`). The validation
explanation at the output cap takes 104,276 ms against 120,000 ms; it was 83,345 ms before R5.

## The runs (the plan: two labelled runs and one held-out run, all taken, none beyond it)

| Run | Capture ids (UTC) | Issues | Displayed | Withheld by the gate | Secret | Undelivered | Inference (min–max) |
|---|---|---|---|---|---|---|---|
| labelled 1 | `…11-08-10-108Z-c4213d`, `…11-14-06-367Z-dccab8` | 17 | 12 | **5** | 0 | 0 | 57.9–107.2 s |
| held-out 1 | `…11-21-21-243Z-001e51`, `…11-27-58-400Z-d0341b`, `…11-29-47-498Z-05d71b` | 18 | 16 | 2 | 0 | 0 | 55.1–115.1 s |
| labelled 2 | `…11-37-09-302Z-1dfc55`, `…11-43-06-853Z-ed1e9d` | 17 | 11 | **6** | 0 | 0 | 62.3–102.9 s |

- Every answer arrived inside the 125 s deadline, and none was refused. The slowest was 115 s (held-out), 10 s
  inside it.
- There was no leak: no canary and no residual secret.
- The harness parts passed 9/0, 8/0, 9/0, 9/0, 5/0, 9/0 and 8/0.

## DX, criterion by criterion (`npm run verify:ai-authoring-dx`, exit 1)

| Criterion | Status | Detail |
|---|---|---|
| DX-0 frozen inputs | MET | 7 fresh captures, all on revision 2. The 7 revision-1 captures are kept on the record and not counted. |
| DX-1 deterministic guidance | holds on its own gates | `verify:ai-authoring` §14 (382/382). `verify:ai-assist-gui` is re-run on the final build (see the task's verification list). |
| DX-2 fresh evidence | MET | 2 complete labelled runs and 1 complete held-out run |
| DX-3 automated review | **NOT MET** | 52 texts read, 39 displayed and 13 withheld. **0 displayed with a defect.** 22 of 39 displayed correct and actionable (56 %, the bar is 80 %). No text lacked a judge rule. |
| DX-4 at most 1 in 4 undisplayed, per run | **NOT MET** | labelled 1: 5/17. labelled 2: 6/17. held-out: 2/18. |
| DX-5 raw result visible | MET | Own on subject: 17/17, 17/17 and 18/18. Own actionable: 7/17, 6/17 and 11/18. |

- **False withholding** (withheld but read correct by DX-3, over all read correct), reported and not capped: 3/15,
  4/15 and 2/18.
- Several of those DX-3 reads as correct only lexically. It is the limit recorded with its calibration: supported
  words related wrongly, such as a consequence moved onto "the flow".
- **The adopted quality target** stays NOT MET.

## Root cause

### DX-4: the model re-casts consequence clauses around "the flow" as subject

11 of the 13 withheld texts do this, on the rules whose summary carries a consequence. The same pattern repeats in
both labelled runs:

| Issue type | What the model does |
|---|---|
| Conditional-branch pair (branch case) | Moves "runs twice" from the branch onto the flow, and gives it a cause. |
| Unguarded cycle | Makes the flow's running the cause of the cycle error. |
| Connector leaving End | Drops the summary's first clause and rewrites the second ("finishes at an End node"). The gate cannot match that against the evidence. |
| Dead end (labelled) | Adds an outcome ("early") or re-states the stop with a new cause. |
| Invalid timeout | Invents an immediate failure of the step, in both runs. |
| High timeout (run 2) | Invents an error the user sees. |

The two held-out withholdings are the Issues line's own dead-end summary. The 160-character limit cut it
mid-word, so it is no longer a verbatim copy.

**What this means.** R5 told the model to use the summary's words, and it did so for the rules whose summary has no
consequence clause. Where the summary has one, the 0.8B still rewrites it. That is the 2026-09-25 finding again:
each request change removes the defect it targets, and this model's own paraphrase makes another.

### DX-3: displayed texts often carry no action

17 of 39 displayed texts carry no action, in four ways:
- the summary alone;
- the Issues line's metadata echoed as prose ("on the run path at a connector");
- a bare rule code;
- for `connectorStructure`, a paraphrase of the placeholder summary, since that rule's summary names no defect.

The 0.8B follows "first its action as given" for about half the issues.

### What held

- 0 displayed escapes in 39.
- The gate withheld every text that DX-3 reads as inventing a cause or consequence (4 of the 13).
- The held-out set, including the three codes that are new since revision 1, stayed within the cap at 2/18.

## What follows (the owner's decision, no new one needed)

- **R6 on Qwen3.5-2B.** The owner downloads `Qwen3.5-2B-Q4_K_M.gguf` (lmstudio-community, 1,270,808,032 bytes) to
  `~/Downloads`.
- The agent verifies its SHA-256 against the published identity in `scripts/benchmark-ai-model.mts`. It then runs
  `npm run benchmark:ai-model-2b`, the existing L1.8 qualification.
- The 2B is pinned, and the full protocol re-run as revision 3, only if it meets the 125 s explanation deadline and
  the runtime requirements. The held-out set and the evaluator stay the same.
- If it fails qualification, no L4b run is taken on it, and there is no fallback to the 4B. L4b stays open with the
  measured blocker.
- **At this record:** the 2B is not in `~/Downloads`, so R6 is **BLOCKED on the owner's download**.
