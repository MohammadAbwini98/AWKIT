/**
 * Pending locator upgrades (Phase L, L3 §5): the lifecycle between a candidate that survived the
 * compiler, the intent guard and the capture-time browser proof, and the promotion that L3 §6 owns.
 *
 * - A candidate lives only in `step.locator.pendingUpgrade` (never `alternatives`); `LocatorFactory`
 *   never reads it, so it can never execute.
 * - Writing or replacing it is a T0 annotation, compare-and-swap against the step's current binding,
 *   run inside the flow store's folder lane (`JsonProfileStore.updateWith`). A proposal for an older
 *   target, or one older than the pending candidate already there, is refused.
 * - Replay proof tallies live in runtime memory (`LocatorRecoveryStore`), never in the profile.
 *   `evaluatePendingUpgrade` turns a tally into the lifecycle state and the `proofSatisfied` input of
 *   `AiAutonomyPolicy`. Nothing here promotes: promotion is L3 §6.
 *
 * Stores are injected. Node's `crypto` is the only runtime import, so this module stays usable from
 * the runner and the main process but is not renderer-safe.
 */
import { createHash } from "node:crypto";

import type { FlowProfile, FlowStep, LocatorCandidate, LocatorContext, PendingLocatorUpgrade, PendingProofEvidence } from "../profiles/FlowProfile";
import { createLocatorApprovalBinding, locatorBindingMatches } from "../profiles/locatorApproval";
import { decideAiAction, type AiPolicyReason } from "../security/authz/AiAutonomyPolicy";
import type { CompiledLocatorPlan } from "./locatorPlan";

/**
 * Seeded defaults (L1 seeds, L7 commits; docs/ai/DECISIONS.md 2026-09-19): T2 needs same-element
 * replay proof on at least `minReplays` passing replays spanning `minDataRows` distinct data rows.
 *
 * `committed` says whether those numbers are the owner-ratified thresholds yet. While it is false the
 * seeded numbers still decide `eligible` (and therefore `proofSatisfied`), but they are NOT permission
 * for an unattended replacement: `promoteLocatorUpgrade` refuses mode `"auto"` (L3 §6). A user who
 * reviews the evidence and approves it is a different authorization and is unaffected.
 */
export interface LocatorUpgradeReplayPolicy {
  minReplays: number;
  minDataRows: number;
  /** Whether these numbers are owner-ratified. Typed as a flag, not the literal `false` it holds now. */
  committed: boolean;
}
export const LOCATOR_UPGRADE_REPLAY_POLICY: Readonly<LocatorUpgradeReplayPolicy> = Object.freeze({
  minReplays: 3,
  minDataRows: 2,
  committed: false
});
/** Distinct data-row keys kept per tally; enough to prove the minimum, bounded for pathological runs. */
export const LOCATOR_REPLAY_MAX_ROW_KEYS = 32;

/** Stable key order, `undefined` members dropped: two equal structures always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

export function locatorCandidateDigest(candidate: LocatorCandidate, context?: LocatorContext): string {
  return sha256Hex(canonicalJson({ candidate, context }));
}

/**
 * The two digests a replay tally is keyed by: the pending candidate with its scope, and the step
 * binding. A superseded candidate or an edited step produces different digests, so its tally can
 * never be read as evidence for the current one. Undefined when the step has no pending candidate.
 */
export function pendingUpgradeDigests(step: FlowStep): { candidateDigest: string; bindingDigest: string } | undefined {
  const pending = step.locator?.pendingUpgrade;
  const binding = createLocatorApprovalBinding(step);
  if (!pending || !binding) return undefined;
  return { candidateDigest: locatorCandidateDigest(pending.candidate, pending.context), bindingDigest: sha256Hex(canonicalJson(binding)) };
}

export function createPendingUpgrade(input: {
  step: FlowStep;
  compiled: CompiledLocatorPlan;
  meaningChange: boolean;
  proof: PendingLocatorUpgrade["proof"];
  /**
   * What the proof established, for L3 §10 evidence-on-demand. Omitted when no proof ran; the
   * field is then absent from the stored candidate, which reads as unavailable rather than passed.
   */
  proofEvidence?: PendingProofEvidence;
  modelId: string;
  now: Date;
}): PendingLocatorUpgrade | undefined {
  const binding = createLocatorApprovalBinding(input.step);
  if (!binding) return undefined;
  return {
    schemaVersion: 1,
    candidate: { ...input.compiled.candidate },
    ...(input.compiled.context ? { context: structuredClone(input.compiled.context) } : {}),
    proof: input.proof,
    ...(input.proofEvidence ? { proofEvidence: { ...input.proofEvidence } } : {}),
    meaningChange: input.meaningChange,
    binding,
    modelId: input.modelId,
    createdAt: input.now.toISOString()
  };
}

