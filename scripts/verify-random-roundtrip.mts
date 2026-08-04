/**
 * Randomized Automation Test Lab — Phase 3 (persistence round-trip).
 * Run with: npx tsx scripts/verify-random-roundtrip.mts
 *
 * Property under test: saving and reloading a flow is semantically stable.
 *
 *   profile → JSON → profile                       (JsonProfileStore serialization)
 *   profile → designer document → profile          (Flow Designer mapping)
 *
 * ## THIS VERIFIER IS NOW A REGRESSION GUARD (was a discovery run)
 *
 * The audit (`docs/testing/RANDOMIZED_TESTING_ARCHITECTURE.md` §3) catalogued real data loss in the
 * designer mapping. That was a **baseline discovery run** and it was expected to fail. All thirteen
 * catalogued defects (RT-01…RT-15) have since been fixed in `flowProfileMapping.ts` and the corpus
 * now round-trips **losslessly**, so this verifier is expected to be **green** and any new difference
 * is an unexpected regression. The assertions were never tuned, skipped or weakened to get there, and
 * no lost field is excluded from the equality check.
 *
 * What it produces on every run, deterministically:
 *   - a defect report (JSON + Markdown) under `reports/random-tests/`,
 *   - the original and reloaded definitions, preserved verbatim,
 *   - a field-level semantic diff grouped by shape and affected node type,
 *   - a minimal failing definition per defect,
 *   - the owning source boundary, severity and recommended fix,
 *   - reproduction commands,
 *   - and, above all, the split between KNOWN BASELINE defects and UNEXPECTED NEW failures.
 *
 * Secret handling: the lab generates secret-backed values as opaque *references* only
 * (`SafeTestData.SECRET_REFERENCES`) and never resolves them, so no plaintext can reach a fixture,
 * diff, log or artifact. That is asserted here rather than assumed.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlowProfile, FlowStep, StepType, ValueSource } from "@src/profiles/FlowProfile";
import {
  createEdge,
  createValueSource,
  fromFlowStep,
  toDesignerDocument,
  toFlowProfile,
  toFlowStep,
  type FlowDesignerEdge,
  type FlowDesignerNode
} from "@renderer/components/workflow/flowProfileMapping";
import { resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { generateFlow } from "@src/testing/random/RandomFlowGenerator";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import { ALL_FLOW_PATTERNS } from "@src/testing/random/GenerationConstraints";
import { SECRET_LEAK_CANARY, SECRET_REFERENCES } from "@src/testing/fixtures/SafeTestData";
import {
  diffSemantic,
  differenceShape,
  edgeIndexFromPath,
  groupDifferences,
  nodeIndexFromPath,
  type DifferenceGroup,
  type FieldDifference
} from "@src/testing/roundtrip/SemanticDiff";
import {
  KNOWN_ROUNDTRIP_DEFECTS,
  OBSERVED_ROUNDTRIP_DEFECTS,
  findKnownDefect,
  type RoundTripDefect
} from "@src/testing/roundtrip/RoundTripDefectCatalog";

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

const REPORT_DIR = join(process.cwd(), "reports", "random-tests");
const CAMPAIGN_SEED = "awkit-roundtrip-baseline-001";
const REPRO_COMMAND = `npx tsx scripts/verify-random-roundtrip.mts   # seed ${CAMPAIGN_SEED} (fixed)`;

/* ------------------------------------------------------------------ *
 * 1. Source-parity guard for the interim extracted mapping
 * ------------------------------------------------------------------ */
