import { useMemo, useState } from "react";
import { AlertTriangle, Gauge as GaugeIcon } from "lucide-react";
import type { ProcessHistoryPoint, RuntimeSeriesPoint, TelemetryRangePreset } from "@src/reports/TelemetryContracts";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { ReportGaugePanel, type ReportGauge } from "../components/reports/ReportGaugePanel";
import { LiveProcessStrip } from "../components/reports/LiveProcessStrip";
import { AvailabilityNotice } from "../components/reports/AvailabilityNotice";
import { ConsumptionTimeline, type TimelineSeries } from "../components/reports/ConsumptionTimeline";
import { useRuntimeStatus } from "../components/reports/useRuntimeStatus";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";

interface ChromeHistory {
  runtime: RuntimeSeriesPoint[];
  processes: ProcessHistoryPoint[];
}

function safePct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.min(100, (numerator / denominator) * 100) : 0;
}

function timeline(points: RuntimeSeriesPoint[], key: "activeBrowsers" | "queueDepth", label: string, color: string): TimelineSeries {
  return {
    label,
    color,
    points: points.map((point) => ({ x: Date.parse(point.bucketIso), y: point[key] })).filter((point) => !Number.isNaN(point.x))
  };
}

export function ReportsChrome() {
  const [range, setRange] = useState<TelemetryRangePreset>("24h");
  const { status, loading: liveLoading, error: liveError } = useRuntimeStatus(2000);
  const { data: history, loading: historyLoading, error: historyError, refetch } = useTelemetryQuery<ChromeHistory>(async () => {
    const [runtime, processes] = await Promise.all([
      window.playwrightFlowStudio.telemetry.runtimeSeries(range),
      window.playwrightFlowStudio.telemetry.processHistory(range, 500)
    ]);
    return { runtime, processes };
  }, [range]);
  const exportData = useMemo(() => (status && history ? { range, capturedAt: new Date().toISOString(), live: status, history } : undefined), [history, range, status]);

  return (
    <ReportPage
      title="Chrome Consumption"
      description="Live Chrome/Playwright runtime consumption, browser-pool pressure, and process metrics."
      icon={<GaugeIcon size={18} />}
      range={range}
      onRangeChange={setRange}
      onRefresh={refetch}
      refreshing={historyLoading}
      exportData={exportData}
      exportName="chrome-consumption"
    >
      {liveLoading && !status ? (
        <SkeletonCard variant="chart" />
      ) : liveError && !status ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="Could not load runtime status" hint={liveError} />
      ) : status ? (
        <ChromeContent status={status} history={history} historyError={historyError} />
      ) : null}
    </ReportPage>
  );
}

