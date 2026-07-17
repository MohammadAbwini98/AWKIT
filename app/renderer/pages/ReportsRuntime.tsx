import { useState } from "react";
import { Activity, AlertTriangle, Cpu, Gauge, LineChart, ListChecks, ShieldAlert } from "lucide-react";
import type { ProcessHistoryPoint, RuntimeSeriesPoint, TelemetryRangePreset } from "@src/reports/TelemetryContracts";
import type { AnomalyEvent, CapacityAnalytics, CapacityMetricStats, RuntimeObservabilitySummary } from "@src/reports/ObservabilityContracts";
import { MetricCard } from "../components/shared/MetricCard";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { ConsumptionTimeline, type TimelineSeries } from "../components/reports/ConsumptionTimeline";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";
import { formatWhen } from "../components/reports/statusTone";

interface RuntimeHistory {
  series: RuntimeSeriesPoint[];
  processes: ProcessHistoryPoint[];
  capacity: CapacityAnalytics;
  anomalies: AnomalyEvent[];
  summary: RuntimeObservabilitySummary;
}

function epoch(iso: string): number {
  return Date.parse(iso);
}

/** Build a timeline series, dropping points whose value is undefined (leaves gaps). */
function seriesFrom<T>(points: T[], getX: (p: T) => number, getY: (p: T) => number | undefined, label: string, color: string): TimelineSeries {
  return {
    label,
    color,
    points: points
      .map((p) => ({ x: getX(p), y: getY(p) }))
      .filter((p): p is { x: number; y: number } => p.y !== undefined && !Number.isNaN(p.x))
  };
}

function maxBy<T>(points: T[], getY: (p: T) => number | undefined): number | undefined {
  const values = points.map(getY).filter((v): v is number => v !== undefined);
  return values.length ? Math.max(...values) : undefined;
}

export function ReportsRuntime() {
  const [range, setRange] = useState<TelemetryRangePreset>("24h");

  const { data, loading, error, refetch } = useTelemetryQuery<RuntimeHistory>(async () => {
    const [series, processes, capacity, anomalies, summary] = await Promise.all([
      window.playwrightFlowStudio.telemetry.runtimeSeries(range),
      window.playwrightFlowStudio.telemetry.processHistory(range, 500),
      window.playwrightFlowStudio.telemetry.capacityAnalytics(range),
      window.playwrightFlowStudio.telemetry.anomalies(range, undefined, 100),
      window.playwrightFlowStudio.telemetry.observabilitySummary()
    ]);
    return { series, processes, capacity, anomalies, summary };
  }, [range]);

  const empty =
    data && data.series.length === 0 && data.processes.length === 0 && data.capacity.bucketCount === 0 && data.anomalies.length === 0;

  return (
    <ReportPage
      title="Runtime Analytics"
      description="Concurrency, host resource, and Chrome consumption history over the selected range."
      icon={<LineChart size={18} />}
      range={range}
      onRangeChange={setRange}
      onRefresh={refetch}
      refreshing={loading}
    >
      {loading && !data ? (
        <>
          <SkeletonCard variant="chart" />
          <SkeletonCard variant="chart" />
        </>
      ) : error ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="Could not load runtime history" hint={error} />
      ) : empty ? (
        <EmptyState
          icon={<ListChecks size={28} />}
          title="No runtime history in this range yet"
          hint="Runtime and Chrome consumption samples are recorded while workflows run. Run a workflow, then return here."
        />
      ) : data ? (
        <RuntimeContent data={data} />
      ) : null}
    </ReportPage>
  );
}

