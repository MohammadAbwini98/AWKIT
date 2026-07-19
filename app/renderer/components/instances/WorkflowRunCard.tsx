import { AlertTriangle, Camera, Database, GitBranch, Layers, Play, Workflow as WorkflowIcon } from "lucide-react";
import type { InstanceIsolationMode } from "@src/instances/InstanceIsolationMode";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";

/** Per-card, per-workflow run parameters (kept independent for each workflow). */
export interface WorkflowCardParams {
  totalRuns: number;
  concurrentInstances: number;
  runMode: "headed" | "headless";
  isolationMode: InstanceIsolationMode;
  screenshotOnFailure: boolean;
  stopOnError: boolean;
}

export type WorkflowCardStatus = "active" | "inactive" | "invalid";

interface WorkflowRunCardProps {
  workflow: WorkflowProfile;
  status: WorkflowCardStatus;
  /** Reason the workflow can't run (invalid/inactive); empty when runnable. */
  blockReason: string;
  params: WorkflowCardParams;
  /** Per-card validation errors for the current parameter values. */
  paramErrors: string[];
  dataSourceName: string | null;
  maxRuns: number;
  maxConcurrentRuns: number;
  onChange: (patch: Partial<WorkflowCardParams>) => void;
  onRun: () => void;
  /** When set, the Run button is disabled (e.g. the acting role lacks the Execute Workflows permission). */
  runDisabled?: boolean;
  runDisabledReason?: string;
}

const statusLabel: Record<WorkflowCardStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  invalid: "Invalid"
};

function formatDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/**
 * Enterprise-styled workflow run card. The header is always visible; the body holds two
 * overlapping, equal-area layers — a summary (default) and the run parameters — that
 * cross-fade on hover or keyboard focus (focus-within). The card height never changes, so
 * the grid never reflows. Inputs stay in the DOM and remain keyboard-focusable (focusing
 * one reveals the params layer via :focus-within).
 */
export function WorkflowRunCard({
  workflow,
  status,
  blockReason,
  params,
  paramErrors,
  dataSourceName,
  maxRuns,
  maxConcurrentRuns,
  onChange,
  onRun,
  runDisabled = false,
  runDisabledReason
}: WorkflowRunCardProps) {
  const runnable = status === "active" && paramErrors.length === 0 && !runDisabled;
  const runTitle = runDisabled
    ? runDisabledReason ?? "Not permitted"
    : blockReason || (paramErrors.length ? paramErrors.join(" ") : `Run ${workflow.name}`);

  return (
    <article className={`workflow-card workflow-card-${status}`} tabIndex={0} aria-label={`Workflow ${workflow.name}`}>
      <header className="workflow-card-head">
        <div className="workflow-card-title">
          <WorkflowIcon size={16} />
          <strong title={workflow.name}>{workflow.name}</strong>
        </div>
        <span className={`workflow-card-badge badge-${status}`}>{statusLabel[status]}</span>
      </header>

      <div className="workflow-card-body">
        {/* Layer 1 — summary (default) */}
        <div className="workflow-card-summary">
          {workflow.description ? <p className="workflow-card-desc">{workflow.description}</p> : null}

          <ul className="workflow-card-meta">
            <li title="Linked flows">
              <Layers size={13} /> {workflow.nodes.length} flow{workflow.nodes.length === 1 ? "" : "s"}
            </li>
            <li title="Connectors">
              <GitBranch size={13} /> {workflow.edges.length} connector{workflow.edges.length === 1 ? "" : "s"}
            </li>
            <li title="Execution mode">{workflow.execution.mode}</li>
            <li title="Data source">
              <Database size={13} /> {dataSourceName ?? "None"}
            </li>
          </ul>
          <div className="workflow-card-updated">Updated {formatDate(workflow.updatedAt)}</div>

          {blockReason ? (
            <div className="workflow-card-block">
              <AlertTriangle size={13} /> {blockReason}
            </div>
          ) : null}
          <span className="workflow-card-hint">Hover or focus to configure &amp; run</span>
        </div>

        {/* Layer 2 — run parameters (revealed on hover/focus, same area, no height change) */}
        <div className="workflow-card-params">
        <div className="workflow-card-params-grid">
          <label>
            Total runs
            <input
              type="number"
              min={1}
              max={maxRuns}
              value={params.totalRuns}
              onChange={(event) => onChange({ totalRuns: Number(event.target.value) })}
            />
          </label>
          <label>
            Concurrent
            <input
              type="number"
              min={1}
              max={maxConcurrentRuns}
              value={params.concurrentInstances}
              onChange={(event) => onChange({ concurrentInstances: Number(event.target.value) })}
            />
          </label>
          <label>
            Run mode
            <select value={params.runMode} onChange={(event) => onChange({ runMode: event.target.value as WorkflowCardParams["runMode"] })}>
              <option value="headless">Headless</option>
              <option value="headed">Headed</option>
            </select>
          </label>
          <label>
            Isolation
            <select
              value={params.isolationMode}
              onChange={(event) => onChange({ isolationMode: event.target.value as InstanceIsolationMode })}
            >
              <option value="browserContext">Browser context</option>
              <option value="persistentContext">Persistent context</option>
            </select>
          </label>
        </div>

        <div className="workflow-card-toggles">
          <label
            className="inline-check disabled"
            title="Screenshot-on-failure is configured per step in each flow's failure settings."
          >
            <input type="checkbox" checked={params.screenshotOnFailure} disabled readOnly />
            Screenshot on failure
            <Camera size={12} />
          </label>
          <label className="inline-check">
            <input type="checkbox" checked={params.stopOnError} onChange={(event) => onChange({ stopOnError: event.target.checked })} />
            Stop on error
          </label>
        </div>

        {paramErrors.length ? (
          <div className="workflow-card-errors">
            {paramErrors.map((error) => (
              <span key={error}>{error}</span>
            ))}
          </div>
        ) : null}

        <button className="workflow-card-run" disabled={!runnable} onClick={onRun} title={runTitle} type="button">
          <Play size={14} />
          Run workflow
        </button>
        </div>
      </div>
    </article>
  );
}
