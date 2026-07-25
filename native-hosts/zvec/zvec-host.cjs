/**
 * AWKIT semantic native host — RAW, UNBUNDLED CommonJS.
 *
 * Phase 0C artifact for docs/AWKIT_ZVEC_BLOCKER_RESOLUTION_IMPLEMENTATION_PLAN.md (§4.2, §5, §7.1).
 *
 * THIS FILE MUST NEVER BE BUNDLED. Phase 0B Finding A recorded a hard native crash (no JS error,
 * no uncaughtException, process gone) the moment a Vite-bundled caller reached the first Zvec
 * collection operation, while byte-identical unbundled code passed every step. The host is
 * therefore copied verbatim by scripts/prepare-zvec-native-host.mjs and shipped through
 * electron-builder `extraResources`, never as an electron-vite input.
 *
 * It runs as an Electron utilityProcess child and speaks only the versioned message protocol
 * below over `process.parentPort`. It never touches AWKIT's authoritative JSON/SQLite stores,
 * exposes no command line, and opens no listening port.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// v2 changed `fetch` and `query` from id-only summaries to real documents and added the typed-filter
// operations. The change is deliberately NOT backward compatible: an adapter reading v2 shapes from
// a v1 host would silently misparse every row, so the `hello` compatibility gate must reject the
// pairing outright rather than let it degrade.
const PROTOCOL_VERSION = 2;

// Zvec is required from this host's OWN packaged module root (native-hosts/zvec/node_modules),
// staged adjacent to this file. Resolution never reaches into app.asar.
// eslint-disable-next-line import/no-unresolved
const zvec = require("@zvec/zvec");

/**
 * §7.1 — the main process resolves generation paths, and the host independently re-verifies them.
 * A host that trusted the caller would turn any future IPC validation gap into arbitrary
 * filesystem access, so this check is deliberately duplicated rather than shared.
 *
 * The root is fixed ONCE at process start, from the environment the manager forks with. It is
 * deliberately not taken per request: a per-request root would let a single validation gap point the
 * host anywhere, whereas a start-time root means no individual request can ever escape it. It is
 * also required for correctness — AWKIT lets the user configure its runtime data location, so a
 * hard-coded %LOCALAPPDATA% path silently ignored that setting.
 */
const SEMANTIC_RUNTIME_ROOT = path.resolve(
  process.env.AWKIT_SEMANTIC_RUNTIME_ROOT ||
    path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Local"), "SpecterStudio")
);
const APPROVED_ROOT = path.join(SEMANTIC_RUNTIME_ROOT, "semantic-index", "generations");

function assertConfinedPath(candidate) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new HostError("SEMANTIC_PATH_INVALID");
  }
  const resolved = path.resolve(candidate);
  const rel = path.relative(APPROVED_ROOT, resolved);
  // Empty rel means the caller passed the generations root itself, which is not a generation.
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new HostError("SEMANTIC_PATH_OUTSIDE_APPROVED_ROOT");
  }
  return resolved;
}

/** Errors that carry a stable, path-free reason code safe to relay toward the renderer. */
class HostError extends Error {
  constructor(reason, retryable = false) {
    super(reason);
    this.reason = reason;
    this.retryable = retryable;
  }
}

/**
 * ── Typed filters ────────────────────────────────────────────────────────────────────────────────
 *
 * Zvec's `filter` is a SQL-like expression STRING with no parameter binding. A raw expression must
 * therefore never cross this boundary: callers send the typed clause list defined in
 * `src/semantic/ZvecFilter.ts`, and the expression is assembled HERE, from an allowlist.
 *
 * This is duplicated from that module on purpose, exactly as `assertConfinedPath` duplicates
 * `isConfinedGenerationPath`. A host that accepted a caller-built expression would turn any future
 * IPC validation gap into a filter-injection path — able to widen a delete to the whole collection.
 * The two copies are kept honest by `verify:semantic-zvec-filter`, which parses this file and
 * asserts the field allowlist and value rule match the TypeScript source.
 *
 * The value rule is a REFUSAL, not an escaper, and it was measured rather than assumed. The grammar
 * reads `\"` as an escaped quote but a backslash before anything else as literal, so a value holding
 * a backslash can neither be doubled (silently matches nothing) nor left alone (a trailing backslash
 * escapes its own closing quote). Such a value is rejected. Quotes are safe, escaped as `\"`.
 */
