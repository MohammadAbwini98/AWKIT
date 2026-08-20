/**
 * Wait-step validation contract — focused regression verifier.
 * Run with: npx tsx scripts/verify-wait-validation.mts
 *
 * THE DEFECT THIS EXISTS FOR: a Fixed time Wait carrying `Duration (ms) = 2000` was reported as
 *   "Step Wait (…) (wait) requires a value or value source."
 * and a flow holding two of them showed "Draft — not runnable (2)". `STEP_REQUIREMENTS` answers one
 * requirement per step *type*, but the `wait` node is five different steps behind one type literal:
 * its flat `requiresValue: true` row demanded a value from every subtype — including the three that
 * take no value at all — while `selector`, which cannot run without a locator, was checked for
 * neither. `WaitStepContract` refines the requirement by subtype; this file is its proof.
 *
 * Every subtype gets a POSITIVE control (the defect must be reported) and a NEGATIVE control (a
 * correct configuration must come back clean). Positive controls alone would be satisfied by a
 * validator that rejects everything — which is what the broken rule effectively did for waits.
 *
 * The contract is asserted against the RUNTIME's own dispatch (`StepExecutor.executeWait`), not
 * against the table: a source-level check reads the executor's switch arms so the validator cannot
 * drift from the only thing that runs these steps.
 *
 * Pure: no browser, no Electron, no filesystem writes (it reads source for the drift check).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { FlowEdge, FlowProfile, FlowStep, StepLocator, WaitCondition } from "@src/profiles/FlowProfile";
import { executionBlockingErrorsOf, validateFlowDefinition, type FlowValidationCode, type FlowValidationIssue } from "@src/validation/FlowValidator";
import { STEP_REQUIREMENTS } from "@src/validation/StepRequirements";
import { WAIT_STEP_TYPES, isUsableWaitDuration, waitStepContractFor } from "@src/validation/WaitStepContract";
import { MAX_WAIT_CONDITION_DEPTH, WAIT_CONDITION_TYPES, waitConditionLabel } from "@src/validation/WaitConditionContract";
import { PreRunValidator, isRunBlocked } from "@src/reports/PreRunValidator";
import { scenarioForFlow } from "@src/testing/oracle/TestExecutionOracle";
import { fromFlowStep, toFlowStep, type FlowDesignerNode } from "../app/renderer/components/workflow/flowProfileMapping";
import { getNodeDefinition } from "../app/renderer/components/workflow/flowNodeRegistry";

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

const LOCATOR: StepLocator = { strategy: "css", value: "#spinner", resolution: "resolved", resolvedBy: "user" };

/** Codes reported against a single wait node, validated through the real engine. */
function codesFor(step: Partial<FlowStep>): FlowValidationCode[] {
  const flow: FlowProfile = {
    id: "wait-probe",
    name: "wait probe",
    version: 1,
    nodes: [{ id: "w", type: "wait", name: "Wait", ...step } as FlowStep],
    edges: []
  };
  return validateFlowDefinition(flow).issues.filter((issue) => issue.nodeId === "w").map((issue) => issue.code);
}

const has = (step: Partial<FlowStep>, code: FlowValidationCode): boolean => codesFor(step).includes(code);
const clean = (step: Partial<FlowStep>): boolean => codesFor(step).length === 0;

/* ------------------------------------------------------------------ *
 * 1. Fixed time — the reported defect
 * ------------------------------------------------------------------ */
