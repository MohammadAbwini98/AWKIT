import { useEffect, useRef } from "react";
import { Activity, Clock3, Layers3, ListChecks, X } from "lucide-react";
import type { InstanceRuntimeState } from "@src/instances/InstanceRuntimeState";
import type { WorkflowRunSummary } from "@src/instances/instanceCardLogic";

interface WorkflowInstancesModalProps {
  summary: WorkflowRunSummary;
  workflowName: string;
  workflowMissing?: boolean;
  instances: InstanceRuntimeState[];
  onClose: () => void;
  onOpenReport: (instanceId: string) => void;
}

function formatTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatIsolation(mode: string): string {
  return mode === "persistentContext" ? "Persistent" : "Context";
}

function formatStatus(status: string): string {
  return status.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase());
}

export function WorkflowInstancesModal({
  summary,
  workflowName,
  workflowMissing,
  instances,
  onClose,
  onOpenReport
}: WorkflowInstancesModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = `workflow-instances-title-${summary.executionId}`;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (document.activeElement === dialogRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" data-testid="workflow-instances-overlay" onMouseDown={onClose}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-dialog workflow-instances-modal"
        data-testid="workflow-instances-modal"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal-header workflow-instances-header">
          <div>
            <span className="workflow-instances-icon" aria-hidden>
              <Layers3 size={18} />
            </span>
            <div>
              <h2 id={titleId}>{workflowName}</h2>
              <span className={workflowMissing ? "instance-workflow-missing" : undefined}>
                Execution {summary.executionId}
              </span>
            </div>
          </div>
          <button aria-label="Close workflow instance details" className="icon-button" onClick={onClose} title="Close" type="button">
            <X size={18} />
          </button>
        </header>

        <section className="workflow-run-modal-summary" aria-label="Workflow run summary">
          <div>
            <ListChecks size={15} />
            <span>Total</span>
            <strong>{summary.total}</strong>
          </div>
          <div>
            <Activity size={15} />
            <span>Active</span>
            <strong>{summary.running + summary.paused}</strong>
          </div>
          <div>
            <Clock3 size={15} />
            <span>Pending</span>
            <strong>{summary.pending}</strong>
          </div>
          <div className={summary.failed ? "tone-danger" : undefined}>
            <span>Failed</span>
            <strong>{summary.failed}</strong>
          </div>
          <div>
            <span>Completed</span>
            <strong>{summary.completed}</strong>
          </div>
          <div>
            <span>Cancelled</span>
            <strong>{summary.cancelled}</strong>
          </div>
        </section>

        <div className="workflow-instances-table-wrap">
          <table className="workflow-instances-table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Status</th>
                <th>Current flow / step</th>
                <th>Row</th>
                <th>Browser</th>
                <th>Mode</th>
                <th>Isolation</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Retries</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((instance) => (
                <tr key={instance.instanceId} data-testid="workflow-instance-detail-row">
                  <td className="instance-name-cell">
                    <strong>{instance.config.name}</strong>
                    <small>{instance.instanceId}</small>
                  </td>
                  <td><span className={`state-pill ${instance.status}`}>{formatStatus(instance.status)}</span></td>
                  <td className="workflow-instance-activity">
                    <strong>{instance.currentFlow ?? "Waiting"}</strong>
                    <small>{instance.manualHandoff?.message ?? instance.currentStep ?? "Not started"}</small>
                  </td>
                  <td>{instance.currentDataRowIndex == null ? "—" : instance.currentDataRowIndex + 1}</td>
                  <td>{instance.config.browser}</td>
                  <td>{instance.config.headless ? "Headless" : "Headed"}</td>
                  <td>{formatIsolation(instance.config.isolationMode)}</td>
                  <td>{formatTime(instance.startedAt)}</td>
                  <td>{formatDuration(instance.durationMs)}</td>
                  <td>{instance.retryAttempt}</td>
                  <td>
                    <button
                      aria-label={`Open report for ${instance.config.name}`}
                      className="icon-button"
                      onClick={() => onOpenReport(instance.instanceId)}
                      title="Open instance execution report"
                      type="button"
                    >
                      <Activity size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
