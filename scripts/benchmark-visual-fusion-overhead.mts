/**
 * benchmark:visual-fusion-overhead — N2 closure criterion 7 (awkit-vra.12): the end-to-end cost of shadow visual fusion on
 * a real `LocatorFactory` resolve, on real Chromium, at DPR 1 and 2, headless and headed.
 *
 * Each iteration is the N2.5 runtime lab scenario (`verify:visual-fusion-runtime`): four distinctly named buttons, one
 * step on `#save-profile`. Four resolves, each through a new factory as a flow run creates one:
 *   P1 first pass         — no reference on disk yet: the stage captures and writes one (a refresh).
 *   P2 repeat pass        — same stage, inside the 60 s window: rate-limited, no capture.
 *   P3 next-run pass      — a NEW stage on the same folder (`PlaywrightRunner` builds a factory and a stage per flow run)
 *                           with the stores' clock advanced past the 60 s window: due, captures, digest unchanged, nothing
 *                           written. This is the refresh that recurs in production. The refresh table is process-wide,
 *                           so a next run INSIDE the window is rate-limited exactly like P2.
 *   R  recovery           — the target's id is renamed, every saved candidate misses, local recovery wins and the stage
 *                           compares the winner and up to three competitors against the reference.
 *
 * Three arms per iteration, interleaved in a rotating order so drift hits them alike:
 *   baseline — `LocatorFactoryOptions` without a `visualFusion` key (the pre-N2 shape);
 *   off      — `visualFusion: undefined`, exactly what `PlaywrightRunner` passes when `AWKIT_VISUAL_FUSION` is unset;
 *   shadow   — a real `VisualFusionStage` (production store, production digest) with an always-clear handoff check.
 * Off and baseline execute the same factory code, so their difference bounds the harness noise as well as the off path.
 *
 * Overhead = the per-iteration paired difference against baseline, reported as p50 and p95. "Within noise" (the plan's
 * off criterion) is decided per metric and cell, before the run, as: the 95% bootstrap CI of the median paired
 * difference contains 0, or the median difference is at most half the baseline's interquartile range.
 *
 * Non-vacuity: every measured iteration must seed, recover the true target and, in shadow, write on P1, capture on P3
 * and reach a visual comparison on R (numeric winner score, a compared reason); off and baseline must carry no visual
 * block. An FD-5 overrun (a pass observation past the 400 ms budget that held its slot, or a budget-exhausted recovery)
 * is the budget working: it is counted and reported per cell with its capped cost left in the timings, and a cell with
 * overruns in more than 20% of its shadow samples no longer measures the compared path. A cell that misses any of this
 * is INCONCLUSIVE, and the run exits 1. One discarded warm-up iteration per arm
 * and cell precedes the measurement; the very first (cold-process) shadow sample is reported on its own.
 *
 * Writes docs/plans/ai-upgrade-v5/evidence/N2-overhead-matrix.json: timings, codes and rounded scores only, no pixels.
 *
 * Run: npm run benchmark:visual-fusion-overhead
 */

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import type { FlowStep } from "@src/profiles/FlowProfile";
import { LocatorFactory, VISUAL_OBSERVATION_BUDGET_MS, type LocatorRecoveryEvent, type LocatorRecoveryVisual, type LocatorVisualFusion } from "@src/runner/LocatorFactory";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { VisualFusionStage } from "@src/runner/visualFusion/VisualFusionStage";
import { VISUAL_REFERENCE_REFRESH_MS, VisualReferenceStore, type VisualReferenceStoreOptions } from "@src/runner/visualFusion/VisualReferenceStore";
import { VISUAL_EVIDENCE_MAX_BYTES, VISUAL_EVIDENCE_VERSION, type VisualEvidence } from "@src/visual/visualEvidence";

