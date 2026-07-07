import { AlertTriangle, Cpu, Gauge as GaugeIcon, MemoryStick, MonitorDot } from "lucide-react";
import { MetricCard } from "../components/shared/MetricCard";
import { AnimatedCounter } from "../components/shared/AnimatedCounter";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { RpmGaugeCard } from "../components/reports/RpmGaugeCard";
import { LiveProcessStrip } from "../components/reports/LiveProcessStrip";
import { AvailabilityNotice } from "../components/reports/AvailabilityNotice";
import { useRuntimeStatus } from "../components/reports/useRuntimeStatus";

function safePct(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.min(100, (numerator / denominator) * 100) : 0;
}

export function ReportsChrome() {
  const { status, loading, error } = useRuntimeStatus(2000);

  return (
    <ReportPage
      title="Chrome Consumption"
      description="Live Chrome/Playwright runtime consumption, browser-pool pressure, and process metrics."
      icon={<GaugeIcon size={18} />}
    >
      {loading && !status ? (
        <div className="page-grid awkit-gauge-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} variant="chart" />
          ))}
        </div>
      ) : error && !status ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="Could not load runtime status" hint={error} />
      ) : status ? (
        <ChromeContent status={status} />
      ) : null}
    </ReportPage>
  );
}

function ChromeContent({ status }: { status: NonNullable<ReturnType<typeof useRuntimeStatus>["status"]> }) {
  const cap = status.capacity;
  const pool = status.browserPool;
  const proc = status.processes;

  const poolPct = safePct(cap.activeBrowsers, cap.maxBrowsers);
  const concurrencyPct = safePct(cap.activeFlows, cap.maxActiveFlows);

  return (
    <>
      <AvailabilityNotice availability={proc?.availability} reason={proc?.availabilityReason} />

      {cap.dispatchBlocked ? (
        <div className="awkit-availability-notice awkit-backpressure" role="status">
          <AlertTriangle size={15} />
          <div>
            <strong>Dispatch is currently throttled by backpressure.</strong>
            {cap.blockedReason ? <span className="awkit-muted">{cap.blockedReason}</span> : null}
          </div>
        </div>
      ) : null}

      <div className="page-grid awkit-gauge-grid">
        <RpmGaugeCard
          title="Browser pool"
          value={poolPct}
          unit="saturation"
          caption={`${cap.activeBrowsers} / ${cap.maxBrowsers} browsers`}
          tooltip="Pool saturation = active browsers ÷ max browsers per host (AWKIT_MAX_BROWSERS). Source: BrowserWorkerPool / CapacitySnapshot."
          pulseHigh
        />
        <RpmGaugeCard
          title="Concurrency"
          value={concurrencyPct}
          unit="usage"
          caption={`${cap.activeFlows} / ${cap.maxActiveFlows} active flows`}
          tooltip="Concurrency usage = active flows ÷ max active flows (AWKIT_MAX_ACTIVE_FLOWS). Source: CapacitySnapshot."
          pulseHigh
        />
        <RpmGaugeCard
          title="Memory pressure"
          value={cap.systemMemoryPercent}
          unit="system RAM"
          caption={cap.systemMemoryPercent === undefined ? "sampling…" : `${cap.freeMemoryMb.toLocaleString()} MB free`}
          tooltip="System memory in use (%). Source: ResourceSampler (os.totalmem/freemem). Undefined until the first sample."
          pulseHigh
        />
        <RpmGaugeCard
          title="CPU"
          value={cap.cpuPercent}
          unit="system CPU"
          caption={cap.cpuPercent === undefined ? "sampling…" : `main ${cap.processCpuPercent?.toFixed(0) ?? "—"}%`}
          tooltip="System-wide CPU busy (%) between samples. Source: ResourceSampler (os.cpus deltas). Undefined until two samples exist."
        />
      </div>

      <div className="page-grid metrics-grid">
        <MetricCard label="Active instances" value={<AnimatedCounter value={cap.activeFlows} />} detail="Flows executing now" icon={<MonitorDot size={22} />} />
        <MetricCard label="Queued" value={<AnimatedCounter value={cap.queueDepth} />} detail="Instances awaiting a slot" icon={<MonitorDot size={22} />} />
        <MetricCard
          label="Chromium processes"
          value={proc?.chromiumProcessCount === undefined ? "—" : <AnimatedCounter value={proc.chromiumProcessCount} />}
          detail={proc?.availability === "full" ? "AWKIT-owned process tree" : "process sampling unavailable"}
          icon={<Cpu size={22} />}
        />
        <MetricCard
          label="Chromium memory"
          value={proc?.chromiumMemoryMb === undefined ? "—" : `${proc.chromiumMemoryMb.toLocaleString()} MB`}
          detail={`Electron main ${(proc?.electronMainMemoryMb ?? cap.processRssMb).toLocaleString()} MB`}
          icon={<MemoryStick size={22} />}
        />
      </div>

      <section className="work-panel awkit-report-panel">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Process detail</strong>
            <span>Live browser slots and Chrome/host consumption</span>
          </div>
        </div>
        <LiveProcessStrip status={status} />
      </section>
    </>
  );
}
