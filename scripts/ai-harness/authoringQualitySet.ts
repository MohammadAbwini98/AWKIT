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

import { ACTION_AS_NAME, makesCausalClaim, sentencesOf, supportedTextOf, unsupportedClaims, withholdReasons, type ExplanationWithholdReason, type UnsupportedKind } from "@src/ai/authoringClaimScreen";
import { AUTHORING_LIMITS, buildAuthoringRequest, parseAuthoringAnswer, rankingKeepsPriority, type AuthoringAnswer, type AuthoringIssueRef, type AuthoringRequest } from "@src/ai/authoringExplanation";
import type { FlowEdge, FlowProfile, FlowStep, StepType } from "@src/profiles/FlowProfile";
import { findResidualSecrets } from "@src/semantic/SemanticPolicyValidator";
import { FLOW_VALIDATION_RULES, isExecutionBlocking, type FlowValidationCode } from "@src/validation/FlowValidator";

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
  invalidTimeout: /timeout|time|wait|negative|zero|positive|number/i,
  // The held-out set's three codes the labelled set never sends (L4b DX revision 2, 2026-09-26). Written from each
  // rule's summary and the product's corrective step, before any revision-2 output and without reading a
  // held-out text. The flow reference names ANOTHER flow, never "the flow" every answer is about.
  missingFlowReference: /\brun[ -]another[ -]flow\b|\b(?:another|other|saved|referenced|targeted|target|called|child|sub)[ -]?flows?\b|\bflows?\b[^.;]{0,40}\b(?:does(?:n't| not) exist|no longer exists?|not found|was deleted)\b|\breferenc/i,
  connectorStructure: /connector|connection|\bedges?\b|\blinks?\b|structur/i,
  invalidLoopBounds: /\bloop|iteration|\bbounds?\b|\blimit|\b1000\b|repeat/i
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
  invalidTimeout: /timeout|time|wait|positive|number|value/i,
  // As SUBJECT's three above: from the product's step ("Choose a saved flow…", "Change or remove the connector…",
  // "Set the loop's iteration limit to a number from 1 to 1000"), before any revision-2 output.
  missingFlowReference: /\bflows?\b|referenc|target/i,
  connectorStructure: /connector|connection|\bedges?\b|\blinks?\b/i,
  invalidLoopBounds: /\bloop|iteration|\blimit|\bbounds?\b|\bnumber\b|\bcount\b|\b1000\b/i
});

/**
 * The unsupported-claim screens (`unsupportedClaims`, `WRONG_REMEDY`, `makesCausalClaim`) moved into the
 * product on 2026-09-25 with R4, unchanged, so the Flow Designer's display gate and this judge read ONE set
 * of rules: `src/ai/authoringClaimScreen.ts`. They are re-exported here for the harness's callers.
 */
export { WRONG_REMEDY, makesCausalClaim, unsupportedClaims, type UnsupportedKind } from "@src/ai/authoringClaimScreen";

/** A corrective verb in its base form: an instruction to the person, not a description of the problem. */
const CORRECTIVE =
  /\b(?:add|apply|attach|assign|break|change|choose|connect|convert|configure|decrease|define|delete|disconnect|drop|edit|enter|give|insert|lower|make|move|pick|provide|reconnect|reduce|regenerate|remove|rename|replace|rewrite|select|shorten|specify|supply|switch|update|use)\b|\bset (?:the|a|an|it|its|this|that|one)\b/i;

