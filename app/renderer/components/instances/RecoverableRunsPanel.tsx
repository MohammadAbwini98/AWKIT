import { CheckCircle2, ChevronDown, ChevronRight, FolderOpen, Play, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DurableArtifactRecord, DurableAttemptRecord, DurableRunRecord } from "@src/runner/store/RuntimeStoreSchema";
import type { WorkflowProfile } from "@src/profiles/WorkflowProfile";

/**
 * Recoverable / interrupted prior runs (Phase 4C). Compact, action-oriented list rendered in
 * the Instance Monitor after startup recovery finds runs a previous app instance left behind:
 *  - orphaned + recoverable → safe to re-run (re-run = AWKIT's resume model);
 *  - failed + manual-review → a side-effect node was in flight; NEVER auto-resumed. The user
 *    inspects the details/artifacts, verifies the external system, then marks it reviewed.
 */

interface RecoveryDetails {
  run?: DurableRunRecord;
  attempts: DurableAttemptRecord[];
  artifacts: DurableArtifactRecord[];
}

export interface RecoverableRunsPanelProps {
  runs: DurableRunRecord[];
  resolveWorkflow: (scenarioId?: string) => WorkflowProfile | undefined;
  onRerunWorkflow: (workflow: WorkflowProfile) => void;
  onOpenPath: (path: string, label: string) => void;
  onMessage: (message: string) => void;
  /** Re-fetch the runtime status right away so acted-on rows disappear without waiting a poll. */
  onChanged: () => void;
}

/** Windows/posix-safe "directory of this file path" without node:path in the renderer. */
function parentDir(filePath: string): string {
  return filePath.replace(/[\\/][^\\/]*$/, "");
}

function lastAttemptOf(details: RecoveryDetails | undefined): DurableAttemptRecord | undefined {
  if (!details?.attempts.length) return undefined;
  return details.attempts[details.attempts.length - 1];
}

/** Best folder to open for a run's artifacts: newest artifact, else trace/screenshot dir. */
function artifactFolderOf(details: RecoveryDetails | undefined): string | undefined {
  const attempt = lastAttemptOf(details);
  const newestArtifact = details?.artifacts[details.artifacts.length - 1];
  const candidate = newestArtifact?.path ?? attempt?.tracePath ?? attempt?.screenshotPath;
  return candidate ? parentDir(candidate) : undefined;
}

