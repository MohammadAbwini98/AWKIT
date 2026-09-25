/**
 * L4b's held-out selection, by the rule in scripts/ai-harness/authoringHeldOutSelection.ts (owner directive
 * 2026-09-26, latest). No model, no display gate.
 *
 *   npm run verify:ai-authoring-held-out-eligibility  enumerate every candidate of S1 and S2, apply E1 to E3, and
 *       write eligibility.json once (a later run compares with it and never rewrites it). Exit 0 written or
 *       matching, 1 differing.
 *   npm run verify:ai-authoring-held-out-select       only once eligibility.json is committed and matches a fresh
 *       enumeration: derive the seed from it, and write the selected flows to flows/ once. Exit 0 written or
 *       already the selection, 1 refused.
 * Then `npm run verify:ai-authoring-held-out` writes inventory.json, and both are committed before any fresh run.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { HELD_OUT_DIR } from "./ai-harness/authoringDx";
import {
  ELIGIBILITY_FILE,
  buildEligibility,
  heldOutFileName,
  oracleCandidates,
  resourceCandidates,
  selectHeldOut,
  selectionSeed,
  type Candidate,
  type EligibilityInventory
} from "./ai-harness/authoringHeldOutSelection";

const root = process.cwd();
const dir = path.join(root, HELD_OUT_DIR);
const eligibilityPath = path.join(dir, ELIGIBILITY_FILE);
const candidates: Candidate[] = [...resourceCandidates(root), ...oracleCandidates()];
const fresh = buildEligibility(candidates);

const excludedBy = (rule: string) => fresh.entries.filter((e) => e.excluded?.startsWith(rule)).length;
console.log(`L4b held-out eligibility (rules ${fresh.rules}): ${fresh.candidates} candidate(s), ${fresh.eligible} eligible sending ${fresh.issuesEligible} issue(s)`);
console.log(`  excluded: E1 ${excludedBy("E1")}, E2 ${excludedBy("E2")}, E3 ${excludedBy("E3")}`);
if (fresh.candidates !== fresh.eligible + excludedBy("E1") + excludedBy("E2") + excludedBy("E3")) {
  console.error("  ✗ every candidate must be either eligible or excluded by exactly one rule");
  process.exit(1);
}

const committedText = fs.existsSync(eligibilityPath) ? fs.readFileSync(eligibilityPath, "utf8") : null;
const matches = committedText !== null && JSON.stringify(JSON.parse(committedText)) === JSON.stringify(fresh);

if (process.argv.includes("--eligibility")) {
  if (committedText === null) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(eligibilityPath, `${JSON.stringify(fresh, null, 2)}\n`);
    console.log(`wrote ${path.relative(root, eligibilityPath)}: commit it before the selection`);
    process.exit(0);
  }
  console.log(matches ? `${ELIGIBILITY_FILE} matches a fresh enumeration` : `✗ ${ELIGIBILITY_FILE} DIFFERS from a fresh enumeration; it is never rewritten`);
  process.exit(matches ? 0 : 1);
}

if (!process.argv.includes("--select")) {
  console.error("--eligibility or --select");
  process.exit(1);
}
const refuse = (why: string) => {
  console.error(`REFUSED: ${why}`);
  process.exit(1);
};
if (committedText === null) refuse(`no ${ELIGIBILITY_FILE}; run verify:ai-authoring-held-out-eligibility and commit it first`);
if (!matches) refuse(`${ELIGIBILITY_FILE} differs from a fresh enumeration`);
const relative = path.relative(root, eligibilityPath);
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
if (git("ls-files", "--", relative).trim() === "" || git("status", "--porcelain", "--", relative).trim() !== "") refuse(`${relative} is not committed as it is`);

const inventory = JSON.parse(committedText!) as EligibilityInventory;
const chosen = selectHeldOut(inventory);
console.log(`  seed ${selectionSeed(inventory)} (SHA-256 of ${ELIGIBILITY_FILE}'s content)`);
console.log(`  selected ${chosen.length} flow(s) sending ${chosen.reduce((n, e) => n + e.sent.length, 0)} issue(s):`);
const bySource = new Map(candidates.map((c) => [c.source, c]));
const planned = chosen.map((entry) => ({ entry, name: heldOutFileName(entry.source), text: bySource.get(entry.source)!.text }));
for (const p of planned) console.log(`    ${p.name}  ${p.entry.source}  sends ${p.entry.sent.map((s) => `${s.code}${s.fixable ? "+fix" : ""}${s.blocking ? "+blocks" : ""}`).join(", ")}`);
if (new Set(planned.map((p) => p.name)).size !== planned.length) refuse("two selected flows map to one file name");

const flowsDir = path.join(dir, "flows");
const existing = fs.existsSync(flowsDir) ? fs.readdirSync(flowsDir).sort() : [];
if (existing.length > 0) {
  const same = existing.length === planned.length && planned.every((p) => existing.includes(p.name) && fs.readFileSync(path.join(flowsDir, p.name), "utf8") === p.text);
  console.log(same ? "flows/ already holds exactly this selection" : "");
  if (!same) refuse("flows/ holds something other than this selection; it is never rewritten");
  process.exit(0);
}
fs.mkdirSync(flowsDir, { recursive: true });
for (const p of planned) fs.writeFileSync(path.join(flowsDir, p.name), p.text);
console.log(`wrote ${planned.length} flow(s) to ${path.relative(root, flowsDir)}: run verify:ai-authoring-held-out, then commit flows/ and inventory.json`);
