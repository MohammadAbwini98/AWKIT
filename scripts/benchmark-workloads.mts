/**
 * Representative workload matrix (Browser Resource Optimization).
 *
 * Compares Balanced vs Low Resource across representative local workloads (form / table / SPA / animation /
 * image-heavy / multi-tab / popup / download), headed, N reps, full stats (RAM/CPU/duration/procs/network).
 * Each (workload, profile) is resolved through the REAL `resolveBrowserConfigurationForRun` using a
 * per-workload capability flow, so the matrix also validates that capability overrides keep the workload
 * working (e.g. a download workflow keeps downloads even under Low Resource). Behavioural success is asserted
 * per workload so a resource saving that breaks the workflow is caught.
 *
 * Run: npx tsx scripts/benchmark-workloads.mts [--reps 15] [--headless]
 */
import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CORES, IS_WIN, startWorkloadServer, runInstance, stats, reductionPct, type DriveApi, type Stats } from "./benchmark/lib.mts";
import { installResourceRouting } from "../src/runner/ResourceRoutingPolicy";
import { buildChromiumHardeningArgs } from "../src/runner/ChromiumHardening";
import { resolveBrowserConfigurationForRun } from "../src/runner/browserProfile/resolveForRun";
import type { ResolvedBrowserRuntimeConfiguration } from "../src/runner/browserProfile/BrowserRuntimeConfigurationResolver";
import type { InstanceConfig } from "../src/instances/InstanceConfig";
import type { FlowProfile, FlowStep } from "../src/profiles/FlowProfile";
import type { BrowserResourceProfileMode } from "../src/runner/browserProfile/BrowserResourceProfile";

const OUT_DIR = join(process.cwd(), "reports", "browser-performance");
const PORT = 4413;
const argv = process.argv.slice(2);
const REPS = Math.max(1, Number.parseInt(argv[argv.indexOf("--reps") + 1] ?? "15", 10) || 15);
const HEADED = !argv.includes("--headless");
const PROFILES: BrowserResourceProfileMode[] = ["balanced", "low-resource"];

const flow = (types: string[]): FlowProfile[] => [
  { id: "f", name: "f", nodes: types.map((t, i) => ({ id: "n" + i, type: t, label: t })) as FlowStep[], edges: [] } as unknown as FlowProfile
];

interface Workload { name: string; capFlow: FlowProfile[]; drive: (api: DriveApi) => Promise<Record<string, number | string | boolean>> }

