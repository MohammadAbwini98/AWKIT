import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ListChecks, Workflow } from "lucide-react";
import type { RunHistoryPage, TelemetryRangePreset, WorkflowReportRow } from "@src/reports/TelemetryContracts";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { StatusBadge } from "../components/shared/StatusBadge";
import { ReportPage } from "../components/reports/ReportPage";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";
import { RunDetailDrawer } from "../components/reports/RunDetailDrawer";
import { formatDurationMs, formatWhen, statusToTone } from "../components/reports/statusTone";

type SortKey = "scenarioName" | "totalRuns" | "successRate" | "avgMs" | "p95Ms" | "retryCount";

function sortValue(row: WorkflowReportRow, key: SortKey): number | string {
  switch (key) {
    case "scenarioName":
      return (row.scenarioName ?? row.scenarioId ?? "").toLowerCase();
    case "avgMs":
      return row.duration.avgMs ?? -1;
    case "p95Ms":
      return row.duration.p95Ms ?? -1;
    default:
      return row[key];
  }
}

export function ReportsWorkflows() {
  const [range, setRange] = useState<TelemetryRangePreset>("24h");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "totalRuns", dir: "desc" });
  const [selected, setSelected] = useState<{ scenarioId?: string; name: string } | null>(null);
  const [runInstanceId, setRunInstanceId] = useState<string | null>(null);

  const { data, loading, error, refetch } = useTelemetryQuery<WorkflowReportRow[]>(
    () => window.playwrightFlowStudio.telemetry.workflows(range),
    [range]
  );

  const sorted = useMemo(() => {
    if (!data) return [];
    const rows = [...data];
    rows.sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      const cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const SortHeader = ({ label, col, numeric }: { label: string; col: SortKey; numeric?: boolean }) => (
    <th className={numeric ? "awkit-th-numeric" : ""}>
      <button type="button" className="awkit-sort-header" onClick={() => toggleSort(col)}>
        {label}
        {sort.key === col ? sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} /> : null}
      </button>
    </th>
  );

  return (
    <ReportPage
      title="Workflow Reports"
      description="Per-workflow run counts, success rate, and durations. Click a row for recent runs."
      icon={<Workflow size={18} />}
      range={range}
      onRangeChange={setRange}
      onRefresh={refetch}
      refreshing={loading}
    >
      {loading && !data ? (
        <SkeletonCard variant="chart" />
      ) : error ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="Could not load workflow reports" hint={error} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={28} />}
          title="No workflow runs in this range yet"
          hint="Run a workflow from the Instances page to populate per-workflow statistics."
        />
      ) : (
        <>
          <div className="awkit-table-wrap work-panel awkit-report-panel">
            <table className="awkit-table awkit-table-hover">
              <thead>
                <tr>
                  <SortHeader label="Workflow" col="scenarioName" />
                  <SortHeader label="Runs" col="totalRuns" numeric />
                  <SortHeader label="Success" col="successRate" numeric />
                  <SortHeader label="Avg" col="avgMs" numeric />
                  <SortHeader label="p95" col="p95Ms" numeric />
                  <SortHeader label="Retries" col="retryCount" numeric />
                  <th>Last run</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const key = row.scenarioId ?? row.scenarioName ?? "unknown";
                  const isSelected = selected?.scenarioId === row.scenarioId;
                  return (
                    <tr
                      key={key}
                      className={isSelected ? "is-selected" : ""}
                      onClick={() => setSelected({ scenarioId: row.scenarioId, name: row.scenarioName ?? row.scenarioId ?? "Workflow" })}
                    >
                      <td>{row.scenarioName ?? row.scenarioId ?? "(unknown)"}</td>
                      <td className="awkit-td-numeric">{row.totalRuns}</td>
                      <td className="awkit-td-numeric">{(row.successRate * 100).toFixed(0)}%</td>
                      <td className="awkit-td-numeric">{formatDurationMs(row.duration.avgMs)}</td>
                      <td className="awkit-td-numeric">{formatDurationMs(row.duration.p95Ms)}</td>
                      <td className="awkit-td-numeric">{row.retryCount}</td>
                      <td>{row.lastRunStatus ? <StatusBadge tone={statusToTone(row.lastRunStatus)} label={row.lastRunStatus} /> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected ? (
            <RecentRuns
              scenarioId={selected.scenarioId}
              name={selected.name}
              range={range}
              onOpenRun={setRunInstanceId}
              onClose={() => setSelected(null)}
            />
          ) : null}
        </>
      )}

      {runInstanceId ? <RunDetailDrawer instanceId={runInstanceId} onClose={() => setRunInstanceId(null)} /> : null}
    </ReportPage>
  );
}

function RecentRuns({
  scenarioId,
  name,
  range,
  onOpenRun,
  onClose
}: {
  scenarioId?: string;
  name: string;
  range: TelemetryRangePreset;
  onOpenRun: (instanceId: string) => void;
  onClose: () => void;
}) {
  const { data, loading } = useTelemetryQuery<RunHistoryPage>(
    () => window.playwrightFlowStudio.telemetry.runHistory(range, { limit: 25 }, { scenarioId }),
    [scenarioId, range]
  );

  return (
    <section className="work-panel awkit-report-panel">
      <div className="awkit-report-panel-head">
        <div>
          <strong>Recent runs — {name}</strong>
          <span>{data ? `${data.total} run(s) in range` : "loading…"}</span>
        </div>
        <button type="button" className="awkit-icon-button" onClick={onClose} aria-label="Close recent runs">
          ×
        </button>
      </div>
      {loading && !data ? (
        <SkeletonCard lines={3} />
      ) : !data || data.rows.length === 0 ? (
        <p className="awkit-muted">No runs recorded for this workflow in the selected range.</p>
      ) : (
        <div className="awkit-table-wrap">
          <table className="awkit-table awkit-table-hover">
            <thead>
              <tr>
                <th>Status</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Category</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((run) => (
                <tr key={run.instanceId} onClick={() => onOpenRun(run.instanceId)}>
                  <td>
                    <StatusBadge tone={statusToTone(run.status)} label={run.status} />
                  </td>
                  <td>{formatWhen(run.startedAt)}</td>
                  <td>{formatDurationMs(run.durationMs)}</td>
                  <td className="awkit-muted">{run.reportCategory ?? "—"}</td>
                  <td className="awkit-td-numeric">
                    <button type="button" className="awkit-link-button" onClick={() => onOpenRun(run.instanceId)}>
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
