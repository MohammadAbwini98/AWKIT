/**
 * Bounded locator-upgrade synthesis attempts (Phase L, L3 §7).
 *
 * One job asks the configured provider for a locator plan, runs it through the trusted pipeline that
 * L3 §2–§5 already own, and stops. `LOCATOR_PLAN_MAX_ATTEMPTS` synthesis attempts, **consumed only by
 * real rejections** (malformed output, compiler, intent, a browser rejection, a repeated candidate);
 * between them the next attempt gets structured deterministic feedback built from codes and field
 * paths only — never page text, model text, candidate text or a typed value.
 *
 * Every iteration either returns or consumes exactly one attempt, so the loop is bounded by
 * construction: there is no path that asks the provider again without spending budget. Outcomes that
 * produced no candidate at all (provider disabled, unavailable, timed out, cancelled) are terminal and
 * spend nothing, because retrying them is not synthesis. `unprovable-now` is likewise not a rejection
 * (L3 §5): the candidate is stored as `pendingUpgrade` for replay proof and the job ends.
 *
 * What this does NOT do: promote. A successful attempt writes `step.locator.pendingUpgrade` through the
 * existing compare-and-swap in the flow store's lane, and nothing else. Promotion, replay eligibility
 * and revert stay with L3 §5–§6. The saved locator remains authoritative throughout, so a provider that
 * is missing, disabled, slow or wrong changes no run, no Recorder session and no step's outcome.
 *
 * The provider, the browser proof and the profile write are all injected, so the whole lifecycle runs
 * against `FakeAiHostTransport` with no Electron and, for the pure cases, no browser. Node's `crypto`
 * reaches this module through `pendingUpgrade`, so it is main/runner-side, not renderer-safe.
 */
import type { AiJobOutcome, AiJobPriority, AiJobRequest } from "./AiService";
import type { AiPromptSpec } from "./AiPromptBuilder";
import {
  LOCATOR_PLAN_MAX_ATTEMPTS,
  LOCATOR_PLAN_SCHEMA,
  evaluateLocatorPlan,
  type LocatorPlanPolicy,
  type LocatorPlanRejectionCode
} from "./locatorPlan";
import { createPendingUpgrade, locatorCandidateDigest, type PendingUpgradeRefusal } from "./pendingUpgrade";
import type { FlowStep, PendingLocatorUpgrade } from "../profiles/FlowProfile";
import { classifyLocatorQuality, type LocatorQualityClass } from "../recorder/LocatorQualityClass";
import { UPGRADE_CONTEXT_TTL_MS, type UpgradeContext } from "../recorder/upgradeContext";
import { decideAiAction } from "../security/authz/AiAutonomyPolicy";
import type { LocatorProofResult } from "../runner/locatorProof";

/** Bounds a single job. `maxAttempts` mirrors L3 §7; the rest keep one job's cost predictable. */
export const LOCATOR_ATTEMPT_LIMITS = Object.freeze({
  maxAttempts: LOCATOR_PLAN_MAX_ATTEMPTS,
  /** Per provider call. A job is interactive work behind a weak locator, not a batch. */
  timeoutMs: 30_000,
  /** The plan grammar is small; a longer answer is a malformed one. */
  maxOutputTokens: 512,
  /** Delimited context handed to the model, before `AiPromptBuilder`'s own global cap. */
  maxDataChars: 3_000
});

/** L3 §1: only a weak finalized locator is queued on its own. Stronger classes are left alone. */
const WEAK_CLASSES: ReadonlySet<LocatorQualityClass> = new Set(["guarded-positional", "review-required"]);

export type LocatorAttemptStage = "provider" | "compiler" | "intent" | "duplicate" | "proof";

export type LocatorAttemptOutcome =
  | "accepted"
  | "not-eligible"
  /** A T3 refusal reached at proof time (a protected-login surface). Terminal: the job never asks again. */
  | "forbidden"
  | "provider-unavailable"
  | "attempts-exhausted"
  | "cancelled"
  | "superseded"
  | "context-expired"
  | "write-failed";

