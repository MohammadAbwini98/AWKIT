/**
 * Qualification (Phase L, L8b.4, E6): what a configuration has been PROVEN to do, kept apart from what
 * it can run. Compatible is not Qualified.
 *
 *  - The quality key: model SHA-256 + runtime build + backend + offload class + context + KV-cache
 *    settings + feature + output budget. It carries across hardware. A configuration is qualified for a
 *    feature only when the release-owned `AI_QUALIFIED_CONFIGURATIONS` lists exactly that key, so one
 *    configuration never qualifies another.
 *  - The latency class: the quality key plus a coarse hardware class. Measured locally or not claimed:
 *    L9's ETA history (`AiEtaHistory`) measures it on this machine and Settings shows those measurements
 *    as measurements; qualification itself never claims a latency.
 *  - Labels, each with a reason: Incompatible (the failed check), unchecked (a stage has not run for this
 *    runtime), Qualified (for the features named), Compatible but unqualified.
 *
 * An unqualified compatible model runs under exactly the product's own bounded budgets (nothing is
 * raised for it) and is never presented as meeting a qualified configuration's quality or latency.
 * The licensing machine fingerprint is never used. Framework-agnostic and pure.
 */

import { AI_QUALIFIED_CONFIGURATIONS, isValidAiQualifiedConfiguration, type AiQualifiedConfiguration } from "../offline/AiQualifiedList";
import { AI_FEATURE_IDS, type AiFeatureId } from "../security/authz/AiAutonomyPolicy";
import type { AiOffloadClass } from "./AiExecutionProfile";
import type { AiCompatibilityCheck } from "./AiModelCompatibility";

/** The KV-cache and attention settings the product loads with: the runtime's defaults, never configured. */
export const AI_KV_CACHE_SETTINGS = "runtime-default" as const;

export interface AiQualityKey {
  modelSha256: string;
  runtimeBuild: string;
  backend: "cpu" | "vulkan";
  offload: AiOffloadClass;
  contextTokens: number;
  kvCache: typeof AI_KV_CACHE_SETTINGS;
  feature: AiFeatureId;
  outputTokens: number;
}

export interface AiRunConfiguration {
  backend: "cpu" | "vulkan";
  offload: AiOffloadClass;
  contextTokens: number;
}

/** Every field, in a fixed order: two keys are the same key only when every field is equal. */
export function qualityKeyId(key: Omit<AiQualityKey, "feature"> & { feature: string }): string {
  return [key.modelSha256, key.runtimeBuild, key.backend, key.offload, `ctx${key.contextTokens}`, `kv:${key.kvCache}`, key.feature, `out${key.outputTokens}`].join("|");
}

/** Exactly listed, by a well-formed entry. A malformed entry qualifies nothing, whatever it says. */
export function isQualified(key: AiQualityKey, list: readonly AiQualifiedConfiguration[] = AI_QUALIFIED_CONFIGURATIONS): boolean {
  const id = qualityKeyId(key);
  return list.some((entry) => isValidAiQualifiedConfiguration(entry) && qualityKeyId(entry) === id);
}

const pow2 = (value: number): number => 2 ** Math.max(0, Math.floor(Math.log2(Math.max(1, value))));

/** Coarse and non-identifying: logical CPUs, memory and VRAM, each rounded down to a power of two. */
export function hardwareClassOf(machine: { logicalCpus: number; totalMemoryMb: number; vramTotalBytes: number | null }): string {
  const vram = machine.vramTotalBytes && machine.vramTotalBytes > 0 ? `vram${pow2(machine.vramTotalBytes / 1024 ** 3)}g` : "novram";
  return `cpu${pow2(machine.logicalCpus)}-ram${pow2(machine.totalMemoryMb / 1024)}g-${vram}`;
}

/** The latency class (E6): the quality key on a hardware class. L9's ETA history records under it. */
export function latencyClassId(key: Parameters<typeof qualityKeyId>[0], hardwareClass: string): string {
  return `${qualityKeyId(key)}@${hardwareClass}`;
}

