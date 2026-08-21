/**
 * Loop and Scroll step contracts — focused regression verifier.
 * Run with: npx tsx scripts/verify-loop-scroll-validation.mts
 *
 * THE DEFECTS THIS EXISTS FOR — the fourth and fifth instances of the class behind `awkit-3p6x`
 * (the wait node), `awkit-jtok` (Smart Wait conditions) and `awkit-56un` (assertions).
 *
 * `loop` was the worst of the five. Its flat row `{ requiresLocator: false, requiresValue: true }`
 * was wrong for EVERY possible configuration:
 *   - the loop's input is its iteration SOURCE (`config.loopType` + `iterationCount`/locator/data
 *     source), never `step.value` — which the runner reads only for a `fill` action. So every loop
 *     reported "requires a value or value source", and the Loop panel has no value field at all
 *     (`sections: ["loop", "execution"]`), making the demand unsatisfiable from the designer. A
 *     correctly configured Loop node was permanently "Draft — not runnable".
 *   - the locator was never required, and its absence is SILENT: `performLoopAction` guards every
 *     arm with `if (target)`, so a click/delete/fill loop with no locator runs its full iteration
 *     count doing nothing and still reports `passed`.
 *
 * `scroll` had the same value-channel defect (`config.scrollAmount`, and again no value field in its
 * panel), plus an unchecked `scrollTarget: "element"` with no element — where the runner quietly
 * wheels the page instead of scrolling to the element.
 *
 * Both are asserted against the RUNTIME's own dispatch, and the SILENT cases get the most attention:
 * they are the ones no run report would ever reveal.
 *
 * Pure: no browser, no Electron, no filesystem writes (it reads source for the drift check).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { FlowProfile, FlowStep, StepLocator } from "@src/profiles/FlowProfile";
import { executionBlockingErrorsOf, validateFlowDefinition, validateFlowSet, type FlowValidationCode } from "@src/validation/FlowValidator";
import { STEP_REQUIREMENTS } from "@src/validation/StepRequirements";
import { LOOP_ACTION_TYPES, LOOP_ACTIONS_NEEDING_A_TARGET, LOOP_TYPES, resolveLoopAction, resolveLoopType } from "@src/validation/LoopStepContract";
import { SCROLL_DIRECTIONS, SCROLL_TARGETS, scrollTargetsElement } from "@src/validation/ScrollStepContract";
import { generateFlow } from "@src/testing/random/RandomFlowGenerator";
import { ALL_FLOW_PATTERNS, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import { getNodeDefinition } from "../app/renderer/components/workflow/flowNodeRegistry";
import { fromFlowStep, toFlowStep, type FlowDesignerNode } from "../app/renderer/components/workflow/flowProfileMapping";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const LOCATOR: StepLocator = { strategy: "css", value: "#row", resolution: "resolved", resolvedBy: "user" };

type StepProbe = Pick<FlowStep, "type"> & Omit<Partial<FlowStep>, "id" | "type" | "name">;

function completeStep(step: StepProbe): FlowStep {
  return { id: "s", name: "S", ...step };
}

/** Test-boundary helper for malformed literals that can arrive through imported JSON. */
function setRawProperty(target: object, key: PropertyKey, value: unknown): void {
  if (!Reflect.set(target, key, value)) throw new Error(`Could not inject raw property ${String(key)}`);
}

function stepWithRawConfig(step: StepProbe, key: PropertyKey, value: unknown): FlowStep {
  const result = completeStep({ ...step, config: { ...step.config } });
  if (!result.config) throw new Error("Raw loop/scroll probe has no config object");
  setRawProperty(result.config, key, value);
  return result;
}

