/**
 * Deterministic in-process stand-in for the local-AI utility host (Phase L, L1.7), speaking the real
 * `AiHostProtocol` shapes. Every normal verifier uses it; only `verify:ai-model-live` touches a real
 * model. It fakes the TRANSPORT only: `AiService`'s queue, admission, prompt and output logic run
 * unmodified against it.
 *
 * Like `FakeZvecHostTransport` it reproduces the real host's refusals and the manager's deadlines, so
 * it is never more permissive than production (a permissive fake relocates risk, it does not remove it):
 *  - `infer` before `load` is refused, and a process that crashed comes back with no model loaded;
 *  - `infer` without a JSON schema, or with thinking on, is refused;
 *  - a prompt over `maxPromptTokens` (estimated at 3 characters per token) is refused;
 *  - a model path outside the model root is refused;
 *  - every call honours its timeout like the manager, and a timed-out inference keeps running until
 *    it is cancelled, as a real runtime does;
 *  - `cancel` resolves the pending inference with `stopReason: "cancelled"`.
 * `crash()` simulates the host process dying; one crash more than the restart policy allows opens the
 * circuit for the session, as it does for the real manager.
 *
 * Framework-agnostic: no Electron.
 */

import { isAbsolute, relative, resolve as resolvePath } from "node:path";

import {
  AI_HOST_PROTOCOL_VERSION,
  AI_HOST_RESTART_POLICY,
  AiHostCallError,
  type AiHostHello,
  type AiHostReason,
  type AiHostRequestPayload,
  type AiHostTransport,
  type AiInferRequest,
  type AiInferResult
} from "./contracts/AiHostProtocol";

export interface FakeInferStep {
  /** Model output text. Default "{}". */
  text?: string;
  /** Generation time. Default 5 ms. */
  delayMs?: number;
  outputTokens?: number;
  /** Reject with this reason instead of answering. */
  fail?: AiHostReason;
  /** Never answer unless cancelled or timed out. */
  hang?: boolean;
  /** The host process dies partway through this inference. */
  crash?: boolean;
}

export interface FakeAiHostOptions {
  modelRoot?: string;
  runtimeBuild?: string;
  compatible?: boolean;
  loadDelayMs?: number;
  loadFails?: boolean;
  respond?: (request: AiInferRequest, index: number) => FakeInferStep | string;
}

