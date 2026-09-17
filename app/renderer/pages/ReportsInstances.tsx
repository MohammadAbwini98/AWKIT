import { useEffect, useState } from "react";
import { Activity, AlertTriangle, ChevronLeft, ChevronRight, ListChecks, MonitorDot, PauseCircle } from "lucide-react";
import type { RunHistoryPage, TelemetryRangePreset } from "@src/reports/TelemetryContracts";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { StatusBadge } from "../components/shared/StatusBadge";
import { MetricCard } from "../components/shared/MetricCard";
import { ReportPage } from "../components/reports/ReportPage";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";
import { RunDetailDrawer } from "../components/reports/RunDetailDrawer";
import { formatDurationMs, formatWhen, statusToTone } from "../components/reports/statusTone";

const DISTRIBUTION_ORDER = ["running", "starting", "waitingForManualAction", "queued", "pending", "completed", "failed", "cancelled"];
const PAGE_SIZE = 25;

/** Live instance status distribution, polled every 2s (cleaned up on unmount). */
function useLiveDistribution(): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const instances = (await window.playwrightFlowStudio.executions.list()) as Array<{ status?: string }>;
        if (!active) return;
        const next: Record<string, number> = {};
        for (const instance of instances) {
          const status = String(instance.status ?? "unknown");
          next[status] = (next[status] ?? 0) + 1;
        }
        setCounts(next);
      } catch {
        /* transient IPC failure — keep the last snapshot */
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return counts;
}

export function ReportsInstances() {
  const [range, setRange] = useState<TelemetryRangePreset>("24h");
  const [offset, setOffset] = useState(0);
  const [runInstanceId, setRunInstanceId] = useState<string | null>(null);
  const distribution = useLiveDistribution();

  const { data, loading, error, refetch } = useTelemetryQuery<RunHistoryPage>(
    () => window.playwrightFlowStudio.telemetry.runHistory(range, { limit: PAGE_SIZE, offset }),
    [range, offset]
  );

  const liveStatuses = DISTRIBUTION_ORDER.filter((status) => (distribution[status] ?? 0) > 0);
  const liveTotal = Object.values(distribution).reduce((sum, value) => sum + value, 0);
  const activeTotal = (distribution.running ?? 0) + (distribution.starting ?? 0);
  const queuedTotal = (distribution.queued ?? 0) + (distribution.pending ?? 0);
  const manualTotal = distribution.waitingForManualAction ?? 0;

  return (
    <ReportPage
      title="Instance Reports"
      description="Live instance status distribution and historical run activity."
      icon={<MonitorDot size={18} />}
      range={range}
      onRangeChange={(next) => {
        setRange(next);
        setOffset(0);
      }}
      onRefresh={refetch}
      refreshing={loading}
    >
      <div className="awkit-report-widget-grid">
      <div className="page-grid metrics-grid">
        <MetricCard label="Active instances" value={activeTotal} detail="Running or starting now" icon={<Activity size={22} />} tone={activeTotal > 0 ? "success" : "default"} />
        <MetricCard label="Queued" value={queuedTotal} detail="Waiting for a runtime slot" icon={<ListChecks size={22} />} />
        <MetricCard label="Manual handoffs" value={manualTotal} detail="Awaiting operator action" icon={<PauseCircle size={22} />} tone={manualTotal > 0 ? "warning" : "default"} />
        <MetricCard label="Runs in range" value={data?.total ?? "—"} detail="Historical workflow instances" icon={<MonitorDot size={22} />} />
      </div>

      <section className="work-panel awkit-report-panel awkit-report-span-4">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Live status</strong>
            <span>{liveTotal === 0 ? "No instances in the pool right now" : `${liveTotal} instance(s) in the pool`}</span>
          </div>
        </div>
        {liveStatuses.length === 0 ? (
          <p className="awkit-muted">Nothing running. Start a workflow from the Instances page to see live status here.</p>
        ) : (
          <div className="awkit-distribution">
            {liveStatuses.map((status) => (
              <div className="awkit-distribution-item" key={status}>
                <StatusBadge tone={statusToTone(status)} label={status} />
                <strong>{distribution[status]}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-8">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Run history</strong>
            <span>{data ? `${data.total} run(s) in range` : "loading…"}</span>
          </div>
        </div>
        {loading && !data ? (
          <SkeletonCard lines={4} />
        ) : error ? (
          <EmptyState icon={<AlertTriangle size={28} />} title="Could not load run history" hint={error} compact />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState icon={<ListChecks size={28} />} title="No runs in this range yet" hint="Completed runs appear here with their duration and outcome." compact />
        ) : (
          <>
            <div className="awkit-table-wrap">
              <table className="awkit-table awkit-table-hover">
                <thead>
                  <tr>
                    <th>Workflow</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>Queue</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((run) => (
                    <tr key={run.instanceId} onClick={() => setRunInstanceId(run.instanceId)}>
                      <td>{run.scenarioName ?? run.scenarioId ?? "(unknown)"}</td>
                      <td>
                        <StatusBadge tone={statusToTone(run.status)} label={run.status} />
                      </td>
                      <td>{formatWhen(run.startedAt)}</td>
                      <td>{formatDurationMs(run.durationMs)}</td>
                      <td>{formatDurationMs(run.queueWaitMs)}</td>
                      <td className="awkit-td-numeric">
                        <button type="button" className="awkit-link-button" onClick={() => setRunInstanceId(run.instanceId)}>
                          Details
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="awkit-pager">
              <button type="button" className="awkit-icon-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label="Previous page">
                <ChevronLeft size={16} />
              </button>
              <span className="awkit-muted">
                {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
              </span>
              <button
                type="button"
                className="awkit-icon-button"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </>
        )}
      </section>
      </div>

      {runInstanceId ? <RunDetailDrawer instanceId={runInstanceId} onClose={() => setRunInstanceId(null)} /> : null}
    </ReportPage>
  );
}
