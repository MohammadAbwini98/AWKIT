/**
 * The shared `SemanticStore` contract suite.
 *
 * One set of assertions, run against EVERY implementation. This lives in `src/` rather than in the
 * verifier script on purpose: the Zvec adapter's own verifier imports and runs the identical suite,
 * so the two implementations cannot drift into "passes its own tests" territory. A behaviour that
 * the in-memory store implements and Zvec does not becomes a failing check rather than a discovery
 * made later in production.
 *
 * The suite takes a FACTORY, not a store, because several checks need a fresh, isolated store (and
 * a real backend may need per-case temp directories).
 *
 * Framework-agnostic: no Electron, no filesystem, no Zvec, no test framework.
 */

import {
  semanticIds,
  semanticSourceHash,
  type SemanticDocumentKind,
  type SemanticOutcome
} from "./contracts/SemanticDocument";
import { buildValidatedDocument, type ValidatedSemanticDocument } from "./SemanticPolicyValidator";
import { SemanticStoreError, type SemanticStore } from "./SemanticStore";

export interface ContractCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export type SemanticStoreFactory = () => Promise<SemanticStore>;

/** Build a valid document through the REAL pipeline — the suite never fabricates a branded doc. */
export function contractDocument(options: {
  kind?: SemanticDocumentKind;
  entityId: string;
  revision?: string;
  title: string;
  body: string;
  workflowId?: string;
  flowId?: string;
  nodeType?: string;
  hostname?: string;
  outcome?: SemanticOutcome;
  errorCategory?: string;
  tags?: string[];
  updatedAt?: string;
}): ValidatedSemanticDocument {
  const kind = options.kind ?? "workflow";
  const revision = options.revision ?? "r1";
  const source: Record<string, unknown> = {};
  // Only allowlisted fields for the kind; the pipeline drops anything else anyway.
  if (kind === "workflow") {
    source.workflowId = options.workflowId ?? options.entityId;
    source.name = options.title;
  } else if (kind === "run-failure") {
    source.runId = options.entityId;
    source.errorCategory = options.errorCategory;
    source.nodeType = options.nodeType;
    source.hostname = options.hostname;
  }

  const built = buildValidatedDocument({
    kind,
    id: kind === "workflow" ? semanticIds.workflow(options.entityId, revision) : semanticIds.runSummary(options.entityId),
    entityId: options.entityId,
    revision,
    sourceHash: semanticSourceHash([options.entityId, revision, options.body]),
    title: options.title,
    body: options.body,
    source,
    tags: options.tags,
    workflowId: options.workflowId,
    flowId: options.flowId,
    nodeType: options.nodeType,
    hostname: options.hostname,
    outcome: options.outcome,
    errorCategory: options.errorCategory,
    updatedAt: options.updatedAt
  });

  if (!built.ok) {
    throw new Error(`contract fixture failed policy validation: ${JSON.stringify(built.rejections)}`);
  }
  return built.document;
}

/**
 * Run the full contract against one implementation.
 *
 * Returns results rather than throwing/printing so the caller owns reporting, and so a failure in
 * one check never hides the checks after it.
 */