/** Complete sentences only: an unfinished tail, or a fragment the product marked "…", instructs nothing. */
const completeSentencesOf = (text: string): string[] => sentencesOf(/[.!?]["')\]]?$/.test(text) ? text : text.replace(/[^.!?]*$/, ""));

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
  /**
   * Explanations the product's display gate withheld (R4): accepted, never shown, and never counted by the
   * target as a successful AI explanation. The readings above still cover them, as a record of the model.
   */
  displayWithheld: number;
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
    displayWithheld: answer.explanations.filter((e) => e.withheld).length,
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

  // The ddcfc35b captures (2026-09-23): the task sentence echoed as the cause, and no action. The corrective
  // task sentence measured and reverted the same day must not let its echo pass for one either: "correct"
  // alone instructs nothing.
  const leaveEnd = "Remove this connector from the End step.";
  const becauseCycle = "The automation flow failed validation because connectors form a cycle with no Loop Back connector, causing a runtime-cycle error.";
  const becauseReading = read("cycle", [becauseCycle, leaveEnd])?.judged.perExplanation[0];
  expect("echoed: the task sentence given back as the cause is on subject and not actionable", becauseReading?.onSubject === true && becauseReading.category === "notActionable");
  const echoOnly = read("cycle", ["To correct this validation issue, note that connectors form a cycle with no Loop Back connector.", leaveEnd])?.judged.perExplanation[0];
  expect("...as is a corrective task sentence echoed with no action", echoOnly?.onSubject === true && echoOnly.category === "notActionable");
  expect("...and that echo leading into the action is actionable", good(read("cycle", ["To correct this validation issue, change the connector that closes this cycle to a Loop Back connector with a maximum count.", leaveEnd]), 0));
  const becauseCut = read("warnings", ["Lower this step's timeout unless the step really needs to wait that long.", "The automation flow failed validation because a reachable step had no way out, causing the run to stop at that node and report success without reaching the End"]);
  expect("echoed and cut by the limit: a lone fragment, not actionable", becauseCut?.answer.explanations[1].text.endsWith("…") === true && becauseCut.judged.perExplanation[1].actionable === false);
  // The line's rule code copied as the whole text (the id is followed by it in the Issues line).
  const bare = read("casing", ["unsupportedOperator", "unsupportedConfiguration"]);
  expect("a bare rule code is a marked fragment, never actionable", bare !== null && bare.answer.explanations.every((e) => e.text.endsWith("…")) && bare.judged.actionable === 0);
  // Summary then action runs past the limit for this rule, so the product trims the action away.
  const sourceSummary = "A bound value source is missing the key it reads; it resolves to an empty value or fails the run.";
  const sourceStep = requestFor("values")?.issues[1]?.step ?? "";
  const summaryFirst = read("values", ["Set the value this step needs.", `${sourceSummary} Action: ${sourceStep}`.slice(0, AUTHORING_LIMITS.maxExplanationChars)]);
  expect("summary then action past the limit: the action is trimmed away, marked cut, not actionable", summaryFirst?.answer.explanations[1].text === sourceSummary && summaryFirst.answer.explanations[1].cut === true && !summaryFirst.judged.perExplanation[1].actionable);
  expect("...while the action first survives the same limit", good(read("values", ["Set the value this step needs.", `${sourceStep} ${sourceSummary}`.slice(0, AUTHORING_LIMITS.maxExplanationChars)]), 1));

  // The product's own step, as the model's whole text, is the answer the request asks for: it must be
  // judged actionable and clear every screen, including the one above, for every labelled code.
  for (const labelled of LABELLED_SET) {
    const request = requestFor(labelled.id);
    const reading = request ? read(labelled.id, request.issues.map((ref) => ref.step)) : null;
    expect(`${labelled.id}: the product's steps, restated, are actionable and screen-clear`, reading !== null && reading.judged.perExplanation.every((p) => p.actionable && p.category === "unverified"));
  }
  return failures;
}

/**
 * The fabricated-literal screen in every quotation style. Run 2 of the corrective task sentence measured at
 * d2f9721f (2026-09-23) gave "Correct the operator casing to 'operator'." and "…to 'true'.": values the
 * request never held, read as not actionable and never as defects, so neither would reach a person. Each is
 * replayed verbatim, then double-quoted, curly-quoted, back-quoted, escaped and unquoted, beside the
 * request's own words quoted the same ways (rule text, issue ids, the given action), which must stay clear.
 */
export function literalControlFailures(requestFor: (caseId: string) => AuthoringRequest | undefined): string[] {
  const failures: string[] = [];
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };
  const readings = (caseId: string, texts: string[]) => {
    const request = requestFor(caseId);
    if (!request || request.issues.length !== texts.length) return [];
    const parsed = parseAuthoringAnswer({ version: 1, explanations: request.issues.map((ref, i) => ({ issueId: ref.id, text: texts[i] })) }, request);
    return parsed.ok ? judgeAuthoringAnswer(request, parsed).perExplanation : [];
  };
  const invented = (caseId: string, texts: string[]) => {
    const read = readings(caseId, texts);
    return read.length === texts.length && read.every((p) => p.category === "defect" && p.unsupported.includes("FABRICATED_LITERAL"));
  };
  const clear = (caseId: string, texts: string[]) => {
    const read = readings(caseId, texts);
    return read.length === texts.length && read.every((p) => p.unsupported.length === 0);
  };
  const op = (value: string) => `The operator casing is incorrect. Action: Correct the operator casing to ${value}.`;
  const setting = (value: string) => `The configuration value is outside its permitted set. Action: Correct the configuration value to ${value}.`;

  expect("reported: 'operator' and 'true', single-quoted as captured, are invented values", invented("casing", [op("'operator'"), setting("'true'")]));
  expect("...double-quoted too", invented("casing", [op('"operator"'), setting('"true"')]));
  expect("...curly-quoted", invented("casing", [op("‘operator’"), setting("“true”")]));
  expect("...back-quoted", invented("casing", [op("`operator`"), setting("`true`")]));
  expect("...with escaped quotation marks", invented("casing", [op("\\'operator\\'"), setting('\\"true\\"')]));
  expect("...and unquoted, where the value is a literal: a boolean, an operator name", invented("casing", ["The operator casing is incorrect. Change the operator to notEquals.", setting("true")]));
  // This request holds "unsupported" and "supported" only inside the rule codes, never as a word or a name.
  expect("a quoted name the request holds only inside a longer word is invented", invented("casing", ['Remove the "Unsupported" connector.', 'Rename the "Supported" step.']));

  const step = (caseId: string, index: number) => requestFor(caseId)?.issues[index]?.step ?? "";
  expect("the request's own rule code stays clear when quoted", clear("single", ["The timeout value is zero, negative, or not a finite number, which violates the validation rule for the 'invalidTimeout' rule."]));
  expect("an omitted location is no longer supported when quoted", invented("single", ["The timeout value is zero, negative, or not a finite number, which violates the validation rule for the 'on the run path' node."]));
  expect("...as do an issue id and its rule code", clear("casing", ["Issue 'i0' is 'unsupportedOperator': the condition's operator is not a known one.", step("casing", 1)]));
  expect("...and the given action's own target, quoted as a value", clear("casing", ["Review and apply the offered safe fix, which corrects the operator's casing to 'a listed value'.", step("casing", 1)]) && clear("cycle", ["Change the connector that closes this cycle to “Loop Back”.", "Remove this connector from the End step."]));
  expect("...and escaped quotation marks around them", clear("cycle", ['Add a \\"Loop Back\\" connector to break the cycle.', "Remove this connector from the End step."]));
  expect("apostrophes, straight and curly, are never quotation marks", clear("cycle", ["Change this cycle's closing connector to a Loop Back connector, so the steps' loop and the connector’s count end it.", "Remove this connector from the End step’s outgoing connectors."]));
  return failures;
}

