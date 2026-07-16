/**
 * Per-instance browser resource benchmark (Browser Resource Optimization architecture — Phase 3 + 10).
 *
 * Measures ONE Chromium automation instance across workflow states, under each Browser Resource Profile,
 * using the SAME resolver-derived launch args + context options the runner uses. Writes machine-readable
 * results to reports/browser-performance/ + a comparison with reduction percentages.
 *
 * Metrics per profile (averaged over N reps to de-noise):
 *   - Network (DETERMINISTIC): requests + bytes the local server actually served the browser. A blocked
 *     sub-resource is `route.abort()`ed in the browser and never reaches the server, so this is an exact
 *     proxy for network-received-by-instance. This is the headline evidence that resource blocking works.
 *   - Working-set RAM (MB) of the instance's Chromium processes → avg / peak.
 *   - CPU % (share of one core, summed over the instance's Chromium processes, from Win32_Process
 *     kernel+user time deltas) → avg / p95 / peak, per state (blank / navigate / idle / form).
 *   - Chromium process count.
 *
 * NOT hardcoded to any machine: cores/RAM are detected and reported. Sampling of RAM/CPU is Windows-only
 * (matches ProcessTreeSampler); network sampling is cross-platform. "Our" Chromium = PIDs that appeared
 * after launch (baseline diff), which also covers Playwright's chrome-headless-shell.exe.
 *
 * Run: npx tsx scripts/benchmark-browser-resource.mts [--profiles balanced,low-resource] [--headed] [--reps 3]
 */
import http from "node:http";
import os from "node:os";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type LaunchOptions } from "playwright";
import { buildChromiumHardeningArgs } from "../src/runner/ChromiumHardening";
import { installResourceRouting } from "../src/runner/ResourceRoutingPolicy";
import { resolveBrowserConfigurationForRun } from "../src/runner/browserProfile/resolveForRun";
import type { BrowserResourceProfileMode } from "../src/runner/browserProfile/BrowserResourceProfile";
import type { InstanceConfig } from "../src/instances/InstanceConfig";
import type { FlowProfile } from "../src/profiles/FlowProfile";

const PORT = 4409;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = join(process.cwd(), "reports", "browser-performance");
const CORES = Math.max(1, os.cpus().length);
const IS_WIN = os.platform() === "win32";

const argv = process.argv.slice(2);
const HEADED = argv.includes("--headed");
const REPS = Math.max(1, Number.parseInt(argv[argv.indexOf("--reps") + 1] ?? "3", 10) || 3);
const profilesArg = argv[argv.indexOf("--profiles") + 1];
const PROFILES: BrowserResourceProfileMode[] =
  argv.includes("--profiles") && profilesArg ? (profilesArg.split(",") as BrowserResourceProfileMode[]) : ["balanced", "low-resource"];

// ── Minimal valid PNG encoder (random pixels → poorly compressible → real transfer + decode weight). ──
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}
function makePng(w: number, h: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowStart = y * (1 + w * 4);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < w * 4; x++) raw[rowStart + 1 + x] = Math.floor(Math.random() * 256);
  }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}

const HEAVY_PNG = makePng(220, 220); // ~190 KB, decodes to ~190 KB bitmap; 16 of them per page
const FONT_BYTES = Buffer.alloc(48 * 1024); // stand-in web font payload (blocked under lean)
const IMG_COUNT = 16;

const HTML = `<!doctype html><html><head><style>
@font-face{font-family:Bench;src:url('/font.woff2') format('woff2');}
@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
.spin{width:40px;height:40px;background:#39f;animation:spin 1.2s linear infinite;}
h1{font-family:Bench,system-ui;}
</style></head><body>
<h1 id="title">Bench Lab</h1>
<div class="spin"></div><div class="spin"></div><div class="spin"></div>
<canvas id="c" width="300" height="150"></canvas>
<div id="imgs"></div>
<input id="field" placeholder="type here"/><button id="go">Go</button>
<script>
for(let i=0;i<${IMG_COUNT};i++){const im=new Image();im.src='/img/'+i+'.png?x='+i;document.getElementById('imgs').appendChild(im);}
const ctx=document.getElementById('c').getContext('2d');let t=0;
function draw(){t+=0.05;ctx.clearRect(0,0,300,150);for(let i=0;i<40;i++){ctx.fillStyle='hsl('+((i*6+t*30)%360)+',70%,50%)';ctx.fillRect((i*5+t*10)%300,75+Math.sin(t+i)*60,4,4);}requestAnimationFrame(draw);}
requestAnimationFrame(draw);
setInterval(()=>{let s=0;for(let i=0;i<4000;i++)s+=Math.sqrt(i);window.__t=s;},250);
setInterval(()=>{fetch('/track/google-analytics.com/collect?v='+Date.now()).catch(()=>{});},1000);
new Image().src='/track/google-analytics.com/pixel.gif';
window.__ready=true;
</script></body></html>`;

