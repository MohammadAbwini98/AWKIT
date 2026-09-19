/**
 * verify:locator-plan — Phase L L3 §2–§3: the locator plan DSL, its trusted compiler and the intent guard
 * (`src/ai/locatorPlan.ts`). Pure and in-process; no model, no browser.
 *
 * What makes it fail: a plan that reaches a candidate with an invented frame, a script or engine-prefixed
 * selector, a positional selector, an unstable id, XPath without policy, a closed-shadow target, or scope/
 * target text equal to a bound data value; a frame chain taken from the plan instead of the capture; a
 * position → text scope change not flagged as `meaningChange` (or flagged when nothing changed); rejection
 * feedback that echoes model text.
 *
 * The proof gates (L3 §4) and replay proof (§5) need a browser and are not covered here.
 *
 * Run: npm run verify:locator-plan
 */
import { isBoundedSchema } from "@src/ai/AiOutputContract";
import {
  LOCATOR_PLAN_SCHEMA,
  compileLocatorPlan,
  evaluateLocatorPlan,
  guardLocatorPlanIntent,
  type CompiledLocatorPlan
} from "@src/ai/locatorPlan";
import type { LocatorContext, StepLocator } from "@src/profiles/FlowProfile";

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

const plan = (target: Record<string, unknown>, scopes: Array<Record<string, unknown>> = [], extra: Record<string, unknown> = {}) => ({
  version: 1,
  target,
  scopes,
  ...extra
});
type Outcome = { ok: true } | { ok: false; code: string; field: string };
const code = (result: Outcome): string => (result.ok ? "OK" : result.code);
const rejects = (label: string, result: Outcome, expected: string, field?: string): void =>
  check(`${label} → ${expected}${field ? ` at ${field}` : ""}`, code(result) === expected && (!field || (!result.ok && result.field === field)), JSON.stringify(result));

const captured: LocatorContext = {
  frameChain: [{ selector: "iframe#checkout", name: "checkout" }],
  shadow: { boundary: "open" }
};
const guarded: StepLocator = {
  strategy: "css",
  value: "table tr:nth-child(3) button",
  guard: { schemaVersion: 1 } as unknown as StepLocator["guard"],
  quality: { strategy: "fallback", isUnique: true, matchCount: 1, confidence: "low", disambiguation: "positional" }
};
const semantic: StepLocator = { strategy: "role", value: "button", name: "Save" };

console.log("Schema");
check("plan schema stays inside the bounded output subset", isBoundedSchema(LOCATOR_PLAN_SCHEMA));

console.log("Compiler: accepted plans");
const ok = compileLocatorPlan(
  plan({ strategy: "role", value: "button", name: "Delete", exact: true }, [{ kind: "tableRow", strategy: "role", value: "row", hasText: "Invoice total" }]),
  captured
);
check("role target inside a tableRow scope compiles", ok.ok, JSON.stringify(ok));
if (ok.ok) {
  check("candidate carries strategy/value/name/exact", ok.candidate.strategy === "role" && ok.candidate.value === "button" && ok.candidate.name === "Delete" && ok.candidate.exact === true);
  check("scope becomes a typed container with hasText", ok.context?.containers?.[0]?.type === "tableRow" && ok.context.containers[0].hasText === "Invoice total");
  check("frame chain is the captured one", ok.context?.frameChain?.[0]?.selector === "iframe#checkout" && ok.context.frameChain.length === 1);
  check("shadow scope is the captured one", ok.context?.shadow?.boundary === "open");
  ok.context!.frameChain![0].selector = "iframe#mutated";
  check("compiled context is a copy (capture not mutated)", captured.frameChain![0].selector === "iframe#checkout");
}
check("stable #id css compiles", compileLocatorPlan(plan({ strategy: "css", value: "#submit-order" }), undefined).ok);
check("stable id compiles", compileLocatorPlan(plan({ strategy: "id", value: "checkout-form" }), undefined).ok);
check("testId compiles", compileLocatorPlan(plan({ strategy: "testId", value: "pay-now" }), undefined).ok);
check("no context when nothing was captured and no scope", (() => {
  const r = compileLocatorPlan(plan({ strategy: "label", value: "Email" }), undefined);
  return r.ok && r.context === undefined;
})());
check("XPath under explicit policy compiles", compileLocatorPlan(plan({ strategy: "xpath", value: "//button[@name='go']" }), undefined, { allowXPath: true }).ok);
check("three scopes (the chain maximum) compile", compileLocatorPlan(
  plan({ strategy: "role", value: "button", name: "Go" }, [
    { kind: "dialog", strategy: "role", value: "dialog", name: "Cart" },
    { kind: "form", strategy: "label", value: "Shipping" },
    { kind: "section", strategy: "testId", value: "addr" }
  ]),
  undefined
).ok);

