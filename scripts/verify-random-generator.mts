/**
 * Randomized Automation Test Lab — Phase 1 (deterministic generation core).
 * Run with: npx tsx scripts/verify-random-generator.mts
 *
 * Pure verification: no browser, no Electron, no disk writes. Proves that generated definitions are
 * reproducible from a seed, structurally valid against the REAL validators
 * (`validateConnectorStructure`), and that the lab's catalogs have not drifted from the renderer's
 * node catalog.
 *
 * This intentionally drives `validateConnectorStructure` from `src/profiles/FlowProfile.ts` rather
 * than reimplementing the rules — a generator checked against a copy of the rules proves nothing.
 */
import { connectorKind, validateConnectorStructure, type FlowEdge, type FlowProfile, type StepType } from "@src/profiles/FlowProfile";
import { flowNodeCatalog, getFlowNodeCatalogItem } from "@renderer/components/workflow/flowNodeCatalog";
import { ALL_NODE_TYPES, DEFAULT_GENERATABLE_NODE_TYPES, NODE_CATALOG } from "@src/testing/random/NodeCatalog";
import {
  ALL_CONDITION_OPERATORS,
  ALL_CONDITION_SOURCES,
  ALL_CONNECTOR_KINDS,
  ALL_EDGE_TYPES,
  ALL_LOOP_MODES,
  RUNTIME_LOOP_LIMITS
} from "@src/testing/random/ConnectorCatalog";
import { CoverageTracker } from "@src/testing/random/CoverageTracker";
import {
  ALL_FLOW_PATTERNS,
  CONSTRAINT_CEILINGS,
  DEFAULT_ALLOWED_HOSTS,
  assertAllowedTarget,
  resolveConstraints,
  type FlowPatternName
} from "@src/testing/random/GenerationConstraints";
import { generateFlow } from "@src/testing/random/RandomFlowGenerator";
import { generateCampaign } from "@src/testing/random/RandomWorkflowGenerator";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import { SECRET_REFERENCES } from "@src/testing/fixtures/SafeTestData";

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

const baseOptions = { seed: "awkit-generator-verify", workflowCount: 2, recorderFidelity: true } as const;

/* ------------------------------------------------------------------ *
 * 1. Seeded randomness
 * ------------------------------------------------------------------ */
console.log("\nSeededRandom");
{
  const a = new SeededRandom("seed-alpha");
  const b = new SeededRandom("seed-alpha");
  const c = new SeededRandom("seed-bravo");
  const drawA = Array.from({ length: 20 }, () => a.float());
  const drawB = Array.from({ length: 20 }, () => b.float());
  const drawC = Array.from({ length: 20 }, () => c.float());
  check("same seed produces the identical sequence", JSON.stringify(drawA) === JSON.stringify(drawB));
  check("different seeds produce different sequences", JSON.stringify(drawA) !== JSON.stringify(drawC));
  check("float() stays within [0, 1)", drawA.every((value) => value >= 0 && value < 1));

  const parent = new SeededRandom("seed-parent");
  const childBefore = parent.derive("child").float();
  for (let i = 0; i < 50; i += 1) parent.float();
  const childAfter = parent.derive("child").float();
  check("derive() is position-stable under parent consumption", childBefore === childAfter);

  const ranged = Array.from({ length: 200 }, () => new SeededRandom(`r${Math.random()}`).int(3, 7));
  check("int() respects inclusive bounds", ranged.every((value) => value >= 3 && value <= 7));

  let threw = false;
  try {
    new SeededRandom("x").pick([]);
  } catch {
    threw = true;
  }
  check("pick() throws on an empty pool instead of returning undefined", threw);
}

/* ------------------------------------------------------------------ *
 * 2. Catalog ↔ renderer registry parity
 * ------------------------------------------------------------------ */