/**
 * The seven displayed answers the 2026-09-25 AI evaluation found making a claim the evidence does not support
 * (docs/plans/ai-upgrade-v5/evidence/L4b-ai-technical-evaluation-2026-09-25.md), each replayed verbatim as the
 * Flow Designer showed it: a non-blocking issue given as the reason "the automation flow failed validation",
 * two of them with an invented "first step". Every one read `notActionable` and screen-clear, so none reached
 * a person. Each must now be a defect, and each is a causal claim a person must read. Beside them, twins that
 * must stay clear of the screen they test: the same echo on the blocking error it is true of, the claim
 * denied, and the request's own blocking words (R2).
 */
export function causalClaimControlFailures(requestFor: (caseId: string) => AuthoringRequest | undefined): string[] {
  const failures: string[] = [];
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };
  /**
   * `text` exactly as displayed, as the answer to issue `index` of `caseId`, beside the product's own action
   * for any other issue. Judged as the review store re-reads a capture: the shown text, not re-trimmed.
   */
  const reading = (caseId: string, index: number, text: string) => {
    const request = requestFor(caseId);
    if (!request?.issues[index]) return undefined;
    const answer: AuthoringAnswer = {
      ok: true,
      explanations: request.issues.map((ref, i) => ({ issueId: ref.id, issue: ref.issue, step: ref.step, text: i === index ? text : ref.step, ...(i === index && text.endsWith("…") ? { cut: true as const } : {}) })),
      ranking: []
    };
    return judgeAuthoringAnswer(request, answer).perExplanation[index];
  };
  const firstStep = "The automation flow failed validation because the timeout for the first step was set to an unusually high value, causing the flow to fail validation before the…";
  const CAPTURED = [
    { item: "adbc14/cycle/i1", caseId: "cycle", index: 1, position: false, text: "The automation flow failed validation because a connector leaves an End node, causing the flow to finish at End and never run." },
    { item: "992ea9/warnings/i0", caseId: "warnings", index: 0, position: true, text: firstStep },
    { item: "992ea9/warnings/i1", caseId: "warnings", index: 1, position: false, text: "The automation flow failed validation because a reachable step had no way out, causing the run to stop at that node and report success without reaching the End…" },
    { item: "f36c94/branch/i1", caseId: "branch", index: 1, position: false, text: "The automation flow failed validation because the condition needs a comparison value or a variable path that is not set, causing the runner to fail validation…" },
    { item: "f36c94/cycle/i1", caseId: "cycle", index: 1, position: false, text: "The automation flow failed validation because a connector leaves an End node, so the flow finishes at End and never runs." },
    { item: "840178/warnings/i0", caseId: "warnings", index: 0, position: true, text: firstStep },
    { item: "840178/warnings/i1", caseId: "warnings", index: 1, position: false, text: "The automation flow failed validation because a reachable step has no way out, causing the run to stop at that node and report success without reaching the End…" }
  ];
  for (const c of CAPTURED) {
    const p = reading(c.caseId, c.index, c.text);
    const blocking = requestFor(c.caseId)?.issues[c.index] ? isExecutionBlocking(requestFor(c.caseId)!.issues[c.index].issue) : true;
    expect(`${c.item}: (precondition) its issue does not block the run`, !blocking);
    expect(`${c.item}: a validation failure given to a non-blocking issue is overstated, so the answer is a defect`, p?.category === "defect" && p.unsupported.includes("SEVERITY_OVERSTATED") && !p.actionable);
    if (c.position) expect(`${c.item}: "the first step" is a position the request never gave`, p?.unsupported.includes("FABRICATED_LITERAL") === true);
    expect(`${c.item}: a causal claim, which a person must read`, makesCausalClaim(c.text));
  }

  // The same echo on the blocking error it is true of: a causal claim for a person, and no severity screen hit.
  const echoes = [
    { item: "adbc14/cycle/i0", caseId: "cycle", text: "The automation flow failed validation because connectors form a cycle with no Loop Back connector, causing a runtime-cycle error." },
    { item: "840178/single/i0", caseId: "single", text: "The automation flow failed validation because the timeout value is zero, negative, or not a finite number. The rule code is invalidTimeout." }
  ];
  for (const e of echoes) {
    const p = reading(e.caseId, 0, e.text);
    expect(`${e.item}: the echo on a blocking error is not overstated, and stays notActionable`, p?.category === "notActionable" && p.unsupported.length === 0);
    expect(`${e.item}: ...and is still a causal claim a person must read`, makesCausalClaim(e.text));
  }
  const lower = "Lower this step's timeout unless the step really needs to wait that long.";
  const clearOf = (caseId: string, index: number, text: string) => reading(caseId, index, text)?.category === "unverified";
  const hitBy = (caseId: string, index: number, text: string, kind: UnsupportedKind) => reading(caseId, index, text)?.unsupported.includes(kind) === true;
  expect("a validation failure denied on the claim itself is not overstated", clearOf("warnings", 0, `This warning does not fail validation. ${lower}`) && clearOf("warnings", 0, `Validation did not fail on this warning. ${lower}`));
  expect("...while a negation elsewhere in the sentence ('had no way out') excuses nothing", hitBy("warnings", 1, "The flow failed validation because this step has no way out.", "SEVERITY_OVERSTATED"));
  expect("the failure form is read in either order: 'validation fails because…'", hitBy("warnings", 0, `Validation fails because this timeout is high. ${lower}`, "SEVERITY_OVERSTATED"));
  // R2's words. The request now says of each issue whether it blocks the run; saying the opposite is a severity claim.
  expect("a non-blocking issue said to block the run is overstated", hitBy("warnings", 0, `This timeout blocks the run. ${lower}`, "SEVERITY_OVERSTATED"));
  expect("...and one said not to block it is clear", clearOf("warnings", 0, `This warning does not block the run. ${lower}`));
  const positive = "Set this step's timeout to a positive number of milliseconds.";
  expect("a blocking issue said not to block the run is understated", hitBy("single", 0, `This timeout does not block the run. ${positive}`, "SEVERITY_UNDERSTATED") && hitBy("single", 0, `This timeout doesn't block the run. ${positive}`, "SEVERITY_UNDERSTATED"));
  expect("...and one said to block it is clear", clearOf("single", 0, `This timeout blocks the run. ${positive}`));
  // A position the request never gives, however it is written, whatever the issue's severity.
  expect("a numbered step is a position the request never gave", hitBy("warnings", 0, "Lower the timeout of step 2 unless it really needs to wait that long.", "FABRICATED_LITERAL"));
  expect("...as is an ordinal on a blocking issue", hitBy("single", 0, "Set the first step's timeout to a positive number of milliseconds.", "FABRICATED_LITERAL"));
  expect("'this step' and 'the next step', the request's own words, are no position", clearOf("warnings", 1, "Add an outgoing connector from this step to the next step or to an End step."));
  // The first live run after R2 (capture 78eafe, 2026-09-25): the issue's id given as the step it is at. Not causal,
  // so R1's reading rule missed it too; it is a location the request never gave.
  expect("78eafe/single/i0: an issue id given as a step ('at step i0') is a position the request never gave", hitBy("single", 0, "The validation found an issue in the automation flow at step i0. The rule code is 'invalidTimeout'.", "FABRICATED_LITERAL"));
  expect("...while the issue id named as the issue is not", !hitBy("single", 0, `Issue i0 is an invalid timeout. ${positive}`, "FABRICATED_LITERAL"));
  expect("a purpose ('so that it knows') is not a causal claim, and an answer without one is not", !makesCausalClaim("Add a locator to this step so that it knows which element to act on.") && !makesCausalClaim(lower));
  return failures;
}

