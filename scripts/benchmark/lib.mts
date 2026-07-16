/**
 * Shared benchmark library for the Browser Resource Optimization experiments.
 *
 * Provides: full statistics (mean/median/p95/max/min/stddev), a self-contained multi-workload HTTP server
 * (offline, deterministic), Chromium-subtree process sampling (Windows CIM; PID-baseline diff so it also
 * catches chrome-headless-shell.exe), a Win32 window-minimize helper (for the occluded/minimized throttle
 * experiment), and a generic per-instance runner. Every driver script (stats / ablation / occlusion /
 * workloads) builds on this so the measurement method is identical across experiments.
 *
 * Nothing is hardcoded to a machine; cores/RAM are detected by the callers.
 */
import http from "node:http";
import os from "node:os";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type LaunchOptions, type Page } from "playwright";

export const IS_WIN = os.platform() === "win32";
export const CORES = Math.max(1, os.cpus().length);

// ── Statistics ────────────────────────────────────────────────────────────────
export interface Stats { n: number; mean: number; median: number; p95: number; max: number; min: number; stddev: number }

export function stats(nums: number[]): Stats | undefined {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  const q = (p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))];
  const r = (v: number) => Math.round(v * 10) / 10;
  return { n: xs.length, mean: r(mean), median: r(q(0.5)), p95: r(q(0.95)), max: r(xs[xs.length - 1]), min: r(xs[0]), stddev: r(Math.sqrt(variance)) };
}

/** Accurate reduction percentage of `opt` vs `base` (positive = less resource). No rounding to 100. */
export function reductionPct(base: number | undefined, opt: number | undefined): number | null {
  if (base === undefined || opt === undefined || base === 0) return null;
  return Math.round(((base - opt) / base) * 10000) / 100; // 2 decimals
}

// ── PNG asset (random pixels → real transfer + decode weight) ───────────────────
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
export function makePng(w: number, h: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) { const rs = y * (1 + w * 4); raw[rs] = 0; for (let x = 0; x < w * 4; x++) raw[rs + 1 + x] = Math.floor(Math.random() * 256); }
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })), pngChunk("IEND", Buffer.alloc(0))]);
}

const HEAVY_PNG = makePng(220, 220);       // ~190 KB
const FONT_BYTES = Buffer.alloc(48 * 1024); // stand-in web font

// ── Workload pages (self-contained) ─────────────────────────────────────────────
const head = (extraStyle = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Bench;src:url('/font.woff2') format('woff2');}
body{font-family:Bench,system-ui;margin:16px} ${extraStyle}</style></head><body>`;

// Instrumentation shared by idle/animation pages: timer + rAF counters for throttling measurement.
const INSTRUMENT = `<script>
window.__timerFires=0; window.__raf=0; window.__lastTimer=performance.now();
setInterval(()=>{window.__timerFires++;window.__lastTimer=performance.now();},200);
(function loop(){window.__raf++;requestAnimationFrame(loop);})();
window.__ready=true;
</script>`;

const PAGES: Record<string, string> = {
  // Image-heavy: 24 heavy PNGs → the RAM/network driver.
  "image-heavy": head() + `<h1 id="title">Image Heavy</h1><div id="imgs"></div>