console.log("\nMapping extraction integrity");
{
  const designerSource = await readFile(join(process.cwd(), "app/renderer/pages/FlowChartDesigner.tsx"), "utf8");
  const mappingSource = await readFile(
    join(process.cwd(), "app/renderer/components/workflow/flowProfileMapping.ts"),
    "utf8"
  );

  /** Grab a top-level function's source text, from its signature to the closing brace at column 0. */
  const extract = (source: string, name: string): string | undefined => {
    const start = source.indexOf(`function ${name}(`);
    if (start < 0) return undefined;
    const end = source.indexOf("\n}\n", start);
    return end < 0 ? undefined : source.slice(start, end + 2);
  };
  /** Comments and whitespace are not behavior; anything else must match exactly. */
  const normalize = (text: string): string =>
    text
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\s+/g, " ")
      .trim();

  const mapped = ["toFlowProfile", "toFlowStep", "toNodeConfig", "createValueSource", "fromFlowStep", "createEdge"];
  const stillPrivate = mapped.filter((name) => extract(designerSource, name) !== undefined);

  if (stillPrivate.length === 0) {
    // Plan task 0.1 has landed: the designer imports the shared module and there is nothing to drift.
    check(
      "FlowChartDesigner imports the extracted mapping (task 0.1 complete)",
      designerSource.includes("flowProfileMapping")
    );
  } else {
    const drifted = stillPrivate.filter((name) => {
      const a = extract(designerSource, name);
      const b = extract(mappingSource, name);
      return !a || !b || normalize(a) !== normalize(b);
    });
    check(
      `interim copies stay identical to FlowChartDesigner (${stillPrivate.length} functions)`,
      drifted.length === 0,
      drifted.length > 0 ? `drifted: ${drifted.join(", ")}` : undefined
    );
    console.log(
      `    note: task 0.1 (delete the private copies, import from flowProfileMapping) is still pending — this guard retires itself when it lands.`
    );
  }
}

/* ------------------------------------------------------------------ *
 * 2. Generate the corpus
 * ------------------------------------------------------------------ */
const constraints = resolveConstraints({
  seed: CAMPAIGN_SEED,
  // recorderFidelity emits exactly the fields the designer mapping is suspected of dropping:
  // locators on non-requiresLocator steps, popup metadata, and secret references.
  recorderFidelity: true,
  minNodesPerFlow: 5,
  maxNodesPerFlow: 16
});

interface Case {
  readonly name: string;
  readonly original: FlowProfile;
}

const cases: Case[] = [];
for (const pattern of ALL_FLOW_PATTERNS) {
  for (let index = 0; index < 6; index += 1) {
    const name = `${pattern}-${index}`;
    cases.push({
      name,
      original: generateFlow({
        flowId: `rt-${name}`,
        flowName: `Round-trip ${name}`,
        rng: new SeededRandom(`${CAMPAIGN_SEED}::${name}`),
        constraints,
        pattern
      }).profile
    });
  }
}

/** The full save→load→save cycle through the real designer mapping. */
function designerRoundTrip(profile: FlowProfile): FlowProfile {
  const document = toDesignerDocument(profile);
  // The designer threads the loaded flow-level metadata through its own state (FlowChartDesigner
  // loadProfile → toFlowProfile), so model that here; without it RT-06/RT-07 could not be exercised.
  return toFlowProfile(document.nodes, document.edges, profile.id, profile.name, {
    description: profile.description,
    version: profile.version,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt
  });
}

/* ------------------------------------------------------------------ *
 * 3. JSON serialization round trip — expected to be lossless
 * ------------------------------------------------------------------ */
console.log("\nJSON serialization round trip (JsonProfileStore)");
{
  const lossy: string[] = [];
  for (const testCase of cases) {
    // JsonProfileStore is plain stringify/parse with an unvalidated cast (ProfileStore.ts:145,174),
    // so this models it exactly.
    const reloaded = JSON.parse(JSON.stringify(testCase.original)) as FlowProfile;
    const differences = diffSemantic(testCase.original, reloaded);
    if (differences.length > 0) lossy.push(`${testCase.name}: ${differences[0]?.path}`);
  }
  check(`${cases.length} profiles survive JSON serialization unchanged`, lossy.length === 0, lossy.slice(0, 3).join(" | "));
}

/* ------------------------------------------------------------------ *
 * 4. Designer round trip — the discovery run
 * ------------------------------------------------------------------ */
