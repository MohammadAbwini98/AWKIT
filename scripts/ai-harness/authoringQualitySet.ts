/**
 * The labelled set behind `verify:ai-authoring-quality-live` (Phase L, L4b), and the judge it applies.
 *
 * Each case is a small broken flow whose report sends one or two issues from different L4a families,
 * through `buildAuthoringRequest`, so together they cover one request per fix kind, both severities, a
 * report the builder must truncate and reorder, a warnings-only report and a lone issue. The step
 * names, the flow name and the typed values carry `CANARY`, which the product never sends: the request
 * carries codes, severities, anchors and rule summaries only.
 *
 * The judge is a PROXY and says so. Model text is never recorded, so every quality reading is lexical:
 *  - on subject: it names its own issue's subject (`SUBJECT`); misattributed: it names another sent
 *    issue's instead;
 *  - actionable: one sentence holds a corrective verb and its issue's remedy (`REMEDY`);
 *  - unsupported: a screen found a claim the request does not support (`UnsupportedKind`).
 * A screen can prove an explanation WRONG; nothing here can prove one right. So an explanation that
 * clears every screen is `unverified`, for a person to judge, never `accepted`. The live gate records
 * these rates and judges only the product's own contract; the quality target (adopted provisionally,
 * 2026-09-22) is evaluated over every captured run and a person's verdicts by `verify:ai-authoring-review`
 * (scripts/ai-harness/authoringQualityReview.ts).
 *
 * The labels (codes, fixes, which issue blocks the run, what is truncated) and every pattern were
 * written from the validator's rules, before any model output was seen.
 *
 * Electron-free: `verify:ai-authoring` audits the set and runs the judge's controls without a model.
 */

import { parseAuthoringAnswer, rankingKeepsPriority, type AuthoringAnswer, type AuthoringIssueRef, type AuthoringRequest } from "@src/ai/authoringExplanation";
import type { FlowEdge, FlowProfile, FlowStep, StepType } from "@src/profiles/FlowProfile";
import { findResidualSecrets } from "@src/semantic/SemanticPolicyValidator";
import { isExecutionBlocking, type FlowValidationCode } from "@src/validation/FlowValidator";

/** Planted in every name and value the product must never send. */
export const CANARY = "QX7CANARY";

