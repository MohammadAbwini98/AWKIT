/**
 * Randomized Automation Test Lab — Phase 2 (validation oracle + mutation testing).
 * Run with: npx tsx scripts/verify-random-oracle.mts
 *
 * Two properties:
 *   1. A valid generated flow is accepted by every real validator (the negative control — without
 *      it, a validator that rejects everything would score full marks on the mutation suite).
 *   2. A flow carrying exactly one controlled defect produces the outcome the oracle declares.
 *
 * ## Status after Tranche 2 Stage 2b
 *
 * Phase 2 found 9 of 13 controlled defect classes detected by nothing. Stage 2a closed all 9 in the
 * shared engine (`src/validation/FlowValidator.ts`); Stage 2b wired that engine into production —
 * `PreRunValidator` delegates all flow-definition rules to it (deleting the drifted hardcoded
 * locator list of `awkit-acw`), the run gate blocks on the engine's blocking policy, and the
 * designer/library/import surface the same reports. `KNOWN_VALIDATION_GAPS` and
 * `PRODUCTION_UNENFORCED_RULES` are both empty and asserted so — they are regression guards now.
 *
 * Pure: no browser, no Electron. Writes a gap report to `reports/random-tests/`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlowProfile, FlowStep, StepLocator } from "@src/profiles/FlowProfile";
import { ALL_FLOW_PATTERNS, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { generateFlow } from "@src/testing/random/RandomFlowGenerator";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import {
  ALL_MUTATION_KINDS,
  applyMutation,
  requiredValueMutationTarget,
  type MutationKind,
  type RequiredValueMutationTarget
} from "@src/testing/random/RandomMutator";
import {
  KNOWN_VALIDATION_GAPS,
  MUTATION_EXPECTATIONS,
  PRODUCTION_UNENFORCED_RULES,
  deriveEngineLocatorValidatedTypes,
  deriveLocatorValidatedTypes,
  judgeMutation,
  requirementTableDrift,
  validateFlowProfile
} from "@src/testing/oracle/TestExecutionOracle";
import { ALL_NODE_TYPES, NODE_CATALOG } from "@src/testing/random/NodeCatalog";
import { CoverageTracker } from "@src/testing/random/CoverageTracker";

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
const CAMPAIGN_SEED = "awkit-oracle-baseline-001";

const constraints = resolveConstraints({
  seed: CAMPAIGN_SEED,
  recorderFidelity: true,
  minNodesPerFlow: 6,
  maxNodesPerFlow: 16
});

const corpus: FlowProfile[] = [];
for (const pattern of ALL_FLOW_PATTERNS) {
  for (let index = 0; index < 6; index += 1) {
    corpus.push(
      generateFlow({
        flowId: `oracle-${pattern}-${index}`,
        flowName: `Oracle ${pattern} ${index}`,
        rng: new SeededRandom(`${CAMPAIGN_SEED}::${pattern}-${index}`),
        constraints,
        // Earlier flows only, so `runFlow` nodes are placeable and every reference resolves.
        referenceableFlowIds: corpus.map((profile) => profile.id).slice(0, 3),
        pattern
      }).profile
    );
  }
}

// Measured against the real validators, never against a copy of their lists.
const locatorValidatedTypes = deriveLocatorValidatedTypes();
const engineLocatorValidatedTypes = deriveEngineLocatorValidatedTypes();
// The whole corpus is the flow library, so a `runFlow` targeting a sibling resolves and only a
// deliberately broken reference is reported.
const corpusFlowIds = new Set(corpus.map((profile) => profile.id));
const oracleContext = { locatorValidatedTypes, referenceableFlowIds: corpusFlowIds };

/* ------------------------------------------------------------------ *
 * 1. Negative control — valid flows must be accepted
 * ------------------------------------------------------------------ */
