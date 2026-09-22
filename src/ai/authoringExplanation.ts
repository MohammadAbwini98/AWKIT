/**
 * AI authoring explanations (T0) and safe-fix ranking (T1) — Phase L, L4b.
 *
 * The validator is and stays the source of truth. This module builds a bounded, id-and-enum-only
 * request from a `FlowValidationReport`, and validates the answer back against **that same report**.
 * It is the whole L4b contract, and it is arranged so the two things L4b must never do are impossible
 * rather than merely checked:
 *
 *  1. **AI cannot invent a fix kind.** The answer has no `kind` field at all. Ranking is a permutation
 *     of issue IDS the validator already emitted a `safeFix` for, so the most a model can do is
 *     reorder work `SafeFixApplier` was already willing to perform. A new fix kind stays what L4b says
 *     it is: a deterministic, owner-approved change to `FlowValidator` and `SafeFixApplier` first.
 *  2. **AI cannot name something that is not in the report.** Issue ids are a closed `enum` in the
 *     decoding grammar, and `parseAuthoringAnswer` re-checks every id against the report afterwards,
 *     because a grammar is one layer and L1.3 requires runtime validation after decoding.
 *
 * Owner decisions (2026-09-22): each explanation names a corrective step grounded in the issue it was
 * given, and invents no name, selector, value, connection or automatic fix. A fix order is optional;
 * where it is given, a fix for an issue that blocks the run comes first — the one documented priority
 * between fixes — and an order that breaks it is withheld, never shown and never re-sorted.
 *
 * What crosses to the model: issue codes, severities, active-path flags, the anchor's KIND (node,
 * connector or flow), rule summaries (product-authored constants) and the `kind`/`field` of each emitted
 * fix. Never an anchor id, a validator message, a locator value, a typed value, a step name or any
 * profile literal — `safeFix.from`/`to` are deliberately withheld even though they are usually enum
 * casing, because "usually" is not a contract. So the prompt's size is a function of product constants
 * alone, which is what lets L1.8 bound its worst case.
 *
 * Pure: no Electron, no filesystem, no clock, no Playwright, no model.
 */

import type { AiPromptSpec } from "./AiPromptBuilder";
import type { AiOutputSchema } from "./AiOutputContract";
import {
  FLOW_VALIDATION_RULES,
  isExecutionBlocking,
  type FlowValidationIssue,
  type FlowValidationReport,
  type SafeFixKind
} from "../validation/FlowValidator";
import { decideAiAction, type AiPolicyConfig, type AiPolicyDecision } from "../security/authz/AiAutonomyPolicy";

export const AUTHORING_ANSWER_VERSION = 1;

/** One job's bounds. An authoring explanation is interactive help, not a batch. */
export const AUTHORING_LIMITS = Object.freeze({
  /**
   * Issues sent in one request: as many as one answer explains. A sent issue costs its whole line in
   * prompt evaluation, the larger half of the wait on a CPU-only host (L1.8). A report with more is
   * truncated, and the request says so.
   */
  maxIssues: 2,
  /** Characters per explanation. Enough for two plain sentences; a longer answer is a malformed one. */
  maxExplanationChars: 160,
  /**
   * This feature's own deadline: its L1.8 ceiling, 120 s at the output cap (`explanationAtCapMs` in
   * `benchmark:ai-model`), plus 5 s over the overhead measured beside it — under 0.1 s of dispatch and
   * main-loop delay. Qwen3.5-0.8B's answers took 52–76 s on the qualifying host (88 s at the cap), so
   * the shared 30 s cancelled every real explanation. The other features keep 30 s.
   */
  timeoutMs: 125_000,
  /**
   * The L1.8 budget for this feature (≤192 out). The runtime's grammar lets a model indent its JSON, and
   * Qwen3.5-0.8B does: 151 tokens for two explanations of 116 characters, ~90 of them structure (L1.8).
   * Two at `maxExplanationChars` plus a full ranking still fit, which matters because an answer cut off
   * at the cap is invalid JSON and is discarded whole.
   */
  maxOutputTokens: 192,
  maxDataChars: 3_000
});

