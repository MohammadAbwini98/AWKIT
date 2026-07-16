import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { PlaywrightRunner } from "./PlaywrightRunner";
import { ManualHandoffController } from "./ManualHandoffController";
import {
  LIVE_PROGRESS_MAX_EVENTS,
  LIVE_PROGRESS_MAX_STEPS,
  type LiveEventSnapshot,
  type LiveExecutionSnapshot,
  type RunnerProgressEvent,
  type RunnerProgressReporter
} from "./RunnerProgress";
import { InstanceManager, type StorageDirs } from "../instances/InstanceManager";
import { InstancePool } from "../instances/InstancePool";
import { ConcurrentExecutionCoordinator } from "../orchestrator/ConcurrentExecutionCoordinator";
import type { ConcurrentRunProfile } from "../instances/ConcurrentRunProfile";
import type { InstanceRuntimeState } from "../instances/InstanceRuntimeState";
import { getAppMode, getResourcesRoot, getRuntimeDataRoot, isProductionOffline } from "../../app/main/appPaths";
import { getSessionService } from "../../app/main/ipc/session.ipc";
import type { FlowProfile } from "../profiles/FlowProfile";
import { collectSecretNames } from "../profiles/FlowValidation";
import { registerSecretValues } from "../reports/SecretMasker";
import type { ScenarioProfile } from "../profiles/ScenarioProfile";
import type { ResolvedDataSource } from "./InstanceExecutionContext";
import { ReportService } from "../reports/ReportService";
import type { InstanceReport } from "../reports/ExecutionReport";
import { createReportStore } from "../../app/main/profileStores";
import { RunLogger } from "./artifacts/RunLogger";
import { writeRunStateArtifacts } from "./artifacts/RunStateArtifacts";
import { BrowserWorkerPool, BrowserPoolSaturatedError, type BrowserWorkerSlot } from "./browser/BrowserWorkerPool";
import os from "node:os";
import { SharedBrowserPool, type SharedBrowserSnapshot } from "./browser/SharedBrowserPool";
import { createBrowserSubtreeSampler, type BrowserSubtreeSampler } from "./browser/BrowserProcessSampler";
import { isSharedEligible } from "./browser/browserSharing";
import { resolveBrowserIsolation } from "./browser/BrowserIsolationResolver";
import { OperationLimiters } from "./concurrency/OperationLimiters";
import { AdaptiveController, type AdaptiveThresholds } from "./concurrency/AdaptiveController";
import {
  canAdmitWeighted,
  computeWorkloadWeight,
  extractWorkloadFeatures,
  weightedBudget,
  DEFAULT_WORKLOAD_WEIGHT_CONFIG
} from "./concurrency/WorkloadWeights";
import { loadTraceMode } from "./artifacts/TraceService";
import { resolveBrowserConfigurationForRun } from "./browserProfile/resolveForRun";
import { explainResolution } from "./browserProfile/BrowserRuntimeConfigurationResolver";
import { BackpressureController } from "./concurrency/BackpressureController";
import type { CapacitySnapshot } from "./concurrency/CapacitySnapshot";
import { buildDispatchClaims } from "./concurrency/DispatchClaims";
import {
  buildLockDebugSnapshot,
  buildRuntimeStatus,
  type LockDebugSnapshot,
  type RuntimeEnvironmentInfo,
  type RuntimeStatusSnapshot
} from "./concurrency/RuntimeStatus";
import { globalResourceLocks, type LeaseToken } from "./concurrency/ResourceLockManager";
import type { BrowserPoolSnapshot } from "./browser/BrowserWorkerPool";
import type { WatchdogSnapshot } from "./runtime/WatchdogService";
import { globalProfileLocks } from "../profiles/ProfileLockManager";
import { classifyError, RETRYABLE_ERROR_CLASSES } from "./runtime/ErrorClassifier";
import { NodeAttemptLog, type NodeAttempt } from "./runtime/NodeAttempt";
import { ProcessTreeSampler, type ProcessTreeSample } from "./runtime/ProcessTreeSampler";
import { RuntimeObservationCollector } from "./runtime/RuntimeObservationCollector";
import { detectRegressions, detectRunAnomalies, reconcileRegressions, type RegressionInput } from "./runtime/AnomalyDetector";
import { ADMISSION_REASON_LABELS, normalizeAdmissionReason, normalizePressureState } from "../reports/ObservabilityContracts";
import type {
  AnomalyEvent,
  CapacityAnalytics,
  RunVsHistoryComparison,
  RuntimeObservabilitySummary,
  WorkflowHistoricalStats,
  WorkflowHistoricalTrend,
  WorkflowRanking,
  WorkflowRankingMetric
} from "../reports/ObservabilityContracts";
import { QUEUE_DELAY_PROXY_MS } from "../reports/observabilityAggregation";
import type { DurableAnomalyRecord } from "./store/RuntimeStoreSchema";
import { FlowRunStateMachine } from "./runtime/RuntimeStateMachine";
import { WatchdogService, type WatchdogFinding } from "./runtime/WatchdogService";
import { toReportCategory } from "../reports/ReportCategories";
import {
  processSampleToHistoryPoint,
  type FailureBreakdown,
  type MachineFilter,
  type MachineRunContext,
  type MachineSummary,
  type ProcessHistoryPoint,
  type RunDetail,
  type RunHistoryFilter,
  type RunHistoryPage,
  type RunStatusCounts,
  type RuntimeSeriesPoint,
  type TelemetryOverview,
  type TelemetryPage,
  type TelemetryRange,
  type WorkflowComparisonRow,
  type WorkflowReportRow,
  type WorkflowTrend
} from "../reports/TelemetryContracts";
import { CancellationTokenSource } from "./concurrency/CancellationToken";
import { OriginClaimTracker } from "./concurrency/OriginClaimTracker";
import { ResourceSampler } from "./concurrency/ResourceSampler";
import { defaultSemaphoreCapacities, type ConcurrencyLimits } from "./concurrency/ConcurrencyConfig";
import { APP_INSTANCE_ID } from "./store/AppInstance";
import { configureDurableLocks, getDurableLockStore } from "./store/DurableLockConfig";
import { DurableLockStore, type DurableLease } from "./store/DurableLockStore";
import { NullRuntimeStore, type RuntimeStore } from "./store/RuntimeStore";
import { SqliteRuntimeStore } from "./store/SqliteRuntimeStore";
import { getSqlJsWasmPath } from "./store/SqlJsLoader";
import {
  RUNTIME_DB_FILENAME,
  type DurableArtifactRecord,
  type DurableAttemptRecord,
  type DurableRunRecord
} from "./store/RuntimeStoreSchema";
import { runStartupRecovery } from "./store/StartupRecovery";

/** Per-execution context retained so a single instance can be re-run on demand. */
interface RunContext {
  profile: ConcurrentRunProfile;
  flows: FlowProfile[];
  scenario: ScenarioProfile;
  workflowDataSource?: ResolvedDataSource;
  dataSources: Record<string, ResolvedDataSource>;
  dirs: StorageDirs;
  runtimeInputs: Record<string, unknown>;
}

export class ExecutionEngine {
  public readonly pool = new InstancePool();
  private readonly coordinator = new ConcurrentExecutionCoordinator();
  private readonly manager = new InstanceManager();

  private readonly activeRuns = new Map<string, Promise<void>>();
  private readonly runReports = new Map<string, InstanceReport[]>();
  private readonly runStartTimes = new Map<string, string>();
  private readonly manualHandoffController = new ManualHandoffController();
  // Kept beyond the run lifetime so "Repeat" can re-run a finished instance.
  private readonly runContexts = new Map<string, RunContext>();

