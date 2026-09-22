/**
 * Shared launcher for the local-AI Electron harness (Phase L, L1): builds
 * `scripts/ai-harness/harnessMain.ts` into a disposable Electron app directory, launches it
 * (optionally under a CPU affinity mask), and reads back its JSON report. Also locates the dev
 * runtime and model pack and measures the pack.
 *
 * The launch is a plain Electron process on an app DIRECTORY (the form this environment supports;
 * see scripts/verify-zvec-packaged-live.mts). No Playwright connection is needed because the harness
 * reports through a file.
 */

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const HOST_PATH = path.join(ROOT, "native-hosts", "ai", "ai-host.cjs");
/** The pack named in docs/plans/ai-upgrade-v5/L1-ai-foundation.md (owner step 2). */
export const MODEL_FILE_NAME = "Qwen3.5-4B-Q4_K_M.gguf";
/** Hugging Face's published LFS object for that file. A cross-check only; the pin uses our own measurement. */
export const PUBLISHED_PACK = Object.freeze({
  source: "https://huggingface.co/lmstudio-community/Qwen3.5-4B-GGUF",
  sizeBytes: 2_707_513_696,
  sha256: "25082a7dd3776cc3c741c6347d3bd04523f05796607b3fbc32fa3a25dfa1418c"
});

export interface HarnessReport {
  mode: string;
  ok: boolean;
  steps: { label: string; ok: boolean; durationMs: number; detail?: unknown; error?: string }[];
  log?: string[];
  [key: string]: unknown;
}

export async function buildAiHarness(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-harness-"));
  await build({
    entryPoints: [path.join(ROOT, "scripts", "ai-harness", "harnessMain.ts")],
    outfile: path.join(dir, "main.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    // The runtime must never be bundled into, or loaded by, the main process.
    external: ["electron", "node-llama-cpp"],
    // Playwright stays external but by its absolute repository path: the app directory is in the temp
    // folder, where a bare `require("playwright")` finds nothing, and product code that imports it
    // (`LocatorFactory` → `closedShadowBridge`) loads with the bundle, not on demand.
    plugins: [
      {
        name: "repository-playwright",
        setup(build) {
          const resolved = createRequire(path.join(ROOT, "package.json")).resolve("playwright");
          build.onResolve({ filter: /^playwright$/ }, () => ({ path: resolved, external: true }));
        }
      }
    ],
    alias: { "@main": path.join(ROOT, "app", "main"), "@src": path.join(ROOT, "src") },
    logLevel: "silent"
  });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "awkit-ai-harness", version: "0.0.0", main: "main.cjs" }, null, 2));
  return dir;
}

/**
 * Synchronous on purpose. As a bare `spawn` this returned before `taskkill` had even run, so the
 * caller's cleanup deleted the staged model root while Electron still had the .gguf memory-mapped:
 * on Windows that is an EPERM on unlink, which crashed the verifier and leaked a 2.7 GB copy plus a
 * live utility host holding the model. The kill has to be finished before the file can be released.
 */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
  } catch {
    /* already gone, or never started */
  }
}

/**
 * Run the harness and return its report, or null when it wrote none. With `affinityMask` the
 * Electron process is started by `start /affinity`, so it and every child (the utility host,
 * Chromium) are confined to those logical CPUs from creation.
 */
export async function runAiHarness(
  harnessDir: string,
  env: Record<string, string>,
  { timeoutMs, affinityMask }: { timeoutMs: number; affinityMask?: string }
): Promise<HarnessReport | null> {
  const reportPath = path.join(harnessDir, `report-${Date.now()}.json`);
  const electronPath = createRequire(import.meta.url)("electron") as unknown as string;
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env, AWKIT_HARNESS_REPORT: reportPath };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const child = affinityMask
    ? spawn("cmd.exe", ["/d", "/s", "/c", `"start "" /affinity ${affinityMask} /wait "${electronPath}" "${harnessDir}""`], {
        env: childEnv,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true
      })
    : spawn(electronPath, [harnessDir], { env: childEnv, stdio: "ignore", windowsHide: true });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const timedOut = await Promise.race([exited.then(() => false), new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs))]);
  if (timedOut) {
    killTree(child.pid);
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    // Windows releases a process's memory-mapped .gguf slightly AFTER the process itself is gone,
    // and the caller deletes the staged model root as soon as this returns. Without this settle the
    // delete races the unmap and fails with EPERM, leaking a 2.7 GB copy per timed-out run.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  if (!fs.existsSync(reportPath)) return null;
  return JSON.parse(fs.readFileSync(reportPath, "utf8")) as HarnessReport;
}

