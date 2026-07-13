# Plan — Machine-Agnostic Concurrency Capacity + Per-Workflow Comparison Reports

**Status:** PLAN ONLY — no production code changed by this document. Written to be executed later.
**Author context:** derived from `AWKIT-Concurrency-and-Resource-Optimization.md` (owner guide) reviewed
against the live codebase on 2026-07-12; revised 2026-07-12 to be **fully hardware-agnostic**.
**Scope:** two workstreams:

- **A. Concurrency & capacity** — the system dynamically inspects the **current host**, derives a
  **per-machine** capacity recommendation, offers **Sequential / Auto / Manual** modes, calibrates through
  **machine-relative benchmarks**, adapts to **live resource pressure**, and lands the guide's resource
  optimizations (shared browser pool, operation limiters, weights, lean/artifact profiles).
- **B. Workflow reporting** — a report that compares each workflow against its own **history runs**, shows
  richer **statistics per workflow**, and records the **machine context** of every run so runs on
  different hardware are never compared as if equivalent.

> **Hardware-agnostic mandate (non-negotiable for this plan).** AWKIT may run on 4-core laptops, 8-core
> desktops, 32-core servers, VMs with throttled allocations, or hosts shared with other applications.
> **No CPU count, RAM size, browser count, context count, memory reserve, or concurrency number may be
> hardcoded as a target, default, or production profile.** Every such value is either (a) detected from the
> current host, (b) a configurable default/bound, or (c) a measured benchmark result. Specific hardware
> shapes (including any 8-GB, 16-GB, 32-GB, 48-GB, 64-GB, or 128-GB machine) appear **only as clearly
> labelled examples or test fixtures** — never as a production default.

Read `AGENTS.md` › required-reading order and `docs/ai/RULES.md` before executing any phase. Keep
**offline-first** and the **Hologram design-token** UI rules throughout.

---

## 0. How to use this plan

- Phases are ordered by dependency; do them top-to-bottom within a workstream.
- Each phase lists **Goal · Touchpoints (real files) · Approach · Contract/schema changes ·
  Verification · Risks**.
- All numeric defaults shown are **configuration seeds**, not fixed constants — they live in one
  `CapacityTuning` config object (§2.4), are overridable, and are validated at bounds.
- Suggested PR grouping is in §9; owner decisions in §10; example/fixture machines in §11; migration in
  §12; acceptance criteria in §13; the "document corrections" log in §14.

---

## 1. Current state (confirmed from code — the baseline you build on)

### 1.1 Concurrency runtime (what exists)

| Concern | Where | Behavior today |
|---|---|---|
| Host caps | `src/runner/concurrency/ConcurrencyConfig.ts` (`ConcurrencyLimits`, `loadConcurrencyLimits`) | Static conservative defaults (`maxBrowsersPerHost` 2, `maxContextsPerBrowser` 4 *unused for multi-instance*, `maxActiveFlows` 4, `minFreeMemoryMb` 512, `maxSystemMemoryPercent` 85, `maxCpuPercent` 85, `maxProcessMemoryMb` 2048, `maxPerOrigin` 2, `maxPerAccount` 1). All env-overridable. **Not derived from the host.** |
| Browser slots | `src/runner/browser/BrowserWorkerPool.ts` | A **semaphore of `maxBrowsersPerHost`**. **One browser process per running instance.** `reconfigure()` mutates soft caps in place; rebuilds the semaphore **only when idle**. |
| Browser launch | `src/runner/BrowserContextFactory.ts` (`create`) | `browserContext` → `chromium.launch()` **+ one** `browser.newContext()`. `persistentContext` → `launchPersistentContext()` under an exclusive `profile:*` lock. |
| Admission | `src/runner/concurrency/BackpressureController.ts` (`admit`) | Blocks new dispatch on pool saturation, `maxActiveFlows`, free-mem floor, crash rate, sampled system-mem %, process RSS, CPU %. Prefers queueing. |
| Dispatch loop | `src/runner/ExecutionEngine.ts` (`processQueue` ~L472, `runInstanceInner` ~L591) | Per 500 ms tick: promote → admission → `startPending` → `tryAcquireSlot` per instance → origin/account claims → `runInstance`. |
| Sampling | `src/runner/concurrency/ResourceSampler.ts`; `src/runner/runtime/ProcessTreeSampler.ts` | System mem %, main-proc RSS, system+process CPU %; Chromium subtree count/memory (Windows CIM). Best-effort, never throws. |
| Settings surface | `app/main/uiSettings.ts` (`runtime: { maxBrowsers, maxActiveFlows }`, defaults `{2,4}`, bounds browsers 1–16 / flows 1–64); `app/main/ipc/execution.ipc.ts` (`applyRuntimeConcurrencyFromSettings` pushes at startup / on save / before each run) → `ExecutionEngine.configureConcurrency` (~L260) → `BrowserWorkerPool.reconfigure`. | Two static numbers; **no machine detection, no per-machine profile, no sequential/auto UX.** |
| Run modes | `src/instances/ConcurrentRunProfile.ts` (`single \| fixedConcurrent \| dataDrivenConcurrent \| multipleScenarios`), `maxConcurrentInstances`. | `maxConcurrentInstances = 1` already yields sequential behavior; no first-class Sequential/Auto. |

**Reuse note:** the existing static defaults are acceptable as **absolute safety floors/bounds** (e.g. a
minimum free-memory protection), but they must be reframed as *configurable protections*, never as the
target capacity. The target is always derived per machine (§2–§3).

### 1.2 Reporting (what exists)

- Durable read-model over SQLite (`src/runner/store/SqliteRuntimeStore.ts`, schema `RuntimeStoreSchema.ts`
  at migration **v2 = `reporting-extensions`**).
- `src/reports/TelemetryContracts.ts`: `WorkflowReportRow` (runs, success/failed/cancelled, successRate,
  `DurationStats` avg/median/p95, avgQueueWaitMs, retryCount, lastRun*), `RunHistoryRow/Page`,
  `TelemetryOverview`, plus `percentile`/`durationStats` helpers.
