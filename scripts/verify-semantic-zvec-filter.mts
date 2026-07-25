/**
 * Typed Zvec filters — asserted against the REAL native binding, not against a fake.
 *
 * This verifier exists because the previous round of this work concluded from the TypeScript types
 * alone that the vendor had no scan or filter capability, and shipped `UNSUPPORTED_OPERATION` on that
 * basis. The types were incomplete; the capability existed. So every claim this subsystem now makes
 * about the filter grammar is checked here by EXECUTING it:
 *
 *  - equality is a single `=` (`==` is a syntax error, which no type signature reveals);
 *  - `filter` is a PRE-filter, applied before ranking and before top-K truncation;
 *  - the vendor imposes no top-K cap — the old 100 ceiling was AWKIT's own;
 *  - a `nullable` string field REJECTS an explicit null; absence must be written by omission;
 *  - no escaper is safe for arbitrary strings, so unsafe values are REFUSED rather than escaped.
 *
 * It also keeps the host's independent copy of the filter builder honest. The host must build the
 * expression itself — otherwise the "no raw expression crosses the boundary" guarantee is cosmetic —
 * so the duplicate is checked for drift against the TypeScript source here.
 *
 * The binding is required directly (raw CommonJS, plain `require`), never through the host module:
 * the host refuses to run outside a utilityProcess, and bundling it is what caused the Phase 0B hard
 * crash. Skips loudly if `@zvec/zvec` is absent rather than passing vacuously.
 *
 * Run: npx tsx scripts/verify-semantic-zvec-filter.mts
 */

import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  ZVEC_FILTERABLE_FIELDS,
  ZvecFilterError,
  buildZvecFilterExpression,
  entityFilter,
  isFilterSafeString,
  matchAllFilter,
  type ZvecSafeFilter
} from "@src/semantic/contracts/ZvecFilter";
import { SEMANTIC_SCHEMA } from "@src/semantic/ZvecSemanticStore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

let passed = 0;
let failed = 0;

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function expression(filter: ZvecSafeFilter): string {
  return buildZvecFilterExpression(filter);
}

function refuses(label: string, build: () => unknown, expectedCode?: string): void {
  let code = "";
  try {
    build();
    code = "resolved";
  } catch (error) {
    code = error instanceof ZvecFilterError ? error.code : "wrong-error-type";
  }
  check(label, expectedCode ? code === expectedCode : code !== "resolved" && code !== "wrong-error-type", code);
}

// ── 1. The builder's own rules ────────────────────────────────────────────────────────────────────

console.log("Filter builder — structure:\n");

check("equality renders a single '=' (the grammar rejects '==')", expression(entityFilter("e1")) === 'entityId = "e1"', expression(entityFilter("e1")));
check("IN renders parentheses, not brackets", expression({ all: [{ field: "kind", op: "in", values: ["workflow", "flow"] }] }) === 'kind IN ("workflow", "flow")');
check("isNull renders IS NULL", expression({ all: [{ field: "nodeType", op: "isNull" }] }) === "nodeType IS NULL");
check("neq renders '!='", expression({ all: [{ field: "kind", op: "neq", value: "flow" }] }) === 'kind != "flow"');
check("numbers render unquoted", expression(matchAllFilter()) === "schemaVersion >= 0");
check(
  "multiple clauses are parenthesised and ANDed",
  expression({ all: [{ field: "kind", op: "eq", value: "flow" }, { field: "entityId", op: "eq", value: "e1" }] }) ===
    '(kind = "flow") AND (entityId = "e1")'
);

refuses("an EMPTY clause list is refused, never treated as match-everything", () => expression({ all: [] }), "FILTER_EMPTY");
refuses("a field outside the allowlist is refused", () => expression({ all: [{ field: "content" as never, op: "eq", value: "x" }] }), "FILTER_UNKNOWN_FIELD");
refuses("an empty IN list is refused", () => expression({ all: [{ field: "kind", op: "in", values: [] }] }), "FILTER_IN_EMPTY");
refuses("a non-finite number is refused", () => expression({ all: [{ field: "schemaVersion", op: "gte", value: Number.NaN }] }), "FILTER_VALUE_TYPE");
refuses("a non-scalar value is refused", () => expression({ all: [{ field: "kind", op: "eq", value: {} as never }] }), "FILTER_VALUE_TYPE");

console.log("\nFilter builder — value safety (a refusal, not an escaper):\n");

