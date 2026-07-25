/**
 * Verifies the generation create/validate/activate/rollback lifecycle against real temp trees.
 *
 * The invariant under test is the one that protects a working index: **a rebuild must never mutate
 * the active generation.** A failed or crashed rebuild has to leave the previously active pointer
 * exactly as it was, and a successful one has to move the pointer in a single atomic step.
 *
 * Run: npx tsx scripts/verify-zvec-generation-lifecycle.mts
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generationName, semanticIndexLayout } from "@src/semantic/SemanticGenerationLayout";
import {
  activateGeneration,
  createGeneration,
  listGenerations,
  readActivePointer,
  rebuildIntoNewGeneration,
  repairMetadataFromPointer,
  rollbackGeneration,
  SemanticGenerationError
} from "@src/semantic/SemanticGenerationManager";
import { readMetadata } from "@src/semantic/SemanticGenerationReconciler";
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

const cleanup: string[] = [];
function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-genlife-"));
  fs.mkdirSync(semanticIndexLayout(root).generations, { recursive: true });
  cleanup.push(root);
  return root;
}

function threw(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof SemanticGenerationError ? error.reason : `unexpected: ${String(error)}`;
  }
}

const OK = { ok: true } as const;

console.log("Generation lifecycle:\n");

// ── create ──
console.log("Create:");
{
  const root = tempRoot();
  const first = createGeneration(root);
  check("first generation is gen-000001", first.name === generationName(1), first.name);
  check("its directory is created", fs.existsSync(first.path));
  const second = createGeneration(root);
  check("the next generation increments", second.name === generationName(2), second.name);
  check("generations list newest-first", listGenerations(root)[0] === generationName(2));
}
{
  // Sequence must come from disk, not a stored counter: a counter drifts after a manual deletion
  // and then hands out a name that already exists.
  const root = tempRoot();
  fs.mkdirSync(path.join(semanticIndexLayout(root).generations, generationName(7)), { recursive: true });
  const next = createGeneration(root);
  check("sequence is derived from what is on disk", next.name === generationName(8), next.name);
}

// ── activate ──
console.log("\nActivate:");
{
  const root = tempRoot();
  const gen = createGeneration(root);
  const { pointer } = activateGeneration(root, gen.name, OK);
  check("pointer names the activated generation", pointer.activeGeneration === gen.name);
  check("the first activation has no predecessor", pointer.previousGeneration === null);
  check("pointer is persisted", readActivePointer(root)?.activeGeneration === gen.name);
  check("metadata records the active generation", readMetadata(root).activeGeneration === gen.name);
  check("metadata stamps lastSuccessfulRebuildAt", Boolean(readMetadata(root).lastSuccessfulRebuildAt));

  const second = createGeneration(root);
  const { pointer: moved } = activateGeneration(root, second.name, OK);
  check("activating again retains the predecessor for rollback", moved.previousGeneration === gen.name);
  check("the new generation is active", readActivePointer(root)?.activeGeneration === second.name);
}
{
  const root = tempRoot();
  check("activating a missing generation is refused", threw(() => activateGeneration(root, generationName(3), OK)) === "SEMANTIC_GENERATION_MISSING");
  const gen = createGeneration(root);
  check(
    "activating a generation that FAILED validation is refused",
    threw(() => activateGeneration(root, gen.name, { ok: false, reason: "sample query returned nothing" })) ===
      "SEMANTIC_GENERATION_VALIDATION_FAILED"
  );
  check("a rejected activation leaves no active pointer", readActivePointer(root) === null);
  check("an invalid generation name is refused", threw(() => activateGeneration(root, "not-a-generation", OK)) === "SEMANTIC_GENERATION_INVALID_NAME");
}
{
  // Re-activating the current generation must not make it its own predecessor, or rollback becomes
  // a no-op that silently pretends to have rolled back.
  const root = tempRoot();
  const gen = createGeneration(root);
  activateGeneration(root, gen.name, OK);
  const { pointer: again } = activateGeneration(root, gen.name, OK);
  check("re-activating the same generation keeps previous=null", again.previousGeneration === null, String(again.previousGeneration));
}

// ── rollback ──
console.log("\nRollback:");
{
  const root = tempRoot();
  const first = createGeneration(root);
  activateGeneration(root, first.name, OK);
  const second = createGeneration(root);
  activateGeneration(root, second.name, OK);

  const { pointer: rolled } = rollbackGeneration(root);
  check("rollback restores the predecessor", rolled.activeGeneration === first.name);
  check("rollback keeps the abandoned generation as the forward target", rolled.previousGeneration === second.name);
  check("metadata follows the rollback", readMetadata(root).activeGeneration === first.name);

  const { pointer: forward } = rollbackGeneration(root);
  check("rolling back again returns to the newer generation", forward.activeGeneration === second.name);
}
{
  const root = tempRoot();
  check("rollback with no active pointer is refused", threw(() => rollbackGeneration(root)) === "SEMANTIC_GENERATION_NO_ACTIVE");
  const only = createGeneration(root);
  activateGeneration(root, only.name, OK);
  check("rollback with no retained target is refused", threw(() => rollbackGeneration(root)) === "SEMANTIC_GENERATION_NO_ROLLBACK_TARGET");
}
{
  const root = tempRoot();
  const first = createGeneration(root);
  activateGeneration(root, first.name, OK);
  const second = createGeneration(root);
  activateGeneration(root, second.name, OK);
  // The retained target was reclaimed; rollback must say so rather than point at a missing path.
  fs.rmSync(path.join(semanticIndexLayout(root).generations, first.name), { recursive: true, force: true });
  check("rollback to a reclaimed target is refused", threw(() => rollbackGeneration(root)) === "SEMANTIC_GENERATION_ROLLBACK_TARGET_MISSING");
  check("the active pointer is unchanged by the refused rollback", readActivePointer(root)?.activeGeneration === second.name);
}

// ── rebuild ──
console.log("\nRebuild (never mutates the active generation):");
{
  const root = tempRoot();
  const original = createGeneration(root);
  fs.writeFileSync(path.join(original.path, "collection.bin"), Buffer.alloc(2048));
  activateGeneration(root, original.name, OK);

  const outcome = await rebuildIntoNewGeneration({
    runtimeRoot: root,
    populate: async (_n, p) => {
      fs.writeFileSync(path.join(p, "collection.bin"), Buffer.alloc(4096));
    },
    validate: async () => OK
  });
  check("a successful rebuild activates the new generation", outcome.activated);
  check("the pointer moved to the rebuilt generation", readActivePointer(root)?.activeGeneration === outcome.generation);
  check("the previous generation is retained for rollback", readActivePointer(root)?.previousGeneration === original.name);
  check("the previous generation's data is untouched", fs.statSync(path.join(original.path, "collection.bin")).size === 2048);
}
{
  const root = tempRoot();
  const original = createGeneration(root);
  activateGeneration(root, original.name, OK);

  const outcome = await rebuildIntoNewGeneration({
    runtimeRoot: root,
    populate: async () => undefined,
    validate: async () => ({ ok: false, reason: "health query returned no rows" })
  });
  check("a rebuild that fails validation does not activate", !outcome.activated);
  check("the failure reason is reported", outcome.reason === "health query returned no rows", outcome.reason);
  check("the failed generation is discarded", !fs.existsSync(path.join(semanticIndexLayout(root).generations, outcome.generation)));
  check("the ORIGINAL generation is still active", readActivePointer(root)?.activeGeneration === original.name);
}
{
  const root = tempRoot();
  const original = createGeneration(root);
  activateGeneration(root, original.name, OK);

  const outcome = await rebuildIntoNewGeneration({
    runtimeRoot: root,
    populate: async () => {
      throw new Error("host exited mid-populate");
    },
    validate: async () => OK
  });
  check("a rebuild that throws mid-populate does not activate", !outcome.activated);
  check("the partial generation is discarded", !fs.existsSync(path.join(semanticIndexLayout(root).generations, outcome.generation)));
  check("the ORIGINAL generation survives a crashed rebuild", readActivePointer(root)?.activeGeneration === original.name);
  check("the original generation directory still exists", fs.existsSync(original.path));
}

// ── atomicity ──
console.log("\nAtomicity:");
{
  const root = tempRoot();
  const gen = createGeneration(root);
  activateGeneration(root, gen.name, OK);
  const layout = semanticIndexLayout(root);
  check("no .tmp pointer file is left behind", !fs.existsSync(`${layout.activeGenerationFile}.tmp`));
  check("no .tmp metadata file is left behind", !fs.existsSync(`${layout.metadataFile}.tmp`));
  check("the pointer file parses as JSON", (() => { try { JSON.parse(fs.readFileSync(layout.activeGenerationFile, "utf8")); return true; } catch { return false; } })());
}
{
  // A corrupt pointer must read as "no active generation" rather than throwing into startup.
  const root = tempRoot();
  fs.writeFileSync(semanticIndexLayout(root).activeGenerationFile, "{ truncated");
  check("a corrupt pointer reads as null instead of throwing", readActivePointer(root) === null);
}

// ── health / degraded-state model ──
console.log("\nHealth and degraded state:");
{
  const base = {
    included: true,
    enabledBySetting: true,
    hostState: "ready",
    circuitOpen: false,
    unexpectedExits: 0,
    lastReasonCode: null,
    activeGeneration: generationName(1),
    previousShutdownClean: true,
    reclaimedBytesOnStartup: 0
  } as const;

  check("a ready host reports available", buildSemanticHealth({ ...base }).capability === "available");
  check("available carries no degraded reason", buildSemanticHealth({ ...base }).degradedReason === null);

  // Order matters: the most fundamental cause must win, so the reason is actionable rather than a
  // downstream symptom.
  check(
    "not-included wins over every other cause",
    buildSemanticHealth({ ...base, included: false, enabledBySetting: false, circuitOpen: true, hostState: "failedOpen" }).degradedReason ===
      "NOT_INCLUDED"
  );
  check(
    "disabled-by-setting wins over circuit-open",
    buildSemanticHealth({ ...base, enabledBySetting: false, circuitOpen: true }).degradedReason === "DISABLED_BY_SETTING"
  );
  check("circuit-open is reported distinctly", buildSemanticHealth({ ...base, circuitOpen: true }).degradedReason === "CIRCUIT_OPEN");
  check("rebuild-required is reported distinctly", buildSemanticHealth({ ...base, rebuildRequired: true }).degradedReason === "REBUILD_REQUIRED");
  check("a degraded host reports DEGRADED_AFTER_FAILURE", buildSemanticHealth({ ...base, hostState: "degraded" }).degradedReason === "DEGRADED_AFTER_FAILURE");
  check("a stopped host reports NOT_STARTED", buildSemanticHealth({ ...base, hostState: "stopped" }).degradedReason === "NOT_STARTED");
  check("failedOpen maps to CIRCUIT_OPEN", buildSemanticHealth({ ...base, hostState: "failedOpen" }).degradedReason === "CIRCUIT_OPEN");
  check("an unknown host state falls back to HOST_UNAVAILABLE", buildSemanticHealth({ ...base, hostState: "wat" }).degradedReason === "HOST_UNAVAILABLE");
  check("every unavailable state has a non-empty summary", ["NOT_INCLUDED", "CIRCUIT_OPEN", "NOT_STARTED"].every((r) => {
    const h = buildSemanticHealth({ ...base, included: r !== "NOT_INCLUDED", circuitOpen: r === "CIRCUIT_OPEN", hostState: r === "NOT_STARTED" ? "stopped" : base.hostState });
    return h.summary.length > 0;
  }));

  // Paths are privileged: the default shape must be safe to hand to any surface.
  const unprivileged = buildSemanticHealth({ ...base, indexPath: "C:\\Users\\someone\\AppData\\Local\\SpecterStudio\\semantic-index" });
  check("indexPath is OMITTED by default", unprivileged.indexPath === undefined);
  check("no summary leaks a filesystem path", !/[A-Za-z]:\\|\//.test(unprivileged.summary), unprivileged.summary);
  const privileged = buildSemanticHealth({
    ...base,
    indexPath: "C:\\Users\\someone\\AppData\\Local\\SpecterStudio\\semantic-index",
    includePaths: true
  });
  check("indexPath is present only when explicitly requested", typeof privileged.indexPath === "string");

  check(
    "an unclean previous shutdown is surfaced with the bytes reclaimed",
    (() => {
      const h = buildSemanticHealth({ ...base, previousShutdownClean: false, reclaimedBytesOnStartup: 110_800_000 });
      return h.previousShutdownClean === false && h.reclaimedBytesOnStartup === 110_800_000;
    })()
  );
}

// ── the activation failure window (Phase 1A review finding #1) ──
console.log("\nActivation failure window (metadata write fails AFTER the pointer swap):");
{
  const root = tempRoot();
  const original = createGeneration(root);
  activateGeneration(root, original.name, OK);

  const layout = semanticIndexLayout(root);
  // Make the metadata write fail while leaving the pointer write working: a DIRECTORY at
  // metadata.json's path makes writeFileSync throw EISDIR, and the temp+rename write cannot recover.
  fs.rmSync(layout.metadataFile, { force: true });
  fs.mkdirSync(layout.metadataFile, { recursive: true });

  const outcome = await rebuildIntoNewGeneration({
    runtimeRoot: root,
    populate: async (_n, p) => { fs.writeFileSync(path.join(p, "collection.bin"), Buffer.alloc(1024)); },
    validate: async () => OK
  });

  check("activation still counts as activated when only metadata failed", outcome.activated, JSON.stringify(outcome));
  check("status is ACTIVATED_METADATA_REPAIR_REQUIRED", outcome.status === "ACTIVATED_METADATA_REPAIR_REQUIRED", outcome.status);
  // The bug this guards: the rebuild catch used to delete the generation the pointer now named.
  check(
    "the ACTIVATED generation is NOT deleted by the error path",
    fs.existsSync(path.join(layout.generations, outcome.generation)),
    outcome.generation
  );
  check("the pointer names the new generation", readActivePointer(root)?.activeGeneration === outcome.generation);
  check("the pointer does NOT reference a deleted directory", (() => {
    const p2 = readActivePointer(root);
    return Boolean(p2 && fs.existsSync(path.join(layout.generations, p2.activeGeneration)));
  })());

  // Repair path: with metadata writable again, startup brings it back into line with the pointer.
  fs.rmSync(layout.metadataFile, { recursive: true, force: true });
  const repaired = repairMetadataFromPointer(root);
  check("repairMetadataFromPointer reports a repair", repaired);
  check("metadata now agrees with the pointer", readMetadata(root).activeGeneration === outcome.generation);
}
{
  // Repair is a no-op when they already agree, so startup does not rewrite metadata every launch.
  const root = tempRoot();
  const gen = createGeneration(root);
  activateGeneration(root, gen.name, OK);
  check("repair is a no-op when metadata already agrees", repairMetadataFromPointer(root) === false);
}

// ── concurrent allocation (Phase 1A review finding #2) ──
console.log("\nConcurrent generation allocation:");
{
  const root = tempRoot();
  // Allocate repeatedly with no coordination; every name must be unique. mkdir-without-recursive is
  // the atomic claim, so a loser retries rather than silently adopting the winner's directory.
  const names = Array.from({ length: 25 }, () => createGeneration(root).name);
  check("every allocated generation name is unique", new Set(names).size === names.length, names.join(","));
  check("all allocated directories exist", names.every((n) => fs.existsSync(path.join(semanticIndexLayout(root).generations, n))));
}
{
  const root = tempRoot();
  const layout = semanticIndexLayout(root);
  // Pre-claim the name the allocator would pick, simulating a competing creator winning the race.
  fs.mkdirSync(path.join(layout.generations, generationName(1)), { recursive: true });
  const next = createGeneration(root);
  check("allocation skips a name claimed by a competitor", next.name === generationName(2), next.name);
}

// ── the idle state is not a warning (Phase 1A review finding #6) ──
console.log("\nIdle capability:");
{
  const idle = buildSemanticHealth({
    included: true, enabledBySetting: true, hostState: "stopped", circuitOpen: false,
    unexpectedExits: 0, lastReasonCode: null, activeGeneration: null,
    previousShutdownClean: true, reclaimedBytesOnStartup: 0
  });
  check("an unstarted host is availableOnDemand, not unavailable", idle.capability === "availableOnDemand", idle.capability);
  check("it still explains itself as NOT_STARTED", idle.degradedReason === "NOT_STARTED");
  const broken = buildSemanticHealth({
    included: true, enabledBySetting: true, hostState: "wat", circuitOpen: false,
    unexpectedExits: 0, lastReasonCode: null, activeGeneration: null,
    previousShutdownClean: true, reclaimedBytesOnStartup: 0
  });
  check("a genuinely broken host is still unavailable", broken.capability === "unavailable");
}

for (const dir of cleanup) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* disposable */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
