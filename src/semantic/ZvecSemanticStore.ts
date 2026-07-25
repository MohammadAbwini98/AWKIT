/**
 * `SemanticStore` implemented over the Zvec utility host (plan §6.2).
 *
 * This is the ONLY file in the subsystem that knows Zvec's wire shapes. Everything above it talks
 * to `SemanticStore`, so replacing the vendor means rewriting this adapter and nothing else — that
 * is the whole point of the adapter-first rule.
 *
 * The host transport is injected rather than imported so this stays in `src/` (framework-agnostic,
 * no Electron). `ZvecUtilityHostManager.call` satisfies `ZvecHostTransport` structurally, and a
 * fake satisfying the same interface lets the shared contract suite run without a native host.
 *
 * **Scalar-only projection.** Zvec fields are flat scalars, so arrays (`tags`) are joined and the
 * document is reconstructed on read. `content` round-trips verbatim because search summaries come
 * from it. Nothing is stored that was not already redacted and validated — the store accepts only
 * `ValidatedSemanticDocument`.
 */

import {
  SEMANTIC_DEFAULT_TOP_K,
  SEMANTIC_DOCUMENT_KINDS,
  SEMANTIC_MAX_TOP_K,
  isSemanticDocumentKind,
  type SemanticDocumentKind,
  type SemanticOutcome,
  type SemanticSearchHit,
  type SemanticSearchRequest,
  type SemanticSearchResult
} from "./contracts/SemanticDocument";
import {
  buildZvecFilterExpression,
  entityFilter,
  matchAllFilter,
  ZvecFilterError,
  type ZvecFilterClause,
  type ZvecFilterField,
  type ZvecSafeFilter
} from "./contracts/ZvecFilter";
import type {
  ZvecCountResponse,
  ZvecDeleteResponse,
  ZvecDocumentsResponse,
  ZvecSafeDocument,
  ZvecSafeSchema
} from "./contracts/ZvecHostProtocol";
import { validateSemanticDocument, type ValidatedSemanticDocument } from "./SemanticPolicyValidator";
import { deriveMatchReasons, tokenize } from "./SemanticRanking";
import {
  SemanticStoreError,
  type SemanticStore,
  type SemanticStoreErrorCode,
  type SemanticStoreStats,
  type SemanticUpsertResult
} from "./SemanticStore";

/** The subset of the host manager this adapter needs. Structurally satisfied by `ZvecUtilityHostManager`. */
export interface ZvecHostTransport {
  call<T = unknown>(request: unknown, timeoutMs: number): Promise<T>;
}

export const SEMANTIC_COLLECTION_NAME = "awkit-memory-v1";

/** Bounded deadlines — a hung host must never block a caller indefinitely. */
export const ZVEC_TIMEOUTS = { open: 15_000, write: 20_000, read: 10_000, close: 5_000 } as const;

/**
 * The collection schema.
 *
 * Previously written with `type: "string"` and force-cast with `as unknown as ZvecSafeSchema`, which
 * hid the fact that the host reads `dataType` — every field would have been created with
 * `dataType: undefined`. The cast is gone so the type checker enforces the wire shape.
 *
 * `nullable` matters for correctness: an OPTIONAL field must be declared nullable and written by
 * OMISSION (the binding rejects an explicit null), and only a nullable field answers `IS NULL`.
 * `invert` is a performance flag on the dimensions that are actually filtered.
 */
export const SEMANTIC_SCHEMA: ZvecSafeSchema = {
  name: SEMANTIC_COLLECTION_NAME,
  fields: [
    { name: "id", dataType: "STRING", invert: true },
    { name: "kind", dataType: "STRING", invert: true },
    // `entityId` is stored for traceability but is NOT indexed for filtering — identity filters go
    // through the derived fixed-alphabet `entityKey`, so raw source text never enters the grammar.
    { name: "entityId", dataType: "STRING" },
    { name: "entityKey", dataType: "STRING", invert: true },
    { name: "revision", dataType: "STRING" },
    { name: "sourceHash", dataType: "STRING" },
    { name: "schemaVersion", dataType: "INT64" },
    { name: "title", dataType: "STRING" },
    { name: "content", dataType: "STRING", fts: { tokenizer: "standard" } },
    { name: "tags", dataType: "STRING", nullable: true },
    { name: "workflowId", dataType: "STRING", nullable: true, invert: true },
    { name: "flowId", dataType: "STRING", nullable: true, invert: true },
    { name: "nodeId", dataType: "STRING", nullable: true },
    { name: "nodeType", dataType: "STRING", nullable: true, invert: true },
    { name: "hostname", dataType: "STRING", nullable: true, invert: true },
    { name: "outcome", dataType: "STRING", nullable: true, invert: true },
    { name: "errorCategory", dataType: "STRING", nullable: true, invert: true },
    { name: "createdAt", dataType: "STRING" },
    { name: "updatedAt", dataType: "STRING" }
  ]
};

