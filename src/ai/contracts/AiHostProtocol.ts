/**
 * Wire protocol for the local-AI utility host (Phase L, L1.1).
 *
 * Transport: an Electron `utilityProcess` MessagePort, exactly like the Zvec host; structured clone,
 * no TCP listener. Every message is versioned, every request is correlated by id, and no raw native
 * or runtime error text crosses the boundary: failures are the stable, path-free reason codes below.
 *
 * The host owns inference only. It never sees a filesystem path it did not get from the manager at
 * fork time (the model root), never decides what a prompt contains, and never persists a prompt or a
 * response. Constrained decoding is mandatory: an `infer` without a JSON schema is refused.
 *
 * Framework-agnostic: no Electron, no filesystem.
 */

export const AI_HOST_PROTOCOL_VERSION = 1;

/** 4K context ceiling from the model baseline; feature packets are much smaller. */
export const AI_CONTEXT_TOKENS = 4096;
export const AI_MAX_PROMPT_TOKENS = 3072;
export const AI_MAX_OUTPUT_TOKENS = 512;
/** Bounds the host enforces on GPU requests (L8a.3); values outside them are protocol violations. */
export const AI_MAX_GPU_LAYERS = 1024;
export const AI_MAX_VRAM_RESERVE_BYTES = 68719476736;

/** The backend a host process runs, fixed when the manager forks it. */
export type AiHostBackend = "cpu" | "vulkan";

export type AiHostReason =
  // ── raised by the host ──
  | "AI_MODEL_PATH_OUTSIDE_ROOT"
  | "AI_MODEL_LOAD_FAILED"
  | "AI_MODEL_NOT_LOADED"
  | "AI_PROMPT_TOO_LONG"
  | "AI_SCHEMA_REQUIRED"
  | "AI_INFERENCE_FAILED"
  | "AI_UNKNOWN_REQUEST"
  | "AI_PROTOCOL_VIOLATION"
  | "AI_HOST_INTERNAL_ERROR"
  /** A GPU host could not install its backend (no pack directory, or no resolve hook in this runtime). */
  | "AI_GPU_BACKEND_UNAVAILABLE"
  /** The runtime bound no usable GPU device (it reports this as a missing binary, L8a.0). */
  | "AI_GPU_NO_USABLE_DEVICE"
  /** A GPU load with the requested layer count failed (typically memory); the caller may retry smaller. */
  | "AI_GPU_LOAD_FAILED"
  // ── raised by the manager, never by the host ──
  /** The backend pack failed its load-time integrity check, so no GPU host was started. */
  | "AI_GPU_BACKEND_REFUSED"
  | "AI_HOST_EXITED"
  /** A cancel the host did not honour within `cancelGraceMs`, so the manager killed it (the model is gone). */
  | "AI_HOST_KILLED_ON_CANCEL"
  | "AI_HOST_TIMEOUT"
  | "AI_HOST_UNAVAILABLE"
  | "AI_RUNTIME_INCOMPATIBLE"
  | "AI_CIRCUIT_OPEN"
  | "AI_DISPOSED";

export interface AiLoadRequest {
  type: "load";
  /** Absolute path under the model root the host fixed at fork time; anything else is refused. */
  modelPath: string;
  contextTokens: number;
  threads: number;
  /**
   * Layers to offload. A GPU host requires 1..AI_MAX_GPU_LAYERS; the CPU host accepts only absent or 0.
   * Resolved once from `gpuPlan` and sent as a number, never "auto" (L8a.0).
   */
  gpuLayers?: number;
}

/** Measure a GPU host's devices, VRAM and the model's per-layer need; loads nothing. GPU hosts only. */
export interface AiGpuPlanRequest {
  type: "gpuPlan";
  modelPath: string;
  contextTokens: number;
  threads: number;
  /** VRAM kept free beside the model and context; null is the runtime's own padding. */
  reserveBytes: number | null;
}

/** Numbers only, path-free: what the runtime measured and estimated. */
export interface AiGpuPlan {
  /** Vulkan devices the runtime binds. */
  deviceCount: number;
  totalLayers: number;
  /** The largest layer count whose estimate fits beside the reserve; 0 when not even one does. */
  fitLayers: number;
  /** Estimated VRAM for every layer plus the context, excluding the reserve. */
  fullRequiredBytes: number;
  reserveBytes: number;
  freeBytes: number;
  totalBytes: number;
}

