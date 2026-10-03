/**
 * L8a.5 live mode (AWKIT_HARNESS_MODE=gpuLifecycle): what a GPU load costs and survives on the REAL
 * Vulkan host, through the production `AiUtilityHostManager` (with the L8a.2 pack guard before every
 * fork) and the pinned Qwen3.5-0.8B.
 *
 * MECHANICS only: eligibility is never consulted, so on a non-NVIDIA adapter these numbers prove the
 * machinery and qualify nothing (E11).
 *  - Per placement: every layer (what GPU-Only loads) and half the layers (a GPU-Offload partial load).
 *    Each gets a cold fork, handshake and load, and cancel latency against the L1.8 3 s ceiling, during
 *    prompt processing and during generation. It also gets the host killed from outside and brought
 *    back: the exit seen, a re-fork through the pack guard, the handshake and the reload.
 *  - Exhaustion: a loaded host keeps inferring while other GPU hosts take the adapter's VRAM. The
 *    harness records what the runtime and the host do (an error, an exit, or only time), what a fresh
 *    plan and load see under that pressure, and whether the host recovers once the VRAM is back.
 *    Observations, not verdicts: the launcher decides what they mean.
 *
 * PRODUCT, its own mode (AWKIT_HARNESS_MODE=gpuAutoLifecycle, `runGpuAutomaticLifecycle`), so each run fits the
 * 600 s tool ceiling: Automatic's lifecycle through the production `AiService`, with the stored mode `auto` and the
 * product's own readiness (`automaticLifecycle` below). Only its labelled not-ready leg substitutes the readiness
 * answer. On a machine whose readiness does not prove NVIDIA, Automatic runs as CPU & RAM only, only that
 * resolution is checked, and the GPU lifecycle is recorded as NOT RUN.
 */

import { AiUtilityHostManager } from "@main/ai/AiUtilityHostManager";
import { displayAdapterVendorIds, gpuReadiness } from "@main/ai/gpuAdapters";
import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AiBackendPackStore } from "@src/ai/AiBackendPack";
import { describeAdapters, type AiGpuReadiness } from "@src/ai/AiExecutionProfile";
import { AiJobTracker, type AiJobStage, type AiJobStatus } from "@src/ai/AiJobStatus";
import type { AiOutputSchema } from "@src/ai/AiOutputContract";
import { AiService, type AiJobRequest, type AiServiceSettings } from "@src/ai/AiService";
import {
  AI_HOST_PROTOCOL_VERSION,
  AiHostCallError,
  type AiGpuPlan,
  type AiInferResult,
  type AiLoadResult
} from "@src/ai/contracts/AiHostProtocol";
import { AI_BACKEND_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";

import { built, cancelJob, prose, SYNTHETIC_FAILURE } from "./bench";
import { establishFreshHost, HostTeardown, withHostTeardown } from "./gpuHostLifecycle";
import { nvidiaVramUsedMib, vramBelow } from "./gpuLive";

type Step = <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;

const HELLO = { type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } } as const;
const SMALL: AiOutputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
/** Filler hosts are started until one cannot load every layer, or this many are running. */
const MAX_FILLERS = 6;
const IDLE: AiAdmissionView = { activeRuns: 0, queuedRuns: 0, pressureState: "stable", dispatchBlocked: false, activeWeight: 0, weightedBudget: 100, freeMemoryMb: 1_000_000 };
/** L1.8: a cancel settles within 3 s, on every backend. */
const CANCEL_CEILING_MS = 3_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const reasonOf = (error: unknown): string => (error instanceof AiHostCallError ? error.reason : String((error as Error)?.message ?? error));

async function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await sleep(10);
  }
  return true;
}

type Context = { step: Step; record: (key: string, value: unknown) => void; log: (line: string) => void };

/**
 * Every host this run starts (killed, restarted, fillers included) has left Windows before the harness
 * exits: the launcher deletes the pack those hosts mapped as soon as Electron is gone.
 */
export async function runGpuLifecycle(context: Context): Promise<void> {
  const hosts = new HostTeardown();
  await withHostTeardown(context.step, hosts, () => lifecycleSteps(context, hosts));
}

