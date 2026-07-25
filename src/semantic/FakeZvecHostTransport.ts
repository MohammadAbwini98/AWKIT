/**
 * An in-process stand-in for the Zvec utility host, speaking the real `ZvecHostRequest` wire shapes.
 *
 * This exists so `ZvecSemanticStore` can be driven through the SHARED contract suite without a
 * native host or a packaged build. It is a transport fake, not a store fake — the adapter's own
 * logic (field projection, existence pre-reads, filter translation, re-validation on read) runs
 * unmodified, which is the part that can actually be wrong.
 *
 * ## It models the real host's QUIRKS on purpose
 *
 * An earlier version of this fake encoded the protocol as *intended* rather than as implemented, and
 * the host was written to something else. Three defects survived a green suite as a direct result:
 * `fetch` returned bare id strings while the adapter read `.id` off each row; a `nullable` string
 * field was written as an explicit `null`, which the real binding rejects outright; and the schema
 * used `type` where the host reads `dataType`. A fake that is more permissive than the real thing
 * does not reduce risk, it relocates it — so the measured rejections are reproduced here:
 *
 *  - an explicit `null` in a document field is REJECTED (write fails, as the binding does);
 *  - a filter naming a field outside the allowlist, or a value the grammar cannot represent, is
 *    REJECTED with the same reason codes;
 *  - an empty filter clause list is REJECTED rather than meaning "everything".
 *
 * What it still deliberately does NOT prove: native crash behaviour, real FTS ranking quality,
 * on-disk durability, or process isolation. Those need the real host, tracked as `awkit-9yv`.
 *
 * Framework-agnostic: no Electron, no filesystem.
 */

import { buildZvecFilterExpression, type ZvecSafeFilter } from "./contracts/ZvecFilter";
import type { ZvecSafeDocument } from "./contracts/ZvecHostProtocol";
import type { ZvecHostTransport } from "./ZvecSemanticStore";

export interface FakeZvecFailureInjection {
  onOpen?: boolean;
  onUpsert?: boolean;
  onDelete?: boolean;
  onQuery?: boolean;
  onFetch?: boolean;
  onCount?: boolean;
  onDeleteByFilter?: boolean;
}

interface FakeRequest {
  type: string;
  collectionId?: string;
  ids?: string[];
  docs?: ZvecSafeDocument[];
  filter?: ZvecSafeFilter;
  query?: { fts?: { queryString?: string }; topK?: number; filter?: ZvecSafeFilter };
}

/** Same tokenizer rule as the in-memory store, so FTS behaviour is comparable across implementations. */
function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

/**
 * The measured Zvec primary-key rule: `A-Za-z0-9` plus `- _ . @ # + =`, non-empty, and short enough
 * that a 200-character key is refused. Anything else fails the write, exactly as the binding does.
 */