/**
 * Raw `entityId`, `revision` and `nodeId` are deliberately ABSENT: they are unconstrained source text,
 * and entity-wide DELETION is built on identity. Refusing an unsafe value there is fail-closed but
 * leaves that entity permanently unremovable, so identity is filtered through the derived
 * fixed-alphabet `entityKey` (`sha256`, `[0-9a-f]{64}`) instead. Do not add them back.
 */
const FILTERABLE_FIELDS = new Set([
  "id",
  "kind",
  "entityKey",
  "sourceHash",
  "schemaVersion",
  "outcome",
  "hostname",
  "workflowId",
  "flowId",
  "nodeType",
  "errorCategory"
]);

function isFilterSafeString(value) {
  if (value.includes("\\")) return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function renderFilterScalar(value) {
  if (typeof value === "string") {
    if (!isFilterSafeString(value)) throw new HostError("SEMANTIC_FILTER_VALUE_UNSAFE");
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new HostError("SEMANTIC_FILTER_INVALID");
}

function renderFilterClause(clause) {
  if (!clause || typeof clause !== "object") throw new HostError("SEMANTIC_FILTER_INVALID");
  if (!FILTERABLE_FIELDS.has(clause.field)) throw new HostError("SEMANTIC_FILTER_FIELD_REJECTED");
  switch (clause.op) {
    // A single `=`; `==` is a syntax error in this grammar.
    case "eq":
      return `${clause.field} = ${renderFilterScalar(clause.value)}`;
    case "neq":
      return `${clause.field} != ${renderFilterScalar(clause.value)}`;
    case "gte":
      return `${clause.field} >= ${renderFilterScalar(clause.value)}`;
    // An omitted optional reads as NULL: the binding rejects an explicit null on a nullable field,
    // so absence is written by omission.
    case "isNull":
      return `${clause.field} IS NULL`;
    case "in": {
      if (!Array.isArray(clause.values) || clause.values.length === 0) {
        throw new HostError("SEMANTIC_FILTER_INVALID");
      }
      // Parentheses, not brackets: `IN [...]` is a syntax error.
      return `${clause.field} IN (${clause.values.map(renderFilterScalar).join(", ")})`;
    }
    default:
      throw new HostError("SEMANTIC_FILTER_INVALID");
  }
}

/**
 * Build an expression from a typed filter. An empty clause list is REFUSED rather than treated as
 * match-everything: "delete where nothing" silently meaning "delete everything" is the worst
 * available default, and a caller wanting the whole collection must say so with an explicit clause.
 */
function buildFilterExpression(filter) {
  if (!filter || !Array.isArray(filter.all) || filter.all.length === 0) {
    throw new HostError("SEMANTIC_FILTER_INVALID");
  }
  const rendered = filter.all.map(renderFilterClause);
  return rendered.length === 1 ? rendered[0] : rendered.map((r) => `(${r})`).join(" AND ");
}

/**
 * Upper bound on rows materialised by one scan or count.
 *
 * The vendor imposes no top-K cap (measured: `topk: 1500` returned 1500 rows of 1500). The previous
 * `Math.min(topK, 100)` here was AWKIT's own, and it was the entire reason entity-wide operations
 * were declared unsupported. A bound is still required so a pathological collection cannot exhaust
 * host memory — but hitting it is reported as `exact: false` rather than silently truncated, because
 * an undercount that looks precise is worse than an admitted unknown.
 */
const HOST_MAX_SCAN = 100_000;

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Locate the staged native binary so the handshake can report its hash to the main process. */
function findNativeBinary() {
  const candidate = path.join(
    __dirname,
    "node_modules",
    "@zvec",
    "bindings-win32-x64",
    "zvec_node_binding.node"
  );
  return fs.existsSync(candidate) ? candidate : null;
}

const collections = new Map();

function requireCollection(collectionId) {
  const entry = collections.get(collectionId);
  if (!entry) throw new HostError("SEMANTIC_COLLECTION_NOT_OPEN");
  return entry;
}

function buildSchema(safeSchema) {
  const fields = (safeSchema.fields || []).map((f) => {
    const field = { name: f.name, dataType: zvec.ZVecDataType[f.dataType] };
    if (f.nullable === true) field.nullable = true;
    if (f.fts) {
      field.indexParams = {
        indexType: zvec.ZVecIndexType.FTS,
        tokenizerName: f.fts.tokenizer === "jieba" ? "jieba" : "standard"
      };
    } else if (f.invert === true) {
      // An INVERT index makes a scalar filter an indexed lookup instead of a brute-force scan.
      // Filters work without it (measured), so this is a performance property, not a correctness one
      // — which matters because generations created before this flag existed still open and filter
      // correctly, just more slowly.
      field.indexParams = { indexType: zvec.ZVecIndexType.INVERT };
    }
    return field;
  });
  const vectors = (safeSchema.vectors || []).map((v) => ({
    name: v.name,
    dataType: zvec.ZVecDataType.VECTOR_FP32,
    dimension: v.dimension,
    indexParams: {
      indexType: zvec.ZVecIndexType.FLAT,
      metricType: zvec.ZVecMetricType.COSINE
    }
  }));
  const schema = { name: safeSchema.name, fields };
  if (vectors.length > 0) schema.vectors = vectors;
  return new zvec.ZVecCollectionSchema(schema);
}

/**
 * Phase 0 finding, confirmed against the real binding: insertSync/upsertSync reject a batch
 * larger than 1024 documents ("exceeds max write batch size"). The limit is absent from the
 * package's TypeScript types, so chunking lives here rather than in any caller.
 */
const MAX_WRITE_BATCH = 1024;

/**
 * Absent optional fields must be OMITTED, never sent as null.
 *
 * Measured against the real binding: a `nullable: true` STRING field rejects an explicit JS null with
 * "Expected scalar field[x] to be a string", failing the whole batch. Omission is the accepted way to
 * express absence, and it reads back as NULL for `IS NULL` filters. Normalising here rather than
 * trusting callers means one adapter writing `?? null` cannot poison every write — and a null on a
 * NON-nullable field still fails, correctly, as a missing required field.
 */
function normalizeDocumentFields(doc) {
  const fields = doc.fields || {};
  const out = {};
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    if (value === null || value === undefined) continue;
    out[key] = value;
  }
  const normalized = { id: doc.id, fields: out };
  if (doc.vectors) normalized.vectors = doc.vectors;
  return normalized;
}

function chunkedWrite(collection, method, docs) {
  let written = 0;
  const normalized = docs.map(normalizeDocumentFields);
  for (let offset = 0; offset < normalized.length; offset += MAX_WRITE_BATCH) {
    const chunk = normalized.slice(offset, offset + MAX_WRITE_BATCH);
    const statuses = collection[method](chunk);
    const failed = statuses.filter((s) => !s.ok);
    if (failed.length > 0) throw new HostError("SEMANTIC_WRITE_REJECTED");
    written += chunk.length;
  }
  return written;
}

/** Shape a vendor row as a wire document. Vectors are never returned — nothing reads them yet. */
function toWireDocument(row) {
  return { id: row.id, fields: row.fields || {} };
}

/**
 * Materialise every row matching a filter, up to `HOST_MAX_SCAN`.
 *
 * `exact` is false when the bound was reached, so a caller can refuse rather than act on a count it
 * cannot trust. Callers that only need the number pass `fieldsNeeded: false`, which asks the vendor
 * for no scalar fields at all.
 */
function scanByFilter(collection, filter, fieldsNeeded) {
  const request = {
    filter: buildFilterExpression(filter),
    topk: HOST_MAX_SCAN,
    includeVector: false
  };
  if (!fieldsNeeded) request.outputFields = [];
  const rows = collection.querySync(request);
  return { rows, exact: rows.length < HOST_MAX_SCAN };
}

const handlers = {
  hello(req) {
    const nativeBinary = findNativeBinary();
    return {
      protocolVersion: PROTOCOL_VERSION,
      versions: {
        zvec: safeVersion("@zvec/zvec"),
        binding: safeVersion("@zvec/bindings-win32-x64"),
        node: process.versions.node,
        electron: process.versions.electron || null,
        napi: process.versions.napi || null,
        platform: process.platform,
        arch: process.arch
      },
      jiebaDictDir: Boolean(zvec.ZVecGetDefaultJiebaDictDir && zvec.ZVecGetDefaultJiebaDictDir()),
      hostSourceSha256: sha256File(__filename),
      nativeBinarySha256: nativeBinary ? sha256File(nativeBinary) : null,
      approvedRootConfigured: APPROVED_ROOT,
      compatible:
        !req.expected ||
        (req.expected.protocolVersion === PROTOCOL_VERSION &&
          req.expected.platform === process.platform &&
          req.expected.arch === process.arch)
    };
  },

  open(req) {
    const resolved = assertConfinedPath(req.path);
    if (collections.has(req.generation)) throw new HostError("SEMANTIC_COLLECTION_ALREADY_OPEN");
    // Three cases, not two — and the middle one is the production case.
    //
    // `createGeneration` allocates a generation by `mkdir`-ing the directory WITHOUT `recursive`;
    // that mkdir IS its atomic claim against two rebuilds picking the same name. So every real
    // candidate arrives here as an EXISTING EMPTY directory, while MEASURED vendor behaviour is:
    //
    //   ZVecCreateAndOpen(absent dir)   -> OK
    //   ZVecCreateAndOpen(existing dir) -> throws "path validate failed", empty or not
    //   ZVecOpen(real collection dir)   -> OK
    //
    // So an existing EMPTY directory can be neither created into nor opened, and the rebuild path
    // failed at populate every single time. The empty directory is removed with `rmdirSync` — never
    // `rm -r` — because rmdir refuses a non-empty directory, so this can only ever discard a
    // directory that holds nothing.
    //
    // Invisible until the store was driven through the real generation manager: the contract suite
    // invents its own names, whose directories do not exist, so it only ever took the create path.
    const entries = fs.existsSync(resolved) ? fs.readdirSync(resolved) : null;
    let collection;
    if (entries === null) {
      collection = zvec.ZVecCreateAndOpen(resolved, buildSchema(req.schema));
    } else if (entries.length === 0) {
      fs.rmdirSync(resolved);
      collection = zvec.ZVecCreateAndOpen(resolved, buildSchema(req.schema));
    } else {
      collection = zvec.ZVecOpen(resolved);
    }
    const exists = entries !== null && entries.length > 0;
    collections.set(req.generation, { collection, path: resolved });
    // `collectionId` is the field every other request carries and the adapter reads. This used to
    // return only `generation`, so the adapter saw `collectionId: undefined` and reported
    // BACKEND_UNAVAILABLE for a collection that had in fact opened successfully — invisible until the
    // store was driven through the real host, because the transport fake returned `collectionId`.
    // `generation` is kept alongside it; the two are deliberately the same value.
    return {
      collectionId: req.generation,
      generation: req.generation,
      created: !exists,
      docCount: collection.stats.docCount
    };
  },

  upsert(req) {
    const { collection } = requireCollection(req.collectionId);
    return { written: chunkedWrite(collection, "upsertSync", req.docs || []) };
  },

  insert(req) {
    const { collection } = requireCollection(req.collectionId);
    return { written: chunkedWrite(collection, "insertSync", req.docs || []) };
  },

  /**
   * v1 returned `Object.keys(...)` — bare id strings — while the adapter read `row.id` off each
   * entry, so every fetch silently yielded undefined ids. Returning real documents is the fix, and
   * it is what makes `get`, the delete presence check, and the upsert insert/replace split work.
   */
  fetch(req) {
    const { collection } = requireCollection(req.collectionId);
    const map = collection.fetchSync({ ids: req.ids || [], includeVector: false });
    return { docs: Object.keys(map).map((id) => toWireDocument(map[id])) };
  },

  // updateSync is a true partial patch; upsertSync is insert-or-REPLACE and requires every
  // non-nullable field on each call (Phase 0 finding). They are kept as distinct operations
  // so callers cannot accidentally blank fields by patching through upsert.
  update(req) {
    const { collection } = requireCollection(req.collectionId);
    const status = collection.updateSync({ id: req.docId, fields: req.fields || {} });
    if (!status.ok) throw new HostError("SEMANTIC_UPDATE_REJECTED");
    return { updated: req.docId };
  },

  delete(req) {
    const { collection } = requireCollection(req.collectionId);
    const statuses = collection.deleteSync(req.ids || []);
    if (statuses.some((s) => !s.ok)) throw new HostError("SEMANTIC_DELETE_REJECTED");
    return { deleted: statuses.length };
  },

  /**
   * Delete every document matching a typed filter, and PROVE it.
   *
   * `deleteByFilterSync` reports `{ok:true}` whether it removed 500 rows or none, so the count is
   * established by scanning first and the removal is confirmed by re-scanning after. That end-to-end
   * check is what makes the reported number trustworthy regardless of how the expression was built:
   * a residual match means the delete under-removed, which is reported as a failure rather than as a
   * successful partial.
   */
  deleteByFilter(req) {
    const { collection } = requireCollection(req.collectionId);
    const before = scanByFilter(collection, req.filter, false);
    if (!before.exact) throw new HostError("SEMANTIC_SCAN_BOUND_EXCEEDED");
    if (before.rows.length === 0) return { deleted: 0 };

    const status = collection.deleteByFilterSync(buildFilterExpression(req.filter));
    // The vendor returns a status object here instead of throwing, so an unchecked call would treat
    // an invalid-filter rejection as a successful delete.
    if (!status || !status.ok) throw new HostError("SEMANTIC_DELETE_REJECTED");

    const after = scanByFilter(collection, req.filter, false);
    if (!after.exact || after.rows.length > 0) throw new HostError("SEMANTIC_DELETE_INCOMPLETE");
    return { deleted: before.rows.length };
  },

  /** Exact count, optionally filtered. `exact:false` means the scan bound was hit — never a guess. */
  count(req) {
    const { collection } = requireCollection(req.collectionId);
    if (!req.filter) return { count: collection.stats.docCount, exact: true };
    const { rows, exact } = scanByFilter(collection, req.filter, false);
    return { count: rows.length, exact };
  },

  /** Enumerate documents matching a typed filter. The scan primitive entity operations are built on. */
  scan(req) {
    const { collection } = requireCollection(req.collectionId);
    const { rows, exact } = scanByFilter(collection, req.filter, true);
    return { docs: rows.map(toWireDocument), exact };
  },

  /**
   * v1 capped top-K at 100 and returned only hit counts plus ten ids. Both were AWKIT's own choices:
   * the vendor honours a large top-K, applies `filter` as a PRE-filter before ranking, and returns
   * full rows. Pushing the filter into the query is a correctness fix, not an optimisation — filtering
   * after a truncated top-K silently drops matches that rank outside the unfiltered head.
   */
  async query(req) {
    const { collection } = requireCollection(req.collectionId);
    const q = req.query || {};
    const topK = Math.min(Math.max(1, Number(q.topK) || 20), HOST_MAX_SCAN);
    const request = { topk: topK, includeVector: false };
    if (q.fieldName) request.fieldName = q.fieldName;
    if (q.fts) request.fts = q.fts;
    if (q.vector) request.vector = Float32Array.from(q.vector);
    if (q.filter) request.filter = buildFilterExpression(q.filter);
    const docs = await collection.query(request);

    // `totalMatched` is contractually the count BEFORE top-K truncation ("showing 20 of 137"), so it
    // cannot be the length of a truncated page. When the page is not full it IS the total; only when
    // the window filled up is a second, count-only pass needed — `outputFields: []` asks the vendor
    // for no scalar fields, so the extra pass materialises ids rather than document bodies.
    let totalMatched = docs.length;
    let totalExact = true;
    if (docs.length >= topK) {
      const counting = { ...request, topk: HOST_MAX_SCAN, outputFields: [] };
      const all = await collection.query(counting);
      totalMatched = all.length;
      totalExact = all.length < HOST_MAX_SCAN;
    }

    return { docs: docs.map(toWireDocument), truncated: docs.length >= topK, totalMatched, totalExact };
  },

  stats(req) {
    const { collection, path: p } = requireCollection(req.collectionId);
    return { docCount: collection.stats.docCount, path: p };
  },

  close(req) {
    const entry = requireCollection(req.collectionId);
    entry.collection.closeSync();
    collections.delete(req.collectionId);
    return { closed: true };
  },

  shutdown() {
    for (const [id, entry] of collections) {
      try {
        entry.collection.closeSync();
      } catch {
        /* a collection that cannot close must not block the remaining ones or the exit */
      }
      collections.delete(id);
    }
    return { shutdown: true };
  }
};

// The Phase 0D crash-injection handler (`__testAbort`, gated on AWKIT_ZVEC_HOST_TEST_ABORT) was
// REMOVED here in Phase 1A. Crash containment is now covered without shipping an abort path:
// ZvecHostRestartPolicy is exercised directly by scripts/verify-zvec-host-lifecycle.mts, and the
// Phase 0D evidence that a native abort is contained (exit 134 detected in 84.62 ms, application
// survived and still served IPC) is recorded in docs/ZVEC_PHASE_0_COMPATIBILITY_REPORT.md.
// Any future crash test must inject the fault from the harness, never from shipped host code.

function safeVersion(pkg) {
  try {
    return require(path.join(__dirname, "node_modules", pkg, "package.json")).version;
  } catch {
    return null;
  }
}

/** Map any thrown value to a stable reason code — vendor errors embed absolute paths (Phase 0 §12). */
function toSafeReason(err) {
  if (err instanceof HostError) return { reason: err.reason, retryable: err.retryable };
  if (zvec.isZVecError && zvec.isZVecError(err)) {
    return { reason: `SEMANTIC_NATIVE_${err.code}`, retryable: false };
  }
  return { reason: "SEMANTIC_HOST_INTERNAL_ERROR", retryable: false };
}

async function dispatch(req) {
  const handler = handlers[req.type];
  if (!handler) throw new HostError("SEMANTIC_UNKNOWN_REQUEST");
  return await handler(req);
}

if (!process.parentPort) {
  // Refuse to run as a standalone command; the host is only ever a utilityProcess child.
  process.exit(2);
}

process.parentPort.on("message", (event) => {
  const req = event.data;
  if (!req || req.version !== PROTOCOL_VERSION || typeof req.id !== "string") {
    process.parentPort.postMessage({
      version: PROTOCOL_VERSION,
      id: req && typeof req.id === "string" ? req.id : "unknown",
      ok: false,
      reason: "SEMANTIC_PROTOCOL_VIOLATION",
      retryable: false
    });
    return;
  }

  Promise.resolve()
    .then(() => dispatch(req))
    .then((value) => {
      process.parentPort.postMessage({ version: PROTOCOL_VERSION, id: req.id, ok: true, value });
      if (req.type === "shutdown") process.exit(0);
    })
    .catch((err) => {
      const safe = toSafeReason(err);
      process.parentPort.postMessage({
        version: PROTOCOL_VERSION,
        id: req.id,
        ok: false,
        reason: safe.reason,
        retryable: safe.retryable
      });
    });
});

process.parentPort.postMessage({
  version: PROTOCOL_VERSION,
  type: "ready",
  pid: process.pid
});
