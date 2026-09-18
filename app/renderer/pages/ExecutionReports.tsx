/**
 * ExecutionReports ("Run Artifacts") — stored run reports on the approved SpecterStudio design:
 * filter card, selectable report table with per-report open/export actions, and artifact widgets.
 *
 * Shows REAL reports only. No dummy/sample data: records marked demo/sample/seed are filtered out, and
 * every count and chart is derived from the stored reports' own screenshots, downloads and errors.
 */
import {
  Braces,
  Camera,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Hand,
  RefreshCw,
  Sheet,
  TriangleAlert,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConcurrentRunReport } from "@src/reports/ExecutionReport";
import { Permission } from "@src/security/authz/Permissions";
import { usePermissions } from "../security/usePermissions";
import { usePageChrome } from "../state/pageChrome";
import {
  SysBadge,
  SysBanner,
  SysButton,
  SysCellActions,
  SysCellText,
  SysChips,
  SysFilters,
  SysIconButton,
  SysMainCell,
  SysPage,
  SysPagination,
  SysTable,
  SysTableCard,
  SysTableEmpty,
  SysTdCheck,
  SysTh,
  SysThCheck,
  sortRows,
  useSysFilters,
  useSysPaging,
  useSysSelection,
  useSysSort,
  type SysFilterField,
  type SysTone
} from "../components/system/SystemUI";

// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
const DEMO_REPORTS_ENABLED = (import.meta as any).env?.VITE_ENABLE_DEMO_REPORTS === "true";

/** Persisted report contract returned by the main-owned report store. */
type StoredReport = ConcurrentRunReport & {
  id: string;
  /** Marker used to detect and clean up demo/seed records. */
  source?: string;
};

type ExportFormat = "json" | "csv" | "xlsx";

interface ReportFacts {
  screenshots: number;
  downloads: number;
  errors: number;
}

const OUTCOME: Record<string, { label: string; tone: SysTone; icon: LucideIcon; key: string }> = {
  passed: { label: "Succeeded", tone: "success", icon: CheckCircle2, key: "succeeded" },
  completed: { label: "Succeeded", tone: "success", icon: CheckCircle2, key: "succeeded" },
  failed: { label: "Failed", tone: "danger", icon: XCircle, key: "failed" },
  manualHandoff: { label: "Manual handoff", tone: "warning", icon: Hand, key: "handoff" }
};
const outcomeOf = (status: string) => OUTCOME[status] ?? { label: status, tone: "neutral" as SysTone, icon: FileText, key: status };

const FILTER_FIELDS: SysFilterField[] = [
  {
    key: "artifact",
    label: "Artifact",
    type: "select",
    options: [
      { value: "all", label: "Any" },
      { value: "screenshot", label: "Screenshot" },
      { value: "download", label: "Download" },
      { value: "error", label: "Error" }
    ]
  },
  {
    key: "outcome",
    label: "Outcome",
    type: "select",
    options: [
      { value: "all", label: "Any" },
      { value: "succeeded", label: "Succeeded" },
      { value: "failed", label: "Failed" },
      { value: "handoff", label: "Manual handoff" }
    ]
  },
  { key: "from", label: "From", type: "date" },
  { key: "run", label: "Run id", type: "text", placeholder: "execution id" }
];