- IPC `app/main/ipc/telemetry.ipc.ts` → preload `telemetry.*` → renderer.
- UI `app/renderer/pages/ReportsWorkflows.tsx`: sortable per-workflow table + Recent Runs drill-down.
  Charts are hand-rolled SVG in `app/renderer/components/reports/*`.

### 1.3 Gap analysis vs the owner guide (machine-agnostic framing)

| Requirement | Status | Plan phase |
|---|---|---|
| Detect the current host's CPU/RAM/OS and record it | ❌ | **A1** |
| Per-machine capacity calculation (conservative before benchmarks) | ❌ | **A2** |
| Persisted **per-machine** capacity profile + recalibrate on hardware change | ❌ | **A3** |
| Sequential / Auto / Manual modes (machine-independent Sequential) | ⚠️ implicit only | **A4** |
| Shared browser pool + isolated contexts, **derived sizing** | ❌ (1 browser/instance; fixed config) | **A5** |
| Operation limiters (launch/nav/download/screenshot) | ❌ | **A6** |
| Adaptive controller driven by **live environmental pressure** | ⚠️ backpressure pauses; no grow/shrink target | **A7** |
| Workload-aware capacity + scheduler weights | ❌ | **A8** |
| Lean modes + artifact profiles + storageState preference | ⚠️ partial | **A9** |
| **Machine-relative** benchmark stages + stop conditions + production margin | ❌ | **A10** |
| Reports record machine context; filter by machine/mode/class | ❌ | **B1–B4** |

---

## 2. Capacity model (fully machine-agnostic)

### 2.1 Capacity terminology — seven distinct values (never conflated)

| Term | Meaning | Source |
|---|---|---|
| **Detected machine capacity** | Theoretical upper estimate from raw specs, ignoring safety | `CapacityPlanner` from `MachineCapabilities` |
| **Conservative recommended capacity** | Safe initial recommendation *before* any benchmark | `CapacityPlanner` × `capacitySafetyFactor` |
| **Configured capacity** | What an administrator set (Manual mode / config) | Settings |
| **Benchmark-tested capacity** | Highest concurrency stage proven sustainable on *this* machine | `A10` benchmark |
| **Production-approved capacity** | Benchmark-tested × a configurable margin **below** the highest sustainable stage | `A10` |
| **Current adaptive capacity** | Live effective target after applying real-time resource pressure | `A7` controller |
| **Absolute safety ceiling** | Hard cap that is never exceeded by any mode, including Manual | config `absoluteSafetyMaximum` |

These are stored/passed as **separate fields** (see `MachineCapacityProfile`, §2.5). Reports and UI must
show which value they are displaying.

### 2.2 Machine capability detection

```ts
interface MachineCapabilities {
  machineId: string;              // locally generated install/machine id (§2.6), NOT a hardware serial
  hostname?: string;              // best-effort, non-authoritative (may change/duplicate)
  platform: string;              // os.platform()
  architecture: string;          // os.arch()

  logicalCpuCount: number;        // os.cpus().length
  physicalCpuCount?: number;      // best-effort; undefined when not reliably detectable
  totalMemoryMb: number;          // os.totalmem()
  availableMemoryMb: number;      // os.freemem() at detection (fluctuates — see §2.3)

  cpuModel?: string;              // os.cpus()[0].model (best-effort)
  cpuBaseSpeedMhz?: number;       // os.cpus()[0].speed (best-effort; unreliable on some VMs)

  operatingSystem: string;        // os.type()
  operatingSystemVersion?: string;// os.release()

  detectedAt: string;             // ISO timestamp
}
```

**Detection rules (do not assume):**
- `logicalCpuCount` is **not** safely usable automation capacity. Reserve cores (config) and account for
  live background CPU load (§2.3, A7).
- Installed RAM is **not** available RAM. Distinguish: **total**, **currently available**,
  **OS reserve**, **AWKIT/Electron reserve**, **configurable safety reserve**, **usable-for-automation**.
- Physical vs logical CPU and CPU speed may be unavailable on VMs — treat as optional, degrade gracefully.

### 2.3 Initial (pre-benchmark) capacity calculation — conservative, config-driven

Implemented as a **pure** function (no Electron/React). No constant in it is specific to any machine shape.

```text
osReserveMb        = resolveReserve(reservedMemoryMb, reservedMemoryPercent, totalMemoryMb, "os")
awkitReserveMb     = resolveReserve(awkitReservedMemoryMb, awkitReservedMemoryPercent, totalMemoryMb)
safetyReserveMb    = resolveReserve(safetyReservedMemoryMb, safetyReservedMemoryPercent, totalMemoryMb)

usableMemoryMb =
  max(0, currentAvailableMemoryMb - osReserveMb - awkitReserveMb - safetyReserveMb)

memoryCapacityEstimate =
  floor(usableMemoryMb / conservativeEstimatedMemoryPerInstanceMb[workloadClass])

usableCores =
  max(0, logicalCpuCount
        - reservedLogicalCpuCount
        - estimatedCoresConsumedByCurrentBackgroundLoad)   // from live CPU sample, smoothed

cpuCapacityEstimate =
  floor(usableCores / conservativeEstimatedCpuCoresPerInstance[workloadClass])
  // refined by previous observations for this machine when available

initialRecommendedCapacity =
  max(1, minimum(
      memoryCapacityEstimate,
      cpuCapacityEstimate,
      administratorMaximumConcurrency,
      absoluteSafetyMaximum))
```

- **`resolveReserve(absolute, percent, total, kind)`** implements the reserve **precedence** (§2.4):
  when both absolute and percentage are configured, the **more protective** value wins for reserves/floors
  (i.e. the larger reserve); for **maximums/ceilings**, the more restrictive (smaller) wins. This is
  explicit and unit-tested.
