/**
 * Flow Designer node catalog ↔ registry parity verifier (awkit-8lz).
 *
 * What regression makes this fail: registering a node type in ONE of the two Flow Designer sources
 * and not the other. `flowNodeRegistry.ts` owns behaviour (category, property sections, validation,
 * executability); `flowNodeCatalog.ts` owns presentation (label, description, icon). Nothing used to
 * reconcile them, and `getFlowNodeCatalogItem` returned `flowNodeCatalog[0]` — the `start` entry —
 * for any type it did not know. So `hover`, registered in the registry with no catalog entry, drew
 * on the canvas as a valid "Start / Flow entry point" node with the Play icon, and shipped silently.
 *
 * This verifier asserts the contract in BOTH directions over the real production modules (nothing is
 * re-implemented here), plus the two behaviours that made the defect invisible:
 *   - an unknown step type renders explicitly as Unknown, never as Start;
 *   - the `?? flowNodeCatalog[0]` fallback is gone from the source.
 *
 * Every set comparison below is guarded by a cardinality/non-empty check first, because `.every()`
 * over an empty collection passes — an empty catalog or a failed parse must fail this verifier, not
 * satisfy it.
 *
 * Run: npx tsx scripts/verify-flow-node-catalog-parity.mts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  flowNodeCatalog,
  getFlowNodeCatalogItem,
  UNKNOWN_FLOW_NODE_LABEL,
  type FlowNodeCatalogItem
} from "../app/renderer/components/workflow/flowNodeCatalog";
import { getNodeDefinition, nodeRegistry, registeredStepTypes } from "../app/renderer/components/workflow/flowNodeRegistry";
import type { StepType } from "../src/profiles/FlowProfile";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Floor for the number of real node types. A parity check over two empty (or barely populated)
 * collections agrees with itself perfectly; this is what stops that from reading as a pass. It is a
 * floor, not an equality — the catalog is expected to grow — but it must never shrink past it
 * without a deliberate decision.
 */
const MIN_NODE_TYPES = 25;

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

// ---------------------------------------------------------------------------
// The StepType union, parsed from source.
//
// `META` is a total `Record<StepType, …>`, so TypeScript already proves registry↔union parity at
// compile time. Parsing the union anyway catches the drift that would silently void that proof —
// someone widening `META` to `Partial<Record<StepType, …>>`. Capture permissively (any quoted
// member) and validate strictly afterwards, so a member with an unexpected shape is COLLECTED and
// then reported, rather than skipped by the regex and never compared.
// ---------------------------------------------------------------------------
function parseStepTypeUnion(): string[] {
  const source = readFileSync(resolve(repoRoot, "src/profiles/FlowProfile.ts"), "utf8");
  const block = /export type StepType =([\s\S]*?);\s*\n/.exec(source);
  if (!block) return [];
  return [...block[1].matchAll(/"([^"]*)"/g)].map((match) => match[1]);
}

const unionTypes = parseStepTypeUnion();
const catalogTypes = flowNodeCatalog.map((item) => item.type as string);
const registryTypes = registeredStepTypes.map((type) => type as string);

// ---------------------------------------------------------------------------
// 1. Cardinality / non-empty guards — run FIRST so nothing below can pass vacuously.
// ---------------------------------------------------------------------------
console.log("Cardinality guards (a parity check over empty sets must not pass):");
check("catalog is non-empty", catalogTypes.length > 0, `length=${catalogTypes.length}`);
check("registry is non-empty", registryTypes.length > 0, `length=${registryTypes.length}`);
check("StepType union parsed from source is non-empty", unionTypes.length > 0, `length=${unionTypes.length}`);
check(
  `catalog carries at least ${MIN_NODE_TYPES} node types`,
  catalogTypes.length >= MIN_NODE_TYPES,
  `length=${catalogTypes.length}`
);
check(
  `registry carries at least ${MIN_NODE_TYPES} node types`,
  registryTypes.length >= MIN_NODE_TYPES,
  `length=${registryTypes.length}`
);
check(
  `StepType union declares at least ${MIN_NODE_TYPES} members`,
  unionTypes.length >= MIN_NODE_TYPES,
  `length=${unionTypes.length}`
);
check(
  "catalog and registry have the same cardinality",
  catalogTypes.length === registryTypes.length,
  `catalog=${catalogTypes.length} registry=${registryTypes.length}`
);
check("catalog has no duplicate step types", new Set(catalogTypes).size === catalogTypes.length);
check("registry has no duplicate step types", new Set(registryTypes).size === registryTypes.length);
check(
  "known anchor types are present in the catalog",
  ["start", "end", "click", "hover"].every((type) => catalogTypes.includes(type)),
  `catalog=${sorted(catalogTypes).join(",")}`
);

// ---------------------------------------------------------------------------
// 2. Bidirectional parity.
// ---------------------------------------------------------------------------
console.log("\nRegistry ↔ catalog parity (both directions):");
const catalogSet = new Set(catalogTypes);
const registrySet = new Set(registryTypes);
const unionSet = new Set(unionTypes);

const registryOnly = registryTypes.filter((type) => !catalogSet.has(type));
const catalogOnly = catalogTypes.filter((type) => !registrySet.has(type));