console.log("\nFixed time waits");
{
  check("a Fixed time wait with Duration (ms) 2000 is valid", clean({ config: { waitType: "time" }, timeoutMs: 2000 }));
  check(
    "…and specifically reports no missingRequiredValue (the defect message)",
    !has({ config: { waitType: "time" }, timeoutMs: 2000 }, "missingRequiredValue"),
    codesFor({ config: { waitType: "time" }, timeoutMs: 2000 }).join(", ")
  );
  // `executeWait` defaults an absent `config.waitType` to "time", so a bare wait node must too.
  check("a wait with no explicit waitType and a duration is valid (default subtype)", clean({ timeoutMs: 2000 }));
  check("a Fixed time wait whose duration is a literal value is valid", clean({ config: { waitType: "time" }, value: "2000" }));
  check(
    "a Fixed time wait bound to a value source is valid (duration resolves at run time)",
    clean({ config: { waitType: "time" }, valueSource: { type: "runtimeInput", value: "delay" } })
  );

  // Negative controls — meaningful validation must survive the fix.
  check("a Fixed time wait with NO duration at all is invalid", has({ config: { waitType: "time" } }, "missingRequiredValue"));
  check("a Fixed time wait with duration 0 is invalid", has({ config: { waitType: "time" }, timeoutMs: 0 }, "invalidTimeout"));
  check("a Fixed time wait with a negative duration is invalid", has({ config: { waitType: "time" }, timeoutMs: -1 }, "invalidTimeout"));
  check("a Fixed time wait with a NaN duration is invalid", has({ config: { waitType: "time" }, timeoutMs: Number.NaN }, "invalidTimeout"));
  check(
    "a Fixed time wait with an infinite duration is invalid",
    has({ config: { waitType: "time" }, timeoutMs: Number.POSITIVE_INFINITY }, "invalidTimeout")
  );
  // `Number("soon")` is NaN and `page.waitForTimeout(NaN)` is not a wait — caught before the browser opens.
  check("a Fixed time wait with a non-numeric literal duration is invalid", has({ config: { waitType: "time" }, value: "soon" }, "invalidTimeout"));
  check("a Fixed time wait with a negative literal duration is invalid", has({ config: { waitType: "time" }, value: "-5" }, "invalidTimeout"));
  check("a Fixed time wait with a zero literal duration is invalid", has({ config: { waitType: "time" }, value: "0" }, "invalidTimeout"));

  // One defect, one issue: an unusable `timeoutMs` must not ALSO count as a missing duration, or the
  // designer's "not runnable (N)" badge double-counts a single mistake.
  check(
    "an unusable duration reports exactly one issue, not two",
    codesFor({ config: { waitType: "time" }, timeoutMs: -1 }).length === 1,
    codesFor({ config: { waitType: "time" }, timeoutMs: -1 }).join(", ")
  );
}

/* ------------------------------------------------------------------ *
 * 2. The other four subtypes keep their real requirements
 * ------------------------------------------------------------------ */
console.log("\nOther wait subtypes stay strict");
{
  // `executeWait` case "selector" calls `locatorFactory.create(step.locator)`, which throws
  // "Locator is required for this step." on undefined — so the gate must demand one.
  check("a Selector visible wait with a locator is valid", clean({ config: { waitType: "selector" }, locator: LOCATOR }));
  check("a Selector visible wait with NO locator is invalid", has({ config: { waitType: "selector" } }, "missingRequiredLocator"));
  check(
    "a Selector visible wait is NOT satisfied by a value standing in for the locator",
    has({ config: { waitType: "selector" }, value: "#spinner" }, "missingRequiredLocator")
  );

  check("a Text visible wait naming its text is valid", clean({ config: { waitType: "textVisible" }, value: "Saved" }));
  check("a Text visible wait with no text is invalid", has({ config: { waitType: "textVisible" } }, "missingRequiredValue"));
  // The regression the first draft of this fix introduced: `timeoutMs` is how long a textVisible wait
  // may look, not what it looks for, so it must NOT satisfy the text requirement.
  check(
    "a Text visible wait is NOT satisfied by a timeout standing in for the text",
    has({ config: { waitType: "textVisible" }, timeoutMs: 5000 }, "missingRequiredValue")
  );
  check(
    "a Text visible wait bound to a value source is valid",
    clean({ config: { waitType: "textVisible" }, valueSource: { type: "runtimeInput", value: "toast" } })
  );

  // `waitForLoadState` takes no step input at all; demanding one was a pure false positive.
  check("a Navigation wait needs no value and no locator", clean({ config: { waitType: "navigation" } }));
  check("a Network idle wait needs no value and no locator", clean({ config: { waitType: "networkIdle" } }));

  // An unknown literal falls through `executeWait`'s `default:` arm into the fixed-time branch.
  check(
    "an unrecognised waitType is validated as fixed time, matching the executor's default arm",
    clean({ config: { waitType: "bogus" as never }, timeoutMs: 2000 })
  );
}