<script>for(let i=0;i<24;i++){const im=new Image();im.src='/img/'+i+'.png?x='+i;document.getElementById('imgs').appendChild(im);}window.__ready=true;</script></body></html>`,

  // Animation-heavy: CSS keyframe spinners + rAF canvas + timers (CPU / reduced-motion / throttling).
  "animation": head(`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.s{width:60px;height:60px;background:linear-gradient(#39f,#f39);animation:spin 1s linear infinite;display:inline-block;margin:6px}`) +
`<h1 id="title">Animation</h1><button id="popup" type="button">p</button>${"<div class=s></div>".repeat(12)}<canvas id="c" width="400" height="200"></canvas>
<script>const x=document.getElementById('c').getContext('2d');let t=0;(function d(){t+=0.05;x.clearRect(0,0,400,200);for(let i=0;i<80;i++){x.fillStyle='hsl('+((i*4+t*30)%360)+',70%,50%)';x.fillRect((i*5+t*10)%400,100+Math.sin(t+i)*80,5,5);}requestAnimationFrame(d);})();
document.getElementById('popup').onclick=()=>window.open('/popup-child','_blank');</script>${INSTRUMENT}</body></html>`,

  // Form-heavy: many inputs/selects (light, form workflows).
  "form": head() + `<h1 id="title">Form</h1><form id="f">` +
Array.from({ length: 40 }, (_, i) => `<div><label>Field ${i}</label><input id="fld${i}" name="fld${i}"><select><option>a</option><option>b</option></select></div>`).join("") +
`<button id="go" type="button">Submit</button></form><script>window.__ready=true;</script></body></html>`,

  // Large table: 1500 rows (DOM-heavy RAM).
  "table": head(`td,th{border:1px solid #ccc;padding:2px 6px;font-size:12px}`) + `<h1 id="title">Table</h1><table><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Amount</th></tr></thead><tbody id="b"></tbody></table>
<script>const b=document.getElementById('b');let h='';for(let i=0;i<1500;i++){h+='<tr><td>'+i+'</td><td>User '+i+'</td><td>user'+i+'@ex.com</td><td>'+(i%2?'active':'idle')+'</td><td>$'+(i*7%1000)+'</td></tr>';}b.innerHTML=h;window.__ready=true;</script></body></html>`,

  // SPA: view-swapping + a service worker (SW blocking test) + a few images per view.
  "spa": head() + `<h1 id="title">SPA</h1><nav><button id="v1">Home</button><button id="v2">List</button><button id="v3">Detail</button></nav><div id="view">home</div>
<script>
if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').then(()=>{window.__sw='registered';}).catch(()=>{window.__sw='failed';});}
function render(v){let h='<h2>'+v+'</h2>';for(let i=0;i<6;i++)h+='<img src="/img/'+v+i+'.png?x='+i+'">';document.getElementById('view').innerHTML=h;}
document.getElementById('v1').onclick=()=>render('home');document.getElementById('v2').onclick=()=>render('list');document.getElementById('v3').onclick=()=>render('detail');
render('home');window.__ready=true;</script></body></html>`,

  // Idle/wait: minimal DOM + instrumentation + a poll fetch + a rAF (long idle workflows).
  "idle": head() + `<h1 id="title">Idle</h1><div id="log">waiting</div><button id="popup" type="button">popup</button>
<script>setInterval(()=>{fetch('/api/ping?t='+Date.now()).catch(()=>{});},1000);
document.getElementById('popup').onclick=()=>window.open('/popup-child','_blank');</script>${INSTRUMENT}</body></html>`,

  "popup-child": head() + `<h1 id="title">Popup Child</h1><script>window.__ready=true;</script></body></html>`,

  "multitab": head() + `<h1 id="title">Multi Tab A</h1><button id="open" type="button">open B</button>
<script>document.getElementById('open').onclick=()=>window.open('/multitab-b','_blank');window.__ready=true;</script></body></html>`,
  "multitab-b": head() + `<h1 id="title">Multi Tab B</h1><div id="imgs"></div><script>for(let i=0;i<8;i++){const im=new Image();im.src='/img/b'+i+'.png?x='+i;document.body.appendChild(im);}window.__ready=true;</script></body></html>`,

  "download": head() + `<h1 id="title">Download</h1><a id="dl" href="/file.bin" download="file.bin">download</a><script>window.__ready=true;</script></body></html>`
};

export interface WorkloadServer { server: http.Server; served: { requests: number; bytes: number }; resetServed(): void; base: string }

export function startWorkloadServer(port: number): Promise<WorkloadServer> {
  const served = { requests: 0, bytes: 0 };
  const send = (res: http.ServerResponse, code: number, type: string, body: Buffer | string, count = true) => {
    const buf = typeof body === "string" ? Buffer.from(body) : body;
    if (count) { served.requests++; served.bytes += buf.length; }
    res.writeHead(code, { "content-type": type }).end(buf);
  };
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0].replace(/^\//, "");
    if (PAGES[path]) return void send(res, 200, "text/html", PAGES[path]);
    if (path.startsWith("img/")) return void send(res, 200, "image/png", HEAVY_PNG);
    if (path.startsWith("track/")) return void send(res, 200, "image/gif", HEAVY_PNG.subarray(0, 64));
    if (path === "font.woff2") return void send(res, 200, "font/woff2", FONT_BYTES);
    if (path === "sw.js") return void send(res, 200, "text/javascript", "self.addEventListener('fetch',()=>{});");
    if (path === "file.bin") return void res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": "attachment; filename=file.bin" }).end(Buffer.alloc(256 * 1024));
    if (path === "api/ping") return void send(res, 200, "application/json", "{}", false);
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, served, resetServed: () => { served.requests = 0; served.bytes = 0; }, base: `http://127.0.0.1:${port}` })));
}

