/**
 * An in-process stand-in for the Zvec utility host, speaking the real `ZvecHostRequest` wire shapes.
 *
 * This exists so `ZvecSemanticStore` can be driven through the SHARED contract suite without a
 * native host or a packaged build. It is a transport fake, not a store fake — the adapter's own
 * logic (field projection, existence pre-reads, filter application, re-validation on read) runs
 * unmodified, which is the part that can actually be wrong.
 *
 * What it deliberately does NOT prove: native crash behaviour, real FTS ranking quality, on-disk
 * durability, or process isolation. Those need the real host and are covered by
 * `verify:zvec-packaged-live`. Treating a green run here as evidence of native correctness would be
 * exactly the "passes its own tests" trap the shared suite exists to prevent.
 *
 * Framework-agnostic: no Electron, no filesystem.
 */

import type { ZvecSafeDocument } from "./contracts/ZvecHostProtocol";
import type { ZvecHostTransport } from "./ZvecSemanticStore";

export interface FakeZvecFailureInjection {
  onOpen?: boolean;
  onUpsert?: boolean;
  onDelete?: boolean;
  onQuery?: boolean;
  onFetch?: boolean;
}

interface FakeRequest {
  type: string;
  collectionId?: string;
  ids?: string[];
  docs?: ZvecSafeDocument[];
  query?: { fts?: { queryString?: string }; topK?: number };
}

/** Same tokenizer rule as the in-memory store, so FTS behaviour is comparable across implementations. */
function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
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
        for (const doc of req.docs ?? []) col.set(doc.id, doc);
        return { ok: true } as T;
      }

      case "delete": {
        if (this.failures.onDelete) throw new Error("host delete failed");
        const col = this.collection(req.collectionId);
        for (const id of req.ids ?? []) col.delete(id);
        return { ok: true } as T;
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
        const q = req.query?.fts?.queryString ?? "";
        const terms = tokens(q);
        const all = [...col.values()];

        // An empty query returns everything (the adapter relies on this for stats/clear); a
        // non-empty one matches any term against title+content+tags, ranked by hit count.
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

        return { docs: matched.slice(0, req.query?.topK ?? matched.length) } as T;
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
