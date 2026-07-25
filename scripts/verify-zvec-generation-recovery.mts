/**
 * Verifies semantic-index reconciliation against a real temporary directory tree.
 *
 * Phase 0D left five orphaned generations (110.8 MB) after abruptly-killed runs, with nothing to
 * reclaim them. These checks pin the behaviour that fixes it, and — just as importantly — pin what
 * reconciliation must NEVER do: touch the active generation, delete a quarantined one, or disturb
 * anything that is not a generation directory.
 *
 * Run: npx tsx scripts/verify-zvec-generation-recovery.mts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { semanticIndexLayout, generationName } from "@src/semantic/SemanticGenerationLayout";
import {
  GENERATION_RETENTION_COUNT,
  markIndexClosed,
  markIndexOpen,
  readMetadata,
  reconcileGenerations,
  writeMetadata
} from "@src/semantic/SemanticGenerationReconciler";
import { defaultSemanticIndexMetadata } from "@src/semantic/SemanticGenerationLayout";

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

/** Build a disposable runtime root with the given generations, each holding a sized dummy file. */
function makeRoot(generations: string[], bytesEach = 1024): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-semantic-"));
  const layout = semanticIndexLayout(root);
  fs.mkdirSync(layout.generations, { recursive: true });
  for (const name of generations) {
    const dir = path.join(layout.generations, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "collection.bin"), Buffer.alloc(bytesEach));
  }
  return root;
}

const cleanup: string[] = [];
function tempRoot(generations: string[], bytesEach?: number): string {
  const r = makeRoot(generations, bytesEach);
  cleanup.push(r);
  return r;
}

console.log("Semantic generation reconciliation:\n");

// ── unclean shutdown discards every non-active generation ──
console.log("Unclean shutdown:");
{
  const root = tempRoot([generationName(1), generationName(2), generationName(3)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: generationName(3), cleanShutdown: false });
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: generationName(3) });
  const layout = semanticIndexLayout(root);

  check("unclean shutdown is detected", report.uncleanShutdown);
  check("the active generation survives", fs.existsSync(path.join(layout.generations, generationName(3))));
  check("orphan gen-000001 is removed", !fs.existsSync(path.join(layout.generations, generationName(1))));
  check("orphan gen-000002 is removed", !fs.existsSync(path.join(layout.generations, generationName(2))));
  check("reclaimed bytes are reported", report.reclaimedBytes >= 2048, `${report.reclaimedBytes} bytes`);
  check(
    "the active generation is labelled active, not discarded",
    report.outcomes.find((o) => o.name === generationName(3))?.disposition === "active"
  );
}

// ── missing metadata is treated as unclean, never assumed safe ──
{
  const root = tempRoot([generationName(1)]);
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: null });
  check("absent metadata is treated as an unclean shutdown", report.uncleanShutdown);
}
{
  const root = tempRoot([generationName(1)]);
  fs.writeFileSync(semanticIndexLayout(root).metadataFile, "{ this is not json");
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: null });
  check("corrupt metadata is treated as an unclean shutdown", report.uncleanShutdown);
}

// ── clean shutdown keeps a bounded rollback window ──
console.log("\nClean shutdown:");
{
  const root = tempRoot([generationName(1), generationName(2), generationName(3), generationName(4)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: generationName(4), cleanShutdown: true });
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: generationName(4) });
  const layout = semanticIndexLayout(root);

  check("clean shutdown is detected", !report.uncleanShutdown);
  check("the active generation survives", fs.existsSync(path.join(layout.generations, generationName(4))));
  check(
    `exactly ${GENERATION_RETENTION_COUNT} rollback target is retained`,
    report.outcomes.filter((o) => o.disposition === "retained").length === GENERATION_RETENTION_COUNT
  );
  check("the retained target is the NEWEST non-active generation", fs.existsSync(path.join(layout.generations, generationName(3))));
  check("older generations beyond retention are discarded", !fs.existsSync(path.join(layout.generations, generationName(1))));
}

