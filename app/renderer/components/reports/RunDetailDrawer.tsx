import { FolderOpen, X } from "lucide-react";
import type { RunDetail } from "@src/reports/TelemetryContracts";
import { StatusBadge } from "../shared/StatusBadge";
import { SkeletonCard } from "../shared/SkeletonCard";
import { EmptyState } from "../shared/EmptyState";
import { useTelemetryQuery } from "./useTelemetryQuery";
import { formatDurationMs, formatWhen, statusToTone } from "./statusTone";

interface RunDetailDrawerProps {
  instanceId: string;
  onClose: () => void;
}

/** Parent folder of a file path (handles both separators; renderer has no node path). */
function parentFolder(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : path;
}

/** Right-side drawer showing one run's metadata, node attempts, and artifact links. */
export function RunDetailDrawer({ instanceId, onClose }: RunDetailDrawerProps) {
  const { data, loading, error } = useTelemetryQuery<RunDetail>(
    () => window.playwrightFlowStudio.telemetry.runDetail(instanceId),
    [instanceId]
  );

  const openPath = (path: string) => {
    void window.playwrightFlowStudio.system.openPath(parentFolder(path)).catch(() => undefined);
  };

  return (
    <div className="awkit-drawer-scrim" role="dialog" aria-modal="true" aria-label="Run detail" onClick={onClose}>
      <aside className="awkit-drawer" onClick={(event) => event.stopPropagation()}>
        <header className="awkit-drawer-head">
          <div>
            <strong>Run detail</strong>
            <span className="awkit-muted">{instanceId}</span>
          </div>
          <button type="button" className="awkit-icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>

        {loading && !data ? (
          <div className="awkit-drawer-body">
            <SkeletonCard lines={4} />
            <SkeletonCard variant="chart" />
          </div>
        ) : error ? (
          <div className="awkit-drawer-body">
            <EmptyState title="Could not load run detail" hint={error} compact />
          </div>
        ) : !data?.run ? (
          <div className="awkit-drawer-body">
            <EmptyState title="Run not found" hint="This run is no longer in the durable history (retention may have removed it)." compact />
          </div>
        ) : (
          <div className="awkit-drawer-body">
            <section className="awkit-detail-meta">
              <div className="awkit-detail-meta-head">
                <StatusBadge tone={statusToTone(data.run.status)} label={data.run.status} />
                <strong>{data.run.scenarioName ?? data.run.scenarioId ?? "Workflow"}</strong>
              </div>
              <dl className="awkit-detail-grid">
                <div>
                  <dt>Duration</dt>
                  <dd>{formatDurationMs(data.run.durationMs)}</dd>
                </div>
                <div>
                  <dt>Queue wait</dt>
                  <dd>{formatDurationMs(data.run.queueWaitMs)}</dd>
                </div>
                <div>
                  <dt>Started</dt>
                  <dd>{formatWhen(data.run.startedAt)}</dd>
                </div>
                <div>
                  <dt>Ended</dt>
                  <dd>{formatWhen(data.run.endedAt)}</dd>
                </div>
                <div>
                  <dt>Category</dt>
                  <dd>{data.run.reportCategory ?? "—"}</dd>
                </div>
                <div>
                  <dt>Error class</dt>
                  <dd>{data.run.errorClass ?? "—"}</dd>
                </div>
              </dl>
              {data.run.error ? <p className="awkit-detail-error">{data.run.error}</p> : null}
            </section>

            <section className="awkit-detail-section">
              <h3>Node attempts ({data.attempts.length})</h3>
              {data.attempts.length === 0 ? (
                <p className="awkit-muted">No node attempts recorded for this run.</p>
              ) : (
                <div className="awkit-table-wrap">
                  <table className="awkit-table">
                    <thead>
                      <tr>
                        <th>Node</th>
                        <th>Try</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.attempts.map((attempt) => (
                        <tr key={attempt.attemptId}>
                          <td title={attempt.nodeId}>{attempt.nodeId}</td>
                          <td>{attempt.tryNumber}</td>
                          <td>
                            <StatusBadge tone={statusToTone(attempt.status)} label={attempt.status} />
                          </td>
                          <td>{formatDurationMs(attempt.durationMs)}</td>
                          <td className="awkit-muted">{attempt.errorClass ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="awkit-detail-section">
              <h3>Artifacts ({data.artifacts.length})</h3>
              {data.artifacts.length === 0 ? (
                <p className="awkit-muted">No artifacts recorded (traces/screenshots are captured on failure).</p>
              ) : (
                <ul className="awkit-artifact-list">
                  {data.artifacts.map((artifact) => (
                    <li key={`${artifact.kind}-${artifact.path}`}>
                      <span className="awkit-artifact-kind">{artifact.kind}</span>
                      <button type="button" className="awkit-link-button" onClick={() => openPath(artifact.path)} title={artifact.path}>
                        <FolderOpen size={13} /> Open folder
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
