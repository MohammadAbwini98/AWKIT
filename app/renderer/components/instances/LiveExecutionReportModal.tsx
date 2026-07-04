import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Camera, CheckCircle2, Clock, Loader2, X, XCircle } from "lucide-react";
import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";
import {
  buildLiveExecutionReport,
  isLiveExecutionStatus,
  type ExecutionReportStep,
  type ExecutionStepStatus,
  type LiveExecutionReport
} from "./executionReportModel";

type StoredReport = ConcurrentRunReport & { id: string };

interface LiveExecutionReportModalProps {
  instance: InstanceRuntimeState;
  workflow?: WorkflowProfile;
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

export function LiveExecutionReportModal({ instance, workflow, onClose }: LiveExecutionReportModalProps) {
  const [report, setReport] = useState<StoredReport | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
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

  const model = useMemo<LiveExecutionReport>(
    () => buildLiveExecutionReport(instance, workflow, report, new Date(nowMs).toISOString()),
    [instance, workflow, report, nowMs]
  );
  const updateLabel = model.live ? `Updated ${formatRelativeTime(model.updatedAt, nowMs)}` : `Final update: ${formatTime(model.updatedAt)}`;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-dialog report-modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header report-modal-header">
          <h2>
            <Activity size={18} /> Execution Report
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
            <span>{updateLabel}</span>
          </div>
        </section>

        <div className="report-body">
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
              <StatCard label="Elapsed" value={formatDuration(model.stats.elapsedMs)} />
              <StatCard label="Avg step" value={model.stats.averageStepDurationMs != null ? formatDuration(model.stats.averageStepDurationMs) : undefined} />
              <StatCard label="Longest step" value={model.stats.longestStepDurationMs != null ? formatDuration(model.stats.longestStepDurationMs) : undefined} hint={model.stats.longestStepLabel} />
              <StatCard label="Screenshots" value={model.stats.screenshotCount} />
              <StatCard label="Errors" value={model.stats.errorCount} tone={model.stats.errorCount ? "bad" : undefined} />
            </div>
          </section>

          {/* Human-readable timeline */}
          <section className="report-section">
            <h3>Activity timeline</h3>
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