// ── quarantine preserves evidence rather than deleting it ──
console.log("\nQuarantine:");
{
  const root = tempRoot([generationName(1), generationName(2)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: generationName(2), cleanShutdown: false });
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: generationName(2), quarantined: [generationName(1)] });
  const layout = semanticIndexLayout(root);

  check("the crashing generation is quarantined, not discarded", report.outcomes.find((o) => o.name === generationName(1))?.disposition === "quarantined");
  check("it is moved out of generations/", !fs.existsSync(path.join(layout.generations, generationName(1))));
  const quarantined = fs.existsSync(layout.quarantine) ? fs.readdirSync(layout.quarantine) : [];
  check("it is preserved under quarantine/ for inspection", quarantined.some((n) => n.startsWith(generationName(1))), quarantined.join(","));
  check("its bytes are NOT counted as reclaimed", !report.outcomes.some((o) => o.disposition === "quarantined" && report.reclaimedBytes >= o.bytes && o.bytes > 0 && report.reclaimedBytes === o.bytes));
}

// ── dry run plans without touching disk ──
console.log("\nDry run:");
{
  const root = tempRoot([generationName(1), generationName(2)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: generationName(2), cleanShutdown: false });
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: generationName(2), dryRun: true });
  const layout = semanticIndexLayout(root);

  check("dry run reports the plan", report.outcomes.length >= 2);
  check("dry run marks itself as such", report.dryRun);
  check("dry run deletes nothing", fs.existsSync(path.join(layout.generations, generationName(1))));
  check("dry run still reports what WOULD be reclaimed", report.reclaimedBytes > 0);
}

// ── non-generation entries are never disturbed ──
console.log("\nSafety:");
{
  const root = tempRoot([generationName(1)]);
  const layout = semanticIndexLayout(root);
  const stray = path.join(layout.generations, "user-notes.txt");
  const strayDir = path.join(layout.generations, "not-a-generation");
  fs.writeFileSync(stray, "do not delete me");
  fs.mkdirSync(strayDir, { recursive: true });
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: null, cleanShutdown: false });

  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: null });
  check("a stray file is left untouched", fs.existsSync(stray));
  check("a non-generation directory is left untouched", fs.existsSync(strayDir));
  check("both are reported as ignored", report.outcomes.filter((o) => o.disposition === "ignored").length === 2);
}
{
  // Reconciling an index that does not exist yet must be a no-op, not a crash.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-semantic-empty-"));
  cleanup.push(root);
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: null });
  check("a missing semantic-index directory reconciles as a no-op", report.outcomes.length === 0);
}

// ── the clean/unclean marker round-trips ──
console.log("\nShutdown marker:");
{
  const root = tempRoot([generationName(1)]);
  markIndexOpen(root);
  check("markIndexOpen records cleanShutdown=false", readMetadata(root).cleanShutdown === false);
  markIndexClosed(root, generationName(1));
  const after = readMetadata(root);
  check("markIndexClosed records cleanShutdown=true", after.cleanShutdown === true);
  check("markIndexClosed records the active generation", after.activeGeneration === generationName(1));
  check("markIndexClosed stamps lastSuccessfulUpdateAt", Boolean(after.lastSuccessfulUpdateAt));

  // The real sequence: open, crash (no close), reconcile.
  markIndexOpen(root);
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: generationName(1) });
  check("open-then-crash is detected as unclean on the next start", report.uncleanShutdown);
}

// ── a pointer naming a missing generation is REPORTED, never silently repaired ──
{
  const root = tempRoot([generationName(1)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: generationName(9), cleanShutdown: true });
  const report = reconcileGenerations({ runtimeRoot: root, authoritativeActiveGeneration: generationName(9) });
  check("the missing active generation is reported", report.activeGenerationMissing);
  check("nothing is discarded while the active generation is missing", report.reclaimedBytes === 0);
  check("surviving generations are preserved for rebuild", fs.existsSync(path.join(semanticIndexLayout(root).generations, generationName(1))));
  check("no other generation is silently promoted", report.activeGeneration === generationName(9));
}

for (const dir of cleanup) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* temp dirs are disposable */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
