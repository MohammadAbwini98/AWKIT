/**
 * Controlled promotion of a proven pending locator upgrade (Phase L, L3 §6), and nothing else.
 *
 * This module is the ONLY path from `step.locator.pendingUpgrade` to the authoritative saved locator.
 * A candidate does not become the locator because a model produced it, because it compiled, or even
 * because one browser proof passed: `promoteLocatorUpgrade` re-derives every precondition from the
 * profile it is handed, inside the flow store's single-writer lane, and refuses with a stable code
 * otherwise. Callers pass the replay tally (external runtime memory); everything derived from the
 * step — digests, eligibility, policy tier, staleness — is recomputed here, so a caller cannot hand
 * in an `eligible` flag and have it believed.
 *
 * What a promotion changes: the primary candidate (`strategy`/`value`/`name`/`exact`), its scope
 * `context`, the record-time `quality` (now describing the proven candidate, so the locator is no
 * longer classified positional), and the positional `guard`, which described the replaced primary.
 * Everything else on the step and its locator is carried through untouched, including keys this
 * version does not know about. The whole pre-change locator is kept in `locatorProvenance.previous`
 * as the one-click revert target — never in `alternatives`, which the runner executes
 * (docs/ai/DECISIONS.md 2026-09-19).
 *
 * Pure: no Electron, no filesystem, no clock. The audit record is returned for the caller to persist
 * AFTER the locator write lands, so a crash can never leave an audit entry claiming a change that
 * did not happen.
 */

import type { AiActionRecord } from "./AiActionRecord";
import {
  evaluatePendingUpgrade,
  LOCATOR_UPGRADE_REPLAY_POLICY,
  pendingUpgradeDigests,
  replayProofScopeMatches,
  type LocatorReplayProofRecord,
  type PendingUpgradeEvaluation
} from "./pendingUpgrade";
import type {
  AppliedLocatorUpgradeView,
  FlowLocatorUpgradesView,
  PendingLocatorUpgradeView
} from "./contracts/AiApi";
import type { FlowProfile, LocatorCandidate, LocatorProvenance, StepLocator } from "../profiles/FlowProfile";
import { createLocatorApprovalBinding, locatorBindingMatches } from "../profiles/locatorApproval";
import { decideAiAction, type AiPolicyConfig, type AiPolicyReason } from "../security/authz/AiAutonomyPolicy";

/**
 * Who authorized the replacement.
 *
 * `auto` is the unattended T2 apply: it additionally requires the replay thresholds to be committed
 * (`LOCATOR_UPGRADE_REPLAY_POLICY.committed`), because a seeded number is a working assumption, not
 * a mandate to replace a user's locator without asking. `user-approved` is a person reviewing the
 * same evidence and applying it; it is recorded as T1, so a later revert cannot self-demote a
 * feature for a decision a human made.
 */
export type LocatorPromotionMode = "auto" | "user-approved";

export type LocatorPromotionRefusal =
  | "STEP_NOT_FOUND"
  | "NO_LOCATOR"
  | "NO_PENDING"
  /** The step's pending candidate is not the one the caller evaluated. */
  | "SUPERSEDED"
  /** The step changed after the candidate was proposed. */
  | "STALE"
  /** The locator is not an authoritative resolved locator (needs review, invalid, approved fallback). */
  | "BASELINE_NOT_PROMOTABLE"
  /** Fewer passing replays, or fewer distinct data rows, than the policy requires. */
  | "PROOF_NOT_SATISFIED"
  /** At least one replay refused this candidate; it can never be promoted. */
  | "REPLAY_REJECTED"
  /** Mode `auto` with seeded, uncommitted thresholds. */
  | "THRESHOLDS_PROVISIONAL"
  /** The autonomy policy does not permit this apply (master switch off, T0, or auto below T2). */
  | "POLICY_REFUSED"
  /** An open editor has unsaved changes to this flow; its next save would undo the promotion. */
  | "EDITOR_DIRTY"
  | Extract<AiPolicyReason, `T3_${string}`>;

