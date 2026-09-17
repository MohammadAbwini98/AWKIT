import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Lightbulb, ListChecks, ShieldAlert, Workflow } from "lucide-react";
import type { FailureBreakdown, TelemetryOverview, TelemetryRangePreset, WorkflowReportRow } from "@src/reports/TelemetryContracts";
import { reportCategoryLabel, type ReportCategory } from "@src/reports/ReportCategories";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { MetricCard } from "../components/shared/MetricCard";
import { ReportPage } from "../components/reports/ReportPage";
import { DonutChart, type DonutSegment } from "../components/reports/DonutChart";
import { BarChart, type BarDatum } from "../components/reports/BarChart";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";
import { RunDetailDrawer } from "../components/reports/RunDetailDrawer";
import { formatDurationMs, formatWhen } from "../components/reports/statusTone";
import { ConsumptionTimeline, type TimelineSeries } from "../components/reports/ConsumptionTimeline";

interface FailuresData {
  failures: FailureBreakdown;
  workflows: WorkflowReportRow[];
  overview: TelemetryOverview;
}

/* Failure-category → chart-series assignment. Colors resolve through the categorical
 * --awkit-chart-* token family (global.css, light + dark variants) so the donut/bars
 * follow the theme instead of painting light-tuned hexes on dark surfaces. Series tokens
 * are assigned by data category, never by run state. */
const CATEGORY_COLORS: Partial<Record<ReportCategory, string>> = {
  navigation: "var(--awkit-chart-1)",
  selector: "var(--awkit-chart-2)",
  timeout: "var(--awkit-chart-3)",
  assertion: "var(--awkit-chart-4)",
  "browser-crash": "var(--awkit-chart-5)",
  "context-closed": "var(--awkit-chart-6)",
  "profile-lock": "var(--awkit-chart-7)",
  "session-expired": "var(--awkit-chart-8)",
  "auth-handoff-required": "var(--awkit-chart-9)",
  network: "var(--awkit-chart-10)",
  "download-upload": "var(--awkit-chart-11)",
  "data-binding": "var(--awkit-chart-12)",
  cancelled: "var(--awkit-chart-13)",
  unknown: "var(--awkit-chart-14)"
};

const MIN_RUNS_FOR_FLAKINESS = 5;

/** flakiness = min(100, round(failureRate×60 + retryRate×40)). Timeouts are counted in the
 * failure rate. Documented in the column tooltip; adjustable later. */
function flakinessScore(row: WorkflowReportRow): number | undefined {
  if (row.totalRuns < MIN_RUNS_FOR_FLAKINESS) return undefined;
  const denom = row.success + row.failed;
  const failureRate = denom > 0 ? row.failed / denom : 0;
  const retryRate = row.totalRuns > 0 ? row.retryCount / row.totalRuns : 0;
  return Math.min(100, Math.round(failureRate * 60 + retryRate * 40));
}

function buildInsights(data: FailuresData): string[] {
  const insights: string[] = [];
  const { failures, workflows } = data;
  if (failures.total > 0 && failures.categories.length > 0) {
    const top = failures.categories[0];
    insights.push(`Most failures are ${reportCategoryLabel(top.category).toLowerCase()}-related (${top.count} of ${failures.total}).`);
  }
  const slowest = [...workflows].filter((w) => w.duration.p95Ms !== undefined).sort((a, b) => (b.duration.p95Ms ?? 0) - (a.duration.p95Ms ?? 0))[0];
  if (slowest?.duration.p95Ms) {
    insights.push(`${slowest.scenarioName ?? slowest.scenarioId ?? "A workflow"} has the highest p95 duration (${Math.round(slowest.duration.p95Ms / 100) / 10}s).`);
  }
  const flakiest = workflows
    .map((w) => ({ w, score: flakinessScore(w) }))
    .filter((entry): entry is { w: WorkflowReportRow; score: number } => entry.score !== undefined && entry.score >= 40)
    .sort((a, b) => b.score - a.score)[0];
  if (flakiest) {
    insights.push(`${flakiest.w.scenarioName ?? flakiest.w.scenarioId ?? "A workflow"} looks flaky (score ${flakiest.score}).`);
  }
  return insights;
}

