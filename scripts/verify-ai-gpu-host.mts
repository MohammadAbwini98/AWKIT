/**
 * verify:ai-gpu-host — Phase L L8a.3 execution modes on the REAL hosts, in a real Electron app.
 *
 * Imports the pinned Vulkan pack (the manifest's 24 files from the installed prebuilt) into a scratch
 * backends root through the production `AiBackendPackStore` and the real trust chain (the signed
 * dependency manifest and this build's staged VC++ runtime), stages the pinned Qwen3.5-0.8B, then runs
 * `scripts/ai-harness/gpuLive.ts` (AWKIT_HARNESS_MODE=gpu):
 *  - CPU & RAM only unchanged, and the CPU host refusing every GPU request;
 *  - PRODUCT: this machine's adapters by PCI vendor ID and what GPU-Offload and GPU-Only do with them;
 *  - MECHANICS (eligibility substituted, labelled): the pack guard before the GPU host forks, the runtime's
 *    plan, an offloaded load and inference, every llama.cpp binary in the GPU host loaded from the pack,
 *    the service's GPU-Offload, GPU-Only's real shortfall, the CPU fallback, and a pack altered after
 *    import refused before any GPU host starts.
 * On a non-NVIDIA adapter the mechanics are not NVIDIA qualification (E11), and this verifier never
 * says they are. Without the runtime, the Vulkan prebuilt or the model it exits 2 (NOT RUN), never 0.
 *
 * `--lifecycle` (L8a.5, npm run verify:ai-gpu-lifecycle) runs `scripts/ai-harness/gpuLifecycle.ts`
 * instead, on the same imported pack and model. For every layer and for a partial load it measures:
 *  - the cold load;
 *  - cancel latency against the L1.8 3 s ceiling, during prompt processing and during generation;
 *  - the cost of a host killed from outside and brought back with the model.
 * It also records how a loaded host behaves while other GPU hosts take the adapter's VRAM. A cancel
 * that lands after the inference finished is INCONCLUSIVE (exit 2), never a pass.
 *
 * `--packaged` (L8a.5: npm run verify:ai-gpu-packaged, and with `--lifecycle`
 * verify:ai-gpu-lifecycle-packaged) runs one mode per run against dist/win-unpacked's AI
 * tree: the packaged host, the packaged pinned runtime and CPU prebuilt, and pack trust from the packaged
 * signed manifest and runtime DLLs. The source managers and service drive it in a real Electron utility
 * process, as the L8a.0 gate did. The packaged EXE's own CPU path is verify:ai-packaged-app. A package
 * whose host differs from the source host is stale and FAILS, and a missing package exits 2.
 *
 * Run: npm run verify:ai-gpu-host
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AiBackendPackStore, backendTrustSources, resolveBackendTrust } from "@src/ai/AiBackendPack";
import { AI_BACKEND_MANIFEST, AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";
import { readSignedDependencyManifest } from "@src/offline/SupplyChainIntegrity";

import { HOST_PATH, ROOT, buildAiHarness, measurePack, printSteps, runAiHarness, runtimeInstalled, stageModelRoot, type HarnessReport } from "./ai-harness/launch.mts";

const lifecycle = process.argv.includes("--lifecycle");
const packaged = process.argv.includes("--packaged");
/** L1.8: a cancel settles within 3 s, on every backend. */
const CANCEL_CEILING_MS = 3_000;
let inconclusive = 0;
const packagedResources = path.join(ROOT, "dist", "win-unpacked", "resources");
const hostPath = packaged ? path.join(packagedResources, "native-hosts", "ai", "ai-host.cjs") : HOST_PATH;
// One harness mode per run: the modes run ends by invalidating the imported pack on purpose (sticky
// until re-import), and both modes together take most of 10 minutes.
const modes = [lifecycle ? "gpuLifecycle" : "gpu"];

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function notRun(reason: string): never {
  console.log(`NOT RUN: ${reason} — exit 2, never a pass`);
  process.exit(2);
}

const PACK_NAME = "Qwen3.5-0.8B-Q4_K_M.gguf";
const installedVulkan = path.join(ROOT, "node_modules", "@node-llama-cpp", "win-x64-vulkan");