const ITERATIONS = 25;
const MATRIX = [
  { headless: true, dpr: 1 },
  { headless: true, dpr: 2 },
  { headless: false, dpr: 1 },
  { headless: false, dpr: 2 }
];
const ARMS = ["baseline", "off", "shadow"] as const;
type Arm = (typeof ARMS)[number];
const METRICS = ["firstPassMs", "repeatPassMs", "nextRunPassMs", "recoverMs"] as const;
type Metric = (typeof METRICS)[number];
const EVIDENCE_PATH = "docs/plans/ai-upgrade-v5/evidence/N2-overhead-matrix.json";
/** The fusion R1/R2 "no visual comparison happened" reasons (`decideFusion`), as in `verify:visual-fusion-runtime`. */
const UNCOMPARED = new Set(["protected-surface", "budget-exhausted", "cancelled", "target-stale", "target-offscreen", "frame-mapping-failed", "version-mismatch", "capture-failed", "fusion-off", "step-ineligible", "no-reference", "invalid-input"]);

const LAB = `<!doctype html><html><body style="font:16px sans-serif;margin:24px;background:#fff">
<main><section id="profile"><h2>Profile</h2><div class="actions" style="display:flex;gap:12px">
<button id="save-profile" type="button" style="background:#1d4ed8;color:#fff;border:0;padding:8px 16px">Save profile</button>
<button id="cancel-profile" type="button" style="background:#e5e7eb;border:0;padding:8px 16px">Cancel</button>
<button id="reset-profile" type="button" style="background:#fde68a;border:0;padding:8px 16px">Reset form</button>
<button id="export-profile" type="button" style="background:#bbf7d0;border:0;padding:8px 16px">Export</button>
</div></section></main></body></html>`;

const ROOT = await mkdtemp(join(tmpdir(), "awkit-fusion-overhead-"));

const digestOf = (value: unknown): string | null => {
  const digest = (value as VisualEvidence | null)?.fingerprint?.contentDigest;
  return typeof digest === "string" ? digest : null;
};

/** The production store, recording each refresh outcome so a sample can prove which path it measured. */
class RecordingStore extends VisualReferenceStore {
  readonly statuses: string[] = [];
  override async refresh(...args: Parameters<VisualReferenceStore["refresh"]>): ReturnType<VisualReferenceStore["refresh"]> {
    const result = await super.refresh(...args);
    this.statuses.push(result.status);
    return result;
  }
}

interface Sample {
  arm: Arm;
  firstPassMs: number;
  repeatPassMs: number;
  nextRunPassMs: number;
  recoverMs: number;
  seeded: boolean;
  recovered: boolean;
  isTarget: boolean;
  visual: LocatorRecoveryVisual | null;
  /** shadow only: refresh outcomes during P1, P2, P3 and R. */
  refresh: { p1: string[]; p2: string[]; p3: string[]; r: string[] };
  /** shadow only: wall time inside `observePass` for P1, P2, P3. */
  observePassMs: [number, number, number];
}

function stage(folder: string, store: RecordingStore, passMs: number[]): LocatorVisualFusion {
  const real = new VisualFusionStage({ folder, store, handedOff: () => false });
  return {
    observeRecovery: (observation) => real.observeRecovery(observation),
    observePass: async (observation) => {
      // Indexed by start order: an overrun observation can finish after the next pass started.
      const index = passMs.push(Number.NaN) - 1;
      const started = performance.now();
      try {
        await real.observePass(observation);
      } finally {
        passMs[index] = performance.now() - started;
      }
    }
  };
}

async function timed(run: () => Promise<unknown>): Promise<{ ms: number; ok: boolean }> {
  const started = performance.now();
  try {
    await run();
    return { ms: performance.now() - started, ok: true };
  } catch {
    return { ms: performance.now() - started, ok: false };
  }
}

