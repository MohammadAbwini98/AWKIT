/**
 * verify:ai-gpu-backend-gate — Phase L, L8a.0: the Vulkan backend gate on the packaged build (`awkit-djnl.11`).
 *
 * L8a lets an administrator run the local model on an NVIDIA GPU without the installer ever carrying a
 * GPU binary: the user imports a pinned backend pack, the app copies it into an app-managed folder, and
 * the utility host loads GPU binaries only from there (docs/plans/ai-upgrade-v5/L8a-…, E3). Before any
 * of that is built, this gate measures what the plan left open and proves the loading boundary holds.
 *
 *   A. The pinned pack: `@node-llama-cpp/win-x64-vulkan` at the pinned build, every file with its size and
 *      SHA-256, x64 images, what they import from outside themselves, and their Authenticode status.
 *   B. The installer carries no GPU backend (a control proves the scan flags one), and the sizes: the CPU
 *      runtime that ships, the separate pack the user imports.
 *   C. The host, as Windows sees it: every display adapter by PCI vendor ID (E2), driver versions, the
 *      Vulkan loaders, nvidia-smi's VRAM, and what the backend binary itself says it needs. A known
 *      Microsoft software or remote-session adapter (no PCI function) is set aside by name and software
 *      enumerator; any other adapter without a PCI vendor ID fails.
 *   D. The loader decides, in a real Electron utility process like the AI host. The packaged AI tree and
 *      the pack staged in a separate "app-managed" folder are copied to scratch; every name this host could
 *      supply from outside them (System32 other than Windows' own files, the Windows directory, PATH,
 *      Electron's directory) is rewritten to a same-length decoy, except the Vulkan loader, which only
 *      the driver provides. An ESM resolve hook points node-llama-cpp's one pack specifier at the
 *      app-managed copy. The backend must then load with the GPU active, and the process's own module
 *      list must show every binary it resolved coming from those folders and nothing from the repository
 *      or a CUDA Toolkit. Controls: the unpatched copy loads; the pack without its app-local Visual C++
 *      runtime must NOT load; CPU mode loads nothing from the pack.
 *   E. Adapter pinning by per-spawn environment (`GGML_VK_VISIBLE_DEVICES`) on the utility host.
 *   F. The 3.21.1 sizing APIs, called for real on the pinned Qwen3.5-0.8B pack: GGUF insights, the
 *      runtime's own estimates and layer resolution, then CPU, partial and full offload measured
 *      (resolved layers, VRAM before/after, load time, a grammar-constrained generation).
 *
 * Outcomes that are answers, not failures: pinning unsupported, an API that throws. They are printed
 * as the L8a.0 record. Exit, the `gateExitCode` convention: 1 on any failure, 2 when a section could
 * not run (no dist/win-unpacked, no NVIDIA adapter, no pack), 0 only when every section ran and passed.
 *
 * Run: npm run verify:ai-gpu-backend-gate
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "../src/offline/AiModelManifest";
import { measurePack } from "./ai-harness/launch.mts";
import { adapterIdentityVerdict, classifyWindowsAdapter, pciVendorId } from "./ai-harness/windowsAdapters";
import { readPeImage, type PeImage } from "./helpers/pe-image.mts";
import { gateExitCode } from "./lib/failure-capture-gate.mts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NODE_MODULES = path.join(ROOT, "node_modules");
const UNPACKED = path.join(ROOT, "dist", "win-unpacked");
const PACKAGED_AI = path.join(UNPACKED, "resources", "native-hosts", "ai");
const PACK_PACKAGE = "@node-llama-cpp/win-x64-vulkan";
const PACK_BINS = "bins/win-x64-vulkan";
const CPU_PACKAGE = "@node-llama-cpp/win-x64";
const CPU_BINS_IN_TREE = "node_modules/@node-llama-cpp/win-x64/bins/win-x64";
const MSVC_RUNTIME = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll"];
const VULKAN_LOADER = "vulkan-1.dll";
const NVIDIA_VENDOR_ID = "10DE";
const MODEL_NAME = "Qwen3.5-0.8B-Q4_K_M.gguf";
const CONTEXT_TOKENS = 4096;
const SYSTEM_ROOT = process.env.SystemRoot ?? "C:\\Windows";
const SYSTEM32 = path.join(SYSTEM_ROOT, "System32");
const API_SET = /^(api|ext)-ms-/i;
const HOST_PROCESS = /^node\.(exe|dll)$/i;
const WINDOWS_SIGNER = /^CN=Microsoft Windows,/;
/** A GPU backend of llama.cpp/ggml, by file name. Names only; the installer scan also checks package folders. */
const GPU_BACKEND_FILE = /^(ggml-(vulkan|cuda|hip|sycl|opencl|musa|cann|metal)[^/]*|(ggml|llama)\.(vulkan|cuda)\.[^/]*)$/i;
/** Same exclusions as scripts/prepare-ai-native-host.mjs: never needed to load or run the runtime. */
const EXCLUDED_FILE = [/\.d\.[cm]?ts$/i, /\.map$/i, /\.lib$/i, /^(readme|changelog|history)(\.[a-z]+)?$/i];

let passed = 0;
let failed = 0;
const notRun: string[] = [];
const checks: string[] = [];
function check(label: string, ok: boolean, detail?: string): boolean {
  const line = `${ok ? "✓" : "✗"} ${label}${!ok && detail ? ` — ${detail}` : ""}`;
  checks.push(line);
  if (ok) {
    passed += 1;
    console.log(`  ${line}`);
  } else {
    failed += 1;
    console.error(`  ${line}`);
  }
  return ok;
}
/** Where the full record is written; the console keeps only a summary. */
const RECORD_FILE = path.join(os.tmpdir(), "awkit-l8a0-record.json");
function skip(label: string, reason: string): void {
  notRun.push(label);
  console.log(`  - NOT RUN: ${label} — ${reason}`);
}
/** The L8a.0 record: measured facts printed at the end, never assertions. */
const record: Record<string, unknown> = {};

