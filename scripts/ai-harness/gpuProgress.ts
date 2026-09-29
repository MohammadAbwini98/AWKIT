/**
 * L9 live mode (AWKIT_HARNESS_MODE=gpuProgress): the job-status contract on the REAL Vulkan and CPU hosts,
 * through the production `AiService`, `AiJobTracker` and `AiEtaHistoryStore`, with the pinned Vulkan pack
 * imported by the launcher and the pinned Qwen3.5-0.8B.
 *
 * MECHANICS only, like gpuLive's: eligibility is SUBSTITUTED so the GPU modes load on this machine's
 * adapter. On a non-NVIDIA adapter this proves that the runtime's own load fraction reaches the job as
 * determinate progress on the GPU, that cold and warm and the ETA history work per placement, and nothing
 * about NVIDIA (E11). The product's own answer for this machine is verify:ai-progress-packaged.
 *
 * The history is a scratch file under the launcher's scratch root; keys are latency-class-shaped ids of
 * the placement, never text.
 */

import fs from "node:fs";
import path from "node:path";

import { AiUtilityHostManager } from "@main/ai/AiUtilityHostManager";
import { displayAdapterVendorIds } from "@main/ai/gpuAdapters";
import { describeAdapters } from "@src/ai/AiExecutionProfile";
import type { AiAdmissionView } from "@src/ai/AiAdmission";
import { AiBackendPackStore } from "@src/ai/AiBackendPack";
import { AiEtaHistoryStore } from "@src/ai/AiEtaHistory";
import { AiJobTracker, type AiJobSample, type AiJobStatus } from "@src/ai/AiJobStatus";
import type { AiOutputSchema } from "@src/ai/AiOutputContract";
import { AiService, type AiJobRequest, type AiServiceSettings } from "@src/ai/AiService";
import { resolveAiTimeBudgets } from "@src/ai/AiTimeBudgets";
import { AI_BACKEND_MANIFEST, AI_RUNTIME_PIN } from "@src/offline/AiModelManifest";

type Step = <T>(label: string, fn: () => Promise<T> | T) => Promise<T | undefined>;

const IDLE: AiAdmissionView = { activeRuns: 0, queuedRuns: 0, pressureState: "stable", dispatchBlocked: false, activeWeight: 0, weightedBudget: 100, freeMemoryMb: 1_000_000 };
const SMALL: AiOutputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
const OWNER = 1;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** What one job's statuses showed, in the contract's words: never a status's full body. */
function summarize(statuses: AiJobStatus[]) {
  const stages = statuses.map((s) => s.stage).filter((stage, i, all) => i === 0 || all[i - 1] !== stage);
  const loads = statuses.filter((s) => s.progress !== null);
  const last = statuses.at(-1) ?? null;
  return {
    stages,
    loadFractions: loads.map((s) => s.progress!.done),
    progressOnlyInLoad: loads.every((s) => s.stage === "model-load" && s.progress!.unit === "fraction" && s.progress!.total === 1000 && s.progress!.done <= 1000),
    fractionsRise: loads.every((s, i) => i === 0 || s.progress!.done >= loads[i - 1].progress!.done),
    cold: last?.cold ?? null,
    noHistoryWhileRunning: statuses.some((s) => s.state === "running" && s.noHistory),
    etas: statuses.filter((s) => s.eta !== null).map((s) => ({ warmth: s.eta!.warmth, samples: s.eta!.samples })),
    profile: last?.profile ?? null,
    state: last?.state ?? null,
    terminalReason: last?.terminalReason ?? null
  };
}