const ZVEC_DOCUMENT_KEY = /^[A-Za-z0-9._@#+=-]{1,180}$/;

function assertValidDocumentKey(id: unknown): void {
  if (typeof id !== "string" || !ZVEC_DOCUMENT_KEY.test(id)) {
    throw new Error("SEMANTIC_WRITE_REJECTED: document key contains invalid characters");
  }
}

/**
 * Evaluate a typed filter against a stored row.
 *
 * `buildZvecFilterExpression` is called first purely for its VALIDATION — it throws on an unknown
 * field, an unsafe value or an empty clause list exactly as the host does, so a caller that would
 * be refused by the real host is refused here too. The matching itself is then done structurally.
 */
function matchesFilter(doc: ZvecSafeDocument, filter: ZvecSafeFilter): boolean {
  buildZvecFilterExpression(filter);
  return filter.all.every((clause) => {
    const value = doc.fields[clause.field];
    switch (clause.op) {
      case "eq":
        return value === clause.value;
      case "neq":
        return value !== clause.value;
      case "gte":
        return typeof value === "number" && value >= clause.value;
      // An omitted optional reads as NULL, mirroring the binding: absence is written by omission.
      case "isNull":
        return value === undefined || value === null;
      case "in":
        return clause.values.some((v) => v === value);
      default:
        return false;
    }
  });
}

export class FakeZvecHostTransport implements ZvecHostTransport {
  private collections = new Map<string, Map<string, ZvecSafeDocument>>();
  private nextId = 1;

  constructor(private readonly failures: FakeZvecFailureInjection = {}) {}

  async call<T = unknown>(request: unknown, _timeoutMs: number): Promise<T> {
    const req = request as FakeRequest;

    switch (req.type) {
      case "open": {
        if (this.failures.onOpen) throw new Error("host open failed");
        const collectionId = `col-${this.nextId++}`;
        this.collections.set(collectionId, new Map());
        return { collectionId } as T;
      }

      case "upsert": {
        if (this.failures.onUpsert) throw new Error("host upsert failed");
        const col = this.collection(req.collectionId);
        for (const doc of req.docs ?? []) {
          // The real binding REJECTS a primary key containing `:` `/` `\` `~` `|` `,` `;`, a space or
          // any non-ASCII, and bounds its length. A JavaScript Map accepts any string, and that
          // difference hid the single worst defect in this subsystem: AWKIT's `kind:component:hash`
          // ids are colon-delimited, so no document could ever be written to a real index while every
          // test passed. Enforced here so the fake can never be more permissive than the backend.
          assertValidDocumentKey(doc.id);
          // The real binding rejects an explicit null on a nullable field with
          // "Expected scalar field[x] to be a string", failing the whole batch.
          for (const [key, value] of Object.entries(doc.fields ?? {})) {
            if (value === null) throw new Error(`SEMANTIC_WRITE_REJECTED: null field ${key}`);
          }
          col.set(doc.id, doc);
        }
        return { written: (req.docs ?? []).length } as T;
      }

      case "delete": {
        if (this.failures.onDelete) throw new Error("host delete failed");
        const col = this.collection(req.collectionId);
        for (const id of req.ids ?? []) col.delete(id);
        return { deleted: (req.ids ?? []).length } as T;
      }

      case "deleteByFilter": {
        if (this.failures.onDeleteByFilter) throw new Error("host deleteByFilter failed");
        const col = this.collection(req.collectionId);
        const filter = req.filter as ZvecSafeFilter;
        const doomed = [...col.values()].filter((d) => matchesFilter(d, filter));
        for (const doc of doomed) col.delete(doc.id);
        // The host re-scans to prove the delete landed; model the same post-condition.
        const residual = [...col.values()].filter((d) => matchesFilter(d, filter));
        if (residual.length > 0) throw new Error("SEMANTIC_DELETE_INCOMPLETE");
        return { deleted: doomed.length } as T;
      }

      case "count": {
        if (this.failures.onCount) throw new Error("host count failed");
        const col = this.collection(req.collectionId);
        const count = req.filter
          ? [...col.values()].filter((d) => matchesFilter(d, req.filter as ZvecSafeFilter)).length
          : col.size;
        return { count, exact: true } as T;
      }

      case "scan": {
        const col = this.collection(req.collectionId);
        const docs = [...col.values()].filter((d) => matchesFilter(d, req.filter as ZvecSafeFilter));
        return { docs, exact: true } as T;
      }

      case "fetch": {
        if (this.failures.onFetch) throw new Error("host fetch failed");
        const col = this.collection(req.collectionId);
        const docs = (req.ids ?? []).map((id) => col.get(id)).filter((d): d is ZvecSafeDocument => Boolean(d));
        return { docs } as T;
      }

      case "query": {
        if (this.failures.onQuery) throw new Error("host query failed");
        const col = this.collection(req.collectionId);
        // The engine REJECTS an empty full-text clause rather than treating it as match-everything, so
        // a filter-only search must arrive with no `fts` at all. Modelled here because the permissive
        // version of this fake let `fts: {}` pass and every filter-only search in the contract suite
        // would have failed against the real host.
        if (req.query?.fts && !req.query.fts.queryString) {
          throw new Error("SEMANTIC_QUERY_REJECTED: an empty full-text clause is not a match-all");
        }
        const q = req.query?.fts?.queryString ?? "";
        const terms = tokens(q);

        // The filter is a PRE-filter in the real engine — applied before ranking and before top-K
        // truncation. Applying it in that order here is what makes the fake's search semantics match.
        const filter = req.query?.filter;
        const all = [...col.values()].filter((d) => (filter ? matchesFilter(d, filter) : true));

        const matched =
          terms.length === 0
            ? all
            : all
                .map((doc) => {
                  const hay = tokens(
                    `${String(doc.fields.title ?? "")} ${String(doc.fields.content ?? "")} ${String(doc.fields.tags ?? "")}`
                  );
                  const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
                  return { doc, score };
                })
                .filter((r) => r.score > 0)
                .sort((a, b) => b.score - a.score || String(a.doc.id).localeCompare(String(b.doc.id)))
                .map((r) => r.doc);

        const topK = req.query?.topK ?? matched.length;
        // The host reports the PRE-truncation total (via a count-only second pass); model that here,
        // otherwise the adapter's totalMatched handling is never exercised.
        return {
          docs: matched.slice(0, topK),
          truncated: matched.length > topK,
          totalMatched: matched.length,
          totalExact: true
        } as T;
      }

      case "stats": {
        const col = this.collection(req.collectionId);
        return { docCount: col.size } as T;
      }

      case "close":
        // Mirrors the real host: closing releases the handle but does not destroy the collection.
        return { ok: true } as T;

      default:
        throw new Error(`unsupported request: ${req.type}`);
    }
  }

  private collection(id: string | undefined): Map<string, ZvecSafeDocument> {
    const col = id ? this.collections.get(id) : undefined;
    if (!col) throw new Error("unknown collection");
    return col;
  }
}
