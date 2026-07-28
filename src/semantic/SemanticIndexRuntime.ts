/**
 * The production binding between the rebuild orchestrator and the real generation runtime.
 *
 * Everything below this file was already verified in isolation: the orchestrator against in-memory
 * stores and a lifecycle stub, the store against a real utility host, the generation manager against
 * a real filesystem. This is the layer that makes them one system — it owns the ACTIVE store, the
 * mutation queue, and the transition between generations.
 *
 * ## The rule that shapes this file
 *
 * **The pointer swap is the commit point, and it is irreversible.** From the instant
 * `activateGeneration` writes the pointer, the new generation is authoritative — a restart will open
 * it, and nothing else. So when the step AFTER activation fails (the new generation will not open, or
 * the queue cannot be retargeted onto it), the recovery must never:
 *
 *   - revert the pointer, which would strand every document the rebuild just wrote; or
 *   - resume writing to the previous generation, which forks the index into two divergent histories,
 *     one of which becomes unreachable at the next restart.
 *
 * Instead writes STOP, the pending queue is preserved, a bounded reopen is attempted, and the state is
 * reported as `ACTIVE_GENERATION_OPEN_FAILED`. The enforcement is not a flag anyone has to remember to
 * check: the queue is retargeted onto a store that REFUSES every write, so a stray `drain()` cannot
 * reach the superseded generation even by mistake.
 *
 * Framework-agnostic on purpose: the host transport is injected, so this whole layer is drivable from
 * a verifier without Electron, exactly as `ZvecSemanticStore` is.
 */

import path from "node:path";

import { semanticIndexLayout } from "./SemanticGenerationLayout";
import {
  readActivePointerStrict,
  rebuildIntoNewGeneration,
  type GenerationValidation
} from "./SemanticGenerationManager";
import type { ValidatedSemanticDocument } from "./SemanticPolicyValidator";
import { SemanticMutationQueue, type SemanticMutation } from "./SemanticMutationQueue";
import { SemanticRebuildOrchestrator, type RebuildReport } from "./SemanticRebuildOrchestrator";
import type { SemanticSearchRequest, SemanticSearchResult } from "./contracts/SemanticDocument";
import {
  SemanticStoreError,
  type SemanticStore,
  type SemanticStoreStats,
  type SemanticUpsertResult
} from "./SemanticStore";
import { ZvecSemanticStore, ZVEC_TIMEOUTS, type ZvecHostTransport } from "./ZvecSemanticStore";

/** Why the runtime is not accepting writes. Null when it is. */
export type SemanticRuntimeBlock =
  /** No active generation exists yet — the index has never been built. */
  | "NO_ACTIVE_GENERATION"
  /** The pointer could not be read or is damaged; active identity is unknown. */
  | "ACTIVE_POINTER_READ_FAILED"
  /** A rebuild activated but its generation could not be opened/retargeted. */
  | "ACTIVE_GENERATION_OPEN_FAILED";

export interface SemanticIndexRuntimeStatus {
  activeGeneration: string | null;
  /** False whenever `block` is non-null. */
  writable: boolean;
  block: SemanticRuntimeBlock | null;
  rebuildRequired: boolean;
  /** Mutations still queued. Preserved across a blocked state — never discarded. */
  pending: number;
  /** True once a post-activation failure requires startup reconciliation to finish the job. */
  reconciliationRequired: boolean;
  /** ISO time of the last drain that wrote something with no failures; null if none yet. */
  lastIndexedAt: string | null;
  /** Safe sentence for the last indexing failure, cleared by the next clean drain. */
  lastIndexError: string | null;
}

