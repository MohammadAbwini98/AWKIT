/**
 * Randomized Automation Test Lab — Phase 2 (validation oracle + mutation testing).
 * Run with: npx tsx scripts/verify-random-oracle.mts
 *
 * Two properties:
 *   1. A valid generated flow is accepted by every real validator (the negative control — without
 *      it, a validator that rejects everything would score full marks on the mutation suite).
 *   2. A flow carrying exactly one controlled defect produces the outcome the oracle declares.
 *
 * Validation *gaps* are first-class results here, not failures to be hidden. Several defects the
 * brief asks about are not detected by anything today — most importantly there is no flow-level
 * reachability check at all. Each is catalogued in `TestExecutionOracle.MUTATION_EXPECTATIONS` with
 * its citation, risk and recommended fix, and is asserted to *still* be a gap. A gap that closes,
 * or a new one that opens, both fail: the catalog is a regression guard on validation coverage.
 *
 * Pure: no browser, no Electron. Writes a gap report to `reports/random-tests/`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlowProfile } from "@src/profiles/FlowProfile";
import { ALL_FLOW_PATTERNS, resolveConstraints } from "@src/testing/random/GenerationConstraints";
import { generateFlow } from "@src/testing/random/RandomFlowGenerator";
import { SeededRandom } from "@src/testing/random/SeededRandom";
import { ALL_MUTATION_KINDS, applyMutation, type MutationKind } from "@src/testing/random/RandomMutator";
import {
  KNOWN_VALIDATION_GAPS,
  MUTATION_EXPECTATIONS,
  deriveLocatorValidatedTypes,
  judgeMutation,
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

// Measured against the real PreRunValidator, never against a copy of its list.
const locatorValidatedTypes = deriveLocatorValidatedTypes();
const oracleContext = { locatorValidatedTypes };

/* ------------------------------------------------------------------ *
 * 1. Negative control — valid flows must be accepted
 * ------------------------------------------------------------------ */
console.log("\nValid generated flows are accepted by the real validators");
{
  const connectorRejections: string[] = [];
  const preRunRejections: string[] = [];

  for (const profile of corpus) {
    const result = validateFlowProfile(profile);
    if (result.connectorIssues.length > 0) connectorRejections.push(`${profile.id}: ${result.connectorIssues[0]}`);
    if (result.preRunErrors.length > 0) preRunRejections.push(`${profile.id}: ${result.preRunErrors[0]?.message}`);
  }

  check(`${corpus.length} valid flows produce zero connector-structure issues`, connectorRejections.length === 0, connectorRejections.slice(0, 3).join(" | "));
  check(`${corpus.length} valid flows produce zero pre-run errors`, preRunRejections.length === 0, preRunRejections.slice(0, 3).join(" | "));
}

/* ------------------------------------------------------------------ *
 * 1b. Locator-validation coverage by node type
 * ------------------------------------------------------------------ */
console.log("\nLocator validation coverage (node catalog vs. PreRunValidator)");
const locatorRequiringTypes = ALL_NODE_TYPES.filter((type) => NODE_CATALOG[type].requiresLocator);
const locatorCoverageDrift = locatorRequiringTypes.filter((type) => !locatorValidatedTypes.has(type));
{
  check(
    `PreRunValidator enforces a locator for all ${locatorRequiringTypes.length} types that require one`,
    locatorCoverageDrift.length === 0,
    locatorCoverageDrift.length > 0
      ? `NOT enforced for: ${locatorCoverageDrift.join(", ")} — PreRunValidator.ts:55 hardcodes its type list and it has drifted from flowNodeCatalog.ts`
      : undefined
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

// Every mutation must find a target somewhere in the corpus, or it is proving nothing.
const neverApplied = outcomes.filter((outcome) => outcome.applied === 0);
check(
  `all ${ALL_MUTATION_KINDS.length} mutation kinds found a target in the corpus`,
  neverApplied.length === 0,
  neverApplied.map((outcome) => outcome.kind).join(", ")
);

console.log("\n  Detected as expected (validation works):");
for (const outcome of outcomes.filter((o) => MUTATION_EXPECTATIONS[o.kind].status === "detected")) {
  check(
    `${outcome.kind} — rejected in ${outcome.matched}/${outcome.applied} flows by ${MUTATION_EXPECTATIONS[outcome.kind].detectedBy}`,
    outcome.applied > 0 && outcome.matched === outcome.applied,
    outcome.discrepancies.join(" | ")
  );
}

console.log("\n  Known validation gaps (asserted to STILL be gaps — these are holes, not passes):");
for (const outcome of outcomes.filter((o) => MUTATION_EXPECTATIONS[o.kind].status === "knownGap")) {
  check(
    `${outcome.kind} — still undetected in ${outcome.matched}/${outcome.applied} flows`,
    outcome.applied > 0 && outcome.matched === outcome.applied,
    outcome.discrepancies.join(" | ")
  );
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
    knownGapKinds: KNOWN_VALIDATION_GAPS.length
  },
  detected: outcomes
    .filter((o) => MUTATION_EXPECTATIONS[o.kind].status === "detected")
    .map((o) => ({ kind: o.kind, applied: o.applied, rejected: o.matched, detectedBy: MUTATION_EXPECTATIONS[o.kind].detectedBy, rationale: MUTATION_EXPECTATIONS[o.kind].rationale, exampleSignal: o.exampleSignal ?? null })),
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
  locatorCoverageDrift.length === 0
    ? "PreRunValidator enforces a locator for every type that requires one."
    : `**\`${locatorCoverageDrift.join("`, `")}\`** require a locator per the node catalog but are **not** in PreRunValidator's hardcoded list (\`PreRunValidator.ts:55\`). A step of that type with no locator passes pre-run validation and fails at run time instead.`,
  "",
  `## Detected (${gapReport.detected.length})`,
  "",
  "| Mutation | Caught by | Rejected |",
  "|---|---|---|",
  ...gapReport.detected.map((entry) => `| \`${entry.kind}\` | ${entry.detectedBy} | ${entry.rejected}/${entry.applied} |`),
  "",
  `## ⚠ Validation gaps (${gapReport.gaps.length})`,
  "",
  "Nothing rejects these today. Each is a hole in validation coverage, not an accepted behavior.",
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
console.log(
  `\n⚠ ${KNOWN_VALIDATION_GAPS.length} of ${ALL_MUTATION_KINDS.length} controlled defects are not rejected by any validator. See validation-gaps.md.`
);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
