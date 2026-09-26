# L4b acceptance: owner decision proposal (2026-09-25)

> **Prepared by the implementing agent (Claude Opus 5.5). The owner decided on 2026-09-25: option B (§0).** Nothing
> was written to `reviews.json`. The adopted target, its thresholds, cases and denominators are unchanged. L4b is
> not closed. The evidence is in `L4b-decision-record-2026-09-25.md`.

## 0. The owner's decision (2026-09-25) and the DX-0 freeze

**Decision:** `L4b: B, cap 25 %, held-out yes, reader owner`.

- **Measure:** DX-0 to DX-5 (§5) accept L4b. §1 stays on the record as **NOT MET**, permanently. Withheld text is
  never counted as model output.
- **Cap:** at most 25 % of issues withheld **in each** fresh complete run (at most 4 of 17), never averaged.
- **Held-out set: required.** The owner made the recommended set mandatory.
  - At least 17 issues, in flows outside the labelled set.
  - Selected by someone other than the implementing agent.
  - Committed with its hash **after** this freeze and **before** the first fresh run.
- **Reader (DX-3): the owner**, under their own label.
  - The agent prepares the reading packet and analyses the results afterwards. It records no verdict.
  - No AI agent's label (Claude, ChatGPT, Codex, Gemini or any other) counts as the reader.
- **The old reading (§4).** The adopted target's pending readings (criteria 1 and 4: 26 answers, 16 of them for
  criterion 4) are superseded as closure conditions.
  - They are **not waived as passed.** They stay on the record as historical PENDING: not executed, not passed.
  - The target is NOT MET on criterion 2 whatever they would show.
  - Under DX, the owner reads every fresh DX-3 text instead: every displayed text, and every withheld one to
    measure the gate (never credited).
- **What the decision does not do.** It authorizes the acceptance procedure, not a closure.
  - L4b closes only if DX-1 to DX-5 all hold on the frozen fresh and held-out evidence and the owner's reading.
  - L4b stays open, and no criterion is adjusted, if any of these happens:
    - a fresh run withholds more than 4 of 17;
    - a displayed text has a confirmed unsupported claim;
    - fewer than 80 % of displayed texts are judged correct and actionable.
  - L6 closes only by its own documented dependency on an accepted L4b.

**DX-0, frozen at the commit that records this decision.** Change any of these, and the fresh runs taken after it
are void.

| Input | Frozen value |
|---|---|
| Model pack | Qwen3.5-0.8B Q4_K_M, 527,502,816 bytes, sha256 `f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec`. The live harness refuses any other file. Its captures carry the label `Qwen3.5-0.8B-unpinned`, which is the harness's own name for these same bytes. |
| Runtime | `AI_RUNTIME_PIN.build` `node-llama-cpp@3.21.1+llama.cpp@v0.4.0` (`src/offline/AiModelManifest.ts`, blob `a6f2472e72b589fb37aa1ba543d588830972d1b2`) |
| Request | instructions sha256 `ab4b891fa050b9c0fbc85f6c04c93ff9b8effdc77167cbafbef0f7d35a9a3fa5`, printed by `verify:ai-authoring-review` as "current request" |
| Display gate (R4), the three files the R4 mutation run covers | `src/ai/authoringClaimScreen.ts` blob `3c3204fa350cb922e7b092705ede63f12ddf42a3`; `src/ai/authoringExplanation.ts` (request builder and parser) blob `c4376cccfb79106bc5a88a577d4bf32364612c56`; `app/main/ai/aiAssist.ts` (adapter) blob `74180291114b7eecc9718b8d2761f4dc90665e2b` |
| Evaluation rules | DX-1 to DX-5 as written in §5, with the 25 % cap per run, and this section's rulings. The adopted target's evaluation (§1) is unchanged. |

- Blob ids are `git ls-files -s <path>`. Check any of them with `git hash-object <path>`.
- The DX evaluation code (§6 B, work item 1) is written to these rules before any fresh run, and its source
  identity is added here before the first run. Writing it changes no rule.

**The DX evaluator (2026-09-26, before any fresh run). Nothing below changes a DX-0 input.**

