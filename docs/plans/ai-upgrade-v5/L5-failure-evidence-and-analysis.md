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
analysis persistence as built"). `awkit-djnl.8` is `in_progress`: the automatic analysis and the live
quality gate are not built, and the milestone cannot close under the conditional development
authorization.

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
- **Not built:** the automatic analysis, `verify:ai-error-quality-live`. (The `diagnostics` persistence
  extension, listed here when this section was written, was built later the same day; see below.)
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
