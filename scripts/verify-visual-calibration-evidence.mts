/**
 * verify:visual-calibration-evidence — Phase N, N6.6 (awkit-vra.15.6): an independent audit of the REAL calibration
 * evidence on this machine (`%LOCALAPPDATA%/SpecterStudio/visual-baselines/dev/calibration/sessions/*.json`) and the
 * grants issued from it (`.../dev/grants/*.json`). Read-only; no browser is launched.
 *
 * It re-derives every VA-12 count with its own code (not `evaluateCalibrationCell`), then cross-checks that module:
 *   - every launch has a unique identity and exactly one primary trial, recorded first (no partial or duplicate launch
 *     is counted); interrupted sessions are listed and their recorded launches classified like any other;
 *   - per cell and bound environment: >= 300 passing primary launches over >= 3 sessions, zero failed, every negative
 *     failed in >= 30 launches and never passed, moved/clipped/hovered/focused always inconclusive, zero captures and an
 *     inconclusive verdict on every protected/handoff/sensitive fixture, nearest-rank p95 over ONE primary duration per
 *     launch <= 2000 ms, and the plan's bound 1 - 0.05^(1/n) recomputed from n;
 *   - every grant names a qualified cell and its environment, and its `evidenceDigest` equals the SHA-256 of the
 *     canonical JSON of exactly the launches of that cell and environment recorded before its issue time.
 * The grant MACs are verified only by the calibration root's audit mode (it needs the safeStorage key).
 *
 * Without evidence on this machine the audit is BLOCKED (exit 2), never a pass.
 *
 * Run: npm run verify:visual-calibration-evidence
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "@src/runner/visualAssertion/stepContentDigest";
import {
  evaluateCalibrationCell,
  type VisualCalibrationEnvironment,
  type VisualCalibrationLaunch
} from "@src/runner/visualAssertion/calibration/visualCalibrationCriteria";

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

const devRoot = join(process.env.LOCALAPPDATA ?? "", "SpecterStudio", "visual-baselines", "dev");
const sessionsDir = join(devRoot, "calibration", "sessions");
const grantsDir = join(devRoot, "grants");
if (!process.env.LOCALAPPDATA || !existsSync(sessionsDir)) {
  console.error(`BLOCKED: no calibration evidence at ${sessionsDir}`);
  process.exit(2);
}

interface SessionFile {
  version: number;
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  concurrency?: number;
  launches: VisualCalibrationLaunch[];
  errors: Array<{ cell: string; message: string }>;
}
const names = readdirSync(sessionsDir).filter((n) => n.endsWith(".json")).sort();
const sessions: SessionFile[] = names.map((n) => JSON.parse(readFileSync(join(sessionsDir, n), "utf8")) as SessionFile);
const all = sessions.flatMap((s) => s.launches);
const cellOf = (l: VisualCalibrationLaunch) => `${l.cell.renderMode}@${l.cell.devicePixelRatio}`;
const envKey = (e: VisualCalibrationEnvironment) => canonicalJson(e);

console.log(`Evidence: ${sessions.length} session files, ${all.length} recorded launches\n`);
console.log("A. Launch integrity\n");
{
  const keys = all.map((l) => `${l.sessionId}|${cellOf(l)}|${l.startedAt}`);
  check("every launch has a unique identity (session, cell, start time)", new Set(keys).size === keys.length, `${keys.length - new Set(keys).size} duplicates`);
  const withId = all.filter((l) => l.launchId);
  check("launches recorded with a launchId have unique ids", new Set(withId.map((l) => l.launchId)).size === withId.length);
  check("launches recorded with contextsAtStart began in a fresh browser (0 open contexts)", all.every((l) => l.contextsAtStart === undefined || l.contextsAtStart === 0));
  console.log(`    launches with recorded launchId and fresh-browser proof: ${withId.length} of ${all.length} (fields added 2026-10-25 after the 21 sessions)`);
  check("every launch belongs to the session file that holds it", sessions.every((s) => s.launches.every((l) => l.sessionId === s.sessionId)));
  const primaries = all.map((l) => l.trials.filter((t) => t.fixture === "primary").length);
  check("every recorded launch has exactly one primary trial", primaries.every((n) => n === 1), `${primaries.filter((n) => n !== 1).length} launches without exactly one`);
  check("the primary trial is always the launch's first trial (the fresh-launch measurement)", all.every((l) => l.trials[0]?.fixture === "primary"));
  const interrupted = sessions.filter((s) => !s.endedAt);
  console.log(`    interrupted sessions: ${interrupted.map((s) => `${s.sessionId} (${s.launches.length} launches, lanes ${s.concurrency ?? 1})`).join(", ") || "none"}`);
  check(
    "an interrupted session only holds launches persisted after they completed (each has its full fixture set or primary only)",
    interrupted.every((s) => s.launches.every((l) => l.trials.length === 1 || l.trials.length === 12))
  );
  check("no launch has a partial fixture set (1 or 12 trials only)", all.every((l) => l.trials.length === 1 || l.trials.length === 12), `${all.filter((l) => l.trials.length !== 1 && l.trials.length !== 12).length} partial`);
  const errors = sessions.flatMap((s) => s.errors);
  console.log(`    recorded launch errors (never counted as trials): ${errors.length}`);
}

console.log("\nB. Per-cell criteria, recounted independently\n");
const grants = existsSync(grantsDir)
  ? readdirSync(grantsDir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => JSON.parse(readFileSync(join(grantsDir, n), "utf8")) as { cell: { renderMode: "headed" | "headless"; devicePixelRatio: number }; environment: VisualCalibrationEnvironment; evidenceDigest: string; issuedAt: string; expiresAt: string; mode: string })
  : [];
const cells = [...new Set(all.map(cellOf))].sort();
const rows: string[] = [];
for (const id of cells) {
  const ofCell = all.filter((l) => cellOf(l) === id);
  const envs = [...new Set(ofCell.map((l) => envKey(l.environment)))];
  check(`${id}: one bound environment across its launches`, envs.length === 1, `${envs.length} environments`);
  const environment = ofCell[ofCell.length - 1].environment;
  const mine = ofCell.filter((l) => envKey(l.environment) === envKey(environment));
  const prim = mine.map((l) => l.trials[0]);
  const pass = prim.filter((t) => t.verdict === "passed").length;
  const fail = prim.filter((t) => t.verdict === "failed").length;
  const inconclusive = prim.filter((t) => t.verdict === "inconclusive");
  const sessionsWithPass = new Set(mine.filter((l) => l.trials[0].verdict === "passed").map((l) => l.sessionId)).size;
  const fixtures = (name: string) => mine.flatMap((l) => l.trials.filter((t) => t.fixture === name));
  const negatives = ["restyle", "swap", "text", "size"].map((name) => ({ name, failed: fixtures(name).filter((t) => t.verdict === "failed").length, passed: fixtures(name).filter((t) => t.verdict === "passed").length }));
  const notInconclusive = ["moved", "clipped", "hovered", "focused"].flatMap((name) => fixtures(name).filter((t) => t.verdict !== "inconclusive"));
  const refusalViolations = ["protected", "handoff", "sensitive"].flatMap((name) => fixtures(name).filter((t) => t.captures !== 0 || t.verdict !== "inconclusive"));
  const durations = prim.map((t) => t.durationMs).sort((a, b) => a - b);
  const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
  const bound = fail === 0 && pass > 0 ? 1 - Math.pow(0.05, 1 / pass) : null;

  check(`${id}: >= 300 passing primary launches (${pass})`, pass >= 300);
  check(`${id}: over >= 3 sessions (${sessionsWithPass})`, sessionsWithPass >= 3);
  check(`${id}: zero failed primary trials`, fail === 0, String(fail));
  check(
    `${id}: every inconclusive primary is a deadline or capture refusal, counted toward neither (${inconclusive.length}: ${[...new Set(inconclusive.map((t) => t.code))].join(", ") || "none"})`,
    inconclusive.every((t) => ["budget-exhausted", "capture-unavailable", "capture-stale", "page-closed", "cancelled"].includes(t.code))
  );
  for (const n of negatives) check(`${id}: ${n.name} failed in >= 30 launches (${n.failed}) and never passed`, n.failed >= 30 && n.passed === 0);
  check(`${id}: moved, clipped, hovered and focused always inconclusive`, notInconclusive.length === 0, String(notInconclusive.length));
  check(`${id}: zero captures on protected, handoff and sensitive fixtures`, refusalViolations.length === 0, String(refusalViolations.length));
  check(`${id}: p95 over one primary per launch within 2000 ms (${p95} ms over ${durations.length})`, p95 <= 2000);

  const module = evaluateCalibrationCell(mine[0].cell, environment, all);
  check(
    `${id}: the shipped criterion agrees with this recount`,
    module.qualified && module.primary.passed === pass && module.primary.failed === fail && module.p95Ms === p95 && module.sessions === sessionsWithPass && module.falseMismatchUpperBound95 === bound
  );

  const grant = grants.find((g) => `${g.cell.renderMode}@${g.cell.devicePixelRatio}` === id);
  if (!grant) {
    check(`${id}: a grant exists for the qualified cell`, false, "no grant file");
  } else {
    const counted = all.filter((l) => cellOf(l) === id && envKey(l.environment) === envKey(grant.environment) && l.startedAt < grant.issuedAt);
    const digest = createHash("sha256").update(canonicalJson(counted), "utf8").digest("hex");
    check(`${id}: the grant binds the dev mode and this cell's recorded environment`, grant.mode === "dev" && envKey(grant.environment) === envKey(environment));
    check(`${id}: the grant's evidence digest matches the ${counted.length} launches recorded before its issue`, digest === grant.evidenceDigest, `${digest} vs ${grant.evidenceDigest}`);
    rows.push(`  ${id.padEnd(14)} passed ${String(pass).padStart(3)}  failed ${fail}  inconclusive ${inconclusive.length}  sessions ${sessionsWithPass}  p95 ${p95} ms  bound ${(100 * (bound ?? NaN)).toFixed(3)} %  grant expires ${grant.expiresAt}`);
  }
}
check("every grant file names a cell that has evidence", grants.every((g) => cells.includes(`${g.cell.renderMode}@${g.cell.devicePixelRatio}`)));

console.log("\nRecalculated qualification:\n");
for (const row of rows) console.log(row);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
