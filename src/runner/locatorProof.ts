/**
 * Real-browser proof gates for AI locator candidates (Phase L, L3 §4) and the replay proof of a pending
 * candidate (L3 §5). Every candidate reaches the browser only through the trusted compiler and intent
 * guard in `src/ai/locatorPlan.ts`; then, on the live page:
 *
 *   D  policy: no T3 step (sensitive action, protected-login step), no protected-login surface, and the
 *      candidate's frame chain and shadow scope are exactly the step's captured ones;
 *   -  the step's own locator (the guarded baseline) resolves through `LocatorFactory.resolve`, which
 *      re-proves a guarded-positional target's identity; if it cannot, nothing is proven;
 *   A  the candidate builds through the same `LocatorFactory` frame/shadow/container root;
 *   B  it matches exactly one element;
 *   C  that element IS the baseline's element (DOM node identity in the same JS context).
 *
 * Proof is observational: counts, element handles and one identity comparison. Nothing is clicked,
 * typed, navigated or submitted, and the factory used here has no recovery memory, so resolving the
 * baseline writes nothing. Results carry codes, gates, counts and a digest — never candidate text,
 * page text or typed values.
 */
import type { Locator, Page } from "playwright";
import { evaluateLocatorPlan, planFromCandidate, type CompiledLocatorPlan, type LocatorPlanPolicy } from "@src/ai/locatorPlan";
import {
  canonicalJson as canonical,
  locatorCandidateDigest,
  mergeReplayProof,
  pendingUpgradeDigests,
  sha256Hex as sha256,
  type LocatorReplayProofRecord
} from "@src/ai/pendingUpgrade";
import { locatorFrameChain, type FlowStep, type LocatorContext, type LocatorGuard, type PendingProofEvidence } from "@src/profiles/FlowProfile";
import { locatorBindingMatches } from "@src/profiles/locatorApproval";
import { UPGRADE_CONTEXT_TTL_MS, type UpgradeContext } from "@src/recorder/upgradeContext";
import { decideAiAction } from "@src/security/authz/AiAutonomyPolicy";
import { detectRecorderProtectedLogin } from "@src/security/ProtectedLoginDetector";
import type { InstanceExecutionContext } from "./InstanceExecutionContext";
import { LocatorFactory } from "./LocatorFactory";
import { fingerprintsEqual, similarity } from "./locatorFingerprint";
import type { LocatorElementFingerprint, LocatorRecoveryStore } from "./LocatorRecoveryStore";

export type LocatorProofOutcome = "proven" | "rejected" | "unprovable-now";
export type ProofGate = "pass" | "fail" | "not-run";

export interface LocatorProofResult {
  schemaVersion: 1;
  outcome: LocatorProofOutcome;
  /** Stable code: `PROVEN`, a compiler/intent code, a `T3_*` policy reason, or a browser-gate code. */
  code: string;
  /** Compiler/intent path of the refused field; never its value. */
  field?: string;
  compiled: boolean;
  intent: "passed" | "rejected" | "not-run";
  meaningChange?: boolean;
  /** sha256 of the compiled candidate and its scope. */
  candidateDigest?: string;
  gates: { policy: ProofGate; buildable: ProofGate; unique: ProofGate; sameElement: ProofGate };
  scope: "compatible" | "mismatch" | "not-checked";
  baselineMatchCount?: number;
  candidateMatchCount?: number;
  /** L3 §8 only: which saved identity gate C compared against, and how closely it matched. */
  identityAnchor?: PendingProofEvidence["identityAnchor"];
  identityScore?: number;
  /** Whether the candidate may be stored as `pendingUpgrade` (proven now, or unprovable now). */
  pendingEligible: boolean;
}

const NOT_RUN = { policy: "not-run", buildable: "not-run", unique: "not-run", sameElement: "not-run" } as const;

// The digest helpers moved to `src/ai/pendingUpgrade.ts` when L3 §6 needed them outside the runner
// (promotion must recompute them without importing Playwright). Re-exported so the runner remains
// the one place the proof path imports them from.
export { locatorCandidateDigest, pendingUpgradeDigests };