export function ReportsFailures() {
  const [range, setRange] = useState<TelemetryRangePreset>("24h");
  const [evidenceRunId, setEvidenceRunId] = useState<string | null>(null);

  const { data, loading, error, refetch } = useTelemetryQuery<FailuresData>(async () => {
    const [failures, workflows, overview] = await Promise.all([
      window.playwrightFlowStudio.telemetry.failures(range),
      window.playwrightFlowStudio.telemetry.workflows(range),
      window.playwrightFlowStudio.telemetry.overview(range)
    ]);
    return { failures, workflows, overview };
  }, [range]);

  const segments: DonutSegment[] = useMemo(
    () =>
      (data?.failures.categories ?? []).map((entry) => ({
        label: reportCategoryLabel(entry.category),
        value: entry.count,
        color: CATEGORY_COLORS[entry.category] ?? "var(--awkit-chart-14)"
      })),
    [data]
  );

  const noFailures = data && data.overview.failedRuns === 0;
  const failureSeries: TimelineSeries[] = data ? [{
    label: "Failed runs",
    color: "var(--awkit-danger)",
    points: data.overview.runsSeries.map((point) => ({ x: Date.parse(point.bucketIso), y: point.failed })).filter((point) => !Number.isNaN(point.x))
  }] : [];
  const summary = useMemo(() => {
    const workflows = data?.workflows ?? [];
    const leastReliable = [...workflows].filter((row) => row.success + row.failed > 0).sort((a, b) => a.successRate - b.successRate)[0];
    const authHandoffs = data?.failures.categories.find((entry) => entry.category === "auth-handoff-required")?.count ?? 0;
    return {
      totalRuns: data?.overview.totalRuns ?? 0,
      failedRuns: data?.overview.failedRuns ?? 0,
      failureRate: data?.overview.failureRate ?? 0,
      authHandoffs,
      leastReliable
    };
  }, [data]);

  return (
    <ReportPage
      title="Failure Analytics"
      description="Failure categories, reliability ranking, and evidence-based insights."
      icon={<ShieldAlert size={18} />}
      range={range}
      onRangeChange={setRange}
      onRefresh={refetch}
      refreshing={loading}
      exportData={data}
      exportName="failure-analytics"
    >
      {loading && !data ? (
        <SkeletonCard variant="chart" />
      ) : error ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="Could not load failure analytics" hint={error} />
      ) : !data ? null : (
        <div className="awkit-report-widget-grid">
          <div className="page-grid metrics-grid">
            <MetricCard label="Failed runs" value={summary.failedRuns.toLocaleString()} detail={`${summary.totalRuns.toLocaleString()} total runs`} icon={<ShieldAlert size={22} />} tone={summary.failedRuns > 0 ? "danger" : "success"} />
            <MetricCard label="Failure rate" value={`${(summary.failureRate * 100).toFixed(1)}%`} detail="Of all runs in range" icon={<ListChecks size={22} />} tone={summary.failureRate > 0 ? "warning" : "success"} />
            <MetricCard label="Least reliable" value={summary.leastReliable ? `${(summary.leastReliable.successRate * 100).toFixed(0)}%` : "—"} detail={summary.leastReliable?.scenarioName ?? summary.leastReliable?.scenarioId ?? "No workflow runs"} icon={<Workflow size={22} />} />
            <MetricCard label="Auth handoffs" value={summary.authHandoffs.toLocaleString()} detail="Protected-login operator handoffs" icon={<ShieldAlert size={22} />} />
          </div>

          {noFailures ? (
            <div className="awkit-report-span-12"><EmptyState icon={<CheckCircle2 size={28} />} title="No failures in this range" hint="Every completed run in this window succeeded (or was cancelled). Nice." /></div>
          ) : (
            <>
                <section className="work-panel awkit-report-panel awkit-report-span-7">
                  <div className="awkit-report-panel-head">
                    <div>
                      <strong>Failure categories</strong>
                      <span>{data.failures.total} categorized failure(s){data.failures.total < summary.failedRuns ? " from the bounded recent sample" : ""}</span>
                    </div>
                  </div>
                  <div className="awkit-donut-with-legend">
                    <DonutChart segments={segments} centerLabel={String(data.failures.total)} centerSub="failures" />
                    <BarChart data={segments.map((s): BarDatum => ({ label: s.label, value: s.value, color: s.color }))} />
                  </div>
                </section>

                <section className="work-panel awkit-report-panel awkit-report-span-5">
                  <div className="awkit-report-panel-head">
                    <div>
                      <strong>Top failing workflows</strong>
                      <span>By failed run count</span>
                    </div>
                  </div>
                  {data.failures.topWorkflows.length === 0 ? (
                    <p className="awkit-muted">No attributable failing workflows.</p>
                  ) : (
                    <BarChart
                      data={data.failures.topWorkflows.map((w): BarDatum => ({ label: w.scenarioName ?? w.scenarioId ?? "(unknown)", value: w.failed, color: "var(--awkit-danger)" }))}
                    />
                  )}
                </section>

                <section className="work-panel awkit-report-panel awkit-report-span-7">
                  <div className="awkit-report-panel-head"><div><strong>Failures over time</strong><span>Failed-run volume across the selected range</span></div></div>
                  <ConsumptionTimeline series={failureSeries} />
                </section>

                <section className="work-panel awkit-report-panel awkit-insights awkit-report-span-5">
                  <Lightbulb size={16} />
                  {buildInsights(data).length > 0 ? (
                    <ul>{buildInsights(data).map((insight) => <li key={insight}>{insight}</li>)}</ul>
                  ) : (
                    <p className="awkit-muted">No statistically useful insight is available yet.</p>
                  )}
                </section>
            </>
          )}

          <section className="work-panel awkit-report-panel awkit-report-span-12">
            <div className="awkit-report-panel-head">
              <div>
                <strong>Workflow reliability</strong>
                <span>Success rate, retries, and flakiness (≥{MIN_RUNS_FOR_FLAKINESS} runs)</span>
              </div>
            </div>
            {data.workflows.length === 0 ? (
              <p className="awkit-muted">No workflow runs in this range.</p>
            ) : (
              <div className="awkit-table-wrap">
                <table className="awkit-table">
                  <thead>
                    <tr>
                      <th>Workflow</th>
                      <th className="awkit-th-numeric">Runs</th>
                      <th className="awkit-th-numeric">Success</th>
                      <th className="awkit-th-numeric">Retries</th>
                      <th className="awkit-th-numeric" title="flakiness = min(100, round(failureRate×60 + retryRate×40)); timeouts count in the failure rate. Shown only for workflows with ≥5 runs.">
                        Flakiness
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.workflows]
                      .sort((a, b) => (flakinessScore(b) ?? -1) - (flakinessScore(a) ?? -1))
                      .map((row) => {
                        const score = flakinessScore(row);
                        return (
                          <tr key={row.scenarioId ?? row.scenarioName ?? "unknown"}>
                            <td>{row.scenarioName ?? row.scenarioId ?? "(unknown)"}</td>
                            <td className="awkit-td-numeric">{row.totalRuns}</td>
                            <td className="awkit-td-numeric">{(row.successRate * 100).toFixed(0)}%</td>
                            <td className="awkit-td-numeric">{row.retryCount}</td>
                            <td className="awkit-td-numeric">
                              {score === undefined ? <span className="awkit-muted">—</span> : <span className={score >= 40 ? "awkit-flaky-high" : ""}>{score}</span>}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* The evidence behind the aggregates. Without it this page can tell an operator that 12
              runs timed out but not WHICH ones, so the numbers cannot be acted on or checked. The
              rows carry no free-text error message by contract; full detail is fetched per run
              through the already authorization-gated telemetry.runDetail. */}
          {data.failures.recent.length > 0 ? (
            <section className="work-panel awkit-report-panel awkit-report-span-12">
              <div className="awkit-report-panel-head">
                <div>
                  <strong>Failure evidence</strong>
                  <span>Most recent failed runs in this range</span>
                </div>
              </div>
              <div className="awkit-table-wrap">
                <table className="awkit-table" data-testid="failure-evidence-table">
                  <thead>
                    <tr>
                      <th>Workflow</th>
                      <th>Category</th>
                      <th>Ended</th>
                      <th className="awkit-th-numeric">Duration</th>
                      <th>Run</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.failures.recent.map((row) => (
                      <tr key={row.instanceId}>
                        <td>{row.scenarioName ?? row.scenarioId ?? "(unknown)"}</td>
                        <td>{reportCategoryLabel(row.category)}</td>
                        <td>{row.endedAt ? formatWhen(row.endedAt) : <span className="awkit-muted">—</span>}</td>
                        <td className="awkit-td-numeric">
                          {typeof row.durationMs === "number" ? formatDurationMs(row.durationMs) : <span className="awkit-muted">—</span>}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="toolbar-button"
                            data-testid={`failure-evidence-open-${row.instanceId}`}
                            onClick={() => setEvidenceRunId(row.instanceId)}
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      )}

      {evidenceRunId ? <RunDetailDrawer instanceId={evidenceRunId} onClose={() => setEvidenceRunId(null)} /> : null}
    </ReportPage>
  );
}
