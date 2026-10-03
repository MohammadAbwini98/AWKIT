/**
 * The live quality modes' execution arm (`AWKIT_HARNESS_EXECUTION`, set by `verify-ai-explanation-live.mts
 * --execution`): where each model call of a run actually ran, so a quality run on the GPU can be compared with
 * the qualified CPU & RAM one under the same labelled sets and judges (L8a, the curated Qwen3.5-0.8B).
 *
 *  - unset: the qualified CPU & RAM path, exactly as before, and nothing is recorded.
 *  - "cpu": the same CPU & RAM path (no execution mode stored, as the qualified evidence ran), every call recorded.
 *  - "auto": the service wired as Settings wires Automatic, the default: the stored mode `auto`, the product's own
 *    readiness over the pinned Vulkan pack the launcher imported (AWKIT_HARNESS_BACKENDS_ROOT), and a Vulkan host
 *    behind the L8a.2 pack guard. Automatic resolves at each load; nothing here decides where a call runs.
 *
 * Recorded per call (`execution` in the report): the stored mode, the readiness answers, the resolved mode,
 * backend and layers from the service, the answer's own profile, the job's stages from the production job
 * tracker, and its timings and token counts. Per GPU plan: the Vulkan devices the runtime binds and their VRAM. nvidia-smi is read after a call without waiting for it, so no
 * reading is ever inside a measured duration. Counts, codes and timings only, never model text.
 */

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AiUtilityHostManager } from "@main/ai/AiUtilityHostManager";
import { gpuReadiness } from "@main/ai/gpuAdapters";
import { AiBackendPackStore } from "@src/ai/AiBackendPack";
import type { AiGpuReadiness } from "@src/ai/AiExecutionProfile";
import type { AiGpuPlan } from "@src/ai/contracts/AiHostProtocol";
import { AiJobTracker, type AiJobStatus } from "@src/ai/AiJobStatus";
import type { AiService } from "@src/ai/AiService";
import { AI_BACKEND_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";

export type LiveExecution = "cpu" | "auto";

export function liveExecution(env: NodeJS.ProcessEnv = process.env): LiveExecution | null {
  const value = env.AWKIT_HARNESS_EXECUTION;
  return value === "cpu" || value === "auto" ? value : null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** VRAM in use on every NVIDIA GPU (MiB, summed), read without blocking; null where nvidia-smi gives none. */
function vramUsedMib(): Promise<number | null> {
  const smi = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "nvidia-smi.exe");
  if (!fs.existsSync(smi)) return Promise.resolve(null);
  return new Promise((resolve) =>
    execFile(smi, ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 60_000 }, (error, stdout) => {
      const rows = String(stdout ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map(Number);
      resolve(!error && rows.length > 0 && rows.every(Number.isFinite) ? rows.reduce((sum, value) => sum + value, 0) : null);
    })
  );
}

/** The Vulkan host and the product's readiness over the launcher's imported pack, as aiRuntime wires them. */
export function makeLiveGpu(log: (level: "error" | "warn" | "info", message: string) => void) {
  const entry = AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan") ?? null;
  // Verify-only: the launcher imported the pack through the real trust chain; this store only reads it back.
  const store = new AiBackendPackStore({
    root: required("AWKIT_HARNESS_BACKENDS_ROOT"),
    entry,
    runtimeBuild: AI_RUNTIME_PIN.build!,
    trust: async () => ({ ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: "verify only" })
  });
  let guardRuns = 0;
  const manager = new AiUtilityHostManager({
    hostPath: required("AWKIT_HARNESS_HOST_PATH"),
    modelRoot: required("AWKIT_HARNESS_MODEL_ROOT"),
    backend: {
      kind: "vulkan",
      // The L8a.2 load-time guard before every GPU host fork.
      verify: async () => {
        guardRuns += 1;
        const verdict = await store.verifyForLoad();
        return verdict.ok ? { ok: true, dir: verdict.dir } : { ok: false };
      }
    },
    log
  });
  // The runtime's own answer to each GPU plan: the Vulkan devices it binds and their VRAM. Readiness counts Chromium's
  // adapter list, which names one NVIDIA GPU twice under Remote Desktop, so verify:ai-gpu-quality checks this count
  // against Windows' NVIDIA PCI adapters instead. The service's request and the host's answer are unchanged.
  const plans: Array<{ deviceCount: number; totalBytes: number }> = [];
  const call = manager.call.bind(manager);
  manager.call = (async (request, timeoutMs, onProgress) => {
    const answer = await call(request, timeoutMs, onProgress);
    if (request.type === "gpuPlan") {
      const plan = answer as AiGpuPlan;
      plans.push({ deviceCount: plan.deviceCount, totalBytes: plan.totalBytes });
    }
    return answer;
  }) as typeof manager.call;
  return { manager, readiness: (): Promise<AiGpuReadiness> => gpuReadiness(store), guardRuns: () => guardRuns, plans: () => [...plans] };
}
export type LiveGpu = ReturnType<typeof makeLiveGpu>;

/** One record for the whole run, whatever number of services the mode makes. */
export class ExecutionLog {
  private readonly statuses: AiJobStatus[] = [];
  readonly jobs = new AiJobTracker({ publish: (_owner, status) => this.statuses.push(status) });
  private readonly readiness: AiGpuReadiness[] = [];
  private readonly calls: Array<Record<string, unknown>> = [];
  private readonly vram: Array<{ afterCall: number; mib: number | null }> = [];
  private readonly gpus: LiveGpu[] = [];
  private readonly pids = new Set<number>();

  constructor(
    private readonly configured: LiveExecution,
    private readonly record: (key: string, value: unknown) => void
  ) {}

  /** The readiness answer for a GPU, counted as one resolution of Automatic. */
  readinessOf(gpu: LiveGpu): () => Promise<AiGpuReadiness> {
    if (!this.gpus.includes(gpu)) this.gpus.push(gpu);
    return async () => {
      const answer = await gpu.readiness();
      this.readiness.push(answer);
      this.publish();
      return answer;
    };
  }

  /** Every call through `service.submit` is recorded after it settles. The request the model sees is unchanged. */
  observe(service: AiService, gpu?: LiveGpu): void {
    const submit = service.submit.bind(service);
    service.submit = async (request) => {
      // The tracker publishes a job's stages only to an owner. The product's IPC names one; these direct calls do not.
      const tracked = request.owner ? request : { ...request, owner: { window: 0, requestId: request.requestId } };
      const started = Date.now();
      const outcome = await submit(tracked);
      const wallMs = Date.now() - started;
      const { execution } = await service.status();
      const pid = gpu?.manager.status().pid ?? null;
      if (pid !== null) this.pids.add(pid);
      const mine = this.statuses.filter((s) => s.jobId === tracked.owner!.requestId);
      const last = mine.at(-1);
      const stages = mine.reduce<Array<{ stage: string; atMs: number }>>((list, s) => (list[list.length - 1]?.stage === s.stage ? list : [...list, { stage: s.stage, atMs: s.elapsedMs }]), []);
      const ok = outcome.status === "ok" ? outcome : null;
      this.calls.push({
        requestId: request.requestId,
        feature: request.feature,
        status: outcome.status,
        code: "code" in outcome ? outcome.code : null,
        resolved: execution.mode,
        executionBackend: execution.backend,
        layers: `${execution.gpuLayers} of ${execution.totalLayers ?? "?"}`,
        fallbackReason: execution.fallbackReason,
        refusal: execution.refusal?.reason ?? null,
        answerProfile: ok ? ok.profile : null,
        jobProfile: last?.profile ?? null,
        cold: last?.cold ?? null,
        stages,
        wallMs,
        firstTokenMs: ok?.usage.firstTokenMs ?? null,
        generationMs: ok?.usage.generationMs ?? null,
        promptTokens: ok?.usage.promptTokens ?? null,
        outputTokens: ok?.usage.outputTokens ?? null,
        maxOutputTokens: request.maxOutputTokens,
        gpuHostPid: pid
      });
      this.publish();
      if (gpu) {
        const afterCall = this.calls.length;
        void vramUsedMib().then((mib) => {
          this.vram.push({ afterCall, mib });
          this.publish();
        });
      }
      return outcome;
    };
  }

  private publish(): void {
    this.record("execution", {
      configured: this.configured,
      readiness: this.readiness,
      guardRuns: this.gpus.reduce((n, gpu) => n + gpu.guardRuns(), 0),
      gpuPlans: this.gpus.flatMap((gpu) => gpu.plans()),
      gpuHostPids: [...this.pids],
      vramMibAfterCalls: this.vram,
      calls: this.calls
    });
  }
}
