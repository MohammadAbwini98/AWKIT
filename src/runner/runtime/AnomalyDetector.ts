/**
 * Deterministic, explainable resource-regression and anomaly detection (Phase 06).
 *
 * NO AI/LLM. Every alert is reproducible from stored measurements + historical baselines using simple
 * statistics with documented thresholds, minimum-sample requirements, and hysteresis. Pure and
 * framework-agnostic so the whole rule set is unit-testable against synthetic datasets.
 */
import { percentile } from "@src/reports/TelemetryContracts";
import type { AnomalySeverity } from "@src/reports/ObservabilityContracts";
import type { DurableAnomalyRecord, DurableRunRecord } from "../store/RuntimeStoreSchema";

export interface AnomalyDetectionConfig {
  /** Minimum prior runs required before ANY run-level anomaly may fire (never flag from 2–3 runs). */
  minRunHistory: number;
  /** duration ≥ this multiple of the historical median → anomaly. */
  durationMedianMultiple: number;
  /** duration ≥ this multiple of the median → critical (vs warning). */
  durationCriticalMultiple: number;
  /** queue wait ≥ this multiple of the historical P95 → anomaly. */
  queueWaitP95Multiple: number;
  /** Below this historical failure rate, a single failure is treated as anomalous. */
  rareFailureRate: number;
  /** retry count strictly above the historical P95 (and > 0) → anomaly. */
  retryAboveP95: boolean;
  /** Observed run-mean CPU this many percentage points above the historical mean → anomaly. */
  cpuMeanDeltaPoints: number;
  /** Observed run-mean Chromium RSS this fraction above the historical mean → anomaly. */
  chromiumRssMeanDeltaPct: number;

  // ── regression (recent window vs previous comparable window) ──
  /** Minimum runs in EACH window before a regression may fire. */
  minRegressionRuns: number;
  /** duration P95 increased by ≥ this percent → regression. */
  durationP95IncreasePct: number;
  /** failure rate increased by ≥ this many percentage points → regression. */
  failureRatePointIncrease: number;
  /** queue-wait P95 increased by ≥ this percent → regression. */
  queueWaitP95IncreasePct: number;
  /** observed Chromium RSS P95 increased by ≥ this percent → regression. */
  chromiumRssP95IncreasePct: number;
  /** queue-delay count increased by ≥ this percent AND ≥ this absolute → regression. */
  queueDelayIncreasePct: number;
  queueDelayIncreaseAbs: number;
  /** Regression cooldown (ms): suppress a duplicate active regression of the same signal within this window. */
  regressionCooldownMs: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyDetectionConfig = {
  minRunHistory: 8,
  durationMedianMultiple: 2.5,
  durationCriticalMultiple: 4,
  queueWaitP95Multiple: 1.5,
  rareFailureRate: 0.1,
  retryAboveP95: true,
  cpuMeanDeltaPoints: 25,
  chromiumRssMeanDeltaPct: 0.4,
  minRegressionRuns: 10,
  durationP95IncreasePct: 30,
  failureRatePointIncrease: 15,
  queueWaitP95IncreasePct: 50,
  chromiumRssP95IncreasePct: 40,
  queueDelayIncreasePct: 100,
  queueDelayIncreaseAbs: 10,
  regressionCooldownMs: 6 * 3_600_000
};

export interface DetectedAnomaly {
  scope: "run" | "regression";
  signalType: string;
  severity: AnomalySeverity;
  currentValue?: number;
  baselineValue?: number;
  thresholdRule: string;
  windowLabel?: string;
  sampleCount?: number;
  note?: string;
}

// ── Run-level anomaly checks ─────────────────────────────────────────────────

/**
 * Compare ONE completed run against its workflow's historical window (which must already exclude the run).
 * Returns [] when there is insufficient history — never flags from 2–3 runs.
 */
export function detectRunAnomalies(run: DurableRunRecord, history: DurableRunRecord[], config: AnomalyDetectionConfig = DEFAULT_ANOMALY_CONFIG): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = [];
  const priors = history.filter((r) => r.instanceId !== run.instanceId);
  if (priors.length < config.minRunHistory) return out;

