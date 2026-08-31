// Canonical Flow Designer GUI verifier.
//
// The broad pre-capsule walkthrough is intentionally preserved in
// `verify-flow-designer-gui.pre-capsule.mjs`. A capsule compatibility reader lets all unrelated Designer coverage and
// all Loop functional checks that do not encode the rejected U-route. The small allow-list below
// retires only assertions whose DOM oracle was explicitly rewritten to require that rejected visual.
// A focused real-Electron suite then binds the approved 7282178 capsule-and-ring contract.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runLegacyGuiCoverage } from "./lib/legacy-gui-verifier-coverage.mjs";
import {
  FLOW_LOOP_CAPSULE_CHECK_NAMES,
  matchesFlowLoopCapsuleCheckContract,
  runFlowLoopCapsuleSuite
} from "./lib/verify-flow-loop-capsule-gui.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Emptied 2026-08-18 (awkit-6be step 2). The 16 retired U-route assertions were DELETED from the
// pre-capsule walkthrough rather than left failing behind an allow-list: an assertion that always
// fails teaches readers to ignore a red line. Their intent is carried by the focused capsule suite
// above, audited name by name; the one intent with no replacement (inspector-delete + Undo) was
// added to that suite first. Keep this array — a future retirement should be visible as a diff
// against an empty list, not as a new concept.
const supersededURouteChecks = [];

console.log("Flow Designer: preserved broad GUI coverage");
const broad = runLegacyGuiCoverage({
  root,
  script: "verify-flow-designer-gui.pre-capsule.mjs",
  supersededChecks: supersededURouteChecks,
  expectedChecks: 138
});

console.log("\nFlow Designer: approved 7282178 Loop capsule contract");
const capsule = await runFlowLoopCapsuleSuite(root);

const focusedPassed = capsule.results?.filter((result) => result.pass).length ?? 0;
const focusedTotal = capsule.results?.length ?? 0;
const focusedContractMatches = matchesFlowLoopCapsuleCheckContract(capsule.results);
console.log(`\nFlow capsule checks: ${focusedPassed}/${focusedTotal}`);
console.log(`Preserved broad checks observed: ${broad.totalChecks}; retired U-route failures: ${broad.retiredFailures.length}; unexpected failures: ${broad.unexpectedFailures.length}`);
// An ABORTED suite returns fewer results than it has names, which previously printed as an ordinary
// "12/13" and read like product failures. Say so explicitly and name the check it stopped after, so
// an intermittent abort is diagnosable from a single run instead of needing someone to be watching.
// The suite already logs the underlying error; this makes the partial result self-describing. awkit-7h0w.
if (capsule.error || focusedTotal < FLOW_LOOP_CAPSULE_CHECK_NAMES.length) {
  const lastRan = capsule.results?.[focusedTotal - 1]?.name ?? "(none)";
  const reason = capsule.error ?? "(suite returned no error; it stopped without throwing)";
  console.error(
    `Flow capsule suite ABORTED after ${focusedTotal}/${FLOW_LOOP_CAPSULE_CHECK_NAMES.length} checks. ` +
      `Last check to run: "${lastRan}". Checks ${focusedTotal + 1}-${FLOW_LOOP_CAPSULE_CHECK_NAMES.length} never executed. ` +
      `Reason: ${reason}`
  );
}

if (!focusedContractMatches) {
  console.error(`Flow capsule check contract mismatch: expected exactly ${FLOW_LOOP_CAPSULE_CHECK_NAMES.length} unique named checks in canonical order.`);
}

if (!broad.pass || !capsule.pass || !focusedContractMatches) {
  process.exit(1);
}
process.exit(0);
