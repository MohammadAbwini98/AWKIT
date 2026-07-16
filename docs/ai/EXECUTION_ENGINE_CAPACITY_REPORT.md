# Real-ExecutionEngine Shared-Browser Capacity — Benchmark & Calibration Report

**Machine:** MohammadAbwini — Intel i7-8750H, 12 logical CPU, 16 278 MB RAM (≈7 858 MB free at test
time), Windows 10 (10.0.19045). **Playwright** 1.61.0. **Date:** 2026-07-15.
All numbers below come from measured runs through the real `ExecutionEngine` dispatch path — no simulation.

Artifacts:
- `reports/browser-performance/engine-abcd.json` — A/B/C/D machine-relative ramp (45 s holds)
- `reports/browser-performance/weight-calibration.json` — Phase 6 A8 weight calibration
- `reports/browser-performance/soak.json` — Phase 9 sustained MIXED soak (Config D, 30 min)
- `reports/browser-performance/headed-anchor.json` — Headed Production Anchor (Config A vs D, F=6, headed)
- `reports/browser-performance/capacity-reserve.json` — Phase 7 memory-reserve replay (models A/B/C)
- `.benchmark-runtime/runtime/benchmarks/bench-*.json` — planner ramp validation run

---

## 1. Executive Summary

Driving **real workflow instances through `ExecutionEngine.startRun`** (queue → adaptive controller →
backpressure → weighted admission → operation limiters → browser worker pool → isolation resolver →
`BrowserContextFactory` → `SharedBrowserPool` → `PlaywrightRunner`) surfaced one **real defect** and produced
a clear, evidence-based production recommendation.

- **Defect found & fixed:** under concurrent dispatch the shared pool over-launched browsers
  (`maxBrowsers=2, concurrency=6` → **6** browsers, 1 launch key) because `selectOrLaunch` read the browser
  count, then `await`ed `launch()` before registering — a check-then-act race. The prior context-factory
  benchmark never hit it because it created contexts serially. Fixed by reserving the browser+context slot
  **atomically under the pool mutex** and creating the context outside the lock, rolling back on failure.
  Peak shared browsers dropped from 6 → **2**. Guarded by a new regression test (delayed launch, 8 concurrent
  acquisitions, cap holds). Without this fix the shared pool delivered *no* savings under real concurrency.

- **Config D (shared pool ON + A8 weighted admission ON) dominates the baseline** on every axis at the same
  target load and sustains **50 % higher stable concurrency** with zero failures.

- **Weighted admission alone (Config C) is a net negative** — it only pays off when combined with the pool.

- **Production defaults APPLIED (this change): shared pool ON by default, and A8 weighted admission ON by
  default whenever the pool is on** — with a hard dependency so weights never default on without the pool
  (Config C is harmful). Explicit `AWKIT_SHARED_BROWSER_POOL` / `AWKIT_WORKLOAD_WEIGHTS` overrides still win.

- **CapacityPlanner memory reserve CHANGED** after a machine-size replay showed the previous formula
  under-admitted on larger machines (128 GB with 23 GB free → capacity 1). The OS reserve is now a ceiling,
  not a double-counted subtraction; small/pressured machines are unchanged.

- **Browser recycling contradiction resolved**: exact per-reason close accounting proves the soak's browser
  relaunches are routine `CONTEXT_COUNT_RECYCLE` + `IDLE_DRAIN`, never memory-based (`MEMORY_THRESHOLD` = 0).

- **Headed Production Anchor (Phase 01) CONFIRMS the defaults**: headed A-vs-D at F=6 shows D delivers +122 %
  throughput, −63.5 % P95 duration, −16 % CPU P95, and half the RSS peak — the pool + A8 win is even larger
  headed than headless (see §4a).

---

## 2. Real ExecutionEngine benchmark architecture

The benchmark constructs real `ConcurrentRunProfile` + `ScenarioProfile` + `FlowProfile[]` workloads and calls
`executionEngine.startRun(...)` — the same entry point the IPC layer uses — with **no Electron/IPC**. A tiny
`electron` stub (`scripts/benchmark/electron-stub.mjs`, mapped via `TSX_TSCONFIG_PATH`) satisfies the
transitive `app`/`ipcMain` imports so `src/runner/*` loads unmodified under `tsx`. The engine builds its own
pool / adaptive / backpressure / limiters internally; the harness only toggles levers through the existing
`configureConcurrency({ useSharedBrowserPool, workloadWeights, maxBrowsersPerHost, maxActiveFlows })` API.

- `scripts/benchmark/engineHarness.mts` — stage runner, metric collector, teardown asserts.
- `scripts/benchmark/workloads.mts` — the LIGHT/MEDIUM/HEAVY/WAITING flows + MIXED picker.
- `scripts/benchmark/lib.mts` — offline workload HTTP server + per-PID Chromium RSS/CPU sampler.
- `scripts/benchmark-engine-abcd.mts` / `-weight-calibration.mts` / `-engine-soak.mts` — the three drivers,
  launched via `scripts/benchmark/run.mjs` (sets origin-cap / trace-off / bench-tsconfig env before import).

Per-run durations, statuses, queue-wait and retries are read from the **durable run store** (accurate
per-instance data), not from in-memory pool guesses. Metric families collected: SYSTEM (CPU mean/median/P95/
peak, mem %, event-loop delay), AWKIT (main RSS, node heap, queue depth, active/queued), CHROMIUM (process
count, RSS median/peak, shared browsers/contexts), SCHEDULER (adaptive target/state, weighted budget,
admission blocks + reasons, queue wait), WORKFLOW (throughput/min, duration P50/P95, failure rate, crashes).

---

## 3. Workload matrix (Phase 3)

All four classes are headless `browserContext` (shared-eligible) flows against the offline workload server:

| Class | What it does | Structural weight |
|---|---|--:|
| LIGHT | goto `/form` → 3 fills → submit → assert confirmation | 1.0 |
| MEDIUM | SPA (`/spa`, image sub-resource wait) → list/detail → `/table` → 2nd SPA nav | 1.0 |
| HEAVY | `/image-heavy` → `/multitab` popup (open + return) → `/download` file | 1.25 |
| WAITING | `/idle` → 4 s wait → response-wait on `/api/ping` → 4 s wait → assert | 1.0 |
| MIXED | 0.40 light / 0.25 medium / 0.20 heavy / 0.15 waiting, run concurrently on one engine | — |

