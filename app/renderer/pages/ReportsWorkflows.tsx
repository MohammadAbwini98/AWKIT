import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, GitCompare, ListChecks, Minus, TrendingDown, TrendingUp, Workflow } from "lucide-react";
import type {
  MachineFilter,
  MachineSummary,
  RunHistoryPage,
  TelemetryRangePreset,
  WorkflowComparisonRow,
  WorkflowTrend
} from "@src/reports/TelemetryContracts";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { StatusBadge } from "../components/shared/StatusBadge";
import { ReportPage } from "../components/reports/ReportPage";
import { MetricSparkline } from "../components/reports/MetricSparkline";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";
import { RunDetailDrawer } from "../components/reports/RunDetailDrawer";
import { formatDurationMs, formatWhen, statusToTone } from "../components/reports/statusTone";

type SortKey = "scenarioName" | "totalRuns" | "successRate" | "avgMs" | "p95Ms" | "retryCount";

function sortValue(row: WorkflowComparisonRow, key: SortKey): number | string {
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

/** Stable key for a comparison row (workflows without a scenarioId fall back to their name). */
function rowKey(row: { scenarioId?: string; scenarioName?: string }): string {
  return row.scenarioId ?? row.scenarioName ?? "unknown";
}

/** Short, human-ish machine label for the filter dropdown. */
function machineLabel(machine: MachineSummary): string {
  const parts: string[] = [];
  if (machine.logicalCpuCount) parts.push(`${machine.logicalCpuCount}-core`);
  if (machine.totalMemoryMb) parts.push(`${Math.round(machine.totalMemoryMb / 1024)} GB`);
  parts.push(machine.machineId ? machine.machineId.slice(0, 8) : "unknown");
  return parts.join(" · ");
}

/** Distinct, defined, sorted values of one machine-context field seen in history. */
function distinct(machines: MachineSummary[], pick: (m: MachineSummary) => string | undefined): string[] {
  const set = new Set<string>();
  for (const machine of machines) {
    const value = pick(machine);
    if (value) set.add(value);
  }
  return [...set].sort();
}

export function ReportsWorkflows() {
  const [range, setRange] = useState<TelemetryRangePreset>("24h");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "totalRuns", dir: "desc" });
  const [selected, setSelected] = useState<{ scenarioId?: string; name: string } | null>(null);
  const [runInstanceId, setRunInstanceId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MachineFilter>({});
  const [compareMode, setCompareMode] = useState(false);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const [currentMachineId, setCurrentMachineId] = useState<string | undefined>(undefined);

  // Detect this machine once so the filter can offer a "This machine" shortcut.
  useEffect(() => {
    let cancelled = false;
    window.playwrightFlowStudio.system
      .capacityPreview()
      .then((preview) => {
        if (!cancelled) setCurrentMachineId(preview.capabilities.machineId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Machines seen in the current range, to populate the filter option lists.
  const { data: machines } = useTelemetryQuery<MachineSummary[]>(
    () => window.playwrightFlowStudio.telemetry.machines(range),
    [range]
  );

  // Serialize the filter so object identity doesn't retrigger every render.
  const filterKey = useMemo(() => JSON.stringify(filter), [filter]);
  const activeFilter = useMemo<MachineFilter | undefined>(() => (filterKey === "{}" ? undefined : filter), [filterKey, filter]);

  const { data, loading, error, refetch } = useTelemetryQuery<WorkflowComparisonRow[]>(
    () => window.playwrightFlowStudio.telemetry.workflowComparison(range, activeFilter),
    [range, filterKey]
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

  const compareRows = useMemo(() => sorted.filter((row) => compareKeys.includes(rowKey(row))), [sorted, compareKeys]);

  const toggleSort = (key: SortKey) =>
    setSort((current) => (current.key === key ? { key, dir: current.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const patchFilter = (patch: Partial<MachineFilter>) =>
    setFilter((current) => {
      const next = { ...current, ...patch };
      // Drop empty-string selections so they don't count as an active filter.
      for (const field of Object.keys(next) as (keyof MachineFilter)[]) {
        if (!next[field]) delete next[field];
      }
      return next;
    });

  const toggleCompare = (row: WorkflowComparisonRow) => {
    const key = rowKey(row);
    setCompareKeys((keys) => {
      if (keys.includes(key)) return keys.filter((k) => k !== key);
      if (keys.length >= 4) return keys; // cap at 4 side-by-side
      return [...keys, key];
    });
  };

  const SortHeader = ({ label, col, numeric }: { label: string; col: SortKey; numeric?: boolean }) => (
    <th className={numeric ? "awkit-th-numeric" : ""}>
      <button type="button" className="awkit-sort-header" onClick={() => toggleSort(col)}>
        {label}
        {sort.key === col ? sort.dir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} /> : null}
      </button>
    </th>
  );

  const modeOptions = distinct(machines ?? [], (m) => m.executionMode);
  const poolOptions = distinct(machines ?? [], (m) => m.browserPoolMode);
  const classOptions = distinct(machines ?? [], (m) => m.workloadClass);

  return (
    <ReportPage
      title="Workflow Reports"
      description="Per-workflow success rate and durations vs the previous window, filterable by machine. Click a row for recent runs."
      icon={<Workflow size={18} />}
      range={range}
      onRangeChange={setRange}
      onRefresh={refetch}
      refreshing={loading}
    >
      <div className="awkit-report-filters" role="group" aria-label="Report filters">
        <label className="awkit-filter-field">
          <span>Machine</span>
          <select
            value={filter.machineId ?? ""}
            onChange={(event) => patchFilter({ machineId: event.target.value || undefined })}
            aria-label="Filter by machine"
          >
            <option value="">All machines</option>
            {currentMachineId ? <option value={currentMachineId}>This machine</option> : null}
            {(machines ?? []).map((machine) => (
              <option key={machine.machineId ?? "unknown"} value={machine.machineId ?? ""} disabled={!machine.machineId}>
                {machineLabel(machine)} ({machine.runs})
              </option>
            ))}
          </select>
        </label>

        <label className="awkit-filter-field">
          <span>Mode</span>
          <select value={filter.executionMode ?? ""} onChange={(event) => patchFilter({ executionMode: event.target.value || undefined })} aria-label="Filter by execution mode">
            <option value="">Any mode</option>
            {modeOptions.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </select>
        </label>

        <label className="awkit-filter-field">
          <span>Browsers</span>
          <select value={filter.browserPoolMode ?? ""} onChange={(event) => patchFilter({ browserPoolMode: event.target.value || undefined })} aria-label="Filter by browser pool mode">
            <option value="">Any pool</option>
            {poolOptions.map((pool) => (
              <option key={pool} value={pool}>
                {pool}
              </option>
            ))}
          </select>
        </label>

        <label className="awkit-filter-field">
          <span>Workload</span>
          <select value={filter.workloadClass ?? ""} onChange={(event) => patchFilter({ workloadClass: event.target.value || undefined })} aria-label="Filter by workload class">
            <option value="">Any workload</option>
            {classOptions.map((cls) => (
              <option key={cls} value={cls}>
                {cls}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={`awkit-filter-toggle${compareMode ? " is-active" : ""}`}
          aria-pressed={compareMode}
          onClick={() => {
            setCompareMode((on) => !on);
            setCompareKeys([]);
          }}
        >
          <GitCompare size={14} /> Compare
        </button>
      </div>

      {loading && !data ? (
        <SkeletonCard variant="chart" />
      ) : error ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="Could not load workflow reports" hint={error} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={28} />}
          title="No workflow runs match this filter"
          hint="Run a workflow from the Instances page, or clear the machine filter, to populate per-workflow statistics."
        />
      ) : (
        <>
          <div className="awkit-table-wrap work-panel awkit-report-panel">
            <table className="awkit-table awkit-table-hover">
              <thead>
                <tr>
                  {compareMode ? <th className="awkit-th-select" aria-label="Compare" /> : null}
                  <SortHeader label="Workflow" col="scenarioName" />
                  <SortHeader label="Runs" col="totalRuns" numeric />
                  <SortHeader label="Success" col="successRate" numeric />
                  <SortHeader label="Avg" col="avgMs" numeric />
                  <SortHeader label="p95" col="p95Ms" numeric />
                  <th className="awkit-th-numeric">Trend</th>
                  <th>Last run</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const key = rowKey(row);
                  const isSelected = selected?.scenarioId === row.scenarioId && !compareMode;
                  const isChecked = compareKeys.includes(key);
                  return (
                    <tr
                      key={key}
                      className={isSelected || (compareMode && isChecked) ? "is-selected" : ""}
                      onClick={() =>
                        compareMode
                          ? toggleCompare(row)
                          : setSelected({ scenarioId: row.scenarioId, name: row.scenarioName ?? row.scenarioId ?? "Workflow" })
                      }
                    >
                      {compareMode ? (
                        <td className="awkit-td-select">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={!isChecked && compareKeys.length >= 4}
                            onChange={() => toggleCompare(row)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Compare ${row.scenarioName ?? row.scenarioId ?? "workflow"}`}
                          />
                        </td>
                      ) : null}
                      <td>
                        <span className="awkit-wf-name">
                          <TrendIcon trend={row.trend} />
                          {row.scenarioName ?? row.scenarioId ?? "(unknown)"}
                        </span>
                        <MachineContextLine context={row.machineContext} />
                      </td>
                      <td className="awkit-td-numeric">
                        {row.totalRuns}
                        <DeltaChip value={row.delta.totalRuns} kind="count" />
                      </td>
                      <td className="awkit-td-numeric">
                        {(row.successRate * 100).toFixed(0)}%
                        <DeltaChip value={row.delta.successRate} kind="rate" higherIsBetter />
                      </td>
                      <td className="awkit-td-numeric">
                        {formatDurationMs(row.duration.avgMs)}
                        <DeltaChip value={row.delta.avgMs} kind="duration" />
                      </td>
                      <td className="awkit-td-numeric">
                        {formatDurationMs(row.duration.p95Ms)}
                        <DeltaChip value={row.delta.p95Ms} kind="duration" />
                      </td>
                      <td className="awkit-td-trend">
                        <WorkflowSparkline scenarioId={row.scenarioId} range={range} filter={activeFilter} filterKey={filterKey} />
                      </td>
                      <td>{row.lastRunStatus ? <StatusBadge tone={statusToTone(row.lastRunStatus)} label={row.lastRunStatus} /> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {compareMode ? (
            <ComparePanel rows={compareRows} range={range} filter={activeFilter} filterKey={filterKey} />
          ) : selected ? (
            <RecentRuns
              scenarioId={selected.scenarioId}
              name={selected.name}
              range={range}
              filter={activeFilter}
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

/** Overall trend glyph next to the workflow name. */
function TrendIcon({ trend }: { trend: WorkflowComparisonRow["trend"] }) {
  if (trend === "new") return <span className="awkit-trend-badge is-new" title="New this window">new</span>;
  if (trend === "up") return <TrendingUp size={14} className="awkit-trend-up" aria-label="Improving vs previous window" />;
  if (trend === "down") return <TrendingDown size={14} className="awkit-trend-down" aria-label="Declining vs previous window" />;
  return <Minus size={14} className="awkit-trend-flat" aria-label="Flat vs previous window" />;
}

type DeltaKind = "rate" | "duration" | "count";

/**
 * A ▲/▼ chip showing a metric's change vs the previous window. Color is by *goodness*: a green chip
 * means the change is favorable (higher success rate, or lower duration). `count` is neutral.
 */
function DeltaChip({ value, kind, higherIsBetter }: { value: number | undefined; kind: DeltaKind; higherIsBetter?: boolean }) {
  if (value === undefined || value === 0 || Number.isNaN(value)) return null;
  const up = value > 0;
  let tone: "up" | "down" | "neutral" = "neutral";
  if (kind !== "count") tone = up === Boolean(higherIsBetter) ? "up" : "down";

  let text: string;
  if (kind === "rate") text = `${up ? "+" : ""}${(value * 100).toFixed(1)} pts`;
  else if (kind === "duration") text = `${up ? "+" : "−"}${formatDurationMs(Math.abs(value))}`;
  else text = `${up ? "+" : ""}${value}`;

  return (
    <span className={`awkit-delta-chip is-${tone}`}>
      {up ? "▲" : "▼"} {text}
    </span>
  );
}

/** Compact machine-context caption under a workflow name (representative run in this window). */
function MachineContextLine({ context }: { context?: WorkflowComparisonRow["machineContext"] }) {
  if (!context) return null;
  const bits: string[] = [];
  if (context.executionMode) bits.push(context.executionMode);
  if (context.browserPoolMode) bits.push(context.browserPoolMode);
  if (context.workloadClass) bits.push(context.workloadClass);
  if (context.logicalCpuCount) bits.push(`${context.logicalCpuCount}c`);
  if (context.machineId) bits.push(context.machineId.slice(0, 8));
  if (bits.length === 0) return null;
  return <span className="awkit-wf-machine">{bits.join(" · ")}</span>;
}

/** Lazily loads a workflow's success-rate trend and renders a compact sparkline. */
function WorkflowSparkline({
  scenarioId,
  range,
  filter,
  filterKey
}: {
  scenarioId?: string;
  range: TelemetryRangePreset;
  filter?: MachineFilter;
  filterKey: string;
}) {
  const { data } = useTelemetryQuery<WorkflowTrend>(
    () => window.playwrightFlowStudio.telemetry.workflowTrend(scenarioId, range, filter),
    [scenarioId, range, filterKey]
  );
  const values = (data?.points ?? []).map((point) => point.successRate * 100);
  if (values.length < 2) return <span className="awkit-muted awkit-trend-empty">—</span>;
  return <MetricSparkline values={values} width={120} height={28} ariaLabel="Success-rate trend" stroke="var(--awkit-success)" />;
}

/** Side-by-side comparison of 2–4 selected workflows (Compare mode). */
function ComparePanel({
  rows,
  range,
  filter,
  filterKey
}: {
  rows: WorkflowComparisonRow[];
  range: TelemetryRangePreset;
  filter?: MachineFilter;
  filterKey: string;
}) {
  return (
    <section className="work-panel awkit-report-panel">
      <div className="awkit-report-panel-head">
        <div>
          <strong>Compare workflows</strong>
          <span>{rows.length < 2 ? "Select 2–4 workflows to compare" : `${rows.length} selected`}</span>
        </div>
      </div>
      {rows.length < 2 ? (
        <p className="awkit-muted">Tick the checkboxes on the left to place workflows side by side.</p>
      ) : (
        <div className="awkit-compare-grid">
          {rows.map((row) => (
            <div key={rowKey(row)} className="awkit-compare-card">
              <strong className="awkit-compare-title">{row.scenarioName ?? row.scenarioId ?? "(unknown)"}</strong>
              <WorkflowSparkline scenarioId={row.scenarioId} range={range} filter={filter} filterKey={filterKey} />
              <dl className="awkit-compare-stats">
                <div>
                  <dt>Runs</dt>
                  <dd>
                    {row.totalRuns}
                    <DeltaChip value={row.delta.totalRuns} kind="count" />
                  </dd>
                </div>
                <div>
                  <dt>Success</dt>
                  <dd>
                    {(row.successRate * 100).toFixed(0)}%
                    <DeltaChip value={row.delta.successRate} kind="rate" higherIsBetter />
                  </dd>
                </div>
                <div>
                  <dt>Avg</dt>
                  <dd>
                    {formatDurationMs(row.duration.avgMs)}
                    <DeltaChip value={row.delta.avgMs} kind="duration" />
                  </dd>
                </div>
                <div>
                  <dt>p95</dt>
                  <dd>
                    {formatDurationMs(row.duration.p95Ms)}
                    <DeltaChip value={row.delta.p95Ms} kind="duration" />
                  </dd>
                </div>
              </dl>
              <MachineContextLine context={row.machineContext} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecentRuns({
  scenarioId,
  name,
  range,
  filter,
  onOpenRun,
  onClose
}: {
  scenarioId?: string;
  name: string;
  range: TelemetryRangePreset;
  filter?: MachineFilter;
  onOpenRun: (instanceId: string) => void;
  onClose: () => void;
}) {
  const filterKey = useMemo(() => JSON.stringify(filter ?? {}), [filter]);
  const { data, loading } = useTelemetryQuery<RunHistoryPage>(
    () => window.playwrightFlowStudio.telemetry.runHistory(range, { limit: 25 }, { ...filter, scenarioId }),
    [scenarioId, range, filterKey]
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