const step = (id: string, type: StepType, extra: Partial<FlowStep> = {}): FlowStep => ({ id, type, name: `${type} ${CANARY} ${id}`, ...extra });
const click = (id: string) => step(id, "click", { locator: { strategy: "testId", value: `${CANARY.toLowerCase()}-${id}` } });
const edge = (id: string, source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge => ({ id, source, target, type: "success", kind: "normal", ...extra });
const conditional = (id: string, source: string, target: string, operator: string, expectedValue: string): FlowEdge =>
  edge(id, source, target, { type: "conditional", kind: "conditional", conditional: { sourceField: "outcome", operator, expectedValue } as FlowEdge["conditional"] });
const flow = (id: string, nodes: FlowStep[], edges: FlowEdge[]): FlowProfile => ({ id, name: `Orders ${CANARY} ${id}`, version: 1, nodes, edges });

export interface LabelledCase {
  id: string;
  /** The L4a families its two issues come from. */
  families: string;
  flow: FlowProfile;
  /**
   * The codes the request must send, in order, which carry an emitted fix, and which stop the run (an
   * error on the run path). Blocking issues must come first, and a ranking must put their fixes first.
   */
  sent: Array<{ code: FlowValidationCode; fixable: boolean; blocking: boolean }>;
  /** Issues the report has beyond what one request sends. */
  truncated?: number;
}

export const LABELLED_SET: readonly LabelledCase[] = Object.freeze([
  {
    // Not the L1.8 benchmark's flow: that one sends the same code twice, which no attribution can judge.
    id: "casing",
    families: "unsupported literals, both fixable by normalizeEnumCasing",
    flow: flow("casing", [step("s", "start"), click("a"), click("b"), step("e", "end")], [
      edge("e1", "s", "a"),
      conditional("e2", "a", "b", "NotEquals", "ok"),
      edge("e3", "a", "e"),
      edge("e4", "b", "e", { type: "conditional", kind: "conditional", conditional: { sourceField: "Outcome", operator: "equals", expectedValue: "ok" } as unknown as FlowEdge["conditional"] }),
      edge("e5", "b", "e")
    ]),
    sent: [
      { code: "unsupportedOperator", fixable: true, blocking: true },
      { code: "unsupportedConfiguration", fixable: true, blocking: true }
    ]
  },
  {
    id: "locator-orphan",
    families: "missing required binding, unreachable node",
    flow: flow("locator-orphan", [step("s", "start"), step("a", "click"), click("b"), click("x"), step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "b"), edge("e3", "b", "e")]),
    sent: [
      // The report lists unreachableNode first (rule order); the builder must send the blocking one first.
      { code: "missingRequiredLocator", fixable: false, blocking: true },
      { code: "unreachableNode", fixable: false, blocking: false }
    ]
  },
  {
    id: "branch",
    families: "branch pair, incomplete condition",
    flow: flow("branch", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), conditional("e2", "a", "e", "equals", "")]),
    sent: [
      { code: "incompleteBranchPair", fixable: false, blocking: true },
      { code: "incompleteCondition", fixable: false, blocking: false }
    ]
  },
  {
    id: "cycle",
    families: "unguarded cycle, connector leaving End",
    flow: flow("cycle", [step("s", "start"), click("a"), click("b"), step("e", "end")], [
      edge("e1", "s", "a"),
      edge("e2", "a", "b"),
      conditional("e3", "b", "a", "notEquals", "ok"),
      edge("e4", "b", "e"),
      edge("e5", "e", "a")
    ]),
    sent: [
      { code: "unguardedCycle", fixable: false, blocking: true },
      { code: "connectorFromEndNode", fixable: false, blocking: false }
    ]
  },
  {
    id: "values",
    families: "missing required value, incomplete value source",
    flow: flow("values", [
      step("s", "start"),
      step("a", "fill", { locator: { strategy: "testId", value: `${CANARY.toLowerCase()}-card` } }),
      step("b", "fill", { locator: { strategy: "testId", value: `${CANARY.toLowerCase()}-pin` }, valueSource: { type: "runtimeInput" } }),
      step("e", "end")
    ], [edge("e1", "s", "a"), edge("e2", "a", "b"), edge("e3", "b", "e")]),
    sent: [
      { code: "missingRequiredValue", fixable: false, blocking: true },
      { code: "incompleteValueSource", fixable: false, blocking: false }
    ]
  },
  {
    id: "duplicate-timeout",
    families: "duplicate connector id fixable by regenerateId, high timeout",
    flow: flow("duplicate-timeout", [step("s", "start"), click("a"), { ...click("b"), timeoutMs: 3_600_000 }, step("e", "end")], [
      edge("e1", "s", "a"),
      edge("e1", "a", "b"),
      edge("e3", "b", "e")
    ]),
    sent: [
      { code: "duplicateEdgeId", fixable: true, blocking: true },
      { code: "highTimeout", fixable: false, blocking: false }
    ]
  },
  {
    // Four issues, two sent. The report lists the off-path duplicate id first; the builder must send the
    // on-path operator first, and a ranking must put that fix first. Two fixes of different urgency is
    // the only way a fix ORDER has a right answer.
    id: "priority",
    families: "a blocking fix and an off-path fix, two more truncated",
    flow: flow("priority", [step("s", "start"), click("a"), click("b"), step("e", "end"), click("x"), click("y")], [
      edge("e1", "s", "a"),
      conditional("e2", "a", "b", "NotEquals", "ok"),
      edge("e3", "a", "e"),
      edge("e4", "b", "e"),
      edge("d1", "x", "y"),
      edge("d1", "y", "e")
    ]),
    sent: [
      { code: "unsupportedOperator", fixable: true, blocking: true },
      { code: "duplicateEdgeId", fixable: true, blocking: false }
    ],
    truncated: 2
  },
  {
    // Nothing here stops the run: an explanation that says the flow cannot run is wrong.
    id: "warnings",
    families: "non-blocking warnings only",
    flow: flow("warnings", [step("s", "start"), click("a"), { ...click("b"), timeoutMs: 3_600_000 }, step("e", "end")], [
      edge("e1", "s", "a"),
      conditional("e2", "a", "b", "notEquals", "ok"),
      edge("e3", "a", "e")
    ]),
    sent: [
      { code: "highTimeout", fixable: false, blocking: false },
      { code: "deadEndNode", fixable: false, blocking: false }
    ]
  },
  {
    // One issue, and the request holds neither the step nor its value: any value or name an answer
    // gives is invented.
    id: "single",
    families: "one blocking issue, nothing specific to quote",
    flow: flow("single", [step("s", "start"), { ...click("a"), timeoutMs: -1 }, step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "e")]),
    sent: [{ code: "invalidTimeout", fixable: false, blocking: true }]
  }
]);

/**
 * What an explanation of each issue has to name. One that explains an operator issue without saying
 * "operator" has not explained that issue. Written before any model output was seen, and the three
 * the benchmark packet already used are unchanged.
 */
export const SUBJECT: Readonly<Partial<Record<FlowValidationCode, RegExp>>> = Object.freeze({
  unsupportedOperator: /operator/i,
  unsupportedConfiguration: /source|setting|configur|value|field/i,
  incompleteBranchPair: /connector|branch|condition|way out/i,
  missingRequiredLocator: /locator|selector|which element|target element/i,
  unreachableNode: /reach|connect|orphan|isolat|incoming/i,
  incompleteCondition: /compar|expected|value|variable/i,
  unguardedCycle: /cycle|loop|repeat|circular|forever|infinite/i,
  connectorFromEndNode: /\bend\b|finish/i,
  missingRequiredValue: /value|text|input|fill|enter|type/i,
  incompleteValueSource: /source|key|bound|resolve/i,
  duplicateEdgeId: /duplicate|same id|share|unique|identifier|\bid\b/i,
  highTimeout: /timeout|time|wait|long|second|minute|hour/i,
  deadEndNode: /way out|dead[- ]end|outgoing|no (?:next|following|connector)|stops? there|nowhere|without reaching/i,
  invalidTimeout: /timeout|time|wait|negative|zero|positive|number/i
});