function codesForCompleteStep(step: FlowStep): FlowValidationCode[] {
  const flow: FlowProfile = {
    id: "probe",
    name: "probe",
    version: 1,
    nodes: [step],
    edges: []
  };
  return validateFlowDefinition(flow).issues.filter((i) => i.nodeId === "s").map((i) => i.code);
}
function codesFor(step: StepProbe): FlowValidationCode[] {
  return codesForCompleteStep(completeStep(step));
}
const messagesFor = (step: StepProbe): string[] => {
  const flow: FlowProfile = { id: "probe", name: "probe", version: 1, nodes: [completeStep(step)], edges: [] };
  return validateFlowDefinition(flow).issues.filter((i) => i.nodeId === "s").map((i) => i.message);
};
const has = (step: StepProbe, code: FlowValidationCode): boolean => codesFor(step).includes(code);
const clean = (step: StepProbe): boolean => codesFor(step).length === 0;

/* ------------------------------------------------------------------ *
 * 1. Scroll — the distance channel the designer actually writes
 * ------------------------------------------------------------------ */
console.log("\nScroll: the distance lives in config, not in value");
{
  check("a scroll configured the way the designer writes it is valid", clean({ type: "scroll", config: { scrollDirection: "down", scrollAmount: 300 } }));
  check("…and specifically reports no missingRequiredValue", !has({ type: "scroll", config: { scrollDirection: "down", scrollAmount: 300 } }, "missingRequiredValue"));
  check("a scroll carrying its distance as a literal value is valid", clean({ type: "scroll", value: "300" }));
  check("a scroll bound to a value source is valid", clean({ type: "scroll", valueSource: { type: "runtimeInput", value: "px" } }));
  // A scroll-to-element ignores the distance entirely, so the locator alone completes it.
  check("a scroll-to-element needs no distance", clean({ type: "scroll", locator: LOCATOR, config: { scrollTarget: "element" } }));

  check("a scroll stating no distance at all is invalid", has({ type: "scroll" }, "missingRequiredValue"));
  check("the message names the Amount box", messagesFor({ type: "scroll" }).some((m) => m.includes("Amount")));

  // `cfg.scrollTarget === "element" && step.locator` — without the locator the condition is false and
  // the runner silently wheels the page instead. Nothing fails; it scrolls the wrong thing.
  check("a scroll-to-element with NO locator is invalid", has({ type: "scroll", config: { scrollTarget: "element" } }, "missingRequiredLocator"));
  check("a page scroll needs no locator", clean({ type: "scroll", config: { scrollTarget: "page", scrollAmount: 200 } }));

  // `mouse.wheel(0, NaN)` moves nothing while looking configured.
  check("a non-numeric literal distance is reported", has({ type: "scroll", value: "lots" }, "unsupportedConfiguration"));
  check("a zero distance is reported (the page would not move)", has({ type: "scroll", config: { scrollAmount: 0 } }, "unsupportedConfiguration"));
  check("a NaN scrollAmount is reported", has({ type: "scroll", config: { scrollAmount: Number.NaN } }, "unsupportedConfiguration"));
  const unknownDirection = stepWithRawConfig({ type: "scroll", config: { scrollAmount: 100 } }, "scrollDirection", "sideways");
  const unknownTarget = stepWithRawConfig({ type: "scroll", config: { scrollAmount: 100 } }, "scrollTarget", "orbit");
  check("an unknown scrollDirection is reported", codesForCompleteStep(unknownDirection).includes("unsupportedConfiguration"));
  check("an unknown scrollTarget is reported", codesForCompleteStep(unknownTarget).includes("unsupportedConfiguration"));

  // …and the negative controls, so the rule cannot be satisfied by rejecting everything.
  for (const direction of SCROLL_DIRECTIONS) {
    check(`a page scroll ${direction} is clean`, clean({ type: "scroll", config: { scrollAmount: 250, scrollDirection: direction } }));
  }
  check("a negative distance is tolerated (it inverts the direction, it does not break)", clean({ type: "scroll", config: { scrollAmount: -250 } }));
  check("one bad distance reports exactly one issue", codesFor({ type: "scroll", config: { scrollAmount: 0 } }).length === 1, codesFor({ type: "scroll", config: { scrollAmount: 0 } }).join(", "));
  check("there are exactly 2 scroll targets and 4 directions", SCROLL_TARGETS.length === 2 && SCROLL_DIRECTIONS.length === 4);
  check(
    "scrollTargetsElement mirrors the runtime's literal comparison",
    scrollTargetsElement(completeStep({ type: "scroll", config: { scrollTarget: "element" } })) && !scrollTargetsElement(unknownTarget)
  );
}