async function lifecycleSteps({ step, record, log }: Context, hosts: HostTeardown): Promise<void> {
  const hostPath = required("AWKIT_HARNESS_HOST_PATH");
  const modelRoot = required("AWKIT_HARNESS_MODEL_ROOT");
  const modelPath = required("AWKIT_HARNESS_MODEL_PATH");
  const backendsRoot = required("AWKIT_HARNESS_BACKENDS_ROOT");
  const threads = Number(required("AWKIT_HARNESS_THREADS"));
  const logger = (level: string, message: string) => log(`${level}: ${message}`);
  const store = new AiBackendPackStore({
    root: backendsRoot,
    entry: AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan") ?? null,
    runtimeBuild: AI_RUNTIME_PIN.build!,
    trust: async () => ({ ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: "verify only" })
  });
  const makeGpu = () =>
    hosts.track(
      new AiUtilityHostManager({
        hostPath,
        modelRoot,
        backend: {
          kind: "vulkan",
          verify: async () => {
            const verdict = await store.verifyForLoad();
            return verdict.ok ? { ok: true, dir: verdict.dir } : { ok: false };
          }
        },
        log: logger
      })
    );
  let jobs = 0;
  const nextJob = () => `gpu-life-${++jobs}#1`;
  const load = (manager: AiUtilityHostManager, gpuLayers: number) =>
    manager.call<AiLoadResult>({ type: "load", modelPath, contextTokens: 4096, threads, gpuLayers }, 180_000);
  const infer = (manager: AiUtilityHostManager, jobId: string, packet: { system: string; user: string }, schema: AiOutputSchema, maxOutputTokens: number) =>
    manager.call<AiInferResult>(
      { type: "infer", jobId, system: packet.system, user: packet.user, jsonSchema: schema as unknown as Record<string, unknown>, maxPromptTokens: 3072, maxOutputTokens, thinking: false, temperature: 0, seed: 0 },
      240_000
    );
  const vendorIds = await displayAdapterVendorIds();
  record("adapters", vendorIds === null ? null : describeAdapters(vendorIds));
  const longPrompt = built(SYNTHETIC_FAILURE.spec);
  const shortPrompt = built({ instructions: "Answer with ok set to true.", fields: [{ name: "run", text: prose(300, 41) }], maxDataChars: 9_000 });

  const plan = await step("the runtime plans the offload on this adapter", async () => {
    const planner = makeGpu();
    try {
      await planner.call(HELLO, 15_000);
      return await planner.call<AiGpuPlan>({ type: "gpuPlan", modelPath, contextTokens: 4096, threads, reserveBytes: null }, 120_000);
    } finally {
      await planner.dispose();
    }
  });
  record("plan", plan ?? null);
  if (!plan || plan.fitLayers < 2) return;

  const placements = [
    { key: "full", name: `every layer (${plan.fitLayers >= plan.totalLayers ? plan.totalLayers : plan.fitLayers} of ${plan.totalLayers})`, layers: Math.min(plan.totalLayers, plan.fitLayers) },
    { key: "partial", name: `a partial load (${Math.floor(plan.fitLayers / 2)} of ${plan.totalLayers})`, layers: Math.floor(plan.fitLayers / 2) }
  ];
  const measured: Record<string, unknown> = {};
  for (const placement of placements) {
    const result: Record<string, unknown> = { layers: placement.layers };
    measured[placement.key] = result;

    result.cold = await step(`${placement.name}: cold fork, handshake and load`, async () => {
      const runs = [];
      for (let i = 0; i < 2; i += 1) {
        const manager = makeGpu();
        try {
          const forked = Date.now();
          await manager.call(HELLO, 15_000);
          const helloAt = Date.now();
          const loaded = await load(manager, placement.layers);
          const loadedAt = Date.now();
          await manager.release();
          runs.push({ forkAndHelloMs: helloAt - forked, loadWallMs: loadedAt - helloAt, hostLoadMs: loaded.loadMs, gpuLayers: loaded.gpuLayers, releaseMs: Date.now() - loadedAt });
        } finally {
          await manager.dispose();
        }
      }
      return { runs };
    });

    // The prompt's own timing on this placement decides when each cancel lands: a GPU evaluates a long
    // prompt far faster than the CPU the L1.8 bench waited 1 s for.
    const baseline = await step(`${placement.name}: the long prompt's timing (no cancel)`, async () => {
      const manager = makeGpu();
      try {
        await load(manager, placement.layers);
        const answer = await infer(manager, nextJob(), longPrompt, SYNTHETIC_FAILURE.schema, 256);
        return { promptTokens: answer.promptTokens, outputTokens: answer.outputTokens, stopReason: answer.stopReason, ...answer.timings };
      } finally {
        await manager.dispose();
      }
    });
    result.baseline = baseline ?? null;
    if (!baseline) continue;

    const measureCancel = (phase: "prompt" | "generation", cancelAfterMs: number) =>
      step(`${placement.name}: cancel during ${phase === "prompt" ? "prompt processing" : "generation"}`, async () => {
        const manager = makeGpu();
        try {
          await load(manager, placement.layers);
          const jobId = nextJob();
          const pending = infer(manager, jobId, longPrompt, SYNTHETIC_FAILURE.schema, 256).then(
            (answer) => answer,
            (error: unknown) => error
          );
          await sleep(cancelAfterMs);
          const cancelledAt = Date.now();
          const killed = await cancelJob(manager, jobId);
          const answer = await pending;
          const latencyMs = Date.now() - cancelledAt;
          if (killed) {
            if (!(answer instanceof AiHostCallError && answer.reason === "AI_HOST_KILLED_ON_CANCEL")) throw new Error("the host was killed but the inference did not report it");
            return { latencyMs, cancelAfterMs, settledBy: "kill" };
          }
          if (answer instanceof Error) throw answer;
          const settled = answer as AiInferResult;
          return { latencyMs, cancelAfterMs, settledBy: settled.stopReason === "cancelled" ? "host" : `finished (${settled.stopReason})`, outputTokens: settled.outputTokens };
        } finally {
          await manager.dispose();
        }
      });
    result.cancelDuringPrompt = await measureCancel("prompt", Math.max(10, Math.floor(baseline.firstTokenMs * 0.4)));
    result.cancelDuringGeneration = await measureCancel("generation", baseline.firstTokenMs + Math.max(50, Math.floor(baseline.generationMs * 0.3)));

    result.killRestartReload = await step(`${placement.name}: killed from outside, then back with the model loaded`, async () => {
      const manager = makeGpu();
      try {
        await load(manager, placement.layers);
        const pid = manager.status().pid;
        if (!pid) throw new Error("no GPU host");
        const killedAt = Date.now();
        process.kill(pid);
        if (!(await until(() => manager.status().pid === null, 10_000))) throw new Error("the manager never saw the exit");
        const exitSeenMs = Date.now() - killedAt;
        const restartedAt = Date.now();
        await manager.call(HELLO, 15_000);
        const restartMs = Date.now() - restartedAt;
        const reloadedAt = Date.now();
        const reloaded = await load(manager, placement.layers);
        const reloadMs = Date.now() - reloadedAt;
        const status = manager.status();
        return { exitSeenMs, restartMs, reloadMs, hostLoadMs: reloaded.loadMs, gpuLayers: reloaded.gpuLayers, totalMs: Date.now() - killedAt, strikes: status.unexpectedExits, circuitOpen: status.circuitOpen };
      } finally {
        await manager.dispose();
      }
    });
  }
  record("placements", measured);

  // ── Exhaustion: other GPU processes take the VRAM after this host has loaded ──────────────────
  const exhaustion: Record<string, unknown> = {};
  const probe = makeGpu();
  const fillers: AiUtilityHostManager[] = [];
  try {
    exhaustion.probeLoaded = await step("EXHAUSTION the probe host loads every layer it can and answers", async () => {
      await probe.call(HELLO, 15_000);
      const loaded = await load(probe, placements[0].layers);
      const answer = await infer(probe, nextJob(), shortPrompt, SMALL, 16);
      return { gpuLayers: loaded.gpuLayers, stopReason: answer.stopReason, ...answer.timings };
    });
    if (!exhaustion.probeLoaded) return;

    const taken: unknown[] = [];
    for (let k = 1; k <= MAX_FILLERS; k += 1) {
      const filler = makeGpu();
      fillers.push(filler);
      const observed = await step(`EXHAUSTION filler host ${k} takes VRAM`, async () => {
        await filler.call(HELLO, 15_000);
        const before = await filler.call<AiGpuPlan>({ type: "gpuPlan", modelPath, contextTokens: 4096, threads, reserveBytes: 0 }, 120_000);
        let loaded: Record<string, unknown>;
        try {
          const value = await load(filler, before.totalLayers);
          loaded = { ok: true, gpuLayers: value.gpuLayers };
        } catch (error) {
          loaded = { ok: false, reason: reasonOf(error) };
        }
        return { freeBytesBefore: before.freeBytes, totalBytes: before.totalBytes, fitLayersBefore: before.fitLayers, load: loaded, status: filler.status() };
      });
      taken.push(observed ?? null);
      if (!observed || observed.load.ok !== true) break;
    }
    exhaustion.fillers = taken;

    const inferUnderPressure = (label: string, packet: { system: string; user: string }, schema: AiOutputSchema, maxOutputTokens: number) =>
      step(label, async () => {
        const started = Date.now();
        let outcome: Record<string, unknown>;
        try {
          const answer = await infer(probe, nextJob(), packet, schema, maxOutputTokens);
          outcome = { ok: true, stopReason: answer.stopReason, ...answer.timings };
        } catch (error) {
          outcome = { ok: false, reason: reasonOf(error) };
        }
        return { ...outcome, wallMs: Date.now() - started, probe: probe.status() };
      });
    exhaustion.shortUnderPressure = await inferUnderPressure("EXHAUSTION the probe host answers a short prompt with the VRAM taken", shortPrompt, SMALL, 16);
    exhaustion.longUnderPressure = await inferUnderPressure("EXHAUSTION the probe host answers the long prompt with the VRAM taken", longPrompt, SYNTHETIC_FAILURE.schema, 256);

    exhaustion.freshLoadUnderPressure = await step("EXHAUSTION a fresh GPU host plans and loads under that pressure", async () => {
      const fresh = makeGpu();
      try {
        await fresh.call(HELLO, 15_000);
        const planned = await fresh.call<AiGpuPlan>({ type: "gpuPlan", modelPath, contextTokens: 4096, threads, reserveBytes: null }, 120_000);
        let loaded: Record<string, unknown>;
        try {
          const value = await load(fresh, planned.totalLayers);
          loaded = { ok: true, gpuLayers: value.gpuLayers };
        } catch (error) {
          loaded = { ok: false, reason: reasonOf(error) };
        }
        return { freeBytes: planned.freeBytes, fitLayers: planned.fitLayers, fullRequiredBytes: planned.fullRequiredBytes, loadEveryLayer: loaded, status: fresh.status() };
      } finally {
        await fresh.dispose();
      }
    });

    await Promise.all(fillers.splice(0).map((filler) => filler.dispose()));
    exhaustion.recovered = await inferUnderPressure("EXHAUSTION the probe host answers once the VRAM is back", shortPrompt, SMALL, 16);
  } finally {
    await Promise.all(fillers.map((filler) => filler.dispose()));
    await probe.dispose();
    record("exhaustion", exhaustion);
  }
}

