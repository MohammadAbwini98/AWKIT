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
 * Run: npm run verify:ai-gpu-host
 */

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AiBackendPackStore, backendTrustSources, resolveBackendTrust } from "@src/ai/AiBackendPack";
import { AI_BACKEND_MANIFEST, AI_MODEL_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";
import { readSignedDependencyManifest } from "@src/offline/SupplyChainIntegrity";

import { HOST_PATH, ROOT, buildAiHarness, measurePack, printSteps, runAiHarness, runtimeInstalled, stageModelRoot } from "./ai-harness/launch.mts";

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

console.log("verify:ai-gpu-host — L8a.3 modes on the real CPU and Vulkan hosts\n");
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
  const sources = backendTrustSources({ packaged: false, resourcesPath: "", appPath: ROOT });
  const store = new AiBackendPackStore({
    root: backendsRoot,
    entry,
    runtimeBuild: AI_RUNTIME_PIN.build,
    trust: async () => resolveBackendTrust({ signed: await readSignedDependencyManifest(sources.resourcesRoot), hostRoot: sources.hostRoot, entry, runtimeBuild: AI_RUNTIME_PIN.build! })
  });
  const imported = await store.import(source);
  check("the pinned Vulkan pack imports through the production store and trust chain", imported.ok, JSON.stringify(imported));
  if (!imported.ok) throw new Error("import failed");

  const report = await runAiHarness(
    harnessDir,
    {
      AWKIT_HARNESS_MODE: "gpu",
      AWKIT_HARNESS_HOST_PATH: HOST_PATH,
      AWKIT_HARNESS_MODEL_ROOT: staged.modelRoot,
      AWKIT_HARNESS_MODEL_PATH: staged.modelPath,
      AWKIT_HARNESS_MODEL_ID: model.id,
      AWKIT_HARNESS_BACKENDS_ROOT: backendsRoot,
      AWKIT_HARNESS_THREADS: String(Math.max(1, Math.min(8, os.cpus().length - 2)))
    },
    { timeoutMs: 540_000 }
  );
  if (!report) {
    check("the harness wrote a report", false, "no report: Electron never reached app.whenReady() or timed out");
  } else {
    printSteps(report, check);
    check("the harness ran every step", report.steps.length >= 20, `${report.steps.length} steps`);
    check("no raw model or pack path reached the managers' log", !(report.log ?? []).some((line) => line.includes(staged.modelRoot) || line.includes(backendsRoot)));
    console.log(`\n  · adapters: ${JSON.stringify(report.adapters)}`);
    console.log(`  · product readiness: ${JSON.stringify(report.productReadiness)}`);
    console.log(`  · plan: ${JSON.stringify(report.plan)}`);
    console.log(`  · load: ${JSON.stringify(report.load)}`);
    console.log(`  · pack guard runs: ${String(report.guardRuns)}`);
    const nvidia = Array.isArray(report.adapters) && (report.adapters as Array<{ nvidia: boolean }>).some((adapter) => adapter.nvidia);
    console.log(
      nvidia
        ? "  · an NVIDIA adapter is present: the MECHANICS steps ran on it."
        : "  · NVIDIA qualification: BLOCKED — no 0x10DE adapter on this machine (E11); the MECHANICS steps ran on a non-NVIDIA adapter and qualify nothing."
    );
  }
} finally {
  rmSync(harnessDir, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  rmSync(staged.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 && passed > 0 ? 0 : 1);