  // ── Concurrency & stability layer ────────────────────────────────────────
  /** Bounded browser slots: caps live Chromium processes on the host (env-configurable). */
  private readonly browserPool = new BrowserWorkerPool();
  /** CPU/memory sampler (Phase 3) — feeds backpressure and the runtime status strip. */
  private readonly sampler = new ResourceSampler(this.browserPool.concurrencyLimits.resourceSampleIntervalMs);
  /** Chrome/host process-tree sampler (reporting; gated by AWKIT_PROCESS_SAMPLING). */
  private readonly processSampler = new ProcessTreeSampler();
  /** Throttle for persisting process-tree history rows (ms epoch of last write). */
  private lastProcessSampleWriteAt = 0;
  /**
   * Runtime observability collector (Runtime Observability & Historical Analytics phase). Fed by the
   * existing sampler ticks — starts NO timers of its own. Accumulates per-run environmental summaries +
   * bounded capacity/admission/browser-lifecycle time buckets. Best-effort: never affects a run.
   */
  private readonly observations = new RuntimeObservationCollector();
  /**
   * Runtime observability master switch (Runtime Observability & Historical Analytics phase). Default ON;
   * `AWKIT_RUNTIME_OBSERVABILITY=0` disables ONLY the incremental observability work — per-run environmental
   * summaries, capacity/admission/browser-lifecycle time buckets, and anomaly/regression detection — for A/B
   * overhead benchmarking and troubleshooting. The load-bearing runtime is untouched: the `ResourceSampler`
   * that feeds backpressure and the process-tree history sampling both keep running, and static run
   * dimensions (headed / resourceProfile / isolationClass / workloadWeight / pressureStateAtRun) are still
   * recorded (they are already-resolved config, not sampling overhead). Never a production default of OFF.
   */
  private readonly observabilityEnabled = process.env.AWKIT_RUNTIME_OBSERVABILITY !== "0";
  /** Capacity/admission/lifecycle bucket width (ms). Env-tunable; default 30s (see report §4). */
  private readonly observationBucketMs = observationBucketMsFromEnv();
  /** Per-workflow throttle for the regression check (epoch ms of last run). */
  private readonly lastRegressionCheckAt = new Map<string, number>();
  /** Admission control: pool saturation + host memory/CPU + crash rate → allow/queue with a reason. */
  private readonly backpressure = new BackpressureController(this.browserPool, this.browserPool.concurrencyLimits, this.sampler);
  /**
   * Shared Chromium pool (Phase A5, experimental — gated by limits.useSharedBrowserPool). Shared-eligible
   * instances lease an isolated context here instead of launching a dedicated browser. Sizing is synced
   * from the live concurrency limits in configureConcurrency().
   */
  private readonly sharedBrowserPool = new SharedBrowserPool({
    maxBrowsers: this.browserPool.concurrencyLimits.maxBrowsersPerHost,
    maxContextsPerBrowser: this.browserPool.concurrencyLimits.maxContextsPerBrowser,
    maxContextsPerBrowserHardLimit: this.browserPool.concurrencyLimits.maxContextsPerBrowserHardLimit,
    recycleAfterContexts: this.browserPool.concurrencyLimits.browserRecycleAfterContexts
  });
  /**
   * Operation limiters (Phase A6): stagger simultaneous browser launches / context creations /
   * navigations / downloads / screenshots across all instances. Sized live in configureConcurrency().
   */
  private readonly operationLimiters = new OperationLimiters({
    browserLaunch: this.browserPool.concurrencyLimits.maxConcurrentBrowserLaunches,
    contextCreation: this.browserPool.concurrencyLimits.maxConcurrentContextCreations,
    navigation: this.browserPool.concurrencyLimits.maxConcurrentNavigations,
    download: this.browserPool.concurrencyLimits.maxConcurrentDownloads,
    screenshot: this.browserPool.concurrencyLimits.maxConcurrentScreenshots
  });
  /**
   * Adaptive concurrency controller (Phase A7): lowers the live active-flow target under real host
   * pressure and recovers gradually. Ceiling = maxActiveFlows; re-seeded in configureConcurrency().
   */
  private readonly adaptive = new AdaptiveController(
    this.browserPool.concurrencyLimits.maxActiveFlows,
    this.buildAdaptiveThresholds(this.browserPool.concurrencyLimits)
  );
  /**
   * Phase A8 — cached per-instance admission weight (persistent profile / headed / downloads / parallel
   * branches / trace-video / … each add cost). Computed once from the static config + flows; stable for
   * the instance's lifetime. Only consulted when limits.workloadWeights is enabled.
   */
  private readonly instanceWeights = new Map<string, number>();
  /**
   * Phase A5+ memory-based recycling: samples each pooled browser's process-tree RSS so a browser whose OWN
   * footprint stays over `browserRecycleMemoryMb` for a moving window is drained + replaced. Windows-only
   * attribution (empty elsewhere → feature stays inert). Evaluated on a throttle from the dispatch loop.
   */
  private readonly browserSubtreeSampler: BrowserSubtreeSampler = createBrowserSubtreeSampler();
  private lastMemRecycleAt = 0;
  /**
   * Phase B1 — the machine identity for runs started now (machineId / CPU / RAM / mode / workload class /
   * recommendation), pushed in by the main process (the src/ core never detects the machine itself). Live
   * fields (pool mode, configured cap, available memory, peak concurrency) are filled at write time.
   */
  private machineRunContext: MachineRunContext = {};
  /** Phase B1 — peak simultaneously-active instance count observed per execution (for reporting). */
  private readonly executionPeakConcurrency = new Map<string, number>();
  /** Per-instance unsettled runner promises — the watchdog's "is anything actually running" signal. */
  private readonly activeInstanceRunners = new Map<string, Promise<void>>();
  /** Per-instance hard-cancellation sources (Phase 3). */
  private readonly cancellationSources = new Map<string, CancellationTokenSource>();
  /** Durable runtime store (SQLite via sql.js) — NullRuntimeStore until initialized/disabled. */
  private durableStore: RuntimeStore = new NullRuntimeStore();
  private durableLockStore?: DurableLockStore;
  private durableInit?: Promise<void>;
  /** Interrupted prior runs found by startup recovery (surfaced in runtime status). */
  private recoverableRuns: DurableRunRecord[] = [];
  /** Runtime store/artifact paths + app mode (Phase 4B diagnostics). */
  private environmentInfo?: RuntimeEnvironmentInfo;
  private lastThrottleReason?: string;
  private readonly watchdog = new WatchdogService(
    {
      listActiveInstances: () =>
        this.pool
          .list()
          .filter((instance) => ["starting", "running"].includes(instance.status))
          .map((instance) => ({
            instanceId: instance.instanceId,
            executionId: instance.executionId,
            status: instance.status,
            heartbeatAt: instance.runtime?.heartbeatAt,
            startedAt: instance.startedAt,
            runnerActive: this.activeInstanceRunners.has(instance.instanceId)
          })),
      onFinding: (finding) => this.handleWatchdogFinding(finding),
      log: (message) => console.warn(message)
    },
    this.browserPool.concurrencyLimits,
    globalResourceLocks
  );

  public getInstances(): InstanceRuntimeState[] {
    return this.pool.list();
  }

  /**
   * Whether the incremental runtime-observability collection/persistence is active (per-run environmental
   * summaries, capacity/admission/lifecycle buckets, anomaly/regression detection). Default true; gated off
   * with `AWKIT_RUNTIME_OBSERVABILITY=0` for A/B overhead benchmarking. Read-only view of the resolved flag.
   */
  public isObservabilityEnabled(): boolean {
    return this.observabilityEnabled;
  }

  /**
   * Phase 3 durable runtime init (once, on the first run): opens the SQLite runtime store and
   * the durable cross-process lock store under `<runtime root>/runtime/`, scans stale locks
   * from prior crashes (marked + recorded, never silently deleted), and runs startup recovery
   * over runs that were still active when a previous app instance exited. Any failure here
   * downgrades to in-memory-only behavior — durability must never block execution.
   */
  private ensureDurableRuntime(dirs: StorageDirs): Promise<void> {
    if (this.durableInit) return this.durableInit;
    this.durableInit = (async () => {
      const runtimeDir = join(dirs.root, "runtime");
      const sqlitePath = join(runtimeDir, RUNTIME_DB_FILENAME);
      const buildEnvironment = (enabled: boolean): RuntimeEnvironmentInfo => ({
        appMode: getAppMode(),
        runtimeRoot: dirs.root,
        sqlitePath,
        artifactsRoot: join(dirs.root, "instances"),
        sqlJsWasmPath: getSqlJsWasmPath(),
        durableStoreEnabled: enabled
      });
      if (process.env.AWKIT_DURABLE_STORE === "0") {
        this.environmentInfo = buildEnvironment(false);
        return;
      }
      try {
        this.durableStore = await SqliteRuntimeStore.open(sqlitePath);
        this.durableLockStore = new DurableLockStore(join(runtimeDir, "locks"), defaultSemaphoreCapacities());
        configureDurableLocks(this.durableLockStore);
        this.environmentInfo = buildEnvironment(true);

        // Stale durable locks from prior crashes: quarantine with a reason + record the event.
        const staleLocks = await this.durableLockStore.scanStale();
        for (const stale of staleLocks) {
          this.durableStore.recordWatchdogEvent({
            kind: "staleDurableLock",
            reason: `${stale.key} (owner ${stale.ownerId}): ${stale.staleReason}`,
            at: new Date().toISOString()
          });
        }

        // Startup recovery: runs that looked active under a previous app instance.
        const verdicts = runStartupRecovery(this.durableStore, APP_INSTANCE_ID);
        for (const verdict of verdicts) {
          console.warn(`[recovery] run ${verdict.run.instanceId}: ${verdict.status} — ${verdict.recoveryNote}`);
        }
        this.refreshRecoverableRuns();

        // Bounded reporting retention (DB rows only; never user artifacts). Env-overridable.
        this.durableStore.sweepRetention({
          retentionHours: Number(process.env.AWKIT_REPORT_RETENTION_HOURS) || 24,
          retentionRuns: Number(process.env.AWKIT_REPORT_RETENTION_RUNS) || 5000,
          observabilityBucketDays: Number(process.env.AWKIT_OBSERVABILITY_BUCKET_RETENTION_DAYS) || 14,
          anomalyDays: Number(process.env.AWKIT_ANOMALY_RETENTION_DAYS) || 90
        });

        await this.durableStore.persistNow();
      } catch (error) {
        console.warn(`[runtime-store] durable runtime disabled: ${error instanceof Error ? error.message : String(error)}`);
        this.durableStore = new NullRuntimeStore();
        this.environmentInfo = buildEnvironment(false);
      }
    })();
    return this.durableInit;
  }

  /**
   * Open the durable runtime (store + locks + startup recovery) ahead of the first run —
   * called at app startup by the IPC layer so recoverable prior runs are visible in the
   * Instance Monitor immediately after a restart, not only once a new run starts.
   */
  public initializeDurableRuntime(dirs: StorageDirs): Promise<void> {
    return this.ensureDurableRuntime(dirs);
  }

  /** Runs awaiting user attention: orphaned/recoverable or failed/manual-review verdicts. */
  private refreshRecoverableRuns(): void {
    this.recoverableRuns = this.durableStore
      .listRuns(200)
      .filter((run) => run.recoveryNote !== undefined && ["orphaned", "failed"].includes(run.status))
      .slice(0, 20);
  }

  /** Current capacity/backpressure view (browsers, contexts, pages, memory, crash window). */
  public getCapacitySnapshot(): CapacitySnapshot {
    const list = this.pool.list();
    const active = list.filter((instance) => ["starting", "running"].includes(instance.status)).length;
    const queued = list.filter((instance) => ["queued", "pending"].includes(instance.status)).length;
    return this.backpressure.snapshot(active, queued, { target: this.adaptive.currentTarget, state: this.adaptive.currentState });
  }

  /** Lock-table debug view (profile/downloadDir/origin/account counts + stale leases). */
  public getLockSnapshot(): LockDebugSnapshot {
    return buildLockDebugSnapshot(globalResourceLocks.snapshot(false));
  }

  public getBrowserPoolSnapshot(): BrowserPoolSnapshot {
    return this.browserPool.snapshot();
  }

  /**
   * Read-only view of the shared Chromium pool (Phase A5): live shared-browser count, contexts, and
   * per-browser recycle/health state. Additive diagnostics for the capacity benchmark + a future Instance
   * Monitor gauge; empty/zeroed only when no shared browsers exist (pool turned off, or none created yet).
   */
  public getSharedBrowserSnapshot(): SharedBrowserSnapshot {
    return this.sharedBrowserPool.snapshot();
  }

  /**
   * Close every shared browser that currently has no active contexts (Phase A5). The engine already
   * drains idle shared browsers at each run's end; this exposes the same operation so a caller can reclaim
   * shared Chromium that fell idle AFTER the last run finished (e.g. capacity-benchmark teardown, or a
   * future explicit "release idle browsers" control). No-op when the shared pool is turned off.
   */
  public drainIdleSharedBrowsers(): Promise<void> {
    return this.sharedBrowserPool.drainIdle();
  }

  public getWatchdogSnapshot(): WatchdogSnapshot {
    return this.watchdog.snapshot();
  }

  /**
   * Explicit durable-store flush: resolve only once every accepted run write has been committed to the
   * SQLite file on disk. In-process reads already see writes immediately (the sql.js DB is mutated
   * synchronously on each upsert), so this is for cross-process/at-rest durability and for benchmarks/
   * verifiers that need a deterministic drain point rather than an arbitrary sleep.
   */
  public async persistDurableNow(): Promise<void> {
    await this.durableStore.persistNow();
  }