/** The same identity the host reports in `hello`, read from the repository's node_modules. */
export function runtimeInstalled(): { installed: boolean; build: string | null } {
  const modules = path.join(ROOT, "node_modules");
  const read = (file: string) => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };
  const pkg = read(path.join(modules, "node-llama-cpp", "package.json"));
  const release = read(path.join(modules, "node-llama-cpp", "llama", "binariesGithubRelease.json"));
  const binary = read(path.join(modules, "@node-llama-cpp", "win-x64", "package.json"));
  const addon = fs.existsSync(path.join(modules, "@node-llama-cpp", "win-x64", "bins", "win-x64", "llama-addon.node"));
  if (!pkg?.version || !release?.release) return { installed: false, build: null };
  return { installed: Boolean(binary?.version === pkg.version && addon), build: `node-llama-cpp@${pkg.version}+llama.cpp@${release.release}` };
}

/** Where owner step 2 puts the pack; AWKIT_AI_LIVE_MODEL overrides it. */
export function locateModelCandidate(): string | null {
  const candidates = [process.env.AWKIT_AI_LIVE_MODEL, path.join(os.homedir(), "Downloads", MODEL_FILE_NAME)].filter(Boolean) as string[];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile()) ?? null;
}

/**
 * Streamed SHA-256 and size, cached per (path, size, mtime) in the temp folder so the live verifier
 * and the benchmark do not rehash 2.7 GB on every run. The cache is keyed by those three facts, so an
 * edited or replaced file is always rehashed.
 */
export async function measurePack(file: string): Promise<{ sha256: string; sizeBytes: number; cached: boolean }> {
  const stat = fs.statSync(file);
  const cacheFile = path.join(os.tmpdir(), "awkit-ai-pack-measurements.json");
  const key = `${path.resolve(file)}|${stat.size}|${stat.mtimeMs}`;
  let cache: Record<string, string> = {};
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  } catch {
    cache = {};
  }
  if (typeof cache[key] === "string" && /^[0-9a-f]{64}$/.test(cache[key])) return { sha256: cache[key], sizeBytes: stat.size, cached: true };
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 })
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve())
      .on("error", reject);
  });
  const sha256 = hash.digest("hex");
  cache[key] = sha256;
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  return { sha256, sizeBytes: stat.size, cached: false };
}

/**
 * A disposable model root holding the pack as `<sha256>.gguf`, the layout `AiModelPackStore` uses.
 * A hard link avoids copying 2.7 GB; it falls back to a copy across volumes.
 */
export function stageModelRoot(file: string, sha256: string): { root: string; modelRoot: string; modelPath: string; linked: boolean } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-ai-live-"));
  const modelRoot = path.join(root, "models");
  fs.mkdirSync(modelRoot, { recursive: true });
  const modelPath = path.join(modelRoot, `${sha256}.gguf`);
  try {
    fs.linkSync(file, modelPath);
    return { root, modelRoot, modelPath, linked: true };
  } catch {
    fs.copyFileSync(file, modelPath);
    return { root, modelRoot, modelPath, linked: false };
  }
}

export function machine(): { cpuModel: string; logicalCpus: number; totalMemoryGb: number; os: string } {
  const cpus = os.cpus();
  return {
    cpuModel: cpus[0]?.model?.trim() ?? "unknown",
    logicalCpus: cpus.length,
    totalMemoryGb: Math.round(os.totalmem() / 1024 ** 3),
    os: `${os.type()} ${os.release()}`
  };
}

export function printSteps(report: HarnessReport, check: (label: string, ok: boolean, detail?: string) => void): void {
  for (const s of report.steps) check(`${s.label} (${s.durationMs} ms)`, s.ok, s.error);
  // A truncated run is a FAILED check, never a short list of passes: the harness now writes its
  // report after every step, so `complete: false` means it was killed mid-run rather than finished.
  if (report.complete === false) {
    check("the harness ran to completion", false, `killed while running: ${String(report.inFlight ?? "unknown")}`);
  }
}