const served = { requests: 0, bytes: 0 };
function startServer(): Promise<http.Server> {
  const send = (res: http.ServerResponse, code: number, type: string, body: Buffer | string) => {
    const buf = typeof body === "string" ? Buffer.from(body) : body;
    served.requests++;
    served.bytes += buf.length;
    res.writeHead(code, { "content-type": type }).end(buf);
  };
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/") return void send(res, 200, "text/html", HTML);
    if (path.startsWith("/img/")) return void send(res, 200, "image/png", HEAVY_PNG);
    if (path.startsWith("/track/")) return void send(res, 200, "image/gif", HEAVY_PNG.subarray(0, 64));
    if (path === "/font.woff2") return void send(res, 200, "font/woff2", FONT_BYTES);
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

interface RawSample { atMs: number; count: number; rssMb: number; cpuUnits: number }
interface StateSample { state: string; count: number; rssMb: number; cpuCorePct?: number }
interface ChromiumProc { pid: number; rssBytes: number; cpuUnits: number }

function queryChromiumProcs(): Promise<ChromiumProc[]> {
  if (!IS_WIN) return Promise.resolve([]);
  const script = [
    "$ErrorActionPreference='Stop';",
    // Matches chrome.exe, chromium.exe, msedge.exe AND chrome-headless-shell.exe (Playwright headless).
    "$p=Get-CimInstance Win32_Process -Filter \"Name LIKE '%chrom%' OR Name LIKE '%msedge%'\" | Select-Object ProcessId,WorkingSetSize,KernelModeTime,UserModeTime;",
    "foreach($x in $p){ Write-Output ('{0}|{1}|{2}' -f $x.ProcessId,[int64]$x.WorkingSetSize,([int64]$x.KernelModeTime + [int64]$x.UserModeTime)) }"
  ].join(" ");
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return void resolve([]);
        const procs: ChromiumProc[] = [];
        for (const line of String(stdout).trim().split(/\r?\n/)) {
          const [pid, rss, cpu] = line.split("|");
          const p = Number.parseInt(pid, 10);
          if (!Number.isFinite(p)) continue;
          procs.push({ pid: p, rssBytes: Number.parseInt(rss, 10) || 0, cpuUnits: Number.parseInt(cpu, 10) || 0 });
        }
        resolve(procs);
      }
    );
  });
}

async function chromiumPids(): Promise<Set<number>> {
  return new Set((await queryChromiumProcs()).map((p) => p.pid));
}

async function sampleChromium(baseline: Set<number>): Promise<RawSample> {
  const atMs = Date.now();
  const ours = (await queryChromiumProcs()).filter((p) => !baseline.has(p.pid));
  return {
    atMs,
    count: ours.length,
    rssMb: Math.round(ours.reduce((a, p) => a + p.rssBytes, 0) / (1024 * 1024)),
    cpuUnits: ours.reduce((a, p) => a + p.cpuUnits, 0)
  };
}

function toStateSamples(raw: RawSample[], stateOf: (atMs: number) => string): StateSample[] {
  const out: StateSample[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    let cpuCorePct: number | undefined;
    if (i > 0 && IS_WIN) {
      const prev = raw[i - 1];
      const wallMs = s.atMs - prev.atMs;
      const unitDelta = s.cpuUnits - prev.cpuUnits; // 100ns units
      if (wallMs > 0 && unitDelta >= 0) cpuCorePct = Math.round(((unitDelta / 1e4) / wallMs) * 100 * 10) / 10;
    }
    out.push({ state: stateOf(s.atMs), count: s.count, rssMb: s.rssMb, cpuCorePct });
  }
  return out;
}

function agg(nums: number[]): { avg: number; p95: number; peak: number } | undefined {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const avg = Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  const p95 = xs[Math.min(xs.length - 1, Math.floor(xs.length * 0.95))];
  return { avg, p95, peak: xs[xs.length - 1] };
}

function summarize(samples: StateSample[]) {
  const states = ["blank", "navigate", "idle", "form", "all"];
  const perState: Record<string, unknown> = {};
  for (const st of states) {
    const rows = st === "all" ? samples : samples.filter((s) => s.state === st);
    if (rows.length === 0) continue;
    perState[st] = {
      samples: rows.length,
      processCount: agg(rows.map((r) => r.count)),
      rssMb: agg(rows.map((r) => r.rssMb)),
      cpuCorePct: agg(rows.map((r) => r.cpuCorePct).filter((n): n is number => n !== undefined))
    };
  }
  return perState;
}

