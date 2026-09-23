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
 * The corrective step itself is the product's, not the model's (2026-09-23): every rule has one
 * product-authored step (`correctiveStep`), the one that names the safe fix only where the validator
 * emitted one. It travels in the request, so the model restates a step that is right instead of guessing
 * one, and it travels in the answer beside the model's text, so what the person is told to do never
 * rests on model wording alone. A reviewed 0.8B answer had told the person to add a connector INTO End
 * for a connector leaving it, and read "requires a value and has none" as the value not being required.
 *
 * What crosses to the model: issue codes, severities, active-path flags, the anchor's KIND (node,
 * connector or flow), rule summaries and corrective steps (product-authored constants) and whether the
 * validator emitted a fix. Never an anchor id, a validator message, a locator value, a typed value, a step
 * name or any profile literal — `safeFix.from`/`to` are deliberately withheld even though they are usually
 * enum casing, because "usually" is not a contract. So the prompt's size is a function of product
 * constants alone, which is what lets L1.8 bound its worst case.
 *
 * Pure: no Electron, no filesystem, no clock, no Playwright, no model.
 */

import type { AiPromptSpec } from "./AiPromptBuilder";
import type { AiOutputSchema } from "./AiOutputContract";
import {
  FLOW_VALIDATION_RULES,
  isExecutionBlocking,
  type FlowValidationCode,
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
  /** The product's corrective step for this issue (`correctiveStep`). Never model text. */
  step: string;
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
  /**
   * Model prose, complete sentences only. Always rendered as an AI interpretation, never as a validator
   * message. A sentence the character limit cut off is dropped, never completed (`cut`).
   */
  text: string;
  /** The product's corrective step for the issue, from the request: never taken from the answer. */
  step: string;
  /** The model's text ran into the character limit mid-sentence; see {@link endAtCompleteSentence}. */
  cut?: true;
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
 * Every clause is load-bearing, and `verify:ai-authoring` §12 holds each one: the given action (the
 * corrective step) first, so the character limit cuts the explanation rather than the action; no other
 * action; the list of things never to invent; the fix limit; and the ranking's priority. Its length is
 * L1.8 prompt time: it is shorter than the one it replaced, because each issue's line carries its action.
 */
// The 0.8B echoes the task sentence: 16 of the 2026-09-23 captured answers opened "The automation flow
// failed validation because…", and none held an action. Both alternatives measured no better that day:
// with no task sentence, answers collapsed to bare rule codes ("Unsupported Operator…"), 2 of 10
// actionable; asked instead "how to correct each validation issue", the echo ended but runs gave 8/17
// and 8/17 (this sentence: 9/17 and 7/17), and the verb came back as the model's own actions with values
// it invented ("Correct the operator casing to 'operator'"). See L4 › "One corrective change, measured".
const INSTRUCTIONS =
  "You explain why an automation flow failed validation, for the person editing it. " +
  "Each issue has an id, its rule code, severity, where it is, the rule's one-line summary and the action " +
  "that corrects it. For each issue, write one or two short sentences: first its action as given, then " +
  "what is wrong. Never suggest another action, and never invent issues, ids, rules, step names, selectors, " +
  "values or connections. Only an issue marked fixable has a safe fix the application can apply; you may " +
  "put those ids in order of which is most worth doing first, errors on the run path first. " +
  "You may not rank an id that is not marked fixable.";

/**
 * The corrective step for each rule, product-authored: an instruction to the person, tied to the node or
 * connector the finding anchors ("this step", "this connector"), resting on the rule alone. Where the
 * validator's own message already names a remedy (a branch pair, a cycle, a condition's priority, an
 * ignored binding) this is that remedy. Exhaustive, so a new rule does not type-check without one.
 */
const CORRECTIVE_STEP: Readonly<Record<FlowValidationCode, string>> = Object.freeze({
  missingStartNode: "Add a Start node and connect it to the first step.",
  multipleStartNodes: "Keep one Start node and remove the others.",
  missingEndNode: "Add an End node and connect the last step to it.",
  unreachableEndNode: "Connect the steps so that a path leads from Start to an End node.",
  duplicateNodeId: "Delete one of the steps that share this id, add it again so it gets a new id, and reconnect it.",
  duplicateEdgeId: "Give each connector that shares this id its own id.",
  duplicateFlowId: "Give one of the flows that share this id a new id by saving it as a new flow.",
  brokenConnectorEndpoint: "Reconnect this connector to a step that exists, or delete it.",
  unreachableNode: "Connect this step from a step that runs, or delete it if it is not needed.",
  missingFlowReference: "Choose a saved flow for this Run Another Flow step.",
  flowReferenceCycle: "Change one of these Run Another Flow steps so that the flows no longer run each other in a loop.",
  missingRequiredLocator: "Add a locator to this step so that it knows which element to act on.",
  missingRequiredValue: "Set the value this step needs in its settings, or bind a value source to it.",
  invalidTimeout: "Set this step's timeout to a positive number of milliseconds.",
  invalidWaitCondition: "Fill in the field this Smart Wait condition needs, or remove the condition.",
  invalidLoopBounds: "Set the loop's iteration limit to a number from 1 to 1000.",
  unsupportedOperator: "Change the condition's operator to one of the listed operators.",
  unsupportedConfiguration: "Change this setting to one of its listed values.",
  connectorStructure: "Change or remove the connector this finding points to, as the finding describes.",
  degradedWaitCondition: "Fill in the field this optional Smart Wait condition needs, or remove the condition.",
  highTimeout: "Lower this step's timeout unless the step really needs to wait that long.",
  largeLoopBounds: "Lower the loop's iteration limit unless the run needs that many passes.",
  locatorNeedsReview: "Review and approve this step's locator, or record the element again.",
  interactionPrerequisiteBlocked: "Review this step's prerequisite and choose how the step should run.",
  ignoredConditionValueSource: "Remove the value source binding, or put its value into the condition's expression.",
  incompleteBranchPair: "Add the matching branch or a fallback connector from the same step, or change this connector to a standard one.",
  unguardedCycle: "Change the connector that closes this cycle to a Loop Back connector with a maximum count, or remove it.",
  connectorFromEndNode: "Remove this connector from the End step, or move its target so that it runs before End.",
  deadEndNode: "Add an outgoing connector from this step to the next step or to an End step.",
  incompleteCondition: "Set the condition's comparison value, or the variable path it reads.",
  emptyLoopValues: "Add values to this loop's static list, or choose another loop mode.",
  ambiguousConditionPriority: "Give each conditional connector from this step its own priority.",
  incompleteValueSource: "Set the missing key this value source reads, or remove the binding."
});

/** What each fix kind does, for the step of an issue the validator emitted it for. It names the issue's own subject. */
const SAFE_FIX_EFFECT: Readonly<Record<SafeFixKind, (issue: FlowValidationIssue) => string>> = Object.freeze({
  normalizeEnumCasing: (issue: FlowValidationIssue) => `corrects ${issue.code === "unsupportedOperator" ? "the operator's" : "this setting's"} casing to a listed value`,
  regenerateId: () => "gives this connector a new id"
});

/**
 * The product's corrective step for one issue. Deterministic: the same issue always gets the same step.
 * Where the validator emitted a fix, the step is that fix through its preview; no other step ever names one.
 */
export function correctiveStep(issue: FlowValidationIssue): string {
  return issue.safeFix ? `Review and apply the offered safe fix, which ${SAFE_FIX_EFFECT[issue.safeFix.kind](issue)}.` : CORRECTIVE_STEP[issue.code];
}

/**
 * Keep only complete sentences. The grammar ends a text at `maxExplanationChars` wherever it is, and a
 * cut sentence read as an instruction ("The person should add a condition to the") is incomplete or
 * misleading. So an unfinished tail is dropped, never completed or rewritten; a text with no complete
 * sentence at all keeps its fragment, marked with an ellipsis so it cannot pass for a finished one.
 */
export function endAtCompleteSentence(text: string): { text: string; cut: boolean } {
  if (/[.!?]["')\]]?$/.test(text)) return { text, cut: false };
  // A sentence ends where the next one starts with a capital, so "e.g. the value" is not an end.
  const ends = [...text.matchAll(/[.!?]["')\]]?(?=\s+[A-Z])/g)].map((m) => (m.index ?? 0) + m[0].length);
  if (ends.length > 0) return { text: text.slice(0, ends[ends.length - 1]), cut: true };
  return { text: `${text.slice(0, AUTHORING_LIMITS.maxExplanationChars - 1).trimEnd()}…`, cut: true };
}

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
  const issues: AuthoringIssueRef[] = sent.map((issue, index) => ({ id: `i${index}`, issue, fixable: issue.safeFix !== undefined, step: correctiveStep(issue) }));
  const fixableIds = issues.filter((ref) => ref.fixable).map((ref) => ref.id);
  const ids = issues.map((ref) => ref.id);

  // Only the anchor's kind, never its id: an id is the user's (a recorded step's is a UUID, dozens of
  // prompt tokens the model cannot use), and an answer is mapped back through `issues`, not through it.
  // Never a step name, a locator or a validator message, which can carry a profile literal either. A
  // fixable issue's step says what its fix does, so the fix's kind and field are not repeated here.
  const issueLines = issues
    .map((ref) => {
      const { issue } = ref;
      const anchor = issue.nodeId ? "at a node" : issue.edgeId ? "at a connector" : "flow-wide";
      // "Action", never "Step": a step is a node here, and labelled "Step:" the 0.8B read the corrective
      // step as a step's NAME ("The step 'Add a locator to this step' is missing a locator"). The action
      // stays after the summary: put first, with the instruction to match, the 0.8B stopped restating
      // it (2 of 10 actionable against 7 of 10, 2026-09-23).
      return `${ref.id}: ${issue.code} (${issue.severity}, ${issue.onActivePath ? "on the run path" : "off the run path"}, ${anchor}${ref.fixable ? ", fixable" : ""}) — ${FLOW_VALIDATION_RULES[issue.code].summary} Action: ${ref.step}`;
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
    const ended = endAtCompleteSentence(trimmed);
    explanations.push({ issueId, issue: ref.issue, text: ended.text, step: ref.step, ...(ended.cut ? { cut: true as const } : {}) });
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
