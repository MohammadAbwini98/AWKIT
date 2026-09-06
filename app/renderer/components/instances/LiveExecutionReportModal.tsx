import { useEffect, useMemo, useState } from "react";
import { useModalFocusContract } from "../shared/useModalFocusContract";
import { Activity, AlertTriangle, Camera, CheckCircle2, Clock, Loader2, Pause, Play, RotateCcw, X, XCircle } from "lucide-react";
import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import type { WorkflowComparisonRow } from "@src/reports/TelemetryContracts";
import {
  buildLiveExecutionReport,
  compareElapsedToHistory,
  isLiveExecutionStatus,
  type ExecutionReportStep,
  type ExecutionStepStatus,
  type LiveExecutionReport,
  type WorkflowHistoryBaseline
} from "./executionReportModel";

type StoredReport = ConcurrentRunReport & { id: string };

interface LiveExecutionReportModalProps {
  instance: InstanceRuntimeState;
  workflow?: WorkflowProfile;
  /** Permission.WORKFLOW_EXECUTE — gates Restart, matching the instance table's repeat action. */
  canExecute: boolean;
  /** Permission.WORKFLOW_STOP — gates Pause/Resume, matching the instance table's pause action. */
  canStop: boolean;
  onClose: () => void;
}

const STATUS_LABEL: Record<ExecutionStepStatus, string> = {
  pending: "Pending",
  running: "Running",
  waiting: "Waiting",
  waitingForManualAction: "Manual action",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled"
};

/**
 * Step-outcome legend. Every one of the eight ExecutionStepStatus values has exactly one bucket, so
 * the rendered counts always reconcile to steps.length. Buckets with a zero count are not rendered.
 */
const LEGEND_BUCKETS: { key: string; label: string; tone: string; match: ExecutionStepStatus[] }[] = [
  { key: "succeeded", label: "Succeeded", tone: "succeeded", match: ["succeeded"] },
  { key: "running", label: "Running", tone: "running", match: ["running"] },
  { key: "waiting", label: "Waiting", tone: "waiting", match: ["waiting", "waitingForManualAction"] },
  { key: "failed", label: "Failed", tone: "failed", match: ["failed"] },
  { key: "skipped", label: "Skipped / not taken", tone: "skipped", match: ["skipped"] },
  { key: "pending", label: "Pending", tone: "pending", match: ["pending"] },
  { key: "cancelled", label: "Cancelled", tone: "cancelled", match: ["cancelled"] }
];

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString();
}

function formatDuration(ms?: number): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const isAnimated = (status: ExecutionStepStatus) => status === "running" || status === "waiting" || status === "waitingForManualAction";
const isActiveStepStatus = (status: ExecutionStepStatus) => status === "running" || status === "waiting" || status === "waitingForManualAction";
const statusClass = (status: string) => status.toLowerCase();

