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
  | "BACKEND_UNAVAILABLE"
  /**
   * The backend cannot perform this operation CORRECTLY yet.
   *
   * Deliberately distinct from a failure: it means "refusing rather than guessing". An entity-wide
   * delete that silently removes only the first page is worse than one that refuses, because the
   * caller believes content is gone when it is still indexed.
   */
  | "UNSUPPORTED_OPERATION";

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
  /** Documents newly added. Meaningful only when `countsKnown` is true. */
  inserted: number;
  /** Documents that replaced an existing id (upsert IS replace — never a second copy). */
  replaced: number;
  /**
   * Whether `inserted`/`replaced` are exact.
   *
   * The write itself always either succeeded or threw — this flag is about the ATTRIBUTION, not the
   * data. A backend that must pre-read to tell an insert from a replacement can lose that read while
   * the write still lands. Reporting `inserted: n, replaced: 0` in that case would be a precise-
   * looking number that is known to be a guess, so the split is explicitly marked unknown instead.
   *
   * `inserted + replaced` still equals the number of documents written, whatever this says.
   */
  countsKnown: boolean;
}

export interface SemanticStoreStats {
  documents: number;
  /** Per-kind counts, for status surfaces and rebuild parity checks. */
  byKind: Record<string, number>;
}

/**
 * What an implementation can do correctly.
 *
 * Declared rather than assumed so the shared contract suite can assert the RIGHT behaviour for each
 * backend: a store lacking `entityOperations` must throw `UNSUPPORTED_OPERATION`, not return a
 * plausible-looking partial result. Without this the suite would either be weakened for everyone or
 * would silently bless a partial delete.
 */
export interface SemanticStoreCapabilities {
  /**
   * Whole-collection scans: `deleteByEntity`, `stats`, `clear`, and exact `totalMatched`.
   *
   * Requires the backend to enumerate every document. The Zvec utility host has no scan/cursor
   * operation today — its `query` is top-K capped — so the adapter declares this false until the
   * host protocol gains one.
   */
  entityOperations: boolean;
}

export interface SemanticStore {
  /** Identifies the implementation in diagnostics ("in-memory", "zvec"). */
  readonly name: string;
  readonly capabilities: SemanticStoreCapabilities;

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
