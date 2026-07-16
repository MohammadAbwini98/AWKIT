/**
 * Shared-browser capacity benchmark — Model A (browser-per-workflow) vs Model B (shared browser + one
 * isolated context per workflow), driven through the REAL BrowserContextFactory + SharedBrowserPool so it
 * exercises the production lease path (and the launch-arg-aware compatibility key), unlike
 * benchmark-concurrency.mts which launches one chromium.launch() per instance and never touches the pool.
 *
 * For each concurrency level it holds N contexts live against the offline mock workload, samples the
 * Chromium subtree (process count + RSS via PID-baseline diff, Windows CIM), and validates per-context
 * cookie isolation. Headless (fast, safe, deterministic) — the process/RAM SHARING ratio is identical
 * headed; the headed per-context bitmap overhead is orthogonal (measured separately in the per-instance work).
 *
 *   npx tsx scripts/benchmark-shared-pool.mts
 *   AWKIT_BENCH_LEVELS=1,2,4,8 AWKIT_BENCH_HOLD_MS=3500 npx tsx scripts/benchmark-shared-pool.mts
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserContextFactory, type BrowserRuntime } from "../src/runner/BrowserContextFactory";
import { SharedBrowserPool } from "../src/runner/browser/SharedBrowserPool";
import { startWorkloadServer, sampleChromium, chromiumPids, stats, reductionPct, wait } from "./benchmark/lib.mts";
import type { InstanceConfig } from "../src/instances/InstanceConfig";
import type { InstanceExecutionContext } from "../src/runner/InstanceExecutionContext";

const PORT = 4409;
const LEVELS = (process.env.AWKIT_BENCH_LEVELS ?? "1,2,4,8").split(",").map((s) => Number.parseInt(s.trim(), 10)).filter((n) => n >= 1);
const HOLD_MS = Number.parseInt(process.env.AWKIT_BENCH_HOLD_MS ?? "3500", 10);
const MAX_BROWSERS = Number.parseInt(process.env.AWKIT_BENCH_MAX_BROWSERS ?? "2", 10); // mirrors the default host cap

function config(i: number): InstanceConfig {
  return { id: `i${i}`, name: `i${i}`, browser: "chromium", headless: true, isolationMode: "browserContext", timeoutMs: 30000, viewport: { width: 1280, height: 720 } };
}
function ctx(root: string, i: number): InstanceExecutionContext {
  return {
    executionId: "bench", instanceId: `i${i}`, scenarioId: "s", instanceOrderNumber: i + 1, totalInstances: LEVELS.length,
    runtimeInputs: {}, instanceInputs: {}, flowOutputs: {},
    paths: { downloads: join(root, `d${i}`), screenshots: join(root, `s${i}`), logs: join(root, `l${i}`), reports: join(root, `r${i}`) }
  };
}

/** Drive one leased context through a representative mixed navigation (form + image-heavy + idle). */
async function drive(rt: BrowserRuntime, base: string, i: number): Promise<void> {
  const page = await rt.context.newPage();
  await page.goto(`${base}/form`, { waitUntil: "domcontentloaded" });
  await page.fill("#fld0", `tester-${i}`).catch(() => undefined);
  await page.goto(`${base}/image-heavy`, { waitUntil: "domcontentloaded" });
  // A per-context cookie proves isolation across the shared browser (Model B).
  await rt.context.addCookies([{ name: "bench_owner", value: `i${i}`, url: base }]);
}

interface LevelResult { level: number; processes: number; rssMb: number; cookieIsolated: boolean; }

/** Run one concurrency level for one model (dedicated pool=undefined, or a shared pool), return metrics. */
async function runLevel(level: number, root: string, base: string, pool: SharedBrowserPool | undefined): Promise<LevelResult> {
  const factory = new BrowserContextFactory({ productionOffline: false, resourcesRoot: root, sharedBrowserPool: pool });
  const baseline = await chromiumPids();
  const runtimes: BrowserRuntime[] = [];
  for (let i = 0; i < level; i++) runtimes.push(await factory.create(config(i), ctx(root, i)));
  for (let i = 0; i < level; i++) await drive(runtimes[i], base, i);

  // Sample the steady-state subtree across the hold window.
  const samples: Array<{ count: number; rssMb: number }> = [];
  const deadline = Date.now() + HOLD_MS;
  while (Date.now() < deadline) { samples.push(await sampleChromium(baseline)); await wait(500); }

  // Cookie isolation: each context must see ONLY its own bench_owner cookie (Model B correctness).
  let cookieIsolated = true;
  for (let i = 0; i < level; i++) {
    const cookies = await runtimes[i].context.cookies(base);
    const owner = cookies.filter((c) => c.name === "bench_owner");
    if (owner.length !== 1 || owner[0].value !== `i${i}`) cookieIsolated = false;
  }

  const procStat = stats(samples.map((s) => s.count));
  const rssStat = stats(samples.map((s) => s.rssMb));
  for (const rt of runtimes) await rt.close();
  if (pool) await pool.drainIdle();
  return { level, processes: Math.round(procStat?.median ?? 0), rssMb: Math.round(rssStat?.median ?? 0), cookieIsolated };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "awtkit-sharedpool-bench-"));
  const wl = await startWorkloadServer(PORT);
  const dedicated: LevelResult[] = [];
  const shared: LevelResult[] = [];
  try {
    for (const level of LEVELS) {
      console.log(`\n── Level ${level} ──`);
      const a = await runLevel(level, root, wl.base, undefined);
      console.log(`  Model A (browser/workflow): processes=${a.processes} rss=${a.rssMb}MB isolated=${a.cookieIsolated}`);
      const pool = new SharedBrowserPool({ maxBrowsers: MAX_BROWSERS, maxContextsPerBrowser: 16, maxContextsPerBrowserHardLimit: 16, recycleAfterContexts: 9999 });
      const b = await runLevel(level, root, wl.base, pool);
      console.log(`  Model B (shared browser):   processes=${b.processes} rss=${b.rssMb}MB isolated=${b.cookieIsolated}`);
      dedicated.push(a);
      shared.push(b);
    }
  } finally {
    wl.server.close();
    await rm(root, { recursive: true, force: true });
  }

  console.log(`\n=== Shared-browser capacity: Model A (browser/workflow) vs Model B (shared) ===`);
  console.log(`(headless; maxBrowsers=${MAX_BROWSERS}; hold=${HOLD_MS}ms; RSS/proc = median of subtree samples)\n`);
  console.log(`| N | A procs | B procs | proc ↓ | A RSS MB | B RSS MB | RSS ↓ | isolated |`);
  console.log(`|--:|--------:|--------:|-------:|---------:|---------:|------:|:--------:|`);
  for (let i = 0; i < LEVELS.length; i++) {
    const a = dedicated[i], b = shared[i];
    const procRed = reductionPct(a.processes, b.processes);
    const rssRed = reductionPct(a.rssMb, b.rssMb);
    console.log(`| ${a.level} | ${a.processes} | ${b.processes} | ${procRed === null ? "—" : procRed + "%"} | ${a.rssMb} | ${b.rssMb} | ${rssRed === null ? "—" : rssRed + "%"} | ${a.cookieIsolated && b.cookieIsolated ? "yes" : "NO"} |`);
  }
  const allIsolated = [...dedicated, ...shared].every((r) => r.cookieIsolated);
  console.log(`\nPer-context cookie isolation held in every cell: ${allIsolated ? "YES" : "NO"}`);
  process.exit(allIsolated ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });
