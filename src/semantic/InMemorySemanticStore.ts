/**
 * In-memory `SemanticStore` with REAL semantics.
 *
 * This is deliberately not a mock. It implements upsert-is-replace, entity deletion, filtering,
 * deterministic token-based ranking and bounded results for real, so that the shared contract suite
 * exercises genuine behaviour on both sides. A mock that returns canned answers would let the Zvec
 * adapter diverge silently — the contract suite would be asserting against the mock's opinions
 * rather than against the contract.
 *
 * It also serves two production-adjacent purposes:
 *   - the fallback when the native host is unavailable (semantic search degrades rather than
 *     disappearing), and
 *   - the parity oracle for rebuilds.
 *
 * `failures` exists so the queue and rebuild logic can be tested against a store that fails the way
 * a real one does — mid-batch, on a specific operation — instead of only against a happy path.
 *
 * Framework-agnostic: no Electron, no filesystem, no Zvec.
 */

import {
  SEMANTIC_DEFAULT_TOP_K,
  SEMANTIC_MAX_TOP_K,
  type SemanticSearchHit,
  type SemanticSearchRequest,
  type SemanticSearchResult
} from "./contracts/SemanticDocument";
import type { ValidatedSemanticDocument } from "./SemanticPolicyValidator";
import { deriveMatchReasons, tokenize } from "./SemanticRanking";
import {
  SemanticStoreError,
  type SemanticStore,
  type SemanticStoreStats,
  type SemanticUpsertResult
} from "./SemanticStore";

/** Injected failure points, for exercising error paths that a healthy store never reaches. */
export interface InMemoryFailureInjection {
  onOpen?: boolean;
  onUpsert?: boolean;
  onDelete?: boolean;
  onSearch?: boolean;
  /** Fail only when the batch contains this document id — simulates a mid-batch failure. */
  onUpsertOfId?: string;
}

export interface InMemorySemanticStoreOptions {
  failures?: InMemoryFailureInjection;
  /** Reject writes past this many documents, exercising CAPACITY_EXCEEDED. */
  maxDocuments?: number;
}

/** Re-exported so callers and tests have one tokenizer identity across the subsystem. */
export { tokenize } from "./SemanticRanking";

export class InMemorySemanticStore implements SemanticStore {
  readonly name = "in-memory";

  private documents = new Map<string, ValidatedSemanticDocument>();
  private opened = false;
  private closed = false;

  constructor(private readonly options: InMemorySemanticStoreOptions = {}) {}

  async open(): Promise<void> {
    if (this.options.failures?.onOpen) throw new SemanticStoreError("BACKEND_UNAVAILABLE");
    this.opened = true;
    this.closed = false;
  }

  async close(): Promise<void> {
    this.opened = false;
    this.closed = true;
  }

  private assertOpen(): void {
    if (!this.opened) throw new SemanticStoreError(this.closed ? "ALREADY_CLOSED" : "NOT_OPEN");
  }

  async upsert(documents: readonly ValidatedSemanticDocument[]): Promise<SemanticUpsertResult> {
    this.assertOpen();
    const f = this.options.failures;
    if (f?.onUpsert) throw new SemanticStoreError("WRITE_FAILED");
    if (f?.onUpsertOfId && documents.some((d) => d.id === f.onUpsertOfId)) {
      throw new SemanticStoreError("WRITE_FAILED");
    }

    let inserted = 0;
    let replaced = 0;

    for (const doc of documents) {
      const exists = this.documents.has(doc.id);
      if (!exists && this.options.maxDocuments !== undefined && this.documents.size >= this.options.maxDocuments) {
        throw new SemanticStoreError("CAPACITY_EXCEEDED");
      }
      // Replace, never append: the id is deterministic, so a re-projection of the same entity
      // revision must converge on exactly one document.
      this.documents.set(doc.id, doc);
      if (exists) replaced += 1;
      else inserted += 1;
    }

    return { inserted, replaced };
  }

  async delete(ids: readonly string[]): Promise<number> {
    this.assertOpen();
    if (this.options.failures?.onDelete) throw new SemanticStoreError("WRITE_FAILED");
    let removed = 0;
    for (const id of ids) {
      if (this.documents.delete(id)) removed += 1; // absent ids are not an error
    }
    return removed;
  }

  async deleteByEntity(entityId: string): Promise<number> {
    this.assertOpen();
    if (this.options.failures?.onDelete) throw new SemanticStoreError("WRITE_FAILED");
    let removed = 0;
    for (const [id, doc] of [...this.documents.entries()]) {
      if (doc.entityId === entityId) {
        this.documents.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async get(id: string): Promise<ValidatedSemanticDocument | null> {
    this.assertOpen();
    return this.documents.get(id) ?? null;
  }

  async stats(): Promise<SemanticStoreStats> {
    this.assertOpen();
    const byKind: Record<string, number> = {};
    for (const doc of this.documents.values()) byKind[doc.kind] = (byKind[doc.kind] ?? 0) + 1;
    return { documents: this.documents.size, byKind };
  }

  async clear(): Promise<void> {
    this.assertOpen();
    this.documents.clear();
  }

  async search(request: SemanticSearchRequest): Promise<SemanticSearchResult> {
    this.assertOpen();
    if (this.options.failures?.onSearch) throw new SemanticStoreError("QUERY_FAILED");

    const mode = request.mode ?? "fullText";
    // Phase 1B is full-text only (plan §12.1). Vector/hybrid are accepted by the type but degrade
    // to full text and SAY SO via `degraded`, rather than silently pretending to have ranked by
    // vector similarity.
    const degraded = mode !== "fullText";

    const terms = tokenize(request.text);
    const scored: SemanticSearchHit[] = [];

    for (const doc of this.documents.values()) {
      if (!matchesFilters(doc, request)) continue;

      const { score, reasons } = scoreDocument(doc, terms, request);
      // An empty query returns everything that matches the FILTERS — useful for "show me all
      // failures for this workflow" — but a non-empty query must actually match something.
      if (terms.length > 0 && score <= 0) continue;

      scored.push({
        documentId: doc.id,
        kind: doc.kind,
        entityId: doc.entityId,
        title: doc.title,
        summary: doc.content.slice(0, 240),
        score,
        workflowId: doc.workflowId,
        flowId: doc.flowId,
        nodeId: doc.nodeId,
        hostname: doc.hostname,
        updatedAt: doc.updatedAt,
        reasons
      });
    }

    // Deterministic ordering: score desc, then updatedAt desc, then id asc. The final id tiebreak
    // matters — without it two equally-scored documents could swap places between runs, which would
    // make rebuild parity checks flaky for no real reason.
    scored.sort(
      (a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || a.documentId.localeCompare(b.documentId)
    );

    const topK = Math.min(Math.max(1, request.topK ?? SEMANTIC_DEFAULT_TOP_K), SEMANTIC_MAX_TOP_K);
    return { hits: scored.slice(0, topK), totalMatched: scored.length, mode, degraded };
  }
}

function matchesFilters(doc: ValidatedSemanticDocument, request: SemanticSearchRequest): boolean {
  if (request.kinds && request.kinds.length > 0 && !request.kinds.includes(doc.kind)) return false;
  if (request.workflowId !== undefined && doc.workflowId !== request.workflowId) return false;
  if (request.flowId !== undefined && doc.flowId !== request.flowId) return false;
  if (request.nodeType !== undefined && doc.nodeType !== request.nodeType) return false;
  if (request.hostname !== undefined && doc.hostname !== request.hostname) return false;
  if (request.outcome !== undefined && doc.outcome !== request.outcome) return false;
  if (request.errorCategory !== undefined && doc.errorCategory !== request.errorCategory) return false;
  return true;
}

/**
 * Deterministic scoring with explainable reasons (plan §12.3/§12.4).
 *
 * The boosts are intentionally simple and named. The plan explicitly warns against inventing a
 * permanent weighting formula before offline benchmark data exists, so these are transparent
 * integers rather than a tuned model — and every one of them produces a human-readable `reason`.
 */
function scoreDocument(
  doc: ValidatedSemanticDocument,
  terms: string[],
  request: SemanticSearchRequest
): { score: number; reasons: string[] } {
  if (terms.length === 0) return { score: 1, reasons: ["Filter match"] };

  const titleTokens = new Set(tokenize(doc.title));
  const contentTokens = tokenize(doc.content);
  const tagTokens = new Set(tokenize(doc.tags.join(" ")));
  const contentCounts = new Map<string, number>();
  for (const t of contentTokens) contentCounts.set(t, (contentCounts.get(t) ?? 0) + 1);

  let score = 0;
  let titleHits = 0;

  for (const term of terms) {
    if (titleTokens.has(term)) {
      score += 5;
      titleHits += 1;
    }
    const inContent = contentCounts.get(term) ?? 0;
    if (inContent > 0) score += Math.min(inContent, 3); // cap so one repeated word cannot dominate
    if (tagTokens.has(term)) score += 2;
  }

  if (titleHits === terms.length && terms.length > 0) score += 10;
  if (request.workflowId !== undefined && doc.workflowId === request.workflowId) score += 3;
  if (request.hostname !== undefined && doc.hostname === request.hostname) score += 2;
  if (request.nodeType !== undefined && doc.nodeType === request.nodeType) score += 2;

  // Weights stay local (each backend ranks differently); the EXPLANATION is shared, so `reasons`
  // means the same thing whichever store answered.
  return { score, reasons: deriveMatchReasons(doc, terms, request) };
}