function RuntimeContent({ data }: { data: RuntimeHistory }) {
  const { series, processes } = data;

  const busiest = series.reduce<RuntimeSeriesPoint | undefined>((best, point) => (!best || point.activeFlows > best.activeFlows ? point : best), undefined);
  const peakBrowsers = maxBy(series, (p) => p.activeBrowsers);
  const peakMemory = maxBy(series, (p) => p.systemMemoryPercent);
  const peakChromiumMb = maxBy(processes, (p) => p.chromiumMemoryMb);
  const peakProcesses = maxBy(processes, (p) => p.chromiumProcessCount);

  const concurrency: TimelineSeries[] = [
    seriesFrom(series, (p) => epoch(p.bucketIso), (p) => p.activeBrowsers, "Active browsers", "var(--awkit-purple)"),
    seriesFrom(series, (p) => epoch(p.bucketIso), (p) => p.activeFlows, "Active flows", "var(--awkit-blue)"),
    seriesFrom(series, (p) => epoch(p.bucketIso), (p) => p.queueDepth, "Queue depth", "var(--awkit-warning)")
  ];
  const host: TimelineSeries[] = [
    seriesFrom(series, (p) => epoch(p.bucketIso), (p) => p.systemMemoryPercent, "System memory", "var(--awkit-blue)"),
    seriesFrom(series, (p) => epoch(p.bucketIso), (p) => p.cpuPercent, "CPU", "var(--awkit-danger)")
  ];
  const procCount: TimelineSeries[] = [
    seriesFrom(processes, (p) => epoch(p.timestamp), (p) => p.chromiumProcessCount, "Chromium processes", "var(--awkit-purple)")
  ];
  const procMem: TimelineSeries[] = [
    seriesFrom(processes, (p) => epoch(p.timestamp), (p) => p.chromiumMemoryMb, "Chromium memory", "var(--awkit-purple)"),
    seriesFrom(processes, (p) => epoch(p.timestamp), (p) => p.electronMainMemoryMb, "Electron main", "var(--awkit-blue)")
  ];

  return (
    <>
      <CurrentRuntimeStrip summary={data.summary} />
      <div className="page-grid metrics-grid">
        <MetricCard label="Busiest window" value={busiest ? formatWhen(busiest.bucketIso) : "—"} detail={busiest ? `${busiest.activeFlows} active flow(s)` : "no activity"} icon={<Activity size={22} />} />
        <MetricCard label="Peak active browsers" value={peakBrowsers?.toString() ?? "—"} detail="Highest concurrent browsers" icon={<Cpu size={22} />} />
        <MetricCard label="Peak system memory" value={peakMemory === undefined ? "—" : `${peakMemory}%`} detail="Highest sampled RAM usage" icon={<LineChart size={22} />} />
        <MetricCard label="Peak Chromium memory" value={peakChromiumMb === undefined ? "—" : `${peakChromiumMb.toLocaleString()} MB`} detail={peakProcesses === undefined ? "process sampling unavailable" : `peak ${peakProcesses} process(es)`} icon={<Cpu size={22} />} />
      </div>

      <section className="work-panel awkit-report-panel">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Concurrency over time</strong>
            <span>Active browsers, active flows, and queue depth</span>
          </div>
        </div>
        <ConsumptionTimeline series={concurrency} />
      </section>

      <section className="work-panel awkit-report-panel">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Host resources over time</strong>
            <span>System memory and CPU (sampled while runs execute)</span>
          </div>
        </div>
        <ConsumptionTimeline series={host} unit="%" />
      </section>

      <section className="work-panel awkit-report-panel">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Chrome processes over time</strong>
            <span>SpecterStudio-owned Chromium process count</span>
          </div>
        </div>
        <ConsumptionTimeline series={procCount} />
      </section>

      <section className="work-panel awkit-report-panel">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Chrome memory over time</strong>
            <span>Chromium total and Electron main working set</span>
          </div>
        </div>
        <ConsumptionTimeline series={procMem} unit=" MB" />
      </section>

      <CapacityEffectivenessPanel capacity={data.capacity} />
      <AnomaliesPanel anomalies={data.anomalies} />
    </>
  );
}

