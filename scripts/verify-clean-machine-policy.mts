/**
 * Clean-machine validation policy verifier (Track 4 — owner policy 2026-07-24).
 *
 * Verifier class: **documentation-consistency**. It asserts that the current policy documentation
 * agrees with the single canonical policy source
 * (`scripts/lib/clean-machine-validation-policy.ts`) — the blocking matrix and the canonical policy
 * wording — and that no protected release gate was weakened and no historical NOT EXECUTED evidence
 * was rewritten. There is no executable release-promotion gate in the app to exercise; this policy
 * is documentation-enforced, so this is a file/content-consistency check over source constants.
 *
 * What realistic regression would make this test fail?
 *   Someone marking clean-machine validation PASSED without it being executed; deleting the runbook;
 *   removing the non-blocking policy wording; making a failed clean-machine result non-blocking;
 *   rewriting the historical `☐ Not Executed` runbook rows; or dropping the mandatory framing of a
 *   protected gate (checksum / offline-bundle / packaged-startup / artifact-integrity /
 *   dependency-manifest / security). Any of those is a truthfulness or safety regression.
 *
 * Run: npx tsx scripts/verify-clean-machine-policy.mts
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  CLEAN_MACHINE_POLICY_STATEMENT,
  CLEAN_MACHINE_OWNER_DECISION,
  PROTECTED_RELEASE_GATES,
  CleanMachineValidationPolicyError,
  coerceCleanMachineValidationStatus,
  resolveCleanMachineGate,
  resolveReleasePromotion,
  renderCleanMachineReportLine,
  type ProtectedReleaseGate
} from "./lib/clean-machine-validation-policy";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

let failed = 0;
let passed = 0;
const check = (name: string, cond: boolean, detail = ""): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};
const throws = (fn: () => unknown): boolean => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

const RUNBOOK = "CLEAN_MACHINE_VALIDATION_RUNBOOK.md";
const CURRENT_STATE = "docs/ai/CURRENT_STATE.md";
const HANDOFF = "docs/ai/HANDOFF.md";

console.log("Clean-machine validation policy — consistency verifier (Track 4)\n");

// ── Proof 1–4, 5, 8: blocking matrix over the canonical resolver ──────────────────────────────
console.log("Blocking matrix (canonical policy resolver):");
check("1. passed permits promotion", resolveReleasePromotion({ cleanMachine: "passed" }).blocked === false);
check(
  "2. not-executed-non-blocking permits promotion",
  resolveReleasePromotion({ cleanMachine: "not-executed-non-blocking" }).blocked === false
);
check(
  "3. owner-waived-non-blocking permits promotion",
  resolveReleasePromotion({ cleanMachine: "owner-waived-non-blocking" }).blocked === false
);
{
  const failedDecision = resolveReleasePromotion({ cleanMachine: "failed" });
  check(
    "4. failed blocks promotion (with a BLOCKING reason)",
    failedDecision.blocked === true && failedDecision.blockingReasons.some((r) => /FAILED/i.test(r))
  );
}
{
  // A non-blocking clean-machine disposition must NOT itself add a blocking reason, but a failed
  // protected gate still blocks — proving the policy did not weaken the other mandatory gates.
  const eachGateBlocks = (PROTECTED_RELEASE_GATES as readonly ProtectedReleaseGate[]).every((gate) => {
    const d = resolveReleasePromotion({ cleanMachine: "owner-waived-non-blocking", failedProtectedGates: [gate] });
    return d.blocked === true && d.blockingReasons.length === 1 && d.blockingReasons[0].includes(gate);
  });
  check("5. a failed protected gate still blocks while clean-machine is waived", eachGateBlocks);
}
check(
  "8. unknown/malformed status fails safe (never a silent waiver)",
  throws(() => coerceCleanMachineValidationStatus("bogus")) &&
    throws(() => coerceCleanMachineValidationStatus(undefined)) &&
    throws(() => resolveReleasePromotion({ cleanMachine: "corrupt" as never })) &&
    throws(() => resolveReleasePromotion({ cleanMachine: "passed", failedProtectedGates: ["not-a-gate" as never] })),
  "expected CleanMachineValidationPolicyError on unknown input"
);
check(
  "8b. the safe-failure is a typed policy error",
  (() => {
    try {
      coerceCleanMachineValidationStatus("bogus");
      return false;
    } catch (e) {
      return e instanceof CleanMachineValidationPolicyError;
    }
  })()
);

// ── Proof 6: waived/unexecuted is never rendered as passed ─────────────────────────────────────
console.log("\nTruthful rendering:");
{
  const nonPassStatuses = ["failed", "not-executed-non-blocking", "owner-waived-non-blocking"] as const;
  const neverPassed = nonPassStatuses.every((s) => {
    const r = resolveCleanMachineGate(s);
    return r.indicator !== "pass" && !/\bpassed\b/i.test(r.label);
  });
  check("6. waived / unexecuted / failed never render as PASSED or a green indicator", neverPassed);
  const passIsPass = resolveCleanMachineGate("passed").indicator === "pass";
  check("6b. only an actually-executed pass uses the green pass indicator", passIsPass);
  const neutral =
    resolveCleanMachineGate("not-executed-non-blocking").indicator === "neutral" &&
    resolveCleanMachineGate("owner-waived-non-blocking").indicator === "neutral";
  check("6c. unexecuted and waived use the neutral (informational) indicator", neutral);
  check(
    "6d. the current owner report line is waived/non-blocking, not passed",
    /OWNER WAIVED|NON-BLOCKING/i.test(renderCleanMachineReportLine()) &&
      !/\bpassed\b/i.test(renderCleanMachineReportLine())
  );
}

// ── Proof 9: current documentation carries the non-blocking policy explanation ─────────────────
console.log("\nDocumentation carries the canonical non-blocking policy:");
const runbookText = read(RUNBOOK);
const currentStateText = read(CURRENT_STATE);
const handoffText = read(HANDOFF);
check("9. runbook reproduces the canonical policy statement", runbookText.includes(CLEAN_MACHINE_POLICY_STATEMENT));
check(
  "9b. CURRENT_STATE reproduces the canonical policy statement",
  currentStateText.includes(CLEAN_MACHINE_POLICY_STATEMENT)
);
check(
  "9c. the dated owner decision is recorded in the current docs",
  runbookText.includes(CLEAN_MACHINE_OWNER_DECISION.date) &&
    currentStateText.includes(CLEAN_MACHINE_OWNER_DECISION.date) &&
    /owner/i.test(currentStateText)
);
check(
  "9d. HANDOFF records clean-machine as optional / non-blocking by owner policy",
  /optional and non-blocking/i.test(handoffText)
);

// ── Proof 7: historical NOT EXECUTED evidence remains unchanged ────────────────────────────────
console.log("\nHistorical evidence preserved:");
check(
  "7. runbook still records its checks as `Not Executed` (rows not rewritten)",
  (runbookText.match(/Not Executed/g) ?? []).length >= 20
);
check("7b. runbook still makes no pass claim for its checks", /makes no pass claims/i.test(runbookText));
check("7c. the 2026-07-23 owner development-waiver banner is preserved", runbookText.includes("2026-07-23"));
check(
  "7d. CURRENT_STATE still states clean-machine is NOT executed (truthful execution status)",
  /clean-machine[^\n]*not executed/i.test(currentStateText) || /not executed[^\n]*clean-machine/i.test(currentStateText)
);

// ── Proof 10: protected gates remain mandatory / unaffected ────────────────────────────────────
console.log("\nProtected release gates remain mandatory:");
check(
  "10. canonical statement lists every protected gate as NOT waived",
  (PROTECTED_RELEASE_GATES as readonly string[]).every((g) => CLEAN_MACHINE_POLICY_STATEMENT.includes(g))
);
check(
  "10b. runbook keeps its checksum/hash-mismatch abort rule (checksum + artifact-integrity)",
  /hash mismatch aborts the run/i.test(runbookText) && /SHA-256/i.test(runbookText)
);
check(
  "10c. runbook keeps its FAIL / BLOCKER section (a real failure still blocks)",
  /FAIL \/ BLOCKER/i.test(runbookText)
);
check(
  "10d. the new policy explicitly does not waive the protected gates in prose",
  /does not waive[^]*?(checksum)[^]*?(security)/i.test(runbookText)
);

// ── No current document falsely claims the validation PASSED ───────────────────────────────────
console.log("\nNo false PASSED claim in current policy docs:");
{
  const allowedNear = /(may be recorded|\bif\b|\bwould\b|\(\s*\)|expect|requires|unless|allows updating|when executed|→)/i;
  const scanForFalsePass = (label: string, text: string): boolean => {
    const offending = text
      .split(/\r?\n/)
      .filter((line) => /clean[- ]machine/i.test(line) && /\bpassed\b/i.test(line) && !allowedNear.test(line));
    if (offending.length) {
      console.error(`      ${label} offending line(s): ${JSON.stringify(offending.slice(0, 3))}`);
    }
    return offending.length === 0;
  };
  check("no unconditional 'clean-machine … PASSED' claim in the runbook", scanForFalsePass("runbook", runbookText));
  check("no unconditional 'clean-machine … PASSED' claim in CURRENT_STATE", scanForFalsePass("CURRENT_STATE", currentStateText));
  check("no unconditional 'clean-machine … PASSED' claim in HANDOFF", scanForFalsePass("HANDOFF", handoffText));
}

// ── The runbook still exists and stays usable as an optional procedure ─────────────────────────
console.log("\nRunbook remains available as an optional procedure:");
check("runbook file still exists", existsSync(join(root, RUNBOOK)));
check("runbook still contains its executable procedure sections (§4 clean-profile)", /## 4\./.test(runbookText));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error("\nclean-machine policy consistency FAILED");
  process.exit(1);
}
console.log("clean-machine policy consistency ✓");