MIXED is produced by running several single-class runs **concurrently on one engine** (pool, backpressure,
adaptive controller and weighted admission are all global across runs) — more realistic than one identical
scenario per run.

---

## 4. A/B/C/D benchmark results

Machine-relative ramp, MIXED workload, 45 s sustained holds per stage, shared-pool browser budget P=2.
Stage = target simultaneously-active instances. "Stable" = highest stage sustained with no health-stop and
≈0 failures.

**Head-to-head at F=6 (every config ran this stage):**

| Config (pool/weights) | Chromium procs | Chromium RSS (MB) | CPU P95 | Throughput/min | Dur P95 (ms) | Sustained active | Failure |
|---|--:|--:|--:|--:|--:|--:|--:|
| **A** — off / off | 20 | 1656 | 88.4 | 110.3 | 4317 | 6 | 0 |
| **B** — on / off | 11 | 791 | 90.9 | 113.5 | 3654 | 6 | 0 |
| **C** — off / on | 12 | 716 | 96.6 | 60.2 | 5016 | 4 (couldn't hold 6) | 0 |
| **D** — on / on | **10** | **727** | **81** | **124.3** | **2865** | 6 | 0 |

**Stable concurrency & metrics at each config's stable point:**

| Config | Stable concurrency | Chromium procs | Chromium RSS (MB) | Shared browsers | CPU P95 | Throughput/min | Dur P95 (ms) | Failure rate |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| A — off / off | 6 | 20 | 1656 | 0 | 88.4 | 110.3 | 4317 | 0 |
| B — on / off | 6 | 11 | 791 | 2 | 90.9 | 113.5 | 3654 | 0 |
| C — off / on | 3 | 9 | 638 | 0 | 93.0 | 71.0 | 10141 | 0 |
| D — on / on | **9** | 14 | 1060 | 2 | 92.4 | 117.4 | 4388 | 0 |

Config A health-stopped at F=9 (CPU P95 99.9 %); B health-stopped at F=9 (CPU P95 96.9 % **+ 10.2 %
failures**); C health-stopped at F=6; **D sustained F=9 cleanly (0 failures)** and only health-stopped at
F=12 (CPU P95 100 %, 40.7 % failures).

**Calculated deltas (D vs baseline A, at the shared F=6 operating point):**

- Chromium **process count −50 %** (10 vs 20)
- Chromium **RSS −56 %** (727 vs 1656 MB)
- **Throughput +12.7 %** (124.3 vs 110.3 /min)
- **P95 workflow duration −34 %** (2865 vs 4317 ms)
- **Stable concurrency +50 %** (9 vs 6)
- Queue-wait P95 ≈ unchanged (both saturate the queue by design at these targets: ~44 s)

**Pool-only effect (B vs A):** processes −45 %, RSS −52 % at F=6 — confirms the previously reported
per-context-factory savings (~38.7 % at conc 8) now measured through the **real engine**, and extends them.
The pool trades a little more AWKIT-side RSS + CPU at very low load (node/CDP overhead of shared browsers)
for large Chromium-side savings that widen as concurrency rises.

---

## 4a. Headed Production Anchor (Phase 01)

The A/B/C/D ramp and the 30-min soak were **headless**; AWKIT's real default execution mode is **headed**
(`activeOnly`), so the production-default recommendation is anchored here against headed execution. Short
cross-check only — **Config A vs Config D, MIXED, F=6, 50 s sustained per config** (in the required 45–60 s
window), through the real `ExecutionEngine.startRun` dispatch path (queue → adaptive → backpressure → weighted
admission → limiters → worker pool → isolation resolver → `BrowserContextFactory` → `SharedBrowserPool` →
`PlaywrightRunner`). Driver: `scripts/benchmark-engine-headed-anchor.mts` (`npm run benchmark:engine-headed`),
reusing the existing harness — no `chromium.launch()` per instance. Artifact:
`reports/browser-performance/headed-anchor.json`.

**Required result table (headed, F=6, 50 s each):**

| Config | Chromium procs | Chromium RSS (med / P95 / peak) | CPU P95 | Throughput/min | Dur P95 | Failures |
|---|--:|--:|--:|--:|--:|--:|
| **A** — pool off / weights off | 19 | 834 / 1579 / **2215** MB | **99.7 %** | 52.5 | 6554 ms | 0 |
| **D** — pool on / weights on | 17 | 875 / **1063 / 1065** MB | **83.8 %** | **116.6** | **2394 ms** | 0 |

Extra metrics: CPU mean A 75.3 % / D 72.5 %; CPU peak A 99.7 % / D 86.4 %; shared browsers/contexts A 0/0 /
D 2/3; duration P50 A 3270 ms / D 1557 ms; queue-wait P95 A 50 212 ms / D 45 406 ms; retries 0/0; browser
crashes 0/0; page crashes 0/0; sustained active 4/4 (both CPU-bound at F=6 headed); teardown clean both.

**Exact Config D vs A deltas:**

- Chromium **process count −10.5 %** (17 vs 19)
- Chromium RSS: **median +4.9 %** (875 vs 834 — a wash / slightly higher for D), but **P95 −32.7 %**
  (1063 vs 1579) and **peak −51.9 %** (1065 vs 2215) — D's tail is far flatter
- **CPU P95 −16.0 %** (83.8 vs 99.7) — D stays under the 85 % cap; A pins the CPU
- **Throughput +122.1 %** (116.6 vs 52.5 /min) — D more than doubles headed throughput
- **P95 workflow duration −63.5 %** (2394 vs 6554 ms)
- **Failure rate Δ 0** (0 % both)

**Conclusion — the current production defaults (Shared Pool + A8 ON) are CONFIRMED, and are *more* justified
in headed mode than headless.** Headed execution gives every dedicated browser its own visible-window
compositor/GPU/renderer, so Config A's 6 dedicated headed browsers (19 Chromium procs) **saturate the CPU**
(P95/peak 99.7 %), collapsing throughput to 52.5/min and inflating P95 duration to 6.5 s and peak Chromium RSS
to 2.2 GB. Config D shares 2 browsers (17 procs), holds CPU P95 at 83.8 % (under cap), and delivers **2.2×
throughput, 63.5 % lower P95 duration, and roughly half the RSS peak** — with zero failures/crashes and clean
teardown. The one axis where D is not better is **median** Chromium RSS (+4.9 %, a wash at this low sustained
concurrency); its P95/peak dominance and CPU/throughput gains decisively outweigh it. **No regression → no fix
needed; defaults stay enabled with headed evidence.**

---

## 5. Dynamic admission findings

- Adaptive controller + backpressure participated in **every** configuration (never disabled). Blocked-
  dispatch reasons were captured: at low pool budgets the binding constraint is "browser pool saturated";
  as load rises it shifts to "CPU pressure (>85 % cap)" and "active flow limit reached".
- **Weighting-only (C) hurts**: with dedicated (unshared) browsers, weighted admission throttles medium/heavy
  instances harder (they weigh ≥1.0) without the memory dividend that sharing provides, so stable concurrency
  fell to 3 and throughput dropped ~40 %. Weighted admission is only worth enabling **together with** the pool.
- **Weighting + pool (D) is where weighting earns its keep**: D held F=9 at 0 failures where B (pool, no
  weights) already showed 10.2 % failures at F=9 — the weighted budget kept the host inside the healthy
  envelope one full stage longer.

---

## 6. Workload weight calibration (Phase 6)

Single-class cohorts at concurrency 4, 25 s each, measured through the real engine.
`measuredRelativeCost = 0.6·cpuRel + 0.4·ramRel`.

| Workload | Existing weight | CPU/inst (cores) | RAM/inst (MB) | Dur P50 | Measured rel cost | Proposed final |
|---|--:|--:|--:|--:|--:|--:|
| light | 1.00 | 0.012 | 211 | 2006 ms | 1.00 | 1.00 |
| medium | 1.00 | 0.026 | 230 | 2581 ms | 1.74 | 1.75* |
| heavy | 1.25 | 0.00† | 231 | 3085 ms | 0.44† | 1.00 (keep) |
| waiting | 1.00 | 0.00 | 198 | 10 556 ms | 0.37 | 1.00 (keep) |

† heavy CPU sampled as 0 — its work (image decode, popup, download) is **bursty** and the 25 s cohort with
constant start/cancel churn undersamples it; its measured cost is understated, so it is **not** lowered.
\* medium's higher measured cost is real but small and CPU-noise-sensitive.

**Waiting question — answered with evidence:** the WAITING workflow stays active **5.3× longer** than LIGHT
(10 556 ms vs 2006 ms) yet consumes **~0× the CPU** and *slightly less* RAM (198 vs 211 MB). The existing
weight is **feature-based and duration-agnostic**, so it charges WAITING 1.0 — it does **not** over-charge a
long-idle workflow. This is exactly the property the task asked to verify.

**Decision — keep the existing weight seeds unchanged; do NOT add phase-aware weighting:**
1. The model's key safety property (waiting not over-charged) is **validated**, not violated.
2. The weight is emergent from **structural features** (persistent profile, headed, browser-swap, downloads,
   parallel branches, trace/video, node/nav counts) — there is no per-class constant to "bump". These four
   synthetic **headless browserContext** flows deliberately lack the heavy structural features the model
   targets, so RAM/inst is nearly flat (198–231 MB, ~1.16× spread) and provides no reliable basis to re-tune
   the structural surcharges that govern real production flows.
3. CPU at this scale is near measurement noise (0.00–0.026 cores) — not a trustworthy basis to change shipped
   constants.
4. Phase-aware weighting (RUNNING_ACTIVE / WAITING_* / DOWNLOAD_ACTIVE) showed **no meaningful value** — the
   duration-agnostic model already avoids the failure mode it would address. Per the task, it is not
   implemented.

The correct channel for future recalibration already exists: `CapacityPlanner` accepts
`measuredMemoryPerInstanceMb` / `measuredCpuCoresPerInstance` overrides and the `unmeasured → estimated →
benchmarked` confidence ladder (Phase A10), fed by real production telemetry rather than synthetic cohorts.

---

## 7. CapacityPlanner memory reserve — re-evaluation & CHANGE (Phase 7)

Replay across 4/8/16/32/64/128 GB at low/medium/high pressure (`scripts/benchmark-capacity-reserve.mts` →
`reports/browser-performance/capacity-reserve.json`) comparing three models. Medium seed 700 MB/instance,
CPU held constant to isolate the memory axis. Pressure = fraction of total that is currently **available**.

- **A (previous, shipped-until-now):** `usable = available − OS 20 %(of total) − AWKIT 1024 MB − safety 10 %(of total)`
- **B (available safety-floor):** `usable = available − 1024 MB − max(1024 MB, 10 % of available)`
- **C (chosen, now shipped):** OS reserve becomes a **ceiling** on planning memory (`planning = min(available,
  total − OS 20 %)`); then `usable = planning − 1024 MB baseline − growth(clamp(5 % of total, 512, 4096)) −
  max(1024 MB, 10 % of planning)`.

**Result — capacity (medium) at each machine × pressure; A→C = extra instances C admits vs A:**

| Machine | Pressure | Available | A usable / cap | B usable / cap | **C usable / cap** | A→C |
|---|---|--:|--:|--:|--:|--:|
| 4 GB | low | 3072 | 819 / **1** | 1024 / 1 | 512 / **1** | 0 |
| 4 GB | high | 737 | 0 / **1** | 0 / 1 | 0 / **1** | 0 |
| 8 GB | low | 6144 | 2662 / **3** | 4096 / 5 | 3584 / **5** | +2 |
| 8 GB | high | 1475 | 0 / **1** | 0 / 1 | 0 / **1** | 0 |
| 16 GB | low | 12288 | 6349 / **9** | 10035 / 14 | 9216 / **13** | +4 |
| 16 GB | high | 2949 | 0 / **1** | 901 / 1 | 82 / **1** | 0 |
| 32 GB | low | 24576 | 13722 / **19** | 21094 / 30 | 19456 / **27** | +8 |
| 32 GB | high | 5898 | 0 / **1** | 3850 / 5 | 2212 / **3** | +2 |
| 64 GB | low | 49152 | 28467 / **40** | 43213 / 61 | 39936 / **57** | +17 |
| 64 GB | high | 11796 | 0 / **1** | 9592 / 13 | 6316 / **9** | +8 |
| 128 GB | low | 98304 | 57958 / **82** | 87450 / 124 | 83354 / **119** | +37 |
| 128 GB | medium | 58982 | 18636 / **26** | 52060 / 74 | 47964 / **68** | +42 |
| 128 GB | high | 23593 | **0 / 1** | 20210 / 28 | 16114 / **23** | **+22** |

(Model C is cross-checked to equal the live `planCapacity` output on every row — 0 mismatches.)

**Finding — the previous formula unnecessarily under-admitted on larger machines, severely under pressure.**
Because OS 20 % + safety 10 % were computed on **total** and subtracted from **already-current available**,
they **double-count the OS** (available already excludes what the OS + other apps use). On a **128 GB machine
with 23.6 GB genuinely free**, model A's reserves (38.4 GB of total) exceed available entirely → **usable 0 →
capacity 1**. A 128-core-class host with 23 GB free being told to run **one** workflow is indefensible.

**Change (evidence-based, safe):** adopt model **C**.
1. The OS reserve is now a **ceiling** (`planning = min(available, total − OS 20 %)`) — it protects a rarely-
   idle host from over-committing but is never re-subtracted from available, so it can't zero out real memory.
2. The AWKIT **1024 MB absolute baseline is kept** (measured engine core 230–320 MB + Electron chrome; an
   absolute is correct because app footprint is machine-independent), now plus a **bounded machine-relative
   growth reserve** (5 % of total, clamped 512–4096 MB) — the machine-relative headroom the task asked for.
3. The safety cushion scales with **planning (available)** memory, floored at 1024 MB — it tracks real headroom.

**Why C over B:** C keeps the OS ceiling and an explicit growth reserve, so it is a touch more conservative
than B on big machines while still fixing the pathology — the safer of the two improved models.

**Why this is safe to admit more:** these are **conservative pre-benchmark seeds**, superseded by measured
overrides and gated by `requiresBenchmarkBeforeHighConcurrency` on large machines; and the live
BackpressureController (`maxSystemMemoryPercent` 85 %, `minFreeMemoryMb`) + AdaptiveController remain the
runtime guardrail regardless of the seed. Small/pressured machines are unchanged (4 GB, 8 GB-high, 16 GB-high
all still floor to **1**). Guarded by `verify:capacity-planner` (35/35, incl. new anti-pathology + `usable ≤
available` checks).

**Final formula (`src/runner/concurrency/CapacityPlanner.ts` `planCapacity`):**

```
planningMemory = min(available, max(0, total − reservedMemoryPercent% × total))     // OS reserve = ceiling
usable = max(0, planningMemory
               − awkitReservedMemoryMb                                              // 1024 MB absolute baseline
               − clamp(awkitGrowthPercentOfTotal% × total, growthMin, growthMax)    // 5 %, [512, 4096] MB
               − max(safetyReservedMemoryMb, safetyReservedMemoryPercent% × planningMemory)) // max(1024, 10% of planning)
```

---

## 8. Browser memory recycling result (Phase 8)

**Outcome: wired end-to-end, structurally correct, but INERT on this stack — by evidence, not by omission.**

The lifecycle is implemented: `SharedBrowserPool.applyMemorySamples(byId, thresholdMb, window=3)` marks a
browser `recycling` only when the **minimum** subtree-RSS over the whole moving window exceeds the threshold
(a single spike never recycles); a marked browser stops taking new leases and closes once its last context
releases (READY → DRAINING → close → replacement launches on demand). It never touches active workflows.
`ExecutionEngine.evaluateSharedBrowserMemoryRecycling` is called on a 20 s throttle from the dispatch loop and
feeds it per-browser samples from `BrowserProcessSampler` (a Windows CIM `ParentProcessId` subtree walk that
sums each browser root's own Chromium processes — the same reliable mechanism `ProcessTreeSampler` uses).

**Why it is inert:** per-browser attribution needs each pooled browser's **root Chromium PID**, obtained from
`browser.process()?.pid`. **Playwright 1.61's `Browser` exposes no `process()`** — verified both in the typed
API (only `BrowserServer` and `ElectronApplication` declare `process(): ChildProcess`) and empirically at
runtime (`typeof browser.process === "undefined"` for a locally-launched Chromium). So `browserRoots()`
returns empty, `evaluateSharedBrowserMemoryRecycling` returns before any sampling cost, and recycling never
acts. Attribution is also empty off Windows or on any sampler error — the code **never guesses**.

Per the task's explicit guidance ("if reliable per-browser attribution is not possible, document why and keep
the feature disabled rather than implementing inaccurate recycling"), the feature ships **wired but disabled
by evidence**. It was deliberately **not** enabled by rebuilding the launch path to `launchServer()` +
`connect()` (the only way to get a `BrowserServer.process()` handle), because that is a material change to the
proven launch/isolation architecture — off-limits absent a defect, and unjustified for an optional feature.
The wiring is kept intact so that a launch path which *does* surface a root PID (a remote browser server, or a
future Playwright that exposes it) lights the feature up with **no further code change**.

Note: the default `browserRecycleMemoryMb` is 2500 (not 0), so the intent is "on when attributable" — it is
the missing PID, not a disabled flag, that keeps it inert today.

**Resolving the "browsers recycled" contradiction (exact lifecycle attribution).** An earlier draft described
the soak's falling Chromium RSS and its browser relaunches as "browsers recycled", which read as if
memory-based recycling was acting — it was not. `SharedBrowserPool` now stamps and counts an **exact close
reason** for every browser retirement, exposed on the snapshot as `closeReasons` (and `launchFailures`):

`CONTEXT_COUNT_RECYCLE` · `MEMORY_THRESHOLD` · `IDLE_DRAIN` · `UNHEALTHY` · `CRASH` · `POOL_SHUTDOWN` ·
`LAUNCH_FAILURE` · `OTHER`.

A forced-recycle smoke (recycle-after-8-contexts, 1 min) attributed **CONTEXT_COUNT_RECYCLE=22, IDLE_DRAIN=3,
MEMORY_THRESHOLD=0**, and the 30-min soak (recycle-after-50, shipped default) shows the same shape (see §9's
`close reasons` line). So every relaunch/close is **routine context-count recycling** (a browser is drained
and replaced after it has created `browserRecycleAfterContexts` contexts) plus **idle drain / pool shutdown**
at the end — and `MEMORY_THRESHOLD` is always **0**, consistent with the inert memory path. The falling
Chromium RSS is that ordinary recycle/drain releasing processes, **not** memory-threshold recycling. The
report no longer conflates the two.

---

## 9. Soak-test results (Phase 9) — full 30 minutes

Config D (shared pool ON + A8 weights ON + adaptive ON + backpressure ON), MIXED workload, concurrency 6,
**30.0 minutes**, 110 snapshots (15 s cadence). Exit 0. Artifact: `reports/browser-performance/soak.json`.

**Workflow / crash counters:** completed **≈3822** (live counter 61 → 3883, ≈**127/min** — matches Config D's
benchmark throughput); **failed 0, retries 0, browser crashes 0, page crashes 0**. (The durable run-history
query returned 495 completed rows — a store retention/flush artifact, not the real total; it too shows 0 failed
/ 0 retries. No failure or crash log line appeared across the run.)

**Counts over time (bounded — the pool caps process count under sustained load):**

| | start | end | peak |
|---|--:|--:|--:|
| Shared browsers | 3 | 3 | **4** |
| BrowserContexts | 4 | 5 | **5** |
| Pages (≈contexts) | 4 | 5 | **5** |
| Chromium processes | 14 | 12 | **17** |
| Queue depth | 8934 | 5112 | 8934 |

**Memory / handles (start → end, P95, peak — and the honest first-third→last-third drift):**

| Metric | start | end | P95 | peak | 1st⅓→last⅓ avg | Read |
|---|--:|--:|--:|--:|--:|---|
| Node heap (MB) | 135 | 169 | 196 | 300 | 172 → 170 | **flat — no JS-heap leak** |
| Active handles | 48 | 63 | — | 99 | 50 → 45 | **flat/down — no handle leak** |
| Chromium RSS (MB) | 946 | 1312 | 1426 | 1669 | 1088 → 1115 | flat (recycle sawtooth) |
| AWKIT/main RSS (MB) | 239 | 319 | 344 | 368 | 247 → 302 | mild **+55 MB** native-RSS drift, bounded |

**Browser lifecycle by exact reason (item 3 evidence):** relaunched **80** = closed **80**, launch failures 0.

```
CONTEXT_COUNT_RECYCLE = 77     MEMORY_THRESHOLD = 0     IDLE_DRAIN = 3
UNHEALTHY = 0   CRASH = 0   POOL_SHUTDOWN = 0   LAUNCH_FAILURE = 0   OTHER = 0
```

Every one of the 80 browser retirements is **routine context-count recycling** (a browser drains + is replaced
after `browserRecycleAfterContexts` = 50 contexts) plus a few idle drains. **`MEMORY_THRESHOLD` = 0** confirms
memory-based recycling never fired (inert, as §8) — the falling/rising Chromium RSS is ordinary recycle churn,
not memory recycling.

**Teardown asserts — all clean (exit 0):**

```
active workflows            = 0
leased contexts             = 0
orphan contexts             = 0
orphan pages                = 0
stale leases                = 0
orphan Chromium processes   = 0
→ CLEAN ✓
```

**Honest leak assessment.** The load-bearing leak signals are clean: **JS heap flat** (172→170 MB third-avg),
**active handles flat** (50→45), **shared browsers / contexts / pages flat and bounded** (≤4/≤5/≤5), browser
launches balanced (80 opened = 80 closed), and **teardown fully clean** (zero active/leased/stale/orphan). The
one non-flat metric is **AWKIT process RSS**, which drifted **+55 MB** (247→302 MB third-avg, peak 368) — native
RSS high-water without any accompanying heap/handle growth, bounded and plateauing; worth watching on multi-hour
runs but not a JS/handle/context/browser leak. Note: `queueWaitP95 ≈ 29.8 min` is an artifact of front-loading
9000 instances into the queue to keep the engine saturated — it is a soak-design number, not production latency.

---

## 10. Verification results

| Suite | Result |
|---|---|
| `npm run build` (tsc --noEmit + electron-vite) | ✅ pass |
| `verify:concurrency-defaults` (shipped defaults + pool→weights dependency; now ENFORCED, see §15) | ✅ 18/18 |
| `verify:capacity-planner` (incl. NEW anti-pathology + `usable ≤ available` checks) | ✅ 35/35 |
| `verify:capacity-modes` / `verify:machine-capabilities` / `verify:benchmark-planner` | ✅ 10/10 · 20/20 · 36/36 |
| `verify:shared-browser-pool` | ✅ 19/19 (over-launch race regression) |
| `verify:browser-isolation` | ✅ 27/27 |
| `verify:runner` (live, now pool-ON by default) | ✅ 82/82 |
| `verify:concurrency` (now pool-ON by default) | ✅ 78/78 |
| `verify:shared-browser-live` | ✅ 5/5 |

Exact commands: `npm run build`, `npm run verify:concurrency-defaults`, `npm run verify:capacity-planner`,
`npm run verify:capacity-modes`, `npm run verify:machine-capabilities`, `npm run verify:benchmark-planner`,
`npm run verify:shared-browser-pool`, `npm run verify:browser-isolation`, `npm run verify:runner`,
`npm run verify:concurrency`, `npm run verify:shared-browser-live`, `npm run benchmark:capacity-reserve`,
`npm run benchmark:engine-soak` (30-min), `npm run benchmark:engine-headed` (Phase 01 headed anchor).

---

## 11. Changed files

- `src/runner/concurrency/ConcurrencyConfig.ts` — **shipped defaults flipped**: `useSharedBrowserPool` → true;
  `workloadWeights` now defaults to the resolved pool state (dependency), explicit env still wins.
- `src/runner/concurrency/CapacityPlanner.ts` — **memory reserve model changed** to Model C (OS reserve as
  ceiling; absolute baseline + bounded growth reserve; safety off available); new tuning fields + `clampRange`.
- `src/runner/browser/SharedBrowserPool.ts` — **close-reason accounting** (`SharedBrowserCloseReason`,
  `closeReasons`/`launchFailures` on the snapshot, per-reason attribution at every retirement); prior
  over-launch race fix + memory-recycling API retained.
- `scripts/benchmark-engine-soak.mts` — richer metrics (P95/peak, queue-wait P95, crashes, close-reason
  breakdown, orphan pages).
- `scripts/verify-concurrency-defaults.mts` (new) — proves the shipped defaults + pool→weights dependency.
- `scripts/benchmark-capacity-reserve.mts` (new) — the reserve replay/comparison.
- `scripts/benchmark-engine-headed-anchor.mts` (new) — Phase 01 headed A-vs-D anchor (`benchmark:engine-headed`).
- `scripts/verify-capacity-planner.mts` — added anti-pathology + `usable ≤ available` + protection checks.
- `package.json` — `verify:concurrency-defaults`, `benchmark:capacity-reserve` scripts.
- `docs/ai/EXECUTION_ENGINE_CAPACITY_REPORT.md` — this report (+ CURRENT_STATE / TASK_LOG / KNOWN_ISSUES).
- Prior-session files retained: `ExecutionEngine.ts`, `BrowserProcessSampler.ts`, benchmark harness,
  `verify-shared-browser-pool.mts`.
- **Concurrency closing task (Phases 02–06) changed files: see §17** (ConcurrencyConfig, RuntimeStore +
  SqliteRuntimeStore, TelemetryContracts, ExecutionEngine, engineHarness, soak, verify-concurrency-defaults,
  verify-telemetry, new verify-durable-accuracy, package.json).

---

## 12. Remaining risks

- Single machine (12-core / 16 GB), single run per stage, synthetic mock-site flows. The A/B/C/D contrast is
  large and consistent, but absolute numbers won't transfer verbatim to other hardware or real sites.
- Heavy-class CPU was undersampled (bursty work + short cohort) — treat heavy's measured cost as a floor.
- Memory recycling is unexercised on this stack (no per-browser PID on Playwright 1.61) — logic tested, no
  live end-to-end proof until a PID-bearing launch path exists; `MEMORY_THRESHOLD` close-count stays 0.
- **Defaults now ship pool + weights ON.** The runtime BackpressureController/AdaptiveController remain the
  live guardrail, but the change should still be validated on a clean packaged machine (GUI walkthrough) and
  on lower-spec hardware before wide release. The new reserve model admits more on large machines by design;
  its higher seeds are bounded by benchmark-gating + runtime backpressure but are not yet field-proven at scale.

---

## 13. Production defaults (Phase 10) — APPLIED

**Shipped defaults now enable BOTH the shared browser pool AND A8 weighted admission (Configuration D),** with
a dependency so weighting never ships on without the pool (Config C measured harmful).

Evidence: at equal load D cut Chromium processes 50 % and RSS 56 %, raised throughput 12.7 %, lowered P95
duration 34 %, and sustained 50 % higher stable concurrency than the baseline — with zero failures through
F=9 where the no-weight pool (B) had already begun failing.

**Exact shipped values (`ConcurrencyConfig.ts` DEFAULTS + `loadConcurrencyLimits` resolution):**

| Setting | Env | Shipped default | Notes |
|---|---|---|---|
| Shared browser pool | `AWKIT_SHARED_BROWSER_POOL` | **ON** (`useSharedBrowserPool: true`) | off via `=0/false/no/off` |
| A8 weighted admission | `AWKIT_WORKLOAD_WEIGHTS` | **follows the pool** → ON by default | never on independently |
| `browserRecycleMemoryMb` | `AWKIT_BROWSER_RECYCLE_MEMORY_MB` | 2500 | inert until per-browser PID exists |
| Weight seeds | — | unchanged | validated; recalibrate via measured overrides |

**Dependency (verified, `verify:concurrency-defaults` 18/18 — ENFORCED as of Phase 02, see §14):**

```
AWKIT_SHARED_BROWSER_POOL unset,  AWKIT_WORKLOAD_WEIGHTS unset  → pool=ON,  weights=ON
AWKIT_SHARED_BROWSER_POOL=true,   weights unspecified           → pool=ON,  weights=ON
AWKIT_SHARED_BROWSER_POOL=false,  weights unspecified           → pool=OFF, weights=OFF   (never on without pool)
AWKIT_SHARED_BROWSER_POOL=true,   AWKIT_WORKLOAD_WEIGHTS=false   → pool=ON,  weights=OFF   (operator disables)
AWKIT_SHARED_BROWSER_POOL=false,  AWKIT_WORKLOAD_WEIGHTS=true    → pool=OFF, weights=OFF   (FORCED OFF + diagnostic)
```

`weights=false` while the pool is ON is always honoured. `weights=true` while the pool is OFF (Config C) is
**refused** — weighted admission can never resolve ON without the pool — and a searchable diagnostic is
emitted. Config C is therefore unreachable through normal configuration (Phase 02 hardened this; the prior
behavior on the last line let an explicit `weights=true` recreate Config C).

---

# Concurrency Closing Task (Phases 02–06)

Final closure of the three outstanding validation gaps: the headed production anchor (Phase 01, §4a above),
the enforced Shared-Pool → A8 dependency (Phase 02), and the proven durable run-history root cause with its
accuracy/reporting follow-through (Phases 03–05). No optimization work was reopened.

## 14. Headed Anchor Results (Phase 01)

See **§4a**. Summary: headed, `activeOnly`, MIXED, F=6, 50 s per config through the real `ExecutionEngine`.
Config **D** (pool+weights ON) vs **A** (both OFF): **CPU P95 −16.0 %** (83.8 vs 99.7 %), **throughput +122.1 %**
(116.6 vs 52.5/min), **P95 duration −63.5 %** (2394 vs 6554 ms), Chromium **procs −10.5 %** and **RSS peak
−51.9 %**, 0 failures/crashes, clean teardown. **Production defaults CONFIRMED for headed execution** — no
regression, no fix required. Artifact: `reports/browser-performance/headed-anchor.json`.

## 15. Shared Pool / A8 Dependency (Phase 02) — ENFORCED

**What happens for the invalid explicit combination:**

```
AWKIT_SHARED_BROWSER_POOL=false
AWKIT_WORKLOAD_WEIGHTS=true
→ resolved pool    = OFF
→ resolved weights = OFF   (forced; Config C is NOT activated)
→ diagnostic (console.warn, once, searchable):
  [concurrency] AWKIT_WORKLOAD_WEIGHTS=true ignored because Shared Browser Pool is disabled.
                Weighted admission requires Shared Browser Pool.
```

**Final resolution rules** (`loadConcurrencyLimits` + `resolveWeightedAdmission`, one authoritative path):

| `AWKIT_SHARED_BROWSER_POOL` | `AWKIT_WORKLOAD_WEIGHTS` | Resolved pool | Resolved weights | Diagnostic |
|---|---|---|---|---|
| unset | unset | ON | ON | — |
| `true` | unset | ON | ON | — |
| `false` | unset | OFF | OFF | — |
| `true` | `false` | ON | OFF | — |
| `true` | `true` | ON | ON | — |
| `false` | `true` | **OFF** | **OFF** | **emitted** |

- No application-startup error; no silent Config C; the operator request is never silently discarded (a clear
  diagnostic is always emitted for the invalid explicit combo).
- Explicit `weights=false` is still respected when the pool is ON; the pool may be disabled independently;
  weighted admission may not run independently.
- Enforcement lives only in `loadConcurrencyLimits` (the single place the app resolves pool/weights from env
  — the app's `configureConcurrency` only ever overrides `maxBrowsersPerHost`/`maxActiveFlows`, never
  pool/weights). The benchmark harness can still construct Config C via a direct programmatic override, which
  is how it was measured harmful — intentionally out of the "normal configuration" path.
- **Changed files:** `src/runner/concurrency/ConcurrencyConfig.ts` (add `resolveWeightedAdmission` +
  `WEIGHTED_ADMISSION_REQUIRES_POOL_DIAGNOSTIC` + dedup emitter; enforce on final merged values),
  `scripts/verify-concurrency-defaults.mts` (invert the old "explicit weights=true preserved" assertion →
  now "forced OFF + diagnostic"; add resolver truth table + emission checks).
- **Tests:** `verify:concurrency-defaults` **18/18** (was 12/12), including the resolver unit truth table and
  the loadConcurrencyLimits diagnostic emission.

## 16. Durable History Root Cause (Phase 03) — PROVEN

**Exact cause:** the 30-minute soak counted live completions from the in-memory instance pool
(`engine.getInstances().filter(status === "completed")` ≈ 3822) but counted durable completions from a
**single run-history page** that `queryRunHistory` **hard-clamps to 500 rows**, so the durable count could
never exceed 500 (observed 495). It is a **read-side query-limit bug in the benchmark's counting method**, not
lost, unflushed, overwritten, or retention-pruned writes — every completed run WAS persisted.

- **Clamp:** `src/runner/store/SqliteRuntimeStore.ts` › `queryRunHistory` — `const limit = Math.min(500,
  Math.max(1, page.limit ?? 50))`. A caller asking for `{ limit: 200000 }` receives ≤ 500 rows; `page.total`
  (an **unbounded** `SELECT COUNT(*)`) held the true count but the soak never read it.
- **Misuse site:** `scripts/benchmark-engine-soak.mts` — `getTelemetryRunHistory({}, { limit: 200000 })` then
  `runHistory.rows.filter(status === "completed").length`.
- **Alternatives rejected with evidence:**
  - *Lost/unflushed writes* — rejected: the sql.js DB is mutated **synchronously** on each terminal `upsertRun`
    (`ExecutionEngine.ts:1143`), so in-process reads see every write immediately; and a store reopened from the
    SQLite file on disk after `persistDurableNow()` returns **all** rows (Phase 04 Part D).
  - *Retention pruning* — rejected: `sweepRetention` runs **once at startup** on an empty DB with
    `retentionRuns: 5000` (`ExecutionEngine.ts:275`); 3822 < 5000, so nothing was pruned.
  - *Key collision / overwrite* — rejected: `runtime_runs.instanceId` is the `PRIMARY KEY` and instanceIds are
    unique per instance, so each run is exactly one row (Phase 04: no duplicate/missing IDs across pages).
- **Runtime reproduction:** `scripts/verify-durable-accuracy.mts` reproduces the exact mechanism through the
  real engine — with 648 durable rows, one clamped page returns **500** while the aggregate/pagination return
  **648** (see §18).

## 17. Fix Applied (Phase 03/05) — every code change

- `src/runner/store/RuntimeStore.ts` — interface: add `countRunsByStatus(range?, filter?)` (unbounded
  aggregate) and `getRun(instanceId)` (keyed lookup); `NullRuntimeStore` implements both.
- `src/runner/store/SqliteRuntimeStore.ts` — add `countRunsByStatus` (`SELECT status, COUNT(*) … GROUP BY
  status`, no row cap); extract a shared `runFilterClause` used by both `queryRunHistory` and the aggregate so
  a page and its count always describe the same population; **`queryOverview` now sources totalRuns /
  successRuns / failedRuns / cancelledRuns / otherRuns / rates from the aggregate** (previously counted a
  ≤ 5000 materialized row read — a latent under-count once > 5000 runs land in a window). Duration/queue-wait
  percentiles stay on the most-recent-N-in-range window (documented; N=5000 ≥ retention cap).
- `src/reports/TelemetryContracts.ts` — add the `RunStatusCounts` contract.
- `src/runner/ExecutionEngine.ts` — add `getTelemetryStatusCounts` (delegates to the aggregate),
  `persistDurableNow()` (explicit durable drain), and switch `getTelemetryRunDetail` **and**
  `getRecoveryDetails` from a `listRuns(1000)` scan to the keyed `getRun` (detail now available for any
  retained run, not just the recent 1000).
- `scripts/benchmark/engineHarness.mts` — add `readAllRunHistory(engine, range?, filter?)` that follows
  pagination against `page.total`; `drainRuns` uses it instead of one `{ limit: 100000 }` page.
- `scripts/benchmark-engine-soak.mts` — count via `getTelemetryStatusCounts` + `readAllRunHistory`, and log a
  live-vs-durable reconciliation (`durable completed === live completed → MATCH`).
- `scripts/verify-durable-accuracy.mts` (new) + `scripts/verify-telemetry.mts` (new Part I) + `package.json`
  (`verify:durable-accuracy`).

## 18. Durable Accuracy Verification (Phase 04)

`npm run verify:durable-accuracy` — real `ExecutionEngine` + durable SQLite, Config D, bounded known workload
(600 OK + 40 hard-failing + 40 long-waiting cancelled mid-flight at concurrency 8), explicit `persistDurableNow`
drain (no arbitrary sleep). Artifact: `reports/browser-performance/durable-accuracy.json`. **27/27 checks.**

| Metric | Count |
|---|--:|
| Submitted | 680 |
| Completed | 600 |
| Failed | 40 |
| Cancelled | 40 |
| Expected Persisted | 648 |
| Actual Persisted | 648 |

- `submitted (680) === completed + failed + cancelled` (live invariant) ✓
- `expected persisted (648) === actual persisted (648)` ✓ — the 32 pending-cancelled instances never dispatched
  at concurrency 8, so they correctly persist no row; the 8 dispatched-cancelled instances are durably recorded
  as `cancelled`.
- **Bug reproduced + fixed at scale:** one clamped page returns **500** rows (< 648), while `readAllRunHistory`
  (pagination) and `countRunsByStatus` (aggregate) both return **648**; no duplicate / no missing instanceIds.
- **No write loss:** every completed and every failed instance has exactly one durable row; a store reopened
  from disk sees all 648.
- **Retention:** default cap (5000) ≫ workload → nothing pruned; a cap of 100 deterministically retains
  `min(total, 100)` most-recent terminal rows (interrupted/recoverable rows are never swept).

## 19. Reporting / Statistics Impact (Phase 05)

The `~3822 vs 495` discrepancy did **not** corrupt shipped UI statistics (each headline surface already used a
complete aggregate or live in-memory counts), with **one latent read-model defect fixed** in `queryOverview`.

| Statistic / View | Data source | Limited by pagination? | Limited by retention? | Correct? |
|---|---|---|---|---|
| Total runs (Overview) | `countRunsByStatus` aggregate (was ≤5000 row read) | No (was: >5000) | Retention window | **Fixed** ✓ |
| Success / Failure / Cancelled count (Overview) | `countRunsByStatus` aggregate | No | Retention window | **Fixed** ✓ |
| Success / Failure rate (Overview) | derived from the aggregate counts | No | Retention window | **Fixed** ✓ |
| Avg / P95 duration (Overview) | most-recent-N-in-range window (N=5000 ≥ retention) | No (documented window, DESC — not a first page) | Retention window | ✓ |
| Run history list + "N run(s) in range" | `queryRunHistory` page + unbounded `COUNT(*)` `total` | No (UI reads 25/page, shows `total`) | Retention window | ✓ (already) |
| Workflow comparison / per-workflow stats | store-side aggregation over ≤10000-in-window (≥ retention) | No | Retention window | ✓ |
| Failures breakdown | store-side aggregation over ≤10000-in-window (≥ retention) | No | Retention window | ✓ |
| Concurrent Instance Monitor (live distribution) | live in-memory `executions.list()` | No (not durable) | No | ✓ |
| Live Report / runtime series | capacity-snapshot samples (time-bucketed) | No | Raw-sample window | ✓ |

- **Fix:** `queryOverview` counts/rates now come from the unbounded aggregate (previously a ≤5000 materialized
  row read — correct under default retention, but a latent under-count once > 5000 runs accumulate in a window
  before the next startup sweep). No UI redesign.
- **P95 population:** computed from the most-recent-N runs in range (ordered `DESC`), i.e. a documented
  reporting window ≥ retention capacity — **not** an arbitrary first page.
- No other statistic derived a headline total from `rows.length` of a clamped page (verified across the
  renderer): the Instances page shows the unbounded `total`; the Overview shows aggregates; the Instance
  Monitor counts live instances.

## 20. Closing Verification & Remaining Risks

**Commands run (this closing task):**

| Command | Result |
|---|---|
| `npm run build` (tsc --noEmit + electron-vite) | ✅ pass |
| `npm run verify:concurrency-defaults` | ✅ 18/18 |
| `npm run verify:telemetry` | ✅ 61/61 (incl. new Part I: aggregate vs clamp, `getRun`) |
| `npm run verify:durable-accuracy` (N=600) | ✅ 27/27 |
| `npm run verify:concurrency` | ✅ 78/78 |
| `npm run verify:runner` (live) | ✅ 82/82 |
| `npm run verify:shared-browser-pool` | ✅ 19/19 |
| `npm run verify:browser-isolation` | ✅ 27/27 |

**Remaining risks (genuine, not already-resolved):**

- `queryWorkflows` / `queryFailures` / `queryWorkflowComparison` read up to 10000 in-window rows (≥ the 5000
  default retention cap, so complete for the retained window). If an operator raises
  `AWKIT_REPORT_RETENTION_RUNS` well past 10000, those breakdowns would cover only the most-recent 10000 —
  a documented window, not a wrong lifetime total. The headline Overview counts are aggregate-exact regardless.
- The durable accuracy verifier is single-machine, headless, synthetic mock-site flows; it proves count
  correctness and the read-path fix, not absolute throughput on other hardware.
