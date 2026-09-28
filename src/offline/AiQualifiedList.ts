/**
 * Local-AI qualified list (Phase L, L8b.4, E6): the configurations whose answer QUALITY has been
 * proven, beside the model manifest. Release-owned and Risk 3 like `AiModelManifest.ts`; it changes
 * only with an app release, and there is no user override.
 *
 * Compatible is not Qualified. A model the manifest lists, or one an administrator registered that
 * passed its compatibility stages, runs; only a configuration with an entry here is Qualified, and only
 * for that entry's feature. An entry is one quality key: model SHA-256 + runtime build + backend +
 * offload class + context + KV-cache settings + feature + output budget. A configuration that differs
 * in ANY field is not qualified by it: GPU never qualifies CPU, full offload never qualifies partial,
 * another runtime build is re-measured, and a raised budget never inherits a smaller one's evidence.
 *
 * Latency is never listed: it depends on the machine, so it is measured locally or not claimed (L9).
 *
 * The existing evidence stays keyed exactly as it was measured. Qwen3.5-0.8B on CPU & RAM went GO on
 * all eight L1.8 criteria on the qualifying host, and the owner's limited GO accepted it for three
 * person-triggered features, at the output budgets that run measured. The 4B (L1.8 NO-GO) and the 2B
 * (L1.8 FAIL) have no entry: they can be compatible, never qualified.
 */

export type AiQualifiedOffload = "cpu" | "full" | `partial:${number}`;

export interface AiQualifiedConfiguration {
  /** Lowercase hex SHA-256 of the whole model file. */
  modelSha256: string;
  /** The pinned runtime build the evidence was taken on (`AI_RUNTIME_PIN.build` then). */
  runtimeBuild: string;
  backend: "cpu" | "vulkan";
  offload: AiQualifiedOffload;
  contextTokens: number;
  /** KV-cache and attention settings. The runtime's defaults are the only ones the product sets. */
  kvCache: "runtime-default";
  /** An `AiFeatureId`; checked by `AiQualification`, which owns the feature vocabulary. */
  feature: string;
  /** The feature's `maxOutputTokens` the evidence was measured at. */
  outputTokens: number;
  /** Where the evidence is, for a reader. Never parsed. */
  evidence: string;
}

const QWEN_0_8B = "f5b14da98939b60bbe1019a964eba656407e1e0b64f1fe3003ff6d650e93bfec";
const L1_8_BUILD = "node-llama-cpp@3.21.1+llama.cpp@v0.4.0";
const L1_8_EVIDENCE =
  "docs/plans/ai-upgrade-v5/evidence/L1.8-benchmark-full-host-Qwen3.5-0.8B-Q4_K_M.json (GO on all eight, 2026-09-26); " +
  "owner's limited GO, docs/ai/DECISIONS.md 2026-09-23";

const cpu08b = (feature: string, outputTokens: number): AiQualifiedConfiguration =>
  Object.freeze({
    modelSha256: QWEN_0_8B,
    runtimeBuild: L1_8_BUILD,
    backend: "cpu",
    offload: "cpu",
    contextTokens: 4096,
    kvCache: "runtime-default",
    feature,
    outputTokens,
    evidence: L1_8_EVIDENCE
  });

export const AI_QUALIFIED_CONFIGURATIONS: readonly AiQualifiedConfiguration[] = Object.freeze([
  cpu08b("locatorSemanticUpgrade", 256),
  cpu08b("validationExplanation", 176),
  cpu08b("failureAnalysis", 256)
]);

const OFFLOAD = /^(?:cpu|full|partial:[1-9]\d{0,3})$/;

/** Structural check. `AiQualification` ignores any entry that fails it, whatever the list says. */
export function isValidAiQualifiedConfiguration(entry: unknown): entry is AiQualifiedConfiguration {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    typeof e.modelSha256 === "string" &&
    /^[0-9a-f]{64}$/.test(e.modelSha256) &&
    typeof e.runtimeBuild === "string" &&
    e.runtimeBuild.length > 0 &&
    e.runtimeBuild.length <= 200 &&
    (e.backend === "cpu" || e.backend === "vulkan") &&
    typeof e.offload === "string" &&
    OFFLOAD.test(e.offload) &&
    // A CPU backend offloads nothing, and a GPU backend always offloads at least one layer.
    (e.backend === "cpu") === (e.offload === "cpu") &&
    Number.isInteger(e.contextTokens) &&
    (e.contextTokens as number) >= 256 &&
    e.kvCache === "runtime-default" &&
    typeof e.feature === "string" &&
    /^[A-Za-z]{1,64}$/.test(e.feature) &&
    Number.isInteger(e.outputTokens) &&
    (e.outputTokens as number) >= 1 &&
    typeof e.evidence === "string" &&
    e.evidence.length > 0
  );
}
