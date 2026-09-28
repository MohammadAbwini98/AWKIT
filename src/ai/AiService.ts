/**
 * AiService (Phase L, L1.1): the single, optional AI boundary.
 *
 * Framework-agnostic: the Electron host manager, the model registry, settings and the engine's
 * admission view are injected, so every path runs against `FakeAiHostTransport` with no Electron.
 *
 *  - Optional. Disabled, no runtime, no model, an open circuit or a host error each become a result
 *    code. `submit` never throws, and nothing here can block a run, the Recorder, Stop or Save.
 *  - One bounded queue: interactive before background, FIFO within each, a length bound, one
 *    inference at a time, bounded prompt and output tokens, a timeout and cancellation per job.
 *  - Yields. A queued job waits while admission holds (runs active, host pressure). A running job is
 *    cancelled on the host and requeued, a bounded number of times, the moment admission stops.
 *  - Every prompt is built HERE (`buildAiPrompt`: redaction, caps, rescan) and every output is
 *    validated HERE (`parseAiOutput`); thinking is always off.
 *  - No prompt, response or model text is logged or persisted: logs carry codes and counts.
 *  - Where the model runs (L8a.3) follows the execution mode: the CPU host by default; for a GPU mode
 *    the GPU host, sized from its own plan, with GPU-Offload falling back to the CPU host (reason kept)
 *    and GPU-Only refusing. A mode change reloads at the next job, never mid-inference.
 */

import { randomBytes } from "node:crypto";

import { isAiFeatureId, type AiFeatureId } from "../security/authz/AiAutonomyPolicy";
import { SemanticRedactor } from "../semantic/SemanticRedactor";
import { decideAiAdmission, type AiAdmissionHoldReason, type AiAdmissionView } from "./AiAdmission";
import {
  CPU_PROFILE,
  decideGpuLoad,
  GPU_LOSS_LIMIT,
  retryLayers,
  unprovenDevices,
  vramOf,
  type AiExecutionProfile,
  type AiGpuReadiness,
  type AiGpuReason,
  type AiLoadStage
} from "./AiExecutionProfile";
import { isBoundedSchema, parseAiOutput, type AiOutputSchema } from "./AiOutputContract";
import { buildAiPrompt, type AiPromptSpec } from "./AiPromptBuilder";
import type { AiExecutionMode } from "./AiSettings";
import {
  AI_CONTEXT_TOKENS,
  AI_HOST_PROTOCOL_VERSION,
  AI_HOST_TIMEOUTS,
  AI_MAX_OUTPUT_TOKENS,
  AI_MAX_PROMPT_TOKENS,
  AiHostCallError,
  type AiGpuPlan,
  type AiHostBackend,
  type AiHostHello,
  type AiHostReason,
  type AiHostTransport,
  type AiInferResult,
  type AiLoadResult
} from "./contracts/AiHostProtocol";

export interface AiServiceLimits {
  maxQueue: number;
  /** Times one job may be pushed back to the queue by active runs before it gives up. */
  maxYields: number;
  maxJobTimeoutMs: number;
  /** How often a running job re-checks admission, i.e. the bound on how late it yields. */
  yieldCheckMs: number;
  /** How often held work re-checks admission. */
  admissionRetryMs: number;
}

export const AI_SERVICE_LIMITS: Readonly<AiServiceLimits> = Object.freeze({
  maxQueue: 16,
  maxYields: 3,
  /** The longest per-feature deadline (failure analysis and locator attempts, 185 s); above it a job is refused. */
  maxJobTimeoutMs: 185_000,
  yieldCheckMs: 250,
  admissionRetryMs: 1_000
});

export type AiJobPriority = "interactive" | "background";

export interface AiJobRequest {
  /** Caller correlation and cancellation key. */
  requestId: string;
  feature: AiFeatureId;
  priority: AiJobPriority;
  prompt: AiPromptSpec;
  schema: AiOutputSchema;
  maxOutputTokens: number;
  timeoutMs: number;
}

export type AiRejectCode =
  | "DISABLED"
  | "UNAVAILABLE"
  | "QUEUE_FULL"
  | "DUPLICATE_REQUEST"
  | "INVALID_REQUEST"
  | "PROMPT_REJECTED"
  | "SHUTDOWN";
export type AiFailCode = "TIMEOUT" | "MALFORMED_OUTPUT" | "SCHEMA_REJECTED" | "HOST_ERROR" | "LOAD_FAILED" | "YIELD_LIMIT";

export interface AiJobUsage {
  promptTokens: number;
  outputTokens: number;
  firstTokenMs: number;
  generationMs: number;
}

export type AiJobOutcome =
  | { status: "ok"; value: unknown; modelId: string; usage: AiJobUsage; yields: number }
  | { status: "rejected"; code: AiRejectCode; reason?: AiUnavailableReason }
  | { status: "cancelled"; yields: number }
  | { status: "failed"; code: AiFailCode; yields: number };

