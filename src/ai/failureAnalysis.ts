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
import type { FailureCauseBaseline } from "../runner/evidence/FailureCauseBaseline";
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
  maxCategoryChars: 40,
  maxExplanationChars: 600,
  maxStepChars: 200,
  maxSteps: 4,
  timeoutMs: 30_000,
  maxOutputTokens: 512,
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
}

const INSTRUCTIONS =
  "You interpret why an automation run failed, for the person who will investigate it. " +
  "You are given the application's own deterministic conclusion, and the evidence events it rests on, " +
  "each with an id. Name the evidence that best explains the failure, by id. " +
  "Do not name evidence that is not in the list, and do not invent evidence. " +
  "If the evidence does not support a conclusion, set insufficient to true and say so — that is a " +
  "correct answer, and a guess is not. " +
  "You are describing a run that has already finished. You cannot change its result, retry it, or " +
  "change any setting; write only what a person should look at.";

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
  const evidence = rankEvidence(entry, limits.maxEvidencePerAnalysis);
  if (evidence.length === 0) return undefined;
  const ids = evidence.map((event) => event.id);

  // The payload is already redacted, id-stripped and capped by L5a's buffer, so it is rendered as-is
  // rather than re-derived here: a second normalization is a second place for the rules to drift.
  //
  // URL fields are the exception, and not by choice. `AiPromptBuilder` redacts every DATA string, and
  // its first rule replaces any whole URL — including a route template L5a already stripped of its
  // query, userinfo and ids. That is correct defence in depth and must not be weakened, so the route
  // travels through the `ids` channel instead, which is unredacted but still rescanned for residual
  // secrets. Without it the model would be told a request failed and never told which one.
  const isUrlField = (key: string): boolean => /(?:url|Url|URL)$/.test(key);
  const lines = evidence
    .map((event) => {
      const fields = Object.entries(event.payload)
        .filter(([key]) => !isUrlField(key))
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ");
      const repeat = event.repeatCount > 1 ? ` x${event.repeatCount}` : "";
      return `${event.id}: ${event.source} (${event.severity}) at ${event.offsetMs}ms${repeat} ${fields}`;
    })
    .join("\n");
  const routes = evidence.flatMap((event) =>
    Object.entries(event.payload)
      .filter(([key, value]) => isUrlField(key) && typeof value === "string")
      .map(([, value]) => `${event.id}=${String(value)}`)
  );

  return {
    prompt: {
      instructions: INSTRUCTIONS,
      maxDataChars: limits.maxDataChars,
      fields: [
        { name: "DeterministicConclusion", text: `${entry.baseline.cause}: ${entry.baseline.reason} (window: ${entry.baseline.window})` },
        { name: "ConclusionEvidenceIds", ids: entry.baseline.evidenceIds.length ? entry.baseline.evidenceIds : ["none"] },
        { name: "Evidence", text: lines },
        ...(routes.length ? [{ name: "EvidenceRoutes" as const, ids: routes }] : []),
        // Counts only: the batch shape is useful context, and it carries nothing about any row.
        { name: "AffectedInstances", ids: [String(group.count)] }
      ]
    },
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["version", "insufficient"],
      properties: {
        version: { type: "integer", minimum: FAILURE_ANALYSIS_VERSION, maximum: FAILURE_ANALYSIS_VERSION },
        insufficient: { type: "boolean" },
        category: { type: "string", maxLength: limits.maxCategoryChars },
        explanation: { type: "string", maxLength: limits.maxExplanationChars },
        // Closed enum: the grammar cannot name an event this request did not offer.
        primaryEvidenceIds: { type: "array", maxItems: ids.length, items: { type: "string", enum: ids } },
        secondaryEvidenceIds: { type: "array", maxItems: ids.length, items: { type: "string", enum: ids } },
        investigationSteps: { type: "array", maxItems: limits.maxSteps, items: { type: "string", maxLength: limits.maxStepChars } }
      }
    },
    group,
    evidence
  };
}