- `conservativeEstimatedMemoryPerInstanceMb` / `…CpuCoresPerInstance` are **per-workload-class seeds**
  (§2.4) — starting envelopes only, replaced by measured values once a benchmark or history exists.
- `currentAvailableMemoryMb` and background CPU load are **live** inputs (recomputed on each Auto
  evaluation), so a machine that is temporarily busy yields a lower recommendation (§A7).
- Binding constraint (`ram` | `cpu` | `adminMax` | `safetyCeiling`) is returned so the UI can explain
  *why* (§A4 Auto explanation).

**Explicitly forbidden:** returning a high capacity from large RAM alone. CPU cores, live load, workload
class, and (once known) browser/page/download behavior all constrain the result.

### 2.4 `CapacityTuning` — one config object, all seeds/bounds (no scattered constants)

```ts
interface CapacityTuning {
  // Reserves (support BOTH absolute and percentage; precedence per §2.3)
  reservedMemoryMb?: number;           reservedMemoryPercent?: number;
  awkitReservedMemoryMb?: number;      awkitReservedMemoryPercent?: number;
  safetyReservedMemoryMb?: number;     safetyReservedMemoryPercent?: number;
  reservedLogicalCpuCount: number;

  // Per-workload conservative seed envelopes (mb / cpu-cores), replaced by measurement
  conservativeMemoryPerInstanceMb: { light: number; medium: number; heavy: number };
  conservativeCpuCoresPerInstance: { light: number; medium: number; heavy: number };

  // Safety
  capacitySafetyFactor: number;        // applied to detected → conservative recommended (e.g. < 1)
  productionApprovalMargin: number;    // applied below highest sustainable benchmark stage
  absoluteSafetyMaximum: number;       // hard ceiling, never exceeded
  administratorMaximumConcurrency?: number;

  // Live-pressure thresholds (also used by backpressure/adaptive controller)
  minimumFreeMemoryMb?: number;        minimumFreeMemoryPercent?: number;
  maximumSystemMemoryPercent: number;
  maximumAverageCpuPercent: number;    maximumP95CpuPercent: number;

  // Bootstrap category boundaries (config, not scattered ifs) — see §2.7
  bootstrapCategories: BootstrapCategoryRule[];

  // Shared-pool derivation bounds — see §A5
  maxContextsPerBrowserHardLimit: number;  // failure-isolation cap, always enforced
  targetContextsPerBrowser: number;        // starting ratio, tuned by benchmark/memory history
  dedicatedPersistentBrowserAllowancePercent: number;
}
```

All numbers above are **defaults in one place**, documented as tunable, and validated. None encodes a
specific machine shape.

### 2.5 Per-machine capacity profile (persisted)

```ts
interface MachineCapacityProfile {
  machineId: string;
  capabilitiesSnapshot: MachineCapabilities;   // the snapshot this profile was calibrated against

  recommendedCapacity: number;                 // conservative recommended (pre/without benchmark)
  configuredCapacity: number;                  // administrator/manual
  benchmarkTestedCapacity?: number;            // highest sustainable stage measured
  productionApprovedCapacity?: number;         // margin below benchmarkTested
  absoluteSafetyCeiling: number;

  estimatedMemoryPerInstanceMb?: number;       // measured; overrides seed once known
  estimatedCpuCostPerInstance?: number;

  capacitySafetyFactor: number;

  lastBenchmarkId?: string;
  lastCalibratedAt?: string;
  updatedAt: string;

  // Workload-class recommendations live in a sibling map (see §A8)
}
```

- Persisted under the runtime root (never `resources/`/`app.asar`): e.g.
  `<runtimeRoot>/runtime/machine-profiles/<machineId>.json`, written atomically (reuse the
  `writeProfile` temp-file+rename pattern already used by `ProfileStore`/`uiSettings`).
- A profile from **another machine must not be reused**. On load, compare the stored
  `capabilitiesSnapshot` fingerprint to the freshly detected one; on **material change** (CPU count, total
  RAM band, OS, machine identity, or a large VM-allocation shift) mark the profile
  **requiresRecalibration** and fall back to a fresh conservative recommendation until re-benchmarked.

### 2.6 Machine identity (safe, privacy-preserving)

- Generate a **locally random installation id** (UUID) on first run, stored at
  `<runtimeRoot>/runtime/machine-id.json`. This is the authoritative `machineId`.
- Derive a **capability fingerprint** = stable hash of `{platform, arch, logicalCpuCount,
  totalMemoryMb rounded to a band}`. Used only to detect hardware change — not as identity.
- Do **not** depend on hostname alone (mutable/duplicable). Do **not** collect MAC addresses, disk
  serials, or other sensitive hardware identifiers. Nothing leaves the machine (offline-first).

### 2.7 Conservative bootstrap categories (config-driven boundaries)

Before any benchmark exists, classify the machine into a **bootstrap profile** whose boundaries are
`CapacityTuning.bootstrapCategories` **config values**, not scattered hardcoded conditions:

```ts
interface BootstrapCategoryRule {
  name: string;                      // e.g. "small" | "medium" | "large" | "highCapacity" | "custom"
  minLogicalCpu?: number; maxLogicalCpu?: number;
  minAvailableMemoryMb?: number; maxAvailableMemoryMb?: number;
  startingCapacityFactor: number;    // fraction of the computed estimate to start from
  requiresBenchmarkBeforeHighConcurrency?: boolean;
}
```

- Categories are **illustrative labels** (Small / Medium / Large / High Capacity / Custom). The *rules*
  decide membership from detected specs; the plan ships default rules but they are fully editable.
- **High-capacity machines must require benchmark validation** before adopting high concurrency —
  large RAM alone never unlocks it (`requiresBenchmarkBeforeHighConcurrency: true`).
- No category encodes a specific vendor machine; boundaries are ranges in config.

---

## 3. Workstream A — Machine-agnostic concurrency & sequential