export type AiUnavailableReason =
  | "DISABLED"
  | "RUNTIME_MISSING"
  | "RUNTIME_INCOMPATIBLE"
  | "CIRCUIT_OPEN"
  | "MODEL_MISSING"
  | "MODEL_INVALID"
  /** A registered model the manifest does not list, not yet checked for compatibility (L8b.1). */
  | "MODEL_UNCHECKED"
  /** GPU-Only refused; the execution profile names why. */
  | "GPU_UNAVAILABLE"
  | "SHUTDOWN";

export type AiServiceState =
  | { kind: "available" }
  | { kind: "unavailable"; reason: AiUnavailableReason }
  | { kind: "loading" }
  | { kind: "busy" }
  | { kind: "error"; code: AiHostReason };

export interface AiServiceStatus {
  state: AiServiceState;
  queueDepth: number;
  /** Why queued work is waiting, when it is. */
  holdReason: AiAdmissionHoldReason | null;
  loadedModelId: string | null;
  /** Where the model runs now, or why a GPU mode is not running on the GPU. */
  execution: AiExecutionProfile;
  /** `execution` came from a load under the current mode and reserve; false until the next load after a change. */
  executionApplied: boolean;
  /** What a model load is doing now, or null. */
  loadStage: AiLoadStage | null;
  counters: { completed: number; failed: number; cancelled: number; rejected: number; yielded: number };
}

export interface AiServiceSettings {
  enabled: boolean;
  yieldDuringRuns: boolean;
  /** Unload the model after this long idle; 0 keeps it loaded. */
  idleUnloadMs: number;
  minFreeMemoryMb: number;
  /** Absent is CPU & RAM only. */
  executionMode?: AiExecutionMode;
  /** VRAM kept free beside the model; absent or null is the runtime's own padding. */
  vramReserveBytes?: number | null;
}

export type AiModelResolution =
  | { ok: true; modelId: string; modelPath: string; contextTokens: number }
  | { ok: false; reason: "MODEL_MISSING" | "MODEL_INVALID" | "MODEL_UNCHECKED" };

export interface AiServiceDeps {
  /** The host for a backend; null when it is not part of this build. The CPU host decides "runtime missing". */
  transport: (backend: AiHostBackend) => AiHostTransport | null;
  /** GPU readiness before any GPU host starts (backend pack and adapters). Absent: GPU modes are unavailable. */
  gpu?: () => Promise<AiGpuReadiness>;
  model: () => Promise<AiModelResolution>;
  /** Full checksum check before a load (the model pack caches it per session). False refuses the load. */
  verifyModel?: (model: Extract<AiModelResolution, { ok: true }>) => Promise<boolean>;
  settings: () => Promise<AiServiceSettings>;
  admission: () => AiAdmissionView;
  threads: number;
  /** Pinned runtime build from the manifest; a host reporting anything else is incompatible. */
  expectedRuntimeBuild?: string;
  inferenceWeight?: number;
  limits?: Partial<AiServiceLimits>;
  redactor?: () => SemanticRedactor;
  nonce?: () => string;
  log?: (level: "info" | "warn", message: string) => void;
}