console.log("\nDesigner mapping round trip (regression guard — must stay lossless)");

const allDifferences: FieldDifference[] = [];
const perCase = new Map<string, { original: FlowProfile; reloaded: FlowProfile; differences: FieldDifference[] }>();

for (const testCase of cases) {
  const reloaded = designerRoundTrip(testCase.original);
  const differences = diffSemantic(testCase.original, reloaded);
  perCase.set(testCase.name, { original: testCase.original, reloaded, differences });
  allDifferences.push(...differences);
}

/** Resolve the step type a node-scoped diff path refers to, so defects can be attributed. */
function nodeTypeResolver(profile: FlowProfile): (path: string) => string | undefined {
  return (path: string) => {
    const index = nodeIndexFromPath(path);
    return index === undefined ? undefined : profile.nodes[index]?.type;
  };
}

// Group across the whole corpus, attributing node types per case.
const groupsByKey = new Map<string, DifferenceGroup>();
for (const [name, record] of perCase) {
  void name;
  for (const group of groupDifferences(record.differences, nodeTypeResolver(record.original))) {
    const key = `${group.shape}::${group.kind}`;
    const existing = groupsByKey.get(key);
    if (!existing) {
      groupsByKey.set(key, group);
    } else {
      groupsByKey.set(key, {
        shape: group.shape,
        kind: group.kind,
        occurrences: existing.occurrences + group.occurrences,
        example: existing.example,
        nodeTypes: [...new Set([...existing.nodeTypes, ...group.nodeTypes])].sort()
      });
    }
  }
}
const groups = [...groupsByKey.values()].sort((a, b) =>
  a.shape === b.shape ? a.kind.localeCompare(b.kind) : a.shape.localeCompare(b.shape)
);

interface ClassifiedGroup {
  readonly group: DifferenceGroup;
  readonly defect?: RoundTripDefect;
}
const classified: ClassifiedGroup[] = groups.map((group) => {
  const defect = findKnownDefect(group.shape, group.kind);
  return defect ? { group, defect } : { group };
});
const knownGroups = classified.filter((entry) => entry.defect !== undefined);
const unexpectedGroups = classified.filter((entry) => entry.defect === undefined);

console.log(
  `    ${allDifferences.length} raw differences across ${cases.length} flows → ${groups.length} distinct defect shapes`
);

/* ------------------------------------------------------------------ *
 * 5. Minimal failing definitions
 * ------------------------------------------------------------------ */
/**
 * Shrink a defect to the smallest flow that still reproduces it: `start → offending node → end`,
 * or a three-node graph carrying the offending edge. A minimized case that no longer reproduces the
 * shape is reported as such rather than silently dropped.
 */
function minimalCaseFor(group: DifferenceGroup): { profile: FlowProfile; reproduces: boolean } | undefined {
  for (const [, record] of perCase) {
    for (const difference of record.differences) {
      if (differenceShape(difference.path) !== group.shape || difference.kind !== group.kind) continue;

      const start = record.original.nodes.find((node) => node.type === "start");
      const end = record.original.nodes.find((node) => node.type === "end");
      if (!start || !end) continue;

      const nodeIndex = nodeIndexFromPath(difference.path);
      const edgeIndex = edgeIndexFromPath(difference.path);
      const scoped = nodeIndex === undefined ? undefined : record.original.nodes[nodeIndex];
      // A defect on the start or end node needs no third node — those two are already in the
      // minimal graph. Anything else contributes exactly one action node.
      const middle =
        scoped && scoped.type !== "start" && scoped.type !== "end"
          ? scoped
          : record.original.nodes.find((node) => node.type !== "start" && node.type !== "end");
      if (!middle) continue;

      // Edge-scoped defects must keep the *offending* connector, not just any one.
      const offendingEdge = edgeIndex === undefined ? undefined : record.original.edges[edgeIndex];

      const minimal: FlowProfile = {
        ...record.original,
        id: `minimal-${group.shape.replace(/[^a-zA-Z0-9]/g, "-")}`,
        nodes: [start, middle, end],
        edges: [
          offendingEdge
            ? { ...offendingEdge, source: start.id, target: middle.id }
            : { id: "min-e0", source: start.id, target: middle.id, type: "success", kind: "normal" },
          { id: "min-e1", source: middle.id, target: end.id, type: "success", kind: "normal" }
        ]
      };

      const reproduced = diffSemantic(minimal, designerRoundTrip(minimal)).some(
        (candidate) => differenceShape(candidate.path) === group.shape && candidate.kind === group.kind
      );
      return { profile: minimal, reproduces: reproduced };
    }
  }
  return undefined;
}

