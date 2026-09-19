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
  // ── raised by the manager, never by the host ──
  | "AI_HOST_EXITED"
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
}

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
  platform: string;
  arch: string;
}

export interface AiLoadResult {
  loadMs: number;
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

/** What `AiService` needs from a host: the Electron manager in production, the fake everywhere else. */
export interface AiHostTransport {
  call<T = unknown>(request: AiHostRequestPayload, timeoutMs: number): Promise<T>;
  /** False once the circuit is open or the transport is disposed. */
  isAvailable(): boolean;
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
  cancelMs: 2_000,
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
