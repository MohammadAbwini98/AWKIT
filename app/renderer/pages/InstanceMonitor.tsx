import { Activity, ChevronDown, FileImage, MonitorDot, Pause, Play, RefreshCw, RotateCcw, Search, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePageChrome } from "../state/pageChrome";
import { WorkflowRunCard, type WorkflowCardParams, type WorkflowCardStatus } from "../components/instances/WorkflowRunCard";
import { RecoverableRunsPanel } from "../components/instances/RecoverableRunsPanel";
import { ProtectedLoginHandoffPanel, type ProtectedLoginCapabilities } from "../components/auth/ProtectedLoginHandoffPanel";
import { LiveExecutionReportModal } from "../components/instances/LiveExecutionReportModal";
import {
  filterWorkflows,
  resolveWorkflowName,
  validateCardParams as validateCardParamsPure,
  visibleCardCount as computeVisibleCardCount
} from "@src/instances/instanceCardLogic";
import { ConcurrentExecutionCoordinator } from "@src/orchestrator/ConcurrentExecutionCoordinator";
import { ScenarioOrchestrator } from "@src/orchestrator/ScenarioOrchestrator";
import type { BrowserWindowMode, ConcurrentRunProfile } from "@src/instances/ConcurrentRunProfile";
import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";
import type { InstanceIsolationMode } from "@src/instances/InstanceIsolationMode";
import type { InstanceStatus } from "@src/instances/InstanceStatus";
import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";
import { workflowToScenarioProfile, type WorkflowProfile } from "@src/profiles/WorkflowProfile";

const coordinator = new ConcurrentExecutionCoordinator();
const orchestrator = new ScenarioOrchestrator();

// Workflow cards grid: always render every card, but cap the grid at two rows tall and let it
// scroll internally once the cards overflow that height (no "Load More" paging).
const MAX_CARD_ROWS = 2;

/** Measure how many columns the CSS grid currently renders (responsive two-row-cap math). */
function useGridColumns(ref: React.RefObject<HTMLElement>): number {
  const [columns, setColumns] = useState(1);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const template = getComputedStyle(element).gridTemplateColumns;
      const count = template.split(" ").filter((part) => part && part !== "0px").length;
      setColumns((current) => (count > 0 && count !== current ? count : current));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return columns;
}

const baseRunProfile: ConcurrentRunProfile = {
  id: "batch-run",
  scenarioId: "",
  runMode: "dataDrivenConcurrent",
  maxConcurrentInstances: 3,
  browserWindowMode: "headless",
  dataSource: {
    id: "",
    name: "",
    type: "jsonArray",
    file: "",
    path: "$.rows",
    rowCount: 0,
    sampleRow: {}
  },
  instanceTemplate: {
    browser: "chromium",
    headless: true,
    isolationMode: "browserContext",
    timeoutMs: 30000,
    viewport: { width: 1440, height: 900 }
  },
  resourceControls: {
    maxBrowserContextsPerProcess: 5,
    delayBetweenInstanceStartsMs: 250
  },
  failurePolicy: {
    stopAllOnCriticalFailure: false,
    continueOtherInstancesOnFailure: true,
    retryFailedInstance: true,
    retryCount: 1
  }
};

