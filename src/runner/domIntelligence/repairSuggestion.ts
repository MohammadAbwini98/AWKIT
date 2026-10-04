import type { Frame, Locator, Page } from "playwright";

import type { FlowStep, LocatorElementFingerprint } from "@src/profiles/FlowProfile";
import { detectRecorderProtectedLogin } from "@src/security/ProtectedLoginDetector";

import { stepCandidatesDigest } from "../LocatorRecoveryStore";
import { createPageFingerprint, hashFingerprint, similarity } from "../locatorFingerprint";
import {
  RECOVERY_SCORE_THRESHOLD,
  decideProviderAgreement,
  isRecoveryCompatible,
  rankLocalRecovery,
  recheckSnapshotWinner,
  type RecoveryDecision
} from "../recoverySnapshot";
import type { LocatorRecoveryStage } from "../LocatorFactory";
import { DOM_INTELLIGENCE_LIMITS, type DomCandidateProof, type DomIntelligenceRecoveryOptions, type DomRepairSuggestion } from "./DomIntelligenceProvider";
import { captureDomSnapshot, withDeadline } from "./domSnapshot";
import { compareRoutes, routeKey } from "../routeIdentity";

/**
 * AWKIT's verdict on one provider candidate, over the SAME competitor set the recovery proof uses
 * (every visible element sharing the recorded tag or role). A candidate is `proven` only when it is
 * AWKIT's own gated winner; otherwise the verdict names the first rule it fails.
 */
export function proveCandidate(
  step: Pick<FlowStep, "type">,
  expected: LocatorElementFingerprint | undefined,
  candidate: { index: number; fingerprint?: LocatorElementFingerprint },
  decision: RecoveryDecision | undefined,
  agreement?: { index: number }
): { proof: DomCandidateProof; awkitScore?: number } {
  if (!expected || !decision) return { proof: "no-recorded-identity" };
  const fingerprint = candidate.fingerprint;
  if (!fingerprint) return { proof: "not-visible" };
  const awkitScore = Number(similarity(expected, fingerprint).toFixed(3));
  if (!isRecoveryCompatible(step, fingerprint)) return { proof: "incompatible", awkitScore };
  if (decision.winner?.index === candidate.index) return { proof: "proven", awkitScore };
  if (agreement?.index === candidate.index) return { proof: "agreed", awkitScore };
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
 * a stored, still-bound reference, inside a wall-clock budget. The result is a bounded suggestion for the
 * run's provenance. Since L12 it can also carry `agreed`: AWKIT's best candidate that the provider ranks
 * first (`decideProviderAgreement`), re-proven and pinned by the same stale-snapshot check every recovery
 * layer uses. The caller still applies the actionability veto before acting on it.
 */
export async function suggestRepair(input: {
  page: Page;
  frame: Frame;
  step: FlowStep;
  expected: LocatorElementFingerprint;
  /** `domReferenceId(step, flowId)`; defaults to the step's blueprint id. */
  referenceId?: string;
  options: DomIntelligenceRecoveryOptions;
}): Promise<{ stage: SuggestionStage; suggestion?: DomRepairSuggestion; agreed?: { locator: Locator; fingerprint: LocatorElementFingerprint; score: number } }> {
  const { frame, step, expected, options } = input;
  const referenceId = input.referenceId ?? step.locator?.blueprintId;
  if (!referenceId || !step.locator) return { stage: { outcome: "skipped", reason: "no-reference" } };
  const reference = await options.references.get(referenceId, stepCandidatesDigest(step.locator)).catch(() => undefined);
  if (!reference) return { stage: { outcome: "skipped", reason: "no-reference" } };
  // A reference proven on another route never describes an element here (L11.F).
  if (compareRoutes(reference.route, routeKey(frame.url())) === "mismatch") return { stage: { outcome: "skipped", reason: "route-mismatch" } };

  const budgetMs = Math.max(50, Math.min(options.budgetMs ?? 800, DOM_INTELLIGENCE_LIMITS.maxTimeoutMs));
  const deadline = performance.now() + budgetMs;
  // A protected sign-in, MFA, CAPTCHA, passkey or device-approval surface never reaches the host: the
  // Recorder's own detector first, then the serializer's password and one-time-code check below.
  const detection = await withDeadline(detectRecorderProtectedLogin(input.page).catch(() => undefined), budgetMs, () => undefined);
  if (!detection) return { stage: { outcome: "error", reason: "snapshot-failed" } };
  if (detection.detected && detection.recommendedAction === "pause") return { stage: { outcome: "skipped", reason: "protected-surface" } };
  const snapshot = await withDeadline(
    captureDomSnapshot(frame, { mode: "recover", expected }).catch(() => undefined),
    Math.max(50, deadline - performance.now()),
    () => undefined
  );
  if (!snapshot) return { stage: { outcome: "error", reason: "snapshot-failed" } };
  if (snapshot.refused) return { stage: { outcome: "skipped", reason: "protected-surface" } };

  const remaining = Math.max(50, deadline - performance.now());
  // The stage's own deadline also covers a cold host start (spawn to hello), which the provider bounds
  // separately and generously; the run never waits for it past this budget.
  const result = await withDeadline(
    options.provider.findRecoveryCandidates({
      html: snapshot.html,
      reference,
      maxCandidates: 5,
      timeoutMs: remaining,
      // L12.2: only AWKIT's own competitors can be accepted, so only they are scored (a truncated set: all).
      ...(snapshot.candidatesTruncated ? {} : { candidateIndices: snapshot.candidates.map((candidate) => candidate.index) })
    }),
    remaining,
    () => ({ ok: false as const, code: "TIMEOUT" as const, message: "The repair-suggestion budget ran out." })
  );
  if (!result.ok) {
    const reason = result.code === "TIMEOUT" ? "provider-timeout" : result.code === "DISABLED" || result.code === "UNAVAILABLE" ? "provider-unavailable" : "provider-error";
    return { stage: { outcome: "error", reason } };
  }
  const status = await options.provider.getStatus().catch(() => undefined);
  const suggestion: DomRepairSuggestion = { provider: status?.provider ?? "none", candidates: result.candidates.length };
  const top = result.candidates[0];
  if (!top) return { stage: { outcome: "suggested", reason: "no-candidate", candidates: 0 }, suggestion };

  const decision = snapshot.candidatesTruncated ? undefined : rankLocalRecovery(step, expected, snapshot.candidates);
  const agreement = decideProviderAgreement(decision, expected.ancestry, result.candidates);
  const known = snapshot.candidates.find((entry) => entry.index === top.index)?.fingerprint;
  const fingerprint = known ?? (performance.now() < deadline ? await fingerprintAt(frame, top.index) : undefined);
  const verdict = proveCandidate(step, expected, { index: top.index, fingerprint }, decision, agreement);
  suggestion.best = { providerScore: top.score, ...verdict };
  const stage: SuggestionStage = { outcome: "suggested", candidates: result.candidates.length, score: top.score };
  if (!agreement) return { stage, suggestion };
  // The page may have changed since the snapshot: exactly one element must still carry the agreed
  // identity at that index, and the step acts on that pinned node only (as for every recovery layer).
  const locator = await recheckSnapshotWinner(frame.locator("body *"), frame, agreement).catch(() => undefined);
  if (!locator) return { stage: { ...stage, outcome: "refused", reason: "stale-snapshot" }, suggestion };
  return { stage: { ...stage, outcome: "proven" }, suggestion, agreed: { locator, fingerprint: agreement.fingerprint, score: agreement.score } };
}