check("a plain value is safe", isFilterSafeString("workflow-1"));
check("a value containing a quote is safe (escaped as \\\")", isFilterSafeString('has"quote'));
check("a BACKSLASH makes a value unsafe", !isFilterSafeString("ends-with\\"));
// Written as ESCAPE SEQUENCES, never literal control bytes. A raw control character is invisible in
// a diff and is silently eaten by an editor or a copy/paste round trip — `verify:source-hygiene`
// enforces this, and it caught exactly that mistake in the first draft of this very file.
check("a NUL makes a value unsafe", !isFilterSafeString("has\u0000nul"));
check("a DEL makes a value unsafe", !isFilterSafeString("has\u007Fdel"));
check("a newline makes a value unsafe", !isFilterSafeString("has\nnewline"));
check("the unit separator that delimits tags makes a value unsafe", !isFilterSafeString("a\u001Fb"));
refuses("an unsafe value is refused rather than escaped", () => expression(entityFilter("bad\\value")), "FILTER_VALUE_UNSAFE");
check("a quote is escaped, not rejected", expression(entityFilter('a"b')) === 'entityId = "a\\"b"', expression(entityFilter('a"b')));

// ── 2. The host's independent duplicate must not drift ────────────────────────────────────────────

console.log("\nHost duplicate (the copy that actually runs):\n");

const hostSource = readFileSync(join(ROOT, "native-hosts", "zvec", "zvec-host.cjs"), "utf8");

