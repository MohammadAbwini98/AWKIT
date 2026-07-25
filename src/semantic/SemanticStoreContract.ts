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

import type { SemanticDocumentKind, SemanticOutcome } from "./contracts/SemanticDocument";
import { projectAndValidate, type ValidatedSemanticDocument } from "./SemanticPolicyValidator";
import { SemanticStoreError, type SemanticStore } from "./SemanticStore";

export interface ContractCheck {
  label: string;
  ok: boolean;
  detail?: string;
}

export type SemanticStoreFactory = () => Promise<SemanticStore>;

/**
 * Build a valid document through the REAL pipeline — the suite never fabricates a branded doc.
 *
 * Note `body` is gone: fixtures now supply raw SOURCE fields and the kind's projector decides what
 * becomes indexable content. A fixture helper that could inject arbitrary body text would be able to
 * do something production callers cannot, which would make the suite test a path that does not exist.
 */
export function contractDocument(options: {
  kind?: SemanticDocumentKind;
  entityId: string;
  revision?: string;
  title: string;
  /** Goes into an allowlisted DESCRIPTIVE field, not into a free-form body. */
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

  const source: Record<string, unknown> = { updatedAt: options.updatedAt, tags: options.tags, revision };
  if (kind === "workflow") {
    source.workflowId = options.workflowId ?? options.entityId;
    source.name = options.title;
    source.description = options.body;
  } else if (kind === "flow") {
    source.flowId = options.entityId;
    source.workflowId = options.workflowId;
    source.name = options.title;
    source.description = options.body;
  } else if (kind === "run-failure") {
    source.runId = options.entityId;
    source.attemptId = revision;
    source.errorCategory = options.errorCategory ?? "timeout";
    source.errorSummary = options.body;
    source.nodeType = options.nodeType;
    source.hostname = options.hostname;
    source.workflowId = options.workflowId;
    source.outcome = options.outcome;
  } else if (kind === "run-summary") {
    source.runId = options.entityId;
    source.workflowId = options.workflowId;
    source.hostname = options.hostname;
    source.outcome = options.outcome;
  } else if (kind === "documentation") {
    source.relativePath = options.entityId;
    source.title = options.title;
    source.body = options.body;
  }

  const built = projectAndValidate(kind, source);
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

  const probe = await factory();
  const supportsEntityOps = probe.capabilities.entityOperations;

  const fresh = async (): Promise<SemanticStore> => {
    const store = await factory();
    await store.open();
    if (supportsEntityOps) await store.clear();
    return store;
  };

  /** Assert an unsupported operation REFUSES rather than returning a plausible partial result. */
  const expectUnsupported = async (label: string, operation: () => Promise<unknown>): Promise<void> => {
    let code = "";
    try {
      await operation();
      code = "resolved";
    } catch (error) {
      code = error instanceof SemanticStoreError ? error.code : "wrong-error-type";
    }
    check(`${label} refuses with UNSUPPORTED_OPERATION rather than a partial result`, code === "UNSUPPORTED_OPERATION", code);
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

    if (supportsEntityOps) {
      const stats = await store.stats();
      check("upsert is replace — the store holds ONE document, not two", stats.documents === 1, String(stats.documents));
    } else {
      // Without a scan the count is unavailable, so replacement is proven through the id instead:
      // one id maps to one document, and the second write reported `replaced`.
      check("upsert is replace — the second write replaced rather than inserted", r2.replaced === 1 && r2.inserted === 0);
      check("both writes targeted one id", first.id === again.id);
    }

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

  // ── current-state identity: a new revision REPLACES ──────────────────────────────────────────
  {
    const store = await fresh();
    const r1 = contractDocument({ entityId: "wf-3", revision: "r1", title: "A", body: "one" });
    const r2 = contractDocument({ entityId: "wf-3", revision: "r2", title: "A", body: "two" });

    check("two revisions of a current-state entity share one id", r1.id === r2.id, `${r1.id} vs ${r2.id}`);

    await store.upsert([r1]);
    const second = await store.upsert([r2]);
    if (supportsEntityOps) {
      check("re-indexing a new revision does NOT accumulate documents", (await store.stats()).documents === 1, String((await store.stats()).documents));
    } else {
      check("re-indexing a new revision REPLACES rather than inserting", second.replaced === 1 && second.inserted === 0, JSON.stringify(second));
    }

    const live = await store.get(r1.id);
    check("the stored document is the NEWER revision", live?.revision === "r2", live?.revision);
    check("the revision survives as a field", live?.revision !== undefined);
    await store.close();
  }

  // ── historical identity: each occurrence is its own document ─────────────────────────────────
  {
    const store = await fresh();
    const docs = [
      contractDocument({ kind: "run-failure", entityId: "run-3", revision: "a1", title: "T", body: "first attempt" }),
      contractDocument({ kind: "run-failure", entityId: "run-3", revision: "a2", title: "T", body: "second attempt" }),
      contractDocument({ kind: "run-failure", entityId: "run-4", revision: "a1", title: "T", body: "other run" })
    ];
    check("two attempts of one run have distinct ids", docs[0].id !== docs[1].id);
    await store.upsert(docs);

    if (supportsEntityOps) {
      check("historical occurrences are distinct documents", (await store.stats()).documents === 3, String((await store.stats()).documents));
      check("deleteByEntity removes every occurrence of one entity", (await store.deleteByEntity("run-3")) === 2);
      check("deleteByEntity leaves other entities alone", (await store.stats()).documents === 1);
    } else {
      // The backend cannot enumerate the collection, so these must REFUSE. Asserting the refusal is
      // what stops a silently-truncated delete from passing as success.
      await expectUnsupported("deleteByEntity", () => store.deleteByEntity("run-3"));
      await expectUnsupported("stats", () => store.stats());
      await expectUnsupported("clear", () => store.clear());
      check("documents written before the unsupported call are still retrievable", (await store.get(docs[0].id)) !== null);
    }
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

  // ── hostile entity identities must still be deletable ────────────────────────────────────────
  //
  // This is the check that justifies the derived `entityKey`. Filtering by raw `entityId` forced a
  // choice between corrupting the value and refusing it; refusal is fail-closed but leaves a
  // legitimate entity permanently stuck in the index. Every identity below is one a real AWKIT user
  // can produce — a Windows path, a name with an apostrophe, a non-Latin script — and every one must
  // be removable. A store that reports 0 removed here is failing, not being careful.
  if (supportsEntityOps) {
    const hostile: ReadonlyArray<[string, string]> = [
      ["windows path", "C:\\Users\\name\\item"],
      ["single quote", "single'quote"],
      ["double quote", 'double"quote'],
      ["trailing backslash", "trailing\\"],
      ["non-Latin script", "Unicode-اسم"],
      ["newline", "has\nnewline"],
      ["unit separator", "has\u001Fseparator"],
      ["nul", "has\u0000nul"],
      ["filter-ish payload", '" OR schemaVersion >= 0 OR entityId = "'],
      ["decomposed unicode", "cafe\u0301-entity"]
    ];

    for (const [label, entityId] of hostile) {
      const store = await fresh();
      await store.upsert([
        contractDocument({ entityId, title: `Hostile ${label}`, body: "removable content" }),
        contractDocument({ entityId: "bystander", title: "Bystander", body: "must survive" })
      ]);

      // A REFUSAL is recorded as a failure of this check, not allowed to abort the suite. That is the
      // failure mode being guarded: filtering by raw `entityId` makes these identities throw
      // (unrepresentable value) or match nothing, and either way the entity is stuck in the index.
      let removed = -1;
      let refusal = "";
      try {
        removed = await store.deleteByEntity(entityId);
      } catch (error) {
        refusal = error instanceof SemanticStoreError ? error.code : "unexpected-error-type";
      }
      check(
        `[hostile] an entityId with a ${label} is deletable`,
        removed === 1,
        refusal ? `refused with ${refusal}` : `removed=${removed}`
      );
      check(
        `[hostile] deleting a ${label} identity leaves other entities alone`,
        (await store.stats()).documents === 1,
        String((await store.stats()).documents)
      );
      await store.close();
    }

    // NFC/NFD: the same identifier in two composition forms is ONE entity, so a delete issued with
    // either spelling must remove it. Without normalization in the key derivation this passes for the
    // form that was written and silently reports success for the other.
    const store = await fresh();
    const composed = "caf\u00E9-entity";
    const decomposed = "cafe\u0301-entity";
    await store.upsert([contractDocument({ entityId: composed, title: "Composed", body: "content" })]);
    const removedViaOtherForm = await store.deleteByEntity(decomposed);
    check(
      "[hostile] a Unicode-decomposed spelling deletes the composed entity (NFC-normalized key)",
      removedViaOtherForm === 1,
      `removed=${removedViaOtherForm}`
    );
    await store.close();
  }

  // ── totalMatched past the internal fetch window ──────────────────────────────────────────────
  //
  // The `topK: 1` assertion above CANNOT catch the failure this guards. That fixture holds three
  // documents, so a store reporting "every candidate I fetched" and a store reporting "every
  // document that matched" produce the same number — the check passes with the defect present
  // (confirmed by negative control). The defect only appears once matches exceed the window the
  // adapter fetches, at which point a truncated page length silently becomes the reported total and
  // "showing 20 of 137" reads as "20 of 100".
  {
    const store = await fresh();
    const MANY = 130;
    const docs = [];
    for (let i = 0; i < MANY; i += 1) {
      docs.push(contractDocument({ entityId: `bulk-${i}`, title: `Bulk ${i}`, body: "sharedbulkterm appears in every one" }));
    }
    await store.upsert(docs);

    const page = await store.search({ text: "sharedbulkterm", topK: 20 });
    check(`[window] a query matching ${MANY} documents returns only the requested topK`, page.hits.length === 20, String(page.hits.length));
    check(
      `[window] totalMatched is the true total (${MANY}), not the page or the fetch ceiling`,
      page.totalMatched === MANY,
      String(page.totalMatched)
    );
    check("[window] an exact total is not reported as degraded", page.degraded === false);
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
  if (supportsEntityOps) {
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