console.log("\nValid generated flows are accepted by the real validators");
{
  const connectorRejections: string[] = [];
  const preRunRejections: string[] = [];
  const engineRejections: string[] = [];
  const engineWarnings: string[] = [];

  for (const profile of corpus) {
    const result = validateFlowProfile(profile, { referenceableFlowIds: corpusFlowIds });
    if (result.connectorIssues.length > 0) connectorRejections.push(`${profile.id}: ${result.connectorIssues[0]}`);
    if (result.preRunErrors.length > 0) preRunRejections.push(`${profile.id}: ${result.preRunErrors[0]?.message}`);
    if (result.flowErrors.length > 0) engineRejections.push(`${profile.id}: ${result.flowErrors[0]?.code} — ${result.flowErrors[0]?.message}`);
    if (result.flowWarnings.length > 0) engineWarnings.push(`${profile.id}: ${result.flowWarnings[0]?.code}`);
  }

  check(`${corpus.length} valid flows produce zero connector-structure issues`, connectorRejections.length === 0, connectorRejections.slice(0, 3).join(" | "));
  check(`${corpus.length} valid flows produce zero pre-run errors`, preRunRejections.length === 0, preRunRejections.slice(0, 3).join(" | "));
  // The control that keeps the new engine honest: a validator that rejected everything would
  // otherwise score full marks on the mutation suite below.
  check(`${corpus.length} valid flows produce zero FlowValidator errors`, engineRejections.length === 0, engineRejections.slice(0, 3).join(" | "));
  check(`${corpus.length} valid flows produce zero FlowValidator warnings`, engineWarnings.length === 0, engineWarnings.slice(0, 3).join(" | "));
}

/* ------------------------------------------------------------------ *
 * 1b. Locator-validation coverage by node type
 * ------------------------------------------------------------------ */
console.log("\nLocator validation coverage (node catalog vs. validators)");
const locatorRequiringTypes = ALL_NODE_TYPES.filter((type) => NODE_CATALOG[type].requiresLocator);
const locatorCoverageDrift = locatorRequiringTypes.filter((type) => !locatorValidatedTypes.has(type));
const engineLocatorDrift = locatorRequiringTypes.filter((type) => !engineLocatorValidatedTypes.has(type));
{
  check(
    `FlowValidator enforces a locator for all ${locatorRequiringTypes.length} types that require one`,
    engineLocatorDrift.length === 0,
    engineLocatorDrift.length > 0 ? `NOT enforced for: ${engineLocatorDrift.join(", ")}` : undefined
  );

  check(
    "the engine's STEP_REQUIREMENTS table agrees with the test lab's NODE_CATALOG",
    requirementTableDrift().length === 0,
    requirementTableDrift()
      .map((entry) => `${entry.type}.${entry.field}: engine=${entry.engine} catalog=${entry.catalog}`)
      .join(" | ")
  );

  // Stage 2b deleted PreRunValidator's hardcoded list — it delegates to the engine's
  // STEP_REQUIREMENTS-derived set, so the production gate must now cover every type (`radio`
  // included — awkit-acw closed). Any drift here is a regression in the delegation.
  check(
    `PreRunValidator (via engine delegation) enforces a locator for all ${locatorRequiringTypes.length} types — awkit-acw closed`,
    locatorCoverageDrift.length === 0,
    `observed drift: [${locatorCoverageDrift.join(", ")}]`
  );

  check(
    "PRODUCTION_UNENFORCED_RULES is empty — every detected rule reaches a production caller",
    PRODUCTION_UNENFORCED_RULES.length === 0,
    PRODUCTION_UNENFORCED_RULES.map((expectation) => expectation.kind).join(", ")
  );
}

/* ------------------------------------------------------------------ *
 * 2. Mutation testing — exactly one controlled defect per scenario
 * ------------------------------------------------------------------ */
console.log("\nControlled mutations (one defect per scenario)");

const coverage = new CoverageTracker();
interface MutationOutcome {
  readonly kind: MutationKind;
  readonly applied: number;
  readonly matched: number;
  readonly discrepancies: string[];
  readonly exampleSignal?: string;
}

interface ObservedExpectationRegression {
  readonly kind: MutationKind;
  readonly applied: number;
  readonly matched: number;
  readonly discrepancies: readonly string[];
}

function observedExpectationRegressions(source: readonly MutationOutcome[]): ObservedExpectationRegression[] {
  return source
    .filter(
      (outcome) =>
        MUTATION_EXPECTATIONS[outcome.kind].status === "detected" &&
        (outcome.applied === 0 || outcome.matched !== outcome.applied)
    )
    .map(({ kind, applied, matched, discrepancies }) => ({ kind, applied, matched, discrepancies }));
}

