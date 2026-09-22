# Agent Handoff

## HANDOFF (2026-09-22, latest) — L4b decisions implemented; the adopted target is NOT MET, and review awaits a person

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`97996c48`, then this closeout):** the owner's four L4b decisions are implemented. Details are
  in L4 › "The owner's L4b decisions, implemented and measured".
  - the quality target is adopted provisionally, thresholds unchanged;
  - the request asks for an evidence-grounded corrective step;
  - there is a local, redacted human-review store;
  - a fix order is optional and blocking-first, and a violating order is withheld.
- **Measured on the real 0.8B:**
  - L1.8 re-measured: GO on all 8, with 71,492 ms at cap against 120,000. The projection margin at the
    slowest rates is 2.7 s.
  - Two complete quality runs: 17/17 and 16/17 on subject, **6/17 and 5/17 actionable**, 0
    misattributed, 0 screen hits, nothing ranked.
  - `verify:ai-authoring-review`: **TARGET NOT MET** (criterion 3). Criteria 1 and 4 are PENDING, with
    11 screen-clear answers unread.
- **Next, not started:**
  1. **A person** reviews the 11 answers. Run `npm run verify:ai-authoring-review -- --pending`, then
     `-- --record <item> --correct yes|no --actionable yes|no --grounded yes|no --unsupported yes|no
     --reviewer <label>` for each.
  2. The owner decides how to close criterion 3. The options are another request change, a different
     model, or a change to the target. From the captures, not from review:
     - some answers restate the rule;
     - the casing issues get the "check" fallback;
     - 12 of 34 texts end at 160 characters.
     Any request change re-opens L1.8, where only 2.7 s of margin is projected.
  3. Then L1's go/no-go. The next Phase L item stays L5b's baseline gap (−5).
- **Do not:**
  - record a review verdict as an agent;
  - count a screen-clear or unreviewed answer as correct;
  - tune a screen or the proxy after seeing a result. A proxy false positive ("does not specify") was
    left as registered;
  - lower a threshold;
  - re-sort a withheld fix order.

## HANDOFF (2026-09-22, superseded) — L4b explanation quality measured past the subject: 0/17 actionable, nothing ranked

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`3e37f2c1`, then this closeout):**
  - `verify:ai-authoring-quality-live` now reads corrective action, five unsupported-claim screens,
    per-explanation categories and the fix order, over 9 cases (17 issues, 14 codes).
  - It runs in two parts under the tool ceiling: `-part1` and `-part2`.
  - No product change. Details are in L4 › "Corrective action, unsupported claims and fix priority,
    measured".
- **Result on the real 0.8B, one run:**
  - 9/9 accepted, 17/17 on subject by proxy, 0 misattributed.
  - **0/17 actionable.** There was 1 unconfirmed severity hit, and no fabricated fix, value or remedy.
  - Nothing ranked, so the T1 fix order is unmeasured.
- **Next, not started; each is the owner's call:**
  1. Adopt, change or reject L4's proposed quality target.
  2. Decide whether the product's instruction should ask for a corrective step. It currently forbids
     describing a repair. Changing it changes the request, and L1.8's `explanationAtCapMs` must then be
     re-measured.
  3. Choose how a person reviews answers, since the harness never records model text.
  4. Then L1's go/no-go. The next Phase L item after that stays L5b's baseline gap (−5).
- **Do not:**
  - count a screen-clear explanation as correct;
  - tune a screen after seeing a result. The one hit was left as registered;
  - claim a fix order was measured.

## HANDOFF (2026-09-22, superseded) — the deterministic failure cause reads confirmed request provenance: 14/17

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`14c0ad84`, then this closeout):**
  - `deriveFailureCause` moves the failed step's own request ahead of other requests, never ahead of other
    evidence, and never cites a request issued after the failure.
  - Without provenance nothing changes.
  - Details are in L5 › "Deterministic cause selection reads confirmed request provenance".
- **Result, measured without a model:**
  - Labelled set 9/11, unchanged.
  - Request-provenance cases 5/6 (was 2/6).
  - All 17 rows 14/17 (was 11/17), false attributions 3 (was 6), no regression.
  - The model's requests are byte-identical, so the recorded AI 9/17 stands. The gap is now −5.
- **Integrated (`880fd602`):** merged with the concurrent Phase M registration (`4951b366`). The
  tracker database was re-imported, and Phase M's 8 issues are in both the database and the export.
  The dashboard is 177/177 "Sources agree" at 311 issues, 17 outstanding / 294 closed, 155 edges and 13
  phases A..M.
  - The lease guard admits no merge or rebase, so the owner ran both.
  - Any agent pulling a concurrent `.beads/issues.jsonl` must `bd import` it before its next `bd`
    write. Auto-export is on and would otherwise drop the new issues.
- **Next L1/L5 blocker, not started:**
  - L5b's automatic analysis needs an AI that beats a now-stronger baseline. The 0.8B is five rows
    below it.
  - The model choice in L1's go/no-go is the owner's decision: whether a larger pack is measured on the
    same 17 rows.
  - L1 also still owes the L4b explanation quality target. L1, L4b and L5b stay `in_progress`. **L7
    cannot be entered.**
- **Do not:**
  - relabel a case or relax the judge;
  - demote uncertain or off-target requests without a link. That is cause from timing.
  - claim the AI was re-measured. Its numbers are `e27e15bd`'s, re-scored against the new baseline.

## HANDOFF (2026-09-22, superseded) — failure analysis reads runtime request provenance; the 0.8B falls below the baseline on it

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`e27e15bd`, then this closeout):**
  - The failure-analysis request states each request's runtime relation to the failed step, and ranks
    the step's own request first.
  - A request issued after the failure can never be the cause.
  - A request without provenance is byte-identical.
  - Six real-runner cases were added, run by `verify:ai-error-quality-live-requests1` and `-requests2`.
  - Details are in L5 › "Request provenance in the failure-analysis request, measured".
- **Result:**
  - Technical verification: PASS.
  - Model quality: not met.
    - Labelled set: 9/11 against 9/11.
    - Six new cases: AI 0/6 against the baseline's 2/6.
    - All 17 rows: 9/17 against 11/17, improvement −2, 8 false attributions.
  - The 0.8B never cited the failed step's own request. Rule 7 keeps the automatic analysis off.
- **Next L1/L5 blocker, not started:**
  - L5b's automatic analysis needs an AI that beats the baseline on the labelled set, and the 0.8B does
    not. Prompt, anchoring, step and request provenance have all been measured without moving it.
  - Two owner decisions remain, neither measured here:
    - the model, inside L1's go/no-go: whether a larger pack uses the provenance the 0.8B ignores;
    - the deterministic baseline, which was deliberately not changed: whether it should read a confirmed
      link. The baseline was wrong on 4 of the 6 new cases.
  - L1 also still owes the L4b explanation quality target. L1, L4b and L5b stay `in_progress`. **L7
    cannot be entered.**
- **Do not:**
  - relabel a case, relax the judge or change a recorded answer to move these numbers;
  - bar uncertain or off-target requests from primary evidence to force a score. That infers cause from
    timing, and would copy a rule into the grammar that the model cannot then be right against;
  - report the live quality gates' technical PASS as quality acceptance.

## HANDOFF (2026-09-22, superseded) — failure evidence records request-to-step provenance at runtime

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`3699617f`):**
  - Request events carry optional provenance: a stable id across redirects, the response and a transfer
    failure; the issue step and time; the frame; and a confirmed link when the runner holds the request
    (navigation response, response-wait match).
  - The failure record carries the failed step's target page and frame.
  - `requestRelations` separates confirmed from uncertain relations.
  - New verifier: `verify:request-provenance` 59/0, with three mutations caught. The Runner Lab gains a
    Request provenance section.
  - Details are in L5 › "Request-to-step provenance, recorded at runtime".
- **Next L1/L5 blocker, not started:**
  - The failure-analysis request does not read `requestRelations`. Using it (ranking a confirmed link
    first, or treating a confirmed-unrelated request differently) is a L5b cause-selection decision.
  - It needs labelled cases built from real-runner provenance, written before the 0.8B is measured on
    them.
  - L1 still owes the L4b explanation quality target and the owner's go/no-go. L1, L4b and L5b stay
    `in_progress`. **L7 cannot be entered.**
- **Do not:**
  - call a request `linkedToFailedStep` because it was issued during the step or matches its URL. Only a
    runner-held request is a link;
  - move provenance into `payload`: that would change the dedupe key, the byte caps and every prompt;
  - read `hasUserGesture` or `Sec-Fetch-User` as a link. User activation outlives a click by about 5 s.

## HANDOFF (2026-09-22, superseded) — failure analysis knows which step each event came from; the 0.8B still ties the baseline

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`407d6080`):**
  - `stepRelations` reads each event's collector step stamp.
  - After-failure events are never primary and are offered last.
  - Lines state their step only when steps differ.
  - Two provenance cases added, run by `verify:ai-error-quality-live-provenance`.
  - The labelled set is unchanged at 9/11 vs 9/11. The provenance cases scored AI 1/2 vs baseline 2/2,
    twice.
  - Details are in L5 › "Step relevance, from the collector's step stamp".
- **Not done, and owner decisions:**
  - The AI does not beat the baseline, so the automatic analysis stays off (rule 7).
  - The 0.8B ignores step labels, and the labelled set's two misses are within one step.
  - What remains is a model or new runtime provenance (a request's initiating action, the failed step's
    page), both outside this task.
  - L1, L4b and L5b stay `in_progress`. **L7 cannot be entered.**
- **Do not:**
  - bar earlier-step events when the failed step has direct evidence. That copies the baseline's window
    precedence into the grammar;
  - add text or URL matching between the step and an event as "relevance";
  - restamp the labelled set's events into several steps to make provenance score. They were built as
    one step.

## HANDOFF (2026-09-22, superseded) — failure analysis no longer shows the deterministic conclusion; the 0.8B still ties the baseline

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`c44a6e2c`):**
  - The failure-analysis prompt no longer carries the deterministic conclusion, and lists the evidence
    newest first.
  - Three anchoring cases were added, plus an echo diagnostic.
  - The live gate now runs in two parts.
  - Two runs, each 20/0: whole set 9/11 vs 9/11, 2 false attributions, 1 correct decline. The eight
    rows of `4f81424a` are unchanged at 7/8.
  - L1.8 is still GO: `failureAnalysisAtCap` 120.4 s.
  - Details are in L5 › "Baseline anchoring, removed and measured".
- **Not done, and owner decisions:**
  - The AI does not beat the baseline, so the automatic analysis stays off (rule 7).
  - The remaining limit is the model's own cause selection, not the prompt.
  - L1 still owes an L4b explanation quality target and the go/no-go. L1, L4b and L5b stay
    `in_progress`. **L7 cannot be entered.**
- **Do not:**
  - tune the prompt's wording against these eleven rows and report the result as an improvement. A
    change needs cases written before it is measured;
  - run the whole `verify:ai-error-quality-live` from a tool with a 600 s ceiling. Use `-part1` then
    `-part2`.

## HANDOFF (2026-09-22, superseded) — `verify:ai-error-quality-live` built; the 0.8B ties the baseline on L5's labelled set, 13/0

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`4f81424a`):**
  - The labelled set and its judge are in `scripts/ai-harness/errorQualitySet.ts`, audited by
    `verify:ai-error-analysis` (252/252).
  - The live mode is `scripts/ai-harness/errorQualityLive.ts`.
  - Two runs, both 13/0: baseline 7/8, AI 7/8, improvement 0, 1 false attribution.
  - Details are in L5 › "The live quality gate as built".
- **Not done, and owner decisions:**
  - L1 has every live quality gate it names. Still owed: an L4b explanation quality target, and the
    go/no-go, including whether the 4B stays pinned.
  - L5b's automatic analysis stays off: the AI does not beat the baseline (rule 7).
  - L1, L4b and L5b stay `in_progress`. **L7 cannot be entered.**
- **Do not:**
  - relabel an event after seeing a model's answer: labels come from the scenario's construction;
  - count "arrived" or "cited something" as accuracy: primary evidence must include a cause event and
    no unrelated one;
  - add rows without timing the run: eight calls take ~8 min inside the 10-minute tool limit.

## HANDOFF (2026-09-22, superseded) — `verify:ai-authoring-quality-live` built; the 0.8B explains L4b's labelled set, 10/0

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`1126c1b6`):**
  - The labelled set and its judge are in `scripts/ai-harness/authoringQualitySet.ts`, audited by
    `verify:ai-authoring` §11 (148/148).
  - The live mode is `scripts/ai-harness/authoringQualityLive.ts`.
  - Result: 10/0. 12/12 issues explained, 0 leaks, 12/12 on subject, 0 misattributed, 0 of 3 fixable
    issues ranked.
  - Details are in L4 › "The live quality gate as built".
- **Not done, and owner decisions:**
  - An L4b explanation quality target: L4's acceptance requires one before release, and none is
    recorded.
  - `verify:ai-error-quality-live` is not built.
  - The go/no-go, and whether the 4B stays pinned. L1 and L4b stay `in_progress`. **L7 cannot be
    entered.**
- **Do not:**
  - tune `SUBJECT` to a run's output. It was written before any model text was seen, and a rate is
    evidence, not a pass mark.
  - read one run's rate as the model's: the prompt nonce is random.
  - add cases without timing the run: six take ~5.5 min inside the 10-minute tool limit.

## HANDOFF (2026-09-22, superseded) — the Qwen3.5-0.8B pack is pinned; `verify:ai-model-live-0-8b` 23/0

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:**
  - `3fa15327`: `verify:ai-model-live --pack` and a GGUF header reader, plus the new script
    `verify:ai-model-live-0-8b`.
  - `d6b306f0`: the 0.8B entry, measured from the file and its own header, and its license notice. The
    4B and `AI_RUNTIME_PIN` are unchanged.
  - Pinned: 23/0, with the import through the real manifest and all 13 live steps.
  - Details are in the L1 plan › "The 0.8B pinned, and `verify:ai-model-live` on it".
- **Not done, and owner decisions:**
  - `verify:ai-authoring-quality-live` and `verify:ai-error-quality-live` are not built.
  - The go/no-go on the re-scoped model, and whether the 4B stays pinned: it fails L1.8 on this host.
  - L1 stays `in_progress`. **L7 cannot be entered.** Nothing is wired.
- **Do not:**
  - write a manifest field from a model card: `verify:ai-model-live-0-8b` checks context length and
    quantization against the header;
  - edit `src/offline/**` or `resources/THIRD_PARTY_NOTICES.md` without a release lease.

## HANDOFF (2026-09-22, superseded) — the real 0.8B's locator plans are proven on real pages; `verify:ai-locator-quality-live` 14/0, false-target 0

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`858ffd17`):**
  - New `verify:ai-locator-quality-live`: six real Recorder captures through the product's job and the
    real host. The product proves each plan in real Chromium; the page judges each accepted candidate
    on a fresh page.
  - Results: 14/0 twice, 0 false targets, twins refused, 3–4 of 5 solvable scenarios browser-proven,
    and 5 of 6 jobs took a real second attempt.
  - Fixtures `lu-scope` and `lu-dynamic` added to the locator-upgrade lab. The harness is now
    type-checked.
  - Details are in the L1 plan › "The real 0.8B's locator plans proven on real pages".
- **Not done, and owner decisions:**
  - Still owed for L1: the pin, license notice, `verify:ai-model-pack`, and `verify:ai-model-live` on
    the 0.8B (the script still looks for the 4B).
  - `verify:ai-authoring-quality-live` and `verify:ai-error-quality-live` are not built.
  - The owner's go/no-go. L1 stays `in_progress`. **L7 cannot be entered.** The job is still not wired.
  - Open: the 0.8B never delivered a scoped upgrade; rates vary run to run with the random nonce.
- **Do not:**
  - count a stubbed or page-unavailable proof as a browser proof;
  - judge an accepted candidate by the product's own gates alone. Re-check it on a fresh page against
    the page's own outcome.
  - add scenarios without timing the run: one run is ~510 s against a 575 s budget inside the
    10-minute tool limit.

## HANDOFF (2026-09-22, superseded) — the locator-upgrade request meets its 180 s ceiling at its own 256-token cap; no benchmark packet is a stand-in any more

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`4a846c41`):**
  - `locatorAttemptJob`: one block of whole lines within 2,800 characters, no Recorder fallbacks,
    `LOCATOR_ATTEMPT_SCHEMA` (one scope, 200-character value, 80-character texts), a 256-token cap.
  - Real 0.8B: both live jobs accepted; largest 62.2 s of inference (was 74.9), 98.3 s at the cap (was
    186.4). Benchmark `packets:locatorUpgrade` is the product's own request: 115.3 s at the cap, **GO on
    all 8**.
  - The owner's `scripts/ai-harness/locatorUpgradePacket.ts` now builds that request and is committed;
    `scripts/offline-benchmark/` is untouched and untracked. New `verify:ai-locator-upgrade-budget`.
    Details are in the L1 plan › "`locatorUpgrade` inside its ceiling at its own output cap".