interface PendingInference {
  resolve: (result: AiInferResult) => void;
  reject: (error: Error) => void;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class FakeAiHostTransport implements AiHostTransport {
  readonly requests: AiHostRequestPayload[] = [];
  readonly modelRoot: string;
  loadedPath: string | null = null;
  crashes = 0;
  maxConcurrentInferences = 0;
  private active = 0;
  private inferIndex = 0;
  private disposed = false;
  private readonly pending = new Map<string, PendingInference>();

  constructor(private readonly options: FakeAiHostOptions = {}) {
    this.modelRoot = resolvePath(options.modelRoot ?? "fake-model-root");
  }

  get circuitOpen(): boolean {
    return this.crashes > AI_HOST_RESTART_POLICY.maxRestartsInWindow;
  }

  isAvailable(): boolean {
    return !this.disposed && !this.circuitOpen;
  }

  inferRequests(): AiInferRequest[] {
    return this.requests.filter((request): request is AiInferRequest => request.type === "infer");
  }

  requestTypes(): string[] {
    return this.requests.map((request) => request.type);
  }

  async call<T = unknown>(request: AiHostRequestPayload, timeoutMs: number): Promise<T> {
    if (this.disposed) throw new AiHostCallError("AI_DISPOSED");
    if (this.circuitOpen) throw new AiHostCallError("AI_CIRCUIT_OPEN");
    this.requests.push(structuredClone(request));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AiHostCallError("AI_HOST_TIMEOUT")), timeoutMs);
    });
    try {
      return (await Promise.race([this.handle(request), deadline])) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The host process dies: in-flight inferences fail, and the restarted process has no model. */
  crash(): void {
    this.crashes += 1;
    this.loadedPath = null;
    for (const [jobId, pending] of this.pending) {
      this.pending.delete(jobId);
      pending.reject(new AiHostCallError("AI_HOST_EXITED", true));
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const [jobId, pending] of this.pending) {
      this.pending.delete(jobId);
      pending.reject(new AiHostCallError("AI_DISPOSED"));
    }
  }

  private async handle(request: AiHostRequestPayload): Promise<unknown> {
    switch (request.type) {
      case "hello": {
        const hello: AiHostHello = {
          protocolVersion: AI_HOST_PROTOCOL_VERSION,
          compatible: this.options.compatible ?? true,
          runtime: { name: "llama.cpp", build: this.options.runtimeBuild ?? "b-fake" },
          platform: process.platform,
          arch: process.arch
        };
        return hello;
      }
      case "load": {
        const rel = relative(this.modelRoot, resolvePath(request.modelPath));
        if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new AiHostCallError("AI_MODEL_PATH_OUTSIDE_ROOT");
        await delay(this.options.loadDelayMs ?? 5);
        if (this.options.loadFails) throw new AiHostCallError("AI_MODEL_LOAD_FAILED");
        this.loadedPath = request.modelPath;
        return { loadMs: this.options.loadDelayMs ?? 5 };
      }
      case "infer":
        return this.infer(request);
      case "cancel": {
        // A real runtime stops generating asynchronously, after the message crosses the process
        // boundary. Resolving synchronously here would hide a caller that does not wait for it.
        await delay(2);
        const pending = this.pending.get(request.jobId);
        if (!pending) return { cancelled: false };
        this.pending.delete(request.jobId);
        pending.resolve({
          text: "",
          promptTokens: 0,
          outputTokens: 0,
          stopReason: "cancelled",
          timings: { promptMs: 0, generationMs: 0, firstTokenMs: 0 }
        });
        return { cancelled: true };
      }
      case "unload":
        this.loadedPath = null;
        return { unloaded: true };
      case "shutdown":
        return {};
      default:
        throw new AiHostCallError("AI_UNKNOWN_REQUEST");
    }
  }

  private async infer(request: AiInferRequest): Promise<AiInferResult> {
    if (!this.loadedPath) throw new AiHostCallError("AI_MODEL_NOT_LOADED");
    if (!request.jsonSchema || typeof request.jsonSchema !== "object") throw new AiHostCallError("AI_SCHEMA_REQUIRED");
    if (request.thinking !== false) throw new AiHostCallError("AI_PROTOCOL_VIOLATION");
    const promptTokens = Math.ceil((request.system.length + request.user.length) / 3);
    if (promptTokens > request.maxPromptTokens) throw new AiHostCallError("AI_PROMPT_TOO_LONG");

    const scripted = this.options.respond?.(request, this.inferIndex++) ?? {};
    const step: FakeInferStep = typeof scripted === "string" ? { text: scripted } : scripted;
    if (step.fail) throw new AiHostCallError(step.fail);

    this.active += 1;
    this.maxConcurrentInferences = Math.max(this.maxConcurrentInferences, this.active);
    try {
      return await new Promise<AiInferResult>((resolve, reject) => {
        this.pending.set(request.jobId, { resolve, reject });
        const delayMs = step.delayMs ?? 5;
        if (step.crash) {
          setTimeout(() => this.crash(), delayMs);
          return;
        }
        if (step.hang) return;
        setTimeout(() => {
          if (!this.pending.delete(request.jobId)) return;
          resolve({
            text: step.text ?? "{}",
            promptTokens,
            outputTokens: Math.min(step.outputTokens ?? 16, request.maxOutputTokens),
            stopReason: "stop",
            timings: { promptMs: 1, generationMs: delayMs, firstTokenMs: 1 }
          });
        }, delayMs);
      });
    } finally {
      this.active -= 1;
    }
  }
}