function observedDetectionSummary(source: readonly MutationOutcome[]): { readonly ok: boolean; readonly message: string } {
  const regressions = observedExpectationRegressions(source);
  if (regressions.length === 0) {
    const detectedKinds = source.filter((outcome) => MUTATION_EXPECTATIONS[outcome.kind].status === "detected").length;
    return {
      ok: true,
      message: `✓ All ${detectedKinds} detected-expectation mutation kinds were rejected in every observed application.`
    };
  }
  return {
    ok: false,
    message: `⚠ ${regressions.length} observed mutation expectation regression(s): ${regressions
      .map((entry) => `${entry.kind} ${entry.matched}/${entry.applied}`)
      .join(", ")}. See validation-gaps.md.`
  };
}

const outcomes: MutationOutcome[] = [];

for (const kind of ALL_MUTATION_KINDS) {
  let applied = 0;
  let matched = 0;
  const discrepancies: string[] = [];
  let exampleSignal: string | undefined;

  for (const profile of corpus) {
    const mutated = applyMutation(profile, kind, new SeededRandom(`${CAMPAIGN_SEED}::mut::${kind}::${profile.id}`));
    // `undefined` means this flow had no target for the mutation — not a pass, just not applicable.
    if (!mutated) continue;
    applied += 1;
    coverage.recordGenerated("mutationKind", kind);

    const verdict = judgeMutation(mutated.profile, mutated.mutation, oracleContext);
    if (verdict.matchesExpectation) {
      matched += 1;
      if (verdict.rejected && !exampleSignal) {
        exampleSignal = verdict.result.connectorIssues[0] ?? verdict.result.preRunErrors[0]?.message;
      }
    } else if (discrepancies.length < 3) {
      discrepancies.push(`${profile.id}: ${verdict.discrepancy}`);
    }
  }

  outcomes.push(exampleSignal === undefined ? { kind, applied, matched, discrepancies } : { kind, applied, matched, discrepancies, exampleSignal });
}

/* ------------------------------------------------------------------ *
 * 2a. Focused required-value mutator contract probes
 * ------------------------------------------------------------------ */
