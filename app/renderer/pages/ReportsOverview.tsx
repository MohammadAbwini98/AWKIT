import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Gauge, ListChecks, TimerReset, XCircle } from "lucide-react";
import type { TelemetryOverview, TelemetryRangePreset } from "@src/reports/TelemetryContracts";
import { MetricCard } from "../components/shared/MetricCard";
import { AnimatedCounter } from "../components/shared/AnimatedCounter";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { MetricSparkline } from "../components/reports/MetricSparkline";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";

interface OverviewData {
  overview: TelemetryOverview;
  activeInstances: number;
  queuedInstances: number;
}

const ACTIVE = new Set(["running", "starting"]);
const QUEUED = new Set(["queued", "pending"]);

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function ReportsOverview() {
  const [range, setRange] = useState<TelemetryRangePreset>("24h");

  const { data, loading, error, refetch } = useTelemetryQuery<OverviewData>(async () => {
    const [overview, instances] = await Promise.all([
      window.playwrightFlowStudio.telemetry.overview(range),
      window.playwrightFlowStudio.executions.list() as Promise<Array<{ status?: string }>>
    ]);
    return {
      overview,
      activeInstances: instances.filter((i) => ACTIVE.has(String(i.status))).length,
      queuedInstances: instances.filter((i) => QUEUED.has(String(i.status))).length
    };
  }, [range]);

  return (
    <ReportPage
      title="Reports Overview"
      description="Automation outcomes, durations, and live activity from completed runs."
      icon={<Gauge size={18} />}
      range={range}
      onRangeChange={setRange}
      onRefresh={refetch}
      refreshing={loading}
    >
      {loading && !data ? (
        <div className="page-grid metrics-grid">
          {Array.from({ length: 8 }).map((_, index) => (
            <SkeletonCard key={index} lines={2} />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={<AlertTriangle size={28} />}
          title="Could not load reports"
          hint={error}
          action={
            <button type="button" className="awkit-primary-button" onClick={refetch}>
              Try again
            </button>
          }
        />
      ) : data && !data.overview.storeEnabled ? (
        <EmptyState
          icon={<ListChecks size={28} />}
          title="Durable reporting is disabled"
          hint="Set AWKIT_DURABLE_STORE=1 (the default) to record run history and see reports here."
        />
      ) : data && data.overview.totalRuns === 0 ? (
        <EmptyState
          icon={<ListChecks size={28} />}
          title="No runs in this range yet"
          hint="Run a workflow from the Instances page — its outcome, duration, and errors will appear here."
        />
      ) : data ? (
        <OverviewContent data={data} />
      ) : null}
    </ReportPage>
  );
}

function OverviewContent({ data }: { data: OverviewData }) {
  const { overview } = data;
  const series = overview.runsSeries.map((point) => point.total);

  return (
    <>
      <div className="page-grid metrics-grid">
        <MetricCard
          label="Total runs"
          value={<AnimatedCounter value={overview.totalRuns} />}
          detail="Runs started in the selected range"
          icon={<Activity size={22} />}
        />
        <MetricCard
          label="Success rate"
          tone="success"
          value={pct(overview.successRate)}
          detail={`${overview.successRuns} completed of ${overview.successRuns + overview.failedRuns} terminal`}
          icon={<CheckCircle2 size={22} />}
        />
        <MetricCard
          label="Failure rate"
          tone={overview.failureRate > 0 ? "danger" : "default"}
          value={pct(overview.failureRate)}
          detail={`${overview.failedRuns} failed run(s)`}
          icon={<XCircle size={22} />}
        />
        <MetricCard
          label="Cancelled"
          value={<AnimatedCounter value={overview.cancelledRuns} />}
          detail="User-cancelled runs (not counted as failures)"
          icon={<XCircle size={22} />}
        />
        <MetricCard
          label="Avg duration"
          value={formatDuration(overview.duration.avgMs)}
          detail={`Median ${formatDuration(overview.duration.medianMs)}`}
          icon={<Clock size={22} />}
        />
        <MetricCard
          label="p95 duration"
          value={formatDuration(overview.duration.p95Ms)}
          detail="95th percentile run time"
          icon={<TimerReset size={22} />}
        />
        <MetricCard
          label="Avg queue wait"
          value={formatDuration(overview.avgQueueWaitMs)}
          detail="Enqueue to dispatch"
          icon={<Clock size={22} />}
        />
        <MetricCard
          label="Live instances"
          value={<AnimatedCounter value={data.activeInstances} />}
          detail={`${data.queuedInstances} queued right now`}
          icon={<Activity size={22} />}
        />
      </div>

      <section className="work-panel awkit-report-panel">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Runs over time</strong>
            <span>{overview.totalRuns} run(s) across the selected range</span>
          </div>
        </div>
        {series.length >= 2 ? (
          <MetricSparkline values={series} width={640} height={72} ariaLabel={`Runs over time: ${series.join(", ")}`} />
        ) : (
          <p className="awkit-muted">Not enough data points yet to draw a trend.</p>
        )}
      </section>
    </>
  );
}
