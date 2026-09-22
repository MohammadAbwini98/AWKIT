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
- **Residual-secret rescan (added 2026-09-21).** After redaction and the field cap, every stored
  string is rescanned with `findResidualSecrets`, the same independent check used for model prompts
  and stored L5b analyses. A flagged string is replaced whole by `[redacted]`. The event is kept with
  its source, status and step correlation, because the cause baseline rests on them. The replacement
  is counted per occurrence in the new optional `summary.residualSecrets`, over stored events only.
  A cap-dropped or retracted occurrence counts nothing (corrected the same day). Proven by
  `verify:failure-cause-baseline` (71/71; the rescan mutation-tested 2/2, the count red-first at
  69/71). A report written before the rescan is refused before the model, proven by
  `verify:ai-error-analysis` (140/140). **The L5a overhead gate was not re-run:** its three runs, the
  latest at `a2125084`, predate this change to the capture path. In an informational loop the
  rescan's cost could not be told apart from run-to-run variation.
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

**Closed on the owner's acceptance of INCONCLUSIVE (2026-09-21).** The methodology was decided on
2026-09-21 and extended to option C the same day (see the two "L5a gate" sections below). All three
approved runs were INCONCLUSIVE with no FAIL, and the owner accepted that as this machine's result. The
overhead ceiling was **not established** and is not claimed PASS (see "L5a acceptance" below).

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

### L5a gate — owner decision and measured result (2026-09-21)

**Decision (the owner, in session, 2026-09-21).** Run the duration gate **on the development machine**.
VMware validation is not required for L5a. Development-machine figures are **not** evidence of VMware
performance. Adopt **B + D + E**, and make **p95 informational until each mode has ≥ 21 samples**.
The median, CPU and byte ceilings stay binding, and **no ceiling is raised**.

**A finding the brief did not have: the "p95" check compared maximums, and it was not paired.**
`stats()` computes p95 as `xs[floor(0.95·n)]`, which is the largest sample whenever n ≤ 20. The old gate
pooled 18 samples per mode (6 rounds × 3 instances) and compared max(ON) with max(OFF). Those were two
independent maximums, with none of the ABBA drift cancellation the median gets. That is why evidence
p95 swung −916 → +1064 → +49 ms on identical code. The same holds under B + D (7 samples per mode). The
full set of reasons the old procedure disagreed with itself:

1. Real cost below the noise. The profiler measured +10–15 ms, while per-round deltas spread about
   ±700 ms, so the median's standard error was as large as the 150 ms ceiling.
2. A saturated host. With 6 Chromiums, CPU-pressure backpressure added scheduler delay to whichever
   batch it hit.
3. The even-count median returned the upper middle value.
4. The p95 compared a maximum with a maximum, unpaired (above).
5. The ceiling moves with the contended OFF baseline, so it drifted 204.9 → 290.1 → 171.8 ms.

**As implemented** (`scripts/verify-failure-capture-overhead.mts`, ceilings untouched):

- The defaults are now 7 rounds and 1 instance per workload.
- The duration and CPU ceilings are judged over a **distribution-free 95 % interval for the median of
  the paired deltas**, using order statistics x(k) and x(n+1−k), where k is the largest value with
  P(Bin(n,½) ≤ k−1) ≤ 2.5 %.
  - PASS when the upper bound ≤ ceiling.
  - FAIL when the lower bound > ceiling.
  - INCONCLUSIVE otherwise, with exit code 2.
- With 7 rounds the interval is **[min, max]** (98.4 %), so PASS needs every round under the ceiling.
- A self-check pins the interval, including n = 7, n = 21 and n = 5 (for which no 95 % interval
  exists), and pins every verdict boundary.
- Evidence bytes stay a hard cap. p95 prints as informational below 21 samples per mode.
- `npm run benchmark:failure-capture-saturated` (3 per workload) is option D's separate informational
  run. Its duration and CPU verdicts never decide an exit code.
- An env override away from 1 instance exits 2 as "gate NOT RUN", never 0.
- Each run appends its raw per-batch data to `evidence/L5a-overhead-gate.json` or
  `evidence/L5a-overhead-saturated.json`.

**Measured (development host, 12 logical CPUs, Windows, plain stacks as packaged).**

| Run | fast median Δ, 95 % interval | evidence median Δ, 95 % interval | Node CPU/instance Δ, 95 % interval | bytes | Verdict |
|---|---|---|---|---|---|
| Gate 1 | −10 ms, [−162, 190] vs 150 → INCONCLUSIVE | −9 ms, [−181, 45] vs 150 → **PASS** | −31 ms, [−78.5, 78] vs 70.6 → INCONCLUSIVE | 3,826 ≤ 4,096 PASS | **INCONCLUSIVE** (18 PASS, 0 FAIL, 2 INCONCLUSIVE) |
| Gate 2 (final verifier state) | +174 ms, [−312, 417] vs 150 → INCONCLUSIVE | +117 ms, [−457, 407] vs 150 → INCONCLUSIVE | −62 ms, [−273.5, 187] vs 96 → INCONCLUSIVE | 3,826 PASS | **INCONCLUSIVE** (17 PASS, 0 FAIL, 3 INCONCLUSIVE) |
| Saturated, informational | +130 ms, [−280, 358] vs 150 | +104 ms, [−257, 510] vs 162.7 | +7.7 ms, [−72.8, 57.7] vs 90.9 → within | 3,826 PASS | informational (17 PASS, 0 FAIL) |

In every run, all instances passed, ON batches produced events and OFF batches none, and a clean
fast run never grew its report. Every listener and binding was released and no automation Chromium
outlived its batch. The import closure reaches no model. Collector `startGeneration` median was
2.6 ms, 3.9 ms and 3.0 ms.

**Application cost versus measurement variability.** No run shows a cost the collector could explain.
Every gate point estimate is within ±175 ms of zero, with negative and positive signs, and collector
start is ≤ 4 ms. Gate 2's spread comes from the host. Its batch wall times split into about 1,050 ms
and about 1,570 ms groups, affecting OFF batches (3 of 7) as well as ON (4 of 7), and gate 1 had none.
The saturated run hit CPU-pressure backpressure in round 7. Its single-snapshot Chromium RSS read ON
964 MB against OFF 763 MB (median). No ceiling applies to it, and the unsaturated gate shows ON 212 / 205 MB
against OFF 210 / 212 MB (median). **No bottleneck was found, so nothing was optimized.**

**Status: L5a stays OPEN.** Its acceptance needs "overhead within the approved threshold", and neither
approved run established it. There was no FAIL either, and INCONCLUSIVE is not relabelled. Before
gate 2 ran, it was recorded that a mixed result would not close L5a in the same session.