/** An issue as this request refers to it. `id` is positional within ONE report snapshot. */
export interface AuthoringIssueRef {
  /** `i0`, `i1`, … in the order sent. Short, and it can leak nothing. */
  id: string;
  issue: FlowValidationIssue;
  /** The validator emitted a `safeFix` for this issue, so it may appear in a ranking. */
  fixable: boolean;
}

export interface AuthoringRequest {
  prompt: AiPromptSpec;
  schema: AiOutputSchema;
  /** Every issue sent, blocking ones first. The caller maps an answer back through this, never by re-validating. */
  issues: AuthoringIssueRef[];
  /** Ids of the issues the validator emitted a fix for. The ONLY ids a ranking may contain. */
  fixableIds: string[];
  /** Issues the report had beyond `maxIssues`. Reported so a UI never implies the list was complete. */
  truncated: number;
}

export interface AuthoringExplanation {
  issueId: string;
  issue: FlowValidationIssue;
  /** Model prose. Always rendered as an AI interpretation, never as a validator message. */
  text: string;
}

export interface AuthoringAnswer {
  ok: true;
  /** T0. At most one per issue, and only for issues in this report. */
  explanations: AuthoringExplanation[];
  /**
   * T1. Emitted-fix issue ids, most worth applying first. A subset, because a model declining to rank
   * an issue is information; never a superset, and never anything the validator did not emit a fix for.
   * Empty when the model ranked nothing, or when its order was withheld.
   */
  ranking: string[];
  /**
   * Set when the model's order put a fix that can wait ahead of one for an issue that blocks the run.
   * The order is withheld rather than re-sorted: re-sorting would show the product's order as the AI's.
   */
  rankingWithheld?: "PRIORITY_VIOLATION";
}

export type AuthoringRejectionCode =
  /** The answer was not an object of the right shape. */
  | "MALFORMED"
  /** An id that is not in this report — the closed enum should have prevented it; this is the re-check. */
  | "UNKNOWN_ISSUE"
  /** The same issue explained or ranked twice. */
  | "DUPLICATE_ISSUE"
  /** A ranked issue the validator emitted no `safeFix` for. AI may rank fixes; it may not propose them. */
  | "FIX_NOT_EMITTED"
  /** An explanation that is empty or only whitespace. */
  | "EMPTY_EXPLANATION"
  /** Control characters in prose that a UI would render. */
  | "UNSAFE_TEXT";

export interface AuthoringRejection {
  ok: false;
  code: AuthoringRejectionCode;
  /** The path of the offending field, never its value. */
  field: string;
}

/**
 * Every clause is load-bearing, and `verify:ai-authoring` §12 holds each one: the corrective step, its
 * grounding in the issue given, the fallback when the issue says too little, the list of things never
 * to invent, the automatic-fix limit and the ranking's priority. Its length is L1.8 prompt time.
 */
const INSTRUCTIONS =
  "You explain why an automation flow failed validation, for the person editing it. " +
  "You are given validation issues by id, each with its rule code, severity, where it is and the rule's " +
  "own one-line summary. For each issue, write one or two short sentences: what is wrong, then the step " +
  "the person should take in the editor, starting with a verb such as add, set, connect, remove or change. " +
  "Base the step only on that issue; if it gives too little for a specific step, say what to check. " +
  "Never invent issues, ids, rules, step names, selectors, values or connections, and never say the " +
  "application can fix an issue that is not marked fixable. " +
  "An issue marked fixable has a repair the application already knows how to perform safely; " +
  "you may put those ids in order of which is most worth doing first, errors on the run path first. " +
  "You may not rank an id that is not marked fixable.";

/** Product-authored, one line per kind. The model is told what a fix IS; it never chooses one. */
const FIX_KIND_SUMMARY: Readonly<Record<SafeFixKind, string>> = Object.freeze({
  normalizeEnumCasing: "rewrites a setting whose spelling differs from a legal value only by casing",
  regenerateId: "assigns a fresh id where nothing refers to the old one ambiguously"
});

