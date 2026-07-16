/**
 * Diagnostic: does the shared pool respect maxBrowsers under CONCURRENT lease acquisition (the real
 * processQueue pattern)? Single-class light workload → one launch key, so browser count > maxBrowsers can
 * only mean an over-launch race (not launch-key splitting).
 */
import { ExecutionEngine } from "@src/runner/ExecutionEngine";
import { startWorkloadServer } from "./lib.mts";
import { buildDirs, cleanupRoot } from "./engineHarness.mts";
import { buildFlow, buildScenario, buildProfile } from "./workloads.mts";

async function main() {
  const wl = await startWorkloadServer(4421);
  const { dirs, root } = await buildDirs("awkit-diag-race-");
  const engine = new ExecutionEngine();
  const MAX_BROWSERS = 2;
  const CONC = 6;
  engine.configureConcurrency({ maxBrowsersPerHost: MAX_BROWSERS, maxActiveFlows: CONC, useSharedBrowserPool: true, workloadWeights: false });

  const flows = [buildFlow("waiting", wl.base, 6000)]; // waiting → contexts stay leased so we can observe the peak
  const scenario = buildScenario("waiting", flows[0].id);
  const executionId = `diag-${Date.now()}`;
  const profile = buildProfile("waiting", wl.base, { executionId, headless: true, maxConcurrentInstances: CONC });
  await engine.startRun(executionId, profile, Array.from({ length: CONC }), dirs, {}, scenario, flows);

  // Sample the shared pool peak while the waiting contexts are all live.
  let peak = 0;
  const keys = new Set<string>();
  for (let i = 0; i < 16; i++) {
    const s = engine.getSharedBrowserSnapshot();
    peak = Math.max(peak, s.totalBrowsers);
    s.browsers.forEach((b) => keys.add(b.launchKey));
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log(`maxBrowsers=${MAX_BROWSERS} concurrency=${CONC}`);
  console.log(`peak shared browsers = ${peak}  (distinct launch keys = ${keys.size})`);
  console.log(`launch keys: ${[...keys].join(" | ")}`);
  console.log(peak > MAX_BROWSERS ? `\n>>> DEFECT: pool launched ${peak} browsers, exceeding maxBrowsers=${MAX_BROWSERS} under concurrent leases.` : `\nPool respected maxBrowsers.`);

  engine.stopAll();
  await new Promise((r) => setTimeout(r, 4000));
  await engine.drainIdleSharedBrowsers().catch(() => undefined);
  wl.server.close();
  await cleanupRoot(root);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
