/**
 * Assertion-step validation contract — focused regression verifier.
 * Run with: npx tsx scripts/verify-assertion-validation.mts
 *
 * THE DEFECT THIS EXISTS FOR — the third instance of one class, after `awkit-3p6x` (the wait node)
 * and `awkit-jtok` (Smart Wait conditions). `STEP_REQUIREMENTS` answers one requirement per step
 * TYPE, and `assertText` is SEVEN assertions behind one type literal. Its flat row was wrong three
 * ways at once:
 *
 *   1. `config.expectedValue` — the box the designer writes and the runtime reads FIRST — was
 *      invisible to `hasRequiredValue`, so an ordinary configured Assert Text node reported
 *      "requires a value or value source". EIGHT of this repo's own fixture flows were flagged by it.
 *   2. `url` and `storage` were required to carry a locator neither ever resolves.
 *   3. `attribute` needs `config.attributeName` and `storage` needs `config.storageKey`, and both
 *      requirements existed ONLY as a throw inside `executeAssertion` — after the browser is open.
 *
 * Every kind gets a POSITIVE control (the defect must be reported) and a NEGATIVE control (a correct
 * configuration must come back clean). The negative controls carry the weight here: this change
 * RELAXES two rules, and the way a relaxation fails is by letting real defects through.
 *
 * The contract is asserted against the RUNTIME's own dispatch (`StepExecutor.executeAssertion`), not
 * against the table, so the validator cannot drift from the only thing that runs these steps.
 *
 * Pure: no browser, no Electron, no filesystem writes (it reads source for the drift check).
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { FlowProfile, FlowStep, StepLocator } from "@src/profiles/FlowProfile";
import { executionBlockingErrorsOf, validateFlowDefinition, type FlowValidationCode } from "@src/validation/FlowValidator";
import { STEP_REQUIREMENTS } from "@src/validation/StepRequirements";
import {
  ASSERTION_KINDS,
  ASSERTION_CONTRACTS,
  COMPARISON_OPERATORS,
  STORAGE_AREAS,
  assertionStepContract,
  resolveAssertionKind
} from "@src/validation/AssertionStepContract";
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

const LOCATOR: StepLocator = { strategy: "css", value: "#el", resolution: "resolved", resolvedBy: "user" };

type AssertionOverrides = Omit<Partial<FlowStep>, "id" | "type" | "name">;

function assertionStep(overrides: AssertionOverrides = {}): FlowStep {
  return { id: "a", type: "assertText", name: "Assert", ...overrides };
}

/** Test-boundary helper for malformed literals that can arrive through imported JSON. */
function setRawProperty(target: object, key: PropertyKey, value: unknown): void {
  if (!Reflect.set(target, key, value)) throw new Error(`Could not inject raw property ${String(key)}`);
}

function assertionStepWithRawConfig(overrides: AssertionOverrides, key: PropertyKey, value: unknown): FlowStep {
  const result = assertionStep({ ...overrides, config: { ...overrides.config } });
  if (!result.config) throw new Error("Raw assertion probe has no config object");
  setRawProperty(result.config, key, value);
  return result;
}

function codesForCompleteStep(step: FlowStep): FlowValidationCode[] {
  const flow: FlowProfile = {
    id: "assert-probe",
    name: "assert probe",
    version: 1,
    nodes: [step],
    edges: []
  };
  return validateFlowDefinition(flow).issues.filter((i) => i.nodeId === "a").map((i) => i.code);
}
function codesFor(step: AssertionOverrides): FlowValidationCode[] {
  return codesForCompleteStep(assertionStep(step));
}
const messagesFor = (step: AssertionOverrides): string[] => {
  const flow: FlowProfile = {
    id: "assert-probe",
    name: "assert probe",
    version: 1,
    nodes: [assertionStep(step)],
    edges: []
  };
  return validateFlowDefinition(flow).issues.filter((i) => i.nodeId === "a").map((i) => i.message);
};
const has = (step: AssertionOverrides, code: FlowValidationCode): boolean => codesFor(step).includes(code);
const clean = (step: AssertionOverrides): boolean => codesFor(step).length === 0;

