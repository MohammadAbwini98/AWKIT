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
  SEMANTIC_MAX_TOP_K,
  isSemanticDocumentKind,
  type SemanticDocumentKind,
  type SemanticOutcome,
  type SemanticSearchHit,
  type SemanticSearchRequest,
  type SemanticSearchResult
} from "./contracts/SemanticDocument";
import type { ZvecSafeDocument, ZvecSafeSchema } from "./contracts/ZvecHostProtocol";
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

export const SEMANTIC_SCHEMA: ZvecSafeSchema = {
  name: SEMANTIC_COLLECTION_NAME,
  fields: [
    { name: "id", type: "string" },
    { name: "kind", type: "string" },
    { name: "entityId", type: "string" },
    { name: "revision", type: "string" },
    { name: "sourceHash", type: "string" },
    { name: "schemaVersion", type: "number" },
    { name: "title", type: "string" },
    { name: "content", type: "string" },
    { name: "tags", type: "string" },
    { name: "workflowId", type: "string" },
    { name: "flowId", type: "string" },
    { name: "nodeId", type: "string" },
    { name: "nodeType", type: "string" },
    { name: "hostname", type: "string" },
    { name: "outcome", type: "string" },
    { name: "errorCategory", type: "string" },
    { name: "createdAt", type: "string" },
    { name: "updatedAt", type: "string" }
  ]
} as unknown as ZvecSafeSchema;

/**
 * Joined with a character that cannot appear in a redacted tag, so the split is unambiguous.
 *
 * Written as an ESCAPE SEQUENCE, never a literal control byte: a raw control character in source
 * is invisible in diffs and is silently destroyed by an editor or a copy/paste round trip.
 */
const TAG_SEPARATOR = "\u001F";