export interface LocatorPromotionInput {
  /** `createdAt` of the exact pending candidate the caller evaluated; anything else is SUPERSEDED. */
  createdAt: string;
  mode: LocatorPromotionMode;
  /** Id for the `AiActionRecord` and the provenance that points at it. */
  actionId: string;
  nowIso: string;
  /**
   * Every replay tally in locator memory. The evidence for THIS step is selected here, inside the
   * lane, rather than passed in already chosen: the digests it must match are derived from the step
   * this call is about to write, so a tally picked against an earlier read cannot be smuggled in.
   */
  replayProofs: readonly LocatorReplayProofRecord[];
  policy: AiPolicyConfig;
  /**
   * An open editor holds unsaved changes to this flow. Refusing here rather than in a caller keeps
   * it part of the one trusted operation: the editor's next save writes its whole document, locator
   * included, so a promotion landing underneath it would be undone without a trace.
   */
  editorDirty: boolean;
  replayPolicy?: typeof LOCATOR_UPGRADE_REPLAY_POLICY;
}

/**
 * The tally that stands as promotion evidence for one step's current pending candidate.
 *
 * A tally is per SCENARIO, so one flow step can have several — one per workflow that ran it. Only
 * tallies whose candidate and binding digests match the step as it is now are considered at all.
 * Among those, a single refusal anywhere disqualifies the candidate outright (returned first, so the
 * evaluation reports `replay-rejected`). Otherwise one tally must satisfy the policy on its own:
 * counts are never summed across scenarios, because three single-row runs in three workflows are not
 * the "three replays across two data rows" the policy asks for.
 */
export function selectReplayEvidence(
  records: readonly LocatorReplayProofRecord[],
  flowId: string,
  stepId: string,
  digests: { candidateDigest: string; bindingDigest: string },
  policy: { minReplays: number; minDataRows: number } = LOCATOR_UPGRADE_REPLAY_POLICY
): LocatorReplayProofRecord | undefined {
  const mine = records.filter(
    (record) =>
      replayProofScopeMatches(record.scopeKey, flowId, stepId) &&
      record.candidateDigest === digests.candidateDigest &&
      record.bindingDigest === digests.bindingDigest
  );
  return (
    mine.find((record) => record.rejected > 0) ??
    mine.find((record) => record.proven >= policy.minReplays && record.dataRowKeys.length >= policy.minDataRows) ??
    mine.reduce<LocatorReplayProofRecord | undefined>((best, record) => (!best || record.proven > best.proven ? record : best), undefined)
  );
}

export interface LocatorPromotionSuccess {
  ok: true;
  profile: FlowProfile;
  record: AiActionRecord;
  evaluation: PendingUpgradeEvaluation;
}

export type LocatorPromotionResult = LocatorPromotionSuccess | { ok: false; code: LocatorPromotionRefusal };

/**
 * What the Flow Designer may show for one flow: every step's pending candidate with its verification
 * state, and every applied promotion with whether its revert would still be accepted.
 *
 * `promotable`/`blockedReason` come from a DRY RUN of `promoteLocatorUpgrade` itself rather than a
 * second copy of the rules, so the badge and the write can never disagree — if the preview says
 * promotable, the write accepts it for the same reasons, and if it does not, it names the same code.
 */