// ── PRODUCT: Automatic's lifecycle ────────────────────────────────────────────────────────────────

/** AWKIT_HARNESS_MODE=gpuAutoLifecycle: every host it starts has left Windows before the harness exits. */
export async function runGpuAutomaticLifecycle({ step, record, log }: Context): Promise<void> {
  const hosts = new HostTeardown();
  const logger = (level: string, message: string) => log(`${level}: ${message}`);
  const store = new AiBackendPackStore({
    root: required("AWKIT_HARNESS_BACKENDS_ROOT"),
    entry: AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan") ?? null,
    runtimeBuild: AI_RUNTIME_PIN.build!,
    trust: async () => ({ ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: "verify only" })
  });
  const vendorIds = await displayAdapterVendorIds();
  record("adapters", vendorIds === null ? null : describeAdapters(vendorIds));
  await withHostTeardown(step, hosts, () =>
    automaticLifecycle({
      step,
      record,
      logger,
      hosts,
      store,
      hostPath: required("AWKIT_HARNESS_HOST_PATH"),
      modelRoot: required("AWKIT_HARNESS_MODEL_ROOT"),
      modelPath: required("AWKIT_HARNESS_MODEL_PATH"),
      modelId: required("AWKIT_HARNESS_MODEL_ID"),
      threads: Number(required("AWKIT_HARNESS_THREADS"))
    })
  );
}