/* ------------------------------------------------------------------ *
 * 2. Loop — the iteration source, and the silent no-op
 * ------------------------------------------------------------------ */
console.log("\nLoop: the iteration source lives in config, and a missing target is silent");
{
  check("a fixed-count loop with a locator and a count is valid", clean({ type: "loop", locator: LOCATOR, config: { loopType: "fixedCount", iterationCount: 3, loopActionType: "click" } }));
  check("…and specifically reports no missingRequiredValue", !has({ type: "loop", locator: LOCATOR, config: { loopType: "fixedCount", iterationCount: 3 } }, "missingRequiredValue"));
  check("an elements loop with a locator is valid", clean({ type: "loop", locator: LOCATOR, config: { loopType: "elements", loopActionType: "click" } }));
  // The workflow data source is a run-time binding; rejecting it would fail every data-driven flow.
  check("a dataRows loop is valid (its source resolves at run time)", clean({ type: "loop", locator: LOCATOR, config: { loopType: "dataRows", loopActionType: "click" } }));

  check("a loop stating no iteration source is invalid", has({ type: "loop", locator: LOCATOR, config: { loopType: "fixedCount" } }, "missingRequiredValue"));
  check("the message explains the three ways to state one", messagesFor({ type: "loop", locator: LOCATOR }).some((m) => m.includes("iteration count")));

  // THE SILENT CASE: every action arm is guarded by `if (target)`.
  for (const action of ["click", "delete", "fill"] as const) {
    check(
      `a ${action} loop with NO locator is invalid (it would iterate doing nothing)`,
      has({ type: "loop", value: "x", config: { loopType: "fixedCount", iterationCount: 2, loopActionType: action } }, "missingRequiredLocator")
    );
  }
  // …and the actions that genuinely need no target must NOT be asked for one.
  check("a scroll-action loop needs no locator", clean({ type: "loop", config: { loopType: "fixedCount", iterationCount: 2, loopActionType: "scroll" } }));
  check("a customFlow-action loop needs no locator", clean({ type: "loop", config: { loopType: "fixedCount", iterationCount: 2, loopActionType: "customFlow", targetFlowId: "child" } }));
  check("click, delete and fill are the ONLY target-needing actions", [...LOOP_ACTIONS_NEEDING_A_TARGET].slice().sort().join(",") === "click,delete,fill");

  // `elements` with no locator counts zero and the body never runs — reported ONCE, by the locator
  // rule, not twice.
  const elementsNoLocator = codesFor({ type: "loop", config: { loopType: "elements", loopActionType: "click" } });
  check("an elements loop with no locator is reported", elementsNoLocator.includes("missingRequiredLocator"));
  check("…exactly once, not as both a missing locator and a missing source", elementsNoLocator.length === 1, elementsNoLocator.join(", "));

  // Action-specific inputs the runner reads.
  check("a fill loop with no value is invalid", has({ type: "loop", locator: LOCATOR, config: { loopType: "elements", loopActionType: "fill" } }, "missingRequiredValue"));
  check("a fill loop with a value is clean", clean({ type: "loop", locator: LOCATOR, value: "text", config: { loopType: "elements", loopActionType: "fill" } }));
  check("a fill loop bound to a value source is clean", clean({ type: "loop", locator: LOCATOR, valueSource: { type: "runtimeInput", value: "v" }, config: { loopType: "elements", loopActionType: "fill" } }));
  check("a customFlow loop naming no flow is invalid", has({ type: "loop", config: { loopType: "fixedCount", iterationCount: 2, loopActionType: "customFlow" } }, "missingRequiredValue"));

  const unknownLoopType = stepWithRawConfig({ type: "loop", locator: LOCATOR, config: { iterationCount: 2 } }, "loopType", "sideways");
  const unknownLoopAction = stepWithRawConfig({ type: "loop", locator: LOCATOR, config: { loopType: "elements" } }, "loopActionType", "juggle");
  check("an unknown loopType is reported", codesForCompleteStep(unknownLoopType).includes("unsupportedConfiguration"));
  check("an unknown loopActionType is reported", codesForCompleteStep(unknownLoopAction).includes("unsupportedConfiguration"));

  // The bounds rule keeps its own job; presence and range must not double-report.
  const zeroCount = codesFor({ type: "loop", locator: LOCATOR, config: { loopType: "fixedCount", iterationCount: 0, loopActionType: "click" } });
  check("iterationCount 0 reports invalidLoopBounds, not a missing source", zeroCount.includes("invalidLoopBounds") && !zeroCount.includes("missingRequiredValue"), zeroCount.join(", "));

  check(`there are ${LOOP_TYPES.length} loop types and ${LOOP_ACTION_TYPES.length} actions`, LOOP_TYPES.length === 3 && LOOP_ACTION_TYPES.length === 5);
  const rawLoopType = stepWithRawConfig({ type: "loop" }, "loopType", "bogus");
  const rawLoopAction = stepWithRawConfig({ type: "loop" }, "loopActionType", "bogus");
  check("an unknown loopType resolves to fixedCount, matching the executor", resolveLoopType(rawLoopType) === "fixedCount");
  check("an unknown loopActionType resolves to click, matching the executor", resolveLoopAction(rawLoopAction) === "click");
}

