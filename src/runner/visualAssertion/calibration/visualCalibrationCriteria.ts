/**
 * The VA-12 qualification criterion (Phase N, N6.6 / awkit-vra.15.6), as a PURE decision over recorded trial
 * evidence. Plan: docs/plans/ai-upgrade-v5/N6-visual-assertions.md › Enforcement grants, "Confidence criterion (fixed
 * before measuring), per cell". Nothing here measures, signs or issues: the calibration root
 * (`app/main/calibration/visualCalibrationRoot.ts`) records real launches and calls this, and issues a grant only for
 * a cell this function qualifies.
 *
 * Per cell (render mode x device pixel ratio), counting only launches recorded in THIS environment (browser, app, OS
 * build, capture policy, fingerprint, policy and suite versions — a grant binds exactly those):
 *   1. at least 300 primary trials `passed` over at least three separate sessions, and ZERO primary trials `failed`
 *      (an inconclusive primary trial counts toward neither);
 *   2. restyle, swap, text and size each `failed` in at least 30 launches, and never `passed`;
 *   3. moved, clipped and interaction-state fixtures always `inconclusive`;
 *   4. zero captures on the protected, handoff and sensitive fixtures, each refused inconclusive;
 *   5. the p95 of primary-trial durations within the 2000 ms deadline.
 */

export const VISUAL_CALIBRATION_MIN_PASSED = 300;
export const VISUAL_CALIBRATION_MIN_SESSIONS = 3;
export const VISUAL_CALIBRATION_MIN_NEGATIVE_LAUNCHES = 30;
export const VISUAL_CALIBRATION_P95_LIMIT_MS = 2000;

export type VisualCalibrationFixture =
  | "primary"
  | "restyle"
  | "swap"
  | "text"
  | "size"
  | "moved"
  | "clipped"
  | "hovered"
  | "focused"
  | "protected"
  | "handoff"
  | "sensitive";

export const VISUAL_CALIBRATION_NEGATIVES: readonly VisualCalibrationFixture[] = ["restyle", "swap", "text", "size"];
export const VISUAL_CALIBRATION_ALWAYS_INCONCLUSIVE: readonly VisualCalibrationFixture[] = ["moved", "clipped", "hovered", "focused"];
export const VISUAL_CALIBRATION_ZERO_CAPTURE: readonly VisualCalibrationFixture[] = ["protected", "handoff", "sensitive"];

export interface VisualCalibrationTrial {
  fixture: VisualCalibrationFixture;
  verdict: "passed" | "failed" | "inconclusive";
  code: string;
  durationMs: number;
  /** Guarded captures the adapter requested for this fixture. */
  captures: number;
}

export interface VisualCalibrationCellKey {
  renderMode: "headed" | "headless";
  devicePixelRatio: number;
}

/** The environment a launch ran in: exactly the fields a grant binds besides the cell. */
export interface VisualCalibrationEnvironment {
  browserVersion: string;
  appVersion: string;
  osBuild: string;
  capturePolicy: string;
  fingerprintVersion: string;
  assertionPolicyVersion: number;
  calibrationSuiteVersion: string;
}

/** One fresh browser launch (one independent trial of the primary fixture, plus any other fixtures it ran). */
export interface VisualCalibrationLaunch {
  /** Random per launch (recorded since 2026-10-25; earlier launches are identified by session, cell and start time). */
  launchId?: string;
  /** Browser contexts already open when the trial began; 0 proves a fresh browser (recorded since 2026-10-25). */
  contextsAtStart?: number;
  sessionId: string;
  cell: VisualCalibrationCellKey;
  environment: VisualCalibrationEnvironment;
  startedAt: string;
  trials: VisualCalibrationTrial[];
}

export interface VisualCalibrationCellSummary {
  cell: VisualCalibrationCellKey;
  qualified: boolean;
  /** Every unmet criterion, in plan order; empty only when qualified. */
  unmet: string[];
  launches: number;
  sessions: number;
  primary: { passed: number; failed: number; inconclusive: number };
  negatives: Record<string, { failed: number; passed: number; inconclusive: number }>;
  alwaysInconclusiveViolations: number;
  zeroCaptureViolations: number;
  p95Ms: number | null;
  /**
   * The plan's bound: with zero failed primary trials in n passed ones, the one-sided 95 % upper bound on the per-launch
   * false-mismatch probability is 1 - 0.05^(1/n) (Clopper-Pearson). Null when a primary failed or none passed. It
   * assumes independent launches and covers the calibration fixtures on this machine and environment only.
   */
  falseMismatchUpperBound95: number | null;
  /** Observe usefulness: unchanged primaries `passed` plus negatives `failed`, over all primary and negative trials. */
  observeUsefulness: { decisive: number; total: number; rate: number | null };
}

export const cellId = (cell: VisualCalibrationCellKey): string => `${cell.renderMode}@${cell.devicePixelRatio}`;