### Phase A1 — `MachineCapabilityDetector` (new service)

- **Goal:** detect and record `MachineCapabilities` (§2.2) for the current host; expose a stable
  `machineId` and capability fingerprint.
- **Touchpoints (new):** `src/runner/concurrency/MachineCapabilityDetector.ts` (pure `src/`, uses
  `node:os`); machine-id persistence helper under `app/main` or a small `src/` store fed a path (keep
  `src/` framework-agnostic — the main process passes the runtime root, mirroring the existing
  `appPaths` bridge). Reuse `ResourceSampler` for the live available-memory/CPU inputs.
- **Approach:** read `os.*`; best-effort physical-CPU/base-speed (undefined when unreliable); compute
  fingerprint; load-or-create `machine-id.json`. Never throws (degrade to minimal capabilities).
- **Verification:** `scripts/verify-machine-capabilities.mts` (`tsx`): mock `os` to several **example**
  shapes (§11) and assert fields populate, optional fields degrade, fingerprint changes when CPU/RAM band
  changes and is stable across a reboot with identical specs.
- **Risks:** VM/misreporting — treat optional fields as optional; never fail detection.

### Phase A2 — `CapacityPlanner` (pure core, per-machine, per-workload)

- **Goal:** turn `MachineCapabilities` + live sample + `CapacityTuning` + workload class → the seven
  capacity values (the pre-benchmark ones) with an explained breakdown.
- **Touchpoints (new):** `src/runner/concurrency/CapacityPlanner.ts` (+ types). Framework-agnostic.
- **Approach:** implement §2.3 exactly; apply the bootstrap category (§2.7) `startingCapacityFactor` and
  `capacitySafetyFactor`; return `{ detected, conservativeRecommended, bindingConstraint, inputs,
  categoryName, requiresBenchmark }`. When a `MachineCapacityProfile` supplies measured
  `estimatedMemoryPerInstanceMb`/`estimatedCpuCostPerInstance`, those override the seed envelopes.
- **Contract:** new `CapacityRecommendation` type; export `DEFAULT_CAPACITY_TUNING`.
- **Verification:** `scripts/verify-capacity-planner.mts` (`tsx`), table-driven across **example** shapes
  (§11): low-resource → very low; high-RAM/low-CPU → CPU-bound (RAM does not inflate it); admin max and
  absolute ceiling clamp; live pressure lowers the number; workload-class monotonicity (heavy ≤ medium ≤
  light). Add `verify:capacity-planner` to `package.json`.
- **Risks:** low (pure). Guard `totalmem()===0`/NaN → floor to 1.

### Phase A3 — Per-machine capacity profiles + recalibration

- **Goal:** persist `MachineCapacityProfile` per machine; detect hardware change and require recalibration.
- **Touchpoints (new):** `src/runner/concurrency/MachineCapacityProfileStore.ts` (atomic read/write via
  the established temp-file+rename pattern); wired from `app/main` with the runtime-root path. Read at
  engine/app startup alongside `initializeDurableRuntime`.
- **Approach:** load profile by `machineId`; compare fingerprint; on material change set
  `requiresRecalibration` and use A2's conservative recommendation until re-benchmarked (never silently
  keep the old machine's numbers). Preserve prior **administrator/manual** settings across recalibration.
- **Contract:** new on-disk artifact under the runtime root; no IPC/preload change yet (A4 adds the read
  IPC).
- **Verification:** `scripts/verify-machine-profile.mts` (`tsx`): create → persist → reload identical;
  change CPU/RAM fingerprint → flagged for recalibration; two machineIds keep isolated profiles;
  atomic-write/no-residue (mirror `verify:profile-store`).
- **Risks:** clock/rounding in the fingerprint band — use coarse bands so trivial `freemem` drift does not
  false-trigger recalibration (use `totalMemoryMb`, not `availableMemoryMb`, in the fingerprint).

### Phase A4 — Settings modes (Sequential / Auto / Manual) + full capacity config

- **Goal:** first-class modes and the complete configurable capacity surface; Sequential is
  machine-independent; Auto is fully explained; Manual stays safety-constrained.
- **Touchpoints:**
  - `app/main/uiSettings.ts` — extend `runtime` to the capacity settings block:

    ```ts
    capacityMode: 'sequential' | 'auto' | 'manual';
    manualMaxConcurrency?: number;
    administratorMaximumConcurrency?: number;
    absoluteSafetyMaximum?: number;
    capacitySafetyFactor: number;
    minimumFreeMemoryMb?: number;         minimumFreeMemoryPercent?: number;
    maximumSystemMemoryPercent: number;
    maximumAverageCpuPercent: number;     maximumP95CpuPercent: number;
    reservedLogicalCpuCount?: number;
    reservedMemoryMb?: number;            reservedMemoryPercent?: number;
    recalibrateOnHardwareChange: boolean;
    workloadClass?: 'light' | 'medium' | 'heavy' | 'custom';
    ```

    Keep the legacy `{ maxBrowsers, maxActiveFlows }` for back-compat; **migrate on read** (absent
    `capacityMode` → `'manual'`, mapping old numbers to `manualMaxConcurrency`/derived — see §12). Update
    `defaultSettings`, deep-merge, and the validator (enum modes/classes, numeric bounds, precedence
    validation when both absolute and percentage reserves are set).
  - `app/main/ipc/execution.ipc.ts` — `applyRuntimeConcurrencyFromSettings()` computes effective limits:
    **sequential** → `{ maxBrowsers:1, maxActiveFlows:1, maxPerOrigin:1, maxPerAccount:1, all operation
    limiters:1 }`; **auto** → detect machine (A1) + load profile (A3) + `CapacityPlanner` (A2) + live
    pressure (A7), pick benchmarked value when available else conservative, clamp to admin/absolute; map
    to `maxActiveFlows` and derive `maxBrowsers`/contexts via A5; **manual** → `manualMaxConcurrency`
    clamped by admin max and `absoluteSafetyMaximum`, with **all hard protections still enforced**.
  - `app/main/ipc/system.ipc.ts` (+ preload `system.*`) — `capacityPreview(workloadClass)` returning the
    `CapacityRecommendation` + `MachineCapabilities` + active `MachineCapacityProfile` so the UI can show
    the Auto explanation. Register handler + preload signature; keep `verify:ipc-contract` green.
  - `app/renderer/pages/Settings.tsx` — mode selector; Auto shows a **"why this number"** readout (see
    below); Manual reveals numeric inputs **and warns when the value exceeds recommended/benchmark-tested**
    but never lets it exceed `absoluteSafetyMaximum`; Sequential shows an explainer. Token-only styling.

  **Auto explanation (UI, values illustrative):**

  ```text
  Current auto capacity: N instances
  Based on:
  - This machine's capacity profile (benchmarked | conservative estimate)
  - Workload classification: <class>
  - Live CPU pressure and available-memory reserve
  - Configured safety margin and administrator maximum
  - Absolute safety ceiling: <M>
  ```

