/**
 * Reconciles the semantic index on startup (plan §12, §14.4).
 *
 * Phase 0D produced the concrete evidence for this: abruptly-killed runs left five orphaned
 * generations totalling 110.8 MB under `semantic-index/generations/`, with nothing to clean them
 * up. The index is derived and rebuildable, so an orphan is waste rather than data loss — but
 * unbounded waste on a user's disk is still a defect.
 *
 * Rules:
 *  - the ACTIVE generation is never touched;
 *  - a generation that took the host down is QUARANTINED, not deleted, so it can be inspected;
 *  - after an unclean shutdown every other generation is discarded, because a generation that was
 *    open during a crash may be mid-write and is cheaper to rebuild than to trust;
 *  - after a clean shutdown, non-active generations are kept up to a small retention count so a
 *    rollback target survives, and older ones are discarded;
 *  - anything that is not a well-formed generation directory is left strictly alone.
 *
 * Framework-agnostic and side-effect-explicit: `dryRun` produces the full plan without touching
 * disk, which is what the verifier exercises.
 */

import fs from "node:fs";
import path from "node:path";

import {
  ACTIVE_GENERATION_FILE,
  defaultSemanticIndexMetadata,
  generationSequence,
  isGenerationName,
  semanticIndexLayout,
  type SemanticIndexMetadata
} from "./SemanticGenerationLayout";

/** How many non-active generations to keep after a clean shutdown, as rollback targets. */
export const GENERATION_RETENTION_COUNT = 1;

export type GenerationDisposition = "active" | "retained" | "discarded" | "quarantined" | "ignored";

export interface GenerationOutcome {
  name: string;
  disposition: GenerationDisposition;
  reason: string;
  bytes: number;
}

export interface ReconciliationReport {
  uncleanShutdown: boolean;
  activeGeneration: string | null;
  outcomes: GenerationOutcome[];
  reclaimedBytes: number;
  dryRun: boolean;
}

export interface ReconcileOptions {
  runtimeRoot: string;
  /** Generations known to have crashed the host; quarantined rather than deleted. */
  quarantined?: readonly string[];
  /** Plan only — do not modify disk. */
  dryRun?: boolean;
}

function directorySize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += directorySize(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    } catch {
      /* a file vanishing mid-scan is not a reconciliation failure */
    }
  }
  return total;
}

/** Read index metadata, tolerating absence or corruption — neither is fatal for an optional store. */
export function readMetadata(runtimeRoot: string): SemanticIndexMetadata {
  const layout = semanticIndexLayout(runtimeRoot);
  try {
    const parsed = JSON.parse(fs.readFileSync(layout.metadataFile, "utf8")) as Partial<SemanticIndexMetadata>;
    return { ...defaultSemanticIndexMetadata(), ...parsed };
  } catch {
    // A missing or unreadable metadata file is indistinguishable from a crash before the first
    // orderly shutdown, so it is treated as unclean rather than assumed safe.
    return { ...defaultSemanticIndexMetadata(), cleanShutdown: false };
  }
}

/** Atomically persist metadata (write-temp-then-rename), so a crash cannot truncate it. */
export function writeMetadata(runtimeRoot: string, metadata: SemanticIndexMetadata): void {
  const layout = semanticIndexLayout(runtimeRoot);
  fs.mkdirSync(layout.root, { recursive: true });
  const temp = `${layout.metadataFile}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  fs.renameSync(temp, layout.metadataFile);
}

/** Mark the index as open. Called before the first host operation of the session. */
export function markIndexOpen(runtimeRoot: string): void {
  const metadata = readMetadata(runtimeRoot);
  writeMetadata(runtimeRoot, { ...metadata, cleanShutdown: false });
}

/** Mark the index as cleanly closed. Called only from an orderly shutdown. */
export function markIndexClosed(runtimeRoot: string, activeGeneration: string | null): void {
  const metadata = readMetadata(runtimeRoot);
  writeMetadata(runtimeRoot, {
    ...metadata,
    activeGeneration,
    cleanShutdown: true,
    lastSuccessfulUpdateAt: new Date().toISOString()
  });
}

/**
 * Inspect `generations/` and decide what to keep, discard, or quarantine.
 *
 * Never throws: reconciliation is best-effort housekeeping for an optional subsystem, and a failure
 * here must not affect application startup.
 */
export function reconcileGenerations(options: ReconcileOptions): ReconciliationReport {
  const { runtimeRoot, quarantined = [], dryRun = false } = options;
  const layout = semanticIndexLayout(runtimeRoot);
  const metadata = readMetadata(runtimeRoot);
  const quarantineSet = new Set(quarantined);

  const report: ReconciliationReport = {
    uncleanShutdown: !metadata.cleanShutdown,
    activeGeneration: metadata.activeGeneration,
    outcomes: [],
    reclaimedBytes: 0,
    dryRun
  };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(layout.generations, { withFileTypes: true });
  } catch {
    return report; // no generations directory yet — nothing to reconcile
  }

  // Newest first, so retention keeps the most recent rollback target.
  const generations = entries
    .filter((e) => e.isDirectory() && isGenerationName(e.name))
    .map((e) => e.name)
    .sort((a, b) => (generationSequence(b) ?? 0) - (generationSequence(a) ?? 0));

  for (const entry of entries) {
    if (!entry.isDirectory() || !isGenerationName(entry.name)) {
      report.outcomes.push({ name: entry.name, disposition: "ignored", reason: "not a generation directory", bytes: 0 });
    }
  }

  let retainedSoFar = 0;

  for (const name of generations) {
    const dir = path.join(layout.generations, name);
    const bytes = directorySize(dir);

    if (name === metadata.activeGeneration) {
      report.outcomes.push({ name, disposition: "active", reason: "active generation", bytes });
      continue;
    }

    if (quarantineSet.has(name)) {
      report.outcomes.push({ name, disposition: "quarantined", reason: "crashed the host; preserved for inspection", bytes });
      if (!dryRun) {
        try {
          fs.mkdirSync(layout.quarantine, { recursive: true });
          fs.renameSync(dir, path.join(layout.quarantine, `${name}-${Date.now()}`));
        } catch {
          /* leaving it in place is safer than deleting evidence */
        }
      }
      continue;
    }

    // After an unclean shutdown nothing non-active is trusted: it may be mid-write, and the index
    // is rebuildable from authoritative stores.
    const discard = report.uncleanShutdown || retainedSoFar >= GENERATION_RETENTION_COUNT;

    if (!discard) {
      retainedSoFar += 1;
      report.outcomes.push({ name, disposition: "retained", reason: "rollback target", bytes });
      continue;
    }

    report.outcomes.push({
      name,
      disposition: "discarded",
      reason: report.uncleanShutdown ? "orphaned by an unclean shutdown" : "beyond the retention window",
      bytes
    });
    report.reclaimedBytes += bytes;
    if (!dryRun) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* a locked directory is retried on the next startup */
      }
    }
  }

  // The stale active-generation pointer is cleared when it no longer names a real directory, so the
  // next open starts from a known state instead of chasing a missing path.
  if (metadata.activeGeneration && !generations.includes(metadata.activeGeneration) && !dryRun) {
    try {
      writeMetadata(runtimeRoot, { ...metadata, activeGeneration: null, cleanShutdown: metadata.cleanShutdown });
      fs.rmSync(path.join(layout.root, ACTIVE_GENERATION_FILE), { force: true });
    } catch {
      /* best effort */
    }
  }

  return report;
}