const sha256 = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const posix = (p: string): string => p.split(path.sep).join("/");
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const lower = (p: string): string => path.resolve(p).toLowerCase();
const isUnder = (root: string, candidate: string): boolean => {
  const rel = path.relative(lower(root), lower(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function peOf(file: string): PeImage | null {
  return /\.(dll|node|exe)$/i.test(file) ? readPeImage(fs.readFileSync(file)) : null;
}

// ── Signatures (one PowerShell call per batch) ─────────────────────────────────────────────────────

const signatureCache = new Map<string, { status: string; subject: string; version: string }>();

function readSignatures(files: string[]): void {
  const todo = [...new Set(files.map((f) => f.toLowerCase()))].filter((f) => !signatureCache.has(f) && fs.existsSync(f));
  if (todo.length === 0) return;
  const list = path.join(os.tmpdir(), `awkit-gpu-gate-sig-${process.pid}.txt`);
  fs.writeFileSync(list, todo.join("\n"), "utf8");
  const script =
    "$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security') -ErrorAction Stop; [Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
    `foreach ($p in Get-Content -LiteralPath '${list}') { $s = Get-AuthenticodeSignature -LiteralPath $p; $v = (Get-Item -LiteralPath $p).VersionInfo; ` +
    "$subject = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' }; " +
    "Write-Output ('{0}|{1}|{2}|{3}' -f $p, $s.Status, $v.FileVersion, $subject) }";
  const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 600_000, windowsHide: true, maxBuffer: 64 << 20 });
  fs.rmSync(list, { force: true });
  if (run.status !== 0 || run.error) throw new Error(`signature probe failed: ${run.error?.message ?? run.stderr?.trim() ?? `exit ${run.status}`}`);
  for (const line of `${run.stdout ?? ""}`.split(/\r?\n/)) {
    const [file, status, version, ...subject] = line.split("|");
    if (file && status) signatureCache.set(file.trim().toLowerCase(), { status: status.trim(), version: (version ?? "").trim(), subject: subject.join("|").trim() });
  }
}
function signatureOf(file: string): { status: string; subject: string; version: string } | null {
  readSignatures([file]);
  return signatureCache.get(file.toLowerCase()) ?? null;
}
const windowsOwn = (name: string): boolean => {
  const sig = signatureOf(path.join(SYSTEM32, name));
  return sig !== null && sig.status === "Valid" && WINDOWS_SIGNER.test(sig.subject);
};

function powershellLines(command: string): string[] {
  const run = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`], { encoding: "utf8", timeout: 120_000, windowsHide: true });
  return run.status === 0 ? `${run.stdout ?? ""}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
}

// ── Isolation from the host (the L7 verify:native-dependencies method) ──────────────────────────────

const electronPath = createRequire(import.meta.url)("electron") as unknown as string;
const ELECTRON_DIR = path.dirname(electronPath);
const PATH_DIRS = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
const OUTSIDE_DIRS = [...new Set([SYSTEM32, SYSTEM_ROOT, ELECTRON_DIR, ...PATH_DIRS])];
const existsOutside = (name: string): boolean => OUTSIDE_DIRS.some((dir) => fs.existsSync(path.join(dir, name)));

function decoyFor(name: string): string {
  for (const prefix of ["zq", "qz", "zx", "xz", "qx"]) {
    const decoy = `${prefix}${name.slice(2)}`;
    if (!existsOutside(decoy)) return decoy;
  }
  throw new Error(`no free decoy for ${name}`);
}

/**
 * Rewrite, across `tree`, every import this host could satisfy from outside it to a same-length decoy and
 * rename a file of that name inside the tree to match. The Vulkan loader is exempt: only the display
 * driver provides it (E3, "detected by the host probe; never imported").
 */
function isolateFromHost(tree: string): { decoys: Map<string, string>; patched: number; leftover: string[] } {
  const binaries = listFiles(tree).map((file) => ({ file, image: peOf(file) })).filter((b): b is { file: string; image: PeImage } => b.image !== null);
  const decoys = new Map<string, string>();
  for (const { image } of binaries) {
    for (const { name } of image.imports) {
      const key = name.toLowerCase();
      if (decoys.has(key) || key === VULKAN_LOADER || API_SET.test(name) || HOST_PROCESS.test(name)) continue;
      if (!existsOutside(name) || windowsOwn(name)) continue;
      decoys.set(key, decoyFor(name));
    }
  }
  let patched = 0;
  for (const { file, image } of binaries) {
    const bytes = fs.readFileSync(file);
    let changed = false;
    for (const imp of image.imports) {
      const decoy = decoys.get(imp.name.toLowerCase());
      if (!decoy || imp.offset < 0) continue;
      bytes.write(decoy, imp.offset, "latin1");
      changed = true;
      patched += 1;
    }
    if (changed) fs.writeFileSync(file, bytes);
  }
  for (const file of listFiles(tree)) {
    const decoy = decoys.get(path.basename(file).toLowerCase());
    if (decoy) fs.renameSync(file, path.join(path.dirname(file), decoy));
  }
  const leftover = listFiles(tree).flatMap((file) => (peOf(file)?.imports ?? []).filter((i) => decoys.has(i.name.toLowerCase())).map((i) => `${posix(path.relative(tree, file))} → ${i.name}`));
  return { decoys, patched, leftover };
}

/** Every DLL name the binaries of `tree` import, lower-cased (API sets, node.exe and the Vulkan loader aside). */
function importedNames(tree: string): Set<string> {
  const names = new Set<string>();
  for (const file of listFiles(tree)) {
    for (const { name } of peOf(file)?.imports ?? []) {
      const key = name.toLowerCase();
      if (!API_SET.test(name) && !HOST_PROCESS.test(name) && key !== VULKAN_LOADER) names.add(key);
    }
  }
  return names;
}

// ── The probe: a real Electron utility process, forked the way AiUtilityHostManager forks the host ──

/** Runs inside the utility process. CommonJS, no named inner functions beyond what Node needs. */
const PROBE = String.raw`
"use strict";
const { register } = require("node:module");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const spec = JSON.parse(process.env.AWKIT_GPU_PROBE_SPEC);
const logs = [];
const listModules = () => String(spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process -Id " + process.pid + ").Modules | ForEach-Object { $_.FileName }"], { encoding: "utf8", windowsHide: true, timeout: 60000 }).stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const message = (e) => String((e && e.message) || e).replace(/\s+/g, " ").slice(0, 400);
const attempt = async (out, key, fn) => {
  try { out[key] = { ok: true, value: await fn() }; } catch (e) { out[key] = { ok: false, error: message(e) }; }
  return out[key];
};
const vram = async (llama) => { const s = await llama.getVramState(); return { total: s.total, used: s.used, free: s.free }; };
(async () => {
  const out = { env: { GGML_VK_VISIBLE_DEVICES: process.env.GGML_VK_VISIBLE_DEVICES ?? null }, logs };
  try {
    if (spec.pack) {
      const target = pathToFileURL(path.join(spec.pack, "dist", "index.js")).href;
      const hook = "export async function resolve(s, c, n) { return s === " + JSON.stringify(spec.specifier) + " ? { url: " + JSON.stringify(target) + ", shortCircuit: true } : n(s, c); }";
      register("data:text/javascript," + encodeURIComponent(hook));
      out.packBinsDir = (await import(spec.specifier)).getBinsDir().binsDir;
    }
    const rt = await import("node-llama-cpp");
    const started = performance.now();
    const llama = await rt.getLlama({
      gpu: spec.gpu, build: "never", skipDownload: true, progressLogs: false,
      logLevel: rt.LlamaLogLevel.debug,
      logger: (level, text) => { const line = String(text).trim(); if (logs.length < 120 && /vulkan|ggml_vk|load_backend|device|vram|gpu/i.test(line)) logs.push(line.slice(0, 300)); }
    });
    out.getLlamaMs = Math.round(performance.now() - started);
    out.gpu = llama.gpu;
    out.supportsGpuOffloading = llama.supportsGpuOffloading;
    out.gpuSupportsMmap = llama.gpuSupportsMmap;
    out.vramPaddingSize = llama.vramPaddingSize;
    out.systemInfo = String(llama.systemInfo).slice(0, 600);
    await attempt(out, "getVramState", () => vram(llama));
    await attempt(out, "getGpuDeviceNames", () => llama.getGpuDeviceNames());
    await attempt(out, "deviceInfoFields", () => Object.keys(llama._bindings.getGpuDeviceInfo()));
    await attempt(out, "getSwapState", () => llama.getSwapState());
    if (spec.model) {
      const m = {};
      out.model = m;
      const info = await attempt(m, "readGgufFileInfo", async () => { const i = await rt.readGgufFileInfo(spec.model); return { architecture: i.metadata?.general?.architecture ?? null }; });
      const insights = info.ok ? await rt.GgufInsights.from(await rt.readGgufFileInfo(spec.model), llama) : null;
      if (insights) {
        m.insights = { totalLayers: insights.totalLayers, modelSize: insights.modelSize, isHybrid: insights.isHybrid, isRecurrent: insights.isRecurrent, flashAttentionSupported: insights.flashAttentionSupported, trainContextSize: insights.trainContextSize };
        const total = insights.totalLayers;
        await attempt(m, "resolveAuto", () => insights.configurationResolver.resolveModelGpuLayersV2("auto"));
        await attempt(m, "resolveFitContext", () => insights.configurationResolver.resolveModelGpuLayersV2({ fitContext: { contextSize: spec.contextSize } }));
        await attempt(m, "resolveMax", () => insights.configurationResolver.resolveModelGpuLayersV2("max"));
        m.runs = [];
        for (const gpuLayers of [0, Math.floor(total / 2), "max", "auto"]) {
          const run = { requested: gpuLayers };
          m.runs.push(run);
          const n = gpuLayers === "max" ? total : typeof gpuLayers === "number" ? gpuLayers : null;
          if (n !== null) {
            await attempt(run, "modelEstimate", () => insights.estimateModelResourceRequirementsV2({ gpuLayers: n, useMmap: true, gpuSupportsMmap: llama.gpuSupportsMmap }));
            await attempt(run, "contextEstimate", () => insights.estimateContextResourceRequirementsV2({ contextSize: spec.contextSize, modelGpuLayers: n, batchSize: 512, sequences: 1 }));
          }
          run.vramBefore = await vram(llama);
          let model = null;
          let context = null;
          try {
            const t0 = performance.now();
            model = await llama.loadModel({ modelPath: spec.model, gpuLayers, useMmap: true, useMlock: false });
            run.loadMs = Math.round(performance.now() - t0);
            run.gpuLayers = model.gpuLayers;
            run.vramAfterModel = await vram(llama);
            context = await model.createContext({ contextSize: spec.contextSize, batchSize: 512, sequences: 1, threads: spec.threads });
            run.vramAfterContext = await vram(llama);
            const grammar = await llama.createGrammarForJsonSchema({ type: "object", properties: { answer: { type: "string", maxLength: 40 } }, required: ["answer"], additionalProperties: false });
            const completion = new rt.LlamaCompletion({ contextSequence: context.getSequence() });
            let first = null;
            let tokens = 0;
            const g0 = performance.now();
            const text = await completion.generateCompletion("Answer as JSON. What colour is a clear daytime sky?", { grammar, maxTokens: 32, temperature: 0, seed: 1, onToken: (chunk) => { if (first === null) first = performance.now(); tokens += chunk.length; } });
            const g1 = performance.now();
            run.generation = { tokens, firstTokenMs: first === null ? null : Math.round(first - g0), totalMs: Math.round(g1 - g0), tokensPerSecond: first === null || g1 === first ? null : Math.round(((tokens - 1) / ((g1 - first) / 1000)) * 10) / 10, json: (() => { try { JSON.parse(text); return true; } catch { return false; } })() };
          } catch (e) {
            run.error = message(e);
          } finally {
            if (context) await context.dispose().catch(() => undefined);
            if (model) await model.dispose().catch(() => undefined);
          }
          run.vramAfterDispose = await vram(llama);
        }
      }
    }
    if (spec.auditModules) out.modules = listModules();
    await llama.dispose();
  } catch (e) {
    out.error = message(e);
    if (spec.auditModules) out.modules = listModules();
  }
  process.parentPort.postMessage(out);
  setTimeout(() => process.exit(0), 100);
})();
`;

const LAUNCHER = String.raw`
"use strict";
const { app, utilityProcess } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const launch = JSON.parse(process.env.AWKIT_GPU_LAUNCH);
app.setPath("userData", path.join(launch.scratch, "launcher-user-data"));
app.disableHardwareAcceleration();
app.on("window-all-closed", () => undefined);
app.whenReady().then(() => {
  const env = Object.assign({}, process.env, launch.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.AWKIT_GPU_LAUNCH;
  let result = null;
  const child = utilityProcess.fork(launch.probe, [], { env, cwd: launch.cwd, stdio: "ignore", serviceName: "awkit-gpu-probe" });
  const timer = setTimeout(() => { result = result || { timedOut: true }; child.kill(); }, launch.timeoutMs);
  child.on("message", (m) => { result = m; });
  child.on("exit", (code) => {
    clearTimeout(timer);
    fs.writeFileSync(launch.report, JSON.stringify(result || { crashed: true, exitCode: code }));
    app.quit();
  });
});
`;

interface ProbeSpec {
  gpu: "vulkan" | false;
  pack?: string;
  model?: string;
  auditModules?: boolean;
  contextSize?: number;
  threads?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProbeResult = Record<string, any>;

let launcherDir = "";
let probeCounter = 0;

/** Fork the probe in a real utility process with `tree` (the AI tree root) as its module root and cwd. */
async function runProbe(scratch: string, tree: string, spec: ProbeSpec, extraEnv: Record<string, string> = {}, timeoutMs = 240_000): Promise<ProbeResult> {
  const probe = path.join(tree, "awkit-gpu-probe.cjs");
  fs.writeFileSync(probe, PROBE);
  const report = path.join(scratch, `probe-${(probeCounter += 1)}.json`);
  const launch = {
    scratch,
    probe,
    cwd: tree,
    report,
    timeoutMs,
    env: { ...extraEnv, AWKIT_GPU_PROBE_SPEC: JSON.stringify({ ...spec, specifier: PACK_PACKAGE }) }
  };
  const env: NodeJS.ProcessEnv = { ...process.env, AWKIT_GPU_LAUNCH: JSON.stringify(launch) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_PATH;
  const child = spawn(electronPath, [launcherDir], { env, stdio: "ignore", windowsHide: true });
  await new Promise<void>((resolve) => {
    const guard = setTimeout(() => {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      resolve();
    }, timeoutMs + 30_000);
    child.once("exit", () => {
      clearTimeout(guard);
      resolve();
    });
  });
  // Windows releases a process's mapped files slightly after the process is gone.
  await new Promise((resolve) => setTimeout(resolve, 500));
  fs.rmSync(probe, { force: true });
  return fs.existsSync(report) ? (JSON.parse(fs.readFileSync(report, "utf8")) as ProbeResult) : { crashed: true, detail: "the launcher wrote no report" };
}

const probeDetail = (r: ProbeResult): string =>
  r.error ?? (r.crashed ? `utility process ended without a result (exit ${r.exitCode ?? "?"})` : r.timedOut ? "timed out" : `gpu ${r.gpu}`);

// ── Run ────────────────────────────────────────────────────────────────────────────────────────────

console.log("verify:ai-gpu-backend-gate — L8a.0, the Vulkan backend on the packaged build\n");

const pinned = /^node-llama-cpp@(\d+\.\d+\.\d+)\+llama\.cpp@(.+)$/.exec(AI_RUNTIME_PIN.build ?? "");
const packDir = path.join(NODE_MODULES, ...PACK_PACKAGE.split("/"));
const cpuDir = path.join(NODE_MODULES, ...CPU_PACKAGE.split("/"));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-gpu-gate-"));

try {
  // ── A ──
  console.log("A. The pinned Vulkan backend pack");
  check("AI_RUNTIME_PIN names a node-llama-cpp + llama.cpp build", pinned !== null, String(AI_RUNTIME_PIN.build));
  const packPkg = fs.existsSync(path.join(packDir, "package.json")) ? (JSON.parse(fs.readFileSync(path.join(packDir, "package.json"), "utf8")) as { version?: string }) : null;
  const metaFile = path.join(packDir, ...PACK_BINS.split("/"), "_nlcBuildMetadata.json");
  const meta = fs.existsSync(metaFile) ? (JSON.parse(fs.readFileSync(metaFile, "utf8")) as { buildOptions?: { gpu?: unknown; arch?: string; platform?: string; llamaCpp?: { release?: string } } }) : null;
  if (!check(`${PACK_PACKAGE} is installed at the pinned ${pinned?.[1] ?? "?"}`, packPkg?.version !== undefined && packPkg.version === pinned?.[1], `installed ${packPkg?.version ?? "none"}`)) {
    throw new Error("no pinned pack to measure");
  }
  check(
    `its build metadata is win/x64/vulkan at the pinned llama.cpp release ${pinned?.[2]}`,
    meta?.buildOptions?.gpu === "vulkan" && meta.buildOptions.arch === "x64" && meta.buildOptions.platform === "win" && meta.buildOptions.llamaCpp?.release === pinned?.[2],
    JSON.stringify(meta?.buildOptions ?? null)
  );
  const packFiles = listFiles(packDir).filter((file) => !EXCLUDED_FILE.some((p) => p.test(path.basename(file))) && !path.basename(file).startsWith("."));
  const packBinaries = packFiles.map((file) => ({ file, rel: posix(path.relative(packDir, file)), image: peOf(file) })).filter((b) => b.image !== null) as { file: string; rel: string; image: PeImage }[];
  check(`every one of the pack's ${packBinaries.length} PE images is x64`, packBinaries.length > 0 && packBinaries.every((b) => b.image.machine === 0x8664), packBinaries.filter((b) => b.image.machine !== 0x8664).map((b) => b.rel).join(", "));
  const packNames = new Set(packFiles.map((f) => path.basename(f).toLowerCase()));
  const outside = new Map<string, string[]>();
  for (const b of packBinaries) {
    for (const imp of b.image.imports) {
      const key = imp.name.toLowerCase();
      if (API_SET.test(imp.name) || HOST_PROCESS.test(imp.name) || packNames.has(key)) continue;
      outside.set(key, [...(outside.get(key) ?? []), path.basename(b.rel)]);
    }
  }
  readSignatures([...outside.keys()].map((name) => path.join(SYSTEM32, name)));
  const notWindows = [...outside.keys()].filter((name) => !windowsOwn(name)).sort();
  console.log(`    imported from outside the pack: ${[...outside.keys()].sort().join(", ")}`);
  check(
    `the only non-Windows DLLs the pack needs from outside itself are the Vulkan loader and the Visual C++ runtime (${notWindows.join(", ")})`,
    notWindows.length > 0 && notWindows.every((name) => name === VULKAN_LOADER || MSVC_RUNTIME.includes(name)) && notWindows.includes(VULKAN_LOADER),
    notWindows.join(", ")
  );
  readSignatures(packBinaries.map((b) => b.file));
  const packSignatures = [...new Set(packBinaries.map((b) => signatureOf(b.file)?.status ?? "Unread"))];
  const cpuHashes = new Map(listFiles(cpuDir).map((file) => [posix(path.relative(path.join(cpuDir, "bins", "win-x64"), file)), sha256(file)]));
  const inventory = packFiles.map((file) => {
    const rel = posix(path.relative(packDir, file));
    const hash = sha256(file);
    return { relativePath: rel, size: fs.statSync(file).size, sha256: hash, sameAsCpu: cpuHashes.get(path.posix.basename(rel)) === hash };
  });
  const newestLinker = packBinaries.map((b) => b.image.linker).sort((a, b) => Number(b.split(".")[0]) - Number(a.split(".")[0]) || Number(b.split(".")[1]) - Number(a.split(".")[1]))[0];
  console.log(`    ${inventory.length} files, ${mb(inventory.reduce((s, f) => s + f.size, 0))}; Authenticode ${packSignatures.join(", ")}; newest linker ${newestLinker}`);
  record.pack = {
    inventory,
    package: `${PACK_PACKAGE}@${packPkg?.version}`,
    llamaCppRelease: meta?.buildOptions?.llamaCpp?.release,
    files: inventory.length,
    bytes: inventory.reduce((s, f) => s + f.size, 0),
    authenticode: packSignatures,
    newestLinker,
    importsFromOutside: Object.fromEntries([...outside].map(([k, v]) => [k, [...new Set(v)].length])),
    identicalToCpuPrebuilt: inventory.filter((f) => f.sameAsCpu).map((f) => path.posix.basename(f.relativePath))
  };

  // ── B ──
  console.log("\nB. The installer carries no GPU backend; sizes");
  const flagged = (root: string): string[] =>
    listFiles(root)
      .map((file) => posix(path.relative(root, file)))
      .filter((rel) => GPU_BACKEND_FILE.test(path.posix.basename(rel)) || /@node-llama-cpp\/win-x64-(vulkan|cuda)/i.test(rel));
  const controlHits = flagged(packDir);
  check(`control — the scan flags the pack's own GPU backend files (${controlHits.length})`, controlHits.some((rel) => /ggml-vulkan\.dll$/i.test(rel)), controlHits.join(", "));
  if (!fs.existsSync(PACKAGED_AI)) {
    skip("the packaged build (sections B–F)", "there is no dist/win-unpacked/resources/native-hosts/ai — run `npm run package:portable`");
  } else {
    const hits = flagged(UNPACKED);
    check("dist/win-unpacked holds no llama.cpp/ggml GPU backend and no GPU prebuilt package", hits.length === 0, hits.slice(0, 8).join(", "));
    const hostManifest = JSON.parse(fs.readFileSync(path.join(PACKAGED_AI, "ai-native-host-manifest.json"), "utf8")) as { gpu?: boolean; runtimeBuild?: string; totalBytes?: number; binaryPackage?: string; msvcRuntime?: { fileVersions?: Record<string, string>; minimumVersion?: string } };
    check(
      `the packaged host manifest is the pinned CPU-only runtime (${hostManifest.runtimeBuild}, gpu ${hostManifest.gpu})`,
      hostManifest.gpu === false && hostManifest.runtimeBuild === AI_RUNTIME_PIN.build && hostManifest.binaryPackage === CPU_PACKAGE
    );
    const cpuBinsBytes = listFiles(path.join(PACKAGED_AI, ...CPU_BINS_IN_TREE.split("/"))).reduce((s, f) => s + fs.statSync(f).size, 0);
    const msvcSources = MSVC_RUNTIME.map((name) => path.join(PACKAGED_AI, ...CPU_BINS_IN_TREE.split("/"), name));
    const msvcBytes = msvcSources.filter((f) => fs.existsSync(f)).reduce((s, f) => s + fs.statSync(f).size, 0);
    const packBytes = (record.pack as { bytes: number }).bytes + msvcBytes;
    console.log(`    installer: AI tree ${mb(hostManifest.totalBytes ?? 0)}, of which the CPU prebuilt ${mb(cpuBinsBytes)}; GPU delta to the installer: 0 bytes`);
    console.log(`    separate Vulkan pack as imported (its files + the app-local Visual C++ runtime): ${mb(packBytes)}`);
    record.sizes = { installerAiTreeBytes: hostManifest.totalBytes, installerCpuPrebuiltBytes: cpuBinsBytes, installerGpuDeltaBytes: 0, vulkanPackBytesWithMsvc: packBytes };
    // The pack is staged with the app-local Visual C++ runtime the installer already ships and validated.
    const msvcVersions = MSVC_RUNTIME.map((name) => hostManifest.msvcRuntime?.fileVersions?.[name] ?? "0.0.0");
    const atLeast = (v: string, floor: string): boolean => {
      const [a, b] = v.split(".").map(Number);
      const [c, d] = floor.split(".").map(Number);
      return a > c || (a === c && b >= d);
    };
    check(
      `the installer's app-local Visual C++ runtime (${msvcVersions.join(", ")}) is present and at least the pack's newest linker ${newestLinker}`,
      msvcSources.every((f) => fs.existsSync(f)) && msvcVersions.every((v) => atLeast(v, newestLinker)),
      msvcSources.filter((f) => !fs.existsSync(f)).join(", ")
    );

    // ── C ──
    console.log("\nC. The host's GPUs, drivers and Vulkan loaders (Windows' view)");
    const adapters = powershellLines(
      "Get-CimInstance Win32_VideoController | ForEach-Object { '{0}|{1}|{2}|{3}' -f $_.PNPDeviceID, $_.DriverVersion, $_.DriverDate, $_.Name }"
    ).map((line) => {
      const [pnp = "", driverVersion = "", driverDate = "", ...rest] = line.split("|");
      const name = rest.join("|");
      return { pnpDeviceId: pnp, vendorId: pciVendorId(pnp), deviceId: /DEV_([0-9A-F]{4})/i.exec(pnp)?.[1]?.toUpperCase() ?? null, driverVersion, driverDate: driverDate.slice(0, 10), name, kind: classifyWindowsAdapter(pnp, name) };
    });
    for (const a of adapters) console.log(`    adapter VEN_${a.vendorId ?? "????"} DEV_${a.deviceId ?? "????"} driver ${a.driverVersion} (${a.driverDate}) — ${a.name} [${a.kind}: ${a.pnpDeviceId}]`);
    // PCI identity is required of every adapter that could be a hardware acceleration candidate. A known
    // Microsoft software or remote-session adapter has none and is set aside by name AND software
    // enumerator; any other adapter without a PCI vendor ID still fails (scripts/ai-harness/windowsAdapters.ts).
    const identity = adapterIdentityVerdict(adapters);
    check(
      `Windows enumerates every hardware display adapter with a PCI vendor ID (${identity.pci} PCI${identity.microsoftSoftware.length > 0 ? `; set aside as Microsoft software adapters: ${identity.microsoftSoftware.join(", ")}` : ""})`,
      identity.ok,
      identity.unknown.length > 0 ? `no PCI identity and not a known Microsoft software adapter: ${identity.unknown.join("; ")}` : identity.pci === 0 ? "no PCI display adapter" : undefined
    );
    if (adapters.some((a) => a.kind === "microsoft-software" && /remote/i.test(a.name))) {
      console.log("    · a Remote Desktop session is active: NVIDIA qualification evidence is taken at the physical console (docs/NVIDIA_QUALIFICATION_SETUP.md)");
    }
    const nvidia = adapters.filter((a) => a.vendorId === NVIDIA_VENDOR_ID);
    const loaders = [path.join(SYSTEM32, VULKAN_LOADER), path.join(ELECTRON_DIR, VULKAN_LOADER), path.join(UNPACKED, VULKAN_LOADER)].filter((f) => fs.existsSync(f));
    readSignatures(loaders);
    for (const f of loaders) {
      const sig = signatureOf(f);
      console.log(`    ${f}: ${sig?.version ?? "?"}, ${sig?.status ?? "?"} (${sig?.subject.split(",")[0] || "unsigned"})`);
    }
    const smi = path.join(SYSTEM32, "nvidia-smi.exe");
    const smiRows = fs.existsSync(smi)
      ? `${spawnSync(smi, ["--query-gpu=index,pci.bus_id,driver_version,memory.total,memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8", windowsHide: true, timeout: 60_000 }).stdout ?? ""}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      : [];
    for (const row of smiRows) console.log(`    nvidia-smi: ${row}`);
    // What the backend binary says it needs, from its own strings: the Vulkan API level and the GGML_VK_* switches it reads.
    const vkBinary = fs.readFileSync(path.join(packDir, ...PACK_BINS.split("/"), "ggml-vulkan.dll")).toString("latin1");
    const apiStrings = [...new Set(vkBinary.match(/[ -~]{0,60}Vulkan 1\.\d[ -~]{0,60}/g) ?? [])].slice(0, 6);
    const vkEnv = [...new Set(vkBinary.match(/GGML_VK_[A-Z0-9_]+/g) ?? [])].sort();
    console.log(`    ggml-vulkan.dll names the Vulkan API: ${apiStrings.length > 0 ? apiStrings.map((s) => JSON.stringify(s.trim())).join("; ") : "no \"Vulkan 1.x\" string"}`);
    console.log(`    ggml-vulkan.dll reads: ${vkEnv.join(", ") || "no GGML_VK_* variable"}`);
    record.host = {
      adapters: adapters.map(({ vendorId, deviceId, driverVersion, driverDate, kind }) => ({ vendorId, deviceId, driverVersion, driverDate, kind })),
      nvidiaAdapters: nvidia.length,
      vulkanLoaders: loaders.map((f) => ({ path: f, version: signatureOf(f)?.version, signer: signatureOf(f)?.subject.split(",")[0] || "unsigned" })),
      nvidiaSmi: smiRows,
      backendApiStrings: apiStrings,
      backendEnvSwitches: vkEnv
    };

    let model: string | null = null;
    const candidate = path.join(os.homedir(), "Downloads", MODEL_NAME);
    if (fs.existsSync(candidate)) {
      const measured = await measurePack(candidate);
      if (AI_MODEL_MANIFEST.some((e) => e.fileName === MODEL_NAME && e.sha256 === measured.sha256 && e.sizeBytes === measured.sizeBytes)) model = candidate;
      else check(`~/Downloads/${MODEL_NAME} is the pinned pack`, false, `sha256 ${measured.sha256}`);
    }

    // The loader boundary, pinning and the sizing APIs are the backend's, not a vendor's: they run on any
    // Vulkan adapter. The NVIDIA-only acceptance (E11) is a separate gate that stays NOT RUN without one.
    if (nvidia.length === 0) {
      skip(
        `NVIDIA evidence (E11: GPU modes on the development machine's NVIDIA adapter)`,
        `no display adapter with PCI vendor ID 0x${NVIDIA_VENDOR_ID} on this host (${adapters.map((a) => `0x${a.vendorId}`).join(", ")}); D–F below measure the backend on the adapter(s) present`
      );
    }
    record.measuredOnVendorIds = adapters.map((a) => a.vendorId);
    if (!fs.existsSync(path.join(SYSTEM32, VULKAN_LOADER))) {
      skip("sections D–F", `no ${VULKAN_LOADER} in System32: no Vulkan-capable display driver is installed`);
    } else {
      // ── D ──
      console.log("\nD. The loader decides: packaged AI tree + app-managed Vulkan pack, in a real utility process");
      const ancestors: string[] = [];
      for (let dir = scratch; path.dirname(dir) !== dir; dir = path.dirname(dir)) ancestors.push(path.dirname(dir));
      const leaks = ancestors.filter((dir) => ["node-llama-cpp", "@node-llama-cpp"].some((name) => fs.existsSync(path.join(dir, "node_modules", name))));
      check("precondition: no directory above the scratch root can supply node-llama-cpp or a GPU pack", leaks.length === 0, leaks.join(", "));

      launcherDir = path.join(scratch, "launcher");
      fs.mkdirSync(launcherDir, { recursive: true });
      fs.writeFileSync(path.join(launcherDir, "package.json"), JSON.stringify({ name: "awkit-gpu-gate-launcher", main: "main.cjs" }));
      fs.writeFileSync(path.join(launcherDir, "main.cjs"), LAUNCHER);

      /** One layout: <root>/ai (the packaged tree) and <root>/app-managed/vulkan (the pack, optionally with its runtime). */
      const stage = (name: string, withMsvc: boolean): { root: string; tree: string; pack: string } => {
        const root = path.join(scratch, name);
        const tree = path.join(root, "ai");
        const pack = path.join(root, "app-managed", "vulkan");
        fs.cpSync(PACKAGED_AI, tree, { recursive: true });
        for (const file of packFiles) {
          const to = path.join(pack, path.relative(packDir, file));
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.copyFileSync(file, to);
        }
        if (withMsvc) for (const source of msvcSources) fs.copyFileSync(source, path.join(pack, ...PACK_BINS.split("/"), path.basename(source)));
        return { root, tree, pack };
      };

      const plain = stage("plain", true);
      const control = await runProbe(scratch, plain.tree, { gpu: "vulkan", pack: plain.pack });
      check("control — the unpatched copy loads the Vulkan backend through the resolve hook", control.gpu === "vulkan", probeDetail(control));
      check(
        "the hook resolved node-llama-cpp's pack specifier to the app-managed folder",
        typeof control.packBinsDir === "string" && isUnder(plain.pack, control.packBinsDir),
        String(control.packBinsDir)
      );

      const isolated = stage("isolated", true);
      const iso = isolateFromHost(isolated.root);
      console.log(`    made unreachable from outside the layout: ${[...iso.decoys.keys()].join(", ") || "nothing"}; ${iso.patched} import(s) rewritten`);
      check("the rewrite left no import of those names", iso.leftover.length === 0, iso.leftover.slice(0, 4).join("; "));
      const loaded = await runProbe(scratch, isolated.tree, { gpu: "vulkan", pack: isolated.pack, auditModules: true });
      const devices: string[] = loaded.getGpuDeviceNames?.ok ? loaded.getGpuDeviceNames.value : [];
      check(
        `the Vulkan backend loads with only the layout to satisfy its imports (gpu ${loaded.gpu}, ${devices.length} device(s), ${loaded.getLlamaMs ?? "?"} ms)`,
        loaded.gpu === "vulkan" && loaded.supportsGpuOffloading === true && devices.length > 0 && (loaded.getVramState?.value?.total ?? 0) > 0,
        probeDetail(loaded)
      );
      const modules: string[] = Array.isArray(loaded.modules) ? loaded.modules : [];
      check(`control — the process's module list was read (${modules.length}, the Electron executable among them)`, modules.some((m) => lower(m) === lower(electronPath)));
      // Names the layout's binaries import that Windows itself does not provide: each must bind inside the layout.
      const ours = new Set([...importedNames(isolated.root)].filter((name) => !windowsOwn(name)));
      const cudaRoots = [process.env.CUDA_PATH, ...["ProgramFiles", "ProgramW6432"].map((v) => process.env[v] && path.join(process.env[v]!, "NVIDIA GPU Computing Toolkit"))].filter(Boolean) as string[];
      const violations = modules.filter((m) => {
        // The host process: node_modules/electron/dist here, the install directory when packaged.
        if (isUnder(isolated.root, m) || isUnder(ELECTRON_DIR, m)) return false;
        const base = path.basename(m).toLowerCase();
        return isUnder(ROOT, m) || cudaRoots.some((r) => isUnder(r, m)) || /^(ggml|llama)/.test(base) || /\.node$/.test(base) || ours.has(base);
      });
      console.log(`    names the layout must satisfy itself: ${[...ours].sort().join(", ")}`);
      check(
        `no module the runtime resolved came from outside the layout, the repository (the Electron host aside) or a CUDA Toolkit (${ours.size} names checked)`,
        ours.size > 0 && violations.length === 0,
        violations.join(", ")
      );
      const addons = modules.filter((m) => /llama-addon\.node$/i.test(m));
      const vkBackend = modules.filter((m) => /ggml-vulkan\.dll$/i.test(m));
      check(
        "exactly one llama-addon.node and ggml-vulkan.dll are loaded, both from the app-managed folder",
        addons.length === 1 && vkBackend.length === 1 && isUnder(isolated.pack, addons[0]) && isUnder(isolated.pack, vkBackend[0]),
        [...addons, ...vkBackend].join(", ")
      );
      // The runtime under its own name, or under its decoy when this host could have supplied it from outside.
      const runtimeNames = new Set(MSVC_RUNTIME.flatMap((name) => [name, iso.decoys.get(name)?.toLowerCase() ?? name]));
      const runtimeLoaded = modules.filter((m) => runtimeNames.has(path.basename(m).toLowerCase()));
      check(
        `the backend bound the app-local Visual C++ runtime beside the pack, and no other copy (${runtimeLoaded.length} loaded)`,
        runtimeLoaded.length > 0 && runtimeLoaded.every((m) => isUnder(isolated.pack, m)),
        runtimeLoaded.join(", ")
      );
      const vulkanLoaded = modules.filter((m) => path.basename(m).toLowerCase() === VULKAN_LOADER);
      const thirdParty = modules.filter((m) => !isUnder(isolated.root, m) && !isUnder(SYSTEM_ROOT, m) && !isUnder(ELECTRON_DIR, m));
      console.log(`    Vulkan loader bound: ${vulkanLoaded.join(", ") || "none"}`);
      console.log(`    driver-stack modules outside Windows and Electron: ${thirdParty.join(", ") || "none"}`);
      console.log(`    ggml log: ${(loaded.logs as string[] | undefined)?.slice(0, 12).join(" ⏎ ") ?? "none"}`);

      const withoutMsvc = stage("isolated-no-msvc", false);
      const isoNoMsvc = isolateFromHost(withoutMsvc.root);
      const refused = await runProbe(scratch, withoutMsvc.tree, { gpu: "vulkan", pack: withoutMsvc.pack });
      check(
        `control — without its app-local Visual C++ runtime the isolated pack does NOT load (${[...isoNoMsvc.decoys.keys()].filter((n) => MSVC_RUNTIME.includes(n)).length} runtime name(s) made unreachable)`,
        !refused.timedOut && refused.gpu !== "vulkan",
        probeDetail(refused)
      );

      const cpu = await runProbe(scratch, isolated.tree, { gpu: false, pack: isolated.pack, auditModules: true });
      const cpuFromPack = ((cpu.modules as string[] | undefined) ?? []).filter((m) => isUnder(isolated.pack, m) || path.basename(m).toLowerCase() === VULKAN_LOADER);
      check(
        "CPU mode with the pack present loads the CPU backend and nothing from the pack or the Vulkan loader",
        cpu.gpu === false && Array.isArray(cpu.modules) && cpu.modules.length > 0 && cpuFromPack.length === 0,
        cpu.error ?? cpuFromPack.join(", ")
      );

      record.runtime = {
        loadMechanism: "ESM resolve hook (module.register) mapping the one pack specifier to <app-managed>/vulkan/dist/index.js",
        gpu: loaded.gpu,
        getLlamaMs: loaded.getLlamaMs,
        supportsGpuOffloading: loaded.supportsGpuOffloading,
        gpuSupportsMmap: loaded.gpuSupportsMmap,
        vramPaddingSize: loaded.vramPaddingSize,
        getVramState: loaded.getVramState,
        getGpuDeviceNames: loaded.getGpuDeviceNames,
        deviceInfoFields: loaded.deviceInfoFields,
        getSwapState: loaded.getSwapState?.ok ? "ok" : loaded.getSwapState,
        vulkanLoaderBound: vulkanLoaded,
        thirdPartyModules: thirdParty,
        decoyed: [...iso.decoys.keys()],
        ggmlLog: loaded.logs
      };

      // ── E ──
      console.log("\nE. Adapter pinning by per-spawn environment (GGML_VK_VISIBLE_DEVICES)");
      const pins: { value: string; devices: string[] | null; gpu: unknown; echoed: unknown; detail: string }[] = [];
      for (const value of [...devices.map((_, i) => String(i)).slice(0, 4), String(devices.length)]) {
        const r = await runProbe(scratch, isolated.tree, { gpu: "vulkan", pack: isolated.pack }, { GGML_VK_VISIBLE_DEVICES: value });
        pins.push({ value, devices: r.getGpuDeviceNames?.ok ? r.getGpuDeviceNames.value : null, gpu: r.gpu ?? null, echoed: r.env?.GGML_VK_VISIBLE_DEVICES, detail: probeDetail(r) });
      }
      check("the per-spawn variable reached every utility process", pins.every((p) => p.echoed === p.value), JSON.stringify(pins.map((p) => p.echoed)));
      const pinnedOk = pins.slice(0, -1).every((p, i) => p.devices?.length === 1 && p.devices[0] === devices[i]);
      const hideAll = pins[pins.length - 1];
      for (const p of pins) console.log(`    GGML_VK_VISIBLE_DEVICES=${p.value}: gpu ${String(p.gpu)}, devices ${JSON.stringify(p.devices)}${p.detail.startsWith("gpu") ? "" : ` — ${p.detail}`}`);
      console.log(`    RESULT: adapter pinning ${pinnedOk ? "SUPPORTED" : "NOT SUPPORTED"} by per-spawn environment on the utility host (${devices.length} Vulkan device(s) on this host)`);
      record.pinning = { supported: pinnedOk, vulkanDevices: devices.length, runs: pins };
      check("each pinning run gave a determinate answer (no crash, no timeout)", pins.slice(0, -1).every((p) => !/ended without|timed out|no report/.test(p.detail)), pins.map((p) => p.detail).join("; "));
      record.noVisibleDevice = hideAll;

      // ── F ──
      console.log(`\nF. The 3.21.1 sizing APIs and measured offload on the pinned ${MODEL_NAME}`);
      if (!model) {
        skip("section F", `no pinned pack at ~/Downloads/${MODEL_NAME}`);
      } else {
        const threads = Math.max(1, Math.min(8, Math.floor(os.cpus().length / 2)));
        const f = await runProbe(scratch, isolated.tree, { gpu: "vulkan", pack: isolated.pack, model, contextSize: CONTEXT_TOKENS, threads }, {}, 600_000);
        const m = f.model ?? {};
        check("readGgufFileInfo + GgufInsights.from run on the Vulkan Llama", m.readGgufFileInfo?.ok === true && typeof m.insights?.totalLayers === "number", m.readGgufFileInfo?.error ?? probeDetail(f));
        for (const key of ["resolveAuto", "resolveFitContext", "resolveMax"]) console.log(`    ${key}: ${JSON.stringify(m[key] ?? null)}`);
        const runs: ProbeResult[] = Array.isArray(m.runs) ? m.runs : [];
        for (const r of runs) {
          console.log(
            `    gpuLayers ${JSON.stringify(r.requested)} → ${r.gpuLayers ?? "?"} of ${m.insights?.totalLayers}; load ${r.loadMs ?? "?"} ms; VRAM used ${mb(r.vramBefore?.used ?? 0)} → model ${mb(r.vramAfterModel?.used ?? 0)} → context ${mb(r.vramAfterContext?.used ?? 0)} → disposed ${mb(r.vramAfterDispose?.used ?? 0)}; ` +
              `estimate model ${r.modelEstimate?.ok ? mb(r.modelEstimate.value.gpuVram) : r.modelEstimate?.error ?? "n/a"}, context ${r.contextEstimate?.ok ? mb(r.contextEstimate.value.gpuVram) : r.contextEstimate?.error ?? "n/a"}; ` +
              `${r.generation ? `${r.generation.tokens} tokens, first ${r.generation.firstTokenMs} ms, ${r.generation.tokensPerSecond} tok/s, JSON ${r.generation.json}` : `error ${r.error}`}`
          );
        }
        const byRequest = (req: unknown): ProbeResult | undefined => runs.find((r) => r.requested === req);
        const total = m.insights?.totalLayers;
        check("gpuLayers 0 loads with no layer on the GPU and generates grammar-valid JSON", byRequest(0)?.gpuLayers === 0 && byRequest(0)?.generation?.json === true, byRequest(0)?.error);
        check(
          `a partial count (${Math.floor((total ?? 0) / 2)}) is honored exactly and generates`,
          byRequest(Math.floor((total ?? 0) / 2))?.gpuLayers === Math.floor((total ?? 0) / 2) && byRequest(Math.floor((total ?? 0) / 2))?.generation?.json === true,
          byRequest(Math.floor((total ?? 0) / 2))?.error
        );
        check(`"max" offloads every layer (${total}) and generates`, byRequest("max")?.gpuLayers === total && byRequest("max")?.generation?.json === true, byRequest("max")?.error);
        const full = byRequest("max");
        check(
          "full offload moves VRAM: used grows on load and falls back after dispose",
          (full?.vramAfterContext?.used ?? 0) > (full?.vramBefore?.used ?? 0) && (full?.vramAfterDispose?.used ?? Infinity) < (full?.vramAfterContext?.used ?? 0)
        );
        record.offload = { model: MODEL_NAME, contextTokens: CONTEXT_TOKENS, threads, insights: m.insights, resolveAuto: m.resolveAuto, resolveFitContext: m.resolveFitContext, resolveMax: m.resolveMax, runs };
      }
    }
  }
} catch (error) {
  check("the gate ran to completion", false, error instanceof Error ? error.message : String(error));
} finally {
  try {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (error) {
    console.error(`  ! scratch left in place: ${scratch} (${(error as NodeJS.ErrnoException).code ?? error})`);
  }
}

fs.writeFileSync(RECORD_FILE, `${JSON.stringify({ ranAt: new Date().toISOString(), checks, notRun, record }, null, 2)}\n`);
console.log(`\nL8a.0 record written to ${RECORD_FILE}`);
for (const line of checks.filter((l) => l.startsWith("✗"))) console.error(`  ${line}`);
const exitCode = gateExitCode({ passed, failed, inconclusive: 0, gateNotRun: notRun.length > 0 });
console.log(`\n${passed} passed, ${failed} failed${notRun.length > 0 ? `, NOT RUN: ${notRun.join("; ")}` : ""} — ${exitCode === 0 ? "PASS" : exitCode === 1 ? "FAIL" : "NOT RUN, which is never a pass"}`);
process.exit(exitCode);