interface AutomaticContext {
  step: Step;
  record: (key: string, value: unknown) => void;
  logger: (level: string, message: string) => void;
  hosts: HostTeardown;
  store: AiBackendPackStore;
  hostPath: string;
  modelRoot: string;
  modelPath: string;
  modelId: string;
  threads: number;
}

/**
 * Automatic through its lifecycle, with the stored mode `auto`, the product's own readiness and the production
 * `AiService`, the way Settings runs it:
 *   1-3   the first load resolves Automatic on the readiness check and answers;
 *   4-6   a cancel during prompt evaluation and one during generation each end the job cancelled within the
 *         L1.8 3 s ceiling, leave the service available, and the next request is answered;
 *   7-9   the GPU host killed mid-inference (the crash contract: that job fails, one unexpected exit, the circuit
 *         stays closed), after which the next load resolves afresh and runs on the GPU again;
 *   10-12 a release stops the GPU host and nvidia-smi shows its VRAM given back; the next load reloads and answers;
 *   13    readiness SUBSTITUTED as not proven (labelled): CPU & RAM only, no GPU host, no fallback reason and no
 *         refusal, where GPU-Only under the same answer refuses (the labelled control);
 *   14    readiness restored: the next fresh resolution after a release is back on the GPU.
 * Every wait is on something observable: the job's own reported stage, a host exit, or a bounded nvidia-smi
 * reading. On a machine whose readiness does not prove NVIDIA only steps 1-3 run (as CPU & RAM only); the GPU
 * lifecycle there is NOT RUN, and the record says so.
 */