/**
 * Joined with a character that cannot appear in a redacted tag, so the split is unambiguous.
 *
 * Written as an ESCAPE SEQUENCE, never a literal control byte: a raw control character in source
 * is invisible in diffs and is silently destroyed by an editor or a copy/paste round trip.
 */
const TAG_SEPARATOR = "\u001F";

/**
 * An absent optional is OMITTED, never written as null.
 *
 * Measured against the real binding: a `nullable: true` string field rejects an explicit null with
 * "Expected scalar field[x] to be a string", which fails the entire write batch. The previous
 * `?? null` form meant any document with an absent optional — the common case — would have been
 * rejected outright by the real host. Omission reads back as NULL for `IS NULL` filters.
 */
export function toZvecDocument(doc: ValidatedSemanticDocument): ZvecSafeDocument {
  const fields: Record<string, string | number | boolean> = {
    id: doc.id,
    kind: doc.kind,
    entityId: doc.entityId,
    entityKey: doc.entityKey,
    revision: doc.revision,
    sourceHash: doc.sourceHash,
    schemaVersion: doc.schemaVersion,
    title: doc.title,
    content: doc.content,
    tags: doc.tags.join(TAG_SEPARATOR),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };

  const optional: Record<string, string | undefined> = {
    workflowId: doc.workflowId,
    flowId: doc.flowId,
    nodeId: doc.nodeId,
    nodeType: doc.nodeType,
    hostname: doc.hostname,
    outcome: doc.outcome,
    errorCategory: doc.errorCategory
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) fields[key] = value;
  }

  return { id: doc.id, fields };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Rebuild a document from host fields.
 *
 * Re-validated through the policy validator rather than cast: the index is a file on disk that
 * another process (or a corrupted write) could have altered, so content coming OUT of it is treated
 * as untrusted input exactly like content going in. A row that no longer passes policy is dropped
 * rather than returned — better to lose one search hit than to surface an unredacted value that
 * reached the index before a policy tightened.
 */
export function fromZvecDocument(raw: ZvecSafeDocument): ValidatedSemanticDocument | null {
  const f = raw.fields ?? {};
  const kind = str(f.kind);
  if (!isSemanticDocumentKind(kind)) return null;

  const tagsRaw = str(f.tags);
  const result = validateSemanticDocument({
    id: str(f.id) ?? raw.id,
    kind: kind as SemanticDocumentKind,
    entityId: str(f.entityId) ?? "",
    // Not recomputed here: the validator recomputes and compares it, so a row whose stored key
    // disagrees with its own identity is REJECTED rather than silently corrected on read.
    entityKey: str(f.entityKey) ?? "",
    revision: str(f.revision) ?? "",
    sourceHash: str(f.sourceHash) ?? "",
    schemaVersion: typeof f.schemaVersion === "number" ? f.schemaVersion : -1,
    title: str(f.title) ?? "",
    content: str(f.content) ?? "",
    tags: tagsRaw ? tagsRaw.split(TAG_SEPARATOR).filter(Boolean) : [],
    workflowId: str(f.workflowId),
    flowId: str(f.flowId),
    nodeId: str(f.nodeId),
    nodeType: str(f.nodeType),
    hostname: str(f.hostname),
    outcome: str(f.outcome) as SemanticOutcome | undefined,
    errorCategory: str(f.errorCategory),
    createdAt: str(f.createdAt) ?? "",
    updatedAt: str(f.updatedAt) ?? ""
  });

  return result.ok ? result.document : null;
}

export interface ZvecSemanticStoreOptions {
  transport: ZvecHostTransport;
  /** Generation name and absolute path, resolved by the generation manager. */
  generation: string;
  generationPath: string;
}

export class ZvecSemanticStore implements SemanticStore {
  readonly name = "zvec";

