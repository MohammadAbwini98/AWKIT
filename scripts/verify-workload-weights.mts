// Verifies workload-aware capacity + scheduler weights (src/runner/concurrency/WorkloadWeights.ts):
// feature extraction from config+flows, monotonic weight computation, light/medium/heavy classification
// (rounding UP on ambiguity), the weighted-admission predicate (never deadlocks an idle host), the
// weighted budget, and the confidence transitions on per-class recommendations. Pure — no Electron.
// Run: npx tsx scripts/verify-workload-weights.mts
import type { InstanceConfig } from "../src/instances/InstanceConfig";
import type { FlowProfile, FlowStep, FlowEdge, StepType, FlowEdgeType } from "../src/profiles/FlowProfile";
import {
  extractWorkloadFeatures,
  computeWorkloadWeight,
  classifyWorkload,
  classifyWorkloadFeatures,
  canAdmitWeighted,
  weightedBudget,
  buildWorkloadRecommendation,
  DEFAULT_WORKLOAD_WEIGHT_CONFIG,
  type WorkloadFeatures
} from "../src/runner/concurrency/WorkloadWeights";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const CFG = DEFAULT_WORKLOAD_WEIGHT_CONFIG;

function config(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return {
    id: "i1",
    name: "inst",
    browser: "chromium",
    headless: true,
    isolationMode: "browserContext",
    timeoutMs: 30_000,
    viewport: { width: 1280, height: 720 },
    ...overrides
  };
}

function step(type: StepType, extra: Partial<FlowStep> = {}): FlowStep {
  return { id: `s-${Math.random().toString(36).slice(2)}`, type, name: type, ...extra };
}

function edge(type: FlowEdgeType): FlowEdge {
  return { id: `e-${Math.random().toString(36).slice(2)}`, source: "a", target: "b", type };
}

function flows(nodes: FlowStep[], edges: FlowEdge[] = []): FlowProfile[] {
  return [{ id: "f1", name: "flow", version: 1, nodes, edges }];
}

/** A fully-light baseline feature set (all heavy signals off). */
function lightFeatures(): WorkloadFeatures {
  return {
    headed: false,
    persistentProfile: false,
    browserSwap: false,
    navigationCount: 0,
    downloadCount: 0,
    uploadCount: 0,
    screenshotCount: 0,
    fullPageScreenshot: false,
    popupUsage: false,
    parallelBranches: false,
    nestedFlows: false,
    loops: false,
    nodeCount: 3,
    traceOrVideo: false
  };
}