/** Live runtime summary snapshot (pressure, adaptive target, weighted budget, active weight, admission reason). */
function CurrentRuntimeStrip({ summary }: { summary: RuntimeObservabilitySummary }) {
  return (
    <section className="work-panel awkit-report-panel">
      <div className="awkit-report-panel-head">
        <div>
          <strong>Current runtime</strong>
          <span>
            Machine pressure: <span className={`awkit-sev awkit-sev-${pressureTone(summary.pressureState)}`}>{summary.pressureState}</span>
            {summary.currentAdmissionReasonLabel ? ` · dispatch blocked: ${summary.currentAdmissionReasonLabel}` : ""}
          </span>
        </div>
        <Gauge size={18} />
      </div>
      <div className="page-grid metrics-grid">
        <MetricCard label="Active / queued" value={`${summary.activeWorkflows} / ${summary.queuedWorkflows}`} detail="workflows" icon={<Activity size={22} />} />
        <MetricCard label="Adaptive target" value={summary.adaptiveTarget?.toString() ?? "—"} detail="live active-flow cap" icon={<Gauge size={22} />} />
        <MetricCard
          label="Weighted admission"
          value={summary.weightedAdmissionActive ? `${summary.activeWeight ?? 0} / ${summary.weightedBudget ?? 0}` : "off"}
          detail={summary.weightedAdmissionActive ? "active weight / budget" : "count-based admission"}
          icon={<Gauge size={22} />}
        />
        <MetricCard
          label="Browsers · contexts · pages"
          value={`${summary.sharedBrowsers ?? 0} · ${summary.browserContexts ?? 0} · ${summary.pageCount ?? 0}`}
          detail="shared pool + contexts"
          icon={<Cpu size={22} />}
        />
      </div>
    </section>
  );
}

function pressureTone(state: string): "info" | "warning" | "critical" {
  if (state === "critical") return "critical";
  if (state === "pressure") return "warning";
  return "info";
}

/** Format a bounded capacity metric as "mean · P95 · max" with an optional unit. p95 is a bucketed ceiling. */
function fmtStat(stat: CapacityMetricStats, unit = ""): string {
  const parts: string[] = [];
  if (stat.mean !== undefined) parts.push(`mean ${stat.mean}${unit}`);
  if (stat.p95 !== undefined) parts.push(`P95 ${stat.p95}${unit}`);
  if (stat.max !== undefined) parts.push(`max ${stat.max}${unit}`);
  return parts.length ? parts.join(" · ") : "—";
}