/* ------------------------------------------------------------------ *
 * 1. The expected value is read from the channel the designer writes
 * ------------------------------------------------------------------ */
console.log("\nExpected value: every channel the runtime reads");
{
  // `resolveStepValue(step, cfg.expectedValue ?? step.value)` — a valueSource wins, then
  // config.expectedValue, then step.value. All three are legal.
  check("config.expectedValue satisfies the value rule (the designer's own channel)", clean({ locator: LOCATOR, config: { assertionType: "text", expectedValue: "Welcome" } }));
  check("step.value still satisfies it", clean({ locator: LOCATOR, value: "Welcome" }));
  check("a valueSource still satisfies it", clean({ locator: LOCATOR, valueSource: { type: "runtimeInput", value: "expected" } }));

  // The reported defect itself.
  check(
    "a configured Assert Text no longer reports missingRequiredValue",
    !has({ locator: LOCATOR, config: { assertionType: "text", expectedValue: "Welcome" } }, "missingRequiredValue")
  );

  // …and the rule is still real.
  check("an assertion with NO expected value anywhere is invalid", has({ locator: LOCATOR, config: { assertionType: "text" } }, "missingRequiredValue"));
  // An empty string is not an expected value: `actual.includes("")` is true for every page, so a
  // `contains` assertion would pass without asserting anything.
  check("an EMPTY expected value is invalid (contains-'' matches any page)", has({ locator: LOCATOR, config: { assertionType: "text", expectedValue: "" } }, "missingRequiredValue"));
  check("a whitespace-only expected value is invalid", has({ locator: LOCATOR, config: { assertionType: "text", expectedValue: "   " } }, "missingRequiredValue"));
  check("the message names the Expected value box, not 'a value or value source'", messagesFor({ locator: LOCATOR, config: { assertionType: "text" } }).some((m) => m.includes("Expected value")));
}

/* ------------------------------------------------------------------ *
 * 2. Locator required only where the runtime resolves one
 * ------------------------------------------------------------------ */
console.log("\nLocator: required by kind, not by type");
{
  // `url` reads `activePage.url()`; `storage` reads through `page.evaluate`. Neither touches
  // `step.locator`, so demanding one was a pure false positive.
  check("a url assertion needs no locator", clean({ config: { assertionType: "url", expectedValue: "/done" } }));
  check("a storage assertion needs no locator", clean({ config: { assertionType: "storage", storageKey: "token", expectedValue: "abc" } }));

  // Everything else does resolve one, so the requirement must survive.
  for (const kind of ["text", "value", "count", "attribute", "visible"] as const) {
    check(
      `a ${kind} assertion with no locator still reports missingRequiredLocator`,
      has({ config: { assertionType: kind, expectedValue: "x", attributeName: "aria-pressed" } }, "missingRequiredLocator")
    );
  }
  // The contract and the runtime must agree on exactly which kinds skip the locator.
  const noLocator = ASSERTION_KINDS.filter((k) => !ASSERTION_CONTRACTS[k].requiresLocator).slice().sort().join(",");
  check("url and storage are the ONLY page-reading kinds", noLocator === "storage,url", noLocator);
}

/* ------------------------------------------------------------------ *
 * 3. Config a kind cannot run without — enforced before the browser opens
 * ------------------------------------------------------------------ */
