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
import {
  readActivePointerStrict,
  repairMetadataFromPointer,
  resolveActiveIdentity
} from "@src/semantic/SemanticGenerationManager";
import { buildSemanticHealth } from "@src/semantic/contracts/SemanticHealth";

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
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "known", generation: generationName(3) } });
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
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "none" } });
  check("absent metadata is treated as an unclean shutdown", report.uncleanShutdown);
}
{
  const root = tempRoot([generationName(1)]);
  fs.writeFileSync(semanticIndexLayout(root).metadataFile, "{ this is not json");
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "none" } });
  check("corrupt metadata is treated as an unclean shutdown", report.uncleanShutdown);
}

// ── clean shutdown keeps a bounded rollback window ──
console.log("\nClean shutdown:");
{
  const root = tempRoot([generationName(1), generationName(2), generationName(3), generationName(4)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: generationName(4), cleanShutdown: true });
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "known", generation: generationName(4) } });
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
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "known", generation: generationName(2) }, quarantined: [generationName(1)] });
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
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "known", generation: generationName(2) }, dryRun: true });
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

  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "none" } });
  check("a stray file is left untouched", fs.existsSync(stray));
  check("a non-generation directory is left untouched", fs.existsSync(strayDir));
  check("both are reported as ignored", report.outcomes.filter((o) => o.disposition === "ignored").length === 2);
}
{
  // Reconciling an index that does not exist yet must be a no-op, not a crash.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-semantic-empty-"));
  cleanup.push(root);
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "none" } });
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
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "known", generation: generationName(1) } });
  check("open-then-crash is detected as unclean on the next start", report.uncleanShutdown);
}

// ── a pointer naming a missing generation is REPORTED, never silently repaired ──
{
  const root = tempRoot([generationName(1)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: generationName(9), cleanShutdown: true });
  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: { status: "known", generation: generationName(9) } });
  check("the missing active generation is reported", report.activeGenerationMissing);
  check("nothing is discarded while the active generation is missing", report.reclaimedBytes === 0);
  check("surviving generations are preserved for rebuild", fs.existsSync(path.join(semanticIndexLayout(root).generations, generationName(1))));
  check("no other generation is silently promoted", report.activeGeneration === generationName(9));
}

// ── a DAMAGED pointer must never read as "no active generation" ──
//
// This is the regression suite for the defect where `readActivePointer` returned `null` for missing,
// unreadable, malformed, and invalid-name pointers alike. Reconciliation reads `null` as "nothing is
// active, so nothing is protected", and on an unclean shutdown that discarded EVERY generation —
// including the live one. Each case below writes a real damaged pointer to disk and drives the real
// production startup mapping (`resolveActiveIdentity`), not a hand-built identity object.
console.log("\nDamaged active pointer (identity unknown):");

/** Write a raw pointer file body, bypassing the writer's validation. */
function writeRawPointer(root: string, body: string): void {
  const layout = semanticIndexLayout(root);
  fs.mkdirSync(layout.root, { recursive: true });
  fs.writeFileSync(layout.activeGenerationFile, body, "utf8");
}