| File | Role | Blob |
|---|---|---|
| `scripts/ai-harness/authoringDx.ts` | DX-0 constants, the evaluator (DX-0, DX-2 to DX-5), the held-out format and structural check | `b6f17b98acdb3115283cfbe1bbfc8763a1cd920a` |
| `scripts/ai-harness/authoringQualityReview.ts` | captures carry `inputs`; verdicts carry `misattributed` | `2b7d8ff2aefe9aacc8fc6b4c79e66c568891c70a` |
| `scripts/ai-harness/authoringQualityLive.ts` | the harness runs the held-out set and records `inputs` | `8301d8c64fb980c7e093f7b1f3aad92f8c1703a8` |
| `scripts/verify-ai-explanation-live.mts` | the launcher: it measures `inputs`, adds `--held-out --part k`, and refuses any fresh authoring run until the held-out set is committed | `bfa72737656b622c3cce96a94973676c01c47fb0` |
| `scripts/verify-ai-authoring-review.mts` | the CLI: `--dx`, `--dx --pending`, `--held-out`, `--record … --misattributed` | `97d8885a3b81d0664ec7e1a7f05b54f6203c9342` |
| `scripts/verify-ai-authoring.mts` (§15) | its checks, without a model: 57 of 362 | `82b0a4e15b66e3a52da993b253a4afe806f444a9` |
| `scripts/verify-ai-display-gate-mutations.mts` (`--dx`) | its mutation run: 25 mutants | `9a7577ca5fb5dc7f3924881e58e3650ddb0973f2` |

- **Commands:**
  - `npm run verify:ai-authoring-dx` evaluates DX. It exits 0 MET, 1 NOT MET, 2 PENDING.
  - `npm run verify:ai-authoring-dx-pending` prints the reading packet.
  - `npm run verify:ai-authoring-held-out` runs the structural check and writes the inventory once.
  - `npm run verify:ai-authoring-held-out-live-part1` to `-part4` run the held-out set, five flows per part.
- **DX-1 is not computed by the evaluator.** It rests on `verify:ai-authoring` §14 and `verify:ai-assist-gui` on
  the accepted build.
- **Proof, without a model, on 2026-09-26:**
  - `verify:ai-authoring` 362/362;
  - `verify:ai-dx-mutations` 54/0, 25 of 25 mutants killed, with the control at 362/362;
  - `verify:ai-display-gate-mutations` 38/0, 15 of 15 killed.
- **DX-0 on the working tree:** MET. `verify:ai-authoring-dx` reads the four blobs, the request hash `ab4b891f…` and
  `AI_RUNTIME_PIN.build` from the tree, and all equal the table above. It reports PENDING, with no fresh capture
  and no held-out set yet.

**How the evaluator reads the rules.** Each reading below was fixed before any fresh output exists, so the owner can
overrule any of them now, and no later.

1. **DX-4 counts every issue without a displayed AI text:**
   - withheld by the gate;
   - withheld for a residual secret;
   - never delivered (a refused or timed-out answer, or an issue the answer did not explain).

   §5 says so: "the model must give a displayable explanation for at least 3 issues in 4". Otherwise a model that
   times out would pass the cap.
2. **The cap applies to every complete fresh run, the held-out run included.**
   - Each run's ratio is judged by itself; runs are never averaged.
   - Integer arithmetic: `4 × undisplayed ≤ sent`, so 4 of 17 passes and 5 of 17 fails.
3. **DX-3's 80 % is over every fresh displayed text, labelled and held-out together.**
   - It is judged only once DX-2 holds, and the per-run figures are reported beside it.
   - A confirmed escape fails DX-3 at once and can never be undone. An escape is a displayed text a person marks
     unsupported, not grounded, or misattributed.
4. **A DX verdict needs `--misattributed yes|no`,** because DX-3 names misattribution and the old verdict had no
   field for it. A verdict without it, or under a placeholder's or an agent's label, is no reading.
5. **Every fresh text must be read before DX-3 can be MET,** displayed and withheld alike.
   - The packet is blind: it lists them in item-id order, without saying which the gate withheld and without any
     judge reading.
   - The false-withholding rate and the escape count are reported per run.
6. **Evidence plan and counting:**
   - The plan is exactly two complete labelled runs and one complete held-out run.
   - Every fresh output counts.
   - A run left incomplete keeps DX-2 PENDING until it is completed. It is never dropped, and a text in it still
     counts for DX-3.
   - The agent takes no run beyond the plan.