console.log("\nRequired config fields");
{
  check("an attribute assertion with no attributeName is invalid", has({ locator: LOCATOR, config: { assertionType: "attribute", expectedValue: "true" } }, "missingRequiredValue"));
  check("…and the message names config.attributeName", messagesFor({ locator: LOCATOR, config: { assertionType: "attribute", expectedValue: "true" } }).some((m) => m.includes("config.attributeName")));
  check("a whitespace-only attributeName is invalid (the runtime trims it)", has({ locator: LOCATOR, config: { assertionType: "attribute", attributeName: "  ", expectedValue: "true" } }, "missingRequiredValue"));

  check("a storage assertion with no storageKey is invalid", has({ config: { assertionType: "storage", expectedValue: "abc" } }, "missingRequiredValue"));
  check("…and the message names config.storageKey", messagesFor({ config: { assertionType: "storage", expectedValue: "abc" } }).some((m) => m.includes("config.storageKey")));
  check("a whitespace-only storageKey is invalid", has({ config: { assertionType: "storage", storageKey: " ", expectedValue: "abc" } }, "missingRequiredValue"));

  // Those fields are documented as ignored by every other kind, so requiring them elsewhere would
  // flag correct flows.
  check("a text assertion is NOT asked for an attributeName", clean({ locator: LOCATOR, config: { assertionType: "text", expectedValue: "Hi" } }));
  check("a count assertion is NOT asked for a storageKey", clean({ locator: LOCATOR, config: { assertionType: "count", expectedValue: "3" } }));

  const withField = ASSERTION_KINDS.filter((k) => ASSERTION_CONTRACTS[k].requiredConfigField !== undefined).slice().sort().join(",");
  check("attribute and storage are the ONLY kinds with a required config field", withField === "attribute,storage", withField);
}

/* ------------------------------------------------------------------ *
 * 4. Literals outside their permitted set, and comparisons that cannot pass
 * ------------------------------------------------------------------ */
console.log("\nConfiguration literals");
{
  const unknownKind = assertionStepWithRawConfig({ locator: LOCATOR, config: { expectedValue: "x" } }, "assertionType", "sparkle");
  const unknownOperator = assertionStepWithRawConfig(
    { locator: LOCATOR, config: { assertionType: "text", expectedValue: "x" } },
    "comparisonOperator",
    "roughly"
  );
  const unknownStorageArea = assertionStepWithRawConfig(
    { config: { assertionType: "storage", storageKey: "k", expectedValue: "x" } },
    "storageArea",
    "cloud"
  );
  check("an unknown assertionType is reported", codesForCompleteStep(unknownKind).includes("unsupportedConfiguration"));
  check("an unknown comparisonOperator is reported", codesForCompleteStep(unknownOperator).includes("unsupportedConfiguration"));
  check("an unknown storageArea is reported", codesForCompleteStep(unknownStorageArea).includes("unsupportedConfiguration"));

  // `Number(actual) > Number(expected)` — a non-numeric literal is NaN, and every comparison with
  // NaN is false, so the assertion can never pass however the page behaves.
  check("greaterThan against a non-numeric literal is reported", has({ locator: LOCATOR, config: { assertionType: "count", comparisonOperator: "greaterThan", expectedValue: "many" } }, "unsupportedConfiguration"));
  check("lessThan against a non-numeric literal is reported", has({ locator: LOCATOR, config: { assertionType: "count", comparisonOperator: "lessThan", expectedValue: "few" } }, "unsupportedConfiguration"));
  check("…and the message explains it can never pass", messagesFor({ locator: LOCATOR, config: { assertionType: "count", comparisonOperator: "greaterThan", expectedValue: "many" } }).some((m) => m.includes("never pass")));

  // Negative controls for the same rule.
  check("greaterThan against a numeric literal is fine", clean({ locator: LOCATOR, config: { assertionType: "count", comparisonOperator: "greaterThan", expectedValue: "3" } }));
  check("greaterThan against a negative/decimal literal is fine", clean({ locator: LOCATOR, config: { assertionType: "count", comparisonOperator: "lessThan", expectedValue: "-2.5" } }));
  // A dynamic value cannot be judged statically, so it must not be guessed at.
  check(
    "greaterThan bound to a valueSource is NOT reported (it resolves at run time)",
    clean({ locator: LOCATOR, config: { assertionType: "count", comparisonOperator: "greaterThan" }, valueSource: { type: "runtimeInput", value: "n" } })
  );
  check("contains against a non-numeric literal is fine (no numeric coercion)", clean({ locator: LOCATOR, config: { assertionType: "text", comparisonOperator: "contains", expectedValue: "many" } }));

  // Absent literals must not be reported — every one has a documented runtime default.
  check("an assertion with no assertionType at all is a text assertion, and clean", clean({ locator: LOCATOR, value: "Hi" }));
  check("an assertion with no comparisonOperator is clean", clean({ locator: LOCATOR, config: { assertionType: "text", expectedValue: "Hi" } }));
  check("a storage assertion with no storageArea is clean (defaults to local)", clean({ config: { assertionType: "storage", storageKey: "k", expectedValue: "v" } }));
}

