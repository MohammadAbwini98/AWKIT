/**
 * Failure intelligence (Phase L, L5b): coalescing, and the bounded post-run analysis contract.
 *
 * L5a already answers "what happened" deterministically — `deriveFailureCause` produces a
 * `FailureCauseBaseline` for every terminal failure, with no model, always. L5b adds one optional
 * T0 interpretation on top, and its hard problem is not the prompt: it is that a 500-row data-driven
 * run that fails the same way 500 times must cost **one** analysis, not 500.
 *
 * So this module is two things:
 *
 *  1. **Coalescing.** A signature over the facts that make two failures the *same* failure — the
 *     baseline's cause code, the primary evidence source, the status or error kind, the path template
 *     (already id-stripped by L5a) and the flow/node/step — and deliberately NOT the instance, the
 *     data row, the timing or the repeat count, which is what makes 500 identical failures collapse.
 *     One member is analysed; the rest reference it with a count.
 *  2. **The request/answer contract.** Evidence ids are a closed `enum` in the decoding grammar, built
 *     from the representative's own bounded evidence, and re-checked after decoding. "Insufficient
 *     evidence" is a first-class answer, because a model that must always name a cause will invent one.
 *     It is an EMPTY conclusion list, not a flag beside one: the runtime's grammar writes every schema
 *     property, so a flag let the model decline and conclude in the same answer — and every real v1
 *     answer on Qwen3.5-0.8B did exactly that, and was refused. Where declining is allowed at all is
 *     decided from the evidence, never by the model: see {@link buildFailureAnalysisRequest}.
 *
 * What L5b may never do, and cannot express here: change a run's status, retry anything, alter policy
 * or touch a workflow. The answer carries an interpretation and evidence ids. There is no field for a
 * verdict, an action or a retry, so there is nothing for a caller to mistakenly honour.
 *
 * Pure: no Electron, no filesystem, no clock, no Playwright, no model.
 */

import type { AiPromptSpec } from "./AiPromptBuilder";
import type { AiOutputSchema } from "./AiOutputContract";
import type { ConcurrentRunReport, FailureAnalysisBody, StoredFailureAnalysis } from "../reports/ExecutionReport";
import type { ExecutionEvidenceEvent } from "../runner/evidence/ExecutionEvidence";
import { DIRECT_FAILURE_CAUSES, type FailureCauseBaseline } from "../runner/evidence/FailureCauseBaseline";
import { decideAiAction, type AiPolicyConfig, type AiPolicyDecision } from "../security/authz/AiAutonomyPolicy";
import { findResidualSecrets } from "../semantic/SemanticPolicyValidator";
import type { SemanticRedactor } from "../semantic/SemanticRedactor";

export const FAILURE_ANALYSIS_VERSION = 1;

/**
 * Per-batch bounds. A batch is one execution's terminal failures, analysed after the run.
 *
 * `maxAnalyses` is the number of model calls a whole run may cost. Everything past it keeps its
 * deterministic baseline and is reported as analysed-no, which is a truthful outcome rather than a
 * silent omission.
 */
export interface FailureAnalysisLimits {
  maxSignatures: number;
  maxAnalyses: number;
  maxEvidencePerAnalysis: number;
  maxEvidenceChars: number;
  maxCitedIds: number;
  maxCategoryChars: number;
  maxExplanationChars: number;
  maxStepChars: number;
  maxSteps: number;
  timeoutMs: number;
  maxOutputTokens: number;
  maxDataChars: number;
}