// ── The answer ──────────────────────────────────────────────────────────────────────────────────

export interface FailureAnalysis {
  ok: true;
  /** True when the model declined to conclude. Everything below is then empty. */
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
  /** A conclusion with no supporting evidence and no `insufficient` flag — a guess wearing a verdict. */
  | "UNSUPPORTED_CONCLUSION"
  /** `insufficient` is true, yet the answer still concludes. */
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
 * Beyond the id re-check, two rules the grammar cannot express and that decide whether this feature
 * is trustworthy at all:
 *
 *  - **A conclusion must cite evidence.** An answer that names a cause with no `primaryEvidenceIds`
 *    is a guess presented as a finding, and it is refused rather than shown with a caveat.
 *  - **`insufficient` means insufficient.** An answer that sets the flag and still concludes is
 *    contradictory; accepting either half would be choosing which one to believe.
 */
export function parseFailureAnalysis(value: unknown, request: FailureAnalysisRequest): FailureAnalysis | FailureAnalysisRejection {
  const reject = (code: FailureAnalysisRejectionCode, field: string): FailureAnalysisRejection => ({ ok: false, code, field });
  if (typeof value !== "object" || value === null || Array.isArray(value)) return reject("MALFORMED", "$");
  const raw = value as Record<string, unknown>;
  if (raw.version !== FAILURE_ANALYSIS_VERSION) return reject("MALFORMED", "version");
  if (typeof raw.insufficient !== "boolean") return reject("MALFORMED", "insufficient");

  const offered = new Set(request.evidence.map((event) => event.id));
  const seen = new Set<string>();
  const readIds = (field: "primaryEvidenceIds" | "secondaryEvidenceIds"): string[] | FailureAnalysisRejection => {
    const list = raw[field];
    if (list === undefined) return [];
    if (!Array.isArray(list)) return reject("MALFORMED", field);
    const out: string[] = [];
    for (const [index, id] of list.entries()) {
      const path = `${field}.${index}`;
      if (typeof id !== "string") return reject("MALFORMED", path);
      if (!offered.has(id)) return reject("UNKNOWN_EVIDENCE", path);
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
    if (typeof value_ !== "string") return reject("MALFORMED", field);
    const trimmed = value_.trim();
    if (trimmed.length > max) return reject("MALFORMED", field);
    if (hasControlChar(trimmed)) return reject("UNSAFE_TEXT", field);
    return trimmed;
  };
  const category = text("category", FAILURE_ANALYSIS_LIMITS.maxCategoryChars);
  if (typeof category !== "string") return category;
  const explanation = text("explanation", FAILURE_ANALYSIS_LIMITS.maxExplanationChars);
  if (typeof explanation !== "string") return explanation;

  const steps: string[] = [];
  if (raw.investigationSteps !== undefined) {
    if (!Array.isArray(raw.investigationSteps)) return reject("MALFORMED", "investigationSteps");
    if (raw.investigationSteps.length > FAILURE_ANALYSIS_LIMITS.maxSteps) return reject("MALFORMED", "investigationSteps");
    for (const [index, step] of raw.investigationSteps.entries()) {
      const path = `investigationSteps.${index}`;
      if (typeof step !== "string") return reject("MALFORMED", path);
      const trimmed = step.trim();
      if (!trimmed || trimmed.length > FAILURE_ANALYSIS_LIMITS.maxStepChars) return reject("MALFORMED", path);
      if (hasControlChar(trimmed)) return reject("UNSAFE_TEXT", path);
      steps.push(trimmed);
    }
  }

  const concludes = category.length > 0 || explanation.length > 0;
  if (raw.insufficient === true && concludes) return reject("CONTRADICTORY", "insufficient");
  if (raw.insufficient !== true && concludes && primary.length === 0) return reject("UNSUPPORTED_CONCLUSION", "primaryEvidenceIds");

  return {
    ok: true,
    insufficient: raw.insufficient,
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
