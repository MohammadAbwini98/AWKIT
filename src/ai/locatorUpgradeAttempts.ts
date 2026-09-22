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
import type { AiOutputSchema } from "./AiOutputContract";
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
import { decideAiAction, type AiFeatureId } from "../security/authz/AiAutonomyPolicy";
import type { LocatorProofResult } from "../runner/locatorProof";

/** Bounds a single job. `maxAttempts` mirrors L3 §7; the rest keep one job's cost predictable. */
export const LOCATOR_ATTEMPT_LIMITS = Object.freeze({
  maxAttempts: LOCATOR_PLAN_MAX_ATTEMPTS,
  /**
   * Per provider call, so a job may take `maxAttempts` of these. This feature's L1.8 ceiling, 180 s at
   * the output cap (`backgroundJobAtCapMs` in `benchmark:ai-model`), plus the same 5 s over measured
   * overhead as `AUTHORING_LIMITS.timeoutMs`. The shared 30 s ended every real attempt on Qwen3.5-0.8B
   * (`verify:ai-locator-upgrade-live`).
   */
  timeoutMs: 185_000,
  /**
   * At 512 the cap alone projected past the 180 s L1.8 ceiling. 256 is the lowest cap every valid plan
   * fits: any candidate the capture offers, whole, scoped by any container it offers. One cut at the cap
   * is invalid JSON and is refused whole (`verify:ai-locator-upgrade-budget`).
   */
  maxOutputTokens: 256,
  /**
   * The answer's own bounds, each at or inside `LOCATOR_PLAN_SCHEMA`'s (see {@link LOCATOR_ATTEMPT_SCHEMA}),
   * taken from what `sanitizeUpgradeContext` lets a capture show, so a plan copying it is never cut:
   * the target's value as long as a candidate's, every other text as long as a name or container text.
   * One scope: two do not fit the cap with their texts.
   */
  maxScopes: 1,
  maxValueChars: 200,
  maxTextChars: 80,
  /** Context lines go whole, most useful first, while they fit: a line never reaches the model cut. */
  maxContextChars: 2_800,
  /** Delimited context handed to the model, before `AiPromptBuilder`'s own global cap. */
  maxDataChars: 3_000
});

/**
 * The grammar one attempt decodes against: `LOCATOR_PLAN_SCHEMA` with the same keys and enums and
 * tighter bounds, so every answer it admits is a plan the trusted compiler still judges in full.
 * node-llama-cpp writes every key in schema order whatever `required` says, so these bounds, not the
 * model, set how long an answer can get.
 */
function narrowed(schema: AiOutputSchema, key = "", scoped = false): AiOutputSchema {
  const limits = LOCATOR_ATTEMPT_LIMITS;
  switch (schema.type) {
    case "object":
      return { ...schema, properties: Object.fromEntries(Object.entries(schema.properties).map(([name, child]) => [name, narrowed(child, name, scoped)])) };
    case "array":
      return { ...schema, items: narrowed(schema.items, "", true), maxItems: Math.min(schema.maxItems, limits.maxScopes) };
    case "string":
      return "maxLength" in schema ? { ...schema, maxLength: Math.min(schema.maxLength, key === "value" && !scoped ? limits.maxValueChars : limits.maxTextChars) } : schema;
    default:
      return schema;
  }
}
export const LOCATOR_ATTEMPT_SCHEMA: AiOutputSchema = narrowed(LOCATOR_PLAN_SCHEMA);

/** L3 §1: only a weak finalized locator is queued on its own. Stronger classes are left alone. */
const WEAK_CLASSES: ReadonlySet<LocatorQualityClass> = new Set(["guarded-positional", "review-required"]);