/* ------------------------------------------------------------------ *
 * 5. No collateral damage
 * ------------------------------------------------------------------ */
console.log("\nNo collateral relaxation");
{
  // The flat table is untouched, so the three-way parity guard in verify:validation still holds.
  check("STEP_REQUIREMENTS still declares assertText as requiresLocator", STEP_REQUIREMENTS.assertText.requiresLocator === true);
  check("STEP_REQUIREMENTS still declares assertText as requiresValue", STEP_REQUIREMENTS.assertText.requiresValue === true);

  // `assertVisible` is a SEPARATE step type with its own executor arm; it must be unaffected.
  const visibleNoLocator: FlowProfile = {
    id: "av",
    name: "av",
    version: 1,
    nodes: [{ id: "v", type: "assertVisible", name: "Visible" }],
    edges: []
  };
  check(
    "assertVisible with no locator is still reported",
    validateFlowDefinition(visibleNoLocator).issues.some((i) => i.code === "missingRequiredLocator" && i.nodeId === "v")
  );
  const visibleOk: FlowProfile = {
    id: "av2",
    name: "av2",
    version: 1,
    nodes: [{ id: "v", type: "assertVisible", name: "Visible", locator: LOCATOR }],
    edges: []
  };
  check("assertVisible needs no expected value", validateFlowDefinition(visibleOk).issues.filter((i) => i.nodeId === "v").length === 0);

  // Other value-requiring types must not have picked up the expectedValue channel.
  const fillWithExpected: FlowProfile = {
    id: "f",
    name: "f",
    version: 1,
    nodes: [{ id: "s", type: "fill", name: "Fill", locator: LOCATOR, config: { expectedValue: "smuggled" } }],
    edges: []
  };
  check(
    "a fill is NOT satisfied by config.expectedValue (that channel is the assertion's alone)",
    validateFlowDefinition(fillWithExpected).issues.some((i) => i.code === "missingRequiredValue" && i.nodeId === "s")
  );
}

/* ------------------------------------------------------------------ *
 * 6. Persistence round-trip and the designer panel
 * ------------------------------------------------------------------ */
console.log("\nRound-trip and the properties panel");
{
  const roundTrip = (step: FlowStep): FlowStep => {
    const data = fromFlowStep(step);
    const node: FlowDesignerNode = { id: step.id, type: "flowNode", position: step.position ?? { x: 0, y: 0 }, data };
    return toFlowStep(node, []);
  };

  const saved = roundTrip({
    id: "a",
    type: "assertText",
    name: "Assert",
    locator: LOCATOR,
    config: { assertionType: "attribute", attributeName: "aria-pressed", comparisonOperator: "equals", expectedValue: "true" }
  });
  check("reload preserves the assertion kind", saved.config?.assertionType === "attribute", String(saved.config?.assertionType));
  check("reload preserves the attribute name", saved.config?.attributeName === "aria-pressed", String(saved.config?.attributeName));
  check("reload preserves the expected value", saved.config?.expectedValue === "true", String(saved.config?.expectedValue));
  check("the reloaded step still validates clean", clean({ locator: saved.locator, config: saved.config }));

  const storage = roundTrip({
    id: "a",
    type: "assertText",
    name: "Assert",
    config: { assertionType: "storage", storageKey: "token", storageArea: "session", expectedValue: "abc" }
  });
  check("reload preserves the storage key and area", storage.config?.storageKey === "token" && storage.config?.storageArea === "session");
  check("the reloaded storage assertion validates clean without a locator", clean({ config: storage.config }));

  const definition = getNodeDefinition("assertText");
  const dataFor = (step: AssertionOverrides) => fromFlowStep(assertionStep(step));
  check("panel: a complete text assertion shows no inline error", definition.validate(dataFor({ locator: LOCATOR, config: { assertionType: "text", expectedValue: "Hi" } })).length === 0);
  check("panel: a missing expected value still shows an error", definition.validate(dataFor({ locator: LOCATOR, config: { assertionType: "text" } })).length === 1);
  // The panel knew only about the expected value, so these two are the drift this fix closes.
  check("panel: an attribute assertion with no attribute name shows an error", definition.validate(dataFor({ locator: LOCATOR, config: { assertionType: "attribute", expectedValue: "true" } })).length === 1);
  check("panel: a storage assertion with no key shows an error", definition.validate(dataFor({ config: { assertionType: "storage", expectedValue: "abc" } })).length === 1);
  check("panel: a complete attribute assertion shows no error", definition.validate(dataFor({ locator: LOCATOR, config: { assertionType: "attribute", attributeName: "aria-pressed", expectedValue: "true" } })).length === 0);
  check("panel: a complete storage assertion shows no error", definition.validate(dataFor({ config: { assertionType: "storage", storageKey: "token", expectedValue: "abc" } })).length === 0);
  // Stale-state transition: the panel validates LIVE data, so filling the field clears the error.
  const broken = dataFor({ locator: LOCATOR, config: { assertionType: "attribute", expectedValue: "true" } });
  check("panel: the broken starting state does report an error", definition.validate(broken).length === 1);
  check("panel: typing the attribute name clears it immediately", definition.validate({ ...broken, attributeName: "aria-pressed" }).length === 0);
}