- **Contract:** additive settings + migration; one new IPC channel + preload method.
- **Verification:** `verify:settings-persistence` (mode round-trips, legacy migration, reserve
  precedence); `verify:ipc-contract`; a small real-Electron Settings render check. Assert Sequential
  truly serializes (origin/account also 1) and Manual cannot exceed the ceiling.
- **Risks:** Auto changing `maxBrowsers` mid-run is deferred by `reconfigure` (idle-only) — surface the
  existing "applies when no run is in progress" hint.

### Phase A5 — Shared browser pool + isolated contexts, **derived sizing** ★ largest change

- **Goal:** N shared Chromium processes each hosting isolated contexts, with a **dedicated
  1-browser-per-instance pool** for persistent-profile / Reuse-Session / protected-login instances. Pool
  sizing is **derived per machine**, not a fixed 4×4.
- **Touchpoints:** `BrowserWorkerPool.ts`, `BrowserContextFactory.ts` (`create`), `PlaywrightRunner.ts`
  (browser lifecycle + Reuse Session swap + `onBrowserRuntime`/`onRuntimeClosing`), `ExecutionEngine.ts`
  (slot acquisition ~L603, `registerRuntime` ~L699), `ConcurrencyConfig.ts` (`maxContextsPerBrowser`
  already present).
- **Derived pool sizing (no fixed numbers):** from the machine profile + `CapacityTuning`, derive
  `targetBrowserProcessCount`, `maxContextsPerBrowser` (≤ `maxContextsPerBrowserHardLimit` for failure
  isolation, always enforced), `maxTotalContexts`, `maxTotalPages`, `dedicatedPersistentBrowserAllowance`
  — inputs: capabilities, benchmark/memory/CPU history, workload mix, failure-isolation policy, admin
  constraints. Example only: split effective concurrency across browsers so per-browser context count
  stays under the hard limit; **always** keep ≥ a small number of browsers when concurrency > 1 for crash
  isolation.
- **Approach:** classify each instance `shared` vs `dedicated` at dispatch (dedicated = persistentContext
  / Reuse Session / Auto Secure Login / Protected Login Handoff). A "slot" for shared work becomes a
  **context lease** on a least-loaded healthy browser; launch a new shared browser only up to the derived
  target. Implement the guide's Browser Pool Requirements (health, drain, recycle-after-N-contexts /
  memory / repeated failed contexts, leaked-context/page detection). Move browser lifecycle ownership for
  shared work into the pool; the runner receives a **context** and closes only the context in `finally`.
  Preserve the generation-scoped `markExpectedClose` crash-vs-expected-close logic (per-context close
  path) so the 2026-07-11 backpressure false-positive does not return.
- **Contract:** internal only; `ConcurrencyLimits` gains derived-sizing + recycle fields (additive,
  env-overridable).
- **Verification:** heavily extend `verify:browser-pool`: derived sizing across **example** machine
  profiles (§11) yields different browser/context counts; least-loaded selection; recycle + drain; leaked
  context detection; a shared-browser crash fails only its ≤hard-limit contexts; dedicated pool stays 1:1.
  A live `/designer-lab` scenario asserts Chromium **process count** ≈ derived target (proves sharing).
- **Risks:** highest-risk phase. Context state bleed → strict `context.close()` + storageState, never
  shared cookies. Reuse Session must be provably excluded from shared. Ship behind
  `AWKIT_SHARED_BROWSER_POOL` (default off first; flip after verifiers + a live run); keep the 1:1 path as
  the flag's fallback.

### Phase A6 — Operation limiters (stagger expensive operations)

- **Goal:** independent, configurable rate limits (browser launches / context creations / navigations /
  downloads / screenshots) so peak concurrency does not mean peak simultaneous expensive ops. **All limits
  are config/derived, not fixed to any machine.**
- **Touchpoints:** reuse `src/runner/concurrency/Semaphore.ts`; add an `OperationLimiters` holder on
  `ExecutionEngine`, injected into `BrowserContextFactory` (launch/context) and `StepExecutor`
  (navigation/download/screenshot). Config in `ConcurrencyConfig.ts`; Sequential → all 1; Auto → derived
  from the machine profile.
- **Verification:** `verify:operation-limiters` (`tsx`): no more than N concurrent acquisitions under a
  burst, across a couple of derived configs.
- **Risks:** deadlock — keep limiters fine-grained/short-held (acquire around the Playwright call, release
  in `finally`); never hold two ordering-sensitive limiters at once.

### Phase A7 — Adaptive controller driven by live environmental pressure

- **Goal:** maintain **Current adaptive capacity** between 1 and the machine's ceiling, growing slowly when
  healthy and shrinking under pressure — responsive to **other applications** loading the machine, not
  just AWKIT's own use.