/**
 * Which L3 job this is. The loop, the budget, the duplicate guard, the feedback and the write are
 * identical; these four facts are the whole difference, so `repair` is a parameter rather than a
 * second copy of a bounded loop whose boundedness had to be re-proven.
 *
 * - `upgrade` (§7): a still-working but fragile locator. Proof compares against the live baseline,
 *   and `unprovable-now` is stored for replay to settle later.
 * - `repair` (§8): a locator observed FAILING. Proof compares against a saved identity, ceiling is
 *   T1, and only a proven candidate is stored — replay cannot settle a baseline that never resolves.
 */
export type LocatorJobMode = "upgrade" | "repair";

const MODES = Object.freeze({
  upgrade: {
    feature: "locatorSemanticUpgrade",
    instructions:
      "You propose one replacement locator for a web element whose current locator is fragile. " +
      "Return a single JSON locator plan matching the schema: a target strategy and value, and at most " +
      "one semantic scope. Prefer role with an accessible name, label, placeholder or a test id. " +
      "Never return code, a CSS path, a positional index, a frame reference, or text that is a data " +
      "value the flow fills in. Scope by stable page structure, never by row content. " +
      "If a previous attempt was refused, the refusal names the field and the rule it broke: fix that field."
  },
  repair: {
    feature: "locatorRepair",
    instructions:
      "You propose one replacement locator for a web element whose saved locator no longer matches it. " +
      "Return a single JSON locator plan matching the schema: a target strategy and value, and at most " +
      "one semantic scope. Prefer role with an accessible name, label, placeholder or a test id. " +
      "Never return code, a CSS path, a positional index, a frame reference, or text that is a data " +
      "value the flow fills in. Scope by stable page structure, never by row content. " +
      "The replacement must be the SAME element the step always acted on, not a similar one nearby. " +
      "If a previous attempt was refused, the refusal names the field and the rule it broke: fix that field."
  }
} as const satisfies Record<LocatorJobMode, { feature: AiFeatureId; instructions: string }>);

export type LocatorAttemptStage = "provider" | "compiler" | "intent" | "duplicate" | "proof";

export type LocatorAttemptOutcome =
  | "accepted"
  | "not-eligible"
  /** A T3 refusal reached at proof time (a protected-login surface). Terminal: the job never asks again. */
  | "forbidden"
  | "provider-unavailable"
  | "attempts-exhausted"
  /**
   * The candidate was not refused, but nothing could be stored. §8 only: a repair whose proof came
   * back `unprovable-now` (page gone, identity unreadable) has no replay route to resolve it later,
   * so the job ends rather than leaving a proposal that can never be settled.
   */
  | "unprovable"
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
  /** §7 semantic upgrade (default) or §8 runtime repair. See {@link LocatorJobMode}. */
  mode?: LocatorJobMode;
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

/**
 * L3 §8 eligibility. Deliberately NOT the §1 weakness gate: a strong semantic locator breaks too,
 * and that is precisely the case repair exists for.
 *
 * What it does check is T3 first and unconditionally, and that the baseline is an authoritative
 * locator — a `needs-review` or `invalid` locator is not something to repair into place, it is
 * something the user has not accepted yet.
 *
 * What it deliberately does NOT check is whether the locator is actually failing. A caller asserting
 * that would be a caller the job has to trust; instead `proveRepairCandidate` re-observes it on the
 * page (gate E, `BASELINE_HEALTHY`), where it cannot be claimed, only measured.
 */
export function isLocatorRepairEligible(step: FlowStep): LocatorUpgradeEligibility {
  const policy = decideAiAction("locatorRepair", "locatorChange", { step }, { enabled: true });
  if (policy.decision === "forbidden") return { eligible: false, code: policy.reason };
  const locator = step.locator;
  if (!locator) return { eligible: false, code: "NO_BASELINE" };
  if (locator.resolution !== undefined && locator.resolution !== "resolved") return { eligible: false, code: "BASELINE_NOT_PROMOTABLE" };
  return { eligible: true, quality: classifyLocatorQuality(locator)?.class ?? "unknown" };
}