function main() {
  // 1. Plain headless isolated context = base weight, classified light.
  {
    const f = extractWorkloadFeatures(config(), flows([step("start"), step("goto"), step("end")]));
    const w = computeWorkloadWeight(f);
    check("plain headless ephemeral context is base weight", w === CFG.baseWeight, `weight=${w}`);
    check("plain context classifies light", classifyWorkload(w) === "light", classifyWorkload(w));
    check("headed defaults from config.headless=true → false", f.headed === false);
  }

  // 2. Weight is monotonic: every heavy signal only raises it.
  {
    const base = computeWorkloadWeight(lightFeatures());
    const raises = (patch: Partial<WorkloadFeatures>, label: string) => {
      const w = computeWorkloadWeight({ ...lightFeatures(), ...patch });
      check(`${label} raises weight`, w > base, `base=${base} with=${w}`);
    };
    raises({ headed: true }, "headed");
    raises({ persistentProfile: true }, "persistent profile");
    raises({ browserSwap: true }, "browser swap");
    raises({ downloadCount: 2 }, "downloads");
    raises({ screenshotCount: 3 }, "screenshots");
    raises({ fullPageScreenshot: true }, "full-page screenshot");
    raises({ popupUsage: true }, "popup");
    raises({ parallelBranches: true }, "parallel branches");
    raises({ nestedFlows: true }, "nested flows");
    raises({ loops: true }, "loops");
    raises({ traceOrVideo: true }, "trace/video");
    raises({ navigationCount: CFG.navigationFreeCount + 10 }, "many navigations");
    raises({ nodeCount: CFG.nodeFreeCount + 50 }, "many nodes");
  }

  // 3. Navigations/nodes below the free threshold add nothing (only the excess costs).
  {
    const under = computeWorkloadWeight({ ...lightFeatures(), navigationCount: CFG.navigationFreeCount, nodeCount: CFG.nodeFreeCount });
    check("navigations/nodes under the free threshold are free", under === CFG.baseWeight, `weight=${under}`);
  }

  // 4. A heavy stack classifies heavy and clamps at maxWeight.
  {
    const heavy: WorkloadFeatures = {
      headed: true,
      persistentProfile: true,
      browserSwap: true,
      navigationCount: 40,
      downloadCount: 10,
      uploadCount: 4,
      screenshotCount: 20,
      fullPageScreenshot: true,
      popupUsage: true,
      parallelBranches: true,
      nestedFlows: true,
      loops: true,
      nodeCount: 200,
      traceOrVideo: true
    };
    const w = computeWorkloadWeight(heavy);
    check("heavy stack clamps at maxWeight", w === CFG.maxWeight, `weight=${w} max=${CFG.maxWeight}`);
    check("heavy stack classifies heavy", classifyWorkloadFeatures(heavy) === "heavy");
  }

  // 5. Classification boundaries (inclusive upper bounds; ambiguity rounds up to the heavier class).
  {
    check("weight at lightMax is light", classifyWorkload(CFG.lightMaxWeight) === "light");
    check("weight just above lightMax is medium", classifyWorkload(CFG.lightMaxWeight + 0.01) === "medium");
    check("weight at mediumMax is medium", classifyWorkload(CFG.mediumMaxWeight) === "medium");
    check("weight just above mediumMax is heavy", classifyWorkload(CFG.mediumMaxWeight + 0.01) === "heavy");
    // A persistent + headed instance is never mis-classified as light.
    const ph = computeWorkloadWeight({ ...lightFeatures(), headed: true, persistentProfile: true });
    check("persistent + headed is at least medium", classifyWorkload(ph) !== "light", `weight=${ph} class=${classifyWorkload(ph)}`);
  }

  // 6. Weight is clamped to [base, maxWeight] and never below base.
  {
    const w = computeWorkloadWeight({ ...lightFeatures(), nodeCount: 0 });
    check("weight never drops below base", w >= CFG.baseWeight, `weight=${w}`);
  }

  // 7. Weighted budget = max(1, flows) × budgetPerFlow.
  {
    check("budget scales with flows", weightedBudget(4, 1) === 4);
    check("budget honors budgetPerFlow", weightedBudget(4, 1.5) === 6);
    check("budget floors flows at 1", weightedBudget(0, 2) === 2);
  }

  // 8. Weighted admission: idle host always admits; within budget admits; over budget blocks.
  {
    const budget = weightedBudget(4, 1); // 4
    check("idle host admits even an over-budget instance (no deadlock)", canAdmitWeighted(0, 9, budget) === true);
    check("within budget admits", canAdmitWeighted(2, 1.5, budget) === true);
    check("exactly at budget admits", canAdmitWeighted(2.5, 1.5, budget) === true);
    check("over budget blocks", canAdmitWeighted(3, 1.5, budget) === false);
    // Two heavy (weight ~2.5 each) fill a budget of 4: first (idle) admits, second blocks.
    check("two heavy instances exceed a light budget", canAdmitWeighted(2.5, 2.5, budget) === false);
  }

  // 9. Feature extraction reads flow structure (navigations, downloads, full-page shot, popup, parallel,
  //    nested flow, loop, browser swap, node count).
  {
    const nodes = [
      step("start"),
      step("goto"),
      step("routeChange"),
      step("downloadFile"),
      step("uploadFile"),
      step("screenshot", { config: { fullPage: true } }),
      step("switchToPopup"),
      step("runFlow"),
      step("loop"),
      step("reuseSession"),
      step("end")
    ];
    const f = extractWorkloadFeatures(config({ isolationMode: "persistentContext", headless: false }), flows(nodes, [edge("parallel")]));
    check("extracts navigation count (goto + routeChange)", f.navigationCount === 2, `nav=${f.navigationCount}`);
    check("extracts download count", f.downloadCount === 1);
    check("extracts upload count", f.uploadCount === 1);
    check("detects full-page screenshot", f.fullPageScreenshot === true);
    check("detects popup usage", f.popupUsage === true);
    check("detects parallel branches (edge)", f.parallelBranches === true);
    check("detects nested flows", f.nestedFlows === true);
    check("detects loops", f.loops === true);
    check("detects browser swap (reuseSession)", f.browserSwap === true);
    check("persistent isolation → persistentProfile", f.persistentProfile === true);
    check("headless:false → headed", f.headed === true);
    check("counts all nodes", f.nodeCount === nodes.length, `nodes=${f.nodeCount}`);
  }

  // 10. userDataDir / sessionProfileId also imply a persistent profile.
  {
    const byDir = extractWorkloadFeatures(config({ userDataDir: "/tmp/p" }), flows([step("start")]));
    const bySession = extractWorkloadFeatures(config({ sessionProfileId: "sess-1" }), flows([step("start")]));
    check("userDataDir implies persistent profile", byDir.persistentProfile === true);
    check("sessionProfileId implies persistent profile", bySession.persistentProfile === true);
  }

  // 11. Empty/degenerate input never throws and yields base weight.
  {
    const f = extractWorkloadFeatures(config(), []);
    check("no flows → light base weight", computeWorkloadWeight(f) === CFG.baseWeight);
  }

  // 12. Recommendation confidence transitions: unmeasured → estimated → benchmarked.
  {
    const unmeasured = buildWorkloadRecommendation("m1", { workloadClass: "light", recommendedConcurrency: 6 });
    const estimated = buildWorkloadRecommendation("m1", { workloadClass: "medium", recommendedConcurrency: 4, measured: true });
    const benchmarked = buildWorkloadRecommendation("m1", { workloadClass: "heavy", recommendedConcurrency: 2, benchmarkTestedConcurrency: 3 });
    check("no measurement → unmeasured", unmeasured.confidence === "unmeasured");
    check("measured cost → estimated", estimated.confidence === "estimated");
    check("benchmark present → benchmarked", benchmarked.confidence === "benchmarked");
    check("recommendation carries the machine id + class", benchmarked.machineId === "m1" && benchmarked.workloadClass === "heavy");
    check("recommendedConcurrency floored to >= 1", buildWorkloadRecommendation("m1", { workloadClass: "light", recommendedConcurrency: 0.6 }).recommendedConcurrency === 1);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nWorkload weights: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