console.log("\nRequired-value mutation targeting contract");
{
  const locator: StepLocator = { strategy: "css", value: "#probe", resolution: "resolved", resolvedBy: "user" };
  const step = (id: string, type: FlowStep["type"], overrides: Omit<Partial<FlowStep>, "id" | "type" | "name"> = {}): FlowStep => ({
    id,
    type,
    name: `Probe ${id}`,
    ...overrides
  });
  const eligible: readonly { readonly step: FlowStep; readonly channel: RequiredValueMutationTarget }[] = [
    { step: step("generic-goto", "goto", { url: "https://example.test" }), channel: "genericValue" },
    { step: step("generic-press", "press", { value: "Enter" }), channel: "genericValue" },
    { step: step("generic-fill", "fill", { locator, value: "Ada" }), channel: "genericValue" },
    { step: step("generic-select", "select", { locator, value: "alpha" }), channel: "genericValue" },
    { step: step("generic-radio", "radio", { locator, value: "alpha" }), channel: "genericValue" },
    { step: step("generic-upload", "uploadFile", { locator, value: "C:\\fixture.txt" }), channel: "genericValue" },
    { step: step("generic-condition", "condition", { value: "true" }), channel: "genericValue" },
    { step: step("generic-login", "autoSecureLogin", { value: "https://login.example.test" }), channel: "genericValue" },
    { step: step("assert-config", "assertText", { config: { assertionType: "url", expectedValue: "example.test" } }), channel: "assertionExpectedValue" },
    { step: step("wait-time", "wait", { config: { waitType: "time" }, timeoutMs: 250 }), channel: "timeWaitDuration" },
    { step: step("wait-text", "wait", { config: { waitType: "textVisible" }, value: "Ready", timeoutMs: 5000 }), channel: "textVisibleWaitText" },
    { step: step("scroll-page", "scroll", { config: { scrollTarget: "page", scrollAmount: 320 } }), channel: "pageScrollDistance" },
    { step: step("loop-fixed", "loop", { config: { loopType: "fixedCount", iterationCount: 3, loopActionType: "scroll", scrollAmount: 100 } }), channel: "fixedLoopIterationCount" },
    { step: step("run-flow", "runFlow", { flowId: corpus[0]?.id }), channel: "runFlowTarget" }
  ];
  const ineligible: readonly FlowStep[] = [
    step("wait-selector", "wait", { config: { waitType: "selector" }, locator }),
    step("wait-navigation", "wait", { config: { waitType: "navigation" } }),
    step("wait-network", "wait", { config: { waitType: "networkIdle" } }),
    step("scroll-element", "scroll", { config: { scrollTarget: "element" }, locator }),
    step("loop-elements", "loop", { config: { loopType: "elements", loopActionType: "click" }, locator }),
    step("loop-data", "loop", { config: { loopType: "dataRows", loopActionType: "scroll", scrollAmount: 100 } }),
    step("already-missing", "fill", { locator })
  ];

  const eligibleDrift = eligible
    .filter((probe) => requiredValueMutationTarget(probe.step) !== probe.channel)
    .map((probe) => `${probe.step.id}: expected ${probe.channel}, got ${String(requiredValueMutationTarget(probe.step))}`);
  const ineligibleDrift = ineligible
    .filter((probe) => requiredValueMutationTarget(probe) !== undefined)
    .map((probe) => `${probe.id}: got ${String(requiredValueMutationTarget(probe))}`);
  check("all concrete required-value shapes select their exact runtime channel", eligibleDrift.length === 0, eligibleDrift.join(" | "));
  check("optional and already-invalid shapes are ineligible for missingRequiredValue", ineligibleDrift.length === 0, ineligibleDrift.join(" | "));

  const exactCases = eligible;
  const targetDrift: string[] = [];
  const resultDrift: string[] = [];
  let immutable = true;
  for (const probe of exactCases) {
    const profile: FlowProfile = {
      id: `required-value-${probe.step.id}`,
      name: `Required value ${probe.step.id}`,
      version: 1,
      nodes: [
        { id: "start", type: "start", name: "Start" },
        probe.step,
        { id: "end", type: "end", name: "End" }
      ],
      edges: [
        { id: "start-action", source: "start", target: probe.step.id, type: "success", kind: "normal" },
        { id: "action-end", source: probe.step.id, target: "end", type: "success", kind: "normal" }
      ]
    };
    const before = JSON.stringify(profile);
    const mutated = applyMutation(profile, "missingRequiredValue", new SeededRandom(`required-value::${probe.step.id}`));
    immutable = immutable && JSON.stringify(profile) === before;
    if (mutated?.mutation.targetId !== probe.step.id || mutated.mutation.targetType !== probe.step.type || !mutated.mutation.description.includes(probe.channel)) {
      targetDrift.push(`${probe.step.id}: ${JSON.stringify(mutated?.mutation)}`);
      continue;
    }
    const verdict = judgeMutation(mutated.profile, mutated.mutation, oracleContext);
    const targetIssues = verdict.result.flowErrors.filter((issue) => issue.nodeId === probe.step.id);
    if (!verdict.matchesExpectation || targetIssues.length !== 1 || targetIssues[0]?.code !== "missingRequiredValue") {
      resultDrift.push(`${probe.step.id}: ${targetIssues.map((issue) => issue.code).join(",") || "no target issue"}`);
    }
  }
  check("focused mutations report the exact target id, type and removed channel", targetDrift.length === 0, targetDrift.join(" | "));
  check("each focused mutation produces exactly one missingRequiredValue issue on its target", resultDrift.length === 0, resultDrift.join(" | "));
  check("focused missingRequiredValue mutations leave every input profile immutable", immutable);

  const syntheticMismatch = outcomes.map((outcome) =>
    outcome.kind === "missingRequiredValue" ? { ...outcome, applied: 2, matched: 1 } : outcome
  );
  const syntheticSummary = observedDetectionSummary(syntheticMismatch);
  check(
    "observed final/report status turns red for a measured mismatch instead of using a static all-green claim",
    !syntheticSummary.ok && syntheticSummary.message.includes("missingRequiredValue 1/2") && !syntheticSummary.message.startsWith("✓"),
    syntheticSummary.message
  );
}

