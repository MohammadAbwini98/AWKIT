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

const supersededURouteChecks = [
  "A fresh Workflow Loop shows its authoritative Count × 3 default instead of runtime progress",
  "Workflow Loop label updates to the authored While condition and never presents an iteration counter",
  "Workflow Loop renders one continuous rounded return path, one path direction layer, and one compact static marker",
  "Workflow Loop direction moves continuously on the real return path while its marker and authored label stay stationary",
  "A non-circular saved shape cannot collapse a semantic Workflow Loop into an ordinary edge",
  "Workflow Loop path and marker remain attached and proportionate without restarting motion at 25%, 100%, and 200% zoom",
  "Dragging the real Workflow node keeps its attached return path and marker aligned without creating another node",
  "Two Workflow Loops render independently with distinct identities, routes, and authored summaries",
  "Workflow Loop direction becomes static while its path, arrow, marker, and authored label remain readable under reduced motion",
  "Reduced motion freezes both independent Workflow Loop direction paths without hiding either summary",
  "Saved Workflow Loop restores its While summary, direction path, and single Conditional exit after reload",
  "The compact Workflow Loop marker is a reliable direct configuration target",
  "Configure loop reopens the existing Workflow Loop with its immediate unsaved bound edit and authored summary intact",
  "Reconfigured Workflow Loop persists with one Conditional exit and keeps its path-following direction motion after reload",
  "Undo restores a keyboard-deleted Workflow Loop with its authored state",
  "Workflow Loop Undo restores the configured connector and exactly one emphasized Loop exit"
];

console.log("Workflow Builder: preserved broad GUI coverage");
const broad = runLegacyGuiCoverage({
  root,
  script: "verify-workflow-builder-gui.pre-capsule.mjs",
  supersededChecks: supersededURouteChecks,
  expectedChecks: 74
});

console.log("\nWorkflow Builder: approved 7282178 Loop capsule contract");
const capsule = await runWorkflowLoopCapsuleSuite(root);

const focusedPassed = capsule.results?.filter((result) => result.pass).length ?? 0;
const focusedTotal = capsule.results?.length ?? 0;
const focusedContractMatches = matchesWorkflowLoopCapsuleCheckContract(capsule.results);
console.log(`\nWorkflow capsule checks: ${focusedPassed}/${focusedTotal}`);
console.log(`Preserved broad checks observed: ${broad.totalChecks}; retired U-route failures: ${broad.retiredFailures.length}; unexpected failures: ${broad.unexpectedFailures.length}`);
if (!focusedContractMatches) {
  console.error(`Workflow capsule check contract mismatch: expected exactly ${WORKFLOW_LOOP_CAPSULE_CHECK_NAMES.length} unique named checks in canonical order.`);
}

if (!broad.pass || !capsule.pass || !focusedContractMatches) {
  process.exit(1);
}
process.exit(0);