  /** Aggregated runtime status for the IPC status API / Instance Monitor strip. */
  /**
   * Apply user-configured host concurrency caps (from Settings) over the env/default limits. Pushed in
   * from the main process (the src/ core never reads app settings). Safe to call at startup, on every
   * settings save, and before each run; a `maxBrowsersPerHost` change only resizes the slot pool while
   * it is idle (see BrowserWorkerPool.reconfigure). `maxActiveFlows` takes effect immediately.
   */
  public configureConcurrency(overrides: Partial<ConcurrencyLimits>): void {
    this.browserPool.reconfigure(overrides);
    // Keep the shared pool's sizing in step with the live limits (Phase A5).
    const limits = this.browserPool.concurrencyLimits;
    this.sharedBrowserPool.setOptions({
      maxBrowsers: limits.maxBrowsersPerHost,
      maxContextsPerBrowser: limits.maxContextsPerBrowser,
      maxContextsPerBrowserHardLimit: limits.maxContextsPerBrowserHardLimit,
      recycleAfterContexts: limits.browserRecycleAfterContexts
    });
    this.operationLimiters.configure({
      browserLaunch: limits.maxConcurrentBrowserLaunches,
      contextCreation: limits.maxConcurrentContextCreations,
      navigation: limits.maxConcurrentNavigations,
      download: limits.maxConcurrentDownloads,
      screenshot: limits.maxConcurrentScreenshots
    });
    this.adaptive.updateThresholds(this.buildAdaptiveThresholds(limits));
    // A configuration change is an intentional operator action (not pressure): the target jumps to the
    // new ceiling immediately rather than crawling there.
    this.adaptive.setCeiling(limits.maxActiveFlows);
  }

  /**
   * Phase B1: record the machine identity for runs started from now on (pushed by the main process,
   * which owns machine detection). Merged into each run's durable row so reports can filter/compare by
   * machine. Best-effort — an unset context just leaves the machine columns NULL ("Unknown" in reports).
   */
  public setMachineRunContext(context: MachineRunContext): void {
    this.machineRunContext = { ...context };
  }

  /**
   * Injected by the main process (audit §15): resolve a named secret to its decrypted value from the
   * encrypted secret store. Kept as a callback so `src/` never imports Electron `safeStorage`; the tsx
   * verifiers that don't set it simply run with secrets unavailable.
   */
  private secretResolver?: (name: string) => string | undefined;

  public setSecretResolver(resolver: (name: string) => string | undefined): void {
    this.secretResolver = resolver;
  }

  /** Resolve the secret names a scenario's flows reference into a per-run map (undefined when none/no resolver). */
  private resolveSecretsForFlows(flows: FlowProfile[]): Record<string, string> | undefined {
    if (!this.secretResolver) return undefined;
    const names = collectSecretNames(flows);
    if (!names.length) return undefined;
    const map: Record<string, string> = {};
    for (const name of names) {
      const value = this.secretResolver(name);
      if (value !== undefined) map[name] = value;
    }
    if (!Object.keys(map).length) return undefined;
    registerSecretValues(Object.values(map)); // scrub these literals from logs/diagnostics
    return map;
  }

  /** Machine-context columns for a run starting now: static identity + live pool/cap/memory readings. */
  private buildRunMachineContext(): Partial<MachineRunContext> {
    const limits = this.browserPool.concurrencyLimits;
    return {
      ...this.machineRunContext,
      browserPoolMode: limits.useSharedBrowserPool ? "shared" : "dedicated",
      configuredConcurrency: this.machineRunContext.configuredConcurrency ?? limits.maxActiveFlows,
      availableMemoryMbAtStart: this.machineRunContext.availableMemoryMbAtStart ?? Math.round(os.freemem() / (1024 * 1024))
    };
  }

  /** Map the live concurrency limits into the adaptive controller's threshold config. */
  private buildAdaptiveThresholds(limits: ConcurrencyLimits): AdaptiveThresholds {
    return {
      enabled: limits.adaptiveConcurrency,
      growStep: limits.adaptiveGrowStep,
      shrinkStep: limits.adaptiveShrinkStep,
      cooldownMs: limits.adaptiveCooldownMs,
      healthyCpuPercent: limits.adaptiveHealthyCpuPercent,
      healthyMemoryPercent: limits.adaptiveHealthyMemoryPercent,
      pressureCpuPercent: limits.maxCpuPercent,
      pressureMemoryPercent: limits.maxSystemMemoryPercent,
      pressureFreeMemoryMb: limits.minFreeMemoryMb,
      pressureEventLoopMs: limits.adaptivePressureEventLoopMs,
      criticalCpuPercent: limits.adaptiveCriticalCpuPercent,
      criticalMemoryPercent: limits.adaptiveCriticalMemoryPercent,
      criticalEventLoopMs: limits.adaptiveCriticalEventLoopMs,
      criticalCrashes: limits.maxRecentCrashes
    };
  }

  public async getRuntimeStatus(): Promise<RuntimeStatusSnapshot> {
    // Keep host resource sampling live even with no active run so the Chrome Consumption gauges show
    // system RAM/CPU at idle instead of a permanent "sampling…". start() is idempotent, primes the
    // first sample synchronously, and the timer is unref'd/best-effort — a no-op once a run started it.
    this.sampler.start();
    const durableLocks = await this.durableLockStore?.snapshot().catch(() => undefined);
    return buildRuntimeStatus({
      capacity: this.getCapacitySnapshot(),
      lockEntries: globalResourceLocks.snapshot(false),
      browserPool: this.browserPool.snapshot(),
      watchdog: this.watchdog.snapshot(),
      durableLocks,
      recoverableRuns: this.recoverableRuns,
      environment: this.environmentInfo,
      processes: this.processSampler.latest
    });
  }

  /**
   * Start Chrome/host process-tree sampling (reporting only; gated by AWKIT_PROCESS_SAMPLING).
   * Each tick refreshes the live snapshot and, throttled to ~15s, appends a durable history row.
   * Idempotent, never throws, and the timer is unref'd — safe if no run is active.
   */
  private startProcessSampling(): void {
    if (process.env.AWKIT_PROCESS_SAMPLING === "0") return;
    this.processSampler.start((sample) => {
      const now = Date.now();
      // Observability tick — runs EVERY sampler tick (reuses this existing loop; no new timer). Never
      // throws; a collector fault must not affect execution or the process-history write below.
      this.collectObservationTick(sample, now);
      // Durable process-history write (throttled to ~15s; unchanged from the reporting refactor).
      if (now - this.lastProcessSampleWriteAt < 15_000) return;
      this.lastProcessSampleWriteAt = now;
      const pool = this.browserPool.snapshot();
      this.durableStore.recordProcessSample({
        timestamp: sample.sampledAt,
        chromiumProcessCount: sample.chromiumProcessCount,
        chromiumMemoryMb: sample.chromiumMemoryMb,
        electronMainMemoryMb: sample.electronMainMemoryMb,
        browserContextCount: pool.slots.reduce((sum, slot) => sum + (slot.activeContexts ?? 0), 0),
        pageCount: pool.slots.reduce((sum, slot) => sum + (slot.activePages ?? 0), 0),
        activeBrowsers: pool.activeSlots,
        idleBrowsers: Math.max(0, pool.maxSlots - pool.activeSlots),
        crashesWindow: pool.recentCrashes,
        availability: sample.availability
      });
    });
  }

  /**
   * Feed one shared host sample + live capacity context into the observation collector and flush any
   * completed time bucket. Reuses the already-computed capacity snapshot + pool snapshots — no extra OS
   * scan. Best-effort: any fault is swallowed so observability never affects a run.
   */
  private collectObservationTick(processSample: ProcessTreeSample, nowMs: number): void {
    if (!this.observabilityEnabled) return;
    try {
      const capacity = this.getCapacitySnapshot();
      const sharedSnap = this.sharedBrowserPool.snapshot();
      const limits = this.browserPool.concurrencyLimits;
      const weightedActive = limits.workloadWeights;
      this.observations.observeTick(
        {
          systemCpuPercent: capacity.cpuPercent,
          systemMemoryPercent: capacity.systemMemoryPercent,
          chromiumRssMb: processSample.chromiumMemoryMb,
          awkitRssMb: processSample.electronMainMemoryMb ?? capacity.processRssMb,
          nodeHeapMb: safeHeapUsedMb()
        },
        {
          adaptiveTarget: capacity.adaptiveTarget,
          weightedBudget: weightedActive ? weightedBudget(limits.maxActiveFlows, limits.workloadWeightBudgetPerFlow) : undefined,
          activeWeight: this.activeWeightedCost(),
          activeFlows: capacity.activeFlows,
          queuedFlows: capacity.queueDepth,
          sharedBrowsers: sharedSnap.totalBrowsers,
          contextCount: capacity.activeContexts,
          pageCount: capacity.activePages,
          weightedAdmissionActive: weightedActive
        }
      );
      this.observations.observeRetirements(sharedSnap.closeReasons as unknown as Record<string, number>);
      this.flushObservationBuckets(nowMs);
    } catch {
      /* observability must never affect execution */
    }
  }

  /** Finalize a run's environmental observation summary into its durable run columns. Best-effort. */
  private finalizeRunObservation(instanceId: string): Partial<DurableRunRecord> {
    if (!this.observabilityEnabled) return {};
    try {
      const summary = this.observations.finalizeRun(instanceId);
      if (!summary) return {};
      return {
        obsSampleCount: summary.sampleCount,
        obsSystemCpuMean: summary.observedSystemCpuMeanDuringRun,
        obsSystemCpuP95: summary.observedSystemCpuP95DuringRun,
        obsSystemMemoryMean: summary.observedSystemMemoryMeanDuringRun,
        obsSystemMemoryP95: summary.observedSystemMemoryP95DuringRun,
        obsChromiumRssMeanMb: summary.observedChromiumRssMeanMbDuringRun,
        obsChromiumRssP95Mb: summary.observedChromiumRssP95MbDuringRun,
        obsAwkitRssMeanMb: summary.observedAwkitRssMeanMbDuringRun,
        obsAwkitRssP95Mb: summary.observedAwkitRssP95MbDuringRun
      };
    } catch {
      return {};
    }
  }

  /** Record one admission-delay episode (normalized reason + current pressure state). Best-effort. */
  private recordAdmissionDelay(rawReason: string | undefined): void {
    if (!this.observabilityEnabled) return;
    try {
      this.observations.recordAdmissionDelay(normalizeAdmissionReason(rawReason), normalizePressureState(this.adaptive.currentState));
    } catch {
      /* observability must never affect execution */
    }
  }

  /** Persist any completed capacity/admission/lifecycle bucket. `force` rolls a partial bucket (teardown). */
  private flushObservationBuckets(nowMs: number, force = false): void {
    if (!this.observabilityEnabled) return;
    const rolled = this.observations.maybeRollBuckets(nowMs, this.observationBucketMs, force);
    if (!rolled) return;
    if (rolled.capacity) this.durableStore.recordCapacityBucket(rolled.capacity);
    for (const admission of rolled.admission) this.durableStore.recordAdmissionBucket(admission);
    for (const lifecycle of rolled.lifecycle) this.durableStore.recordBrowserLifecycleBucket(lifecycle);
  }

