import { useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, Gauge, ListChecks } from "lucide-react";
import type { RuntimeSeriesPoint, TelemetryOverview, TelemetryRangePreset, WorkflowReportRow } from "@src/reports/TelemetryContracts";
import { MetricCard } from "../components/shared/MetricCard";
import { AnimatedCounter } from "../components/shared/AnimatedCounter";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { DonutChart, type DonutSegment } from "../components/reports/DonutChart";
import { BarChart } from "../components/reports/BarChart";
import { ConsumptionTimeline, type TimelineSeries } from "../components/reports/ConsumptionTimeline";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";

interface OverviewData {
  overview: TelemetryOverview;
  activeInstances: number;
  queuedInstances: number;
  runtime: RuntimeSeriesPoint[];
  workflows: WorkflowReportRow[];
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
    const [overview, instances, runtime, workflows] = await Promise.all([
      window.playwrightFlowStudio.telemetry.overview(range),
      window.playwrightFlowStudio.executions.list() as Promise<Array<{ status?: string }>>,
      window.playwrightFlowStudio.telemetry.runtimeSeries(range),
      window.playwrightFlowStudio.telemetry.workflows(range)
    ]);
    return {
      overview,
      activeInstances: instances.filter((i) => ACTIVE.has(String(i.status))).length,
      queuedInstances: instances.filter((i) => QUEUED.has(String(i.status))).length,
      runtime,
      workflows
    };
  }, [range]);

  return (
    <ReportPage
      title="Reports"
      description="Automation outcomes, durations, and live activity from completed runs."
      icon={<Gauge size={18} />}
      range={range}
      onRangeChange={setRange}
      onRefresh={refetch}
      refreshing={loading}
      exportData={data}
      exportName="reports-overview"
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
  const outcomeSeries: TimelineSeries[] = [
    { label: "Succeeded", color: "var(--awkit-success)", points: overview.runsSeries.map((point) => ({ x: Date.parse(point.bucketIso), y: point.success })) },
    { label: "Failed", color: "var(--awkit-danger)", points: overview.runsSeries.map((point) => ({ x: Date.parse(point.bucketIso), y: point.failed })) },
    { label: "Cancelled", color: "var(--awkit-warning)", points: overview.runsSeries.map((point) => ({ x: Date.parse(point.bucketIso), y: point.cancelled })) }
  ];
  const peakConcurrency = data.runtime.reduce((peak, point) => Math.max(peak, point.activeFlows), 0);
  const peakQueue = data.runtime.reduce((peak, point) => Math.max(peak, point.queueDepth), 0);
  const busiest = [...data.workflows].sort((a, b) => b.totalRuns - a.totalRuns).slice(0, 8);
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
          detail={`${overview.successRuns} succeeded of ${overview.successRuns + overview.failedRuns} success/failure outcomes`}
          icon={<CheckCircle2 size={22} />}
        />
        <MetricCard
          label="Median duration"
          value={formatDuration(overview.duration.medianMs)}
          detail={`Average ${formatDuration(overview.duration.avgMs)}`}
          icon={<Clock size={22} />}
        />
        <MetricCard
          label="Peak concurrency"
          value={<AnimatedCounter value={peakConcurrency} />}
          detail={`Peak queue ${peakQueue} · ${data.activeInstances} active now`}
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
        {overview.runsSeries.length >= 2 ? (
          <ConsumptionTimeline series={outcomeSeries} height={240} />
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

      <section className="work-panel awkit-report-panel awkit-report-span-4">
        <div className="awkit-report-panel-head">
          <div><strong>Busiest workflows</strong><span>Run volume in the selected range</span></div>
        </div>
        {busiest.length > 0 ? (
          <BarChart data={busiest.map((row) => ({ label: row.scenarioName ?? row.scenarioId ?? "(unknown)", value: row.totalRuns, color: "var(--awkit-accent)" }))} />
        ) : <p className="awkit-muted">No attributable workflow volume in this range.</p>}
      </section>

      <section className="work-panel awkit-report-panel awkit-report-span-8">
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

      <section className="work-panel awkit-report-panel awkit-report-span-12">
        <div className="awkit-report-panel-head">
          <div><strong>Live activity</strong><span>Current workload outside the selected history range</span></div>
          <span className="awkit-report-tag">Live</span>
        </div>
        <div className="awkit-report-summary-list awkit-report-summary-compact">
          <div><span>Active instances</span><strong>{data.activeInstances}</strong><small>running or starting</small></div>
          <div><span>Queued instances</span><strong>{data.queuedInstances}</strong><small>waiting for capacity</small></div>
        </div>
      </section>
    </div>
  );
}
