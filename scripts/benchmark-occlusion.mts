/**
 * Occluded/minimized headed-Chromium throttle experiment (Browser Resource Optimization).
 *
 * The open question after the headed benchmark: can AWKIT substantially cut CPU for UNATTENDED headed
 * instances whose window is minimized/occluded? Playwright disables all background throttling by default
 * (`--disable-background-timer-throttling`, `--disable-backgrounding-occluded-windows`,
 * `--disable-renderer-backgrounding`), so a minimized AWKIT window keeps burning CPU (rAF + timers keep
 * running). This measures each throttle switch, individually and combined, via SELECTIVE ignoreDefaultArgs
 * (never `ignoreDefaultArgs: true`), on a genuinely minimized window (Win32 ShowWindowAsync).
 *
 * For each config it also checks behavioural correctness while minimized: page timer rate, rAF rate,
 * Playwright waitForResponse, popup detection, and a Playwright click — i.e. does re-enabling throttling
 * break AWKIT's waits / multi-window features?
 *
 * Run: npx tsx scripts/benchmark-occlusion.mts [--reps 20]
 */
import os from "node:os";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORES, IS_WIN, startWorkloadServer, runInstance, stats, reductionPct, type StateSample, type Stats
} from "./benchmark/lib.mts";
import { buildChromiumHardeningArgs } from "../src/runner/ChromiumHardening";
import { BACKGROUND_THROTTLING_DEFAULT_ARGS } from "../src/runner/browserProfile/BrowserRuntimeConfigurationResolver";

const OUT_DIR = join(process.cwd(), "reports", "browser-performance");
const PORT = 4411;
const argv = process.argv.slice(2);
const REPS = Math.max(1, Number.parseInt(argv[argv.indexOf("--reps") + 1] ?? "20", 10) || 20);

const TIMER = "--disable-background-timer-throttling";
const OCCL = "--disable-backgrounding-occluded-windows";
const REND = "--disable-renderer-backgrounding";

// Each config: which Playwright throttle-disable defaults to DROP (re-enabling that throttle), and whether
// to also drop AWKIT's own re-pin of the timer switch.
interface Config { name: string; drop: string[]; omitTimerPin: boolean; note: string }
const CONFIGS: Config[] = [
  { name: "pw-default", drop: [], omitTimerPin: false, note: "current AWKIT/Playwright — all throttling disabled" },
  { name: "timer-throttle-only", drop: [TIMER], omitTimerPin: true, note: "re-enable background timer throttling only" },
  { name: "renderer-backgrounding-only", drop: [REND], omitTimerPin: false, note: "re-enable renderer backgrounding only" },
  { name: "occluded-backgrounding-only", drop: [OCCL], omitTimerPin: false, note: "re-enable occluded-window backgrounding only" },
  { name: "all-three", drop: BACKGROUND_THROTTLING_DEFAULT_ARGS, omitTimerPin: true, note: "low-resource throttling (combined)" }
];

interface RepMetrics { minimizedCpu?: number; minimizedRss?: number; timerRatePerSec: number; rafRatePerSec: number; waitResponseMs?: number; waitResponseOk: boolean; popupOk: boolean; clickOk: boolean; minimizedCount: number; hidden: boolean }