/**
 * The 34 answers the Flow Designer displayed in the two complete runs after R1 and R2 (captures 3bc349 and
 * f409c9, then 6155eb and 78eafe, 2026-09-25), verbatim as displayed, numbered as in
 * docs/plans/ai-upgrade-v5/evidence/L4b-ai-technical-evaluation-2026-09-25-after-R1-R2.md. `unsupported` is that
 * evaluation's finding: an AI reading, not a person's verdict. `withheld` is what R4 was proposed to decide,
 * written from that document's measurement before the gate existed: the 8 unsupported answers, and the correct
 * restatements #22 and #33, whose causes the gate cannot tell from invented ones.
 */
export const R2_DISPLAYED_ANSWERS: ReadonlyArray<{ n: number; run: 1 | 2; caseId: string; index: number; text: string; unsupported: boolean; withheld: boolean }> = Object.freeze(
  (
    [
      [1, 1, "casing", 0, "The operator is not a known operator. Action: Review and apply the offered safe fix, which corrects the operator's casing to a listed value.", false, false],
      [2, 1, "casing", 1, "A configuration literal is outside its permitted set. Action: Review and apply the offered safe fix, which corrects this setting's casing to a listed value.", false, false],
      [3, 1, "locator-orphan", 0, "The step has no locator, and its type needs one. Action: Add a locator to this step so that it knows which element to act on.", false, false],
      [4, 1, "locator-orphan", 1, "Node cannot be reached from Start. Action: Connect this step from a step that runs, or delete it if it is not needed.", false, false],
      [5, 1, "branch", 0, "The conditional connector is the only way out of the step, so the runner ignores the condition and runs the branch twice.", true, true],
      [6, 1, "branch", 1, "The condition needs a comparison value or a variable path that is not set. Action: Set the condition's comparison value, or the variable path it reads.", false, false],
      [7, 1, "cycle", 0, "The connector that closes the cycle is not a Loop Back connector, so the flow stops at the end of the run path.", true, true],
      [8, 1, "cycle", 1, "The connector leaves an End node, so the flow finishes at End and never runs.", true, true],
      [9, 1, "values", 0, "The step has no value, and its type needs one. Action: Set the value this step needs in its settings, or bind a value source to it.", false, false],
      [10, 1, "values", 1, "A bound value source is missing the key it reads; it resolves to an empty value or fails the run.", false, false],
      [11, 1, "duplicate-timeout", 0, "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id.", false, false],
      [12, 1, "duplicate-timeout", 1, "highTimeout (warning, does not block the run, on the run path, at a node) — Timeout is unusually high.", false, false],
      [13, 1, "priority", 0, "The operator is not a known operator. Action: Review and apply the offered safe fix, which corrects the operator's casing to a listed value.", false, false],
      [14, 1, "priority", 1, "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id.", false, false],
      [15, 1, "warnings", 0, "The step has a high timeout that does not block the run, which is flagged as a warning on the run path at a node. This is a highTimeout issue.", false, false],
      [16, 1, "warnings", 1, "A reachable step has no way out; the run stops there and reports success without reaching End. This is a deadEndNode issue.", false, false],
      [17, 1, "single", 0, "The validation error indicates that the timeout value is zero, negative, or not a finite number, which causes the step to fail immediately.", true, true],
      [18, 2, "casing", 0, "unsupportedOperator…", false, false],
      [19, 2, "casing", 1, "unsupportedConfiguration…", false, false],
      [20, 2, "locator-orphan", 0, "The step has no locator, and its type needs one. Action: Add a locator to this step so that it knows which element to act on.", false, false],
      [21, 2, "locator-orphan", 1, "Node cannot be reached from Start. Action: Connect this step from a step that runs, or delete it if it is not needed.", false, false],
      [22, 2, "branch", 0, "The conditional connector is missing a matching branch or fallback connector from the same step, causing the runner to ignore the condition and run the branch…", false, true],
      [23, 2, "branch", 1, "The condition's comparison value or variable path is not set, which causes the condition to fail and not block the run…", true, true],
      [24, 2, "cycle", 0, "The connector that closes the cycle is not a Loop Back connector, so the flow stops at the end of the run path. This causes a runtime-cycle error.", true, true],
      [25, 2, "cycle", 1, "The connector leaves an End node, so the flow finishes at the End step and never runs.", true, true],
      [26, 2, "values", 0, "The step has no value, and its type needs one. Action: Set the value this step needs in its settings, or bind a value source to it.", false, false],
      [27, 2, "values", 1, "A bound value source is missing the key it reads; it resolves to an empty value or fails the run.", false, false],
      [28, 2, "duplicate-timeout", 0, "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id.", false, false],
      [29, 2, "duplicate-timeout", 1, "Timeout is unusually high. Action: Lower this step's timeout unless the step really needs to wait that long.", false, false],
      [30, 2, "priority", 0, "The operator is not a known operator. Action: Review and apply the offered safe fix, which corrects the operator's casing to a listed value.", false, false],
      [31, 2, "priority", 1, "Two or more connectors share one id. Action: Review and apply the offered safe fix, which gives this connector a new id.", false, false],
      [32, 2, "warnings", 0, "The step has a high timeout that is not blocking the run, but the rule indicates it should be lowered unless the step truly needs to wait that long.", false, false],
      [33, 2, "warnings", 1, "The step is a dead end node because a reachable step has no way out, causing the run to stop at that node and report success without reaching the End.", false, true],
      [34, 2, "single", 0, "The validation found an issue in the automation flow at step i0. The rule code is 'invalidTimeout'.", true, true]
    ] as const
  ).map(([n, run, caseId, index, text, unsupported, withheld]) => ({ n, run, caseId, index, text, unsupported, withheld }))
);