/** False once the L2 context is past its TTL. An expired context is never rebuilt from run data. */
export function upgradeContextUsable(context: UpgradeContext | undefined, now: Date): boolean {
  if (!context) return true;
  const age = now.getTime() - Date.parse(context.capturedAt);
  return Number.isFinite(age) && age <= UPGRADE_CONTEXT_TTL_MS;
}

// ── Prompt (L3 §7) ──────────────────────────────────────────────────────────────────────────────

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
  DUPLICATE_CANDIDATE: "that is the same plan as a previous attempt, which was already refused",
  // L3 §8 repair codes.
  BASELINE_HEALTHY: "the saved locator resolves fine, so there is nothing to repair",
  NO_IDENTITY_ANCHOR: "no saved identity exists for this step, so nothing can be proven against it",
  TARGET_UNFINGERPRINTABLE: "the matched element's identity could not be read"
});

/**
 * The context one attempt may see, as lines in the order they are worth keeping: what is being
 * replaced, the target, a previous refusal, then the neighbourhood.
 *
 * - Any context field the L2 marker pass flagged as carrying a bound data value is DROPPED here rather
 *   than relied on being caught downstream, so the model is never shown a row's contents.
 * - The baseline's VALUE is never sent, and neither are the Recorder's fallback candidates (structural
 *   or positional CSS/XPath): both are the fragile form being replaced, which the compiler refuses.
 * - It is one DATA block. Each block costs about 45 prompt tokens of nonce delimiters, and the seven it
 *   used to be were most of a typical prompt.
 */
function contextLines(input: LocatorUpgradeAttemptInput, records: readonly LocatorAttemptRecord[]): string[] {
  const baseline = input.step.locator;
  const context = input.upgradeContext;
  const bound = new Set(context?.boundValues.map((marker) => marker.field));
  const pairs = (entries: Array<[string, string]>) => entries.filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join(" ");
  const target = context ? pairs([["tag", context.target.tag], ["role", context.target.role], ["type", context.target.type], ["name", bound.has("target.name") ? "" : context.target.name]]) : "";
  return [
    `current locator: ${baseline?.strategy ?? "unknown"}, ${classifyLocatorQuality(baseline)?.class ?? "unknown"}`,
    target ? `target: ${target}` : "",
    ...(records.length ? buildAttemptFeedback(records).split("\n").map((refusal) => `refused ${refusal}`) : []),
    ...(context?.candidates ?? []).map((candidate, index) =>
      candidate.fallback || bound.has(`candidates.${index}`) ? "" : `candidate: ${candidate.strategy}=${candidate.value}${candidate.name ? ` name=${candidate.name}` : ""} matches=${candidate.count}`
    ),
    ...(context?.containers ?? []).map((container, index) => `container: ${container.kind} ${container.role}${bound.has(`containers.${index}.name`) ? "" : ` ${container.name}`}`.trim()),
    context && !bound.has("heading") && context.heading ? `heading: ${context.heading}` : "",
    ...(context?.siblingActions ?? []).map((action, index) => (bound.has(`siblingActions.${index}`) ? "" : `sibling action: ${action}`)),
    // Field PATHS, so the model is told which slots are data-bound without being shown the data.
    bound.size ? `data-bound, not shown: ${[...bound].slice(0, 32).join(", ")}` : ""
  ].filter(Boolean);
}