async function runConfig(cfg: Config, server: Awaited<ReturnType<typeof startWorkloadServer>>): Promise<RepMetrics[]> {
  const reps: RepMetrics[] = [];
  const launchArgs = buildChromiumHardeningArgs(process.env, { omitBackgroundTimerThrottlePin: cfg.omitTimerPin });
  for (let r = 0; r < REPS; r++) {
    const result = await runInstance(
      { headed: true, launchArgs, ignoreDefaultArgs: cfg.drop.length ? cfg.drop : undefined, contextOptions: { viewport: { width: 1200, height: 800 } } },
      server,
      async ({ page, context, base, mark, minimize, wait }): Promise<Record<string, number | string | boolean>> => {
        mark("nav");
        // Heavy-rAF page as the backgrounded instance: if throttling engaged, rAF would pause and CPU
        // would drop sharply — maximizing statistical power to detect any real throttle effect.
        await page.goto(base + "/animation", { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForFunction("window.__ready === true", { timeout: 5000 }).catch(() => {});
        await wait(1500);

        // Make `page` a genuinely HIDDEN, backgrounded instance: (1) open a second foreground tab so the
        // idle page becomes a background tab (visibilityState=hidden — reliable), AND (2) minimize the
        // window (occluded). This is the realistic "unattended, not-foreground" state that AWKIT's
        // concurrent headed instances sit in. Both mechanisms together give the throttle switches their
        // best chance to engage.
        const fg = await context.newPage();
        await fg.goto(base + "/form", { waitUntil: "domcontentloaded" }).catch(() => {});
        await fg.bringToFront().catch(() => {});
        const minimizedCount = await minimize();
        await wait(3000); // occlusion/visibility detection runs on a delayed timer — let it register

        mark("minimized");
        const vis = (await page.evaluate("({v:document.visibilityState,h:document.hidden})").catch(() => null)) as any;
        const t0 = (await page.evaluate("({t:window.__timerFires,r:window.__raf,n:performance.now()})").catch(() => null)) as any;
        await wait(5000); // sample CPU while minimized
        const t1 = (await page.evaluate("({t:window.__timerFires,r:window.__raf,n:performance.now()})").catch(() => null)) as any;

        let timerRatePerSec = -1, rafRatePerSec = -1;
        if (t0 && t1 && t1.n > t0.n) {
          const secs = (t1.n - t0.n) / 1000;
          timerRatePerSec = Math.round(((t1.t - t0.t) / secs) * 10) / 10;
          rafRatePerSec = Math.round(((t1.r - t0.r) / secs) * 10) / 10;
        }

        // Behavioural correctness while minimized:
        // (a) Playwright waitForResponse to a DRIVER-initiated fetch (isolates the wait from page timers).
        mark("behavior");
        let waitResponseMs: number | undefined, waitResponseOk = false;
        const wrStart = Date.now();
        const rp = page.waitForResponse((res) => res.url().includes("/api/ping"), { timeout: 4000 });
        await page.evaluate("fetch('/api/ping?probe='+Date.now())").catch(() => {});
        const resp = await rp.catch(() => null);
        if (resp) { waitResponseOk = true; waitResponseMs = Date.now() - wrStart; }

        // (b) Popup detection while minimized.
        let popupOk = false;
        const popupP = context.waitForEvent("page", { timeout: 4000 }).catch(() => null);
        await page.click("#popup").catch(() => {});
        const popup = await popupP;
        if (popup) { popupOk = true; await popup.close().catch(() => {}); }

        // (c) A Playwright click still works while minimized.
        let clickOk = false;
        try { await page.click("#popup", { timeout: 3000, trial: true }); clickOk = true; } catch { clickOk = false; }

        return { timerRatePerSec, rafRatePerSec, waitResponseMs: waitResponseMs ?? -1, waitResponseOk, popupOk, clickOk, minimizedCount, visibility: (vis?.v as string) ?? "?", hidden: Boolean(vis?.h) };
      }
    );
    const min = result.samples.filter((s) => s.state === "minimized");
    const cpu = min.map((s) => s.cpuCorePct).filter((n): n is number => n !== undefined);
    const rss = min.map((s) => s.rssMb);
    const b = result.behavior;
    reps.push({
      minimizedCpu: cpu.length ? cpu.reduce((a, c) => a + c, 0) / cpu.length : undefined,
      minimizedRss: rss.length ? rss.reduce((a, c) => a + c, 0) / rss.length : undefined,
      timerRatePerSec: Number(b.timerRatePerSec ?? -1),
      rafRatePerSec: Number(b.rafRatePerSec ?? -1),
      waitResponseMs: Number(b.waitResponseMs) >= 0 ? Number(b.waitResponseMs) : undefined,
      waitResponseOk: Boolean(b.waitResponseOk),
      popupOk: Boolean(b.popupOk),
      clickOk: Boolean(b.clickOk),
      minimizedCount: Number(b.minimizedCount ?? 0),
      hidden: Boolean(b.hidden)
    });
    process.stdout.write(`  ${cfg.name} rep ${r + 1}/${REPS} cpu=${reps[reps.length - 1].minimizedCpu?.toFixed(1) ?? "?"}% timer=${reps[reps.length - 1].timerRatePerSec}/s raf=${reps[reps.length - 1].rafRatePerSec}/s min=${reps[reps.length - 1].minimizedCount}\r`);
  }
  process.stdout.write("\n");
  return reps;
}

function summarize(reps: RepMetrics[]) {
  const okCount = (f: (r: RepMetrics) => boolean) => reps.filter(f).length;
  return {
    reps: reps.length,
    minimizedCpuCorePct: stats(reps.map((r) => r.minimizedCpu).filter((n): n is number => n !== undefined)),
    minimizedRssMb: stats(reps.map((r) => r.minimizedRss).filter((n): n is number => n !== undefined)),
    timerRatePerSec: stats(reps.map((r) => r.timerRatePerSec).filter((n) => n >= 0)),
    rafRatePerSec: stats(reps.map((r) => r.rafRatePerSec).filter((n) => n >= 0)),
    waitResponseMs: stats(reps.map((r) => r.waitResponseMs).filter((n): n is number => n !== undefined)),
    waitResponseOkRate: okCount((r) => r.waitResponseOk) / reps.length,
    popupOkRate: okCount((r) => r.popupOk) / reps.length,
    clickOkRate: okCount((r) => r.clickOk) / reps.length,
    minimizeSuccessRate: okCount((r) => r.minimizedCount > 0) / reps.length,
    pageHiddenRate: okCount((r) => r.hidden) / reps.length
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startWorkloadServer(PORT);
  const machine = { platform: os.platform(), logicalCpuCount: CORES, totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)), cpuModel: os.cpus()[0]?.model?.trim() };
  console.log(`Occlusion/minimized throttle experiment — ${machine.cpuModel} · ${CORES} cores · headed · reps ${REPS}`);
  if (!IS_WIN) { console.log("Windows-only (minimize + CPU sampling). Aborting."); process.exit(0); }

  const out: any = { machine, reps: REPS, workload: "idle (minimized)", generatedAt: new Date().toISOString(), configs: {} };
  try {
    for (const cfg of CONFIGS) {
      console.log(`\n[${cfg.name}] ${cfg.note}`);
      const reps = await runConfig(cfg, server);
      out.configs[cfg.name] = { note: cfg.note, drop: cfg.drop, ...summarize(reps) };
      writeFileSync(join(OUT_DIR, "occlusion.json"), JSON.stringify(out, null, 2)); // incremental
    }
  } finally { server.server.close(); }

  const base = out.configs["pw-default"];
  console.log("\n=== Minimized-window CPU (share of one core) + behaviour vs pw-default baseline ===");
  const row = (name: string) => {
    const c = out.configs[name]; if (!c) return;
    const cpu: Stats | undefined = c.minimizedCpuCorePct;
    const red = reductionPct(base.minimizedCpuCorePct?.mean, cpu?.mean);
    console.log(`${name.padEnd(30)} CPU mean ${fmtS(cpu)} ${red === null ? "" : `(${red > 0 ? "-" : "+"}${Math.abs(red)}% vs base)`}`);
    console.log(`  ${" ".padEnd(28)} pageHidden ${pct(c.pageHiddenRate)} · timer ${fmtS(c.timerRatePerSec)}/s · rAF ${fmtS(c.rafRatePerSec)}/s · waitResp ${pct(c.waitResponseOkRate)} (${c.waitResponseMs?.median ?? "?"}ms) · popup ${pct(c.popupOkRate)} · click ${pct(c.clickOkRate)} · minimized ${pct(c.minimizeSuccessRate)}`);
  };
  for (const c of CONFIGS) row(c.name);
  console.log(`\nWrote ${join(OUT_DIR, "occlusion.json")}`);
}

function fmtS(s: Stats | undefined): string { return s ? `${s.mean} (med ${s.median}, p95 ${s.p95}, max ${s.max}, sd ${s.stddev})` : "n/a"; }
function pct(v: number): string { return `${Math.round(v * 100)}%`; }

main().catch((e) => { console.error(e); process.exit(1); });