console.log("Compiler: rejected plans");
rejects("plan-supplied frameChain", compileLocatorPlan(plan({ strategy: "role", value: "button" }, [], { frameChain: [{ selector: "iframe" }] }), captured), "INVENTED_FRAME");
rejects("plan-supplied shadow", compileLocatorPlan(plan({ strategy: "role", value: "button" }, [], { shadow: { boundary: "open" } }), captured), "INVENTED_FRAME");
rejects("unknown top-level operation", compileLocatorPlan(plan({ strategy: "role", value: "button" }, [], { evaluate: "x" }), undefined), "MALFORMED");
rejects("unknown strategy", compileLocatorPlan(plan({ strategy: "tagName", value: "button" }), undefined), "MALFORMED");
rejects("unknown scope kind", compileLocatorPlan(plan({ strategy: "role", value: "button" }, [{ kind: "iframe", strategy: "css", value: "#a" }]), undefined), "MALFORMED");
rejects("wrong version", compileLocatorPlan({ ...plan({ strategy: "role", value: "button" }), version: 2 }, undefined), "MALFORMED");
rejects("scope chain over the maximum", compileLocatorPlan(
  plan({ strategy: "role", value: "button" }, Array.from({ length: 4 }, () => ({ kind: "section", strategy: "testId", value: "s" }))),
  undefined
), "MALFORMED");
rejects("not an object", compileLocatorPlan("document.querySelector('x')", undefined), "MALFORMED");
rejects("empty value", compileLocatorPlan(plan({ strategy: "text", value: "   " }), undefined), "MALFORMED", "target.value");
rejects("css positional :nth-child", compileLocatorPlan(plan({ strategy: "css", value: "#list li:nth-child(2)" }), undefined), "POSITIONAL", "target.value");
rejects("css combinator/class selector", compileLocatorPlan(plan({ strategy: "css", value: "div.card > button" }), undefined), "UNSUPPORTED", "target.value");
rejects("css engine prefix", compileLocatorPlan(plan({ strategy: "css", value: "xpath=//a" }), undefined), "SCRIPT", "target.value");
rejects("css chained selector", compileLocatorPlan(plan({ strategy: "css", value: "#a >> nth=1" }), undefined), "SCRIPT", "target.value");
rejects("css generated id", compileLocatorPlan(plan({ strategy: "css", value: "#row-48213" }), undefined), "UNSTABLE_ID", "target.value");
rejects("id generated (hex chunk)", compileLocatorPlan(plan({ strategy: "id", value: "btn-a3f9c2d1" }), undefined), "UNSTABLE_ID", "target.value");
rejects("id with selector syntax", compileLocatorPlan(plan({ strategy: "id", value: "a'] , [x" }), undefined), "SCRIPT", "target.value");
rejects("role that is not a role token", compileLocatorPlan(plan({ strategy: "role", value: "button[name=x]" }), undefined), "UNSUPPORTED", "target.value");
rejects("javascript: in a text value", compileLocatorPlan(plan({ strategy: "text", value: "javascript:alert(1)" }), undefined), "SCRIPT", "target");
rejects("control character in a name", compileLocatorPlan(plan({ strategy: "role", value: "button", name: "Sa" + String.fromCharCode(0) + "ve" }), undefined), "SCRIPT", "target");
rejects("control character in hasText", compileLocatorPlan(
  plan({ strategy: "role", value: "button" }, [{ kind: "card", strategy: "testId", value: "c", hasText: "a" + String.fromCharCode(10) + "b" }]),
  undefined
), "SCRIPT", "scopes.0.hasText");
rejects("XPath without policy", compileLocatorPlan(plan({ strategy: "xpath", value: "//button" }), undefined), "XPATH_NOT_ALLOWED", "target.strategy");
rejects("positional XPath under policy", compileLocatorPlan(plan({ strategy: "xpath", value: "//tr[3]/td/button" }), undefined, { allowXPath: true }), "POSITIONAL", "target.value");
rejects("XPath last() under policy", compileLocatorPlan(plan({ strategy: "xpath", value: "(//button)[last()]" }), undefined, { allowXPath: true }), "POSITIONAL", "target.value");
rejects("bad scope is reported at its index", compileLocatorPlan(
  plan({ strategy: "role", value: "button" }, [{ kind: "card", strategy: "testId", value: "ok" }, { kind: "card", strategy: "css", value: "#x:nth-of-type(2)" }]),
  undefined
), "POSITIONAL", "scopes.1.value");
rejects("instrumented closed-shadow target", compileLocatorPlan(plan({ strategy: "role", value: "button" }), { shadow: { boundary: "closed", instrumented: true } }), "UNSUPPORTED", "context.shadow");
const secretish = compileLocatorPlan(plan({ strategy: "css", value: "#row-99887766 SECRET-MODEL-TEXT" }), undefined);
check("rejection feedback never echoes model text", !secretish.ok && !JSON.stringify(secretish).includes("SECRET-MODEL-TEXT") && Object.keys(secretish).sort().join() === "code,field,ok");