export const FAILURE_ANALYSIS_LIMITS: Readonly<FailureAnalysisLimits> = Object.freeze({
  /** Distinct signatures tracked in one batch. Beyond this, further signatures keep baseline only. */
  maxSignatures: 20,
  /** Model calls one batch may cost, however many signatures it found. */
  maxAnalyses: 5,
  /** Evidence events offered to one analysis, highest severity and closest to the failure first. */
  maxEvidencePerAnalysis: 12,
  /**
   * Characters of evidence lines shown, whole lines only. The prompt builder's 1,200-character default
   * field cap used to cut the list instead, while the grammar still offered every id: the largest live
   * fixture's twelfth line reached the model as `ev8: http.error (err`, its status gone. Twelve lines of
   * about 125 characters fit.
   */
  maxEvidenceChars: 1_500,
  /**
   * Ids per citation list, primary and secondary each. An id costs about 6.5 output tokens in indented
   * JSON, and the largest real answer cited all 11 cause candidates as primary, singling out none.
   */
  maxCitedIds: 2,
  maxCategoryChars: 40,
  maxExplanationChars: 260,
  maxStepChars: 150,
  maxSteps: 2,
  /**
   * This feature's own deadline: its L1.8 ceiling, 180 s at the output cap (`backgroundJobAtCapMs` in
   * `benchmark:ai-model`), plus the same 5 s over measured overhead as `AUTHORING_LIMITS.timeoutMs`. The
   * shared 30 s cancelled every real analysis on Qwen3.5-0.8B (`verify:ai-failure-analysis-live`).
   */
  timeoutMs: 185_000,
  /**
   * This feature's L1.8 output budget. At 512, the cap alone projected to 110–200 s of generation at the
   * decode rates Qwen3.5-0.8B has shown on the qualifying host, before any prompt evaluation. The longest
   * answer the parser can accept — every list and text above at its limit — must still fit, because an
   * answer cut at the cap is invalid JSON and is discarded whole. `verify:ai-failure-analysis-budget`
   * counts it on the model's own tokenizer.
   */
  maxOutputTokens: 256,
  maxDataChars: 3_000
});

/** One terminal failure, as the batch receives it. */
export interface FailureBatchEntry {
  instanceId: string;
  flowId?: string;
  nodeId?: string;
  /** Nth step execution in the instance, as L5a records it. */
  stepIndex?: number;
  baseline: FailureCauseBaseline;
  /** The instance's evidence. Only the baseline's cited events and near neighbours are ever sent. */
  events: readonly ExecutionEvidenceEvent[];
}

export interface CoalescedFailureGroup {
  signature: string;
  /** Every instance that failed this way, in batch order. The first is the representative. */
  instanceIds: string[];
  count: number;
  representative: FailureBatchEntry;
  /**
   * Whether this group gets a model call. `false` means the batch budget was already spent — the
   * group keeps its deterministic baseline, which is the same answer it would have had with AI off.
   */
  analyse: boolean;
  /** Why not, when `analyse` is false. */
  skipped?: "BATCH_BUDGET" | "SIGNATURE_CAP";
}

export interface CoalescedBatch {
  groups: CoalescedFailureGroup[];
  /** Entries whose signature arrived after `maxSignatures` distinct ones. Baseline only. */
  overflow: number;
  /** Failures in, groups out, analyses planned — the coalescing ratio L5b's metrics ask for. */
  stats: { failures: number; signatures: number; analyses: number };
}

/**
 * The coalescing signature.
 *
 * Deliberately excludes the instance id, the data row, every offset and every repeat count: those are
 * exactly what differs between the 500 identical failures this exists to collapse. Deliberately
 * includes the path template rather than the URL, because L5a already stripped its identifiers, so
 * `/orders/48213` and `/orders/48214` are one route and one analysis.
 */
export function failureSignature(entry: FailureBatchEntry): string {
  const primaryId = entry.baseline.evidenceIds[0];
  const primary = primaryId === undefined ? undefined : entry.events.find((event) => event.id === primaryId);
  const source = primary?.source ?? "none";
  // The status or the error kind, whichever this source carries — it is what distinguishes a 409 from
  // a 422 on the same route, which the labelled set requires to stay separate analyses.
  const payload = primary?.payload ?? {};
  const discriminator =
    payload.status !== undefined
      ? `status=${payload.status}`
      : payload.failure !== undefined
        ? `failure=${payload.failure}`
        : payload.kind !== undefined
          ? `kind=${payload.kind}`
          : payload.name !== undefined
            ? `name=${payload.name}`
            : "class=none";
  const route = typeof payload.url === "string" ? payload.url : "route=none";
  return [entry.baseline.cause, source, discriminator, route, entry.flowId ?? "-", entry.nodeId ?? "-", entry.stepIndex ?? "-"].join("|");
}