/** One attempt's terminal fact. Codes and field PATHS only — never a value from the page or the model. */
export interface LocatorAttemptRecord {
  /** 1-based synthesis attempt. */
  attempt: number;
  /** Whether it spent budget. Only a real rejection does. */
  consumed: boolean;
  stage: LocatorAttemptStage;
  code: string;
  /** Compiler/intent path of the refused field, e.g. `scopes.0.hasText`. */
  field?: string;
}

export interface LocatorAttemptResult {
  outcome: LocatorAttemptOutcome;
  /** The terminal code: a provider code, a plan rejection code, a proof code, or `OK`. */
  code: string;
  /** Attempts spent. Never above `maxAttempts`. */
  attemptsUsed: number;
  /** Provider calls made. Exceeds `attemptsUsed` by one when a call failed without synthesizing. */
  calls: number;
  attempts: LocatorAttemptRecord[];
  /** Present only on `accepted`. */
  pending?: PendingLocatorUpgrade;
}

/** The structural subset of `AiService` a job needs, so the real service satisfies it unchanged. */
export interface LocatorUpgradeProvider {
  submit(request: AiJobRequest): Promise<AiJobOutcome>;
  cancel(requestId: string): boolean;
}

export interface LocatorUpgradeAttemptDeps {
  ai: LocatorUpgradeProvider;
  /** L3 §4 browser proof of one raw plan. The trusted compiler and intent guard run inside it again. */
  prove(plan: unknown, attempt: number): Promise<LocatorProofResult>;
  /** The L3 §5 compare-and-swap through the flow store's lane. */
  annotate(pending: PendingLocatorUpgrade): Promise<{ code: "OK" | "FLOW_NOT_FOUND" | "WRITE_FAILED" | PendingUpgradeRefusal }>;
}

export interface LocatorUpgradeAttemptInput {
  /** Correlation and cancel key. Each attempt submits `${requestId}.a${attempt}`. */
  requestId: string;
  step: FlowStep;
  /** Texts the candidate must never be scoped by (L2 markers, the run's row, the step's own value). */
  boundValues: readonly string[];
  /** L2 capture-time context. Memory-only and TTL-bounded; an expired one ends the job. */
  upgradeContext?: UpgradeContext;
  policy?: LocatorPlanPolicy;
  priority?: AiJobPriority;
  /** The user asked from Element Spy (L3 §1), so the weak-locator gate does not apply. */
  userRequested?: boolean;
  signal?: AbortSignal;
  maxAttempts?: number;
  now?: () => Date;
}

// ── Eligibility (L3 §1) ─────────────────────────────────────────────────────────────────────────

export type LocatorUpgradeEligibility = { eligible: true; quality: LocatorQualityClass | "unknown" } | { eligible: false; code: string };

/**
 * Whether a job may be queued for this step at all. T3 first and unconditionally, then the trigger
 * rule. The current locator stays authoritative either way; this only decides whether to ask.
 */
export function isLocatorUpgradeEligible(step: FlowStep, options: { userRequested?: boolean } = {}): LocatorUpgradeEligibility {
  const policy = decideAiAction("locatorSemanticUpgrade", "locatorChange", { step }, { enabled: true });
  if (policy.decision === "forbidden") return { eligible: false, code: policy.reason };
  if (!step.locator) return { eligible: false, code: "NO_BASELINE" };
  const quality = classifyLocatorQuality(step.locator)?.class;
  if (!quality) return { eligible: false, code: "NO_QUALITY_CLASS" };
  // An explicit user request is its own trigger; otherwise only a weak locator is worth a model call.
  if (!options.userRequested && !WEAK_CLASSES.has(quality)) return { eligible: false, code: "LOCATOR_NOT_WEAK" };
  return { eligible: true, quality };
}

/** False once the L2 context is past its TTL. An expired context is never rebuilt from run data. */
export function upgradeContextUsable(context: UpgradeContext | undefined, now: Date): boolean {
  if (!context) return true;
  const age = now.getTime() - Date.parse(context.capturedAt);
  return Number.isFinite(age) && age <= UPGRADE_CONTEXT_TTL_MS;
}

