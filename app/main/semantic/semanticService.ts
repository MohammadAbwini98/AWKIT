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
import path, { join } from "node:path";
import fs from "node:fs";

import { getRuntimeDataRoot, getRuntimePaths } from "../appPaths";
import { getUiSettings } from "../uiSettings";
import { executionEngine, type RunCompletionEvent } from "@src/runner/ExecutionEngine";
import { FileLocatorRecoveryStore } from "@src/runner/LocatorRecoveryStore";
import { projectAndValidate, type ValidatedSemanticDocument } from "@src/semantic/SemanticPolicyValidator";

import { SEMANTIC_MAX_TOP_K, type SemanticSearchRequest } from "@src/semantic/contracts/SemanticDocument";
import type {
  LocatorSuggestionRequest,
  SemanticAdminResponse,
  SemanticSearchResponse,
  SemanticSettingsView,
  SemanticStatusView,
  SimilarFailureRequest
} from "@src/semantic/contracts/SemanticApi";

import { buildSemanticHealth, type SemanticHealth } from "@src/semantic/contracts/SemanticHealth";
import { semanticIndexLayout } from "@src/semantic/SemanticGenerationLayout";
import {
  markIndexClosed,
  markIndexOpen,
  reconcileGenerations,
  type ReconciliationReport
} from "@src/semantic/SemanticGenerationReconciler";
import { resolveActiveIdentity, repairMetadataFromPointer, type MetadataRepairResult } from "@src/semantic/SemanticGenerationManager";
import { SemanticIndexRuntime, type SemanticIndexRuntimeStatus } from "@src/semantic/SemanticIndexRuntime";
import type { RebuildReport } from "@src/semantic/SemanticRebuildOrchestrator";
import { createFlowProfileStore, createWorkflowProfileStore } from "../profileStores";
import {
  createSemanticSnapshotProvider,
  locatorSemanticSource,
  runFailureSemanticSource,
  runOutcome,
  runSummarySemanticSource,
  type SemanticSnapshotKind
} from "./semanticSnapshot";
import { ZvecUtilityHostManager } from "./ZvecUtilityHostManager";

let manager: ZvecUtilityHostManager | null = null;
let lastReconciliation: ReconciliationReport | null = null;
let lastMetadataRepair: MetadataRepairResult | null = null;
let indexRuntime: SemanticIndexRuntime | null = null;

/**
 * Register the live index runtime so staged shutdown can drain it.
 *
 * `getSemanticHostManager()` is the production registrar. This setter stays exported so a test or a
 * future alternate composition can substitute a runtime, and so `null` can be restored on dispose.
 *
 * A registered runtime is what makes the reported health real: `semanticHealth()` derives
 * `rebuildRequired` and `activeGenerationOpenFailed` from `indexRuntime?.status()`, so while nothing
 * was ever registered both read healthy unconditionally, and `disposeSemanticSubsystem` had nothing
 * to drain and therefore recorded every shutdown as clean.
 */
export function setSemanticIndexRuntime(runtime: SemanticIndexRuntime | null): void {
  indexRuntime = runtime;
}

export function getSemanticIndexRuntime(): SemanticIndexRuntime | null {
  return indexRuntime;
}

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
    lastMetadataRepair = repairMetadataFromPointer(runtimeRoot());
    // The pointer is authoritative and is resolved HERE, then handed to reconciliation explicitly.
    // Reconciliation must never derive active identity from metadata: metadata is read through a
    // tolerant reader that yields `activeGeneration: null` on any failure, which previously made an
    // unreadable metadata file delete the generation the pointer named.
    //
    // `resolveActiveIdentity` (not a raw pointer read) is what keeps a DAMAGED pointer from reading
    // as "no active generation": that collapse let an unreadable pointer authorise the same deletion
    // from one level up. It returns an explicit `unknown`, under which reconciliation discards nothing.
    lastReconciliation = reconcileGenerations({
      runtimeRoot: runtimeRoot(),
      activeIdentity: resolveActiveIdentity(runtimeRoot())
    });
    markIndexOpen(runtimeRoot());
    // Register the index runtime for this session, AFTER reconciliation has repaired the pointer it
    // will later open. This spawns nothing: both `ZvecUtilityHostManager` and `SemanticIndexRuntime`
    // have inert constructors, and the host is not contacted until `ensureSemanticIndexOpen()`. It
    // must happen here rather than being left to the first semantic caller, because until a runtime
    // is registered `semanticHealth()` reports healthy unconditionally and `disposeSemanticSubsystem`
    // has nothing to drain, so every shutdown records as clean regardless of what was in flight.
    getSemanticHostManager();
    return lastReconciliation;
  } catch {
    // Housekeeping must never take the application down.
    return null;
  }
}

