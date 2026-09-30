import type { Frame, Page } from "playwright";

import type { FlowStep, LocatorElementFingerprint } from "@src/profiles/FlowProfile";

import { stepCandidatesDigest } from "../LocatorRecoveryStore";
import { createPageFingerprint, hashFingerprint, similarity } from "../locatorFingerprint";
import { RECOVERY_SCORE_THRESHOLD, isRecoveryCompatible, rankLocalRecovery, type RecoveryDecision } from "../recoverySnapshot";
import type { LocatorRecoveryStage } from "../LocatorFactory";
import { DOM_INTELLIGENCE_LIMITS, type DomCandidateProof, type DomIntelligenceRecoveryOptions, type DomRepairSuggestion } from "./DomIntelligenceProvider";
import { captureDomSnapshot, withDeadline } from "./domSnapshot";

/**
 * AWKIT's verdict on one provider candidate, over the SAME competitor set the recovery proof uses
 * (every visible element sharing the recorded tag or role). A candidate is `proven` only when it is
 * AWKIT's own gated winner; otherwise the verdict names the first rule it fails.
 */
export function proveCandidate(
  step: Pick<FlowStep, "type">,
  expected: LocatorElementFingerprint | undefined,
  candidate: { index: number; fingerprint?: LocatorElementFingerprint },
  decision: RecoveryDecision | undefined
): { proof: DomCandidateProof; awkitScore?: number } {
  if (!expected || !decision) return { proof: "no-recorded-identity" };
  const fingerprint = candidate.fingerprint;
  if (!fingerprint) return { proof: "not-visible" };
  const awkitScore = Number(similarity(expected, fingerprint).toFixed(3));
  if (!isRecoveryCompatible(step, fingerprint)) return { proof: "incompatible", awkitScore };
  if (decision.winner?.index === candidate.index) return { proof: "proven", awkitScore };
  if (awkitScore < RECOVERY_SCORE_THRESHOLD) return { proof: "below-threshold", awkitScore };
  // It clears the threshold but is not the gated winner: either another element is within the margin,
  // or it is the best but fails the ancestry veto.
  return { proof: decision.best?.index === candidate.index && decision.refusal === "ancestry-veto" ? "ancestry-veto" : "ambiguous-margin", awkitScore };
}

/** Fingerprint one `body *` element by index (candidates outside the pruned set). */
export async function fingerprintAt(frame: Frame, index: number): Promise<LocatorElementFingerprint | undefined> {
  try {
    return hashFingerprint(await frame.locator("body *").nth(index).evaluate(createPageFingerprint));
  } catch {
    return undefined;
  }
}

type SuggestionStage = Pick<LocatorRecoveryStage, "outcome" | "reason" | "candidates" | "score">;

/**
 * The runner's provider stage (plan E4): only after both recovery layers refused, only for a step with
 * a stored, still-bound reference, inside a wall-clock budget. The result is a bounded, NON-EXECUTING
 * suggestion for the run's provenance. Nothing here can make a step act on an element.
 */
export async function suggestRepair(input: {
  page: Page;
  frame: Frame;
  step: FlowStep;
  expected: LocatorElementFingerprint;
  options: DomIntelligenceRecoveryOptions;
}): Promise<{ stage: SuggestionStage; suggestion?: DomRepairSuggestion }> {
  const { frame, step, expected, options } = input;
  const referenceId = step.locator?.blueprintId;
  if (!referenceId || !step.locator) return { stage: { outcome: "skipped", reason: "no-reference" } };
  const reference = await options.references.get(referenceId, stepCandidatesDigest(step.locator)).catch(() => undefined);
  if (!reference) return { stage: { outcome: "skipped", reason: "no-reference" } };

  const budgetMs = Math.max(50, Math.min(options.budgetMs ?? 800, DOM_INTELLIGENCE_LIMITS.maxTimeoutMs));
  const deadline = performance.now() + budgetMs;
  const snapshot = await withDeadline(
    captureDomSnapshot(frame, { mode: "recover", expected }).catch(() => undefined),
    budgetMs,
    () => undefined
  );
  if (!snapshot) return { stage: { outcome: "error", reason: "snapshot-failed" } };
  if (snapshot.refused) return { stage: { outcome: "skipped", reason: "protected-surface" } };

  const remaining = Math.max(50, deadline - performance.now());
  const result = await options.provider.findRecoveryCandidates({ html: snapshot.html, reference, maxCandidates: 5, timeoutMs: remaining });
  if (!result.ok) {
    const reason = result.code === "TIMEOUT" ? "provider-timeout" : result.code === "DISABLED" || result.code === "UNAVAILABLE" ? "provider-unavailable" : "provider-error";
    return { stage: { outcome: "error", reason } };
  }
  const status = await options.provider.getStatus().catch(() => undefined);
  const suggestion: DomRepairSuggestion = { provider: status?.provider ?? "none", candidates: result.candidates.length };
  const top = result.candidates[0];
  if (!top) return { stage: { outcome: "suggested", reason: "no-candidate", candidates: 0 }, suggestion };

  const decision = snapshot.candidatesTruncated ? undefined : rankLocalRecovery(step, expected, snapshot.candidates);
  const known = snapshot.candidates.find((entry) => entry.index === top.index)?.fingerprint;
  const fingerprint = known ?? (performance.now() < deadline ? await fingerprintAt(frame, top.index) : undefined);
  const verdict = proveCandidate(step, expected, { index: top.index, fingerprint }, decision);
  suggestion.best = { providerScore: top.score, ...verdict };
  return { stage: { outcome: "suggested", candidates: result.candidates.length, score: top.score }, suggestion };
}