7. **"Fresh" means a capture that carries the inputs the launcher measured,** all equal to DX-0 (pack, runtime,
   the four blobs, the request, the committed held-out corpus).
   - Any capture taken on other inputs makes DX-0 NOT MET: the fresh evidence is void.
   - Captures from before DX carry no inputs and count for nothing.

**The held-out set's format** (`L4b-held-out/README.md`):
- one flow per `.json` file in `L4b-held-out/flows/`, as the product saves a flow;
- structural rules only (see the README);
- at least 17 issues sent, which means at least 9 flows, since one request sends at most 2;
- a case id is `ho-` plus 12 hex of the flow's content hash, so it carries nothing from the file's name;
- the corpus hash is taken over the content, never the layout.

`inventory.json` is written once, then committed with the flows, and its corpus hash is recorded here. The
selection is the owner's (or a person the owner names), per the ruling above. **The agent has seen no case.**

**Superseded for the selection only (2026-09-26, latest, the owner's Phase L brief; `docs/ai/DECISIONS.md`).**
The set was selected by a rule committed before any candidate was enumerated
(`scripts/ai-harness/authoringHeldOutSelection.ts`, `L4b-held-out/README.md`):

| Step | Commit | What |
|---|---|---|
| The rule | `f73fcd6b` | sources S1 and S2; exclusions E1 to E3; a seed from the committed inventory; the shortest prefix of at least 17 issues |
| Eligibility | `7dc00699` | 548 candidates, 24 eligible sending 40 issues |
| The set | `cef94893` | 11 flows, 18 issues, corpus sha256 `0db8a5814eee3e08a2a1fc3d8bcb72826af584e48ea8062fd4461ad716ac09d3`, seed `72fccdd8…` |

- The reader ruling above is **unchanged**: DX-3 is a person's reading, and no agent label counts. The brief's
  request to change it was not applied.
- The owner may confirm this set or replace it. A replacement voids every capture taken on this one.

**Evaluator at the fresh runs** (changed before the first run, at `f73fcd6b` and `88f89850`; no DX-0 input
changed): `authoringDx.ts` `ca0a6a99` (`checkHeldOutFlow` factored out, same behaviour), `authoringQualityReview.ts`
`1350dc59` (an agent or model name anywhere in a reviewer label is refused), `verify-ai-authoring.mts` `6c1bd810`
(363 checks), `verify-ai-display-gate-mutations.mts` `6ddf520b` (26 DX mutants). The others are as in the table
above.

**The fresh runs (2026-09-26): DX NOT MET.** The record is `L4b-dx-fresh-runs-2026-09-26.md`.

| Criterion | Status |
|---|---|
| DX-0 | MET |
| DX-2 | MET: two labelled runs and one held-out run, 52 issues, all delivered |
| DX-3 | PENDING: 0 of 52 read by a person |
| DX-4 | **NOT MET**: labelled run 1 5/17 undisplayed (the cap is 4). Labelled run 2 4/17, held-out 3/18. |
| DX-5 | MET |

Per the ruling above, a run over the cap keeps L4b open with no criterion adjusted.

**Revision 2 (2026-09-26, later): the owner's decision in their own words** (`docs/ai/DECISIONS.md`, 2026-09-26
(latest, final)). Asked directly in the session, not taken from a pasted brief.

- **DX-3: automated.** The reader ruling above is superseded for Phase L technical acceptance.
  - A deterministic evaluator, committed before any revision-2 run, decides DX-3.
  - Its thresholds are unchanged: zero displayed escapes, and at least 80 % of displayed texts correct and
    actionable.
  - Its verdicts are recorded as automated, never as a person's.
- **The held-out set is confirmed:** the set of `cef94893`, unchanged, for every later revision.
- **R5 opens revision 2.** A changed request is a new DX-0.
  - Revision 1's captures stay on the record and are judged only as revision 1 (DX NOT MET).
  - Revision 2 is judged only on captures taken on its own inputs.
- **R6, only if R5 fails:** Qwen3.5-2B, after it qualifies under L1.8. It is never the 4B.

**Revision 2's DX-0, frozen at `dc3d0c18` (2026-09-26), before its first run.** Changing any of these voids
revision 2's runs.