- **Not done, and owner decisions:**
  - No real model plan has been proven on a real page: `verify:ai-locator-quality-live` is not built.
  - The pin, license notice, `verify:ai-model-pack`, `verify:ai-model-live` and the live quality gates are
    still owed. L1 stays `in_progress`. **L7 cannot be entered.** The job is still not wired.
  - Open: a capture at every L2 bound (1,017 prompt tokens, counted) was not measured; number-dense
    plans at every limit exceed the cap.
- **Do not:**
  - raise `maxScopes` or any locator text limit without running `verify:ai-locator-upgrade-budget`;
  - narrow the target value below 200 characters: the grammar would cut a candidate the model copied;
  - check "whole lines" through a filter on each line's label: a cut can land inside the label.

## HANDOFF (2026-09-22, superseded) — the failure-analysis request meets its 180 s ceiling at its own 256-token cap; the benchmark measures the product's request

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`42655904`):**
  - `FAILURE_ANALYSIS_LIMITS`: 256-token cap, 2 ids per citation list, 260-character explanation,
    2 steps of 150, whole-line evidence within 1,500 characters. One text block plus routes.
  - Real 0.8B: every live answer accepted and classified; largest 94.0 s of inference (was 135.0),
    126.4 s at the cap (was 219.3). Benchmark `packets:failureAnalysis` is the product's own request:
    132.3 s at the cap, **GO on all 8**.
  - New `verify:ai-failure-analysis-budget` (tokenizer only, seconds). Details are in the L1 plan ›
    "`failureAnalysis` inside its ceiling at its own output cap".
- **Not done, and owner decisions:**
  - The locator request still exceeds its ceiling at its 512-token cap, and its benchmark packet is a
    stand-in. The owner's untracked `scripts/ai-harness/locatorUpgradePacket.ts` and
    `scripts/offline-benchmark/` were left untouched.
  - The pin, license notice, `verify:ai-model-pack`, `verify:ai-model-live` and the live quality gates
    are still owed. L1 stays `in_progress`. **L7 cannot be entered.**
  - Open: a bare runner timeout still costs a model call (27.8 s); the largest live answer wrote no
    investigation step; a request with twelve long routes was not measured.
- **Do not:**
  - raise any `FAILURE_ANALYSIS_LIMITS` text, list or step limit without running
    `verify:ai-failure-analysis-budget`: an answer that outgrows the cap is discarded whole;
  - put evidence back under a character cap that cuts lines, or offer an id whose line was not shown;
  - check "shown" by a line's prefix.

## HANDOFF (2026-09-22, superseded) — real failure analyses are accepted and correctly classified; latency at the cap is still open

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`5ef4852f`):**
  - The failure-analysis answer contract is rebuilt. Declining is an empty `conclusion` list, a direct
    cause must be interpreted, a bare runner failure can only be declined, and the runner's own failure
    record is never primary evidence.
  - On the real 0.8B, all three live cases are accepted and correctly classified
    (`verify:ai-failure-analysis-live` 5/5, which now asserts acceptance and classification).
  - Details are in the L1 plan › "The failure-analysis answer contract, fixed".
- **Not done, and owner decisions:**
  - Both failure analysis and locator upgrade still exceed the 180 s ceiling at their 512-token caps.
  - The largest real conclusion cites all 11 cause candidates as primary. A tighter cap is a quality
    decision for the labelled set.
  - A bare runner timeout still costs one model call whose only answer is a decline.
  - The pin, license notice, `verify:ai-model-pack`, `verify:ai-model-live` and the live quality gates
    are still owed. L1 stays `in_progress`. **L7 cannot be entered.**
- **Do not:**
  - add a field beside `conclusion` that can say "insufficient": the grammar writes every key, so it
    can always be written against the list;
  - leave a decision to the model's first token when the product already knows the answer;
  - count an answer that arrived as a pass in a live gate: assert that it was accepted and classified.

## HANDOFF (2026-09-22, superseded) — failure analysis and locator upgrade have their own 185 s deadlines; their requests still exceed the ceiling at their own cap

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`d71ee244`):**
  - Both features measured through the product on the real 0.8B. Both deadlines 30 s → 185 s (per
    attempt for the locator job), and `maxJobTimeoutMs` 125 s → 185 s.
  - New gates: `verify:ai-deadlines` (virtual clock), `verify:ai-failure-analysis-live` and
    `verify:ai-locator-upgrade-live`.
  - Details are in the L1 plan › "`failureAnalysis` and `locatorUpgrade` measured through the product".
- **Not done, and owner decisions:**
  - Both requests exceed the 180 s ceiling at their own 512-token output caps (181–300 s projected).
    Either bring them inside it, as `d2a81262` did for the explanation, or re-scope the ceiling. Then
    re-point the benchmark's two packets at the product's requests.
  - Every real failure analysis was refused as `CONTRADICTORY`. That task is flagged separately.
  - The pin, license notice, `verify:ai-model-pack`, `verify:ai-model-live` and the live quality gates
    are still owed. L1 stays `in_progress`. **L7 cannot be entered.**
- **Do not:**
  - raise a deadline past its feature's L1.8 ceiling plus 5 s to hide a slow request;
  - raise a feature's `timeoutMs` above `maxJobTimeoutMs`;
  - wire the locator job before L1's go/no-go;
  - run live gates back to back and read the slowest run as the model's speed. This laptop slows by
    about 1.6× when hot.

## HANDOFF (2026-09-21, superseded) — the explanation has its own 125 s deadline and is delivered on the real 0.8B

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (`d2f5feb2`):**
  - `AUTHORING_LIMITS.timeoutMs` 30 s → 125 s, and `AI_SERVICE_LIMITS.maxJobTimeoutMs` 120 s → 125 s.
    Without the second change every explanation would be refused.
  - A real explanation is now delivered through the production path, after 51.5 s and 62.7 s of
    inference, and cancel, kill and reload still work.
  - New live gate: `npm run verify:ai-explanation-live`.
  - Details are in the L1 plan › "`validationExplanation` gets its own deadline".
- **Not done, and owner decisions:**
  - Pin the 0.8B (`AI_MODEL_MANIFEST` plus the license notice), then run `verify:ai-model-pack` and
    `verify:ai-model-live` on it, and build the live quality gates.
  - Timeouts for `locatorUpgrade` and `failureAnalysis`: still 30 s, while their benchmark packets
    take 80–105 s here. Measure them through the product the way `verify:ai-explanation-live` does
    before setting anything.
  - L1 stays `in_progress`. **L7 cannot be entered.** The 2B is NOT RUN.
- **Do not:**
  - raise a feature's `timeoutMs` above `AI_SERVICE_LIMITS.maxJobTimeoutMs`. It is refused as
    `INVALID_REQUEST`, and the UI shows only "could not answer";
  - raise `maxIssues`, `maxExplanationChars` or `maxOutputTokens` without re-measuring;
  - cancel an inference outside `AiUtilityHostManager`.

## HANDOFF (2026-09-21, superseded) — `validationExplanation` fixed in the product; the 0.8B benchmark is GO on all 8

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:**
  - The benchmark packet is now the product's own request (`7f0e931e`). Unchanged, that request
    measured 222 s at cap, and the model explained nothing.
  - The request was fixed (`d2a81262`) and re-measured at **88.3 s against 120 s** (`f58cf28f`), with
    2 of 2 issues explained.
  - Details are in the L1 plan › "`validationExplanation` fixed in the product".
- **Not done, and owner decisions:**
  - Pin the 0.8B (`AI_MODEL_MANIFEST` plus the license notice), then run `verify:ai-model-pack` and
    `verify:ai-model-live` on it, and build the live quality gates.
  - Set per-feature timeouts from these results. `AUTHORING_LIMITS.timeoutMs` is 30 s, and a real
    answer takes 70–76 s here.
  - L1 stays `in_progress`. **L7 cannot be entered.** The 2B is NOT RUN.
- **Do not:**
  - raise `maxIssues`, `maxExplanationChars` or `maxOutputTokens` without re-measuring. The 0.8B writes
    indented JSON (~90 structure tokens for two explanations), and an answer cut off at the cap is
    discarded whole;
  - put anchor ids back in the prompt;
  - cancel an inference outside `AiUtilityHostManager`.

## HANDOFF (2026-09-21, superseded) — the cancel defect is fixed; Qwen3.5-0.8B misses only `validationExplanation`

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:**
  - `awkit-g555` is fixed by kill-and-restart (`6ca6297a`), proven by two mutation-tested suites and
    closed.
  - The 0.8B was re-measured (`d8162f86`): cancel latency 1,020 ms, 7 of 8 PASS.
  - Details are in the L1 plan › "Qwen3.5-0.8B after the cancel fix".
- **L1.8 is still NO-GO,** on `validationExplanation` at cap: 132.3 s against 120 s. L1 stays
  `in_progress`, and **L7 cannot be entered**.
- **Owner decision:** raise that one ceiling, shrink that feature's prompt or its 192-token output
  cap, or use a faster model. The 2B would be slower.
  - Changing the ceiling or the budget means a new benchmark run on the 0.8B.
  - A GO also still owes the manifest pin, the license notice, `verify:ai-model-pack`,
    `verify:ai-model-live` and the live quality gates.
- **Do not:**
  - cancel an inference outside `AiUtilityHostManager`, which would bring the defect back;
  - call a cancel "done" when it resolves. It now also resolves, or rejects, once the CPU is free.

## HANDOFF (2026-09-21, superseded) — Qwen3.5-0.8B is NO-GO on 2 of 8; the cancel defect blocks every model

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** the 0.8B was measured once, across all 7 scenarios. Six criteria PASS, including
  `locatorUpgrade`, the job that failed on the 4B. Two FAIL:
  - `validationExplanation` at cap: 138.5 s against 120 s (throughput);
  - cancel latency: 74.5 s against 3 s (a **host defect, `awkit-g555`**, now blocking L1).
- **Owner decisions needed:**
  1. **`awkit-g555`:** choose how cancellation frees the CPU during prompt evaluation. The options are
     checked chunked evaluation, or kill-and-restart with a grace period. This is a runtime-host change
     (`native-hosts/ai/ai-host.cjs`, gates `verify:ai-host` and `verify:ai-inference-profile`).
     Fix the harness probe to wait for the first output token, then re-measure the cancel scenario.
  2. **`validationExplanation`:** 1.15× over on the 0.8B. Options are the 2B (it will be slower), the
     ceiling, or that feature's prompt or output budget.
  3. **2B:** download it if it should still be measured
     (`npm run benchmark:ai-model-2b`, commands in the L1 plan).
- **Do not:** rerun the 0.8B, raise either ceiling, or call L1.8 passed on 6 of 8.

## HANDOFF (2026-09-21, superseded) — the two smaller packs are not on disk yet; nothing was measured

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Found:** the owner reported both packs downloaded, but neither file is in
  `C:\Users\moham\Downloads`, not even as a partial, and neither is under OneDrive.
  `benchmark:ai-model-2b` answered NOT RUN for the same reason. The Terminal panel shows no command
  run.
- **Fixed:** `benchmark:ai-model-0.8b` → `benchmark:ai-model-0-8b`, because the guard refuses a dot in
  a script name.
- **Next:**
  1. **Owner:** confirm the files are at the exact paths in the L1 plan's `curl.exe` commands.
     `Get-Item "$env:USERPROFILE\Downloads\Qwen3.5-*.gguf"` lists them.
  2. `npm run benchmark:ai-model-0-8b`, then `npm run benchmark:ai-model-2b`, each once, one call per
     scenario.
- **The rest is unchanged:** see the superseded entry below for the GO/NO-GO follow-through and the
  do-nots.

## HANDOFF (2026-09-21, superseded) — L1.8 re-scoped to smaller models; waiting on the owner's two downloads

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** the owner re-scoped L1.8 to a smaller model and chose to measure Qwen3.5-2B and
  Qwen3.5-0.8B separately. Each has a named script with its own evidence file and a published-identity
  check. The details are in the L1 plan › "Re-scoped to a smaller model".
- **Next, in order:**
  1. **Owner:** run the two `curl.exe` commands in that section.
  2. `npm run benchmark:ai-model-0.8b`, then `npm run benchmark:ai-model-2b`. Each needs one call per
     scenario, 7 in all, and stops at the first failed scenario. Measure each pack once, and never
     rerun a failed scenario.
  3. **A GO** needs every scenario to pass. It would then owe the manifest pin, the license notice,
     `verify:ai-model-pack`, `verify:ai-model-live` and the live quality gates before L1 can close.
     **A NO-GO for both** leaves only the ceilings.
- **Do not:**
  - pin either pack before it is measured;
  - pass arguments to `npm run benchmark:ai-model` (the guard refuses it; use the named scripts);
  - rerun the 4B.
- **Also untested:** the unknown-pack and not-downloaded refusals. Running a named script BEFORE its
  pack is downloaded exercises the second one: it is plain `npm run`, and it stops before any model
  loads.

## HANDOFF (2026-09-21, superseded) — L1.8 re-scoped to this machine unconstrained, and still NO-GO

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:**
  - The owner made this development machine, with all 12 logical CPUs, the qualifying host for L1.8.
  - `benchmark:ai-model` was re-scoped (`8e788187`) and run once.
  - Result: `locatorUpgrade` timed out at 240 s twice against the 180 s ceiling, so **FAIL**. Load,
    memory and main-loop delay PASS.
  - Evidence is in `L1.8-benchmark-full-host.json`. The 6-CPU FAIL is untouched in
    `L1.8-benchmark.json`. `awkit-djnl.1` has a note through contract `awkit-djnl-1-l18-host-0921`.
- **Still nothing eligible.** Every remaining L3/L4b/L5b/L6 item needs L1, and L7 needs all of them.
- **One owner decision left, narrower now:** re-scope the **model** or the **ceilings**. The hardware
  option is used up.
- **Do not:**
  - rerun `benchmark:ai-model` hoping for a different draw;
  - raise `deriveInferenceThreads`' cap to "use the machine", which is a product change;
  - raise the 240 s host timeout.
- **Trap:** the harness stops at the first failed scenario. So `validationExplanation`,
  `failureAnalysis`, `cancel`, `playwright` and `batch` have never run on any host, and a future GO
  needs every one of them.

## HANDOFF (2026-09-21, superseded) — L5a closed on the owner's acceptance of INCONCLUSIVE; only L1.8 remains to decide

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:**
  - The owner accepted L5a as INCONCLUSIVE, and `awkit-djnl.7` is closed on it. Tracker: 9
    outstanding / 293 closed.
  - The gate is NOT PASS, and the acceptance does not cover the two later capture-path changes. DECISIONS
    and the L5 plan's "L5a acceptance" section say so.
- **Still nothing eligible.** L5b depends only on L1 now. Its automatic analysis and
  `verify:ai-error-quality-live` need a live model, like every other remaining L3/L4b/L5b/L6 item. L7
  is blocked by all of them.
- **One owner decision left:** **L1.8.** Re-scope the model, the ceilings or the qualifying hardware.
  Check first: mask `0x3F` is 3 physical cores on a 6-core/12-thread part.
- **Do not** re-run the L5a gate to "upgrade" the result without a new owner decision. A later approved
  run on a quiet host would replace the accepted outcome.

## HANDOFF (2026-09-21, superseded) — the L5a rescan is regression-verified; still no independently eligible Phase L work

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:**
  - `verify:runner` ran, 138/0.
  - `summary.residualSecrets` now counts only stored replacements. Dropped and retracted occurrences
    had been counted.
  - L5b now has proof that a pre-rescan report carrying a residual is refused before the model.
  - CURRENT_STATE has the numbers.
- **Re-checked against the tracker and the L3/L4b/L5b/L6 plans:** `bd ready` offers only the epic and
  L5a, and L5a's one open criterion is the overhead gate. Everything else is as the superseded handoff
  below says: L1-gated, deliberately declined (L6 mapping review), or blocked by those (L7).
- **Owner decisions needed (unchanged):**
  1. **L1.8:** re-scope the model, the ceilings or the qualifying hardware.
  2. **L5a:** pick a host without the batch stall, remove its cause, or accept INCONCLUSIVE. Any
     approved run now measures a capture path two changes newer than `a2125084`.
- **Trap:** this session's permission classifier refused to run a verifier against a temporarily
  weakened `AiPromptBuilder` rescan. Pin a refusal with a precondition that calls the real layer
  instead of mutating a security check.

## HANDOFF (2026-09-21, superseded) — L5b analyses are saved with their run report; no model-independent Phase L work remains

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** `626d92fe` built the L5b `diagnostics` persistence extension. It was the last
  model-independent item in L3, L4b, L5b or L6. The L5 plan's "L5b analysis persistence as built"
  section has the detail.
- **A new assist that stores an AI answer should reuse this pattern:**
  - store the answer where its subject lives;
  - make what is shown what is stored (`SemanticRedactor` + `findResidualSecrets`, refuse on a
    residual);
  - write through `updateWith`, so a deleted subject is never resurrected;
  - add delete with the creating permissions and no policy check.
- **Nothing else is eligible without an owner decision.** What remains:
  - L3 production callers (§7/§8/§9), the idle scheduler, L4b/L5b live callers, L5b's automatic
    analysis and every `*-quality-live` gate all need the L1 go/no-go.
  - L6's T1 mapping review was deliberately declined: it would invent a flow-level input declaration.
  - **L7 cannot be entered.**