const minimalCases = new Map<string, { profile: FlowProfile; reproduces: boolean }>();
for (const entry of classified) {
  const minimal = minimalCaseFor(entry.group);
  if (minimal) minimalCases.set(`${entry.group.shape}::${entry.group.kind}`, minimal);
}

/* ------------------------------------------------------------------ *
 * 6. The assertions — NOT tuned to pass
 * ------------------------------------------------------------------ */
console.log("\nRound-trip equality (unmodified assertions)");
check(
  `all ${cases.length} generated flows survive the designer round trip unchanged`,
  allDifferences.length === 0,
  `${allDifferences.length} field differences across ${groups.length} defect shapes — see the report`
);

for (const defect of KNOWN_ROUNDTRIP_DEFECTS) {
  const observed = classified.some((entry) => entry.defect?.id === defect.id);
  if (!observed) continue;
  check(`${defect.id}: ${defect.title}`, false, `${defect.severity} — owner: ${defect.owner.split(" ")[0]}`);
}

console.log("\nBaseline classification");
check(
  "every observed difference is explained by a catalogued defect (no unexpected new failures)",
  unexpectedGroups.length === 0,
  unexpectedGroups.length > 0
    ? unexpectedGroups.map((entry) => `${entry.group.shape} (${entry.group.kind})`).join(", ")
    : undefined
);

// Only `observed` entries are asserted. `predicted` ones are read from the source but not yet
// exercised by the corpus; asserting them would make the catalog claim more than the run proves.
const unobservedDefects = OBSERVED_ROUNDTRIP_DEFECTS.filter(
  (defect) => !classified.some((entry) => entry.defect?.id === defect.id)
);
check(
  "every catalogued 'observed' defect still reproduces",
  unobservedDefects.length === 0,
  unobservedDefects.length > 0
    ? `no longer reproduced (fixed — delete the entry — or a generator coverage regression): ${unobservedDefects.map((defect) => defect.id).join(", ")}`
    : undefined
);

const predictedDefects = KNOWN_ROUNDTRIP_DEFECTS.filter((defect) => defect.status === "predicted");
console.log(
  `    ${OBSERVED_ROUNDTRIP_DEFECTS.length} observed defects asserted; ${predictedDefects.length} predicted but not exercised (${predictedDefects
    .map((defect) => defect.id)
    .join(", ")})`
);

/* ------------------------------------------------------------------ *
 * 6b. Value-source edit paths (regression cover for the RT-14/RT-02 fix)
 * ------------------------------------------------------------------ */