/* ------------------------------------------------------------------ *
 * 3. A customFlow loop's target is a flow reference like any other
 * ------------------------------------------------------------------ */
console.log("\nLoop child-flow references");
{
  const loopFlow = (targetFlowId: string): FlowProfile => ({
    id: "parent",
    name: "parent",
    version: 1,
    nodes: [
      { id: "n-start", type: "start", name: "Start" },
      { id: "n-loop", type: "loop", name: "Loop", config: { loopType: "fixedCount", iterationCount: 2, loopActionType: "customFlow", targetFlowId } },
      { id: "n-end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e1", source: "n-start", target: "n-loop", type: "success" },
      { id: "e2", source: "n-loop", target: "n-end", type: "success" }
    ]
  });
  const child: FlowProfile = {
    id: "child",
    name: "child",
    version: 1,
    nodes: [
      { id: "c-start", type: "start", name: "Start" },
      { id: "c-end", type: "end", name: "End" }
    ],
    edges: [{ id: "ce", source: "c-start", target: "c-end", type: "success" }]
  };
  const resolvable = validateFlowSet([loopFlow("child"), child]);
  check("a loop whose child flow exists is clean", resolvable.reports.every((r) => r.issues.length === 0), resolvable.reports.flatMap((r) => r.issues.map((i) => i.message)).join(" | "));
  const missing = validateFlowSet([loopFlow("ghost"), child]);
  check("a loop naming a flow that does not exist is reported", missing.reports.some((r) => r.issues.some((i) => i.code === "missingFlowReference")));
  // Without a flow set there is nothing to resolve against, so it must NOT guess.
  check("with no reference context the loop target is not guessed at", !validateFlowDefinition(loopFlow("ghost")).issues.some((i) => i.code === "missingFlowReference"));
}

/* ------------------------------------------------------------------ *
 * 4. No collateral relaxation
 * ------------------------------------------------------------------ */
