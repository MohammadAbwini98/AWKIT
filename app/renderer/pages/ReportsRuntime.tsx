import { useState } from "react";
import { Activity, AlertTriangle, Cpu, LineChart, ListChecks } from "lucide-react";
import type { ProcessHistoryPoint, RuntimeSeriesPoint, TelemetryRangePreset } from "@src/reports/TelemetryContracts";
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
    const [series, processes] = await Promise.all([
      window.playwrightFlowStudio.telemetry.runtimeSeries(range),
      window.playwrightFlowStudio.telemetry.processHistory(range, 500)
    ]);
    return { series, processes };
  }, [range]);

  const empty = data && data.series.length === 0 && data.processes.length === 0;

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
            <span>AWKIT-owned Chromium process count</span>
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
    </>
  );
}