console.log(
  `${lifecycle ? `verify:ai-gpu-lifecycle${packaged ? "-packaged" : ""} — L8a.5 cancel, kill-restart-reload and VRAM exhaustion` : `verify:ai-gpu-${packaged ? "packaged" : "host"} — L8a.3 modes`} on ${packaged ? "dist/win-unpacked's AI tree" : "the real CPU and Vulkan hosts"}\n`
);
if (packaged) {
  if (!existsSync(hostPath)) notRun("no dist/win-unpacked AI tree: run npm run package:portable first");
  // A package older than the host it should carry is stale evidence, never a pass.
  check("the packaged host is the source host, byte for byte (the package is not stale)", readFileSync(hostPath).equals(readFileSync(HOST_PATH)));
}
const runtime = runtimeInstalled();
if (!runtime.installed || runtime.build !== AI_RUNTIME_PIN.build) notRun(`the pinned runtime ${AI_RUNTIME_PIN.build} is not installed`);
const entry = AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan");
if (!entry || !existsSync(installedVulkan)) notRun("the pinned Vulkan prebuilt is not installed");
const packFile = path.join(os.homedir(), "Downloads", PACK_NAME);
if (!existsSync(packFile)) notRun(`no model pack at ~/Downloads/${PACK_NAME}`);
const measured = await measurePack(packFile);
const model = AI_MODEL_MANIFEST.find((item) => item.sha256 === measured.sha256 && item.sizeBytes === measured.sizeBytes);
if (!model) notRun(`${PACK_NAME} is not a pinned manifest entry`);

