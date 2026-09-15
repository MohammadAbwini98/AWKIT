import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useModalFocusContract } from "../shared/useModalFocusContract";
import { AlertTriangle, Camera, Check, CheckCircle2, ChevronLeft, Loader2, Minus, Pause, Play, RotateCcw, X, XCircle } from "lucide-react";
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
  pending: "Queued",
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
  const logRef = useRef<HTMLOListElement>(null);
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

  // The execution log sticks to the newest entry while the run is live (it stops following once the
  // user is reading a finished run, so the final entries stay in view).
  useEffect(() => {
    const el = logRef.current;
    if (el && model.live) el.scrollTop = el.scrollHeight;
  }, [model.events.length, model.live]);

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

  const percent = model.progress?.percent ?? 0;
  // Toolbar markers sit on the step-progress axis: one tick per failed or manual-handoff step, at
  // that step's fractional position. Real model data only — no invented timeline.
  const markers = model.steps
    .map((step, index) =>
      step.status === "failed" || step.status === "waitingForManualAction"
        ? { left: model.steps.length ? ((index + 0.5) / model.steps.length) * 100 : 0, tone: step.status === "failed" ? "failed" : "waiting", title: `${STATUS_LABEL[step.status]}: ${step.label}` }
        : null
    )
    .filter((marker): marker is { left: number; tone: string; title: string } => marker !== null);
  const phaseLabel = failedStep
    ? `Halted at ${failedStep.label}`
    : manualStep
      ? `Waiting · ${manualStep.label}`
      : model.live
        ? (model.currentActivity ?? "Running")
        : instance.status === "completed"
          ? "Run finished"
          : "Ready";
  const toggleTitle = isRunning
    ? canStop ? "Pause this instance" : "Requires the Stop Workflows permission"
    : isPaused
      ? canStop ? "Resume this instance" : "Requires the Stop Workflows permission"
      : "Instance is not running";

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div ref={dialogRef} tabIndex={-1} className="modal-dialog report-modal run-monitor" role="dialog" aria-modal="true" aria-label="Live run monitor" onMouseDown={(event) => event.stopPropagation()}>
        <header className="run-monitor-header">
          <button className="icon-button run-monitor-back" type="button" title="Back to instances" aria-label="Close live run monitor" onClick={onClose}>
            <ChevronLeft size={18} />
          </button>
          <div className="run-monitor-heading">
            <div className="run-monitor-title-row">
              <h2 title={model.workflowName}>{model.workflowName}</h2>
              <span className={`report-status-pill pill-${statusClass(model.status)}`}>
                {model.live ? <Loader2 className="spin" size={13} /> : null}
                {model.status}
              </span>
            </div>
            <p className="run-monitor-subtitle">
              Run #{instance.executionId.slice(-8)} · {model.instanceName}
              {model.startedAt ? ` · started ${formatTime(model.startedAt)}` : ""}
            </p>
          </div>
          <div className="run-monitor-header-stats">
            <RunStat label="Elapsed" value={formatDuration(instance.durationMs)} />
            <RunStat label="Steps done" value={model.progress ? `${model.progress.completed} / ${model.stats.totalSteps}` : `${model.stats.completedSteps} / ${model.stats.totalSteps}`} />
            <RunStat label="Retries" value={String(totalRetries)} />
            <RunStat label="Skipped" value={String(skippedCount)} />
          </div>
          <button className="icon-button" type="button" title="Close" aria-label="Close live run monitor" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="run-monitor-body">
          <div className="run-monitor-canvas" role="region" aria-label="Workflow steps">
            <div className="run-monitor-flow-scroll">
              {model.steps.length === 0 ? (
                <div className="run-monitor-empty">
                  <span className="run-monitor-empty-tile">
                    <Loader2 className="spin" size={19} />
                  </span>
                  <strong>{loading ? "Loading report…" : "No flow details yet"}</strong>
                  <span>{loading ? "Fetching the execution report for this run." : "Flow details appear here as the run progresses and completes."}</span>
                </div>
              ) : (
                <div className="run-monitor-flow">
                  {model.steps.map((step, index) => (
                    <Fragment key={step.id}>
                      {index > 0 ? <MonitorEdge into={step.status} /> : null}
                      <MonitorNodeCard step={step} index={index} active={step.id === model.currentStepId || isActiveStepStatus(step.status)} />
                    </Fragment>
                  ))}
                </div>
              )}
              {model.live && !model.hasDetailedResults && model.steps.length > 0 ? (
                <p className="run-monitor-canvas-hint">Detailed per-flow results appear here as the run progresses and completes.</p>
              ) : null}
            </div>

            {/* Floating run controls — Restart (repeat), Pause/Resume, and live step progress. */}
            <div className="run-monitor-toolbar">
              <button
                className="run-monitor-tool-icon"
                disabled={!isDone || !canExecute}
                title={!canExecute ? "Requires the Execute Workflows permission" : isDone ? "Repeat (re-run) this instance" : "Instance must finish before it can be repeated"}
                aria-label="Restart instance"
                type="button"
                onClick={() => runControl(window.playwrightFlowStudio.executions.repeatInstance(instance.instanceId))}
              >
                <RotateCcw size={16} />
              </button>
              <button
                className="run-monitor-tool-primary"
                disabled={(!isRunning && !isPaused) || !canStop}
                title={toggleTitle}
                aria-label={isRunning ? "Pause instance" : "Resume instance"}
                type="button"
                onClick={() =>
                  runControl(
                    isRunning
                      ? window.playwrightFlowStudio.executions.pauseInstance(instance.instanceId)
                      : window.playwrightFlowStudio.executions.resumeInstance(instance.instanceId)
                  )
                }
              >
                {isRunning ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <div className="run-monitor-progress">
                <div
                  className="run-monitor-progress-track"
                  role="progressbar"
                  aria-label="Step progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  aria-valuetext={`${model.progress?.completed ?? model.stats.completedSteps} of ${model.stats.totalSteps} steps`}
                >
                  <div className="run-monitor-progress-fill" style={{ width: `${percent}%` }} />
                  {markers.map((marker) => (
                    <span key={marker.title} className={`run-monitor-marker tone-${marker.tone}`} style={{ left: `${marker.left}%` }} title={marker.title} aria-hidden />
                  ))}
                </div>
                <div className="run-monitor-progress-labels">
                  <span>{formatDuration(instance.durationMs)}</span>
                  <span className="run-monitor-progress-phase" title={phaseLabel}>{phaseLabel}</span>
                  <span>{baseline?.avgMs != null ? `avg ${formatDuration(baseline.avgMs)}` : "no history"}</span>
                </div>
              </div>
            </div>
          </div>

          <aside className="run-monitor-aside" aria-label="Execution log">
            <div className="run-monitor-aside-head">
              <h3>Execution log</h3>
              <span
                className="run-monitor-log-count"
                title={model.events.length >= 200 ? "Showing the most recent 200 entries" : `${model.events.length} entries`}
              >
                {model.events.length}
              </span>
              <span className="run-monitor-log-updated">{updateLabel}</span>
            </div>

            {failedStep ? (
              <div className="run-monitor-alert" role="status">
                <AlertTriangle size={14} />
                <span>
                  <strong>Run halted at {failedStep.label}</strong>
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

            {model.events.length === 0 ? (
              <p className="report-empty run-monitor-log-empty">No activity recorded yet.</p>
            ) : (
              <ol ref={logRef} className="run-monitor-log">
                {model.events.map((event) => (
                  <li key={event.id} className={`level-${event.level}`}>
                    <span className="run-monitor-log-time">{formatTime(event.timestamp)}</span>
                    <span className="run-monitor-log-dot" aria-hidden />
                    <span className="run-monitor-log-text">{event.message}</span>
                  </li>
                ))}
              </ol>
            )}

            <div className="run-monitor-aside-foot">
              {legend.length ? (
                <section className="run-monitor-legend-block">
                  <h4>Step outcomes</h4>
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
              <section className="run-monitor-legend-block">
                <h4>Statistics</h4>
                <ul className="run-monitor-stats-list">
                  <StatRow label="Success rate" value={model.stats.successRate != null ? `${model.stats.successRate}%` : undefined} />
                  <StatRow
                    label="Elapsed"
                    value={formatDuration(model.stats.elapsedMs)}
                    hint={historyComparison?.label}
                    hintTone={historyComparison?.tone}
                  />
                  <StatRow label={baseline ? `History avg · ${historyScopeLabel}` : "History avg"} value={baseline?.avgMs != null ? formatDuration(baseline.avgMs) : undefined} />
                  <StatRow label="History p95" value={baseline?.p95Ms != null ? formatDuration(baseline.p95Ms) : undefined} />
                  <StatRow label="Avg step" value={model.stats.averageStepDurationMs != null ? formatDuration(model.stats.averageStepDurationMs) : undefined} />
                  <StatRow label="Longest step" value={model.stats.longestStepDurationMs != null ? formatDuration(model.stats.longestStepDurationMs) : undefined} hint={model.stats.longestStepLabel} />
                  <StatRow label="Screenshots" value={model.stats.screenshotCount != null ? String(model.stats.screenshotCount) : undefined} />
                  <StatRow label="Errors" value={model.stats.errorCount != null ? String(model.stats.errorCount) : undefined} tone={model.stats.errorCount ? "bad" : undefined} />
                </ul>
              </section>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function MonitorNodeCard({ step, index, active }: { step: ExecutionReportStep; index: number; active: boolean }) {
  const className = statusClass(step.status);
  const Icon =
    step.status === "succeeded"
      ? CheckCircle2
      : step.status === "failed"
        ? XCircle
        : step.status === "waitingForManualAction"
          ? AlertTriangle
          : isAnimated(step.status)
            ? Loader2
            : CheckCircle2;
  const animated = isAnimated(step.status);
  const technicalError = step.status === "failed" ? step.error : undefined;
  const chipLabel =
    step.status === "failed" && step.retryCount
      ? `Failed · ${step.retryCount} ${step.retryCount === 1 ? "retry" : "retries"}`
      : STATUS_LABEL[step.status];
  const Mark = step.status === "succeeded" ? Check : step.status === "failed" ? X : step.status === "skipped" || step.status === "cancelled" ? Minus : null;
  return (
    <article
      className={`run-monitor-node st-${className} ${active ? "is-current" : ""} ${animated ? "is-active" : ""}`}
      tabIndex={technicalError ? 0 : undefined}
      aria-label={`Step ${index + 1}: ${step.label} — ${STATUS_LABEL[step.status]}`}
    >
      <div className="run-monitor-node-head">
        <span className="run-monitor-node-tile">
          <Icon className={animated ? "spin" : undefined} size={17} />
        </span>
        <span className="run-monitor-node-id">
          <span className="run-monitor-node-meta">{[step.flowLabel, step.type].filter(Boolean).join(" · ") || `Step ${index + 1}`}</span>
          <span className="run-monitor-node-title" title={step.label}>{step.label}</span>
        </span>
        {Mark ? (
          <span className={`run-monitor-node-mark tone-${className}`} aria-hidden>
            <Mark size={13} />
          </span>
        ) : null}
      </div>
      {step.message ? <p className="run-monitor-node-msg">{step.message}</p> : null}
      <div className="run-monitor-node-foot">
        <span className={`run-monitor-node-chip tone-${className}`}>
          <span className="run-monitor-node-chip-dot" aria-hidden />
          {chipLabel}
        </span>
        <span className="run-monitor-node-time">{step.durationMs != null ? formatDuration(step.durationMs) : "—"}</span>
      </div>
      {technicalError ? (
        <div className="report-node-error-hint run-monitor-node-error">
          <AlertTriangle size={12} />
          <span>Hover to view technical details</span>
          <div className="report-node-tooltip" role="tooltip">
            <strong>Technical details</strong>
            <pre>{technicalError}</pre>
          </div>
        </div>
      ) : null}
      {(step.startedAt && step.status !== "pending") || step.screenshotCount ? (
        <div className="run-monitor-node-meta-row">
          {step.startedAt && step.status !== "pending" ? <span>started {formatTime(step.startedAt)}</span> : null}
          {step.screenshotCount ? (
            <span className="run-monitor-node-shots">
              <Camera size={11} /> {step.screenshotCount}
            </span>
          ) : null}
          {step.retryCount ? <span>{step.retryCount} {step.retryCount === 1 ? "retry" : "retries"}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

/** Connector between consecutive steps — its state follows the downstream step. */
function MonitorEdge({ into }: { into: ExecutionStepStatus }) {
  const tone =
    into === "running" || into === "waiting" || into === "waitingForManualAction"
      ? "active"
      : into === "succeeded"
        ? "done"
        : into === "failed"
          ? "failed"
          : "idle";
  return <span className={`run-monitor-edge tone-${tone}`} aria-hidden />;
}

function StatRow({ label, value, hint, hintTone, tone }: { label: string; value: string | undefined; hint?: string; hintTone?: string; tone?: "bad" }) {
  const unavailable = value === undefined;
  return (
    <li className={`run-monitor-stat-row ${tone === "bad" && !unavailable ? "tone-bad" : ""}`}>
      <span className="run-monitor-stat-row-label">{label}</span>
      <span className="run-monitor-stat-row-value">
        {unavailable ? "—" : value}
        {hint && !unavailable ? <em className={`report-vs-chip tone-${hintTone === "ahead" ? "ahead" : hintTone === "behind" ? "behind" : "neutral"}`}>{hint}</em> : null}
      </span>
    </li>
  );
}

function RunStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="run-monitor-stat">
      <span className="run-monitor-stat-label">{label}</span>
      <span className="run-monitor-stat-value">{value}</span>
    </div>
  );
}
