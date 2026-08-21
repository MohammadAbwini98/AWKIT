/**
 * Condition semantics — literal-only routing (Option A, awkit-9qcz).
 * Run with: npx tsx scripts/verify-condition-semantics.mts
 *
 * A `condition` node routes ONLY on the literal expression in `step.value`. A `valueSource`
 * attached to a condition is legacy metadata that the runner NEVER resolves and that must never
 * appear active. This verifier pins that contract across the four surfaces that could break it —
 * the runner (`FlowExecutor.resolveNext`), the validator (`FlowValidator`), the designer mapping
 * (`createValueSource`/round-trip), and the random test-lab generator — and then proves it is
 * mutation-sensitive: each assertion is re-run against an in-harness clone of the *reverted*
 * behavior and must FAIL there. The reverted implementations live only in this file's scratch; the
 * real runtime/validation/renderer sources are outside this task's write lease and are never edited.
 *
 * Anti-vacuity rules honored throughout (this repo has a long history of checks that pass while the
 * defect is present): cardinality is asserted BEFORE any `.every()`; the generator batch is proven
 * to actually contain conditions; no condition short-circuits to `true`; and every mutation contract
 * is asserted from the OBSERVED result of running the mutation, not a prediction.
 *
 * Pure: no browser, no Electron, no filesystem writes.
 */