// ── Prompt (L3 §7) ──────────────────────────────────────────────────────────────────────────────

const INSTRUCTIONS =
  "You propose one replacement locator for a web element whose current locator is fragile. " +
  "Return a single JSON locator plan matching the schema: a target strategy and value, and at most " +
  "three semantic scopes. Prefer role with an accessible name, label, placeholder or a test id. " +
  "Never return code, a CSS path, a positional index, a frame reference, or text that is a data " +
  "value the flow fills in. Scope by stable page structure, never by row content. " +
  "If a previous attempt was refused, the refusal names the field and the rule it broke: fix that field.";

/** Short, product-authored correction per refusal code. Deterministic: same code, same sentence. */
const FEEDBACK: Readonly<Partial<Record<LocatorPlanRejectionCode | string, string>>> = Object.freeze({
  MALFORMED: "the answer was not a single JSON plan matching the schema",
  MALFORMED_OUTPUT: "the answer was not a single JSON plan matching the schema",
  SCHEMA_REJECTED: "the answer had fields the schema does not allow",
  INVENTED_FRAME: "a plan may not name a frame, iframe or shadow root; scope comes from the capture",
  UNSUPPORTED: "that strategy or value form is not supported",
  SCRIPT: "the value looked like code or a selector engine prefix",
  POSITIONAL: "the value selected by position",
  UNSTABLE_ID: "that id looks generated and will not survive a re-render",
  XPATH_NOT_ALLOWED: "XPath is not permitted for this step",
  INTENT_BOUND_VALUE: "that text is a data value the flow fills in, so it would re-target on the next row",
  NOT_BUILDABLE: "the locator could not be built on the page",
  CANDIDATE_NO_MATCH: "it matched no element",
  CANDIDATE_NOT_UNIQUE: "it matched more than one element",
  WRONG_ELEMENT: "it matched a different element than the step acts on",
  FRAME_CONTEXT_MISMATCH: "it left the element's frame or shadow scope",
  DUPLICATE_CANDIDATE: "that is the same plan as a previous attempt, which was already refused"
});

const line = (label: string, value: string): string => (value ? `${label}: ${value}\n` : "");

/**
 * The delimited, redacted data one attempt may see. Any context field the L2 marker pass flagged as
 * carrying a bound data value is DROPPED here rather than relied on being caught downstream, so the
 * model is never shown a row's contents in the first place.
 */
function contextFields(context: UpgradeContext | undefined): AiPromptSpec["fields"] {
  if (!context) return [];
  const bound = new Set(context.boundValues.map((marker) => marker.field));
  const target = line("tag", context.target.tag) + line("role", context.target.role) + line("type", context.target.type) +
    (bound.has("target.name") ? "" : line("name", context.target.name));
  const candidates = context.candidates
    .map((candidate, index) => (bound.has(`candidates.${index}`) ? "" : `${candidate.strategy}=${candidate.value}${candidate.name ? ` name=${candidate.name}` : ""} matches=${candidate.count}${candidate.fallback ? " (fallback)" : ""}`))
    .filter(Boolean)
    .join("\n");
  const containers = context.containers
    .map((container, index) => (bound.has(`containers.${index}.name`) ? `${container.kind} ${container.role}` : `${container.kind} ${container.role} ${container.name}`.trim()))
    .join("\n");
  const siblings = context.siblingActions.filter((_, index) => !bound.has(`siblingActions.${index}`)).join("\n");
  return [
    { name: "TargetElement", text: target },
    { name: "UniqueCandidates", text: candidates },
    { name: "Containers", text: containers },
    ...(bound.has("heading") ? [] : [{ name: "PageHeading" as const, text: context.heading }]),
    { name: "SiblingActions", text: siblings },
    // Field PATHS, so the model is told which slots are data-bound without being shown the data.
    { name: "DataBoundFields", ids: [...bound].slice(0, 32) }
  ];
}