  const durations = numbers(priors.map((r) => r.durationMs));
  const median = percentile(durations, 50);
  if (run.durationMs !== undefined && median && median > 0) {
    const ratio = run.durationMs / median;
    if (ratio >= config.durationMedianMultiple) {
      out.push({
        scope: "run",
        signalType: "duration-slow",
        severity: ratio >= config.durationCriticalMultiple ? "critical" : "warning",
        currentValue: run.durationMs,
        baselineValue: median,
        thresholdRule: `duration ≥ ${config.durationMedianMultiple}× historical median`,
        sampleCount: priors.length,
        note: `Run took ${round2(ratio)}× the historical median (${run.durationMs}ms vs ${median}ms).`
      });
    }
  }

  const queueWaits = numbers(priors.map((r) => r.queueWaitMs));
  const queueP95 = percentile(queueWaits, 95);
  if (run.queueWaitMs !== undefined && queueP95 && queueP95 > 0 && run.queueWaitMs >= queueP95 * config.queueWaitP95Multiple) {
    out.push({
      scope: "run",
      signalType: "queue-wait-high",
      severity: "warning",
      currentValue: run.queueWaitMs,
      baselineValue: queueP95,
      thresholdRule: `queue wait ≥ ${config.queueWaitP95Multiple}× historical P95`,
      sampleCount: priors.length,
      note: `Queue wait ${run.queueWaitMs}ms vs historical P95 ${queueP95}ms.`
    });
  }

  if (statusBucket(run.status) === "failed") {
    const priorFailRate = failureRate(priors);
    if (priorFailRate < config.rareFailureRate) {
      out.push({
        scope: "run",
        signalType: "unexpected-failure",
        severity: "warning",
        currentValue: 1,
        baselineValue: round4(priorFailRate),
        thresholdRule: `failure when historical failure rate < ${config.rareFailureRate}`,
        sampleCount: priors.length,
        note: `Run failed though this workflow normally succeeds (historical failure rate ${round2(priorFailRate * 100)}%).`
      });
    }
  }

  if (config.retryAboveP95) {
    const retries = numbers(priors.map((r) => r.retryCount));
    const retryP95 = percentile(retries, 95) ?? 0;
    if ((run.retryCount ?? 0) > 0 && (run.retryCount ?? 0) > retryP95) {
      out.push({
        scope: "run",
        signalType: "retry-high",
        severity: "info",
        currentValue: run.retryCount,
        baselineValue: retryP95,
        thresholdRule: "retry count above historical P95",
        sampleCount: priors.length,
        note: `Run retried ${run.retryCount}× vs historical P95 ${retryP95}.`
      });
    }
  }

  // Environmental CPU (mean over the run, not a brief peak) materially above the historical mean → warning.
  const cpuMeans = numbers(priors.map((r) => r.obsSystemCpuMean));
  const histCpuMean = mean(cpuMeans);
  if (run.obsSystemCpuMean !== undefined && histCpuMean !== undefined && run.obsSystemCpuMean - histCpuMean >= config.cpuMeanDeltaPoints) {
    out.push({
      scope: "run",
      signalType: "observed-cpu-high",
      severity: "warning",
      currentValue: round1(run.obsSystemCpuMean),
      baselineValue: round1(histCpuMean),
      thresholdRule: `observed run-mean CPU ≥ historical mean + ${config.cpuMeanDeltaPoints} points`,
      sampleCount: priors.length,
      note: "Environmental observation (host CPU during the run window), not exclusive workflow CPU."
    });
  }

