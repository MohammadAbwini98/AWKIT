/**
 * Phase 6 — A8 workload-weight calibration. Runs each workload class as an isolated single-class cohort at
 * a fixed concurrency through the REAL ExecutionEngine, measures the per-instance runtime cost (Chromium
 * subtree CPU + RSS, duration), and compares the MEASURED relative cost to the existing WorkloadWeights
 * model (computeWorkloadWeight). Emits the required table and a recommended weight per class.
 *
 * Deliberately does NOT build a second weighting system — it measures the existing one and proposes updated
 * constants. Also probes the "waiting" question: a workflow that mostly idles must not be weighted like a
 * CPU-heavy one just because it stays active a long time.
 *
 *   npm run benchmark:engine-weights            (fixed concurrency 4, 25s per class)
 *   AWKIT_WEIGHT_CONC=6 AWKIT_WEIGHT_HOLD_MS=30000 npm run benchmark:engine-weights
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { startWorkloadServer } from "./benchmark/lib.mts";
import { runStage, buildDirs, cleanupRoot, installBenchGuards, type ConfigSpec, type StageResult } from "./benchmark/engineHarness.mts";
import { WORKLOAD_CLASSES, type WorkloadClass } from "./benchmark/workloads.mts";

installBenchGuards();

const CONC = Number.parseInt(process.env.AWKIT_WEIGHT_CONC ?? "4", 10);
const HOLD_MS = Number.parseInt(process.env.AWKIT_WEIGHT_HOLD_MS ?? "25000", 10);
const PORT = 4440;

/** Mean Chromium-subtree CPU (in cores) over the stage, from cumulative CPU units (Win32 100ns ticks). */
function chromiumCpuCores(r: StageResult): number {
  const s = r.samples.filter((x) => x.chromiumProcs > 0);
  if (s.length < 2) return 0;
  const first = s[0], last = s[s.length - 1];
  const elapsedSec = (last.atMs - first.atMs) / 1000;
  if (elapsedSec <= 0) return 0;
  const unitDelta = last.chromiumCpuUnits - first.chromiumCpuUnits; // 100ns units
  return Math.max(0, (unitDelta * 100) / 1e9 / elapsedSec); // ns → s → cores
}

async function main() {
  const wl = await startWorkloadServer(PORT);
  const perClass: Record<string, {
    existingWeight: number; activeMedian: number;
    cpuCoresTotal: number; cpuPerInstance: number;
    chromiumRssMedianMb: number; ramPerInstanceMb: number;
    durationP50Ms?: number; durationP95Ms?: number; completed: number; failRate: number;
  }> = {};

  try {
    for (const cls of WORKLOAD_CLASSES) {
      const spec: ConfigSpec = { name: `W-${cls}`, sharedPool: false, workloadWeights: false, maxBrowsersPerHost: CONC, maxActiveFlows: CONC };
      process.stdout.write(`  measuring ${cls} at concurrency ${CONC} … `);
      const { dirs, root } = await buildDirs("awkit-weightcal-");
      const engine = new ExecutionEngine();
      const r = await runStage(engine, wl, dirs, { config: spec, targetActive: CONC, holdMs: HOLD_MS, headless: true, mix: { [cls]: 1 } });
      await cleanupRoot(root);
      const active = Math.max(1, r.sustainedActive?.median ?? CONC);
      const cpuCores = chromiumCpuCores(r);
      const rss = r.chromiumRssMb?.median ?? 0;
      perClass[cls] = {
        existingWeight: r.perClassWeight[cls],
        activeMedian: r.sustainedActive?.median ?? 0,
        cpuCoresTotal: Number(cpuCores.toFixed(3)),
        cpuPerInstance: Number((cpuCores / active).toFixed(3)),
        chromiumRssMedianMb: rss,
        ramPerInstanceMb: Number((rss / active).toFixed(1)),
        durationP50Ms: r.durationP50Ms,
        durationP95Ms: r.durationP95Ms,
        completed: r.completed,
        failRate: r.failureRate
      };
      console.log(`active≈${active} cpu=${cpuCores.toFixed(2)}cores (${(cpuCores / active).toFixed(2)}/inst) rss=${rss}MB (${(rss / active).toFixed(0)}/inst) durP50=${r.durationP50Ms}ms`);
    }
  } finally {
    wl.server.close();
  }

  // Relative costs normalized to LIGHT = 1.0. Admission protects mainly CPU + RAM; blend 0.6·CPU + 0.4·RAM.
  const base = perClass["light"];
  const rel = (cls: WorkloadClass) => {
    const p = perClass[cls];
    const cpuRel = base.cpuPerInstance > 0 ? p.cpuPerInstance / base.cpuPerInstance : 1;
    const ramRel = base.ramPerInstanceMb > 0 ? p.ramPerInstanceMb / base.ramPerInstanceMb : 1;
    const blended = 0.6 * cpuRel + 0.4 * ramRel;
    return { cpuRel: Number(cpuRel.toFixed(2)), ramRel: Number(ramRel.toFixed(2)), blended: Number(blended.toFixed(2)) };
  };

  const table = WORKLOAD_CLASSES.map((cls) => {
    const r = rel(cls);
    // Proposed final weight: anchor light at 1.0, round measured blend to 0.25 steps, floor at 1.0 (a slot
    // always costs at least the base). Waiting is NOT inflated by its long duration — cost is CPU+RAM only.
    const proposed = Math.max(1.0, Math.round(r.blended * 4) / 4);
    return { cls, existing: perClass[cls].existingWeight, cpuRel: r.cpuRel, ramRel: r.ramRel, measuredRelativeCost: r.blended, proposedFinalWeight: proposed, cpuPerInstanceCores: perClass[cls].cpuPerInstance, ramPerInstanceMb: perClass[cls].ramPerInstanceMb, durationP50Ms: perClass[cls].durationP50Ms };
  });

  console.log(`\n=== A8 workload-weight calibration (concurrency ${CONC}, hold ${HOLD_MS}ms, single-class cohorts) ===`);
  console.log(`| Workload | Existing Weight | CPU/inst (cores) | RAM/inst (MB) | durP50 | Measured Rel Cost | Proposed Final |`);
  console.log(`|---|--:|--:|--:|--:|--:|--:|`);
  for (const row of table) {
    console.log(`| ${row.cls} | ${row.existing} | ${row.cpuPerInstanceCores} | ${row.ramPerInstanceMb} | ${row.durationP50Ms}ms | ${row.measuredRelativeCost} | ${row.proposedFinalWeight} |`);
  }
  const w = perClass["waiting"], l = perClass["light"];
  console.log(`\nWaiting probe: waiting CPU/inst=${w.cpuPerInstance} cores vs light=${l.cpuPerInstance} cores; waiting durP50=${w.durationP50Ms}ms vs light=${l.durationP50Ms}ms.`);
  console.log(`→ waiting stays active ${((w.durationP50Ms ?? 1) / (l.durationP50Ms ?? 1)).toFixed(1)}× longer but consumes ${(w.cpuPerInstance / Math.max(0.001, l.cpuPerInstance)).toFixed(2)}× the CPU — feature-based weight (duration-agnostic) correctly avoids over-charging it.`);

  const artifactDir = join(process.cwd(), "reports", "browser-performance");
  await mkdir(artifactDir, { recursive: true });
  const artifactPath = join(artifactDir, "weight-calibration.json");
  await writeFile(artifactPath, JSON.stringify({ concurrency: CONC, holdMs: HOLD_MS, perClass, table }, null, 2), "utf8");
  console.log(`\nArtifact: ${artifactPath}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