| Input | Frozen value |
|---|---|
| Model pack | unchanged: Qwen3.5-0.8B Q4_K_M, sha256 `f5b14da9…93bfec` |
| Runtime | unchanged: `node-llama-cpp@3.21.1+llama.cpp@v0.4.0` (`AiModelManifest.ts` `a6f2472e`) |
| Request (R5) | instructions sha256 `abea5095fad32abbf71f58f1dd2aac5cdca76221e0d493a92bd21c3389de310c`, `authoringExplanation.ts` `a8413cc040d013ecc284895c02f7ea51f0a6fb16` |
| Display gate (R4) | `authoringClaimScreen.ts` `b8142e0b7928dc7143ffba030ba3f5e662a3363f`. Its one change is the proven false positive: a number ending a request sentence is now held, so `invalidLoopBounds`' own step is no longer withheld as `FABRICATED_LITERAL`. Red first: the `number-ending-a-sentence-not-held` mutant fails 2 checks. |
| Adapter | unchanged: `aiAssist.ts` `74180291` |
| Held-out corpus | unchanged and confirmed: `0db8a581…` (`cef94893`) |
| DX rubric | DX-0 to DX-5 as in §5, the 25 % cap per run, and this section's rulings. DX-3 is automated: the zero-escape and 80 % thresholds are unchanged. |

**The evaluator at revision 2's runs** (blob ids, from `git ls-files -s`):