interface QueuedJob {
  request: AiJobRequest;
  system: string;
  user: string;
  yields: number;
  userCancelled: boolean;
  hostJobId: string | null;
  settled: boolean;
  resolve: (outcome: AiJobOutcome) => void;
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const HELD_VIEW: AiAdmissionView = {
  activeRuns: 0,
  queuedRuns: 0,
  pressureState: "unknown",
  dispatchBlocked: true,
  activeWeight: 0,
  weightedBudget: 0,
  freeMemoryMb: 0
};

function unref(timer: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

export class AiService {
  private readonly limits: AiServiceLimits;
  private readonly queue: QueuedJob[] = [];
  private running: QueuedJob | null = null;
  private executing: Promise<void> | null = null;
  private pumping = false;
  private disposed = false;
  /** Hosts whose handshake passed, per backend; a host that exits is forgotten. */
  private readonly handshaken = new Set<AiHostBackend>();
  private incompatible = false;
  private loading = false;
  private loadedModelId: string | null = null;
  /** The host the model is loaded on (or last was). */
  private backend: AiHostBackend = "cpu";
  /** The mode and reserve the current load was made for; a different one reloads. */
  private profileKey: string | null = null;
  private profile: AiExecutionProfile = CPU_PROFILE;
  /** The mode and reserve `profile` was produced under; unlike `profileKey` it survives an unload. */
  private profileFor: string | null = null;
  /** The current load's GPU plan, for the profile's VRAM figures. */
  private plan: AiGpuPlan | null = null;
  private stage: AiLoadStage | null = null;
  /** The mode and reserve GPU-Only last refused under, so status reports it until they change. */
  private refusedKey: string | null = null;
  /** GPU losses after a successful load under one mode and reserve (L8a.5); a new setting starts over. */
  private gpuLosses: { key: string; count: number } | null = null;
  private lastError: AiHostReason | null = null;
  private holdReason: AiAdmissionHoldReason | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private readonly counters = { completed: 0, failed: 0, cancelled: 0, rejected: 0, yielded: 0 };

  constructor(private readonly deps: AiServiceDeps) {
    this.limits = { ...AI_SERVICE_LIMITS, ...deps.limits };
  }

  async submit(request: AiJobRequest): Promise<AiJobOutcome> {
    const reject = (code: AiRejectCode, reason?: AiUnavailableReason) => this.rejected(code, reason, request?.feature);
    try {
      if (this.disposed) return reject("SHUTDOWN");
      if (!this.isValid(request)) return reject("INVALID_REQUEST");
      const settings = await this.deps.settings();
      if (!settings.enabled) return reject("DISABLED", "DISABLED");
      const unavailable = await this.unavailableReason();
      if (unavailable) return reject("UNAVAILABLE", unavailable);
      const prompt = buildAiPrompt(request.prompt, (this.deps.redactor ?? (() => new SemanticRedactor()))(), this.nonce());
      if (!prompt.ok) return reject("PROMPT_REJECTED");
      // Checked last and synchronously with the enqueue, so concurrent submits cannot both pass.
      if (this.disposed) return reject("SHUTDOWN");
      if (this.queue.some((job) => job.request.requestId === request.requestId) || this.running?.request.requestId === request.requestId) {
        return reject("DUPLICATE_REQUEST");
      }
      if (this.queue.length >= this.limits.maxQueue) return reject("QUEUE_FULL");
      return await new Promise<AiJobOutcome>((resolve) => {
        this.enqueue(
          { request, system: prompt.system, user: prompt.user, yields: 0, userCancelled: false, hostJobId: null, settled: false, resolve },
          false
        );
        void this.pump();
      });
    } catch {
      return reject("UNAVAILABLE");
    }
  }

  /** Cancel a queued or running job. Returns false when no such job exists. */
  cancel(requestId: string): boolean {
    const index = this.queue.findIndex((job) => job.request.requestId === requestId);
    if (index >= 0) {
      const [job] = this.queue.splice(index, 1);
      this.finish(job, { status: "cancelled", yields: job.yields });
      return true;
    }
    if (this.running?.request.requestId === requestId) {
      this.running.userCancelled = true;
      if (this.running.hostJobId) void this.cancelOnHost(this.running.hostJobId);
      return true;
    }
    return false;
  }

  /** Re-check admission now, e.g. when a run finishes. */
  notifyAdmissionChanged(): void {
    void this.pump();
  }

  /**
   * Unload the model now if nothing is running or queued, and stop a GPU host, e.g. before the model
   * or the GPU backend pack is replaced (a loaded DLL cannot be deleted). The next job re-plans.
   */
  async releaseModel(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    await this.unloadIfIdle();
    if (!this.running && this.queue.length === 0) await this.releaseGpuHost();
  }

  async status(): Promise<AiServiceStatus> {
    const settings = await this.deps.settings().catch(() => null);
    return {
      state: await this.state(),
      queueDepth: this.queue.length,
      holdReason: this.holdReason,
      loadedModelId: this.loadedModelId,
      execution: {
        ...this.profile,
        refusal: this.profile.refusal ? { ...this.profile.refusal } : null,
        vram: this.profile.vram ? { ...this.profile.vram } : null
      },
      executionApplied: settings !== null && this.profileFor === this.executionKey(settings),
      loadStage: this.stage,
      counters: { ...this.counters }
    };
  }

  /** Bounded: queued work is rejected, running work is cancelled, then the host is disposed. */
  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    for (const job of this.queue.splice(0)) this.finish(job, { status: "rejected", code: "SHUTDOWN" });
    const running = this.running;
    if (running) {
      running.userCancelled = true;
      if (running.hostJobId) void this.cancelOnHost(running.hostJobId);
    }
    if (this.executing) {
      await Promise.race([this.executing, new Promise((resolve) => unref(setTimeout(resolve, AI_HOST_TIMEOUTS.cancelMs)))]);
    }
    const hosts = new Set([this.deps.transport("cpu"), this.deps.transport("vulkan")]);
    await Promise.all([...hosts].map((host) => host?.dispose().catch(() => undefined)));
  }

  // ─────────────────────────────── internals ───────────────────────────────

  private isValid(request: AiJobRequest): boolean {
    return (
      typeof request === "object" &&
      request !== null &&
      typeof request.requestId === "string" &&
      REQUEST_ID.test(request.requestId) &&
      isAiFeatureId(request.feature) &&
      (request.priority === "interactive" || request.priority === "background") &&
      typeof request.prompt === "object" &&
      request.prompt !== null &&
      isBoundedSchema(request.schema) &&
      Number.isInteger(request.maxOutputTokens) &&
      request.maxOutputTokens >= 1 &&
      request.maxOutputTokens <= AI_MAX_OUTPUT_TOKENS &&
      Number.isInteger(request.timeoutMs) &&
      request.timeoutMs >= 1 &&
      request.timeoutMs <= this.limits.maxJobTimeoutMs
    );
  }

  private nonce(): string {
    return (this.deps.nonce ?? (() => randomBytes(8).toString("hex")))();
  }

  private async unavailableReason(): Promise<AiUnavailableReason | null> {
    const cpu = this.deps.transport("cpu");
    if (!cpu) return "RUNTIME_MISSING";
    if (!(this.deps.transport(this.backend) ?? cpu).isAvailable()) return "CIRCUIT_OPEN";
    if (this.incompatible) return "RUNTIME_INCOMPATIBLE";
    const model = await this.deps.model().catch((): AiModelResolution => ({ ok: false, reason: "MODEL_INVALID" }));
    return model.ok ? null : model.reason;
  }

  private executionKey(settings: AiServiceSettings): string {
    return `${settings.executionMode ?? "cpu"}|${settings.vramReserveBytes ?? "default"}`;
  }

  private async state(): Promise<AiServiceState> {
    if (this.disposed) return { kind: "unavailable", reason: "SHUTDOWN" };
    const settings = await this.deps.settings().catch(() => null);
    if (!settings?.enabled) return { kind: "unavailable", reason: "DISABLED" };
    const unavailable = await this.unavailableReason();
    if (unavailable) return { kind: "unavailable", reason: unavailable };
    // Reported until the mode or reserve changes; the next job still re-evaluates, so a fixed cause clears it.
    if (this.refusedKey !== null && this.refusedKey === this.executionKey(settings)) return { kind: "unavailable", reason: "GPU_UNAVAILABLE" };
    if (this.loading) return { kind: "loading" };
    if (this.running) return { kind: "busy" };
    if (this.lastError) return { kind: "error", code: this.lastError };
    return { kind: "available" };
  }

  /** A refusal at submit time. Logged by code; the feature only when it is a known id, never raw input. */
  private rejected(code: AiRejectCode, reason: AiUnavailableReason | undefined, feature: unknown): AiJobOutcome {
    this.counters.rejected += 1;
    this.deps.log?.("info", `ai job ${isAiFeatureId(feature) ? feature : "unknown"}: rejected/${code}`);
    return reason ? { status: "rejected", code, reason } : { status: "rejected", code };
  }

  private finish(job: QueuedJob, outcome: AiJobOutcome): void {
    if (job.settled) return;
    job.settled = true;
    if (outcome.status === "ok") this.counters.completed += 1;
    else if (outcome.status === "failed") this.counters.failed += 1;
    else if (outcome.status === "cancelled") this.counters.cancelled += 1;
    else this.counters.rejected += 1;
    this.deps.log?.("info", `ai job ${job.request.feature}: ${outcome.status}${"code" in outcome ? `/${outcome.code}` : ""}`);
    job.resolve(outcome);
  }

  /** Interactive before background; `front` puts a yielded job back at the head of its class. */
  private enqueue(job: QueuedJob, front: boolean): void {
    const firstBackground = this.queue.findIndex((queued) => queued.request.priority === "background");
    let index: number;
    if (job.request.priority === "interactive") index = front ? 0 : firstBackground;
    else index = front ? firstBackground : -1;
    this.queue.splice(index === -1 ? this.queue.length : index, 0, job);
  }

  private admissionView(): AiAdmissionView {
    try {
      return this.deps.admission();
    } catch {
      return HELD_VIEW; // an unreadable engine view holds inference rather than guessing
    }
  }

  private admit(settings: AiServiceSettings) {
    return decideAiAdmission(this.admissionView(), {
      yieldDuringRuns: settings.yieldDuringRuns,
      minFreeMemoryMb: settings.minFreeMemoryMb,
      inferenceWeight: this.deps.inferenceWeight
    });
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.retryTimer = null;
    this.idleTimer = null;
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    this.clearTimers();
    let settings: AiServiceSettings | null = null;
    try {
      while (!this.disposed && this.queue.length > 0) {
        settings = await this.deps.settings().catch(() => null);
        if (!settings?.enabled) {
          for (const job of this.queue.splice(0)) this.finish(job, { status: "rejected", code: "DISABLED", reason: "DISABLED" });
          break;
        }
        const decision = this.admit(settings);
        if (!decision.admit) {
          this.holdReason = decision.reason;
          this.retryTimer = unref(setTimeout(() => void this.pump(), this.limits.admissionRetryMs));
          break;
        }
        this.holdReason = null;
        const job = this.queue.shift()!;
        this.executing = this.execute(job, settings).catch(() => {
          this.finish(job, { status: "failed", code: "HOST_ERROR", yields: job.yields });
        });
        await this.executing;
        this.executing = null;
      }
    } finally {
      this.pumping = false;
    }
    if (!this.disposed && this.queue.length === 0 && settings && settings.idleUnloadMs > 0 && this.loadedModelId) {
      this.idleTimer = unref(setTimeout(() => void this.unloadIfIdle(), settings.idleUnloadMs));
    }
  }

  private cancelOnHost(hostJobId: string): Promise<unknown> {
    const backend = this.backend;
    const transport = this.deps.transport(backend);
    if (!transport) return Promise.resolve();
    return transport.call({ type: "cancel", jobId: hostJobId }, AI_HOST_TIMEOUTS.cancelMs).catch((error: unknown) => {
      // The host was killed to free it (awkit-g555), or went away meanwhile: the model went with it.
      if (error instanceof AiHostCallError && (error.reason === "AI_HOST_KILLED_ON_CANCEL" || error.reason === "AI_HOST_EXITED")) this.forgetHost(backend);
    });
  }

  private forgetHost(backend: AiHostBackend = this.backend): void {
    this.handshaken.delete(backend);
    if (this.backend === backend) {
      this.loadedModelId = null;
      this.profileKey = null;
    }
  }

  /**
   * The GPU host's inference failed or the host exited after a successful load (L8a.5): count the loss
   * for this setting and free the GPU. A failed inference leaves the host alive and holding VRAM.
   */
  private async gpuLost(settings: AiServiceSettings): Promise<void> {
    const key = this.executionKey(settings);
    this.gpuLosses = { key, count: this.gpuLosses?.key === key ? this.gpuLosses.count + 1 : 1 };
    this.deps.log?.("warn", `ai gpu lost after load (${this.gpuLosses.count} of ${GPU_LOSS_LIMIT} for this setting)`);
    await this.releaseGpuHost();
  }

  /** Stop the GPU host, if any, so its VRAM and the backend files it loaded are freed. */
  private async releaseGpuHost(): Promise<void> {
    const gpu = this.deps.transport("vulkan");
    if (!gpu || gpu === this.deps.transport("cpu")) return;
    this.forgetHost("vulkan");
    await gpu.release?.().catch(() => undefined);
  }

  /** Drop the current load before loading for another model, mode or reserve. Runs between jobs only. */
  private async dropLoad(): Promise<void> {
    const previous = this.backend;
    const hadModel = this.loadedModelId !== null;
    this.loadedModelId = null;
    this.profileKey = null;
    if (hadModel) await this.deps.transport(previous)?.call({ type: "unload" }, AI_HOST_TIMEOUTS.unloadMs).catch(() => undefined);
    if (previous === "vulkan") await this.releaseGpuHost();
    this.backend = "cpu";
  }

  private hello(transport: AiHostTransport): Promise<AiHostHello> {
    return transport.call<AiHostHello>({ type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } }, AI_HOST_TIMEOUTS.helloMs);
  }