console.log("\nValue-source handling");
{
  const step = (valueSource: ValueSource, extra: Partial<FlowStep> = {}): FlowStep => ({
    id: "vs-1",
    type: "fill",
    name: "vs",
    locator: { strategy: "id", value: "firstName" },
    valueSource,
    ...extra
  });

  // Preserved untouched: the panel cannot author these, so a save must not rebuild them.
  const envBack = createValueSource(fromFlowStep(step({ type: "env", envKey: "AWKIT_LAB_ENV_ALPHA" }, { value: "literal-fallback" })));
  check("env source keeps its envKey", envBack?.type === "env" && envBack.envKey === "AWKIT_LAB_ENV_ALPHA", JSON.stringify(envBack));

  const secretBack = createValueSource(fromFlowStep(step({ type: "secret", secretName: "awkit-lab-secret-ref-0001" })));
  check(
    "secret source survives with no literal attached",
    secretBack?.type === "secret" && secretBack.secretName === "awkit-lab-secret-ref-0001" && secretBack.value === undefined,
    JSON.stringify(secretBack)
  );

  const generatedBack = createValueSource(fromFlowStep(step({ type: "generated", generator: "randomEmail" })));
  check("generated source keeps a generator inside its union", generatedBack?.type === "generated" && generatedBack.generator === "randomEmail");

  // The `goto` case that used to corrupt everything: url must not leak into the source.
  const gotoBack = createValueSource(
    fromFlowStep(step({ type: "env", envKey: "AWKIT_LAB_ENV_BRAVO" }, { type: "goto", url: "http://127.0.0.1:4321/form.html" }))
  );
  check("a goto url no longer overwrites its value source", gotoBack?.type === "env" && gotoBack.envKey === "AWKIT_LAB_ENV_BRAVO", JSON.stringify(gotoBack));

  // Authorable kinds still behave, including switching an unauthorable one to static.
  const staticBack = createValueSource(fromFlowStep(step({ type: "static", value: "lab-alpha" }, { value: "lab-alpha" })));
  check("static source round-trips its value", staticBack?.type === "static" && staticBack.value === "lab-alpha");

  const switched = { ...fromFlowStep(step({ type: "env", envKey: "AWKIT_LAB_ENV_ALPHA" })), valueSourceType: "static" as const, value: "typed-by-user" };
  const switchedBack = createValueSource(switched);
  check(
    "switching an env source to Static produces a static source from the typed value",
    switchedBack?.type === "static" && switchedBack.value === "typed-by-user",
    JSON.stringify(switchedBack)
  );

  const toDynamic = { ...fromFlowStep(step({ type: "env", envKey: "AWKIT_LAB_ENV_ALPHA" })), valueSourceType: "dynamic" as const };
  check("switching to Dynamic produces a dynamic source", createValueSource(toDynamic)?.type === "dynamic");

  // A step with no source at all must not acquire one.
  const none = createValueSource(fromFlowStep({ id: "vs-2", type: "click", name: "c", locator: { strategy: "id", value: "resetButton" } }));
  check("a step with no value source does not gain one", none === undefined, JSON.stringify(none));
}

/* ------------------------------------------------------------------ *
 * 6c. Field edit paths (regression cover for the RT-01/03/04/05/08/10/12 fixes)
 * ------------------------------------------------------------------ *
 * The corpus above only exercises load→save with no edits. These check the paths a *user* takes —
 * editing a previously-absent field, or relying on a recorder-owned field surviving — which the
 * corpus cannot reach. Kept small and explicit so a regression names the exact behavior lost.
 */