export interface SemanticIndexRuntimeOptions {
  runtimeRoot: string;
  transport: ZvecHostTransport;
  /** Read every document that should exist, from authoritative sources. Used by rebuild. */
  snapshot: () => Promise<readonly ValidatedSemanticDocument[]>;
  /** Bounded reopen attempts after a post-activation open failure. Default 3. */
  reopenAttempts?: number;
  /** Delay between reopen attempts. Default 250 ms. */
  reopenDelayMs?: number;
  /** Wall-clock budget for shutdown quiescence. Default 5000 ms. */
  shutdownDeadlineMs?: number;
  /** Max pending mutations before overflow handling engages. Passed through to the queue. */
  maxPending?: number;
  /** Max adjacent mutations per host write. Passed through to the queue. */
  batchSize?: number;
  /** Retries for classified-safe failures. Ambiguous mutations are never retried. */
  maxRetries?: number;
  /** Max delta-journal entries before a rebuild refuses to activate. Passed through to the queue. */
  maxRebuildDelta?: number;
  logger?: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * A store that refuses every operation.
 *
 * This is the enforcement behind "never resume writing to the previous generation after the pointer
 * committed". Retargeting the queue onto THIS makes the guarantee structural: correctness no longer
 * depends on every future caller remembering to consult a boolean before draining.
 *
 * Reads refuse too. A read served from the superseded generation would be answered from an index the
 * pointer no longer names, which is precisely the stale answer that looks authoritative.
 */
class RefusingSemanticStore implements SemanticStore {
  readonly name = "refusing";
  readonly capabilities = { entityOperations: false, persistence: false, vectorSearch: false } as const;

  constructor(private readonly code: SemanticRuntimeBlock) {}

  private refuse(): never {
    throw new SemanticStoreError("BACKEND_UNAVAILABLE", this.code);
  }