  // ── Reporting queries (read-only; delegate to the durable store) ────────────

  getTelemetryOverview(range: TelemetryRange): TelemetryOverview {
    return this.durableStore.queryOverview(range);
  }

  getTelemetryWorkflows(range: TelemetryRange): WorkflowReportRow[] {
    return this.durableStore.queryWorkflows(range);
  }

  getTelemetryWorkflowComparison(range: TelemetryRange, machineFilter?: MachineFilter): WorkflowComparisonRow[] {
    return this.durableStore.queryWorkflowComparison(range, machineFilter);
  }

  getTelemetryWorkflowTrend(scenarioId: string | undefined, range: TelemetryRange, buckets: number, machineFilter?: MachineFilter): WorkflowTrend {
    return this.durableStore.queryWorkflowTrend(scenarioId, range, buckets, machineFilter);
  }

  getTelemetryMachines(range: TelemetryRange): MachineSummary[] {
    return this.durableStore.listRunMachines(range);
  }

  getTelemetryRunHistory(range: TelemetryRange, page: TelemetryPage, filter?: RunHistoryFilter): RunHistoryPage {
    return this.durableStore.queryRunHistory(range, page, filter);
  }

  /** Complete run counts by status via an unbounded aggregate (correct beyond any pagination/row cap). */
  getTelemetryStatusCounts(range: TelemetryRange, filter?: RunHistoryFilter): RunStatusCounts {
    return this.durableStore.countRunsByStatus(range, filter);
  }

  getTelemetryRunDetail(instanceId: string): RunDetail {
    // Keyed lookup — NOT a recent-N scan, so detail is available for any run still in the store.
    const run = this.durableStore.getRun(instanceId);
    return { run, attempts: this.durableStore.listAttempts(instanceId), artifacts: this.durableStore.listArtifacts(instanceId) };
  }

  getTelemetryFailures(range: TelemetryRange): FailureBreakdown {
    return this.durableStore.queryFailures(range);
  }

  getTelemetryRuntimeSeries(range: TelemetryRange, bucketMs: number): RuntimeSeriesPoint[] {
    return this.durableStore.queryRuntimeSeries(range, bucketMs);
  }

  getTelemetryProcessHistory(sinceIso?: string, limit?: number): ProcessHistoryPoint[] {
    return this.durableStore.listProcessSamples(sinceIso, limit).map(processSampleToHistoryPoint);
  }

  // ── Observability analytics getters (delegate to the durable store) ─────────

  getTelemetryWorkflowHistoricalStats(scenarioId: string | undefined, range: TelemetryRange, machineFilter?: MachineFilter): WorkflowHistoricalStats {
    return this.durableStore.queryWorkflowHistoricalStats(scenarioId, range, machineFilter);
  }

  getTelemetryWorkflowHistoricalTrend(scenarioId: string | undefined, range: TelemetryRange, machineFilter?: MachineFilter): WorkflowHistoricalTrend {
    return this.durableStore.queryWorkflowHistoricalTrend(scenarioId, range, machineFilter);
  }

  getTelemetryRunVsHistory(instanceId: string, range?: TelemetryRange): RunVsHistoryComparison | undefined {
    return this.durableStore.queryRunVsHistory(instanceId, range);
  }

  getTelemetryWorkflowRankings(range: TelemetryRange, metric: WorkflowRankingMetric, limit?: number, machineFilter?: MachineFilter): WorkflowRanking {
    return this.durableStore.queryWorkflowRankings(range, metric, limit, machineFilter);
  }

  getTelemetryCapacityAnalytics(range: TelemetryRange): CapacityAnalytics {
    return this.durableStore.queryCapacityAnalytics(range);
  }

  getTelemetryAnomalies(range: TelemetryRange, workflowId?: string, limit?: number): AnomalyEvent[] {
    return this.durableStore.queryAnomalies(range, workflowId, limit);
  }

  /** Live observability summary for the Instance Monitor strip (Phase 07). */
  getObservabilitySummary(): RuntimeObservabilitySummary {
    const capacity = this.getCapacitySnapshot();
    const limits = this.browserPool.concurrencyLimits;
    const shared = this.sharedBrowserPool.snapshot();
    const weightedActive = limits.workloadWeights;
    const reason = normalizeAdmissionReason(capacity.blockedReason);
    return {
      pressureState: normalizePressureState(capacity.adaptiveState),
      activeWorkflows: capacity.activeFlows,
      queuedWorkflows: capacity.queueDepth,
      adaptiveTarget: capacity.adaptiveTarget,
      weightedBudget: weightedActive ? weightedBudget(limits.maxActiveFlows, limits.workloadWeightBudgetPerFlow) : undefined,
      activeWeight: weightedActive ? this.activeWeightedCost() : undefined,
      weightedAdmissionActive: weightedActive,
      sharedBrowsers: shared.totalBrowsers,
      browserContexts: capacity.activeContexts,
      pageCount: capacity.activePages,
      cpuPercent: capacity.cpuPercent,
      systemMemoryPercent: capacity.systemMemoryPercent,
      chromiumRssMb: this.processSampler.latest?.chromiumMemoryMb,
      currentAdmissionReason: capacity.dispatchBlocked ? reason : undefined,
      currentAdmissionReasonLabel: capacity.dispatchBlocked ? ADMISSION_REASON_LABELS[reason] : undefined
    };
  }

  /**
   * Deterministic run-level anomaly + throttled regression detection after a run finalizes (Phase 06).
   * Best-effort — a detection fault never affects the run. Run-level checks compare the run to its 30-day
   * history; regression checks compare recent 7 days vs the previous 7 days (throttled to 5 min/workflow).
   */
  private runAnomalyChecks(instanceId: string, scenarioId: string | undefined): void {
    if (!this.observabilityEnabled) return;
    try {
      const run = this.durableStore.getRun(instanceId);
      if (!run) return;
      const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const history = this.durableStore.listRunsForScenario(scenarioId, since30);
      const nowIso = new Date().toISOString();
      for (const anomaly of detectRunAnomalies(run, history)) {
        this.durableStore.recordAnomaly({
          workflowId: scenarioId,
          runId: instanceId,
          detectedAt: nowIso,
          scope: anomaly.scope,
          signalType: anomaly.signalType,
          severity: anomaly.severity,
          currentValue: anomaly.currentValue,
          baselineValue: anomaly.baselineValue,
          thresholdRule: anomaly.thresholdRule,
          windowLabel: anomaly.windowLabel,
          sampleCount: anomaly.sampleCount,
          state: "active",
          note: anomaly.note
        });
      }
      const key = scenarioId ?? "(unknown)";
      const now = Date.now();
      if (now - (this.lastRegressionCheckAt.get(key) ?? 0) >= 5 * 60_000) {
        this.lastRegressionCheckAt.set(key, now);
        this.runRegressionCheck(scenarioId, now);
      }
    } catch {
      /* observability must never affect execution */
    }
  }

  private runRegressionCheck(scenarioId: string | undefined, nowMs: number): void {
    const windowMs = 7 * 86_400_000;
    const all = this.durableStore.listRunsForScenario(scenarioId, new Date(nowMs - 2 * windowMs).toISOString());
    const epoch = (r: DurableRunRecord) => Date.parse(r.endedAt ?? r.startedAt ?? r.updatedAt);
    const recent = all.filter((r) => epoch(r) >= nowMs - windowMs);
    const previous = all.filter((r) => {
      const t = epoch(r);
      return t >= nowMs - 2 * windowMs && t < nowMs - windowMs;
    });
    const input: RegressionInput = {
      recent,
      previous,
      recentQueueDelays: recent.filter((r) => (r.queueWaitMs ?? 0) > QUEUE_DELAY_PROXY_MS).length,
      previousQueueDelays: previous.filter((r) => (r.queueWaitMs ?? 0) > QUEUE_DELAY_PROXY_MS).length,
      windowLabel: "recent 7d vs previous 7d"
    };
    const detected = detectRegressions(input);
    // Latest anomaly per signal (DESC list → first per signal is newest) for dedup/cooldown/recovery.
    const existing = this.durableStore.listAnomalies(undefined, scenarioId, 200).filter((a) => a.scope === "regression");
    const latestPerSignal = new Map<string, DurableAnomalyRecord>();
    for (const a of existing) if (!latestPerSignal.has(a.signalType)) latestPerSignal.set(a.signalType, a);
    const rows = reconcileRegressions(detected, [...latestPerSignal.values()], scenarioId, new Date(nowMs).toISOString());
    for (const row of rows) this.durableStore.recordAnomaly(row);
  }

  /** Durable runs view (recovery inspection). */
  public getRecoverableRuns(): DurableRunRecord[] {
    return [...this.recoverableRuns];
  }

  /**
   * Full durable detail for one recoverable/interrupted prior run: the run row, its node
   * attempts (last node, safety level, error class, trace/screenshot paths), and every
   * recorded artifact path. Read-only; no secrets (URLs were sanitized at write time).
   */
  public getRecoveryDetails(instanceId: string): {
    run?: DurableRunRecord;
    attempts: DurableAttemptRecord[];
    artifacts: DurableArtifactRecord[];
  } {
    // Keyed lookup — available for any retained run, not just the most recent 1000.
    const run = this.durableStore.getRun(instanceId);
    return {
      run,
      attempts: this.durableStore.listAttempts(instanceId),
      artifacts: this.durableStore.listArtifacts(instanceId)
    };
  }

  /**
   * User verdict on a recoverable/manual-review prior run. `markReviewed` records that a
   * human checked the external system; `markAbandoned` records the run will not be re-run.
   * Neither resumes anything — dangerous interrupted nodes are never auto-resumed.
   */
  public async applyRecoveryAction(instanceId: string, action: "markReviewed" | "markAbandoned"): Promise<void> {
    const run = this.recoverableRuns.find((candidate) => candidate.instanceId === instanceId);
    if (!run) {
      throw new Error(`Run ${instanceId} is not in the recoverable/manual-review list.`);
    }
    const status = action === "markReviewed" ? "reviewed" : "abandoned";
    this.durableStore.markRunRecovery(instanceId, {
      status,
      recoverable: false,
      recoveryNote: `${run.recoveryNote ?? "Interrupted prior run."} Marked ${status} by user at ${new Date().toISOString()}.`
    });
    this.durableStore.recordWatchdogEvent({
      instanceId,
      kind: "recoveryAction",
      reason: `User marked the interrupted run ${status}.`,
      at: new Date().toISOString()
    });
    this.refreshRecoverableRuns();
    await this.durableStore.persistNow();
  }