export function toZvecDocument(doc: ValidatedSemanticDocument): ZvecSafeDocument {
  return {
    id: doc.id,
    fields: {
      id: doc.id,
      kind: doc.kind,
      entityId: doc.entityId,
      revision: doc.revision,
      sourceHash: doc.sourceHash,
      schemaVersion: doc.schemaVersion,
      title: doc.title,
      content: doc.content,
      tags: doc.tags.join(TAG_SEPARATOR),
      workflowId: doc.workflowId ?? null,
      flowId: doc.flowId ?? null,
      nodeId: doc.nodeId ?? null,
      nodeType: doc.nodeType ?? null,
      hostname: doc.hostname ?? null,
      outcome: doc.outcome ?? null,
      errorCategory: doc.errorCategory ?? null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    }
  };
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
   * Entity-wide operations are NOT supported yet.
   *
   * The utility host exposes no scan or cursor operation — its `query` is top-K capped at 100 and
   * returns hit counts plus a handful of ids, not the full document set. Anything built on it
   * (`deleteByEntity`, `stats`, `clear`, an exact `totalMatched`) therefore sees only the first page.
   *
   * Refusing is the safe half of that trade: a partial delete that reports success leaves content
   * indexed which the caller believes is gone, and an undercounted `stats` silently misreports the
   * index. Flip this to true once the host protocol gains scan + count.
   */
  readonly capabilities = { entityOperations: false } as const;

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
      const fetched = await this.options.transport.call<{ docs?: ZvecSafeDocument[] } | ZvecSafeDocument[]>(
        { type: "fetch", collectionId, ids: documents.map((d) => d.id) },
        ZVEC_TIMEOUTS.read
      );
      const rows = Array.isArray(fetched) ? fetched : (fetched?.docs ?? []);
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
      const fetched = await this.options.transport.call<{ docs?: ZvecSafeDocument[] } | ZvecSafeDocument[]>(
        { type: "fetch", collectionId, ids: [...ids] },
        ZVEC_TIMEOUTS.read
      );
      const rows = Array.isArray(fetched) ? fetched : (fetched?.docs ?? []);
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

  async deleteByEntity(_entityId: string): Promise<number> {
    this.assertOpen();
    // Previously this ran a top-K full-text query for the entity id and deleted whatever came back.
    // Two independent problems: the entity id need not appear in indexed CONTENT at all (so the
    // query could match nothing and report a successful no-op), and even when it did the result was
    // capped at 100. Both produce "deleted successfully" while documents remain indexed.
    throw new SemanticStoreError("UNSUPPORTED_OPERATION");
  }

  async get(id: string): Promise<ValidatedSemanticDocument | null> {
    const collectionId = this.assertOpen();
    try {
      const fetched = await this.options.transport.call<{ docs?: ZvecSafeDocument[] } | ZvecSafeDocument[]>(
        { type: "fetch", collectionId, ids: [id] },
        ZVEC_TIMEOUTS.read
      );
      const rows = Array.isArray(fetched) ? fetched : (fetched?.docs ?? []);
      const row = rows.find((r) => r.id === id);
      return row ? fromZvecDocument(row) : null;
    } catch (error) {
      this.fail(error, "READ_FAILED");
    }
  }

  async stats(): Promise<SemanticStoreStats> {
    this.assertOpen();
    // An undercounted index is worse than no count: it silently misreports how much is stored, and
    // rebuild parity checks would compare against a number that is wrong by construction.
    throw new SemanticStoreError("UNSUPPORTED_OPERATION");
  }

  async clear(): Promise<void> {
    this.assertOpen();
    // Clearing only the first 100 documents while reporting success would leave the index populated
    // after a user explicitly asked for it to be deleted (plan §9.4 Settings action).
    throw new SemanticStoreError("UNSUPPORTED_OPERATION");
  }

  private async queryDocuments(collectionId: string, text: string, topK: number): Promise<ValidatedSemanticDocument[]> {
    try {
      const value = await this.options.transport.call<{ docs?: ZvecSafeDocument[] } | ZvecSafeDocument[]>(
        {
          type: "query",
          collectionId,
          query: { fieldName: "content", fts: text ? { queryString: text } : {}, topK }
        },
        ZVEC_TIMEOUTS.read
      );
      const rows = Array.isArray(value) ? value : (value?.docs ?? []);
      // Rows failing re-validation are dropped, not surfaced (see `fromZvecDocument`).
      return rows.map(fromZvecDocument).filter((d): d is ValidatedSemanticDocument => d !== null);
    } catch (error) {
      this.fail(error, "QUERY_FAILED");
    }
  }

  async search(request: SemanticSearchRequest): Promise<SemanticSearchResult> {
    const collectionId = this.assertOpen();
    const mode = request.mode ?? "fullText";
    const degraded = mode !== "fullText";
    const topK = Math.min(Math.max(1, request.topK ?? SEMANTIC_DEFAULT_TOP_K), SEMANTIC_MAX_TOP_K);

    // Over-fetch, then apply the named filters here. Zvec's FTS ranks on text; the structured
    // dimensions are AWKIT's contract, and applying them after ranking keeps filter semantics
    // identical to the in-memory implementation — which is what makes the shared suite meaningful.
    const candidates = await this.queryDocuments(collectionId, request.text, SEMANTIC_MAX_TOP_K);

    const filtered = candidates.filter((doc) => {
      if (request.kinds && request.kinds.length > 0 && !request.kinds.includes(doc.kind)) return false;
      if (request.workflowId !== undefined && doc.workflowId !== request.workflowId) return false;
      if (request.flowId !== undefined && doc.flowId !== request.flowId) return false;
      if (request.nodeType !== undefined && doc.nodeType !== request.nodeType) return false;
      if (request.hostname !== undefined && doc.hostname !== request.hostname) return false;
      if (request.outcome !== undefined && doc.outcome !== request.outcome) return false;
      if (request.errorCategory !== undefined && doc.errorCategory !== request.errorCategory) return false;
      return true;
    });

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

    return { hits: hits.slice(0, topK), totalMatched: hits.length, mode, degraded };
  }
}