  async open(): Promise<void> {
    this.refuse();
  }
  async close(): Promise<void> {
    /* Closing a store that holds nothing is a no-op, never an error: shutdown must not fail here. */
  }
  async upsert(): Promise<SemanticUpsertResult> {
    this.refuse();
  }
  async delete(): Promise<number> {
    this.refuse();
  }
  async deleteByEntity(): Promise<number> {
    this.refuse();
  }
  async get(): Promise<ValidatedSemanticDocument | null> {
    this.refuse();
  }
  async search(_request: SemanticSearchRequest): Promise<SemanticSearchResult> {
    this.refuse();
  }
  async stats(): Promise<SemanticStoreStats> {
    this.refuse();
  }
  async clear(): Promise<void> {
    this.refuse();
  }
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SemanticIndexRuntime {
  private active: { store: SemanticStore; generation: string } | null = null;
  private block: SemanticRuntimeBlock | null = "NO_ACTIVE_GENERATION";
  private reconciliationRequired = false;
  private readonly queue: SemanticMutationQueue;
  private readonly orchestrator: SemanticRebuildOrchestrator;

  constructor(private readonly options: SemanticIndexRuntimeOptions) {
    // Constructed against a refusing store rather than a null one: the queue must be usable (and
    // safely refusing) from the moment this object exists, including before `open()` has run.
    this.queue = new SemanticMutationQueue({
      store: new RefusingSemanticStore("NO_ACTIVE_GENERATION"),
      maxPending: options.maxPending,
      batchSize: options.batchSize,
      maxRetries: options.maxRetries,
      maxRebuildDelta: options.maxRebuildDelta
    });
    this.orchestrator = new SemanticRebuildOrchestrator({
      queue: this.queue,
      snapshot: options.snapshot,
      rebuildGeneration: (hooks) => this.rebuildGeneration(hooks),
      openCandidate: async (generation, generationPath) => {
        const store = this.newStore(generation, generationPath);
        await store.open();
        return { store, close: () => store.close() };
      },
      retarget: (generation, generationPath) => this.retarget(generation, generationPath),
      logger: options.logger
    });
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.options.logger?.(level, message);
  }

  private newStore(generation: string, generationPath: string): SemanticStore {
    return new ZvecSemanticStore({ transport: this.options.transport, generation, generationPath });
  }

  private generationPath(generation: string): string {
    return path.join(semanticIndexLayout(this.options.runtimeRoot).generations, generation);
  }

  /**
   * Open the generation the POINTER names — never the newest on disk, never one remembered from a
   * previous run. The pointer is authoritative; anything else is a guess that can disagree with it.
   */
  async open(): Promise<SemanticIndexRuntimeStatus> {
    const read = readActivePointerStrict(this.options.runtimeRoot);
    if (read.status === "invalid" || read.status === "unreadable") {
      // Deliberately does NOT fall back to "no active generation": that collapse is what previously
      // authorised deleting a live index. Unknown identity means stop and require recovery.
      this.enterBlockedState("ACTIVE_POINTER_READ_FAILED");
      return this.status();
    }
    if (read.status === "missing") {
      this.enterBlockedState("NO_ACTIVE_GENERATION");
      return this.status();
    }

    const generation = read.pointer.activeGeneration;
    try {
      const store = this.newStore(generation, this.generationPath(generation));
      await store.open();
      this.active = { store, generation };
      this.block = null;
      this.queue.retargetStore(store);
      this.log("info", `Semantic index opened generation ${generation}.`);
    } catch (error) {
      this.enterBlockedState("ACTIVE_GENERATION_OPEN_FAILED");
      this.reconciliationRequired = true;
      this.log("error", `Semantic index could not open the active generation: ${describe(error)}`);
    }
    return this.status();
  }

  /**
   * Stop writes and point the queue at a refusing store.
   *
   * The pending queue is NOT cleared. Those mutations are the user's most recent changes; a blocked
   * runtime is a state to recover from, not a reason to discard them.
   */
  private enterBlockedState(block: SemanticRuntimeBlock): void {
    this.block = block;
    // Retarget can throw if a drain is in flight. Blocking is a safety action and must not be the
    // thing that fails, so the refusal is best-effort and the flag still stands.
    try {
      this.queue.retargetStore(new RefusingSemanticStore(block));
    } catch {
      /* a drain is finishing against the old store; the block still applies to everything after it */
    }
  }

  /** Adapter from the orchestrator's hook shape to the real generation lifecycle. */
  private async rebuildGeneration(hooks: {
    populate: (generation: string, generationPath: string) => Promise<void>;
    validate: (generation: string, generationPath: string) => Promise<GenerationValidation>;
  }): Promise<{ generation: string; activated: boolean; status: string; reason?: string; metadataRepairRequired?: boolean }> {
    const outcome = await rebuildIntoNewGeneration({
      runtimeRoot: this.options.runtimeRoot,
      populate: hooks.populate,
      validate: hooks.validate
    });
    return {
      generation: outcome.generation,
      activated: outcome.activated,
      status: outcome.status,
      reason: outcome.reason,
      // The manager reports this as a distinct ACTIVATED status; the orchestrator wants a flag. The
      // index IS live either way — only derived metadata is behind.
      metadataRepairRequired: outcome.status === "ACTIVATED_METADATA_REPAIR_REQUIRED"
    };
  }

  /**
   * Swap the live store onto the newly-activated generation.
   *
   * Runs AFTER the pointer has committed, so failure here is recovery, never reversal. On failure the
   * runtime blocks, the queue is pointed at a refusing store, and a bounded reopen is attempted before
   * the error is rethrown for the orchestrator to report.
   */
  private async retarget(generation: string, generationPath: string): Promise<void> {
    const previous = this.active;
    try {
      const next = this.newStore(generation, generationPath);
      await next.open();
      this.active = { store: next, generation };
      this.block = null;
      this.queue.retargetStore(next);

      // Closed only after the swap succeeded. Closing first would leave a window with no readable
      // store at all if the open then failed.
      if (previous) {
        try {
          await previous.store.close();
        } catch (error) {
          // A leaked handle on a superseded generation is reclaimed by startup reconciliation. It must
          // not turn a successful activation into a reported failure.
          this.log("warn", `Superseded generation did not close cleanly: ${describe(error)}`);
        }
      }
      return;
    } catch (error) {
      this.enterBlockedState("ACTIVE_GENERATION_OPEN_FAILED");
      this.reconciliationRequired = true;
      this.log("error", `Semantic index activated ${generation} but could not open it: ${describe(error)}`);

      if (await this.reopenActive(generation, generationPath)) {
        this.log("info", `Semantic index recovered: ${generation} opened on retry.`);
        return;
      }
      throw error;
    }
  }

  /** Bounded reopen of the pointer-selected generation. Never touches the pointer. */
  private async reopenActive(generation: string, generationPath: string): Promise<boolean> {
    const attempts = this.options.reopenAttempts ?? 3;
    const wait = this.options.reopenDelayMs ?? 250;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await delay(wait);
      try {
        const store = this.newStore(generation, generationPath);
        await store.open();
        this.active = { store, generation };
        this.block = null;
        this.reconciliationRequired = false;
        this.queue.retargetStore(store);
        return true;
      } catch (error) {
        this.log("warn", `Reopen attempt ${attempt}/${attempts} failed: ${describe(error)}`);
      }
    }
    return false;
  }