function pct(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

/**
 * Capacity & queue effectiveness — explainable, separate metrics (no opaque 0–100 score). Environmental
 * resource observations are labelled as such: they are correlations with the run window, not exclusive
 * per-workflow ownership under a shared browser pool.
 */
function CapacityEffectivenessPanel({ capacity }: { capacity: CapacityAnalytics }) {
  if (capacity.bucketCount === 0) {
    return (
      <section className="work-panel awkit-report-panel">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Capacity &amp; queue effectiveness</strong>
            <span>Whether the adaptive / pool / weighted system is operating near its intended envelope</span>
          </div>
          <Gauge size={18} />
        </div>
        <EmptyState icon={<Gauge size={24} />} title="No capacity samples in this range yet" hint="Capacity buckets are recorded while workflows run." />
      </section>
    );
  }
  const rows: Array<{ label: string; value: string; environmental?: boolean }> = [
    { label: "System CPU", value: fmtStat(capacity.systemCpu, "%"), environmental: true },
    { label: "System memory", value: fmtStat(capacity.systemMemory, "%"), environmental: true },
    { label: "Chromium RSS", value: fmtStat(capacity.chromiumRssMb, " MB"), environmental: true },
    { label: "SpecterStudio RSS", value: fmtStat(capacity.awkitRssMb, " MB"), environmental: true },
    { label: "Adaptive target", value: fmtStat(capacity.adaptiveTarget) },
    { label: "Active workflows", value: fmtStat(capacity.activeFlows) },
    { label: "Queued workflows", value: fmtStat(capacity.queuedFlows) },
    { label: "Shared browsers", value: fmtStat(capacity.sharedBrowsers) },
    { label: "Browser contexts", value: fmtStat(capacity.contextCount) },
    { label: "Pages", value: fmtStat(capacity.pageCount) }
  ];
  if (capacity.capacityUtilizationApplicable) {
    rows.splice(4, 0, { label: "Weighted budget", value: fmtStat(capacity.weightedBudget) }, { label: "Active weight", value: fmtStat(capacity.activeWeight) });
  }

  return (
    <section className="work-panel awkit-report-panel">
      <div className="awkit-report-panel-head">
        <div>
          <strong>Capacity &amp; queue effectiveness</strong>
          <span>Explainable indicators from {capacity.bucketCount} capacity bucket(s) · {capacity.windowSampleCount} samples</span>
        </div>
        <Gauge size={18} />
      </div>

      <div className="page-grid metrics-grid">
        <MetricCard
          label="Adaptive-target utilization"
          value={pct(capacity.adaptiveTargetUtilization)}
          detail="active flows ÷ adaptive target"
          icon={<Gauge size={22} />}
        />
        <MetricCard
          label="Capacity utilization"
          value={capacity.capacityUtilizationApplicable ? pct(capacity.capacityUtilization) : "n/a"}
          detail={capacity.capacityUtilizationApplicable ? "active weight ÷ weighted budget" : "weighted admission not active"}
          icon={<Gauge size={22} />}
        />
        <MetricCard label="Runtime admission delays" value={capacity.totalAdmissionDelays.toLocaleString()} detail="runtime block episodes in range (not per-workflow)" icon={<Activity size={22} />} />
        <MetricCard
          label="Contexts / shared browser"
          value={capacity.effectiveness.contextsPerSharedBrowser?.toString() ?? "—"}
          detail={`shared ${pct(capacity.effectiveness.sharedRatio)} · dedicated ${pct(capacity.effectiveness.dedicatedRatio)}`}
          icon={<Cpu size={22} />}
        />
      </div>

      <div className="awkit-obs-tables">
        <table className="awkit-obs-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Mean · P95 · Max</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>
                  {r.label}
                  {r.environmental ? <span className="awkit-obs-env" title="Environmental observation around the run window — not exclusive per-workflow ownership"> env</span> : null}
                </td>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table className="awkit-obs-table">
          <thead>
            <tr>
              <th>Runtime admission reason</th>
              <th>Count</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {capacity.admissionReasons.length === 0 ? (
              <tr>
                <td colSpan={3}>No runtime admission delays in range.</td>
              </tr>
            ) : (
              capacity.admissionReasons.map((reason) => (
                <tr key={reason.reason}>
                  <td>{reason.label}</td>
                  <td>{reason.count.toLocaleString()}</td>
                  <td>{reason.percentage}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {capacity.failureAtPressure.length > 0 && (
        <table className="awkit-obs-table">
          <thead>
            <tr>
              <th>Pressure state at dispatch</th>
              <th>Runs</th>
              <th>Failed</th>
              <th>Failure rate</th>
            </tr>
          </thead>
          <tbody>
            {capacity.failureAtPressure.map((row) => (
              <tr key={row.pressureState}>
                <td>{row.pressureState}</td>
                <td>{row.runs.toLocaleString()}</td>
                <td>{row.failed.toLocaleString()}</td>
                <td>{Math.round(row.failureRate * 1000) / 10}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AnomaliesPanel({ anomalies }: { anomalies: AnomalyEvent[] }) {
  const active = anomalies.filter((a) => a.state === "active");
  return (
    <section className="work-panel awkit-report-panel">
      <div className="awkit-report-panel-head">
        <div>
          <strong>Anomalies &amp; regressions</strong>
          <span>Deterministic, explainable detections vs each workflow's history</span>
        </div>
        <ShieldAlert size={18} />
      </div>
      {active.length === 0 ? (
        <EmptyState icon={<ShieldAlert size={24} />} title="No anomalies detected in this range" hint="Run-level and regression checks compare each workflow to its own history." />
      ) : (
        <table className="awkit-obs-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Signal</th>
              <th>Scope</th>
              <th>Detail</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.id ?? `${a.signalType}-${a.detectedAt}`}>
                <td>
                  <span className={`awkit-sev awkit-sev-${a.severity}`}>{a.severity}</span>
                </td>
                <td>{a.signalType}</td>
                <td>{a.scope}</td>
                <td>{a.note ?? a.thresholdRule ?? "—"}</td>
                <td>{formatWhen(a.detectedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