- **Owner decisions needed:**
  1. **L1.8.** Re-scope the model, the ceilings or the qualifying hardware. Check first: mask `0x3F`
     is 3 physical cores on a 6-core/12-thread part.
  2. **L5a.** Pick a host without the batch stall, remove the stall's cause, or accept INCONCLUSIVE.
     Do NOT re-run the gate.
- **Follow-ups, done the same day:**
  - The `SemanticRedactor` gap for `password: {value}`, quoted values with spaces and nested object
    values is FIXED (KNOWN_ISSUES, CURRENT_STATE).
  - L5a's `EvidenceBuffer` now has the residual-secret rescan. A flagged field becomes `[redacted]` and
    the event stays.
  - The PEM header is the residual fixture both suites use.
  - **The L5a gate evidence predates the rescan.** If the owner approves another gate run, it measures
    the current capture path.
- **Tracker:** `awkit-djnl.8` has a note, added through contract `awkit-djnl-8-l5b-persist-0921` and a
  released `project-state` lease. 10 outstanding / 292 closed.
- **Trap:** the guard refuses newlines and `<` `>` in `git commit -m`. Attribution goes inline, as
  `(Co-Authored-By: Claude Opus 5)`, like earlier commits.

## HANDOFF (2026-09-21, superseded) — L5a Option C ran once and is INCONCLUSIVE; the gate rules are unit-proven; L1.8 still FAILS

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Owner decisions, recorded in DECISIONS and the L5 plan:**
  - Option C: 21 × 1 on the development machine, run once.
  - p95 is a binding yes/no check at 21 samples.
  - The order-statistic median interval is policy.
  - Ceilings unchanged, no VMware claim.
- **Result:** the single run is **INCONCLUSIVE** (0 FAIL, both p95 PASS, bytes PASS), and there is no
  product defect. **L5a stays open. Do NOT re-run the gate**: the owner said run once, and a batch-level
  host stall (17 of 42 batches, both modes) keeps the 21-round interval at about ±300 ms against a 150 ms
  ceiling. The KNOWN_ISSUES entry lists what not to do.
- **Next owner decision:** a host without the stall, the stall's cause removed, or accepting
  INCONCLUSIVE. None is adopted.
- **Tooling:**
  - The gate rules live in `scripts/lib/failure-capture-gate.mts` and are proven by
    `npm run verify:failure-capture-gate-stats` (unit, 47/47).
  - `verify:failure-capture-overhead` only gates at 21 × 1. Anything else is gate NOT RUN (exit 2).
  - Raw runs append to `docs/plans/ai-upgrade-v5/evidence/L5a-overhead-gate.json`, now 3 runs.
- **Unchanged:** L1.8 FAILS, the conditional development authorization stands, L4b/L5b/L6 stay open, and
  **L7 cannot be entered**. Still 10 outstanding / 292 closed.

## HANDOFF (2026-09-21, superseded) — L5a's gate methodology is decided and measured INCONCLUSIVE; L1.8 still FAILS

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Owner decision, recorded in DECISIONS and the L5 plan:**
  - L5a's duration gate is **B + D + E on the development machine**.
  - p95 is informational below 21 samples per mode.
  - Ceilings are unchanged.
  - VMware is not required for L5a, and no VMware claim is made.
- **Measured: INCONCLUSIVE twice, no FAIL, no bottleneck. L5a stays open.** Do not re-run the gate
  hoping for a PASS. At 7 rounds the 95 % interval is [min, max], so one noisy round decides, and a
  re-run adds no information. Change the method only on a new owner decision.
- **Next owner decision:** option C (21 rounds, about 3× the runtime, which makes the interval
  [x(6), x(16)] and p95 binding) or accept INCONCLUSIVE as the development-host outcome. Neither is
  adopted.
- **How the gate reads now:** `npm run verify:failure-capture-overhead` exits 0 on PASS, 1 on FAIL and 2
  on INCONCLUSIVE, or when an env override leaves the approved 1-instance configuration.
  `npm run benchmark:failure-capture-saturated` is informational only. Both append raw runs under
  `docs/plans/ai-upgrade-v5/evidence/`.
- **Traps met this session:**
  - The lease guard refuses `tail`, `where`, `npx tsx -e`, env-prefixed commands, background commands,
    and `npm run verify:x -- <args>`. Only bare `npm run verify:*` and `npm run benchmark:*` pass, which
    is why the saturated mode has its own npm script.
  - An unquoted `.beads/**` in `agent:lease-grant` is expanded by bash into file names. Quote it.
  - A task contract's `working_tree_expected` accepts only `clean` or `preserved_changes`, and every
    preserved entry needs a git status and a SHA-256.
- **Unchanged from the previous handoff:** L1.8 FAILS, the conditional development authorization
  stands, L4b/L5b/L6 stay open, and **L7 cannot be entered**. Still 10 outstanding / 292 closed.

## HANDOFF (2026-09-21, superseded) — Phase L's L4b, L5b and L6 surfaces are in the app; L1.8 still FAILS

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Read this first:** everything below is proven with the **deterministic provider only**, under the
  owner's conditional development authorization. L1.8's FAIL is unchanged, L5a's methodology is still the
  owner's call, and **nothing may close**. Do not describe any of it as live-model acceptance.
- **Commits, all pushed to `main`:** `8ee425a1` (L4b in the Flow Designer + the shared IPC boundary +
  the test provider seam), `63d0a3cb` (L6 fragment dialogs + the shared `useAiAssistJob` hook),
  `cf9bbb32` (L5b in the run-detail drawer), then the state commit.
- **The boundary:** `app/main/ai/aiAssist.ts` behind `ai:explainValidation`, `ai:summarizeFragment`,
  `ai:analyzeFailure` and `ai:cancelAssist`. The renderer names data, main re-reads or re-validates it and
  reuses each milestone's own request builder and parser. A new assist feature should add ONE function
  there and ONE channel, and must be admitted deliberately in the exact rosters of
  `verify:ai-permissions` and `verify:ai-fallback` (both fail on an unlisted channel — by design).
- **The test seam:** `AWKIT_TEST_AI_PROVIDER=<file>` makes a NON-PACKAGED build use `FakeAiHostTransport`,
  re-reading the file for every inference (write the next `FakeInferStep` before each UI action).
  `verify:ai-assist-gui` is the worked example, including seeding a failed run through the real
  `SqliteRuntimeStore`.
- **Deliberately not built:** L6's T1 parameter-mapping review (runtime inputs live on workflows — a Flow
  Designer mapping UI would invent a flow-level declaration); L5b's automatic post-run analysis and the
  diagnostics persistence extension; every `*-quality-live` gate; every production (live-model) caller.
- **Tracker:** `awkit-djnl.6` and `.8` are now `in_progress` with notes; `.9` and `.1` gained notes. Done
  through contract `docs/ai/contracts/awkit-djnl-phase-l-ui-0921.json` and a released `project-state`
  lease. Still 10 outstanding / 292 closed.
- **Traps met this session:**
  - The lease guard refuses a `;` anywhere in a shell command, **including inside a quoted `bd --notes`
    string** — reword with commas. Two such refusals count toward the shared 3-denial limit.
  - Leaving the Flow Designer with unsaved edits raises the unsaved-changes guard, so a GUI suite that
    navigated away silently stayed on the designer until it clicked *Discard Changes*.
  - Identical coalesced failures carry identical evidence ids, so "the named instance was analysed" is
    only testable when that instance has an event the group's first member lacks.
- **Next eligible work, in order:** (1) the L5a overhead-gate methodology, once the owner decides;
  (2) the production callers and `*-quality-live` gates, after the owner resolves L1.8. **L7 cannot be
  entered** — every confirmation it asks for depends on L1.8 or the L5a gate.

## HANDOFF (2026-09-21, superseded) — Phase L's AI-dependent cores are BUILT under a conditional authorization; L1.8 still FAILS

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**. Every new gate is a
  Phase L gate, not a comprehensive-validation case, so nothing moved.
- **Read this first:** the owner separated *permission to develop* from *permission to accept*
  (`docs/ai/DECISIONS.md`, 2026-09-21; `L1-ai-foundation.md` › *L1 status: PARTIAL PASS*). L1.8's FAIL
  is unchanged and unsoftened. Every AI-dependent milestone was built against the **deterministic
  providers**, and **none of them may close**.
- **Commits, all pushed to `main`:** `694bc6f0` (L1 partial-pass record), `387d9a37` (L3 §8 repair),
  `3b9dc30f` (L3 §9 sweep), `510bdbe2` (L4b), `eacfb88c` (L5b), `3054e7e5` (L6 Intelligence).
- **What is now built** — the model-independent core of every AI-dependent milestone:

  | Milestone | New module | Gate |
  |---|---|---|
  | L3 §8 runtime repair | `src/runner/locatorProof.ts` (repair gates), `mode: "repair"` | `verify:ai-locator-repair` 85/85 |
  | L3 §9 health sweep | `src/ai/locatorSweep.ts` | `verify:ai-locator-sweep` 60/60 |
  | L4b authoring | `src/ai/authoringExplanation.ts` | `verify:ai-authoring` 55/55 |
  | L5b failure intelligence | `src/ai/failureAnalysis.ts` | `verify:ai-error-analysis` 76/76 |
  | L6 Intelligence | `src/ai/fragmentAssist.ts` | `verify:ai-fragment-assist` 59/59 |

  Each was mutation-tested (3–4 mutations each, all caught) and each has its "as built" section in its
  plan file.
- **The one thing none of them has is a production caller, and that is ARCHITECTURAL.**
  `verify:ai-fallback` proves *no module the execution tree can reach, at any depth, reaches the model*,
  and `AiService` lives in the main process. Wiring any of these into the runner or the Recorder would
  break that green guard. It is the same L1-gated boundary L3 §7 recorded, and it is the **first thing
  to build once the model decision lands** — not a gap to patch around.
- **Do not re-run the long benchmark.** L1.8 is recorded in
  `docs/plans/ai-upgrade-v5/evidence/L1.8-benchmark.json` and `L1.8-inference-profile.json`.
- **Owner decisions still required, unchanged in kind:**
  1. **L1.8** — re-scope the model, the ceilings, or the qualifying hardware. Worth confirming first:
     mask `0x3F` selects logical CPUs 0–5, which on a 6-core/12-thread part is **3 physical cores**.
  2. **L5a's overhead gate** — the methodology (rounds, median definition, host). Recommendation B+D on
     the VMware target, reported with E (`L5-failure-evidence-and-analysis.md`). L5a stays open on it.
- **One gate is BLOCKED and it is structural.** `isAllowedUnleasedShellCommand`
  (`tools/agents/lease-guard.mjs:474`) omits `isProjectStateCommand`, so **every mutating `bd` verb is
  unreachable in the direct loop** and needs a routed `project-state` lease. The tracker is therefore
  untouched at **10 outstanding / 292 closed** — which is also the state the decision calls for, since
  nothing may close. A `project-state` agent should add the authorization note to `awkit-djnl.1`.
- **Next eligible work, in order:** (1) the L5a overhead-gate methodology, once the owner decides;
  (2) renderer surfaces for L4b, L5b and L6 Intelligence, which are model-independent and were left out
  only for scope; (3) the production callers, after L1.8 resolves. **L7 cannot be entered** — every
  confirmation it asks for depends on L1.8 or the L5a gate.

## HANDOFF (2026-09-20) — L1.2 pinned and committed; L1.8 FAILS on measured throughput

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**. `verify:ai-model-live`
  is a Phase L gate, not a ledger case, so nothing moved.
- **Commits:** `a28050c7` (L1.2 pin) and `8eca0eee` (harness evidence + L1.8 measurements). Pushed.
- **The Node blocker is GONE and L1.2 is COMPLETE.** The prebuilt `llama-addon.node` is really present.
  `verify:ai-model-pack` **46/46, `1 pinned pack(s)`**; inside `verify:ai-model-live` the pack/pins 3/3
  and the real `AiModelPackStore` import 3/3 both PASS. Portable Node 22 was used for the *install
  only* — system Node is still 18.16 and the product depends on neither.
- **L1.8 is NOT accepted, and this is the live blocker.** Load 50,101 ms (ceiling 60,000), peak working
  set 3,550 MB (ceiling 6,144), main-loop p99 21 ms (ceiling 100) all PASS; the `locatorUpgrade`
  background job **FAILS 180,000 ms**, taking >240,000 ms without producing 192 tokens. Through
  `AiService`, a ~250-token prompt capped at 128 tokens does not finish in 120 s — under ~1 token/s.
- **Compute-bound with the model resident — NOT disk, NOT threads.** The 50 s cold load suggested slow
  storage (~54 MB/s); the resource sample **overturned** that. Across 240 s of inference CPU is a flat
  line (avg 25 / max 26) at ~3× the 8 seen during the single-threaded load — exactly the 3 configured
  threads — with the working set resident at 3,550 MB. Warm load is 10,488 ms, so storage is a
  cold-start cost only. *Caveat:* Electron `percentCPUUsage` normalization is ambiguous; trust the flat
  line and the 3:1 ratio, not the absolute value.
- **Do NOT re-run the long benchmark to reproduce this.** It is recorded in
  `docs/plans/ai-upgrade-v5/evidence/L1.8-benchmark.json` and the bench resumes per scenario.
- **The one thing still not isolated: prefill vs constrained decode.** The host returns timings only on
  completion and these runs never complete. Leading hypothesis is JSON-schema GBNF sampling over a
  ~151k vocabulary on every token; **hypothesis, not a finding.** Testing it means touching
  `native-hosts/**`, which is `runtime`-owned Risk-3 and **not** authorized by this task's contract.
- **Next agent work:** the owner decision below. Nothing in Phase L that depends on L1 is eligible, and
  fake-provider tests must never be presented as live acceptance.
- **Owner decision required:** (1) authorize a `runtime`-routed change to report host timings on
  timeout or add a grammar-off probe, so prefill vs decode can be separated; then (2) if constrained
  decode dominates, revisit the decoding strategy; **or** (3) accept that a 4B Q4_K_M on a 2018 6-core
  mobile CPU is below the bar and re-scope the model, the ceilings, or the qualifying hardware.
  **No ceiling was moved and no timeout was raised to hide throughput.**

## HANDOFF (2026-09-20) — model pack acquired and verified; runtime blocked on Node 18.16 vs ≥20

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**. No product source changed.
- **Model pack DONE.** `%USERPROFILE%\Downloads\Qwen3.5-4B-Q4_K_M.gguf`, **2,707,513,696 bytes** and
  SHA-256 **`25082a7d…1418c`**, both exact. Read from the file, not assumed: `GGUF v3`,
  `general.architecture = qwen35`, `qwen35.context_length = 262144`, 426 tensors.
- **Runtime IMPOSSIBLE on this machine.** `node-llama-cpp@3.21.1` declares `engines.node >= 20.0.0`;
  Node here is **v18.16.0**. Postinstall crashes on import attributes. `--ignore-scripts` does NOT help:
  all 13 platform prebuilts (incl. `@node-llama-cpp/win-x64`, the native binary) are optional deps that
  also need Node ≥20, so npm skips them silently and `node_modules/@node-llama-cpp/` ends up **empty**.
  Reverted to zero diff via `npm uninstall` (the raw install had churned `package-lock.json` by 2059
  lines / 238 deletions under npm 9.5.1).
- **Two traps worth carrying forward.** (1) A failed `curl` inside a command chain still reported task
  **exit 0** because `ls` ran last — the download had actually died at 1.08 GB with `curl: (56)`, leaving
  a **truncated fragment under the correct filename**, which is exactly what a `Downloads\*.gguf`
  existence check calls "present". Verify size *and* checksum. (2) `verify:ai-model-live` did **not**
  fail open on the half-install — it checks for the prebuilt, not the package.
- **L1.2 deliberately NOT written.** The pack half is measurable now, but `src/offline/**` is the Risk-3
  offline boundary owned by the release role; L1.2 also needs the llama.cpp runtime pin (impossible
  without a runtime) and the third-party notices; and no entry can be validated end to end while nothing
  can load the model. `AI_MODEL_MANIFEST` stays empty, `AI_RUNTIME_PIN.build` stays null. **L1.8 NOT RUN.**
- **One decision blocks everything: upgrade Node to 20/22 LTS, or not.** That is a toolchain change, not
  part of the acquisition — 233 verifiers, the `tsx` harnesses and `electron-builder` all pass on 18.16
  today, and the repo declares no `engines` field. Upgrading enables one complete, validated
  L1.2 + L1.8 pass. **Do not upgrade Node on an agent's own initiative.**
- **Next agent work without the runtime: still none in Phase L.**

## HANDOFF (2026-09-20) — L1 artifacts still absent; structural coverage is now declared and enforced

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**. No validation case moved.
- **L1.2 and L1.8 are still BLOCKED, re-checked on this machine.** `node-llama-cpp` is absent from
  `package.json`, `node_modules/` **and the npm cache**, so there is no offline install path either; no
  `.gguf` exists in `Downloads`, `%LOCALAPPDATA%/SpecterStudio` or any staging location.
  `verify:ai-model-live` → **NOT RUN**. **No live-model inference ran; no live acceptance is claimed.**
  No manifest entry was written — every field it needs (size, SHA-256, compatibility) must come from the
  real artifact, and inventing them is what the model-pack contract exists to refuse.