export function InstanceMonitor() {
  const [workflows, setWorkflows] = useState<WorkflowProfile[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState("");
  const [maxParallel, setMaxParallel] = useState(3);
  const [runCount, setRunCount] = useState(5);
  const [startDelayMs, setStartDelayMs] = useState(250);
  const [isolationMode, setIsolationMode] = useState<InstanceIsolationMode>("browserContext");
  const [browserWindowMode, setBrowserWindowMode] = useState<BrowserWindowMode>("headless");
  const [runMessage, setRunMessage] = useState("");
  const [dataSourceNames, setDataSourceNames] = useState<Record<string, string>>({});
  const [dataSourceRecords, setDataSourceRecords] = useState<number | null>(null);

  // Phase 03 fix: start with EMPTY instances — no dummy/demo data
  const [instances, setInstances] = useState<InstanceRuntimeState[]>([]);

  // ── Workflow cards grid (primary run UX) ─────────────────────────────────────
  const [execDefaults, setExecDefaults] = useState({
    maxRuns: 100,
    maxConcurrentRuns: 10,
    defaultRuns: 5,
    defaultConcurrentRuns: 3,
    defaultRunMode: "headless" as "headed" | "headless",
    screenshotOnFailure: true,
    stopOnError: false
  });
  const [cardParams, setCardParams] = useState<Record<string, WorkflowCardParams>>({});
  const [cardSearch, setCardSearch] = useState("");
  // Every card is always rendered; once the cards exceed two rows the grid becomes an internal
  // scroller constrained to the measured two-row height (below) so the rest of the page stays put.
  const [gridScrollHeight, setGridScrollHeight] = useState<number | null>(null);
  const [classicOpen, setClassicOpen] = useState(false);
  const [authCaps, setAuthCaps] = useState<ProtectedLoginCapabilities | null>(null);
  const [reportInstanceId, setReportInstanceId] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusSnapshot | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const gridColumns = useGridColumns(gridRef);

  useEffect(() => {
    Promise.all([
      window.playwrightFlowStudio.workflows.list(),
      window.playwrightFlowStudio.settings.get(),
      window.playwrightFlowStudio.dataSources.list()
    ])
      .then(([savedWorkflows, settings, savedDataSources]) => {
        setWorkflows(savedWorkflows);
        setDataSourceNames(Object.fromEntries(savedDataSources.map((source) => [source.id, source.name])));
        setExecDefaults(settings.execution);
        // Seed each workflow's card params from persisted per-card values, else Settings defaults.
        const seeded: Record<string, WorkflowCardParams> = {};
        for (const workflow of savedWorkflows) {
          const saved = settings.workflowRunCards?.[workflow.id];
          seeded[workflow.id] = saved ?? {
            totalRuns: settings.execution.defaultRuns,
            concurrentInstances: settings.execution.defaultConcurrentRuns,
            runMode: settings.execution.defaultRunMode,
            isolationMode: "browserContext",
            screenshotOnFailure: settings.execution.screenshotOnFailure,
            stopOnError: settings.execution.stopOnError
          };
        }
        setCardParams(seeded);

        const workflowId = settings.instanceRunSettings.workflowId || savedWorkflows[0]?.id || "";
        setSelectedWorkflowId(workflowId);
        // First run (no saved last-run): seed the classic form from the Settings execution
        // defaults so the Settings screen drives Run defaults. Otherwise restore the
        // user's last run values.
        const hasLastRun = !!settings.instanceRunSettings.workflowId;
        const runMode = hasLastRun ? settings.instanceRunSettings.browserMode : settings.execution.defaultRunMode;
        setRunCount(hasLastRun ? settings.instanceRunSettings.totalRuns : settings.execution.defaultRuns);
        setMaxParallel(hasLastRun ? settings.instanceRunSettings.maxConcurrentInstances : settings.execution.defaultConcurrentRuns);
        setBrowserWindowMode(runMode === "headless" ? "headless" : "activeOnly");
        setStartDelayMs(settings.instanceRunSettings.delayBetweenStartsMs);
      })
      .catch(() => setRunMessage("Unable to load saved workflows."));

    // Protected-login handoff capabilities (OAuth/saved/test-session) for disabled-with-reason UI.
    window.playwrightFlowStudio.auth
      .getCapabilities()
      .then((caps) => setAuthCaps(caps))
      .catch(() => undefined);
  }, []);

  const openOAuthHandoff = async (provider: string) => {
    setRunMessage("Opening OAuth in your system browser…");
    try {
      const result = await window.playwrightFlowStudio.auth.openOAuth(provider);
      if (!result.success) setRunMessage(result.error ?? "OAuth is not available.");
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : "OAuth request failed.");
    }
  };

  useEffect(() => {
    const fetchInstances = () => {
      window.playwrightFlowStudio.executions.list().then((list) => {
        const now = Date.now();
        const updated = (list as InstanceRuntimeState[]).map(instance => {
          if (["starting", "running", "paused"].includes(instance.status) && instance.startedAt) {
            return { ...instance, durationMs: now - new Date(instance.startedAt).getTime() };
          }
          if (["completed", "failed", "cancelled"].includes(instance.status) && instance.startedAt && instance.endedAt) {
            return { ...instance, durationMs: new Date(instance.endedAt).getTime() - new Date(instance.startedAt).getTime() };
          }
          return instance;
        });
        setInstances(updated);
      }).catch(() => undefined);
    };

    const interval = setInterval(fetchInstances, 1000);
    fetchInstances(); // Initial fetch
    return () => clearInterval(interval);
  }, []);

  // Concurrency runtime status (capacity / locks / pool / watchdog) — lighter 2s poll.
  const refreshRuntimeStatus = useCallback(() => {
    window.playwrightFlowStudio.executions
      .runtimeStatus()
      .then(setRuntimeStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshRuntimeStatus, 2000);
    refreshRuntimeStatus();
    return () => clearInterval(interval);
  }, [refreshRuntimeStatus]);

  const selectedWorkflow = useMemo(() => workflows.find((workflow) => workflow.id === selectedWorkflowId), [workflows, selectedWorkflowId]);
  const workflowDataSource = selectedWorkflow?.dataSource;

  useEffect(() => {
    if (!workflowDataSource?.dataSourceId) {
      setDataSourceRecords(null);
      return;
    }
    window.playwrightFlowStudio.dataSources
      .preview(workflowDataSource.dataSourceId, workflowDataSource.rootArrayPath)
      .then((preview) => {
        const result = preview as { selected?: unknown; rows?: unknown[] };
        const rows = Array.isArray(result.selected) ? result.selected : result.rows ?? [];
        setDataSourceRecords(rows.length);
      })
      .catch(() => setDataSourceRecords(null));
  }, [workflowDataSource?.dataSourceId, workflowDataSource?.rootArrayPath]);

  useEffect(() => {
    window.playwrightFlowStudio.settings
      .update({
        instanceRunSettings: {
          workflowId: selectedWorkflowId,
          totalRuns: runCount,
          maxConcurrentInstances: maxParallel,
          browserMode: browserWindowMode === "headless" ? "headless" : "headed",
          delayBetweenStartsMs: startDelayMs
        }
      })
      .catch(() => undefined);
  }, [browserWindowMode, maxParallel, runCount, selectedWorkflowId, startDelayMs]);

  const counts = useMemo(
    () => ({
      active: instances.filter((instance) => ["running", "starting", "waitingForManualAction", "paused"].includes(instance.status)).length,
      queued: instances.filter((instance) => instance.status === "queued").length,
      completed: instances.filter((instance) => ["completed", "failed", "cancelled"].includes(instance.status)).length
    }),
    [instances]
  );

  const validationErrors = useMemo(() => validateRunSettings(selectedWorkflowId, runCount, maxParallel), [maxParallel, runCount, selectedWorkflowId]);

  // ── Workflow card derived data + handlers ────────────────────────────────────
  // Per-workflow status: invalid (validation errors) / inactive (no flows) / active.
  const workflowStatusMap = useMemo(() => {
    const map = new Map<string, { status: WorkflowCardStatus; blockReason: string }>();
    for (const workflow of workflows) {
      if (workflow.nodes.length === 0) {
        map.set(workflow.id, { status: "inactive", blockReason: "No flows added — open Workflow Builder to add flows." });
        continue;
      }
      try {
        const plan = orchestrator.createExecutionPlan(workflowToScenarioProfile(workflow));
        const errors = plan.validationIssues.filter((issue) => issue.severity === "error");
        if (errors.length) {
          map.set(workflow.id, { status: "invalid", blockReason: errors.map((issue) => issue.message).join(" ") });
          continue;
        }
      } catch (error) {
        map.set(workflow.id, { status: "invalid", blockReason: error instanceof Error ? error.message : "Workflow is invalid." });
        continue;
      }
      map.set(workflow.id, { status: "active", blockReason: "" });
    }
    return map;
  }, [workflows]);

  const defaultCardParams = useCallback(
    (): WorkflowCardParams => ({
      totalRuns: execDefaults.defaultRuns,
      concurrentInstances: execDefaults.defaultConcurrentRuns,
      runMode: execDefaults.defaultRunMode,
      isolationMode: "browserContext",
      screenshotOnFailure: execDefaults.screenshotOnFailure,
      stopOnError: execDefaults.stopOnError
    }),
    [execDefaults]
  );

  const getCardParams = useCallback((workflowId: string): WorkflowCardParams => cardParams[workflowId] ?? defaultCardParams(), [cardParams, defaultCardParams]);

  const updateCardParams = useCallback(
    (workflowId: string, patch: Partial<WorkflowCardParams>) => {
      setCardParams((current) => {
        const next = { ...(current[workflowId] ?? defaultCardParams()), ...patch };
        const merged = { ...current, [workflowId]: next };
        // Persist this workflow's card params (per-workflow, independent).
        window.playwrightFlowStudio.settings.update({ workflowRunCards: { [workflowId]: next } }).catch(() => undefined);
        return merged;
      });
    },
    [defaultCardParams]
  );

  const validateCardParams = useCallback(
    (workflow: WorkflowProfile, params: WorkflowCardParams): string[] =>
      validateCardParamsPure(
        params,
        { maxRuns: execDefaults.maxRuns, maxConcurrentRuns: execDefaults.maxConcurrentRuns },
        !!workflow.dataSource?.dataSourceId,
        !!(workflow.dataSource?.dataSourceId && dataSourceNames[workflow.dataSource.dataSourceId])
      ),
    [execDefaults.maxRuns, execDefaults.maxConcurrentRuns, dataSourceNames]
  );

  const runWorkflowFromCard = useCallback(
    async (workflow: WorkflowProfile) => {
      const meta = workflowStatusMap.get(workflow.id);
      if (meta && meta.status !== "active") {
        setRunMessage(`${workflow.name}: ${meta.blockReason}`);
        return;
      }
      const params = getCardParams(workflow.id);
      const errors = validateCardParams(workflow, params);
      if (errors.length) {
        setRunMessage(`${workflow.name}: ${errors.join(" ")}`);
        return;
      }
      setRunMessage(`Starting ${workflow.name}…`);
      try {
        const result = (await window.playwrightFlowStudio.executions.runWorkflow({
          workflowId: workflow.id,
          dryRun: false,
          headless: params.runMode === "headless",
          totalInstances: params.totalRuns,
          maxConcurrentInstances: params.concurrentInstances,
          isolationMode: params.isolationMode,
          stopOnError: params.stopOnError
        })) as { status?: string; message?: string; error?: string };

        if (result.status === "validationFailed") setRunMessage(`${workflow.name}: validation failed. Resolve workflow issues before running.`);
        else if (result.error) setRunMessage(`${workflow.name}: ${result.error}`);
        else setRunMessage(result.message ?? `${workflow.name} run ${result.status ?? "started"}.`);
      } catch (error) {
        setRunMessage(error instanceof Error ? error.message : "Run request failed.");
      }
    },
    [workflowStatusMap, getCardParams, validateCardParams]
  );

  const filteredWorkflows = useMemo(() => filterWorkflows(workflows, cardSearch), [workflows, cardSearch]);

  // Always render every card; enable the two-row scroller only once the cards overflow two rows.
  const visibleWorkflows = filteredWorkflows;
  const needsScroll = filteredWorkflows.length > computeVisibleCardCount(gridColumns, MAX_CARD_ROWS);

  // Measure the height of two card rows so the overflowing grid scroller shows exactly two rows.
  useEffect(() => {
    if (!needsScroll) {
      setGridScrollHeight(null);
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      const card = grid.querySelector<HTMLElement>(".workflow-card");
      if (!card) return;
      const gap = parseFloat(getComputedStyle(grid).rowGap || "14") || 14;
      // Two rows of cards plus the single inter-row gap between them.
      setGridScrollHeight(Math.round(card.offsetHeight * 2 + gap));
    };
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [needsScroll, gridColumns, visibleWorkflows.length]);

  // Resolve an instance's workflow name for the table (Task 05).
  const workflowNameById = useMemo(() => new Map(workflows.map((workflow) => [workflow.id, workflow.name])), [workflows]);
  const resolveWorkflow = useCallback((scenarioId: string) => resolveWorkflowName(workflowNameById, scenarioId), [workflowNameById]);

  const startAll = async () => {
    if (validationErrors.length) {
      setRunMessage(validationErrors.join(" "));
      return;
    }

    const profile: ConcurrentRunProfile = {
      ...baseRunProfile,
      scenarioId: selectedWorkflowId,
      maxConcurrentInstances: maxParallel,
      browserWindowMode,
      resourceControls: { ...baseRunProfile.resourceControls, delayBetweenInstanceStartsMs: startDelayMs },
      instanceTemplate: { ...baseRunProfile.instanceTemplate, isolationMode }
    };

    setRunMessage("Starting run…");

    try {
      const result = (await window.playwrightFlowStudio.executions.runWorkflow({
        workflowId: selectedWorkflowId,
        dryRun: false,
        headless: browserWindowMode === "headless",
        totalInstances: runCount,
        maxConcurrentInstances: maxParallel
      })) as { status?: string; message?: string; error?: string };

      if (result.status === "validationFailed") {
        setRunMessage("Validation failed. Resolve workflow issues before running.");
      } else if (result.error) {
        setRunMessage(result.error);
      } else {
        setRunMessage(result.message ?? `Workflow run ${result.status ?? "started"}.`);
      }
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : "Run request failed.");
    }
  };

  // Phase 05: functional toolbar controls
  const hasActive = counts.active > 0;
  const hasPaused = instances.some((i) => i.status === "paused" || i.status === "waitingForManualAction");
  const hasAny = instances.length > 0;

  const pauseAll = () => {
    window.playwrightFlowStudio.executions.pauseInstance("all").catch(() => undefined);
  };
  const resumeAll = () => {
    window.playwrightFlowStudio.executions.resumeInstance("all").catch(() => undefined);
  };
  const stopAll = () => {
    window.playwrightFlowStudio.executions.stopAll().catch(() => undefined);
  };

  // Phase 03+05: clear only completed/failed/cancelled/stopped — never adds dummy replacements.
  // Must remove from the backend pool too, otherwise the 1s poll re-fetches and the rows reappear.
  const clearCompleted = async () => {
    const terminal = instances.filter((instance) => ["completed", "failed", "cancelled", "stopped"].includes(instance.status));
    if (!terminal.length) {
      setRunMessage("No completed instances to clear.");
      return;
    }
    // Optimistic local removal for instant feedback.
    setInstances((current) =>
      current.filter((instance) => !["completed", "failed", "cancelled", "stopped"].includes(instance.status))
    );
    await Promise.all(
      terminal.map((instance) => window.playwrightFlowStudio.executions.removeInstance(instance.instanceId).catch(() => undefined))
    );
  };

  // Runs start from the per-workflow cards now; the header keeps only a global Stop All.
  usePageChrome(
    {
      actions: [
        {
          id: "stop",
          label: "Stop All",
          variant: "primary",
          onClick: stopAll,
          disabled: !hasActive,
          title: hasActive ? "Stop all active instances (all workflows)" : "No active instances to stop"
        }
      ],
      dirty: false
    },
    [hasActive]
  );

  // Phase 05: per-instance status-aware controls
  const updateInstanceStatus = (instanceId: string, status: InstanceStatus) => {
    const action =
      status === "paused"
        ? window.playwrightFlowStudio.executions.pauseInstance(instanceId)
        : status === "running"
          ? window.playwrightFlowStudio.executions.resumeInstance(instanceId)
          : status === "cancelled"
            ? window.playwrightFlowStudio.executions.stopInstance(instanceId)
            : Promise.resolve();
    action.catch(() => undefined);
  };

  const openPath = async (path: string, label: string) => {
    if (!path) {
      setRunMessage(`${label} path is not set for this instance.`);
      return;
    }
    setRunMessage(`Opening ${label}…`);
    try {
      // @ts-ignore - added to preload.ts
      const errMessage = await window.playwrightFlowStudio.system.openPath(path);
      if (errMessage) {
        setRunMessage(`Failed to open ${label}: ${errMessage}`);
      }
    } catch (e: any) {
      setRunMessage(`Failed to open ${label}: ${e.message}`);
    }
  };

  // Task 09: re-run a single finished instance.
  const repeatInstance = async (instanceId: string) => {
    setRunMessage("Repeating instance…");
    try {
      const result = await window.playwrightFlowStudio.executions.repeatInstance(instanceId);
      if (result && !result.success) {
        setRunMessage(`Cannot repeat instance: ${result.error ?? "unavailable"}`);
      } else {
        setRunMessage(`Re-running instance ${instanceId}.`);
      }
    } catch (error) {
      setRunMessage(error instanceof Error ? error.message : "Repeat request failed.");
    }
  };

  const removeInstance = async (instanceId: string) => {
    // Optimistically remove from local state
    setInstances((current) => current.filter((instance) => instance.instanceId !== instanceId));
    // Remove from backend so it doesn't reappear on next poll
    try {
      // @ts-ignore
      await window.playwrightFlowStudio.executions.removeInstance(instanceId);
    } catch {
      // ignore
    }
  };

  return (
    <section className="page">
      <section className="work-panel">
        <div className="section-heading">
          <h1>Concurrent Instance Monitor</h1>
          <span>
            {counts.active} active, {counts.queued} queued, {counts.completed} completed
          </span>
        </div>

        {/* Primary run UX: workflow cards grid */}
        <p className="im-cards-hint">Select a workflow card, configure run parameters, then click Run. Multiple workflows can run at the same time.</p>

        <div className="im-card-search">
          <Search size={15} />
          <input
            placeholder="Search workflows by name…"
            value={cardSearch}
            onChange={(event) => setCardSearch(event.target.value)}
          />
        </div>

        {workflows.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <MonitorDot size={30} style={{ color: "var(--awkit-text-muted)" }} />
            <strong>No workflows created yet.</strong>
            <span>Create your first workflow in Workflow Builder.</span>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="empty-state" style={{ marginTop: 12 }}>
            <Search size={26} style={{ color: "var(--awkit-text-muted)" }} />
            <strong>No matching workflows found.</strong>
            <span>Adjust your search text.</span>
          </div>
        ) : (
          <>
            <div
              className={needsScroll ? "workflow-card-grid is-scrolling" : "workflow-card-grid"}
              ref={gridRef}
              style={needsScroll && gridScrollHeight ? { maxHeight: gridScrollHeight } : undefined}
            >
              {visibleWorkflows.map((workflow) => {
                const meta = workflowStatusMap.get(workflow.id) ?? { status: "active" as WorkflowCardStatus, blockReason: "" };
                const params = getCardParams(workflow.id);
                return (
                  <WorkflowRunCard
                    key={workflow.id}
                    workflow={workflow}
                    status={meta.status}
                    blockReason={meta.blockReason}
                    params={params}
                    paramErrors={meta.status === "active" ? validateCardParams(workflow, params) : []}
                    dataSourceName={workflow.dataSource?.dataSourceId ? dataSourceNames[workflow.dataSource.dataSourceId] ?? null : null}
                    maxRuns={execDefaults.maxRuns}
                    maxConcurrentRuns={execDefaults.maxConcurrentRuns}
                    onChange={(patch) => updateCardParams(workflow.id, patch)}
                    onRun={() => void runWorkflowFromCard(workflow)}
                  />
                );
              })}
            </div>
            {needsScroll ? (
              <span className="form-message im-load-more-msg">Showing all {filteredWorkflows.length} workflows — scroll the grid to view more.</span>
            ) : null}
          </>
        )}

        {/* Runtime capacity / lock / watchdog status (read-only diagnostics strip) */}
        {runtimeStatus ? (
          <div
            className="toolbar-strip im-runtime-status"
            style={{ flexWrap: "wrap", gap: "12px", marginTop: 12, fontSize: 12, color: "var(--awkit-text-secondary)", alignItems: "center" }}
            title="Concurrency runtime status: browser pool, capacity, resource locks, and watchdog activity."
          >
            <span>
              <strong>Browsers</strong> {runtimeStatus.capacity.activeBrowsers}/{runtimeStatus.capacity.maxBrowsers}
            </span>
            <span>
              <strong>Flows</strong> {runtimeStatus.capacity.activeFlows}/{runtimeStatus.capacity.maxActiveFlows}
            </span>
            <span>
              <strong>Pages</strong> {runtimeStatus.capacity.activePages}
            </span>
            <span>
              <strong>Queued</strong> {runtimeStatus.capacity.queueDepth}
            </span>
            <span title={`Profile: ${runtimeStatus.locks.profileLocks} · Origin: ${runtimeStatus.locks.originLocks} · Account: ${runtimeStatus.locks.accountLocks} · Download dirs: ${runtimeStatus.locks.downloadDirLocks}`}>
              <strong>Locks</strong> {runtimeStatus.locks.totalHeld}
              {runtimeStatus.locks.staleLocks > 0 ? ` (${runtimeStatus.locks.staleLocks} stale)` : ""}
            </span>
            <span>
              <strong>Crashes</strong> {runtimeStatus.capacity.recentCrashes}
            </span>
            {runtimeStatus.capacity.cpuPercent !== undefined ? (
              <span title={`Sampled ${runtimeStatus.capacity.sampledAt ?? ""} · process RSS ${runtimeStatus.capacity.processRssMb}MB`}>
                <strong>CPU</strong> {runtimeStatus.capacity.cpuPercent}%
              </span>
            ) : null}
            {runtimeStatus.capacity.systemMemoryPercent !== undefined ? (
              <span>
                <strong>Mem</strong> {runtimeStatus.capacity.systemMemoryPercent}%
              </span>
            ) : null}
            {runtimeStatus.recoverableRuns && runtimeStatus.recoverableRuns.length > 0 ? (
              <span
                style={{ color: "var(--awkit-warning)" }}
                title={runtimeStatus.recoverableRuns
                  .map((run) => `${run.instanceId}: ${run.status}${run.recoveryNote ? ` — ${run.recoveryNote}` : ""}`)
                  .join("\n")}
              >
                <strong>Recoverable</strong> {runtimeStatus.recoverableRuns.length} prior run(s)
              </span>
            ) : null}
            {runtimeStatus.durableLocks && runtimeStatus.durableLocks.stale.length > 0 ? (
              <span
                style={{ color: "var(--awkit-warning)" }}
                title={runtimeStatus.durableLocks.stale.map((s) => `${s.key}: ${s.staleReason}`).join("\n")}
              >
                <strong>Stale durable locks</strong> {runtimeStatus.durableLocks.stale.length}
              </span>
            ) : null}
            {runtimeStatus.capacity.dispatchBlocked && runtimeStatus.capacity.blockedReason ? (
              <span style={{ color: "var(--awkit-warning)" }} title={runtimeStatus.capacity.blockedReason}>
                <strong>Backpressure:</strong> {runtimeStatus.capacity.blockedReason}
              </span>
            ) : null}
            {runtimeStatus.watchdog.recentFindings.length > 0 ? (
              <span
                style={{ color: "var(--awkit-warning)" }}
                title={runtimeStatus.watchdog.recentFindings.map((f) => `${f.kind}: ${f.instanceId} — ${f.reason}`).join("\n")}
              >
                <strong>Watchdog:</strong> {runtimeStatus.watchdog.recentFindings[runtimeStatus.watchdog.recentFindings.length - 1].kind} (
                {runtimeStatus.watchdog.totalFindings} total)
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Recoverable / interrupted prior runs (Phase 4C): actionable after an app restart. */}
        {runtimeStatus?.recoverableRuns?.length ? (
          <RecoverableRunsPanel
            runs={runtimeStatus.recoverableRuns}
            resolveWorkflow={(scenarioId) => workflows.find((workflow) => workflow.id === scenarioId)}
            onRerunWorkflow={(workflow) => void runWorkflowFromCard(workflow)}
            onOpenPath={(path, label) => void openPath(path, label)}
            onMessage={setRunMessage}
            onChanged={refreshRuntimeStatus}
          />
        ) : null}

        {/* Monitor-wide controls (apply across every running workflow) */}
        <div className="toolbar-strip im-monitor-controls" style={{ flexWrap: "wrap", gap: "8px" }}>
          <button disabled={!hasActive} id="im-pause-all" onClick={pauseAll} title={hasActive ? "Pause all active instances" : "No active instances"} type="button">
            <Pause size={15} />
            Pause All
          </button>
          <button disabled={!hasPaused} id="im-resume-all" onClick={resumeAll} title={hasPaused ? "Resume all paused instances" : "No paused instances"} type="button">
            <RotateCcw size={15} />
            Resume All
          </button>
          <button disabled={!hasActive} id="im-stop-all" onClick={stopAll} title={hasActive ? "Stop all active instances" : "No active instances"} type="button">
            <Square size={15} />
            Stop All
          </button>
          <button
            disabled={counts.completed === 0}
            id="im-clear-completed"
            onClick={() => void clearCompleted()}
            title={counts.completed > 0 ? "Remove completed/failed/cancelled rows (all workflows)" : "No completed instances to clear"}
            type="button"
          >
            <Trash2 size={15} />
            Clear Completed
          </button>
        </div>

        {/* Status / message row */}
        <div className="validation-list run-validation ok">
          {runMessage ? <strong>{runMessage}</strong> : <strong>Select a workflow card, set parameters, then Run. Multiple workflows can run at once.</strong>}
        </div>

        {/* Advanced / Classic run form (the previous dropdown-based UX) */}
        <details className="im-classic" onToggle={(event) => setClassicOpen((event.target as HTMLDetailsElement).open)}>
          <summary>
            <ChevronDown size={14} className={classicOpen ? "im-classic-caret open" : "im-classic-caret"} />
            Advanced / Classic run form
          </summary>
          <div className="toolbar-strip run-toolbar" style={{ flexWrap: "wrap", gap: "8px", marginTop: 10 }}>
            <label>
              Workflow
              <select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)}>
                <option value="">Select workflow</option>
                {workflows.map((workflow) => (
                  <option key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Total Runs
              <input type="number" min="1" value={runCount} onChange={(event) => setRunCount(Number(event.target.value))} style={{ width: "70px" }} />
            </label>
            <label>
              Concurrent
              <input type="number" min="1" value={maxParallel} onChange={(event) => setMaxParallel(Number(event.target.value))} style={{ width: "70px" }} />
            </label>
            <label>
              Isolation
              <select value={isolationMode} onChange={(event) => setIsolationMode(event.target.value as InstanceIsolationMode)}>
                <option value="browserContext">Browser context</option>
                <option value="persistentContext">Persistent context</option>
              </select>
            </label>
            <label>
              Run Type
              <select value={browserWindowMode} onChange={(event) => setBrowserWindowMode(event.target.value as BrowserWindowMode)}>
                <option value="headless">Headless</option>
                <option value="activeOnly">Headed</option>
              </select>
            </label>
            <label>
              Start Delay (ms)
              <input type="number" min="0" step="50" value={startDelayMs} onChange={(event) => setStartDelayMs(Number(event.target.value))} style={{ width: "80px" }} />
            </label>
            <button
              disabled={validationErrors.length > 0}
              id="im-start-all"
              onClick={() => void startAll()}
              title={validationErrors.length ? validationErrors.join(" ") : "Start the selected workflow"}
              type="button"
            >
              <Play size={15} />
              Start Run
            </button>
          </div>
          {selectedWorkflowId && workflowDataSource?.dataSourceId ? (
            <div className="validation-list run-validation" style={{ marginTop: 8 }}>
              <strong>
                Data source: {dataSourceNames[workflowDataSource.dataSourceId] ?? workflowDataSource.dataSourceId}
                {dataSourceRecords === null ? "" : ` — ${dataSourceRecords} record(s)`}
              </strong>
              {dataSourceRecords !== null && runCount > dataSourceRecords ? (
                <span>
                  Total runs ({runCount}) exceed available records ({dataSourceRecords}); instance-order IDs above {dataSourceRecords} will not resolve.
                </span>
              ) : null}
            </div>
          ) : null}
        </details>

        {/* Protected login handoff (paused instances) */}
        <ProtectedLoginHandoffPanel
          instances={instances}
          capabilities={authCaps}
          workflowName={(scenarioId) => resolveWorkflow(scenarioId).name}
          onCancel={(id) => window.playwrightFlowStudio.executions.stopInstance(id).catch(() => undefined)}
          onContinue={(id) => window.playwrightFlowStudio.executions.resumeInstance(id).catch(() => undefined)}
          onRetry={(id) => window.playwrightFlowStudio.executions.retryHandoff(id).catch(() => undefined)}
          onOpenOAuth={(provider) => void openOAuthHandoff(provider)}
        />

        {/* Phase 04: stable table with overflow-x wrapper */}
        {instances.length === 0 ? (
          <div className="empty-state" id="im-empty-state" style={{ marginTop: "16px" }}>
            <MonitorDot size={32} style={{ color: "var(--awkit-text-muted)" }} />
            <strong>No active instances.</strong>
            <span>Run a workflow card above to launch instances; they will appear here.</span>
          </div>
        ) : (
          <div className="instance-table-wrapper" style={{ marginTop: "16px" }}>
            <table className="instance-table">
              <colgroup>
                <col style={{ minWidth: "130px" }} />
                <col style={{ minWidth: "140px" }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "80px" }} />
                <col style={{ width: "100px" }} />
                <col style={{ minWidth: "120px" }} />
                <col style={{ minWidth: "120px" }} />
                <col style={{ width: "55px" }} />
                <col style={{ width: "75px" }} />
                <col style={{ width: "55px" }} />
                <col style={{ width: "200px" }} />
                <col style={{ width: "110px" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Instance</th>
                  <th>Workflow</th>
                  <th>Browser</th>
                  <th>Mode</th>
                  <th>Isolation</th>
                  <th>Current Flow</th>
                  <th>Current Step</th>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Dur.</th>
                  <th>Controls</th>
                  <th>Files</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((instance) => {
                  const isActive = ["running", "starting", "waitingForManualAction"].includes(instance.status);
                  const isPaused = instance.status === "paused" || instance.status === "waitingForManualAction";
                  const isRunning = instance.status === "running" || instance.status === "starting";
                  const isStoppable = ["running", "queued", "starting", "paused", "waitingForManualAction"].includes(instance.status);
                  const isDone = ["completed", "failed", "cancelled", "stopped"].includes(instance.status);

                  const workflow = resolveWorkflow(instance.scenarioId);

                  return (
                    <tr key={instance.instanceId}>
                      <td className="instance-name-cell">
                        <strong>{instance.config.name}</strong>
                        <small>exec {instance.executionId.slice(-8)}</small>
                      </td>
                      <td className="instance-name-cell">
                        <strong className={workflow.missing ? "instance-workflow-missing" : undefined} title={instance.scenarioId}>
                          {workflow.name}
                        </strong>
                        <small>{instance.scenarioId || "—"}</small>
                      </td>
                      <td>{instance.config.browser}</td>
                      <td>{instance.config.headless ? "Headless" : "Headed"}</td>
                      <td>{formatIsolation(instance.config.isolationMode)}</td>
                      <td className="instance-ellipsis">{instance.currentFlow ?? "—"}</td>
                      <td className="instance-ellipsis">{instance.manualHandoff?.message ?? instance.currentStep ?? "—"}</td>
                      <td style={{ textAlign: "center" }}>{instance.currentDataRowIndex ?? "—"}</td>
                      <td>
                        <span className={`state-pill ${statusClass(instance.status)}`}>{formatStatus(instance.status)}</span>
                      </td>
                      <td style={{ textAlign: "center" }}>{formatDuration(instance.durationMs)}</td>
                      <td>
                        <div className="table-actions instance-controls">
                          <button
                            disabled={!isRunning}
                            title={isRunning ? "Pause this instance" : "Instance is not running"}
                            type="button"
                            onClick={() => updateInstanceStatus(instance.instanceId, "paused")}
                          >
                            <Pause size={13} />
                          </button>
                          <button
                            disabled={!isPaused}
                            title={isPaused ? "Resume this instance" : "Instance is not paused"}
                            type="button"
                            onClick={() => updateInstanceStatus(instance.instanceId, "running")}
                          >
                            <Play size={13} />
                          </button>
                          <button
                            disabled={!isStoppable}
                            title={isStoppable ? "Stop this instance" : "Instance cannot be stopped"}
                            type="button"
                            onClick={() => updateInstanceStatus(instance.instanceId, "cancelled")}
                          >
                            <Square size={13} />
                          </button>
                          <button
                            disabled={!isDone}
                            title={isDone ? "Repeat (re-run) this instance" : "Instance must finish before it can be repeated"}
                            type="button"
                            onClick={() => void repeatInstance(instance.instanceId)}
                          >
                            <RefreshCw size={13} />
                          </button>
                          <button
                            disabled={!isDone}
                            title={isDone ? "Remove this instance" : "Cannot remove a running instance"}
                            type="button"
                            onClick={() => removeInstance(instance.instanceId)}
                            style={{ color: isDone ? "var(--awkit-danger)" : "inherit" }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                      <td>
                        <div className="table-actions instance-controls">
                          <button
                            title="Open the live, human-readable execution report"
                            type="button"
                            onClick={() => setReportInstanceId(instance.instanceId)}
                          >
                            <Activity size={13} />
                          </button>
                          <button
                            disabled={fileButtonDisabled(instance.status, instance.paths.screenshots)}
                            title={fileButtonTitle(instance.status, instance.paths.screenshots, "Screenshots")}
                            type="button"
                            onClick={() => openPath(instance.paths.screenshots, "Screenshots")}
                          >
                            <FileImage size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {reportInstanceId
        ? (() => {
            const target = instances.find((instance) => instance.instanceId === reportInstanceId);
            if (!target) return null;
            return (
              <LiveExecutionReportModal
                instance={target}
                workflow={workflows.find((workflow) => workflow.id === target.scenarioId)}
                onClose={() => setReportInstanceId(null)}
              />
            );
          })()
        : null}
    </section>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Phase 03 fix: this function is now only called when the user explicitly starts
 * a run — never on component mount. It creates planned (not fake running) instances.
 */
function createPlannedInstances(
  profile: ConcurrentRunProfile,
  runCount: number,
  browserWindowMode: BrowserWindowMode,
  isolationMode: InstanceIsolationMode,
  workflowId: string
): InstanceRuntimeState[] {
  const executionId = `exec-${Date.now().toString(36)}`;
  const root = `%LOCALAPPDATA%/PlaywrightFlowStudio`;

  return Array.from({ length: runCount }, (_, index) => {
    const instanceId = `instance-${index + 1}`;
    return {
      executionId,
      instanceId,
      scenarioId: workflowId,
      config: {
        id: instanceId,
        name: `Instance ${index + 1}`,
        browser: "chromium",
        headless: browserWindowMode === "headless",
        isolationMode,
        timeoutMs: 30000,
        viewport: { width: 1440, height: 900 },
        downloadsPath: `${root}/downloads/${executionId}/${instanceId}`,
        screenshotsPath: `${root}/screenshots/${executionId}/${instanceId}`,
        logsPath: `${root}/logs/${executionId}/${instanceId}.jsonl`,
        userDataDir: isolationMode === "persistentContext" ? `${root}/instances/${executionId}/${instanceId}/profile` : undefined
      },
      status: "pending" as const,
      currentFlow: undefined,
      currentStep: undefined,
      currentDataRowIndex: index,
      currentDataRow: { rowIndex: index },
      queuePosition: undefined,
      durationMs: 0,
      retryAttempt: 0,
      paths: {
        downloads: `${root}/downloads/${executionId}/${instanceId}`,
        screenshots: `${root}/screenshots/${executionId}/${instanceId}`,
        logs: `${root}/logs/${executionId}/${instanceId}.jsonl`,
        reports: `${root}/reports/${executionId}/${instanceId}.json`,
        storage: `${root}/instances/${executionId}/${instanceId}/storage`,
        userDataDir: isolationMode === "persistentContext" ? `${root}/instances/${executionId}/${instanceId}/profile` : undefined
      },
      resourcePolicy: {
        storageStatePath: `${root}/storage/${instanceId}-auth.json`,
        userDataDir: isolationMode === "persistentContext" ? `${root}/instances/${executionId}/${instanceId}/profile` : undefined,
        downloadsPath: `${root}/downloads/${executionId}/${instanceId}`,
        screenshotsPath: `${root}/screenshots/${executionId}/${instanceId}`,
        logsPath: `${root}/logs/${executionId}/${instanceId}.jsonl`
      },
      runtimeInputs: {},
      instanceInputs: { rowIndex: index, browserWindowMode },
      flowOutputs: {}
    } satisfies InstanceRuntimeState;
  });
}

/**
 * Task 10: file/artifact buttons are enabled ONLY for failed instances that have an
 * artifact path. Completed (and every other status) keep them disabled.
 */
function fileButtonDisabled(status: InstanceStatus, path: string | undefined): boolean {
  return !(status === "failed" && !!path);
}

function fileButtonTitle(status: InstanceStatus, path: string | undefined, label: string): string {
  if (status === "completed") return "Files are available only for failed instances.";
  if (status === "failed") return path ? `${label}: ${path}` : "No failure files available.";
  return "Files are available after a failed run.";
}

function validateRunSettings(workflowId: string, runCount: number, maxParallel: number): string[] {
  const errors: string[] = [];
  if (!workflowId) errors.push("Select a workflow before starting.");
  if (runCount < 1) errors.push("Total runs must be greater than 0.");
  if (maxParallel < 1) errors.push("Concurrent instances must be greater than 0.");
  return errors;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function formatIsolation(isolationMode: InstanceIsolationMode): string {
  return isolationMode === "persistentContext" ? "Persistent" : "Context";
}

function formatStatus(status: InstanceStatus): string {
  return status
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase())
    .trim();
}

function statusClass(status: InstanceStatus): string {
  if (status === "waitingForManualAction") return "waiting";
  return status.toLowerCase();
}