export type PendingUpgradeRefusal = "STEP_NOT_FOUND" | "NO_LOCATOR" | "STALE" | "SUPERSEDED" | Extract<AiPolicyReason, `T3_${string}`>;
export type PendingUpgradeWrite = { ok: true; profile: FlowProfile; replaced: boolean } | { ok: false; code: PendingUpgradeRefusal };

/** Pure compare-and-swap. Run it inside the flow store's folder lane. */
export function attachPendingUpgrade(profile: FlowProfile, stepId: string, pending: PendingLocatorUpgrade): PendingUpgradeWrite {
  const index = profile.nodes.findIndex((node) => node.id === stepId);
  if (index < 0) return { ok: false, code: "STEP_NOT_FOUND" };
  const step = profile.nodes[index];
  if (!step.locator) return { ok: false, code: "NO_LOCATOR" };
  // T3 is checked on the step as it is NOW, not as it was when the candidate was proposed.
  const policy = decideAiAction("locatorSemanticUpgrade", "locatorChange", { step }, { enabled: true });
  if (policy.decision === "forbidden" && policy.reason.startsWith("T3_")) {
    return { ok: false, code: policy.reason as Extract<AiPolicyReason, `T3_${string}`> };
  }
  if (!locatorBindingMatches(pending.binding, step)) return { ok: false, code: "STALE" };
  const existing = step.locator.pendingUpgrade;
  if (existing && Date.parse(existing.createdAt) > Date.parse(pending.createdAt)) return { ok: false, code: "SUPERSEDED" };
  const nodes = profile.nodes.slice();
  nodes[index] = { ...step, locator: { ...step.locator, pendingUpgrade: pending } };
  return { ok: true, profile: { ...profile, nodes }, replaced: existing !== undefined };
}

/** Pure compare-and-swap removal: only the exact pending candidate named by `createdAt` is cleared. */
export function clearPendingUpgrade(profile: FlowProfile, stepId: string, createdAt: string): FlowProfile | undefined {
  const index = profile.nodes.findIndex((node) => node.id === stepId);
  const locator = index < 0 ? undefined : profile.nodes[index].locator;
  if (!locator?.pendingUpgrade || locator.pendingUpgrade.createdAt !== createdAt) return undefined;
  const { pendingUpgrade: _pending, ...rest } = locator;
  const nodes = profile.nodes.slice();
  nodes[index] = { ...profile.nodes[index], locator: rest };
  return { ...profile, nodes };
}

export interface PendingUpgradeFlowStore {
  updateWith(id: string, change: (current: FlowProfile | null) => FlowProfile | undefined): Promise<FlowProfile | undefined>;
}

/** Write a pending candidate through the flow store's single-writer lane. */
export async function annotatePendingUpgrade(
  flows: PendingUpgradeFlowStore,
  flowId: string,
  stepId: string,
  pending: PendingLocatorUpgrade
): Promise<{ code: "OK" | "FLOW_NOT_FOUND" | "WRITE_FAILED" | PendingUpgradeRefusal; replaced?: boolean }> {
  let outcome: { code: "OK" | "FLOW_NOT_FOUND" | PendingUpgradeRefusal; replaced?: boolean } = { code: "FLOW_NOT_FOUND" };
  try {
    await flows.updateWith(flowId, (current) => {
      if (!current) return undefined;
      const result = attachPendingUpgrade(current, stepId, pending);
      outcome = result.ok ? { code: "OK", replaced: result.replaced } : { code: result.code };
      return result.ok ? result.profile : undefined;
    });
  } catch {
    return { code: "WRITE_FAILED" };
  }
  return outcome;
}