function formatRelativeTime(iso: string | undefined, nowMs: number): string {
  if (!iso) return "just now";
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "just now";
  const seconds = Math.max(0, Math.round((nowMs - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function LiveExecutionReportModal({ instance, workflow, canExecute, canStop, onClose }: LiveExecutionReportModalProps) {
  // AWKIT-A11Y-001: the modal focus contract (focus in / Tab trap / Escape / focus return).
  const { dialogRef } = useModalFocusContract(onClose);
  const [report, setReport] = useState<StoredReport | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [baseline, setBaseline] = useState<WorkflowHistoryBaseline | undefined>(undefined);
  const shouldPollReport = isLiveExecutionStatus(instance.status);

  useEffect(() => {
    let active = true;
    const fetchReport = () => {
      window.playwrightFlowStudio.reports
        .get(instance.executionId)
        .then((result) => {
          if (active) setReport((result as StoredReport) ?? undefined);
        })
        .catch(() => undefined)
        .finally(() => active && setLoading(false));
    };
    setLoading(true);
    fetchReport();
    const interval = shouldPollReport ? window.setInterval(fetchReport, 3000) : undefined;
    const finalRetry = shouldPollReport ? undefined : window.setTimeout(fetchReport, 1000);
    return () => {
      active = false;
      if (interval) window.clearInterval(interval);
      if (finalRetry) window.clearTimeout(finalRetry);
    };
  }, [instance.executionId, shouldPollReport]);

  useEffect(() => {
    if (!shouldPollReport) return;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [shouldPollReport]);

  // B4 — this workflow's historical per-run baseline (avg/p95), scoped to the current machine so a
  // live run is compared only against runs on the same hardware; falls back to all machines when the
  // current machine has no history (e.g. only pre-v3 runs). Fetched once per opened instance.
  useEffect(() => {
    const scenarioId = instance.scenarioId;
    if (!scenarioId) {
      setBaseline(undefined);
      return;
    }
    let cancelled = false;
    const pick = (rows: WorkflowComparisonRow[]) => rows.find((row) => row.scenarioId === scenarioId);
    void (async () => {
      let machineId: string | undefined;
      try {
        machineId = (await window.playwrightFlowStudio.system.capacityPreview()).capabilities.machineId;
      } catch {
        machineId = undefined;
      }
      try {
        let scoped = Boolean(machineId);
        let rows = await window.playwrightFlowStudio.telemetry.workflowComparison("all", machineId ? { machineId } : undefined);
        let row = pick(rows);
        if ((!row || row.totalRuns === 0) && machineId) {
          scoped = false;
          rows = await window.playwrightFlowStudio.telemetry.workflowComparison("all");
          row = pick(rows);
        }
        if (cancelled) return;
        setBaseline(row && row.totalRuns > 0 ? { avgMs: row.duration.avgMs, p95Ms: row.duration.p95Ms, runs: row.totalRuns, machineScoped: scoped } : undefined);
      } catch {
        if (!cancelled) setBaseline(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [instance.scenarioId]);

  const model = useMemo<LiveExecutionReport>(
    () => buildLiveExecutionReport(instance, workflow, report, new Date(nowMs).toISOString()),
    [instance, workflow, report, nowMs]
  );
  const updateLabel = model.live ? `Updated ${formatRelativeTime(model.updatedAt, nowMs)}` : `Final update: ${formatTime(model.updatedAt)}`;
  const historyComparison = useMemo(() => compareElapsedToHistory(instance.durationMs, baseline, model.live), [instance.durationMs, baseline, model.live]);
  const historyScopeLabel = baseline ? (baseline.machineScoped ? "this machine" : "all machines") : "";

  // Control state mirrors the instance table's predicates exactly so the monitor cannot grant an
  // action the table would refuse. Pause/Resume are WORKFLOW_STOP; Restart is WORKFLOW_EXECUTE.
  const isPaused = instance.status === "paused" || instance.status === "waitingForManualAction";
  const isRunning = instance.status === "running" || instance.status === "starting";
  const isDone = ["completed", "failed", "cancelled", "stopped"].includes(instance.status);
  const runControl = (action: Promise<unknown>) => {
    action.catch(() => undefined);
  };

  const skippedCount = model.steps.filter((step) => step.status === "skipped").length;
  const totalRetries = model.steps.reduce((sum, step) => sum + (step.retryCount ?? 0), 0);
  const legend = LEGEND_BUCKETS.map((bucket) => ({
    ...bucket,
    count: model.steps.filter((step) => bucket.match.includes(step.status)).length
  })).filter((bucket) => bucket.count > 0);

  const failedStep = model.steps.find((step) => step.status === "failed");
  const manualStep = model.steps.find((step) => step.status === "waitingForManualAction");

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="modal-dialog report-modal run-monitor" role="dialog" aria-modal="true" aria-label="Live run monitor" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header report-modal-header">
          <h2>
            <Activity size={18} /> Live Run Monitor
          </h2>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Summary banner */}
        <section className={`report-banner status-${statusClass(model.status)}`}>
          <div className="report-banner-main">
            <div className="report-banner-title">
              <strong>{model.workflowName}</strong>
              <span>{model.instanceName} · {model.instanceId.slice(-12)}</span>
            </div>
            <span className={`report-status-pill pill-${statusClass(model.status)}`}>
              {model.live ? <Loader2 className="spin" size={13} /> : null}
              {model.status}
            </span>
          </div>
          <div className={`report-activity ${model.live ? "is-live" : ""}`}>
            {model.live ? <span className="heartbeat" aria-hidden /> : null}
            <span>{model.currentActivity}</span>
          </div>
          <div className="report-banner-meta">
            <span><Clock size={12} /> Started {formatTime(model.startedAt)}</span>
            <span>Elapsed {formatDuration(instance.durationMs)}</span>
            {baseline?.avgMs != null ? (
              <span className="report-history-vs">
                vs history: avg {formatDuration(baseline.avgMs)}{baseline.p95Ms != null ? ` · p95 ${formatDuration(baseline.p95Ms)}` : ""}
                {historyComparison ? <em className={`report-vs-chip tone-${historyComparison.tone}`}>{historyComparison.label}</em> : null}
                <small>{historyScopeLabel} · {baseline.runs} run{baseline.runs === 1 ? "" : "s"}</small>
              </span>
            ) : null}
            <span>{updateLabel}</span>
          </div>
          <div className="run-monitor-stats">
            <RunStat label="Elapsed" value={formatDuration(instance.durationMs)} />
            <RunStat label="Steps done" value={`${model.stats.completedSteps} / ${model.stats.totalSteps}`} />
            <RunStat label="Retries" value={String(totalRetries)} />
            <RunStat label="Skipped" value={String(skippedCount)} />
          </div>
        </section>

        <div className="report-body run-monitor-body">
          <div className="run-monitor-main">
          {/* Live node map */}
          <section className="report-section">
            <h3>Flows &amp; steps</h3>
            {model.steps.length === 0 ? (
              <p className="report-empty">{loading ? "Loading report…" : "No flow details available for this run yet."}</p>
            ) : (
              <div className="report-process">
                {model.progress ? (
                  <div className="report-process-summary">
                    <div>
                      <strong>{model.progress.label}</strong>
                      <span>
                        {model.progress.completed} completed / {model.progress.total} total
                        {model.progress.failed ? ` / ${model.progress.failed} failed` : ""}
                      </span>
                    </div>
                    <span className="report-progress-percent">{model.progress.percent}%</span>
                    <div className="report-progress-track" aria-hidden>
                      <div className="report-progress-fill" style={{ width: `${model.progress.percent}%` }} />
                    </div>
                  </div>
                ) : null}
                <div className="report-process-scroll">
                  <div className="report-process-flow">
                    {model.steps.map((step, index) => (
                      <ReportNodeCard key={step.id} step={step} index={index} active={step.id === model.currentStepId || isActiveStepStatus(step.status)} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            {model.live && !model.hasDetailedResults ? (
              <p className="report-hint">Detailed per-flow results appear here as the run progresses and completes.</p>
            ) : null}
          </section>

          {/* Statistics */}
          <section className="report-section">
            <h3>Statistics</h3>
            <div className="report-stats">
              <StatCard label="Total steps" value={model.stats.totalSteps} />
              <StatCard label="Completed" value={model.stats.completedSteps} tone="ok" />
              <StatCard label="Failed" value={model.stats.failedSteps} tone={model.stats.failedSteps ? "bad" : undefined} />
              <StatCard label="Pending" value={model.stats.pendingSteps} />
              <StatCard label="Running / waiting" value={model.stats.runningSteps} />
              <StatCard label="Success rate" value={model.stats.successRate != null ? `${model.stats.successRate}%` : undefined} />
              <StatCard label="Elapsed" value={formatDuration(model.stats.elapsedMs)} hint={historyComparison?.label} />
              <StatCard label={baseline ? `History avg · ${historyScopeLabel}` : "History avg"} value={baseline?.avgMs != null ? formatDuration(baseline.avgMs) : undefined} />
              <StatCard label="History p95" value={baseline?.p95Ms != null ? formatDuration(baseline.p95Ms) : undefined} />
              <StatCard label="Avg step" value={model.stats.averageStepDurationMs != null ? formatDuration(model.stats.averageStepDurationMs) : undefined} />
              <StatCard label="Longest step" value={model.stats.longestStepDurationMs != null ? formatDuration(model.stats.longestStepDurationMs) : undefined} hint={model.stats.longestStepLabel} />
              <StatCard label="Screenshots" value={model.stats.screenshotCount} />
              <StatCard label="Errors" value={model.stats.errorCount} tone={model.stats.errorCount ? "bad" : undefined} />
            </div>
          </section>
          </div>
          <aside className="run-monitor-aside">
            {failedStep ? (
              <div className="run-monitor-alert" role="status">
                <AlertTriangle size={14} />
                <span>
                  <strong>Run stopped at {failedStep.label}</strong>
                  {failedStep.error ?? "This step failed before the workflow could continue."}
                </span>
              </div>
            ) : manualStep ? (
              <div className="run-monitor-alert tone-warning" role="status">
                <AlertTriangle size={14} />
                <span>
                  <strong>Waiting for manual action</strong>
                  {manualStep.message ?? "Complete the required action in the browser to continue."}
                </span>
              </div>
            ) : null}

          {/* Human-readable timeline */}
          <section className="report-section">
            <h3>
              Execution log
              <span
                className="run-monitor-log-count"
                title={model.events.length >= 200 ? "Showing the most recent 200 entries" : `${model.events.length} entries`}
              >
                {model.events.length}
              </span>
            </h3>
            {model.events.length === 0 ? (
              <p className="report-empty">No activity recorded yet.</p>
            ) : (
              <ol className="report-timeline">
                {model.events.map((event) => (
                  <li key={event.id} className={`timeline-item level-${event.level}`}>
                    <span className="timeline-time">{formatTime(event.timestamp)}</span>
                    <span className="timeline-dot" aria-hidden />
                    <span className="timeline-message">{event.message}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
            {legend.length ? (
              <section className="report-section">
                <h3>Step outcomes</h3>
                <ul className="run-monitor-legend">
                  {legend.map((bucket) => (
                    <li key={bucket.key}>
                      <span className={`run-monitor-legend-swatch tone-${bucket.tone}`} aria-hidden />
                      <span>{bucket.label}</span>
                      <span className="run-monitor-legend-count">{bucket.count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
        <div className="run-monitor-controls toolbar-strip">
          <button
            disabled={!isDone || !canExecute}
            title={!canExecute ? "Requires the Execute Workflows permission" : isDone ? "Repeat (re-run) this instance" : "Instance must finish before it can be repeated"}
            type="button"
            onClick={() => runControl(window.playwrightFlowStudio.executions.repeatInstance(instance.instanceId))}
          >
            <RotateCcw size={14} /> Restart
          </button>
          <button
            disabled={!isRunning || !canStop}
            title={!canStop ? "Requires the Stop Workflows permission" : isRunning ? "Pause this instance" : "Instance is not running"}
            type="button"
            onClick={() => runControl(window.playwrightFlowStudio.executions.pauseInstance(instance.instanceId))}
          >
            <Pause size={14} /> Pause
          </button>
          <button
            disabled={!isPaused || !canStop}
            title={!canStop ? "Requires the Stop Workflows permission" : isPaused ? "Resume this instance" : "Instance is not paused"}
            type="button"
            onClick={() => runControl(window.playwrightFlowStudio.executions.resumeInstance(instance.instanceId))}
          >
            <Play size={14} /> Resume
          </button>
          <p className="run-monitor-controls-note">{updateLabel}</p>
        </div>
      </div>
    </div>
  );
}

function ReportNodeCard({ step, index, active }: { step: ExecutionReportStep; index: number; active: boolean }) {
  const Icon =
    step.status === "succeeded"
      ? CheckCircle2
      : step.status === "failed"
        ? XCircle
        : step.status === "waitingForManualAction"
          ? AlertTriangle
          : isAnimated(step.status)
            ? Loader2
            : Activity;
  const technicalError = step.status === "failed" ? step.error : undefined;
  const className = statusClass(step.status);
  return (
    <article className={`report-node status-${className} ${active ? "is-current" : ""} ${isAnimated(step.status) ? "is-active" : ""}`} tabIndex={technicalError ? 0 : undefined}>
      <span className="report-node-number">{index + 1}</span>
      <header>
        <span className="report-node-icon">
          <Icon className={isAnimated(step.status) ? "spin" : undefined} size={17} />
        </span>
        <strong title={step.label}>{step.label}</strong>
        <span className={`report-node-badge badge-${className}`}>{STATUS_LABEL[step.status]}</span>
      </header>
      {step.flowLabel ? <span className="report-node-flow">{step.flowLabel}{step.type ? ` · ${step.type}` : ""}</span> : null}
      {step.message ? <p className="report-node-msg">{step.message}</p> : null}
      {technicalError ? (
        <div className="report-node-error-hint">
          <AlertTriangle size={12} />
          <span>Hover to view technical details</span>
          <div className="report-node-tooltip" role="tooltip">
            <strong>Technical details</strong>
            <pre>{technicalError}</pre>
          </div>
        </div>
      ) : null}
      <footer>
        {step.durationMs != null ? <span>{formatDuration(step.durationMs)}</span> : null}
        {step.startedAt ? <span>{formatTime(step.startedAt)}</span> : null}
        {step.screenshotCount ? (
          <span className="report-node-shots">
            <Camera size={11} /> {step.screenshotCount}
          </span>
        ) : null}
        {step.retryCount ? <span>retries: {step.retryCount}</span> : null}
      </footer>
    </article>
  );
}

function StatCard({ label, value, tone, hint }: { label: string; value: number | string | undefined; tone?: "ok" | "bad"; hint?: string }) {
  const display = value === undefined || value === "—" ? "Not available" : value;
  const unavailable = display === "Not available";
  return (
    <div className={`report-stat ${tone ? `tone-${tone}` : ""} ${unavailable ? "unavailable" : ""}`}>
      <span className="report-stat-value">{display}</span>
      <span className="report-stat-label">{label}{hint && !unavailable ? ` · ${hint}` : ""}</span>
    </div>
  );
}

function RunStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-monitor-stat">
      <span className="run-monitor-stat-value">{value}</span>
      <span className="run-monitor-stat-label">{label}</span>
    </div>
  );
}