console.log("\nCatalog parity with the renderer node registry");
{
  const registryTypes = flowNodeCatalog.map((item) => item.type).sort();
  const catalogTypes = [...ALL_NODE_TYPES].sort();
  check(
    `catalog covers all ${registryTypes.length} registry node types`,
    JSON.stringify(registryTypes) === JSON.stringify(catalogTypes),
    `registry=${registryTypes.length} catalog=${catalogTypes.length}`
  );

  const locatorMismatches = ALL_NODE_TYPES.filter(
    (type) => NODE_CATALOG[type].requiresLocator !== Boolean(getFlowNodeCatalogItem(type).requiresLocator)
  );
  check("requiresLocator matches the registry for every node type", locatorMismatches.length === 0, locatorMismatches.join(", "));

  const valueMismatches = ALL_NODE_TYPES.filter(
    (type) => NODE_CATALOG[type].requiresValue !== Boolean(getFlowNodeCatalogItem(type).requiresValue)
  );
  check("requiresValue matches the registry for every node type", valueMismatches.length === 0, valueMismatches.join(", "));

  check("all 4 connector kinds catalogued", ALL_CONNECTOR_KINDS.length === 4);
  check("all 9 legacy edge types catalogued", ALL_EDGE_TYPES.length === 9);
  check("all 13 condition operators catalogued", ALL_CONDITION_OPERATORS.length === 13);
  check("all 5 condition sources catalogued", ALL_CONDITION_SOURCES.length === 5);
  check("all 4 loop modes catalogued", ALL_LOOP_MODES.length === 4);
}

/* ------------------------------------------------------------------ *
 * 3. Constraint resolution and safety
 * ------------------------------------------------------------------ */
console.log("\nConstraint resolution and target safety");
{
  const resolved = resolveConstraints({ seed: "s" });
  check("defaults resolve without options", resolved.workflowCount === 1 && resolved.minNodesPerFlow >= 3);
  check(
    "loop iterations default well below the runtime hard cap",
    resolved.maxLoopIterations < RUNTIME_LOOP_LIMITS.absoluteMaxLoopIterations
  );
  check(
    "node count is clamped to the ceiling, not the request",
    resolveConstraints({ seed: "s", maxNodesPerFlow: 10_000 }).maxNodesPerFlow === CONSTRAINT_CEILINGS.nodesPerFlow
  );

  let inverted = false;
  try {
    resolveConstraints({ seed: "s", minNodesPerFlow: 20, maxNodesPerFlow: 5 });
  } catch {
    inverted = true;
  }
  check("inverted node bounds are rejected", inverted);

  let external = false;
  try {
    resolveConstraints({ seed: "s", baseUrl: "https://example.com" });
  } catch {
    external = true;
  }
  check("an unauthorized host is refused at constraint resolution", external);
  check(
    "an explicitly allowed host is accepted",
    assertAllowedTarget("http://fixture.internal:8080/x", ["fixture.internal"]).hostname === "fixture.internal"
  );
  check("localhost is allowed by default", DEFAULT_ALLOWED_HOSTS.includes("127.0.0.1"));

  let badProtocol = false;
  try {
    assertAllowedTarget("file:///c:/windows", ["127.0.0.1"]);
  } catch {
    badProtocol = true;
  }
  check("non-http(s) protocols are refused", badProtocol);
}

/* ------------------------------------------------------------------ *
 * 4. Graph validity — every pattern, driven through the real validator
 * ------------------------------------------------------------------ */