  /**
   * Handshake and model load on the host the execution mode calls for. Returns "ready" or the job's
   * outcome. A loaded model is kept while the model, mode and reserve are unchanged; anything else drops
   * the load first. This runs between jobs, so a mode change never lands mid-inference.
   */
  private async ensureReady(settings: AiServiceSettings): Promise<"ready" | AiJobOutcome> {
    const model = await this.deps.model().catch((): AiModelResolution => ({ ok: false, reason: "MODEL_INVALID" }));
    if (!model.ok) return { status: "rejected", code: "UNAVAILABLE", reason: model.reason };
    const key = this.executionKey(settings);
    const active = this.deps.transport(this.backend);
    if (this.loadedModelId === model.modelId && this.profileKey === key && this.handshaken.has(this.backend) && active?.isAvailable()) return "ready";
    if (this.loadedModelId !== null) this.stage = "unloading";
    try {
      await this.dropLoad();
      this.loading = true;
      this.plan = null;
      this.stage = "verifying-model";
      if (this.deps.verifyModel && !(await this.deps.verifyModel(model).catch(() => false))) {
        this.lastError = "AI_MODEL_LOAD_FAILED";
        return { status: "failed", code: "LOAD_FAILED", yields: 0 };
      }
      const mode = settings.executionMode ?? "cpu";
      let fallbackReason: AiGpuReason | null = null;
      if (mode !== "cpu") {
        const gpu = await this.loadOnGpu(mode, settings.vramReserveBytes ?? null, model, key);
        if (gpu.kind === "ready") {
          this.profileKey = key;
          this.profileFor = key;
          this.refusedKey = null;
          return "ready";
        }
        if (gpu.kind === "refuse") {
          this.profile = {
            mode,
            backend: "vulkan",
            gpuLayers: 0,
            totalLayers: gpu.totalLayers,
            requestedLayers: null,
            fallbackReason: null,
            refusal: { reason: gpu.reason, requiredBytes: gpu.requiredBytes, availableBytes: gpu.availableBytes },
            vram: vramOf(this.plan)
          };
          this.profileFor = key;
          this.refusedKey = key;
          this.deps.log?.("warn", `ai gpu-only refused: ${gpu.reason}`);
          return { status: "rejected", code: "UNAVAILABLE", reason: "GPU_UNAVAILABLE" };
        }
        fallbackReason = gpu.reason;
        this.deps.log?.("warn", `ai gpu-offload falling back to CPU: ${gpu.reason}`);
      }
      return await this.loadOnCpu(mode, key, fallbackReason, model);
    } finally {
      this.loading = false;
      this.stage = null;
    }
  }

