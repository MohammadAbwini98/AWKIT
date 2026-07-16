/**
 * Validates the full harness (metrics + durable run history + teardown asserts) with ONE small MIXED
 * Config-D stage at low concurrency and a short hold, before the heavy A/B/C/D + ramp + soak runs.
 *
 *   TSX_TSCONFIG_PATH=scripts/benchmark/tsconfig.bench.json PRODUCTION_OFFLINE=false \
 *     npx tsx scripts/benchmark/stage-smoke.mts
 */
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { startWorkloadServer } from "./lib.mts";
import { buildDirs, cleanupRoot, runStage, type ConfigSpec } from "./engineHarness.mts";
import { DEFAULT_MIX } from "./workloads.mts";

async function main() {
  const wl = await startWorkloadServer(4420);
  const { dirs, root } = await buildDirs("awkit-stage-smoke-");
  const engine = new ExecutionEngine();

  const configD: ConfigSpec = { name: "D", sharedPool: true, workloadWeights: true, maxBrowsersPerHost: 2, maxActiveFlows: 4 };
  console.log("Running one MIXED Config-D stage (target 4, hold 8s)…");
  const result = await runStage(engine, wl, dirs, { config: configD, targetActive: 4, holdMs: 8000, headless: true, mix: DEFAULT_MIX, sampleIntervalMs: 1000 });

  console.log("\n── Stage result ──");
  console.log(`per-class weight: ${JSON.stringify(result.perClassWeight)}`);
  console.log(`sustained active: median=${result.sustainedActive?.median} max=${result.sustainedActive?.max}`);
  console.log(`chromium procs: median=${result.chromiumProcs?.median}  rss median=${result.chromiumRssMb?.median}MB peak=${result.chromiumPeakRssMb}MB`);
  console.log(`shared browsers: median=${result.sharedBrowsers?.median}  contexts median=${result.sharedContexts?.median}`);
  console.log(`cpu%: median=${result.cpuPercent?.median} p95=${result.cpuPercent?.p95}  eventLoop ms: median=${result.eventLoopDelayMs?.median}`);
  console.log(`AWKIT rss median=${result.processRssMb?.median}MB  node heap median=${result.nodeHeapUsedMb?.median}MB`);
  console.log(`workflows: completed=${result.completed} failed=${result.failed} cancelled=${result.cancelled} total=${result.totalRuns}`);
  console.log(`throughput/min=${result.throughputPerMin}  durP50=${result.durationP50Ms}ms durP95=${result.durationP95Ms}ms  failRate=${result.failureRate}`);
  console.log(`dispatchBlocked fraction=${result.dispatchBlockedFraction}  reasons=${JSON.stringify(result.blockedReasons)}`);
  console.log(`teardown clean=${result.teardown.clean}  notes=${JSON.stringify(result.teardown.notes)}`);

  wl.server.close();
  await cleanupRoot(root);

  const ok = result.completed > 0 && result.teardown.clean;
  console.log(ok ? "\n✓ STAGE SMOKE PASS" : "\n✗ STAGE SMOKE FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