async function automaticLifecycle(c: AutomaticContext): Promise<void> {
  const { step, record, hosts, store } = c;
  const life: Record<string, unknown> = {};
  let guardRuns = 0;
  const cpu = hosts.track(new AiUtilityHostManager({ hostPath: c.hostPath, modelRoot: c.modelRoot, log: c.logger }));
  const gpu = hosts.track(new AiUtilityHostManager({
    hostPath: c.hostPath,
    modelRoot: c.modelRoot,
    backend: {
      kind: "vulkan",
      // Exactly what aiRuntime wires: the L8a.2 load-time guard before every GPU host fork.
      verify: async () => {
        guardRuns += 1;
        const verdict = await store.verifyForLoad();
        return verdict.ok ? { ok: true, dir: verdict.dir } : { ok: false };
      }
    },
    log: c.logger
  }));
  const readiness = await gpuReadiness(store);
  life.readiness = readiness;
  const onGpu = readiness.ok;
  // Every readiness answer the service asks for is one resolution of Automatic.
  let resolutions = 0;
  let substituted: AiGpuReadiness | null = null;
  const settings: AiServiceSettings = { enabled: true, yieldDuringRuns: false, idleUnloadMs: 0, minFreeMemoryMb: 0, executionMode: "auto", vramReserveBytes: null };
  const statuses: AiJobStatus[] = [];
  const service = new AiService({
    transport: (backend) => (backend === "cpu" ? cpu : gpu),
    gpu: async () => {
      resolutions += 1;
      return substituted ?? gpuReadiness(store);
    },
    model: async () => ({ ok: true, modelId: c.modelId, modelPath: c.modelPath, contextTokens: 4096 }),
    verifyModel: async () => true,
    settings: async () => settings,
    admission: () => IDLE,
    threads: c.threads,
    expectedRuntimeBuild: AI_RUNTIME_PIN.build!,
    log: c.logger,
    jobs: new AiJobTracker({ publish: (_owner, status) => statuses.push(status) })
  });
  const host = () => (onGpu ? gpu : cpu);
  let jobs = 0;
  const request = (kind: "short" | "long"): AiJobRequest => {
    const requestId = `auto-life-${++jobs}`;
    const owner = { window: 1, requestId };
    return kind === "short"
      ? { requestId, owner, feature: "locatorSemanticUpgrade", priority: "interactive", prompt: { instructions: "Answer with ok set to true.", fields: [{ name: "element", text: "Save" }], maxDataChars: 500 }, schema: SMALL, maxOutputTokens: 16, timeoutMs: 180_000 }
      : { requestId, owner, feature: "failureAnalysis", priority: "interactive", prompt: SYNTHETIC_FAILURE.spec, schema: SYNTHETIC_FAILURE.schema, maxOutputTokens: 256, timeoutMs: 180_000 };
  };
  const statusesOf = (requestId: string) => statuses.filter((s) => s.jobId === requestId);
  const stagesOf = (requestId: string) =>
    statusesOf(requestId).reduce<Array<{ stage: string; atMs: number }>>((list, s) => (list[list.length - 1]?.stage === s.stage ? list : [...list, { stage: s.stage, atMs: s.elapsedMs }]), []);
  const reached = (requestId: string, stage: AiJobStage) => statuses.some((s) => s.jobId === requestId && s.stage === stage);
  const vram = (label: string) => {
    const mib = onGpu ? nvidiaVramUsedMib() : null;
    (life.vramMib = (life.vramMib as Array<{ at: string; mib: number | null }> | undefined) ?? []).push({ at: label, mib });
    return mib;
  };

  /** One short request through Automatic, checked against where it must have run. */
  const answer = async (expectGpu: boolean) => {
    const job = request("short");
    const resolutionsBefore = resolutions;
    const guardBefore = guardRuns;
    const started = Date.now();
    const outcome = await service.submit(job);
    const wallMs = Date.now() - started;
    const { execution } = await service.status();
    const last = statusesOf(job.requestId).at(-1);
    const wanted = expectGpu ? { mode: "gpu-offload", backend: "vulkan", device: "gpu" } : { mode: "cpu", backend: "cpu", device: "cpu" };
    const problems = [
      outcome.status !== "ok" && `outcome ${JSON.stringify(outcome)}`,
      settings.executionMode !== "auto" && "the stored mode is no longer auto",
      execution.mode !== wanted.mode && `resolved to ${execution.mode}`,
      execution.backend !== wanted.backend && `ran on ${execution.backend}`,
      expectGpu && !(execution.gpuLayers >= 1) && "no layer on the GPU",
      (execution.fallbackReason !== null || execution.refusal !== null) && "a fallback or refusal was reported",
      (last?.state !== "completed" || last.profile?.mode !== wanted.mode || last.profile.backend !== wanted.backend || last.profile.device !== wanted.device) &&
        "the job profile is not the resolved mode",
      (expectGpu ? gpu.status().pid === null : gpu.status().pid !== null) && "the GPU host did not match the resolved mode"
    ].filter(Boolean);
    if (problems.length > 0) throw new Error(`${problems.join("; ")}: ${JSON.stringify({ outcome, execution, job: last })}`);
    return {
      configured: settings.executionMode,
      resolved: execution.mode,
      backend: execution.backend,
      layers: `${execution.gpuLayers} of ${execution.totalLayers ?? "?"}`,
      jobProfile: last?.profile ?? null,
      cold: last?.cold ?? null,
      freshResolutions: resolutions - resolutionsBefore,
      guardRuns: guardRuns - guardBefore,
      gpuPid: gpu.status().pid,
      stages: stagesOf(job.requestId),
      wallMs,
      ...(outcome.status === "ok" ? { firstTokenMs: outcome.usage.firstTokenMs, generationMs: outcome.usage.generationMs, outputTokens: outcome.usage.outputTokens } : {})
    };
  };

  /** A running request cancelled once its own status reports `stage`; it must end cancelled and leave the service usable. */
  const cancelAt = async (stage: "prompt-evaluation" | "generation") => {
    const job = request("long");
    const pending = service.submit(job);
    if (!(await until(() => reached(job.requestId, stage), 180_000))) throw new Error(`the request never reported ${stage}: ${JSON.stringify(stagesOf(job.requestId))}`);
    const hostPid = host().status().pid;
    const cancelledAt = Date.now();
    const accepted = service.cancel(job.requestId);
    const outcome = await pending;
    const latencyMs = Date.now() - cancelledAt;
    const status = await service.status();
    const last = statusesOf(job.requestId).at(-1);
    const settledBy = hostPid !== null && host().status().pid === hostPid ? "host" : "kill";
    if (outcome.status === "ok") throw new Error(`INCONCLUSIVE: the inference finished before the cancel landed (${latencyMs} ms)`);
    const problems = [
      !accepted && "the service did not know the running request",
      outcome.status !== "cancelled" && `outcome ${JSON.stringify(outcome)}`,
      latencyMs > CANCEL_CEILING_MS && `settled in ${latencyMs} ms, over the ${CANCEL_CEILING_MS} ms ceiling`,
      last?.state !== "cancelled" && `the job's own status reads ${last?.state}`,
      status.state.kind !== "available" && `the service reads ${JSON.stringify(status.state)} afterwards`,
      status.queueDepth !== 0 && "work is left queued",
      settings.executionMode !== "auto" && "the stored mode is no longer auto"
    ].filter(Boolean);
    if (problems.length > 0) throw new Error(`${problems.join("; ")}: ${JSON.stringify({ outcome, stages: stagesOf(job.requestId) })}`);
    return { phase: stage, latencyMs, settledBy, serviceState: status.state.kind, stages: stagesOf(job.requestId) };
  };

  const baseline = vram("before any load");
  await step("(precondition) PRODUCT Automatic lifecycle starts with no GPU host running and the stored mode auto", () => {
    if (settings.executionMode !== "auto") throw new Error(`stored mode ${settings.executionMode}`);
    return establishFreshHost(gpu);
  });
  life.firstLoad = await step(
    `PRODUCT Automatic lifecycle 1-3: the first load resolves Automatic on the product's readiness (${onGpu ? "proven NVIDIA: GPU-Offload" : `${readiness.reason}: CPU & RAM only`}) and answers`,
    async () => {
      const value = await answer(onGpu);
      if (value.freshResolutions !== 1 || value.cold !== true) throw new Error(`expected one fresh resolution on a cold load: ${JSON.stringify(value)}`);
      if (onGpu && value.guardRuns !== 1) throw new Error(`guard ran ${value.guardRuns} times for the first GPU host`);
      const loaded = vram("loaded after the first load");
      if (onGpu && (baseline === null || loaded === null || !(loaded > baseline))) throw new Error(`VRAM ${baseline} MiB before and ${loaded} MiB loaded`);
      return { ...value, vramBeforeMib: baseline, vramLoadedMib: loaded };
    }
  );
  if (!onGpu) {
    life.gpuLifecycle = `NOT RUN: readiness ${readiness.reason}, so Automatic runs as CPU & RAM only here`;
    record("automaticLifecycle", life);
    await service.shutdown();
    return;
  }

  life.cancelDuringPrompt = await step("PRODUCT Automatic lifecycle 4-5: a request cancelled during prompt evaluation ends cancelled within 3 s and leaves the service available", () => cancelAt("prompt-evaluation"));
  life.cancelDuringGeneration = await step("PRODUCT Automatic lifecycle 4-5: a request cancelled during generation ends cancelled within 3 s and leaves the service available", () => cancelAt("generation"));
  life.afterCancel = await step("PRODUCT Automatic lifecycle 6: the next request after the cancels is answered on the GPU", async () => {
    const value = await answer(true);
    // A host killed to honour a cancel takes the model with it, so the next job reloads and resolves again. An
    // earlier kill was already reloaded by the generation cancel's own job: only the last cancel decides here.
    const killed = (life.cancelDuringGeneration as { settledBy?: string } | undefined)?.settledBy === "kill";
    if (value.freshResolutions !== (killed ? 1 : 0)) throw new Error(`${value.freshResolutions} fresh resolutions after ${killed ? "a" : "no"} kill on the last cancel`);
    return { ...value, reloadedAfterKillOnCancel: killed };
  });

  let killedPid: number | null = null;
  life.killed = await step("PRODUCT Automatic lifecycle 7: the GPU host killed mid-inference fails that job (HOST_ERROR), one unexpected exit, the circuit closed", async () => {
    const job = request("long");
    const pending = service.submit(job);
    if (!(await until(() => reached(job.requestId, "generation"), 180_000))) throw new Error(`the request never reached generation: ${JSON.stringify(stagesOf(job.requestId))}`);
    killedPid = gpu.status().pid;
    if (!killedPid) throw new Error("no GPU host to kill");
    const strikesBefore = gpu.status().unexpectedExits;
    process.kill(killedPid);
    const outcome = await pending;
    if (!(await until(() => gpu.status().pid === null, 10_000))) throw new Error("the manager never saw the exit");
    const after = gpu.status();
    const problems = [
      (outcome.status !== "failed" || outcome.code !== "HOST_ERROR") && `outcome ${JSON.stringify(outcome)}`,
      after.unexpectedExits !== strikesBefore + 1 && `${after.unexpectedExits - strikesBefore} unexpected exits recorded`,
      after.circuitOpen && "the circuit opened",
      !gpu.isAvailable() && "the GPU host manager is no longer available"
    ].filter(Boolean);
    if (problems.length > 0) throw new Error(`${problems.join("; ")}: ${JSON.stringify({ outcome, after })}`);
    return { killedPid, outcome: `${outcome.status}/${"code" in outcome ? outcome.code : ""}`, strikes: after.unexpectedExits, circuitOpen: after.circuitOpen, stages: stagesOf(job.requestId) };
  });
  life.restarted = await step("PRODUCT Automatic lifecycle 8-9: after the restart Automatic resolves afresh (one readiness check, one guarded fork) and runs on the GPU again", async () => {
    const value = await answer(true);
    if (value.freshResolutions !== 1 || value.guardRuns !== 1 || value.gpuPid === null || value.gpuPid === killedPid || value.cold !== true) throw new Error(`not a fresh resolution on a new GPU host: ${JSON.stringify(value)}`);
    return { ...value, vramLoadedMib: vram("loaded after the restart") };
  });

  life.released = await step("PRODUCT Automatic lifecycle 10-11: releasing the model stops the GPU host and nvidia-smi shows its VRAM given back", async () => {
    const loaded = nvidiaVramUsedMib();
    if (loaded === null || gpu.status().pid === null) throw new Error(JSON.stringify({ loaded, pid: gpu.status().pid }));
    await service.releaseModel();
    if (gpu.status().pid !== null) throw new Error("the release left the GPU host running");
    const released = await vramBelow(loaded);
    vram("after the release");
    if (released === null || released >= loaded) throw new Error(`VRAM ${loaded} MiB loaded and ${String(released)} MiB after the release`);
    return { loadedMib: loaded, releasedMib: released, baselineMib: baseline, releasedVsBaselineMib: baseline === null ? null : released - baseline };
  });
  life.reloaded = await step("PRODUCT Automatic lifecycle 12: the next request reloads through Automatic and is answered on the GPU", async () => {
    const value = await answer(true);
    if (value.freshResolutions !== 1 || value.cold !== true) throw new Error(`not a fresh, cold reload: ${JSON.stringify(value)}`);
    return { ...value, vramLoadedMib: vram("loaded after the reload") };
  });

  life.notReady = await step("PRODUCT Automatic lifecycle 13, readiness SUBSTITUTED as VENDOR_UNPROVEN after a release: CPU & RAM only, no GPU host, no fallback reason, no refusal", async () => {
    await service.releaseModel();
    if (gpu.status().pid !== null) throw new Error("the release left the GPU host running");
    substituted = { ok: false, reason: "VENDOR_UNPROVEN" };
    const value = await answer(false);
    if (value.freshResolutions !== 1) throw new Error(`${value.freshResolutions} fresh resolutions`);
    return { ...value, vramMib: vram("CPU & RAM only under the substituted answer") };
  });
  life.gpuOnlyControl = await step("(control) PRODUCT GPU-Only under the same substituted answer refuses with GPU_UNAVAILABLE, which Automatic never does", async () => {
    settings.executionMode = "gpu-only";
    try {
      const outcome = await service.submit(request("short"));
      const { execution } = await service.status();
      if (outcome.status !== "rejected" || outcome.reason !== "GPU_UNAVAILABLE" || execution.refusal?.reason !== "VENDOR_UNPROVEN" || gpu.status().pid !== null) {
        throw new Error(JSON.stringify({ outcome, execution }));
      }
      return { outcome: `${outcome.status}/${outcome.code}/${outcome.reason}`, refusal: execution.refusal.reason };
    } finally {
      settings.executionMode = "auto";
    }
  });
  life.restored = await step("PRODUCT Automatic lifecycle 14: readiness restored, the next fresh resolution after a release is back on the GPU", async () => {
    substituted = null;
    await service.releaseModel();
    const value = await answer(true);
    if (value.freshResolutions !== 1 || value.cold !== true) throw new Error(`not a fresh resolution: ${JSON.stringify(value)}`);
    return { ...value, vramLoadedMib: vram("loaded after readiness was restored") };
  });
  const loadedAtEnd = nvidiaVramUsedMib();
  await service.releaseModel();
  life.finalRelease = { gpuHostRunning: gpu.status().pid !== null, loadedMib: loadedAtEnd, releasedMib: loadedAtEnd === null ? null : await vramBelow(loadedAtEnd) };
  record("automaticLifecycle", life);
  await service.shutdown();
}