export async function runGpuProgress({ step, record, log }: { step: Step; record: (key: string, value: unknown) => void; log: (line: string) => void }): Promise<void> {
  const hostPath = required("AWKIT_HARNESS_HOST_PATH");
  const modelRoot = required("AWKIT_HARNESS_MODEL_ROOT");
  const modelPath = required("AWKIT_HARNESS_MODEL_PATH");
  const modelId = required("AWKIT_HARNESS_MODEL_ID");
  const backendsRoot = required("AWKIT_HARNESS_BACKENDS_ROOT");
  const threads = Number(required("AWKIT_HARNESS_THREADS"));
  const build = AI_RUNTIME_PIN.build!;
  const entry = AI_BACKEND_MANIFEST.find((candidate) => candidate.id === "vulkan") ?? null;
  const logger = (level: string, message: string) => log(`${level}: ${message}`);

  const store = new AiBackendPackStore({
    root: backendsRoot,
    entry,
    runtimeBuild: build,
    trust: async () => ({ ok: false, code: "SIGNED_MANIFEST_UNVERIFIED", detail: "verify only" })
  });
  const guard = await step("(precondition) the imported pack passes the load-time guard", async () => {
    const verdict = await store.verifyForLoad();
    if (!verdict.ok) throw new Error(`${verdict.reason} ${verdict.path ?? ""}`);
    return verdict.dir;
  });
  if (!guard) return;
  // By PCI vendor ID only, so the launcher can say whether these mechanics ran on NVIDIA.
  record("adapters", describeAdapters(await displayAdapterVendorIds()));

  const cpu = new AiUtilityHostManager({ hostPath, modelRoot, log: logger });
  const gpu = new AiUtilityHostManager({
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
  });

  // The production tracker and history; the key is the placement's shape, as aiRuntime's latency class is.
  const historyFile = path.join(path.dirname(backendsRoot), "eta", "ai-eta-history.json");
  const history = new AiEtaHistoryStore(historyFile, Date.now, (line) => log(`eta: ${line}`));
  const keyOf = (sample: AiJobSample): string | null =>
    sample.profile ? `mechanics|${sample.kind}|${sample.profile.backend}|${sample.profile.offload}|${sample.profile.mode}` : null;
  const statuses: AiJobStatus[] = [];
  const pendingRecords: Promise<unknown>[] = [];
  const tracker = new AiJobTracker({
    estimate: (sample) => {
      const key = keyOf(sample);
      return key ? history.estimate(key, sample.cold) : null;
    },
    record: (sample, runMs) => {
      const key = keyOf(sample);
      if (key) pendingRecords.push(history.record(key, sample.cold, runMs));
    },
    publish: (owner, status) => {
      if (owner === OWNER) statuses.push(status);
    }
  });

  const settings: AiServiceSettings = {
    enabled: true,
    yieldDuringRuns: false,
    idleUnloadMs: 0,
    minFreeMemoryMb: 0,
    executionMode: "gpu-offload",
    vramReserveBytes: null,
    budgets: resolveAiTimeBudgets(undefined)
  };
  const service = new AiService({
    transport: (backend) => (backend === "cpu" ? cpu : gpu),
    // SUBSTITUTED eligibility: the mechanics, never NVIDIA qualification.
    gpu: async () => ({ ok: true, nvidiaAdapters: 1 }),
    model: async () => ({ ok: true, modelId, modelPath, contextTokens: 4096 }),
    verifyModel: async () => true,
    settings: async () => settings,
    admission: () => IDLE,
    threads,
    expectedRuntimeBuild: build,
    log: logger,
    jobs: tracker
  });

  let jobs = 0;
  const run = async (label: string) => {
    const requestId = `gpu-progress-${++jobs}`;
    const request: AiJobRequest = {
      requestId,
      feature: "locatorSemanticUpgrade",
      priority: "interactive",
      prompt: { instructions: "Answer with ok set to true.", fields: [{ name: "element", text: "Save" }], maxDataChars: 500 },
      schema: SMALL,
      maxOutputTokens: 16,
      timeoutMs: 185_000,
      owner: { window: OWNER, requestId }
    };
    const outcome = await service.submit(request);
    await Promise.all(pendingRecords.splice(0));
    const seen = summarize(statuses.filter((s) => s.jobId === requestId));
    record(label, { outcome: outcome.status, ...seen });
    return { outcome, seen };
  };
  // A mode change first drops the old load, reported under model-load too: the LAST model-load is the new one.
  const loaded = (seen: ReturnType<typeof summarize>) =>
    seen.stages.includes("backend-probe") &&
    seen.stages.lastIndexOf("model-load") > seen.stages.indexOf("backend-probe") &&
    seen.stages.indexOf("prompt-evaluation") > seen.stages.lastIndexOf("model-load") &&
    seen.stages.indexOf("generation") > seen.stages.indexOf("prompt-evaluation");

  await step("MECHANICS GPU-Offload, cold: the runtime's own load fraction is the job's determinate progress on the Vulkan host", async () => {
    const { outcome, seen } = await run("offloadCold");
    if (outcome.status !== "ok" || seen.state !== "completed") throw new Error(JSON.stringify({ outcome, seen }));
    if (!loaded(seen) || seen.loadFractions.length === 0 || !seen.progressOnlyInLoad || !seen.fractionsRise) throw new Error(JSON.stringify(seen));
    if (seen.profile?.backend !== "vulkan" || seen.profile.device !== "gpu" || seen.profile.mode !== "gpu-offload" || seen.profile.offload === "cpu") throw new Error(JSON.stringify(seen.profile));
    if (seen.cold !== true || !seen.noHistoryWhileRunning || seen.etas.length > 0) throw new Error(`first run: ${JSON.stringify(seen)}`);
    return { stages: seen.stages, loadFractions: seen.loadFractions, offload: seen.profile.offload };
  });
  await step("MECHANICS GPU-Offload, warm with no warm history: no load, no estimate, and it says so", async () => {
    const { outcome, seen } = await run("offloadWarmFirst");
    if (outcome.status !== "ok" || seen.state !== "completed" || seen.cold !== false) throw new Error(JSON.stringify({ outcome, seen }));
    if (seen.stages.includes("model-load") || seen.loadFractions.length > 0 || !seen.noHistoryWhileRunning || seen.etas.length > 0) throw new Error(JSON.stringify(seen));
    return { stages: seen.stages };
  });
  await step("MECHANICS GPU-Offload, warm again: a measured range from the one earlier warm run on this placement", async () => {
    const { outcome, seen } = await run("offloadWarmMeasured");
    if (outcome.status !== "ok" || seen.cold !== false) throw new Error(JSON.stringify({ outcome, seen }));
    if (!seen.etas.some((eta) => eta.warmth === "warm" && eta.samples === 1)) throw new Error(JSON.stringify(seen.etas));
    return { etas: seen.etas.slice(0, 1) };
  });

  settings.executionMode = "gpu-only";
  await step("MECHANICS GPU-Only: a reload that places every layer, with the runtime's load fraction, or a refusal with its reason and no progress", async () => {
    const { outcome, seen } = await run("gpuOnly");
    if (outcome.status === "ok") {
      if (!loaded(seen) || seen.loadFractions.length === 0 || !seen.progressOnlyInLoad || seen.cold !== true) throw new Error(JSON.stringify(seen));
      if (seen.profile?.backend !== "vulkan" || seen.profile.mode !== "gpu-only" || seen.profile.offload !== "full") throw new Error(JSON.stringify(seen.profile));
      return { placed: seen.profile.offload, loadFractions: seen.loadFractions };
    }
    if (outcome.status !== "rejected" || seen.state !== "failed" || !seen.terminalReason || seen.loadFractions.length > 0) throw new Error(JSON.stringify({ outcome, seen }));
    return { refused: seen.terminalReason };
  });

  settings.executionMode = "cpu";
  await step("CPU & RAM only after the GPU modes: a cold CPU load with its own fraction, measured apart from the GPU placements", async () => {
    const { outcome, seen } = await run("cpuCold");
    if (outcome.status !== "ok" || seen.cold !== true || seen.profile?.backend !== "cpu" || seen.profile.device !== "cpu") throw new Error(JSON.stringify({ outcome, seen }));
    if (seen.loadFractions.length === 0 || !seen.progressOnlyInLoad || seen.etas.length > 0) throw new Error(JSON.stringify(seen));
    return { loadFractions: seen.loadFractions };
  });

  await step("the history holds each placement's cold and warm durations apart, under placement keys only", async () => {
    const parsed = JSON.parse(fs.readFileSync(historyFile, "utf8")) as { schemaVersion: number; entries: Record<string, { cold: number[]; warm: number[] }> };
    const offload = Object.entries(parsed.entries).find(([key]) => key.includes("|vulkan|") && key.endsWith("|gpu-offload"));
    const onCpu = Object.entries(parsed.entries).find(([key]) => key.includes("|cpu|cpu|cpu"));
    if (parsed.schemaVersion !== 1 || !offload || offload[1].cold.length !== 1 || offload[1].warm.length !== 2 || !onCpu || onCpu[1].cold.length !== 1) throw new Error(JSON.stringify(parsed.entries));
    return { keys: Object.keys(parsed.entries) };
  });

  await service.shutdown();
}
