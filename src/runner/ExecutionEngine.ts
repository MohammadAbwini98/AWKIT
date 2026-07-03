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
import { getResourcesRoot, isProductionOffline } from "../../app/main/appPaths";
import { getSessionService } from "../../app/main/ipc/session.ipc";
import type { FlowProfile } from "../profiles/FlowProfile";
import type { ScenarioProfile } from "../profiles/ScenarioProfile";
import type { ResolvedDataSource } from "./InstanceExecutionContext";
import { ReportService } from "../reports/ReportService";
import type { InstanceReport } from "../reports/ExecutionReport";
import { createReportStore } from "../../app/main/profileStores";

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

  public getInstances(): InstanceRuntimeState[] {
    return this.pool.list();
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

    runPromise.finally(() => {
      this.activeRuns.delete(executionId);
      this.runReports.delete(executionId);
      this.runStartTimes.delete(executionId);
    });
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
        break;
      }

      const promoted = this.coordinator.promoteQueued(currentList, profile.maxConcurrentInstances);
      promoted.forEach(i => {
        if (i.status === "pending" && this.pool.get(i.instanceId)?.status === "queued") {
          this.pool.update(i.instanceId, { status: "pending", queuePosition: undefined });
        }
      });

      const updatedList = this.pool.list().filter((i) => i.executionId === executionId);
      const started = this.coordinator.startPending(updatedList, profile.maxConcurrentInstances);
      const newlyStarted = started.filter(i => i.status === "running" && this.pool.get(i.instanceId)?.status === "pending");

      for (const instance of newlyStarted) {
        this.pool.update(instance.instanceId, {
          status: "running",
          startedAt: instance.startedAt,
          currentFlow: instance.currentFlow,
          currentStep: instance.currentStep
        });

        this.runInstance(instance, flows, scenario, workflowDataSource, dataSources, dirs).catch(console.error);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private async runInstance(
    instance: InstanceRuntimeState,
    flows: FlowProfile[],
    scenario: ScenarioProfile,
    workflowDataSource: ResolvedDataSource | undefined,
    dataSources: Record<string, ResolvedDataSource>,
    dirs: StorageDirs
  ): Promise<void> {
    const progress = this.createProgressReporter(instance.instanceId, flows);
    const runner = new PlaywrightRunner({
      resourcesRoot: getResourcesRoot(),
      productionOffline: isProductionOffline(),
      flows,
      progress,
      sessionService: getSessionService(),
      manualHandoffController: this.manualHandoffController
    });

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
          // Saved browser sessions live in a stable runtime folder, not per-execution.
          paths: { ...instance.paths, sessions: join(dirs.root, "sessions") }
        },
        instance.config
      );

      const current = this.pool.get(instance.instanceId);
      if (current?.status === "cancelled") {
        // The user cancelled while the runner was paused; keep the cancelled state.
      } else if (result.status === "manualHandoff") {
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
        this.pool.updateStatus(instance.instanceId, result.status === "passed" ? "completed" : "failed");
      }

      const reportService = new ReportService(dirs.reports);
      const instanceReport = reportService.createInstanceReport(result, instance.currentDataRowIndex);
      const reports = this.runReports.get(instance.executionId);
      if (reports) reports.push(instanceReport);
      
    } catch (error) {
      if (this.pool.get(instance.instanceId)?.status !== "cancelled") {
        this.pool.updateStatus(instance.instanceId, "failed");
      }
    }
  }

  /**
   * Builds a live-progress reporter bound to one instance. It folds per-step events into a bounded
   * snapshot on the instance runtime state so the renderer's existing 1s poll surfaces true live
   * per-flow/per-step progress before the final report is written. No secrets are stored.
   */
  private createProgressReporter(instanceId: string, flows: FlowProfile[]): RunnerProgressReporter {
    const flowNameById = new Map(flows.map((flow) => [flow.id, flow.name]));
    const snapshot: LiveExecutionSnapshot = { updatedAt: new Date().toISOString(), steps: [], events: [] };

    return {
      report: (event: RunnerProgressEvent) => {
        const now = event.timestamp;
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
        } else if (i.status === "paused") {
          this.pool.updateStatus(i.instanceId, "running");
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
  }

  public stopInstance(instanceId: string): void {
    if (instanceId === "all") {
      this.pool.list().forEach(i => {
        if (!["completed", "failed", "cancelled"].includes(i.status)) {
          if (i.status === "waitingForManualAction") {
            this.manualHandoffController.cancel(i.executionId, i.instanceId);
          }
          this.pool.updateStatus(i.instanceId, "cancelled");
        }
      });
    } else {
      const instance = this.pool.get(instanceId);
      if (instance?.status === "waitingForManualAction") {
        this.manualHandoffController.cancel(instance.executionId, instance.instanceId);
      }
      this.pool.updateStatus(instanceId, "cancelled");
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
    this.pool.update(instanceId, {
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: undefined,
      durationMs: 0,
      currentFlow: undefined,
      currentStep: undefined,
      retryAttempt: (instance.retryAttempt ?? 0) + 1
    });
    const fresh = this.pool.get(instanceId);
    if (!fresh) return;
    void this.runInstance(fresh, context.flows, context.scenario, context.workflowDataSource, context.dataSources, context.dirs).catch(
      console.error
    );
  }
}

export const executionEngine = new ExecutionEngine();