  private async loadOnCpu(
    mode: AiExecutionMode,
    key: string,
    fallbackReason: AiGpuReason | null,
    model: Extract<AiModelResolution, { ok: true }>
  ): Promise<"ready" | AiJobOutcome> {
    const transport = this.deps.transport("cpu");
    if (!transport) return { status: "rejected", code: "UNAVAILABLE", reason: "RUNTIME_MISSING" };
    if (!transport.isAvailable()) return { status: "rejected", code: "UNAVAILABLE", reason: "CIRCUIT_OPEN" };
    this.stage = fallbackReason ? "falling-back" : "loading-cpu";
    if (!this.handshaken.has("cpu")) {
      let hello: AiHostHello;
      try {
        hello = await this.hello(transport);
      } catch (error) {
        this.lastError = error instanceof AiHostCallError ? error.reason : "AI_HOST_INTERNAL_ERROR";
        return { status: "failed", code: "HOST_ERROR", yields: 0 };
      }
      const build = this.deps.expectedRuntimeBuild;
      if (
        !hello?.compatible ||
        hello.protocolVersion !== AI_HOST_PROTOCOL_VERSION ||
        (hello.backend !== undefined && hello.backend !== "cpu") ||
        (build !== undefined && hello.runtime?.build !== build)
      ) {
        this.incompatible = true;
        this.lastError = "AI_RUNTIME_INCOMPATIBLE";
        return { status: "rejected", code: "UNAVAILABLE", reason: "RUNTIME_INCOMPATIBLE" };
      }
      this.handshaken.add("cpu");
    }
    try {
      await transport.call(
        { type: "load", modelPath: model.modelPath, contextTokens: Math.min(model.contextTokens, AI_CONTEXT_TOKENS), threads: this.deps.threads },
        AI_HOST_TIMEOUTS.loadMs
      );
      this.backend = "cpu";
      this.loadedModelId = model.modelId;
      this.profileKey = key;
      this.profileFor = key;
      this.refusedKey = null;
      this.profile = { ...CPU_PROFILE, mode, fallbackReason, vram: vramOf(this.plan) };
      return "ready";
    } catch (error) {
      this.lastError = error instanceof AiHostCallError ? error.reason : "AI_HOST_INTERNAL_ERROR";
      this.forgetHost("cpu");
      return { status: "failed", code: "LOAD_FAILED", yields: 0 };
    }
  }