/** Frame chain + shadow scope: the part of a context a candidate may never change. */
const scopeOf = (context?: LocatorContext): string => canonical({ frames: locatorFrameChain(context), shadow: context?.shadow });

function result(outcome: LocatorProofOutcome, code: string, partial: Partial<LocatorProofResult> = {}): LocatorProofResult {
  return {
    schemaVersion: 1,
    outcome,
    code,
    compiled: false,
    intent: "not-run",
    gates: { ...NOT_RUN },
    scope: "not-checked",
    ...partial,
    pendingEligible: outcome !== "rejected"
  };
}

/** Gates D, A, B and C for a candidate that already passed the compiler and the intent guard. */
export async function proveCompiledCandidate(
  page: Page,
  step: FlowStep,
  compiled: CompiledLocatorPlan,
  meta: { meaningChange: boolean }
): Promise<LocatorProofResult> {
  const base: Partial<LocatorProofResult> = {
    compiled: true,
    intent: "passed",
    meaningChange: meta.meaningChange,
    candidateDigest: locatorCandidateDigest(compiled.candidate, compiled.context)
  };
  const gates = { ...NOT_RUN } as LocatorProofResult["gates"];
  const done = (outcome: LocatorProofOutcome, code: string, extra: Partial<LocatorProofResult> = {}) =>
    result(outcome, code, { ...base, gates: { ...gates }, ...extra });

  // D — policy, before the page is touched.
  const policy = decideAiAction("locatorSemanticUpgrade", "locatorChange", { step }, { enabled: true });
  if (policy.decision === "forbidden") {
    gates.policy = "fail";
    return done("rejected", policy.reason);
  }
  if (!step.locator) {
    gates.policy = "fail";
    return done("rejected", "NO_BASELINE");
  }
  if (scopeOf(compiled.context) !== scopeOf(step.locator.context)) {
    gates.policy = "fail";
    return done("rejected", "FRAME_CONTEXT_MISMATCH", { scope: "mismatch" });
  }
  if (page.isClosed()) return done("unprovable-now", "PAGE_UNAVAILABLE", { scope: "compatible" });
  // The Recorder's DOM-signal detector (the one Element Spy refuses on), not the runner's lenient
  // text-only pause check: any protected-login signal means no AI evidence from this page at all.
  const detection = await detectRecorderProtectedLogin(page).catch(() => null);
  if (detection?.detected) {
    gates.policy = "fail";
    return done("rejected", "T3_PROTECTED_LOGIN", { scope: "compatible" });
  }
  gates.policy = "pass";

  // The guarded baseline. A fresh factory without memory: resolving it records and recovers nothing.
  const factory = new LocatorFactory(page);
  let baseline: Locator;
  try {
    baseline = await factory.resolve(step);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /IDENTITY_CHANGED/.test(message) ? "BASELINE_IDENTITY_CHANGED" : "BASELINE_UNRESOLVED";
    return done("unprovable-now", code, { scope: "compatible" });
  }
  const baselineMatchCount = await baseline.count().catch(() => 0);
  if (baselineMatchCount !== 1) {
    return done("unprovable-now", baselineMatchCount === 0 ? "TARGET_MISSING" : "BASELINE_UNRESOLVED", { scope: "compatible", baselineMatchCount });
  }

  // A — buildable through the same root.
  let candidate: Locator;
  try {
    candidate = await factory.locateCandidate(compiled.candidate, compiled.context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    gates.buildable = "fail";
    return done("rejected", /did not resolve strictly/.test(message) ? "CANDIDATE_NOT_UNIQUE" : "NOT_BUILDABLE", { scope: "compatible", baselineMatchCount });
  }
  gates.buildable = "pass";

  // B — exactly one element.
  const candidateMatchCount = await candidate.count().catch(() => 0);
  if (candidateMatchCount !== 1) {
    gates.unique = "fail";
    return done("rejected", candidateMatchCount === 0 ? "CANDIDATE_NO_MATCH" : "CANDIDATE_NOT_UNIQUE", { scope: "compatible", baselineMatchCount, candidateMatchCount });
  }
  gates.unique = "pass";

  // C — the same DOM node. Handles from different frames cannot meet in one evaluation.
  const [baselineHandle, candidateHandle] = await Promise.all([
    baseline.elementHandle({ timeout: 1_000 }).catch(() => null),
    candidate.elementHandle({ timeout: 1_000 }).catch(() => null)
  ]);
  try {
    if (!baselineHandle || !candidateHandle) {
      return done("unprovable-now", "TARGET_MISSING", { scope: "compatible", baselineMatchCount, candidateMatchCount });
    }
    let same: boolean;
    try {
      same = await baselineHandle.evaluate((a, b) => a === b, candidateHandle);
    } catch {
      gates.sameElement = "fail";
      return done("rejected", "FRAME_CONTEXT_MISMATCH", { scope: "mismatch", baselineMatchCount, candidateMatchCount });
    }
    gates.sameElement = same ? "pass" : "fail";
    return same
      ? done("proven", "PROVEN", { scope: "compatible", baselineMatchCount, candidateMatchCount })
      : done("rejected", "WRONG_ELEMENT", { scope: "compatible", baselineMatchCount, candidateMatchCount });
  } finally {
    await baselineHandle?.dispose().catch(() => undefined);
    await candidateHandle?.dispose().catch(() => undefined);
  }
}

// ── L3 §8: runtime repair ───────────────────────────────────────────────────────────────────────

/**
 * The saved identity a repair candidate is proven against.
 *
 * §4's gate C asks "is this the same DOM node the baseline resolves to". A repair cannot: the
 * baseline failing is the whole premise. So gate C becomes "does this element's re-derived
 * fingerprint match an identity the product already recorded for this step", using
 * `LocatorFactory`'s own threshold and its own fingerprint pipeline — never a second definition of
 * sameness, which is how a repair would come to accept an element the guarded path refuses.
 */
export interface RepairIdentityAnchor {
  fingerprint: LocatorElementFingerprint;
  /** `exact` demands equality; anything else accepts `similarity >= GUARD_MATCH_THRESHOLD`. */
  confidence: LocatorGuard["confidence"];
  source: NonNullable<PendingProofEvidence["identityAnchor"]>;
}

/**
 * Pick the saved identity to prove against, most authoritative first.
 *
 * 1. The step's own positional `guard` — capture-time identity, in the profile, with its confidence.
 * 2. A caller-supplied blueprint element — capture-time identity from the page model. It is passed
 *    in rather than looked up here because the deterministic recovery §8 runs *first* has already
 *    resolved the page key, the frame and the document fingerprint to find it; re-deriving that
 *    probe would be a second copy of `LocatorFactory.recoverFromBlueprint`'s preamble.
 * 3. The runtime recovery memory — the identity of the element that last resolved successfully.
 *
 * Undefined when the product recorded no identity for this step at all. A repair then has nothing to
 * prove against, and guessing is exactly what L3 forbids.
 */
export function resolveRepairAnchor(
  step: FlowStep,
  sources: { blueprint?: { fingerprint: LocatorElementFingerprint }; recovery?: { fingerprint?: LocatorElementFingerprint } } = {}
): RepairIdentityAnchor | undefined {
  const guard = step.locator?.guard;
  if (guard?.fingerprint) return { fingerprint: guard.fingerprint, confidence: guard.confidence, source: "guard" };
  if (sources.blueprint) return { fingerprint: sources.blueprint.fingerprint, confidence: "high", source: "blueprint" };
  if (sources.recovery?.fingerprint) return { fingerprint: sources.recovery.fingerprint, confidence: "high", source: "recovery-memory" };
  return undefined;
}

/** Whether a re-derived fingerprint is the anchored element, by `LocatorFactory`'s own rule. */
function identityMatch(anchor: RepairIdentityAnchor, observed: LocatorElementFingerprint): { same: boolean; score: number } {
  if (anchor.confidence === "exact") {
    const same = fingerprintsEqual(observed, anchor.fingerprint);
    return { same, score: same ? 1 : similarity(anchor.fingerprint, observed) };
  }
  const score = similarity(anchor.fingerprint, observed);
  return { same: score >= LocatorFactory.GUARD_MATCH_THRESHOLD, score };
}

/**
 * Gates for a repair candidate (L3 §8). Same D/A/B as §4, with two differences that matter:
 *
 *   E  the step's saved locator must be OBSERVED FAILING right now. A "repair" of a locator that
 *      still resolves uniquely is not a repair — it is an unproven replacement of working behavior,
 *      so it is refused outright (`BASELINE_HEALTHY`) rather than stored for later.
 *   C  identity against {@link RepairIdentityAnchor} instead of DOM node identity with the baseline.
 *
 * Observational only: counts, one fingerprint read, no click, type, navigation or write.
 */
export async function proveRepairCandidate(
  page: Page,
  step: FlowStep,
  compiled: CompiledLocatorPlan,
  anchor: RepairIdentityAnchor | undefined,
  meta: { meaningChange: boolean }
): Promise<LocatorProofResult> {
  const base: Partial<LocatorProofResult> = {
    compiled: true,
    intent: "passed",
    meaningChange: meta.meaningChange,
    candidateDigest: locatorCandidateDigest(compiled.candidate, compiled.context)
  };
  const gates = { ...NOT_RUN } as LocatorProofResult["gates"];
  // A repair is storable ONLY when it is proven. `unprovable-now` is deferral, and deferral is what
  // replay resolves — but replay proves against a baseline that, here, by definition does not
  // resolve. So an unproven repair has no route to ever becoming proven and is never written.
  const done = (outcome: LocatorProofOutcome, code: string, extra: Partial<LocatorProofResult> = {}): LocatorProofResult => ({
    ...result(outcome, code, { ...base, gates: { ...gates }, ...extra }),
    pendingEligible: outcome === "proven"
  });

  // D — policy, before the page is touched. `locatorRepair` has its own feature id, but T3 is a
  // property of the STEP, so a sensitive or protected-login step is refused here exactly as in §4.
  const policy = decideAiAction("locatorRepair", "locatorChange", { step }, { enabled: true });
  if (policy.decision === "forbidden") {
    gates.policy = "fail";
    return done("rejected", policy.reason);
  }
  if (!step.locator) {
    gates.policy = "fail";
    return done("rejected", "NO_BASELINE");
  }
  if (scopeOf(compiled.context) !== scopeOf(step.locator.context)) {
    gates.policy = "fail";
    return done("rejected", "FRAME_CONTEXT_MISMATCH", { scope: "mismatch" });
  }
  // No anchor means the product never recorded an identity for this step. Terminal, not deferred:
  // waiting does not create one, and proving against the candidate's own say-so is not a proof.
  if (!anchor) {
    gates.policy = "fail";
    return done("rejected", "NO_IDENTITY_ANCHOR", { scope: "compatible" });
  }
  if (page.isClosed()) return done("unprovable-now", "PAGE_UNAVAILABLE", { scope: "compatible" });
  const detection = await detectRecorderProtectedLogin(page).catch(() => null);
  if (detection?.detected) {
    gates.policy = "fail";
    return done("rejected", "T3_PROTECTED_LOGIN", { scope: "compatible" });
  }
  gates.policy = "pass";

  // E — the baseline really is broken. A fresh factory with no memory, so this observation neither
  // records a winner nor consumes the recovery path the runner already tried.
  const factory = new LocatorFactory(page);
  let baselineMatchCount = 0;
  try {
    baselineMatchCount = await (await factory.resolve(step)).count().catch(() => 0);
  } catch {
    // Unresolvable is the expected state for a repair: leave the count at 0 and continue.
    baselineMatchCount = 0;
  }
  if (baselineMatchCount === 1) {
    return done("rejected", "BASELINE_HEALTHY", { scope: "compatible", baselineMatchCount });
  }

  // A — buildable through the same frame/shadow/container root.
  let candidate: Locator;
  try {
    candidate = await factory.locateCandidate(compiled.candidate, compiled.context);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    gates.buildable = "fail";
    return done("rejected", /did not resolve strictly/.test(message) ? "CANDIDATE_NOT_UNIQUE" : "NOT_BUILDABLE", { scope: "compatible", baselineMatchCount });
  }
  gates.buildable = "pass";

  // B — exactly one element.
  const candidateMatchCount = await candidate.count().catch(() => 0);
  if (candidateMatchCount !== 1) {
    gates.unique = "fail";
    return done("rejected", candidateMatchCount === 0 ? "CANDIDATE_NO_MATCH" : "CANDIDATE_NOT_UNIQUE", { scope: "compatible", baselineMatchCount, candidateMatchCount });
  }
  gates.unique = "pass";

  // C — identity against the saved anchor, through LocatorFactory's own fingerprint pipeline.
  const observed = await LocatorFactory.fingerprintOne(candidate);
  if (!observed) {
    return done("unprovable-now", "TARGET_UNFINGERPRINTABLE", { scope: "compatible", baselineMatchCount, candidateMatchCount });
  }
  const identity = identityMatch(anchor, observed);
  gates.sameElement = identity.same ? "pass" : "fail";
  return done(identity.same ? "proven" : "rejected", identity.same ? "REPAIR_PROVEN" : "WRONG_ELEMENT", {
    scope: "compatible",
    baselineMatchCount,
    candidateMatchCount,
    identityAnchor: anchor.source,
    identityScore: Math.round(identity.score * 1000) / 1000
  });
}

/** Raw-plan entry for a repair job: compile and intent-guard, then run the repair gates. */
export async function proveRepairPlan(
  page: Page,
  step: FlowStep,
  plan: unknown,
  input: { boundValues: readonly string[]; anchor?: RepairIdentityAnchor; policy?: LocatorPlanPolicy }
): Promise<LocatorProofResult> {
  if (!step.locator) return result("rejected", "NO_BASELINE");
  const evaluated = evaluateLocatorPlan(plan, {
    boundValues: input.boundValues,
    baseline: step.locator,
    captured: step.locator.context,
    policy: input.policy
  });
  if (!evaluated.ok) {
    const intent = evaluated.code === "INTENT_BOUND_VALUE";
    return result("rejected", evaluated.code, { field: evaluated.field, compiled: intent, intent: intent ? "rejected" : "not-run" });
  }
  return proveRepairCandidate(page, step, evaluated, input.anchor, { meaningChange: evaluated.meaningChange });
}

/**
 * Capture-time entry (L3 §4/§5): a raw model plan against the step it would upgrade. `upgradeContext`
 * is the L2 memory-only capture context when the job has one; an expired one, or one captured in a
 * different frame depth, refuses the plan before compilation.
 */
export async function proveLocatorPlan(
  page: Page,
  step: FlowStep,
  plan: unknown,
  input: { boundValues: readonly string[]; policy?: LocatorPlanPolicy; upgradeContext?: UpgradeContext; now?: Date }
): Promise<LocatorProofResult> {
  if (!step.locator) return result("rejected", "NO_BASELINE");
  const context = input.upgradeContext;
  if (context) {
    const age = (input.now ?? new Date()).getTime() - Date.parse(context.capturedAt);
    if (!Number.isFinite(age) || age > UPGRADE_CONTEXT_TTL_MS) return result("rejected", "CONTEXT_EXPIRED");
    if (context.frameDepth !== locatorFrameChain(step.locator.context).length) return result("rejected", "FRAME_CONTEXT_MISMATCH", { scope: "mismatch" });
  }
  const evaluated = evaluateLocatorPlan(plan, {
    boundValues: input.boundValues,
    baseline: step.locator,
    captured: step.locator.context,
    policy: input.policy
  });
  if (!evaluated.ok) {
    const intent = evaluated.code === "INTENT_BOUND_VALUE";
    return result("rejected", evaluated.code, { field: evaluated.field, compiled: intent, intent: intent ? "rejected" : "not-run" });
  }
  return proveCompiledCandidate(page, step, evaluated, { meaningChange: evaluated.meaningChange });
}

/** Replay entry (L3 §5): re-compile and re-prove the step's stored pending candidate. No model call. */
export async function replayPendingUpgrade(page: Page, step: FlowStep, input: { boundValues: readonly string[] }): Promise<LocatorProofResult> {
  const pending = step.locator?.pendingUpgrade;
  if (!step.locator || !pending) return result("rejected", "NO_PENDING");
  if (!locatorBindingMatches(pending.binding, step)) return result("rejected", "STALE_PENDING");
  if (scopeOf(pending.context) !== scopeOf(step.locator.context)) return result("rejected", "FRAME_CONTEXT_MISMATCH", { scope: "mismatch" });
  const evaluated = evaluateLocatorPlan(planFromCandidate(pending.candidate, pending.context), {
    boundValues: input.boundValues,
    baseline: step.locator,
    captured: step.locator.context
  });
  if (!evaluated.ok) {
    const intent = evaluated.code === "INTENT_BOUND_VALUE";
    return result("rejected", evaluated.code, { field: evaluated.field, compiled: intent, intent: intent ? "rejected" : "not-run" });
  }
  return proveCompiledCandidate(page, step, evaluated, { meaningChange: evaluated.meaningChange || pending.meaningChange });
}

const MAX_BOUND_VALUES = 200;

/** Texts bound to this run that a candidate must never be scoped by: the data row, inputs and the step's own value. */
export function replayBoundValues(context: InstanceExecutionContext, step: FlowStep): string[] {
  const out = new Set<string>();
  const add = (value: unknown): void => {
    if (out.size >= MAX_BOUND_VALUES) return;
    if (typeof value === "string" && value.trim().length >= 2) out.add(value.trim());
    else if (typeof value === "number" && Number.isFinite(value) && String(value).length >= 2) out.add(String(value));
  };
  const addAll = (source: unknown): void => {
    if (Array.isArray(source)) source.forEach(add);
    else if (source && typeof source === "object") Object.values(source as Record<string, unknown>).forEach(add);
    else add(source);
  };
  addAll(context.currentRow);
  addAll(context.instanceInputs);
  addAll(context.runtimeInputs);
  add(step.value);
  add(step.valueSource?.value);
  return [...out];
}

/** A hashed key for the current data row; never the row's values. */
export function dataRowKey(context: InstanceExecutionContext): string {
  return context.currentRow === undefined ? "no-row" : sha256(canonical(context.currentRow)).slice(0, 24);
}

export interface PendingReplayObservation {
  result: LocatorProofResult;
  store: LocatorRecoveryStore;
  scopeKey: string;
  rowKey: string;
  digests: { candidateDigest: string; bindingDigest: string };
}

/**
 * Runner hook, before the step's action: prove the pending candidate against the element the baseline
 * resolves to right now. A refusal is recorded immediately; a proof counts only after the step passes
 * ({@link recordPendingReplay}), so the observable outcome, not mere resolution, earns a replay.
 */
export async function observePendingReplay(
  page: Page,
  step: FlowStep,
  context: InstanceExecutionContext,
  memory: { store: LocatorRecoveryStore; scopeKey: string },
  now: () => Date = () => new Date()
): Promise<PendingReplayObservation | undefined> {
  const digests = pendingUpgradeDigests(step);
  if (!digests || !memory.store.updateReplayProof) return undefined;
  const proof = await replayPendingUpgrade(page, step, { boundValues: replayBoundValues(context, step) });
  const observation: PendingReplayObservation = { result: proof, store: memory.store, scopeKey: memory.scopeKey, rowKey: dataRowKey(context), digests };
  if (proof.outcome === "rejected" && proof.code !== "STALE_PENDING") await record(observation, "rejected", now());
  return observation;
}

/** Runner hook, after the step: a proven candidate counts one replay only when the step passed. */
export async function recordPendingReplay(observation: PendingReplayObservation, stepPassed: boolean, now: Date = new Date()): Promise<void> {
  if (observation.result.outcome === "proven" && stepPassed) await record(observation, "proven", now);
}

async function record(observation: PendingReplayObservation, outcome: "proven" | "rejected", now: Date): Promise<LocatorReplayProofRecord | undefined> {
  return observation.store.updateReplayProof?.(observation.scopeKey, (previous) =>
    mergeReplayProof(previous, {
      scopeKey: observation.scopeKey,
      ...observation.digests,
      outcome,
      code: observation.result.code,
      rowKey: observation.rowKey,
      now
    })
  );
}