console.log("\nNo collateral relaxation");
{
  // The flat tables are untouched, so the three-way parity guard in verify:validation still holds.
  check("STEP_REQUIREMENTS still declares scroll as requiresValue", STEP_REQUIREMENTS.scroll.requiresValue === true);
  check("STEP_REQUIREMENTS still declares loop as requiresValue", STEP_REQUIREMENTS.loop.requiresValue === true);
  check("STEP_REQUIREMENTS still declares neither as requiring a locator at type level", !STEP_REQUIREMENTS.scroll.requiresLocator && !STEP_REQUIREMENTS.loop.requiresLocator);

  // A bare probe of each must still report, which is what `verify:validation`'s value-type sweep asserts.
  check("a bare scroll still reports missingRequiredValue", has({ type: "scroll" }, "missingRequiredValue"));
  check("a bare loop still reports missingRequiredValue", has({ type: "loop" }, "missingRequiredValue"));

  // Other value-requiring types must not have picked up a config channel.
  const smuggled: FlowProfile = {
    id: "f",
    name: "f",
    version: 1,
    nodes: [{ id: "s", type: "fill", name: "Fill", locator: LOCATOR, config: { scrollAmount: 100, iterationCount: 3 } }],
    edges: []
  };
  check(
    "a fill is NOT satisfied by scrollAmount or iterationCount",
    validateFlowDefinition(smuggled).issues.some((i) => i.code === "missingRequiredValue" && i.nodeId === "s")
  );
}

/* ------------------------------------------------------------------ *
 * 5. The generated corpus — where this rule found a real defect
 * ------------------------------------------------------------------ */
/*
 * The random generator emitted `loopActionType: "click"` with NO locator (the catalog marks the type
 * as needing none, which is true for a scroll- or customFlow-action loop), and picked
 * `scrollTarget: "element"` half the time with nothing to scroll to. Every such node was dead: the
 * loop iterated doing nothing and the scroll wheeled the page. Nothing reported it until the
 * step-level contracts started checking, so the corpus is asserted clean here as well as in
 * `verify:validation`, with the specific node types named.
 */
console.log("\nThe generated corpus contains no dead loop or scroll nodes");
{
  const constraints = resolveConstraints({ seed: "awkit-loop-scroll", recorderFidelity: true, minNodesPerFlow: 6, maxNodesPerFlow: 16 });
  const corpus: FlowProfile[] = [];
  for (const pattern of ALL_FLOW_PATTERNS) {
    for (let index = 0; index < 4; index += 1) {
      corpus.push(
        generateFlow({
          flowId: `ls-${pattern}-${index}`,
          flowName: `LS ${pattern} ${index}`,
          rng: new SeededRandom(`awkit-loop-scroll::${pattern}-${index}`),
          constraints,
          referenceableFlowIds: corpus.map((p) => p.id).slice(0, 3),
          pattern
        }).profile
      );
    }
  }
  // Cardinality first: an empty corpus would make every assertion below pass vacuously.
  const loopNodes = corpus.flatMap((p) => p.nodes.filter((s) => s.type === "loop"));
  const scrollNodes = corpus.flatMap((p) => p.nodes.filter((s) => s.type === "scroll"));
  check(`the corpus actually contains loop and scroll nodes (${loopNodes.length} / ${scrollNodes.length})`, loopNodes.length > 0 && scrollNodes.length > 0);

  const deadLoops = loopNodes.filter((s) => LOOP_ACTIONS_NEEDING_A_TARGET.has(resolveLoopAction(s)) && s.locator === undefined);
  check("no generated loop acts on a target it does not have", deadLoops.length === 0, `${deadLoops.length} dead loop node(s)`);
  const deadScrolls = scrollNodes.filter((s) => scrollTargetsElement(s) && s.locator === undefined);
  check("no generated scroll targets an element it does not have", deadScrolls.length === 0, `${deadScrolls.length} dead scroll node(s)`);

  const set = validateFlowSet(corpus);
  const dirty = set.reports.filter((r) => r.issues.length > 0);
  check(`all ${corpus.length} generated flows validate clean`, dirty.length === 0, dirty.slice(0, 3).map((r) => `${r.flowId}: ${r.issues.map((i) => i.code).join(",")}`).join(" | "));
}