- **Touchpoints:** `BackpressureController.ts` (already samples CPU/mem/crashes/free-RAM) + a new
  `AdaptiveController`. Before dispatch, consider: current available memory, current CPU usage + recent
  trend, current AWKIT usage, active browser/page counts, disk pressure, queue size, recent timeout rate,
  recent crash rate, Node event-loop delay (`perf_hooks.monitorEventLoopDelay`). `admit()` uses
  `min(currentAdaptiveCapacity, effectiveCeiling)`.
- **States (thresholds all in `CapacityTuning`):** Healthy → grow by 1 slowly; Stable → hold; Pressure →
  stop dispatching new work; Critical → reduce target + recycle high-memory browsers + delay new work.
  Gradually restore after recovery.
- **Contract:** internal; surface `currentAdaptiveCapacity` + state + the pressure inputs in
  `getRuntimeStatus()` (additive) for the Instance Monitor strip and reports.
- **Verification:** `verify:adaptive-concurrency` (`tsx`): synthetic health samples drive grow/hold/shrink;
  never exceeds ceiling or drops below 1; a simulated external-load spike lowers the target and recovery
  restores it.
- **Risks:** oscillation — asymmetric steps (grow slow, shrink fast) + cooldown; never thrash
  `maxBrowsersPerHost` (idle-only resize preserved).

### Phase A8 — Workload-aware capacity + scheduler weights

- **Goal:** capacity is **not one universal number** — recommend per workload class, and schedule by
  **weighted** cost, both improved from history.
- **Touchpoints:** `CapacityPlanner` (per-class recommendations), dispatch accounting in
  `ExecutionEngine.processQueue` / `ConcurrentExecutionCoordinator` (admit against weighted active cost),
  weight function from `InstanceConfig` + scenario features, history feed from telemetry/process samples.
- **Contracts:**

  ```ts
  interface WorkloadCapacityRecommendation {
    machineId: string;
    workloadClass: 'light' | 'medium' | 'heavy' | 'custom';
    recommendedConcurrency: number;
    benchmarkTestedConcurrency?: number;
    productionApprovedConcurrency?: number;
    confidence: 'unmeasured' | 'estimated' | 'benchmarked';
  }
  ```

  Workflow classification inputs: page count, avg navigations, JS intensity, downloads, uploads,
  screenshots, tracing, video, persistent profiles, parallel branches, popups, avg CPU/memory history,
  historical duration. **Scheduler weights** (all configurable, history-improved): simple ephemeral
  context = low; persistent profile / headed / extra pages / parallel isolated branches / video-or-trace /
  heavy report / large download = progressively higher. Weight is an **admission** concept, kept separate
  from the physical context budget in A5 (no double counting).
- **Verification:** unit-test the weight + per-class functions; assert a persistent+headed instance
  consumes more weighted budget; `confidence` transitions unmeasured→estimated→benchmarked.
- **Risks:** misclassification → default to the safer (heavier) class when unsure.

### Phase A9 — Resource-reduction profiles (lean modes + artifact profiles)

- **Goal:** per-run knobs to cut per-instance cost — request-blocking modes, artifact profiles,
  service-worker block, download opt-out, deterministic viewport/`reducedMotion`. Defaults preserve
  today's behavior.
- **Touchpoints:** new `src/runner/ResourceRoutingPolicy.ts` (`context.route` Normal/Lean/Ultra-Lean with
  allow-lists + per-workflow overrides + debug logging), wired in `BrowserContextFactory`; formalize
  artifact profiles `Production | Balanced | Debug | Full` over the existing `AWKIT_TRACE_MODE` +
  failure-screenshot defaults; context options `serviceWorkers`, `acceptDownloads` (opt-in),
  deterministic `viewport`/`deviceScaleFactor`/`reducedMotion` for non-visual runs. Never block images
  globally by default.
- **Verification:** extend `verify:runner`/mock-site with a Lean scenario (images aborted, flow still
  passes) and a downloads-required scenario; Normal unchanged.
- **Risks:** breaking apps needing images/service workers → Normal default, opt-in, per-workflow override +
  compatibility fallback logging.

### Phase A10 — Machine-relative benchmark harness + calibration

- **Goal:** calibrate this machine's real per-instance cost and sustainable capacity; stages **scale
  relative to the detected recommendation**, not a fixed 4→32 sequence.
- **Touchpoints (new):** `scripts/benchmark-concurrency.mts` driving Light/Medium/Heavy mock-site
  workflows; reuse `ResourceSampler` + `ProcessTreeSampler`; writes results into the machine profile
  (`benchmarkTestedCapacity`, measured per-instance mem/CPU) + a run artifact under the runtime root.
- **Dynamic stage generation (relative to provisional recommendation R and ceiling):**

  ```text
  Stage 1: ceil(0.25 × R)
  Stage 2: ceil(0.50 × R)
  Stage 3: ceil(0.75 × R)
  Stage 4: R
  Stage 5: ceil(1.25 × R)   // only if the machine stayed healthy
  Stage 6+: continue gradual growth until a stop condition, never exceeding the safety ceiling
  ```

  Normalize to distinct integers ≥ 1; small machines may run e.g. `1 → 2 → 3 → 4`, larger machines run
  higher — **these are computed, never hardcoded profiles**. Avoid aggressive jumps.
- **Stop conditions (all configurable):** sustained CPU over threshold; P95 CPU over threshold; available
  memory below reserve; memory usage over threshold; swap/page-file pressure rising; P95 workflow latency
  regression over allowance; error rate over threshold; browser crash rate; renderer crash rate;
  continuously growing queue delay; Node event-loop delay over threshold; material disk/network bottleneck.
- **Production-approved capacity:** **not** the highest attempted stage — apply
  `productionApprovalMargin` **below** the highest *sustainable* stage.
- **Verification:** the harness self-checks (queue bounded, error < threshold); a `tsx` unit test proves
  stage generation scales with R and ceiling and normalizes to integers. Document that true production caps
  require a clean-machine run (external gate).
