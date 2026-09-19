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
 * Pure: stores are injected, digests are computed by the runner.
 */
import type { FlowProfile, FlowStep, PendingLocatorUpgrade } from "../profiles/FlowProfile";
import { createLocatorApprovalBinding, locatorBindingMatches } from "../profiles/locatorApproval";
import { decideAiAction, type AiPolicyReason } from "../security/authz/AiAutonomyPolicy";
import type { CompiledLocatorPlan } from "./locatorPlan";

/**
 * Seeded defaults (L1 seeds, L7 commits; docs/ai/DECISIONS.md 2026-09-19): T2 needs same-element
 * replay proof on at least `minReplays` passing replays spanning `minDataRows` distinct data rows.
 */
export const LOCATOR_UPGRADE_REPLAY_POLICY = Object.freeze({ minReplays: 3, minDataRows: 2 });
/** Distinct data-row keys kept per tally; enough to prove the minimum, bounded for pathological runs. */
export const LOCATOR_REPLAY_MAX_ROW_KEYS = 32;

export function createPendingUpgrade(input: {
  step: FlowStep;
  compiled: CompiledLocatorPlan;
  meaningChange: boolean;
  proof: PendingLocatorUpgrade["proof"];
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