/**
 * What a corrective action for each issue acts on. "Add a locator" corrects a missing locator; "add a
 * connector" does not. Restating the rule's own summary is never actionable: none of the summaries
 * holds a verb from `CORRECTIVE`.
 */
export const REMEDY: Readonly<Partial<Record<FlowValidationCode, RegExp>>> = Object.freeze({
  unsupportedOperator: /operator|casing|spelling|lower ?case|capital|fix|repair/i,
  unsupportedConfiguration: /setting|value|literal|option|casing|spelling|source|field|lower ?case|capital|fix|repair/i,
  missingRequiredLocator: /locator|selector|element|target/i,
  unreachableNode: /connect|incoming|\bstart\b|reach|remov|delet/i,
  incompleteBranchPair: /connector|way out|branch|path|exit|fallback|default|otherwise|\belse\b|condition/i,
  incompleteCondition: /value|variable|comparison|compare|expected|path/i,
  unguardedCycle: /loop|cycle|break|exit|connector/i,
  connectorFromEndNode: /connector|\bend\b/i,
  missingRequiredValue: /value|text|input|source/i,
  incompleteValueSource: /key|source|field|name|variable/i,
  duplicateEdgeId: /\bid\b|identifier|unique|regenerat|fix|repair/i,
  highTimeout: /timeout|time|wait|limit|second|minute/i,
  deadEndNode: /connector|way out|\bend\b|next|path|continue/i,
  invalidTimeout: /timeout|time|wait|positive|number|value/i
});

/**
 * Corrections a rule contradicts, one pattern per rule whose wrong direction is unambiguous. Unlike the
 * patterns above, these were written AFTER real answers were read: each is a regression screen for a
 * correction the 97996c48 captures gave (an agent's reading, pending a person's review), generalised
 * from the rule rather than from the wording. A hit is an unsupported claim, and never actionable.
 */
export const WRONG_REMEDY: Readonly<Partial<Record<FlowValidationCode, RegExp>>> = Object.freeze({
  // The connector LEAVING End is the defect; another connector into End leaves it in place.
  connectorFromEndNode: /\b(?:add|connect|draw|create|insert)\b[^.;]{0,40}\bconnectors?\b[^.;]{0,30}\b(?:to|into|reach(?:es)?)\b[^.;]{0,15}\bend\b/i,
  // The step's type needs one: saying it is not needed or not required inverts the rule.
  missingRequiredValue: /\b(?:not|never)\b[^.;]{0,20}\b(?:need|requir)\w*[^.;]{0,20}\bvalues?\b/i,
  missingRequiredLocator: /\b(?:not|never)\b[^.;]{0,20}\b(?:need|requir)\w*[^.;]{0,20}\blocators?\b/i,
  // The emitted fix gives the duplicate a new id. Removing a connector, or an id, is a structural change no rule asks for.
  duplicateEdgeId: /\b(?:remove|delete|drop)\b[^.;]{0,25}\b(?:edges?|connectors?|connections?|ids?|identifiers?)\b/i,
  // The connector already carries its condition, and the runner is nothing the editor changes.
  incompleteBranchPair: /\badd (?:a |another |the )?condition\b|\b(?:add|set|change|configure)\b[^.;]{0,30}\b(?:to|in) the runner\b/i,
  // A timeout that is already unusually high is not corrected by raising it.
  highTimeout: /\b(?:increase|raise|extend|lengthen)\b[^.;]{0,20}\btimeouts?\b/i
});

/** A corrective verb in its base form: an instruction to the person, not a description of the problem. */
const CORRECTIVE =
  /\b(?:add|apply|attach|assign|break|change|choose|connect|convert|configure|decrease|define|delete|disconnect|drop|edit|enter|give|insert|lower|make|move|pick|provide|reconnect|reduce|regenerate|remove|rename|replace|rewrite|select|shorten|specify|supply|switch|update|use)\b|\bset (?:the|a|an|it|its|this|that|one)\b/i;

/**
 * Claims the request does not support, each one evidence an explanation is wrong:
 *  - AUTO_FIX_CLAIMED: the application can repair an issue it emitted no fix for (AI inventing a fix);
 *  - OFF_DOMAIN: a cause or remedy outside the flow (restart, network, cache, credentials, support);
 *  - FABRICATED_LITERAL: a quoted name, a selector, a URL or a value the request never held, or the
 *    corrective action given as a step's name (`ACTION_AS_NAME`);
 *  - SEVERITY_OVERSTATED: an issue that does not block the run is said to stop the flow running;
 *  - SEVERITY_UNDERSTATED: an issue that blocks the run is said to be harmless or only a warning;
 *  - WRONG_REMEDY: a correction the issue's own rule contradicts (`WRONG_REMEDY`).
 */
export type UnsupportedKind = "AUTO_FIX_CLAIMED" | "OFF_DOMAIN" | "FABRICATED_LITERAL" | "SEVERITY_OVERSTATED" | "SEVERITY_UNDERSTATED" | "WRONG_REMEDY";

