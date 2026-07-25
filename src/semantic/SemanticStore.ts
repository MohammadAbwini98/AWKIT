/**
 * The vendor-neutral store interface (plan §6.2 — "adapter first").
 *
 * Everything above this line in the stack talks to `SemanticStore` and never to Zvec. That is what
 * makes `InMemorySemanticStore` a genuine second implementation rather than a mock: both are driven
 * by the same contract suite, so a behaviour the in-memory store gets right and the Zvec adapter
 * gets wrong is a caught bug rather than an untested assumption.
 *
 * **Only `ValidatedSemanticDocument` may be written.** The brand cannot be minted outside
 * `SemanticPolicyValidator`, so an unredacted or unvalidated document cannot reach any store —
 * enforced by the type checker, not by convention.
 *
 * Framework-agnostic: no Electron, no filesystem, no Zvec.
 */

import type {
  SemanticSearchRequest,
  SemanticSearchResult
} from "./contracts/SemanticDocument";
import type { ValidatedSemanticDocument } from "./SemanticPolicyValidator";

/** Stable, path-free reason codes. A store error must never carry a vendor message or a path. */
export type SemanticStoreErrorCode =
  | "NOT_OPEN"
  | "ALREADY_CLOSED"
  | "WRITE_FAILED"
  | "READ_FAILED"
  | "QUERY_FAILED"
  | "CAPACITY_EXCEEDED"
  | "BACKEND_UNAVAILABLE";

export class SemanticStoreError extends Error {
  constructor(
    readonly code: SemanticStoreErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "SemanticStoreError";
  }
}

export interface SemanticUpsertResult {
  /** Documents newly added. */
  inserted: number;
  /** Documents that replaced an existing id (upsert IS replace — never a second copy). */
  replaced: number;
}

export interface SemanticStoreStats {
  documents: number;
  /** Per-kind counts, for status surfaces and rebuild parity checks. */
  byKind: Record<string, number>;
}

export interface SemanticStore {
  /** Identifies the implementation in diagnostics ("in-memory", "zvec"). */
  readonly name: string;

  open(): Promise<void>;
  close(): Promise<void>;

  /**
   * Insert or replace by document id.
   *
   * Replace-by-id is the load-bearing semantic: document ids are deterministic, so re-projecting an
   * unchanged entity must converge on one document rather than accumulating near-duplicates.
   */
  upsert(documents: readonly ValidatedSemanticDocument[]): Promise<SemanticUpsertResult>;

  /** Delete by document id. Deleting an absent id is NOT an error — deletes must be idempotent. */
  delete(ids: readonly string[]): Promise<number>;

  /** Delete every document projected from one source entity, whatever its revision. */
  deleteByEntity(entityId: string): Promise<number>;

  get(id: string): Promise<ValidatedSemanticDocument | null>;

  search(request: SemanticSearchRequest): Promise<SemanticSearchResult>;

  stats(): Promise<SemanticStoreStats>;

  /** Remove everything. Used by rebuild and by the Settings "delete index" action (§9.4). */
  clear(): Promise<void>;
}