const hasControlChar = (value: string): boolean => [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/**
 * Build one bounded request from a report.
 *
 * The issue ids in the schema are a closed `enum` built from THIS report, so the decoding grammar
 * itself cannot produce an id the report does not contain. A report with no issues, or none the model
 * could usefully discuss, returns `undefined`: there is nothing to ask.
 */
export function buildAuthoringRequest(report: FlowValidationReport, options: { maxIssues?: number } = {}): AuthoringRequest | undefined {
  const limit = Math.max(1, Math.min(options.maxIssues ?? AUTHORING_LIMITS.maxIssues, AUTHORING_LIMITS.maxIssues));
  const all = report.issues;
  if (all.length === 0) return undefined;
  // With room for only a few, the issues that stop the flow from running go first, each group in the
  // report's own deterministic order.
  const sent = [...all.filter(isExecutionBlocking), ...all.filter((issue) => !isExecutionBlocking(issue))].slice(0, limit);
  const issues: AuthoringIssueRef[] = sent.map((issue, index) => ({ id: `i${index}`, issue, fixable: issue.safeFix !== undefined }));
  const fixableIds = issues.filter((ref) => ref.fixable).map((ref) => ref.id);
  const ids = issues.map((ref) => ref.id);

  // Only the anchor's kind, never its id: an id is the user's (a recorded step's is a UUID, dozens of
  // prompt tokens the model cannot use), and an answer is mapped back through `issues`, not through it.
  // Never a step name, a locator or a validator message, which can carry a profile literal either.
  const issueLines = issues
    .map((ref) => {
      const { issue } = ref;
      const anchor = issue.nodeId ? "at a node" : issue.edgeId ? "at a connector" : "flow-wide";
      const fix = issue.safeFix ? ` fixable=${issue.safeFix.kind} at ${issue.safeFix.field} (${FIX_KIND_SUMMARY[issue.safeFix.kind]})` : "";
      return `${ref.id}: ${issue.code} (${issue.severity}, ${issue.onActivePath ? "on the run path" : "off the run path"}, ${anchor})${fix} — ${FLOW_VALIDATION_RULES[issue.code].summary}`;
    })
    .join("\n");

  return {
    prompt: {
      instructions: INSTRUCTIONS,
      maxDataChars: AUTHORING_LIMITS.maxDataChars,
      // One DATA block: each costs two nonce delimiters in prompt tokens, and a fixable issue is already
      // marked on its own line.
      fields: [{ name: "Issues", text: issueLines }]
    },
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["version", "explanations"],
      properties: {
        version: { type: "integer", minimum: AUTHORING_ANSWER_VERSION, maximum: AUTHORING_ANSWER_VERSION },
        explanations: {
          type: "array",
          // Every sent issue is explained. Allowed to skip them, Qwen3.5-0.8B skipped them all (L1.8).
          minItems: issues.length,
          maxItems: issues.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["issueId", "text"],
            properties: {
              // Closed enum from THIS report: the grammar cannot emit an id the report lacks.
              issueId: { type: "string", enum: ids },
              text: { type: "string", maxLength: AUTHORING_LIMITS.maxExplanationChars }
            }
          }
        },
        // Likewise closed, and narrower: only ids the validator emitted a fix for. With none there is
        // nothing to rank, so there is no ranking, rather than a placeholder id the parser must refuse.
        ...(fixableIds.length > 0 ? { ranking: { type: "array" as const, maxItems: fixableIds.length, items: { type: "string" as const, enum: fixableIds } } } : {})
      }
    },
    issues,
    fixableIds,
    truncated: all.length - sent.length
  };
}

/**
 * Validate a decoded answer against the request that produced it.
 *
 * The grammar already narrowed ids to this report; this is the L1.3 re-check after decoding, and it
 * also enforces the rules a grammar cannot express: no duplicates, and nothing ranked that the
 * validator did not emit a fix for.
 */