/** Structured deterministic feedback for the next attempt: codes and field paths, nothing else. */
export function buildAttemptFeedback(records: readonly LocatorAttemptRecord[]): string {
  return records
    .map((record) => {
      const why = FEEDBACK[record.code] ?? "it was refused";
      return `attempt ${record.attempt}: refused at ${record.stage} (${record.code})${record.field ? ` on ${record.field}` : ""} — ${why}.`;
    })
    .join("\n");
}

function buildPrompt(input: LocatorUpgradeAttemptInput, records: readonly LocatorAttemptRecord[]): AiPromptSpec {
  const baseline = input.step.locator;
  const quality = classifyLocatorQuality(baseline)?.class;
  return {
    instructions: INSTRUCTIONS,
    maxDataChars: LOCATOR_ATTEMPT_LIMITS.maxDataChars,
    fields: [
      // Strategy and quality only: the baseline's VALUE is the fragile string we are replacing and
      // the model has no use for it, so it is never sent.
      { name: "CurrentLocator", ids: [baseline?.strategy ?? "unknown", quality ?? "unknown"] },
      ...contextFields(input.upgradeContext),
      ...(records.length ? [{ name: "PreviousRefusals", text: buildAttemptFeedback(records) }] : [])
    ]
  };
}

// ── The job ─────────────────────────────────────────────────────────────────────────────────────

/** Provider failures that produced no candidate: terminal, and they spend no attempt. */
const SYNTHESIS_FAILURES: ReadonlySet<string> = new Set(["MALFORMED_OUTPUT", "SCHEMA_REJECTED"]);

/**
 * Run one bounded upgrade job. Never throws: every path ends in a {@link LocatorAttemptResult}, so a
 * caller on the Recorder's or the runner's path can ignore it entirely.
 */