/**
 * Lazily construct the manager and register the index runtime that rides on it. Returns null when
 * the feature is not present in this build — the one case where a null runtime is correct.
 *
 * Constructing the runtime touches nothing: it builds a queue and an orchestrator over a store that
 * refuses every operation until `open()` runs. Plan §16.1 requires normal startup to stay
 * independent of Zvec, so neither this nor the snapshot provider contacts the host; the host starts
 * on the first approved semantic operation, which is the first `ensureSemanticIndexOpen()` call.
 *
 * `ZvecUtilityHostManager` structurally satisfies `ZvecHostTransport` (`call(request, timeoutMs)`),
 * so it is passed directly rather than through an adapter.
 */
export function getSemanticHostManager(): ZvecUtilityHostManager | null {
  if (manager) return manager;
  const hostPath = resolveHostPath();
  if (!hostPath) return null;
  manager = new ZvecUtilityHostManager({ hostPath, runtimeRoot: runtimeRoot() });
  try {
    setSemanticIndexRuntime(
      new SemanticIndexRuntime({
        runtimeRoot: runtimeRoot(),
        transport: manager,
        // Resolved per rebuild, not captured here: the flow and workflow folders are configurable in
        // Settings, and a store pinned at startup would keep indexing the previous location.
        snapshot: createSemanticSnapshotProvider(
          () => ({
            flows: createFlowProfileStore(),
            workflows: createWorkflowProfileStore(),
            // Bounded, most-recent-first. `queryRunHistory` clamps a page to 500 rows, which is the
            // same ceiling the snapshot wants, so the clamp is the contract rather than a surprise.
            runs: {
              list: async (limit) =>
                executionEngine.getTelemetryRunHistory({}, { limit, offset: 0 }).rows
            },
            // Must match `ExecutionEngine`'s own `join(dirs.root, "locator-recovery")`, where
            // `dirs.root` is `getRuntimePaths().root` (see execution.ipc `resolveStorageDirs`).
            // Pointing elsewhere would silently index an empty folder.
            locators: new FileLocatorRecoveryStore(join(getRuntimePaths().root, "locator-recovery"))
          }),
          logSemantic
        ),
        logger: logSemantic
      })
    );
  } catch {
    // The host manager is still usable without an index runtime, and semantic capability is
    // optional. Degrade to the previous behaviour rather than failing the caller.
    setSemanticIndexRuntime(null);
  }
  return manager;
}