const clickFlow: FlowProfile[] = [
  { id: "f", name: "f", nodes: [{ id: "n0", type: "click", label: "c" }], edges: [] } as unknown as FlowProfile
];
const baseConfig: InstanceConfig = {
  id: "bench",
  name: "bench",
  browser: "chromium",
  headless: !HEADED,
  isolationMode: "browserContext",
  timeoutMs: 30000,
  viewport: { width: 1365, height: 768 }
};

function launchOptionsFor(resolved: ReturnType<typeof resolveBrowserConfigurationForRun>): LaunchOptions {
  const opts: LaunchOptions = {
    headless: !HEADED,
    args: [
      ...buildChromiumHardeningArgs(process.env, { omitBackgroundTimerThrottlePin: resolved.launchArgOverrides.omitBackgroundTimerThrottlePin }),
      ...resolved.launchArgOverrides.add
    ]
  };
  if (resolved.launchArgOverrides.ignoreDefaultArgs.length > 0) opts.ignoreDefaultArgs = resolved.launchArgOverrides.ignoreDefaultArgs;
  return opts;
}

async function oneRep(resolved: ReturnType<typeof resolveBrowserConfigurationForRun>): Promise<{ samples: StateSample[]; network: { requests: number; bytes: number } }> {
  const baselinePids = await chromiumPids();
  const browser = await chromium.launch(launchOptionsFor(resolved));
  const raw: RawSample[] = [];
  let stopped = false;
  const timeline: { at: number; state: string }[] = [];
  const mark = (state: string) => timeline.push({ at: Date.now(), state });
  const stateOf = (atMs: number): string => {
    let s = "blank";
    for (const t of timeline) if (atMs >= t.at) s = t.state;
    return s;
  };
  const sampler = (async () => {
    while (!stopped) {
      raw.push(await sampleChromium(baselinePids));
      await new Promise((r) => setTimeout(r, 700));
    }
  })();

  served.requests = 0;
  served.bytes = 0;
  try {
    const ctxOptions: Parameters<typeof browser.newContext>[0] = {
      viewport: resolved.contextOverrides.viewport,
      acceptDownloads: resolved.resourceRouting.acceptDownloads
    };
    if (resolved.resourceRouting.blockServiceWorkers) ctxOptions.serviceWorkers = "block";
    if (resolved.resourceRouting.reducedMotion) ctxOptions.reducedMotion = "reduce";
    if (resolved.resourceRouting.deviceScaleFactor !== undefined) ctxOptions.deviceScaleFactor = resolved.resourceRouting.deviceScaleFactor;
    const context: BrowserContext = await browser.newContext(ctxOptions);
    await installResourceRouting(context, resolved.resourceRouting);

    mark("blank");
    const page = await context.newPage();
    await wait(2000);
    mark("navigate");
    await page.goto(BASE, { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForFunction("window.__ready === true", { timeout: 5000 }).catch(() => {});
    await wait(3000);
    mark("idle");
    await wait(7000);
    mark("form");
    await page.fill("#field", "hello world").catch(() => {});
    await page.click("#go").catch(() => {});
    await wait(2000);
    await context.close();
  } finally {
    stopped = true;
    await sampler;
    await browser.close();
  }
  return { samples: toStateSamples(raw, stateOf), network: { requests: served.requests, bytes: served.bytes } };
}

async function benchProfile(mode: BrowserResourceProfileMode) {
  const resolved = resolveBrowserConfigurationForRun(baseConfig, clickFlow, {
    env: { ...process.env, AWKIT_BROWSER_RESOURCE_PROFILE: mode }
  });
  const allSamples: StateSample[] = [];
  const nets: { requests: number; bytes: number }[] = [];
  for (let r = 0; r < REPS; r++) {
    const { samples, network } = await oneRep(resolved);
    allSamples.push(...samples);
    nets.push(network);
  }
  const network = {
    requests: Math.round(nets.reduce((a, n) => a + n.requests, 0) / nets.length),
    bytes: Math.round(nets.reduce((a, n) => a + n.bytes, 0) / nets.length),
    kbPerRep: Math.round(nets.reduce((a, n) => a + n.bytes, 0) / nets.length / 1024)
  };
  return {
    profile: mode,
    headed: HEADED,
    reps: REPS,
    diagnostics: resolved.diagnostics,
    launchArgOverrides: resolved.launchArgOverrides,
    routingProfile: resolved.resourceRouting.profile,
    traceMode: resolved.traceMode,
    network,
    states: summarize(allSamples)
  };
}

function pct(base: number | undefined, opt: number | undefined): number | null {
  if (base === undefined || opt === undefined || base === 0) return null;
  return Math.round(((base - opt) / base) * 1000) / 10; // positive = reduction
}
function fmt(v: number | null): string {
  return v === null ? "n/a" : `${v > 0 ? "+" : ""}${v}%`;
}
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const machine = {
    platform: os.platform(),
    logicalCpuCount: CORES,
    totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
    cpuModel: os.cpus()[0]?.model?.trim()
  };
  console.log(`Machine: ${machine.cpuModel} · ${CORES} cores · ${machine.totalMemoryMb} MB · ${machine.platform}`);
  console.log(`Mode: ${HEADED ? "headed" : "headless"} · reps: ${REPS} · profiles: ${PROFILES.join(", ")}`);
  if (!IS_WIN) console.log("WARN: CPU/RAM sampling is Windows-only; recording network + process counts only.");
  console.log("");

  const runs: Record<string, any> = {};
  try {
    for (const mode of PROFILES) {
      console.log(`Benchmarking profile: ${mode} (${REPS} reps) ...`);
      const result = await benchProfile(mode);
      runs[mode] = result;
      writeFileSync(join(OUT_DIR, `${mode}.json`), JSON.stringify({ machine, ...result }, null, 2));
      const all: any = result.states.all ?? {};
      console.log(
        `  → net ${result.network.kbPerRep}KB/${result.network.requests}req · RSS avg ${all.rssMb?.avg ?? "?"}MB peak ${all.rssMb?.peak ?? "?"}MB · CPU avg ${all.cpuCorePct?.avg ?? "?"}% p95 ${all.cpuCorePct?.p95 ?? "?"}%`
      );
    }
  } finally {
    server.close();
  }

  const baseline = PROFILES[0];
  const b: any = runs[baseline];
  const comparison: any = { machine, headed: HEADED, reps: REPS, baseline, generatedAt: new Date().toISOString(), profiles: {} };
  for (const mode of PROFILES) {
    const r: any = runs[mode];
    const perState: any = {};
    for (const st of ["blank", "navigate", "idle", "form", "all"]) {
      const bs = b.states[st], rs = r.states[st];
      if (!bs || !rs) continue;
      perState[st] = {
        rssAvgReductionPct: pct(bs.rssMb?.avg, rs.rssMb?.avg),
        rssPeakReductionPct: pct(bs.rssMb?.peak, rs.rssMb?.peak),
        cpuAvgReductionPct: pct(bs.cpuCorePct?.avg, rs.cpuCorePct?.avg),
        cpuP95ReductionPct: pct(bs.cpuCorePct?.p95, rs.cpuCorePct?.p95),
        cpuPeakReductionPct: pct(bs.cpuCorePct?.peak, rs.cpuCorePct?.peak)
      };
    }
    comparison.profiles[mode] = {
      networkBytesReductionPct: pct(b.network.bytes, r.network.bytes),
      networkRequestsReductionPct: pct(b.network.requests, r.network.requests),
      states: perState
    };
  }
  writeFileSync(join(OUT_DIR, "comparison.json"), JSON.stringify(comparison, null, 2));

  console.log("\n=== Reduction vs baseline (" + baseline + "), positive = less resource ===");
  for (const mode of PROFILES) {
    if (mode === baseline) continue;
    const c = comparison.profiles[mode];
    console.log(`${mode}:`);
    console.log(`  network  bytes ${fmt(c.networkBytesReductionPct)} · requests ${fmt(c.networkRequestsReductionPct)}`);
    console.log(`  overall  RSS avg ${fmt(c.states.all?.rssAvgReductionPct)} · RSS peak ${fmt(c.states.all?.rssPeakReductionPct)} · CPU avg ${fmt(c.states.all?.cpuAvgReductionPct)}`);
    console.log(`  navigate RSS avg ${fmt(c.states.navigate?.rssAvgReductionPct)} · CPU avg ${fmt(c.states.navigate?.cpuAvgReductionPct)}`);
    console.log(`  idle     CPU avg ${fmt(c.states.idle?.cpuAvgReductionPct)} · CPU peak ${fmt(c.states.idle?.cpuPeakReductionPct)}`);
  }
  console.log(`\nWrote ${join(OUT_DIR, "comparison.json")} + per-profile JSON`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