/**
 * The subject and remedy rules of the held-out set's three codes the labelled set never sends (L4b DX revision 2), on
 * scripted answers through the product's own request builder and parser. Each rule reads a relevant explanation on
 * subject, actionable and screen-clear; an irrelevant one off subject; a fabricated one a defect. And "the automation
 * flow", which every explanation says, is never the flow reference's subject.
 */
export function heldOutCodeControlFailures(): string[] {
  const failures: string[] = [];
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };
  const read = (code: FlowValidationCode, anchor: { nodeId?: string; edgeId?: string }, text: string) => {
    const flowId = "held-out-code-controls";
    const request = buildAuthoringRequest({
      flowId,
      issues: [{ code, severity: FLOW_VALIDATION_RULES[code].severity, onActivePath: true, flowId, ...anchor, message: "never sent" }],
      reachableNodeIds: new Set(),
      reachabilityKnown: true
    });
    const parsed = request ? parseAuthoringAnswer({ version: 1, explanations: [{ issueId: "i0", text }] }, request) : undefined;
    return request && parsed?.ok ? judgeAuthoringAnswer(request, parsed).perExplanation[0] : undefined;
  };
  const CASES: ReadonlyArray<{ code: FlowValidationCode; anchor: { nodeId?: string; edgeId?: string }; relevant: string[]; irrelevant: string[]; fabricated: string[] }> = [
    {
      code: "missingFlowReference",
      anchor: { nodeId: "n1" },
      relevant: ["Choose a saved flow for this Run Another Flow step.", "This step runs another flow that does not exist; select a saved flow for it."],
      irrelevant: ["Add a locator to this step so that it knows which element to act on.", "The automation flow has an issue at this node; review the automation flow."],
      fabricated: ['Choose the "Checkout" flow for this Run Another Flow step.']
    },
    {
      code: "connectorStructure",
      anchor: { edgeId: "e1" },
      relevant: ["Change or remove the connector this finding points to, as the finding describes.", "Change or remove this connector: it does not follow a structural connector rule."],
      irrelevant: ["Set this step's timeout to a positive number of milliseconds.", "Set the value this step needs in its settings."],
      fabricated: ['Remove the "Retry" connector.']
    },
    {
      code: "invalidLoopBounds",
      anchor: { nodeId: "n1" },
      relevant: ["Set the loop's iteration limit to a number from 1 to 1000.", "The loop's iteration bound is outside 1 to 1000; set its limit to a number in that range."],
      irrelevant: ["Choose a saved flow for this Run Another Flow step.", "Add a locator to this step."],
      fabricated: ["Set the loop's iteration limit to 5000."]
    }
  ];
  for (const c of CASES) {
    for (const text of c.relevant) {
      const p = read(c.code, c.anchor, text);
      expect(`${c.code}: relevant, on subject, actionable and screen-clear: "${text}"`, p?.onSubject === true && p.actionable && p.category === "unverified");
    }
    for (const text of c.irrelevant) expect(`${c.code}: irrelevant, off subject: "${text}"`, read(c.code, c.anchor, text)?.onSubject === false);
    for (const text of c.fabricated) {
      const p = read(c.code, c.anchor, text);
      expect(`${c.code}: fabricated, a defect: "${text}"`, p?.category === "defect" && p.unsupported.includes("FABRICATED_LITERAL"));
    }
  }
  return failures;
}