const sameEnvironment = (a: VisualCalibrationEnvironment, b: VisualCalibrationEnvironment): boolean =>
  a.browserVersion === b.browserVersion &&
  a.appVersion === b.appVersion &&
  a.osBuild === b.osBuild &&
  a.capturePolicy === b.capturePolicy &&
  a.fingerprintVersion === b.fingerprintVersion &&
  a.assertionPolicyVersion === b.assertionPolicyVersion &&
  a.calibrationSuiteVersion === b.calibrationSuiteVersion;

/** Nearest-rank p95; null with no samples. */
export function p95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];
}

/** Decide one cell from every recorded launch. Launches of other cells or other environments are ignored. */
export function evaluateCalibrationCell(
  cell: VisualCalibrationCellKey,
  environment: VisualCalibrationEnvironment,
  launches: readonly VisualCalibrationLaunch[]
): VisualCalibrationCellSummary {
  const mine = launches.filter((l) => cellId(l.cell) === cellId(cell) && sameEnvironment(l.environment, environment));
  const sessionsWithPass = new Set<string>();
  const primary = { passed: 0, failed: 0, inconclusive: 0 };
  const durations: number[] = [];
  const negatives: Record<string, { failed: number; passed: number; inconclusive: number }> = {};
  for (const name of VISUAL_CALIBRATION_NEGATIVES) negatives[name] = { failed: 0, passed: 0, inconclusive: 0 };
  let alwaysInconclusiveViolations = 0;
  let zeroCaptureViolations = 0;

  for (const launch of mine) {
    // Criterion 1 counts ONE primary trial per launch (the launch is the independent unit).
    const first = launch.trials.find((t) => t.fixture === "primary");
    if (first) {
      primary[first.verdict] += 1;
      durations.push(first.durationMs);
      if (first.verdict === "passed") sessionsWithPass.add(launch.sessionId);
    }
    for (const trial of launch.trials) {
      if (trial.fixture === "primary") {
        // Any further primary trial in the same launch is recorded but never counted as independent; a failure still disqualifies.
        if (trial !== first && trial.verdict === "failed") primary.failed += 1;
        continue;
      }
      if (VISUAL_CALIBRATION_NEGATIVES.includes(trial.fixture)) negatives[trial.fixture][trial.verdict] += 1;
      else if (VISUAL_CALIBRATION_ALWAYS_INCONCLUSIVE.includes(trial.fixture)) {
        if (trial.verdict !== "inconclusive") alwaysInconclusiveViolations += 1;
      } else if (VISUAL_CALIBRATION_ZERO_CAPTURE.includes(trial.fixture)) {
        if (trial.captures !== 0 || trial.verdict !== "inconclusive") zeroCaptureViolations += 1;
      }
    }
  }

  const unmet: string[] = [];
  if (primary.passed < VISUAL_CALIBRATION_MIN_PASSED) unmet.push(`primary-passed ${primary.passed}/${VISUAL_CALIBRATION_MIN_PASSED}`);
  if (sessionsWithPass.size < VISUAL_CALIBRATION_MIN_SESSIONS) unmet.push(`sessions ${sessionsWithPass.size}/${VISUAL_CALIBRATION_MIN_SESSIONS}`);
  if (primary.failed > 0) unmet.push(`primary-failed ${primary.failed}`);
  for (const name of VISUAL_CALIBRATION_NEGATIVES) {
    const n = negatives[name];
    if (n.failed < VISUAL_CALIBRATION_MIN_NEGATIVE_LAUNCHES) unmet.push(`${name}-failed ${n.failed}/${VISUAL_CALIBRATION_MIN_NEGATIVE_LAUNCHES}`);
    if (n.passed > 0) unmet.push(`${name}-passed ${n.passed}`);
  }
  if (alwaysInconclusiveViolations > 0) unmet.push(`not-inconclusive ${alwaysInconclusiveViolations}`);
  if (zeroCaptureViolations > 0) unmet.push(`refusal-violations ${zeroCaptureViolations}`);
  const p = p95(durations);
  if (p === null || p > VISUAL_CALIBRATION_P95_LIMIT_MS) unmet.push(`p95 ${p ?? "none"}/${VISUAL_CALIBRATION_P95_LIMIT_MS}`);

  const negativeTotals = Object.values(negatives).reduce((sum, n) => ({ decisive: sum.decisive + n.failed, total: sum.total + n.failed + n.passed + n.inconclusive }), { decisive: 0, total: 0 });
  const decisive = primary.passed + negativeTotals.decisive;
  const total = primary.passed + primary.failed + primary.inconclusive + negativeTotals.total;
  return {
    cell,
    qualified: unmet.length === 0,
    falseMismatchUpperBound95: primary.failed === 0 && primary.passed > 0 ? 1 - Math.pow(0.05, 1 / primary.passed) : null,
    observeUsefulness: { decisive, total, rate: total > 0 ? decisive / total : null },
    unmet,
    launches: mine.length,
    sessions: sessionsWithPass.size,
    primary,
    negatives,
    alwaysInconclusiveViolations,
    zeroCaptureViolations,
    p95Ms: p
  };
}
