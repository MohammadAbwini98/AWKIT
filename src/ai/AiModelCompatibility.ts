/**
 * Compatibility stages for a model the manifest does not list (Phase L, L8b, E6).
 *
 * L8b.2, the static stage: the utility host reads the GGUF header with the pinned runtime's own reader
 * (never the main process) and returns path-free facts; this module decides from them. The first
 * failing check is the reason. Passing it is necessary, not sufficient: the model is still not used
 * until the L8b.3 probe loads it and shows thinking is off.
 *
 * Framework-agnostic and pure.
 */

import type { AiModelPackStatus, AiModelPackStore, AiStaticCheckRecord } from "./AiModelPack";
import { AI_CONTEXT_TOKENS, AI_MAX_GPU_LAYERS, type AiModelHeader } from "./contracts/AiHostProtocol";

export const AI_STATIC_CHECKS = [
  "GGUF_UNREADABLE",
  "GGUF_VERSION",
  "ARCHITECTURE_UNSUPPORTED",
  "TENSOR_TYPE_UNSUPPORTED",
  "CHAT_TEMPLATE",
  "CONTEXT_TOO_SMALL",
  "LAYER_COUNT"
] as const;
export type AiStaticCheck = (typeof AI_STATIC_CHECKS)[number];

export function isAiStaticCheck(value: unknown): value is AiStaticCheck {
  return typeof value === "string" && (AI_STATIC_CHECKS as readonly string[]).includes(value);
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** The host's reply is checked as untrusted: anything malformed reads as unreadable, never as a pass. */
export function staticVerdict(header: unknown): { ok: true } | { ok: false; failed: AiStaticCheck } {
  const fail = (failed: AiStaticCheck) => ({ ok: false as const, failed });
  if (typeof header !== "object" || header === null) return fail("GGUF_UNREADABLE");
  const h = header as Record<string, unknown>;
  if (h.readable !== true || !count(h.tensorCount) || h.tensorCount === 0) return fail("GGUF_UNREADABLE");
  if (h.ggufVersion !== 2 && h.ggufVersion !== 3) return fail("GGUF_VERSION");
  if (h.architectureKnown !== true || typeof h.architecture !== "string") return fail("ARCHITECTURE_UNSUPPORTED");
  if (h.unknownTensorTypes !== 0) return fail("TENSOR_TYPE_UNSUPPORTED");
  // The host prompts with ChatML and a pre-filled empty think block; any other template cannot be driven.
  if (h.chatTemplate !== "chatml") return fail("CHAT_TEMPLATE");
  if (!count(h.contextLength) || h.contextLength < AI_CONTEXT_TOKENS) return fail("CONTEXT_TOO_SMALL");
  if (!count(h.blockCount) || h.blockCount < 1 || h.blockCount > AI_MAX_GPU_LAYERS) return fail("LAYER_COUNT");
  return { ok: true };
}

/**
 * The static stage's standing for the runtime in use: null when it has not run for this runtime build
 * (a result from another build no longer counts), "passed", or the failed check.
 */
export function staticStanding(check: AiStaticCheckRecord | null, runtimeBuild: string | null): "passed" | AiStaticCheck | null {
  if (!check || !runtimeBuild || check.runtimeBuild !== runtimeBuild) return null;
  return check.failed ?? "passed";
}

/**
 * Run the static stage on the active registered model and record its verdict. "not-run" when there is
 * no registered model or runtime pin, or the host could not read the header (absent, circuit open,
 * crashed, timed out): nothing is recorded, so the model stays unchecked. The verdict is recorded
 * against the SHA-256 it was run on, so it never lands on a model that replaced it meanwhile.
 */
export async function runStaticStage(deps: {
  store: Pick<AiModelPackStore, "status" | "modelPath" | "recordStaticCheck">;
  inspect: (modelPath: string) => Promise<AiModelHeader | null>;
  runtimeBuild: string | null;
  now?: () => number;
}): Promise<"not-run" | "passed" | AiStaticCheck> {
  const status: AiModelPackStatus | null = await deps.store.status().catch(() => null);
  if (status?.status !== "registered" || !deps.runtimeBuild) return "not-run";
  const { sha256 } = status.external;
  const header = await deps.inspect(deps.store.modelPath(sha256)).catch(() => null);
  if (header === null) return "not-run";
  const verdict = staticVerdict(header);
  const failed = verdict.ok ? null : verdict.failed;
  const recorded = await deps.store.recordStaticCheck(sha256, { runtimeBuild: deps.runtimeBuild, failed, checkedAt: new Date((deps.now ?? Date.now)()).toISOString() });
  return recorded ? (failed ?? "passed") : "not-run";
}