  /**
   * Entity-wide operations are supported as of host protocol v2.
   *
   * They were previously refused because the host's `query` capped top-K at 100 and returned ids
   * rather than documents — but that cap was AWKIT's own, not a vendor limit. v2 adds typed
   * `scan`/`count`/`deleteByFilter`, so these operations are now exact rather than first-page
   * approximations. The host still refuses to report a count it had to truncate.
   */
  readonly capabilities = { entityOperations: true } as const;

  private collectionId: string | null = null;
  private closed = false;

  constructor(private readonly options: ZvecSemanticStoreOptions) {}

  private assertOpen(): string {
    if (!this.collectionId) throw new SemanticStoreError(this.closed ? "ALREADY_CLOSED" : "NOT_OPEN");
    return this.collectionId;
  }

  /** Map a host failure onto a stable store code. Vendor text never escapes this method. */
  private fail(error: unknown, fallback: SemanticStoreErrorCode): never {
    if (error instanceof SemanticStoreError) throw error;
    throw new SemanticStoreError(fallback);
  }

  async open(): Promise<void> {
    try {
      const value = await this.options.transport.call<{ collectionId?: string } | string>(
        {
          type: "open",
          generation: this.options.generation,
          path: this.options.generationPath,
          schema: SEMANTIC_SCHEMA
        },
        ZVEC_TIMEOUTS.open
      );
      const id = typeof value === "string" ? value : value?.collectionId;
      if (!id) throw new SemanticStoreError("BACKEND_UNAVAILABLE");
      this.collectionId = id;
      this.closed = false;
    } catch (error) {
      this.fail(error, "BACKEND_UNAVAILABLE");
    }
  }

  async close(): Promise<void> {
    const id = this.collectionId;
    this.collectionId = null;
    this.closed = true;
    if (!id) return;
    try {
      await this.options.transport.call({ type: "close", collectionId: id }, ZVEC_TIMEOUTS.close);
    } catch {
      // A failed close still leaves the store unusable from here; surfacing it would turn an
      // already-completed teardown into a caller-visible error for no recoverable reason.
    }
  }

  async upsert(documents: readonly ValidatedSemanticDocument[]): Promise<SemanticUpsertResult> {
    const collectionId = this.assertOpen();
    if (documents.length === 0) return { inserted: 0, replaced: 0, countsKnown: true };

    // Existence is resolved BEFORE writing so inserted/replaced are truthful. Zvec's upsert does not
    // report which rows already existed, and guessing would make the counts fiction.
    let existing = 0;
    let countsKnown = true;
    try {
      const fetched = await this.options.transport.call<ZvecDocumentsResponse>(
        { type: "fetch", collectionId, ids: documents.map((d) => d.id) },
        ZVEC_TIMEOUTS.read
      );
      const rows = fetched?.docs ?? [];
      existing = rows.length;
    } catch {
      // The write still proceeds — a failed pre-read is not a reason to lose data. But the
      // insert/replace SPLIT is now unknown, and silently reporting `existing = 0` claimed every
      // document was new even when all were replacements. Say so instead of inventing a number.
      existing = 0;
      countsKnown = false;
    }

    try {
      await this.options.transport.call(
        { type: "upsert", collectionId, docs: documents.map(toZvecDocument) },
        ZVEC_TIMEOUTS.write
      );
    } catch (error) {
      this.fail(error, "WRITE_FAILED");
    }

    return { inserted: documents.length - existing, replaced: existing, countsKnown };
  }

  async delete(ids: readonly string[]): Promise<number> {
    const collectionId = this.assertOpen();
    if (ids.length === 0) return 0;

    // Deleting an absent id is not an error, but the CONTRACT requires a truthful removed-count, so
    // presence is resolved first rather than assuming every requested id existed.
    let present: string[] = [];
    try {
      const fetched = await this.options.transport.call<ZvecDocumentsResponse>(
        { type: "fetch", collectionId, ids: [...ids] },
        ZVEC_TIMEOUTS.read
      );
      const rows = fetched?.docs ?? [];
      present = rows.map((r) => r.id);
    } catch (error) {
      this.fail(error, "READ_FAILED");
    }

    if (present.length === 0) return 0;
    try {
      await this.options.transport.call({ type: "delete", collectionId, ids: present }, ZVEC_TIMEOUTS.write);
    } catch (error) {
      this.fail(error, "WRITE_FAILED");
    }
    return present.length;
  }

