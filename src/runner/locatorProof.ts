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
import { createHash } from "node:crypto";
import type { Locator, Page } from "playwright";
import { evaluateLocatorPlan, planFromCandidate, type CompiledLocatorPlan, type LocatorPlanPolicy } from "@src/ai/locatorPlan";
import { mergeReplayProof, type LocatorReplayProofRecord } from "@src/ai/pendingUpgrade";
import { locatorFrameChain, type FlowStep, type LocatorCandidate, type LocatorContext } from "@src/profiles/FlowProfile";
import { createLocatorApprovalBinding, locatorBindingMatches } from "@src/profiles/locatorApproval";
import { UPGRADE_CONTEXT_TTL_MS, type UpgradeContext } from "@src/recorder/upgradeContext";
import { decideAiAction } from "@src/security/authz/AiAutonomyPolicy";
import { detectRecorderProtectedLogin } from "@src/security/ProtectedLoginDetector";
import type { InstanceExecutionContext } from "./InstanceExecutionContext";
import { LocatorFactory } from "./LocatorFactory";
import type { LocatorRecoveryStore } from "./LocatorRecoveryStore";

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
  /** Whether the candidate may be stored as `pendingUpgrade` (proven now, or unprovable now). */
  pendingEligible: boolean;
}

const NOT_RUN = { policy: "not-run", buildable: "not-run", unique: "not-run", sameElement: "not-run" } as const;

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Frame chain + shadow scope: the part of a context a candidate may never change. */
const scopeOf = (context?: LocatorContext): string => canonical({ frames: locatorFrameChain(context), shadow: context?.shadow });

export function locatorCandidateDigest(candidate: LocatorCandidate, context?: LocatorContext): string {
  return sha256(canonical({ candidate, context }));
}

export function pendingUpgradeDigests(step: FlowStep): { candidateDigest: string; bindingDigest: string } | undefined {
  const pending = step.locator?.pendingUpgrade;
  const binding = createLocatorApprovalBinding(step);
  if (!pending || !binding) return undefined;
  return { candidateDigest: locatorCandidateDigest(pending.candidate, pending.context), bindingDigest: sha256(canonical(binding)) };
}

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