export function parseAuthoringAnswer(value: unknown, request: AuthoringRequest): AuthoringAnswer | AuthoringRejection {
  const reject = (code: AuthoringRejectionCode, field: string): AuthoringRejection => ({ ok: false, code, field });
  if (typeof value !== "object" || value === null || Array.isArray(value)) return reject("MALFORMED", "$");
  const raw = value as Record<string, unknown>;
  if (raw.version !== AUTHORING_ANSWER_VERSION) return reject("MALFORMED", "version");

  const byId = new Map(request.issues.map((ref) => [ref.id, ref]));
  const fixable = new Set(request.fixableIds);

  if (!Array.isArray(raw.explanations)) return reject("MALFORMED", "explanations");
  const explanations: AuthoringExplanation[] = [];
  const explained = new Set<string>();
  for (const [index, entry] of raw.explanations.entries()) {
    const path = `explanations.${index}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return reject("MALFORMED", path);
    const { issueId, text } = entry as Record<string, unknown>;
    if (typeof issueId !== "string") return reject("MALFORMED", `${path}.issueId`);
    const ref = byId.get(issueId);
    if (!ref) return reject("UNKNOWN_ISSUE", `${path}.issueId`);
    if (explained.has(issueId)) return reject("DUPLICATE_ISSUE", `${path}.issueId`);
    if (typeof text !== "string") return reject("MALFORMED", `${path}.text`);
    const trimmed = text.trim();
    if (!trimmed) return reject("EMPTY_EXPLANATION", `${path}.text`);
    if (trimmed.length > AUTHORING_LIMITS.maxExplanationChars) return reject("MALFORMED", `${path}.text`);
    if (hasControlChar(trimmed)) return reject("UNSAFE_TEXT", `${path}.text`);
    explained.add(issueId);
    explanations.push({ issueId, issue: ref.issue, text: trimmed });
  }

  const ranking: string[] = [];
  if (raw.ranking !== undefined) {
    if (!Array.isArray(raw.ranking)) return reject("MALFORMED", "ranking");
    const ranked = new Set<string>();
    for (const [index, id] of raw.ranking.entries()) {
      const path = `ranking.${index}`;
      if (typeof id !== "string") return reject("MALFORMED", path);
      if (!byId.has(id)) return reject("UNKNOWN_ISSUE", path);
      // The decisive rule of L4b: a model may reorder repairs the validator already offered, and
      // nothing else. Ranking an issue with no emitted fix would be proposing one.
      if (!fixable.has(id)) return reject("FIX_NOT_EMITTED", path);
      if (ranked.has(id)) return reject("DUPLICATE_ISSUE", path);
      ranked.add(id);
      ranking.push(id);
    }
  }

  // A decodable order is still only a suggestion: one that breaks the documented priority is not
  // justified, so there is no fix order. The explanations stand; they are not what was wrong.
  if (rankingKeepsPriority(request, ranking) === false) return { ok: true, explanations, ranking: [], rankingWithheld: "PRIORITY_VIOLATION" };
  return { ok: true, explanations, ranking };
}

/**
 * Whether a ranking keeps the one documented priority between fixes: every fix for an issue that
 * blocks the run (`isExecutionBlocking`) comes before any fix that can wait, and none is left out
 * ahead of one that can. `null` when nothing is ranked or no fix is more urgent than another: there is
 * then no order to keep, and none is invented.
 */
export function rankingKeepsPriority(request: AuthoringRequest, ranking: readonly string[]): boolean | null {
  const blocking = new Map(request.issues.map((ref) => [ref.id, isExecutionBlocking(ref.issue)]));
  if (ranking.length === 0 || new Set(request.fixableIds.map((id) => blocking.get(id))).size < 2) return null;
  const ordered = ranking.every((id, index) => index === 0 || blocking.get(ranking[index - 1]) === true || blocking.get(id) !== true);
  const blockingLeftOut = request.fixableIds.some((id) => blocking.get(id) && !ranking.includes(id));
  return ordered && (!blockingLeftOut || ranking.every((id) => blocking.get(id)));
}

/**
 * Whether this ranking may be shown as a suggestion, and at what tier.
 *
 * `validatorEmittedSafeFix` is passed as `true` only because {@link parseAuthoringAnswer} has already
 * refused any id the validator did not emit a fix for — it is an established fact here, not a caller's
 * assertion. An empty ranking is decided the same way rather than short-circuited, so a feature turned
 * off reports `forbidden` instead of looking like a model that simply had nothing to say.
 */
export function authoringRankingDecision(policy: AiPolicyConfig): AiPolicyDecision {
  return decideAiAction("safeFixRanking", "safeFixApply", { validatorEmittedSafeFix: true }, policy);
}

/** Explanations are always T0: an interpretation is observed and labelled, never applied. */
export function authoringExplanationDecision(policy: AiPolicyConfig): AiPolicyDecision {
  return decideAiAction("validationExplanation", "interpretation", {}, policy);
}