/* ------------------------------------------------------------------ *
 * 3. No generic requirement leaks back in; other step types untouched
 * ------------------------------------------------------------------ */
console.log("\nNo generic value requirement, and no collateral relaxation");
{
  check(
    "a Fixed time wait needs neither value, valueSource, locator nor comparison value",
    clean({ config: { waitType: "time" }, timeoutMs: 2000 })
  );

  // The fix must not have relaxed the flat rule for genuinely value-based types.
  const valueTypes = (Object.keys(STEP_REQUIREMENTS) as Array<keyof typeof STEP_REQUIREMENTS>).filter(
    (type) => STEP_REQUIREMENTS[type].requiresValue && type !== "wait"
  );
  const escaped = valueTypes.filter((type) => {
    const flow: FlowProfile = { id: `v-${type}`, name: "v", version: 1, nodes: [{ id: "s", type, name: String(type) } as FlowStep], edges: [] };
    return !validateFlowDefinition(flow).issues.some((issue) => issue.code === "missingRequiredValue" && issue.nodeId === "s");
  });
  check(`all ${valueTypes.length} other value-requiring types still report missingRequiredValue`, escaped.length === 0, escaped.join(", "));

  // …and the table itself is untouched, so the three-way parity guard in verify:validation still holds.
  check("STEP_REQUIREMENTS still declares wait as requiresValue (subtype refinement is not table drift)", STEP_REQUIREMENTS.wait.requiresValue === true);
  check("STEP_REQUIREMENTS still declares wait as not requiring a locator at the type level", STEP_REQUIREMENTS.wait.requiresLocator === false);
}

/* ------------------------------------------------------------------ *
 * 4. Two Fixed time waits in one flow — the reported screenshot
 * ------------------------------------------------------------------ */
console.log("\nThe reported flow: Start → Action → Wait → Action → Wait → End");
{
  const edge = (id: string, source: string, target: string): FlowEdge => ({ id, source, target, type: "success" });
  const flow: FlowProfile = {
    id: "two-fixed-waits",
    name: "Two fixed-time waits",
    version: 1,
    nodes: [
      { id: "n-start", type: "start", name: "Start" },
      { id: "n-goto", type: "goto", name: "Open URL", url: "http://127.0.0.1:4173/index.html" },
      // Both named "Wait", which is what made the reported messages read "Wait (n-…)".
      { id: "n-wait-1", type: "wait", name: "Wait", config: { waitType: "time" }, timeoutMs: 2000 },
      { id: "n-click", type: "click", name: "Click", locator: LOCATOR },
      { id: "n-wait-2", type: "wait", name: "Wait", config: { waitType: "time" }, timeoutMs: 2000 },
      { id: "n-end", type: "end", name: "End" }
    ],
    edges: [
      edge("e1", "n-start", "n-goto"),
      edge("e2", "n-goto", "n-wait-1"),
      edge("e3", "n-wait-1", "n-click"),
      edge("e4", "n-click", "n-wait-2"),
      edge("e5", "n-wait-2", "n-end")
    ]
  };
  const report = validateFlowDefinition(flow);
  const waitIssues = report.issues.filter((issue) => issue.nodeId === "n-wait-1" || issue.nodeId === "n-wait-2");
  check("two valid Fixed time waits produce 0 wait validation errors", waitIssues.length === 0, waitIssues.map((i) => i.message).join(" | "));

  // The badge is derived from exactly this count, so "Draft — not runnable (2)" cannot come back.
  const blocking = executionBlockingErrorsOf(report);
  check("the designer's blocking count is 0, so the chip reads Runnable", blocking.length === 0, blocking.map((i) => i.message).join(" | "));

  // The run gate must agree with the designer — one contract, not two.
  const gateIssues = new PreRunValidator().validate({ scenario: scenarioForFlow(flow), flows: [flow] });
  check("the pre-run gate does not block the same flow", !isRunBlocked(gateIssues), gateIssues.map((i) => i.message).join(" | "));
}

