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

const supersededURouteChecks = [
  "Flow Loop label reflects design-time mode without a runtime-looking counter",
  "Flow Loop renders one continuous rounded return path, directional overlay, arrow, and compact static marker behind real nodes",
  "Flow Loop animates a directional dash on the real path while preserving stationary geometry, marker, arrow, and label",
  "A non-circular saved shape cannot collapse a semantic Loop back into an ordinary edge",
  "Flow Loop configuration participates in Undo",
  "Flow Loop configuration participates in Redo",
  "Flow Loop path and marker remain attached and proportionate at 25%, 100%, and 200% zoom",
  "Dragging the real Flow node keeps its attached return path and marker aligned without creating another node",
  "Flow Loop path motion stops while its arrow and design-time label stay readable under reduced motion",
  "Two Flow Loops render with independent identity, configuration labels, and path animation",
  "Saved Flow Loop restores its mode-aware label, directional path, and arrow after reload",
  "The compact Flow Loop marker is a reliable direct configuration target without interrupting path motion",
  "Configure loop reopens the existing Flow Loop with its immediate unsaved safety-limit edit intact",
  "Reconfigured Flow Loop persists and keeps its path animation and design-time label after reload",
  "Undo restores a keyboard-deleted Flow Loop with its authored state",
  "Undo restores an inspector-deleted Flow Loop with its configuration"
];

console.log("Flow Designer: preserved broad GUI coverage");
const broad = runLegacyGuiCoverage({
  root,
  script: "verify-flow-designer-gui.pre-capsule.mjs",
  supersededChecks: supersededURouteChecks,
  expectedChecks: 128
});

console.log("\nFlow Designer: approved 7282178 Loop capsule contract");
const capsule = await runFlowLoopCapsuleSuite(root);

const focusedPassed = capsule.results?.filter((result) => result.pass).length ?? 0;
const focusedTotal = capsule.results?.length ?? 0;
const focusedContractMatches = matchesFlowLoopCapsuleCheckContract(capsule.results);
console.log(`\nFlow capsule checks: ${focusedPassed}/${focusedTotal}`);
console.log(`Preserved broad checks observed: ${broad.totalChecks}; retired U-route failures: ${broad.retiredFailures.length}; unexpected failures: ${broad.unexpectedFailures.length}`);
if (!focusedContractMatches) {
  console.error(`Flow capsule check contract mismatch: expected exactly ${FLOW_LOOP_CAPSULE_CHECK_NAMES.length} unique named checks in canonical order.`);
}

if (!broad.pass || !capsule.pass || !focusedContractMatches) {
  process.exit(1);
}
process.exit(0);
