import { AlertTriangle, Cpu, Database, HardDrive, MemoryStick, Server } from "lucide-react";
import type { ServerReport } from "@src/reports/TelemetryContracts";
import { MetricCard } from "../components/shared/MetricCard";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { BarChart, type BarDatum } from "../components/reports/BarChart";
import { AvailabilityNotice } from "../components/reports/AvailabilityNotice";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";
import { DonutChart, type DonutSegment } from "../components/reports/DonutChart";
import { StatusBadge } from "../components/shared/StatusBadge";

function pctOrDash(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value)}%`;
}

export function ReportsServer() {
  const { data, loading, error, refetch } = useTelemetryQuery<ServerReport>(
    () => window.playwrightFlowStudio.telemetry.server(),
    []
  );

  return (
    <ReportPage
      title="Server Performance"
      description="Process resource usage and on-disk storage for artifacts, logs, and the runtime store."
      icon={<Server size={18} />}
      onRefresh={refetch}
      refreshing={loading}
      exportData={data}
      exportName="server-performance"
    >
      {loading && !data ? (
        <div className="page-grid metrics-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} lines={2} />
          ))}
        </div>
      ) : error ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="Could not load server performance" hint={error} />
      ) : data ? (
        <ServerContent data={data} />
      ) : null}
    </ReportPage>
  );
}

function ServerContent({ data }: { data: ServerReport }) {
  const storageBars: BarDatum[] = [
    { label: "Reports", value: data.storage.reportsMb, color: "var(--awkit-blue)" },
    { label: "Screenshots", value: data.storage.screenshotsMb, color: "var(--awkit-accent)" },
    { label: "Logs", value: data.storage.logsMb, color: "var(--awkit-warning)" },
    { label: "Downloads", value: data.storage.downloadsMb, color: "var(--awkit-success)" },
    { label: "Runtime DB", value: data.storage.runtimeDbMb, color: "var(--awkit-accent-hover)" }
  ];
  const storageSegments: DonutSegment[] = storageBars.filter((item) => item.value > 0).map((item) => ({
    label: item.label,
    value: item.value,
    color: item.color ?? "var(--awkit-accent)"
  }));

  return (
    <>
      <AvailabilityNotice availability={data.processAvailability as "full" | "partial" | "unavailable" | undefined} />

      {data.backpressureBlocked ? (
        <div className="awkit-availability-notice awkit-backpressure" role="status">
          <AlertTriangle size={15} />
          <div>
            <strong>Dispatch is currently throttled by backpressure.</strong>
            {data.backpressureReason ? <span className="awkit-muted">{data.backpressureReason}</span> : null}
          </div>
        </div>
      ) : null}

      <div className="awkit-report-widget-grid">
      <div className="page-grid metrics-grid">
        <MetricCard label="System memory" value={pctOrDash(data.systemMemoryPercent)} detail="Sampled RAM usage" icon={<MemoryStick size={22} />} />
        <MetricCard label="System CPU" value={pctOrDash(data.cpuPercent)} detail={`Main process ${data.processCpuPercent?.toFixed(0) ?? "—"}%`} icon={<Cpu size={22} />} />
        <MetricCard label="Electron main" value={`${(data.electronMainMemoryMb ?? data.processRssMb).toLocaleString()} MB`} detail="Main process working set" icon={<MemoryStick size={22} />} />
        <MetricCard
          label="Chromium memory"
          value={data.chromiumMemoryMb === undefined ? "—" : `${data.chromiumMemoryMb.toLocaleString()} MB`}
          detail={data.processAvailability === "full" ? "SpecterStudio-owned Chromium tree" : "process sampling unavailable"}
          icon={<Cpu size={22} />}
        />
      </div>

      <section className="work-panel awkit-report-panel awkit-report-span-8">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Storage usage</strong>
            {/* A truncated walk must not present itself as a total — see StorageUsage.truncated. */}
            <span data-testid="storage-total-summary">
              {data.storage.truncated ? "at least " : ""}
              {data.storage.totalMb.toLocaleString()} MB across artifacts, logs, and the runtime store
            </span>
          </div>
          <HardDrive size={16} />
        </div>
        <BarChart data={storageBars} />
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-4">
        <div className="awkit-report-panel-head">
          <div><strong>Storage breakdown</strong><span>Share by configured data location</span></div>
        </div>
        {storageSegments.length > 0 ? (
          <DonutChart segments={storageSegments} centerLabel={`${data.storage.totalMb.toLocaleString()} MB`} centerSub="on disk" />
        ) : (
          <p className="awkit-muted">No stored artifacts were measured.</p>
        )}
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-7">
        <div className="awkit-report-panel-head">
          <div><strong>Host health</strong><span>Current production telemetry and dispatch state</span></div>
        </div>
        <div className="awkit-table-wrap">
          <table className="awkit-table">
            <thead><tr><th>Signal</th><th>Status</th><th className="awkit-th-numeric">Observed</th></tr></thead>
            <tbody>
              <tr><td>Runtime dispatch</td><td><StatusBadge tone={data.backpressureBlocked ? "warning" : "success"} label={data.backpressureBlocked ? "Throttled" : "Ready"} /></td><td className="awkit-td-numeric">{data.backpressureReason ?? "No backpressure"}</td></tr>
              <tr><td>Process sampler</td><td><StatusBadge tone={data.processAvailability === "full" ? "success" : "warning"} label={data.processAvailability ?? "Unavailable"} /></td><td className="awkit-td-numeric">{data.chromiumMemoryMb === undefined ? "—" : `${data.chromiumMemoryMb.toLocaleString()} MB Chromium`}</td></tr>
              <tr><td>Storage scan</td><td><StatusBadge tone={data.storage.truncated ? "warning" : "success"} label={data.storage.truncated ? "Bounded" : "Complete"} /></td><td className="awkit-td-numeric">{data.storage.totalMb.toLocaleString()} MB</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-5">
        <div className="awkit-report-panel-head">
          <div><strong>Capacity headroom</strong><span>Remaining host resource percentage</span></div>
        </div>
        <BarChart data={[
          { label: "CPU headroom", value: data.cpuPercent === undefined ? 0 : Math.max(0, 100 - data.cpuPercent), color: "var(--awkit-success)" },
          { label: "Memory headroom", value: data.systemMemoryPercent === undefined ? 0 : Math.max(0, 100 - data.systemMemoryPercent), color: "var(--awkit-blue)" }
        ]} />
        {data.cpuPercent === undefined || data.systemMemoryPercent === undefined ? <p className="awkit-muted">Unavailable signals render as zero and are not capacity measurements.</p> : null}
      </section>

      <section className="work-panel awkit-report-panel awkit-storage-note awkit-report-span-12">
        <Database size={15} />
        <p className="awkit-muted">
          Storage sizes are computed from the configured Reports, Screenshots, Logs, and Downloads folders plus the runtime SQLite file,
          cached for up to a minute. AWKIT never deletes your artifacts automatically — only bounded reporting rows are retained.
          {data.storage.truncated ? (
            <>
              {" "}
              <strong data-testid="storage-truncated-note">
                One or more folders contain more files than a single scan reads, so these sizes are a lower bound, not a total.
              </strong>
            </>
          ) : null}
        </p>
      </section>
      </div>
    </>
  );
}