/** Read a model's GGUF header with the pinned runtime's own reader (L8b.2); loads nothing. */
export interface AiInspectRequest {
  type: "inspect";
  modelPath: string;
}

/**
 * Path-free facts from a GGUF header. `readable: false` means the runtime's reader refused the file.
 * The host names only what the pinned runtime knows; `AiModelCompatibility` decides from these.
 */
export type AiModelHeader =
  | { readable: false }
  | {
      readable: true;
      ggufVersion: number | null;
      /** `general.architecture` when it is a plain short name, else null. */
      architecture: string | null;
      architectureKnown: boolean;
      contextLength: number | null;
      blockCount: number | null;
      tensorCount: number;
      /** Tensors whose type the pinned runtime does not name. */
      unknownTensorTypes: number;
      /** ChatML is what the host prompts with; any other template cannot be driven. */
      chatTemplate: "chatml" | "other" | "missing";
    };

/**
 * The dynamic stage (L8b.3): load a confined model on the CPU host, run the fixed probe below, and
 * release it again. CPU hosts only; it leaves nothing loaded. Cancellable by `jobId`.
 */
export interface AiProbeRequest {
  type: "probe";
  jobId: string;
  modelPath: string;
  contextTokens: number;
  threads: number;
}

/**
 * The probe's fixed prompt and schema, mirrored by the host (verify:ai-host checks the two agree). The
 * question is the host's own, never caller text, and the answer is one enum value.
 */
export const AI_PROBE = Object.freeze({
  system: "You answer with JSON only.",
  user: "Is water wet? Answer yes or no.",
  schema: { type: "object", properties: { answer: { type: "string", enum: ["yes", "no"] } }, required: ["answer"], additionalProperties: false },
  /** Unconstrained, greedy tokens read for a think marker; never returned. */
  thinkTokens: 16,
  /** The schema-constrained answer's bound. */
  outputTokens: 32
} as const);

/**
 * What the probe observed. `loaded: false` means the runtime could not load the model or create its
 * context. `thinkingOff` is whether the first `AI_PROBE.thinkTokens` tokens after the product's own
 * thinking-off prompt opened no think block. `text` is the grammar-constrained answer only, which the
 * main process validates with `parseAiOutput` like any product answer. `failed` means the loaded model
 * could not generate (its runtime error text stays in the host); `cancelled` means the probe observed nothing.
 */
export type AiModelProbe =
  | { loaded: false }
  | { loaded: true; loadMs: number; thinkingOff: boolean; text: string; stopReason: "stop" | "length" | "cancelled" | "failed" };

export interface AiInferRequest {
  type: "infer";
  jobId: string;
  system: string;
  user: string;
  /** JSON schema the runtime compiles to a grammar. Required: unconstrained generation is refused. */
  jsonSchema: Record<string, unknown>;
  maxPromptTokens: number;
  maxOutputTokens: number;
  /** Always false for product prompts (Qwen chat-template `enable_thinking`). */
  thinking: false;
  temperature: number;
  seed: number;
}

export type AiHostRequestPayload =
  | { type: "hello"; expected: { protocolVersion: number } }
  | AiLoadRequest
  | AiGpuPlanRequest
  | AiInspectRequest
  | AiProbeRequest
  | AiInferRequest
  | { type: "cancel"; jobId: string }
  | { type: "unload" }
  | { type: "shutdown" };

export type AiHostRequest = AiHostRequestPayload & { version: 1; id: string };

export interface AiHostHello {
  protocolVersion: number;
  compatible: boolean;
  /** Pinned runtime identity, e.g. the llama.cpp build tag; compared against the manifest. */
  runtime: { name: string; build: string };
  /** Absent from a host older than L8a.3, which is the CPU host. */
  backend?: AiHostBackend;
  platform: string;
  arch: string;
}

export interface AiLoadResult {
  loadMs: number;
  backend?: AiHostBackend;
  /** Layers the runtime actually offloaded; 0 on the CPU host. */
  gpuLayers?: number;
}

export interface AiInferResult {
  text: string;
  promptTokens: number;
  outputTokens: number;
  stopReason: "stop" | "length" | "cancelled";
  timings: { promptMs: number; generationMs: number; firstTokenMs: number };
}

