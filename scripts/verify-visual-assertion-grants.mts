/**
 * verify:visual-assertion-grants — Phase N, N6.4 (awkit-vra.15.4): the enforcement gate and the experimental grants.
 * Plan: docs/plans/ai-upgrade-v5/N6-visual-assertions.md › Flag, step mode and build availability, Enforcement grants,
 * VA-9, VA-12, VA-16.
 *
 *   A  the whole outcome matrix (build x flag x step mode x policy verdict x grant status, 2*3*2*4*5 = 240 cells) of
 *      `decideVisualAssertionStepStatus` and `planVisualAssertion`, against an oracle written here from the plan's
 *      tables, plus the pins no cell may break: the packaged build never reads a grant and never passes an enforce
 *      step, observe never fails, a mismatch class needs a proven difference, a grant never overrides a verdict;
 *   B  the grant store: dev-only issue, the packaged build answers `missing` without reading (even with a valid grant
 *      file planted in its folder), every bound environment field, the cell, the 30-day expiry boundary, a clock set
 *      before issue, tampering, corruption, a lost keystore and a key reset;
 *   C  mutation controls: each planted gate defect must disagree with the oracle somewhere.
 *
 * Grants here are verifier fixtures in temporary runtime roots; the AES key protector is verifier-only.
 *
 * Run: npm run verify:visual-assertion-grants
 */

import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decideVisualAssertionStepStatus,
  planVisualAssertion,
  type VisualAssertionAppMode,
  type VisualAssertionDecisionInput,
  type VisualAssertionFlag,
  type VisualAssertionStepMode,
  type VisualAssertionStepStatus,
  type VisualAssertionVerdict,
  type VisualGrantStatus
} from "@src/runner/visualAssertion/visualAssertionContract";
import { VISUAL_CALIBRATION_SUITE_VERSION, VISUAL_GRANT_VALIDITY_MS, type VisualGrantCell, type VisualGrantEnvironment } from "@src/runner/visualAssertion/VisualBaselineStore";
import { makeEnv, tempRoot } from "./lib/visualBaselineKit.mts";

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

const APP_MODES: VisualAssertionAppMode[] = ["dev", "packaged"];
const FLAGS: VisualAssertionFlag[] = ["off", "observe", "enforce"];
const STEP_MODES: VisualAssertionStepMode[] = ["observe", "enforce"];
const VERDICTS: Array<{ verdict: VisualAssertionVerdict; code: string } | undefined> = [
  undefined,
  { verdict: "passed", code: "identical-to-baseline" },
  { verdict: "failed", code: "differs-from-baseline" },
  { verdict: "inconclusive", code: "position-changed" }
];
const GRANTS: Array<VisualGrantStatus | undefined> = [undefined, "valid", "missing", "invalidated", "expired"];

/** The plan's tables, restated independently of the implementation. */
function oracle(input: VisualAssertionDecisionInput): VisualAssertionStepStatus {
  const { appMode, flag, stepMode, verdict, grant } = input;
  const evaluated = flag !== "off";
  if (stepMode === "observe") return { status: "passed", code: evaluated ? (verdict ? verdict.code : "evaluation-unavailable") : "disabled" };
  const unverified = (code: string): VisualAssertionStepStatus => ({ status: "failed", failureClass: "visual-unverified", code });
  if (appMode === "packaged") return unverified("enforce-unavailable-in-production");
  if (flag === "off") return unverified("disabled");
  if (flag === "observe") return unverified("enforce-not-enabled");
  if (grant === "invalidated") return unverified("grant-invalidated");
  if (grant === "expired") return unverified("grant-expired");
  if (grant !== "valid") return unverified("cell-not-qualified");
  if (!verdict) return unverified("evaluation-unavailable");
  if (verdict.verdict === "passed") return { status: "passed", code: verdict.code };
  if (verdict.verdict === "failed") return { status: "failed", failureClass: "visual-mismatch", code: verdict.code };
  return unverified(verdict.code);
}

const same = (a: VisualAssertionStepStatus, b: VisualAssertionStepStatus): boolean => a.status === b.status && a.code === b.code && (a.failureClass ?? null) === (b.failureClass ?? null);

