import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Lightbulb, ShieldAlert } from "lucide-react";
import type { FailureBreakdown, TelemetryRangePreset, WorkflowReportRow } from "@src/reports/TelemetryContracts";
import { reportCategoryLabel, type ReportCategory } from "@src/reports/ReportCategories";
import { EmptyState } from "../components/shared/EmptyState";
import { SkeletonCard } from "../components/shared/SkeletonCard";
import { ReportPage } from "../components/reports/ReportPage";
import { DonutChart, type DonutSegment } from "../components/reports/DonutChart";
import { BarChart, type BarDatum } from "../components/reports/BarChart";
import { useTelemetryQuery } from "../components/reports/useTelemetryQuery";

interface FailuresData {
  failures: FailureBreakdown;
  workflows: WorkflowReportRow[];
}

const CATEGORY_COLORS: Partial<Record<ReportCategory, string>> = {
  navigation: "#3563f8",
  selector: "#5b3e91",
  timeout: "#b97a1a",
  assertion: "#0b1ee6",
  "browser-crash": "#c03434",
  "context-closed": "#c85a54",
  "profile-lock": "#69587e",
  "session-expired": "#8a6d3b",
  "auth-handoff-required": "#1f8a4c",
  network: "#2a9d8f",
  "download-upload": "#457b9d",
  "data-binding": "#7048a8",
  cancelled: "#8a8a8a",
  unknown: "#b0b0b0"
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

  const { data, loading, error, refetch } = useTelemetryQuery<FailuresData>(async () => {
    const [failures, workflows] = await Promise.all([
      window.playwrightFlowStudio.telemetry.failures(range),
      window.playwrightFlowStudio.telemetry.workflows(range)
    ]);
    return { failures, workflows };
  }, [range]);

  const segments: DonutSegment[] = useMemo(
    () =>
      (data?.failures.categories ?? []).map((entry) => ({
        label: reportCategoryLabel(entry.category),
        value: entry.count,
        color: CATEGORY_COLORS[entry.category] ?? "#b0b0b0"
      })),
    [data]
  );

  const noFailures = data && data.failures.total === 0;

  return (
    <ReportPage
      title="Failure Analytics"
      description="Failure categories, reliability ranking, and evidence-based insights."
      icon={<ShieldAlert size={18} />}
      range={range}
      onRangeChange={setRange}
      onRefresh={refetch}
      refreshing={loading}
    >
      {loading && !data ? (
        <SkeletonCard variant="chart" />
      ) : error ? (
        <EmptyState icon={<AlertTriangle size={28} />} title="Could not load failure analytics" hint={error} />
      ) : !data ? null : (
        <>
          {noFailures ? (
            <EmptyState icon={<CheckCircle2 size={28} />} title="No failures in this range" hint="Every completed run in this window succeeded (or was cancelled). Nice." />
          ) : (
            <>
              {buildInsights(data).length > 0 ? (
                <section className="work-panel awkit-report-panel awkit-insights">
                  <Lightbulb size={16} />
                  <ul>
                    {buildInsights(data).map((insight) => (
                      <li key={insight}>{insight}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <div className="awkit-failure-grid">
                <section className="work-panel awkit-report-panel">
                  <div className="awkit-report-panel-head">
                    <div>
                      <strong>Failure categories</strong>
                      <span>{data.failures.total} failed run(s)</span>
                    </div>
                  </div>
                  <div className="awkit-donut-with-legend">
                    <DonutChart segments={segments} centerLabel={String(data.failures.total)} centerSub="failures" />
                    <BarChart data={segments.map((s): BarDatum => ({ label: s.label, value: s.value, color: s.color }))} />
                  </div>
                </section>

                <section className="work-panel awkit-report-panel">
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
              </div>
            </>
          )}

          <section className="work-panel awkit-report-panel">
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
        </>
      )}
    </ReportPage>
  );
}
