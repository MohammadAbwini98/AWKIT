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
 */

import { AiUtilityHostManager } from "@main/ai/AiUtilityHostManager";
import { displayAdapterVendorIds } from "@main/ai/gpuAdapters";
import { AiBackendPackStore } from "@src/ai/AiBackendPack";
import { describeAdapters } from "@src/ai/AiExecutionProfile";
import type { AiOutputSchema } from "@src/ai/AiOutputContract";
import {
  AI_HOST_PROTOCOL_VERSION,
  AiHostCallError,
  type AiGpuPlan,
  type AiInferResult,
  type AiLoadResult
} from "@src/ai/contracts/AiHostProtocol";
import { AI_BACKEND_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";

import { built, cancelJob, prose, SYNTHETIC_FAILURE } from "./bench";
import { HostTeardown, withHostTeardown } from "./gpuHostLifecycle";

type Step = <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;

const HELLO = { type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } } as const;
const SMALL: AiOutputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
/** Filler hosts are started until one cannot load every layer, or this many are running. */
const MAX_FILLERS = 6;

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