/* ------------------------------------------------------------------ *
 * 5. Persistence round-trip through the designer's own mapping
 * ------------------------------------------------------------------ */
console.log("\nPersistence round-trip (save → reload → reopen → validate)");
{
  const roundTrip = (step: FlowStep): FlowStep => {
    const data = fromFlowStep(step);
    const node: FlowDesignerNode = { id: step.id, type: "flowNode", position: step.position ?? { x: 0, y: 0 }, data } as FlowDesignerNode;
    return toFlowStep(node, []);
  };

  const saved = roundTrip({ id: "w", type: "wait", name: "Wait", config: { waitType: "time" }, timeoutMs: 2000 });
  check("reload preserves waitType = time", saved.config?.waitType === "time", String(saved.config?.waitType));
  check("reload preserves the 2000ms duration", saved.timeoutMs === 2000, String(saved.timeoutMs));
  check("reload introduces no value", saved.value === undefined, String(saved.value));
  check("reload introduces no valueSource", saved.valueSource === undefined, JSON.stringify(saved.valueSource));
  check("the reloaded step still validates clean", clean({ config: saved.config, timeoutMs: saved.timeoutMs, value: saved.value }));

  // Editing the duration must survive the round trip too.
  const edited = roundTrip({ id: "w", type: "wait", name: "Wait", config: { waitType: "time" }, timeoutMs: 3000 });
  check("an edited duration (2000 → 3000) persists", edited.timeoutMs === 3000, String(edited.timeoutMs));
  check("the edited step still validates clean", clean({ config: edited.config, timeoutMs: edited.timeoutMs }));

  // Unknown wait metadata must not be dropped on the way through the designer.
  const withExtras = roundTrip({
    id: "w",
    type: "wait",
    name: "Wait",
    config: { waitType: "time" },
    timeoutMs: 2000,
    afterWaits: [{ type: "domStable", stableForMs: 500 }],
    retry: { count: 2, delayMs: 250 }
  });
  check("round-trip preserves afterWaits on a wait node", withExtras.afterWaits?.[0]?.type === "domStable", JSON.stringify(withExtras.afterWaits));
  check("round-trip preserves retry policy on a wait node", withExtras.retry?.count === 2, JSON.stringify(withExtras.retry));
}

/* ------------------------------------------------------------------ *
 * 6. The properties panel agrees with the gate (invalid → valid clears)
 * ------------------------------------------------------------------ */
console.log("\nDesigner properties panel reads the same contract");
{
  const definition = getNodeDefinition("wait");
  const dataFor = (step: Partial<FlowStep>) => fromFlowStep({ id: "w", type: "wait", name: "Wait", ...step } as FlowStep);

  check("panel: a Fixed time wait with 2000ms shows no inline error", definition.validate(dataFor({ config: { waitType: "time" }, timeoutMs: 2000 })).length === 0);
  check("panel: a Navigation wait shows no inline error", definition.validate(dataFor({ config: { waitType: "navigation" } })).length === 0);
  check("panel: a Network idle wait shows no inline error", definition.validate(dataFor({ config: { waitType: "networkIdle" } })).length === 0);
  check("panel: a Selector visible wait with no selector shows an error", definition.validate(dataFor({ config: { waitType: "selector" } })).length === 1);
  check(
    "panel: a Selector visible wait is not excused by text in the value box",
    definition.validate(dataFor({ config: { waitType: "selector" }, value: "#spinner" })).length === 1
  );
  check("panel: a Text visible wait with no text shows an error", definition.validate(dataFor({ config: { waitType: "textVisible" } })).length === 1);
  check("panel: a Text visible wait naming its text shows no error", definition.validate(dataFor({ config: { waitType: "textVisible" }, value: "Saved" })).length === 0);

  // Stale-state transition: the panel validates the LIVE edited data, so switching a broken wait to
  // Fixed time / 2000 clears the error on that edit — no save, reload or reselect required.
  const broken = dataFor({ config: { waitType: "selector" } });
  check("panel: the broken starting state does report an error", definition.validate(broken).length === 1);
  const repaired = { ...broken, waitType: "time" as const, timeoutMs: 2000 };
  check("panel: editing it to Fixed time / 2000 clears the error immediately", definition.validate(repaired).length === 0, definition.validate(repaired).join(" | "));
  // …and the engine, which drives the badge, agrees about the very same edit.
  check("engine: the repaired configuration is clean too", clean({ config: { waitType: "time" }, timeoutMs: 2000 }));
}