export type AiHostResponse =
  | { version: 1; id: string; ok: true; value?: unknown }
  | { version: 1; id: string; ok: false; reason: AiHostReason; retryable: boolean };

export type AiHostEvent = { version: 1; type: "ready"; pid: number } | { version: 1; type: "fatal"; reason: AiHostReason };

/**
 * L9.1: what a request in flight is doing, sent only for the request that asked (`id`) and only where
 * the runtime itself reports it: `load` with the runtime's own load fraction (0..1) during a `load` or a
 * `probe`, and `generation` once, at the first generated token of an `infer`. Nothing else, never text.
 */
export type AiHostProgress = { version: 1; type: "progress"; id: string; stage: "load"; fraction: number } | { version: 1; type: "progress"; id: string; stage: "generation" };

/** The progress a transport hands its caller: the message without its envelope. */
export type AiHostProgressUpdate = { stage: "load"; fraction: number } | { stage: "generation" };

export function isAiHostProgress(message: unknown): message is AiHostProgress {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { version?: unknown; type?: unknown; id?: unknown; stage?: unknown; fraction?: unknown };
  if (m.version !== AI_HOST_PROTOCOL_VERSION || m.type !== "progress" || typeof m.id !== "string") return false;
  if (m.stage === "generation") return true;
  return m.stage === "load" && typeof m.fraction === "number" && Number.isFinite(m.fraction) && m.fraction >= 0 && m.fraction <= 1;
}

/** What `AiService` needs from a host: the Electron manager in production, the fake everywhere else. */
export interface AiHostTransport {
  /** `onProgress` hears this request's own progress messages, if the host sends any. */
  call<T = unknown>(request: AiHostRequestPayload, timeoutMs: number, onProgress?: (progress: AiHostProgressUpdate) => void): Promise<T>;
  /** False once the circuit is open or the transport is disposed. */
  isAvailable(): boolean;
  /**
   * Stop the host process now (freeing its RAM and any VRAM); unlike `dispose`, the next call starts a
   * fresh one. Optional: a transport without it keeps its process until disposed.
   */
  release?(): Promise<void>;
  dispose(): Promise<unknown>;
}

/** Error carrying a stable reason code; raw runtime text never reaches a caller. */
export class AiHostCallError extends Error {
  constructor(
    readonly reason: AiHostReason,
    readonly retryable = false
  ) {
    super(reason);
    this.name = "AiHostCallError";
  }
}

export const AI_HOST_TIMEOUTS = {
  spawnAndReadyMs: 10_000,
  helloMs: 5_000,
  /** A 4B Q4 model loads in seconds from a warm cache; a cold disk is slower. */
  loadMs: 120_000,
  /**
   * A header read, queued behind any running inference. The host stops its own read at 20 s (a crafted
   * header can claim endless entries), so it answers before this and its queue is freed.
   */
  inspectMs: 30_000,
  /** A cold load (`loadMs`) plus the probe's 48 bounded tokens on a slow CPU; a timed-out probe is cancelled. */
  probeMs: 240_000,
  cancelMs: 2_000,
  /**
   * How long a cancelled inference may keep the host before the manager kills and lazily restarts
   * it (awkit-g555). The runtime did not observe an abort until prompt evaluation ended: 74 s,
   * measured. Kept under the 3 s L1.8 cancel ceiling with room for the kill. A cancel the host
   * honours inside it costs no reload.
   */
  cancelGraceMs: 1_000,
  unloadMs: 5_000,
  gracefulShutdownMs: 2_000,
  terminateGraceMs: 250
} as const;

/** Same shape and values as the Zvec host: a host that keeps dying stays down for the session. */
export const AI_HOST_RESTART_POLICY = {
  maxRestartsInWindow: 2,
  windowMs: 5 * 60_000,
  restartDelayMs: 1_000
} as const;

export function isAiHostEvent(message: unknown): message is AiHostEvent {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { version?: unknown; type?: unknown };
  return m.version === AI_HOST_PROTOCOL_VERSION && (m.type === "ready" || m.type === "fatal");
}

export function isAiHostResponse(message: unknown): message is AiHostResponse {
  if (typeof message !== "object" || message === null) return false;
  const m = message as { version?: unknown; id?: unknown; ok?: unknown };
  return m.version === AI_HOST_PROTOCOL_VERSION && typeof m.id === "string" && typeof m.ok === "boolean";
}