  const chromiumMeans = numbers(priors.map((r) => r.obsChromiumRssMeanMb));
  const histChromiumMean = mean(chromiumMeans);
  if (
    run.obsChromiumRssMeanMb !== undefined &&
    histChromiumMean !== undefined &&
    histChromiumMean > 0 &&
    run.obsChromiumRssMeanMb >= histChromiumMean * (1 + config.chromiumRssMeanDeltaPct)
  ) {
    out.push({
      scope: "run",
      signalType: "observed-chromium-rss-high",
      severity: "warning",
      currentValue: run.obsChromiumRssMeanMb,
      baselineValue: Math.round(histChromiumMean),
      thresholdRule: `observed Chromium RSS ≥ historical mean × ${1 + config.chromiumRssMeanDeltaPct}`,
      sampleCount: priors.length,
      note: "Environmental observation (total Chromium RSS during the run window), not exclusive workflow RSS."
    });
  }

  return out;
}

// ── Regression checks (recent window vs previous comparable window) ──────────

export interface RegressionInput {
  recent: DurableRunRecord[];
  previous: DurableRunRecord[];
  recentQueueDelays: number;
  previousQueueDelays: number;
  windowLabel: string;
}

export function detectRegressions(input: RegressionInput, config: AnomalyDetectionConfig = DEFAULT_ANOMALY_CONFIG): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = [];
  if (input.recent.length < config.minRegressionRuns || input.previous.length < config.minRegressionRuns) return out;
  const label = input.windowLabel;

  regressPct(out, "duration-p95", "Duration P95", percentile(numbers(input.previous.map((r) => r.durationMs)), 95), percentile(numbers(input.recent.map((r) => r.durationMs)), 95), config.durationP95IncreasePct, label, input.recent.length);

  const prevFail = failureRate(input.previous);
  const recentFail = failureRate(input.recent);
  const failPointIncrease = (recentFail - prevFail) * 100;
  if (failPointIncrease >= config.failureRatePointIncrease) {
    out.push({
      scope: "regression",
      signalType: "failure-rate",
      severity: failPointIncrease >= config.failureRatePointIncrease * 2 ? "critical" : "warning",
      currentValue: round2(recentFail * 100),
      baselineValue: round2(prevFail * 100),
      thresholdRule: `failure rate +${config.failureRatePointIncrease} percentage points`,
      windowLabel: label,
      sampleCount: input.recent.length,
      note: `Failure rate rose ${round2(failPointIncrease)} points (${round2(prevFail * 100)}% → ${round2(recentFail * 100)}%).`
    });
  }

  regressPct(out, "queue-wait-p95", "Queue-wait P95", percentile(numbers(input.previous.map((r) => r.queueWaitMs)), 95), percentile(numbers(input.recent.map((r) => r.queueWaitMs)), 95), config.queueWaitP95IncreasePct, label, input.recent.length, "info");

  regressPct(out, "observed-chromium-rss-p95", "Observed Chromium RSS P95", percentile(numbers(input.previous.map((r) => r.obsChromiumRssMeanMb)), 95), percentile(numbers(input.recent.map((r) => r.obsChromiumRssMeanMb)), 95), config.chromiumRssP95IncreasePct, label, input.recent.length);

  const prevDelays = input.previousQueueDelays;
  const recentDelays = input.recentQueueDelays;
  const absIncrease = recentDelays - prevDelays;
  const pctIncrease = prevDelays > 0 ? (absIncrease / prevDelays) * 100 : recentDelays > 0 ? Infinity : 0;
  if (absIncrease >= config.queueDelayIncreaseAbs && pctIncrease >= config.queueDelayIncreasePct) {
    out.push({
      scope: "regression",
      signalType: "queue-delays",
      severity: "info",
      currentValue: recentDelays,
      baselineValue: prevDelays,
      thresholdRule: `queue delays +${config.queueDelayIncreasePct}% and +${config.queueDelayIncreaseAbs} absolute`,
      windowLabel: label,
      note: `Queue-delay episodes rose from ${prevDelays} to ${recentDelays}.`
    });
  }

  return out;
}

