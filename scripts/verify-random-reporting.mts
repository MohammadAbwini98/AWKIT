import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapacitySnapshot } from "@src/runner/concurrency/CapacitySnapshot";
import type { RandomRunOutcome, RandomTestRunResult } from "@src/testing/runtime/RandomTestRunner";
import { CoverageTracker } from "@src/testing/random/CoverageTracker";
import { GENERATOR_VERSION } from "@src/testing/random/GenerationConstraints";
import { CampaignReportWriter } from "@src/testing/reporting/CampaignReportWriter";
import { SECRET_LEAK_CANARY } from "@src/testing/fixtures/SafeTestData";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function capacity(overrides: Partial<CapacitySnapshot> = {}): CapacitySnapshot {
  return {
    timestamp: new Date(0).toISOString(),
    activeBrowsers: 0,
    maxBrowsers: 8,
    activeContexts: 0,
    activePages: 0,
    activeFlows: 0,
    maxActiveFlows: 8,
    queueDepth: 0,
    freeMemoryMb: 8_192,
    processRssMb: 100,
    recentCrashes: 0,
    dispatchBlocked: false,
    ...overrides
  };
}

function run(
  executionId: string,
  durationMs: number,
  outcome: RandomRunOutcome,
  samples: CapacitySnapshot[]
): RandomTestRunResult {
  return {
    executionId,
    outcome,
    durationMs,
    capacityPlan: {
      detectedCapacity: 8,
      conservativeRecommendedCapacity: 4,
      memoryCapacityEstimate: 8,
      cpuCapacityEstimate: 8,
      usableMemoryMb: 8_192,
      usableCores: 8,
      bindingConstraint: "ram",
      categoryName: "medium",
      requiresBenchmark: false,
      workloadClass: "medium"
    },
    selectedConcurrency: 2,
    baselineCapacity: samples[0] ?? capacity(),
    finalCapacity: samples.at(-1) ?? capacity(),
    capacitySamples: samples,
    instances: [],
    invariants: { passed: true, findings: [] }
  };
}

const root = await mkdtemp(join(tmpdir(), "awkit-random-reporting-"));
try {
  const coverage = new CoverageTracker();
  coverage.recordGenerated("nodeType", "goto");
  coverage.record("nodeType", "goto", "executed");
  coverage.record("nodeType", "goto", "passed");
  coverage.block("loopMode", "dataSource", "No local data-source fixture is configured for this campaign.");
  const runs = [
    run("run-1", 10, "completed", [capacity({ activeBrowsers: 1, activePages: 1 })]),
    run("run-2", 100, "failed", [capacity({ activeBrowsers: 3, activeContexts: 4, activePages: 5, activeFlows: 4, queueDepth: 9, processRssMb: 700 })]),
    run("run-3", 20, "labTimeout", [capacity({ activeBrowsers: 2, processRssMb: 500 })]),
    run("run-4", 30, "completed", [capacity({ activeFlows: 2 })])
  ];
  const writer = new CampaignReportWriter({
    outputDirectory: join(root, "campaigns"),
    now: () => new Date("2026-07-29T11:00:00.000Z")
  });
  const request = {
    campaignId: "phase-6-verifier",
    seed: "phase-6-seed",
    generatorVersion: GENERATOR_VERSION,
    coverage: coverage.snapshot(),
    runs,
    failures: [
      { executionId: "run-2", category: "execution" as const, signature: "flow-a:locator", reproductionCommand: 'npm run test:random:reproduce -- --artifact "a\\failure.json"' },
      { executionId: "run-2", category: "execution" as const, signature: "flow-b:timeout", reproductionCommand: 'npm run test:random:reproduce -- --artifact "b\\failure.json"' },
      { executionId: "run-3", category: "labTimeout" as const, signature: "deadline", reproductionCommand: 'npm run test:random:reproduce -- --artifact "c\\failure.json"' }
    ],
    secretCanaries: [SECRET_LEAK_CANARY]
  };

  console.log("\nRaw-sample campaign metrics");
  const first = await writer.write(request);
  check("raw duration samples are retained in run order", JSON.stringify(first.report.duration.rawSamplesMs) === "[10,100,20,30]");
  check("nearest-rank percentiles are computed from raw samples", first.report.duration.p50Ms === 20 && first.report.duration.p90Ms === 100 && first.report.duration.p95Ms === 100);
  check("resource peaks come from raw capacity snapshots", first.report.peaks.activeBrowsers === 3 && first.report.peaks.activePages === 5 && first.report.peaks.queueDepth === 9 && first.report.peaks.processRssMb === 700);
  check("all run outcomes are counted", first.report.outcomes.completed === 2 && first.report.outcomes.failed === 1 && first.report.outcomes.labTimeout === 1);

  console.log("\nCoverage, failures, and reproduction");
  const nodeCoverage = first.report.coverage.find((entry) => entry.dimension === "nodeType");
  const blockedCoverage = first.report.coverage.find((entry) => entry.dimension === "loopMode");
  check("coverage remains per dimension and key", nodeCoverage?.entries[0]?.counts.passed === 1);
  check("blocked entries retain their reason", blockedCoverage?.blocked[0]?.blockedReason?.includes("No local data-source fixture"));
  check("failure categories aggregate without losing signatures", first.report.failures.find((entry) => entry.category === "execution")?.count === 2);
  check("reproduction commands are deduplicated and surfaced", first.report.reproductionCommands.length === 3);
  let missingFailureRejected = false;
  try {
    await writer.write({ ...request, failures: request.failures.filter((failure) => failure.executionId !== "run-3") });
  } catch (error) {
    missingFailureRejected = error instanceof Error && error.message.includes("missing for: run-3");
  }
  check("a failed run cannot disappear from failure/reproduction metadata", missingFailureRejected);

  console.log("\nDurable JSON + Markdown");
  const second = await writer.write(request);
  const markdown = await readFile(first.markdownPath, "utf8");
  const json = JSON.parse(await readFile(first.jsonPath, "utf8")) as { schemaVersion?: number };
  check("same timestamp allocates a new directory instead of overwriting", first.directory !== second.directory);
  check("JSON carries a versioned schema", json.schemaVersion === 1);
  check("Markdown includes raw samples, blocked reasons, and reproduction commands", markdown.includes("Raw samples (ms): 10, 100, 20, 30") && markdown.includes("No local data-source fixture") && markdown.includes("test:random:reproduce"));

  let canaryRejected = false;
  try {
    await writer.write({ ...request, campaignId: `unsafe-${SECRET_LEAK_CANARY}` });
  } catch (error) {
    canaryRejected = error instanceof Error && error.message.includes("secret canary");
  }
  check("a secret canary prevents report persistence", canaryRejected);

  console.log(`\nRandom campaign reporting: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await rm(root, { recursive: true, force: true });
}