const scratch = mkdtempSync(path.join(os.tmpdir(), "awkit-gpu-host-"));
const staged = stageModelRoot(packFile, measured.sha256);
const harnessDir = await buildAiHarness();
try {
  // The pack exactly as a user would supply it: the manifest's 24 files.
  const source = path.join(scratch, "vulkan-pack");
  for (const file of entry.files) {
    const target = path.join(source, ...file.path.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(installedVulkan, ...file.path.split("/")), target);
  }
  const backendsRoot = path.join(scratch, "backends");
  const sources = backendTrustSources(packaged ? { packaged: true, resourcesPath: packagedResources, appPath: ROOT } : { packaged: false, resourcesPath: "", appPath: ROOT });
  const store = new AiBackendPackStore({
    root: backendsRoot,
    entry,
    runtimeBuild: AI_RUNTIME_PIN.build,
    trust: async () => resolveBackendTrust({ signed: await readSignedDependencyManifest(sources.resourcesRoot), hostRoot: sources.hostRoot, entry, runtimeBuild: AI_RUNTIME_PIN.build! })
  });
  const imported = await store.import(source);
  check("the pinned Vulkan pack imports through the production store and trust chain", imported.ok, JSON.stringify(imported));
  if (!imported.ok) throw new Error("import failed");

  for (const mode of modes) {
    const report = await runAiHarness(
      harnessDir,
      {
        AWKIT_HARNESS_MODE: mode,
        AWKIT_HARNESS_HOST_PATH: hostPath,
        AWKIT_HARNESS_MODEL_ROOT: staged.modelRoot,
        AWKIT_HARNESS_MODEL_PATH: staged.modelPath,
        AWKIT_HARNESS_MODEL_ID: model.id,
        AWKIT_HARNESS_BACKENDS_ROOT: backendsRoot,
        AWKIT_HARNESS_THREADS: String(Math.max(1, Math.min(8, os.cpus().length - 2)))
      },
      { timeoutMs: mode === "gpuLifecycle" ? 1_500_000 : 540_000 }
    );
    if (!report) check(`the ${mode} harness wrote a report`, false, "no report: Electron never reached app.whenReady() or timed out");
    else if (mode === "gpuLifecycle") reportLifecycle(report, [staged.modelRoot, backendsRoot]);
    else reportModes(report, [staged.modelRoot, backendsRoot]);
  }
} finally {
  rmSync(harnessDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  rmSync(staged.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

console.log(`\n${passed} passed, ${failed} failed${inconclusive ? `, ${inconclusive} inconclusive` : ""}`);
process.exit(failed === 0 && passed > 0 ? (inconclusive > 0 ? 2 : 0) : 1);

function noPrivatePath(report: HarnessReport, privatePaths: string[]): void {
  check("no raw model or pack path reached the managers' log", !(report.log ?? []).some((line) => privatePaths.some((hidden) => line.includes(hidden))));
}

function nvidiaLine(report: HarnessReport): string {
  const nvidia = Array.isArray(report.adapters) && (report.adapters as Array<{ nvidia: boolean }>).some((adapter) => adapter.nvidia);
  return nvidia
    ? "  · an NVIDIA adapter is present: the MECHANICS steps ran on it."
    : "  · NVIDIA qualification: BLOCKED — no 0x10DE adapter on this machine (E11); the MECHANICS steps ran on a non-NVIDIA adapter and qualify nothing.";
}

function reportModes(report: HarnessReport, privatePaths: string[]): void {
  printSteps(report, check);
  check("the harness ran every step", report.steps.length >= 20, `${report.steps.length} steps`);
  noPrivatePath(report, privatePaths);
  console.log(`\n  · adapters: ${JSON.stringify(report.adapters)}`);
  console.log(`  · product readiness: ${JSON.stringify(report.productReadiness)}`);
  console.log(`  · plan: ${JSON.stringify(report.plan)}`);
  console.log(`  · load: ${JSON.stringify(report.load)}`);
  console.log(`  · pack guard runs: ${String(report.guardRuns)}`);
  console.log(nvidiaLine(report));
}

function reportLifecycle(report: HarnessReport, privatePaths: string[]): void {
  printSteps(report, check);
  check("the harness finished", report.complete === true, `stopped in: ${String(report.inFlight)}`);
  noPrivatePath(report, privatePaths);
  console.log(`\n  · plan: ${JSON.stringify(report.plan)}`);
  type Cancel = { latencyMs: number; cancelAfterMs: number; settledBy: string } | null;
  type Placement = { layers: number; cold?: unknown; baseline?: unknown; cancelDuringPrompt?: Cancel; cancelDuringGeneration?: Cancel; killRestartReload?: Record<string, number | boolean> | null };
  const placements = (report.placements ?? {}) as Record<string, Placement>;
  check("both placements were measured", Object.keys(placements).length === 2, Object.keys(placements).join());
  for (const [key, placement] of Object.entries(placements)) {
    console.log(`\n  ${key} (${placement.layers} layers on the GPU)`);
    console.log(`  · cold: ${JSON.stringify(placement.cold)}`);
    console.log(`  · long prompt, uncancelled: ${JSON.stringify(placement.baseline)}`);
    for (const [phase, measured] of [["prompt processing", placement.cancelDuringPrompt], ["generation", placement.cancelDuringGeneration]] as const) {
      if (!measured) continue; // its step already failed above
      if (measured.settledBy === "host" || measured.settledBy === "kill") {
        check(
          `${key}: a cancel during ${phase} settled in ${measured.latencyMs} ms (by the ${measured.settledBy}), within the ${CANCEL_CEILING_MS} ms L1.8 ceiling`,
          measured.latencyMs <= CANCEL_CEILING_MS,
          JSON.stringify(measured)
        );
      } else {
        inconclusive += 1;
        console.log(`  ? ${key}: cancel during ${phase} INCONCLUSIVE — the inference ${measured.settledBy} before the cancel landed at ${measured.cancelAfterMs} ms`);
      }
    }
    const back = placement.killRestartReload;
    if (back) {
      check(`${key}: a host killed from outside is one unexpected exit, and the circuit stays closed`, back.strikes === 1 && back.circuitOpen === false, JSON.stringify(back));
      console.log(`  · killed → back with the model: exit seen ${back.exitSeenMs} ms, re-fork + guard + handshake ${back.restartMs} ms, reload ${back.reloadMs} ms, total ${back.totalMs} ms`);
    }
  }
  console.log(`\n  · exhaustion (observations): ${JSON.stringify(report.exhaustion, null, 2)}`);
  console.log(`\n${nvidiaLine(report)}`);
}