const AUTO_FIX =
  /\b(?:app|application|tool|designer|editor|validator|system|awkit)\b[^.;]{0,20}\b(?:can|will|could)\b[^.;]{0,15}\b(?:fix|repair|correct|resolve|regenerate|rewrite|normalize)\b|\bapply (?:the |a |its )?(?:safe |suggested |available |automatic )?(?:fix|repair)\b|\bauto-?fix|\bone[- ]click\b|\b(?:is|marked) fixable\b|\bfix(?:ed)? (?:it |this )?automatically\b/i;
const NEGATED = /\b(?:not|no|cannot|can't|isn't|won't)\b/i;
const OFF_DOMAIN =
  /\b(?:restart|reboot|reinstall|internet|network|wi-?fi|cache|cookies?|firewall|antivirus|vpn|password|credentials?|permissions?|licen[cs]e|contact (?:support|an? admin\w*|your admin\w*|the admin\w*))\b|\bupdate (?:the |your )?(?:app|application|browser|software|driver)s?\b|\b(?:log|sign) ?in again\b/i;
const BLOCKS_RUN =
  /\b(?:flow|run|automation|execution)\b[^.;]{0,25}\b(?:cannot|can't|can not|won't|will not|unable to|is blocked from)\b[^.;]{0,15}\b(?:run|start|execute|begin)\b|\bfrom (?:running|starting|executing|being run)\b|\bbefore (?:the flow|it) can (?:run|start)\b/i;
const HARMLESS =
  /\b(?:harmless|(?:safe|okay|ok|fine) to ignore|can (?:safely )?(?:be )?ignored?|(?:only|just) a warning|not (?:a )?(?:real |serious |critical |blocking )?(?:problem|issue|error)|does(?:n't| not) matter)\b/i;
const QUOTED = /["`“”]([^"`“”]{2,})["`“”]/g;
/**
 * The corrective action given as the NAME of a step ("The step 'Add a locator to this step' is missing
 * a locator"): a step name the request never held, and no instruction. Written after the first 2026-09-23
 * capture showed it, while the request still labelled the action "Step:".
 */
const ACTION_AS_NAME = /\bstep\s+["'`“‘]?(?:add|apply|change|choose|connect|delete|fill|give|keep|lower|move|reconnect|remove|review|set)\b/i;
const NUMBER = /\b(\d+(?:[.,]\d+)*)\s*(ms|milliseconds?|s|secs?|seconds?|mins?|minutes?|h|hours?|%|px|times)?\b/gi;
const SELECTOR = /https?:\/\/|www\.|(?:^|\s)[#.][a-z][\w-]*|\[data-[\w-]+/i;

const sentencesOf = (text: string): string[] => text.split(/[.!?;]+/).filter((s) => s.trim());
/** Complete sentences only: an unfinished tail, or a fragment the product marked "…", instructs nothing. */
const completeSentencesOf = (text: string): string[] => sentencesOf(/[.!?]["')\]]?$/.test(text) ? text : text.replace(/[^.!?]*$/, ""));

/** Everything the model was given: the instructions and the Issues block, never the nonce. */
const supportedTextOf = (request: AuthoringRequest): string => [request.prompt.instructions, ...request.prompt.fields.map((f) => f.text)].join("\n");

function fabricatesLiteral(text: string, supported: string): boolean {
  if (ACTION_AS_NAME.test(text)) return true;
  const known = supported.toLowerCase();
  for (const quote of text.matchAll(QUOTED)) if (!known.includes(quote[1].trim().toLowerCase())) return true;
  for (const number of text.matchAll(NUMBER)) {
    // A small count ("2 connectors") restates "two or more"; a value or a unit is something the model was never told.
    const held = new RegExp(`(?<![\\w.,])${number[1].replace(/[.,]/g, "\\$&")}(?![\\w.,])`).test(supported);
    if (!held && (number[2] !== undefined || Number(number[1].replace(/,/g, "")) >= 3)) return true;
  }
  return SELECTOR.test(text);
}

/** The screens that hit one explanation of `ref`. */
export function unsupportedClaims(ref: AuthoringIssueRef, text: string, supported: string): UnsupportedKind[] {
  const hits: UnsupportedKind[] = [];
  if (!ref.fixable && sentencesOf(text).some((s) => AUTO_FIX.test(s) && !NEGATED.test(s))) hits.push("AUTO_FIX_CLAIMED");
  if (OFF_DOMAIN.test(text)) hits.push("OFF_DOMAIN");
  if (fabricatesLiteral(text, supported)) hits.push("FABRICATED_LITERAL");
  const blocking = isExecutionBlocking(ref.issue);
  if (!blocking && BLOCKS_RUN.test(text)) hits.push("SEVERITY_OVERSTATED");
  if (blocking && HARMLESS.test(text)) hits.push("SEVERITY_UNDERSTATED");
  if (WRONG_REMEDY[ref.issue.code]?.test(text)) hits.push("WRONG_REMEDY");
  return hits;
}

/**
 * Where one explanation lands, worst first. `defect`: misattributed or an unsupported claim.
 * `offSubject`: it never names its issue. `notActionable`: on subject, no corrective action.
 * `unverified`: every screen clear, which a lexical judge cannot turn into "correct": a person must.
 */
export type ExplanationCategory = "defect" | "offSubject" | "notActionable" | "unverified";

export interface AuthoringJudgement {
  sent: number;
  explained: number;
  /** Names its own issue's subject. */
  onSubject: number;
  /** Does not name its own issue's subject, and names another sent issue's instead. */
  misattributed: number;
  /** One sentence holds a corrective verb and its issue's remedy. */
  actionable: number;
  /** Screen hits over the answer's explanations, by kind. */
  unsupported: Partial<Record<UnsupportedKind, number>>;
  categories: Record<ExplanationCategory, number>;
  /** Codes whose explanation cleared every screen: the ones a person must still judge. */
  review: FlowValidationCode[];
  /** Each explanation's own reading, in answer order: what the review capture records beside its text. */
  perExplanation: Array<{ issueId: string; onSubject: boolean; misattributed: boolean; actionable: boolean; unsupported: UnsupportedKind[]; category: ExplanationCategory }>;
  /**
   * Whether the model's ranking puts every fix for a blocking issue before any other (the product's
   * `rankingKeepsPriority`). `false` when the product withheld it for breaking that; `null` when nothing
   * was ranked or no fix is more urgent than another, so there is nothing to order.
   */
  rankingOrderCorrect: boolean | null;
  /** The product withheld the model's order for breaking the blocking-first priority. */
  rankingWithheld: boolean;
  /** Ran into `maxExplanationChars` mid-sentence, so the product kept its complete sentences only. */
  cutByGrammar: number;
  /** Texts carrying the canary. The product never sends it, so any is a leak through the request. */
  canaryInText: number;
  residualSecrets: number;
  ranked: number;
  textChars: number[];
}

/** The judge, on an answer the product accepted. Counts and codes only. */
export function judgeAuthoringAnswer(request: AuthoringRequest, answer: AuthoringAnswer): AuthoringJudgement {
  const names = (code: FlowValidationCode, text: string) => SUBJECT[code]?.test(text) === true;
  const codes = request.issues.map((ref) => ref.issue.code);
  const supported = supportedTextOf(request);
  const byId = new Map(request.issues.map((ref) => [ref.id, ref]));
  const unsupported: Partial<Record<UnsupportedKind, number>> = {};
  const categories: Record<ExplanationCategory, number> = { defect: 0, offSubject: 0, notActionable: 0, unverified: 0 };
  const review: FlowValidationCode[] = [];
  const perExplanation: AuthoringJudgement["perExplanation"] = [];
  let onSubject = 0;
  let misattributed = 0;
  let actionable = 0;
  for (const e of answer.explanations) {
    const code = e.issue.code;
    const own = names(code, e.text);
    const other = !own && codes.some((c) => c !== code && names(c, e.text));
    const remedy = REMEDY[code];
    const hits = unsupportedClaims(byId.get(e.issueId) as AuthoringIssueRef, e.text, supported);
    // A correction its own rule contradicts is not the issue's remedy, however it is worded, and an
    // action quoted as a step's name instructs nothing.
    const acts = remedy !== undefined && !hits.includes("WRONG_REMEDY") && completeSentencesOf(e.text).some((s) => CORRECTIVE.test(s) && remedy.test(s) && !ACTION_AS_NAME.test(s));
    for (const hit of hits) unsupported[hit] = (unsupported[hit] ?? 0) + 1;
    onSubject += own ? 1 : 0;
    misattributed += other ? 1 : 0;
    actionable += acts ? 1 : 0;
    const category: ExplanationCategory = other || hits.length > 0 ? "defect" : !own ? "offSubject" : !acts ? "notActionable" : "unverified";
    categories[category] += 1;
    if (category === "unverified") review.push(code);
    perExplanation.push({ issueId: e.issueId, onSubject: own, misattributed: other, actionable: acts, unsupported: hits, category });
  }
  return {
    sent: request.issues.length,
    explained: answer.explanations.length,
    onSubject,
    misattributed,
    actionable,
    unsupported,
    categories,
    review,
    perExplanation,
    rankingOrderCorrect: answer.rankingWithheld ? false : rankingKeepsPriority(request, answer.ranking),
    rankingWithheld: answer.rankingWithheld !== undefined,
    cutByGrammar: answer.explanations.filter((e) => e.cut).length,
    canaryInText: answer.explanations.filter((e) => e.text.toUpperCase().includes(CANARY)).length,
    residualSecrets: answer.explanations.reduce((n, e) => n + findResidualSecrets(e.text).length, 0),
    ranked: answer.ranking.length,
    textChars: answer.explanations.map((e) => e.text.length)
  };
}

/**
 * The product-contract failures the live gate refuses, on one request and its answer: a refused answer,
 * a sent issue left unexplained, a canary anywhere, a residual secret. Empty when it holds.
 */
export function deliveryViolations(request: AuthoringRequest, value: unknown, promptText: string): string[] {
  const violations: string[] = [];
  if (promptText.toUpperCase().includes(CANARY)) violations.push("CANARY_IN_PROMPT");
  const answer = parseAuthoringAnswer(value, request);
  if (!answer.ok) return [...violations, `REFUSED_${answer.code}`];
  const judged = judgeAuthoringAnswer(request, answer);
  if (judged.explained !== judged.sent) violations.push("NOT_EVERY_ISSUE_EXPLAINED");
  if (judged.canaryInText > 0) violations.push("CANARY_IN_ANSWER");
  if (judged.residualSecrets > 0) violations.push("RESIDUAL_SECRET");
  return violations;
}

/**
 * The judge and the delivery check on scripted answers, so neither can pass vacuously. Returns every
 * control that did not come out as it must; empty when all hold. `request` must send two issues of
 * the `cycle` case, whose subjects do not overlap.
 */
export function authoringControlFailures(request: AuthoringRequest): string[] {
  const failures: string[] = [];
  const [a, b] = request.issues;
  if (!a || !b || a.issue.code !== "unguardedCycle" || b.issue.code !== "connectorFromEndNode") return ["the controls need the cycle case's request"];
  const onA = "Following these connectors repeats the same two steps forever, so the run stops with an error.";
  const onB = "A connector leaves the End step, and the flow finishes at End, so it never runs.";
  const answer = (texts: [string, string], extra: Record<string, unknown> = {}) => ({ version: 1, explanations: [{ issueId: a.id, text: texts[0] }, { issueId: b.id, text: texts[1] }], ...extra });
  const judge = (value: unknown) => {
    const parsed = parseAuthoringAnswer(value, request);
    return parsed.ok ? judgeAuthoringAnswer(request, parsed) : null;
  };
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };

  const good = judge(answer([onA, onB]));
  expect("a correct answer is on subject twice, misattributed never", good?.onSubject === 2 && good.misattributed === 0);
  expect("...and delivered", deliveryViolations(request, answer([onA, onB]), "prompt").length === 0);
  const swapped = judge(answer([onB, onA]));
  expect("swapped texts are misattributed twice and on subject never", swapped?.onSubject === 0 && swapped.misattributed === 2);
  const vague = judge(answer(["Please look at this part of the flow again.", "Please look at this part of the flow again, too."]));
  expect("a vague answer is on subject never and misattributed never", vague?.onSubject === 0 && vague.misattributed === 0);
  // Inside a complete sentence: an unfinished tail is dropped before delivery, so it is never shown.
  expect("a canary in an answer is refused", deliveryViolations(request, answer([`${CANARY} ${onA}`, onB]), "prompt").includes("CANARY_IN_ANSWER"));
  expect("a canary in the prompt is refused", deliveryViolations(request, answer([onA, onB]), `step ${CANARY.toLowerCase()}`).includes("CANARY_IN_PROMPT"));
  expect("one of two explained is refused", deliveryViolations(request, { version: 1, explanations: [{ issueId: a.id, text: onA }] }, "prompt").includes("NOT_EVERY_ISSUE_EXPLAINED"));
  expect("ranking an issue with no emitted fix is refused", deliveryViolations(request, answer([onA, onB], { ranking: [a.id] }), "prompt").includes("REFUSED_FIX_NOT_EMITTED"));

  // Corrective action, and the screens. onA/onB say what is wrong and nothing about what to do.
  const actA = "These connectors repeat the same two steps forever; replace one with a Loop Back connector.";
  const actB = "A connector leaves the End step and never runs; remove it, or move End after its target.";
  const hits = (value: unknown, kind: UnsupportedKind) => judge(value)?.unsupported[kind] ?? 0;
  expect("a problem stated without a remedy is on subject and not actionable, twice", good?.actionable === 0 && good.categories.notActionable === 2 && Object.keys(good.unsupported).length === 0);
  const acted = judge(answer([actA, actB]));
  expect("an answer that names the remedy is actionable twice, clears every screen and goes to review", acted?.actionable === 2 && acted.categories.unverified === 2 && acted.review.length === 2 && Object.keys(acted.unsupported).length === 0);
  expect("the wrong remedy is not actionable", judge(answer(["These connectors repeat the same two steps forever; add a locator to the step.", actB]))?.actionable === 1);
  expect("claiming the application fixes an issue it emitted no fix for is unsupported", hits(answer([`${actA} The application can fix this automatically.`, actB]), "AUTO_FIX_CLAIMED") === 1);
  expect("...and saying it cannot be fixed automatically is not", hits(answer([`${actA} It cannot be fixed automatically.`, actB]), "AUTO_FIX_CLAIMED") === 0);
  expect("a remedy outside the flow is unsupported", hits(answer(["These steps repeat forever; restart the application and clear the cache.", actB]), "OFF_DOMAIN") === 1);
  expect("a quoted name the request never held is fabricated", hits(answer(['These steps repeat forever; remove the "Retry" connector.', actB]), "FABRICATED_LITERAL") === 1);
  expect("a value the request never held is fabricated", hits(answer(["These steps repeat forever; add a Loop Back connector that stops after 30 tries.", actB]), "FABRICATED_LITERAL") === 1);
  expect("...but quoting the request's own words is not", hits(answer(['These steps repeat forever; add a "Loop Back" connector.', actB]), "FABRICATED_LITERAL") === 0);
  const flowCannotRun = "so the flow cannot run";
  expect("saying a warning stops the flow running overstates it", hits(answer([actA, `A connector leaves End, ${flowCannotRun}; remove it.`]), "SEVERITY_OVERSTATED") === 1);
  expect("...and the same claim about a blocking error does not", hits(answer([`These connectors repeat forever, ${flowCannotRun}; add a Loop Back connector.`, actB]), "SEVERITY_OVERSTATED") === 0);
  const onlyWarning = "but this is only a warning and can be ignored";
  expect("calling a blocking error harmless understates it", hits(answer([`The steps repeat in a loop, ${onlyWarning}.`, actB]), "SEVERITY_UNDERSTATED") === 1);
  expect("...and calling a warning a warning does not", hits(answer([actA, `A connector leaves End, ${onlyWarning}.`]), "SEVERITY_UNDERSTATED") === 0);
  const flagged = judge(answer([`${actA} The application can fix this automatically.`, actB]));
  expect("an unsupported claim makes an otherwise good explanation a defect, never one for review", flagged?.categories.defect === 1 && flagged.categories.unverified === 1 && flagged.review.length === 1);
  expect("a swapped answer is a defect twice", swapped?.categories.defect === 2);
  expect("a vague answer is off subject twice", vague?.categories.offSubject === 2);
  expect("nothing fixable: no ranking order to judge", good?.rankingOrderCorrect === null);
  return failures;
}

/**
 * The ranking-order judge on scripted answers. `request` must be the `priority` case's: a fix for a
 * blocking issue (`i0`) and a fix for one off the run path (`i1`).
 */
export function rankingControlFailures(request: AuthoringRequest): string[] {
  const failures: string[] = [];
  const [a, b] = request.issues;
  if (!a || !b || request.fixableIds.length !== 2 || !isExecutionBlocking(a.issue) || isExecutionBlocking(b.issue)) return ["the controls need the priority case's request"];
  const texts = [
    { issueId: a.id, text: "The condition's operator is not a known one; change its casing to a listed operator." },
    { issueId: b.id, text: "Two connectors share one id; give the duplicate a unique id." }
  ];
  const judge = (ranking: string[] | undefined, extra = "") => {
    const value = { version: 1, explanations: [texts[0], { ...texts[1], text: `${texts[1].text}${extra}` }], ...(ranking ? { ranking } : {}) };
    const parsed = parseAuthoringAnswer(value, request);
    return parsed.ok ? judgeAuthoringAnswer(request, parsed) : null;
  };
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };
  expect("the blocking fix first is in order", judge([a.id, b.id])?.rankingOrderCorrect === true);
  expect("the blocking fix alone is in order", judge([a.id])?.rankingOrderCorrect === true);
  expect("the off-path fix first is out of order, and the product withholds it", judge([b.id, a.id])?.rankingOrderCorrect === false && judge([b.id, a.id])?.rankingWithheld === true && judge([b.id, a.id])?.ranked === 0);
  expect("the off-path fix alone, the blocking one left out, is out of order and withheld", judge([b.id])?.rankingOrderCorrect === false && judge([b.id])?.rankingWithheld === true);
  expect("an order in priority is shown whole", judge([a.id, b.id])?.rankingWithheld === false && judge([a.id, b.id])?.ranked === 2);
  expect("no ranking has no order to judge, and nothing is withheld", judge(undefined)?.rankingOrderCorrect === null && judge(undefined)?.rankingWithheld === false);
  expect("both texts clear every screen and are actionable", judge([a.id, b.id])?.categories.unverified === 2);
  expect("saying the application fixes an issue it DID emit a fix for is supported", judge(undefined, " The application can fix this automatically.")?.unsupported.AUTO_FIX_CLAIMED === undefined);
  return failures;
}

/**
 * The corrections the 97996c48 captures got wrong, replayed as scripted answers the judge must refuse to
 * count, each beside a correct twin: incorrect (a connector into End, the value rule inverted), irrelevant
 * (a condition added "to the runner"), unsupported (a connector removed for a duplicate id) and truncated
 * (the step cut off by the character limit). `requestFor` builds a labelled case's request; the
 * texts are the captured answers, ended with a full stop where the capture was cut so that the screen,
 * not the product's trim, is what each one tests, and every one goes through the product's parser first.
 */
export function correctiveControlFailures(requestFor: (caseId: string) => AuthoringRequest | undefined): string[] {
  const failures: string[] = [];
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };
  /** The judge's reading of `texts` as one answer to `caseId`, after the product parsed it. */
  const read = (caseId: string, texts: string[]) => {
    const request = requestFor(caseId);
    if (!request || request.issues.length !== texts.length) return null;
    const parsed = parseAuthoringAnswer({ version: 1, explanations: request.issues.map((ref, i) => ({ issueId: ref.id, text: texts[i] })) }, request);
    return parsed.ok ? { answer: parsed, judged: judgeAuthoringAnswer(request, parsed) } : null;
  };
  const wrong = (reading: ReturnType<typeof read>, index: number) => {
    const p = reading?.judged.perExplanation[index];
    return p !== undefined && !p.actionable && p.category === "defect" && p.unsupported.includes("WRONG_REMEDY");
  };
  const good = (reading: ReturnType<typeof read>, index: number) => {
    const p = reading?.judged.perExplanation[index];
    return p !== undefined && p.actionable && p.category === "unverified";
  };

  const endAnswer = read("cycle", ["Add a Loop Back connector to break the cycle.", "The flow finishes at an End node, so it never runs. The person should add a connector that connects to an End node to ensure the flow runs."]);
  expect("incorrect: a connector INTO End for one leaving it is a wrong remedy, never actionable", wrong(endAnswer, 1));
  expect("...and removing the connector that leaves End is actionable", good(read("cycle", ["Add a Loop Back connector to break the cycle.", "The flow finishes at an End node, so it never runs. The person should remove the connector that leaves the End node."]), 1));

  const inverted = "The automation flow requires a value at a node on the run path, but the step type does not specify a required value, causing the validation to fail.";
  const valueAnswer = read("values", [inverted, "Set the missing key this value source reads."]);
  expect("incorrect: the value rule inverted is a wrong remedy, never actionable (the old proxy counted it)", wrong(valueAnswer, 0));
  expect("...and the correct reading, 'has no value, and its type needs one', is not", good(read("values", ["Set the value this step needs. The step has no value, and its type needs one.", "Set the missing key this value source reads."]), 0));

  // Captured at exactly 160 characters; "The person should" goes so that the full stop fits.
  const branch = "The runner ignores the condition or runs the branch twice because the conditional connector is its only way out. Add a condition to the runner.";
  expect("irrelevant: adding a condition 'to the runner' for a lone conditional connector is a wrong remedy", wrong(read("branch", [branch, "Set the comparison value for the condition."]), 0));
  expect("...and adding the matching branch is actionable", good(read("branch", ["Add the matching branch or a fallback connector from the same step. The conditional connector is its only way out.", "Set the comparison value for the condition."]), 0));

  const removeEdge = "Two or more connectors share one id, causing a duplicate edge error. The person should remove the duplicate edge or regenerate the id for the connector.";
  expect("unsupported: removing a connector for a duplicate id is a wrong remedy", wrong(read("priority", ["Change the operator's casing to a listed operator.", removeEdge]), 1));
  expect("...as is removing 'the duplicate edge ID'", wrong(read("priority", ["Change the operator's casing to a listed operator.", "The duplicate edge ID means two connectors share the same identifier. The person should remove the duplicate edge ID from the connector list."]), 1));
  expect("...and regenerating the duplicate's id is actionable", good(read("priority", ["Change the operator's casing to a listed operator.", "Regenerate the id of the duplicate connector. Two connectors share one id."]), 1));

  // The corrective action read as a step's NAME (first 2026-09-23 capture, when the line said "Step:").
  const named = (caseId: string, texts: string[], index: number) => {
    const p = read(caseId, texts)?.judged.perExplanation[index];
    return p !== undefined && !p.actionable && p.category === "defect" && p.unsupported.includes("FABRICATED_LITERAL");
  };
  expect("misread: the action quoted as a step's name is a fabricated name, never actionable", named("locator-orphan", ["The step 'Add a locator to this step' is missing a locator, which is required to know which element to act on.", "Connect this step from a step that runs."], 0));
  expect("...unquoted too", named("values", ["The step Set the value this step needs in its settings, or bind a value source to it, has no value, and its type needs one.", "Set the missing key this value source reads."], 0));

  // Truncated: the step came after the explanation and the limit cut it. The product keeps the complete
  // sentence, and a sentence with no step is not actionable; a lone fragment is marked and never counts.
  const cut = read("cycle", ["The automation flow has a cycle where the connector stops the run, causing a runtime-cycle error. The person should add a Loop Back connector to ensure the flow", "Remove the connector that leaves the End node."]);
  expect("truncated: a step cut off mid-sentence is dropped by the product, not shown half-said", cut?.answer.explanations[0].text === "The automation flow has a cycle where the connector stops the run, causing a runtime-cycle error." && cut.answer.explanations[0].cut === true);
  expect("...so it is not actionable", cut?.judged.perExplanation[0].actionable === false && cut.judged.cutByGrammar === 1);
  const fragment = read("cycle", ["The person should add a Loop Back connector to break the cycle so that the flow", "Remove the connector that leaves the End node."]);
  expect("truncated: a lone fragment is marked with an ellipsis and is not actionable", fragment?.answer.explanations[0].text.endsWith("…") === true && fragment.judged.perExplanation[0].actionable === false);
  const stepFirst = read("cycle", ["Add a Loop Back connector to break the cycle. The connectors repeat the same steps and the run stops with a runtime-cy", "Remove the connector that leaves the End node."]);
  expect("...while a step given first survives the limit and is actionable", stepFirst?.answer.explanations[0].text === "Add a Loop Back connector to break the cycle." && good(stepFirst, 0));

  // The product's own step, as the model's whole text, is the answer the request asks for: it must be
  // judged actionable and clear every screen, including the one above, for every labelled code.
  for (const labelled of LABELLED_SET) {
    const request = requestFor(labelled.id);
    const reading = request ? read(labelled.id, request.issues.map((ref) => ref.step)) : null;
    expect(`${labelled.id}: the product's steps, restated, are actionable and screen-clear`, reading !== null && reading.judged.perExplanation.every((p) => p.actionable && p.category === "unverified"));
  }
  return failures;
}
