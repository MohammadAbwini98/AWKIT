# L5 — Failure Evidence (L5a) & Failure Intelligence (L5b)

Shared rules, architecture and decisions: `ROADMAP.md`. L5a depends on L0; L5b on L1 go/no-go PASS + L5a.
**Source of truth for failure capture and analysis.**

## L5a — Run-lifetime deterministic evidence

### Collector (new owner)
Context/run-lifetime collector, composed with the existing browser-context creation hook (no second browser owner).
`NetworkDiagnosticsObserver` keeps its per-action stream-wait role; `captureFailureEvidence` keeps point-in-time
screenshots/DOM. The collector owns: page + popup attach, page replacement, init-script install, listeners, step-window
correlation, teardown, bounded buffering, persistence handoff.

### Signals
- Init script (event-driven MutationObserver on added/changed candidate nodes only; no polling, no full rescans):
  `role=alert`, `aria-live`, `role=status` (neutral), `aria-invalid` transitions, native `invalid` events +
  `validationMessage` + validity flags, bounded `aria-describedby` text, deterministic toast/banner heuristics.
  Field identity only, never values; protected-login excluded.
- Page listeners: HTTP 4xx/5xx metadata (method, sanitized path, status, timing), `requestfailed`, `pageerror`
  (name/message, bounded safe frames), `console.error` (bounded text), error-navigation snapshot (status, title,
  heading/alert — never full HTML), runner failure events (timeout, assertion, locator, cancel, navigation).
- Response-body excerpts **off by default**; if enabled by policy: failure status, allowlisted content type, small
  declared length, hard cap, masking. Never request bodies/headers/cookies; never scan 2xx bodies.

### Contract & bounds
One versioned `ExecutionEvidenceEvent`: id, schemaVersion, source, monotonic offset, execution/instance/flow/node/
step/page context, severity hint, bounded masked payload, dedupe key, repeat count. Caps per event, per source, per
instance, **per run (bytes)**; dedupe with repeat counts; explicit truncation flags. Personal-data masking per L0 policy;
raw evidence not semantically indexed.

### Default & overhead gate
Metadata/UI/form/error listeners ON; body excerpts OFF; console capture bounded and configurable; protected-login
exclusion mandatory. `verify:failure-capture-overhead` measures duration median/p95, CPU, RSS, event volume, observer
work, listener leaks, popup lifecycle, concurrency; first run proposes a numeric threshold that is owner-approved and
committed. If it fails, change the default.

### Deterministic cause baseline
Coded precedence table: failing step window → earliest/highest-confidence error event; else bounded preceding window;
direct HTTP/network/page/UI error before a runner timeout/assertion wins; output evidence IDs + reason code or
`insufficient`. Always computed, no model.

### Status (2026-09-19, `awkit-djnl.7`): implementation and capture evidence complete; duration gate currently FAILS