  /** Watchdog findings become explicit, logged state — never silently ignored stuck work. */
  private handleWatchdogFinding(finding: WatchdogFinding): void {
    const instance = this.pool.get(finding.instanceId);
    if (!instance) return;
    this.durableStore.recordWatchdogEvent({
      instanceId: finding.instanceId,
      kind: finding.kind,
      reason: finding.reason,
      at: finding.at ?? new Date().toISOString()
    });

    if (finding.kind === "orphaned") {
      // No runner promise exists — safe to mark terminal and free the instance's resources.
      this.pool.update(finding.instanceId, {
        status: "failed",
        runtime: { ...instance.runtime, flowRunStatus: "orphaned", watchdogNote: finding.reason }
      });
      globalProfileLocks.releaseOwner(finding.instanceId);
      return;
    }

    // staleHeartbeat: the runner promise is still alive (Playwright actions carry their own
    // timeouts), so recovery here is observation, not termination — the note makes the stall
    // visible in the UI state and run artifacts.
    this.pool.update(finding.instanceId, {
      runtime: { ...instance.runtime, flowRunStatus: instance.runtime?.flowRunStatus ?? "running", watchdogNote: finding.reason }
    });
  }

  public removeInstance(instanceId: string): void {
    const instance = this.pool.get(instanceId);
    if (!instance) return;
    if (["starting", "running", "paused"].includes(instance.status)) {
      throw new Error(`Cannot remove instance ${instanceId} because it is still active.`);
    }
    this.pool.remove(instanceId);
  }

  public async startRun(
    executionId: string,
    profile: ConcurrentRunProfile,
    rows: unknown[],
    dirs: StorageDirs,
    runtimeInputs: Record<string, unknown>,
    scenario: ScenarioProfile,
    flows: FlowProfile[],
    workflowDataSource?: ResolvedDataSource,
    dataSources: Record<string, ResolvedDataSource> = {}
  ): Promise<void> {
    const instances = this.manager.createInstancesForRun(profile, rows, dirs, runtimeInputs);
    const alignedInstances = instances.map((inst) => ({ ...inst, executionId }));

    for (const inst of alignedInstances) {
      this.pool.add(inst);
    }

    this.runReports.set(executionId, []);
    this.runStartTimes.set(executionId, new Date().toISOString());
    this.runContexts.set(executionId, { profile, flows, scenario, workflowDataSource, dataSources, dirs, runtimeInputs });
    this.watchdog.start();
    this.sampler.start();
    this.startProcessSampling();
    await this.ensureDurableRuntime(dirs);

    const runPromise = this.processQueue(
      executionId,
      profile,
      flows,
      scenario,
      workflowDataSource,
      dataSources,
      dirs,
      runtimeInputs
    );
    this.activeRuns.set(executionId, runPromise);

    void runPromise.finally(() => {
      this.activeRuns.delete(executionId);
      this.runReports.delete(executionId);
      this.runStartTimes.delete(executionId);
    }).catch(() => undefined);
  }

  /**
   * Phase A8 — admission weight for one instance, computed once from its static config + flows and
   * cached for the instance's lifetime (weight never changes mid-run). `traceOrVideo` comes from the
   * live trace mode. Only consulted when limits.workloadWeights is enabled.
   */
  private instanceWeight(instance: InstanceRuntimeState, flows: FlowProfile[]): number {
    const cached = this.instanceWeights.get(instance.instanceId);
    if (cached !== undefined) return cached;
    const features = extractWorkloadFeatures(instance.config, flows, { traceOrVideo: loadTraceMode() === "always" });
    const weight = computeWorkloadWeight(features, DEFAULT_WORKLOAD_WEIGHT_CONFIG);
    this.instanceWeights.set(instance.instanceId, weight);
    return weight;
  }

  /** Total weighted cost of every starting/running instance across ALL runs (Phase A8). */
  private activeWeightedCost(): number {
    let total = 0;
    for (const instance of this.pool.list()) {
      if (!["starting", "running"].includes(instance.status)) continue;
      const flows = this.runContexts.get(instance.executionId)?.flows ?? [];
      total += this.instanceWeight(instance, flows);
    }
    return total;
  }

  /**
   * Phase A5+ memory recycling (throttled, non-blocking — called from the dispatch loop). Samples each
   * pooled browser's OWN Chromium subtree RSS and DRAINS any whose footprint stays over `thresholdMb`
   * across the moving window, so a long-lived shared pool can't accumulate memory. Draining never touches
   * active workflows: a marked browser stops taking new leases and closes once its last context releases
   * (existing recycle lifecycle). Fully inert unless per-browser root PIDs are attributable — on Playwright
   * 1.61 a launched Browser exposes no process handle, so `browserRoots()` is empty and this returns before
   * any sampling cost. Attribution is also empty off Windows or on a sampler error → skipped, never guessed.
   */
  private async evaluateSharedBrowserMemoryRecycling(thresholdMb: number): Promise<void> {
    const roots = this.sharedBrowserPool.browserRoots();
    if (roots.length === 0) return; // no attributable root PIDs → recycling inert (see field doc)
    const byPid = await this.browserSubtreeSampler.sample(roots.map((r) => r.pid));
    if (byPid.size === 0) return; // attribution unavailable (non-Windows / query failure) → do not guess
    const byId = new Map<string, number>();
    for (const { id, pid } of roots) {
      const mb = byPid.get(pid);
      if (mb !== undefined) byId.set(id, mb);
    }
    const recycled = await this.sharedBrowserPool.applyMemorySamples(byId, thresholdMb);
    if (recycled.length > 0) {
      console.warn(
        `[shared-pool] draining ${recycled.length} browser(s) whose subtree RSS held over ${thresholdMb}MB: ${recycled.join(", ")}.`
      );
    }
  }

