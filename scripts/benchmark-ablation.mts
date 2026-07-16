/**
 * Per-optimization ablation (Browser Resource Optimization).
 *
 * Answers "where does the ~21% headed RAM saving come from?" by measuring each optimization INDIVIDUALLY
 * against a normal baseline, then the combined low-resource profile — same workload, same method. Headed,
 * image-heavy workload (the one that produced the RAM win). N reps → mean/median/p95/max/stddev.
 *
 * Each cell is a single knob applied to a normal baseline via the real low-level primitives
 * (ResourceRoutingConfig + context options + launch-arg deltas). The combined cell uses the actual
 * resolver's low-resource output, so the ablation and the shipped profile share one code path.
 *
 * Run: npx tsx scripts/benchmark-ablation.mts [--reps 20] [--headed|--headless]
 */
import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORES, IS_WIN, startWorkloadServer, runInstance, stats, reductionPct, type Stats } from "./benchmark/lib.mts";
import { installResourceRouting, type ResourceRoutingConfig } from "../src/runner/ResourceRoutingPolicy";
import { buildChromiumHardeningArgs } from "../src/runner/ChromiumHardening";
import {
  BACKGROUND_THROTTLING_DEFAULT_ARGS,
  KNOWN_ANALYTICS_URL_PATTERNS
} from "../src/runner/browserProfile/BrowserRuntimeConfigurationResolver";
import { resolveBrowserConfigurationForRun } from "../src/runner/browserProfile/resolveForRun";
import type { InstanceConfig } from "../src/instances/InstanceConfig";
import type { FlowProfile } from "../src/profiles/FlowProfile";

const OUT_DIR = join(process.cwd(), "reports", "browser-performance");
const PORT = 4412;
const argv = process.argv.slice(2);
const REPS = Math.max(1, Number.parseInt(argv[argv.indexOf("--reps") + 1] ?? "20", 10) || 20);
const HEADED = !argv.includes("--headless"); // default headed (AWKIT's default run mode)

function normalRouting(): ResourceRoutingConfig {
  return { profile: "normal", blockResourceTypes: [], allowResourceTypes: [], allowUrlPatterns: [], blockUrlPatterns: [], blockServiceWorkers: false, acceptDownloads: true, reducedMotion: false, deviceScaleFactor: undefined, debug: false };
}

interface Cell {
  name: string;
  routing: ResourceRoutingConfig;
  launchArgs: string[];
  ignoreDefaultArgs?: string[];
}

function cell(name: string, mutate: (r: ResourceRoutingConfig) => void, throttle = false): Cell {
  const routing = normalRouting();
  mutate(routing);
  return {
    name,
    routing,
    launchArgs: buildChromiumHardeningArgs(process.env, { omitBackgroundTimerThrottlePin: throttle }),
    ignoreDefaultArgs: throttle ? BACKGROUND_THROTTLING_DEFAULT_ARGS : undefined
  };
}

function combinedLowResourceCell(): Cell {
  const cfg: InstanceConfig = { id: "a", name: "a", browser: "chromium", headless: !HEADED, isolationMode: "browserContext", timeoutMs: 30000, viewport: { width: 1200, height: 800 } };
  const flows: FlowProfile[] = [{ id: "f", name: "f", nodes: [{ id: "n", type: "click", label: "c" }], edges: [] } as unknown as FlowProfile];
  const r = resolveBrowserConfigurationForRun(cfg, flows, { env: { ...process.env, AWKIT_BROWSER_RESOURCE_PROFILE: "low-resource" } });
  return {
    name: "COMBINED-low-resource",
    routing: r.resourceRouting,
    launchArgs: [...buildChromiumHardeningArgs(process.env, { omitBackgroundTimerThrottlePin: r.launchArgOverrides.omitBackgroundTimerThrottlePin }), ...r.launchArgOverrides.add],
    ignoreDefaultArgs: r.launchArgOverrides.ignoreDefaultArgs.length ? r.launchArgOverrides.ignoreDefaultArgs : undefined
  };
}

const CELLS: Cell[] = [
  cell("baseline-normal", () => {}),
  cell("block-images", (r) => { r.blockResourceTypes = ["image"]; }),
  cell("block-media", (r) => { r.blockResourceTypes = ["media"]; }),
  cell("block-fonts", (r) => { r.blockResourceTypes = ["font"]; }),
  cell("block-analytics", (r) => { r.blockUrlPatterns = [...KNOWN_ANALYTICS_URL_PATTERNS]; }),
  cell("reduced-motion", (r) => { r.reducedMotion = true; }),
  cell("block-service-workers", (r) => { r.blockServiceWorkers = true; }),
  cell("device-scale-1", (r) => { r.deviceScaleFactor = 1; }),
  cell("background-throttling", () => {}, true),
  combinedLowResourceCell()
];