/**
 * The display gate (R4) beyond the 34 it was measured on: wording none of them used, the evidence itself
 * copied, and the severity statements the screens already judge. Returns every control that did not come
 * out as it must; empty when all hold. What the gate cannot read is documented, not asserted: L4 › R4.
 */
export function displayGateControlFailures(requestFor: (caseId: string) => AuthoringRequest | undefined): string[] {
  const failures: string[] = [];
  const expect = (label: string, ok: boolean) => {
    if (!ok) failures.push(label);
  };
  const reasons = (caseId: string, index: number, text: string): ExplanationWithholdReason[] | null => {
    const request = requestFor(caseId);
    const ref = request?.issues[index];
    return request && ref ? withholdReasons(ref, text, supportedTextOf(request)) : null;
  };
  const withheldFor = (caseId: string, index: number, text: string, reason: ExplanationWithholdReason) => reasons(caseId, index, text)?.includes(reason) === true;
  const shown = (caseId: string, index: number, text: string) => reasons(caseId, index, text)?.length === 0;
  const summary = (code: FlowValidationCode) => FLOW_VALIDATION_RULES[code].summary;
  const positive = "Set this step's timeout to a positive number of milliseconds.";

  // A consequence or a cause in words none of the 34 used.
  expect("a consequence with no causal word is withheld: 'The step fails at once when it runs.'", withheldFor("single", 0, "The step fails at once when it runs.", "UNESTABLISHED_CONSEQUENCE"));
  expect("...'The runner skips this condition.'", withheldFor("branch", 1, "The runner skips this condition.", "UNESTABLISHED_CONSEQUENCE"));
  expect("...'These connectors loop forever.'", withheldFor("cycle", 0, "These connectors loop forever.", "UNESTABLISHED_CONSEQUENCE"));
  expect("...'The run times out at this step.'", withheldFor("warnings", 0, "The run times out at this step.", "UNESTABLISHED_CONSEQUENCE"));
  expect("a cause through a connective none of the 34 used is withheld: 'Due to the missing value, …'", withheldFor("values", 0, "Due to the missing value, the step is incomplete.", "UNESTABLISHED_CAUSE"));
  // The product's own evidence, copied, is shown: that is what the model was told.
  expect("a rule summary that states a consequence, copied for its own issue, is shown (incompleteValueSource)", shown("values", 1, summary("incompleteValueSource")));
  expect("...unguardedCycle's, with its runtime-cycle error", shown("cycle", 0, summary("unguardedCycle")));
  expect("...one clause of a summary alone, capitalised (deadEndNode's consequence)", shown("warnings", 1, "The run stops there and reports success without reaching End."));
  expect("...a cause in the product's own words (connectorFromEndNode's 'so it never runs' clause)", shown("cycle", 1, "The flow finishes at End, so it never runs."));
  expect("the same summary under another issue is withheld: the evidence is each issue's own", withheldFor("warnings", 0, summary("deadEndNode"), "UNESTABLISHED_CONSEQUENCE"));
  // QC (2026-09-25): evidence counts only as a statement of its own. Framed inside a sentence, it can say the opposite.
  expect("a copied clause framed inside a sentence is read, not trusted: 'After you add a connector, the run stops there…'", withheldFor("warnings", 1, "After you add a connector, the run stops there and reports success without reaching End.", "UNESTABLISHED_CONSEQUENCE"));
  expect("...'It is not true that the run stops there…'", withheldFor("warnings", 1, "It is not true that the run stops there and reports success without reaching End.", "UNESTABLISHED_CONSEQUENCE"));
  // Severity is the screens' to judge, both ways.
  expect("the flow not running, said of an issue that blocks the run, is its own line's evidence: shown", shown("single", 0, `The flow cannot run until this timeout is fixed. ${positive}`));
  expect("...but not a claim about which steps run (QC): 'Only this step will not execute.' is withheld", withheldFor("single", 0, `Only this step will not execute. ${positive}`, "UNESTABLISHED_CONSEQUENCE"));
  expect("...and 'cannot run' for a warning is an invented consequence: withheld", withheldFor("warnings", 0, "This step cannot run as configured.", "UNESTABLISHED_CONSEQUENCE"));
  // Mutation run (2026-09-25): no severity screen reads "does not run", so for a warning only the gate withholds
  // it. Taking the flow's own "blocks the run" evidence for a non-blocking issue survived every control above.
  expect("...as is 'the flow does not run' for a warning, which no severity screen reads: withheld", withheldFor("warnings", 0, "The flow does not run.", "UNESTABLISHED_CONSEQUENCE"));
  // QC (2026-09-25, second pass): a pronoun can carry the scope claim back in, and a bare colon is no statement break.
  expect("...'it' is no subject the evidence names: 'Only this step is affected; it will not execute.' is withheld", withheldFor("single", 0, `Only this step is affected; it will not execute. ${positive}`, "UNESTABLISHED_CONSEQUENCE"));
  expect("a summary after a framing colon is read, not trusted: 'It is not true that: <summary>'", withheldFor("warnings", 1, `It is not true that: ${summary("deadEndNode")}`, "UNESTABLISHED_CONSEQUENCE"));
  expect("a validation failure said of a blocking error is a severity statement, not an invented consequence: shown", shown("single", 0, `This timeout fails validation. ${positive}`));
  expect("...and said of a warning is overstated: withheld", withheldFor("warnings", 0, "This timeout fails validation.", "SEVERITY_OVERSTATED"));
  // Every screen hit is a reason of its own kind, so no screen hit is ever displayed.
  expect("a screen hit is withheld under its kind: an invented position", withheldFor("single", 0, "Set the first step's timeout to a positive number of milliseconds.", "FABRICATED_LITERAL"));
  expect("...a remedy outside the flow", withheldFor("cycle", 0, "Restart the application to clear the loop.", "OFF_DOMAIN"));
  expect("...a correction the rule contradicts", withheldFor("cycle", 1, "Add a connector that connects to the End node.", "WRONG_REMEDY"));
  // Twins that must stay shown.
  expect("a purpose ('so that it knows') is no cause: shown", shown("locator-orphan", 0, "Add a locator to this step so that it knows which element to act on."));
  for (const labelled of LABELLED_SET) {
    const request = requestFor(labelled.id);
    expect(`${labelled.id}: the product's steps, restated, are shown`, request !== undefined && request.issues.every((ref, i) => shown(labelled.id, i, ref.step)));
  }
  return failures;
}