  /**
   * A GPU mode's load: readiness (pack and adapters), the GPU host's handshake (the manager verifies the
   * pack before starting it), the runtime's plan, E2's device proof, the mode's decision, and for
   * GPU-Offload a bounded smaller retry. Anything short of "ready" stops the GPU host so it holds no VRAM.
   */
  private async loadOnGpu(
    mode: Exclude<AiExecutionMode, "cpu">,
    reserveBytes: number | null,
    model: Extract<AiModelResolution, { ok: true }>,
    key: string
  ): Promise<
    | { kind: "ready" }
    | { kind: "fallback"; reason: AiGpuReason }
    | { kind: "refuse"; reason: AiGpuReason; requiredBytes: number | null; availableBytes: number | null; totalLayers: number | null }
  > {
    type Outcome = Awaited<ReturnType<AiService["loadOnGpu"]>>;
    const notOnGpu = (reason: AiGpuReason, totalLayers: number | null = null): Outcome =>
      mode === "gpu-only" ? { kind: "refuse", reason, requiredBytes: null, availableBytes: null, totalLayers } : { kind: "fallback", reason };
    const settle = async (outcome: Outcome): Promise<Outcome> => {
      if (outcome.kind !== "ready") await this.releaseGpuHost();
      return outcome;
    };
    const reasonOf = (error: unknown): AiHostReason | null => (error instanceof AiHostCallError ? error.reason : null);

    this.stage = "checking-gpu";
    // Lost after load too often under this setting: it stays off the GPU for the session (L8a.5).
    if (this.gpuLosses?.key === key && this.gpuLosses.count >= GPU_LOSS_LIMIT) return notOnGpu("LOST_AFTER_LOAD");
    const readiness: AiGpuReadiness = this.deps.gpu
      ? await this.deps.gpu().catch((): AiGpuReadiness => ({ ok: false, reason: "BACKEND_UNAVAILABLE" }))
      : { ok: false, reason: "BACKEND_UNAVAILABLE" };
    if (!readiness.ok) return notOnGpu(readiness.reason);
    const transport = this.deps.transport("vulkan");
    if (!transport || !transport.isAvailable()) return notOnGpu("BACKEND_UNAVAILABLE");

    if (!this.handshaken.has("vulkan")) {
      this.stage = "starting-gpu-host";
      let hello: AiHostHello;
      try {
        hello = await this.hello(transport);
      } catch (error) {
        return settle(notOnGpu(reasonOf(error) === "AI_GPU_BACKEND_REFUSED" ? "BACKEND_PACK_INVALID" : "BACKEND_UNAVAILABLE"));
      }
      const build = this.deps.expectedRuntimeBuild;
      if (!hello?.compatible || hello.protocolVersion !== AI_HOST_PROTOCOL_VERSION || hello.backend !== "vulkan" || (build !== undefined && hello.runtime?.build !== build)) {
        return settle(notOnGpu("BACKEND_UNAVAILABLE"));
      }
      this.handshaken.add("vulkan");
    }

    const contextTokens = Math.min(model.contextTokens, AI_CONTEXT_TOKENS);
    this.stage = "planning-gpu";
    let plan: AiGpuPlan;
    try {
      plan = await transport.call<AiGpuPlan>(
        { type: "gpuPlan", modelPath: model.modelPath, contextTokens, threads: this.deps.threads, reserveBytes },
        AI_HOST_TIMEOUTS.loadMs
      );
      this.plan = plan;
    } catch (error) {
      const reason = reasonOf(error);
      return settle(
        notOnGpu(
          reason === "AI_GPU_NO_USABLE_DEVICE"
            ? "NO_USABLE_DEVICE"
            : reason === "AI_GPU_BACKEND_UNAVAILABLE"
              ? "BACKEND_UNAVAILABLE"
              : reason === "AI_GPU_BACKEND_REFUSED"
                ? "BACKEND_PACK_INVALID"
                : "GPU_LOAD_FAILED"
        )
      );
    }
    const unproven = unprovenDevices(plan.deviceCount, readiness.nvidiaAdapters);
    if (unproven) return settle(notOnGpu(unproven, plan.totalLayers));
    const decision = decideGpuLoad(mode, plan);
    if (decision.action === "refuse") {
      return settle({ kind: "refuse", reason: decision.reason, requiredBytes: decision.requiredBytes, availableBytes: decision.availableBytes, totalLayers: plan.totalLayers });
    }
    if (decision.action === "fallback") return settle({ kind: "fallback", reason: decision.reason });

    let layers = decision.layers;
    for (let retries = 0; ; retries += 1) {
      this.stage = retries === 0 ? "loading-gpu" : "retrying-gpu";
      try {
        const result = await transport.call<AiLoadResult>(
          { type: "load", modelPath: model.modelPath, contextTokens, threads: this.deps.threads, gpuLayers: layers },
          AI_HOST_TIMEOUTS.loadMs
        );
        this.backend = "vulkan";
        this.loadedModelId = model.modelId;
        this.profile = {
          mode,
          backend: "vulkan",
          gpuLayers: Number.isInteger(result?.gpuLayers) ? (result.gpuLayers as number) : layers,
          totalLayers: plan.totalLayers,
          requestedLayers: decision.layers,
          fallbackReason: null,
          refusal: null,
          vram: vramOf(plan)
        };
        return { kind: "ready" };
      } catch (error) {
        this.lastError = reasonOf(error) ?? "AI_HOST_INTERNAL_ERROR";
        // GPU-Only needs every layer, so a smaller retry would change what the mode means.
        const next = mode === "gpu-offload" && reasonOf(error) === "AI_GPU_LOAD_FAILED" ? retryLayers(layers, retries) : null;
        if (next === null) return settle(notOnGpu("GPU_LOAD_FAILED", plan.totalLayers));
        this.deps.log?.("info", `ai gpu load failed at ${layers} layers; retrying with ${next}`);
        layers = next;
      }
    }
  }