- **Built: `guards` — structural coverage on the EXISTING registry, enforced by the EXISTING gate.**
  `VerifierClassification.guards` lists the repo-relative paths a verifier reads *as data* (not what it
  exercises — that is `class`). Declared for the six verifiers whose scan targets I confirmed **by
  reading their source**: `ai-fallback`, `failure-capture-overhead`, `ai-host`, `ai-permissions`,
  `ipc-contract`, `flow-fragments` (23 paths). `verify:verifier-classification` now fails if a declared
  path stops existing, and prints a **Structural coverage** index — *edit a path on the left, run the
  gates on the right*. `src/runner` now resolves to exactly the two gates that had been red.
- **Two stale `why` strings fixed.** Both still described the pre-fix semantics; they went stale in the
  same commit that fixed the checks.
- **Deliberately NOT built: automatic impact-based selection.** The index tells you what to run; nothing
  runs it for you. The precise requirement for diff-driven auto-selection is written into
  `DEVELOPMENT_WORKFLOW.md` § 4 as a **separate, unscheduled roadmap item** — it must reuse `guards`, and
  it does not belong inside an L-series task. **Promoting it to a tracked bead is an owner call**; I did
  not file one, because that moves tracker baselines for work nobody has scheduled.
- **Mutations (contracts written after the runs):** a renamed guards path caught; a collapsed coverage
  map caught by the non-vacuity floor. Both reverted.
- **L5a unchanged.** No owner methodology decision exists, so ceilings, rounds and evidence are untouched
  and L5a stays open. `verify:failure-capture-overhead` was **not re-run** — its inputs did not change and
  the previous session already recorded three verdicts on identical code.
- **Next agent work without the model: still none in Phase L.** L3 §8/§9, L4b, L5b and L6 Intelligence all
  need the L1 go/no-go. The two owner commands are unchanged in
  `docs/plans/ai-upgrade-v5/L1-ai-foundation.md` § "Owner steps".

## HANDOFF (2026-09-20) — L1 is still owner-blocked; two AI boundary guards were silently red

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**. No validation case moved.
  This is verifier-correctness work on the L1 boundary; no product behaviour changed.
- **L1's two owner artifacts are still absent, re-checked on this machine rather than inherited.**
  `node-llama-cpp` is in neither `package.json` nor `node_modules/`; no `.gguf` exists in `Downloads`
  (readable, 59,082 files) or under `%LOCALAPPDATA%/SpecterStudio`. `verify:ai-model-live` reports
  `NOT RUN`. **Outcome B: no live-model acceptance was produced or implied.** The two commands are
  unchanged and are quoted verbatim in `docs/plans/ai-upgrade-v5/L1-ai-foundation.md` § "Owner steps".
- **Found and fixed: `verify:ai-fallback` was 34/2 (documented 36/36) and
  `verify:failure-capture-overhead`'s structural check was red.** Both regressed when L3 put pure modules
  under `src/ai/` and added three IPC channels, and neither L3 session re-ran them. **Nothing in the
  product was wrong** — verified by inspection: `locatorPlan` → `FlowProfile` + `AiOutputContract` (zero
  imports); `pendingUpgrade` → `node:crypto`, `locatorApproval`, `AiAutonomyPolicy`. No transport anywhere
  in the chain. The three channels are permission-gated and sanitized (`verify:ai-permissions` 75/75).
- **The guards were strengthened, not relaxed.** The boundary is now *reachability to the model* rather
  than a folder or `Ai*` name. `verify:ai-fallback` walks the full transitive closure (162 modules from
  122 files) and prints the offending chain; the old one-hop scan **could not see a two-hop reach at all**.
  A vacuity hole was also closed — the preload roster's `.every()` had no cardinality pin.
- **Mutation-tested four ways, each contract written after running the mutation:** direct reach, two-hop
  reach (the case the old check missed), a smuggled `ai:describeThing` channel, and a collector → service
  reach. All caught, all reverted.
- **`verify:failure-capture-overhead` is still FAIL — the L5a gate, not this change.** Its structural
  check is green. The overhead ceilings flapped **three times on identical code in one session**: all
  green, then `evidence median 392 ms` + `p95 1064 ms` red, then `fast median 170 ms` red (ceiling 150 ms).
  **This is fresh evidence for the outstanding owner methodology decision** — no ceiling was touched.
- **Next agent work without the model: still none.** L3 §8/§9, L4b, L5b and L6 Intelligence all need the
  L1 go/no-go. L5a's methodology remains an **owner decision**, not engineering. The model-independent
  surface of Phase L is exhausted.

## HANDOFF (2026-09-20) — task contracts can be retired now, and 16 closed ones were

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**. No validation case moved.
  This is agent-governance and repository-retention work; no product behaviour changed.
- **Root cause fixed, not worked around.** `docs/ai/contracts/README.md` has always said a closed task's
  contract is DELETED, and nothing could ever do it, so ~70 accumulated. The lease guard's shell grammar
  is a closed allowlist of command FORMS with **no deletion verb in it**, so `rm`, `Remove-Item` and
  `git rm` were refused as *forms* — no lease granted deletion and none ever would.
  `agent:lease-finalize` could not serve: its terminal paths REQUIRE the contract to exist.
- **New: `node tools/agents/contract-cleanup.mjs --task <id>` (also `--all`, `--dry-run`).** It is the
  guard's only deletion verb and can only ever remove a task contract. It takes a bare task id, never a
  path. Eligibility comes only from trusted repository state — `complete`, the **shared** task gate, a
  `task.id` matching the filename, no active lease naming it, and a `closed_at_commit` that is an
  ancestor of `HEAD`. Anything unverifiable is REFUSED and kept. It touches the working tree only; the
  guard's existing `git add --`/`git commit -m` forms already record the deletion, so no Git grammar was
  widened.
- **Done: 16 removed, 54 refused**, each independently gated, including this task's stated goal
  `awkit-djnl-9-protected-login-0920`. Every in-flight Phase L contract was correctly **kept**
  (`awkit-djnl-9-l6-ui-0920`, `awkit-phase-l-l0-0919`, `awkit-phase-l-roadmap-0919`,
  `awkit-djnl-1-l1-0919`, `awkit-djnl-1-runtime-0919`). **A retained contract is not a blocker**, and a
  released `active-lease.json` pointing at a deleted contract is the expected steady state — confirmed by
  running `agent:lease`, not assumed.
- **`awkit-djnl.9` is still open and `in_progress`, and its `blocks` edges are untouched.** Nothing about
  L6's status changed here. L6's Intelligence section remains unbuilt and L1-gated. **Next agent work
  without the model: still none in L6.**
- **Not done, deliberately: no temporary-artifact cleanup.** The repository has no policy authorizing an
  agent to delete anything other than a task contract. Rather than grant broad removal rights, the
  missing policy decision is recorded in `KNOWN_ISSUES.md` for an owner to decide. No such artifact
  currently exists in the tree.
- **Checks:** `build` PASS · `typecheck:scripts` PASS · `verify:agent-routing` 1140/1140 (pin re-pinned
  1111 → 1139 for 28 new checks) · `verify:source-hygiene` 11/11 · `verify:verifier-classification` 233 ·
  `verify:roadmap-dashboard` 177/177 "Sources agree" · `git diff --check` clean. Mutation-tested three
  ways (completion check, task-id scope guard, command form), each caught, all restored.
- **Nothing is blocked.** The previous section's "BLOCKED, and it needs one owner command" was resolved
  in the prior session by the two-commit split (`2202e933`, `9fc159a8`, closeout `b7d80020`).

## HANDOFF (2026-09-20) — L6 deterministic acceptance end to end, and the protected-login consolidation

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**. No validation case moved.
- **Done:** `verify:flow-fragments-e2e` (52/52, `real-browser`) — capture in the real Flow Designer,
  insert, wire with the canvas's own drag-to-connect, save, reopen, edit, re-save, then **run for real**
  through `execution:runWorkflow` with the bundled Chromium against the Feature Test Lab. The previous
  section's one explicit `NOT RUN` ("end-to-end execution of an inserted fragment through the real
  runner") is now executed and passing.
- **Also done, and both were product fixes, not test fixes:**
  - `SearchableSelect` re-opened itself on every selection because `EditorIdentityField` wraps it in a
    `<label>`, whose activation behavior re-dispatches a synthetic click onto the trigger. Live in all
    five places the control is mounted. One `preventDefault` on the popup.
  - `ExecutionApplicationService` now refuses a real run whose declared required runtime inputs are
    unsupplied, instead of letting `ValueResolver` substitute `""`.
  - `GET /api/submissions` on the mock site, because `/success?id=` renders an empty record for an
    unknown id and the counter starts at `SUB-1001` — so the old "nothing was submitted" check was
    vacuous.
  - `PROTECTED_LOGIN_STEP_TYPES` consolidated: `AiAutonomyPolicy.ts` and `FailureEvidenceCollector.ts`
    import the canonical set. Membership unchanged. The `verify:flow-fragments` §12 drift guard was
    retargeted at the wiring plus real `decideAiAction` behaviour.
- **`awkit-djnl.9` is still open and `in_progress`, and its `blocks` edges are untouched.** L6's
  Intelligence section is unbuilt and L1-gated. **Next agent work without the model: still none in L6.**
- **Independent QC is now DONE: `APPROVED_WITH_FINDINGS`, zero blocking findings.** An independent
  `awkit-qc-reviewer` reviewed the consolidation and confirmed membership is identical at all three
  consumption sites, the `ReadonlySet<string>` widening is compile-time only (`Set.prototype.has` does
  not consult types, so the matched values are byte-identical), nothing was broadened or weakened, and
  `src/profiles/FlowProfile.ts` has **zero imports** so it cannot cycle back into `src/security/**`. Two
  findings were acted on in this session: the competing-copy scan now asserts that neither consumer
  **names** any member at all (construct-independent, mutation-tested against an array-literal copy that
  the old `new Set([...])`-only scan would have missed), and the `failure-evidence` evidence note was
  corrected — that suite never exercises the suppression path; `verify:ui-error-evidence` (85/85, §11)
  does. One accepted residual: only the security consumer is pinned by BEHAVIOUR, so a change to
  `FailureEvidenceCollector.ts:278` that consulted a different list while keeping the alias would still
  pass §12. The full verdict was recorded on the contract's `qc_review` block; that contract has since
  been retired under the retention rule, so it now lives in history —
  `git show b341536f:docs/ai/contracts/awkit-djnl-9-protected-login-0920.json`.
- **BLOCKED, and it needs one owner command.** The staged index spans four ownership domains plus one
  protected path, and the guard's only two commit routes each require a single-lease or
  zero-protected-path index. There is no unstage in the grammar. Run
  `git restore --staged -- src/security/authz/AiAutonomyPolicy.ts` (or just commit from your own
  terminal). Full reasoning in `KNOWN_ISSUES.md`. **Nothing is lost** — every change is preserved in the
  index and working tree.
- **Also blocked:** `l6-e2e-openflow-failure.png` (inspected, synthetic fixture data only, no secrets) is
  the sole remaining scope escape on the contract's completion gate, and `rm` is not in the guard's
  grammar at all. Run `rm l6-e2e-openflow-failure.png`.
- **Two traps worth carrying forward** (both written up in `KNOWN_ISSUES.md`): `agent:lease-amend` on a
  path outside the holder's ownership **REROUTES and releases the lease** rather than widening it; and a
  single `MutationObserver` callback's live attribute read hides a `true`→`false` pair inside one
  microtask — iterate `records`.

## HANDOFF (2026-09-20) — L6 deterministic core AND the Flow Designer fragment UI, committed

- **The previously-uncommitted work is committed and nothing was lost.** The "TERMINAL `git add`" blocker
  recorded by the previous session **was not an authorization wall — it was a command-form error**, and it
  cost that session its entire closeout. The unleased grammar in `tools/agents/lease-guard.mjs`
  (`isUnleasedGitCommand`) accepts exactly `git add -- <paths>`: the literal `--` separator is required,
  and every path must be non-Risk-3. `git add -A` and `git add <path>` both fail that shape and are
  refused with a message about leases, which reads like an authorization denial and is not one. None of
  the 16 L6 paths is Risk-3 (`packaging_change` is deliberately NOT in `RISK_3_FLAGS`, so even
  `package.json` is ordinary). **Read the guard's grammar before believing a denial.**
- **Also available unleased, and the previous session concluded otherwise:** `npm run agent:lease-grant --
  --task <id> --holder <holder> --paths <paths>` IS in the unleased allowlist (`isLeaseGrantCommand`), as
  is writing a task contract under `docs/ai/contracts/`. What is refused is the *other* spelling,
  `node tools/agents/lease-cli.mjs …`. So a Risk-3 lease **can** be obtained from a direct-work session.
- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** the L6 audit-first matrix, deterministic features 1–3, and the Flow Designer surfaces.
  `src/fragments/FlowFragment.ts`, `src/fragments/fragmentOperations.ts`, `app/main/ipc/fragment.ipc.ts`,
  `app/renderer/components/workflow/FragmentDialogs.tsx`, `verify:flow-fragments` (97/97, `integration`)
  and `verify:flow-fragments-gui` (53/53, `real-browser`). Its blocks edge on `awkit-djnl.6` (L4b) is
  untouched and it is **not** closed.
- **`awkit-djnl.9` tracker status:** see the note at the end of this section for what was and was not
  moved. Mutating `bd` needs a `project-state` lease, which IS obtainable (see the second bullet above).
- **Why L6 at all, when `bd ready` does not list it.** L6 is blocked by L4b → L1 → the owner's model
  acquisition. The *deterministic* features need only L2 (closed) and L4a (closed); the ROADMAP's gating
  sentence is scoped to "**AI parts of** L6". Same precedent as L3. The full boundary argument is in the
  L6 plan — read it before touching the dependency graph.