**Next owner decision (not adopted).** With 7 single-instance rounds, the 95 % interval is [min, max].
On this host a single round's delta spreads 150–450 ms, so the approved gate can only PASS when every
round lands under a 150 ms ceiling. The documented lever that narrows it is **C**: at 21 rounds the
interval becomes [x(6), x(16)] (97.3 %), and p95 also becomes binding under the approved rule, at about
3× the runtime. The owner may also accept INCONCLUSIVE as the development-host outcome. Neither is
assumed here.

### L5a gate — option C and the interval method (2026-09-21, later the same day)

**Owner decisions (in session, all explicit):**

1. **Option C is approved:** 21 rounds × 1 instance on the development machine. The workloads,
   ceilings, controls and three-way verdict are unchanged. It is run **once**, with no re-runs.
2. **p95 at 21 samples per mode** is judged by the existing binding yes/no check: ON p95 − OFF p95 ≤
   max(15 % of OFF p95, 300 ms), unpaired. At 21 samples, `stats().p95` is the second-largest sample.
   A distribution-free interval for p95 is not available at this size: its lowest finite upper bound needs
   at least 72 samples.
3. **The median interval is approved as policy.** It was first chosen by the implementer and recorded as
   such. The owner has now approved it explicitly, so it is no longer only an implementation choice.

**The interval method and its assumptions.** For the n paired per-round deltas, the interval is
[x(k), x(n+1−k)], where k is the largest integer with P(Bin(n, ½) ≤ k − 1) ≤ 2.5 %. Its exact coverage
is 1 − 2·P(Bin(n, ½) ≤ k − 1): 98.4 % at n = 7 ([min, max]) and 97.3 % at n = 21 ([x(6), x(16)]). No
interval exists for n ≤ 5. It assumes:

- **Independent rounds, identically distributed.** ABBA ordering cancels linear drift, but a host whose
  state changes in steps across the run violates this.
- **A continuous distribution**, so ties have probability zero.
- **The target is the median of the per-round delta.** With 1 instance per workload, each delta is one
  ON run minus one OFF run.
- **No normality or symmetry is assumed.** That is why the method suits skewed or bimodal deltas.
- **The ceiling is treated as fixed,** although it is derived from the measured OFF median. Its own
  sampling error is not propagated.
- **No multiplicity correction** across the three binding interval verdicts. Each is a separate 95 %
  statement.

**How it is proven** (`verify:failure-capture-gate-stats`, a unit verifier, 47/47):

- The rules live in `scripts/lib/failure-capture-gate.mts`.
- The interval is checked against an independent exact BigInt binomial for every n from 0 to 80.
- Every PASS / FAIL / INCONCLUSIVE boundary is covered, with negative controls:
  - a low median with a wide spread is not a PASS;
  - a high median with a wide spread is not a FAIL;
  - a lower bound equal to the ceiling is not a FAIL;
  - a missing or non-finite round is INCOMPLETE.
- p95 eligibility is grounded in `stats()`, which returns the maximum at 20 samples.
- Unsupported configurations are gate NOT RUN (exit 2): 2, 3 or 6 instances, the superseded 7
  rounds, or more rounds than approved. The saturated run is never a gate.
- Evidence appends keep earlier runs and refuse an unreadable file, leaving it untouched.
- Every recorded binding verdict (9) is re-derived from the committed raw per-round deltas.
- Mutation-tested five for five: a strict PASS boundary gave 46/47, 90 % coverage 42/47, rounds
  ignored 45/47, unreadable evidence overwritten 43/47, and p95 binding at 20 samples 45/47.

**Option C result: gate run 3, the single approved run (development host, 12 logical CPUs, measured
at `a2125084`).**

| Ceiling | Measured | 95 % interval / check | Verdict |
|---|---|---|---|
| fast median duration | −53 ms | [−314, 214] vs 150 ms | INCONCLUSIVE |
| evidence median duration | −52 ms | [−302, 300] vs 150 ms | INCONCLUSIVE |
| Node CPU per instance | −47.5 ms | [−86, 86] vs 81.6 ms | INCONCLUSIVE |
| fast p95 (binding, 21/21 samples) | ON 896 / OFF 939 ms, −43 ms | ≤ 300 ms | **PASS** |
| evidence p95 (binding, 21/21 samples) | ON 1,165 / OFF 1,149 ms, +16 ms | ≤ 300 ms | **PASS** |
| evidence bytes per instance | max 3,826 B | ≤ 4,096 B | **PASS** |

**Verdict: INCONCLUSIVE** (15 PASS, 0 FAIL, 3 INCONCLUSIVE, exit 2). Every correctness check passed:

- all 84 measured instances passed, and every one of the 21 ON batches produced 7 events;
- OFF batches wrote no diagnostics, and a clean fast run never grew its report;
- every listener and binding was released, and no automation Chromium outlived its batch;
- the import closure (135 modules) reaches no model.

Collector `startGeneration` median was 2.4 ms. The per-round deltas, ON/OFF durations, CPU and wall time
for all 42 batches are in `evidence/L5a-overhead-gate.json` › run 3.

The run's `uncommittedMeasuredSources: true` is a metadata artefact. The tracked tree was clean at
`a2125084`, but the flag also counted the owner's untracked `scripts/ai-harness/locatorUpgradePacket.ts`
and `scripts/offline-benchmark/`, which the gate never imports. The recorded value is left as written.
The flag now counts tracked files only.

**Application cost versus host variability.** The spread is a batch-level stall on this host, not
capture cost:

- **Two wall-time groups:** batches split into about 1,030 ms and about 1,570 ms. 17 of 42 batches
  (40 %) are in the slow group.
- **Common-mode:** a stall slows both workloads of its batch together. The fast and evidence deltas move
  in step round by round (+466/+611, −373/−388, −803/−799, +424/+530).
- **Both modes are hit, OFF more often:** 11 of 21 OFF batches stalled against 6 of 21 ON batches. The
  fast deltas are positive in 8 rounds and negative in 13, and every point estimate is negative. The
  imbalance makes capture look slightly *cheaper* than it is, never costlier.

Its cause is not established, and it is outside the capture code: it hits OFF batches, which run with
the collector disabled. **No product performance defect was demonstrated, so nothing was optimized.**

**L5a acceptance status: CLOSED on the owner's acceptance; the overhead gate stays INCONCLUSIVE.**
Across the three approved runs (7, 7 and 21 rounds):

- 0 FAIL on any ceiling;
- both p95 ceilings PASS where binding, and bytes PASS every time;
- the evidence median PASSED once (run 1);
- no run established every binding ceiling, so "overhead within the approved threshold" is not met.