const DAMAGED_POINTERS: Array<{ label: string; write: (root: string) => void; expect: "invalid" | "unreadable" }> = [
  { label: "malformed JSON", write: (r) => writeRawPointer(r, "{ not json"), expect: "invalid" },
  { label: "truncated mid-write", write: (r) => writeRawPointer(r, '{"activeGeneration":"gen-0000'), expect: "invalid" },
  { label: "empty file", write: (r) => writeRawPointer(r, ""), expect: "invalid" },
  { label: "JSON array instead of an object", write: (r) => writeRawPointer(r, "[]"), expect: "invalid" },
  { label: "JSON null", write: (r) => writeRawPointer(r, "null"), expect: "invalid" },
  {
    label: "invalid activeGeneration name",
    write: (r) => writeRawPointer(r, JSON.stringify({ activeGeneration: "../escape", previousGeneration: null, activatedAt: new Date().toISOString() })),
    expect: "invalid"
  },
  {
    label: "garbage previousGeneration",
    write: (r) => writeRawPointer(r, JSON.stringify({ activeGeneration: generationName(2), previousGeneration: "not-a-generation", activatedAt: new Date().toISOString() })),
    expect: "invalid"
  },
  {
    label: "missing previousGeneration field",
    write: (r) => writeRawPointer(r, JSON.stringify({ activeGeneration: generationName(2), activatedAt: new Date().toISOString() })),
    expect: "invalid"
  },
  {
    label: "non-timestamp activatedAt",
    write: (r) => writeRawPointer(r, JSON.stringify({ activeGeneration: generationName(2), previousGeneration: null, activatedAt: "whenever" })),
    expect: "invalid"
  },
  {
    // A directory where the file should be: readFileSync fails with EISDIR, not ENOENT.
    label: "unreadable (directory in place of the file)",
    write: (r) => {
      const layout = semanticIndexLayout(r);
      fs.mkdirSync(layout.root, { recursive: true });
      fs.mkdirSync(layout.activeGenerationFile, { recursive: true });
    },
    expect: "unreadable"
  }
];

for (const damaged of DAMAGED_POINTERS) {
  const root = tempRoot([generationName(1), generationName(2), generationName(3)]);
  const layout = semanticIndexLayout(root);
  // The worst case: an unclean shutdown, which is exactly when the discard rule is armed.
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: null, cleanShutdown: false });
  damaged.write(root);

  const read = readActivePointerStrict(root);
  check(`${damaged.label}: reads as ${damaged.expect}, not missing`, read.status === damaged.expect, read.status);

  const identity = resolveActiveIdentity(root);
  check(`${damaged.label}: identity resolves to unknown`, identity.status === "unknown", identity.status);

  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: identity });

  // The load-bearing assertion: nothing on disk was destroyed.
  const survivors = [generationName(1), generationName(2), generationName(3)].filter((n) =>
    fs.existsSync(path.join(layout.generations, n))
  );
  check(`${damaged.label}: ALL generations survive`, survivors.length === 3, `survivors: ${survivors.join(", ") || "none"}`);
  check(`${damaged.label}: nothing is reclaimed`, report.reclaimedBytes === 0, String(report.reclaimedBytes));
  check(`${damaged.label}: no generation is discarded`, !report.outcomes.some((o) => o.disposition === "discarded"));
  check(`${damaged.label}: reported as identity-unknown`, report.activeIdentityUnknown);
  check(`${damaged.label}: recovery is required`, report.recoveryRequired);
  check(`${damaged.label}: no generation is claimed active`, report.activeGeneration === null, String(report.activeGeneration));
}

// Quarantine is destructive too (it RENAMES a directory) and must also be suppressed: if the moved
// generation were the live one, quarantining it would break the index just as surely as deleting it.
{
  const root = tempRoot([generationName(1), generationName(2)]);
  const layout = semanticIndexLayout(root);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: null, cleanShutdown: false });
  writeRawPointer(root, "{ corrupt");

  const report = reconcileGenerations({
    runtimeRoot: root,
    activeIdentity: resolveActiveIdentity(root),
    quarantined: [generationName(1)]
  });

  check("identity unknown suppresses quarantine too", fs.existsSync(path.join(layout.generations, generationName(1))));
  check("nothing is quarantined while identity is unknown", !report.outcomes.some((o) => o.disposition === "quarantined"));
  check("the quarantine directory is not even created", !fs.existsSync(layout.quarantine));
}