- **Next agent work without the model: none in L6.** Everything left in L6 is the *Intelligence* section
  (semantic fragment discovery, T0 summary, T1 parameter mapping, the passive hint), which is L1-gated.
  Across Phase L the model-independent surface is now: **L5a's gate methodology, which is an OWNER
  decision, not engineering** (options A–E are recorded in the L5 plan; the brief states plainly that "a
  new optimization needs a profile that shows new cost, not another gate run"). L3 §8/§9, L4b and L5b all
  need the L1 go/no-go.
- **Where L6 stops now.** The UI exists and is proven in the real app: **Save as fragment** and **Insert
  fragment** in the Flow Designer command bar, `verify:flow-fragments-gui` **53/53**. What remains in L6
  is the entire *Intelligence* section, which is L1-gated. `awkit-djnl.9` stays **open**.
- **The two write paths are different ON PURPOSE — do not "unify" them.** Capture goes through
  `fragments:capture` (created in main, from the stored flow, via `create`, which refuses a duplicate id;
  there is no blind-write import channel). Insert deliberately does **not** call `fragments:apply`:
  that channel writes the *stored* flow, which bypasses the editor and yields an insertion the user
  cannot undo and that the next save of an already-dirty document silently overwrites. Insertion is an
  editor transaction built by the same pure `applyFragment`, so undo/redo, dirty state and Save are the
  existing mechanisms. `fragments:apply` remains the audited store-write path for non-editor callers, and
  `verify:flow-fragments-gui` §9 proves it refuses over direct IPC and writes nothing when it does.
- **The designer's selection model is single-node (`selectedNodeId`), not a set.** The save dialog seeds
  from it and then lets the user check steps. Do not add marquee multi-select to "fix" this without an
  explicit canvas decision — the brief that produced this work forbade redesigning the canvas.
- **Required inputs are shown, never remapped.** `runtimeInputs` live on the WORKFLOW profile, not on a
  flow, so there is no flow-level declaration to map onto; a mapping UI here would invent one, and
  rebinding would be exactly the silent substitution the audit exists to prevent.
- **Traps found here:**
  - **A lease denial is not proof that the operation is forbidden — read the grammar.** The single most
    expensive finding of these two sessions: `git add` and `agent:lease-grant` were both available the
    whole time, in one exact spelling each, and a previous session reported them TERMINAL and stopped.
    `tools/agents/lease-guard.mjs` is ~760 lines and every allowed form is a readable regex or token
    check. Reading it once costs less than one wrong "BLOCKED" in a handoff.
  - **`bd`, `git` and `npm run` work through Bash; `sed`, `grep`, `head`, `tail`, `node` and `npx` do
    not.** Use the native Read/Grep/Glob tools, and register a new verifier in `package.json` before
    trying to run it, because `npx tsx …` is refused while `npm run verify:…` is allowed. **Compound
    commands are refused outright** — `hasUnsafeShellSyntax` rejects `;  &  |  >  <  backtick  newline
    $(  ${  ^`, so one bounded command per call, and a commit message cannot contain any of them
    (which is why this repo's `Co-Authored-By` trailer is inline in parentheses rather than a real
    trailer line).
  - **A new toolbar control can break a layout contract two verifiers away.** Two labelled buttons added
    to the Flow Designer command bar overflowed it at 1024px, which `verify:flow-designer` catches as an
    escaped control. Fixed in the product (icon buttons, accessible name on `aria-label`), not by
    relaxing the assertion. Its group count is hardcoded and EXACT — a new `EditorCommandGroup` must be
    reflected there.
  - **A finding's CODE being reported is not the same as it BLOCKING.** A mutation moving
    `resolvedSecretValue` out of the blocking set survived a 94/0 suite untouched, because every secret
    assertion checked the code and none checked the severity. Assert severity per code against a declared
    table, not per case.
  - **`boundaryEdgeDropped` is raised by `captureFragment`, not by `auditFragment`.** A cardinality gate
    that watches only the audit reports it unreachable. Record findings from every producer.
  - **`JsonProfileStore.import` overwrites; `create` refuses a duplicate id.** Any new "import a
    document" channel inherits the overwrite unless it goes through `create`.

## HANDOFF (2026-09-20) — L3 §10 built (Intelligent Locator status vocabulary + evidence on demand)

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** see CURRENT_STATE and the L3 plan's "§10 as built". `awkit-djnl.4` stays `in_progress`; Beads and
  the roadmap tracker pin (10 outstanding / 292 closed) were NOT touched, because no work item opened or
  closed. New: `src/ai/locatorStatus.ts` and `verify:ai-locator-status` (85/85, `unit`).
  `verify:ai-locator-upgrade-gui` extended 24/24 → 65/65.
- **Next agent work without the model: none in L3.** §8 repair and §9 sweep both need a real job, and
  therefore the L1 go/no-go, which is BLOCKED on the owner's model acquisition. §2–§7 and §10 are the whole
  model-independent surface. Do **not** close `awkit-djnl.4`: §8, §9, `verify:ai-locator-repair`,
  `verify:ai-locator-quality-live` and the live-model acceptance all remain.
- **Where §10 stops:** the surface is complete and verified against SEEDED profiles. Nothing in production
  queues an upgrade job, so no user will see a pending candidate until L1 lands. Nothing about §10 implies
  live inference has been exercised.
- **Traps found here:**
  - **The panel's fetched view is per FLOW; its loader only re-runs when the flow changes.** Clearing the
    view on a STEP change therefore leaves it null forever, and a proposal on a flow's second step silently
    reads as "no AI suggestion". Keep the two resets scoped separately.
  - **A step's `safety`/name makes it T3 by keyword.** `resolveStepSafety` → `isDangerousMutationStep` reads
    the step NAME, so a fixture called "Delete row" is `T3_SENSITIVE_STEP` and will never be promotable. That
    is the product working; name non-T3 fixtures accordingly, and assert the precondition with
    `decideAiAction` before asserting anything it gates.
  - **`verify:flow-designer`'s broad suite reads the locator panel's prose.** Consolidating the L2 class block
    into the §10 badge moved the reason text behind the disclosure; two assertions there now open it.
  - **The docs NUL is recurrent.** See KNOWN_ISSUES: it had reappeared in three files at `ef7fa81`.

## HANDOFF (2026-09-20) — L3 §7 built (bounded attempt loop); both standing verifier failures fixed

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** see CURRENT_STATE and the L3 plan's "§7 as built". `awkit-djnl.4` stays `in_progress`; Beads and
  the roadmap tracker pin (10 outstanding / 292 closed) were NOT touched, because no work item opened or
  closed. New: `src/ai/locatorUpgradeAttempts.ts` and `verify:ai-locator-attempts` (87/87). Fixed:
  `verify:ipc-contract` (now 10/10) and `verify:source-hygiene` (now 11/11) — the two failures the previous
  handoff listed as unfixable here were both fixable.
- **Next agent work without the model:** **§10 UX** (the full badge vocabulary: Semantic · Guarded · AI
  suggestion pending proof · AI semantic capture-/replay-proven · Suggestion rejected · Auto-promoted with
  revert, plus evidence on demand). It is independent of L1 and §6 deliberately shipped only the minimum
  panel. §8 repair and §9 sweep both need a real job and therefore the L1 go/no-go.
- **Where §7 stops:** it is a complete, bounded orchestration with no production trigger. Nothing calls
  `runLocatorUpgradeAttempts`; the caller that supplies a live `Page` and an `UpgradeContext` is the L1-gated
  piece. Its integration contract is three injected dependencies — `ai` (any `AiService`), `prove` (a closure
  over `proveLocatorPlan(page, step, …)`) and `annotate` (a closure over `annotatePendingUpgrade(flows, …)`).
- **Traps:**
  - **`#` is reserved in an `AiService` request id.** `AiService` appends `#` itself to build the HOST job id,
    and its own `REQUEST_ID` pattern refuses it, so a per-attempt id suffixed `…#1` comes back
    `rejected/INVALID_REQUEST` — which looks exactly like "the provider is unavailable". Attempts use
    `…​.a1`.
  - **The plan schema is closed, so it catches things the compiler is also written to catch.** An unoffered
    strategy and a top-level `frame` key both come back `SCHEMA_REJECTED` from `AiOutputContract`, never
    `UNSUPPORTED`/`INVENTED_FRAME`. Assert the compiler's own guards directly or they can go dead unnoticed
    behind the outer layer.
  - **A step's `value` is not part of its approval binding.** `createLocatorApprovalBinding` is step type,
    step name and the locator's strategy/value — so a fixture that "edits the step" by changing `value` does
    NOT produce a `STALE` refusal. Rename it, or retarget it.
  - **The Recorder already records a `role`+name alternative for the Archive target**, which is the same
    candidate the §7 fixture proposes. "The candidate is not in `alternatives`" is therefore false for a
    reason that has nothing to do with §7; assert that the write ADDS nothing there instead.
  - **`verify:profile-store`'s block-7 harness precondition is host-load sensitive.** It measured 1.9x (FAIL)
    while Chromium verifiers were running and 17.5x (PASS) on an idle host. Run it when the machine is quiet
    before treating it as a defect. See KNOWN_ISSUES.

## HANDOFF (2026-09-20, superseded) — L3 §6 built (promotion, audit, one-click revert)

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** see CURRENT_STATE and the L3 plan's "§6 as built". `awkit-djnl.4` stays `in_progress`; Beads and
  the roadmap tracker pin (10 outstanding / 292 closed) were NOT touched, because no work item opened or
  closed. New: `src/ai/locatorPromotion.ts`, `app/main/ai/locatorUpgradeService.ts`,
  `app/renderer/components/workflow/LocatorUpgradeSection.tsx`, `verify:ai-locator-upgrade` (78/78) and
  `verify:ai-locator-upgrade-gui` (24/24).
- **Next agent work without the model:** L3 §7 (the bounded attempt loop: max 2 synthesis attempts per job,
  consumed only by real rejections, with structured deterministic feedback between them). §8 repair and §9
  sweep both need the L1 job, so they come after the go/no-go. §10 UX (the full badge vocabulary) is
  independent and can be done any time — §6 deliberately shipped only the minimum panel.
- **Where §6 stops:** nothing queues a proposal, so `pendingUpgrade` is only ever written by a test today. The
  promotion path itself is complete and proven; wiring the capture-time job to `AiService` is the L1-gated
  piece.
- **Traps:**
  - **Do not fold a fast-changing fact into a fetched view.** Dirtiness was originally part of
    `listUpgrades`'s `blockedReason`; the panel then showed "unsaved changes" for a flow that had been clean
    for twenty seconds, because its one fetch crossed the editor's report. The renderer now combines its own
    state with main's answer.
  - **Two `invoke` calls from one effect can land out of order.** The designer's clean→dirty report raced its
    own cleanup and main kept the wrong one. It now goes through one in-order lane and releases on unmount only.
  - **`loadProfile` on the flow that is ALREADY open produces an identical document**, so an effect keyed on
    the document never runs. That left the dirty baseline armed and silently adopted the user's next edit as
    "clean". Fixed with `loadToken`; watch for the same shape anywhere a ref is armed and consumed by a
    value-keyed effect.
  - **`page.waitForFunction` never awaits a promise-returning predicate** — it passes on the first tick. Poll
    with an awaited `evaluate` instead (this bit the GUI verifier before it was written properly).
  - The step's Description field and the flow's share an accessible name; only the step's is part of the
    saveable document, so dirtying the flow-level one changes nothing.
  - `verify:source-hygiene` FAILS on a literal NUL in CURRENT_STATE.md's own §4–§5 section (a previous
    session's editing tool). It cannot be fixed with Edit (a NUL is not expressible in a match string) and the
    shell text tools are outside the lease guard's command set. Anyone with a shell: strip control characters
    from that one line.
  - `verify:ipc-contract` FAILS on `recorder:start`, which IS gated — `resolveRecorderBrowser` asserts
    `PAGE_RECORDER` (or Super User for installed Chrome). The static scan cannot see a gate one call away.

## HANDOFF (2026-09-20, superseded) — L3 §4–§5 built (browser proof, pending upgrades, replay proof)

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** see CURRENT_STATE and the L3 plan's "§4–§5 as built". `awkit-djnl.4` moved open → `in_progress`
  (contract `docs/ai/contracts/awkit-djnl.4.json`); it is not closed.
- **Trap:** the lease guard accepts only `npm run agent:lease-grant -- --task ID --holder project-state --paths
  a,b,c`, and every rejected `npm run …` shares one denial counter (3 = terminal).
- **Next agent work without the model:** L3 §6 promotion. This is a single-writer job through
  `JsonProfileStore.updateWith`, deferred while the flow has unsaved editor changes. It triggers on
  `evaluatePendingUpgrade(...).state === "eligible"` plus `decideAiAction(...).decision === "autoApply"`,
  writes `locatorProvenance` (with `previous`) plus an `AiActionRecord`, and clears the pending candidate.
  After that: the §7 attempt loop and `verify:ai-locator-upgrade` (the spec names its concurrent-promotion and
  unsaved-editor cases). The L3 job that calls `AiService` still waits on L1.
- **Owner decisions (unchanged):** the L5a methodology (see the brief in the L5 plan); L1 acquisition.
- **Traps:**
  - The proof refuses any page the Recorder's DOM detector flags, including the mock site's `/login`
    (it has a password field). Use a neutral page for "navigated away" fixtures.
  - A failing step throws before `recordPendingReplay`, so a mutation of its `stepPassed` check survives
    any test that only uses a failing step. The verifier calls the hook directly.
  - `getByRole(..., { name })` is a substring match: "Remove" also matches "Remove all cards".

## HANDOFF (2026-09-19, superseded) — L3 plan compiler + intent guard built; L5a decision brief written

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** `src/ai/locatorPlan.ts` (L3 §2–§3) with `verify:locator-plan` 53/53. `awkit-djnl.4` stays
  OPEN because it depends on L1. Beads were not touched.
- **Owner decisions needed:** (1) the L5a methodology. The brief in the L5 plan recommends odd rounds, one
  instance per workload, the VMware host and a three-way verdict. (2) L1 acquisition (unchanged).
- **Next agent work without the model:** L3 §4 proof gates (A–D against the guarded baseline's element in a
  real browser) and the §5 `pendingUpgrade` write, clear and replay-proof tally, both driven through the fake
  provider. These should get a mock-site scenario under `/recorder-lab/`. The first caller of
  `evaluateLocatorPlan` must feed it `boundValueSources(actions)` plus the action's own value and any
  data-source column values.
- **Not run:** the `verify:locator-plan` mutation run (refused by the permission classifier). Suggested
  mutations: disable the bound-value check in `guardLocatorPlanIntent`, or the `INVENTED_FRAME` key check.

## HANDOFF (2026-09-19, superseded) — L2 closed in Beads; licensing-recommendation findings reconciled

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** `awkit-djnl.3` CLOSED through a project-state contract and lease
  (`docs/ai/contracts/awkit-djnl.3.json`); `.beads/issues.jsonl` exported.
- **Licensing recommendations (external `Licensing Enforcement Recommendations.txt`, not in the repo):**
  four of its six findings were already fixed on `main` before this session and were re-verified, not
  re-implemented: the interval/focus revalidation sweep (`licenseEnforcementService.ts`, since
  `d2df8e3`/`56739ea`), the shell-free issuer spawn (`packaged-license.mts`), the `awkit-1cc` roadmap
  comment and the `gui-verify-harness.mjs` whitespace. `6c28d46` closed the real remaining gaps: the Test
  Lab artifact verifier now exits **2** on BLOCKED (was 1, same as FAIL), with a new fixture-driven exit
  contract gate `verify:test-lab-cli-only-exit`, and a failed issuer spawn no longer leaks the key path
  through Node's echoed argv.
- **Owner decisions needed (unchanged):** L5a gate methodology; L1 acquisition.
- **Not run:** packaged walkthrough and clean-machine (no authorized issuer key
  `AWKIT_PACKAGED_LICENSE_ISSUER_KEY` on this host, BLOCKED); Element Spy mutation run (still NOT RUN).
- **Trap:** the lease guard refuses `<` and `>` anywhere in a shell command, so a `git commit -m`
  attribution line must be written `(Co-Authored-By: Claude Opus 5)` without the angle-bracket address.

## HANDOFF (2026-09-19, superseded) — L2 complete (Element Spy + upgrade context); L5a gate and L1 still wait on the owner

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** L2 tasks 4 and 5 (see `docs/plans/ai-upgrade-v5/L2-recorder-and-element-spy.md` status).
  Every L2 acceptance item is met and verified.
- **Beads — BLOCKED:** `bd close awkit-djnl.3` is refused by the write-lease guard without a
  project-state task contract and lease (`npm run agent:lease-grant -- --task …`). The tracker therefore
  still reads `open`; the next project-state holder should close it with the evidence in CURRENT_STATE,
  then `bd export -o .beads/issues.jsonl` and `npm run verify:roadmap-dashboard`.
- **Owner decisions needed (unchanged):** L5a gate methodology (re-measured 13 PASS / 2 FAIL on the dev
  host, CPU 85–100 %); L1 acquisition (the two PowerShell steps in `L1-ai-foundation.md`).
- **Next agent work:** none unblocked in Phase L beyond owner steps. L3 consumes
  `RecorderService.getUpgradeContext(actionId)` and the Spy's `ElementInspection.upgradeContext`; the
  Spy's "Find stronger locator with AI" button belongs to L3.
- **Not run:** a deliberate-mutation run of `verify:element-spy` (refused by the session's permission
  classifier). Suggested mutations: drop `preventDefault`/`stopImmediatePropagation` in the Spy click
  listener (`recorderInitScript.ts`), or the frame-chain comparison in `inspectionApplyBlocker`.
- **Traps:**
  - The page script now also emits `locator.upgradeContext` (capture-only). `RecorderService` removes
    it first in `recordActionFromPage` and again in `applyLocatorRecordingMode`; `buildRecordedFlow`
    excludes it. A verifier comparing raw versus stored locators must strip it too.
  - An inspect-only session must never rewrite the draft: `scheduleDraftPersist` is a no-op while
    `inspectSession && !isRecording`, because the draft may not be loaded yet.
  - The Spy's frame identity comes from `buildFrameChain(source.frame)` in main, never from the page;
    a child-frame report whose chain cannot be built is dropped.
  - Ports in some ranges are excluded on this Windows host (`listen EACCES` on 4473); pick a port
    another verifier already uses.

## HANDOFF (2026-09-19, superseded) — L5a overhead root cause fixed but the gate is unstable; L2 quality class and chooser shipped; Element Spy next

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done this session (all on `origin/main`):** `6bfd59d` L5a overhead correction (collector attaches
  before the first page, context-level listeners, atomic `report.json`, production-parity stack traces
  in the overhead verifier); `9d5538e` raw-UI-text suppression switch and `stepIndex`; `0bcc0c8` L2
  quality class; `d94d1a1` L2 strategy chooser.
- **Owner decisions needed:**
  1. **L5a gate methodology.** After the correction the gate passed twice and failed once on the final
     state (+176/+333 ms; per-round deltas −726…+704 ms; CPU-pressure backpressure fired). The statistic
     (`scripts/benchmark/lib.mts` `stats()`) reports the upper middle value for an even count. Decide
     the rounds, the median definition and the host (ideally the VMware target) before approving a
     ceiling. Do not raise the ceilings to get a pass. `AWKIT_L5A_OVERHEAD_SOURCE_MAPS=1` reproduces the
     tsx source-mapped measurement.
  2. **L1 acquisition** (unchanged): the two PowerShell steps in `L1-ai-foundation.md`.
- **Next agent work:** L2 `awkit-djnl.3` task 5, the Element Spy (permission `recorder.elementSpy`
  already exists): an inspect mode in the Recorder that reports identity, candidates with counts, the
  quality class with reasons and frame/shadow/container context, refuses protected-login surfaces, and
  applies a candidate only on an explicit "Use in action". Task 4 (capture-time upgrade context for L3)
  has no consumer until L3; build it with the Spy or with L3.
- **Beads:** unchanged. `awkit-djnl.7` stays OPEN (gate). `awkit-djnl.3` is still `open`; moving it to
  `in_progress` needs a project-state contract and lease, not run this session.
- **Traps:**
  - Every Playwright subscription change (`page.on/off` of `response`, `request*`, `console`, `dialog`)
    is a protocol call that captures a stack; prefer context-level listeners and never unsubscribe from
    a closing page.
  - A context init script registered BEFORE the binding runs first in each new page's documents, so a
    page script that calls the binding at document start must queue and retry.
  - The Recorder page script now emits `recordingCandidates` (capture-only); `RecorderService` and
    `buildRecordedFlow` both strip it. A verifier comparing raw versus stored locators must strip it too.
  - With a hidden duplicate in the DOM the Recorder falls back to a guarded position (see
    `/recorder-lab/locator-quality` › Apply coupon); that is correct capture, not a classifier bug.

## HANDOFF (2026-09-19, superseded) — L4a verified, L5a capture evidence passes but duration gate fails, L1 waits on two owner steps

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** L4a `awkit-djnl.5` is closed (authoring diagnostics 94/94; Flow Designer 138/138 broad +
  16/16 capsule). L5a `awkit-djnl.7` has working
  real-browser evidence (74/74), persistence, privacy and teardown proof, but its current duration gate
  is **FAIL**: +326 ms fast vs +193.4 ms and +380 ms evidence vs +341.6 ms. It remains open. The L1
  real host is written (`51cacba`, `9c25288`).
- **Owner actions:**
  1. **Do not approve the L5a overhead ceilings yet.** The measured CPU/size/cleanup checks pass, but
     the two duration medians do not. Correct the collector/default behavior first, rerun the gate,
     then obtain owner approval for a passing release threshold. The figures are development-host
     measurements, not VMware ones.
  2. **L1 acquisition**, the two PowerShell steps in `docs/plans/ai-upgrade-v5/L1-ai-foundation.md`:
     install `node-llama-cpp@3.21.1` with `NODE_LLAMA_CPP_SKIP_DOWNLOAD=true`, and download
     `Qwen3.5-4B-Q4_K_M.gguf` to Downloads. Then the release lease pins the runtime and the measured
     SHA-256, and `verify:ai-model-live` and `benchmark:ai-model` run. L3, L4b and L5b wait on the go/no-go.
- **Next agent work:** L2 `awkit-djnl.3` (deterministic Recorder and Element Spy; no model needed). The
  L5a follow-up is the Raw-UI-text suppression Settings switch from the privacy policy (default OFF).
- **Traps:**
  - Windows reserves port blocks, so a fixed verifier port can fail with `EACCES`. The L5a verifiers
    ask the OS for a free port.
  - Never await Playwright's context `exposeBinding` on an instance's start-up path (4–5 round trips).
  - The page script's own `<script>` source contains its fixture text, so assert on elements, never
    on text anywhere in a DOM snapshot.
  - `processQueue` writes the report when statuses are terminal. A `cancelled` status is set before
    the runner unwinds, so anything written after that point needs the (now present) runner wait.

## HANDOFF (2026-09-19, superseded) — L1 foundation built; runtime and benchmark need an owner decision

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done (L1 `awkit-djnl.1`, `in_progress`):** the autonomy policy, the audit store and revert, the
  AiService boundary and fake host, the prompt builder and output contract, admission and yield,
  the host manager, IPC and preload, permissions, the dedicated AI settings store, the model-pack
  store and manifest, and Settings › Local AI. Commits `9f452e5`..`016c37c`. Details and evidence are in
  `docs/ai/CURRENT_STATE.md`; the design choices are in `docs/ai/DECISIONS.md` (L1 entry).
- **Blocked on the owner:**
  1. **Choose the runtime binding.** Option (a) is an in-process binding such as `node-llama-cpp`
     inside the utility process: no listener, a new native npm dependency. Option (b) is a pinned
     `llama-server.exe` behind the host: loopback, random port and token.
  2. **Approve obtaining the runtime and the Qwen3.5-4B Q4_K_M pack** (downloads). Then the release
     role pins `AI_RUNTIME_PIN.build` and adds the measured manifest entry (size and SHA-256), and
     the notices ship.
  3. Only then can L1.8 run: the constrained 6-logical-CPU benchmark, its per-feature budgets and
     the go/no-go. L3, L4b and L5b wait on that result.
- **Next once unblocked:** write `native-hosts/ai/ai-host.cjs` against `src/ai/contracts/AiHostProtocol.ts`.
  It must refuse model paths outside `AWKIT_AI_MODEL_ROOT`, honour `cancel` asynchronously, require
  a JSON schema, and send `enable_thinking: false`. Add `verify:ai-model-live` (host plus pack, else
  NOT RUN), then the benchmark.
- **Traps:**
  - `src/security/**` and `src/offline/**` are lease-gated. Each lease can commit only its own
    paths, and the grant needs the contract's `writer` to name the holder.
  - `AiServiceLimits` must stay an explicit interface: `Object.freeze` inferred literal types that
    only `typecheck:scripts` caught.
  - `FakeAiHostTransport` cancels asynchronously on purpose. A synchronous fake hid an overlap race
    at timeout.
  - The `semantic` settings group is writable through `settings:update` by any role; this is
    tracked as a separate task.

## HANDOFF (2026-09-19, superseded) — L0 complete; L1, L2, L4a and L5a are ready

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** L0 `awkit-djnl.2` is closed. The owner audit is in `docs/plans/ai-upgrade-v5/ROADMAP.md` ›
  "Owner audit", and the ratified decisions are in `docs/ai/DECISIONS.md` (2026-09-19). Phase L is
  `in-progress`.
- **Next:** any ready milestone: L1 `awkit-djnl.1` (AI foundation; it gates L3, L4b and L5b), L2 `.3`,
  L4a `.5` or L5a `.7`. Read the DECISIONS entry first: it fixes the field shapes and supersedes L3 §6.
- **Owner review:** these defaults were chosen by the agent and are open to override:
  - `AiActionRecord` retention of 5,000 records / 90 days;
  - raw-UI-text suppression OFF by default;
  - no debug prompt capture in Phase L;
  - the manifest at `src/offline/AiModelManifest.ts` (Risk-3, release-owned).

  Two rulings tighten the plan text: a guarded locator is a revert target, not a runtime fallback, and
  sensitive-action steps get no AI locator proposal at all (T3).
- **Left to measurement:** promotion N and the self-demotion window, threshold and minimum sample
  (seeded in L1, committed in L7).
- **Traps:** the lease guard rejects `;` anywhere in a command, including inside a quoted
  `bd close --reason`. L5a must reuse `PassiveCdpTrace`'s generation lifecycle, but never its raw
  NDJSON as AI input.

## HANDOFF (2026-09-19, superseded) — Phase L registered; the next session starts L0

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** V5 plan committed (`docs/plans/ai-upgrade-v5/`, `0d6e0fd`); Phase L registered `pending`
  in `src/roadmap/ImplementationRoadmap.ts`; Beads epic `awkit-djnl` holds ten dependency-ordered
  milestones; `verify:roadmap-dashboard` pins moved and "Sources agree".
- **Next:** start **L0 = `awkit-djnl.2`** (the only ready milestone): owner audit and decision records
  per `docs/plans/ai-upgrade-v5/L0-decisions-and-registration.md`. L0.1 (roadmap registration) is
  already done. Claim it in `tools/roadmap/assignments.json` while working and clear it when done.
- **Traps:** L0 is `.2` and L1 is `.1`. `bd create --deps blocks:X` = the new issue blocks X, while
  `bd dep add A B` = A depends on B. `bd` writes need a `project-state` lease (contract + grant +
  release). The lease guard accepts only one-line `git commit -m "…"` and `git add -- <paths>`.
- **Left to measurement (not decided):** the T2 promotion replay count N and the self-demotion revert
  threshold, both committed after the L1 baseline.

## HANDOFF (2026-09-17, superseded) — Reports GUI and script-type evidence closed

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** the Reports accessibility verifier now passes the shared harness's isolated
  `--user-data-dir` into Electron and always cleans up its isolated APPDATA/LOCALAPPDATA profile;
  the canvas-layout verifier uses an explicit edge fixture type; stale populated-Reports selectors
  were reconciled with the shipped report composition without weakening product assertions.
- **Evidence:** build PASS; `typecheck:scripts` PASS with zero diagnostics; canvas layout **46/46**;
  Reports a11y **17/17**; Reports smoke **35/35**; populated Reports **173 PASS / 0 FAIL / 3 NOT
  RUN**; telemetry **68/68**; design tokens **35/35**. The three populated-suite omissions are
  explicitly reported live-engine/stale-row cases and remain outside the pass count.
- **Next:** no Reports implementation or verification repair remains; retain the three explicit
  populated-suite omissions until a suitable multi-session/live-engine fixture is added.

## HANDOFF (2026-09-17, superseded) — full Reports reference composition implemented

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** all seven analytics Reports routes now use report-specific reference compositions.
  Chrome Consumption has the requested consolidated Consumption pressure panel, range/refresh
  controls, contexts/queue history, live activity, per-context detail, and memory history. Shared
  permission-gated JSON export is functional and uses only the currently loaded production data.
- **Evidence:** build PASS; design tokens/live Electron 35/35 with zero console errors; source review
  and diff check PASS. The former launcher block is resolved by the closeout above.
- **Next:** superseded by the closeout above.

## HANDOFF (2026-09-17, superseded) — Settings and Reports reference-layout correction complete

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** Settings now has the reference's two primary groups and organized internal subsections;
  Reports Overview, Workflow Reports, Instance Reports, Chrome Consumption, Runtime Analytics, and
  Failure Analytics now use real 12-column KPI/widget compositions with production data.
- **Evidence:** build PASS; design tokens 35/35; focused source review and diff check PASS. The
  Reports/a11y launcher and both Reports GUI gates were subsequently corrected and rerun by the
  closeout above; the separate Settings-only launcher history is unchanged.
- **Next:** superseded by the closeout above for Reports.

## HANDOFF (2026-09-15, latest) — anti-loop execution controls implemented

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** compaction restore now preserves established facts and executed-command results
  (`tools/agents/compaction-checkpoint.mjs`, new `record` CLI) instead of instructing repository
  re-derivation; the write lease allows required closeout bookkeeping under any active lease
  (`SYSTEM_BOOKKEEPING_PATHS`, 16 exact paths) and the guard labels the third identical denial
  TERMINAL (`tools/agents/guard-denials.mjs`); the Stop hook blocks only confirmed secret
  exposure / broken required files while advisories never veto a stop
  (`scripts/ai-memory/check-memory.mjs`); `AGENTS.md` gains authoritative stopping semantics
  (terminal gate states, bounded retries, change-triggered verification); `HANDOFF.md` is
  bounded to the newest entry + template, with older sections moved verbatim to
  `docs/ai/HANDOFF_ARCHIVE.md`.
- **Evidence:** `verify:agent-routing` **1113/1113** (35 new focused checks; cardinality
  re-pinned 1078 to 1112 unconditional); `ai:memory:check` PASS; build + typecheck PASS;
  roadmap dashboard reconciliation round 1.
- **Next:** run a normal feature task under the new policy; record verifier evidence with the
  compaction-checkpoint `record` CLI as tasks run.

## HANDOFF (2026-09-14, latest) — `awkit-uiaa` implemented and awaiting terminal closeout

- **Ledger:** unchanged at **65 PASS / 2 NOT RUN / 0 BLOCKED across 67 cases**.
- **Done:** both designers arrange the authoritative updated graph immediately after successful
  node insertion using the established layout engine. Sessions has protected fixed table columns,
  contained long URLs/statuses and full-value title access. The Component Reference 135°
  indigo → brand-blue → cyan accent is canonical in `src/theme/accentColor.ts` and imported by both
  the main renderer bootstrap and splash.
- **Evidence:** build PASS; canvas **46/46**; Flow Designer **138 + 16**; Workflow Builder
  **68 + 17**; design tokens **35/35** with light/dark Sessions screenshots; accent theme **73/73**;
  accent GUI **40/40** (including the real bundled-splash module/CSP/canvas smoke check); mock-site
  **177/177**; profile store **74/74**; session context **11/11**;
  source hygiene **11/11**; verifier classification **205/205**.
- **Known verification limitation at the time:** `verify:settings-e2e` and
  `verify:settings-persistence` used older launchers. The Reports a11y launcher was subsequently
  migrated to the canonical isolated `--user-data-dir` and now passes **17/17**.
- **QC:** independent review initially rejected the inline-only splash CSP after Vite converted its
  production entry to a local module. The corrected `script-src 'self' 'unsafe-inline'` preserves
  both package and Vite-dev execution; QC re-review **APPROVED** the code and 40/40 real-Electron
  smoke evidence.
- **Tracker:** Bead `awkit-uiaa` is closed and `.beads/issues.jsonl` exported. Run final AI-memory
  and roadmap reconciliation, commit this Project State update, then use the constrained terminal
  finalizer to release and push `main`.

## Purpose

This file is the active handoff note between AI coding agents and humans. It applies to any coding
agent (Claude Code, Codex, Gemini, Antigravity, future agents) and human developers.

Use this file when work is paused, blocked, or moving from one agent/tool to another.

## Current Handoff

> ⚠️ **SUPERSEDED — see the dated block at the very top of this file (2026-07-21).** The status quoted
> below ("clean `main`, nothing uncommitted") is no longer true: there are now two unpushed local branches,
> `chore/brand-logo-5b` and `feature/randomized-test-lab`. The rest of this block is still accurate as
> *history* of the licensing/secure-login/Oracle threads.
>
> Historical status (2026-07-19, later session): clean `main` @ `0a4500f`, nothing paused or blocked. The
> newest work is the **admin/licensing 8-phase package** (PR #21) — see the top block of this file +
> **`docs/LICENSING.md`**. License enforcement ships **default OFF** (`SPECTER_LICENSE_ENFORCE=true`); the
> open rollout decision is bead **`awkit-1cc`**. The secure-login/Oracle summary below is prior context.
> The full detail is the dated
> block at the top of this file + `docs/ai/CURRENT_STATE.md`. Summary: the secure-login epic (`awkit-ekd`) is
> complete and the Oracle epic (`awkit-kzo`) is closed; both shipped to `main`. The GUI-verifier suite is
> repaired and idempotent (shared `scripts/lib/gui-verify-harness.mjs`). Oracle is PRODUCTION-CANDIDATE,
> re-validated on current `main` (350/350 non-GUI + `verify:oracle-live` 7/7 vs the real local 19c, with a
> minted-then-retired ephemeral credential).
>
> **The single open thread is `awkit-cm8`** — two genuinely-external gates (packaged-EXE clean-machine
> walkthrough — `electron-builder` OOMs on this 15.9 GB host — and sustained days-long soak). Neither is
> runnable here; both need a higher-memory build host / dedicated soak machine. Everything else runnable in
> this environment is green. Procedures: `docs/ai/ORACLE_JDBC_VALIDATION_GATES.md`.
>
> **Live-Oracle re-run recipe (for the next agent, if asked):** the local Oracle 19c listens on
> `:1521`; Java 17 + the ojdbc bundle are in the Settings store (`Local-JDK-17` /
> `Oracle-ojdbc17-local-19c-validation`). `SPECTER_READER` is normally left **LOCKED** — re-run
> `scripts/oracle/local-19c-awkit-types-fixture.sql` via OS-auth `sqlplus / as sysdba` (PowerShell, not Git
> Bash — Bash mangles the `/ as sysdba` arg), mint a fresh ephemeral password, run `npm run verify:oracle-live`
> with the `AWKIT_ORACLE_LIVE_*` env, then **rotate + `ACCOUNT LOCK`** and delete the secret file. Never print
> the password.

---

> ⚠️ **Everything below this line is PRESERVED HISTORY** (older dated handoffs — shared-browser capacity,
> React Flow removal, the Phase 2–5 packaging work, etc.). The **current** state is the top block + the
> "Current status (2026-07-19)" note above. Every "uncommitted tree", "feature branch", and "Active Task"
> below is history; do not act on it as if it were current.

### From / To

- **From:** the agent that hardened the A5 shared Chromium browser pool (isolation resolver + compatibility key).
- **To:** any next agent or human developer.
- **Branch (historical):** `main`, working tree modified & uncommitted. **Superseded — see the state change
  above: the tree is now clean and everything is merged.**

### Active Task — Shared-browser concurrency capacity: COMPLETE (pool stays default-OFF)

Goal: maximise stable concurrent workflow capacity by safely sharing Chromium processes. The A5 shared pool
+ adaptive/backpressure/weighted admission + machine-aware capacity core already existed (plan phases
A1–A10); this task **proved them from code + runtime**, then closed the real gaps. `src/runner` core only —
**no route, IPC, preload (`window.playwrightFlowStudio`), profile schema, or packaging change; the default
path is byte-for-byte unchanged** (shared pool stays flag-OFF via `AWKIT_SHARED_BROWSER_POOL`; the `balanced`
resource profile resolves to one stable compatibility key → sharing behaves exactly as before).

### Completed Work (shared-browser capacity)

- **New `src/runner/browser/BrowserIsolationResolver.ts`** — THE authoritative resolver. Classifies every
  instance into `SHARED_CONTEXT | DEDICATED_BROWSER | PERSISTENT_BROWSER | HANDOFF_BROWSER` with a
  `{decision,value,source}` diagnostic per rule (precedence: persistent profile > mid-run browser-swap node >
  shared-flag > catch-all dedicated), plus `sharedCompatibilityKey(config, launchArgOverrides)` that folds the
  **browser-level** launch config (headed/headless + resolved launch-arg deltas) into the pool grouping key.
  Context-level options (viewport, device scale, storageState, request routing) are deliberately EXCLUDED —
  they stay isolated per `BrowserContext`. Pure/framework-agnostic; delimited + collision-safe (no hash dep).
- **Latent correctness bug fixed:** the shared pool previously grouped browsers only by `browser:headed/headless`
  and ignored per-instance `launchArgOverrides`. With the pool ON **and** a non-`balanced` resource profile,
  two instances with divergent launch flags could reuse one browser carrying only the first leaser's flags.
  `sharedCompatibilityKey` now separates them.
- **Wiring:** `browserSharing.isSharedEligible` now delegates to the resolver (single source of truth — the
  dispatch loop and the factory can't drift); `BrowserContextFactory` shared launcher keys on
  `sharedCompatibilityKey(config, this.options.launchArgOverrides)`; `ExecutionEngine.runInstanceInner` logs the
  isolation class + diagnostics **only when the shared pool is enabled** (silent on the default path).
  `sharedLaunchKey` kept as a legacy human-readable diagnostic.
- **Benchmarks:** ran `benchmark:concurrency` with `AWKIT_SHARED_BROWSER_POOL=1` and found the flag is **inert
  in that harness** (it `chromium.launch()`es one browser per instance, bypassing engine/factory/pool). It
  reported this machine's baseline (highest sustainable **7**, production-approved **5**, stop at 8 on P95 CPU
  96.5%). Built + ran new **`scripts/benchmark-shared-pool.mts`** (`npm run benchmark:shared-pool`) that drives
  the REAL `BrowserContextFactory` + `SharedBrowserPool`: Model A (browser/workflow) vs Model B (shared) →
  **N=4 −37.5% processes / −27% RSS; N=8 −56% / −39%** (headless, maxBrowsers=2); per-context cookie isolation
  held in every cell. The pool saves **RAM + process count, NOT CPU** (per-page render CPU is unchanged), so it
  raises the memory-bound ceiling only.

### Changed Files (this task, on top of the pre-existing uncommitted tree)

- **New (untracked):** `src/runner/browser/BrowserIsolationResolver.ts`, `scripts/verify-browser-isolation.mts`,
  `scripts/benchmark-shared-pool.mts`.
- **Modified (tracked):** `src/runner/browser/browserSharing.ts`, `src/runner/BrowserContextFactory.ts`,
  `src/runner/ExecutionEngine.ts`, `package.json`, `docs/ai/CURRENT_STATE.md`, `docs/ai/TASK_LOG.md`,
  `docs/ai/HANDOFF.md`.

### Commands / Tests Run (this task, all green)

- `npm run build` — clean (tsc + electron-vite main/preload/renderer).
- New `verify:browser-isolation` **27/27**.
- Regression: `verify:shared-browser-pool` 18/18, `verify:shared-browser-live` 5/5 (real Chromium),
  `verify:runner` 82/82, `verify:concurrency` 78/78, `verify:workload-weights` 53/53, `verify:resource-routing`
  42/42, `verify:chromium-hardening` 13/13, `verify:browser-resource-profile` 51/51,
  `verify:adaptive-concurrency` 14/14, `verify:operation-limiters` 10/10, `verify:telemetry` 54/54.
- Benchmarks: `benchmark:concurrency` (baseline; profile written to the gitignored `.benchmark-runtime/`),
  `benchmark:shared-pool` (Model A vs B, above).
- **Not run** (untouched areas): recorder/protected-login/GUI/mock-site/packaging verifiers. `npm test` /
  `npm run lint` still do not exist.

### Remaining Work / Recommended Next Step (shared-browser capacity)

- **External gate (unchanged):** a full flag-ON run *through `ExecutionEngine` dispatch* under sustained load on
  a clean machine, then the owner decision to flip the shared pool default ON (owner decision D4). The
  factory+pool lease itself is now measured; sharing does not lift a CPU-bound ceiling (it helps RAM-bound hosts).
- **Optional follow-ups:** wire `browserRecycleMemoryMb` (config field exists; the pool recycles by context
  count only); enable A8 weighted admission (`AWKIT_WORKLOAD_WEIGHTS`, default OFF) once per-class costs are
  calibrated; surface the isolation class / shared-browser count in the Instance Monitor.
- **Recommended next step:** decide whether to commit the working tree. Read the git-full-cycle skill for your
  agent surface (`.claude`/`.codex`/`.gemini` mirror) before any Git operation. Do not push/PR unless asked.

### Known Risks (shared-browser capacity)

- The shared pool is **experimental, default OFF**. Turning it on is now *safe* (incompatible launch configs are
  separated by the compatibility key) but should follow the clean-machine engine-dispatch benchmark.
- `BrowserIsolationResolver` is the single source of truth for browser isolation — do NOT re-derive eligibility
  elsewhere; extend the resolver instead.
- Reuse Session / Auto Secure Login / Manual Handoff / persistent-profile / popup / parallel-isolated-page
  behaviour is unchanged and must stay that way (they map to PERSISTENT/HANDOFF/DEDICATED classes).

### Other uncommitted work already in the tree (NOT this task — leave as-is unless asked)

The working tree carries several earlier sessions beyond this task; do not revert or "clean up" without the
user's ask:

- **Custom in-house canvas engine** (React Flow removal) — see the preserved "Prior uncommitted session" block
  below. Still needs `npm install` to sync `package-lock.json` (`@xyflow/react` removed from `package.json`) +
  `npm run offline:manifest` re-validate.
- **DPAPI secret store + full security-audit remediation** — `src/secrets/`, `app/main/secretStore.ts`,
  `app/main/ipc/{secrets,senderGuard,window}.ipc.ts`, `src/utils/pathSafety.ts`, `src/runner/urlPolicy.ts`,
  `src/profiles/FlowValidation.ts`, `docs/security/`.
- **Browser Resource Optimization** profiles — `src/runner/browserProfile/`, `scripts/benchmark-*.mts`,
  `scripts/benchmark/`, `verify:browser-resource-profile`, `docs/ai/BROWSER_RESOURCE_OPTIMIZATION.md`.
- **Custom app window frame** — `app/renderer/layout/{AppFrame,WindowControls}.tsx`, frameless window changes.

---

## Prior uncommitted session — custom canvas engine (React Flow removal)

### From / To

- **From:** the agent that removed React Flow and built the in-house canvas engine.
- **To:** any next agent or human developer.
- **Branch:** `feature/smart-wait-engine` (level with `origin/feature/smart-wait-engine`; the working
  tree is **modified & uncommitted / unpushed**, and already carried prior sessions' UI-migration work
  before this task). Do not fetch/pull/push/PR unless the user asks.

### Active Task — Remove React Flow (`@xyflow/react`) from the canvases: COMPLETE

The user asked to replace the React Flow-based canvases with the **same custom UI design as their
`Workflow` (flowforge) reference project, but implemented without the React Flow library**. Note the
reference project is itself built on `@xyflow/react`, so this required building a small in-house canvas
engine (viewport pan/zoom, node drag, SVG smooth-step edges, dotted grid, fit-view, screen↔flow
mapping) and porting all three canvases onto it. Renderer-only — **no route, IPC, preload API
(`window.playwrightFlowStudio`), runner/runtime, profile schema, storage contract, or packaging
behavior changed.** Per the user's explicit choice ("adopt flowforge nodes as-is"), the extra
node features listed under Known Risks were intentionally dropped.

### Completed Work (React Flow removal)

- **New in-house engine** `app/renderer/components/canvas/` (all untracked, no `@xyflow` anywhere):
  `FlowCanvas.tsx` (viewport pan/zoom via CSS transform, node drag with DOM measurement, SVG edge
  layer, fit-view, `useCanvas`/`useViewport`, `FlowCanvasHandle` imperative ref exposing
  `fitView`/`zoomTo`/`screenToFlowPosition`, `getIntersectingNodes`), `geometry.ts` (a faithful port
  of React Flow's `getSmoothStepPath` / `getViewportForBounds` math), `edgeComponents.tsx` +
  `edgeLabelContext.ts` (`BaseEdge`/`EdgeLabelRenderer` portaling into an in-transform HTML overlay),
  `Background.tsx` (dotted grid that pans/scales), `CanvasZoomControl.tsx` (glass zoom pill),
  `state.ts` (`useNodesState`/`useEdgesState`/`addEdge` compat helpers), `nodes/StepNode.tsx`,
  `edges/SmoothEdge.tsx` (insert `+`), `edges/LoopEdge.tsx` (self-loop), `types.ts`, `index.ts` barrel.
  The flow runs **top→bottom**: every edge leaves a node's bottom-center and enters the next node's
  top-center (self-loops when source === target).
- **All three canvases converted** to `<FlowCanvas>`: `pages/WorkflowDesigner.tsx` (read-only
  overview, uses `StepNode`), `pages/FlowChartDesigner.tsx`, `pages/ScenarioBuilder.tsx`. Their
  save/load/validation/serialization logic is unchanged — only the rendering layer swapped.
- **Node components rebuilt on the engine** (kept their existing flowforge-parity card markup/CSS):
  `components/workflow/ActionFlowNode.tsx`, `components/scenario/ScenarioFlowNode.tsx`. Resize +
  connector-port rendering removed; loop create/remove moved to the kebab menu via new
  `onToggleLoop`/`hasLoop` data callbacks (page owns the edge mutation).
- **Shared edits:** `components/shared/connectorStyle.ts` dropped its `@xyflow` import; `buildConnectorVisual`
  now returns `{ type: "smooth" | "loop", animated, style }` (was `templateSmooth`/`circular`).
  `components/workflow/FlowNodePropertiesPanel.tsx` `Node` type now imports from the engine.
  `flowDesignerTypes.ts` / `scenarioDesignerTypes.ts` gained `hasLoop`/`onToggleLoop`.
- **Deleted** (React-Flow-only, orphaned by the swap): `components/shared/TemplateSmoothEdge.tsx`,
  `components/shared/SelfLoopEdge.tsx`, `components/shared/ConnectorPorts.tsx`,
  `components/workflow/CanvasZoomControl.tsx`. Removed the `@xyflow/react/dist/style.css` import from
  `main.tsx` and the `@xyflow/react` dependency line from `package.json`.
- **Engine CSS** appended to `global.css` (`.awkit-flow-*`, `.awkit-step-node*`, `.awkit-edge-*`),
  translating the reference's Tailwind card design to AWKIT `--awkit-*` tokens (AWKIT has no Tailwind).
- **Both GUI verify scripts rewritten** against the new DOM (`.awkit-flow-node[data-id]`,
  `g.awkit-flow-edge[data-source][data-target]`, `.awkit-edge-add`, `.awkit-flow-canvas`), dropping the
  removed branch-port geometry checks. `AGENTS.md` (renderer) architecture note updated.

### Changed Files (this task, on top of the pre-existing uncommitted tree)

- **New (untracked):** `app/renderer/components/canvas/**` (engine).
- **Modified:** `app/renderer/pages/{WorkflowDesigner,FlowChartDesigner,ScenarioBuilder}.tsx`,
  `app/renderer/components/workflow/{ActionFlowNode,FlowNodePropertiesPanel,flowDesignerTypes}.tsx`,
  `app/renderer/components/scenario/{ScenarioFlowNode,scenarioDesignerTypes}.tsx`,
  `app/renderer/components/shared/connectorStyle.ts`, `app/renderer/main.tsx`,
  `app/renderer/styles/global.css`, `app/renderer/AGENTS.md`, `package.json`,
  `scripts/verify-flow-designer-gui.mjs`, `scripts/verify-workflow-builder-gui.mjs`.
- **Deleted:** `app/renderer/components/shared/{TemplateSmoothEdge,SelfLoopEdge,ConnectorPorts}.tsx`,
  `app/renderer/components/workflow/CanvasZoomControl.tsx`.
- **Note:** the working tree also holds many *pre-existing* uncommitted changes from earlier sessions
  (Workflow UI migration, Hologram reskin — e.g. `Recorder.tsx`, `LeftNavigation.tsx`, `Settings.tsx`,
  `src/profiles/WorkflowProfile.ts`, `mock-site/*`, doc/`.md` files, `package-lock.json`). Those are
  **not** from this task; leave them as-is unless the user asks.

### Commands / Tests Run (this task)

- `npx tsc --noEmit` — **clean**.
- `npx electron-vite build` — **clean** (main + preload + renderer). Renderer bundle
  **1,589 kB → 1,235 kB** (~355 kB smaller, React Flow gone; modules 2214 → 2049).
- `node scripts/verify-flow-designer-gui.mjs` (real Electron GUI) — **14/14**.
- `node scripts/verify-workflow-builder-gui.mjs` (real Electron GUI) — **14/14**.
- `grep -rn "@xyflow" app/` — no imports remain in source.
- **Not run** (no runner/runtime/mock-site/packaging code touched): `verify:runner`, `verify:recorder`,
  `verify:mock-site`, `verify:workflow-sentinels`, `validate:offline`, packaging verifiers. `npm test` /
  `npm run lint` still do not exist.

### Remaining Work / Recommended Next Step

- **Run `npm install`** — `@xyflow/react` was removed from `package.json` but **still exists in
  `package-lock.json` (6 refs) and `node_modules/`** (install was not run). Sync the lockfile + prune
  the module. This is the top remaining item.
- **Regenerate the offline dependency manifest + re-validate** after the install:
  `npm run offline:manifest` then `npm run validate:offline`. `scripts/generate-dependency-manifest.ps1`
  still references React Flow / `@xyflow` — confirm the manifest no longer lists it and that offline
  validation passes (a dependency was removed).
- **Optional — free node-to-node connect:** the engine currently connects via the `+` insert / append /
  Logic-picker affordances only. Port-drag-to-connect and edge-reconnect were dropped with the port
  model; if arbitrary connect-any-two-nodes is wanted, add flowforge-style drag-a-node-onto-another
  (the engine already exposes `getIntersectingNodes`).
- **Optional cleanup:** the now-unused port helpers remain in `components/shared/connectorStyle.ts`
  (`ConnectorPortFlags`, `computePortFlags`, `reconcileBranchConnectors`, `portHandlesForKind`,
  `branchSourceHandle`, `portPositions`) and the `portFlags?` fields on the two node-data types — dead
  after this task; safe to prune later.
- **Recommended next step:** run `npm install`, then `npm run build`, then `verify:flow-designer` +
  `verify:workflow-builder` to confirm still-green, before committing. Read
  `.claude/skills/git-full-cycle/SKILL.md` before any Git commit. Do not push/PR unless asked.

### Known Risks / Behavior Changes

- **Intentionally dropped features** (from the user's "adopt flowforge nodes as-is" choice): node
  resize, branch-port dragging, edge reconnect, and free port-drag-to-connect. Connections are now made
  via the `+`/append/Logic-picker affordances; loop is toggled from the node kebab menu. All connector
  *kinds* (conditional/parallel/loop), their config, and save/validation logic are preserved.
- **The engine is new hand-written code.** It has been GUI-verified (14/14 ×2) but is less battle-tested
  than React Flow — watch pan/zoom/drag edge cases. Node size is measured from the rendered DOM
  (`ResizeObserver`), so edges attach after first paint.
- The old `docs/ai/CURRENT_STATE.md` "Structured connectors (Checkpoint B)" section still describes the
  **removed** port/handle/`reconcileBranchConnectors` rendering model — the *runtime* connector
  semantics it documents are unchanged, but the renderer half (ports, `useUpdateNodeInternals`,
  branch-pair handles, `.react-flow__*` DOM) no longer exists. See the new dated CURRENT_STATE entry.

---

## Prior release-hardening context (historical — the release gates below are still the real gates)

### Codex Git-Cycle Update

2026-07-07: User explicitly requested committing and pushing all current project changes on
`feature/smart-wait-engine`. This overrides the older "do not push unless explicitly asked" caution for
this Git cycle only; do not assume future pushes are approved.

Fresh verification before staging:
- `npm run build` pass
- `npm run verify:runner` 82/82
- `npm run verify:recorder` 57/57
- `npm run verify:telemetry` 39/39
- `npm run verify:reports` 26/26
- `npm run verify:waits` 21/21
- `npm run verify:mock-site` 28/28
- `npm run validate:offline` pass
- `npm run verify:concurrency` 78/78

### From Agent / Tool

Claude Fable 5 (completed the concurrency & stability layer on top of Codex's uncommitted Reuse Session
lifecycle fixes — both change sets are in the working tree together)

### To Agent / Tool

Any next agent

### Timestamp

2026-07-06

### Branch / Commit

- Repository is a Git repo; always run `git status --short --branch` before editing.
- ~~Current branch: `feature/smart-wait-engine` (ahead of origin by 5 commits; local-only work not pushed).~~
  ~~Work is local-only. Do not fetch, pull, push, or open PRs unless the user explicitly asks.~~
  **STALE (corrected 2026-07-17):** that branch state no longer exists. The repo is on **`main`**, level with
  `origin/main` (`b6e473d`), working tree **clean**, no open PRs. Normal Git flow applies — still only
  push/PR when the user asks. See the state-change note at the top of this file.

### Active Task

Phase 5.1 release-candidate follow-up is in progress on branch `feature/smart-wait-engine`.
The repo is locally modified and uncommitted. The current work items are to:
- centralize Chromium no-egress hardening and ship it into the packaged app,
- make packaged verifiers track the real Electron main process tree and terminate it on cleanup,
- then validate the NSIS install/uninstall cycle and a real clean/offline Windows VM walkthrough.

### Phase 5.1 verification (2026-07-07, current handoff)

- **Chromium no-egress hardening validated end-to-end.** `src/runner/ChromiumHardening.ts`
  (`buildChromiumHardeningArgs`, env-configurable via `AWKIT_CHROMIUM_OFFLINE_HARDENING` /
  `AWKIT_CHROMIUM_EXTRA_ARGS`) is wired into `BrowserContextFactory` + both recorder launch paths and
  NOT into `SessionCaptureService`. Confirmed the `--disable-features` list is an exact superset of
  installed Playwright 1.61's (last-wins), and pinned 4 Playwright behavioral defaults so the arg set
  is self-contained. `npm run verify:chromium-hardening` **13/13** (ONLINE: zero non-loopback over a
  20 s idle window + external navigation still works). `AWKIT_WALKTHROUGH_STRICT_NET=1
  npm run verify:packaged-walkthrough` **70/70** — the strict no-egress check now PASSES; the Phase 5
  Google-service burst is eliminated. **This resolves the Phase 5 egress WARNING.**
- **Packaged-process teardown proven** (`scripts/helpers/packaged-process-tree.mts`): both
  `verify:packaged-runtime` (**25/25**) and the strict walkthrough report a fully-terminated tree.
- **Packaging OOM finding:** the default max-compression (`-mx=9`) packaging OOMs on this 16 GB
  machine; `win-unpacked` (the shared, validated payload) rebuilt hardened. One-off
  `-c.compression=store` builds produced **hardened** validation-grade portable (~1.23 GB) + NSIS
  (~376 MB) EXEs + a consistent `latest.yml` (installer sha512 re-verified). The two package wrappers
  were fixed to fail on a non-zero `electron-builder` exit (they previously masked the failure).
- **Remaining gates (unchanged):** clean/offline Windows VM walkthrough
  (`docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3); NSIS install/uninstall cycle (integrity sha512 only);
  code-signing; producing max-compressed shippable EXEs on a higher-memory machine.
- **RC decision: `PASS WITH WARNINGS`.** `npm test` / `npm run lint` still do not exist.

### Phase 5 additions (2026-07-06, this session)

- **`npm run verify:packaged-walkthrough` (68/68)** — `scripts/verify-packaged-walkthrough.mts`:
  launches the REAL `dist/win-unpacked` EXE with `LOCALAPPDATA` pointed at a fresh empty dir
  (clean first-run simulation); proves first-run init, IPC fixture import, full workflow run +
  artifacts (JSONL/screenshots/report/flow-state), hard cancellation (`cancelled`, Chromium tree
  gone, slot+locks freed), 2-browser OS-level bound under 4 instances, recorder start/cancel,
  hard kill → startup recovery (`orphaned`/recoverable, real Recoverable Runs panel renders,
  markReviewed clears), external SQLite read, ACTUAL portable EXE first boot, NSIS sha512 vs
  `latest.yml`, and network sampling (app processes loopback-only; bundled-Chromium startup
  Google burst = warn-only, `AWKIT_WALKTHROUGH_STRICT_NET=1` to fail). Evidence in
  `dist/phase5-evidence/`.
- **Findings recorded in KNOWN_ISSUES ("Phase 5 packaged-walkthrough findings")** — REQUIRED
  reading before scripting against the packaged app: launcher-stub pid (kill the REAL main from
  `app.evaluate(() => process.pid)`, never `app.process().pid`), orphaned Chromium self-exits
  when the real main dies, per-launch Chromium egress burst, `runWorkflow` needs `dryRun:false`,
  decorated instance ids, mock-site 127.0.0.1/Node-18 `localhost`→`::1` probe gotcha.
- Phase 5J full re-verification green (see CURRENT_STATE header for the complete list).
  `npm test` / `npm run lint` still do not exist.

### Phase 4 additions (2026-07-06, same session family)

- **sql.js ships verified in the packaged app:** `src/runner/store/SqlJsLoader.ts` resolves
  `sql-wasm.wasm` explicitly (`createRequire` + `locateFile`, path exposed);
  `electron-builder.json` lists the dist WASM; manifest generator + `validate-offline-bundle.ps1`
  + the TS manifest policy now REQUIRE `sqlJsRuntimeIncluded`/`sqlJsWasmIncluded` (an old manifest
  fails the packaged startup gate — both packaging scripts regenerate it). Portable (310 MB) +
  NSIS (357 MB) EXEs rebuilt 2026-07-06; `npm run verify:packaged-runtime` 24/24 launches the real
  packaged EXE and proves durable-store init + `%LOCALAPPDATA%` paths + external SQLite read.
- **Runtime diagnostics:** `getRuntimeStatus().environment` = appMode/runtimeRoot/sqlitePath/
  artifactsRoot/sqlJsWasmPath/durableStoreEnabled (logged once at init).
- **Durable runtime opens at app startup** (`registerExecutionIpc` →
  `engine.initializeDurableRuntime`), so startup recovery + recoverable runs appear right after a
  restart without starting a run.
- **Recoverable runs are actionable:** Instance Monitor `RecoverableRunsPanel` (details incl. last
  node/safety/URL/error class/trace/screenshot, open artifact folder, re-run workflow for SAFE runs
  only, mark reviewed/abandoned). New IPC `execution:recoveryDetails`/`execution:recoveryAction`;
  engine `getRecoveryDetails`/`applyRecoveryAction`; `RuntimeStore.listArtifacts`. Dangerous
  (failed/manual-review) runs are never auto-resumed.
- **Stress/soak verifiers (deterministic, tunable `AWKIT_STRESS_*`):** `verify:stress:concurrency`
  13, `verify:stress:cancellation` 8, `verify:stress:locks` 10, `verify:stress:artifacts` 7,
  `verify:soak:runtime` 8 — all green. `verify:stress:locks` found a real bug, now fixed:
  `DurableLockStore.acquireExclusive` treats Windows EPERM/EBUSY wx-create races as contention
  (clean denial) instead of throwing.
- Full Phase 1/2/3 regression re-run green (one `verify:durable-locks` flake under packaging CPU
  load, clean on re-run — noted in KNOWN_ISSUES). `npm test`/`npm run lint` still do not exist.

### Phase 3 additions (2026-07-06, same session family)

- **New dependency:** `sql.js` 1.13.0 (WASM SQLite — chosen because better-sqlite3's native ABI
  can't serve Node 18 tsx verifiers AND Electron 33's Node 20 simultaneously) +
  `@types/sql.js` (dev). Externalized in the main bundle; **packaged-EXE rebuild + dependency
  manifest regeneration still pending** before shipping.
- Durable runtime under `<runtime root>/runtime/`: `runtime.sqlite` (runs/attempts/heartbeats/
  cancellations/watchdog/artifacts/capacity, versioned migrations) + `locks/` (atomic wx-file
  cross-process locks, fencing versions, stale quarantine with reasons).
- Hard cancellation: Stop closes the live browser via per-instance CancellationTokenSource;
  runs end `cancelled` (not failed); `cancelled` error class never retried.
- `FlowStep.safety` explicit side-effect metadata (keyword heuristic = fallback only);
  RetryPolicy is metadata-first; unknown custom types conservative (no auto-retry).
- Dynamic origin claims (`OriginClaimTracker`), CPU/memory `ResourceSampler` in backpressure,
  startup recovery (`runStartupRecovery`: orphaned/recoverable vs failed/manual-review).
- Engine `getRuntimeStatus()` is now **async** (adds `durableLocks` + `recoverableRuns`);
  Instance Monitor strip shows CPU/Mem/Recoverable/Stale-durable-locks.
- New verifiers (95 checks, all green): `verify:durable-store` 11, `verify:durable-locks` 17,
  `verify:cancellation` 12, `verify:safety-policy` 17, `verify:dynamic-origin-claims` 14,
  `verify:resource-sampling` 14, `verify:startup-recovery` 10. Full Phase 1/2 regression green
  (`verify:concurrency` 78, `verify:runner` 82, `verify:waits` 21, `verify:protected-login` 16,
  `verify:recorder` 57, build clean, `ai:memory` pass, `validate:offline` pass in dev mode).
  `npm test`/`npm run lint` do not exist.

### Phase 2 additions (2026-07-06, same session family)

- Failure-path traces: `TraceService` per-step chunks; failed engine-run steps save
  `traces/<stepId>-<ts>.zip` before cleanup; `AWKIT_TRACE_MODE` off/onFailure/always; armed only
  when `instance.paths.traces` exists (verify scripts unaffected).
- Failure screenshots default ON (`onFailure.screenshot: false` opts out; best-effort).
- Origin/account dispatch semaphores (`DispatchClaims` + kind-prefix capacities `origin:*`/`account:*`;
  `AWKIT_MAX_PER_ORIGIN`=2, `AWKIT_MAX_PER_ACCOUNT`=1); released with slot in `finally`.
- Heartbeat refresh on `resumeInstance`/`retryHandoff`; watchdog snapshot (last scan/findings/swept).
- Runtime status: `getRuntimeStatus()` + IPC `execution:runtimeStatus` + preload
  `executions.runtimeStatus()` + read-only Instance Monitor strip (2s poll).
- Node attempts carry `tracePath` + sanitized `currentUrl`.
- New verifiers: `verify:locks` 15, `verify:browser-pool` 13, `verify:watchdog` 13,
  `verify:artifacts` 13, `verify:runtime-status` 15. Regression all green: `verify:concurrency`
  78, build clean, `verify:runner` 82, `verify:waits` 21, `verify:protected-login` 16,
  `verify:recorder` 57, `ai:memory` pass. `npm test`/`npm run lint` do not exist.

### Completed Work

1. **New pure modules:** `src/runner/concurrency/` (ResourceKey, Semaphore, ResourceLockManager —
   exclusive/shared/semaphore, TTL leases, fencing versions, atomic multi-acquire, stale sweep, snapshot;
   ConcurrencyConfig with `AWKIT_*` env overrides; BackpressureController; CapacitySnapshot),
   `src/runner/browser/BrowserWorkerPool.ts`, `src/runner/runtime/` (RuntimeStateMachine, NodeAttempt,
   ErrorClassifier, RetryPolicy, InstanceHeartbeat, WatchdogService), `src/runner/artifacts/` (RunLogger
   JSONL, RunStateArtifacts), `src/profiles/ProfileLockManager.ts`.
2. **BrowserContextFactory:** takes the exclusive in-process `profile:<userDataDir>` lock before
   `launchPersistentContext`, releases it in the runtime close path (and on launch failure). The on-disk
   `Singleton*` artifact check remains for external Chrome/Edge processes.
3. **FlowExecutor:** `executeWithRetry` is classification-gated (RetryPolicy + ErrorClassifier) — only
   transient navigation/timeout/locator/download errors auto-retry, with exponential backoff; dangerous-
   looking mutations (submit/approve/delete/send/pay/confirm keywords) and dead browser/context/page
   failures never do. Isolated parallel branches clamped by `maxActiveNodesPerFlow`.
4. **PlaywrightRunner:** optional `onBrowserRuntime` hook reports the live runtime (initial + each swap
   generation) so the engine's pool can track contexts/pages/disconnects without owning the lifecycle.
5. **ExecutionEngine:** browser-slot admission via BrowserWorkerPool + BackpressureController in
   `processQueue` (blocked dispatch queues with a logged reason); per-instance runner promises tracked;
   heartbeats + JSONL run logs + NodeAttempt records folded from progress events;
   `InstanceRuntimeState.runtime` additive field (flowRunStatus/heartbeatAt/browserWorkerId — UI `status`
   unchanged); WatchdogService marks orphans failed, notes stale heartbeats, sweeps stale locks; end-of-run
   `finally` releases the slot + stray profile locks and writes flow-state/node-attempts/capacity/locks
   JSON under `<instance storage>/state`; `repeatInstance` clears watchdog dedupe and re-enters through the
   slot gate.
6. **Verification:** new `scripts/verify-concurrency.mts` + `npm run verify:concurrency` (78/78), and the
   prior Codex work's tests still pass.

### Files Changed (uncommitted, working tree — includes the prior Codex change set)

- New: `src/runner/concurrency/*`, `src/runner/browser/*`, `src/runner/runtime/*`, `src/runner/artifacts/*`,
  `src/profiles/ProfileLockManager.ts`, `scripts/verify-concurrency.mts`,
  `docs/ai/CONCURRENCY_IMPLEMENTATION_PLAN.md`
- Modified this task: `src/runner/BrowserContextFactory.ts`, `src/runner/FlowExecutor.ts`,
  `src/runner/PlaywrightRunner.ts`, `src/runner/ExecutionEngine.ts`, `src/instances/InstanceRuntimeState.ts`,
  `package.json`, `docs/ai/{ARCHITECTURE,CURRENT_STATE,TASK_LOG,TESTING,COMMANDS,HANDOFF}.md`
- Untracked `electron_test*.cjs` at repo root are **pre-existing** and were left untouched.

### Commands / Tests Run

- `npm run verify:concurrency` — 78/78 (new).
- `npm run build` — clean (tsc + electron-vite).
- `npm run verify:runner` — 82/82.
- `npm run verify:waits` — 21/21.
- `npm run ai:memory` — pass.
- Not run this session: `verify:recorder`, `verify:protected-login`, GUI verifiers, packaging — no
  recorder/protected-login/renderer/packaging code touched.

### Current State Summary

The runner now has an enforced-in-code stability layer: exclusive persistent-profile locking, bounded
browser processes with queueing under backpressure (defaults: 2 browsers, 4 active flows — override via
`AWKIT_MAX_BROWSERS`, `AWKIT_MAX_ACTIVE_FLOWS`, etc.), classified retries with a dangerous-mutation guard,
heartbeat/watchdog recovery for orphaned instances and stale locks, per-instance JSONL run logs (the
previously-unwritten `paths.logs` file), and end-of-run state artifacts for debugging.

### Remaining Work / Recommended Next Step

- **Human clean/offline VM walkthrough** per `docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md` §3 —
  the main remaining gate (includes the NSIS install/uninstall cycle, offline-adapter-disabled
  startup, and the protected-login handoff on a machine with real Chrome). The dev-machine half
  (full packaged workflow run, now with strict no-egress) is automated by `verify:packaged-walkthrough`.
- **Produce shippable EXEs on a higher-memory machine** — the default `-mx=9` packaging OOMs here;
  only `store`-compressed validation EXEs were produced (KNOWN_ISSUES). Then code-sign them.
- Chromium no-egress launch flags: **DONE** (`src/runner/ChromiumHardening.ts`, Phase 5.1C — proven).
- Optional: renderer code-splitting.
- Next phase (deliberately NOT started): remote runner hosts — see the roadmap section in
  `docs/ai/PHASE3_DURABLE_RUNTIME.md`.

### Known Risks / Blockers

- `ELECTRON_RUN_AS_NODE=1` in agent environments makes direct `npx electron script.cjs` boot as plain Node
  (`require('electron').app` is `undefined`). Clear it (`unset ELECTRON_RUN_AS_NODE`) for ad hoc Electron
  reproduction commands. The project GUI verification scripts clear it themselves.
- The real workflow can still pause at Protected Login Handoff after Navigate if the target site requires a
  human login/verification step. Do not automate or bypass that surface.
- Playwright 1.49 API note carried from prior work: no `locator.filter({ visible })`; locator fallback uses
  `nth(i).isVisible()` probing. (Installed Playwright for the app is 1.61 / Chromium 149.)

### Do Not Touch Without Confirmation

- Do not rename `window.playwrightFlowStudio`.
- Do not break offline-first constraints: no runtime internet, no global Node/Playwright/Chromium, and no
  writes to `resources/` or `app.asar`.
- Do not add a "block external / non-Playwright profile" guard to Reuse Session; protected-login session
  capture intentionally uses real Chrome/Edge scoped profiles.
- Keep Mock Site scenarios local-only, deterministic, and free of external services.

### Recommended Next Step

Start from `git status --short --branch`. The lifecycle fix is complete locally and uncommitted. Do not push
unless explicitly asked.

### Required First Actions For Next Agent

1. Read `AGENTS.md`.
2. Read `docs/ai/CURRENT_STATE.md`.
3. Read `docs/ai/HANDOFF.md` (this file).
4. Run `git status --short --branch` and inspect `git diff` before editing.
5. For mock-site work, read `mock-site/AGENTS.md`, `mock-site/README.md`, and the `mock-site-maintainer`
   skill for your agent surface.
6. Read `.claude/skills/git-full-cycle/SKILL.md` (or the `.codex`/`.gemini` mirror) before any Git
   branch/stage/commit/push/PR operation.

## Handoff History

Historical handoff entries live in `docs/ai/HANDOFF_ARCHIVE.md` (moved 2026-09-15 to keep
startup reading bounded; content preserved verbatim, and Git history predating the split
remains authoritative). Read only the newest section above at startup; the archive is never
read at startup. `npm run ai:memory:check` warns when this file exceeds 64 KiB.