export function describeFlowLocatorUpgrades(input: {
  profile: FlowProfile;
  replayProofs: readonly LocatorReplayProofRecord[];
  policy: AiPolicyConfig;
  editorDirty: boolean;
  replayPolicy?: typeof LOCATOR_UPGRADE_REPLAY_POLICY;
}): FlowLocatorUpgradesView {
  const replayPolicy = input.replayPolicy ?? LOCATOR_UPGRADE_REPLAY_POLICY;
  const pending: PendingLocatorUpgradeView[] = [];
  const applied: AppliedLocatorUpgradeView[] = [];

  for (const step of input.profile.nodes) {
    const locator = step.locator;
    if (!locator) continue;
    const provenance = locator.locatorProvenance;
    if (provenance) {
      applied.push({
        stepId: step.id,
        stepName: step.name,
        actionId: provenance.actionId,
        tier: provenance.tier,
        appliedAt: provenance.appliedAt,
        revertable: locatorBindingMatches(provenance.binding, step),
        previous: candidateOf(provenance.previous)
      });
    }
    const proposal = locator.pendingUpgrade;
    if (!proposal) continue;
    const digests = pendingUpgradeDigests(step);
    const evaluation = digests
      ? evaluatePendingUpgrade(step, selectReplayEvidence(input.replayProofs, input.profile.id, step.id, digests, replayPolicy), digests, replayPolicy)
      : { state: "stale" as const, proofSatisfied: false, meaningChange: proposal.meaningChange, replays: 0, dataRows: 0 };
    const dryRun = promoteLocatorUpgrade(input.profile, step.id, {
      createdAt: proposal.createdAt,
      mode: "user-approved",
      actionId: "dry-run",
      nowIso: provenance?.appliedAt ?? proposal.createdAt,
      replayProofs: input.replayProofs,
      policy: input.policy,
      editorDirty: input.editorDirty,
      replayPolicy
    });
    pending.push({
      stepId: step.id,
      stepName: step.name,
      state: evaluation.state,
      proof: proposal.proof,
      meaningChange: proposal.meaningChange,
      replays: evaluation.replays,
      dataRows: evaluation.dataRows,
      minReplays: replayPolicy.minReplays,
      minDataRows: replayPolicy.minDataRows,
      createdAt: proposal.createdAt,
      modelId: proposal.modelId,
      current: candidateOf(locator),
      proposed: { ...proposal.candidate },
      promotable: dryRun.ok,
      blockedReason: dryRun.ok ? null : dryRun.code
    });
  }
  return { flowId: input.profile.id, pending, applied, editorDirty: input.editorDirty };
}

/** Just the four executable fields, so a view never carries guards, fingerprints or provenance. */
function candidateOf(locator: StepLocator): LocatorCandidate {
  return {
    strategy: locator.strategy,
    value: locator.value,
    ...(locator.name !== undefined ? { name: locator.name } : {}),
    ...(locator.exact !== undefined ? { exact: locator.exact } : {})
  };
}

/** Only an authoritative, already-runnable locator is upgraded. Repairing the rest is L3 §8. */
function isPromotableBaseline(locator: StepLocator): boolean {
  return locator.resolution === undefined || locator.resolution === "resolved";
}

/**
 * Compare-and-swap promotion. Run it inside `JsonProfileStore.updateWith` so the profile read, every
 * precondition and the write are one critical section: a second promotion, or a save that lands
 * between a caller's read and this call, is observed here rather than overwritten.
 */