/** Runtime-memory tally of replay proofs for one pending candidate (ids, digests and counts only). */
export interface LocatorReplayProofRecord {
  version: 1;
  scopeKey: string;
  /** Digest of the candidate and its scope; a different candidate starts a fresh tally. */
  candidateDigest: string;
  /** Digest of the step binding; an edited step starts a fresh tally. */
  bindingDigest: string;
  /** Replays where the candidate proved the same element AND the step then passed. */
  proven: number;
  /** Replays where the candidate was refused (wrong element, not unique, intent, scope). */
  rejected: number;
  /** Hashed data-row keys of the proven replays. */
  dataRowKeys: string[];
  lastCode: string;
  updatedAt: string;
}

export function mergeReplayProof(
  previous: LocatorReplayProofRecord | undefined,
  update: { scopeKey: string; candidateDigest: string; bindingDigest: string; outcome: "proven" | "rejected"; code: string; rowKey: string; now: Date }
): LocatorReplayProofRecord {
  const base: LocatorReplayProofRecord =
    previous && previous.candidateDigest === update.candidateDigest && previous.bindingDigest === update.bindingDigest
      ? previous
      : { version: 1, scopeKey: update.scopeKey, candidateDigest: update.candidateDigest, bindingDigest: update.bindingDigest, proven: 0, rejected: 0, dataRowKeys: [], lastCode: "", updatedAt: "" };
  const rows =
    update.outcome === "proven" && !base.dataRowKeys.includes(update.rowKey) && base.dataRowKeys.length < LOCATOR_REPLAY_MAX_ROW_KEYS
      ? [...base.dataRowKeys, update.rowKey]
      : base.dataRowKeys;
  return {
    ...base,
    proven: base.proven + (update.outcome === "proven" ? 1 : 0),
    rejected: base.rejected + (update.outcome === "rejected" ? 1 : 0),
    dataRowKeys: rows,
    lastCode: update.code,
    updatedAt: update.now.toISOString()
  };
}

/**
 * Whether a tally's scope key is this flow's step. The key is composed by `LocatorFactory.scopeKey`
 * as scenario, flow, step joined by NUL, so a caller that knows only a flow and a step (the L3 §6
 * promotion boundary) can recognise the tallies that belong to it without knowing the scenario.
 */
export function replayProofScopeMatches(scopeKey: string, flowId: string, stepId: string): boolean {
  const parts = scopeKey.split(String.fromCharCode(0));
  return parts.length === 3 && parts[1] === flowId && parts[2] === stepId;
}

export type PendingUpgradeState = "none" | "stale" | "pending-replay" | "replay-rejected" | "eligible";

export interface PendingUpgradeEvaluation {
  state: PendingUpgradeState;
  /** The `proofSatisfied` input of `decideAiAction`; true only in state `eligible`. */
  proofSatisfied: boolean;
  meaningChange: boolean;
  replays: number;
  dataRows: number;
}

/**
 * Lifecycle state of the step's pending candidate given its runtime tally. `digests` must be the
 * runner's digests of the CURRENT pending candidate and binding, so a tally for a superseded
 * candidate or an older step never counts. Any refused replay blocks eligibility for that candidate.
 */
export function evaluatePendingUpgrade(
  step: FlowStep,
  record: LocatorReplayProofRecord | undefined,
  digests: { candidateDigest: string; bindingDigest: string },
  policy: { minReplays: number; minDataRows: number } = LOCATOR_UPGRADE_REPLAY_POLICY
): PendingUpgradeEvaluation {
  const pending = step.locator?.pendingUpgrade;
  const none = (state: PendingUpgradeState): PendingUpgradeEvaluation => ({ state, proofSatisfied: false, meaningChange: pending?.meaningChange ?? false, replays: 0, dataRows: 0 });
  if (!pending) return none("none");
  if (!locatorBindingMatches(pending.binding, step)) return none("stale");
  const tally = record && record.candidateDigest === digests.candidateDigest && record.bindingDigest === digests.bindingDigest ? record : undefined;
  if (!tally) return none("pending-replay");
  const counts = { replays: tally.proven, dataRows: tally.dataRowKeys.length, meaningChange: pending.meaningChange };
  if (tally.rejected > 0) return { state: "replay-rejected", proofSatisfied: false, ...counts };
  const eligible = tally.proven >= policy.minReplays && tally.dataRowKeys.length >= policy.minDataRows;
  return { state: eligible ? "eligible" : "pending-replay", proofSatisfied: eligible, ...counts };
}