function factsOf(report: StoredReport): ReportFacts {
  return report.instances.reduce(
    (facts, instance) => ({
      screenshots: facts.screenshots + (instance.screenshots?.length ?? 0),
      downloads: facts.downloads + (instance.downloadedFiles?.length ?? 0),
      errors: facts.errors + (instance.error ? 1 : 0)
    }),
    { screenshots: 0, downloads: 0, errors: 0 }
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return "—";
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

function startedLabel(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : at.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ExecutionReports() {
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { can } = usePermissions();
  const canExport = can(Permission.REPORT_EXPORT);
  const filters = useSysFilters();
  const { sort, toggle: toggleSort } = useSysSort("started", "desc");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = (await window.playwrightFlowStudio.reports.list()) as StoredReport[];
      // Filter out any records clearly marked as demo/sample/seed (Phase 05 cleanup).
      setReports(list.filter((r) => r.source !== "demo" && r.source !== "sample" && r.source !== "seed"));
    } catch (cause) {
      // IPC channel may not be wired yet — start empty, do not crash.
      setReports([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  usePageChrome(
    {
      actions: [
        {
          id: "refresh-reports",
          label: "Refresh",
          icon: <RefreshCw size={15} aria-hidden="true" />,
          onClick: () => void load(),
          title: "Reload the stored run reports"
        }
      ],
      dirty: false
    },
    [load]
  );

  const openReport = useCallback(async (report: StoredReport) => {
    setError("");
    try {
      const message = await window.playwrightFlowStudio.reports.openFolder(report.id);
      if (message) setError(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const exportReport = useCallback(async (report: StoredReport, format: ExportFormat) => {
    setError("");
    try {
      const reportsApi = window.playwrightFlowStudio.reports as typeof window.playwrightFlowStudio.reports & {
        export: (id: string, format?: ExportFormat) => Promise<{ filename: string; mimeType: string; dataBase64: string }>;
      };
      // Main owns serialization and redaction. XLSX is a real workbook, never renamed CSV bytes.
      const exported = await reportsApi.export(report.id, format);
      const bytes = Uint8Array.from(atob(exported.dataBase64), (character) => character.charCodeAt(0));
      const href = URL.createObjectURL(new Blob([bytes], { type: exported.mimeType }));
      const link = document.createElement("a");
      link.href = href;
      link.download = exported.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const facts = useMemo(() => new Map(reports.map((report) => [report.id, factsOf(report)])), [reports]);

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLocaleLowerCase();
    const { artifact, outcome, from, run } = filters.applied;
    const fromMs = from ? Date.parse(from) : Number.NaN;
    return reports.filter((report) => {
      const reportFacts = facts.get(report.id) ?? { screenshots: 0, downloads: 0, errors: 0 };
      if (artifact === "screenshot" && reportFacts.screenshots === 0) return false;
      if (artifact === "download" && reportFacts.downloads === 0) return false;
      if (artifact === "error" && reportFacts.errors === 0) return false;
      if (outcome && outcomeOf(String(report.status)).key !== outcome) return false;
      if (!Number.isNaN(fromMs) && Date.parse(report.startedAt) < fromMs) return false;
      if (run && !`${report.executionId} ${report.id}`.toLocaleLowerCase().includes(run.toLocaleLowerCase())) return false;
      if (!query) return true;
      const errors = report.instances.map((instance) => instance.error ?? "").join(" ");
      return `${report.scenarioName} ${report.scenarioId} ${report.executionId} ${report.id} ${report.status} ${errors}`.toLocaleLowerCase().includes(query);
    });
  }, [facts, filters.applied, filters.search, reports]);

  const sorted = useMemo(
    () =>
      sortRows(filtered, sort, {
        started: (report) => Date.parse(report.startedAt) || 0,
        outcome: (report) => outcomeOf(String(report.status)).label,
        duration: (report) => report.durationMs ?? 0,
        name: (report) => (report.scenarioName || report.scenarioId || "").toLocaleLowerCase()
      }),
    [filtered, sort]
  );
  const paging = useSysPaging(sorted.length);
  const pageRows = paging.slice(sorted);
  const selection = useSysSelection(pageRows.map((report) => report.id));
  const selectedReports = reports.filter((report) => selection.selected.includes(report.id));

  const downloadSelected = async () => {
    for (const report of selectedReports) await exportReport(report, "json");
  };

  return (
    <SysPage className="reports-page run-artifacts-page">
      <h1 className="sr-only">Run Artifacts</h1>
      {error ? <SysBanner tone="danger">{error}</SysBanner> : null}
      {DEMO_REPORTS_ENABLED ? (
        <SysBanner tone="warning">Demo reports are enabled (VITE_ENABLE_DEMO_REPORTS=true). Remove this flag before shipping.</SysBanner>
      ) : null}

      <SysFilters label="Run artifact filters" searchPlaceholder="Search run artifacts by workflow, run id or error…" fields={FILTER_FIELDS} state={filters} />

      <SysTableCard
        title="Stored run reports"
        selectionCount={selection.selected.length}
        actions={
          canExport ? (
            <>
              <SysButton kind="small" icon={Download} disabled={selectedReports.length === 0} onClick={() => void downloadSelected()} title="Export each selected report as JSON">
                Download selected
              </SysButton>
              <SysButton
                kind="small"
                icon={FolderOpen}
                disabled={selectedReports.length !== 1}
                onClick={() => void openReport(selectedReports[0])}
                title={selectedReports.length === 1 ? "Open the selected report folder" : "Select exactly one report"}
              >
                Open folder
              </SysButton>
            </>
          ) : null
        }
      >
        {loading ? (
          <SysTableEmpty icon={FileText} title="Loading reports…" />
        ) : reports.length === 0 ? (
          <SysTableEmpty
            id="reports-empty-state"
            icon={FileText}
            title="No reports yet"
            hint="Run a workflow to generate your first execution report. Reports appear here after a workflow completes."
          />
        ) : sorted.length === 0 ? (
          <SysTableEmpty
            icon={FileText}
            title="No rows match your filters"
            hint="Clear the applied filters to see all rows again."
            actionLabel="Clear filters"
            onAction={filters.clear}
          />
        ) : (
          <SysTable id="reports-list" minWidth={980} caption="Stored run reports">
            <thead>
              <tr>
                <SysThCheck checked={selection.allSelected} onChange={selection.toggleAll} />
                <SysTh label="Run" sortKey="name" sort={sort} onSort={toggleSort} />
                <SysTh label="Outcome" sortKey="outcome" sort={sort} onSort={toggleSort} width={150} />
                <SysTh label="Artifacts" width={220} />
                <SysTh label="Duration" sortKey="duration" sort={sort} onSort={toggleSort} align="right" width={110} />
                <SysTh label="Started" sortKey="started" sort={sort} onSort={toggleSort} width={150} />
                <SysTh label="" width={canExport ? 170 : 40} />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((report) => {
                const outcome = outcomeOf(String(report.status));
                const reportFacts = facts.get(report.id) ?? { screenshots: 0, downloads: 0, errors: 0 };
                const chips = [
                  reportFacts.screenshots ? plural(reportFacts.screenshots, "screenshot") : "",
                  reportFacts.downloads ? plural(reportFacts.downloads, "download") : "",
                  reportFacts.errors ? "error log" : ""
                ].filter(Boolean);
                const totalFlows = report.passedFlows + report.failedFlows + report.skippedFlows;
                const selected = selection.isSelected(report.id);
                return (
                  <tr key={report.id} className={`report-card${selected ? " is-selected" : ""}`}>
                    <SysTdCheck checked={selected} onChange={() => selection.toggle(report.id)} label={`Select ${report.scenarioName || report.id}`} />
                    <td>
                      <SysMainCell
                        tone={outcome.tone === "success" ? "running" : outcome.tone}
                        icon={outcome.tone === "danger" ? TriangleAlert : FileText}
                        text={report.scenarioName || report.scenarioId || "Workflow"}
                        textTitle={report.executionId}
                        sub={`${report.status} · ${plural(report.instances.length, "instance")}${totalFlows ? ` · ${report.passedFlows} of ${totalFlows} flows passed` : ""}`}
                      />
                    </td>
                    <td>
                      <SysBadge tone={outcome.tone} icon={outcome.icon}>
                        {outcome.label}
                      </SysBadge>
                    </td>
                    <td>{chips.length ? <SysChips items={chips} /> : <SysCellText muted>No files</SysCellText>}</td>
                    <td className="sys-td-actions">
                      <SysCellText num>{formatDuration(report.durationMs)}</SysCellText>
                    </td>
                    <td>
                      <SysCellText num muted title={new Date(report.startedAt).toLocaleString()}>
                        {startedLabel(report.startedAt)}
                      </SysCellText>
                    </td>
                    <td className="sys-td-actions">
                      {canExport ? (
                        <SysCellActions>
                          <SysIconButton id={`report-open-${report.id}`} icon={Eye} label="Open" title="Open report folder" onClick={() => void openReport(report)} />
                          <SysIconButton id={`report-export-${report.id}`} icon={Braces} label="Export JSON" title="Export report as JSON" onClick={() => void exportReport(report, "json")} />
                          <SysIconButton id={`report-export-csv-${report.id}`} icon={FileSpreadsheet} label="Export CSV" title="Export report as CSV" onClick={() => void exportReport(report, "csv")} />
                          <SysIconButton id={`report-export-xlsx-${report.id}`} icon={Sheet} label="Export Excel" title="Export report as Excel workbook" onClick={() => void exportReport(report, "xlsx")} />
                        </SysCellActions>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </SysTable>
        )}
        <SysPagination
          total={sorted.length}
          noun="reports"
          page={paging.page}
          pageSize={paging.pageSize}
          totalPages={paging.totalPages}
          onPage={paging.setPage}
          onPageSize={paging.setPageSize}
        />
      </SysTableCard>

      {reports.length > 0 ? <ArtifactWidgets reports={reports} facts={facts} /> : null}

      <SysBanner tone="info" icon={TriangleAlert}>
        Security policy: reports and logs mask secrets. MFA and CAPTCHA must use manual handoff and never bypass controls.
      </SysBanner>
    </SysPage>
  );
}

// ── Artifact widgets (design: KPI row, artifacts-per-day columns, artifact mix donut) ───────────────

const SERIES = [
  { key: "screenshots" as const, label: "Screenshots", color: "var(--awkit-chart-1)" },
  { key: "downloads" as const, label: "Downloads", color: "var(--awkit-chart-10)" },
  { key: "errors" as const, label: "Error logs", color: "var(--awkit-danger)" }
];

function sparkPath(values: number[], width: number, height: number, pad: number): { line: string; area: string } {
  if (values.length < 2) return { line: "", area: "" };
  const max = Math.max(...values) || 1;
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => [(index / (values.length - 1)) * width, height - pad - ((value - min) / span) * (height - pad * 2)]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return { line, area: `${line} L ${width} ${height} L 0 ${height} Z` };
}

function ArtifactWidgets({ reports, facts }: { reports: StoredReport[]; facts: Map<string, ReportFacts> }) {
  const totals = useMemo(() => {
    const sum = { screenshots: 0, downloads: 0, errors: 0 };
    for (const value of facts.values()) {
      sum.screenshots += value.screenshots;
      sum.downloads += value.downloads;
      sum.errors += value.errors;
    }
    return sum;
  }, [facts]);

  // Last 12 local days, oldest first, bucketed by each report's start date.
  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const buckets = Array.from({ length: 12 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() - (11 - index));
      return { day, reports: 0, screenshots: 0, downloads: 0, errors: 0 };
    });
    for (const report of reports) {
      const at = new Date(report.startedAt);
      if (Number.isNaN(at.getTime())) continue;
      at.setHours(0, 0, 0, 0);
      const bucket = buckets.find((candidate) => candidate.day.getTime() === at.getTime());
      if (!bucket) continue;
      const value = facts.get(report.id);
      bucket.reports += 1;
      bucket.screenshots += value?.screenshots ?? 0;
      bucket.downloads += value?.downloads ?? 0;
      bucket.errors += value?.errors ?? 0;
    }
    return buckets;
  }, [facts, reports]);

  const artifactTotal = totals.screenshots + totals.downloads + totals.errors;
  const failedReports = reports.filter((report) => outcomeOf(String(report.status)).key === "failed").length;
  const kpis = [
    { label: "Reports stored", value: reports.length, unit: "", icon: FileText, tone: "blue", note: `${failedReports} failed`, spark: days.map((day) => day.reports) },
    { label: "Screenshots", value: totals.screenshots, unit: "", icon: Camera, tone: "blue", note: "across stored reports", spark: days.map((day) => day.screenshots) },
    { label: "Downloads", value: totals.downloads, unit: "", icon: Download, tone: "green", note: "files captured by runs", spark: days.map((day) => day.downloads) },
    { label: "Error logs", value: totals.errors, unit: "", icon: TriangleAlert, tone: "rose", note: "instances with an error", spark: days.map((day) => day.errors) }
  ];
  const maxDay = Math.max(1, ...days.map((day) => day.screenshots + day.downloads + day.errors));
  const circumference = 2 * Math.PI * 58;
  let offset = 0;

  return (
    <div className="sys-widgets">
      <div className="sys-widget is-bare sys-widget-span-12">
        <div className="sys-kpis" role="list" aria-label="Artifact summary">
          {kpis.map((kpi) => {
            const path = sparkPath(kpi.spark, 72, 26, 4);
            const Icon = kpi.icon;
            return (
              <div className={`sys-kpi tone-${kpi.tone}`} role="listitem" key={kpi.label}>
                <div className="sys-kpi-head">
                  <span className="sys-kpi-tile" aria-hidden="true"><Icon size={15} strokeWidth={1.9} /></span>
                  <span className="sys-kpi-label">{kpi.label}</span>
                </div>
                <div className="sys-kpi-body">
                  <span className="sys-kpi-numbers">
                    <span className="sys-kpi-value">
                      <strong>{kpi.value.toLocaleString()}</strong>
                      {kpi.unit ? <span>{kpi.unit}</span> : null}
                    </span>
                    <span className="sys-kpi-note">{kpi.note}</span>
                  </span>
                  {path.line ? (
                    <svg className="sys-kpi-spark" viewBox="0 0 72 26" preserveAspectRatio="none" aria-hidden="true">
                      <path d={path.area} className="sys-kpi-spark-area" />
                      <path d={path.line} className="sys-kpi-spark-line" vectorEffect="non-scaling-stroke" />
                    </svg>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <section className="sys-widget sys-widget-span-7" aria-label="Artifacts per day">
        <div className="sys-widget-head">
          <div>
            <span className="sys-widget-title">Artifacts per day</span>
            <span className="sys-widget-sub">By artifact type</span>
          </div>
          <span className="sys-spacer" />
          <span className="sys-widget-tag">Last 12 days</span>
        </div>
        <div className="sys-columns" role="img" aria-label={`Artifacts per day for the last 12 days, ${artifactTotal} in total`}>
          {days.map((day) => {
            const total = day.screenshots + day.downloads + day.errors;
            return (
              <span className="sys-column" key={day.day.toISOString()}>
                <span className="sys-column-value">{total || ""}</span>
                <span className="sys-column-stack" style={{ height: `${(total / maxDay) * 100}%` }}>
                  {SERIES.map((series) =>
                    day[series.key] ? (
                      <span key={series.key} style={{ height: `${(day[series.key] / total) * 100}%`, background: series.color }} />
                    ) : null
                  )}
                </span>
              </span>
            );
          })}
        </div>
        <div className="sys-column-labels" aria-hidden="true">
          {days.map((day) => (
            <span key={day.day.toISOString()}>{day.day.getDate()}</span>
          ))}
        </div>
        <div className="sys-widget-legend">
          {SERIES.map((series) => (
            <span key={series.key}>
              <span className="sys-legend-swatch" style={{ background: series.color }} />
              {series.label}
            </span>
          ))}
        </div>
      </section>

      <section className="sys-widget sys-widget-span-5" aria-label="Artifact mix">
        <div className="sys-widget-head">
          <div>
            <span className="sys-widget-title">Artifact mix</span>
            <span className="sys-widget-sub">Files retained with the stored reports</span>
          </div>
          <span className="sys-spacer" />
          <span className="sys-widget-tag">{plural(artifactTotal, "file")}</span>
        </div>
        <div className="sys-donut">
          <div className="sys-donut-ring">
            <svg viewBox="0 0 148 148" aria-hidden="true">
              <circle cx="74" cy="74" r="58" fill="none" className="sys-donut-track" strokeWidth="17" />
              {SERIES.map((series) => {
                const value = totals[series.key];
                if (!artifactTotal || !value) return null;
                const length = (value / artifactTotal) * circumference;
                const dash = `${length.toFixed(2)} ${(circumference - length).toFixed(2)}`;
                const arc = <circle key={series.key} cx="74" cy="74" r="58" fill="none" stroke={series.color} strokeWidth="17" strokeDasharray={dash} strokeDashoffset={(-offset).toFixed(2)} />;
                offset += length;
                return arc;
              })}
            </svg>
            <div className="sys-donut-center">
              <strong>{artifactTotal.toLocaleString()}</strong>
              <span>Files</span>
            </div>
          </div>
          <div className="sys-donut-legend" role="list" aria-label="Artifact mix">
            {SERIES.map((series) => (
              <div role="listitem" key={series.key}>
                <span className="sys-legend-swatch is-square" style={{ background: series.color }} />
                <span className="sys-donut-label">{series.label}</span>
                <span className="sys-spacer" />
                <strong>{totals[series.key].toLocaleString()}</strong>
                <span className="sys-donut-pct">{artifactTotal ? `${Math.round((totals[series.key] / artifactTotal) * 100)}%` : "0%"}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