  /**
   * Delete every document projected from one entity.
   *
   * The original implementation ran a top-K FULL-TEXT query for the entity id and deleted whatever
   * came back — wrong twice over: an entity id need not appear in indexed content at all (matching
   * nothing, reporting a successful no-op), and any match was capped at 100.
   *
   * It now matches on the DERIVED `entityKey`, one per kind. The raw entity id never reaches the
   * grammar, so an id holding a backslash, a quote or non-ASCII text is as deletable as any other —
   * refusing those would have been fail-closed but would have stranded real content in the index
   * permanently. The host renders, executes and then re-scans to prove the removal.
   */
  async deleteByEntity(entityId: string): Promise<number> {
    const collectionId = this.assertOpen();
    try {
      const value = await this.options.transport.call<ZvecDeleteResponse>(
        { type: "deleteByFilter", collectionId, filter: entityFilter(entityId) },
        ZVEC_TIMEOUTS.write
      );
      return typeof value?.deleted === "number" ? value.deleted : 0;
    } catch (error) {
      // An entity id the filter grammar cannot represent is refused rather than partially applied.
      this.fail(error, "WRITE_FAILED");
    }
  }

  async get(id: string): Promise<ValidatedSemanticDocument | null> {
    const collectionId = this.assertOpen();
    try {
      const fetched = await this.options.transport.call<ZvecDocumentsResponse>(
        { type: "fetch", collectionId, ids: [id] },
        ZVEC_TIMEOUTS.read
      );
      const rows = fetched?.docs ?? [];
      const row = rows.find((r) => r.id === id);
      return row ? fromZvecDocument(row) : null;
    } catch (error) {
      this.fail(error, "READ_FAILED");
    }
  }

  private async count(filter?: ZvecSafeFilter): Promise<number> {
    const collectionId = this.assertOpen();
    const value = await this.options.transport.call<ZvecCountResponse>(
      filter ? { type: "count", collectionId, filter } : { type: "count", collectionId },
      ZVEC_TIMEOUTS.read
    );
    // An inexact count is refused, not rounded off. Rebuild parity compares against these numbers,
    // so a silently truncated total would make the comparison meaningless rather than merely coarse.
    if (!value || typeof value.count !== "number") throw new SemanticStoreError("READ_FAILED");
    if (value.exact !== true) throw new SemanticStoreError("UNSUPPORTED_OPERATION");
    return value.count;
  }

  async stats(): Promise<SemanticStoreStats> {
    this.assertOpen();
    try {
      const documents = await this.count();
      const byKind: Record<string, number> = {};
      // Per-kind counts are separate filtered counts rather than one full scan: each is an indexed
      // lookup, and none of them has to transfer document bodies across the port.
      for (const kind of SEMANTIC_DOCUMENT_KINDS) {
        const n = await this.count({ all: [{ field: "kind", op: "eq", value: kind }] });
        if (n > 0) byKind[kind] = n;
      }
      return { documents, byKind };
    } catch (error) {
      this.fail(error, "READ_FAILED");
    }
  }

  async clear(): Promise<void> {
    const collectionId = this.assertOpen();
    try {
      // `matchAllFilter` is an explicit `schemaVersion >= 0` clause, not an empty filter: the host
      // refuses an empty clause list precisely so "delete where nothing" can never mean "delete
      // everything" by accident. Here everything IS the intent, so it is stated.
      await this.options.transport.call<ZvecDeleteResponse>(
        { type: "deleteByFilter", collectionId, filter: matchAllFilter() },
        ZVEC_TIMEOUTS.write
      );
    } catch (error) {
      this.fail(error, "WRITE_FAILED");
    }
  }

  /**
   * Translate the request's named dimensions into a typed filter.
   *
   * Returned as clauses rather than applied in memory afterwards, because the vendor applies `filter`
   * BEFORE ranking. Post-filtering a truncated top-K is what silently dropped a filtered match that
   * ranked outside the unfiltered head.
   */
  private static requestFilter(request: SemanticSearchRequest): ZvecSafeFilter | undefined {
    const all: ZvecFilterClause[] = [];
    if (request.kinds && request.kinds.length > 0) {
      all.push({ field: "kind", op: "in", values: [...request.kinds] });
    }
    const eq: ReadonlyArray<[ZvecFilterField, string | undefined]> = [
      ["workflowId", request.workflowId],
      ["flowId", request.flowId],
      ["nodeType", request.nodeType],
      ["hostname", request.hostname],
      ["outcome", request.outcome],
      ["errorCategory", request.errorCategory]
    ];
    for (const [field, value] of eq) {
      if (value !== undefined) all.push({ field, op: "eq", value });
    }
    return all.length > 0 ? { all } : undefined;
  }