// Every mutation must find a target somewhere in the corpus, or it is proving nothing.
const neverApplied = outcomes.filter((outcome) => outcome.applied === 0);
check(
  `all ${ALL_MUTATION_KINDS.length} mutation kinds found a target in the corpus`,
  neverApplied.length === 0,
  neverApplied.map((outcome) => outcome.kind).join(", ")
);

console.log("\n  Detected as expected (validation works):");
for (const outcome of outcomes.filter((o) => MUTATION_EXPECTATIONS[o.kind].status === "detected")) {
  const expectation = MUTATION_EXPECTATIONS[outcome.kind];
  check(
    `${outcome.kind} — rejected in ${outcome.matched}/${outcome.applied} flows by ${expectation.detectedBy}${expectation.productionEnforced ? "" : " (engine only — not yet wired into production)"}`,
    outcome.applied > 0 && outcome.matched === outcome.applied,
    outcome.discrepancies.join(" | ")
  );
}

console.log("\n  Known validation gaps (asserted to STILL be gaps — these are holes, not passes):");
if (KNOWN_VALIDATION_GAPS.length === 0) {
  console.log("  — none: Stage 2a closed all 9 in the engine; Stage 2b wired them into the run gate.");
}
for (const outcome of outcomes.filter((o) => MUTATION_EXPECTATIONS[o.kind].status === "knownGap")) {
  check(
    `${outcome.kind} — still undetected in ${outcome.matched}/${outcome.applied} flows`,
    outcome.applied > 0 && outcome.matched === outcome.applied,
    outcome.discrepancies.join(" | ")
  );
}

/* ------------------------------------------------------------------ *
 * 2b. Active-path classification
 * ------------------------------------------------------------------ */
console.log("\nActive-path classification (drives the Stage 2b blocking policy)");
{
  // `unreachableNode` is off-path by definition — the whole point of the classification. Every
  // other defect is injected onto the reachable path, so it must be reported as active.
  const offPathByDesign = new Set(["unreachableNode"]);
  const misclassified: string[] = [];
  let activePathKinds = 0;
  let offPathKinds = 0;

  for (const kind of ALL_MUTATION_KINDS) {
    let applied = 0;
    let active = 0;
    for (const profile of corpus) {
      const mutated = applyMutation(profile, kind, new SeededRandom(`${CAMPAIGN_SEED}::mut::${kind}::${profile.id}`));
      if (!mutated) continue;
      const result = validateFlowProfile(mutated.profile, { referenceableFlowIds: corpusFlowIds });
      // Structural connector rules are wrapped from the legacy gate, which has no engine rule.
      if (result.flowErrors.length === 0) continue;
      applied += 1;
      if (result.flowActivePathErrors.length > 0) active += 1;
    }
    if (applied === 0) continue;
    if (offPathByDesign.has(kind)) {
      offPathKinds += 1;
      if (active !== 0) misclassified.push(`${kind}: ${active}/${applied} reported on the active path`);
    } else {
      activePathKinds += 1;
      if (active !== applied) misclassified.push(`${kind}: only ${active}/${applied} reported on the active path`);
    }
  }

  check(
    `${activePathKinds} defect kinds injected onto the reachable path are classified onActivePath`,
    misclassified.length === 0,
    misclassified.slice(0, 3).join(" | ")
  );
  check(`${offPathKinds} off-path-by-definition kind (unreachableNode) is never classified onActivePath`, offPathKinds === 1 && misclassified.length === 0);
}

/* ------------------------------------------------------------------ *
 * 3. One-defect-per-scenario invariant
 * ------------------------------------------------------------------ */
