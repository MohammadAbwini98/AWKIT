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
 */

import { randomBytes } from "node:crypto";

import { isAiFeatureId, type AiFeatureId } from "../security/authz/AiAutonomyPolicy";
import { SemanticRedactor } from "../semantic/SemanticRedactor";
import { decideAiAdmission, type AiAdmissionHoldReason, type AiAdmissionView } from "./AiAdmission";
import { isBoundedSchema, parseAiOutput, type AiOutputSchema } from "./AiOutputContract";
import { buildAiPrompt, type AiPromptSpec } from "./AiPromptBuilder";
import {
  AI_CONTEXT_TOKENS,
  AI_HOST_PROTOCOL_VERSION,
  AI_HOST_TIMEOUTS,
  AI_MAX_OUTPUT_TOKENS,
  AI_MAX_PROMPT_TOKENS,
  AiHostCallError,
  type AiHostHello,
  type AiHostReason,
  type AiHostTransport,
  type AiInferResult
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
  maxJobTimeoutMs: 120_000,
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
  counters: { completed: number; failed: number; cancelled: number; rejected: number; yielded: number };
}

export interface AiServiceSettings {
  enabled: boolean;
  yieldDuringRuns: boolean;
  /** Unload the model after this long idle; 0 keeps it loaded. */
  idleUnloadMs: number;
  minFreeMemoryMb: number;
}

export type AiModelResolution =
  | { ok: true; modelId: string; modelPath: string; contextTokens: number }
  | { ok: false; reason: "MODEL_MISSING" | "MODEL_INVALID" };

export interface AiServiceDeps {
  /** Null when the runtime is not part of this build. */
  transport: () => AiHostTransport | null;
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
  private handshaken = false;
  private incompatible = false;
  private loading = false;
  private loadedModelId: string | null = null;
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

  /** Unload the model now if nothing is running or queued, e.g. before its file is replaced. */
  releaseModel(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    return this.unloadIfIdle();
  }

  async status(): Promise<AiServiceStatus> {
    return {
      state: await this.state(),
      queueDepth: this.queue.length,
      holdReason: this.holdReason,
      loadedModelId: this.loadedModelId,
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
    await this.deps.transport()?.dispose().catch(() => undefined);
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
    const transport = this.deps.transport();
    if (!transport) return "RUNTIME_MISSING";
    if (!transport.isAvailable()) return "CIRCUIT_OPEN";
    if (this.incompatible) return "RUNTIME_INCOMPATIBLE";
    const model = await this.deps.model().catch((): AiModelResolution => ({ ok: false, reason: "MODEL_INVALID" }));
    return model.ok ? null : model.reason;
  }

  private async state(): Promise<AiServiceState> {
    if (this.disposed) return { kind: "unavailable", reason: "SHUTDOWN" };
    const settings = await this.deps.settings().catch(() => null);
    if (!settings?.enabled) return { kind: "unavailable", reason: "DISABLED" };
    const unavailable = await this.unavailableReason();
    if (unavailable) return { kind: "unavailable", reason: unavailable };
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
    const transport = this.deps.transport();
    if (!transport) return Promise.resolve();
    return transport.call({ type: "cancel", jobId: hostJobId }, AI_HOST_TIMEOUTS.cancelMs).catch((error: unknown) => {
      // The host was killed to free it (awkit-g555), or went away meanwhile: the model went with it.
      if (error instanceof AiHostCallError && (error.reason === "AI_HOST_KILLED_ON_CANCEL" || error.reason === "AI_HOST_EXITED")) this.forgetHost();
    });
  }

  private forgetHost(): void {
    this.handshaken = false;
    this.loadedModelId = null;
  }

  /** Handshake and model load. Returns "ready" or the job's outcome. */
  private async ensureReady(transport: AiHostTransport): Promise<"ready" | AiJobOutcome> {
    if (!transport.isAvailable()) return { status: "rejected", code: "UNAVAILABLE", reason: "CIRCUIT_OPEN" };
    if (!this.handshaken) {
      let hello: AiHostHello;
      try {
        hello = await transport.call<AiHostHello>({ type: "hello", expected: { protocolVersion: AI_HOST_PROTOCOL_VERSION } }, AI_HOST_TIMEOUTS.helloMs);
      } catch (error) {
        this.lastError = error instanceof AiHostCallError ? error.reason : "AI_HOST_INTERNAL_ERROR";
        return { status: "failed", code: "HOST_ERROR", yields: 0 };
      }
      const build = this.deps.expectedRuntimeBuild;
      if (!hello?.compatible || hello.protocolVersion !== AI_HOST_PROTOCOL_VERSION || (build !== undefined && hello.runtime?.build !== build)) {
        this.incompatible = true;
        this.lastError = "AI_RUNTIME_INCOMPATIBLE";
        return { status: "rejected", code: "UNAVAILABLE", reason: "RUNTIME_INCOMPATIBLE" };
      }
      this.handshaken = true;
    }
    const model = await this.deps.model().catch((): AiModelResolution => ({ ok: false, reason: "MODEL_INVALID" }));
    if (!model.ok) return { status: "rejected", code: "UNAVAILABLE", reason: model.reason };
    if (this.loadedModelId === model.modelId) return "ready";
    this.loading = true;
    try {
      if (this.deps.verifyModel && !(await this.deps.verifyModel(model).catch(() => false))) {
        this.lastError = "AI_MODEL_LOAD_FAILED";
        return { status: "failed", code: "LOAD_FAILED", yields: 0 };
      }
      await transport.call(
        { type: "load", modelPath: model.modelPath, contextTokens: Math.min(model.contextTokens, AI_CONTEXT_TOKENS), threads: this.deps.threads },
        AI_HOST_TIMEOUTS.loadMs
      );
      this.loadedModelId = model.modelId;
      return "ready";
    } catch (error) {
      this.lastError = error instanceof AiHostCallError ? error.reason : "AI_HOST_INTERNAL_ERROR";
      this.forgetHost();
      return { status: "failed", code: "LOAD_FAILED", yields: 0 };
    } finally {
      this.loading = false;
    }
  }

  private async execute(job: QueuedJob, settings: AiServiceSettings): Promise<void> {
    this.running = job;
    try {
      const transport = this.deps.transport();
      if (!transport) {
        this.finish(job, { status: "rejected", code: "UNAVAILABLE", reason: "RUNTIME_MISSING" });
        return;
      }
      const ready = await this.ensureReady(transport);
      if (ready !== "ready") {
        this.finish(job, ready.status === "failed" ? { ...ready, yields: job.yields } : ready);
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
      if (failure === "AI_HOST_EXITED" || failure === "AI_MODEL_NOT_LOADED" || failure === "AI_HOST_KILLED_ON_CANCEL") this.forgetHost();
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
    const transport = this.deps.transport();
    // Forget first: a job arriving while the unload is in flight reloads, and the host handles
    // messages in order, so the unload can never land after that load.
    this.loadedModelId = null;
    await transport?.call({ type: "unload" }, AI_HOST_TIMEOUTS.unloadMs).catch(() => undefined);
  }
}