console.log("\nField preservation and edit paths");
{
  const nodeFrom = (step: FlowStep): FlowDesignerNode => ({ id: step.id, type: "actionNode", position: { x: 0, y: 0 }, data: fromFlowStep(step) });
  const roundTripStep = (step: FlowStep, edges: FlowDesignerEdge[] = []): FlowStep => toFlowStep(nodeFrom(step), edges);

  // RT-01: a locator on a `wait` step (which the catalog does not mark requiresLocator) is preserved.
  const waitBack = roundTripStep({ id: "w1", type: "wait", name: "w", locator: { strategy: "id", value: "spinner" }, config: { waitType: "selector" } });
  check("RT-01: a wait step keeps its locator through a save", waitBack.locator?.value === "spinner", JSON.stringify(waitBack.locator));

  // RT-03: recorder popup metadata survives a designer re-save.
  const popupBack = roundTripStep({ id: "p1", type: "click", name: "opener", locator: { strategy: "id", value: "open" }, pageAlias: "main", opensPopup: true, popupExpectation: { popupAlias: "popup-1" } });
  check("RT-03: opensPopup + popupExpectation survive a save", popupBack.opensPopup === true && popupBack.popupExpectation?.popupAlias === "popup-1", JSON.stringify(popupBack.popupExpectation));

  // RT-13: outer-to-inner nested recorder scope remains byte-for-byte stable through Designer.
  const nestedContext = { containers: [
    { type: "section" as const, strategy: "testId" as const, value: "workspace-primary" },
    { type: "card" as const, strategy: "testId" as const, value: "account-acme", hasText: "Acme" }
  ] };
  const nestedBack = roundTripStep({ id: "lc1", type: "click", name: "Confirm", locator: { strategy: "role", value: "button", name: "Confirm", context: nestedContext } });
  check("RT-13: nested locator container chain survives a save", JSON.stringify(nestedBack.locator?.context) === JSON.stringify(nestedContext), JSON.stringify(nestedBack.locator?.context));

  // RT-04: an explicit non-retryable safety policy is not downgraded to a heuristic on save.
  const safetyBack = roundTripStep({ id: "s1", type: "click", name: "danger", locator: { strategy: "id", value: "delete" }, safety: { sideEffectLevel: "dangerousMutation", retryable: false } });
  check("RT-04: a non-retryable safety policy survives a save", safetyBack.safety?.sideEffectLevel === "dangerousMutation" && safetyBack.safety?.retryable === false, JSON.stringify(safetyBack.safety));

  // RT-12: a multi-key typed outputs map survives with its declared types, not collapsed to one text key.
  const outputsBack = roundTripStep({ id: "o1", type: "readText", name: "read", locator: { strategy: "id", value: "total" }, outputs: { total: { type: "number" }, label: { type: "text" } } });
  check("RT-12: a multi-key outputs map survives with its types", JSON.stringify(outputsBack.outputs) === JSON.stringify({ total: { type: "number" }, label: { type: "text" } }), JSON.stringify(outputsBack.outputs));

  // RT-10: an absent optional field stays absent on a no-op save…
  const noTimeout = roundTripStep({ id: "t1", type: "click", name: "c", locator: { strategy: "id", value: "go" } });
  check("RT-10: an absent timeoutMs stays absent on a no-op save", noTimeout.timeoutMs === undefined, JSON.stringify(noTimeout.timeoutMs));

  // …but an edit to that same field is always persisted (the edit-safety guard).
  const editedNode = nodeFrom({ id: "t2", type: "click", name: "c", locator: { strategy: "id", value: "go" } });
  const editedBack = toFlowStep({ ...editedNode, data: { ...editedNode.data, timeoutMs: 45000 } }, []);
  check("RT-10: an edited timeoutMs is persisted even though it was absent on load", editedBack.timeoutMs === 45000, JSON.stringify(editedBack.timeoutMs));

  // RT-08: an unlabelled connector persists no fabricated label equal to its type.
  const unlabelled = toFlowProfile([], [createEdge("a", "b", "success")], "f", "F").edges[0];
  check("RT-08: an unlabelled connector persists no fabricated label", unlabelled?.label === undefined, JSON.stringify(unlabelled?.label));

  // RT-05: two connectors sharing a source+target keep their distinct persisted ids on load.
  const twoEdges = toDesignerDocument({
    id: "f",
    name: "F",
    version: 1,
    nodes: [],
    edges: [
      { id: "edge-keep-1", source: "a", target: "b", type: "conditional" },
      { id: "edge-keep-2", source: "a", target: "b", type: "conditional" }
    ]
  }).edges;
  check("RT-05: two edges sharing a source+target keep distinct persisted ids", twoEdges[0]?.id === "edge-keep-1" && twoEdges[1]?.id === "edge-keep-2", twoEdges.map((edge) => edge.id).join(","));
}

/* ------------------------------------------------------------------ *
 * 7. Secret safety
 * ------------------------------------------------------------------ */