// ── Chromium process sampling (subtree via PID-baseline diff) ────────────────────
export interface ChromiumProc { pid: number; rssBytes: number; cpuUnits: number }
export interface RawSample { atMs: number; count: number; rssMb: number; cpuUnits: number }

export function queryChromiumProcs(): Promise<ChromiumProc[]> {
  if (!IS_WIN) return Promise.resolve([]);
  const script = [
    "$ErrorActionPreference='Stop';",
    "$p=Get-CimInstance Win32_Process -Filter \"Name LIKE '%chrom%' OR Name LIKE '%msedge%'\" | Select-Object ProcessId,WorkingSetSize,KernelModeTime,UserModeTime;",
    "foreach($x in $p){ Write-Output ('{0}|{1}|{2}' -f $x.ProcessId,[int64]$x.WorkingSetSize,([int64]$x.KernelModeTime + [int64]$x.UserModeTime)) }"
  ].join(" ");
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) return void resolve([]);
      const procs: ChromiumProc[] = [];
      for (const line of String(stdout).trim().split(/\r?\n/)) {
        const [pid, rss, cpu] = line.split("|");
        const p = Number.parseInt(pid, 10);
        if (Number.isFinite(p)) procs.push({ pid: p, rssBytes: Number.parseInt(rss, 10) || 0, cpuUnits: Number.parseInt(cpu, 10) || 0 });
      }
      resolve(procs);
    });
  });
}

export async function chromiumPids(): Promise<Set<number>> {
  return new Set((await queryChromiumProcs()).map((p) => p.pid));
}

export async function sampleChromium(baseline: Set<number>): Promise<RawSample> {
  const atMs = Date.now();
  const ours = (await queryChromiumProcs()).filter((p) => !baseline.has(p.pid));
  return { atMs, count: ours.length, rssMb: Math.round(ours.reduce((a, p) => a + p.rssBytes, 0) / (1024 * 1024)), cpuUnits: ours.reduce((a, p) => a + p.cpuUnits, 0) };
}

/** Minimize the visible top-level windows owned by the given PIDs (Win32 ShowWindowAsync SW_MINIMIZE). */
export function minimizeChromiumWindows(pids: number[]): Promise<number> {
  if (!IS_WIN || pids.length === 0) return Promise.resolve(0);
  const set = pids.join(",");
  const script = `
$sig=@'
using System;using System.Runtime.InteropServices;using System.Collections.Generic;
public class W{
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
 public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c);
 public static int MinPids(HashSet<uint> pids){int n=0;EnumWindows((h,l)=>{uint pid;GetWindowThreadProcessId(h,out pid);if(pids.Contains(pid)&&IsWindowVisible(h)){ShowWindowAsync(h,6);n++;}return true;},IntPtr.Zero);return n;}
}
'@
Add-Type -TypeDefinition $sig -Language CSharp
$set=New-Object System.Collections.Generic.HashSet[uint32]
foreach($p in @(${set})){[void]$set.Add([uint32]$p)}
Write-Output ([W]::MinPids($set))`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { timeout: 12000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) return void resolve(0);
      resolve(Number.parseInt(String(stdout).trim(), 10) || 0);
    });
  });
}

