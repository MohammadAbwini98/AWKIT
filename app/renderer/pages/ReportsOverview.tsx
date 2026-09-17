import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Gauge, ListChecks } from "lucide-react";
import type { TelemetryOverview, TelemetryRangePreset } from "@src/reports/TelemetryContracts";
import { MetricCard } from "../components/shared/MetricCard";
import { AnimatedCounter } from "../components/shared/AnimatedCounter";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { MetricSparkline } from "../components/reports/MetricSparkline";
import { DonutChart, type DonutSegment } from "../components/reports/DonutChart";
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
  const outcomes: DonutSegment[] = [
    { label: "Succeeded", value: overview.successRuns, color: "var(--awkit-success)" },
    { label: "Failed", value: overview.failedRuns, color: "var(--awkit-danger)" },
    { label: "Cancelled", value: overview.cancelledRuns, color: "var(--awkit-warning)" },
    { label: "Other", value: overview.otherRuns, color: "var(--awkit-chart-6)" }
  ].filter((segment) => segment.value > 0);

  return (
    <div className="awkit-report-widget-grid">
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
          label="Median duration"
          value={formatDuration(overview.duration.medianMs)}
          detail={`Average ${formatDuration(overview.duration.avgMs)}`}
          icon={<Clock size={22} />}
        />
        <MetricCard
          label="Live instances"
          value={<AnimatedCounter value={data.activeInstances} />}
          detail={`${data.queuedInstances} queued right now`}
          icon={<Activity size={22} />}
        />
      </div>

      <section className="work-panel awkit-report-panel awkit-report-span-8">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Outcomes over time</strong>
            <span>Completed volume and failures across the selected range</span>
          </div>
          <span className="awkit-report-tag">{overview.totalRuns} runs</span>
        </div>
        {series.length >= 2 ? (
          <MetricSparkline values={series} width={640} height={72} ariaLabel={`Runs over time: ${series.join(", ")}`} />
        ) : (
          <p className="awkit-muted">Not enough data points yet to draw a trend.</p>
        )}
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-4">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Outcome split</strong>
            <span>Share of all runs in range</span>
          </div>
        </div>
        <DonutChart segments={outcomes} centerLabel={pct(overview.successRate)} centerSub="success" />
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-12">
        <div className="awkit-report-panel-head">
          <div>
            <strong>Run health</strong>
            <span>Failure, cancellation, latency, and queue indicators</span>
          </div>
        </div>
        <div className="awkit-report-summary-list">
          <div><span>Failure rate</span><strong>{pct(overview.failureRate)}</strong><small>{overview.failedRuns} failed</small></div>
          <div><span>Cancelled</span><strong>{overview.cancelledRuns}</strong><small>not counted as failures</small></div>
          <div><span>Average duration</span><strong>{formatDuration(overview.duration.avgMs)}</strong><small>all completed runs</small></div>
          <div><span>p95 duration</span><strong>{formatDuration(overview.duration.p95Ms)}</strong><small>95th percentile</small></div>
          <div><span>Average queue</span><strong>{formatDuration(overview.avgQueueWaitMs)}</strong><small>enqueue to dispatch</small></div>
          <div><span>Queued now</span><strong>{data.queuedInstances}</strong><small>waiting instances</small></div>
        </div>
      </section>
    </div>
  );
}