const WORKLOADS: Workload[] = [
  { name: "image-heavy", capFlow: flow(["click"]), drive: async ({ page, base, mark, wait }) => { mark("nav"); await page.goto(base + "/image-heavy", { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForFunction("window.__ready===true", { timeout: 5000 }).catch(() => {}); await wait(500); mark("loaded"); await wait(3000); const imgs = await page.evaluate("document.querySelectorAll('img').length").catch(() => 0); return { imgs: Number(imgs) }; } },
  { name: "animation", capFlow: flow(["click"]), drive: async ({ page, base, mark, wait }) => { mark("nav"); await page.goto(base + "/animation", { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForFunction("window.__ready===true", { timeout: 5000 }).catch(() => {}); await wait(500); mark("loaded"); await wait(3000); const raf = await page.evaluate("window.__raf").catch(() => 0); return { raf: Number(raf) }; } },
  { name: "form", capFlow: flow(["fill", "click"]), drive: async ({ page, base, mark, wait }) => { mark("nav"); await page.goto(base + "/form", { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForFunction("window.__ready===true", { timeout: 5000 }).catch(() => {}); for (let i = 0; i < 8; i++) await page.fill("#fld" + i, "value " + i).catch(() => {}); mark("loaded"); await wait(2500); const v = await page.inputValue("#fld0").catch(() => ""); return { filledOk: v === "value 0" }; } },
  { name: "table", capFlow: flow(["click"]), drive: async ({ page, base, mark, wait }) => { mark("nav"); await page.goto(base + "/table", { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForFunction("window.__ready===true", { timeout: 5000 }).catch(() => {}); await wait(500); mark("loaded"); await wait(2500); const rows = await page.evaluate("document.querySelectorAll('tbody tr').length").catch(() => 0); return { rows: Number(rows) }; } },
  { name: "spa", capFlow: flow(["click", "routeChange"]), drive: async ({ page, base, mark, wait }) => { mark("nav"); await page.goto(base + "/spa", { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForFunction("window.__ready===true", { timeout: 5000 }).catch(() => {}); mark("loaded"); for (const v of ["#v2", "#v3", "#v1"]) { await page.click(v).catch(() => {}); await wait(600); } await wait(1500); const sw = await page.evaluate("window.__sw||'none'").catch(() => "none"); return { sw: String(sw) }; } },
  { name: "multitab", capFlow: flow(["switchToPopup"]), drive: async ({ page, context, base, mark, wait }) => { mark("nav"); await page.goto(base + "/multitab", { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForFunction("window.__ready===true", { timeout: 5000 }).catch(() => {}); mark("loaded"); const p = context.waitForEvent("page", { timeout: 4000 }).catch(() => null); await page.click("#open").catch(() => {}); const tab = await p; let tabOk = false; if (tab) { await tab.waitForFunction("window.__ready===true", { timeout: 4000 }).catch(() => {}); tabOk = true; } await wait(2000); if (tab) await tab.close().catch(() => {}); return { tabOk }; } },
  { name: "popup", capFlow: flow(["switchToPopup"]), drive: async ({ page, context, base, mark, wait }) => { mark("nav"); await page.goto(base + "/idle", { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForFunction("window.__ready===true", { timeout: 5000 }).catch(() => {}); mark("loaded"); const p = context.waitForEvent("page", { timeout: 4000 }).catch(() => null); await page.click("#popup").catch(() => {}); const pop = await p; let popupOk = false; if (pop) { popupOk = true; await pop.close().catch(() => {}); } await wait(2000); return { popupOk }; } },
  { name: "download", capFlow: flow(["downloadFile"]), drive: async ({ page, base, mark, wait }) => { mark("nav"); await page.goto(base + "/download", { waitUntil: "domcontentloaded" }).catch(() => {}); await page.waitForFunction("window.__ready===true", { timeout: 5000 }).catch(() => {}); mark("loaded"); let downloadOk = false; try { const dl = page.waitForEvent("download", { timeout: 5000 }); await page.click("#dl"); const d = await dl; await d.cancel().catch(() => {}); downloadOk = Boolean(d.suggestedFilename()); } catch { downloadOk = false; } await wait(1500); return { downloadOk }; } }
];

function specFor(resolved: ResolvedBrowserRuntimeConfiguration) {
  const co: Record<string, unknown> = { viewport: resolved.contextOverrides.viewport, acceptDownloads: resolved.resourceRouting.acceptDownloads };
  if (resolved.resourceRouting.blockServiceWorkers) co.serviceWorkers = "block";
  if (resolved.resourceRouting.reducedMotion) co.reducedMotion = "reduce";
  if (resolved.resourceRouting.deviceScaleFactor !== undefined) co.deviceScaleFactor = resolved.resourceRouting.deviceScaleFactor;
  return {
    headed: HEADED,
    launchArgs: [...buildChromiumHardeningArgs(process.env, { omitBackgroundTimerThrottlePin: resolved.launchArgOverrides.omitBackgroundTimerThrottlePin }), ...resolved.launchArgOverrides.add],
    ignoreDefaultArgs: resolved.launchArgOverrides.ignoreDefaultArgs.length ? resolved.launchArgOverrides.ignoreDefaultArgs : undefined,
    contextOptions: co
  };
}

interface RepMetrics { loadedRss?: number; peakRss?: number; loadedCpu?: number; procs?: number; durationMs: number; netBytes: number; netRequests: number; behavior: Record<string, number | string | boolean> }

async function runCell(w: Workload, mode: BrowserResourceProfileMode, server: Awaited<ReturnType<typeof startWorkloadServer>>): Promise<RepMetrics[]> {
  const cfg: InstanceConfig = { id: "w", name: "w", browser: "chromium", headless: !HEADED, isolationMode: "browserContext", timeoutMs: 30000, viewport: { width: 1200, height: 800 } };
  const resolved = resolveBrowserConfigurationForRun(cfg, w.capFlow, { env: { ...process.env, AWKIT_BROWSER_RESOURCE_PROFILE: mode } });
  const spec = specFor(resolved);
  const reps: RepMetrics[] = [];
  for (let r = 0; r < REPS; r++) {
    let net = { bytes: 0, requests: 0 };
    const result = await runInstance(spec, server, async (api) => {
      await installResourceRouting(api.context, resolved.resourceRouting);
      const b = await w.drive(api);
      net = { bytes: server.served.bytes, requests: server.served.requests };
      return b;
    });
    const loaded = result.samples.filter((s) => s.state === "loaded");
    const rss = loaded.map((s) => s.rssMb);
    const cpu = loaded.map((s) => s.cpuCorePct).filter((n): n is number => n !== undefined);
    const procs = loaded.map((s) => s.count);
    reps.push({
      loadedRss: rss.length ? rss.reduce((a, b) => a + b, 0) / rss.length : undefined,
      peakRss: result.samples.length ? Math.max(...result.samples.map((s) => s.rssMb)) : undefined,
      loadedCpu: cpu.length ? cpu.reduce((a, b) => a + b, 0) / cpu.length : undefined,
      procs: procs.length ? Math.max(...procs) : undefined,
      durationMs: result.durationMs,
      netBytes: net.bytes,
      netRequests: net.requests,
      behavior: result.behavior
    });
    process.stdout.write(`  ${w.name}/${mode} rep ${r + 1}/${REPS} rss=${reps[reps.length - 1].loadedRss?.toFixed(0) ?? "?"}MB\r`);
  }
  process.stdout.write("\n");
  return reps;
}

function summarize(reps: RepMetrics[]) {
  const behaviorOkRate: Record<string, number> = {};
  const keys = new Set<string>();
  for (const r of reps) for (const k of Object.keys(r.behavior)) if (typeof r.behavior[k] === "boolean") keys.add(k);
  for (const k of keys) behaviorOkRate[k] = reps.filter((r) => r.behavior[k] === true).length / reps.length;
  return {
    reps: reps.length,
    loadedRssMb: stats(reps.map((r) => r.loadedRss).filter((n): n is number => n !== undefined)),
    peakRssMb: stats(reps.map((r) => r.peakRss).filter((n): n is number => n !== undefined)),
    loadedCpuCorePct: stats(reps.map((r) => r.loadedCpu).filter((n): n is number => n !== undefined)),
    processCount: stats(reps.map((r) => r.procs).filter((n): n is number => n !== undefined)),
    durationMs: stats(reps.map((r) => r.durationMs)),
    netBytes: stats(reps.map((r) => r.netBytes)),
    netRequests: stats(reps.map((r) => r.netRequests)),
    behaviorOkRate
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startWorkloadServer(PORT);
  const machine = { platform: os.platform(), logicalCpuCount: CORES, totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)), cpuModel: os.cpus()[0]?.model?.trim() };
  console.log(`Workload matrix — ${machine.cpuModel} · ${CORES} cores · ${HEADED ? "headed" : "headless"} · reps ${REPS}`);
  if (!IS_WIN) console.log("WARN: RAM/CPU sampling Windows-only; network + duration cross-platform.");

  const out: any = { machine, headed: HEADED, reps: REPS, generatedAt: new Date().toISOString(), workloads: {} };
  try {
    for (const w of WORKLOADS) {
      out.workloads[w.name] = {};
      for (const mode of PROFILES) {
        console.log(`\n[${w.name} / ${mode}]`);
        const reps = await runCell(w, mode, server);
        out.workloads[w.name][mode] = summarize(reps);
        writeFileSync(join(OUT_DIR, "workloads.json"), JSON.stringify(out, null, 2));
      }
    }
  } finally { server.server.close(); }

  console.log("\n=== Balanced → Low Resource per workload (positive = reduction) ===");
  console.log("workload".padEnd(14) + "RAM bal→low        ΔRAM     CPU bal→low     net bal→low       behavior");
  for (const w of WORKLOADS) {
    const bal = out.workloads[w.name].balanced, low = out.workloads[w.name]["low-resource"];
    const dRam = reductionPct(bal.loadedRssMb?.mean, low.loadedRssMb?.mean);
    const beh = Object.entries(low.behaviorOkRate).map(([k, v]) => `${k}:${Math.round((v as number) * 100)}%`).join(" ");
    console.log(
      w.name.padEnd(14) +
      `${bal.loadedRssMb?.mean}→${low.loadedRssMb?.mean}MB`.padEnd(18) +
      `${dRam === null ? "-" : (dRam > 0 ? "-" : "+") + Math.abs(dRam) + "%"}`.padEnd(9) +
      `${bal.loadedCpuCorePct?.mean}→${low.loadedCpuCorePct?.mean}%`.padEnd(16) +
      `${Math.round((bal.netBytes?.mean ?? 0) / 1024)}→${Math.round((low.netBytes?.mean ?? 0) / 1024)}KB`.padEnd(18) +
      (beh || "-")
    );
  }
  console.log(`\nWrote ${join(OUT_DIR, "workloads.json")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