function ChromeContent({ status, history, historyError }: {
  status: NonNullable<ReturnType<typeof useRuntimeStatus>["status"]>;
  history: ChromeHistory | undefined;
  historyError: string | undefined;
}) {
  const cap = status.capacity;
  const pool = status.browserPool;
  const proc = status.processes;
  const totalMemoryMb = cap.systemMemoryPercent !== undefined && cap.systemMemoryPercent < 100 ? cap.freeMemoryMb / (1 - cap.systemMemoryPercent / 100) : undefined;
  const memoryPct = proc?.chromiumMemoryMb !== undefined && totalMemoryMb ? safePct(proc.chromiumMemoryMb, totalMemoryMb) : cap.systemMemoryPercent;
  const pageCapacity = cap.maxActiveFlows * pool.maxPagesPerContext;
  const gauges: ReportGauge[] = [
    { label: "Contexts", value: safePct(cap.activeContexts, cap.maxActiveFlows), display: String(cap.activeContexts), unit: "CONTEXTS", detail: `Saturates at ${cap.maxActiveFlows} concurrent contexts`, color: "var(--awkit-accent)" },
    { label: "CPU", value: undefined, display: "—", unit: "CPU", detail: "Chromium-only CPU sampling is unavailable", color: "var(--awkit-warning)" },
    { label: "Memory", value: memoryPct, display: proc?.chromiumMemoryMb === undefined ? "—" : `${(proc.chromiumMemoryMb / 1024).toFixed(1)} GB`, unit: "MEMORY", detail: proc?.availability === "full" ? "Chromium resident set" : "Process sampling unavailable", color: "var(--awkit-blue)" },
    { label: "Pages open", value: safePct(cap.activePages, Math.max(1, pageCapacity)), display: String(cap.activePages), unit: "PAGES OPEN", detail: `${pageCapacity} configured page slots`, color: "var(--awkit-success)" }
  ];
  const contextSeries = history ? [
    { label: "Contexts", color: "var(--awkit-accent)", points: history.processes.flatMap((point) => point.browserContextCount === undefined ? [] : [{ x: Date.parse(point.timestamp), y: point.browserContextCount }]).filter((point) => !Number.isNaN(point.x)) },
    timeline(history.runtime, "queueDepth", "Queue depth", "var(--awkit-warning)")
  ] : [];
  const memorySeries: TimelineSeries[] = history ? [
    { label: "Chromium memory", color: "var(--awkit-accent)", points: history.processes.flatMap((point) => point.chromiumMemoryMb === undefined ? [] : [{ x: Date.parse(point.timestamp), y: point.chromiumMemoryMb }]) },
    { label: "Electron main", color: "var(--awkit-blue)", points: history.processes.flatMap((point) => point.electronMainMemoryMb === undefined ? [] : [{ x: Date.parse(point.timestamp), y: point.electronMainMemoryMb }]) }
  ] : [];

  return (
    <div className="awkit-report-widget-grid">
      <AvailabilityNotice availability={proc?.availability} reason={proc?.availabilityReason} />
      {cap.dispatchBlocked ? (
        <div className="awkit-availability-notice awkit-backpressure" role="status">
          <AlertTriangle size={15} />
          <div><strong>Dispatch is currently throttled by backpressure.</strong>{cap.blockedReason ? <span className="awkit-muted">{cap.blockedReason}</span> : null}</div>
        </div>
      ) : null}

      <ReportGaugePanel gauges={gauges} />

      <section className="work-panel awkit-report-panel awkit-report-span-8">
        <div className="awkit-report-panel-head"><div><strong>Contexts over time</strong><span>Browser contexts against queue depth</span></div><span className="awkit-report-tag">Selected range</span></div>
        {historyError ? <p className="awkit-muted">Historical telemetry unavailable: {historyError}</p> : <ConsumptionTimeline series={contextSeries} height={240} />}
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-4">
        <div className="awkit-report-panel-head"><div><strong>Live activity</strong><span>Current browser-pool and process state</span></div></div>
        <div className="awkit-report-summary-list awkit-report-summary-compact">
          <div><span>Active flows</span><strong>{cap.activeFlows}</strong><small>{cap.maxActiveFlows} configured</small></div>
          <div><span>Queued</span><strong>{cap.queueDepth}</strong><small>{pool.pendingWaiters} browser waiters</small></div>
          <div><span>Chromium processes</span><strong>{proc?.chromiumProcessCount ?? "—"}</strong><small>SpecterStudio-owned tree</small></div>
          <div><span>Recent crashes</span><strong>{pool.recentCrashes}</strong><small>browser-pool window</small></div>
        </div>
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-7">
        <div className="awkit-report-panel-head"><div><strong>Per-context detail</strong><span>Live browser slots owned by SpecterStudio</span></div></div>
        {pool.slots.length === 0 ? (
          <p className="awkit-muted">No active browser slots. Start a workflow to see per-context detail.</p>
        ) : (
          <div className="awkit-table-wrap">
            <table className="awkit-table">
              <thead><tr><th>Instance</th><th className="awkit-th-numeric">Contexts</th><th className="awkit-th-numeric">Pages</th><th className="awkit-th-numeric">Crashes</th><th>Health</th></tr></thead>
              <tbody>{pool.slots.map((slot) => (
                <tr key={slot.workerId}>
                  <td>{slot.instanceId}</td><td className="awkit-td-numeric">{slot.activeContexts}</td><td className="awkit-td-numeric">{slot.activePages}</td><td className="awkit-td-numeric">{slot.crashes}</td><td>{slot.unhealthy ? slot.unhealthyReason ?? "Unhealthy" : "Healthy"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-5">
        <div className="awkit-report-panel-head"><div><strong>Process detail</strong><span>Live slots and host consumption</span></div></div>
        <LiveProcessStrip status={status} />
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-12">
        <div className="awkit-report-panel-head"><div><strong>Memory over time</strong><span>Chromium and Electron resident memory</span></div></div>
        <ConsumptionTimeline series={memorySeries} unit=" MB" />
      </section>
    </div>
  );
}