console.log("Intent guard");
const compile = (p: unknown): CompiledLocatorPlan => {
  const r = compileLocatorPlan(p, undefined);
  if (!r.ok) throw new Error(`fixture did not compile: ${r.code}`);
  return r;
};
const rowByName = compile(plan({ strategy: "role", value: "button", name: "Delete" }, [{ kind: "tableRow", strategy: "role", value: "row", hasText: "Alice Smith" }]));
rejects("scope text equal to a bound data value", guardLocatorPlanIntent(rowByName, { boundValues: ["alice smith"], baseline: guarded }), "INTENT_BOUND_VALUE", "scopes.0.hasText");
rejects("bound value matched case-insensitively and trimmed", guardLocatorPlanIntent(rowByName, { boundValues: ["  ALICE  "], baseline: guarded }), "INTENT_BOUND_VALUE", "scopes.0.hasText");
rejects(
  "target name containing a bound value",
  guardLocatorPlanIntent(compile(plan({ strategy: "role", value: "link", name: "Order 55213 details" })), { boundValues: ["55213"], baseline: semantic }),
  "INTENT_BOUND_VALUE",
  "target.name"
);
rejects(
  "scope value containing a bound value",
  guardLocatorPlanIntent(compile(plan({ strategy: "role", value: "button" }, [{ kind: "card", strategy: "label", value: "Bob's card" }])), { boundValues: ["bob"], baseline: semantic }),
  "INTENT_BOUND_VALUE",
  "scopes.0.value"
);
const oneChar = guardLocatorPlanIntent(rowByName, { boundValues: ["a", ""], baseline: guarded });
check("bound values shorter than 2 characters are ignored (L2 marker rule)", oneChar.ok, JSON.stringify(oneChar));

const posToText = guardLocatorPlanIntent(rowByName, { boundValues: [], baseline: guarded });
check("guarded positional → row-by-text sets meaningChange", posToText.ok && posToText.meaningChange === true, JSON.stringify(posToText));
const sameScope = guardLocatorPlanIntent(rowByName, {
  boundValues: [],
  baseline: { ...semantic, context: { containers: [{ type: "tableRow", strategy: "role", value: "row", hasText: "alice smith" }] } }
});
check("same text scope as the baseline is not a meaning change", sameScope.ok && sameScope.meaningChange === false, JSON.stringify(sameScope));
const legacyContainer = guardLocatorPlanIntent(rowByName, {
  boundValues: [],
  baseline: { ...semantic, context: { container: { type: "tableRow", strategy: "role", value: "row", hasText: "Alice Smith" } } }
});
check("legacy single `container` baseline is read as a chain", legacyContainer.ok && legacyContainer.meaningChange === false, JSON.stringify(legacyContainer));
const textOnPositional = guardLocatorPlanIntent(compile(plan({ strategy: "text", value: "Remove" })), { boundValues: [], baseline: guarded });
check("text target replacing a positional baseline sets meaningChange", textOnPositional.ok && textOnPositional.meaningChange === true);
const roleOnPositional = guardLocatorPlanIntent(compile(plan({ strategy: "testId", value: "remove-item" })), { boundValues: [], baseline: guarded });
check("test-id target with no text scope is not a meaning change", roleOnPositional.ok && roleOnPositional.meaningChange === false);
const textOnSemantic = guardLocatorPlanIntent(compile(plan({ strategy: "text", value: "Save" })), { boundValues: [], baseline: semantic });
check("text target over a semantic baseline is not a meaning change", textOnSemantic.ok && textOnSemantic.meaningChange === false);

console.log("evaluateLocatorPlan");
const evaluated = evaluateLocatorPlan(plan({ strategy: "role", value: "button", name: "Delete" }, [{ kind: "tableRow", strategy: "role", value: "row", hasText: "Invoice total" }]), {
  boundValues: ["alice"],
  baseline: guarded,
  captured
});
check("compile + guard pass → candidate with meaningChange", evaluated.ok && evaluated.meaningChange === true && evaluated.context?.frameChain?.length === 1, JSON.stringify(evaluated));
rejects("compile rejection wins before the guard", evaluateLocatorPlan(plan({ strategy: "xpath", value: "//a" }), { boundValues: [], baseline: semantic }), "XPATH_NOT_ALLOWED");
rejects("guard rejection surfaces from evaluate", evaluateLocatorPlan(plan({ strategy: "text", value: "Alice Smith" }), { boundValues: ["alice smith"], baseline: semantic }), "INTENT_BOUND_VALUE", "target.value");

console.log(`\nverify:locator-plan — ${passed} passed, ${failed} failed`);
if (passed === 0) failed += 1;
process.exit(failed === 0 ? 0 : 1);