console.log("\nMutation hygiene");
{
  const base = corpus[0] as FlowProfile;
  const before = JSON.stringify(base);
  applyMutation(base, "missingRequiredLocator", new SeededRandom("hygiene"));
  check("applyMutation never modifies the input profile", JSON.stringify(base) === before);

  const first = applyMutation(base, "invalidTimeout", new SeededRandom("hygiene-a"));
  const second = applyMutation(base, "invalidTimeout", new SeededRandom("hygiene-a"));
  check("the same seed and profile reproduce an identical mutation", JSON.stringify(first) === JSON.stringify(second));

  const noTarget = applyMutation(
    { id: "empty", name: "empty", version: 1, nodes: [], edges: [] },
    "missingRequiredLocator",
    new SeededRandom("hygiene-b")
  );
  check("a flow with no suitable target returns undefined rather than an unmutated profile", noTarget === undefined);
}

/* ------------------------------------------------------------------ *
 * 4. Gap report
 * ------------------------------------------------------------------ */
await mkdir(REPORT_DIR, { recursive: true });

const observedRegressions = observedExpectationRegressions(outcomes);
const observedSummary = observedDetectionSummary(outcomes);
const gapReport = {
  campaign: { seed: CAMPAIGN_SEED, generatorVersion: constraints.generatorVersion, flowCount: corpus.length, reproductionCommand: "npx tsx scripts/verify-random-oracle.mts" },
  locatorValidationDrift: {
    typesRequiringLocator: locatorRequiringTypes,
    enforcedByPreRunValidator: [...locatorValidatedTypes].sort(),
    notEnforced: locatorCoverageDrift,
    owner: "src/reports/PreRunValidator.ts:55 — hardcoded type list, drifted from app/renderer/components/workflow/flowNodeCatalog.ts",
    recommendation: "Derive the list from the node catalog so the two cannot drift."
  },
  summary: {
    mutationKinds: ALL_MUTATION_KINDS.length,
    detectedKinds: outcomes.filter((o) => MUTATION_EXPECTATIONS[o.kind].status === "detected").length,
    knownGapKinds: KNOWN_VALIDATION_GAPS.length,
    productionUnenforcedRules: PRODUCTION_UNENFORCED_RULES.length,
    observedExpectationRegressions: observedRegressions.length,
    observedStatus: observedSummary.message
  },
  observedExpectationRegressions: observedRegressions,
  detected: outcomes
    .filter((o) => MUTATION_EXPECTATIONS[o.kind].status === "detected")
    .map((o) => ({
      kind: o.kind,
      applied: o.applied,
      rejected: o.matched,
      detectedBy: MUTATION_EXPECTATIONS[o.kind].detectedBy,
      productionEnforced: MUTATION_EXPECTATIONS[o.kind].productionEnforced,
      rationale: MUTATION_EXPECTATIONS[o.kind].rationale,
      exampleSignal: o.exampleSignal ?? null
    })),
  stage2bWiringChecklist: PRODUCTION_UNENFORCED_RULES.map((expectation) => ({
    kind: expectation.kind,
    detectedBy: expectation.detectedBy,
    riskIfUnvalidated: expectation.riskIfUnvalidated ?? null,
    recommendation: expectation.recommendation ?? null
  })),
  gaps: outcomes
    .filter((o) => MUTATION_EXPECTATIONS[o.kind].status === "knownGap")
    .map((o) => ({
      kind: o.kind,
      applied: o.applied,
      stillUndetected: o.matched,
      rationale: MUTATION_EXPECTATIONS[o.kind].rationale,
      riskIfUnvalidated: MUTATION_EXPECTATIONS[o.kind].riskIfUnvalidated ?? null,
      recommendation: MUTATION_EXPECTATIONS[o.kind].recommendation ?? null
    }))
};
await writeFile(join(REPORT_DIR, "validation-gaps.json"), `${JSON.stringify(gapReport, null, 2)}\n`, "utf8");