function contextOptionsFor(routing: ResourceRoutingConfig): Record<string, unknown> {
  const o: Record<string, unknown> = { viewport: { width: 1200, height: 800 }, acceptDownloads: routing.acceptDownloads };
  if (routing.blockServiceWorkers) o.serviceWorkers = "block";
  if (routing.reducedMotion) o.reducedMotion = "reduce";
  if (routing.deviceScaleFactor !== undefined) o.deviceScaleFactor = routing.deviceScaleFactor;
  return o;
}

interface RepMetrics { loadedRss?: number; peakRss?: number; loadedCpu?: number; netBytes: number; netRequests: number }

async function runCell(c: Cell, server: Awaited<ReturnType<typeof startWorkloadServer>>): Promise<RepMetrics[]> {
  const reps: RepMetrics[] = [];
  for (let r = 0; r < REPS; r++) {
    let net = { bytes: 0, requests: 0 };
    const result = await runInstance(
      { headed: HEADED, launchArgs: c.launchArgs, ignoreDefaultArgs: c.ignoreDefaultArgs, contextOptions: contextOptionsFor(c.routing) },
      server,
      async ({ page, context, base, mark, wait }) => {
        await installResourceRouting(context, c.routing);
        mark("nav");
        await page.goto(base + "/image-heavy", { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForFunction("window.__ready === true", { timeout: 5000 }).catch(() => {});
        await wait(1000);
        mark("loaded");
        await wait(4000); // hold while images decode/retain
        net = { bytes: server.served.bytes, requests: server.served.requests };
        return {};
      }
    );
    const loaded = result.samples.filter((s) => s.state === "loaded");
    const rss = loaded.map((s) => s.rssMb);
    const cpu = loaded.map((s) => s.cpuCorePct).filter((n): n is number => n !== undefined);
    const allRss = result.samples.map((s) => s.rssMb);
    reps.push({
      loadedRss: rss.length ? rss.reduce((a, b) => a + b, 0) / rss.length : undefined,
      peakRss: allRss.length ? Math.max(...allRss) : undefined,
      loadedCpu: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : undefined,
      netBytes: net.bytes,
      netRequests: net.requests
    });
    process.stdout.write(`  ${c.name} rep ${r + 1}/${REPS} rss=${reps[reps.length - 1].loadedRss?.toFixed(0) ?? "?"}MB net=${Math.round(net.bytes / 1024)}KB/${net.requests}req\r`);
  }
  process.stdout.write("\n");
  return reps;
}

function summarize(reps: RepMetrics[]) {
  return {
    reps: reps.length,
    loadedRssMb: stats(reps.map((r) => r.loadedRss).filter((n): n is number => n !== undefined)),
    peakRssMb: stats(reps.map((r) => r.peakRss).filter((n): n is number => n !== undefined)),
    loadedCpuCorePct: stats(reps.map((r) => r.loadedCpu).filter((n): n is number => n !== undefined)),
    netBytes: stats(reps.map((r) => r.netBytes)),
    netRequests: stats(reps.map((r) => r.netRequests))
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startWorkloadServer(PORT);
  const machine = { platform: os.platform(), logicalCpuCount: CORES, totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)), cpuModel: os.cpus()[0]?.model?.trim() };
  console.log(`Ablation — ${machine.cpuModel} · ${CORES} cores · ${HEADED ? "headed" : "headless"} · image-heavy · reps ${REPS}`);
  if (!IS_WIN) console.log("WARN: RAM/CPU sampling Windows-only; network is cross-platform.");

  const out: any = { machine, headed: HEADED, workload: "image-heavy", reps: REPS, generatedAt: new Date().toISOString(), cells: {} };
  try {
    for (const c of CELLS) {
      console.log(`\n[${c.name}]`);
      const reps = await runCell(c, server);
      out.cells[c.name] = summarize(reps);
      writeFileSync(join(OUT_DIR, "ablation.json"), JSON.stringify(out, null, 2));
    }
  } finally { server.server.close(); }

  const base = out.cells["baseline-normal"];
  console.log("\n=== Ablation vs baseline-normal (positive = reduction) ===");
  console.log("cell".padEnd(24) + "RAM(load)   ΔRAM     CPU(load)   net KB   Δnet");
  for (const c of CELLS) {
    const x = out.cells[c.name];
    const dRam = reductionPct(base.loadedRssMb?.mean, x.loadedRssMb?.mean);
    const dNet = reductionPct(base.netBytes?.mean, x.netBytes?.mean);
    console.log(
      c.name.padEnd(24) +
      `${(x.loadedRssMb?.mean ?? "?") + "MB"}`.padEnd(12) +
      `${dRam === null ? "-" : (dRam > 0 ? "-" : "+") + Math.abs(dRam) + "%"}`.padEnd(9) +
      `${(x.loadedCpuCorePct?.mean ?? "?") + "%"}`.padEnd(12) +
      `${Math.round((x.netBytes?.mean ?? 0) / 1024)}`.padEnd(9) +
      `${dNet === null ? "-" : (dNet > 0 ? "-" : "+") + Math.abs(dNet) + "%"}`
    );
  }
  console.log(`\nWrote ${join(OUT_DIR, "ablation.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