function* cells(): Generator<VisualAssertionDecisionInput> {
  for (const appMode of APP_MODES)
    for (const flag of FLAGS)
      for (const stepMode of STEP_MODES)
        for (const verdict of VERDICTS)
          for (const grant of GRANTS) yield { appMode, flag, stepMode, ...(verdict ? { verdict } : {}), ...(grant ? { grant } : {}) };
}

/** Every cell where `decide` disagrees with the oracle. */
function disagreements(decide: (input: VisualAssertionDecisionInput) => VisualAssertionStepStatus): string[] {
  const out: string[] = [];
  for (const cell of cells()) {
    const got = decide(cell);
    const want = oracle(cell);
    if (!same(got, want)) out.push(`${JSON.stringify(cell)} got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }
  return out;
}

// ── A. The matrix ────────────────────────────────────────────────────────────────────────────
console.log("A. The outcome matrix");
{
  const all = [...cells()];
  check("the matrix covers 240 cells", all.length === 240, String(all.length));
  const wrong = disagreements(decideVisualAssertionStepStatus);
  check("every cell matches the plan's tables", wrong.length === 0, wrong.slice(0, 3).join("; "));
  const results = all.map((cell) => ({ cell, out: decideVisualAssertionStepStatus(cell) }));
  check("observe steps never fail, in any build, flag, verdict or grant", results.filter((r) => r.cell.stepMode === "observe").every((r) => r.out.status === "passed"));
  check(
    "the packaged build never passes an enforce step, whatever the flag, verdict or grant",
    results.filter((r) => r.cell.appMode === "packaged" && r.cell.stepMode === "enforce").every((r) => r.out.status === "failed" && r.out.code === "enforce-unavailable-in-production")
  );
  check(
    "visual-mismatch only ever comes from a policy `failed` verdict (a proven difference)",
    results.filter((r) => r.out.failureClass === "visual-mismatch").every((r) => r.cell.verdict?.verdict === "failed")
  );
  check(
    "an enforce step passes only in the dev build, flag enforce, a valid grant and a `passed` verdict",
    results
      .filter((r) => r.cell.stepMode === "enforce" && r.out.status === "passed")
      .every((r) => r.cell.appMode === "dev" && r.cell.flag === "enforce" && r.cell.grant === "valid" && r.cell.verdict?.verdict === "passed")
  );
  check(
    "a non-valid grant always fails the enforce step unverified, even when the verdict passed",
    results
      .filter((r) => r.cell.appMode === "dev" && r.cell.flag === "enforce" && r.cell.stepMode === "enforce" && r.cell.grant !== "valid")
      .every((r) => r.out.status === "failed" && r.out.failureClass === "visual-unverified")
  );
  let planOk = true;
  const planWrong: string[] = [];
  for (const appMode of APP_MODES)
    for (const flag of FLAGS)
      for (const stepMode of STEP_MODES) {
        const plan = planVisualAssertion(appMode, flag, stepMode);
        const wantEvaluate = flag !== "off";
        const wantGrant = appMode === "dev" && flag === "enforce" && stepMode === "enforce";
        if (plan.evaluate !== wantEvaluate || plan.readGrant !== wantGrant) {
          planOk = false;
          planWrong.push(`${appMode}/${flag}/${stepMode}: ${JSON.stringify(plan)}`);
        }
      }
  check("the plan captures only with the flag on and reads a grant only for dev + flag enforce + enforce step (12 cases)", planOk, planWrong.join("; "));
  check(
    "the packaged build never reads a grant (no plan case)",
    APP_MODES.filter((m) => m === "packaged").every((m) => FLAGS.every((f) => STEP_MODES.every((s) => !planVisualAssertion(m, f, s).readGrant)))
  );
}

// ── B. The grant store ───────────────────────────────────────────────────────────────────────
console.log("\nB. The grant store");
const CELL: VisualGrantCell = { renderMode: "headless", devicePixelRatio: 1 };
const ENV: VisualGrantEnvironment = {
  browserVersion: "140.0.7339.16",
  appVersion: "0.1.53",
  osBuild: "win32-10.0.26300",
  capturePolicy: "awkit-va15-v1",
  fingerprintVersion: "awkit-vfp-1",
  assertionPolicyVersion: 1,
  calibrationSuiteVersion: VISUAL_CALIBRATION_SUITE_VERSION
};
const ISSUED = new Date("2026-10-20T00:00:00.000Z");
const EVIDENCE = "e".repeat(64);
const grantsDir = (root: string, mode: "dev" | "packaged") => join(root, "runtime", "visual-baselines", mode, "grants");
{
  const root = tempRoot("grants");
  const dev = makeEnv({ root, mode: "dev" });
  const packaged = makeEnv({ root, mode: "packaged" });

  const refused = await packaged.store.issueGrantUnchecked({ cell: CELL, environment: ENV, evidenceDigest: EVIDENCE, issuedAt: ISSUED });
  check("the packaged build issues no grant", !refused.ok && refused.reason === "packaged-build", JSON.stringify(refused));
  check("an invalid evidence digest is refused", !(await dev.store.issueGrantUnchecked({ cell: CELL, environment: ENV, evidenceDigest: "nope", issuedAt: ISSUED })).ok);
  const issued = await dev.store.issueGrantUnchecked({ cell: CELL, environment: ENV, evidenceDigest: EVIDENCE, issuedAt: ISSUED });
  check("the dev build issues a grant expiring exactly 30 days later", issued.ok && issued.expiresAt === new Date(ISSUED.getTime() + VISUAL_GRANT_VALIDITY_MS).toISOString(), JSON.stringify(issued));
  const day = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(ISSUED.getTime() + ms);
  check("valid the moment it is issued and one day later", (await dev.store.grantStatus(CELL, ENV, at(0))) === "valid" && (await dev.store.grantStatus(CELL, ENV, at(day))) === "valid");
  check("valid 1 ms before the expiry", (await dev.store.grantStatus(CELL, ENV, at(VISUAL_GRANT_VALIDITY_MS - 1))) === "valid");
  check("expired at the expiry instant and after", (await dev.store.grantStatus(CELL, ENV, at(VISUAL_GRANT_VALIDITY_MS))) === "expired" && (await dev.store.grantStatus(CELL, ENV, at(40 * day))) === "expired");
  check("a clock set before the issue time is invalidated, not valid", (await dev.store.grantStatus(CELL, ENV, at(-1))) === "invalidated");
  for (const key of Object.keys(ENV) as Array<keyof VisualGrantEnvironment>) {
    const changed = { ...ENV, [key]: typeof ENV[key] === "number" ? (ENV[key] as number) + 1 : `${ENV[key]}-changed` } as VisualGrantEnvironment;
    check(`a changed ${key} invalidates the grant`, (await dev.store.grantStatus(CELL, changed, at(day))) === "invalidated");
  }
  check(
    "another cell (DPR 2, or headed) has no grant",
    (await dev.store.grantStatus({ renderMode: "headless", devicePixelRatio: 2 }, ENV, at(day))) === "missing" &&
      (await dev.store.grantStatus({ renderMode: "headed", devicePixelRatio: 1 }, ENV, at(day))) === "missing"
  );

  // The packaged build never reads a grant: even a valid dev grant planted in its own folder is `missing`.
  const [grantFile] = readdirSync(grantsDir(root, "dev"));
  mkdirSync(grantsDir(root, "packaged"), { recursive: true });
  copyFileSync(join(grantsDir(root, "dev"), grantFile), join(grantsDir(root, "packaged"), grantFile));
  check("the packaged build answers missing even with a valid grant file in its folder", (await packaged.store.grantStatus(CELL, ENV, at(day))) === "missing");

  const path = join(grantsDir(root, "dev"), grantFile);
  const original = readFileSync(path, "utf8");
  const tamper = async (edit: (grant: Record<string, unknown>) => void): Promise<VisualGrantStatus> => {
    const grant = JSON.parse(original) as Record<string, unknown>;
    edit(grant);
    writeFileSync(path, JSON.stringify(grant));
    const status = await dev.store.grantStatus(CELL, ENV, at(day));
    writeFileSync(path, original);
    return status;
  };
  check("an extended expiry is invalidated (MAC)", (await tamper((g) => (g.expiresAt = new Date(ISSUED.getTime() + 90 * day).toISOString()))) === "invalidated");
  check("a re-dated issue is invalidated (MAC)", (await tamper((g) => (g.issuedAt = at(day).toISOString()))) === "invalidated");
  check("a forged MAC is invalidated", (await tamper((g) => (g.mac = "0".repeat(64)))) === "invalidated");
  check("a grant claiming the packaged mode is invalidated", (await tamper((g) => (g.mode = "packaged"))) === "invalidated");
  check("a changed key generation is invalidated", (await tamper((g) => (g.keyGeneration = 2))) === "invalidated");
  writeFileSync(path, "{ not json");
  check("a corrupt grant file is invalidated", (await dev.store.grantStatus(CELL, ENV, at(day))) === "invalidated");
  writeFileSync(path, original);
  check("the untouched grant is valid again", (await dev.store.grantStatus(CELL, ENV, at(day))) === "valid");

  dev.protector.state.available = false;
  check("a lost keystore invalidates the grant", (await dev.store.grantStatus(CELL, ENV, at(day))) === "invalidated");
  dev.protector.state.available = true;

  const saved = readFileSync(path);
  const reset = await dev.store.resetUnchecked();
  check("a reset removes every grant of the mode", reset.generation === 2 && (await dev.store.grantStatus(CELL, ENV, at(day))) === "missing");
  mkdirSync(grantsDir(root, "dev"), { recursive: true });
  writeFileSync(path, saved);
  check("a grant restored after a reset (old key generation) is invalidated", (await dev.store.grantStatus(CELL, ENV, at(day))) === "invalidated");
}

// ── C. Mutation controls ─────────────────────────────────────────────────────────────────────
console.log("\nC. Mutation controls (each planted gate defect must disagree with the plan)");
{
  const mutants: Array<[string, (input: VisualAssertionDecisionInput) => VisualAssertionStepStatus]> = [
    ["the packaged build honours a valid grant", (i) => (i.appMode === "packaged" && i.flag === "enforce" && i.grant === "valid" ? decideVisualAssertionStepStatus({ ...i, appMode: "dev" }) : decideVisualAssertionStepStatus(i))],
    ["flag observe lets an enforce step enforce", (i) => decideVisualAssertionStepStatus(i.flag === "observe" ? { ...i, flag: "enforce" } : i)],
    ["a missing grant is treated as valid", (i) => decideVisualAssertionStepStatus(i.grant === undefined || i.grant === "missing" ? { ...i, grant: "valid" } : i)],
    ["an expired grant is treated as valid", (i) => decideVisualAssertionStepStatus(i.grant === "expired" ? { ...i, grant: "valid" } : i)],
    [
      "an inconclusive verdict fails as a mismatch",
      (i) => {
        const out = decideVisualAssertionStepStatus(i);
        return out.failureClass === "visual-unverified" && i.verdict?.verdict === "inconclusive" && i.grant === "valid" ? { ...out, failureClass: "visual-mismatch" } : out;
      }
    ],
    [
      "an inconclusive verdict passes an enforce step",
      (i) => (i.verdict?.verdict === "inconclusive" && i.stepMode === "enforce" && i.appMode === "dev" && i.flag === "enforce" && i.grant === "valid" ? { status: "passed", code: i.verdict.code } : decideVisualAssertionStepStatus(i))
    ],
    ["an observe step fails on a mismatch", (i) => (i.stepMode === "observe" && i.verdict?.verdict === "failed" && i.flag !== "off" ? { status: "failed", failureClass: "visual-mismatch", code: i.verdict.code } : decideVisualAssertionStepStatus(i))],
    ["flag off in the packaged build reports disabled for an enforce step", (i) => (i.appMode === "packaged" && i.flag === "off" && i.stepMode === "enforce" ? { status: "failed", failureClass: "visual-unverified", code: "disabled" } : decideVisualAssertionStepStatus(i))]
  ];
  for (const [label, mutant] of mutants) {
    const wrong = disagreements(mutant);
    check(`MUTATION: ${label} is caught`, wrong.length > 0, "the matrix did not notice");
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
