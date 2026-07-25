/**
 * Main-process owner of the optional semantic subsystem.
 *
 * Deliberately tiny in Phase 1A: it resolves the packaged host path, reconciles the index on
 * startup, and disposes the host on quit. There is no semantic IPC, preload API, renderer surface,
 * indexing, or embedding here — those are later phases.
 *
 * Every entry point is non-throwing. The semantic index is optional and rebuildable, so a failure
 * anywhere in this file must degrade semantic capability and nothing else: it may not block
 * startup, delay quit, or fail a workflow run.
 */

import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

import { getRuntimeDataRoot } from "../appPaths";

import { buildSemanticHealth, type SemanticHealth } from "@src/semantic/contracts/SemanticHealth";
import { semanticIndexLayout } from "@src/semantic/SemanticGenerationLayout";
import {
  markIndexClosed,
  markIndexOpen,
  reconcileGenerations,
  type ReconciliationReport
} from "@src/semantic/SemanticGenerationReconciler";
import { repairMetadataFromPointer } from "@src/semantic/SemanticGenerationManager";
import { ZvecUtilityHostManager } from "./ZvecUtilityHostManager";

let manager: ZvecUtilityHostManager | null = null;
let lastReconciliation: ReconciliationReport | null = null;

/**
 * Runtime root that owns all mutable semantic data. Never inside resources/ or app.asar.
 *
 * MUST be `getRuntimeDataRoot()` (`%LOCALAPPDATA%/SpecterStudio`), not `app.getPath("userData")`:
 * Electron's userData default is the ROAMING profile, so using it silently pointed the semantic
 * index at a different directory from every other AWKIT store. Caught by seeding an orphan
 * generation under %LOCALAPPDATA% and observing that startup reconciliation left it untouched.
 */
function runtimeRoot(): string {
  return getRuntimeDataRoot();
}

/**
 * Absolute path of the packaged raw host. In a packaged build it is an extraResources sibling of
 * app.asar; in development it is the repository copy. Returns null when absent, which simply means
 * the optional feature was not included in this build.
 */
export function resolveHostPath(): string | null {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, "native-hosts", "zvec", "zvec-host.cjs")
    : path.join(app.getAppPath(), "native-hosts", "zvec", "zvec-host.cjs");
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Startup housekeeping. Reclaims generations orphaned by an unclean shutdown and marks the index
 * open for this session.
 *
 * This does NOT start the host: plan §16.1 requires normal AWKIT startup to stay independent of
 * Zvec, so the host starts lazily on the first approved semantic operation.
 */
export function initializeSemanticSubsystem(): ReconciliationReport | null {
  try {
    if (!resolveHostPath()) return null; // feature not included in this build
    // The active pointer is authoritative and metadata is derived. If a previous activation wrote
    // the pointer but failed the metadata write, this brings them back into agreement before
    // anything reads metadata.
    repairMetadataFromPointer(runtimeRoot());
    lastReconciliation = reconcileGenerations({ runtimeRoot: runtimeRoot() });
    markIndexOpen(runtimeRoot());
    return lastReconciliation;
  } catch {
    // Housekeeping must never take the application down.
    return null;
  }
}

/** Lazily construct the manager. Returns null when the feature is not present in this build. */
export function getSemanticHostManager(): ZvecUtilityHostManager | null {
  if (manager) return manager;
  const hostPath = resolveHostPath();
  if (!hostPath) return null;
  manager = new ZvecUtilityHostManager({ hostPath, runtimeRoot: runtimeRoot() });
  return manager;
}

/**
 * Health view for status surfaces.
 *
 * `includePaths` defaults to FALSE: the index path is a filesystem location and only an
 * administrator surface may see it (plan §21.1). Callers must opt in explicitly.
 */
export function semanticHealth(options: { includePaths?: boolean; enabledBySetting?: boolean } = {}): SemanticHealth {
  const host = manager?.status() ?? null;
  return buildSemanticHealth({
    included: Boolean(resolveHostPath()),
    // Phase 1A has no semantic settings surface yet; treated as enabled so the reported reason
    // reflects the real host state rather than a setting that does not exist.
    enabledBySetting: options.enabledBySetting ?? true,
    hostState: host?.state ?? "stopped",
    circuitOpen: host?.circuitOpen ?? false,
    unexpectedExits: host?.unexpectedExits ?? 0,
    lastReasonCode: host?.lastReason ?? null,
    activeGeneration: lastReconciliation?.activeGeneration ?? null,
    previousShutdownClean: lastReconciliation ? !lastReconciliation.uncleanShutdown : true,
    reclaimedBytesOnStartup: lastReconciliation?.reclaimedBytes ?? 0,
    indexPath: semanticIndexLayout(runtimeRoot()).root,
    includePaths: options.includePaths ?? false
  });
}

/**
 * Stage 1 of the staged shutdown (plan §12): close the semantic host on its OWN bounded budget,
 * before the existing settings/Oracle/security stage.
 *
 * Phase 0D measured graceful shutdown at p50 0.592 ms / p99 0.631 ms and collection close at p50
 * 11.141 ms (n=15), so this stage is normally imperceptible. It is kept separate anyway because
 * those figures come from a 1,200-document corpus with no production write queue, and because an
 * unbounded native close must never eat into the existing 2,000 ms quit budget.
 *
 * Never rejects.
 */
export async function disposeSemanticSubsystem(): Promise<{ graceful: boolean; elapsedMs: number }> {
  const active = manager;
  manager = null;
  try {
    const result = active ? await active.dispose() : { graceful: true, elapsedMs: 0 };
    // Only an orderly close records cleanShutdown=true; a crash therefore leaves it false and the
    // next startup reconciles.
    markIndexClosed(runtimeRoot(), lastReconciliation?.activeGeneration ?? null);
    return result;
  } catch {
    return { graceful: false, elapsedMs: 0 };
  }
}