console.log("\nSecret handling");
{
  const secretSteps: FlowStep[] = [];
  for (const [, record] of perCase) {
    secretSteps.push(...record.original.nodes.filter((node) => node.valueSource?.type === "secret"));
  }
  check("the corpus exercises secret-backed value sources", secretSteps.length > 0, `${secretSteps.length} steps`);
  check(
    "generated secret sources carry a reference and no literal value",
    secretSteps.every((step) => Boolean(step.valueSource?.secretName) && step.value === undefined)
  );

  const serializedDiff = JSON.stringify([...perCase.values()].map((record) => record.differences));
  check("no secret is resolved anywhere in the diff — the canary never appears", !serializedDiff.includes(SECRET_LEAK_CANARY));
  const referencesInDiff = SECRET_REFERENCES.filter((reference) => serializedDiff.includes(reference));
  check(
    "diffs may name opaque secret references, which carry no sensitive material",
    referencesInDiff.every((reference) => reference.startsWith("awkit-lab-secret-ref-")),
    `${referencesInDiff.length} references present`
  );

  // The defect itself: the reference does not survive. Asserted directly, not inferred from the diff.
  const survivors = secretSteps.filter((step) => {
    for (const [, record] of perCase) {
      const reloaded = record.reloaded.nodes.find((node) => node.id === step.id);
      if (reloaded) return reloaded.valueSource?.secretName === step.valueSource?.secretName;
    }
    return false;
  });
  check(
    "secret references survive the round trip",
    survivors.length === secretSteps.length,
    `${secretSteps.length - survivors.length}/${secretSteps.length} lost — RT-02`
  );
}

/* ------------------------------------------------------------------ *
 * 8. Write the deterministic defect report
 * ------------------------------------------------------------------ */
await mkdir(REPORT_DIR, { recursive: true });

const affectedNodeTypeCounts = new Map<StepType, number>();
for (const [, record] of perCase) {
  const resolve = nodeTypeResolver(record.original);
  for (const difference of record.differences) {
    const type = resolve(difference.path) as StepType | undefined;
    if (type) affectedNodeTypeCounts.set(type, (affectedNodeTypeCounts.get(type) ?? 0) + 1);
  }
}

const reportJson = {
  campaign: {
    seed: CAMPAIGN_SEED,
    generatorVersion: constraints.generatorVersion,
    reproductionCommand: REPRO_COMMAND,
    generatedAt: "deterministic — this report is byte-stable for a fixed seed",
    flowCount: cases.length,
    constraints
  },
  summary: {
    rawDifferences: allDifferences.length,
    defectShapes: groups.length,
    knownBaselineShapes: knownGroups.length,
    unexpectedNewShapes: unexpectedGroups.length,
    catalogedDefectsObserved: KNOWN_ROUNDTRIP_DEFECTS.filter((defect) =>
      classified.some((entry) => entry.defect?.id === defect.id)
    ).map((defect) => defect.id),
    catalogedDefectsNotObserved: unobservedDefects.map((defect) => defect.id)
  },
  findings: classified.map((entry) => {
    const minimal = minimalCases.get(`${entry.group.shape}::${entry.group.kind}`);
    return {
      shape: entry.group.shape,
      kind: entry.group.kind,
      occurrences: entry.group.occurrences,
      affectedNodeTypes: entry.group.nodeTypes,
      classification: entry.defect ? "knownBaseline" : "UNEXPECTED_NEW_FAILURE",
      defectId: entry.defect?.id ?? null,
      severity: entry.defect?.severity ?? "unclassified",
      boundary: entry.defect?.boundary ?? "unknown",
      owner: entry.defect?.owner ?? "unknown — investigate",
      impact: entry.defect?.impact ?? "unknown — investigate",
      recommendedFix: entry.defect?.recommendedFix ?? "unknown — triage required",
      example: { path: entry.group.example.path, before: entry.group.example.before, after: entry.group.example.after },
      minimalFailingDefinition: minimal ? { reproduces: minimal.reproduces, profile: minimal.profile } : null
    };
  }),
  affectedNodeTypes: [...affectedNodeTypeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, differences: count })),
  // Definitions preserved verbatim — the instruction is explicit that both sides are kept.
  definitions: [...perCase.entries()].map(([name, record]) => ({
    case: name,
    original: record.original,
    reloaded: record.reloaded,
    differences: record.differences
  }))
};

