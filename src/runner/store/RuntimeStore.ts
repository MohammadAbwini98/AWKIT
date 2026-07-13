/**
 * Durable runtime store interface. The engine writes run/attempt/heartbeat/cancellation/
 * watchdog/artifact/capacity records through this so state survives an Electron exit or crash.
 * `SqliteRuntimeStore` is the real implementation; `NullRuntimeStore` keeps everything a no-op
 * for callers (and tests) that don't want durability.
 */
import type { CapacitySnapshot } from "../concurrency/CapacitySnapshot";
import type {
  FailureBreakdown,
  MachineFilter,
  MachineSummary,
  RunHistoryFilter,
  RunHistoryPage,
  RuntimeSeriesPoint,
  TelemetryOverview,
  TelemetryPage,
  TelemetryRange,
  WorkflowComparisonRow,
  WorkflowReportRow,
  WorkflowTrend
} from "@src/reports/TelemetryContracts";
import type {
  DurableArtifactRecord,
  DurableAttemptRecord,
  DurableCancellationRecord,
  DurableProcessSampleRecord,
  DurableRunRecord
} from "./RuntimeStoreSchema";

export interface RuntimeStore {
  /** Insert-or-update the run row (partial patch; instanceId/executionId identify it). */
  upsertRun(record: Partial<DurableRunRecord> & { instanceId: string; executionId: string }): void;
  /** Insert-or-replace a node attempt row. */
  recordAttempt(attempt: DurableAttemptRecord): void;
  recordHeartbeat(heartbeat: { instanceId: string; executionId: string; nodeId?: string; browserWorkerId?: string; currentUrl?: string; status?: string; timestamp: string }): void;
  recordCancellation(record: DurableCancellationRecord): void;
  completeCancellation(instanceId: string, completedAt: string): void;
  recordWatchdogEvent(event: { instanceId?: string; kind: string; reason?: string; at: string }): void;
  recordArtifact(artifact: { instanceId: string; executionId: string; nodeId?: string; attemptId?: string; kind: string; path: string; createdAt: string }): void;
  recordCapacitySnapshot(snapshot: CapacitySnapshot): void;
  /** Chrome/host consumption sample (reporting; migration v2). */
  recordProcessSample(sample: DurableProcessSampleRecord): void;
  listProcessSamples(sinceIso?: string, limit?: number): DurableProcessSampleRecord[];
  /** Bounded reporting retention (DB rows only; never user artifacts). */
  sweepRetention(opts?: { retentionHours?: number; retentionRuns?: number }): void;

  // ── Reporting queries (read-only, windowed; aggregation done in the store) ──
  queryOverview(range: TelemetryRange): TelemetryOverview;
  queryWorkflows(range: TelemetryRange): WorkflowReportRow[];
  /** Per-workflow current-vs-previous-window comparison (machine-aware). */
  queryWorkflowComparison(range: TelemetryRange, machineFilter?: MachineFilter): WorkflowComparisonRow[];
  /** Run-over-run trend for one workflow split into `buckets` time buckets. */
  queryWorkflowTrend(scenarioId: string | undefined, range: TelemetryRange, buckets: number, machineFilter?: MachineFilter): WorkflowTrend;
  /** Distinct machines seen in run history within range (reports machine filter). */
  listRunMachines(range?: TelemetryRange): MachineSummary[];
  queryRunHistory(range: TelemetryRange, page: TelemetryPage, filter?: RunHistoryFilter): RunHistoryPage;
  queryFailures(range: TelemetryRange): FailureBreakdown;
  queryRuntimeSeries(range: TelemetryRange, bucketMs: number): RuntimeSeriesPoint[];

  /** Runs that looked active (running/waiting/etc.) under a DIFFERENT app instance. */
  findInterruptedRuns(currentAppInstanceId: string): DurableRunRecord[];
  /** Recovery verdict for an interrupted run (orphaned/recoverable/cancelled/failed + note). */
  markRunRecovery(instanceId: string, patch: { status: string; recoverable: boolean; recoveryNote: string }): void;
  listRuns(limit?: number): DurableRunRecord[];
  listAttempts(instanceId: string): DurableAttemptRecord[];
  /** Recorded artifact paths for a run (traces/screenshots/logs) — recovery inspection. */
  listArtifacts(instanceId: string): DurableArtifactRecord[];

  /** Flush pending writes to disk (atomic). */
  persistNow(): Promise<void>;
  close(): Promise<void>;
}

/** No-op store: durability disabled (tests, or AWKIT_DURABLE_STORE=0). */
export class NullRuntimeStore implements RuntimeStore {
  upsertRun(): void {}
  recordAttempt(): void {}
  recordHeartbeat(): void {}
  recordCancellation(): void {}
  completeCancellation(): void {}
  recordWatchdogEvent(): void {}
  recordArtifact(): void {}
  recordCapacitySnapshot(): void {}
  recordProcessSample(): void {}
  listProcessSamples(): DurableProcessSampleRecord[] {
    return [];
  }
  sweepRetention(): void {}
  queryOverview(): TelemetryOverview {
    return {
      storeEnabled: false,
      totalRuns: 0,
      successRuns: 0,
      failedRuns: 0,
      cancelledRuns: 0,
      otherRuns: 0,
      successRate: 0,
      failureRate: 0,
      duration: {},
      runsSeries: []
    };
  }
  queryWorkflows(): WorkflowReportRow[] {
    return [];
  }
  queryWorkflowComparison(): WorkflowComparisonRow[] {
    return [];
  }
  queryWorkflowTrend(scenarioId: string | undefined): WorkflowTrend {
    return { scenarioId, scenarioName: undefined, points: [] };
  }
  listRunMachines(): MachineSummary[] {
    return [];
  }
  queryRunHistory(_range: TelemetryRange, page: TelemetryPage): RunHistoryPage {
    return { rows: [], total: 0, limit: page.limit ?? 50, offset: page.offset ?? 0 };
  }
  queryFailures(): FailureBreakdown {
    return { total: 0, categories: [], topWorkflows: [] };
  }
  queryRuntimeSeries(): RuntimeSeriesPoint[] {
    return [];
  }
  findInterruptedRuns(): DurableRunRecord[] {
    return [];
  }
  markRunRecovery(): void {}
  listRuns(): DurableRunRecord[] {
    return [];
  }
  listAttempts(): DurableAttemptRecord[] {
    return [];
  }
  listArtifacts(): DurableArtifactRecord[] {
    return [];
  }
  async persistNow(): Promise<void> {}
  async close(): Promise<void> {}
}