console.log("\nGenerated graph validity (all patterns × 25 seeds)");
{
  const failures: string[] = [];
  const structuralFailures: string[] = [];
  const reachabilityFailures: string[] = [];
  const idFailures: string[] = [];
  const loopFailures: string[] = [];
  let profilesChecked = 0;

  /** Forward BFS from Start. The product has no flow-level reachability check — the lab does. */
  const reachableFrom = (profile: FlowProfile, startId: string): Set<string> => {
    const adjacency = new Map<string, string[]>();
    for (const edge of profile.edges) {
      adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    }
    const seen = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      for (const next of adjacency.get(queue.shift() as string) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen;
  };

  for (const pattern of ALL_FLOW_PATTERNS) {
    for (let seedIndex = 0; seedIndex < 25; seedIndex += 1) {
      const seed = `pattern-${pattern}-${seedIndex}`;
      const constraints = resolveConstraints({ ...baseOptions, seed, minNodesPerFlow: 4, maxNodesPerFlow: 18 });
      const { profile } = generateFlow({
        flowId: `flow-${pattern}-${seedIndex}`,
        flowName: `Flow ${pattern} ${seedIndex}`,
        rng: new SeededRandom(seed),
        constraints,
        pattern: pattern as FlowPatternName
      });
      profilesChecked += 1;

      const issues = validateConnectorStructure(profile.edges);
      if (issues.length > 0) structuralFailures.push(`${seed}: ${issues[0]}`);

      const starts = profile.nodes.filter((node) => node.type === "start");
      const ends = profile.nodes.filter((node) => node.type === "end");
      if (starts.length !== 1) failures.push(`${seed}: ${starts.length} start nodes`);
      if (ends.length < 1) failures.push(`${seed}: no end node`);

      const startId = (starts[0] as { id: string } | undefined)?.id;
      if (startId) {
        if (profile.edges.some((edge) => edge.target === startId)) {
          failures.push(`${seed}: start node has an incoming edge`);
        }
        const reachable = reachableFrom(profile, startId);
        const unreachable = profile.nodes.filter((node) => !reachable.has(node.id));
        if (unreachable.length > 0) reachabilityFailures.push(`${seed}: ${unreachable.length} unreachable`);
        if (!ends.some((end) => reachable.has(end.id))) reachabilityFailures.push(`${seed}: no reachable end`);
      }

      const outgoing = new Set(profile.edges.map((edge) => edge.source));
      const incoming = new Set(profile.edges.map((edge) => edge.target));
      for (const node of profile.nodes) {
        if (node.type !== "end" && !outgoing.has(node.id)) failures.push(`${seed}: ${node.id} has no outgoing edge`);
        if (node.type !== "start" && !incoming.has(node.id)) failures.push(`${seed}: ${node.id} has no incoming edge`);
        if (node.type === "end" && outgoing.has(node.id)) failures.push(`${seed}: end node has an outgoing edge`);
      }

      const nodeIds = profile.nodes.map((node) => node.id);
      const edgeIds = profile.edges.map((edge) => edge.id);
      if (new Set(nodeIds).size !== nodeIds.length) idFailures.push(`${seed}: duplicate node id`);
      if (new Set(edgeIds).size !== edgeIds.length) idFailures.push(`${seed}: duplicate edge id`);
      if (profile.edges.some((edge) => !nodeIds.includes(edge.source) || !nodeIds.includes(edge.target))) {
        idFailures.push(`${seed}: edge references a missing node`);
      }

      for (const edge of profile.edges) {
        if (edge.loop && edge.loop.maxIterations > constraints.maxLoopIterations) {
          loopFailures.push(`${seed}: loop maxIterations ${edge.loop.maxIterations} exceeds campaign cap`);
        }
        if (connectorKind(edge) === "loop" && edge.type === "loop" && edge.source !== edge.target) {
          loopFailures.push(`${seed}: structured loop is not a self-loop`);
        }
      }

      // Required config, per the renderer catalog — the same rule validateFlow enforces.
      for (const node of profile.nodes) {
        const item = getFlowNodeCatalogItem(node.type);
        if (item.requiresLocator && !node.locator?.value?.trim()) failures.push(`${seed}: ${node.type} missing locator`);
        const hasValue = Boolean(node.value?.trim()) || node.valueSource?.type === "secret";
        if (item.requiresValue && !hasValue) failures.push(`${seed}: ${node.type} missing value`);
      }

      // Sibling conditionals must carry distinct priorities or routing is ambiguous.
      const prioritiesBySource = new Map<string, number[]>();
      for (const edge of profile.edges) {
        if (edge.kind !== "conditional" || !edge.conditional) continue;
        const list = prioritiesBySource.get(edge.source) ?? [];
        list.push(edge.conditional.priority ?? 0);
        prioritiesBySource.set(edge.source, list);
      }
      for (const [source, priorities] of prioritiesBySource) {
        if (new Set(priorities).size !== priorities.length) failures.push(`${seed}: ${source} has duplicate conditional priorities`);
      }
    }
  }

  check(`${profilesChecked} generated flows across ${ALL_FLOW_PATTERNS.length} patterns`, profilesChecked === ALL_FLOW_PATTERNS.length * 25);
  check("validateConnectorStructure reports zero issues", structuralFailures.length === 0, structuralFailures.slice(0, 3).join(" | "));
  check("start/end rules and required config hold", failures.length === 0, failures.slice(0, 3).join(" | "));
  check("every node is reachable from Start and an End is reachable", reachabilityFailures.length === 0, reachabilityFailures.slice(0, 3).join(" | "));
  check("node and edge ids are unique and resolvable", idFailures.length === 0, idFailures.slice(0, 3).join(" | "));
  check("loops stay within the campaign's bound and self-loop rule", loopFailures.length === 0, loopFailures.slice(0, 3).join(" | "));
}

/* ------------------------------------------------------------------ *
 * 5. Determinism of whole campaigns
 * ------------------------------------------------------------------ */
console.log("\nCampaign determinism");
{
  const constraints = resolveConstraints({ ...baseOptions, seed: "campaign-determinism", workflowCount: 3 });
  const first = generateCampaign(new SeededRandom(constraints.seed), constraints);
  const second = generateCampaign(new SeededRandom(constraints.seed), constraints);
  check("the same seed reproduces a byte-identical campaign", JSON.stringify(first) === JSON.stringify(second));

  const otherConstraints = resolveConstraints({ ...baseOptions, seed: "campaign-different", workflowCount: 3 });
  const other = generateCampaign(new SeededRandom(otherConstraints.seed), otherConstraints);
  check("a different seed produces a different campaign", JSON.stringify(first) !== JSON.stringify(other));

  const flowIds = first.flatMap((workflow) => workflow.flows.map((flow) => flow.profile.id));
  check("flow ids are unique across the campaign", new Set(flowIds).size === flowIds.length);

  const refIds = new Set(flowIds);
  const danglingRefs = first.flatMap((workflow) =>
    workflow.flows.flatMap((flow) =>
      flow.profile.nodes.filter((node) => node.type === "runFlow" && node.flowId && !refIds.has(node.flowId))
    )
  );
  check("every runFlow reference resolves to a generated flow", danglingRefs.length === 0, `${danglingRefs.length} dangling`);

  const selfRefs = first.flatMap((workflow) =>
    workflow.flows.filter((flow) => flow.profile.nodes.some((node) => node.flowId === flow.profile.id))
  );
  check("no flow references itself", selfRefs.length === 0);
}

/* ------------------------------------------------------------------ *
 * 6. Safety: no plaintext secrets, no external targets
 * ------------------------------------------------------------------ */
console.log("\nGenerated-definition safety");
{
  const constraints = resolveConstraints({ ...baseOptions, seed: "safety", workflowCount: 4, recorderFidelity: true });
  const campaign = generateCampaign(new SeededRandom(constraints.seed), constraints);
  const serialized = JSON.stringify(campaign);

  const secretSteps = campaign.flatMap((workflow) =>
    workflow.flows.flatMap((flow) => flow.profile.nodes.filter((node) => node.valueSource?.type === "secret"))
  );
  check("recorderFidelity campaigns do generate secret-backed value sources", secretSteps.length > 0, `${secretSteps.length} found`);
  check(
    "every secret source carries only an opaque reference",
    secretSteps.every((step) => Boolean(step.valueSource?.secretName) && step.value === undefined)
  );
  check(
    "secret references come from the safe fixture pool",
    secretSteps.every((step) => SECRET_REFERENCES.includes(step.valueSource?.secretName as string))
  );

  const urls = campaign.flatMap((workflow) =>
    workflow.flows.flatMap((flow) => flow.profile.nodes.flatMap((node) => (node.url ? [node.url] : [])))
  );
  check(
    "every generated URL targets the local mock site",
    urls.length > 0 && urls.every((url) => url.startsWith(constraints.baseUrl)),
    `${urls.length} urls`
  );
  check("no http(s) URL outside the allowlist appears anywhere", !/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(serialized));

  const humanGated = campaign.flatMap((workflow) =>
    workflow.flows.flatMap((flow) =>
      flow.profile.nodes.filter((node) => NODE_CATALOG[node.type as StepType].gate === "requiresHuman")
    )
  );
  check("no human-blocking node type is generated unattended", humanGated.length === 0, humanGated.map((n) => n.type).join(", "));
}

/* ------------------------------------------------------------------ *
 * 7. Coverage accounting
 * ------------------------------------------------------------------ */
console.log("\nCoverage tracking");
{
  const coverage = new CoverageTracker();
  // Sized so every locally-satisfiable dimension converges. A "coverage" campaign profile (Phase 6)
  // instead generates until a minimum count is reached; this verifier just needs a deterministic
  // campaign large enough that a miss means a generator defect, not an unlucky seed.
  const constraints = resolveConstraints({ ...baseOptions, seed: "coverage", workflowCount: 40, recorderFidelity: true });
  generateCampaign(new SeededRandom(constraints.seed), constraints, coverage);

  const kindGaps = coverage.unexplainedGaps("connectorKind", ALL_CONNECTOR_KINDS, "generated");
  check("all 4 connector kinds generated", kindGaps.length === 0, kindGaps.map((gap) => gap.key).join(", "));

  const edgeGaps = coverage.unexplainedGaps("edgeType", ALL_EDGE_TYPES, "generated");
  check("all 9 legacy edge types generated", edgeGaps.length === 0, edgeGaps.map((gap) => gap.key).join(", "));

  const loopGaps = coverage.unexplainedGaps("loopMode", ["count", "staticList", "whileCondition"], "generated");
  check("locally-satisfiable loop modes generated", loopGaps.length === 0, loopGaps.map((gap) => gap.key).join(", "));

  const patternGaps = coverage.unexplainedGaps("flowPattern", ALL_FLOW_PATTERNS, "generated");
  check("every flow pattern generated at least once", patternGaps.length === 0, patternGaps.map((gap) => gap.key).join(", "));

  // The catalog declaring a type generatable means nothing unless a pattern actually places it.
  // This assertion exists because `loop` and `runFlow` were declared generatable but no pattern
  // emitted them — every mutation and round-trip result for those types was silently vacuous.
  const expectedNodeTypes = [...DEFAULT_GENERATABLE_NODE_TYPES, "start", "end"];
  const nodeTypeGaps = coverage.unexplainedGaps("nodeType", expectedNodeTypes, "generated");
  check(
    `every default-generatable node type is actually placed (${expectedNodeTypes.length} types)`,
    nodeTypeGaps.length === 0,
    nodeTypeGaps.map((gap) => gap.key).join(", ")
  );

  const snapshot = coverage.snapshot();
  check("coverage snapshot is non-empty", snapshot.entries.length > 0);
  check(
    "dataSource loop mode is reported as a gap, not silently omitted",
    coverage.gaps("loopMode", ["dataSource"], "generated").length === 1
  );

  const tracker = new CoverageTracker();
  tracker.block("nodeType", "oracle", "requiresExternalDataSource");
  check("blocked entries surface in the snapshot with a reason", tracker.snapshot().blocked.length === 1);
  check("a blocked key is excluded from unexplained gaps", tracker.unexplainedGaps("nodeType", ["oracle"], "generated").length === 0);
  check("a blocked key still appears in raw gaps", tracker.gaps("nodeType", ["oracle"], "generated")[0]?.blockedReason !== undefined);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