Per the owner's instruction, this INCONCLUSIVE result stands. No other methodology is substituted,
and L5a is not marked complete.

**What would make the gate conclusive** (owner decisions, none adopted):

- measure on a host without the batch-level stall (the VMware target or another quiet machine);
- find and remove the stall's environmental cause on this host;
- or accept INCONCLUSIVE as this machine's result.

At 21 rounds, one bimodal round no longer decides the verdict. It still cannot pass while about 40 %
of the batches carry a ±400–800 ms step.

### L5a acceptance (owner decision, 2026-09-21)

The owner took the third option above: **INCONCLUSIVE is accepted as this machine's result**, and
`awkit-djnl.7` is closed on it.

- **Not established:** "overhead within the approved threshold". The gate stays INCONCLUSIVE, is not
  PASS, and no ceiling, method or evidence changed.
- **What the acceptance rests on:** option C run 3 at `a2125084` (15 PASS, 0 FAIL, 3 INCONCLUSIVE). No
  gate run measured the two later capture-path changes: the rescan at `80a135fe` and the stored-only
  count at `90bbb412`. In an informational loop the rescan's cost was within run-to-run variation. That
  loop is not gate evidence.
- **The other three criteria are green at `90bbb412`:**
  - transient failures are captured before post-failure screenshots miss them
    (`verify:ui-error-evidence` 85/85, real engine);
  - listeners are leak-free (the same suite's teardown releases every page listener and generation
    binding);
  - the baseline cause is measured (`verify:failure-cause-baseline` 71/71).
- **What it does not change:** L5b still needs the L1 go/no-go, L1.8 still FAILS, and L7 still cannot
  be entered. A later owner-approved gate run on a quiet host would replace this outcome, not add to it.

## L5b — Failure intelligence (T0)