  /**
   * Enqueue a mutation.
   *
   * Refused while blocked, and refused with the REASON rather than a generic failure — a caller that
   * cannot tell "index is rebuilding" from "index is broken" cannot report anything useful.
   */
  enqueue(mutation: SemanticMutation): { accepted: boolean; block: SemanticRuntimeBlock | null } {
    if (this.block) return { accepted: false, block: this.block };
    const outcome = this.queue.enqueue(mutation);
    return { accepted: outcome.accepted, block: null };
  }

  async drain(): Promise<void> {
    if (this.block) return;
    await this.queue.drain();
  }

  /** The live store, or null while blocked. Callers must handle null rather than assume a store. */
  get store(): SemanticStore | null {
    return this.block ? null : (this.active?.store ?? null);
  }

  get mutationQueue(): SemanticMutationQueue {
    return this.queue;
  }

  async rebuild(): Promise<RebuildReport> {
    return this.orchestrator.rebuild();
  }

  status(): SemanticIndexRuntimeStatus {
    return {
      activeGeneration: this.active?.generation ?? null,
      writable: this.block === null,
      block: this.block,
      rebuildRequired: this.queue.needsRebuild,
      pending: this.queue.size,
      reconciliationRequired: this.reconciliationRequired,
      lastIndexedAt: this.queue.lastSuccessAt,
      lastIndexError: this.queue.lastError
    };
  }

  /**
   * Bounded shutdown: stop accepting, wait for quiescence within a deadline, close the store.
   *
   * `idle: false` means the deadline won and work was still in flight. It is REPORTED rather than
   * waited out, because an application that cannot exit is a worse failure than an index that needs
   * reconciliation on next start — which is exactly what `markIndexClosed` not being reached implies.
   */
  async shutdown(): Promise<{ idle: boolean; elapsedMs: number }> {
    const started = Date.now();
    // Stop accepting first, so the thing being waited for cannot keep growing while it is awaited.
    if (!this.block) this.block = "NO_ACTIVE_GENERATION";
    const idle = await this.queue.whenIdle(this.options.shutdownDeadlineMs ?? 5_000);
    try {
      await this.active?.store.close();
    } catch (error) {
      this.log("warn", `Semantic store did not close cleanly: ${describe(error)}`);
    }
    this.active = null;
    if (!idle) this.log("warn", "Semantic shutdown deadline elapsed with work still in flight.");
    return { idle, elapsedMs: Date.now() - started };
  }
}

/** Never leaks a vendor message or a path — only a stable shape. */
function describe(error: unknown): string {
  if (error instanceof SemanticStoreError) return error.code;
  if (error instanceof Error) return error.name;
  return "UNKNOWN_ERROR";
}

export { ZVEC_TIMEOUTS };