// ── Per-instance runner ──────────────────────────────────────────────────────
export interface InstanceSpec {
  headed: boolean;
  launchArgs: string[];
  ignoreDefaultArgs?: string[];
  contextOptions: Parameters<Browser["newContext"]>[0];
}

export interface StateSample { state: string; count: number; rssMb: number; cpuCorePct?: number }

export function toStateSamples(raw: RawSample[], stateOf: (atMs: number) => string): StateSample[] {
  const out: StateSample[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    let cpuCorePct: number | undefined;
    if (i > 0 && IS_WIN) {
      const prev = raw[i - 1];
      const wallMs = s.atMs - prev.atMs;
      const unitDelta = s.cpuUnits - prev.cpuUnits;
      if (wallMs > 0 && unitDelta >= 0) cpuCorePct = Math.round(((unitDelta / 1e4) / wallMs) * 100 * 10) / 10;
    }
    out.push({ state: stateOf(s.atMs), count: s.count, rssMb: s.rssMb, cpuCorePct });
  }
  return out;
}

export interface DriveApi {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  base: string;
  mark: (state: string) => void;
  ourPids: () => Promise<number[]>;
  minimize: () => Promise<number>;
  wait: (ms: number) => Promise<void>;
}

export interface RepResult { samples: StateSample[]; durationMs: number; behavior: Record<string, number | string | boolean> }

/** Launch one instance, sample continuously, run `drive`, return per-state samples + duration + behavior. */
export async function runInstance(spec: InstanceSpec, server: WorkloadServer, drive: (api: DriveApi) => Promise<Record<string, number | string | boolean> | void>, sampleIntervalMs = 700): Promise<RepResult> {
  const baselinePids = await chromiumPids();
  const launchOptions: LaunchOptions = { headless: !spec.headed, args: spec.launchArgs };
  if (spec.ignoreDefaultArgs && spec.ignoreDefaultArgs.length > 0) launchOptions.ignoreDefaultArgs = spec.ignoreDefaultArgs;
  const browser = await chromium.launch(launchOptions);
  const raw: RawSample[] = [];
  let stopped = false;
  const timeline: { at: number; state: string }[] = [];
  const mark = (state: string) => timeline.push({ at: Date.now(), state });
  const stateOf = (atMs: number): string => { let s = "start"; for (const t of timeline) if (atMs >= t.at) s = t.state; return s; };
  const sampler = (async () => { while (!stopped) { raw.push(await sampleChromium(baselinePids)); await new Promise((r) => setTimeout(r, sampleIntervalMs)); } })();

  const startedAt = Date.now();
  server.resetServed();
  let behavior: Record<string, number | string | boolean> = {};
  try {
    const context = await browser.newContext(spec.contextOptions);
    const page = await context.newPage();
    const ourPids = async () => [...(await chromiumPids())].filter((p) => !baselinePids.has(p));
    const api: DriveApi = {
      page, context, browser, base: server.base, mark, ourPids,
      minimize: async () => minimizeChromiumWindows(await ourPids()),
      wait: (ms) => new Promise((r) => setTimeout(r, ms))
    };
    const b = await drive(api);
    if (b) behavior = b;
    await context.close();
  } finally {
    stopped = true;
    await sampler;
    await browser.close();
  }
  return { samples: toStateSamples(raw, stateOf), durationMs: Date.now() - startedAt, behavior };
}

export function wait(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