async function iteration(context: BrowserContext, arm: Arm): Promise<Sample> {
  const page = await context.newPage();
  try {
    await page.setContent(LAB);
    const recoveryStore = new FileLocatorRecoveryStore(await mkdtemp(join(ROOT, "recovery-")));
    const events: LocatorRecoveryEvent[] = [];
    const step = { id: "save-profile", name: "Save profile", type: "click", locator: { strategy: "css", value: "#save-profile" } } as unknown as FlowStep;
    const passMs: number[] = [];
    let firstRun: LocatorVisualFusion | undefined;
    let nextRun: LocatorVisualFusion | undefined;
    let firstStore: RecordingStore | undefined;
    let nextStore: RecordingStore | undefined;
    let clockOffset = 0;
    if (arm === "shadow") {
      const folder = await mkdtemp(join(ROOT, "visual-"));
      const now = () => Date.now() + clockOffset;
      const options: VisualReferenceStoreOptions = { folder, evidenceVersion: VISUAL_EVIDENCE_VERSION, maxEvidenceBytes: VISUAL_EVIDENCE_MAX_BYTES, digestOf, now };
      firstStore = new RecordingStore(options);
      nextStore = new RecordingStore(options);
      firstRun = stage(folder, firstStore, passMs);
      nextRun = stage(folder, nextStore, passMs);
    }
    const factory = (fusion: LocatorVisualFusion | undefined) =>
      new LocatorFactory(page, {
        recoveryStore,
        scope: { scenarioId: "n2-overhead", flowId: "overhead" },
        recoveryGraceMs: 0,
        onRecoveryEvent: (event) => events.push(event),
        ...(arm === "baseline" ? {} : { visualFusion: fusion })
      });
    await page.evaluate(() => {
      (window as unknown as { __target: Element }).__target = document.getElementById("save-profile")!;
    });
    const p1 = await timed(() => factory(firstRun).resolve(step));
    const p1Statuses = [...(firstStore?.statuses ?? [])];
    const p2 = await timed(() => factory(firstRun).resolve(step));
    const p2Statuses = (firstStore?.statuses ?? []).slice(p1Statuses.length);
    // The next flow run, after the refresh window (the stores' injected clock; baseline and off have no store).
    clockOffset += VISUAL_REFERENCE_REFRESH_MS + 1_000;
    const p3 = await timed(() => factory(nextRun).resolve(step));
    const p3Statuses = [...(nextStore?.statuses ?? [])];
    await page.evaluate(() => {
      document.getElementById("save-profile")!.id = "profile-save";
    });
    let isTarget = false;
    const started = performance.now();
    let recoverMs = 0;
    let recoveredOk = false;
    try {
      const locator = await factory(nextRun)
        .resolve(step)
        .finally(() => (recoverMs = performance.now() - started));
      recoveredOk = true;
      isTarget = await locator.evaluate((element) => element === (window as unknown as { __target: Element }).__target);
    } catch {
      recoveredOk = false;
    }
    const visuals = events.filter((event) => event.type === "recovery-trace").map((event) => event.trace?.visual ?? null);
    return {
      arm,
      firstPassMs: p1.ms,
      repeatPassMs: p2.ms,
      nextRunPassMs: p3.ms,
      recoverMs,
      seeded: p1.ok && p2.ok && p3.ok,
      recovered: recoveredOk && events.some((event) => event.type === "local-recovery"),
      isTarget,
      visual: visuals.at(-1) ?? null,
      refresh: { p1: p1Statuses, p2: p2Statuses, p3: p3Statuses, r: (nextStore?.statuses ?? []).slice(p3Statuses.length) },
      observePassMs: [passMs[0] ?? 0, passMs[1] ?? 0, passMs[2] ?? 0]
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * FD-5 overruns in a shadow sample: a pass observation that ran past the budget and refreshed nothing (its slot is
 * held), or a recovery whose trace says budget-exhausted. These are the budget working, not a broken sample: they are
 * counted and reported, and their (capped) cost stays in the timings.
 */
function overruns(sample: Sample): string[] {
  if (sample.arm !== "shadow") return [];
  const found: string[] = [];
  const passes = [sample.refresh.p1, sample.refresh.p2, sample.refresh.p3];
  passes.forEach((statuses, p) => {
    if (statuses.length === 0 && sample.observePassMs[p] >= VISUAL_OBSERVATION_BUDGET_MS) found.push(`P${p + 1}`);
  });
  // The step stopped waiting at the budget, but a store write already under way when it did completes afterwards.
  if (lateP1Write(sample)) found.push("P1-late-write");
  if (sample.visual?.reason === "budget-exhausted") found.push("R");
  return found;
}

/** P1 overran with its capture done and its single store write still in flight; the write landed during P2. */
function lateP1Write(sample: Sample): boolean {
  return sample.refresh.p1.length === 0 && sample.observePassMs[0] >= VISUAL_OBSERVATION_BUDGET_MS && sample.refresh.p2.length === 1 && sample.refresh.p2[0] === "written";
}

/** Why a sample does not measure the path it claims, or null. An FD-5 overrun is reported, never excused silently. */
function invalid(sample: Sample): string | null {
  if (!sample.seeded) return "a passing resolve failed";
  if (!sample.recovered || !sample.isTarget) return "the recovery did not return the renamed target";
  if (sample.arm !== "shadow") return sample.visual === null ? null : "a visual block without fusion";
  const over = new Set(overruns(sample));
  if (!over.has("P1") && !sample.refresh.p1.includes("written")) return `P1 wrote no reference (${sample.refresh.p1.join(",") || "no refresh"})`;
  if (sample.refresh.p2.length !== 0 && !over.has("P1-late-write")) return `P2 refreshed inside the window (${sample.refresh.p2.join(",")})`;
  // A held P1 slot means P3 is the first seed, so it writes; otherwise it captures and finds the digest unchanged.
  if (!over.has("P3") && !sample.refresh.p3.some((status) => status === "unchanged" || status === "written")) return `P3 did not capture and refresh (${sample.refresh.p3.join(",") || "no refresh"})`;
  if (over.has("R")) return null;
  const v = sample.visual;
  if (!v || typeof v.winnerScore !== "number" || UNCOMPARED.has(v.reason) || v.outcome === "unchecked") return `R reached no visual comparison (${v ? `${v.outcome}/${v.reason}` : "no visual block"})`;
  return null;
}

/** Non-vacuity: a cell whose overruns exceed this share of its shadow samples no longer measures the compared path. */
const MAX_OVERRUN_SHARE = 0.2;

const quantile = (values: number[], q: number): number => {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const at = (s.length - 1) * q;
  const lo = Math.floor(at);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (at - lo);
};
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Deterministic resampling: mulberry32. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function medianCi(values: number[]): [number, number] {
  const next = rng(0x5eed);
  const medians: number[] = [];
  for (let i = 0; i < 2000; i += 1) medians.push(quantile(values.map(() => values[Math.floor(next() * values.length)]), 0.5));
  return [quantile(medians, 0.025), quantile(medians, 0.975)];
}

interface MetricSummary {
  p50: Record<Arm, number>;
  p95: Record<Arm, number>;
  shadowOverhead: { p50: number; p95: number };
  offOverhead: { p50: number; p95: number; ci95: [number, number]; noiseBand: number; withinNoise: boolean };
}

function summarize(byArm: Record<Arm, Sample[]>, metric: Metric): MetricSummary {
  const values = (arm: Arm) => byArm[arm].map((s) => s[metric]);
  const paired = (arm: Arm) => byArm[arm].map((s, i) => s[metric] - byArm.baseline[i][metric]);
  const offDiff = paired("off");
  const ci = medianCi(offDiff);
  const median = quantile(offDiff, 0.5);
  const noiseBand = (quantile(values("baseline"), 0.75) - quantile(values("baseline"), 0.25)) / 2;
  const by = (q: number) => Object.fromEntries(ARMS.map((arm) => [arm, round1(quantile(values(arm), q))])) as Record<Arm, number>;
  return {
    p50: by(0.5),
    p95: by(0.95),
    shadowOverhead: { p50: round1(quantile(paired("shadow"), 0.5)), p95: round1(quantile(paired("shadow"), 0.95)) },
    offOverhead: {
      p50: round1(median),
      p95: round1(quantile(offDiff, 0.95)),
      ci95: [round1(ci[0]), round1(ci[1])],
      noiseBand: round1(noiseBand),
      withinNoise: (ci[0] <= 0 && ci[1] >= 0) || Math.abs(median) <= noiseBand
    }
  };
}

const keepAlive = setInterval(() => undefined, 1_000);
const cells: unknown[] = [];
const cold: unknown[] = [];
let exitCode = 0;
let browser: Browser | undefined;
let browserVersion = "";

try {
  console.log(`\nN2 overhead matrix — ${ITERATIONS} iterations x ${ARMS.length} arms per cell, budget ${VISUAL_OBSERVATION_BUDGET_MS} ms\n`);
  for (const headless of [true, false]) {
    browser = await chromium.launch({ headless });
    browserVersion = browser.version();
    let firstOfProcess = true;
    for (const { dpr } of MATRIX.filter((cell) => cell.headless === headless)) {
      const label = `${headless ? "headless" : "headed"} DPR ${dpr}`;
      const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
      const started = performance.now();
      // Warm-up, discarded: one iteration per arm. The process's first shadow sample is kept as the cold reading.
      for (const arm of ARMS) {
        const warm = await iteration(context, arm);
        if (arm === "shadow" && firstOfProcess) {
          cold.push({ headless, dpr, firstPassMs: round1(warm.firstPassMs), observePassMs: warm.observePassMs.map(round1), refresh: warm.refresh, recoverMs: round1(warm.recoverMs), visual: warm.visual });
          firstOfProcess = false;
        }
      }
      const byArm: Record<Arm, Sample[]> = { baseline: [], off: [], shadow: [] };
      for (let i = 0; i < ITERATIONS; i += 1) {
        for (let k = 0; k < ARMS.length; k += 1) {
          const arm = ARMS[(i + k) % ARMS.length];
          byArm[arm].push(await iteration(context, arm));
        }
      }
      await context.close();
      const problems = ARMS.flatMap((arm) => byArm[arm].map((s, i) => [arm, i, invalid(s)] as const)).filter(([, , why]) => why !== null);
      const shadow = byArm.shadow;
      const visualMs = shadow.map((s) => s.visual?.ms ?? 0);
      const outcomes: Record<string, number> = {};
      for (const s of shadow) outcomes[`${s.visual?.outcome}/${s.visual?.reason}`] = (outcomes[`${s.visual?.outcome}/${s.visual?.reason}`] ?? 0) + 1;
      const summary = Object.fromEntries(METRICS.map((metric) => [metric, summarize(byArm, metric)])) as Record<Metric, MetricSummary>;
      const passStage = [0, 1, 2].map((p) => ({ p50: round1(quantile(shadow.map((s) => s.observePassMs[p]), 0.5)), p95: round1(quantile(shadow.map((s) => s.observePassMs[p]), 0.95)) }));
      const budgetExhausted = shadow.filter((s) => s.visual?.reason === "budget-exhausted").length;
      const overrunList = shadow.flatMap((s, i) => overruns(s).map((at) => `shadow#${i}:${at}`));
      const overrunSamples = shadow.filter((s) => overruns(s).length > 0).length;
      if (overrunSamples > ITERATIONS * MAX_OVERRUN_SHARE) problems.push(["shadow", -1, `${overrunSamples}/${ITERATIONS} samples overran the budget (cap ${MAX_OVERRUN_SHARE * 100}%)`]);
      const state = problems.length > 0 ? "INCONCLUSIVE" : "MEASURED";
      if (problems.length > 0) exitCode = 1;
      cells.push({
        headless,
        dpr,
        state,
        problems: problems.slice(0, 10).map(([arm, i, why]) => `${arm}#${i}: ${why}`),
        iterations: ITERATIONS,
        summary,
        budgetOverruns: { samples: overrunSamples, events: overrunList },
        recoveryStage: { p50: round1(quantile(visualMs, 0.5)), p95: round1(quantile(visualMs, 0.95)), max: round1(Math.max(...visualMs)), budgetExhausted, outcomes },
        passStage: { firstPass: passStage[0], repeatPass: passStage[1], nextRunPass: passStage[2] },
        refreshStatuses: { p3: [...new Set(shadow.flatMap((s) => s.refresh.p3))], r: [...new Set(shadow.flatMap((s) => s.refresh.r))] },
        raw: Object.fromEntries(ARMS.map((arm) => [arm, Object.fromEntries(METRICS.map((m) => [m, byArm[arm].map((s) => round1(s[m]))]))]))
      });
      const row = (name: string, m: MetricSummary) =>
        `    ${name.padEnd(14)} p50 base ${m.p50.baseline} off ${m.p50.off} shadow ${m.p50.shadow} | shadow overhead p50 ${m.shadowOverhead.p50} p95 ${m.shadowOverhead.p95} | off overhead p50 ${m.offOverhead.p50} CI [${m.offOverhead.ci95.join(", ")}] band ${m.offOverhead.noiseBand} ${m.offOverhead.withinNoise ? "within noise" : "OUTSIDE NOISE"}`;
      console.log(`  ${label}: ${state} (${((performance.now() - started) / 1000).toFixed(1)} s)${problems.length ? ` — ${problems.length} invalid samples, first: ${problems[0][0]}#${problems[0][1]} ${problems[0][2]}` : ""}`);
      for (const metric of METRICS) console.log(row(metric, summary[metric]));
      console.log(`    recovery stage ms p50 ${round1(quantile(visualMs, 0.5))} p95 ${round1(quantile(visualMs, 0.95))} max ${round1(Math.max(...visualMs))}, budget-exhausted ${budgetExhausted}/${ITERATIONS}, outcomes ${JSON.stringify(outcomes)}`);
      console.log(`    FD-5 budget overruns: ${overrunSamples}/${ITERATIONS} shadow samples ${overrunList.length ? `(${overrunList.join(", ")})` : ""}`);
      console.log(`    pass stage ms p50/p95  P1 ${passStage[0].p50}/${passStage[0].p95}  P2 ${passStage[1].p50}/${passStage[1].p95}  P3 ${passStage[2].p50}/${passStage[2].p95}\n`);
    }
    await browser.close();
    browser = undefined;
  }
  console.log(`  cold first shadow sample per browser process: ${JSON.stringify(cold)}`);
  const offWithin = cells.every((cell) => Object.values((cell as { summary: Record<Metric, MetricSummary> }).summary).every((m) => m.offOverhead.withinNoise));
  console.log(`\n  fusion off within noise of baseline in every cell and metric: ${offWithin ? "yes" : "NO"}`);
  await mkdir(dirname(EVIDENCE_PATH), { recursive: true });
  await writeFile(
    EVIDENCE_PATH,
    `${JSON.stringify(
      {
        benchmark: "benchmark:visual-fusion-overhead",
        criterion: "awkit-vra.12 acceptance criterion 7",
        measuredAt: new Date().toISOString(),
        environment: { node: process.version, chromium: browserVersion, platform: process.platform, cpu: cpus()[0]?.model ?? "unknown", logicalCpus: cpus().length },
        budgetMs: VISUAL_OBSERVATION_BUDGET_MS,
        iterations: ITERATIONS,
        noiseRule: "95% bootstrap CI of the median paired difference contains 0, or the median difference is at most half the baseline IQR",
        offWithinNoiseEverywhere: offWithin,
        cold,
        cells
      },
      null,
      2
    )}\n`
  );
  console.log(`  wrote ${EVIDENCE_PATH}`);
} catch (error) {
  exitCode = 1;
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  clearInterval(keepAlive);
  await rm(ROOT, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(exitCode);
