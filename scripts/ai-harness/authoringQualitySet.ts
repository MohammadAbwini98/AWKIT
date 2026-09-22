/**
 * The labelled set behind `verify:ai-authoring-quality-live` (Phase L, L4b), and the judge it applies.
 *
 * Each case is a small broken flow whose report sends exactly two issues from different L4a families,
 * through `buildAuthoringRequest`, so together they cover one request per fix kind and both severities.
 * The step names, the flow name and the typed values carry `CANARY`, which the product never sends:
 * the request carries codes, severities, anchors and rule summaries only.
 *
 * The judge is a PROXY and says so. Model text is never recorded, so whether an explanation is about
 * its own issue is read from whether it names that issue's subject (`SUBJECT`), and whether it describes
 * a different sent issue instead. No plan sets a target for these rates (L4's acceptance asks for one
 * before release), so the live gate records them and judges only the product's own contract.
 *
 * Electron-free: `verify:ai-authoring` audits the set and runs the judge's controls without a model.
 */

import { AUTHORING_LIMITS, parseAuthoringAnswer, type AuthoringAnswer, type AuthoringRequest } from "@src/ai/authoringExplanation";
import type { FlowEdge, FlowProfile, FlowStep, StepType } from "@src/profiles/FlowProfile";
import { findResidualSecrets } from "@src/semantic/SemanticPolicyValidator";
import type { FlowValidationCode } from "@src/validation/FlowValidator";

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
  /** The codes the request must send, in order, and which of them carry an emitted fix. */
  sent: Array<{ code: FlowValidationCode; fixable: boolean }>;
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
      { code: "unsupportedOperator", fixable: true },
      { code: "unsupportedConfiguration", fixable: true }
    ]
  },
  {
    id: "locator-orphan",
    families: "missing required binding, unreachable node",
    flow: flow("locator-orphan", [step("s", "start"), step("a", "click"), click("b"), click("x"), step("e", "end")], [edge("e1", "s", "a"), edge("e2", "a", "b"), edge("e3", "b", "e")]),
    sent: [
      { code: "missingRequiredLocator", fixable: false },
      { code: "unreachableNode", fixable: false }
    ]
  },
  {
    id: "branch",
    families: "branch pair, incomplete condition",
    flow: flow("branch", [step("s", "start"), click("a"), step("e", "end")], [edge("e1", "s", "a"), conditional("e2", "a", "e", "equals", "")]),
    sent: [
      { code: "incompleteBranchPair", fixable: false },
      { code: "incompleteCondition", fixable: false }
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
      { code: "unguardedCycle", fixable: false },
      { code: "connectorFromEndNode", fixable: false }
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
      { code: "missingRequiredValue", fixable: false },
      { code: "incompleteValueSource", fixable: false }
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
      { code: "duplicateEdgeId", fixable: true },
      { code: "highTimeout", fixable: false }
    ]
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
  highTimeout: /timeout|time|wait|long|second|minute|hour/i
});

export interface AuthoringJudgement {
  sent: number;
  explained: number;
  /** Names its own issue's subject. */
  onSubject: number;
  /** Does not name its own issue's subject, and names another sent issue's instead. */
  misattributed: number;
  /** Ended at `maxExplanationChars`: cut by the grammar, not by the model. */
  cutByGrammar: number;
  /** Texts carrying the canary. The product never sends it, so any is a leak through the request. */
  canaryInText: number;
  residualSecrets: number;
  ranked: number;
  textChars: number[];
}

/** The judge, on an answer the product accepted. Counts only. */
export function judgeAuthoringAnswer(request: AuthoringRequest, answer: AuthoringAnswer): AuthoringJudgement {
  const names = (code: FlowValidationCode, text: string) => SUBJECT[code]?.test(text) === true;
  const codes = request.issues.map((ref) => ref.issue.code);
  return {
    sent: request.issues.length,
    explained: answer.explanations.length,
    onSubject: answer.explanations.filter((e) => names(e.issue.code, e.text)).length,
    misattributed: answer.explanations.filter((e) => !names(e.issue.code, e.text) && codes.some((code) => code !== e.issue.code && names(code, e.text))).length,
    cutByGrammar: answer.explanations.filter((e) => e.text.length >= AUTHORING_LIMITS.maxExplanationChars).length,
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
  expect("a canary in an answer is refused", deliveryViolations(request, answer([`${onA} ${CANARY}`, onB]), "prompt").includes("CANARY_IN_ANSWER"));
  expect("a canary in the prompt is refused", deliveryViolations(request, answer([onA, onB]), `step ${CANARY.toLowerCase()}`).includes("CANARY_IN_PROMPT"));
  expect("one of two explained is refused", deliveryViolations(request, { version: 1, explanations: [{ issueId: a.id, text: onA }] }, "prompt").includes("NOT_EVERY_ISSUE_EXPLAINED"));
  expect("ranking an issue with no emitted fix is refused", deliveryViolations(request, answer([onA, onB], { ranking: [a.id] }), "prompt").includes("REFUSED_FIX_NOT_EMITTED"));
  return failures;
}