/* ------------------------------------------------------------------ *
 * 7. A whole flow, and the run gate
 * ------------------------------------------------------------------ */
console.log("\nA configured assertion flow is runnable");
{
  const flow: FlowProfile = {
    id: "assert-flow",
    name: "Assert flow",
    version: 1,
    nodes: [
      { id: "n-start", type: "start", name: "Start" },
      { id: "n-goto", type: "goto", name: "Open", url: "http://127.0.0.1:4173/form" },
      { id: "n-text", type: "assertText", name: "Assert text", locator: LOCATOR, config: { assertionType: "text", expectedValue: "Welcome" } },
      { id: "n-url", type: "assertText", name: "Assert URL", config: { assertionType: "url", expectedValue: "/form" } },
      { id: "n-store", type: "assertText", name: "Assert storage", config: { assertionType: "storage", storageKey: "token", expectedValue: "abc" } },
      { id: "n-end", type: "end", name: "End" }
    ],
    edges: [
      { id: "e1", source: "n-start", target: "n-goto", type: "success" },
      { id: "e2", source: "n-goto", target: "n-text", type: "success" },
      { id: "e3", source: "n-text", target: "n-url", type: "success" },
      { id: "e4", source: "n-url", target: "n-store", type: "success" },
      { id: "e5", source: "n-store", target: "n-end", type: "success" }
    ]
  };
  const report = validateFlowDefinition(flow);
  const blocking = executionBlockingErrorsOf(report);
  check("three differently-configured assertions produce no blocking errors", blocking.length === 0, blocking.map((i) => i.message).join(" | "));
}

/* ------------------------------------------------------------------ *
 * 8. The contract matches the executor that runs these steps
 * ------------------------------------------------------------------ */