check(
  "every registered step type has a catalog entry",
  registryOnly.length === 0,
  registryOnly.length ? `registry-only: ${sorted(registryOnly).join(", ")}` : ""
);
check(
  "every catalog entry is a registered step type",
  catalogOnly.length === 0,
  catalogOnly.length ? `catalog-only: ${sorted(catalogOnly).join(", ")}` : ""
);

const unionMissingFromCatalog = unionTypes.filter((type) => !catalogSet.has(type));
const catalogMissingFromUnion = catalogTypes.filter((type) => !unionSet.has(type));
check(
  "every StepType union member has a catalog entry",
  unionMissingFromCatalog.length === 0,
  unionMissingFromCatalog.length ? `union-only: ${sorted(unionMissingFromCatalog).join(", ")}` : ""
);
check(
  "every catalog entry is a StepType union member",
  catalogMissingFromUnion.length === 0,
  catalogMissingFromUnion.length ? `not in union: ${sorted(catalogMissingFromUnion).join(", ")}` : ""
);

console.log("\nCatalog entry shape (a parity-only check would accept a blank entry):");
const blankEntries = flowNodeCatalog.filter(
  (item: FlowNodeCatalogItem) => !item.label.trim() || !item.description.trim() || typeof item.icon !== "object"
);
check(
  "every catalog entry has a label, a description and an icon",
  blankEntries.length === 0,
  blankEntries.length ? `blank: ${blankEntries.map((item) => item.type).join(", ")}` : ""
);
check(
  "no catalog entry other than start is labelled Start",
  flowNodeCatalog.filter((item) => item.label === "Start").length === 1
);
check(
  "no real catalog entry uses the Unknown label",
  flowNodeCatalog.every((item) => item.label !== UNKNOWN_FLOW_NODE_LABEL)
);
check(
  "nodeRegistry exposes one definition per catalog entry",
  nodeRegistry.length === flowNodeCatalog.length,
  `registry=${nodeRegistry.length} catalog=${flowNodeCatalog.length}`
);

// ---------------------------------------------------------------------------
// 3. The reported defect: hover must render as Hover, and start must be untouched.
// ---------------------------------------------------------------------------
console.log("\nawkit-8lz regression: hover renders as Hover, not Start:");
const startItem = getFlowNodeCatalogItem("start");
const hoverItem = getFlowNodeCatalogItem("hover");

check("hover resolves to its own catalog entry", hoverItem.type === "hover", `type=${String(hoverItem.type)}`);
check("hover is labelled Hover", hoverItem.label === "Hover", `label=${hoverItem.label}`);
check("hover is not labelled Start", hoverItem.label !== startItem.label);
check(
  "hover does not describe itself as the flow entry point",
  hoverItem.description !== startItem.description,
  `description=${hoverItem.description}`
);
check("hover does not use the Start icon", hoverItem.icon !== startItem.icon);
check("hover requires a locator", hoverItem.requiresLocator === true);
const hoverDefinition = getNodeDefinition("hover");
check("hover is an executable interaction node", hoverDefinition.category === "interaction" && hoverDefinition.executable);
check("hover's registry definition carries the Hover label", hoverDefinition.label === "Hover", `label=${hoverDefinition.label}`);

check("start is still labelled Start", startItem.label === "Start", `label=${startItem.label}`);
check("start is still the flow entry point", startItem.description === "Flow entry point", `description=${startItem.description}`);
check("start still resolves to the start entry", startItem.type === "start");

// ---------------------------------------------------------------------------
// 4. Unknown types render as Unknown — the fallback that hid the defect.
// ---------------------------------------------------------------------------
console.log("\nUnknown step types are explicit, never an impersonated Start:");
const invented = "notARealStepType" as StepType;
const originalError = console.error;
let reportedUnknown = false;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("notARealStepType")) reportedUnknown = true;
};
const unknownItem = getFlowNodeCatalogItem(invented);
console.error = originalError;

check("an unknown type is labelled Unknown Step", unknownItem.label === UNKNOWN_FLOW_NODE_LABEL, `label=${unknownItem.label}`);
check("an unknown type is NOT labelled Start", unknownItem.label !== "Start");
check("an unknown type does not claim to be the flow entry point", unknownItem.description !== "Flow entry point");
check("an unknown type does not borrow the Start icon", unknownItem.icon !== startItem.icon);
check("an unknown type names the offending type in its description", unknownItem.description.includes("notARealStepType"));
check("an unknown type preserves the requested type", (unknownItem.type as string) === "notARealStepType");
check("an unknown type is reported to the console", reportedUnknown);
check("an unknown type requires neither a locator nor a value", !unknownItem.requiresLocator && !unknownItem.requiresValue);

console.log("\nSource guard — the entry-zero fallback must not come back:");
const catalogSource = readFileSync(resolve(repoRoot, "app/renderer/components/workflow/flowNodeCatalog.ts"), "utf8");
const fallbackHits = [...catalogSource.matchAll(/\?\?\s*flowNodeCatalog\s*\[\s*0\s*\]/g)];
check(
  "getFlowNodeCatalogItem does not fall back to flowNodeCatalog[0]",
  fallbackHits.length === 0,
  fallbackHits.length ? `${fallbackHits.length} occurrence(s)` : ""
);
check("the source guard actually read the catalog module", catalogSource.includes("getFlowNodeCatalogItem"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