/**
 * Group a batch of terminal failures, and decide which groups earn a model call.
 *
 * Order is deterministic and by impact: most instances first, then signature. A budget spent on the
 * failure that hit 400 rows is worth more than one spent on the failure that hit one — and a stable
 * order means the same batch always produces the same plan, which a report has to be able to promise.
 */
export function coalesceFailures(entries: readonly FailureBatchEntry[], limits = FAILURE_ANALYSIS_LIMITS): CoalescedBatch {
  const bySignature = new Map<string, CoalescedFailureGroup>();
  let overflow = 0;

  for (const entry of entries) {
    const signature = failureSignature(entry);
    const existing = bySignature.get(signature);
    if (existing) {
      existing.instanceIds.push(entry.instanceId);
      existing.count += 1;
      continue;
    }
    if (bySignature.size >= limits.maxSignatures) {
      // A batch with more distinct failures than the cap keeps baselines for the rest rather than
      // growing without bound. Counted, so a report can say the list is partial.
      overflow += 1;
      continue;
    }
    bySignature.set(signature, { signature, instanceIds: [entry.instanceId], count: 1, representative: entry, analyse: false });
  }

  const groups = [...bySignature.values()].sort((a, b) => b.count - a.count || a.signature.localeCompare(b.signature));
  let budget = limits.maxAnalyses;
  for (const group of groups) {
    // An `insufficient` baseline has no evidence to reason over, so spending a call on it buys nothing.
    if (group.representative.baseline.cause === "insufficient" || group.representative.baseline.evidenceIds.length === 0) {
      group.skipped = "BATCH_BUDGET";
      continue;
    }
    if (budget <= 0) {
      group.skipped = "BATCH_BUDGET";
      continue;
    }
    group.analyse = true;
    budget -= 1;
  }

  return {
    groups,
    overflow,
    stats: { failures: entries.length, signatures: groups.length, analyses: groups.filter((group) => group.analyse).length }
  };
}

// ── The request ─────────────────────────────────────────────────────────────────────────────────

export interface FailureAnalysisRequest {
  prompt: AiPromptSpec;
  schema: AiOutputSchema;
  group: CoalescedFailureGroup;
  /** The evidence offered, in the order shown. The ONLY ids an answer may cite. */
  evidence: ExecutionEvidenceEvent[];
  /**
   * The baseline rests on direct evidence, so the answer must conclude. The drawer shows that cause right
   * above the AI's answer: "not enough evidence" beside it would be the report contradicting itself.
   */
  mustConclude: boolean;
}

/** A conclusion's fields, in the order the grammar writes them: cite first, then explain. */
const CONCLUSION_FIELDS = ["primaryEvidenceIds", "secondaryEvidenceIds", "category", "explanation", "investigationSteps"] as const;

/**
 * Whether an event can be a conclusion's primary evidence. The runner's own failure record says THAT
 * the step failed, never why: on a bare timeout Qwen3.5-0.8B cited it as its own cause (2026-09-22).
 */
const isCauseEvidence = (event: ExecutionEvidenceEvent): boolean => event.source !== "runner.failure";

// A conclusion's fields in the grammar's order. v1 said "set insufficient to true and say so": the one
// answer its own parser refused. The model never sees the schema, so only this text can ask for brevity:
// a text the grammar cuts off at its `maxLength` ends mid-sentence.
const INSTRUCTIONS =
  "You interpret why an automation run failed, for the person who will investigate it. " +
  "You are given the application's own deterministic conclusion, and the evidence events it rests on, " +
  "each with an id. A runner.failure event only records that the step failed. If no other event shows " +
  "why, leave the conclusion list empty rather than guess. Otherwise write one conclusion: the ids of " +
  "the events that explain the failure, the ids of events that only followed from it, a short category, " +
  "a one- or two-sentence explanation and up to two brief things to check. Use only ids from the list, " +
  "and do not invent evidence. The run has already finished; you cannot change its result, retry it, or " +
  "change any setting.";

/**
 * The events most likely to carry the cause, most important first.
 *
 * The baseline's own citation order leads, and its FIRST id leads absolutely: that is the event the
 * deterministic conclusion rests on, so burying it under a later, louder event would invite the model
 * to contradict a conclusion it was told to respect. Everything else follows by severity, then by
 * closeness to the failure.
 */