| Part | Where |
|---|---|
| Event contract, bounded masked buffer, retraction | `src/runner/evidence/ExecutionEvidence.ts` (`SemanticRedactor` on every string, URL → origin + path template) |
| Page-side script (UI, validation, document state) | `src/runner/evidence/uiEvidenceScript.ts` (a plain string, never a function's source) |
| Collector (listeners, step correlation, exclusion, handoff) | `src/runner/evidence/FailureEvidenceCollector.ts`, attached by `ExecutionEngine` on the per-generation lifecycle beside `PassiveCdpTrace` |
| Cause baseline | `src/runner/evidence/FailureCauseBaseline.ts` |
| Report extension | `InstanceReport.diagnostics` (optional; absent on clean passes, on old reports and with `AWKIT_FAILURE_EVIDENCE=0`) |
| Fixtures | `/runner-lab` › Failure evidence, `/api/transport-drop`, `/runner-lab/error-page` (`mock-site/README.md`) |

- **Protected-login exclusion.** The page script announces each document's state; a document with a password or
  one-time-code field is excluded and whatever it already produced is retracted (bytes returned, counted as
  `dropped.protected`). A page the runner hands off as a protected login, and every `protectedLoginHandoff`,
  `autoSecureLogin`, `reuseSession` or manual-handoff step, is excluded too. Only the runner's own failure survives.
- **Runner messages** keep the diagnosis line only: Playwright's colour codes and "Call log" (which quotes matched
  elements' HTML) are dropped. A `wait` step that ran out of time is `timeout` even though Playwright words it as a
  locator error.
- **Start-up cost.** Only the init script is awaited on the instance start-up path (one round trip, concurrent with
  the CDP trace start). Exposing the binding takes several sequential round trips (~330 ms median under start-up
  contention), so it completes in the background. Until it lands, the page queues its messages (at most 50), and
  they arrive in order with their age.
- **Cancellation.** A stopped instance is `cancelled` at once while its runner unwinds; the report writer now waits
  (bounded, 30 s) for unwinding runners, so a cancelled instance's report, evidence included, reaches `report.json`.

**Current overhead result, measured on the development host (12 logical CPUs, Windows), 6 ABBA rounds, 3 instances
per workload, 6 concurrent.** This is not a VMware production figure and does not approve a release ceiling.

| Measure | Capture ON | Capture OFF | Delta |
|---|---|---|---|
| Fast workload, median duration | 2,435 ms | 1,934 ms | +326 ms (median of paired rounds; **FAIL** vs 193.4 ms) |
| Evidence workload, median duration | 3,946 ms | 3,416 ms | +380 ms (median of paired rounds; **FAIL** vs 341.6 ms) |
| Fast / evidence p95 | 2,877 / 4,117 ms | 2,680 / 3,819 ms | +197 / +298 ms (**PASS**) |
| Node CPU per instance | 784.3 ms | 719.2 ms | +122.5 ms (**PASS** vs 179.8 ms) |
| Evidence per passing evidence-workload instance | 3.7 KB (7 events) | — | — |

Skipping the redundant initial `about:blank` script evaluation reduced collector start median from 123.9 ms to
94.0 ms, but did not bring both duration medians under the gate. Before the binding moved off the start-up path,
the same suite measured +568 to +1,077 ms on the fast workload's median and failed. **Proposed ceilings**
(in `scripts/verify-failure-capture-overhead.mts`, still pending owner approval):
median ≤ max(10 %, 150 ms), p95 ≤ max(15 %, 300 ms), Node CPU per instance ≤ max(25 %, 40 ms), and ≤ 4 KB of
evidence per passing evidence-workload instance. If capture ever fails them, the default changes.

**Verifiers:** `verify:failure-cause-baseline` 60/60, `verify:ui-error-evidence` 74/74 (real engine, real Chromium,
real mock site, persisted `report.json`; seven mutations caught: collector disconnected, response listener never
attached, buffer dropping UI events, report omitting diagnostics, protected-login guard disabled, report written
before a cancelled runner unwinds, listeners never detached), `verify:failure-capture-overhead` **13 PASS / 2 FAIL**.

**Correction (2026-09-19, `6bfd59d`).** Profiling showed the cost in Playwright's stack capture on every client
API call and CDP command, multiplied by the collector's per-page subscribe and close-time unsubscribe calls and by
setting up the init script and binding on an already-live page. The collector now attaches through a runner hook,
`onBrowserContext`, before the generation's first page; network and console listeners are context-level and are
made inert rather than unsubscribed; the page script is keyed per document, retries a queued message once, and sends
no `about:blank` announcement. Collector start: 94 ms → 3–4 ms median. The verifier now formats stack traces as the
packaged app does (tsx's source-mapped stacks cost ~8 ms per Playwright call; `AWKIT_L5A_OVERHEAD_SOURCE_MAPS=1`
restores them).

| Run after the correction (development host) | Fast median Δ | Evidence median Δ | Node CPU Δ | Result |
|---|---|---|---|---|
| 1 (profiler attached) | +15 ms | +10 ms | +31.3 ms | 15/15 PASS |
| 2 | +132 ms (≤ 150) | +133 ms (≤ 163.9) | +70.2 ms | 15/15 PASS |
| 3, final state | +176 ms (> 150) | +333 ms (> 196.9) | +57.3 ms | 13 PASS / 2 FAIL |

Per-round deltas span about −726 to +704 ms, run 3 hit CPU-pressure backpressure, and the gate's `stats()` takes
the upper middle value for an even round count; six rounds cannot resolve a 150 ms ceiling on this host.

**Follow-ups done (`9d5538e`):** Settings › Execution › **Hide page text in failure evidence** (default OFF,
SETTINGS_EDIT-gated): the page script sends no visible text and the collector drops it again (untrusted page),
including an error page's title and heading and quoted assertion values in the runner's message; role, source,
status codes, counts and field identity stay. Every step-correlated event carries `context.stepIndex`, the Nth step
execution in the instance (a retry keeps its index). `verify:ui-error-evidence` 85/85.

**Open:** the owner decides the gate's methodology (rounds, median definition, host — ideally the VMware target),
then a passing measurement, then an approved release ceiling. L5a stays open until then.

### L5a gate — decision brief (2026-09-19)

What the gate does today (`scripts/verify-failure-capture-overhead.mts`): one untimed warm-up, then
`AWKIT_L5A_OVERHEAD_ROUNDS` (6) rounds, each an ON and an OFF batch in alternating order (ABBA), each batch
`AWKIT_L5A_OVERHEAD_INSTANCES` (3) instances per workload, so 6 concurrent Chromium instances. The statistic is
the median over rounds of (ON batch median − OFF batch median); the ceiling is max(10 % of OFF median, 150 ms).
The method already cancels slow host drift. Its limits:

1. **Resolution.** Recorded per-round deltas span about −726 to +704 ms. With six rounds the standard error of
   the median is roughly 1.25·σ/√6. At a per-round σ of 300–400 ms that is about 150–200 ms, the same size as the
   150 ms ceiling. On this host the gate can pass or fail on noise alone. The recorded runs show it: 15/15,
   15/15, then 13/2 on unchanged code. The +484/+387 ms re-measurement came from the same host at 85–100 % CPU.
2. **Saturation.** Six concurrent Chromiums plus the engine saturate this development host, which triggers
   CPU-pressure backpressure. Backpressure then delays admission in whichever batch it hits. That adds a
   scheduler effect to the measured collector cost.
3. **Median definition.** `stats()` in `scripts/benchmark/lib.mts` takes `xs[floor(n/2)]`. With an even count
   that is the upper of the two middle values, which biases the result upward.
4. **No application cost is left to explain the spread.** With a profiler attached, the delta was +15/+10 ms,
   and collector start measured 3–4 ms after `6bfd59d`. No further hot path has been identified. A new
   optimization needs a profile that shows new cost, not another gate run.

**Further evidence, 2026-09-20 (development host, 12 logical CPUs).** The gate was run three times in one
session on effectively identical code — the only change between runs was a type-only import added and then
removed for a mutation test, which cannot affect runtime cost. It returned three different verdicts:

| Run | `fast` median | `evidence` median | `evidence` p95 | Verdict |
|---|---|---|---|---|
| 1 | 46 ms ≤ 150 ms PASS | 70 ms ≤ 204.9 ms PASS | −916 ms PASS | all ceilings green |
| 2 | −200 ms PASS | **392 ms > 290.1 ms FAIL** | **1064 ms > 511.7 ms FAIL** | two red |
| 3 | **170 ms > 150 ms FAIL** | 132 ms ≤ 171.8 ms PASS | 49 ms PASS | one red, a different one |

Note the ceilings themselves move between runs (204.9 → 290.1 → 171.8 ms), because they are derived from
the measured OFF baseline, so both the measurement and its threshold drift with host contention. This is
first-hand confirmation that the gate cannot currently separate signal from noise on a saturated
development host, and it strengthens the case for B + D reported with E. **No ceiling was changed and no
option was adopted** — this entry is evidence only.

The options below leave the ceilings and the product unchanged. Each needs owner approval, because the
methodology is the owner's call.

| Option | Change | Cost | Effect |
|---|---|---|---|
| A. Quiet host | Run the unchanged gate on the VMware target | none | Less contention, same 6-round resolution |
| B. Odd rounds | Set `AWKIT_L5A_OVERHEAD_ROUNDS=7` (or 9) | +1–3 rounds of runtime | Removes the even-count median bias without changing code |
| C. More rounds | 15–20 rounds | about 3× runtime | Standard error falls by about √(20/6) ≈ 1.8× |
| D. Unsaturated load | `AWKIT_L5A_OVERHEAD_INSTANCES=1` for the duration gate. Keep the saturated run as a separate informational check | none | Measures collector cost, not scheduler response to saturation |
| E. Three-way verdict | PASS when a paired interval's upper bound ≤ ceiling, FAIL when its lower bound > ceiling, otherwise INCONCLUSIVE | a small verifier change | Stops noise from being reported as PASS or FAIL |

**Recommendation:** B + D on the VMware target (A), reported with E. All of these are environment settings
except E. Do not change the ceilings or the evidence collected. Until the owner decides, L5a stays open and its
gate stays at the last recorded FAIL.

## L5b — Failure intelligence (T0)

**Status (2026-09-21): coalescing and the analysis contract are BUILT** — `src/ai/failureAnalysis.ts`,
proven by `verify:ai-error-analysis` (76/76, three mutations caught) over L5a's real `EvidenceBuffer`
and real `deriveFailureCause`. `awkit-djnl.8` stays open: the `diagnostics` persistence extension, the
reports UX and the live quality gate are not built, and the milestone cannot close under the
conditional development authorization.

### L5b as built

- **The hard problem is not the prompt, it is the 500-row run.** A data-driven run that fails the same
  way 500 times must cost **one** analysis. The signature is the baseline's cause code, the primary
  evidence source, the status or error kind, the path template and the flow/node/step — and
  deliberately **not** the instance, the data row, any offset or any repeat count, which is exactly
  what differs between those 500. Measured: 500 → one group, one planned call.
- **Distinct failures stay distinct.** A 409 and a 422 on the same route are separate analyses, because
  the discriminator is the status itself; so are the same status on two routes, and the same failure at
  two steps. The labelled set depends on all three.
- **The budget is a budget, and a declined group is visible.** Past `maxAnalyses` a group keeps its
  deterministic baseline and reports `skipped: "BATCH_BUDGET"`; past `maxSignatures` the batch counts
  an `overflow`. Groups are ordered by impact (most instances first, then signature), so the budget
  buys the most and the plan is deterministic. `buildFailureAnalysisRequest` returns `undefined` for a
  declined group, so a caller cannot analyse past the budget by accident.
- **An `insufficient` baseline is never analysed at all** — there is nothing to reason over, and a
  model asked to explain nothing will invent something.
- **Three rules decide whether the answer is trustworthy:** evidence ids are a closed `enum` and
  re-checked after decoding; a conclusion with no cited evidence is refused as a guess
  (`UNSUPPORTED_CONCLUSION`); and `insufficient` is a first-class answer, with an answer that both
  declines and concludes refused as `CONTRADICTORY` rather than half-believed.
- **L5b cannot change the run, and not because it is told not to.** The schema has no field for a
  status, a retry, a policy or an edit — a model that emits one is refused by `AiOutputContract`
  before this module sees it.
- **One design constraint worth recording:** `AiPromptBuilder` redacts every DATA string, and its
  first rule replaces any whole URL — including a route template L5a had already stripped of query,
  userinfo and ids. That is correct defence in depth and was not weakened; the route travels through
  the `ids` channel instead, which is unredacted but still rescanned for residual secrets. Without it
  the model would be told a request failed and never told which one.
- **Mutation-tested three for three:** adding the instance id to the signature → 63/76 (coalescing
  collapses entirely); allowing an unsupported conclusion → 75/76; removing the per-batch budget →
  71/76.

- Invocation: PASS + no evidence → nothing; PASS + evidence → baseline, AI on demand; FAIL → baseline immediately,
  AI only if enabled, admitted, not coalesced away, and the feature earned auto-run (beats baseline on labelled set).
  Never before terminal outcome.
- Coalescing: signature = source + status/error class + **path template** (ids stripped) + flow/node/step + baseline
  cause code. One analysis per signature; others reference it with counts; bounded distinct signatures and a
  per-batch budget; overflow keeps baseline only; backlog never delays execution or report finalization.
- Input: baseline, terminal failure, bounded high-signal evidence with IDs, small neighbor-step context, counts.
- Output (constrained): primary candidate + evidence IDs, secondary consequences, category, explanation,
  investigation steps, uncertainty; unknown evidence IDs rejected; "insufficient evidence" allowed. Never changes
  status, retries, policy, or workflow.
- Persistence: optional `diagnostics` extension — raw evidence, baseline, AI analysis stored separately; coalesced
  references; old reports load unchanged; analysis deletable/recomputable.
- Reports UX: three distinct sections — Captured evidence · Deterministic cause · AI analysis (labelled, with
  uncertainty and coalesced count).

## Labelled set

Transient toast before timeout; native validation; 409 + message; 422 + field validation; 500 + error page; transport
failure; pageerror before timeout; unrelated console error; duplicate burst; unrelated warning; pass with warning;
insufficient evidence; 500 identical failing rows; multiple signatures in one batch. Metrics: baseline accuracy, AI
accuracy, **AI improvement over baseline**, evidence-link accuracy, false attribution, coalescing ratio, calls per batch,
latency, privacy correctness.

## Verifiers

New `verify:ui-error-evidence`, `verify:failure-capture-overhead`, `verify:failure-cause-baseline`,
`verify:ai-error-analysis`, live `verify:ai-error-quality-live`. Existing: `verify:failure-evidence(-live)`,
`verify:run-report-compatibility`, `verify:telemetry`, `verify:reports`, `verify:runner`, `verify:mock-site`,
`validate:offline`, `npm run build`. Mock-site scenarios for each signal and a fast `<3s` run with zero model calls.

## Known limits (document, don't advertise)

Swallowed exceptions with no UI/network/console trace; errors inside 2xx bodies without an explicit rule;
canvas-only errors; protected-login surfaces (excluded by design).