await writeFile(join(REPORT_DIR, "roundtrip-defects.json"), `${JSON.stringify(reportJson, null, 2)}\n`, "utf8");

const md: string[] = [
  "# Round-trip defect report — Phase 3 baseline discovery",
  "",
  `Seed: \`${CAMPAIGN_SEED}\` · Generator: \`${constraints.generatorVersion}\` · Flows: ${cases.length}`,
  "",
  "**This run is expected to fail.** It is a baseline discovery pass over the persistence boundary;",
  "the assertions are unmodified and no lost field is excluded from the equality check.",
  "",
  "## Reproduce",
  "",
  "```bash",
  REPRO_COMMAND,
  "```",
  "",
  "## Summary",
  "",
  `| Metric | Value |`,
  `|---|---|`,
  `| Raw field differences | ${allDifferences.length} |`,
  `| Distinct defect shapes | ${groups.length} |`,
  `| Known baseline | ${knownGroups.length} |`,
  `| **Unexpected new failures** | **${unexpectedGroups.length}** |`,
  ""
];

if (unexpectedGroups.length > 0) {
  md.push("## ⚠ Unexpected new failures", "", "Not explained by any catalogued defect. Triage these first.", "");
  for (const entry of unexpectedGroups) {
    md.push(
      `### \`${entry.group.shape}\` (${entry.group.kind}) × ${entry.group.occurrences}`,
      "",
      `- Node types: ${entry.group.nodeTypes.length > 0 ? entry.group.nodeTypes.join(", ") : "n/a"}`,
      `- Example: \`${entry.group.example.path}\``,
      `  - before: \`${JSON.stringify(entry.group.example.before)?.slice(0, 200)}\``,
      `  - after: \`${JSON.stringify(entry.group.example.after)?.slice(0, 200)}\``,
      ""
    );
  }
}

md.push("## Known baseline defects", "");
for (const defect of KNOWN_ROUNDTRIP_DEFECTS) {
  const entries = classified.filter((entry) => entry.defect?.id === defect.id);
  if (entries.length === 0) continue;
  const occurrences = entries.reduce((sum, entry) => sum + entry.group.occurrences, 0);
  const nodeTypes = [...new Set(entries.flatMap((entry) => entry.group.nodeTypes))].sort();
  const minimal = minimalCases.get(`${entries[0]?.group.shape}::${entries[0]?.group.kind}`);
  md.push(
    `### ${defect.id} — ${defect.title}`,
    "",
    `- **Severity:** ${defect.severity}`,
    `- **Boundary:** ${defect.boundary}`,
    `- **Owner:** \`${defect.owner}\``,
    `- **Occurrences:** ${occurrences} across shapes ${entries.map((entry) => `\`${entry.group.shape}\``).join(", ")}`,
    `- **Affected node types:** ${nodeTypes.length > 0 ? nodeTypes.join(", ") : defect.affectedNodeTypes}`,
    `- **Impact:** ${defect.impact}`,
    `- **Recommended fix:** ${defect.recommendedFix}`,
    `- **Minimal failing definition:** ${
      minimal ? `${minimal.reproduces ? "reproduces" : "DID NOT reproduce when minimized"} — see \`roundtrip-defects.json\`` : "not minimized"
    }`,
    ""
  );
}

md.push(
  "## Scope note",
  "",
  "These are product defects. Phase 3 does not repair them — the implementation plan assigns the",
  "fixes to their own scope. Do not tune, skip or weaken these assertions to make this run green.",
  ""
);

await writeFile(join(REPORT_DIR, "roundtrip-defects.md"), `${md.join("\n")}\n`, "utf8");

console.log(`\nReport written:\n  ${join(REPORT_DIR, "roundtrip-defects.json")}\n  ${join(REPORT_DIR, "roundtrip-defects.md")}`);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