const hostFieldBlock = /const FILTERABLE_FIELDS = new Set\(\[([\s\S]*?)\]\)/.exec(hostSource);
check("the host declares its own FILTERABLE_FIELDS allowlist", Boolean(hostFieldBlock));
if (hostFieldBlock) {
  const hostFields = [...hostFieldBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const expected = [...ZVEC_FILTERABLE_FIELDS];
  check(
    "the host allowlist matches the TypeScript allowlist exactly",
    hostFields.length === expected.length && expected.every((f) => hostFields.includes(f)),
    `host=${hostFields.join(",")} ts=${expected.join(",")}`
  );
}

check("the host builds the expression itself (no caller-supplied expression)", hostSource.includes("function buildFilterExpression"));
check("the host refuses an empty clause list", /Array\.isArray\(filter\.all\)[\s\S]{0,120}SEMANTIC_FILTER_INVALID/.test(hostSource));
check("the host rejects backslash values", hostSource.includes('value.includes("\\\\")'));
check("the host rejects control characters", hostSource.includes("code < 0x20") && hostSource.includes("code === 0x7f"));
check("the host uses a single '=' for equality", hostSource.includes("${clause.field} = ${renderFilterScalar(clause.value)}"));
check(
  "the host verifies a filtered delete by re-scanning",
  hostSource.includes("SEMANTIC_DELETE_INCOMPLETE") && /after\.rows\.length > 0/.test(hostSource)
);
check("the host checks deleteByFilterSync's status object", /status\.ok/.test(hostSource));
check("the host reports an inexact scan rather than truncating", hostSource.includes("SEMANTIC_SCAN_BOUND_EXCEEDED"));
check("the 100-document top-K cap is gone", !/Math\.min\(Number\(q\.topK\) \|\| 20, 100\)/.test(hostSource));
check("optional fields are normalised by OMISSION, not null", hostSource.includes("function normalizeDocumentFields"));

// Every filterable field must exist in the shipped schema, or a filter would name a column that is
// not there — the kind of drift that only shows up as a runtime error on a real collection.
const schemaFieldNames = SEMANTIC_SCHEMA.fields.map((f) => f.name);
const orphaned = ZVEC_FILTERABLE_FIELDS.filter((f) => !schemaFieldNames.includes(f));
check("every filterable field exists in SEMANTIC_SCHEMA", orphaned.length === 0, orphaned.join(","));
check("SEMANTIC_SCHEMA uses dataType (the field the host reads)", SEMANTIC_SCHEMA.fields.every((f) => typeof f.dataType === "string"));
check(
  "every optional filter dimension is declared nullable",
  ["workflowId", "flowId", "nodeType", "hostname", "outcome", "errorCategory"].every(
    (name) => SEMANTIC_SCHEMA.fields.find((f) => f.name === name)?.nullable === true
  )
);

// ── 3. The real binding ───────────────────────────────────────────────────────────────────────────

const require_ = createRequire(import.meta.url);
const zvecDir = join(ROOT, "node_modules", "@zvec", "zvec");

if (!existsSync(zvecDir)) {
  console.error("\n✗ @zvec/zvec is NOT installed — the real-binding checks did not run.");
  console.error("  This verifier refuses to pass vacuously; run `npm install` and re-run.");
  process.exit(1);
}

console.log("\nReal binding — grammar and semantics (executed, not assumed):\n");

/* eslint-disable @typescript-eslint/no-explicit-any */
const zvec: any = require_(join(zvecDir, "src", "index.js"));
const workDir = mkdtempSync(join(tmpdir(), "awkit-zvec-filter-"));
const collectionPath = join(workDir, "collection");

try {
  // Mirror the shipped schema translation so what is exercised here is what the host would create.
  const fields = SEMANTIC_SCHEMA.fields.map((f) => {
    const field: Record<string, unknown> = { name: f.name, dataType: zvec.ZVecDataType[f.dataType] };
    if (f.nullable === true) field.nullable = true;
    if (f.fts) field.indexParams = { indexType: zvec.ZVecIndexType.FTS, tokenizerName: "standard" };
    else if (f.invert === true) field.indexParams = { indexType: zvec.ZVecIndexType.INVERT };
    return field;
  });
  check("the shipped schema translates to real dataTypes", fields.every((f) => typeof f.dataType === "number"));

  const collection = zvec.ZVecCreateAndOpen(
    collectionPath,
    new zvec.ZVecCollectionSchema({ name: "awkit-filter-probe", fields })
  );

  const base = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id,
    fields: {
      id,
      kind: "run-failure",
      entityId: "entity-plain",
      revision: "r1",
      sourceHash: "a".repeat(64),
      schemaVersion: 1,
      title: `T-${id}`,
      content: `alpha shared token ${id}`,
      tags: "t1",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
      ...over
    }
  });

  // 1500 documents: past the removed 100 cap AND past the vendor's 1024-per-batch write limit.
  const TOTAL = 1500;
  const docs: Record<string, unknown>[] = [];
  for (let i = 0; i < TOTAL; i += 1) {
    docs.push(
      base(`doc-${String(i).padStart(5, "0")}`, {
        entityId: i < 130 ? "entity-big" : `entity-${i}`,
        kind: i % 2 === 0 ? "run-failure" : "workflow",
        // The needle is LAST, so an unfiltered top-K cannot reach it.
        content: i === TOTAL - 1 ? "alpha shared token uniqueneedle" : `alpha shared token ${i}`,
        ...(i % 3 === 0 ? { nodeType: "click" } : {})
      })
    );
  }
  // A document whose entityId contains a quote — safe, and it must not be confused with any other.
  docs.push(base("doc-quoted", { entityId: 'quo"ted' }));

  let writeOk = true;
  for (let offset = 0; offset < docs.length; offset += 1024) {
    const statuses = collection.upsertSync(docs.slice(offset, offset + 1024));
    if (statuses.some((s: { ok: boolean }) => !s.ok)) writeOk = false;
  }
  check(`writes ${docs.length} documents in 1024-row chunks`, writeOk);
  check("stats.docCount is exact", collection.stats.docCount === docs.length, String(collection.stats.docCount));

  const runFilter = (filter: ZvecSafeFilter, topk = 5000): any[] =>
    collection.querySync({ filter: expression(filter), topk, includeVector: false });

  // -- the removed ceiling --
  const allRows = runFilter(matchAllFilter());
  check(
    `a filter-only scan returns ALL ${docs.length} rows (the 100 cap was AWKIT's own)`,
    allRows.length === docs.length,
    String(allRows.length)
  );
  const ftsAll = collection.querySync({ fieldName: "content", fts: { queryString: "alpha" }, topk: 1500 });
  check("the vendor honours topk=1500 for a full-text query", ftsAll.length === 1500, String(ftsAll.length));

  // -- rows carry field values, not just ids --
  check("scan rows carry field values", typeof allRows[0]?.fields?.entityId === "string");
  const fetched = collection.fetchSync({ ids: ["doc-00000", "missing"], includeVector: false });
  check("fetch returns documents keyed by id, absent ids omitted", Boolean(fetched["doc-00000"]) && !fetched["missing"]);
  check("fetched rows carry field values", typeof fetched["doc-00000"]?.fields?.kind === "string");

  // -- the discriminating pre-filter proof --
  const needleUnfiltered = collection.querySync({ fieldName: "content", fts: { queryString: "alpha" }, topk: 10 });
  const needleFiltered = collection.querySync({
    fieldName: "content",
    fts: { queryString: "alpha" },
    filter: expression(entityFilter(`entity-${TOTAL - 1}`)),
    topk: 10
  });
  check(
    "WITHOUT a filter, topk=10 does not reach the last-ranked match (negative control)",
    !needleUnfiltered.some((r: { id: string }) => r.id === `doc-0${TOTAL - 1}`),
    needleUnfiltered.map((r: { id: string }) => r.id).join(",")
  );
  check(
    "WITH a filter, the same topk=10 finds it — the filter is applied BEFORE ranking",
    needleFiltered.length === 1 && needleFiltered[0].id === `doc-0${TOTAL - 1}`,
    needleFiltered.map((r: { id: string }) => r.id).join(",")
  );

  // -- the two-pass exact total the host uses for `totalMatched` --
  // `outputFields: []` is what keeps the counting pass from materialising document bodies. Its
  // behaviour on a QUERY is not documented (only on fetch), so it is measured here rather than
  // assumed — if it silently returned zero rows, every total would read as 0.
  const page = collection.querySync({ fieldName: "content", fts: { queryString: "alpha" }, topk: 10, includeVector: false });
  const countingPass = collection.querySync({
    fieldName: "content",
    fts: { queryString: "alpha" },
    topk: 100_000,
    outputFields: [],
    includeVector: false
  });
  check("a truncated page returns exactly topK rows", page.length === 10, String(page.length));
  check(
    "the count-only pass returns EVERY match, not the page (this is totalMatched)",
    countingPass.length === docs.length,
    `${countingPass.length} vs ${docs.length}`
  );
  check("outputFields: [] still returns ids", typeof countingPass[0]?.id === "string");
  check(
    "outputFields: [] omits scalar fields, so counting transfers no document bodies",
    Object.keys(countingPass[0]?.fields ?? {}).length === 0,
    JSON.stringify(countingPass[0]?.fields)
  );

  // -- operators behave as rendered --
  check("eq matches exactly the intended rows", runFilter(entityFilter("entity-big")).length === 130);
  check(
    "IN matches the union",
    runFilter({ all: [{ field: "kind", op: "in", values: ["run-failure", "workflow"] }] }).length === docs.length
  );
  check(
    "AND narrows",
    runFilter({
      all: [
        { field: "entityId", op: "eq", value: "entity-big" },
        { field: "kind", op: "eq", value: "workflow" }
      ]
    }).length === 65
  );
  check("IS NULL matches OMITTED optionals", runFilter({ all: [{ field: "nodeType", op: "isNull" }] }).length === docs.length - 500);
  check("a quote-bearing value matches exactly one row", runFilter(entityFilter('quo"ted')).length === 1);
  check(
    "a quote-bearing value does NOT widen the match",
    runFilter(entityFilter('quo"ted'))[0]?.id === "doc-quoted"
  );

  // -- the nullable-null quirk, guarded so it cannot regress --
  let nullRejected = false;
  try {
    const st = collection.upsertSync([base("null-probe", { nodeType: null })]);
    nullRejected = st.some((s: { ok: boolean }) => !s.ok);
  } catch {
    nullRejected = true;
  }
  check("an explicit null on a nullable field is REJECTED by the binding (write by omission)", nullRejected);

  // -- entity delete completeness, over the old ceiling --
  const bigBefore = runFilter(entityFilter("entity-big")).length;
  const delStatus = collection.deleteByFilterSync(expression(entityFilter("entity-big")));
  check("deleteByFilter reports a status object rather than throwing", typeof delStatus?.ok === "boolean");
  check("deleteByFilter succeeds", delStatus.ok === true);
  check(
    `an entity with ${bigBefore} documents (>100) is deleted COMPLETELY`,
    runFilter(entityFilter("entity-big")).length === 0
  );
  check("other entities are untouched", collection.stats.docCount === docs.length - bigBefore, String(collection.stats.docCount));

  // -- an invalid expression is reported, not silently treated as success --
  const badStatus = collection.deleteByFilterSync('entityId == "double-equals-is-invalid"');
  check("an invalid filter expression returns ok:false instead of throwing", badStatus.ok === false);
  check("...confirming an unchecked status would read as a successful delete", collection.stats.docCount === docs.length - bigBefore);

  // -- clear-everything --
  const clearStatus = collection.deleteByFilterSync(expression(matchAllFilter()));
  check("matchAll deletes every remaining document", clearStatus.ok === true && collection.stats.docCount === 0, String(collection.stats.docCount));

  collection.closeSync();
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
