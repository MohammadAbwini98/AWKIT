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
  /** The pointer named a generation that is not on disk. Nothing was discarded this run. */
  activeGenerationMissing: boolean;
  /**
   * The active pointer could not be read or was damaged, so which generation is live is UNKNOWN.
   * Everything was preserved and no cleanup ran.
   */
  activeIdentityUnknown: boolean;
  /** An explicit recovery or rebuild is required before the index can be trusted or cleaned up. */
  recoveryRequired: boolean;
  outcomes: GenerationOutcome[];
  reclaimedBytes: number;
  dryRun: boolean;
}

/**
 * What reconciliation is allowed to assume about the active generation.
 *
 * Three states, because two are not enough. "There is no active generation" (first use) and "the
 * active generation cannot be determined" (damaged pointer) demand OPPOSITE behaviour — the first
 * permits cleanup, the second forbids it — and a `string | null` parameter cannot express the
 * difference. It previously collapsed them into `null`, which is how an unreadable pointer became
 * an instruction to delete the live index.
 */
export type ActiveGenerationIdentity =
  | { status: "known"; generation: string }
  /** No active generation exists yet. Cleanup may proceed. */
  | { status: "none" }
  /** Identity is undeterminable. NOTHING may be discarded, quarantined, or retention-trimmed. */
  | { status: "unknown" };

export interface ReconcileOptions {
  runtimeRoot: string;
  /**
   * The active identity, resolved from `active-generation.json` BEFORE calling this — use
   * `resolveActiveIdentity()` so the pointer-read → identity mapping stays in one place.
   *
   * Required, not optional, and deliberately not derived here from `metadata.json`. Metadata is
   * derived data read through a tolerant reader that returns defaults on any failure — including
   * `activeGeneration: null` and `cleanShutdown: false`. Deriving active identity from it meant an
   * unreadable metadata file made every generation look non-active on an unclean startup, and the
   * discard rule then deleted the very generation the authoritative pointer named. Making this a
   * required, three-state parameter forces every caller to resolve the pointer first AND to say
   * explicitly whether the answer is trustworthy.
   */
  activeIdentity: ActiveGenerationIdentity;
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

/**
 * Distinguishable outcomes of reading metadata.
 *
 * The tolerant `readMetadata()` below deliberately never throws, which makes it unsuitable for any
 * caller that must react to failure: a callsite wrapping it in try/catch has dead error handling.
 * Anything that needs to tell "absent" from "corrupt" from "unreadable" must use this instead.
 */
export type StrictMetadataRead =
  | { status: "ok"; metadata: SemanticIndexMetadata }
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "unreadable" };

export function readMetadataStrict(runtimeRoot: string): StrictMetadataRead {
  const layout = semanticIndexLayout(runtimeRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(layout.metadataFile, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { status: "missing" } : { status: "unreadable" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SemanticIndexMetadata>;
    return { status: "ok", metadata: { ...defaultSemanticIndexMetadata(), ...parsed } };
  } catch {
    return { status: "invalid" };
  }
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

/**
 * Mark the index as cleanly closed. Called only from an orderly shutdown.
 *
 * Pass `undefined` for `activeGeneration` when active identity is UNKNOWN (a damaged pointer):
 * overwriting the recorded value with `null` in that case would erase context a later recovery can
 * use, and would assert "there is no active generation" on the strength of a read that failed.
 */
export function markIndexClosed(runtimeRoot: string, activeGeneration: string | null | undefined): void {
  const metadata = readMetadata(runtimeRoot);
  writeMetadata(runtimeRoot, {
    ...metadata,
    activeGeneration: activeGeneration === undefined ? metadata.activeGeneration : activeGeneration,
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
  const { runtimeRoot, activeIdentity, quarantined = [], dryRun = false } = options;
  const layout = semanticIndexLayout(runtimeRoot);
  // Metadata contributes clean-shutdown status, timestamps and retention context ONLY. It never
  // decides which generation is active.
  const metadata = readMetadata(runtimeRoot);
  const quarantineSet = new Set(quarantined);

  const authoritativeActiveGeneration = activeIdentity.status === "known" ? activeIdentity.generation : null;
  const activeIdentityUnknown = activeIdentity.status === "unknown";

  const report: ReconciliationReport = {
    uncleanShutdown: !metadata.cleanShutdown,
    activeGeneration: authoritativeActiveGeneration,
    activeGenerationMissing: false,
    activeIdentityUnknown,
    recoveryRequired: activeIdentityUnknown,
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

  // ── active identity unknown ──
  // The pointer exists but could not be read or is damaged, so ANY generation on disk might be the
  // live one. Every destructive action is therefore off the table — including quarantine, which
  // renames a directory and would break the index if it moved the active generation. Preserve
  // everything, reclaim nothing, and require an explicit recovery or rebuild to resolve it.
  //
  // This check precedes the missing-active check deliberately: "the pointer names a generation that
  // is absent" is a statement we can only make when the pointer was actually readable.
  if (activeIdentityUnknown) {
    for (const name of generations) {
      report.outcomes.push({
        name,
        disposition: "retained",
        reason: "preserved: the active pointer could not be read, so active identity is unknown and nothing is discarded",
        bytes: directorySize(path.join(layout.generations, name))
      });
    }
    return report;
  }

  // A pointer naming a generation that is not on disk is a recovery situation, not a licence to
  // clean up. Silently discarding "orphans" here could destroy the candidates a rebuild would use,
  // and silently promoting a different generation would swap the index out from under the pointer.
  // Report it, change nothing, and let an explicit recovery operation resolve it.
  if (authoritativeActiveGeneration !== null && !generations.includes(authoritativeActiveGeneration)) {
    report.activeGenerationMissing = true;
    report.recoveryRequired = true;
    for (const name of generations) {
      report.outcomes.push({
        name,
        disposition: "retained",
        reason: "preserved: the active pointer names a missing generation, so nothing is discarded this startup",
        bytes: directorySize(path.join(layout.generations, name))
      });
    }
    return report;
  }

  let retainedSoFar = 0;

  for (const name of generations) {
    const dir = path.join(layout.generations, name);
    const bytes = directorySize(dir);

    // ── the absolute rule ──
    // A valid pointer naming an existing generation protects it unconditionally: it is never
    // deleted, quarantined, renamed, or treated as an orphan, whatever state metadata is in. This
    // check comes before the quarantine check for exactly that reason.
    if (name === authoritativeActiveGeneration) {
      report.outcomes.push({ name, disposition: "active", reason: "named by the authoritative active pointer", bytes });
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

  // Reconciliation deliberately does NOT touch the active pointer.
  //
  // An earlier revision cleared `active-generation.json` here whenever `metadata.activeGeneration`
  // named a missing directory — deciding from derived data, and destroying the authoritative record
  // in the process. Metadata is realigned by `repairMetadataFromPointer()` at startup, and a pointer
  // naming a missing generation is reported via `activeGenerationMissing` for an explicit,
  // separately tested recovery operation to resolve.

  return report;
}