/* ------------------------------------------------------------------ *
 * 6. Round-trip and the designer panel
 * ------------------------------------------------------------------ */
console.log("\nRound-trip and the properties panel");
{
  const roundTrip = (step: FlowStep): FlowStep => {
    const data = fromFlowStep(step);
    const node: FlowDesignerNode = { id: step.id, type: "flowNode", position: step.position ?? { x: 0, y: 0 }, data };
    return toFlowStep(node, []);
  };

  const savedScroll = roundTrip({ id: "s", type: "scroll", name: "Scroll", config: { scrollTarget: "page", scrollDirection: "up", scrollAmount: 250 } });
  check("reload preserves the scroll amount and direction", savedScroll.config?.scrollAmount === 250 && savedScroll.config?.scrollDirection === "up");
  check("the reloaded scroll validates clean", clean({ type: "scroll", config: savedScroll.config }));

  const savedLoop = roundTrip({ id: "l", type: "loop", name: "Loop", locator: LOCATOR, config: { loopType: "elements", loopActionType: "click", iterationCount: 4 } });
  check("reload preserves the loop type and action", savedLoop.config?.loopType === "elements" && savedLoop.config?.loopActionType === "click");
  check("reload preserves the loop locator", savedLoop.locator?.value === "#row", JSON.stringify(savedLoop.locator));
  check("the reloaded loop validates clean", clean({ type: "loop", locator: savedLoop.locator, config: savedLoop.config }));

  const scrollDef = getNodeDefinition("scroll");
  const loopDef = getNodeDefinition("loop");
  const dataFor = (step: StepProbe) => fromFlowStep({ id: "n", name: "N", ...step });

  check("panel: a page scroll shows no inline error", scrollDef.validate(dataFor({ type: "scroll", config: { scrollTarget: "page", scrollAmount: 200 } })).length === 0);
  check("panel: a scroll-to-element with no selector shows an error", scrollDef.validate(dataFor({ type: "scroll", config: { scrollTarget: "element" } })).length === 1);
  check("panel: a scroll-to-element WITH a selector shows none", scrollDef.validate(dataFor({ type: "scroll", locator: LOCATOR, config: { scrollTarget: "element" } })).length === 0);

  check("panel: a complete loop shows no inline error", loopDef.validate(dataFor({ type: "loop", locator: LOCATOR, config: { loopType: "elements", loopActionType: "click" } })).length === 0);
  check("panel: a click loop with no selector shows an error", loopDef.validate(dataFor({ type: "loop", config: { loopType: "fixedCount", iterationCount: 2, loopActionType: "click" } })).length === 1);
  check("panel: a fill loop with no value shows an error", loopDef.validate(dataFor({ type: "loop", locator: LOCATOR, config: { loopType: "elements", loopActionType: "fill" } })).length === 1);
  check("panel: a customFlow loop naming no flow shows an error", loopDef.validate(dataFor({ type: "loop", config: { loopType: "fixedCount", iterationCount: 2, loopActionType: "customFlow" } })).length === 1);
  check("panel: the existing fixed-count bound check still fires", loopDef.validate(dataFor({ type: "loop", locator: LOCATOR, config: { loopType: "fixedCount", iterationCount: 0, loopActionType: "click" } })).length === 1);
  // Stale-state transition: the panel validates LIVE data, so choosing an action that needs no
  // target clears the error on that edit.
  const brokenLoop = dataFor({ type: "loop", config: { loopType: "fixedCount", iterationCount: 2, loopActionType: "click" } });
  check("panel: the broken starting state does report an error", loopDef.validate(brokenLoop).length === 1);
  check("panel: switching the action to scroll clears it immediately", loopDef.validate({ ...brokenLoop, loopActionType: "scroll" as const }).length === 0);
}