export async function runSemanticStoreContract(
  factory: SemanticStoreFactory,
  implementationName: string
): Promise<ContractCheck[]> {
  const checks: ContractCheck[] = [];
  const check = (label: string, ok: unknown, detail?: string): void => {
    checks.push({ label: `[${implementationName}] ${label}`, ok: Boolean(ok), detail });
  };

  const fresh = async (): Promise<SemanticStore> => {
    const store = await factory();
    await store.open();
    await store.clear();
    return store;
  };

  // ── lifecycle ────────────────────────────────────────────────────────────────────────────────
  {
    const store = await factory();
    let threwBeforeOpen = false;
    try {
      await store.upsert([]);
    } catch (error) {
      threwBeforeOpen = error instanceof SemanticStoreError;
    }
    check("writing before open() is a typed SemanticStoreError", threwBeforeOpen);
    await store.open();
    check("name is reported", typeof store.name === "string" && store.name.length > 0);
    await store.close();
    let threwAfterClose = false;
    try {
      await store.get("x");
    } catch (error) {
      threwAfterClose = error instanceof SemanticStoreError;
    }
    check("reading after close() is a typed SemanticStoreError", threwAfterClose);
  }

  // ── upsert is REPLACE ────────────────────────────────────────────────────────────────────────
  {
    const store = await fresh();
    const first = contractDocument({ entityId: "wf-1", title: "Login", body: "original body" });
    const again = contractDocument({ entityId: "wf-1", title: "Login", body: "original body" });

    const r1 = await store.upsert([first]);
    check("a new document counts as inserted", r1.inserted === 1 && r1.replaced === 0, JSON.stringify(r1));

    const r2 = await store.upsert([again]);
    check("re-upserting the same id counts as replaced", r2.replaced === 1 && r2.inserted === 0, JSON.stringify(r2));

    const stats = await store.stats();
    check("upsert is replace — the store holds ONE document, not two", stats.documents === 1, String(stats.documents));

    // The deterministic id is what makes this work; prove the fixture actually reused it.
    check("the deterministic id is stable across identical projections", first.id === again.id);
    await store.close();
  }

  // ── get / delete idempotence ─────────────────────────────────────────────────────────────────
  {
    const store = await fresh();
    const doc = contractDocument({ entityId: "wf-2", title: "Checkout", body: "cart and payment" });
    await store.upsert([doc]);

    const got = await store.get(doc.id);
    check("get() returns the stored document", got?.id === doc.id);
    check("get() of an unknown id returns null, not an error", (await store.get("workflow:nope:r1")) === null);

    check("delete() reports how many were removed", (await store.delete([doc.id])) === 1);
    check("delete() of an absent id is idempotent, not an error", (await store.delete([doc.id])) === 0);
    check("the document is gone after delete", (await store.get(doc.id)) === null);
    await store.close();
  }

  // ── deleteByEntity spans revisions ───────────────────────────────────────────────────────────
  {
    const store = await fresh();
    await store.upsert([
      contractDocument({ entityId: "wf-3", revision: "r1", title: "A", body: "one" }),
      contractDocument({ entityId: "wf-3", revision: "r2", title: "A", body: "two" }),
      contractDocument({ entityId: "wf-4", revision: "r1", title: "B", body: "other" })
    ]);
    check("different revisions are distinct documents", (await store.stats()).documents === 3);
    check("deleteByEntity removes every revision of one entity", (await store.deleteByEntity("wf-3")) === 2);
    check("deleteByEntity leaves other entities alone", (await store.stats()).documents === 1);
    await store.close();
  }

  // ── search: matching, filtering, bounding, ordering ──────────────────────────────────────────
  {
    const store = await fresh();
    await store.upsert([
      contractDocument({ entityId: "wf-a", title: "Login workflow", body: "signs in the user", workflowId: "wf-a", tags: ["auth"] }),
      contractDocument({ entityId: "wf-b", title: "Checkout workflow", body: "payment and cart", workflowId: "wf-b" }),
      contractDocument({
        kind: "run-failure",
        entityId: "run-1",
        title: "Timeout",
        body: "click timed out",
        workflowId: "wf-a",
        nodeType: "click",
        hostname: "app.example.com",
        outcome: "failure",
        errorCategory: "timeout"
      })
    ]);

    const login = await store.search({ text: "login" });
    check("search finds a title match", login.hits.some((h) => h.title.includes("Login")), JSON.stringify(login.hits.map((h) => h.title)));
    check("search reports totalMatched", login.totalMatched >= 1);
    check("hits carry explainable reasons", login.hits[0]?.reasons.length > 0);
    check("a title match is explained as such", login.hits[0]?.reasons.some((r) => /title/i.test(r)), JSON.stringify(login.hits[0]?.reasons));

    const none = await store.search({ text: "zzzznotpresent" });
    check("a non-matching query returns no hits", none.hits.length === 0);

    const byKind = await store.search({ text: "", kinds: ["run-failure"] });
    check("filtering by kind excludes other kinds", byKind.hits.every((h) => h.kind === "run-failure") && byKind.hits.length === 1);

    const byWorkflow = await store.search({ text: "", workflowId: "wf-a" });
    check("filtering by workflowId works", byWorkflow.hits.every((h) => h.workflowId === "wf-a"));

    const byOutcome = await store.search({ text: "", outcome: "failure" });
    check("filtering by outcome works", byOutcome.hits.length === 1 && byOutcome.hits[0].kind === "run-failure");

    const byHost = await store.search({ text: "", hostname: "app.example.com" });
    check("filtering by hostname works", byHost.hits.length === 1);

    const byCategory = await store.search({ text: "", errorCategory: "timeout" });
    check("filtering by errorCategory works", byCategory.hits.length === 1);

    const combined = await store.search({ text: "", workflowId: "wf-a", kinds: ["workflow"] });
    check("filters combine with AND semantics", combined.hits.length === 1 && combined.hits[0].kind === "workflow");

    const bounded = await store.search({ text: "", topK: 1 });
    check("topK bounds the hits", bounded.hits.length === 1);
    check("totalMatched reports the pre-truncation count", bounded.totalMatched >= 2, String(bounded.totalMatched));

    const huge = await store.search({ text: "", topK: 100000 });
    check("an absurd topK is clamped rather than honoured", huge.hits.length <= 100);

    // Determinism: identical queries must return identical order.
    const a = await store.search({ text: "workflow" });
    const b = await store.search({ text: "workflow" });
    check(
      "identical queries return identical ordering",
      JSON.stringify(a.hits.map((h) => h.documentId)) === JSON.stringify(b.hits.map((h) => h.documentId))
    );

    const modeDegraded = await store.search({ text: "login", mode: "vector" });
    check("an unsupported mode is reported as degraded, never silently faked", modeDegraded.degraded === true);
    check("a full-text query is not marked degraded", (await store.search({ text: "login", mode: "fullText" })).degraded === false);

    await store.close();
  }

  // ── search never leaks unredacted content ────────────────────────────────────────────────────
  {
    const store = await fresh();
    await store.upsert([
      contractDocument({
        entityId: "wf-secret",
        title: "Session flow",
        body: "visited https://app.example.com/cb?token=SHOULDNOTAPPEAR and used password=ALSONOT"
      })
    ]);
    const res = await store.search({ text: "session" });
    const serialized = JSON.stringify(res);
    check("stored content carries no secret from the source body", !serialized.includes("SHOULDNOTAPPEAR"));
    check("stored content carries no password from the source body", !serialized.includes("ALSONOT"));
    await store.close();
  }

  // ── clear + stats ────────────────────────────────────────────────────────────────────────────
  {
    const store = await fresh();
    await store.upsert([
      contractDocument({ entityId: "wf-x", title: "X", body: "x" }),
      contractDocument({ kind: "run-failure", entityId: "run-x", title: "Y", body: "y", errorCategory: "timeout" })
    ]);
    const stats = await store.stats();
    check("stats reports a per-kind breakdown", (stats.byKind.workflow ?? 0) === 1 && (stats.byKind["run-failure"] ?? 0) === 1, JSON.stringify(stats.byKind));
    await store.clear();
    check("clear empties the store", (await store.stats()).documents === 0);
    check("search after clear returns nothing", (await store.search({ text: "" })).hits.length === 0);
    await store.close();
  }

  // ── empty batches ────────────────────────────────────────────────────────────────────────────
  {
    const store = await fresh();
    const empty = await store.upsert([]);
    check("an empty upsert batch is a no-op, not an error", empty.inserted === 0 && empty.replaced === 0);
    check("an empty delete batch is a no-op", (await store.delete([])) === 0);
    await store.close();
  }

  return checks;
}
