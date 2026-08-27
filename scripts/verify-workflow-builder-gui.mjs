// Canonical Workflow Builder GUI verifier.
//
// The broad pre-capsule walkthrough is intentionally preserved in
// `verify-workflow-builder-gui.pre-capsule.mjs`. A capsule compatibility reader keeps unrelated Builder coverage,
// legacy cross-node Loop Back coverage, and Loop functional assertions that do not encode the
// rejected full-node U-route. Only the explicitly listed obsolete visual-oracle assertions may be
// ignored there. The focused suite below validates the approved 7282178 capsule-and-ring contract
// against the real Electron application and persisted Workflow model.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runLegacyGuiCoverage } from "./lib/legacy-gui-verifier-coverage.mjs";
import {
  matchesWorkflowLoopCapsuleCheckContract,
  runWorkflowLoopCapsuleSuite,
  WORKFLOW_LOOP_CAPSULE_CHECK_NAMES
} from "./lib/verify-workflow-loop-capsule-gui.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Emptied 2026-08-18 (awkit-6be step 2). The 16 retired U-route assertions were DELETED from the
// pre-capsule walkthrough rather than left failing behind an allow-list: an assertion that always
// fails teaches readers to ignore a red line. Their intent is carried by the focused capsule suite
// above, audited name by name; the one intent with no replacement (inspector-delete + Undo) was
// added to that suite first. Keep this array — a future retirement should be visible as a diff
// against an empty list, not as a new concept.
const supersededURouteChecks = [];

console.log("Workflow Builder: preserved broad GUI coverage");
const broad = runLegacyGuiCoverage({
  root,
  script: "verify-workflow-builder-gui.pre-capsule.mjs",
  supersededChecks: supersededURouteChecks,
  expectedChecks: 68
});

console.log("\nWorkflow Builder: approved 7282178 Loop capsule contract");
const capsule = await runWorkflowLoopCapsuleSuite(root);

const focusedPassed = capsule.results?.filter((result) => result.pass).length ?? 0;
const focusedTotal = capsule.results?.length ?? 0;
const focusedContractMatches = matchesWorkflowLoopCapsuleCheckContract(capsule.results);
console.log(`\nWorkflow capsule checks: ${focusedPassed}/${focusedTotal}`);
console.log(`Preserved broad checks observed: ${broad.totalChecks}; retired U-route failures: ${broad.retiredFailures.length}; unexpected failures: ${broad.unexpectedFailures.length}`);
// An ABORTED suite returns fewer results than it has names, which previously printed as an ordinary
// "12/13" and read like product failures. Say so explicitly and name the check it stopped after, so
// an intermittent abort is diagnosable from a single run instead of needing someone to be watching.
// The suite already logs the underlying error; this makes the partial result self-describing. awkit-7h0w.
if (capsule.error || focusedTotal < WORKFLOW_LOOP_CAPSULE_CHECK_NAMES.length) {
  const lastRan = capsule.results?.[focusedTotal - 1]?.name ?? "(none)";
  const reason = capsule.error ?? "(suite returned no error; it stopped without throwing)";
  console.error(
    `Workflow capsule suite ABORTED after ${focusedTotal}/${WORKFLOW_LOOP_CAPSULE_CHECK_NAMES.length} checks. ` +
      `Last check to run: "${lastRan}". Checks ${focusedTotal + 1}-${WORKFLOW_LOOP_CAPSULE_CHECK_NAMES.length} never executed. ` +
      `Reason: ${reason}`
  );
}

if (!focusedContractMatches) {
  console.error(`Workflow capsule check contract mismatch: expected exactly ${WORKFLOW_LOOP_CAPSULE_CHECK_NAMES.length} unique named checks in canonical order.`);
}

if (!broad.pass || !capsule.pass || !focusedContractMatches) {
  process.exit(1);
}
process.exit(0);