export async function runLocatorUpgradeAttempts(
  input: LocatorUpgradeAttemptInput,
  deps: LocatorUpgradeAttemptDeps
): Promise<LocatorAttemptResult> {
  const now = input.now ?? (() => new Date());
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? LOCATOR_ATTEMPT_LIMITS.maxAttempts, LOCATOR_ATTEMPT_LIMITS.maxAttempts));
  const records: LocatorAttemptRecord[] = [];
  const seen = new Set<string>();
  let calls = 0;
  const done = (outcome: LocatorAttemptOutcome, code: string, pending?: PendingLocatorUpgrade): LocatorAttemptResult => ({
    outcome,
    code,
    attemptsUsed: records.filter((record) => record.consumed).length,
    calls,
    attempts: records,
    ...(pending ? { pending } : {})
  });
  const cancelled = (): boolean => input.signal?.aborted === true;

  const eligibility = isLocatorUpgradeEligible(input.step, { userRequested: input.userRequested });
  if (!eligibility.eligible) return done("not-eligible", eligibility.code);
  // Checked before the first call, and again before the write: an expired capture context must end the
  // job, never be reconstructed from whatever the page or the run happens to hold now.
  if (!upgradeContextUsable(input.upgradeContext, now())) return done("context-expired", "CONTEXT_EXPIRED");
  if (cancelled()) return done("cancelled", "CANCELLED");

  const baseline = input.step.locator!;

  for (let attempt = 1; ; attempt += 1) {
    // `#` is reserved: `AiService` appends it to build the HOST job id, and its own request-id
    // pattern refuses it, so an attempt suffixed that way is rejected as an invalid request.
    const requestId = `${input.requestId}.a${attempt}`;
    // A cancelled request must stop the host too, not merely discard its answer.
    const abort = () => deps.ai.cancel(requestId);
    input.signal?.addEventListener("abort", abort, { once: true });
    let outcome: AiJobOutcome;
    calls += 1;
    try {
      outcome = await deps.ai.submit({
        requestId,
        feature: "locatorSemanticUpgrade",
        priority: input.priority ?? "background",
        prompt: buildPrompt(input, records),
        schema: LOCATOR_PLAN_SCHEMA,
        maxOutputTokens: LOCATOR_ATTEMPT_LIMITS.maxOutputTokens,
        timeoutMs: LOCATOR_ATTEMPT_LIMITS.timeoutMs
      });
    } catch {
      return done("provider-unavailable", "PROVIDER_ERROR");
    } finally {
      input.signal?.removeEventListener("abort", abort);
    }
    // No cancellation re-check here on purpose: an abort that lands while `AiService` owns the job
    // comes back as `status: "cancelled"` below, and one that lands after it resolves is caught by the
    // re-check after the proof, which is always awaited before anything is written. A check here was
    // redundant — mutation testing removed it with every assertion still green.

    const spend = (stage: LocatorAttemptStage, code: string, field?: string): LocatorAttemptResult | undefined => {
      records.push({ attempt, consumed: true, stage, code, ...(field ? { field } : {}) });
      return records.filter((record) => record.consumed).length >= maxAttempts ? done("attempts-exhausted", code) : undefined;
    };

    if (outcome.status === "cancelled") return done("cancelled", "CANCELLED");
    if (outcome.status === "rejected") return done("provider-unavailable", outcome.code);
    if (outcome.status === "failed") {
      // Only a malformed or schema-refused ANSWER is a synthesis attempt. A timeout, a host error or a
      // yield limit produced nothing to judge, so retrying is not synthesis: end the job.
      if (!SYNTHESIS_FAILURES.has(outcome.code)) return done("provider-unavailable", outcome.code);
      const exhausted = spend("provider", outcome.code);
      if (exhausted) return exhausted;
      continue;
    }

    // Compile + intent guard, exactly as the proof path will run them again. Doing it here keeps a
    // structurally refused plan off the page entirely and gives the digest for duplicate detection.
    const evaluated = evaluateLocatorPlan(outcome.value, {
      boundValues: input.boundValues,
      baseline,
      captured: baseline.context,
      policy: input.policy
    });
    if (!evaluated.ok) {
      const exhausted = spend(evaluated.code === "INTENT_BOUND_VALUE" ? "intent" : "compiler", evaluated.code, evaluated.field);
      if (exhausted) return exhausted;
      continue;
    }

    // A repeated plan cannot buy a second opinion: it is the same refusal, so it spends the attempt
    // and never reaches the browser again.
    const digest = locatorCandidateDigest(evaluated.candidate, evaluated.context);
    if (seen.has(digest)) {
      const exhausted = spend("duplicate", "DUPLICATE_CANDIDATE");
      if (exhausted) return exhausted;
      continue;
    }
    seen.add(digest);

    const proof = await deps.prove(outcome.value, attempt);
    if (cancelled()) return done("cancelled", "CANCELLED");
    if (proof.outcome === "rejected") {
      const exhausted = spend("proof", proof.code, proof.field);
      // Safety spends the attempt (L3 §7) but ends the job: the page is a protected-login surface, and
      // "ask again with feedback" is exactly the retry §1 forbids. Same for a context that expired
      // mid-flight — the answer to that is never another proposal.
      if (proof.code.startsWith("T3_")) return done("forbidden", proof.code);
      if (proof.code === "CONTEXT_EXPIRED") return done("context-expired", proof.code);
      if (exhausted) return exhausted;
      continue;
    }

    // `proven` or `unprovable-now`: both are storable (L3 §5). Neither promotes anything.
    if (!upgradeContextUsable(input.upgradeContext, now())) return done("context-expired", "CONTEXT_EXPIRED");
    const pending = createPendingUpgrade({
      step: input.step,
      compiled: evaluated,
      meaningChange: evaluated.meaningChange,
      proof: proof.outcome === "proven" ? "capture-proven" : "unprovable-now",
      modelId: outcome.modelId,
      now: now()
    });
    if (!pending) return done("superseded", "NO_BINDING");
    const write = await deps.annotate(pending);
    if (write.code === "OK") return done("accepted", proof.code, pending);
    // The step moved on, or a newer proposal is already there: this answer is stale, not retryable.
    if (write.code === "STALE" || write.code === "SUPERSEDED" || write.code === "STEP_NOT_FOUND") return done("superseded", write.code);
    return done("write-failed", write.code);
  }
}