function rankEvidence(entry: FailureBatchEntry, limit: number): ExecutionEvidenceEvent[] {
  const citedRank = new Map(entry.baseline.evidenceIds.map((id, index) => [id, index]));
  const weight = (event: ExecutionEvidenceEvent): number =>
    citedRank.has(event.id) ? (citedRank.get(event.id) as number) : 1_000 + (event.severity === "error" ? 0 : event.severity === "warning" ? 1 : 2);
  return [...entry.events].sort((a, b) => weight(a) - weight(b) || b.offsetMs - a.offsetMs).slice(0, limit);
}

/**
 * Build one bounded analysis request for a group that earned a model call.
 *
 * `undefined` when the group was not selected, so a caller cannot accidentally analyse a group the
 * budget declined — the decision lives in {@link coalesceFailures} and is not re-litigated here.
 */
export function buildFailureAnalysisRequest(group: CoalescedFailureGroup, limits = FAILURE_ANALYSIS_LIMITS): FailureAnalysisRequest | undefined {
  if (!group.analyse) return undefined;
  const entry = group.representative;

  // The payload is already redacted, id-stripped and capped by L5a's buffer, so it is rendered as-is
  // rather than re-derived here: a second normalization is a second place for the rules to drift.
  //
  // URL fields are the exception, and not by choice. `AiPromptBuilder` redacts every DATA string, and
  // its first rule replaces any whole URL — including a route template L5a already stripped of its
  // query, userinfo and ids. That is correct defence in depth and must not be weakened, so the route
  // travels through the `ids` channel instead, which is unredacted but still rescanned for residual
  // secrets. Without it the model would be told a request failed and never told which one.
  const isUrlField = (key: string): boolean => /(?:url|Url|URL)$/.test(key);
  const lineOf = (event: ExecutionEvidenceEvent): string => {
    const fields = Object.entries(event.payload)
      .filter(([key]) => !isUrlField(key))
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");
    const repeat = event.repeatCount > 1 ? ` x${event.repeatCount}` : "";
    return `${event.id}: ${event.source} (${event.severity}) at ${event.offsetMs}ms${repeat} ${fields}`;
  };

  // Whole lines, most important first, while they fit `maxEvidenceChars`, so every id the grammar offers
  // is one whose line the model was shown. The lead event, the one the baseline rests on, always goes,
  // cut to the budget only if it alone would not fit.
  const evidence: ExecutionEvidenceEvent[] = [];
  const lines: string[] = [];
  let used = 0;
  for (const event of rankEvidence(entry, limits.maxEvidencePerAnalysis)) {
    const line = lineOf(event);
    if (evidence.length > 0 && used + line.length > limits.maxEvidenceChars) continue;
    const shown = line.slice(0, limits.maxEvidenceChars);
    lines.push(shown);
    used += shown.length + 1;
    evidence.push(event);
  }
  if (evidence.length === 0) return undefined;
  const ids = evidence.map((event) => event.id);
  const causeIds = evidence.filter(isCauseEvidence).map((event) => event.id);
  const mustConclude = causeIds.length > 0 && DIRECT_FAILURE_CAUSES.has(entry.baseline.cause);
  const routes = evidence.flatMap((event) =>
    Object.entries(event.payload)
      .filter(([key, value]) => isUrlField(key) && typeof value === "string")
      .map(([, value]) => `${event.id}=${String(value)}`)
  );
  const { baseline } = entry;
  // One text block where there were four. Each DATA block costs two nonce delimiters, about 45 prompt
  // tokens on Qwen3.5-0.8B's tokenizer: 225 of a typical request's 523 carried no evidence at all.
  const failure = [
    `Deterministic conclusion: ${baseline.cause}: ${baseline.reason} (window: ${baseline.window})`,
    `It rests on: ${baseline.evidenceIds.filter((id) => ids.includes(id)).join(", ") || "none"}`,
    // Counts only: the batch shape is useful context, and it carries nothing about any row.
    ...(group.count > 1 ? [`Instances that failed the same way: ${group.count}`] : []),
    "Evidence:",
    ...lines
  ].join("\n");

  return {
    prompt: {
      instructions: INSTRUCTIONS,
      maxDataChars: limits.maxDataChars,
      fields: [
        // Bounded by construction, so the field cap is the data budget: the 1,200-character default is
        // what cut the evidence list mid-line.
        { name: "Failure", text: failure, maxChars: limits.maxDataChars },
        ...(routes.length ? [{ name: "EvidenceRoutes" as const, ids: routes }] : [])
      ]
    },
    // Every key is `required` because the runtime's grammar writes every key anyway, in this order
    // (node-llama-cpp marks each property required): calling one optional misstates what the model
    // must write. So declining is the ONE decision `[]` versus `[{`, and "insufficient beside a
    // conclusion", or a conclusion citing nothing, cannot be decoded at all.
    //
    // Whether declining is TRUE is decided here, from the evidence, not left to the model's first
    // token: Qwen3.5-0.8B declined a failure with eleven error events and concluded on a bare timeout.
    // A direct cause must be interpreted (`minItems`); with nothing but the runner's own record, a
    // decline is the only answer (`maxItems` 0, so the conclusion schema below is never decoded).
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["version", "conclusion"],
      properties: {
        version: { type: "integer", minimum: FAILURE_ANALYSIS_VERSION, maximum: FAILURE_ANALYSIS_VERSION },
        conclusion: {
          type: "array",
          ...(mustConclude ? { minItems: 1 } : {}),
          maxItems: causeIds.length > 0 ? 1 : 0,
          items: {
            type: "object",
            additionalProperties: false,
            required: [...CONCLUSION_FIELDS],
            properties: {
              // Closed enum: the grammar cannot name an event this request did not offer, nor rest a
              // conclusion on the runner's own record. (With no cause evidence it is never decoded.)
              primaryEvidenceIds: {
                type: "array",
                minItems: 1,
                maxItems: Math.max(1, Math.min(limits.maxCitedIds, causeIds.length)),
                items: { type: "string", enum: causeIds.length > 0 ? causeIds : ids }
              },
              secondaryEvidenceIds: { type: "array", maxItems: Math.min(limits.maxCitedIds, ids.length), items: { type: "string", enum: ids } },
              category: { type: "string", maxLength: limits.maxCategoryChars },
              explanation: { type: "string", maxLength: limits.maxExplanationChars },
              investigationSteps: { type: "array", maxItems: limits.maxSteps, items: { type: "string", maxLength: limits.maxStepChars } }
            }
          }
        }
      }
    },
    group,
    evidence,
    mustConclude
  };
}