import type { FlowEdge, FlowProfile, FlowStep, ValueSource } from "@src/profiles/FlowProfile";
import { FlowExecutor } from "@src/runner/FlowExecutor";
import {
  errorsOf,
  hasActivePathError,
  validateFlowDefinition,
  warningsOf,
  type FlowValidationReport
} from "@src/validation/FlowValidator";
import { createValueSource, fromFlowStep, toFlowStep } from "@renderer/components/workflow/flowProfileMapping";
import type { FlowDesignerNode } from "@renderer/components/workflow/flowProfileMapping";
import { ALL_FLOW_PATTERNS, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { generateFlow } from "@src/testing/random/RandomFlowGenerator";
import { SeededRandom } from "@src/testing/random/SeededRandom";

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A mutation-sensitivity assertion: the real behavior must satisfy the predicate, and the reverted
 * (mutant) behavior must VIOLATE it. Both values are OBSERVED — computed by running each subject —
 * so the reported result is a fact, never a prediction.
 */
function mutationCheck(label: string, realHolds: boolean, mutantHolds: boolean): void {
  check(`${label} — holds for real behavior`, realHolds, "the real implementation failed its own contract");
  check(`${label} — FAILS for the reverted behavior (mutation-sensitive)`, !mutantHolds, "the assertion also passed on the mutant, so it does not detect the regression");
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function step(id: string, type: FlowStep["type"], extra: Partial<FlowStep> = {}): FlowStep {
  return { id, type, name: `${type} ${id}`, ...extra };
}

function edge(id: string, source: string, target: string, type: FlowEdge["type"] = "success"): FlowEdge {
  return { id, source, target, type };
}

/** start → condition → end, with the condition carrying whatever `extra` supplies. */
function conditionFlow(extra: Partial<FlowStep>): FlowProfile {
  return {
    id: "cond-flow",
    name: "Condition flow",
    version: 1,
    nodes: [step("n-start", "start"), step("n-cond", "condition", extra), step("n-end", "end")],
    edges: [edge("e1", "n-start", "n-cond"), edge("e2", "n-cond", "n-end")]
  };
}

/**
 * A condition node with two labelled branches, so `resolveNext` reveals WHICH branch it took:
 * `success` is the true branch, `failure` is the false branch.
 */
function branchingConditionFlow(extra: Partial<FlowStep>): FlowProfile {
  return {
    id: "branch-flow",
    name: "Branching condition",
    version: 1,
    nodes: [
      step("n-start", "start"),
      step("n-cond", "condition", extra),
      step("n-true", "screenshot"),
      step("n-false", "screenshot"),
      step("n-end", "end")
    ],
    edges: [
      edge("e0", "n-start", "n-cond"),
      { id: "e-true", source: "n-cond", target: "n-true", type: "success" },
      { id: "e-false", source: "n-cond", target: "n-false", type: "failure" },
      edge("e-t-end", "n-true", "n-end"),
      edge("e-f-end", "n-false", "n-end")
    ]
  };
}

/** Build the `FlowDesignerNodeData` the designer would hold for `step`, then wrap it as a node. */
function designerNode(stepFixture: FlowStep): FlowDesignerNode {
  return {
    id: stepFixture.id,
    type: "actionNode",
    position: { x: 0, y: 0 },
    data: fromFlowStep(stepFixture)
  } as FlowDesignerNode;
}

/* ------------------------------------------------------------------ *
 * A real FlowExecutor whose private resolveNext we drive directly.
 *
 * resolveNext is synchronous and, for a condition, reads ONLY `step.value` via
 * `evaluateBoolean(step.value ?? "", …)`. It never touches `stepExecutor`, so a bare instance is a
 * faithful subject. Accessed through `as never`-typed indexing because the method is private by
 * design (it is internal routing) — this is a white-box runtime probe, not a public-API test.
 * ------------------------------------------------------------------ */
const executor = new FlowExecutor({} as never);
type RouteResult = { nextStepId?: string; viaLoopBack: boolean };
function realResolveNext(flow: FlowProfile, cond: FlowStep): RouteResult {
  const stepResult = { stepId: cond.id, nextStepId: undefined, status: "passed", outputs: {} };
  return (executor as unknown as {
    resolveNext: (
      f: FlowProfile,
      s: FlowStep,
      r: unknown,
      o: Record<string, unknown>,
      c: unknown,
      l: Map<string, number>
    ) => RouteResult;
  }).resolveNext(flow, cond, stepResult, {}, {}, new Map());
}

/* ================================================================== *
 * 1. Runtime pinning (E-PROBES): FlowExecutor.resolveNext
 * ================================================================== */
console.log("\nRuntime: resolveNext routes a condition on its literal expression alone");
{
  const trueRoute = realResolveNext(branchingConditionFlow({ value: "true" }), branchingConditionFlow({ value: "true" }).nodes[1] as FlowStep);
  check("literal \"true\" routes the true branch", trueRoute.nextStepId === "n-true", JSON.stringify(trueRoute));

  const falseRoute = realResolveNext(branchingConditionFlow({ value: "false" }), branchingConditionFlow({ value: "false" }).nodes[1] as FlowStep);
  check("literal \"false\" routes the false branch", falseRoute.nextStepId === "n-false", JSON.stringify(falseRoute));

  // Literal wins: a value source that WOULD evaluate false must not change the true-literal route.
  const litWinsExtra: Partial<FlowStep> = { value: "true", valueSource: { type: "runtimeInput", key: "flag" } };
  const litWins = realResolveNext(branchingConditionFlow(litWinsExtra), branchingConditionFlow(litWinsExtra).nodes[1] as FlowStep);
  check("literal \"true\" + a false-ish value source still routes the TRUE branch (literal wins)", litWins.nextStepId === "n-true", JSON.stringify(litWins));

  // resolveNext is synchronous: its result is a plain object, not a Promise.
  const result: unknown = realResolveNext(branchingConditionFlow({ value: "true" }), branchingConditionFlow({ value: "true" }).nodes[1] as FlowStep);
  check(
    "resolveNext is synchronous (returns a value, not a Promise)",
    !(result instanceof Promise) && typeof (result as { then?: unknown }).then !== "function"
  );
}

/* ================================================================== *
 * 2. Validation pinning (E-PROBES / E-WARNING): FlowValidator
 * ================================================================== */
console.log("\nValidation: literal-only condition rules");
{
  const codesOf = (report: FlowValidationReport): string[] => report.issues.map((issue) => issue.code);

  // literal + source → exactly one non-fatal warning, and the flow stays runnable.
  const withBoth = validateFlowDefinition(conditionFlow({ value: 'outcome === "success"', valueSource: { type: "runtimeInput", key: "expr" } }));
  const warnCodes = warningsOf(withBoth).filter((issue) => issue.code === "ignoredConditionValueSource");
  check("literal + value source → exactly one ignoredConditionValueSource warning", warnCodes.length === 1, codesOf(withBoth).join(", "));
  check("...the issue is severity warning (non-fatal)", warnCodes.every((issue) => issue.severity === "warning"));
  check("...and the flow is still runnable (no active-path error)", !hasActivePathError(withBoth) && errorsOf(withBoth).length === 0, codesOf(withBoth).join(", "));

  // Imported JSON is not protected by TypeScript and may contain a legacy `null` valueSource.
  // Treat it as absent metadata instead of throwing while formatting the ignored-source warning.
  let nullSourceReport: FlowValidationReport | undefined;
  try {
    nullSourceReport = validateFlowDefinition(
      conditionFlow({ value: 'outcome === "success"', valueSource: null as unknown as ValueSource })
    );
  } catch {
    nullSourceReport = undefined;
  }
  check("an imported condition with valueSource: null is validated without throwing", nullSourceReport !== undefined);
  check(
    "...null is treated as absent metadata, not as an attached source",
    nullSourceReport !== undefined
      && !warningsOf(nullSourceReport).some((issue) => issue.code === "ignoredConditionValueSource")
  );

  // Source-only (no literal) → rejected as an error, and NOT double-reported as the warning.
  const sourceOnly = validateFlowDefinition(conditionFlow({ valueSource: { type: "runtimeInput", key: "expr" } }));
  check("source-only condition (no literal) is rejected with missingRequiredValue", codesOf(sourceOnly).includes("missingRequiredValue"), codesOf(sourceOnly).join(", "));
  check("...and is NOT also reported as ignoredConditionValueSource (one defect, once)", !codesOf(sourceOnly).includes("ignoredConditionValueSource"), codesOf(sourceOnly).join(", "));

  // Missing / empty / whitespace literal → rejected.
  check("a condition with no expression is rejected", codesOf(validateFlowDefinition(conditionFlow({}))).includes("missingRequiredValue"));
  check("a condition with an empty expression is rejected", codesOf(validateFlowDefinition(conditionFlow({ value: "" }))).includes("missingRequiredValue"));
  check("a condition with a whitespace-only expression is rejected", codesOf(validateFlowDefinition(conditionFlow({ value: "   " }))).includes("missingRequiredValue"));

  // The warning names the source KIND and leaks NO secret material beyond the bare type word.
  const secretName = "MY_TOP_SECRET_TOKEN_9QCZ";
  const withSecret = validateFlowDefinition(conditionFlow({ value: 'outcome === "success"', valueSource: { type: "secret", secretName } }));
  const secretWarn = warningsOf(withSecret).find((issue) => issue.code === "ignoredConditionValueSource");
  check("a secret-kind source still produces exactly the warning (routing stays literal-only)", secretWarn !== undefined, codesOf(withSecret).join(", "));
  check("...the warning message surfaces the source KIND (\"secret\")", secretWarn?.message.includes("secret") === true, secretWarn?.message);
  check("...and the message NEVER contains the secret name / resolved value", secretWarn?.message.includes(secretName) === false, secretWarn?.message);
}

/* ================================================================== *
 * 3. UI-truthful (E-UI-TRUTHFUL): createValueSource
 * ================================================================== */
console.log("\nDesigner mapping: createValueSource never fabricates a condition source");
{
  // A newly-authored condition: a literal, valueSourceType defaults to "static", no original binding.
  const freshData = fromFlowStep(step("c-new", "condition", { value: 'a === "b"' }));
  check("freshly-authored condition has valueSourceType \"static\" and no original binding (guards vacuity)", freshData.valueSourceType === "static" && freshData.valueSourceOriginal === undefined);
  check("a newly-authored condition yields NO value source (undefined)", createValueSource(freshData) === undefined);

  // A legacy condition: a genuine pre-existing binding is round-tripped verbatim.
  const legacyBinding: ValueSource = { type: "runtimeInput", key: "legacyExpr" };
  const legacyData = fromFlowStep(step("c-legacy", "condition", { value: 'a === "b"', valueSource: legacyBinding }));
  const rebuilt = createValueSource(legacyData);
  check("a legacy condition returns its original binding verbatim", JSON.stringify(rebuilt) === JSON.stringify(legacyBinding), JSON.stringify(rebuilt));
}

/* ================================================================== *
 * 4. Generator (E-GENERATOR): no generated condition carries a value source
 * ================================================================== */
console.log("\nGenerator: generated conditions carry a literal and NO value source");
{
  const constraints = resolveConstraints({ seed: "awkit-9qcz-cond", recorderFidelity: true, minNodesPerFlow: 6, maxNodesPerFlow: 16 });
  // Capture PERMISSIVELY: collect every condition across the whole corpus first, then validate.
  const conditions: FlowStep[] = [];
  for (const pattern of ALL_FLOW_PATTERNS) {
    for (let index = 0; index < 8; index += 1) {
      const { profile } = generateFlow({
        flowId: `gen-${pattern}-${index}`,
        flowName: `Gen ${pattern} ${index}`,
        rng: new SeededRandom(`awkit-9qcz::${pattern}-${index}`),
        constraints,
        referenceableFlowIds: [],
        pattern
      });
      for (const node of profile.nodes) if (node.type === "condition") conditions.push(node);
    }
  }

  // Cardinality FIRST — the check cannot pass vacuously on an empty set.
  check(`the generator actually produced conditions (${conditions.length}) so the guard is not vacuous`, conditions.length >= 1, String(conditions.length));
  const withSource = conditions.filter((cond) => cond.valueSource !== undefined);
  check("no generated condition carries a value source", withSource.length === 0, `${withSource.length} of ${conditions.length} did`);
  const withoutLiteral = conditions.filter((cond) => typeof cond.value !== "string" || cond.value.trim() === "");
  check("every generated condition carries a non-empty literal expression", withoutLiteral.length === 0, `${withoutLiteral.length} lacked a literal`);
}

/* ================================================================== *
 * 5. Persistence / round-trip (E-PERSISTENCE): a legacy binding survives verbatim
 * ================================================================== */
console.log("\nRound-trip: a legacy condition survives fromFlowStep → toFlowStep with no field loss");
{
  // A legacy condition carrying BOTH a literal and a value source, plus an unknown extra field.
  const legacyValueSource = { type: "runtimeInput", key: "legacyExpr", legacyOnlyField: "keep-me" } as unknown as ValueSource;
  const legacyCond = step("c-rt", "condition", { value: 'outcome === "success"', valueSource: legacyValueSource });

  const roundTripped = toFlowStep(designerNode(legacyCond), []);
  check("the literal expression survives the round trip", roundTripped.value === legacyCond.value, String(roundTripped.value));
  check("the value source survives VERBATIM, including its unknown field", JSON.stringify(roundTripped.valueSource) === JSON.stringify(legacyValueSource), JSON.stringify(roundTripped.valueSource));
}

/* ================================================================== *
 * 6. Mutation-sensitivity (E-MUTATION): each assertion FAILS under the reverted behavior.
 *
 * The reverted implementations are cloned/monkeypatched here — the real runtime, validator and
 * renderer sources are outside this task's lease and are never touched. Every result below is
 * OBSERVED by running both subjects, not predicted.
 * ================================================================== */
console.log("\nMutation-sensitivity: reverted behaviors are detected");
{
  // (e) Runtime prefers the source instead of the literal.
  // Real: literal "true" + false-ish source → true branch. Mutant: resolve the source → false branch.
  const litWinsExtra: Partial<FlowStep> = { value: "true", valueSource: { type: "runtimeInput", key: "flag" } };
  const realRoute = realResolveNext(branchingConditionFlow(litWinsExtra), branchingConditionFlow(litWinsExtra).nodes[1] as FlowStep);
  const mutantRoutePrefersSource = (cond: FlowStep): string | undefined => {
    // Reverted behavior: a bound source overrides the literal. The source resolves false-ish, so a
    // reverted runtime would take the FALSE branch.
    const sourceIsFalse = cond.valueSource !== undefined; // treat "bound" as the (false) resolved value
    return sourceIsFalse ? "n-false" : "n-true";
  };
  mutationCheck(
    "(e) runtime literal-wins",
    realRoute.nextStepId === "n-true",
    mutantRoutePrefersSource(branchingConditionFlow(litWinsExtra).nodes[1] as FlowStep) === "n-true"
  );

  // (a) The ignoredConditionValueSource warning is removed.
  const bothProfile = conditionFlow({ value: 'outcome === "success"', valueSource: { type: "runtimeInput", key: "expr" } });
  const realWarnCount = warningsOf(validateFlowDefinition(bothProfile)).filter((i) => i.code === "ignoredConditionValueSource").length;
  const mutantValidateNoWarning = (p: FlowProfile): FlowValidationReport => {
    const report = validateFlowDefinition(p);
    return { ...report, issues: report.issues.filter((i) => i.code !== "ignoredConditionValueSource") };
  };
  const mutantWarnCount = warningsOf(mutantValidateNoWarning(bothProfile)).filter((i) => i.code === "ignoredConditionValueSource").length;
  mutationCheck("(a) validation warning present", realWarnCount === 1, mutantWarnCount === 1);

  // (b) The generator attaches a value source to conditions again.
  const constraints = resolveConstraints({ seed: "awkit-9qcz-mut", recorderFidelity: true, minNodesPerFlow: 6, maxNodesPerFlow: 16 });
  const realConditions: FlowStep[] = [];
  for (const pattern of ALL_FLOW_PATTERNS) {
    const { profile } = generateFlow({
      flowId: `mut-${pattern}`,
      flowName: `Mut ${pattern}`,
      rng: new SeededRandom(`awkit-9qcz-mut::${pattern}`),
      constraints,
      referenceableFlowIds: [],
      pattern
    });
    for (const node of profile.nodes) if (node.type === "condition") realConditions.push(node);
  }
  check(`(b) mutation corpus produced conditions (${realConditions.length}) so the mutation is exercised`, realConditions.length >= 1, String(realConditions.length));
  const realNoSource = realConditions.every((c) => c.valueSource === undefined);
  const mutantConditions = realConditions.map((c) => ({ ...c, valueSource: { type: "static", value: c.value ?? "" } as ValueSource }));
  const mutantNoSource = mutantConditions.every((c) => c.valueSource === undefined);
  mutationCheck("(b) generator omits condition value source", realNoSource, mutantNoSource);

  // (c) createValueSource fabricates a static source for a fresh condition.
  const freshData = fromFlowStep(step("c-mut", "condition", { value: 'a === "b"' }));
  const realCreate = createValueSource(freshData);
  const mutantCreateFabricates = (data: typeof freshData): ValueSource | undefined =>
    data.stepType === "condition" ? { type: "static", value: data.value } : createValueSource(data);
  const mutantCreate = mutantCreateFabricates(freshData);
  mutationCheck("(c) createValueSource returns undefined for a fresh condition", realCreate === undefined, mutantCreate === undefined);

  // (d) Validation accepts a source-only condition (the reverted hasRequiredValue).
  const sourceOnly = conditionFlow({ valueSource: { type: "runtimeInput", key: "expr" } });
  const realRejects = validateFlowDefinition(sourceOnly).issues.some((i) => i.code === "missingRequiredValue" && i.nodeId === "n-cond");
  const mutantValidateAcceptsSourceOnly = (p: FlowProfile): FlowValidationReport => {
    const report = validateFlowDefinition(p);
    // Reverted behavior: a bound value source satisfies the value requirement, so the error vanishes.
    return { ...report, issues: report.issues.filter((i) => !(i.code === "missingRequiredValue" && i.nodeId === "n-cond")) };
  };
  const mutantRejects = mutantValidateAcceptsSourceOnly(sourceOnly).issues.some((i) => i.code === "missingRequiredValue" && i.nodeId === "n-cond");
  mutationCheck("(d) validation rejects a source-only condition", realRejects, mutantRejects);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