**Status (2026-09-21): coalescing and the analysis contract are BUILT** — `src/ai/failureAnalysis.ts`,
proven by `verify:ai-error-analysis` (76/76, three mutations caught) over L5a's real `EvidenceBuffer`
and real `deriveFailureCause`. **The on-demand reports UX was built the same day** (see "L5b on-demand
surface as built"). **The `diagnostics` persistence extension was built on 2026-09-21** (see "L5b
analysis persistence as built"). `awkit-djnl.8` is `in_progress`: the automatic analysis is not built,
and the milestone cannot close under the conditional development authorization. The live quality gate
`verify:ai-error-quality-live` is built (2026-09-22, 13/0 on two runs; see "The live quality gate as
built"). On the labelled set the AI does **not** beat the baseline, so ROADMAP rule 7 does not yet let
the automatic analysis run. Hiding the deterministic conclusion from the model (`c44a6e2c`, 2026-09-22)
did not change that: see "Baseline anchoring, removed and measured". Nor did telling it which step each
event came from (`407d6080`): see "Step relevance, from the collector's step stamp". Nor did telling it
what the runner observed of each request (`e27e15bd`): on six real-runner cases the AI fell below the
baseline, 0/6 against 2/6. See "Request provenance in the failure-analysis request, measured".

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
  - **Rebuilt 2026-09-22 (`5ef4852f`), same three rules.** The runtime's grammar writes every schema
    key, so v1's separate `insufficient` flag made every real Qwen3.5-0.8B answer decline *and* conclude,
    and all were refused. Declining is now an empty `conclusion` list, the only thing that can be written
    in its place. Where it is allowed is decided from the evidence: a baseline resting on direct evidence
    must conclude (the drawer shows that cause above the answer), a failure offering nothing but the
    runner's own record can only decline, and that record is never primary evidence. Measurements and
    mutations: L1 plan › "The failure-analysis answer contract, fixed".
  - **Sized to its L1.8 ceiling 2026-09-22 (`42655904`), same three rules.** The request is one text
    block plus the routes; evidence is whole lines within 1,500 characters, and only shown ids are
    offered (the old field cap had cut the largest failure's twelfth line while its id stayed citable);
    the answer holds 2 ids per list, a 260-character explanation and 2 steps of 150, inside a 256-token
    output cap. Measurements: L1 plan › "`failureAnalysis` inside its ceiling at its own output cap".
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

### L5b on-demand surface as built (2026-09-21, `cf9bbb32`)

Deterministic provider only; `awkit-djnl.8` is `in_progress` and cannot close.

- **Where:** the run-detail drawer that Failure Analytics already opens (`FailureEvidenceSection.tsx`),
  backed by `app/main/ai/aiAssist.ts#analyzeFailure` behind `ai:analyzeFailure` (AI_USE + PAGE_REPORTS).
- **Reports UX, three sections never merged:** *Deterministic cause* (L5a's own), *Captured evidence*
  (every event exactly as persisted, read through the existing PAGE_REPORTS-gated `reports:get`), and
  *AI analysis* — on demand, labelled, with `insufficient` as a first-class answer, the coalesced count,
  and each cited event marked in the evidence list so a citation can be checked. With AI off the first two
  still show.
- **The renderer names a run and an instance; main reads the stored report.** Coalescing decides what the
  answer covers; the **named** instance is analysed, so every cited id is one the user can see beside it.
- **Decision recorded:** the per-batch budget governs the AUTOMATIC post-run analysis, which is **not
  built** (it needs the live quality gate). An explicit click on one failure is one deliberate call, so a
  failure past that budget is still answered. An insufficient baseline is still never analysed.
- **Not built:** the automatic analysis. (The `diagnostics` persistence extension and
  `verify:ai-error-quality-live`, listed here when this section was written, were built later; see below.)
- **Verifiers:** `verify:ai-error-analysis` 100/100 (a 24-check adapter section), `verify:ai-assist-gui` in
  real Electron (seeded through the real `SqliteRuntimeStore`); mutations caught: analysing the group's
  first member, ignoring the coalesced count, dropping the citation marker.

### L5b analysis persistence as built (2026-09-21)

Deterministic provider only; model-independent; built under the conditional development
authorization. `awkit-djnl.8` stays `in_progress` and cannot close. Implements the ratified policy
(DECISIONS, 2026-09-19): *analyses live and die with their run report, and are deletable and
recomputable*.

- **Shape.** `ConcurrentRunReport.diagnostics?: { analyses: StoredFailureAnalysis[] }` in
  `src/reports/ExecutionReport.ts`, kept apart from every instance's L5a `diagnostics` (evidence and
  baseline), which it never changes. One entry per coalescing **signature**, naming the instance
  analysed (its evidence ids are the ones cited) and `instanceIds`, the **coalesced references** to
  every instance that failed the same way. Old reports load unchanged; the field is absent until
  someone asks.
- **Write path.** `app/main/ai/aiAssist.ts#analyzeFailure` saves through the report store's
  `updateWith` inside the folder lane, so `change` sees the file as it is *now*: a report deleted
  while the model was answering is never resurrected, and the answer is still shown, saying it was not
  saved. Asking again replaces the entry for that signature. Saving is best-effort and never fails the
  answer.
- **What is shown is what is stored.** Every string passes `SemanticRedactor` and then the independent
  `findResidualSecrets` rescan — the L0 policy for a stored AI artifact. A residual the redactor could
  not remove **refuses the answer** (`OUTPUT_REJECTED`) rather than showing it; measured:
  `password: {hunter2}` survives `SemanticRedactor` and only the rescan catches it.
- **Delete.** New `ai:deleteFailureAnalysis` (AI_USE + PAGE_REPORTS, the pair that can create one; no
  re-auth). No policy check on purpose: a stored AI answer can be removed with local AI switched off.
  It deletes the entry covering the named instance through any coalesced member; removing the last
  entry drops the extension, so the report is byte-for-byte what the run wrote (unknown extension
  fields are kept).
- **Drawer.** Reopening shows the saved analysis without a model call (state `stored`, "Saved <time>"),
  with AI off too; citations are marked only when the entry was made for the instance on screen,
  otherwise the note names the instance it was made for. *Delete saved analysis* moves focus to the
  section heading so it does not fall to `<body>`, and the result is announced in the live status.
- **Verifiers.** `verify:ai-error-analysis` 131/131 (was 100; a new persistence section over a REAL
  `JsonProfileStore`), mutation-tested 4/4: recompute accumulates → 128; stale-read write resurrects →
  129; redaction skipped → 129; delete ignores coalesced references → 128. `verify:ai-assist-gui` 92/92
  in real Electron (was 76); two renderer mutations, run together in one build, both caught → 90/92,
  each failing only its own check (focus not moved after delete; citations never marked on a saved
  entry). `verify:ai-permissions` 93/93 and
  `verify:ai-fallback` 38/38 with the new channel admitted to both exact rosters.
- **Superseded assertion.** The GUI suite's "analysing changed nothing in the stored report" encoded
  the pre-persistence contract. It now asserts the intent across both representations: everything the
  run wrote is unchanged, exactly one analysis is added, and deleting it restores the original bytes.

### The live quality gate as built (2026-09-22, `4f81424a`)

- **What it sends:** all 14 items of the labelled set below, realised as nine run reports
  (`scripts/ai-harness/errorQualitySet.ts`) built through L5a's real `EvidenceBuffer` and
  `deriveFailureCause`. Every event is labelled `cause` or `unrelated` by the scenario's construction.
  - 409 + message and 422 + field validation are one batch, two signatures.
  - 500 + error page runs over 500 identical rows.
  - The transport failure sits beside an unrelated console error, a neutral status note and an earlier
    blocked analytics pixel. The baseline takes the pixel, so it is wrong by construction.
  - Each asked row goes through `analyzeFailure` on the real Qwen3.5-0.8B.
- **Judged hard:**
  - coalescing as labelled: 500 → 1 call, 2 → 2;
  - no call for the pass with a warning or the insufficient baseline;
  - the product's own request, with its 185 s deadline, delivered and saved;
  - no canary in the prompt or an answer (planted in URL userinfo, query and id segments, and in a
    bearer token), no residual secret, and every citation shown whole.
- **Recorded, not judged:** this section's metrics, and whether the AI beats the baseline (rule 7).
  The controls (right, wrong, mixed, wrong baseline, canary both ways, unknown id, runner as cause,
  decline) run in `verify:ai-error-analysis` and first in the live gate.
- **Results, two runs, both 13/0 with the same metrics:**

| Metric | Run 1 | Run 2 |
|---|---|---|
| Baseline accuracy | 7/8 | 7/8 |
| AI accuracy | 7/8 | 7/8 |
| AI improvement over baseline | 0 | 0 |
| False attribution | 1 | 1 |
| Declined | 0 | 0 |
| Evidence-link accuracy | 19/19 | 18/18 |
| Coalescing | 500 → 1, 2 → 2 | 500 → 1, 2 → 2 |
| Calls per batch | 1 or 2; 0 for pass and insufficient | same |
| Inference per answer | 49.7–80.5 s | 39.4–75.4 s |
| Privacy | 0 canaries, 0 residual secrets | same |

- **The one false attribution is the case built to test it.** On `transport-noise` the AI's primary
  evidence was `[unrelated, cause]`: it kept the baseline's wrong lead event (the blocked pixel) and added
  the real failed submit beside it. It never corrected the baseline, it only agreed with it. That is
  expected of the design, which gives the model the deterministic conclusion first and ranks its cited
  event first. It means that on this set the AI adds interpretation text, not accuracy.
- **Texts cut mid-sentence.** Five texts per run ended at their grammar limit (the 260-character
  explanation, or a 150-character step).
- **What it does not show:**
  - a person's reading of the explanations;
  - a rate stable across more than two samples;
  - a batch past the `maxAnalyses` budget with a live model;
  - the automatic analysis, which is not built.

### Baseline anchoring, removed and measured (2026-09-22, `c44a6e2c`)

**The hypothesis.** The request gave the model L5a's conclusion first ("Deterministic conclusion:
<code>: <reason>", "It rests on: <ids>") and ranked the cited events first. On `transport-noise` the AI
kept the baseline's unrelated lead event, so the prompt looked like the cause.

**The change (`src/ai/failureAnalysis.ts`), prompt only:**

- The cause code, reason and "rests on" ids are no longer sent.
- The offered lines are shown newest first, so the runner's own record leads. They are not in the
  baseline's order, and not oldest first, which is the baseline's own rule (the earliest direct event).
- The instructions say an event is not the cause because it came first or is an error. An event about
  something other than what the step was doing is unrelated and is not cited.
- **Unchanged:**
  - which events are offered: the baseline's citations are still ranked first under the budget, so
    every event the report names can be cited;
  - the evidence tier: `mustConclude` still comes from the baseline;
  - the grammar, the parser, redaction, the rescan, every refusal, the 185 s deadline and the
    256-token cap;
  - L5a's baseline, which the drawer still shows beside the answer.

**Three cases added beyond L5's list** (`ANCHORING_ITEMS`), labelled by construction:

- `unrelated-server-error-first`: a recommendations 503 at 300 ms is the baseline's pick, and a
  `TypeError` in the address form's save button at 1,400 ms is the cause. The baseline is wrong.
- `cause-then-unrelated-console`: the reverse. A payment 502 and its alert come first, then an
  analytics 403 in the console just before the failure. The baseline is right, so newest-first order
  cannot score by position alone.
- `timeout-unrelated-console`: a timeout beside only a favicon 404. The right answer is to decline.
  The judge now scores a row with no cause event as right only when declined.

The judge also records `citesBaselineLead`. The live mode reports `echoesWrongBaseline` (baseline wrong,
AI rests on its lead event), and the metrics again for the eight rows of `4f81424a`. Eleven model calls
pass the 600 s tool ceiling, so `verify:ai-error-quality-live-part1` and `-part2` run the set in two
parts (`--cases`). The parts' cases sum to the whole set.

**Results on the real 0.8B, two runs, each 20/0 across both parts:**

| Metric | Before (`4f81424a`, 8 rows) | Run 1, 8 rows | Run 1, all 11 | Run 2, 8 rows | Run 2, all 11 |
|---|---|---|---|---|---|
| Baseline accuracy | 7/8 | 7/8 | 9/11 | 7/8 | 9/11 |
| AI accuracy | 7/8 | 7/8 | 9/11 | 7/8 | 9/11 |
| AI improvement over baseline | 0 | 0 | 0 | 0 | 0 |
| False attribution | 1 | 1 | 2 | 1 | 2 |
| Rests on the wrong baseline's lead | — | not recorded | not recorded | 0 | 1 |
| Declined | 0 | 0 | 1 (correct) | 0 | 1 (correct) |
| Evidence-link accuracy | 19/19, 18/18 | 10/10 | 14/14 | 9/9 | 11/11 |
| Inference per answer | 39.4–80.5 s | — | 35.0–73.2 s | — | 38.1–79.5 s |

Coalescing (500 → 1, 2 → 2), zero calls for the pass and the insufficient baseline, delivery, saving,
0 canaries and 0 residual secrets held on every row of both runs.

**What it shows:**

- **The prompt was not the whole cause.** With nothing naming the baseline's pick, the model still
  made a wrong choice on both rows where the baseline is wrong:
  - `transport-noise`: primary evidence `[unrelated]` on both runs. Before, it was `[unrelated, cause]`.
    On run 2 the event was **not** the baseline's lead (the blocked pixel), so the model chose its own
    wrong event and dropped the real cause.
  - `unrelated-server-error-first`: the recommendations 503 on both runs. That is the baseline's pick,
    though it was shown last and never named. This is the same wrong choice reached independently, not
    an echo of the prompt.
- **What the change did do.** The model concluded correctly where the only other error came after the
  real cause (`cause-then-unrelated-console`). It declined where nothing but an unrelated error sat
  beside a timeout. Where it agrees with the baseline, that agreement is now a second reading, not a
  repetition.
- **So the limit is the model's own cause selection:** it does not tie an event to what the step was
  waiting for. It is not anchoring alone. The AI still does not beat the baseline, so **rule 7 keeps the
  automatic analysis off**. On-demand analysis is unchanged.
- **Not tuned on the set.** The three cases were written for this change, and no label was changed
  after seeing an answer. One prompt was measured, with no wording iterated against these rows.

**L1.8 with the new prompt:** see L1 › "`failureAnalysis` inside its ceiling at its own output cap".
`benchmark:ai-model-0-8b` re-measured `packets:failureAnalysis` at 798 prompt tokens, with
`failureAnalysisAtCap` 120,389 ms ≤ 180,000 and GO on all 8.

**What it does not show:** a rate over more than two samples; which unrelated event run 1's
`transport-noise` answer cited (`citesBaselineLead` was added after it); a person's reading of the texts.

### Step relevance, from the collector's step stamp (2026-09-22, `407d6080`)

**What the runtime records about an event's relation to the failed step.** It was traced before
anything was built:

- **Recorded:** the collector stamps every event with the step running when it was captured
  (`context.stepIndex` and `nodeId`, via `setStep`) and with its page (`pageId`). The runner's failure
  record carries the failed step's own `stepIndex`.
- **Not recorded, anywhere in the product:**
  - which request a step's action issued. No initiator is captured, and `NetworkDiagnosticsObserver` is
    armed only for stream waits;
  - the page the failed step acted on;
  - request start time.
- **Not provenance:** `ERR_BLOCKED_BY_CLIENT` is not AWKIT's own block. `ResourceRoutingPolicy` aborts
  with the default code.
- **So the step stamp is the only deterministic relevance signal.** The report does not keep the step's
  time window: only the stamps survive.

**The mechanism (`src/ai/failureAnalysis.ts`):** `stepRelations` compares each event's step stamp with
the failed step, meaning the runner record the baseline cites, else the last one.

| Relation | Meaning | May be primary evidence |
|---|---|---|
| `failedStep` | captured while the failed step ran: related by provenance, not proven the cause | yes |
| `earlierStep` | captured during an earlier step: a possible precondition (the baseline's preceding window) | yes |
| `afterFailure` | captured during a step that started after the failed one: cannot have caused it (unrelated) | **no**, in the grammar and the parser (`UNSUPPORTED_CONCLUSION`); it may be a consequence |
| `unknown` | the event or the failure record has no stamp | yes |

- **Offered events:** the baseline's citations first, as before, then the failed step's events, then
  earlier or unknown ones, then after-failure ones. Before, "closest to the failure" put after-failure
  events first.
- **Per-line tags, only when needed:** each line states its step (`[during an earlier step]`) only when
  the offered events span more than one step. A single-step request is byte-identical to `c44a6e2c`'s:
  every labelled row, and the benchmark packet.
- **Nothing else moves:** no instruction change, no causality from order, status, URL or text, and no
  benchmark label anywhere. The baseline, the tier rule and every refusal are unchanged.

**Two cases added (`PROVENANCE_ITEMS`), run by `verify:ai-error-quality-live-provenance`:**

- `earlier-step-unrelated-error`: `unrelated-server-error-first` event for event, but with the 503
  captured one step before the failed step. This is the A/B.
- `earlier-step-cause`: the reverse. A save's 500 comes one step before an assertion whose step holds
  only an unrelated console error, so "prefer the failed step" cannot win by provenance alone.
- Both baselines are right by construction; the baseline's step window already separates these.

**Results on the real 0.8B, every hard check passing:**

| | Baseline | AI | False attr. | Correct declines | Links |
|---|---|---|---|---|---|
| Labelled set, 11 rows (`-part1` 11/0 + `-part2` 9/0) | 9/11 | 9/11 | 2 | 1 | 12/12 |
| Same rows at `c44a6e2c` (two runs) | 9/11 | 9/11 | 2 | 1 | 14/14, 11/11 |
| Provenance cases, run 1 (6/0) | 2/2 | 1/2 | 1 | 0 | 2/2 |
| Provenance cases, run 2 (6/0) | 2/2 | 1/2 | 1 | 0 | 2/2 |

- **The labelled set could not move.** Every event in it is stamped with the failed step, so every
  relation is `failedStep` and the request is unchanged. Its two false attributions (`transport-noise`,
  `unrelated-server-error-first`) are within one step, where no recorded provenance separates the
  events.
- **Where provenance exists, the 0.8B ignored it.** On `earlier-step-unrelated-error` it cited the 503
  marked `[during an earlier step]` over the page error marked `[during the failed step]`, on both runs.
  On `earlier-step-cause` it cited the earlier 500 and was right. Both times it chose the HTTP error,
  whatever step it came from.
- **Latency:** answers took 38.6–87.2 s. The provenance requests were 458–463 prompt tokens and 92–101 s
  at the cap.
- **So the AI still does not beat the baseline, and rule 7 keeps the automatic analysis off.** The
  relevance that holds without the model is deterministic: an after-failure event can no longer be
  offered first or cited as the cause.

**Not done, on purpose:** barring earlier-step events whenever the failed step has direct evidence.
That would copy the baseline's window precedence into the grammar. The AI could then never be right
where the baseline's window is wrong, and it would infer cause from step order.

**What would change the result** is not a prompt: a model that reasons over the step, or runtime
provenance the product does not record (a request's initiating action, the failed step's page).

### Request-to-step provenance, recorded at runtime (2026-09-22, `3699617f`)

L5a now records the runtime provenance the step stamp lacked. No prompt, model setting, deadline,
grammar, baseline or cause-selection rule changed, and the automatic analysis stays off.

**Traced first: what Playwright and the runner can observe.**

- **Observable, and now recorded:**
  - **Request identity.** Playwright passes the collector the same `Request` object in its `request`,
    `response` and `requestfailed` events. `redirectedFrom()` links a redirect hop to its chain.
  - **When a request was issued.** The context's `request` event fires at issue. The existing step stamp
    (`context.stepIndex`) records when it was answered, which can be steps later.
  - **The request's page and frame**, from `request.frame()`.
  - **The failed step's target.** The runner already knows the page it bound for the step
    (`resolveStepPage`). The frame comes from the step's own definition: a locator with no frame chain
    resolves in the main frame, one with a chain in a child frame, and a `goto` loads the main frame.
  - **The requests the runner itself holds.** These are the response a `goto` or `routeChange`
    navigation returned, and the response a response wait matched (`validateResponseStatus`, the single
    path for armed, deferred and before-action response waits).
- **Not observable without a second capture system, so not recorded:**
  - which script call or DOM event issued a request. CDP's `requestWillBeSent.initiator` needs a CDP
    session per page, which would be a parallel network capture;
  - `hasUserGesture` and `Sec-Fetch-User` do not tie a request to the action either: user activation
    lasts about 5 s after any click;
  - which child frame a frame-chain step acted in. Only that it was a child frame is known.

**The mechanism (`ExecutionEvidence.ts`, `FailureEvidenceCollector.ts`, `StepExecutor.ts`):**

| Where | Field | Meaning |
|---|---|---|
| `http.error`, `network.failed`, `page.errorDocument` | `request.id` | `rq<N>`, one per request, kept across its redirect hops, its response and a later transfer failure |
| | `request.redirects` | hops before the one this event describes |
| | `request.issuedStepIndex`, `issuedAtOffsetMs` | the step execution and evidence-clock time at issue (0: before the first step). Absent when the start was not seen |
| | `request.link`, `linkStepIndex` | `navigation` or `responseWait`: the runner holds this request for that step. **The only confirmed link** |
| | `context.frame` | `main` or `child` frame of the event's page |
| `runner.failure` | `context.pageId`, `context.frame` | the page and frame the failed step acted on |

- **The seam:** the runner reports through an optional `RunnerProgressReporter.observe`, the progress
  reporter it already passes to every executor. This call is synchronous and never throws into a step,
  and `observe` data is never sent to the renderer.
- **The classifier:** the pure `requestRelations(events, failed?)` reads these fields against the failed
  step, by default the last runner record:

| Relation | Class | When |
|---|---|---|
| `linkedToFailedStep` | confirmed | the failed step's navigation returned it, or its response wait matched it |
| `linkedToOtherStep` | confirmed | another step's navigation or response wait holds it |
| `issuedBeforeFailedStep` | confirmed | issued before the failed step began, so not by its action (it may have been answered during it, and may still be a precondition) |
| `issuedAfterFailure` | confirmed | issued after the failure was recorded |
| `duringFailedStep` | uncertain | issued while the failed step ran, on its target page and frame, or with the target unknown |
| `offTargetDuringFailedStep` | uncertain | issued while the failed step ran, from another page or frame |
| `unknown` | — | its start was not observed, or the failure record has no step |

Nothing is inferred from co-occurrence: a request issued during the failed step with no link stays
uncertain, whatever its URL, status or timing.

**Results through the real engine (`verify:request-provenance`, 59/0).** The run used real Chromium,
`StepExecutor` and the production collector against the Runner Lab's new Request provenance section,
read back from `report.json`. In one failing checkout, step 4 clicks Save with a response wait on the
save endpoint:

| Request | Step stamp (answered) | Issued | Provenance relation |
|---|---|---|---|
| save 500, the step's response wait matched it | 4 | 4 | **`linkedToFailedStep`**, the only one |
| audit 500, issued by the same click, awaited by nothing | 4 | 4 | `duringFailedStep` |
| heartbeat 503, a same-page timer | 4 | 4 | `duringFailedStep` |
| widget 500, from a child frame | 4 | 4 | `offTargetDuringFailedStep` |
| popup 500, from another page | 4 | 4 | `offTargetDuringFailedStep` |
| inventory 502, issued by the step before | **4** | **3** | `issuedBeforeFailedStep`, where `stepRelations` says `failedStep` |

- **The failed step's own navigation:** a `goto` answered 503 and its after-wait failed. The error
  document is `linkedToFailedStep` through `navigation`.
- **Redirect:** the 302 to a 500 is `redirects: 1`, keeps its chain's issue step, and is linked to the
  step whose response wait matched it.
- **Truncated transfer:** HTTP 500 headers followed by a dropped connection
  (`net::ERR_CONTENT_LENGTH_MISMATCH`). This gives two events (`http.error` and `network.failed`) with
  one request id.
- **Cancelled request:** a request the page aborted leaves no event, as before (`ERR_ABORTED` is not a
  failure).
- **Missing start:** the production collector was attached to a real page after it had issued a
  request. That request has an id and no issue, so its relation is `unknown`, not guessed from when it
  was answered.
- **Mutation-tested:**
  - identity not cached: 21 failures;
  - failed step's target not recorded: 7;
  - issue step taken at completion: 8.

**What it cannot tell apart, by design:** the audit (caused by the action) and the heartbeat
(background) are the same class, because nothing observable separates them. A response wait on the
endpoint the step depends on turns its request into a confirmed link.

**Compatibility, privacy and cost:**

- **Compatibility:**
  - Every new field is optional, and `EVIDENCE_SCHEMA_VERSION` stays 1.
  - An older report gets no relation at all: the verifier strips the fields from a real report to check
    this.
  - With and without provenance, these are byte-identical: step relations, the coalescing signature, the
    deterministic baseline, and the failure-analysis request (prompt, offered ids, tier). The labelled
    set and the benchmark packet never pass through the collector.
- **Privacy:**
  - Provenance holds ids, counts, offsets and link kinds only. No URL, header, cookie or body is kept.
  - The payload path (redaction, rescan, path templates) is unchanged.
  - Protected-login exclusion is unchanged, and provenance has no text of its own.
- **Size:**
  - Provenance is fixed-shape metadata, like `context`. It is about 130 bytes per request event and is
    not counted in the payload byte caps.
  - The event caps (50 per source) bound it to about 20 KB per instance.
- **Overhead** (`verify:failure-capture-overhead`, 18/0 PASS, 21 rounds, run 4 in the evidence file):
  - paired median deltas: fast −3 ms [−47, 37], evidence +14 ms [−35, 50], Node CPU −8 ms
    [−31.5, 23.5];
  - evidence bytes per instance 3,941 ≤ 4,096;
  - the `request` subscription is one per browser generation, and it records facts only for the resource
    types whose failure is ever kept.

**Known limits:**

- **Folding:** an event describes its first occurrence. A linked request folded into an earlier
  identical event (same method, path and status) is counted in `repeatCount`, not described.
- **Parallel branches:** they share the instance's single step stamp. Links use each step's own latest
  execution index, and a target is recorded only for the step the collector considers current.
- **Failed navigations:** a navigation that throws (for example a transport failure) returns no
  `Response`, so that navigation's own request is not linked. `apiPolling` waits are not linked either.

**Not done here, on purpose:** the failure-analysis request does not read `requestRelations` yet.
Ranking a confirmed link first, or treating a confirmed-unrelated request differently, is a
cause-selection change: it needs labelled cases built from real-runner provenance before it is measured.
*(Done at `e27e15bd` with six such cases; measured in the next section.)*

### Request provenance in the failure-analysis request, measured (2026-09-22, `e27e15bd`)

The request now reads L5a's runtime request provenance. On the real 0.8B the product side passes every
hard check, and the model's cause selection does not improve: on the six new cases it scores 0/6 against
the baseline's 2/6. **Technical verification: PASS. Model-quality acceptance: not met.**

**The change (`src/ai/failureAnalysis.ts`):**

- `buildFailureAnalysisRequest` calls `requestRelations` against the same failed-step record
  `stepRelations` uses: the runner record the baseline cites, else the last one.
- A request line with observed provenance states it in product words:

| Relation | The line says |
|---|---|
| `linkedToFailedStep` | "the failed step waited for this request", or "the failed step's own navigation" |
| `linkedToOtherStep` | "an earlier step waited for this request" (or "a later step", or "…'s own navigation") |
| `issuedBeforeFailedStep` | "requested before the failed step began" |
| `issuedAfterFailure` | "requested after the failure" |
| `duringFailedStep` | "requested during the failed step, not linked to it" |
| `offTargetDuringFailedStep` | "requested during the failed step by another page or frame" |
| `unknown`, or no provenance | the step label from `407d6080`, shown only when steps differ |

- **Instructions:** one sentence is added, and only where a line states a relation. It says a request the
  failed step waited for or navigated to is that step's own, and that being requested while the step ran
  does not make it the step's.
- **Selection** (`relevanceRank`): the order that decides which events fit the budget.
  1. The baseline's citations, as before.
  2. The failed step's own request (`linkedToFailedStep`).
  3. The failed step's other events, including `duringFailedStep` requests.
  4. Earlier, unknown, off-target, earlier-issued and other-step events.
  5. Anything from after the failure.

  Without provenance this is exactly `407d6080`'s step order. Lines are still shown newest first, so
  neither the baseline's pick nor a link is presented as the answer.
- **Grammar and parser:** a request `issuedAfterFailure` can never be primary evidence
  (`UNSUPPORTED_CONCLUSION`), like an event from after the failed step. Every other relation stays a
  candidate. A link says which request the step waited for, not that nothing else could matter, and
  "requested during the step" is time alone.
- **The request carries `requestRelations`,** for the offered events that have provenance.
- **Unchanged:** the deterministic baseline, the evidence tier (`mustConclude`), redaction, the rescan,
  every refusal, the 185 s deadline, the 256-token cap and the model.
- **A request without provenance is byte-identical to `407d6080`'s:** older reports, the buffer-built
  labelled rows and the benchmark packet. Prompts stay 417 / 342 / 798 tokens
  (`verify:ai-failure-analysis-budget` 7/0).

**Six real-runner cases (`REQUEST_PROVENANCE_ITEMS`), run by `-requests1` and `-requests2`:**

- **Built from real runs.** `verify:request-provenance` runs five analysis-case flows from the Runner Lab
  (`?rp=` starts only the named extras) through the real engine and Chromium. It captures them to
  `scripts/ai-harness/requestProvenanceCases.json` and fails if a fresh run drifts from the committed
  capture.
- **Labelled by request name before any inference.** In each case the failed step depends on the checkout
  save, which answers 500: that is the cause. Every other named request is unrelated by the lab's
  construction.

| Case | What it isolates | The save | Baseline |
|---|---|---|---|
| `rq-linked-vs-background` | the step's own save beside a same-page heartbeat 503 | linked (response wait) | wrong: takes the heartbeat |
| `rq-linked-earlier-step` | the save beside a request an earlier step waited for | linked | right |
| `rq-issued-before` | an inventory request issued one step earlier, answered first in the failed step | linked | wrong: takes the inventory |
| `rq-off-target` | popup and child-frame requests during the step | linked | wrong: takes the popup |
| `rq-uncertain` | no response wait: the step waited for the save's success text | `duringFailedStep` | right |
| `rq-legacy` | `rq-linked-vs-background` with its provenance stripped (the A/B control) | none | wrong: takes the heartbeat |

**Results on the real 0.8B, one run of each part at `e27e15bd`, every hard check passing:**

| Rows | Checks | Baseline | AI | Improvement | False attr. | Rests on a wrong baseline's pick | Links |
|---|---|---|---|---|---|---|---|
| `-part1`, labelled set | 11/0 | 6/6 | 6/6 | 0 | 0 | 0 | 9/9 |
| `-part2`, labelled set | 9/0 | 3/5 | 3/5 | 0 | 2 | 1 | 6/6 |
| **Labelled set, 11 rows** | 20/0 | **9/11** | **9/11** | **0** | **2** | 1 | 15/15 |
| `-requests1` | 7/0 | 0/3 | 0/3 | 0 | 3 | 3 | 9/9 |
| `-requests2` | 7/0 | 2/3 | 0/3 | −2 | 3 | 1 | 9/9 |
| **Request-provenance cases, 6 rows** | 14/0 | **2/6** | **0/6** | **−2** | **6** | 4 | 18/18 |
| **All 17 rows** | 34/0 | **11/17** | **9/17** | **−2** | **8** | 5 | 33/33 |

- **The labelled set is unchanged** from `c44a6e2c` and `407d6080`: 9/11 against 9/11, false
  attributions on `transport-noise` and `unrelated-server-error-first`, and 1 correct decline
  (`timeout-unrelated-console`). Its rows carry no request provenance, so their requests did not change.
- **Held on every row:** coalescing 500 → 1 and 2 → 2, zero calls for the pass and the insufficient
  baseline, the product's own request under its 185 s deadline, delivered and saved, 0 canaries, 0
  residual secrets, and every citation shown whole.

**What the model cited on the six new rows:**

| Case | AI's primary evidence |
|---|---|
| `rq-linked-vs-background` | the heartbeat (`duringFailedStep`) and an unrelated event, not the save marked "the failed step waited for this request" |
| `rq-issued-before` | the inventory (`issuedBeforeFailedStep`) and an unrelated event |
| `rq-off-target` | the popup and the widget, both `offTargetDuringFailedStep` |
| `rq-linked-earlier-step` | the request an earlier step waited for (`linkedToOtherStep`), where the baseline was right |
| `rq-uncertain` | the request another step waited for (`linkedToOtherStep`), where the baseline was right |
| `rq-legacy` | the heartbeat and an unrelated event: the same answer as with provenance |

**What it shows:**

- **Technical verification passes.** Every answer was accepted, classified, delivered and saved, and cited
  only offered ids shown whole (33/33). There was no leak, and every call finished inside its deadline.
- **Model quality does not.** The 0.8B never cited the request marked as the failed step's own (0 of the 5
  rows that have one).
  - Where the baseline was wrong, it rested on the baseline's own pick in 4 of 4 rows.
  - Where the baseline was right, it chose a request another step waited for, and fell below the baseline
    (improvement −2).
  - The A/B pair (`rq-linked-vs-background` against `rq-legacy`) gives the same wrong answer with and
    without provenance. The request labels did not move the model.
- **This matches `407d6080`:** the 0.8B does not use the step or request provenance stated in its
  prompt. The limit is the model's own cause selection.
- **So the AI does not beat the baseline, and ROADMAP rule 7 keeps the automatic analysis off.**
  On-demand analysis is unchanged. What provenance adds without the model is deterministic: a request
  issued after the failure can no longer be offered first or cited as the cause.
- **Not tuned on the set.** The labels were fixed by request name before inference. No label, acceptance
  criterion or model output was changed after seeing an answer, and one prompt was measured.

**Latency, measured on the six new rows:** 655–770 prompt tokens and 77.3–99.0 s of inference. At the
256-token cap they project to 94.9–129.1 s: first-token time plus the cap at the measured decode rate.
All are under the 180 s ceiling and the 185 s deadline. The labelled rows took 30.8–71.6 s.

**L1.8 is unchanged.** The benchmark packet has no provenance, so its identity did not move.
`benchmark:ai-model-0-8b` re-evaluated at `e27e15bd`: 7/7 current, GO on all 8, `failureAnalysisAtCap`
120,389 ms. It ran no inference. See L1 › "`failureAnalysis` inside its ceiling at its own output cap".

**Regression suites:**

- `verify:ai-error-analysis` 401/401 (was 328). Seven mutations were caught:

  | Mutation | Checks passed |
  |---|---|
  | link ignored | 394/401 |
  | background promoted | 399/401 |
  | identity lost | 398/401 |
  | earlier-issued misread | 397/401 |
  | unknown read as observed | 400/401 |
  | after-failure request accepted | 398/401 |
  | link not ranked | 400/401 |

- `verify:request-provenance` 81/0 (was 59). Its capture-drift guard was mutation-tested and caught at
  80/1.

**What it does not show:**

- a rate: each part ran once at `e27e15bd`;
- a person's reading of the explanations;
- the two step-provenance cases at `e27e15bd`. `-provenance` was not rerun: its buffer-built rows carry
  no request provenance, so their request is unchanged from `407d6080` (AI 1/2 against the baseline's
  2/2, twice);
- the worst-case provenance request. `verify:ai-failure-analysis-budget` counts only requests without
  provenance. A request that states provenance adds one instruction sentence, and its labels come out of
  the unchanged 1,500-character evidence budget. The largest measured one was 770 prompt tokens.
- whether the deterministic baseline reading a confirmed link would be right on these rows. The
  baseline was deliberately left unchanged.

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
`verify:ai-error-analysis` (its last section audits the live labelled set and its judge), live
`verify:ai-error-quality-live` (built, 13/0 on the real 0.8B; since `c44a6e2c` the extended set runs as
`-part1` 11/0 and `-part2` 9/0, twice; since `407d6080` also `-provenance` 6/0, twice; since `e27e15bd`
also `-requests1` 7/0 and `-requests2` 7/0, once, over six real-runner request-provenance cases), and
`verify:request-provenance` (59/0 since `3699617f`: runtime request-to-step provenance through the real
engine; 81/0 since `e27e15bd`, which also captures the six cases and guards them against drift). Existing: `verify:failure-evidence(-live)`,
`verify:run-report-compatibility`, `verify:telemetry`, `verify:reports`, `verify:runner`, `verify:mock-site`,
`validate:offline`, `npm run build`. Mock-site scenarios for each signal and a fast `<3s` run with zero model calls.

## Known limits (document, don't advertise)

Swallowed exceptions with no UI/network/console trace; errors inside 2xx bodies without an explicit rule;
canvas-only errors; protected-login surfaces (excluded by design).