/**
 * Reconcile freshly-detected regressions with the currently-active ones (dedup + cooldown + recovery):
 *  - a NEW regression signal not currently active (or past its cooldown) → an `active` row;
 *  - a previously-active signal NOT detected now → one `recovered` transition row;
 *  - an active signal detected again within its cooldown → suppressed (no duplicate storm).
 * Run-scope anomalies are naturally unique per run and are NOT reconciled here.
 */
export function reconcileRegressions(
  detected: DetectedAnomaly[],
  activeExisting: DurableAnomalyRecord[],
  workflowId: string | undefined,
  nowIso: string,
  config: AnomalyDetectionConfig = DEFAULT_ANOMALY_CONFIG
): DurableAnomalyRecord[] {
  const nowMs = Date.parse(nowIso);
  const detectedBySignal = new Map(detected.map((d) => [d.signalType, d]));
  const activeBySignal = new Map(activeExisting.filter((a) => a.state === "active").map((a) => [a.signalType, a]));
  const rows: DurableAnomalyRecord[] = [];

  for (const d of detected) {
    const active = activeBySignal.get(d.signalType);
    if (active && Number.isFinite(nowMs) && nowMs - Date.parse(active.detectedAt) < config.regressionCooldownMs) continue; // cooldown
    rows.push({
      workflowId,
      detectedAt: nowIso,
      scope: "regression",
      signalType: d.signalType,
      severity: d.severity,
      currentValue: d.currentValue,
      baselineValue: d.baselineValue,
      thresholdRule: d.thresholdRule,
      windowLabel: d.windowLabel,
      sampleCount: d.sampleCount,
      state: "active",
      note: d.note
    });
  }

  for (const active of activeBySignal.values()) {
    if (!detectedBySignal.has(active.signalType)) {
      rows.push({
        workflowId,
        detectedAt: nowIso,
        scope: "regression",
        signalType: active.signalType,
        severity: "info",
        thresholdRule: active.thresholdRule,
        windowLabel: active.windowLabel,
        state: "recovered",
        note: `${active.signalType} regression recovered (no longer over threshold).`
      });
    }
  }

  return rows;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function regressPct(
  out: DetectedAnomaly[],
  signalType: string,
  label: string,
  previous: number | undefined,
  current: number | undefined,
  thresholdPct: number,
  windowLabel: string,
  sampleCount: number,
  baseSeverity: AnomalySeverity = "warning"
): void {
  if (previous === undefined || current === undefined || previous <= 0) return;
  const increasePct = ((current - previous) / previous) * 100;
  if (increasePct >= thresholdPct) {
    out.push({
      scope: "regression",
      signalType,
      severity: increasePct >= thresholdPct * 2 ? escalate(baseSeverity) : baseSeverity,
      currentValue: round1(current),
      baselineValue: round1(previous),
      thresholdRule: `${label} +${thresholdPct}%`,
      windowLabel,
      sampleCount,
      note: `${label} rose ${round1(increasePct)}% (${round1(previous)} → ${round1(current)}).`
    });
  }
}

function escalate(sev: AnomalySeverity): AnomalySeverity {
  return sev === "info" ? "warning" : "critical";
}

function numbers(values: Array<number | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
}

function mean(values: number[]): number | undefined {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
}

function failureRate(runs: DurableRunRecord[]): number {
  let success = 0;
  let failed = 0;
  for (const r of runs) {
    const b = statusBucket(r.status);
    if (b === "success") success += 1;
    else if (b === "failed") failed += 1;
  }
  const denom = success + failed;
  return denom ? failed / denom : 0;
}

function statusBucket(status: string): "success" | "failed" | "cancelled" | "other" {
  if (status === "completed" || status === "passed") return "success";
  if (status === "failed" || status === "crashed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "other";
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