// A genuinely ABSENT pointer is the normal first-use state and must still permit cleanup — otherwise
// the fix would trade data loss for the unbounded-orphan problem Phase 0D found.
{
  const root = tempRoot([generationName(1), generationName(2)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: null, cleanShutdown: false });
  // No pointer file written at all.
  const read = readActivePointerStrict(root);
  check("an absent pointer reads as missing, not invalid", read.status === "missing", read.status);
  check("an absent pointer resolves to identity none", resolveActiveIdentity(root).status === "none");

  const report = reconcileGenerations({ runtimeRoot: root, activeIdentity: resolveActiveIdentity(root) });
  check("first-use cleanup still runs when the pointer is genuinely absent", report.reclaimedBytes > 0, String(report.reclaimedBytes));
  check("an absent pointer is NOT reported as identity-unknown", !report.activeIdentityUnknown);
  check("an absent pointer does not demand recovery", !report.recoveryRequired);
}

// A well-formed pointer must still round-trip through the strict reader unchanged.
{
  const root = tempRoot([generationName(4)]);
  const activatedAt = new Date().toISOString();
  writeRawPointer(root, JSON.stringify({ activeGeneration: generationName(4), previousGeneration: generationName(3), activatedAt }));
  const read = readActivePointerStrict(root);
  check("a valid pointer reads as ok", read.status === "ok", read.status);
  check(
    "a valid pointer preserves all three fields",
    read.status === "ok" &&
      read.pointer.activeGeneration === generationName(4) &&
      read.pointer.previousGeneration === generationName(3) &&
      read.pointer.activatedAt === activatedAt
  );
  check("a valid pointer resolves to a known identity", resolveActiveIdentity(root).status === "known");
}

// Health must name the cause rather than reporting a generic rebuild.
{
  const health = buildSemanticHealth({
    included: true,
    enabledBySetting: true,
    hostState: "ready",
    circuitOpen: false,
    unexpectedExits: 0,
    lastReasonCode: null,
    activeGeneration: null,
    previousShutdownClean: false,
    reclaimedBytesOnStartup: 0,
    activePointerReadFailed: true
  });
  check("health reports ACTIVE_POINTER_READ_FAILED", health.degradedReason === "ACTIVE_POINTER_READ_FAILED", String(health.degradedReason));
  check("health marks capability unavailable", health.capability === "unavailable");
  check("the pointer-read summary leaks no filesystem path", !/[\\/]|[A-Za-z]:/.test(health.summary), health.summary);
  check("ACTIVE_POINTER_READ_FAILED outranks a generic rebuild-required", buildSemanticHealth({
    included: true, enabledBySetting: true, hostState: "ready", circuitOpen: false, unexpectedExits: 0,
    lastReasonCode: null, activeGeneration: null, previousShutdownClean: false, reclaimedBytesOnStartup: 0,
    activePointerReadFailed: true, rebuildRequired: true
  }).degradedReason === "ACTIVE_POINTER_READ_FAILED");
}

// A damaged pointer must not let metadata be "repaired" from it.
{
  const root = tempRoot([generationName(1)]);
  writeRawPointer(root, "{ corrupt");
  const repair = repairMetadataFromPointer(root);
  check("metadata repair refuses a damaged pointer", repair.status === "failed", JSON.stringify(repair));
  check("metadata repair names POINTER_UNREADABLE", repair.status === "failed" && repair.reason === "POINTER_UNREADABLE", JSON.stringify(repair));
}

// markIndexClosed(undefined) preserves the recorded generation instead of asserting absence.
{
  const root = tempRoot([generationName(1)]);
  writeMetadata(root, { ...defaultSemanticIndexMetadata(), activeGeneration: generationName(1), cleanShutdown: false });
  markIndexClosed(root, undefined);
  const after = readMetadata(root);
  check("markIndexClosed(undefined) preserves the recorded activeGeneration", after.activeGeneration === generationName(1), String(after.activeGeneration));
  check("markIndexClosed(undefined) still records a clean shutdown", after.cleanShutdown);

  markIndexClosed(root, null);
  check("markIndexClosed(null) still clears it explicitly", readMetadata(root).activeGeneration === null);
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
