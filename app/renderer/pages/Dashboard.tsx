import type { ReactNode } from "react";
import { Activity, CircleAlert, CircleCheck, Clock, KeyRound, LineChart, Monitor, Play, RefreshCw, ShieldAlert, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { RuntimeStatusSnapshot } from "@src/runner/concurrency/RuntimeStatus";
import type { RunHistoryRow, TelemetryOverview } from "@src/reports/TelemetryContracts";
import { licenseAttentionFor, type LicenseAttention } from "@src/licensing/LicenseAttention";
import { Permission } from "@src/security/authz/Permissions";
import { formatDurationMs, statusToTone } from "../components/reports/statusTone";
import { useNavigation } from "../state/navigation";
import { usePageChrome, type PageAction } from "../state/pageChrome";
import { usePermissions } from "../security/usePermissions";
import { RoutePermissions } from "../security/routePermissions";
import { useSession } from "../security/SessionContext";
import { routes, type RouteId } from "../routes";

/** Quick-action entries (approved Dashboard design): deep links into the authoring surfaces. */
const QUICK_ACTION_ROUTES: RouteId[] = ["scenarioBuilder", "flowChart", "recorder", "dataSources"];

interface OfflineRuntimeCheckView {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

interface OfflineRuntimeStatusView {
  checks: OfflineRuntimeCheckView[];
}

/** Compact relative time ("2 min ago") for run rows; "" when the timestamp is unusable. */
function timeAgo(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function compactCount(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** Design spark polyline: normalise values into a w×h box (each series to its own min/max). */
function sparkPoints(values: number[], width: number, height: number, pad: number): string {
  if (values.length < 2) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function Dashboard() {
  const session = useSession();
  const { can } = usePermissions();
  const { navigateTo } = useNavigation();

  const mayReadReports = can(Permission.PAGE_REPORTS);
  const mayViewLicense = can(Permission.LICENSE_VIEW);
  const sessionRef = session?.principal.sessionRef;

  const [overview, setOverview] = useState<TelemetryOverview | null>(null);
  const [recentRuns, setRecentRuns] = useState<RunHistoryRow[]>([]);
  const [telemetryLoaded, setTelemetryLoaded] = useState(false);
  const [offlineStatus, setOfflineStatus] = useState<OfflineRuntimeStatusView | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusSnapshot | null>(null);
  const [licenseAttention, setLicenseAttention] = useState<(LicenseAttention & { detail: string }) | null>(null);

  // Header actions (approved Dashboard design): New workflow + Record a flow.
  const headerActions = useMemo<PageAction[]>(() => {
    const actions: PageAction[] = [];
    if (can(Permission.PAGE_WORKFLOWS)) {
      actions.push({ id: "new-workflow", label: "New workflow", variant: "primary", onClick: () => navigateTo("scenarioBuilder") });
    }
    if (can(Permission.PAGE_RECORDER)) {
      actions.push({ id: "record-flow", label: "Record a flow", onClick: () => navigateTo("recorder") });
    }
    return actions;
  }, [can, navigateTo]);
  usePageChrome({ actions: headerActions, dirty: false }, [headerActions]);

  const loadTelemetry = useCallback(() => {
    if (!mayReadReports) {
      setTelemetryLoaded(true);
      return Promise.resolve();
    }
    return Promise.all([
      window.playwrightFlowStudio.telemetry.overview("24h"),
      window.playwrightFlowStudio.telemetry.runHistory("24h", { limit: 6, offset: 0 })
    ])
      .then(([nextOverview, history]) => {
        setOverview(nextOverview);
        setRecentRuns(history.rows);
      })
      .catch(() => {
        // Degrade to empty panels — the status bar and Reports pages keep their own error surfaces.
        setOverview(null);
        setRecentRuns([]);
      })
      .finally(() => setTelemetryLoaded(true));
  }, [mayReadReports]);

  useEffect(() => {
    void loadTelemetry();
  }, [loadTelemetry]);

  // Pre-run readiness comes from the same offline-runtime validator the status bar reads.
  useEffect(() => {
    window.playwrightFlowStudio.offlineRuntime
      .getStatus()
      .then(setOfflineStatus)
      .catch(() => setOfflineStatus(null));
  }, []);

  // Live execution capacity (active flows / browsers / queue) — polled like the status bar.
  useEffect(() => {
    let active = true;
    const tick = () =>
      window.playwrightFlowStudio.executions
        .runtimeStatus()
        .then((status) => {
          if (active) setRuntimeStatus(status);
        })
        .catch(() => undefined);
    void tick();
    const timer = window.setInterval(tick, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  // License banner mirrors the status-bar attention model: only real license states surface here.
  useEffect(() => {
    if (!sessionRef || !mayViewLicense) {
      setLicenseAttention(null);
      return;
    }
    let active = true;
    window.playwrightFlowStudio.licensing
      .getStatus(sessionRef)
      .then((response) => {
        if (!active) return;
        if (!response.ok || !response.value) {
          setLicenseAttention(null);
          return;
        }
        const attention = licenseAttentionFor(response.value.status);
        setLicenseAttention(attention ? { ...attention, detail: response.value.userAction } : null);
      })
      .catch(() => {
        if (active) setLicenseAttention(null);
      });
    return () => {
      active = false;
    };
  }, [sessionRef, mayViewLicense]);

  const capacity = runtimeStatus?.capacity;
  const activeFlows = capacity?.activeFlows ?? 0;
  const activeBrowsers = capacity?.activeBrowsers ?? 0;
  const queueDepth = capacity?.queueDepth ?? 0;

  const runsSeries = useMemo(() => overview?.runsSeries ?? [], [overview]);
  const runsPerBucket = useMemo(() => runsSeries.map((point) => point.total), [runsSeries]);
  const completedPerBucket = useMemo(() => runsSeries.map((point) => point.total - point.failed), [runsSeries]);
  const failedPerBucket = useMemo(() => runsSeries.map((point) => point.failed), [runsSeries]);

  // Runs trend: last 6 buckets vs the 6 before them, from the same real series the chart plots.
  const runsTrend = useMemo(() => {
    if (runsPerBucket.length < 12) return null;
    const recent = runsPerBucket.slice(-6).reduce((sum, value) => sum + value, 0);
    const prior = runsPerBucket.slice(-12, -6).reduce((sum, value) => sum + value, 0);
    if (prior === 0) return null;
    const delta = ((recent - prior) / prior) * 100;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) return null;
    // Rising run volume reads as growth (the design shows "+12%" in the success tone).
    return { label: `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(0)}%`, good: delta > 0, up: delta > 0 };
  }, [runsPerBucket]);

  const throughputAxis = useMemo(() => {
    if (runsSeries.length === 0) return [];
    const labelAt = (index: number) => {
      const at = new Date(runsSeries[index].bucketIso);
      return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    };
    const last = runsSeries.length - 1;
    const positions = [0, Math.round(last / 4), Math.round(last / 2), Math.round((last * 3) / 4), last];
    return positions.map((position, index) => (index === positions.length - 1 ? "now" : labelAt(position)));
  }, [runsSeries]);

  const median = overview?.duration.medianMs;
  const p95 = overview?.duration.p95Ms;
  const failedRuns = overview?.failedRuns ?? 0;
  const failureRatePct = overview ? overview.failureRate * 100 : 0;

  const quickActions = useMemo(
    () =>
      QUICK_ACTION_ROUTES.map((routeId) => routes.find((route) => route.id === routeId))
        .filter((route): route is NonNullable<typeof route> => Boolean(route))
        .filter((route) => {
          const permission = RoutePermissions[route.id];
          return !permission || can(permission);
        }),
    [can]
  );

  const now = Date.now();

  return (
    <section className="page dashboard-page">
      {licenseAttention ? (
        <p className="dash-banner" role="status">
          <KeyRound size={15} strokeWidth={2} />
          <span>
            {licenseAttention.label}. {licenseAttention.detail}
          </span>
          <button type="button" className="dash-banner-action" onClick={() => navigateTo("licensing")}>
            Open Licensing
          </button>
        </p>
      ) : null}

      <div className="dash-metrics">
        {!telemetryLoaded ? (
          <>
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
            <MetricSkeleton />
          </>
        ) : (
          <>
            <MetricCardTone
              tone="info"
              icon={<Play size={14} strokeWidth={2.2} />}
              label="Runs today"
              value={overview ? compactCount(overview.totalRuns) : "—"}
              detail={overview ? `Last 24 hours · ${compactCount(failedRuns)} failed` : "Run reports unavailable"}
              trend={runsTrend?.label}
              trendTone={runsTrend ? (runsTrend.good ? "success" : "danger") : undefined}
              spark={runsPerBucket.length >= 2 ? runsPerBucket.slice(-12) : undefined}
            />
            <MetricCardTone
              tone="warning"
              icon={<Clock size={14} strokeWidth={2.2} />}
              label="Median duration"
              value={median === undefined ? "—" : median < 1000 ? `${Math.round(median)}` : `${(median / 1000).toFixed(1)}`}
              unit={median === undefined ? "" : median < 1000 ? "ms" : "s"}
              detail={p95 === undefined ? "p95 not sampled yet" : `p95 at ${formatDurationMs(p95)}`}
            />
            <MetricCardTone
              tone="danger"
              icon={<ShieldAlert size={14} strokeWidth={2.2} />}
              label="Failure rate"
              value={overview ? failureRatePct.toFixed(1) : "—"}
              unit={overview ? "%" : ""}
              detail={overview ? `${compactCount(failedRuns)} failed of ${compactCount(overview.totalRuns)} runs` : "Run reports unavailable"}
            />
            <MetricCardTone
              tone="success"
              icon={<Monitor size={14} strokeWidth={2.2} />}
              label="Active instances"
              value={String(activeFlows)}
              unit="flows"
              detail={`${activeBrowsers} browsers · queue ${queueDepth}`}
            />
          </>
        )}
      </div>

      <div className="dash-panels">
        <section className="dash-panel">
          <PanelHeader
            tileTone="success"
            icon={<CircleCheck size={16} strokeWidth={1.9} />}
            title="Run readiness"
            meta="Pre-run checks"
          />
          {offlineStatus ? (
            <div className="dash-checklist">
              {offlineStatus.checks.map((check) => (
                <div className="dash-check-row" key={check.key}>
                  <span className={check.ok ? "dash-check-mark dash-tone-success" : "dash-check-mark dash-tone-warning"}>
                    {check.ok ? <CircleCheck size={13} strokeWidth={2.4} /> : <CircleAlert size={13} strokeWidth={2.4} />}
                  </span>
                  <span className="dash-check-text">
                    <span className="dash-check-title">{check.label}</span>
                    {check.detail ? <span className="dash-check-sub">{check.detail}</span> : null}
                  </span>
                  <span className={check.ok ? "dash-check-badge dash-ink-success" : "dash-check-badge dash-ink-warning"}>
                    {check.ok ? "Ready" : "Action needed"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <PanelSkeleton rows={4} />
          )}
        </section>

        <section className="dash-panel">
          <PanelHeader
            tileTone="running"
            icon={<Activity size={16} strokeWidth={1.9} />}
            title="Recent activity"
            meta="Last executions"
            actions={
              <button
                type="button"
                className="dash-icon-button"
                aria-label="Refresh recent activity"
                title="Refresh recent activity"
                onClick={() => void loadTelemetry()}
              >
                <RefreshCw size={15} strokeWidth={1.9} />
              </button>
            }
          />
          {!telemetryLoaded ? (
            <PanelSkeleton rows={5} />
          ) : !mayReadReports ? (
            <PanelEmpty
              icon={<ShieldAlert size={18} strokeWidth={1.8} />}
              title="Run reports unavailable"
              hint="Your role does not include the Reports permission, so recent executions are not shown here."
            />
          ) : recentRuns.length === 0 ? (
            <PanelEmpty
              icon={<Activity size={18} strokeWidth={1.8} />}
              title="No runs yet"
              hint="Executed workflows will appear here with status and duration."
            />
          ) : (
            <div className="dash-list">
              {recentRuns.map((run) => {
                const tone = statusToTone(run.status);
                return (
                  <div className="dash-list-row" key={`${run.executionId}-${run.instanceId}`}>
                    <span className={`dash-list-tile dash-tone-${tone}`}>{run.scenarioName ? <LineChart size={14} strokeWidth={1.9} /> : <Play size={14} strokeWidth={1.9} />}</span>
                    <span className="dash-list-text">
                      <span className="dash-list-title">{run.scenarioName ?? "Workflow run"}</span>
                      <span className="dash-list-sub">
                        {run.executionId}
                        {run.startedAt ? ` · ${timeAgo(run.startedAt, now)}` : ""}
                      </span>
                    </span>
                    <span className={`dash-badge dash-tone-${tone}`}>
                      <StatusGlyph tone={tone} />
                      {run.status}
                    </span>
                    <span className="dash-list-value">{formatDurationMs(run.durationMs)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="dash-panels">
        <section className="dash-panel">
          <PanelHeader tileTone="info" icon={<Zap size={16} strokeWidth={1.9} />} title="Quick actions" />
          <div className="dash-list">
            {quickActions.map((route) => {
              const Icon = route.icon;
              return (
                <div className="dash-list-row" key={route.id}>
                  <span className="dash-list-tile dash-tone-info">
                    <Icon size={14} strokeWidth={1.9} />
                  </span>
                  <span className="dash-list-text">
                    <span className="dash-list-title">{route.label}</span>
                    <span className="dash-list-sub">{route.description}</span>
                  </span>
                  <button
                    type="button"
                    className="dash-icon-button"
                    aria-label={`Open ${route.label}`}
                    title={`Open ${route.label}`}
                    onClick={() => navigateTo(route.id)}
                  >
                    <Play size={15} strokeWidth={1.9} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section className="dash-panel">
          <PanelHeader tileTone="running" icon={<LineChart size={16} strokeWidth={1.9} />} title="Throughput" meta="Runs per hour · last 24 h" />
          {!telemetryLoaded ? (
            <PanelSkeleton rows={4} />
          ) : !mayReadReports ? (
            <PanelEmpty
              icon={<LineChart size={18} strokeWidth={1.8} />}
              title="Run reports unavailable"
              hint="Your role does not include the Reports permission, so throughput is not shown here."
            />
          ) : runsSeries.length < 2 ? (
            <PanelEmpty
              icon={<LineChart size={18} strokeWidth={1.8} />}
              title="No runs in the last 24 hours"
              hint="The chart plots every run as it completes — run a workflow to see throughput here."
            />
          ) : (
            <div className="dash-chart">
              <div className="dash-chart-plot">
                <svg viewBox="0 0 640 180" preserveAspectRatio="none" role="img" aria-label="Runs per hour, last 24 hours">
                  {[0, 45, 90, 135, 180].map((y) => (
                    <line key={y} x1="0" x2="640" y1={y} y2={y} stroke="var(--awkit-divider)" strokeWidth="1" />
                  ))}
                  <polyline
                    points={sparkPoints(completedPerBucket, 640, 180, 6)}
                    fill="none"
                    stroke="var(--awkit-blue)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                  <polyline
                    points={sparkPoints(failedPerBucket, 640, 180, 6)}
                    fill="none"
                    stroke="var(--awkit-danger)"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
              <div className="dash-chart-axis" aria-hidden="true">
                {throughputAxis.map((label, index) => (
                  <span key={`${label}-${index}`}>{label}</span>
                ))}
              </div>
              <div className="dash-chart-legend">
                <span>
                  <span className="dash-swatch" style={{ background: "var(--awkit-blue)" }} />
                  Completed
                  <em>{compactCount(completedPerBucket.reduce((sum, value) => sum + value, 0))}</em>
                </span>
                <span>
                  <span className="dash-swatch" style={{ background: "var(--awkit-danger)" }} />
                  Failed
                  <em>{compactCount(failedPerBucket.reduce((sum, value) => sum + value, 0))}</em>
                </span>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function MetricSkeleton() {
  return (
    <article className="dash-metric" aria-hidden="true">
      <div className="dash-metric-head">
        <span className="awkit-skeleton-line" style={{ width: "44%", marginTop: 4 }} />
      </div>
      <span className="awkit-skeleton-line" style={{ width: "66%", height: 22 }} />
      <span className="awkit-skeleton-line" style={{ width: "80%" }} />
    </article>
  );
}

function PanelSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true" style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: rows }).map((_, index) => (
        <span className="awkit-skeleton-line" key={index} style={{ width: index % 2 === 0 ? "92%" : "70%" }} />
      ))}
    </div>
  );
}

type DashTone = "success" | "warning" | "danger" | "info" | "running" | "neutral";

function StatusGlyph({ tone }: { tone: DashTone }) {
  if (tone === "success") return <CircleCheck size={11} strokeWidth={2.4} />;
  if (tone === "danger") return <CircleAlert size={11} strokeWidth={2.4} />;
  if (tone === "running") return <Play size={11} strokeWidth={2.4} />;
  return <Clock size={11} strokeWidth={2.4} />;
}

interface MetricCardToneProps {
  tone: DashTone;
  icon: ReactNode;
  label: string;
  value: string;
  unit?: string;
  detail: string;
  trend?: string;
  trendTone?: "success" | "danger";
  spark?: number[];
}

function MetricCardTone({ tone, icon, label, value, unit, detail, trend, trendTone, spark }: MetricCardToneProps) {
  const up = trend?.startsWith("+") ?? false;
  return (
    <article className="dash-metric">
      <div className="dash-metric-head">
        <span className={`dash-metric-tile dash-tone-${tone}`}>{icon}</span>
        <span className="dash-metric-label">{label}</span>
        {trend ? (
          <span className={`dash-metric-trend dash-tone-${trendTone ?? (up ? "success" : "danger")}`}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transform: up ? "rotate(0deg)" : "rotate(180deg)" }}>
              <path d="M12 19V5" />
              <path d="M6 11l6-6 6 6" />
            </svg>
            {trend}
          </span>
        ) : null}
      </div>
      <div className="dash-metric-value">
        <strong>{value}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
      <div className="dash-metric-foot">
        <span>{detail}</span>
        {spark ? (
          <svg viewBox="0 0 160 40" preserveAspectRatio="none" aria-label={`${label} trend`} className="dash-metric-spark" role="img">
            <polyline
              points={sparkPoints(spark, 160, 40, 3)}
              fill="none"
              stroke="var(--awkit-accent)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}
      </div>
    </article>
  );
}

interface PanelHeaderProps {
  tileTone: DashTone;
  icon: ReactNode;
  title: string;
  meta?: string;
  actions?: ReactNode;
}

function PanelHeader({ tileTone, icon, title, meta, actions }: PanelHeaderProps) {
  return (
    <div className="dash-panel-header">
      <span className={`dash-panel-tile dash-tone-${tileTone}`}>{icon}</span>
      <div className="dash-panel-heading">
        <h3>{title}</h3>
        {meta ? <span>{meta}</span> : null}
      </div>
      {actions}
    </div>
  );
}

interface PanelEmptyProps {
  icon: ReactNode;
  title: string;
  hint: string;
}

function PanelEmpty({ icon, title, hint }: PanelEmptyProps) {
  return (
    <div className="dash-panel-empty">
      <span className="dash-panel-empty-tile">{icon}</span>
      <span className="dash-panel-empty-title">{title}</span>
      <span className="dash-panel-empty-hint">{hint}</span>
    </div>
  );
}