export function promoteLocatorUpgrade(profile: FlowProfile, stepId: string, input: LocatorPromotionInput): LocatorPromotionResult {
  if (input.editorDirty) return { ok: false, code: "EDITOR_DIRTY" };
  const index = profile.nodes.findIndex((node) => node.id === stepId);
  if (index < 0) return { ok: false, code: "STEP_NOT_FOUND" };
  const step = profile.nodes[index];
  const locator = step.locator;
  if (!locator) return { ok: false, code: "NO_LOCATOR" };
  const pending = locator.pendingUpgrade;
  if (!pending) return { ok: false, code: "NO_PENDING" };
  if (pending.createdAt !== input.createdAt) return { ok: false, code: "SUPERSEDED" };
  // The binding is the step revision: type, name, safety, the whole locator and its context.
  if (!locatorBindingMatches(pending.binding, step)) return { ok: false, code: "STALE" };
  if (!isPromotableBaseline(locator)) return { ok: false, code: "BASELINE_NOT_PROMOTABLE" };

  // T3 first and unconditionally, on the step as it is NOW — a sensitive or protected-login step is
  // refused for what it is, never because it happened to run out of evidence first.
  const t3 = decideAiAction("locatorSemanticUpgrade", "locatorChange", { step }, { enabled: true });
  if (t3.decision === "forbidden" && t3.reason.startsWith("T3_")) {
    return { ok: false, code: t3.reason as Extract<AiPolicyReason, `T3_${string}`> };
  }

  // Eligibility is re-derived here from the step as it is NOW plus the runtime tally: a tally written
  // for a superseded candidate or an older step has different digests and is not counted.
  const digests = pendingUpgradeDigests(step);
  if (!digests) return { ok: false, code: "NO_PENDING" };
  const replayPolicy = input.replayPolicy ?? LOCATOR_UPGRADE_REPLAY_POLICY;
  const tally = selectReplayEvidence(input.replayProofs, profile.id, stepId, digests, replayPolicy);
  const evaluation = evaluatePendingUpgrade(step, tally, digests, replayPolicy);
  if (evaluation.state === "replay-rejected") return { ok: false, code: "REPLAY_REJECTED" };
  if (evaluation.state !== "eligible" || !evaluation.proofSatisfied) return { ok: false, code: "PROOF_NOT_SATISFIED" };

  // T3 is evaluated against the step as it is now, not as it was when the candidate was proposed.
  const decision = decideAiAction(
    "locatorSemanticUpgrade",
    "locatorChange",
    { step, meaningChange: evaluation.meaningChange, proofSatisfied: evaluation.proofSatisfied },
    input.policy
  );
  if (decision.decision === "forbidden") {
    return { ok: false, code: decision.reason.startsWith("T3_") ? (decision.reason as Extract<AiPolicyReason, `T3_${string}`>) : "POLICY_REFUSED" };
  }
  if (input.mode === "auto") {
    if (decision.decision !== "autoApply") return { ok: false, code: "POLICY_REFUSED" };
    if (replayPolicy.committed !== true) return { ok: false, code: "THRESHOLDS_PROVISIONAL" };
  } else if (decision.decision !== "autoApply" && decision.decision !== "suggest") {
    // T0 observes. It may describe a candidate; it may not put one into a saved flow.
    return { ok: false, code: "POLICY_REFUSED" };
  }
  const tier: "T1" | "T2" = input.mode === "auto" ? "T2" : "T1";

  // `previous` is the exact pre-change locator, one level deep: it never carries AI fields of its own.
  const { locatorProvenance: _priorProvenance, pendingUpgrade: _pending, ...previous } = locator;
  const { guard: _guard, ...carried } = previous;
  const promoted: StepLocator = {
    ...carried,
    strategy: pending.candidate.strategy,
    value: pending.candidate.value,
    // Assigned even when the candidate has neither, so the replaced primary's accessible name or
    // exact-match flag cannot survive onto a candidate that was proven without them.
    name: pending.candidate.name,
    exact: pending.candidate.exact,
    // EXACTLY the scope the proof used: `proveCompiledCandidate` built and counted the candidate
    // under the compiled context, so carrying the old one (containers included) would run something
    // no gate ever saw. `undefined` here is a scope of its own, not "keep what was there".
    context: pending.context,
    // The replaced primary's record-time evidence described a different selector. What replaces it is
    // what the proof actually established: this candidate matched exactly one element, and that
    // element was the baseline's. It also stops `isPositionalLocator` classifying the new semantic
    // primary as positional, which would send `LocatorFactory` back down the guarded-positional path.
    quality: { strategy: pending.candidate.strategy, isUnique: true, matchCount: 1, confidence: "high" }
  };
  const provenance: LocatorProvenance = {
    schemaVersion: 1,
    source: "ai-semantic-upgrade",
    tier,
    actionId: input.actionId,
    modelId: pending.modelId,
    proof: "replay-proven",
    appliedAt: input.nowIso,
    // Bound to the step AS APPLIED, so revert is refused once the user edits the promoted locator.
    binding: createLocatorApprovalBinding({ ...step, locator: promoted })!,
    previous
  };
  const nodes = profile.nodes.slice();
  nodes[index] = { ...step, locator: { ...promoted, locatorProvenance: provenance } };

  return {
    ok: true,
    profile: { ...profile, nodes, updatedAt: input.nowIso },
    evaluation,
    record: {
      schemaVersion: 1,
      id: input.actionId,
      feature: "locatorSemanticUpgrade",
      actionClass: "locatorChange",
      tier,
      target: { kind: "stepLocator", flowId: profile.id, stepId },
      // Digests only: they identify the proven candidate and the step revision without carrying either.
      evidenceIds: [`candidate:${digests.candidateDigest}`, `binding:${digests.bindingDigest}`],
      proof: { result: "replay-proven", replays: evaluation.replays, dataRows: evaluation.dataRows },
      modelId: pending.modelId,
      createdAt: input.nowIso,
      revertHandle: { kind: "locatorProvenance" }
    }
  };
}