| File | Role | Blob |
|---|---|---|
| `scripts/ai-harness/authoringDx.ts` | DX revisions; the automated DX-3 (`dx3Reading`); the evaluator | `af10ff519a7e3d0e676471c3b4a2cae42f558d60` |
| `scripts/ai-harness/authoringQualitySet.ts` | the judge, with subject and remedy rules for the held-out set's three codes | `b285f170b2f71d97c2c71a9dc6ef48af7cb05f7a` |
| `scripts/ai-harness/authoringQualityReview.ts` | captures and `rereadCapture`, unchanged | `1350dc59b44878888e23c439ee1e549564d96a9d` |
| `scripts/ai-harness/authoringQualityLive.ts` | the live harness, unchanged | `8301d8c64fb980c7e093f7b1f3aad92f8c1703a8` |
| `scripts/verify-ai-explanation-live.mts` | the launcher, unchanged | `bfa72737656b622c3cce96a94973676c01c47fb0` |
| `scripts/verify-ai-authoring-review.mts` | the CLI: `--dx`, and `--dx --pending` (each text's DX-3 reading) | `c44840756bd8c551db5b17f8dadbaa900a3cef22` |
| `scripts/verify-ai-authoring.mts` | §15 and §16: 382 checks without a model | `c9380e634710f7ff8011227e6e6fac41de484946` |
| `scripts/verify-ai-display-gate-mutations.mts` | 37 DX mutants and 16 gate mutants | `c0c74a1a274c3822bcc36900a0cfd8fc78ec137e` |

- **How DX-3 reads a text** (`dx3Reading`). Each point was fixed before any revision-2 output.
  - A displayed text with any of these is an escape:
    - a misattribution;
    - an unsupported fact: a name, value, position or out-of-flow remedy;
    - a claim its own line contradicts: severity, blocking, an automatic fix, a wrong remedy;
    - an invented cause or run-time consequence;
    - a leaked secret.
  - Causes and outcomes are read in a vocabulary wider than R4's. It adds the forms R4's coverage limits name:
    "since", "thus", "hence", "breaks", "could break", "lost", "does nothing", "prevents".
  - A cause or outcome is supported only when every word of it is in the issue's own evidence line. A sentence
    that states one may add no fact beyond that line and a fixed generic vocabulary.
  - "Correct" means on subject with no defect. "Actionable" is the judge's reading of the model's own text,
    never the product's step shown beside it.
- **Calibration, on answers recorded before DX-3 existed** (R2's 34, `verify:ai-authoring` §16):
  - none of the 26 the 2026-09-25 evaluation found correct has a defect;
  - of the 8 it found unsupported, DX-3 finds 5 (#7, #17, #23, #24, #34);
  - #5, #8 and #25 relate supported words wrongly ("or" read as "and"; "it never runs" said of the flow). A
    lexical reading cannot see that. This is its recorded limit, and R4 withholds all three.
- **Proof, without a model:**
  - `verify:ai-authoring` 382/382;
  - `verify:ai-dx-mutations` 82/0, 37 of 37 killed;
  - `verify:ai-display-gate-mutations` 40/0, 16 of 16 killed;
  - `typecheck:scripts` and `build` PASS.

## 1. Original model-output quality: NOT MET (unchanged by anything below)

The adopted target (L4 › "Explanation quality target") over what the pinned Qwen3.5-0.8B produces, two complete
runs of 17 issues after R1 and R2:

| Criterion | Result |
|---|---|
| (1) no confirmed unsupported claim | PENDING: a person must read 26 answers, 0 read |
| (2) on subject, ≥ 90 % in every run | **NOT MET**, 13/17 and 11/17 (withheld answers count as failures) |
| (3) corrective action a person sees, ≥ 80 % | MET, 17/17 and 16/17 (the product's action; the model's own text 9/17 and 7/17, never credited) |
| (4) a person judges the screen-clear answers, ≥ 80 % | PENDING, 0 of 16 judged |
| (5) fix order · (6) two runs | MET · MET |

- **Verdict: TARGET NOT MET.** The AI evaluation (not a person) found an unsupported cause, consequence or
  location in 4/17 answers in each run.
- Six request versions were measured. Each fixed the defect it aimed at, and the model's own paraphrase invented
  another. The limit is this model at this size.
- **No option below marks this target passed.** It stays on the record as NOT MET.

## 2. Delivered-experience quality after R4 (on the 34 answers R4 was designed against)

| For the 34 issues | Result |
|---|---|
| The validator's finding, its actual severity and blocking, and the product's corrective action | 34/34 (deterministic) |
| AI text shown | 24/34 (71 %) |
| Shown and correct and grounded | 24/24 by the AI evaluation; **0/24 confirmed by a person** |
| AI text withheld, with a product sentence naming why | 10/34: run 1 4/17 (24 %), run 2 6/17 (35 %) |

- **A withheld answer is not a successful model explanation.** On these 34, the model gave a displayable
  explanation for 24 issues, and none of those is yet confirmed by a person.
- With AI off, unavailable, timed out or cancelled, no AI text reaches the designer, and the findings and actions
  are unchanged (`verify:ai-authoring` §14, `verify:ai-assist-gui` 185/0).

## 3. The safety fallback (R4): what it achieves and what it does not

- **On the 34 it was designed against:**
  - it withheld all 8 answers the AI evaluation found unsupported;
  - it withheld 2 of the 26 correct answers (#22, #33): a **false-withholding rate of 7.7 %**;
  - 8 of its 10 withholdings were of unsupported answers.
  - These are in-sample figures: the rules were written with these answers in view, so they overstate how the
    gate will do on new output.
- **Held-out wording:** controls written by the implementing agent pass (`verify:ai-authoring` 305/305).
- **Mutation run (new, 2026-09-25):** `verify:ai-display-gate-mutations` 38/0, 15 of 15 mutants killed.
  - No product file was written. Each mutant is applied in memory, by a load hook in a child process.
  - One mutant first survived: treating "the flow does not run" as evidence for a non-blocking issue. A held-out
    control now kills it.
  - This measures how sensitive the checks are to a broken gate. It says nothing of the gate's recall on real
    model output.
- **Not measured:** precision and recall on model output the gate has never seen. No person has judged any of it.
- **Coverage limits** (L4 › R4, 9 listed). The gate is lexical, so:
  - a consequence outside its closed English vocabulary is shown ("prevents", "ends up empty", "nothing happens");
  - a cause outside its connectives is shown ("since", "thus", "hence");
  - a wrong statement that makes no cause, consequence or position claim is shown (a wrong subject);
  - unquoted step names, relative places ("after Start") and other languages are not read;
  - a correct paraphrase of a cause or consequence is withheld with the wrong ones.
- **R4 does not guarantee that every unsupported statement is detected.** Criterion DX-3 below is what measures
  what gets through, on fresh output, by a person.

## 4. The human review the project already requires (unchanged, not satisfied)

- Criterion 1: a person reads 26 answers (1 screen hit, 16 screen-clear, 9 other causal claims). 0 read.
- Criterion 4: a person judges the 16 screen-clear answers, ≥ 80 % correct and actionable. 0 judged.
- The AI evaluation satisfies neither, and the agent records no verdict and never records under the owner's
  identity.

## 5. Proposed delivered-experience criteria (DX)

These would apply only if the owner chooses B below. Each is pass/fail, and all must hold.

- **DX-0, frozen inputs.** Freeze these at the commit that records the owner's decision:
  - the model pin (Qwen3.5-0.8B Q4_K_M, sha256 `f5b14da9…`);
  - the runtime pin;
  - the request (the R2 instructions hash);
  - the display-gate rules (`src/ai/authoringClaimScreen.ts`).

  A change to any of them after the fresh runs start voids those runs.
- **DX-1, deterministic guidance is always there.**
  - In every fresh run, 100 % of issues show the validator's finding, its actual severity and blocking, and the
    product's corrective action, whatever happens to the AI text.
  - With AI off, the pack missing, the runtime unavailable, a timeout or a cancel, the validation panel works as
    without AI.
  - Proof: `verify:ai-authoring` §14 and `verify:ai-assist-gui` on the accepted build.
- **DX-2, fresh evidence on unseen output.**
  - *Required:* two new complete runs of the 17-issue labelled set (`verify:ai-authoring-quality-live-part1` and
    `-part2`, each twice), captured after DX-0. None of their texts existed when the gate was written.
  - *Recommended:* a held-out set of at least 17 further issues in flows outside the labelled set, committed with
    its hash before its first run and chosen by someone other than the implementing agent. Without it, the
    evidence covers only the wording of these 17 issue types.
  - Every output counts, and no case is excluded. An answer that is not delivered (timeout, rejection) counts as
    no AI explanation for its issues.
- **DX-3, independently assessed correctness.** A person reads every AI text displayed in the fresh runs, and
  records each verdict under their own label (`verify:ai-authoring-review -- --record`). Neither the implementing
  agent nor an AI evaluation substitutes for this.
  - **0** displayed texts confirmed to carry an unsupported claim (cause, consequence, location, value or
    severity) or a misattribution;
  - **≥ 80 %** of displayed texts judged correct and actionable.
- **DX-4, withholding-rate policy.**
  - A withheld text is never counted as an explanation, as on subject, as correct or as actionable.
  - **Cap: at most 25 % of issues withheld in every fresh complete run** (at most 4 of 17). So the model must give
    a displayable explanation for at least 3 issues in 4.
  - The cap was not fitted to the data. On the 34 design answers, run 1 (24 %) is within it and run 2 (35 %) is
    over it, so the existing captures would not pass.
  - The person also reads the withheld texts, to measure the gate, never to credit them. The false-withholding
    rate (withheld but correct, over all correct) and the escape count (displayed but unsupported) are reported
    per run. The false-withholding rate is reported, not capped: over-withholding fails safe, and the cap above
    already bounds it.
- **DX-5, the raw result stays visible.** The adopted target's verdict (NOT MET), the model's own on-subject rate
  before the gate, and its own corrective-action rate are reported beside DX, under their own names.

**What acceptance under DX would and would not mean:**
- It would accept L4b as *the delivered experience of the pinned 0.8B behind R4*.
- It would not mark the original target, or the model's quality, as passed.
- It would not claim that R4 catches every unsupported statement; DX-3 measures what gets through.
- A change of model, request or gate needs new fresh runs and a new reading.

## 6. The decision (one reply)

**Which measure accepts L4b?**

- **A. The adopted target, no change.**
  - L4b stays NOT MET, and L6 stays blocked by it.
  - It can move only through R5 (clarify three rule summaries: fresh runs and L1.8) or R6 (a larger model: a pin
    change). Each needs separate authorization, and a person's review afterwards.
- **B. DX-0 to DX-5 as L4b's acceptance measure, with §1 kept on the record as NOT MET.**
  - Work after the decision:
    1. add the DX evaluation to `verify:ai-authoring-review`, beside the adopted target's, which stays unchanged;
    2. make the fresh runs (about 25 minutes of model time for the two required runs);
    3. a person reads about 34 texts (displayed and withheld), more if the held-out set is chosen.
  - L4b closes only when DX-1 to DX-5 all hold on that evidence. Until then it stays `in_progress`.

**Recommendation: B, with the 25 % cap, the held-out set, and a named person as reader.** The deterministic
guidance is complete, and the raw shortfall stays on the record. A person's reading of fresh output is the one
measure of what the lexical gate lets through.

**Reply form:**
- `L4b: A`, or
- `L4b: B, cap <n> %, held-out <yes|no>, reader <label>`.

A different cap is the owner's to set. If none is given, B is not adopted.
