import { AlertTriangle, Cpu, Database, HardDrive, MemoryStick, Server } from "lucide-react";
import type { ServerReport } from "@src/reports/TelemetryContracts";
import { MetricCard } from "../components/shared/MetricCard";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { BarChart, type BarDatum } from "../components/reports/BarChart";
import { AvailabilityNotice } from "../components/reports/AvailabilityNotice";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";

function pctOrDash(value: number | undefined): string {
  return value === undefined ? "—" : `${value}%`;
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
    { label: "Screenshots", value: data.storage.screenshotsMb, color: "var(--awkit-purple)" },
    { label: "Logs", value: data.storage.logsMb, color: "var(--awkit-warning)" },
    { label: "Downloads", value: data.storage.downloadsMb, color: "var(--awkit-success)" },
    { label: "Runtime DB", value: data.storage.runtimeDbMb, color: "var(--awkit-purple-deep)" }
  ];

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

      <div className="page-grid metrics-grid">
        <MetricCard label="System memory" value={pctOrDash(data.systemMemoryPercent)} detail="Sampled RAM usage" icon={<MemoryStick size={22} />} />
        <MetricCard label="System CPU" value={pctOrDash(data.cpuPercent)} detail={`Main process ${data.processCpuPercent?.toFixed(0) ?? "—"}%`} icon={<Cpu size={22} />} />
        <MetricCard label="Electron main" value={`${(data.electronMainMemoryMb ?? data.processRssMb).toLocaleString()} MB`} detail="Main process working set" icon={<MemoryStick size={22} />} />
        <MetricCard
          label="Chromium memory"
          value={data.chromiumMemoryMb === undefined ? "—" : `${data.chromiumMemoryMb.toLocaleString()} MB`}
          detail={data.processAvailability === "full" ? "AWKIT-owned Chromium tree" : "process sampling unavailable"}
          icon={<Cpu size={22} />}
        />
      </div>

      <section className="work-panel awkit-report-panel">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Storage usage</strong>
            <span>{data.storage.totalMb.toLocaleString()} MB across artifacts, logs, and the runtime store</span>
          </div>
          <HardDrive size={16} />
        </div>
        <BarChart data={storageBars} />
      </section>

      <section className="work-panel awkit-report-panel awkit-storage-note">
        <Database size={15} />
        <p className="awkit-muted">
          Storage sizes are computed from the configured Reports, Screenshots, Logs, and Downloads folders plus the runtime SQLite file,
          cached for up to a minute. AWKIT never deletes your artifacts automatically — only bounded reporting rows are retained.
        </p>
      </section>
    </>
  );
}