console.log("\nContract to runtime parity");
{
  const executor = readFileSync(resolve(repoRoot, "src/runner/StepExecutor.ts"), "utf8");
  const body = executor.slice(executor.indexOf("private async executeAssertion("));
  const assertBody = body.slice(0, body.indexOf("private compareValues("));

  check("the executor still defaults an absent assertionType to text", /assertionType\s*=\s*cfg\.assertionType\s*\?\?\s*"text"/.test(assertBody));
  check("the executor still defaults the operator to contains", /operator\s*=\s*cfg\.comparisonOperator\s*\?\?\s*"contains"/.test(assertBody));
  check("the executor still reads expectedValue BEFORE step.value", /resolveStepValue\(step,\s*cfg\.expectedValue\s*\?\?\s*step\.value\)/.test(assertBody));
  check("the url arm still reads the page URL, not an element", /assertionType === "url"\)\s*\{[\s\S]{0,120}activePage\.url\(\)/.test(assertBody));
  check("the storage arm still reads through page.evaluate, not a locator", /assertionType === "storage"\)[\s\S]{0,900}activePage\.evaluate/.test(assertBody));
  check("the attribute arm still throws without config.attributeName", /attributeName[\s\S]{0,200}names no attribute/.test(assertBody));
  check("the storage arm still throws without config.storageKey", /storageKey[\s\S]{0,200}names no key/.test(assertBody));

  // Capture permissively, validate strictly: a restrictive pattern would silently miss a NEW kind.
  const compared = executor.slice(executor.indexOf("private compareValues("));
  const operatorBody = compared.slice(0, compared.indexOf("private async executeLoop("));
  const arms = [...operatorBody.matchAll(/case\s+"([^"]*)":/g)].map((m) => m[1]);
  const declaredOps = new Set<string>(COMPARISON_OPERATORS);
  // `contains` shares its body with `default:`, so it is a case with no body of its own.
  check(`compareValues dispatches on ${arms.length} named operators`, arms.length === declaredOps.size, arms.join(", "));
  check("every compareValues arm is a declared operator", arms.every((a) => declaredOps.has(a)), arms.filter((a) => !declaredOps.has(a)).join(", "));
  check("every declared operator has a compareValues arm", [...declaredOps].every((o) => arms.includes(o)), [...declaredOps].filter((o) => !arms.includes(o)).join(", "));

  check("the contract covers every declared assertion kind", ASSERTION_KINDS.every((k) => ASSERTION_CONTRACTS[k] !== undefined));
  check("there are exactly 7 assertion kinds", ASSERTION_KINDS.length === 7, String(ASSERTION_KINDS.length));
  check("there are exactly 2 storage areas", STORAGE_AREAS.length === 2);
  // An unrecognised literal must resolve to the arm the executor's final `else` actually runs.
  const rawUnknownKind = assertionStepWithRawConfig({}, "assertionType", "bogus");
  check("an unknown assertionType resolves to the text arm, matching the executor", resolveAssertionKind(rawUnknownKind) === "text");
  check("an absent assertionType resolves to the text arm", resolveAssertionKind(assertionStep()) === "text");
  check("assertionStepContract reports the resolved kind", assertionStepContract(assertionStep({ config: { assertionType: "url" } })).kind === "url");
}

/* ------------------------------------------------------------------ *
 * 9. The repo's OWN shipped fixtures — the flows the defect actually hit
 * ------------------------------------------------------------------ */
/*
 * These are not synthetic probes: they are the mock-site flows the live runner executes. EIGHT of
 * them carried their expected value in `config.expectedValue` and were reported as missing a value,
 * so the validator was calling the product's own working fixtures invalid. Pinning them here means
 * a regression is caught against real data, not only against cases this file imagined.
 */
console.log("\nShipped mock-site assertion fixtures");
{
  const fixtureDir = resolve(repoRoot, "resources/test-fixtures/mock-site/flows");
  let files: string[] = [];
  try {
    files = readdirSync(fixtureDir).filter((n) => n.endsWith(".json"));
  } catch {
    files = [];
  }
  // Cardinality first: an empty directory would make every check below pass vacuously.
  check(`the fixture directory holds flows to check (${files.length})`, files.length >= 8, String(files.length));

  let assertionNodes = 0;
  const dirty: string[] = [];
  for (const name of files) {
    let profile: FlowProfile;
    try {
      profile = JSON.parse(readFileSync(resolve(fixtureDir, name), "utf8")) as FlowProfile;
    } catch {
      continue;
    }
    if (!Array.isArray(profile.nodes)) continue;
    const asserts = profile.nodes.filter((step) => step.type === "assertText");
    if (asserts.length === 0) continue;
    assertionNodes += asserts.length;
    const ids = new Set(asserts.map((step) => step.id));
    for (const issue of validateFlowDefinition(profile).issues) {
      if (issue.nodeId !== undefined && ids.has(issue.nodeId) && issue.severity === "error") {
        dirty.push(`${name}#${issue.nodeId}: ${issue.message}`);
      }
    }
  }
  check(`the fixtures actually contain assertion nodes (${assertionNodes})`, assertionNodes >= 8, String(assertionNodes));
  check("no shipped mock-site assertion node reports a validation error", dirty.length === 0, dirty.join(" | "));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