// ── The answer ──────────────────────────────────────────────────────────────────────────────────

export interface FailureAnalysis {
  ok: true;
  /** True when the model declined to conclude: an empty conclusion list. Everything below is then empty. */
  insufficient: boolean;
  category: string;
  explanation: string;
  primaryEvidenceIds: string[];
  secondaryEvidenceIds: string[];
  investigationSteps: string[];
}

export type FailureAnalysisRejectionCode =
  | "MALFORMED"
  /** An evidence id this request did not offer. The closed enum should have stopped it; this is the re-check. */
  | "UNKNOWN_EVIDENCE"
  | "DUPLICATE_EVIDENCE"
  /** A conclusion citing no evidence of cause — none at all, or only the runner's own failure record. A guess wearing a verdict. */
  | "UNSUPPORTED_CONCLUSION"
  /** An answer that declines and concludes: the retired `insufficient` flag against the list, or a decline beside a direct cause. */
  | "CONTRADICTORY"
  | "UNSAFE_TEXT";

export interface FailureAnalysisRejection {
  ok: false;
  code: FailureAnalysisRejectionCode;
  field: string;
}

const hasControlChar = (value: string): boolean => [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/**
 * Validate a decoded analysis against the request that produced it.
 *
 * The grammar already makes the two failures that decide whether this feature is trustworthy at all
 * undecodable; they are re-checked here, because a runtime need not honour every keyword:
 *
 *  - **A conclusion must cite evidence of cause.** A conclusion whose primary evidence is nothing, or
 *    only the runner's own failure record, is a guess presented as a finding, and it is refused rather
 *    than shown with a caveat.
 *  - **Insufficient means insufficient.** Declining is an empty conclusion list and nothing else. An
 *    answer still carrying v1's `insufficient` flag against its own conclusion list is contradictory,
 *    and so is declining where the report's own cause rests on direct evidence; accepting either half
 *    would be choosing which one to believe.
 *
 * Plus what no grammar can express: an id listed twice, and a conclusion that explains nothing.
 */
export function parseFailureAnalysis(value: unknown, request: FailureAnalysisRequest): FailureAnalysis | FailureAnalysisRejection {
  const reject = (code: FailureAnalysisRejectionCode, field: string): FailureAnalysisRejection => ({ ok: false, code, field });
  const isRecord = (candidate: unknown): candidate is Record<string, unknown> => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
  if (!isRecord(value)) return reject("MALFORMED", "$");
  if (value.version !== FAILURE_ANALYSIS_VERSION) return reject("MALFORMED", "version");
  const conclusions = value.conclusion;
  if (!Array.isArray(conclusions) || conclusions.length > 1) return reject("MALFORMED", "conclusion");
  if (typeof value.insufficient === "boolean" && value.insufficient !== (conclusions.length === 0)) return reject("CONTRADICTORY", "insufficient");
  // Closed, as the schema is. The unexpected key is model output, so it is never echoed.
  if (Object.keys(value).some((key) => key !== "version" && key !== "conclusion")) return reject("MALFORMED", "$");
  if (conclusions.length === 0) {
    if (request.mustConclude) return reject("CONTRADICTORY", "conclusion");
    return { ok: true, insufficient: true, category: "", explanation: "", primaryEvidenceIds: [], secondaryEvidenceIds: [], investigationSteps: [] };
  }

  const at = "conclusion.0";
  const raw = conclusions[0];
  if (!isRecord(raw) || Object.keys(raw).some((key) => !(CONCLUSION_FIELDS as readonly string[]).includes(key))) return reject("MALFORMED", at);
  const offered = new Set(request.evidence.map((event) => event.id));
  const causes = new Set(request.evidence.filter(isCauseEvidence).map((event) => event.id));
  const seen = new Set<string>();
  const readIds = (field: "primaryEvidenceIds" | "secondaryEvidenceIds"): string[] | FailureAnalysisRejection => {
    const list = raw[field];
    if (list === undefined) return [];
    if (!Array.isArray(list) || list.length > FAILURE_ANALYSIS_LIMITS.maxCitedIds) return reject("MALFORMED", `${at}.${field}`);
    const out: string[] = [];
    for (const [index, id] of list.entries()) {
      const path = `${at}.${field}.${index}`;
      if (typeof id !== "string") return reject("MALFORMED", path);
      if (!offered.has(id)) return reject("UNKNOWN_EVIDENCE", path);
      if (field === "primaryEvidenceIds" && !causes.has(id)) return reject("UNSUPPORTED_CONCLUSION", path);
      // Across BOTH lists: an id cannot be primary and secondary, or listed twice in either.
      if (seen.has(id)) return reject("DUPLICATE_EVIDENCE", path);
      seen.add(id);
      out.push(id);
    }
    return out;
  };
  const primary = readIds("primaryEvidenceIds");
  if (!Array.isArray(primary)) return primary;
  const secondary = readIds("secondaryEvidenceIds");
  if (!Array.isArray(secondary)) return secondary;

  const text = (field: "category" | "explanation", max: number): string | FailureAnalysisRejection => {
    const value_ = raw[field];
    if (value_ === undefined) return "";
    if (typeof value_ !== "string") return reject("MALFORMED", `${at}.${field}`);
    const trimmed = value_.trim();
    if (trimmed.length > max) return reject("MALFORMED", `${at}.${field}`);
    if (hasControlChar(trimmed)) return reject("UNSAFE_TEXT", `${at}.${field}`);
    return trimmed;
  };
  const category = text("category", FAILURE_ANALYSIS_LIMITS.maxCategoryChars);
  if (typeof category !== "string") return category;
  const explanation = text("explanation", FAILURE_ANALYSIS_LIMITS.maxExplanationChars);
  if (typeof explanation !== "string") return explanation;

  const steps: string[] = [];
  if (raw.investigationSteps !== undefined) {
    if (!Array.isArray(raw.investigationSteps)) return reject("MALFORMED", `${at}.investigationSteps`);
    if (raw.investigationSteps.length > FAILURE_ANALYSIS_LIMITS.maxSteps) return reject("MALFORMED", `${at}.investigationSteps`);
    for (const [index, step] of raw.investigationSteps.entries()) {
      const path = `${at}.investigationSteps.${index}`;
      if (typeof step !== "string") return reject("MALFORMED", path);
      const trimmed = step.trim();
      if (!trimmed || trimmed.length > FAILURE_ANALYSIS_LIMITS.maxStepChars) return reject("MALFORMED", path);
      if (hasControlChar(trimmed)) return reject("UNSAFE_TEXT", path);
      steps.push(trimmed);
    }
  }

  if (primary.length === 0) return reject("UNSUPPORTED_CONCLUSION", `${at}.primaryEvidenceIds`);
  // A conclusion is shown as one, so it has to say something; declining is the empty list.
  if (!explanation) return reject("MALFORMED", `${at}.explanation`);

  return {
    ok: true,
    insufficient: false,
    category,
    explanation,
    primaryEvidenceIds: primary,
    secondaryEvidenceIds: secondary,
    investigationSteps: steps
  };
}

// ── Persistence (the optional run-report `diagnostics` extension) ─────────────────────────────────

/**
 * An answer as it may be shown and stored: every string through `SemanticRedactor`, then the
 * independent residual-secret rescan, as the L0 privacy policy requires of a stored AI artifact.
 * Null when the rescan still fires: such an answer is refused, never shown and never persisted.
 */
export function redactFailureAnalysis(analysis: FailureAnalysisBody, redactor: Pick<SemanticRedactor, "redactText">): FailureAnalysisBody | null {
  const clean = (text: string) => redactor.redactText(text);
  const out = { ...analysis, category: clean(analysis.category), explanation: clean(analysis.explanation), investigationSteps: analysis.investigationSteps.map(clean) };
  return findResidualSecrets([out.category, out.explanation, ...out.investigationSteps].join("\n")).length ? null : out;
}

const storedAnalyses = (report: ConcurrentRunReport): StoredFailureAnalysis[] =>
  Array.isArray(report.diagnostics?.analyses) ? report.diagnostics.analyses : [];

/** The report with `stored` saved: one analysis per signature, so recomputing replaces rather than accumulates. */
export function withStoredFailureAnalysis(report: ConcurrentRunReport, stored: StoredFailureAnalysis): ConcurrentRunReport {
  const others = storedAnalyses(report).filter((entry) => entry.signature !== stored.signature);
  return { ...report, diagnostics: { ...report.diagnostics, analyses: [...others, stored] } };
}

/**
 * The report without the analysis covering `instanceId` (its own or a coalesced member's), or
 * `undefined` when there is none — write nothing. An emptied extension is removed, so a report whose
 * only analysis was deleted is the report the run wrote; fields it does not know are kept.
 */
export function withoutStoredFailureAnalysis(report: ConcurrentRunReport, instanceId: string): ConcurrentRunReport | undefined {
  const analyses = storedAnalyses(report);
  const kept = analyses.filter((entry) => !(Array.isArray(entry?.instanceIds) && entry.instanceIds.includes(instanceId)));
  if (kept.length === analyses.length) return undefined;
  const { diagnostics, ...rest } = report;
  const { analyses: _removed, ...unknownFields } = diagnostics!;
  if (kept.length) return { ...report, diagnostics: { ...unknownFields, analyses: kept } };
  return Object.keys(unknownFields).length ? { ...report, diagnostics: unknownFields as ConcurrentRunReport["diagnostics"] } : rest;
}

/**
 * Whether failure analysis may run at all. `failureAnalysis` has a T0 ceiling, so the answer is
 * always `observe` or `forbidden` — there is no configuration under which it applies anything.
 */
export function failureAnalysisDecision(policy: AiPolicyConfig): AiPolicyDecision {
  return decideAiAction("failureAnalysis", "interpretation", {}, policy);
}