/** Whole lines, in order, while they fit. One that does not fit is skipped, never cut. */
function fitLines(lines: readonly string[], budget: number): string {
  const kept: string[] = [];
  let left = budget;
  for (const text of lines) {
    if (text.length + 1 > left) continue;
    kept.push(text);
    left -= text.length + 1;
  }
  return kept.join("\n");
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

/**
 * The job one attempt submits, `records` being the refusals so far. Exported so the L1.8 benchmark and
 * the live gate measure exactly this request, never a stand-in for it.
 */
export function locatorAttemptJob(input: LocatorUpgradeAttemptInput, records: readonly LocatorAttemptRecord[], requestId: string): AiJobRequest {
  const mode = input.mode ?? "upgrade";
  const prompt: AiPromptSpec = {
    instructions: MODES[mode].instructions,
    maxDataChars: LOCATOR_ATTEMPT_LIMITS.maxDataChars,
    fields: [{ name: "Element", text: fitLines(contextLines(input, records), LOCATOR_ATTEMPT_LIMITS.maxContextChars), maxChars: LOCATOR_ATTEMPT_LIMITS.maxContextChars }]
  };
  return {
    requestId,
    feature: MODES[mode].feature,
    priority: input.priority ?? "background",
    prompt,
    schema: LOCATOR_ATTEMPT_SCHEMA,
    maxOutputTokens: LOCATOR_ATTEMPT_LIMITS.maxOutputTokens,
    timeoutMs: LOCATOR_ATTEMPT_LIMITS.timeoutMs
  };
}

// ── The job ─────────────────────────────────────────────────────────────────────────────────────

/** Provider failures that produced no candidate: terminal, and they spend no attempt. */
const SYNTHESIS_FAILURES: ReadonlySet<string> = new Set(["MALFORMED_OUTPUT", "SCHEMA_REJECTED"]);

/**
 * Run one bounded upgrade (§7) or repair (§8) job. Never throws: every path ends in a
 * {@link LocatorAttemptResult}, so a caller on the Recorder's or the runner's path can ignore it
 * entirely.
 */
export async function runLocatorUpgradeAttempts(
  input: LocatorUpgradeAttemptInput,
  deps: LocatorUpgradeAttemptDeps
): Promise<LocatorAttemptResult> {
  const mode = input.mode ?? "upgrade";
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

  const eligibility =
    mode === "repair" ? isLocatorRepairEligible(input.step) : isLocatorUpgradeEligible(input.step, { userRequested: input.userRequested });
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
      outcome = await deps.ai.submit(locatorAttemptJob(input, records, requestId));
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
      // §8: neither of these is about the candidate, so a better candidate cannot answer them. A
      // healthy baseline means there is nothing to repair, and a missing anchor means there is
      // nothing to prove against. Both end the job.
      if (proof.code === "BASELINE_HEALTHY" || proof.code === "NO_IDENTITY_ANCHOR") return done("not-eligible", proof.code);
      if (exhausted) return exhausted;
      continue;
    }

    // What is storable differs by mode, and `pendingEligible` is the proof's own answer.
    //
    // §7: `proven` or `unprovable-now` are both stored — replay settles the second later (L3 §5).
    // §8: only `proven` is stored. Replay proves a candidate against the baseline's element, and a
    // repair's baseline does not resolve, so an unproven repair has no route to ever becoming proven;
    // storing it would leave a proposal the product can never either confirm or retire.
    if (!proof.pendingEligible) return done("unprovable", proof.code);
    if (!upgradeContextUsable(input.upgradeContext, now())) return done("context-expired", "CONTEXT_EXPIRED");
    const pending = createPendingUpgrade({
      step: input.step,
      compiled: evaluated,
      meaningChange: evaluated.meaningChange,
      proof: mode === "repair" ? "repair-proven" : proof.outcome === "proven" ? "capture-proven" : "unprovable-now",
      // L3 §10 evidence-on-demand: gate verdicts, counts and the code, nothing the proof saw.
      proofEvidence: {
        code: proof.code,
        ...(proof.candidateMatchCount !== undefined ? { candidateMatchCount: proof.candidateMatchCount } : {}),
        ...(proof.baselineMatchCount !== undefined ? { baselineMatchCount: proof.baselineMatchCount } : {}),
        sameElement: proof.gates.sameElement,
        scope: proof.scope,
        ...(proof.identityAnchor !== undefined ? { identityAnchor: proof.identityAnchor } : {}),
        ...(proof.identityScore !== undefined ? { identityScore: proof.identityScore } : {})
      },
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