  private async queryDocuments(
    collectionId: string,
    text: string,
    topK: number,
    filter: ZvecSafeFilter | undefined
  ): Promise<{ documents: ValidatedSemanticDocument[]; totalMatched: number; totalExact: boolean }> {
    // Rendered locally BEFORE the round trip, purely to surface a precise error. The host renders it
    // again — that copy is the authority — but a value the grammar cannot represent must not come back
    // as a generic query failure, and must never come back as a successful zero-match: "no results"
    // and "your filter was unrepresentable" are different answers, and conflating them is how a
    // caller concludes an entity is absent when it was never searched for.
    if (filter) {
      try {
        buildZvecFilterExpression(filter);
      } catch (error) {
        throw new SemanticStoreError(
          error instanceof ZvecFilterError && error.code === "FILTER_VALUE_UNSAFE"
            ? "FILTER_VALUE_UNSAFE"
            : "FILTER_INVALID"
        );
      }
    }

    try {
      const value = await this.options.transport.call<ZvecDocumentsResponse>(
        {
          type: "query",
          collectionId,
          query: { fieldName: "content", fts: text ? { queryString: text } : {}, topK, filter }
        },
        ZVEC_TIMEOUTS.read
      );
      const rows = value?.docs ?? [];
      // Rows failing re-validation are dropped, not surfaced (see `fromZvecDocument`).
      const documents = rows.map(fromZvecDocument).filter((d): d is ValidatedSemanticDocument => d !== null);
      return {
        documents,
        // Falls back to the page length only when the host did not report a total — a host that DID
        // report one is always preferred, because the page length is a truncated number.
        totalMatched: typeof value?.totalMatched === "number" ? value.totalMatched : documents.length,
        totalExact: value?.totalExact !== false
      };
    } catch (error) {
      this.fail(error, "QUERY_FAILED");
    }
  }

  async search(request: SemanticSearchRequest): Promise<SemanticSearchResult> {
    const collectionId = this.assertOpen();
    const mode = request.mode ?? "fullText";
    const degraded = mode !== "fullText";
    const topK = Math.min(Math.max(1, request.topK ?? SEMANTIC_DEFAULT_TOP_K), SEMANTIC_MAX_TOP_K);

    // The filter is pushed INTO the query so the vendor applies it before ranking. The in-memory
    // store filters in memory over its whole collection, which is the same semantics — that
    // equivalence is what makes running one contract suite against both meaningful.
    const {
      documents: filtered,
      totalMatched,
      totalExact
    } = await this.queryDocuments(
      collectionId,
      request.text,
      SEMANTIC_MAX_TOP_K,
      ZvecSemanticStore.requestFilter(request)
    );

    // Reasons come from the SHARED vocabulary, not from a locally-invented string. The contract
    // suite asserts on it, and an adapter emitting its own wording made "reasons" mean something
    // different per backend — caught by running the identical suite against both implementations.
    const terms = tokenize(request.text);

    const hits: SemanticSearchHit[] = filtered.map((doc, index) => ({
      documentId: doc.id,
      kind: doc.kind,
      entityId: doc.entityId,
      title: doc.title,
      summary: doc.content.slice(0, 240),
      // Rank-derived and descending, so ordering is stable and the value is never presented as a
      // calibrated probability (plan §12.4 — no opaque confidence).
      score: filtered.length - index,
      workflowId: doc.workflowId,
      flowId: doc.flowId,
      nodeId: doc.nodeId,
      hostname: doc.hostname,
      updatedAt: doc.updatedAt,
      reasons: deriveMatchReasons(doc, terms, request)
    }));

    hits.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || a.documentId.localeCompare(b.documentId));

    // `totalMatched` is the host's pre-truncation count, not `hits.length` — the latter is the size
    // of an already-truncated page, so reporting it turned "showing 20 of 137" into "20 of 20".
    // It is lower-bounded by the rows actually returned, since re-validation can only drop rows.
    //
    // An inexact total (the host's scan bound reached) is surfaced as `degraded`. That is the only
    // signal this contract carries, and flagging it is preferable to presenting a floor as a total.
    return {
      hits: hits.slice(0, topK),
      totalMatched: Math.max(totalMatched, hits.length),
      mode,
      degraded: degraded || !totalExact
    };
  }
}
