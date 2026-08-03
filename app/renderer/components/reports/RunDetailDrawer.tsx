import { useEffect, useRef } from "react";
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

interface LegacyCompatibilityAttribution {
  flows: Array<{ flowId: string; flowName?: string; expiresAt?: string }>;
}

/** Parse the durable row's JSON snapshot (awkit-5dn). Malformed/absent JSON reads as "no grant". */
function parseLegacyCompatibility(json: string | undefined): LegacyCompatibilityAttribution | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as LegacyCompatibilityAttribution;
    return Array.isArray(parsed?.flows) && parsed.flows.length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
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

  // This is an `aria-modal` dialog, so it owes a keyboard user three things it did not previously
  // provide: focus moves in on open, Tab is trapped inside, Escape dismisses it, and focus returns
  // to whatever opened it. Without them a keyboard or screen-reader user who opened the drawer was
  // stranded — the same defect class as AWKIT-SET-004, which fixed `ConfirmDialog` but never
  // reached this drawer. The implementation deliberately mirrors `ConfirmDialog`'s.
  const drawerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    drawerRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) {
        event.preventDefault();
        drawerRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, []);

  return (
    <div className="awkit-drawer-scrim" role="dialog" aria-modal="true" aria-label="Run detail" onClick={onClose}>
      <aside ref={drawerRef} tabIndex={-1} className="awkit-drawer" onClick={(event) => event.stopPropagation()}>
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
              {(() => {
                const legacyCompatibility = parseLegacyCompatibility(data.run.legacyCompatibilityJson);
                if (!legacyCompatibility) return null;
                const names = legacyCompatibility.flows.map((flow) => flow.flowName ?? flow.flowId).join(", ");
                const earliestExpiry = legacyCompatibility.flows
                  .map((flow) => flow.expiresAt)
                  .filter((value): value is string => Boolean(value))
                  .sort()[0];
                return (
                  <span
                    className="state-pill pill-legacy"
                    data-validation="legacy-compatibility"
                    title={`This run was admitted because ${names} held a Legacy Compatibility grant${earliestExpiry ? `, earliest expiring ${earliestExpiry.slice(0, 10)}` : ""}.`}
                  >
                    Admitted under Legacy Compatibility: {names}
                  </span>
                );
              })()}
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