/* ------------------------------------------------------------------ *
 * 7. The contract matches the executor that runs these steps
 * ------------------------------------------------------------------ */
console.log("\nContract to runtime parity");
{
  const executor = readFileSync(resolve(repoRoot, "src/runner/StepExecutor.ts"), "utf8");
  const body = executor.slice(executor.indexOf("private async executeWait("));
  const waitBody = body.slice(0, body.indexOf("private async executeAssertion("));

  // Capture permissively, validate strictly: a restrictive pattern would silently miss a NEW arm,
  // which is exactly the drift this check exists to catch.
  const arms = [...waitBody.matchAll(/case\s+"([^"]*)":/g)].map((match) => match[1]);
  const declared = new Set<string>(WAIT_STEP_TYPES);
  // Exact set equality, both directions. A subset check either way passes vacuously: "every arm is
  // declared" is satisfied by deleting an arm, and "every subtype has an arm" by adding a stray one.
  const unknownArms = arms.filter((arm) => !declared.has(arm));
  const undispatched = [...declared].filter((type) => !arms.includes(type));
  check(`executeWait dispatches on exactly ${declared.size} arms, one per declared subtype`, arms.length === declared.size, arms.join(", "));
  check("no executor arm is missing from the contract", unknownArms.length === 0, unknownArms.join(", "));
  check("no declared subtype is missing an executor arm", undispatched.length === 0, undispatched.join(", "));
  // `time` shares its body with `default:`, which is what makes an unrecognised literal a fixed-time wait.
  check("the fixed-time arm is also the default arm", /case\s+"time":\s+default:/.test(waitBody));

  check("the executor still defaults an absent waitType to time", /waitType\s*=\s*step\.config\?\.waitType\s*\?\?\s*"time"/.test(waitBody));
  check("the selector arm still resolves step.locator", /case\s+"selector":[\s\S]{0,200}locatorFactory\.create\(step\.locator\)/.test(waitBody));
  check("the fixed-time arm still reads value then timeoutMs", /waitForTimeout\(Number\(\(await this\.resolveStepValue\(step, step\.value\)\) \|\| step\.timeoutMs/.test(waitBody));

  check("the contract covers every declared subtype", WAIT_STEP_TYPES.every((type) => waitStepContractFor(type).waitType === type));
  check("selector is the only locator-requiring subtype", WAIT_STEP_TYPES.filter((type) => waitStepContractFor(type).requiresLocator).join(",") === "selector");
  check(
    "time and textVisible are the only input-requiring subtypes",
    WAIT_STEP_TYPES.filter((type) => waitStepContractFor(type).requiresValue).slice().sort().join(",") === "textVisible,time"
  );
  check(
    "the duration predicate rejects 0, negatives, NaN and Infinity",
    ![0, -1, Number.NaN, Number.POSITIVE_INFINITY].some((v) => isUsableWaitDuration(v)) && isUsableWaitDuration(2000)
  );
}

/* ------------------------------------------------------------------ *
 * 8. Smart Wait CONDITION structural contract (awkit-jtok)
 * ------------------------------------------------------------------ */
/*
 * A different defect from sections 1-7: those are about the wait STEP NODE, this is about the
 * `WaitCondition` entries in a step's `beforeWaits`/`afterWaits`. The engine checked them for
 * TIMEOUTS ONLY, so a condition missing the fields its own type requires was admitted by the run
 * gate and then either threw with the browser already open or - the worse half - passed vacuously.
 *
 * Severity is asserted against the RUNTIME's own optional handling, not against a preference:
 * `runRequiredOrOptional` swallows an optional condition's failure and re-throws a required one.
 */
console.log("\nSmart Wait condition structural contract");
{
  const conditionIssues = (waits: unknown[]): FlowValidationIssue[] => {
    const flow: FlowProfile = {
      id: "cond-probe",
      name: "cond probe",
      version: 1,
      nodes: [{ id: "s", type: "click", name: "Click", locator: LOCATOR, afterWaits: waits as WaitCondition[] } as FlowStep],
      edges: []
    };
    return validateFlowDefinition(flow).issues.filter((i) => i.nodeId === "s");
  };
  const codesOf = (waits: unknown[]): string[] => conditionIssues(waits).map((i) => i.code);
  const reports = (wait: unknown): boolean => codesOf([wait]).includes("invalidWaitCondition");
  const cleanCondition = (wait: unknown): boolean => conditionIssues([wait]).length === 0;

  // --- Positive controls: every type that genuinely requires a field ---
  check("loaderHidden with no locator is reported", reports({ type: "loaderHidden" }));
  check("elementVisible with no locator is reported", reports({ type: "elementVisible" }));
  check("elementHidden with no locator is reported", reports({ type: "elementHidden" }));
  check("elementEnabled with no locator is reported", reports({ type: "elementEnabled" }));
  check("textVisible with no text is reported", reports({ type: "textVisible" }));
  check("tableHasRows with no table is reported", reports({ type: "tableHasRows", minRows: 1 }));
  check("listHasItems with no list is reported", reports({ type: "listHasItems", minItems: 1 }));
  check("fixedDelay with no delayMs is reported", reports({ type: "fixedDelay" }));
  check("apiPolling with no urlContains is reported", reports({ type: "apiPolling" }));
  check("anyOf with no branches is reported", reports({ type: "anyOf", conditions: [] }));
  check("an unknown condition type is reported", reports({ type: "elementSparkles" }));

  // --- The VACUOUS half: conditions that pass without ever waiting ---
  // These are the dangerous ones - nothing looks wrong, the wait just never happens.
  check("urlChanged naming neither matcher is reported (returns true on the first poll)", reports({ type: "urlChanged" }));
  check("response matching nothing is reported (resolves on any first response)", reports({ type: "response" }));
  check("textVisible with an empty string is reported (getByText('') matches everything)", reports({ type: "textVisible", text: "" }));
  // A PRESENT-but-empty locator is the designer-scaffold shape; `create()` only throws on undefined.
  check("a present-but-empty locator is reported, not just an absent one", reports({ type: "elementVisible", locator: { strategy: "css", value: "" } }));

  // --- Bounds ---
  check("tableHasRows expecting 0 rows is reported", reports({ type: "tableHasRows", tableLocator: LOCATOR, minRows: 0 }));
  check("listHasItems expecting a fractional count is reported", reports({ type: "listHasItems", listLocator: LOCATOR, minItems: 1.5 }));
  check("fixedDelay with a negative delay is reported (Math.max clamps it to a no-op)", reports({ type: "fixedDelay", delayMs: -5 }));
  check("a malformed response status range is reported", reports({ type: "response", urlContains: "/a", statusRange: [299, 200] }));

  // --- Configuration pairs that silently do nothing ---
  check("apiPolling naming a response field with no terminal values is reported", reports({ type: "apiPolling", urlContains: "/j", responseField: "status" }));
  check("apiPolling listing terminal values with no field is reported", reports({ type: "apiPolling", urlContains: "/j", terminalValues: ["done"] }));
  check("mustAppear with no appearance grace is reported", reports({ type: "loaderHidden", locator: LOCATOR, mustAppear: true }));
  check("an unknown stream transport is reported", reports({ type: "streamActivity", transport: "carrier-pigeon" }));

  // --- Negative controls: correct conditions must stay clean ---
  const GOOD: unknown[] = [
    { type: "elementVisible", locator: LOCATOR },
    { type: "elementHidden", locator: LOCATOR },
    { type: "elementEnabled", locator: LOCATOR },
    { type: "loaderHidden", locator: LOCATOR },
    { type: "loaderHidden", locator: LOCATOR, appearanceGraceMs: 1500, mustAppear: true, completion: "detached" },
    { type: "textVisible", text: "Saved" },
    // `toastVisible` genuinely requires nothing - it falls back to `getByRole('alert')`.
    { type: "toastVisible" },
    { type: "toastVisible", locator: LOCATOR },
    { type: "response", urlContains: "/api/x" },
    { type: "response", method: "POST" },
    { type: "tableHasRows", tableLocator: LOCATOR, minRows: 1 },
    { type: "listHasItems", listLocator: LOCATOR, minItems: 3 },
    { type: "urlChanged", urlContains: "/done" },
    { type: "urlChanged", fromUrl: "/start" },
    // `domStable` and the optional bounds all have documented runtime defaults.
    { type: "domStable" },
    { type: "domStable", stableForMs: 500 },
    { type: "fixedDelay", delayMs: 250 },
    { type: "anyOf", conditions: [{ type: "textVisible", text: "No results" }] },
    { type: "apiPolling", urlContains: "/job" },
    { type: "apiPolling", urlContains: "/job", responseField: "state", terminalValues: ["done"] },
    { type: "streamActivity", transport: "websocket" }
  ];
  const falsePositives = GOOD.filter((wait) => !cleanCondition(wait));
  check(
    `all ${GOOD.length} correctly-configured conditions stay clean`,
    falsePositives.length === 0,
    falsePositives.map((w) => JSON.stringify(w)).join(" | ")
  );

  // --- Severity mirrors runRequiredOrOptional EXACTLY ---
  const severityOf = (wait: unknown): string => conditionIssues([wait]).map((i) => i.severity).join(",");
  check("a REQUIRED malformed condition is an error (the runner re-throws)", severityOf({ type: "elementVisible" }) === "error");
  check("an OPTIONAL malformed condition is a warning (the runner swallows it)", severityOf({ type: "elementVisible", optional: true }) === "warning");
  check(
    "evidence.requirement 'optional' is also a warning",
    severityOf({ type: "elementVisible", evidence: { requirement: "optional" } }) === "warning"
  );
  // The runtime's check is `optional || requirement === 'optional'` - 'advisory' is NOT in it. The
  // Recorder stamps `optional: true` alongside advisory evidence, but a hand-authored advisory
  // condition without that flag really is required at run time, so it must be an error.
  check(
    "a hand-authored 'advisory' with no optional flag is an ERROR, matching the runtime",
    severityOf({ type: "elementVisible", evidence: { requirement: "advisory" } }) === "error"
  );
  check(
    "recorder-stamped advisory (optional: true) is a warning",
    severityOf({ type: "elementVisible", optional: true, evidence: { requirement: "advisory" } }) === "warning"
  );
  // A warning must not block the run, or the severity split would be decorative.
  {
    const flow: FlowProfile = {
      id: "opt-flow",
      name: "opt flow",
      version: 1,
      nodes: [
        { id: "n-start", type: "start", name: "Start" },
        { id: "n-click", type: "click", name: "Click", locator: LOCATOR, afterWaits: [{ type: "elementVisible", optional: true } as WaitCondition] },
        { id: "n-end", type: "end", name: "End" }
      ],
      edges: [
        { id: "e1", source: "n-start", target: "n-click", type: "success" },
        { id: "e2", source: "n-click", target: "n-end", type: "success" }
      ]
    };
    const report = validateFlowDefinition(flow);
    check(
      "a degraded OPTIONAL condition is reported but does NOT block the run",
      executionBlockingErrorsOf(report).length === 0 && report.issues.some((i) => i.code === "degradedWaitCondition")
    );
  }

  // --- Nesting: OR-group branches are validated too, and identified ---
  const nested = conditionIssues([
    { type: "anyOf", conditions: [{ type: "textVisible", text: "ok" }, { type: "tableHasRows", tableLocator: { strategy: "css", value: "" }, minRows: 1 }] }
  ]);
  check("a defect inside an OR-group branch is reported", nested.some((i) => i.code === "invalidWaitCondition"));
  check("…and the message names the offending branch, not just the group", nested.some((i) => i.message.includes("conditions[1]")), nested.map((i) => i.message).join(" | "));
  check("a one-branch OR-group is legal and stays clean", cleanCondition({ type: "anyOf", conditions: [{ type: "domStable" }] }));

  // --- Timeouts have exactly ONE owner, at every depth ---
  // `validateTimeouts` owns them (it also emits `highTimeout`, which the contract has no notion of),
  // so the contract deliberately ignores `timeoutMs`. Both halves are asserted: no duplicate at the
  // top level, and no GAP inside a branch, which nothing checked before this change.
  const topTimeout = codesOf([{ type: "textVisible", text: "ok", timeoutMs: 0 }]);
  check("a bad top-level condition timeout reports exactly one issue", topTimeout.length === 1, topTimeout.join(", "));
  check("…and it is invalidTimeout, not invalidWaitCondition", topTimeout[0] === "invalidTimeout", topTimeout.join(", "));
  const branchTimeout = codesOf([{ type: "anyOf", conditions: [{ type: "textVisible", text: "ok", timeoutMs: 0 }] }]);
  check("a bad timeout INSIDE an OR-group branch is now reported", branchTimeout.includes("invalidTimeout"), branchTimeout.join(", "));
  check("a high branch timeout still warns", codesOf([{ type: "anyOf", conditions: [{ type: "domStable", timeoutMs: 20 * 60_000 }] }]).includes("highTimeout"));

  // --- Both phases, and per-condition anchoring ---
  const bothPhases: FlowProfile = {
    id: "phases",
    name: "phases",
    version: 1,
    nodes: [
      {
        id: "s",
        type: "click",
        name: "Click",
        locator: LOCATOR,
        beforeWaits: [{ type: "elementVisible" } as WaitCondition],
        afterWaits: [{ type: "textVisible" } as WaitCondition]
      } as FlowStep
    ],
    edges: []
  };
  const phaseIssues = validateFlowDefinition(bothPhases).issues.filter((i) => i.code === "invalidWaitCondition");
  check("beforeWaits and afterWaits are BOTH validated", phaseIssues.length === 2, String(phaseIssues.length));
  check(
    "…and each message names its own phase",
    phaseIssues.some((i) => i.message.includes("before-wait[0]")) && phaseIssues.some((i) => i.message.includes("after-wait[0]"))
  );

  // --- Contract covers the whole union ---
  check(`the contract labels all ${WAIT_CONDITION_TYPES.length} declared condition types`, WAIT_CONDITION_TYPES.every((t) => waitConditionLabel(t) !== `"${t}"`));
  check("the declared set matches the union exactly", WAIT_CONDITION_TYPES.length === 15, String(WAIT_CONDITION_TYPES.length));
  // Depth guard: a pathological nest is bounded rather than recursing without limit.
  let deep: unknown = { type: "domStable" };
  for (let i = 0; i <= MAX_WAIT_CONDITION_DEPTH + 2; i += 1) deep = { type: "anyOf", conditions: [deep] };
  check("an over-deep OR-group nest is reported rather than recursed without bound", reports(deep));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