  private async processQueue(
    executionId: string,
    profile: ConcurrentRunProfile,
    flows: FlowProfile[],
    scenario: ScenarioProfile,
    workflowDataSource: ResolvedDataSource | undefined,
    dataSources: Record<string, ResolvedDataSource>,
    dirs: StorageDirs,
    runtimeInputs: Record<string, unknown>
  ): Promise<void> {
    let hasMore = true;

    while (hasMore) {
      const currentList = this.pool.list().filter((i) => i.executionId === executionId);
      
      const allTerminal = currentList.every(i => ["completed", "failed", "cancelled"].includes(i.status));
      if (allTerminal && currentList.length > 0) {
        hasMore = false;
        
        // Generate final report
        const reports = this.runReports.get(executionId) ?? [];
        const reportService = new ReportService(dirs.reports);
        const finalReport = reportService.createConcurrentRunReport(scenario, reports, {
          executionId,
          runMode: profile.runMode === "fixedConcurrent" ? "concurrent" : profile.runMode as any,
          maxConcurrentInstances: profile.maxConcurrentInstances,
          startedAt: this.runStartTimes.get(executionId) ?? new Date().toISOString(),
          endedAt: new Date().toISOString(),
          runtimeInputs
        });
        
        await reportService.writeReport(finalReport);
        const store = createReportStore();
        await store.import({ ...finalReport, id: executionId });
        // Phase A5: close shared browsers that no other run is still using (idle → no lingering Chromium).
        await this.sharedBrowserPool.drainIdle().catch(() => undefined);
        // Observability: flush any partial capacity/admission/lifecycle bucket so teardown loses nothing.
        this.flushObservationBuckets(Date.now(), true);
        break;
      }

      const promoted = this.coordinator.promoteQueued(currentList, profile.maxConcurrentInstances);
      promoted.forEach(i => {
        if (i.status === "pending" && this.pool.get(i.instanceId)?.status === "queued") {
          this.pool.update(i.instanceId, { status: "pending", queuePosition: undefined });
        }
      });

      // Admission control: prefer keeping instances pending/queued over overloading the host.
      // Blocked dispatch is logged once per reason; the next tick re-evaluates.
      const allInstances = this.pool.list();
      const activeGlobal = allInstances.filter((i) => ["starting", "running"].includes(i.status)).length;
      const queuedGlobal = allInstances.filter((i) => ["queued", "pending"].includes(i.status)).length;
      // Phase B1: track this run's peak simultaneously-active instance count (written at instance end).
      const execActive = allInstances.filter((i) => i.executionId === executionId && ["starting", "running"].includes(i.status)).length;
      this.executionPeakConcurrency.set(executionId, Math.max(this.executionPeakConcurrency.get(executionId) ?? 0, execActive));
      // Phase A7: fold live host pressure into the effective flow cap (grows slowly when healthy,
      // shrinks under CPU/memory/event-loop/crash pressure — including load from other apps).
      const sample = this.sampler.latest;
      const adaptiveTarget = this.adaptive.evaluate({
        cpuPercent: sample?.cpuPercent,
        systemMemoryPercent: sample?.systemMemoryPercent,
        freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
        eventLoopDelayMs: sample?.eventLoopDelayMs,
        recentCrashes: this.browserPool.recentCrashCount(),
        queueDepth: queuedGlobal
      }).target;
      // Phase A5+ memory recycling: throttled, non-blocking. Drains a shared browser whose own subtree RSS
      // stays over budget (moving window), so long-lived pools don't accumulate memory. No-op unless the
      // shared pool is on with a positive threshold; attribution is Windows-only (inert elsewhere).
      const memLimits = this.browserPool.concurrencyLimits;
      if (memLimits.useSharedBrowserPool && memLimits.browserRecycleMemoryMb > 0 && Date.now() - this.lastMemRecycleAt > 20_000) {
        this.lastMemRecycleAt = Date.now();
        void this.evaluateSharedBrowserMemoryRecycling(memLimits.browserRecycleMemoryMb);
      }

      const admission = this.backpressure.admit(activeGlobal, queuedGlobal, adaptiveTarget);
      if (!admission.allow) {
        if (admission.reason !== this.lastThrottleReason) {
          this.lastThrottleReason = admission.reason;
          console.warn(`[backpressure] new instance dispatch blocked: ${admission.reason} (queued: ${queuedGlobal}).`);
          // Observability: count this admission-delay episode by its NORMALIZED reason (once per episode,
          // not per 500ms retry). Real dispatch-loop decision — never inferred later from CPU values.
          this.recordAdmissionDelay(admission.reason);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      this.lastThrottleReason = undefined;

      const updatedList = this.pool.list().filter((i) => i.executionId === executionId);
      const started = this.coordinator.startPending(updatedList, profile.maxConcurrentInstances);
      const newlyStarted = started.filter(i => i.status === "running" && this.pool.get(i.instanceId)?.status === "pending");

      for (const instance of newlyStarted) {
        // Phase A8 (defaults ON with the shared pool; off when weights are disabled): admit against a
        // WEIGHTED budget so heavy instances (persistent profile / headed / downloads / parallel branches /
        // trace-video) consume more of the host than light ones. Weights-off skips this — count-based
        // admission is unchanged. Never deadlocks: an idle host always admits at least one (canAdmitWeighted).
        const limits = this.browserPool.concurrencyLimits;
        if (limits.workloadWeights) {
          const activeWeight = this.activeWeightedCost();
          const candidateWeight = this.instanceWeight(instance, flows);
          const budget = weightedBudget(limits.maxActiveFlows, limits.workloadWeightBudgetPerFlow);
          if (!canAdmitWeighted(activeWeight, candidateWeight, budget)) {
            const reason = `weighted budget reached (active ${activeWeight.toFixed(2)} + ${candidateWeight.toFixed(2)} > ${budget.toFixed(2)})`;
            if (reason !== this.lastThrottleReason) {
              this.lastThrottleReason = reason;
              console.warn(`[backpressure] instance ${instance.instanceId} queued: ${reason}.`);
              this.recordAdmissionDelay(reason);
            }
            continue; // stay pending; retried next tick as active weighted cost drains
          }
        }

        // Shared-eligible instances (Phase A5, flag-gated) run as an isolated context on a pooled
        // browser, so they take a non-semaphore "context slot" bounded by maxActiveFlows instead of a
        // whole-browser permit. Dedicated instances still take a real browser slot; no free slot → the
        // instance stays pending and is retried next tick (graceful queueing, no unbounded Chromium).
        const shared = isSharedEligible(instance.config, flows, this.browserPool.concurrencyLimits.useSharedBrowserPool);
        const slot = shared ? this.browserPool.acquireContextSlot(instance.instanceId) : this.browserPool.tryAcquireSlot(instance.instanceId);
        if (!slot) break;

        // Per-origin / per-account semaphores: saturation of one origin/account queues only the
        // instances that target it; the browser slot goes back so other work can use it.
        const claims = buildDispatchClaims({ baseUrl: instance.config.baseUrl, envFile: instance.config.envFile, flows });
        const claimTokens = claims.length ? globalResourceLocks.tryAcquireMany(instance.instanceId, claims) : [];
        if (!claimTokens) {
          this.browserPool.releaseSlot(slot);
          const reason = `origin/account semaphore saturated (${claims.map((claim) => claim.key).join(", ")})`;
          if (reason !== this.lastThrottleReason) {
            this.lastThrottleReason = reason;
            console.warn(`[backpressure] instance ${instance.instanceId} queued: ${reason}.`);
            this.recordAdmissionDelay(reason);
          }
          continue;
        }

        this.pool.update(instance.instanceId, {
          status: "running",
          startedAt: instance.startedAt,
          currentFlow: instance.currentFlow,
          currentStep: instance.currentStep
        });

        this.runInstance(instance, flows, scenario, workflowDataSource, dataSources, dirs, slot, claimTokens).catch(console.error);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  /**
   * Run one instance. Registers the unsettled promise for the watchdog's orphan detection and
   * guarantees slot/lock/artifact cleanup in `finally`, whatever the runner does.
   */
  private runInstance(
    instance: InstanceRuntimeState,
    flows: FlowProfile[],
    scenario: ScenarioProfile,
    workflowDataSource: ResolvedDataSource | undefined,
    dataSources: Record<string, ResolvedDataSource>,
    dirs: StorageDirs,
    slot?: BrowserWorkerSlot,
    claimTokens?: LeaseToken[]
  ): Promise<void> {
    const promise = this.runInstanceInner(instance, flows, scenario, workflowDataSource, dataSources, dirs, slot, claimTokens);
    this.activeInstanceRunners.set(instance.instanceId, promise);
    return promise.finally(() => {
      this.activeInstanceRunners.delete(instance.instanceId);
      // A terminal instance no longer consumes weighted budget; drop its cached weight (Phase A8).
      this.instanceWeights.delete(instance.instanceId);
    });
  }

  private async runInstanceInner(
    instance: InstanceRuntimeState,
    flows: FlowProfile[],
    scenario: ScenarioProfile,
    workflowDataSource: ResolvedDataSource | undefined,
    dataSources: Record<string, ResolvedDataSource>,
    dirs: StorageDirs,
    preAcquiredSlot?: BrowserWorkerSlot,
    preAcquiredClaims?: LeaseToken[]
  ): Promise<void> {
    // Shared-eligible? (Phase A5) — decides context-slot vs real browser slot and whether the runner
    // leases from the shared pool.
    const shared = isSharedEligible(instance.config, flows, this.browserPool.concurrencyLimits.useSharedBrowserPool);

    // Browser slot: the queue path pre-acquires one under admission control; the Repeat path
    // waits here (bounded) so re-runs also respect the host browser cap. Shared instances take a
    // non-semaphore context slot (bounded by maxActiveFlows), so they never block on the browser cap.
    let slot = preAcquiredSlot;
    if (!slot) {
      if (shared) {
        slot = this.browserPool.acquireContextSlot(instance.instanceId);
      } else {
        try {
          slot = await this.browserPool.acquireSlot(instance.instanceId, 5 * 60_000);
        } catch (error) {
          const message = error instanceof BrowserPoolSaturatedError ? error.message : String(error);
          this.pool.update(instance.instanceId, {
            status: "failed",
            runtime: { flowRunStatus: "failed", watchdogNote: message }
          });
          return;
        }
      }
    }

    // Origin/account semaphores: the queue path pre-acquires; the Repeat path waits (bounded).
    let claimTokens = preAcquiredClaims;
    if (!claimTokens) {
      const claims = buildDispatchClaims({ baseUrl: instance.config.baseUrl, envFile: instance.config.envFile, flows });
      try {
        claimTokens = claims.length ? await globalResourceLocks.acquireMany(instance.instanceId, claims, { waitTimeoutMs: 5 * 60_000 }) : [];
      } catch (error) {
        this.browserPool.releaseSlot(slot);
        const message = error instanceof Error ? error.message : String(error);
        this.pool.update(instance.instanceId, {
          status: "failed",
          runtime: { flowRunStatus: "failed", watchdogNote: message }
        });
        return;
      }
    }

    // Phase 3: durable cross-process semaphores mirroring the in-memory dispatch claims.
    const durableLeases: DurableLease[] = [];
    const durableLocks = getDurableLockStore();
    if (durableLocks && claimTokens) {
      for (const token of claimTokens) {
        const lease = await durableLocks
          .acquireSemaphore(instance.instanceId, token.key, { reason: token.reason ?? "dispatch claim" })
          .catch(() => null);
        if (lease) durableLeases.push(lease);
        // A saturated durable key (another app instance) is tolerated here: the in-memory claim
        // already throttles this process, and profile safety has its own exclusive durable lock.
      }
    }

    // Phase 3: hard-cancellation source + dynamic origin-claim tracker for this instance.
    const cancelSource = new CancellationTokenSource();
    this.cancellationSources.set(instance.instanceId, cancelSource);
    const limits = this.browserPool.concurrencyLimits;
    const originClaims = new OriginClaimTracker(instance.instanceId, globalResourceLocks, {
      enabled: limits.dynamicOriginClaims,
      timeoutMs: limits.originClaimTimeoutMs,
      durable: durableLocks,
      log: (message) => console.warn(message)
    });
    const seededOrigin = claimTokens?.find((token) => token.key.startsWith("origin:"));
    if (seededOrigin) originClaims.seed(seededOrigin.key.slice("origin:".length), seededOrigin, undefined);

    const runLogger = new RunLogger(instance.paths.logs);
    const machine = new FlowRunStateMachine("queued");
    const attempts = new NodeAttemptLog();
    machine.transition("running", "instance dispatched with browser slot");
    this.patchRuntime(instance.instanceId, { flowRunStatus: machine.status, browserWorkerId: slot.workerId });
    // Reporting: run-summary fields. Queue wait is measured from run enqueue (runStartTimes) to
    // dispatch; near-zero for the first instance, meaningful for later queued/concurrent ones.
    const runStartedAtIso = new Date().toISOString();
    const enqueuedAtIso = this.runStartTimes.get(instance.executionId);
    const queueWaitMs = enqueuedAtIso ? Math.max(0, Date.parse(runStartedAtIso) - Date.parse(enqueuedAtIso)) : undefined;
    this.durableStore.upsertRun({
      instanceId: instance.instanceId,
      executionId: instance.executionId,
      scenarioId: instance.scenarioId,
      scenarioName: scenario.name,
      triggerType: "manual",
      status: "running",
      flowRunStatus: machine.status,
      startedAt: runStartedAtIso,
      queueWaitMs,
      // Observability: pressure state at dispatch (failure-at-pressure correlation, Phase 05).
      pressureStateAtRun: this.adaptive.currentState,
      // Phase B1: stamp the run with its machine context so reports can filter/compare by machine.
      ...this.buildRunMachineContext()
    });
    runLogger.log({
      runId: instance.executionId,
      workflowId: instance.scenarioId,
      workerId: instance.instanceId,
      browserWorkerId: slot.workerId,
      event: "instance.start",
      message: `Instance ${instance.instanceOrderNumber ?? 1}/${instance.totalInstances ?? 1} started.`
    });

    const progress = this.createProgressReporter(instance.instanceId, flows, { runLogger, attempts, instance, slot });

    // Browser Resource Optimization: resolve this instance's browser runtime configuration ONCE from the
    // selected profile (env, default balanced == today's behaviour) + the workflow's static capabilities.
    // The default path yields normal routing, no launch-arg deltas, and today's trace mode.
    const browserConfig = resolveBrowserConfigurationForRun(instance.config, flows, {
      machine: { logicalCpuCount: this.machineRunContext?.logicalCpuCount }
    });
    if (browserConfig.profileMode !== "balanced") {
      runLogger.log({
        runId: instance.executionId,
        workflowId: instance.scenarioId,
        workerId: instance.instanceId,
        event: "browser.profile",
        message: `Browser resource profile resolved:\n${explainResolution(browserConfig).join("\n")}`
      });
    }

    // Shared-browser isolation routing: classify this instance's isolation (SHARED_CONTEXT /
    // DEDICATED_BROWSER / PERSISTENT_BROWSER / HANDOFF_BROWSER). Resolved unconditionally so the run's
    // observability dimension is always recorded; the diagnostic is only LOGGED when the pool is on
    // (keeps the default path quiet), preserving the previous behaviour.
    const isolation = resolveBrowserIsolation(instance.config, flows, {
      sharedPoolEnabled: this.browserPool.concurrencyLimits.useSharedBrowserPool,
      launchArgOverrides: browserConfig.launchArgOverrides
    });
    if (this.browserPool.concurrencyLimits.useSharedBrowserPool) {
      runLogger.log({
        runId: instance.executionId,
        workflowId: instance.scenarioId,
        workerId: instance.instanceId,
        event: "browser.isolation",
        message: `Browser isolation: ${isolation.isolationClass} — ${isolation.diagnostics
          .map((d) => `${d.decision}=${d.value} (${d.source})`)
          .join("; ")}`
      });
    }

    // Observability: begin accumulating this run's environmental resource summary. Registered only now
    // (browser config resolved, about to execute) so a pre-execution throw can't leak an accumulator.
    if (this.observabilityEnabled) this.observations.startRun(instance.instanceId);

    const runner = new PlaywrightRunner({
      resourcesRoot: getResourcesRoot(),
      productionOffline: isProductionOffline(),
      flows,
      progress,
      resourceRouting: browserConfig.resourceRouting,
      launchArgOverrides: browserConfig.launchArgOverrides,
      traceMode: browserConfig.traceMode,
      sessionService: getSessionService(),
      manualHandoffController: this.manualHandoffController,
      onBrowserRuntime: ({ runtime, generation }) => this.browserPool.registerRuntime(slot!, runtime, generation),
      onRuntimeClosing: ({ generation }) => this.browserPool.markExpectedClose(slot!, generation),
      cancellation: cancelSource.token,
      originClaims,
      // Phase A5: only shared-eligible instances lease from the shared Chromium pool.
      sharedBrowserPool: shared ? this.sharedBrowserPool : undefined,
      // Phase A6: stagger expensive operations across every instance.
      operationLimiters: this.operationLimiters
    });

    let runError: string | undefined;
    try {
      const result = await runner.executeScenario(
        scenario,
        {
          executionId: instance.executionId,
          instanceId: instance.instanceId,
          scenarioId: scenario.id,
          instanceOrderNumber: (instance.currentDataRowIndex ?? 0) + 1,
          totalInstances: this.pool.list().length,
          runtimeInputs: instance.runtimeInputs,
          instanceInputs: instance.instanceInputs,
          workflowDataSource,
          dataSources,
          flowOutputs: {},
          secrets: this.resolveSecretsForFlows(flows),
          // Saved browser sessions live in a stable runtime folder, not per-execution.
          // The global runtime root (captured profiles, durable store) is upload-blocked (F-01).
          paths: { ...instance.paths, sessions: join(dirs.root, "sessions"), protectedUploadRoots: [getRuntimeDataRoot()] }
        },
        instance.config
      );
      runError = result.error;

      const current = this.pool.get(instance.instanceId);
      if (current?.status === "cancelled") {
        // The user cancelled while the runner was paused; keep the cancelled state.
        machine.transition("cancelled", "user cancelled during run");
      } else if (result.status === "manualHandoff") {
        machine.transition("waitingForManualAction", "manual / protected-login handoff");
        // Pause for manual / protected-login handoff: surface the detail to the UI; never auto-continue.
        this.pool.update(instance.instanceId, {
          status: "waitingForManualAction",
          manualHandoff: {
            message: result.manualHandoff?.message ?? "Manual action is required before this run can continue.",
            requestedAt: new Date().toISOString(),
            detail: result.manualHandoff
          }
        });
      } else {
        machine.transition(result.status === "passed" ? "completed" : "failed", result.error);
        this.pool.updateStatus(instance.instanceId, result.status === "passed" ? "completed" : "failed");
      }

      const reportService = new ReportService(dirs.reports);
      const instanceReport = reportService.createInstanceReport(result, instance.currentDataRowIndex);
      const reports = this.runReports.get(instance.executionId);
      if (reports) reports.push(instanceReport);

    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
      const errorClass = classifyError(runError);
      const wasCancelled = cancelSource.token.cancelled || this.pool.get(instance.instanceId)?.status === "cancelled";
      machine.transition(wasCancelled ? "cancelled" : errorClass === "browser-crash" ? "crashed" : "failed", runError);
      runLogger.log({
        runId: instance.executionId,
        workerId: instance.instanceId,
        browserWorkerId: slot.workerId,
        event: wasCancelled ? "instance.cancelled" : "instance.error",
        message: runError,
        errorStack: error instanceof Error ? error.stack : undefined,
        data: { errorClass }
      });
      if (errorClass === "browser-crash" && !wasCancelled) this.browserPool.markUnhealthy(slot, runError);
      if (this.pool.get(instance.instanceId)?.status !== "cancelled") {
        this.pool.updateStatus(instance.instanceId, "failed");
      }
    } finally {
      // Cleanup is unconditional: slot back to the pool, dispatch claims (in-memory + durable),
      // origin tracker, and stray profile locks released, state artifacts + log flush before the
      // promise settles.
      this.browserPool.releaseSlot(slot);
      await originClaims.release().catch(() => undefined);
      if (claimTokens?.length) globalResourceLocks.releaseMany(claimTokens);
      for (const lease of durableLeases) await lease.release().catch(() => undefined);
      this.cancellationSources.delete(instance.instanceId);
      if (cancelSource.token.cancelled) {
        this.durableStore.completeCancellation(instance.instanceId, new Date().toISOString());
      }
      const strayLocks = globalProfileLocks.releaseOwner(instance.instanceId);
      if (strayLocks > 0) {
        runLogger.log({
          runId: instance.executionId,
          workerId: instance.instanceId,
          event: "locks.releasedStray",
          message: `Released ${strayLocks} profile lock(s) still held at instance end.`
        });
      }
      this.patchRuntime(instance.instanceId, { flowRunStatus: machine.status });
      const endedAtIso = new Date().toISOString();
      const endErrorClass = runError ? classifyError(runError) : undefined;
      const retryCount = attempts.list().reduce((sum, attempt) => sum + Math.max(0, (attempt.tryNumber ?? 1) - 1), 0);
      // Observability: finalize this run's ENVIRONMENTAL observation summary + record its resolved
      // dimensions. Best-effort; a collector fault leaves the columns NULL and never blocks run finalization.
      const observation = this.finalizeRunObservation(instance.instanceId);
      this.durableStore.upsertRun({
        instanceId: instance.instanceId,
        executionId: instance.executionId,
        status: this.pool.get(instance.instanceId)?.status ?? machine.status,
        flowRunStatus: machine.status,
        endedAt: endedAtIso,
        durationMs: Math.max(0, Date.parse(endedAtIso) - Date.parse(runStartedAtIso)),
        retryCount,
        error: runError,
        errorClass: endErrorClass,
        reportCategory: runError ? toReportCategory(endErrorClass) : undefined,
        // Phase B1: the peak simultaneous instance count observed for this run (reporting).
        observedPeakConcurrency: this.executionPeakConcurrency.get(instance.executionId),
        // Observability run dimensions + environmental summary (migration v4).
        headed: resolveHeaded(instance.config),
        resourceProfile: browserConfig.profileMode,
        isolationClass: isolation.isolationClass,
        workloadWeight: this.instanceWeights.get(instance.instanceId) ?? this.instanceWeight(instance, flows),
        ...observation
      });
      // Observability: deterministic anomaly + regression detection for this finalized run (Phase 06).
      this.runAnomalyChecks(instance.instanceId, instance.scenarioId);
      void this.durableStore.persistNow();
      runLogger.log({
        runId: instance.executionId,
        workerId: instance.instanceId,
        event: "instance.end",
        message: `Instance finished with state ${machine.status}.`,
        data: { flowRunStatus: machine.status }
      });

      const list = this.pool.list();
      const endCapacity = this.backpressure.snapshot(
        list.filter((i) => ["starting", "running"].includes(i.status)).length,
        list.filter((i) => ["queued", "pending"].includes(i.status)).length
      );
      this.durableStore.recordCapacitySnapshot(endCapacity);
      const artifactError = await writeRunStateArtifacts(join(instance.paths.storage, "state"), {
        runId: instance.executionId,
        instanceId: instance.instanceId,
        scenarioId: instance.scenarioId,
        flowRunStatus: machine.status,
        transitions: machine.transitions,
        nodeAttempts: attempts.list(),
        capacity: endCapacity,
        locks: globalResourceLocks.snapshot(),
        error: runError
      });
      if (artifactError) {
        runLogger.log({ runId: instance.executionId, workerId: instance.instanceId, event: "artifacts.writeFailed", message: artifactError });
      }
      await runLogger.flush();
    }
  }

  /** Map an in-memory NodeAttempt to its durable row. */
  private toDurableAttempt(attempt: NodeAttempt, instanceId: string) {
    return {
      attemptId: `${instanceId}:${attempt.attemptId}`,
      instanceId,
      executionId: attempt.runId,
      flowId: attempt.flowId,
      nodeId: attempt.nodeId,
      tryNumber: attempt.tryNumber,
      status: attempt.status,
      sideEffectLevel: attempt.sideEffectLevel,
      startedAt: attempt.startedAt,
      completedAt: attempt.completedAt,
      durationMs: attempt.durationMs,
      currentUrl: attempt.currentUrl,
      error: attempt.error,
      errorClass: attempt.errorClass,
      tracePath: attempt.tracePath,
      screenshotPath: attempt.screenshotPath
    };
  }

  /** Merge-patch the instance's concurrency-runtime detail (heartbeat, worker id, watchdog note). */
  private patchRuntime(instanceId: string, patch: Partial<NonNullable<InstanceRuntimeState["runtime"]>>): void {
    try {
      const current = this.pool.get(instanceId);
      if (!current) return;
      this.pool.update(instanceId, {
        runtime: { flowRunStatus: current.runtime?.flowRunStatus ?? "running", ...current.runtime, ...patch }
      });
    } catch {
      // Instance removed mid-run; ignore.
    }
  }

  /**
   * Builds a live-progress reporter bound to one instance. It folds per-step events into a bounded
   * snapshot on the instance runtime state so the renderer's existing 1s poll surfaces true live
   * per-flow/per-step progress before the final report is written. No secrets are stored.
   */
  private createProgressReporter(
    instanceId: string,
    flows: FlowProfile[],
    extras?: {
      runLogger: RunLogger;
      attempts: NodeAttemptLog;
      instance: InstanceRuntimeState;
      slot: BrowserWorkerSlot;
    }
  ): RunnerProgressReporter {
    const flowNameById = new Map(flows.map((flow) => [flow.id, flow.name]));
    const snapshot: LiveExecutionSnapshot = { updatedAt: new Date().toISOString(), steps: [], events: [] };
    /** Open (still-running) attempt per flow/step key, so retries create explicit new attempts. */
    const openAttempts = new Map<string, NodeAttempt>();

    return {
      report: (event: RunnerProgressEvent) => {
        const now = event.timestamp;

        // ── Concurrency layer: heartbeat + JSONL log + node attempts ──────────
        if (extras) {
          this.patchRuntime(instanceId, { heartbeatAt: now });
          this.durableStore.recordHeartbeat({
            instanceId,
            executionId: extras.instance.executionId,
            nodeId: event.stepId,
            browserWorkerId: extras.slot.workerId,
            currentUrl: event.currentUrl,
            status: event.status,
            timestamp: now
          });

          if (event.stepId) {
            const key = `${event.flowId ?? ""}:${event.stepId}`;
            const open = openAttempts.get(key);
            if (event.status === "running") {
              if (open) {
                extras.attempts.heartbeat(open);
              } else {
                const attempt = extras.attempts.start({
                  runId: extras.instance.executionId,
                  flowId: event.flowId,
                  nodeId: event.stepId,
                  tryNumber: (event.retryCount ?? 0) + 1,
                  workerId: instanceId,
                  browserWorkerId: extras.slot.workerId,
                  sideEffectLevel: event.sideEffectLevel
                });
                openAttempts.set(key, attempt);
                this.durableStore.recordAttempt(this.toDurableAttempt(attempt, instanceId));
              }
            } else if (["succeeded", "failed", "skipped", "cancelled"].includes(event.status) && open) {
              const errorClass = event.error ? classifyError(event.error, event.stepType) : undefined;
              extras.attempts.finish(
                open,
                event.status === "succeeded"
                  ? "succeeded"
                  : event.status === "skipped"
                    ? "skipped"
                    : errorClass && RETRYABLE_ERROR_CLASSES.has(errorClass)
                      ? "failedRetryable"
                      : "failedTerminal",
                { error: event.error, errorClass, durationMs: event.durationMs, tracePath: event.tracePath, currentUrl: event.currentUrl }
              );
              this.durableStore.recordAttempt(this.toDurableAttempt(open, instanceId));
              if (event.tracePath) {
                this.durableStore.recordArtifact({
                  instanceId,
                  executionId: extras.instance.executionId,
                  nodeId: event.stepId,
                  attemptId: open.attemptId,
                  kind: "trace",
                  path: event.tracePath,
                  createdAt: now
                });
              }
              openAttempts.delete(key);
            }
          }

          extras.runLogger.log({
            runId: extras.instance.executionId,
            workflowId: extras.instance.scenarioId,
            flowId: event.flowId,
            nodeId: event.stepId,
            workerId: instanceId,
            browserWorkerId: extras.slot.workerId,
            event: `step.${event.status}`,
            message: event.message ?? (event.stepLabel ? `${event.stepLabel} ${event.status}` : undefined),
            errorStack: event.error,
            data: event.retryCount != null ? { retryCount: event.retryCount } : undefined
          });
        }
        snapshot.updatedAt = now;
        const flowLabel = event.flowId ? flowNameById.get(event.flowId) ?? event.flowId : undefined;
        if (event.flowId) {
          snapshot.currentFlowId = event.flowId;
          snapshot.currentFlowLabel = flowLabel;
        }
        if (event.stepId) {
          snapshot.currentStepId = event.stepId;
          snapshot.currentStepLabel = event.stepLabel;
          snapshot.currentStatus = event.status;
        }

        if (event.stepId) {
          const existing = snapshot.steps.find((step) => step.stepId === event.stepId && step.flowId === event.flowId);
          if (existing) {
            existing.status = event.status;
            if (event.status !== "running") existing.endedAt = now;
            if (event.durationMs != null) existing.durationMs = event.durationMs;
            if (event.error) existing.error = event.error;
            if (event.retryCount != null) existing.retryCount = event.retryCount;
          } else {
            snapshot.steps.push({
              flowId: event.flowId,
              flowLabel,
              stepId: event.stepId,
              stepLabel: event.stepLabel,
              stepType: event.stepType,
              status: event.status,
              startedAt: now,
              durationMs: event.durationMs,
              error: event.error,
              retryCount: event.retryCount
            });
            if (snapshot.steps.length > LIVE_PROGRESS_MAX_STEPS) snapshot.steps.splice(0, snapshot.steps.length - LIVE_PROGRESS_MAX_STEPS);
          }
        }

        // Append a human-readable event (skip duplicate consecutive "running" lines for the same step).
        const last = snapshot.events[snapshot.events.length - 1];
        if (event.status !== "running" || !last || last.stepId !== event.stepId) {
          const level: LiveEventSnapshot["level"] =
            event.status === "failed" ? "error" : event.status === "succeeded" ? "success" : event.status === "waitingForManualAction" || event.status === "waiting" ? "warning" : "info";
          snapshot.events.push({ timestamp: now, level, message: event.message ?? `${event.stepLabel ?? event.stepId ?? "Step"} ${event.status}`, stepId: event.stepId });
          if (snapshot.events.length > LIVE_PROGRESS_MAX_EVENTS) snapshot.events.splice(0, snapshot.events.length - LIVE_PROGRESS_MAX_EVENTS);
        }

      if (event.error) snapshot.errorSummary = event.error;

        try {
          const current = this.pool.get(instanceId);
          const statusPatch =
            event.status === "waitingForManualAction"
              ? {
                  status: "waitingForManualAction" as const,
                  manualHandoff: {
                    message: event.manualHandoff?.message ?? event.message ?? "Manual action is required before this run can continue.",
                    requestedAt: event.timestamp,
                    detail: event.manualHandoff
                  }
                }
              : current?.status === "waitingForManualAction" && ["running", "succeeded"].includes(event.status)
                ? { status: "running" as const, manualHandoff: undefined }
                : {};
          this.pool.update(instanceId, {
            // Fresh copies so the renderer sees a new reference each tick.
            ...statusPatch,
            liveProgress: { ...snapshot, steps: snapshot.steps.map((step) => ({ ...step })), events: snapshot.events.map((entry) => ({ ...entry })) },
            currentFlow: flowLabel ?? snapshot.currentFlowLabel,
            currentStep: event.stepLabel ?? snapshot.currentStepLabel
          });
        } catch {
          // Instance may have been removed mid-run; ignore.
        }
      }
    };
  }

  public pauseInstance(instanceId: string): void {
    if (instanceId === "all") {
      this.pool.list().forEach(i => {
        if (["starting", "running"].includes(i.status)) {
          this.pool.updateStatus(i.instanceId, "paused");
        }
      });
    } else {
      this.pool.updateStatus(instanceId, "paused");
    }
  }

  public resumeInstance(instanceId: string): void {
    if (instanceId === "all") {
      this.pool.list().forEach(i => {
        if (i.status === "waitingForManualAction") {
          this.manualHandoffController.resume(i.executionId, i.instanceId);
          this.pool.update(i.instanceId, { status: "running", manualHandoff: undefined });
          this.patchRuntime(i.instanceId, { heartbeatAt: new Date().toISOString() });
        } else if (i.status === "paused") {
          this.pool.updateStatus(i.instanceId, "running");
          this.patchRuntime(i.instanceId, { heartbeatAt: new Date().toISOString() });
        }
      });
    } else {
      const instance = this.pool.get(instanceId);
      if (instance?.status === "waitingForManualAction") {
        this.manualHandoffController.resume(instance.executionId, instance.instanceId);
        this.pool.update(instanceId, { status: "running", manualHandoff: undefined });
      } else {
        this.pool.updateStatus(instanceId, "running");
      }
      // Fresh heartbeat on resume so the watchdog doesn't see handoff idle time as a stall.
      this.patchRuntime(instanceId, { heartbeatAt: new Date().toISOString() });
    }
  }

  public retryHandoff(instanceId: string): void {
    const instance = this.pool.get(instanceId);
    if (!instance) throw new Error(`Instance ${instanceId} not found.`);
    if (instance.status !== "waitingForManualAction") {
      throw new Error(`Instance ${instanceId} is not waiting for manual action.`);
    }
    this.manualHandoffController.retry(instance.executionId, instance.instanceId);
    this.pool.update(instanceId, { status: "running", manualHandoff: undefined });
    this.patchRuntime(instanceId, { heartbeatAt: new Date().toISOString() });
  }

  public stopInstance(instanceId: string): void {
    if (instanceId === "all") {
      this.pool.list().forEach(i => {
        if (!["completed", "failed", "cancelled"].includes(i.status)) {
          this.cancelOne(i.instanceId, "stop all requested");
        }
      });
    } else {
      this.cancelOne(instanceId, "user requested stop");
    }
  }

  /**
   * Hard cancellation (Phase 3): record the request durably, mark the instance cancelled, wake
   * any manual-handoff wait, then fire the cancellation token — its handler closes the live
   * browser runtime so in-flight Playwright work rejects immediately instead of running on.
   */
  private cancelOne(instanceId: string, reason: string): void {
    const instance = this.pool.get(instanceId);
    if (!instance) return;
    if (["completed", "failed", "cancelled"].includes(instance.status) && !this.activeInstanceRunners.has(instanceId)) {
      this.pool.updateStatus(instanceId, "cancelled");
      return;
    }

    this.durableStore.recordCancellation({
      instanceId,
      executionId: instance.executionId,
      requestedAt: new Date().toISOString(),
      reason,
      source: "ui"
    });
    if (instance.status === "waitingForManualAction") {
      this.manualHandoffController.cancel(instance.executionId, instance.instanceId);
    }
    this.pool.updateStatus(instanceId, "cancelled");
    this.patchRuntime(instanceId, { flowRunStatus: "cancelling", watchdogNote: `cancellation requested: ${reason}` });
    const source = this.cancellationSources.get(instanceId);
    if (source) {
      void source.cancel(reason);
      console.warn(`[cancel] instance ${instanceId}: ${reason} — closing live browser work.`);
    }
  }

  public stopAll(): void {
    this.stopInstance("all");
  }

  /** Re-run a single finished instance using its original run context. */
  public repeatInstance(instanceId: string): void {
    const instance = this.pool.get(instanceId);
    if (!instance) throw new Error(`Instance ${instanceId} not found.`);
    if (["starting", "running", "paused", "pending", "queued"].includes(instance.status)) {
      throw new Error(`Cannot repeat instance ${instanceId} because it is still active.`);
    }
    const context = this.runContexts.get(instance.executionId);
    if (!context) {
      throw new Error(`Run context for instance ${instanceId} is no longer available (re-run the workflow).`);
    }

    // Reset terminal state and re-execute just this instance (bypassing the queue).
    this.watchdog.clearInstance(instanceId);
    this.pool.update(instanceId, {
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: undefined,
      durationMs: 0,
      currentFlow: undefined,
      currentStep: undefined,
      retryAttempt: (instance.retryAttempt ?? 0) + 1,
      runtime: { flowRunStatus: "queued" }
    });
    const fresh = this.pool.get(instanceId);
    if (!fresh) return;
    void this.runInstance(fresh, context.flows, context.scenario, context.workflowDataSource, context.dataSources, context.dirs).catch(
      console.error
    );
  }
}

/** Observability bucket width from env (AWKIT_OBSERVABILITY_BUCKET_MS), clamped to [5s, 5min]; default 30s. */
function observationBucketMsFromEnv(): number {
  const raw = process.env.AWKIT_OBSERVABILITY_BUCKET_MS;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return 30_000;
  return Math.min(300_000, Math.max(5_000, parsed));
}

/** Resolve the run's headed dimension from its config (headless === false → headed; undefined when unknown). */
function resolveHeaded(config: { headless?: boolean } | undefined): boolean | undefined {
  if (config?.headless === true) return false;
  if (config?.headless === false) return true;
  return undefined;
}

/** Node heap used (MB); best-effort, undefined if unavailable. */
function safeHeapUsedMb(): number | undefined {
  try {
    return Math.round(process.memoryUsage().heapUsed / (1024 * 1024));
  } catch {
    return undefined;
  }
}

export const executionEngine = new ExecutionEngine();