- **Risks:** heavy — behind an explicit npm script, never automatic.

---

## 4. Workstream B — Per-workflow comparison & history report (machine-aware)

Interpretation (confirm §10 D2): each workflow **vs its own history** (this period vs previous; run-over-
run trend) **and** workflows **side-by-side**, with every run tagged by **machine context** so
cross-machine runs are not silently compared. Build on `ReportsWorkflows` + the telemetry read-model.

### Phase B1 — Read-model: per-workflow stats, history comparison, machine context

- **Touchpoints:** `SqliteRuntimeStore.ts` — `queryWorkflowComparison(range, machineFilter)` and
  `queryWorkflowTrend(scenarioId, range, buckets, machineFilter)`; reuse `durationStats`/`percentile`.
- **Machine context on runs:** persist per run: `machineId`, `logicalCpuCount`, `totalMemoryMb`,
  `availableMemoryMbAtStart`, `executionMode` (sequential/auto/manual), `browserPoolMode`
  (shared/dedicated), `configuredConcurrency`, `observedPeakConcurrency`, `workloadClass`,
  `capacityRecommendationAtRun`. Requires a **migration v3** on `RuntimeStoreSchema.ts` (additive nullable
  columns; v2 DBs upgrade in place, matching the established pattern) written by `ExecutionEngine` at the
  existing `upsertRun` seams.
- **Contract:** `TelemetryContracts.ts` — `WorkflowComparisonRow` = `WorkflowReportRow` + `{ previous,
  delta, trend, machineContext }`; a `MachineRunContext` type; a `RunHistoryFilter` extension for machine/
  mode/pool/class.
- **Verification:** extend `verify:telemetry`: two-window current/previous split, delta signs, percentile
  correctness, empty-history → `null` deltas (not NaN), and machine-context filtering.
- **Risks:** window edges — define `[since, now)` vs previous `[since−len, since)`; cover in the verifier.

### Phase B2 — IPC + preload

- **Touchpoints:** `telemetry.ipc.ts` add `telemetry:workflowComparison`, `telemetry:workflowTrend`, and a
  `telemetry:machines` (list of machine profiles seen in history for the filter); expose in `preload.ts`;
  keep `verify:ipc-contract` green.

### Phase B3 — Comparison UI + machine filters (extend Workflow Reports)

- **Touchpoints:** `ReportsWorkflows.tsx` — per-row trend sparkline + delta chips (▲/▼ vs previous window)
  for success rate/avg/p95/runs; a Compare mode (2–4 workflows side-by-side); and **history filters**:
  All machines / Current machine / Selected machine profile / Execution mode / Shared-or-dedicated /
  Workload class. Reuse hand-rolled SVG primitives + tokens + `TrendDelta`/`StatusBadge`; honor
  `prefers-reduced-motion`; keep new columns inside `.awkit-table-wrap` (avoid the 2026-07-12 width/scroll
  regression). A **Capacity report** view shows, per benchmark/run, the machine context (§B1 fields) so
  runs on different machines are visibly distinguished.
- **Verification:** `verify:reports` extended (comparison endpoint renders; sparklines/delta chips; machine
  filter changes the set).

### Phase B4 — (Optional) live vs history on the run card

- **Touchpoints:** `InstanceMonitor.tsx`, `executionReportModel.ts` — show running workflow vs its
  historical avg/p95 **for the same machine/class**. Confirm scope in §10 D2.

---

## 5. Verification strategy (roll-up)

- Build gate: `npm run build` — must stay clean.
- Machine/capacity: `verify:machine-capabilities`, `verify:capacity-planner`, `verify:machine-profile`,
  `verify:operation-limiters`, `verify:adaptive-concurrency`, extended `verify:browser-pool`,
  `verify:concurrency`.
- Runner/offline: `verify:runner`, `verify:mock-site` + touched feature verifier; `validate:offline`
  (A5/A9 touch launch/context).
- Settings/IPC: `verify:settings-persistence`, `verify:ipc-contract`.
- Reports: `verify:telemetry` (B1), `verify:reports` (B3).
- **Not automatable here:** clean-machine offline GUI walkthrough and the live machine-relative benchmark
  (A10) — external gates called out per PR.

---

## 6. Suggested execution order & PR grouping

Order: **A1 → A2 → A3 → A4** (machine detection + profiles + Auto/Sequential on the *existing* 1-browser
model — immediately useful) → **A6 → A7 → A8 → A9** (safe, flag-guarded increments) → **A5** (largest;
flag-guarded, land last in the concurrency stream) → **A10** (calibration). **B1 → B2 → B3** in parallel
with A; **B4** optional.