export function RecoverableRunsPanel({ runs, resolveWorkflow, onRerunWorkflow, onOpenPath, onMessage, onChanged }: RecoverableRunsPanelProps) {
  const [details, setDetails] = useState<Record<string, RecoveryDetails>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Details are needed for the Open-artifacts button state, so fetch them for every listed
  // run up front (the list is bounded to 20 by the engine; one cheap IPC read per run).
  useEffect(() => {
    let cancelled = false;
    for (const run of runs) {
      if (details[run.instanceId]) continue;
      window.playwrightFlowStudio.executions
        .recoveryDetails(run.instanceId)
        .then((detail) => {
          if (!cancelled) setDetails((current) => ({ ...current, [run.instanceId]: detail }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [runs, details]);

  const applyAction = useCallback(
    async (run: DurableRunRecord, action: "markReviewed" | "markAbandoned") => {
      setBusy((current) => ({ ...current, [run.instanceId]: true }));
      try {
        const result = await window.playwrightFlowStudio.executions.recoveryAction(run.instanceId, action);
        if (result.success) {
          onMessage(`Run ${run.instanceId} marked ${action === "markReviewed" ? "reviewed" : "abandoned"}.`);
          onChanged();
        } else {
          onMessage(result.error ?? "Recovery action failed.");
        }
      } catch (error) {
        onMessage(error instanceof Error ? error.message : "Recovery action failed.");
      } finally {
        setBusy((current) => ({ ...current, [run.instanceId]: false }));
      }
    },
    [onChanged, onMessage]
  );

  if (!runs.length) return null;

  return (
    <div
      className="toolbar-strip im-recoverable-runs"
      data-testid="recoverable-runs-panel"
      style={{ flexDirection: "column", alignItems: "stretch", gap: 8, marginTop: 12, fontSize: 12 }}
      title="Runs interrupted by a previous app exit. Safe runs can be re-run; runs with a side-effect node in flight require manual review and are never auto-resumed."
    >
      <span style={{ color: "var(--awkit-text-secondary)" }}>
        <strong>Interrupted prior runs</strong> — {runs.length} found by startup recovery
      </span>
      {runs.map((run) => {
        const detail = details[run.instanceId];
        const attempt = lastAttemptOf(detail);
        const workflow = resolveWorkflow(run.scenarioId);
        const workflowName = workflow?.name ?? (run.scenarioId ? "Deleted workflow" : "Unknown workflow");
        const artifactFolder = artifactFolderOf(detail);
        const isOpen = !!expanded[run.instanceId];
        const isBusy = !!busy[run.instanceId];
        const safe = run.recoverable === true;
        return (
          <div key={run.instanceId} style={{ border: "1px solid var(--awkit-border)", borderRadius: 8, padding: "8px 10px", background: "var(--awkit-surface-soft)" }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <button
                onClick={() => setExpanded((current) => ({ ...current, [run.instanceId]: !isOpen }))}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                title="View details"
                type="button"
              >
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                Details
              </button>
              <strong
                style={{ color: safe ? "var(--awkit-success)" : "var(--awkit-danger)" }}
                title={run.recoveryNote ?? ""}
              >
                {safe ? "Recoverable — safe to re-run" : "Manual review required"}
              </strong>
              <span title={run.instanceId}>{workflowName}</span>
              <span style={{ color: "var(--awkit-text-secondary)" }}>interrupted {run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "at unknown time"}</span>
              <span style={{ flex: 1 }} />
              {safe ? (
                <button
                  disabled={!workflow || isBusy}
                  onClick={() => workflow && onRerunWorkflow(workflow)}
                  title={workflow ? "Start a fresh run of this workflow (safe — no side-effect node was in flight)" : "The workflow no longer exists."}
                  type="button"
                >
                  <Play size={13} /> Re-run workflow
                </button>
              ) : null}
              <button
                disabled={!artifactFolder}
                onClick={() => artifactFolder && onOpenPath(artifactFolder, "artifact folder")}
                title={artifactFolder ? `Open ${artifactFolder}` : "No recorded artifact paths for this run."}
                type="button"
              >
                <FolderOpen size={13} /> Open artifacts
              </button>
              <button
                disabled={isBusy}
                onClick={() => void applyAction(run, "markReviewed")}
                title="Record that you verified this interrupted run (and the external system, for manual-review runs). Removes it from this list."
                type="button"
              >
                <CheckCircle2 size={13} /> Mark reviewed
              </button>
              <button
                disabled={isBusy}
                onClick={() => void applyAction(run, "markAbandoned")}
                title="Record that this interrupted run will not be re-run. Removes it from this list."
                type="button"
              >
                <XCircle size={13} /> Mark abandoned
              </button>
            </div>
            {isOpen ? (
              <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: 12, rowGap: 2, color: "var(--awkit-text)" }}>
                <span>Verdict</span>
                <span>{run.recoveryNote ?? "—"}</span>
                <span>Instance</span>
                <span>{run.instanceId}</span>
                <span>Status</span>
                <span>
                  {run.status}
                  {run.flowRunStatus ? ` (${run.flowRunStatus})` : ""}
                </span>
                <span>Last node</span>
                <span>{attempt ? `${attempt.nodeId} (try ${attempt.tryNumber}, ${attempt.status})` : "No node attempt recorded."}</span>
                <span>Safety level</span>
                <span>{attempt?.sideEffectLevel ?? "unknown"}</span>
                <span>Last URL</span>
                <span>{run.lastKnownUrl ?? attempt?.currentUrl ?? "—"}</span>
                <span>Error class</span>
                <span>{run.errorClass ?? attempt?.errorClass ?? "—"}</span>
                <span>Error</span>
                <span>{run.error ?? attempt?.error ?? "—"}</span>
                <span>Trace</span>
                <span>
                  {attempt?.tracePath ? (
                    <button onClick={() => onOpenPath(parentDir(attempt.tracePath!), "trace folder")} title={attempt.tracePath} type="button">
                      {attempt.tracePath}
                    </button>
                  ) : (
                    "—"
                  )}
                </span>
                <span>Screenshot</span>
                <span>
                  {attempt?.screenshotPath ? (
                    <button onClick={() => onOpenPath(parentDir(attempt.screenshotPath!), "screenshot folder")} title={attempt.screenshotPath} type="button">
                      {attempt.screenshotPath}
                    </button>
                  ) : (
                    "—"
                  )}
                </span>
                <span>Artifacts</span>
                <span>{detail ? `${detail.artifacts.length} recorded` : "loading…"}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
