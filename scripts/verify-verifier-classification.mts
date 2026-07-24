/**
 * Verifier-classification reconciler + per-class reporter (SRS-BAO-001 FR-I1, Tranche 0).
 *
 * Verifier class: **Static source validation** (parses package.json + the registry source; runs no
 * feature).
 *
 * What realistic regression would make this test fail?
 *   Adding a new `verify:` / `validate:` npm script without classifying it in
 *   `scripts/lib/verifier-classification.ts`; removing a script while leaving a stale registry
 *   entry; or assigning a class outside the fixed taxonomy. Any of those means the per-class counts
 *   below would be wrong or incomplete — precisely the "one undifferentiated total" FR-I1 forbids
 *   (I1.1, I1.3). This is what makes the classification enforceable rather than a one-time note.
 *
 * Run: npx tsx scripts/verify-verifier-classification.mts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VERIFIER_CLASSES, VERIFIER_CLASSIFICATION, type VerifierClass } from "./lib/verifier-classification";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { scripts: Record<string, string> };
const scripts = Object.keys(pkg.scripts).filter((s) => /^(verify|validate):/.test(s));

let failed = 0;
const fail = (msg: string): void => {
  failed += 1;
  console.error(`  ✗ ${msg}`);
};
const pass = (msg: string): void => console.log(`  ✓ ${msg}`);

console.log("Verifier classification reconciliation (FR-I1)\n");

// I1.1 — every verify:/validate: script carries a class.
const unclassified = scripts.filter((s) => !VERIFIER_CLASSIFICATION[s]);
if (unclassified.length) fail(`unclassified verifiers — add them to verifier-classification.ts: ${unclassified.join(", ")}`);
else pass(`all ${scripts.length} verify:/validate: scripts are classified`);

// No stale registry entries (an entry whose npm script was renamed/removed).
const scriptSet = new Set(scripts);
const stale = Object.keys(VERIFIER_CLASSIFICATION).filter((k) => !scriptSet.has(k));
if (stale.length) fail(`stale classification entries — no such npm script: ${stale.join(", ")}`);
else pass("no stale classification entries");

// Every class value is a member of the fixed taxonomy.
const taxonomy = new Set<string>(VERIFIER_CLASSES);
const badClass = Object.entries(VERIFIER_CLASSIFICATION).filter(([, v]) => !taxonomy.has(v.class));
if (badClass.length) fail(`entries with a non-taxonomy class: ${badClass.map(([k]) => k).join(", ")}`);
else pass("every entry uses a taxonomy class");

// I1.3 — per-class counts over the scripts that actually exist. Never a single total alone.
const counts = new Map<VerifierClass, number>(VERIFIER_CLASSES.map((c) => [c, 0]));
for (const s of scripts) {
  const entry = VERIFIER_CLASSIFICATION[s];
  if (entry) counts.set(entry.class, (counts.get(entry.class) ?? 0) + 1);
}

console.log("\nPer-class verifier counts (FR-I1 I1.3 — report these, never one undifferentiated total):");
let total = 0;
for (const c of VERIFIER_CLASSES) {
  const n = counts.get(c) ?? 0;
  total += n;
  console.log(`  ${String(n).padStart(3)}  ${c}`);
}
console.log(`  ${String(total).padStart(3)}  (sum — meaningful ONLY beside the per-class breakdown above)`);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nclassification reconciled ✓");