PRs (per the repo's "fewer PRs; feature docs/tests/TASK_LOG in the feature PR" convention):

1. **PR-CAP-1** — A1 + A2 + A3 + A4 (machine detection, per-machine profiles, Auto/Sequential/Manual,
   full capacity settings) + verifiers + docs + TASK_LOG. Ships value without touching the browser model.
2. **PR-CAP-2** — A6 + A7 + A8 + A9 (limiters, adaptive controller, weights/workload classes, lean/artifact
   profiles), flag-guarded.
3. **PR-CAP-3** — A5 shared browser pool alone (highest risk, isolated review) behind
   `AWKIT_SHARED_BROWSER_POOL`.
4. **PR-CAP-4** — A10 benchmark harness + calibration.
5. **PR-REP-1** — B1 + B2 + B3 (+ B4 if approved), incl. schema migration v3 for machine context.

Each PR updates `CURRENT_STATE.md` + `TASK_LOG.md`; updates `FEATURES.md`/`ARCHITECTURE.md`/`COMMANDS.md`
when changed; runs the ai-memory-maintainer skill.

---

## 7. Guardrails carried through every phase

- **Hardware-agnostic:** no CPU/RAM/browser/context/reserve/concurrency value hardcoded as a target or
  default; everything detected, configured, or measured. Example machine shapes are labelled fixtures only.
- **Offline-first:** no runtime network; launch via `BundledBrowserResolver`; machine profiles, machine-id,
  calibration, and benchmark outputs live under the runtime root, never `resources/`/`app.asar`.
- **`src/` stays framework-agnostic** (detector, planner, profile store logic, limiters, adaptive
  controller live in `src/`; the main process supplies paths).
- **UI = Hologram tokens only**; hand-rolled SVG charts; `prefers-reduced-motion`; don't touch
  `.app-shell`/`.app-main` grids; keep new report columns inside `.awkit-table-wrap`.
- **IPC contract:** register in `app/main/ipc/*` **and** `preload.ts`; keep `verify:ipc-contract` green;
  never rename `window.playwrightFlowStudio`.
- **Backpressure correctness:** preserve the generation-scoped `markExpectedClose` logic when moving to
  per-context close (A5).
- **Safety always on:** minimum free-memory protection, critical CPU protection, browser health checks,
  emergency dispatch pause, and the absolute safety ceiling apply in **every** mode, including Manual.

---

## 8. Manual mode — mandatory safety constraints (explicit)

Manual mode may set a maximum concurrency, but AWKIT must still enforce and **must not disable**:
minimum free-memory protection, critical CPU protection, browser health checks, emergency dispatch pause,
and the absolute safety ceiling. The UI **warns** when the manual value exceeds the recommended or
benchmark-tested capacity; the value is still hard-clamped to `absoluteSafetyMaximum`.

---

## 9. (reserved)

## 10. Decisions needed from the owner

- **D1 — Default safety aggressiveness:** default `capacitySafetyFactor` / `productionApprovalMargin`
  values (conservative vs moderate). Recommendation: conservative until a machine has benchmarked.
- **D2 — Report shape:** each workflow vs its own history, workflows side-by-side, or both (plan assumes
  both). Confirm to scope B4.
- **D3 — Workload class source:** author-tagged per workflow, inferred from history (A8), or both. Plan
  supports manual class now + calibration later.
- **D4 — Shared-pool rollout:** ship A5 default-off (flag) until a live benchmark passes (recommended), or
  default-on once verifiers are green.
- **D5 — Persistent/Reuse-Session routing:** confirm these always route to the **dedicated** pool (plan
  assumes yes; required by the profile-lock + Reuse-Session swap model).
- **D6 — Bootstrap category boundaries + reserve defaults:** approve the default `bootstrapCategories`
  rules and default reserves (all editable), since these seed pre-benchmark behavior on every machine.

## 11. Example machine shapes — **fixtures/examples only (never defaults)**

Used solely for tests and documentation of `CapacityPlanner`/`MachineCapabilityDetector`. **No capacity
value derived from any of these may become a production default without a measured benchmark on the actual
host.**

```text
8 GB RAM  / 4 logical CPUs
16 GB RAM / 8 logical CPUs
32 GB RAM / 12 logical CPUs
48 GB RAM / 8 logical CPUs      # the owner guide's example benchmark environment — example only
64 GB RAM / 16 logical CPUs
128 GB RAM / 32 logical CPUs
```

Each is a `verify:capacity-planner` / `verify:machine-capabilities` case asserting that recommendations
differ appropriately and that high RAM alone never yields high concurrency.

## 12. Migration & compatibility

Existing installations without a machine profile must, on first upgraded launch:
1. Detect the current machine (A1) and create a `MachineCapacityProfile` (A3).
2. **Preserve** existing manual concurrency settings; treat the legacy `runtime.maxBrowsers/maxActiveFlows`
   as **administrator-provided Manual limits** (`capacityMode: 'manual'`), not as an Auto target.
3. **Not** automatically increase concurrency on upgrade.
4. Require benchmark calibration (A10) before adopting materially higher limits than the pre-upgrade value.
5. Flag the profile `requiresRecalibration` if the detected hardware differs from any stored snapshot.

## 13. Acceptance criteria (tests the executed work must satisfy)

- No machine-specific CPU/RAM/browser/context value is hardcoded (grep-guard + review; example fixtures
  are clearly labelled).
- Auto capacity changes appropriately across mocked machine specs (§11).
- Low-resource machines get conservative recommendations; high-RAM/low-CPU machines are **not** given
  unsafe recommendations from RAM alone.
- Simulated current background load lowers the current adaptive capacity; recovery restores it.
- A hardware change invalidates/flags old calibration; profiles stay isolated per machine.
- Manual mode remains safety-constrained (all hard protections active; ceiling enforced).
- Sequential mode always uses exactly one active instance regardless of machine.
- Benchmark stages scale relative to the detected recommendation and normalize to integers.
- Workflow weight affects scheduling admission.
- Reports distinguish runs from different machines (machine context persisted + filterable).
- Shared-browser pool sizing changes across machine profiles (derived, not fixed).
- Existing users are not auto-upgraded to unsafe concurrency (migration §12).

## 14. Document corrections — universal assumptions removed

The following statements from the owner guide / the previous draft of this plan are **not** production
defaults and now appear (if at all) only as clearly labelled examples:

- "12 instances is the universal production starting point" → replaced by per-machine
  **conservative recommended capacity**.
- "16 instances is the universal validation ceiling" → replaced by **machine-relative benchmark stages**
  and a per-machine **benchmark-tested capacity**.
- "Four browsers with four contexts is the universal pool" → replaced by **derived pool sizing** (A5) with
  a configurable per-browser context **hard limit** for failure isolation.
- "8 GB is the universal memory reserve" → replaced by configurable **absolute and/or percentage reserves**
  with defined precedence (§2.3/§2.4).
- "Eight CPU cores is the expected server shape" / "48 GB RAM is the target production machine" → demoted
  to **example/fixture** shapes (§11); the 48 GB / 8-core box is explicitly the guide's *example benchmark
  environment*, not a target.