  private async execute(job: QueuedJob, settings: AiServiceSettings): Promise<void> {
    this.running = job;
    try {
      if (!this.deps.transport("cpu")) {
        this.finish(job, { status: "rejected", code: "UNAVAILABLE", reason: "RUNTIME_MISSING" });
        return;
      }
      const ready = await this.ensureReady(settings);
      if (ready !== "ready") {
        this.finish(job, ready.status === "failed" ? { ...ready, yields: job.yields } : ready);
        return;
      }
      // The host the model was just loaded on, CPU or GPU.
      const backend = this.backend;
      const transport = this.deps.transport(backend);
      if (!transport) {
        this.finish(job, { status: "rejected", code: "UNAVAILABLE", reason: "RUNTIME_MISSING" });
        return;
      }
      if (job.userCancelled) {
        this.finish(job, { status: "cancelled", yields: job.yields });
        return;
      }

      const hostJobId = `${job.request.requestId}#${++this.attempt}`;
      job.hostJobId = hostJobId;
      let yielded = false;
      const watcher = setInterval(() => {
        if (yielded || job.userCancelled) return;
        const decision = this.admit(settings);
        if (!decision.admit) {
          yielded = true;
          this.holdReason = decision.reason;
          void this.cancelOnHost(hostJobId);
        }
      }, this.limits.yieldCheckMs);

      let result: AiInferResult | undefined;
      let failure: AiHostReason | undefined;
      try {
        result = await transport.call<AiInferResult>(
          {
            type: "infer",
            jobId: hostJobId,
            system: job.system,
            user: job.user,
            jsonSchema: job.request.schema as unknown as Record<string, unknown>,
            maxPromptTokens: AI_MAX_PROMPT_TOKENS,
            maxOutputTokens: job.request.maxOutputTokens,
            thinking: false,
            temperature: 0,
            seed: 0
          },
          job.request.timeoutMs
        );
      } catch (error) {
        failure = error instanceof AiHostCallError ? error.reason : "AI_HOST_INTERNAL_ERROR";
      } finally {
        clearInterval(watcher);
        job.hostJobId = null;
      }

      // Whatever else happened, a host that exited or was killed no longer holds the model.
      if (failure === "AI_HOST_EXITED" || failure === "AI_MODEL_NOT_LOADED" || failure === "AI_HOST_KILLED_ON_CANCEL") this.forgetHost(backend);
      if (backend === "vulkan" && (failure === "AI_HOST_EXITED" || failure === "AI_INFERENCE_FAILED")) await this.gpuLost(settings);
      if (job.userCancelled) {
        this.finish(job, { status: "cancelled", yields: job.yields });
        return;
      }
      // A host the manager killed to honour a cancel the runtime could not (awkit-g555) ends the job
      // exactly as a cooperative cancel does.
      if (failure === "AI_HOST_KILLED_ON_CANCEL" || result?.stopReason === "cancelled") {
        if (!yielded) {
          this.finish(job, { status: "failed", code: "HOST_ERROR", yields: job.yields });
          return;
        }
        job.yields += 1;
        this.counters.yielded += 1;
        if (job.yields > this.limits.maxYields) this.finish(job, { status: "failed", code: "YIELD_LIMIT", yields: job.yields });
        else this.enqueue(job, true);
        return;
      }
      if (failure || !result) {
        if (failure === "AI_HOST_TIMEOUT") {
          // The runtime keeps generating past the manager's deadline. Free it (bounded) before the
          // next job starts, or two inferences would overlap on the host.
          await this.cancelOnHost(hostJobId);
          this.finish(job, { status: "failed", code: "TIMEOUT", yields: job.yields });
          return;
        }
        this.lastError = failure ?? "AI_HOST_INTERNAL_ERROR";
        this.finish(job, { status: "failed", code: "HOST_ERROR", yields: job.yields });
        return;
      }
      // A job asked to yield that finished first keeps its result: the work is already done.
      const parsed = parseAiOutput(result.text, job.request.schema);
      if (!parsed.ok) {
        this.finish(job, { status: "failed", code: parsed.code, yields: job.yields });
        return;
      }
      this.lastError = null;
      this.finish(job, {
        status: "ok",
        value: parsed.value,
        modelId: this.loadedModelId ?? "unknown",
        usage: {
          promptTokens: result.promptTokens,
          outputTokens: result.outputTokens,
          firstTokenMs: result.timings?.firstTokenMs ?? 0,
          generationMs: result.timings?.generationMs ?? 0
        },
        yields: job.yields
      });
    } finally {
      this.running = null;
    }
  }

  private async unloadIfIdle(): Promise<void> {
    if (this.disposed || this.running || this.queue.length > 0 || !this.loadedModelId) return;
    const backend = this.backend;
    const transport = this.deps.transport(backend);
    // Forget first: a job arriving while the unload is in flight reloads, and the host handles
    // messages in order, so the unload can never land after that load.
    this.loadedModelId = null;
    this.profileKey = null;
    await transport?.call({ type: "unload" }, AI_HOST_TIMEOUTS.unloadMs).catch(() => undefined);
    // An idle GPU host would keep its device context in VRAM; the next job re-plans on a fresh one.
    if (backend === "vulkan") await this.releaseGpuHost();
  }
}