/* ------------------------------------------------------------------ *
 * 7. A whole flow, and the contracts against the executor
 * ------------------------------------------------------------------ */
console.log("\nContract to runtime parity");
{
  const flow: FlowProfile = {
    id: "ls-flow",
    name: "Loop and scroll",
    version: 1,
    nodes: [
      { id: "n-start", type: "start", name: "Start" },
      { id: "n-scroll", type: "scroll", name: "Scroll", config: { scrollDirection: "down", scrollAmount: 400 } },
      { id: "n-loop", type: "loop", name: "Loop", locator: LOCATOR, config: { loopType: "elements", loopActionType: "click" } },
      { id: "n-end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e1", source: "n-start", target: "n-scroll", type: "success" },
      { id: "e2", source: "n-scroll", target: "n-loop", type: "success" },
      { id: "e3", source: "n-loop", target: "n-end", type: "success" }
    ]
  };
  const blocking = executionBlockingErrorsOf(validateFlowDefinition(flow));
  check("a configured loop-and-scroll flow has no blocking errors", blocking.length === 0, blocking.map((i) => i.message).join(" | "));

  const executor = readFileSync(resolve(repoRoot, "src/runner/StepExecutor.ts"), "utf8");
  // Scroll: the two branches and the amount precedence.
  check("the scroll arm still reads cfg.scrollAmount before the value", /scrollAmount \?\? Number\(\(await this\.resolveStepValue\(step, step\.value\)\) \|\| 500\)/.test(executor));
  check("the scroll arm still gates the element branch on BOTH target and locator", /cfg\.scrollTarget === "element" && step\.locator/.test(executor));
  // Loop: the source selection and the `if (target)` guards that make a missing locator silent.
  check("executeLoop still defaults loopType to fixedCount", /loopType\s*=\s*cfg\.loopType\s*\?\?\s*"fixedCount"/.test(executor));
  check("executeLoop still defaults the action to click", /actionType\s*=\s*cfg\.loopActionType\s*\?\?\s*"click"/.test(executor));
  check("an elements loop still counts zero without a locator", /count = step\.locator \? await this\.locatorFactory\.create\(step\.locator\)\.count\(\) : 0/.test(executor));
  check("performLoopAction still derives a null base without a locator", /const base = step\.locator \? this\.locatorFactory\.create\(step\.locator\) : null/.test(executor));

  const performBody = executor.slice(executor.indexOf("private async performLoopAction("));
  const actionBody = performBody.slice(0, performBody.indexOf("private async takeScreenshot("));
  // Capture permissively, validate strictly: a restrictive pattern would miss a NEW action arm.
  const arms = [...actionBody.matchAll(/case\s+"([^"]*)":/g)].map((m) => m[1]);
  const declared = new Set<string>(LOOP_ACTION_TYPES);
  check(`performLoopAction dispatches on exactly ${declared.size} actions`, arms.length === declared.size, arms.join(", "));
  check("no executor arm is missing from the contract", arms.every((a) => declared.has(a)), arms.filter((a) => !declared.has(a)).join(", "));
  check("no declared action is missing an executor arm", [...declared].every((a) => arms.includes(a)), [...declared].filter((a) => !arms.includes(a)).join(", "));
  // Each target-needing arm must still be the guarded kind — that guard IS the silent failure.
  check("the click/delete arm is still guarded by `if (target)`", /case "delete":[\s\S]{0,120}if \(target\) await target\.click/.test(actionBody));
  check("the fill arm is still guarded by `if (target)`", /case "fill":[\s\S]{0,200}if \(target\) \{/.test(actionBody));
  check("the scroll arm still needs no target", /case "scroll":[\s\S]{0,160}activePage\.mouse\.wheel/.test(actionBody));
  check("the customFlow arm is still guarded by its targetFlowId", /case "customFlow":[\s\S]{0,260}if \(targetFlowId && this\.runChildFlow\)/.test(actionBody));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