const md = [
  "# Validation gap report — Phase 2 oracle",
  "",
  `Seed: \`${CAMPAIGN_SEED}\` · Flows: ${corpus.length} · Mutation kinds: ${ALL_MUTATION_KINDS.length}`,
  "",
  "```bash",
  "npx tsx scripts/verify-random-oracle.mts",
  "```",
  "",
  `## Locator validation drift`,
  "",
  engineLocatorDrift.length === 0
    ? `\`FlowValidator\` enforces a locator for every one of the ${locatorRequiringTypes.length} types that requires one (derived from the exhaustive \`STEP_REQUIREMENTS\` table).`
    : `**\`${engineLocatorDrift.join("`, `")}\`** escape the engine's locator check — this is a regression.`,
  "",
  locatorCoverageDrift.length === 0
    ? "PreRunValidator enforces a locator for every type that requires one."
    : `**\`${locatorCoverageDrift.join("`, `")}\`** require a locator per the node catalog but are **not** in PreRunValidator's hardcoded list (\`PreRunValidator.ts:55\`). A step of that type with no locator still passes pre-run validation and fails at run time instead — Stage 2a does not touch the run gate, so this remains open until Stage 2b (\`awkit-acw\`).`,
  "",
  `## Detected (${gapReport.detected.length})`,
  "",
  "| Mutation | Caught by | Rejected | Enforced in production? |",
  "|---|---|---|---|",
  ...gapReport.detected.map(
    (entry) => `| \`${entry.kind}\` | ${entry.detectedBy} | ${entry.rejected}/${entry.applied} | ${entry.productionEnforced ? "yes" : "**no — Stage 2b**"} |`
  ),
  "",
  `## Observed expectation regressions (${gapReport.observedExpectationRegressions.length})`,
  "",
  observedSummary.message,
  "",
  ...(gapReport.observedExpectationRegressions.length === 0
    ? []
    : [
        "| Mutation | Observed matches | First discrepancy |",
        "|---|---|---|",
        ...gapReport.observedExpectationRegressions.map(
          (entry) => `| \`${entry.kind}\` | ${entry.matched}/${entry.applied} | ${entry.discrepancies[0] ?? "none captured"} |`
        ),
        ""
      ]),
  `## Production-unenforced rules (${gapReport.stage2bWiringChecklist.length})`,
  "",
  gapReport.stage2bWiringChecklist.length === 0
    ? "None — Stage 2b wired the engine into the run gate (PreRunValidator delegation), the designer, the library and import. An entry reappearing here means a rule stopped reaching production."
    : "Rules the shared engine detects that **no production caller enforces**. Each is a wiring regression.",
  "",
  ...(gapReport.stage2bWiringChecklist.length === 0
    ? []
    : [
        "| Rule | Risk while unenforced |",
        "|---|---|",
        ...gapReport.stage2bWiringChecklist.map((entry) => `| \`${entry.kind}\` | ${entry.riskIfUnvalidated ?? "n/a"} |`)
      ]),
  "",
  `## ⚠ Validation gaps (${gapReport.gaps.length})`,
  "",
  gapReport.gaps.length === 0
    ? "None. Stage 2a closed all 9 gaps found in Phase 2; see the wiring checklist above for what production still does not enforce."
    : "Nothing rejects these today. Each is a hole in validation coverage, not an accepted behavior.",
  ""
];
for (const gap of gapReport.gaps) {
  md.push(
    `### \`${gap.kind}\` — undetected in ${gap.stillUndetected}/${gap.applied} flows`,
    "",
    `- **Why it slips through:** ${gap.rationale}`,
    `- **Risk if unvalidated:** ${gap.riskIfUnvalidated ?? "n/a"}`,
    `- **Recommended fix:** ${gap.recommendation ?? "n/a"}`,
    ""
  );
}
await writeFile(join(REPORT_DIR, "validation-gaps.md"), `${md.join("\n")}\n`, "utf8");

console.log(`\nReport written:\n  ${join(REPORT_DIR, "validation-gaps.json")}\n  ${join(REPORT_DIR, "validation-gaps.md")}`);
console.log(`\n${observedSummary.message}`);
if (KNOWN_VALIDATION_GAPS.length > 0) {
  console.log(`⚠ ${KNOWN_VALIDATION_GAPS.length} of ${ALL_MUTATION_KINDS.length} controlled defects are expected validation gaps. See validation-gaps.md.`);
}
console.log(
  PRODUCTION_UNENFORCED_RULES.length === 0
    ? `✓ Every detected rule is enforced by a production caller (run gate via PreRunValidator delegation).`
    : `⚠ ${PRODUCTION_UNENFORCED_RULES.length} rule(s) are detected by the shared engine but wired into NO production caller — wiring regression. See validation-gaps.md.`
);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