export type AiModelLabel = "qualified" | "compatible-unqualified" | "incompatible" | "unchecked";

export type AiQualificationReason =
  | AiCompatibilityCheck
  /** Quality evidence exists for this model, but not for the configuration it runs in. */
  | "NOT_QUALIFIED_ON_THIS_CONFIGURATION"
  /** No quality evidence exists for this model at all. */
  | "NO_QUALITY_EVIDENCE"
  /** A GPU mode's configuration is decided by its next load; nothing is claimed before it. */
  | "CONFIGURATION_NOT_DECIDED"
  /** L9.2 (E8): the evidence was measured under a feature's default time budget, which was changed. */
  | "TIME_BUDGET_CHANGED";

export interface AiQualificationView {
  label: AiModelLabel;
  /** The failed check when incompatible, or why nothing is qualified; null when qualified or unchecked. */
  reason: AiQualificationReason | null;
  /** The features qualified in this configuration, in the product's feature order. */
  qualifiedFeatures: AiFeatureId[];
  configuration: AiRunConfiguration | null;
  /** Measured locally or not claimed (E6): a qualification never claims one; L9's history measures it. */
  latency: { claimed: false; hardwareClass: string | null };
}

export function describeQualification(input: {
  /** "compatible" for a curated pack; a registered model's standing otherwise. */
  compatibility: "compatible" | AiCompatibilityCheck | null;
  modelSha256: string | null;
  runtimeBuild: string | null;
  /** Null before a GPU mode's first load decides the backend and offload. */
  configuration: AiRunConfiguration | null;
  /** Each feature's current `maxOutputTokens`; a feature without one is never qualified. */
  featureBudgets: Readonly<Partial<Record<AiFeatureId, number>>>;
  hardwareClass: string | null;
  /**
   * Features whose time budget is not the default their evidence ran under (L9.2, E8). A changed budget
   * needs its own re-benchmark; it never re-labels old evidence, so those features are not qualified.
   */
  changedBudgetFeatures?: readonly AiFeatureId[];
  list?: readonly AiQualifiedConfiguration[];
}): AiQualificationView {
  const list = input.list ?? AI_QUALIFIED_CONFIGURATIONS;
  const view = (label: AiModelLabel, reason: AiQualificationReason | null, qualifiedFeatures: AiFeatureId[] = []): AiQualificationView => ({
    label,
    reason,
    qualifiedFeatures,
    configuration: input.configuration ? { ...input.configuration } : null,
    latency: { claimed: false, hardwareClass: input.hardwareClass }
  });
  if (input.compatibility === null || !input.modelSha256 || !input.runtimeBuild) return view("unchecked", null);
  if (input.compatibility !== "compatible") return view("incompatible", input.compatibility);
  const sha = input.modelSha256;
  const build = input.runtimeBuild;
  const evidence = list.some((entry) => isValidAiQualifiedConfiguration(entry) && entry.modelSha256 === sha);
  const configuration = input.configuration;
  if (!configuration) return view("compatible-unqualified", evidence ? "CONFIGURATION_NOT_DECIDED" : "NO_QUALITY_EVIDENCE");
  const listed = AI_FEATURE_IDS.filter((feature) => {
    const outputTokens = input.featureBudgets[feature];
    return (
      outputTokens !== undefined &&
      isQualified({ modelSha256: sha, runtimeBuild: build, ...configuration, kvCache: AI_KV_CACHE_SETTINGS, feature, outputTokens }, list)
    );
  });
  const changed = new Set(input.changedBudgetFeatures ?? []);
  const qualified = listed.filter((feature) => !changed.has(feature));
  if (qualified.length > 0) return view("qualified", null, qualified);
  if (listed.length > 0) return view("compatible-unqualified", "TIME_BUDGET_CHANGED");
  return view("compatible-unqualified", evidence ? "NOT_QUALIFIED_ON_THIS_CONFIGURATION" : "NO_QUALITY_EVIDENCE");
}
