/**
 * Compatibility stages for a model the manifest does not list (Phase L, L8b, E6).
 *
 * L8b.2, the static stage: the utility host reads the GGUF header with the pinned runtime's own reader
 * (never the main process) and returns path-free facts; this module decides from them. The first
 * failing check is the reason. Passing it is necessary, not sufficient.
 *
 * L8b.3, the dynamic stage: the CPU host loads the model once, reads a few unconstrained tokens after
 * the product's own thinking-off prompt for a think marker, and answers a fixed schema under its
 * grammar. A model is Compatible only when both stages passed for the runtime build in use. Even then
 * it is not used before an administrator acknowledges it as unverified (L8b.5, E7).
 *
 * Framework-agnostic and pure.
 */

import type { AiModelPackStatus, AiModelPackStore, AiProbeCheckRecord, AiStaticCheckRecord } from "./AiModelPack";
import { parseAiOutput } from "./AiOutputContract";
import { AI_CONTEXT_TOKENS, AI_MAX_GPU_LAYERS, AI_PROBE, type AiModelHeader, type AiModelProbe } from "./contracts/AiHostProtocol";

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

// ── L8b.3: the dynamic stage ─────────────────────────────────────────────────────────────────────

export const AI_PROBE_CHECKS = ["PROBE_LOAD_FAILED", "PROBE_GENERATION_FAILED", "THINKING_NOT_DISABLED", "PROBE_OUTPUT_INVALID"] as const;
export type AiProbeCheck = (typeof AI_PROBE_CHECKS)[number];
export type AiCompatibilityCheck = AiStaticCheck | AiProbeCheck;

export function isAiProbeCheck(value: unknown): value is AiProbeCheck {
  return typeof value === "string" && (AI_PROBE_CHECKS as readonly string[]).includes(value);
}

/** A probe the host cancelled (shutdown, or a timed-out caller) observed nothing: it did not run. */
export function probeCancelled(reply: unknown): boolean {
  return typeof reply === "object" && reply !== null && (reply as Record<string, unknown>).loaded === true && (reply as Record<string, unknown>).stopReason === "cancelled";
}

/**
 * The probe's reply is checked as untrusted: anything malformed fails, never passes. First failure wins:
 * the model did not load; it could not generate; its first tokens opened a think block (thinking cannot be
 * shown to be off, E6); or its constrained answer did not finish or does not validate as the product would.
 */
export function probeVerdict(reply: unknown): { ok: true } | { ok: false; failed: AiProbeCheck } {
  const fail = (failed: AiProbeCheck) => ({ ok: false as const, failed });
  if (typeof reply !== "object" || reply === null || (reply as Record<string, unknown>).loaded !== true) return fail("PROBE_LOAD_FAILED");
  const r = reply as Record<string, unknown>;
  if (r.stopReason === "failed") return fail("PROBE_GENERATION_FAILED");
  if (r.thinkingOff !== true) return fail("THINKING_NOT_DISABLED");
  if (r.stopReason !== "stop" || typeof r.text !== "string" || !parseAiOutput(r.text, AI_PROBE.schema).ok) return fail("PROBE_OUTPUT_INVALID");
  return { ok: true };
}

/**
 * A registered model's compatibility for the runtime in use: null while a stage has not run for this
 * runtime build, the first failed check (static before probe), or "compatible" when both passed.
 */
export function compatibilityStanding(
  checks: { staticCheck: AiStaticCheckRecord | null; probeCheck: AiProbeCheckRecord | null },
  runtimeBuild: string | null
): "compatible" | AiCompatibilityCheck | null {
  const header = staticStanding(checks.staticCheck, runtimeBuild);
  if (header !== "passed") return header;
  const probe = checks.probeCheck;
  if (!probe || probe.runtimeBuild !== runtimeBuild) return null;
  return probe.failed ?? "compatible";
}

/**
 * Both stages on the active registered model, recording each verdict on the SHA-256 it ran on. The probe
 * runs only when this model's static stage passed for this runtime build, so a replacement imported
 * meanwhile is never probed on another file's header. "not-run" whenever a stage could not run (no model,
 * no pin, the host unable or busy, a cancelled probe): nothing is recorded, and the model stays unchecked.
 */
export async function runCompatibilityStages(deps: {
  store: Pick<AiModelPackStore, "status" | "modelPath" | "recordStaticCheck" | "recordProbeCheck">;
  inspect: (modelPath: string) => Promise<AiModelHeader | null>;
  probe: (modelPath: string) => Promise<AiModelProbe | null>;
  runtimeBuild: string | null;
  now?: () => number;
}): Promise<"not-run" | "compatible" | AiCompatibilityCheck> {
  const header = await runStaticStage(deps);
  if (header !== "passed") return header;
  const status = await deps.store.status().catch(() => null);
  if (status?.status !== "registered" || staticStanding(status.staticCheck, deps.runtimeBuild) !== "passed") return "not-run";
  const { sha256 } = status.external;
  const reply = await deps.probe(deps.store.modelPath(sha256)).catch(() => null);
  if (reply === null || probeCancelled(reply)) return "not-run";
  const verdict = probeVerdict(reply);
  const failed = verdict.ok ? null : verdict.failed;
  const recorded = await deps.store.recordProbeCheck(sha256, { runtimeBuild: deps.runtimeBuild!, failed, checkedAt: new Date((deps.now ?? Date.now)()).toISOString() });
  return recorded ? (failed ?? "compatible") : "not-run";
}
