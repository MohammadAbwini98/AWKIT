/**
 * L8a.3 live mode (AWKIT_HARNESS_MODE=gpu): the production `AiUtilityHostManager`, `AiService` and
 * `AiBackendPackStore` against the real `native-hosts/ai/ai-host.cjs` on the CPU and on the Vulkan
 * backend, with the pinned Vulkan pack imported into a scratch backends root by the launcher and the
 * pinned Qwen3.5-0.8B.
 *
 * Two kinds of evidence, never mixed:
 *  - PRODUCT: the product's own E2 answer for this machine's adapters, and what each mode does with it.
 *  - MECHANICS: the real Vulkan host driven with eligibility SUBSTITUTED (the manager, the pack guard,
 *    the loader hook, the runtime's plan, an offloaded load and inference, the service's GPU paths). On
 *    a non-NVIDIA adapter this proves the machinery only. It is not NVIDIA qualification (E11).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AiUtilityHostManager } from "@main/ai/AiUtilityHostManager";
import { displayAdapterVendorIds, gpuReadiness } from "@main/ai/gpuAdapters";
import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AiBackendPackStore } from "@src/ai/AiBackendPack";
import { classifyAdapters, describeAdapters, type AiGpuReadiness } from "@src/ai/AiExecutionProfile";
import type { AiOutputSchema } from "@src/ai/AiOutputContract";
import { AiService, type AiJobRequest, type AiServiceSettings } from "@src/ai/AiService";
import {
  AI_HOST_PROTOCOL_VERSION,
  AI_MAX_VRAM_RESERVE_BYTES,
  AiHostCallError,
  type AiGpuPlan,
  type AiHostHello,
  type AiInferResult,
  type AiLoadResult
} from "@src/ai/contracts/AiHostProtocol";
import { AI_BACKEND_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";

import { establishFreshHost, expectOneGuardedFork, HostTeardown, withHostTeardown } from "./gpuHostLifecycle";

type Step = <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;

const IDLE: AiAdmissionView = { activeRuns: 0, queuedRuns: 0, pressureState: "stable", dispatchBlocked: false, activeWeight: 0, weightedBudget: 100, freeMemoryMb: 1_000_000 };
const SMALL: AiOutputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
const HELLO = { type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } } as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** The DLLs a process has loaded, from Windows itself (the L8a.0 loader-proof method). */
function modulesOf(pid: number): string[] {
  const out = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).Modules | ForEach-Object { $_.FileName }`], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000
  });
  return String(out.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const inside = (base: string, file: string): boolean => {
  const rel = path.relative(base.toLowerCase(), file.toLowerCase());
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

type Context = { step: Step; record: (key: string, value: unknown) => void; log: (line: string) => void };

/** Every host this run starts is torn down before the harness exits, after an early return too. */
export async function runGpuLive(context: Context): Promise<void> {
  const hosts = new HostTeardown();
  await withHostTeardown(context.step, hosts, () => gpuLiveSteps(context, hosts));
}

async function gpuLiveSteps({ step, record, log }: Context, hosts: HostTeardown): Promise<void> {
  const hostPath = required("AWKIT_HARNESS_HOST_PATH");
  const modelRoot = required("AWKIT_HARNESS_MODEL_ROOT");
  const modelPath = required("AWKIT_HARNESS_MODEL_PATH");
  const modelId = required("AWKIT_HARNESS_MODEL_ID");
  const backendsRoot = required("AWKIT_HARNESS_BACKENDS_ROOT");
  const threads = Number(required("AWKIT_HARNESS_THREADS"));
  const build = AI_RUNTIME_PIN.build!;
  const entry = AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan") ?? null;
  const logger = (level: string, message: string) => log(`${level}: ${message}`);

  // The production store over the launcher's import; verify-only, so its trust input is never consulted.
  const store = new AiBackendPackStore({
    root: backendsRoot,
    entry,
    runtimeBuild: build,
    trust: async () => ({ ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: "verify only" })
  });
  let verifications = 0;
  const cpu = hosts.track(new AiUtilityHostManager({ hostPath, modelRoot, log: logger }));
  const gpu = hosts.track(new AiUtilityHostManager({
    hostPath,
    modelRoot,
    backend: {
      kind: "vulkan",
      // Exactly what aiRuntime wires: the L8a.2 load-time guard before every GPU host fork.
      verify: async () => {
        verifications += 1;
        const verdict = await store.verifyForLoad();
        return verdict.ok ? { ok: true, dir: verdict.dir } : { ok: false };
      }
    },
    log: logger
  }));
  const reasonOf = (error: unknown) => (error instanceof AiHostCallError ? error.reason : String((error as Error)?.message ?? error));
  const expectReason = (label: string, fn: () => Promise<unknown>, reason: string) =>
    step(label, async () => {
      try {
        await fn();
      } catch (error) {
        if (reasonOf(error) === reason) return { reason };
        throw new Error(`expected ${reason}, got ${reasonOf(error)}`);
      }
      throw new Error(`expected ${reason}, but the call succeeded`);
    });

  const packDir = await step("(precondition) the imported pack passes the load-time guard", async () => {
    const verdict = await store.verifyForLoad();
    if (!verdict.ok) throw new Error(`${verdict.reason} ${verdict.path ?? ""}`);
    return verdict.dir;
  });
  if (!packDir) return;

  // ── CPU & RAM only is unchanged ─────────────────────────────────────────────────────────────
  await step("the CPU host reports the CPU backend and is compatible", async () => {
    const hello = await cpu.call<AiHostHello>(HELLO, 15_000);
    if (!hello.compatible || hello.backend !== "cpu" || hello.runtime.build !== build) throw new Error(JSON.stringify(hello));
    return { backend: hello.backend, build: hello.runtime.build };
  });
  await expectReason("the CPU host refuses a GPU plan", () => cpu.call({ type: "gpuPlan", modelPath, contextTokens: 4096, threads, reserveBytes: null }, 30_000), "AI_PROTOCOL_VIOLATION");
  await expectReason("the CPU host refuses offloaded layers", () => cpu.call({ type: "load", modelPath, contextTokens: 4096, threads, gpuLayers: 3 }, 30_000), "AI_PROTOCOL_VIOLATION");

  // ── PRODUCT: E2 on this machine ─────────────────────────────────────────────────────────────
  const vendorIds = await displayAdapterVendorIds();
  record("adapters", describeAdapters(vendorIds));
  const readiness = await gpuReadiness(store);
  record("productReadiness", readiness);
  await step("Chromium lists this machine's display adapters by PCI vendor ID", () => {
    if (vendorIds === null || vendorIds.length === 0) throw new Error("no adapter list");
    return { adapters: describeAdapters(vendorIds), classification: classifyAdapters(vendorIds) };
  });
  await step("the product's readiness is the pack's status followed by E2 on those IDs", () => {
    const expected = classifyAdapters(vendorIds);
    if (JSON.stringify(readiness) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(readiness)} vs ${JSON.stringify(expected)}`);
    return readiness;
  });

  const settings: AiServiceSettings = { enabled: true, yieldDuringRuns: false, idleUnloadMs: 0, minFreeMemoryMb: 0, executionMode: "gpu-offload", vramReserveBytes: null };
  const makeService = (readinessFor: () => Promise<AiGpuReadiness>) =>
    new AiService({
      transport: (backend) => (backend === "cpu" ? cpu : gpu),
      gpu: readinessFor,
      model: async () => ({ ok: true, modelId, modelPath, contextTokens: 4096 }),
      verifyModel: async () => true,
      settings: async () => settings,
      admission: () => IDLE,
      threads,
      expectedRuntimeBuild: build,
      log: logger
    });
  let jobs = 0;
  const job = (): AiJobRequest => ({
    requestId: `gpu-live-${++jobs}`,
    feature: "locatorSemanticUpgrade",
    priority: "interactive",
    prompt: { instructions: "Answer with ok set to true.", fields: [{ name: "element", text: "Save" }], maxDataChars: 500 },
    schema: SMALL,
    maxOutputTokens: 16,
    timeoutMs: 180_000
  });

  const product = makeService(() => gpuReadiness(store));
  await step(`PRODUCT GPU-Offload on this machine (${readiness.ok ? "eligible" : readiness.reason})`, async () => {
    const outcome = await product.submit(job());
    const execution = (await product.status()).execution;
    if (outcome.status !== "ok") throw new Error(JSON.stringify(outcome));
    if (readiness.ok ? execution.backend !== "vulkan" : execution.backend !== "cpu" || execution.fallbackReason !== readiness.reason) throw new Error(JSON.stringify(execution));
    if (!readiness.ok && (verifications !== 0 || gpu.status().pid !== null)) throw new Error("an ineligible machine started the GPU host");
    return execution;
  });
  settings.executionMode = "gpu-only";
  await step(`PRODUCT GPU-Only on this machine (${readiness.ok ? "eligible" : "refused"})`, async () => {
    const outcome = await product.submit(job());
    const execution = (await product.status()).execution;
    if (readiness.ok ? outcome.status !== "ok" : outcome.status !== "rejected" || execution.refusal?.reason !== readiness.reason) {
      throw new Error(JSON.stringify({ outcome, execution }));
    }
    return { outcome: outcome.status, execution };
  });

  // ── MECHANICS: the real Vulkan host (eligibility substituted) ───────────────────────────────
  // On an eligible machine the PRODUCT steps left the GPU host running on this manager, and a hello
  // would reuse it: no fork, so no guard run to observe. Stop it with the manager's intentional release
  // first, as below before the service's GPU paths; the guard assertion itself is unchanged.
  await step("(precondition) MECHANICS starts with no GPU host running, so its first call must fork", () => establishFreshHost(gpu));
  const hello = await step("MECHANICS the GPU host starts only after the pack guard, and reports Vulkan", async () => {
    const value = await expectOneGuardedFork(gpu, () => verifications, () => gpu.call<AiHostHello>(HELLO, 15_000));
    if (!value.compatible || value.backend !== "vulkan" || value.runtime.build !== build) throw new Error(JSON.stringify(value));
    return value;
  });
  if (!hello) return;
  const plan = await step("MECHANICS the runtime plans the offload on this adapter", async () => {
    const value = await gpu.call<AiGpuPlan>({ type: "gpuPlan", modelPath, contextTokens: 4096, threads, reserveBytes: null }, 120_000);
    if (!(value.deviceCount >= 1 && value.totalLayers >= 1 && value.fitLayers >= 0 && value.fitLayers <= value.totalLayers && value.freeBytes > 0 && value.totalBytes >= value.freeBytes)) {
      throw new Error(JSON.stringify(value));
    }
    return value;
  });
  record("plan", plan ?? null);
  if (!plan) return;
  await step("MECHANICS a reserve larger than the adapter fits no layer", async () => {
    const value = await gpu.call<AiGpuPlan>({ type: "gpuPlan", modelPath, contextTokens: 4096, threads, reserveBytes: AI_MAX_VRAM_RESERVE_BYTES }, 120_000);
    if (value.fitLayers !== 0) throw new Error(JSON.stringify(value));
    return { fitLayers: value.fitLayers, reserveBytes: value.reserveBytes };
  });
  const layers = Math.max(1, plan.fitLayers);
  const loaded = await step(`MECHANICS the model loads with ${layers} of ${plan.totalLayers} layers on the GPU`, async () => {
    const value = await gpu.call<AiLoadResult>({ type: "load", modelPath, contextTokens: 4096, threads, gpuLayers: layers }, 180_000);
    if (value.backend !== "vulkan" || !(Number(value.gpuLayers) >= 1)) throw new Error(JSON.stringify(value));
    return value;
  });
  record("load", loaded ?? null);
  await step("MECHANICS every GPU binary in the host comes from the app-managed pack", () => {
    const pid = gpu.status().pid;
    if (!pid) throw new Error("no GPU host");
    const modules = modulesOf(pid);
    // Every llama.cpp / ggml binary in this process: the addon, the backends, the CPU variants.
    const runtimeBinaries = modules.filter((file) => /\\(ggml[^\\]*\.dll|llama[^\\]*\.dll|llama-addon\.node)$/i.test(file));
    const outside = runtimeBinaries.filter((file) => !inside(packDir, file));
    if (!runtimeBinaries.some((file) => /ggml-vulkan\.dll$/i.test(file) && inside(packDir, file))) throw new Error(`ggml-vulkan.dll not loaded from the pack: ${runtimeBinaries.join("; ")}`);
    if (outside.length > 0) throw new Error(`loaded from outside the pack: ${outside.join("; ")}`);
    return { fromPack: runtimeBinaries.map((file) => path.basename(file)) };
  });
  await step("MECHANICS an offloaded inference answers inside the schema", async () => {
    const result = await gpu.call<AiInferResult>(
      { type: "infer", jobId: "gpu-raw#1", system: "Answer in the required JSON.", user: "Is Save a button? Answer ok true.", jsonSchema: SMALL as unknown as Record<string, unknown>, maxPromptTokens: 512, maxOutputTokens: 16, thinking: false, temperature: 0, seed: 0 },
      120_000
    );
    JSON.parse(result.text.trim());
    return { stopReason: result.stopReason, timings: result.timings };
  });
  await gpu.release();

  const substituted = makeService(async () => ({ ok: true, nvidiaAdapters: plan.deviceCount }));
  settings.executionMode = "gpu-offload";
  settings.vramReserveBytes = null;
  await step("MECHANICS the service's GPU-Offload loads on the Vulkan host", async () => {
    const outcome = await substituted.submit(job());
    const execution = (await substituted.status()).execution;
    if (outcome.status !== "ok" || execution.backend !== "vulkan" || !(execution.gpuLayers >= 1)) throw new Error(JSON.stringify({ outcome, execution }));
    return execution;
  });
  settings.executionMode = "gpu-only";
  settings.vramReserveBytes = AI_MAX_VRAM_RESERVE_BYTES;
  await step("MECHANICS GPU-Only refuses with the real shortfall and stops the GPU host", async () => {
    const outcome = await substituted.submit(job());
    const execution = (await substituted.status()).execution;
    const refusal = execution.refusal;
    if (outcome.status !== "rejected" || refusal?.reason !== "INSUFFICIENT_VRAM" || !(Number(refusal.requiredBytes) > Number(refusal.availableBytes))) throw new Error(JSON.stringify({ outcome, execution }));
    if (gpu.status().pid !== null) throw new Error("the GPU host still holds VRAM after the refusal");
    return refusal;
  });
  settings.executionMode = "gpu-offload";
  await step("MECHANICS GPU-Offload with nothing fitting runs on the CPU with the reason", async () => {
    const outcome = await substituted.submit(job());
    const execution = (await substituted.status()).execution;
    if (outcome.status !== "ok" || execution.backend !== "cpu" || execution.fallbackReason !== "INSUFFICIENT_VRAM") throw new Error(JSON.stringify({ outcome, execution }));
    return execution;
  });
  settings.executionMode = "cpu";
  settings.vramReserveBytes = null;
  await step("CPU & RAM only after the GPU modes: the CPU host answers, the GPU host stays down", async () => {
    const outcome = await substituted.submit(job());
    const execution = (await substituted.status()).execution;
    if (outcome.status !== "ok" || execution.backend !== "cpu" || execution.mode !== "cpu" || gpu.status().pid !== null) throw new Error(JSON.stringify({ outcome, execution, pid: gpu.status().pid }));
    return execution;
  });

  // ── A pack altered after import never starts a GPU host ─────────────────────────────────────
  const license = path.join(packDir, "LICENSE");
  const bytes = fs.readFileSync(license);
  bytes[0] ^= 0xff;
  fs.writeFileSync(license, bytes);
  await expectReason("a pack altered after import is refused before any GPU host starts", () => gpu.call(HELLO, 15_000), "AI_GPU_BACKEND_REFUSED");
  await step("...and no GPU host process exists", () => {
    const status = gpu.status();
    if (status.pid !== null || status.unexpectedExits !== 0 || status.circuitOpen) throw new Error(JSON.stringify(status));
    return status;
  });

  await substituted.shutdown();
  await product.shutdown();
  record("guardRuns", verifications);
}