function logSemantic(level: "info" | "warn" | "error", message: string): void {
  const line = `[semantic] ${message}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Open the index onto the generation the active pointer names. Idempotent and non-throwing.
 *
 * This is the first approved semantic operation: it is what actually starts the host, so it must be
 * called by a semantic entry point rather than by startup.
 */
export async function ensureSemanticIndexOpen(): Promise<SemanticIndexRuntimeStatus | null> {
  getSemanticHostManager();
  const runtime = indexRuntime;
  if (!runtime) return null;
  const current = runtime.status();
  // Already open on a generation — reopening would close and rebuild a working store for nothing.
  if (current.activeGeneration && current.block === null) return current;
  try {
    return await runtime.open();
  } catch {
    return runtime.status();
  }
}

/**
 * Production entry point for a full rebuild: build a candidate generation from the authoritative
 * flow and workflow snapshot, validate it, and activate it by pointer swap.
 *
 * Returns null when the feature is not in this build. Never throws — a refused rebuild is reported
 * in the `RebuildReport`, and a refusal allocates nothing and leaves the active pointer untouched.
 *
 * An unreadable snapshot is already the orchestrator's `SNAPSHOT_FAILED`, so the catch below is for
 * something outside that taxonomy. It deliberately leaves `refusal` unset rather than borrowing a
 * category it did not observe: a fabricated refusal reads as a diagnosed failure.
 */
export async function rebuildSemanticIndex(): Promise<RebuildReport | null> {
  await ensureSemanticIndexOpen();
  const runtime = indexRuntime;
  if (!runtime) return null;
  try {
    return await runtime.rebuild();
  } catch (error) {
    logSemantic("error", `Semantic rebuild threw outside the refusal taxonomy: ${describeError(error)}`);
    return {
      ok: false,
      reason: describeError(error),
      populated: 0,
      replayed: 0,
      watermark: 0,
      activated: false,
      metadataRepairRequired: false
    };
  }
}

/** Never leaks a vendor message or a path — only a stable shape, as the semantic layer does. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.name : "UNKNOWN_ERROR";
}

/**
 * Health view for status surfaces.
 *
 * `includePaths` defaults to FALSE: the index path is a filesystem location and only an
 * administrator surface may see it (plan §21.1). Callers must opt in explicitly.
 */
export function semanticHealth(options: { includePaths?: boolean; enabledBySetting?: boolean } = {}): SemanticHealth {
  const host = manager?.status() ?? null;
  // Read once: `status()` is a snapshot, and sampling it twice could report a block alongside a
  // rebuildRequired flag from a different instant.
  const index = indexRuntime?.status() ?? null;
  return buildSemanticHealth({
    included: Boolean(resolveHostPath()),
    // Callers that hold the user's setting pass it (see `semanticStatusView`). The `?? true` default
    // is for internal callers that only want host/index state — it must not be read as "the feature
    // is on", which is why the settings-aware path resolves it explicitly.
    enabledBySetting: options.enabledBySetting ?? true,
    hostState: host?.state ?? "stopped",
    circuitOpen: host?.circuitOpen ?? false,
    unexpectedExits: host?.unexpectedExits ?? 0,
    lastReasonCode: host?.lastReason ?? null,
    activeGeneration: lastReconciliation?.activeGeneration ?? null,
    previousShutdownClean: lastReconciliation ? !lastReconciliation.uncleanShutdown : true,
    reclaimedBytesOnStartup: lastReconciliation?.reclaimedBytes ?? 0,
    activePointerReadFailed: lastReconciliation?.activeIdentityUnknown ?? false,
    // A rebuild whose pointer COMMITTED but whose generation would not open. Distinct from
    // REBUILD_REQUIRED on purpose: telling the user to rebuild would invite them to re-run the very
    // operation that just committed.
    activeGenerationOpenFailed: index?.block === "ACTIVE_GENERATION_OPEN_FAILED",
    rebuildRequired: index?.rebuildRequired ?? false,
    metadataRepairFailed: lastMetadataRepair?.status === "failed",
    indexPath: semanticIndexLayout(runtimeRoot()).root,
    includePaths: options.includePaths ?? false
  });
}

/** Current semantic settings, hydrated with defaults. */
export async function semanticSettings(): Promise<SemanticSettingsView> {
  const settings = await getUiSettings();
  return {
    enabled: settings.semantic.enabled,
    defaultTopK: settings.semantic.defaultTopK,
    maxTopK: SEMANTIC_MAX_TOP_K,
    autoIndex: settings.semantic.autoIndex
  };
}

/**
 * Status for the renderer: health plus a flattened index view.
 *
 * Reads the user's `semantic.enabled` setting rather than assuming true, so a disabled subsystem
 * reports as disabled instead of as a host that merely happens not to be running.
 */
export async function semanticStatusView(options: { includePaths?: boolean } = {}): Promise<SemanticStatusView> {
  const settings = await semanticSettings();
  const index = indexRuntime?.status() ?? null;
  return {
    health: semanticHealth({ includePaths: options.includePaths, enabledBySetting: settings.enabled }),
    index: {
      activeGeneration: index?.activeGeneration ?? null,
      writable: index?.writable ?? false,
      rebuildRequired: index?.rebuildRequired ?? false,
      pendingMutations: index?.pending ?? 0,
      reconciliationRequired: index?.reconciliationRequired ?? false,
      lastIndexedAt: index?.lastIndexedAt ?? null,
      lastIndexError: index?.lastIndexError ?? null
    }
  };
}

/**
 * Run a search against the ACTIVE generation.
 *
 * The request is already sanitized by `sanitizeSearchRequest` at the IPC boundary; this adds the
 * availability checks that only the main process can make. Returns a stable reason code — a native
 * or vendor error never crosses back (plan §11.3).
 */
export async function searchSemanticIndex(request: SemanticSearchRequest): Promise<SemanticSearchResponse> {
  const settings = await semanticSettings();
  if (!settings.enabled) {
    return { code: "NOT_AVAILABLE", hits: [], degraded: false, message: "The semantic index is turned off in Settings." };
  }
  const status = await ensureSemanticIndexOpen();
  if (!status) {
    return { code: "NOT_AVAILABLE", hits: [], degraded: false, message: "The semantic index is not included in this build." };
  }
  const store = indexRuntime?.store ?? null;
  if (!store || !status.writable) {
    // Not an error: a blocked or never-built index has nothing to answer with, and saying "search
    // failed" would send the user looking for a fault in their query.
    return { code: "INDEX_NOT_READY", hits: [], degraded: false, message: "The semantic index is not ready yet." };
  }
  try {
    const result = await store.search(request);
    return { code: "OK", hits: [...result.hits], degraded: result.degraded };
  } catch (error) {
    logSemantic("warn", `Semantic search failed: ${describeError(error)}`);
    return { code: "SEARCH_FAILED", hits: [], degraded: false, message: "The search could not be completed." };
  }
}

/**
 * Failures resembling a given one (plan §11.1).
 *
 * Implemented as a scoped search over `run-failure` documents rather than a separate retrieval path,
 * so it inherits the identical sanitization, ranking and explainability. The requesting run is
 * excluded from its own results — returning the query as its own best match is noise, not similarity.
 */
export async function similarSemanticFailures(request: SimilarFailureRequest): Promise<SemanticSearchResponse> {
  const response = await searchSemanticIndex({
    text: request.text,
    kinds: ["run-failure"],
    topK: request.topK,
    ...(request.workflowId ? { workflowId: request.workflowId } : {}),
    ...(request.errorCategory ? { errorCategory: request.errorCategory } : {})
  });
  if (response.code !== "OK" || !request.excludeRunId) return response;
  return { ...response, hits: response.hits.filter((hit) => hit.entityId !== request.excludeRunId) };
}

/**
 * Locator strategies that have worked before for this workflow/flow (plan §11.1).
 *
 * Returns `locator-success` documents, which record WHICH STRATEGY resolved an element and never the
 * selector or the matched text — so a suggestion can say "role worked here before" without ever
 * surfacing the account number that element displayed.
 */
export async function suggestSemanticLocators(request: LocatorSuggestionRequest): Promise<SemanticSearchResponse> {
  return searchSemanticIndex({
    // The strategy vocabulary is the searchable content for this kind; an empty query would match
    // nothing, so the caller's node type is used as the text when it supplies no other hint.
    text: request.text ?? request.nodeType ?? "locator",
    kinds: ["locator-success"],
    topK: request.topK,
    ...(request.workflowId ? { workflowId: request.workflowId } : {}),
    ...(request.flowId ? { flowId: request.flowId } : {}),
    ...(request.nodeType ? { nodeType: request.nodeType } : {})
  });
}

/**
 * Delete every document in the active generation (plan §9.4).
 *
 * Does NOT remove the generation or move the pointer — the index stays live and simply becomes
 * empty, so a later rebuild repopulates it in place. Permission-gated and re-auth-gated by the
 * caller; this function does not authorize.
 */
export async function clearSemanticIndex(): Promise<SemanticAdminResponse> {
  const status = await ensureSemanticIndexOpen();
  if (!status) {
    return { code: "NOT_AVAILABLE", ok: false, message: "The semantic index is not included in this build." };
  }
  const store = indexRuntime?.store ?? null;
  if (!store || !status.writable) {
    return { code: "INDEX_NOT_READY", ok: false, message: "The semantic index is not ready yet." };
  }
  try {
    await store.clear();
    logSemantic("info", "Semantic index cleared by an administrator.");
    return { code: "OK", ok: true };
  } catch (error) {
    logSemantic("error", `Semantic clear failed: ${describeError(error)}`);
    return { code: "CLEAR_FAILED", ok: false, message: "The index could not be cleared." };
  }
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
export async function disposeSemanticSubsystem(): Promise<{ graceful: boolean; elapsedMs: number; drained: boolean }> {
  const active = manager;
  const runtime = indexRuntime;
  manager = null;
  indexRuntime = null;
  try {
    // Drain BEFORE the host goes away. The runtime stops accepting mutations, then waits for the
    // in-flight drain or rebuild on its own wall-clock budget; closing the host underneath a rebuild
    // is how a candidate generation ends up half-written. `idle: false` means the budget elapsed with
    // work still in flight — reported, never waited out, because an application that cannot exit is a
    // worse failure than an index that reconciles on next start.
    let drained = true;
    if (runtime) {
      try {
        drained = (await runtime.shutdown()).idle;
      } catch {
        // Draining is best-effort; a failure here must not prevent the host from being stopped.
        drained = false;
      }
    }
    const result = active ? await active.dispose() : { graceful: true, elapsedMs: 0 };

    // Only an orderly close records cleanShutdown=true; a crash therefore leaves it false and the
    // next startup reconciles. When startup could not determine active identity, pass `undefined` so
    // the recorded generation is preserved rather than asserted to be absent.
    //
    // A shutdown that hit its deadline is NOT orderly: work was still in flight, so the session is
    // deliberately left marked unclean and startup reconciliation finishes the job. Marking it clean
    // because the process is exiting anyway is exactly how an interrupted write becomes invisible.
    if (drained) {
      markIndexClosed(
        runtimeRoot(),
        lastReconciliation?.activeIdentityUnknown ? undefined : (lastReconciliation?.activeGeneration ?? null)
      );
    }
    return { ...result, drained };
  } catch {
    return { graceful: false, elapsedMs: 0, drained: false };
  }
}

/**
 * Index a finalized run incrementally (plan §14), so search results are fresh without a rebuild.
 *
 * Wired to `ExecutionEngine.setRunCompletionObserver` in `registerExecutionIpc`. Four properties
 * matter more than the mechanics:
 *
 * 1. **It never throws.** The engine also guards the call, but a fault belongs to the layer that
 *    caused it — and §14.3 forbids an indexing failure reaching workflow execution. Both layers hold
 *    the line; neither relies on the other.
 * 2. **Nothing is lost when it fails or is switched off.** The run row is already in the durable
 *    store and the locator records are already on disk. Skipping the enqueue costs freshness, never
 *    data, which is what makes `autoIndex: false` a supported state rather than a degraded one.
 * 3. **It classifies with the same `runOutcome` the rebuild snapshot uses**, so a run earns exactly
 *    the same documents by either path.
 * 4. **It is fire-and-forget.** The engine calls it synchronously from run finalization, so the work
 *    is queued on a promise the caller does not await.
 */
export function indexCompletedRun(event: RunCompletionEvent): void {
  void (async () => {
    try {
      const settings = await getUiSettings();
      // Two independent switches: `enabled` decides whether semantic search exists at all,
      // `autoIndex` whether it stays fresh unasked. Either being off means no enqueue.
      if (!settings.semantic.enabled || !settings.semantic.autoIndex) return;

      const runtime = indexRuntime;
      if (!runtime) return;

      const documents: ValidatedSemanticDocument[] = [];
      const add = (kind: SemanticSnapshotKind, source: Record<string, unknown> | undefined): void => {
        if (!source) return;
        const result = projectAndValidate(kind, source);
        // A rejected document is dropped, not thrown. The policy validator is the authority on what
        // may be indexed; a run that fails it must not take the run's own reporting down with it.
        if (result.ok) documents.push(result.document);
      };

      add("run-summary", runSummarySemanticSource(event.run));
      if (runOutcome(event.run.status) === "failure") {
        add("run-failure", runFailureSemanticSource(event.run));
      }

      if (event.locatorScopeKeys.length > 0) {
        const store = new FileLocatorRecoveryStore(join(getRuntimePaths().root, "locator-recovery"));
        for (const scopeKey of event.locatorScopeKeys) {
          const record = await store.get(scopeKey).catch(() => undefined);
          if (record) add("locator-success", locatorSemanticSource(record));
        }
      }

      // `enqueue` answers `{accepted, block}` rather than throwing, so a blocked index (rebuilding,
      // or failed open) simply declines the work and the next rebuild picks it up.
      for (const document of documents) runtime.enqueue({ op: "upsert", document });
    } catch {
      /* freshness is best-effort; the records remain on disk for the next rebuild */
    }
  })();
}
