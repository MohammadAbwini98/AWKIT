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

const PROTOCOL_VERSION = 1;

// Zvec is required from this host's OWN packaged module root (native-hosts/zvec/node_modules),
// staged adjacent to this file. Resolution never reaches into app.asar.
// eslint-disable-next-line import/no-unresolved
const zvec = require("@zvec/zvec");

/**
 * §7.1 — the main process resolves generation paths, and the host independently re-verifies them.
 * A host that trusted the caller would turn any future IPC validation gap into arbitrary
 * filesystem access, so this check is deliberately duplicated rather than shared.
 */
const APPROVED_ROOT = path.resolve(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || ".", "AppData", "Local"),
  "SpecterStudio",
  "semantic-index",
  "generations"
);

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

function chunkedWrite(collection, method, docs) {
  let written = 0;
  for (let offset = 0; offset < docs.length; offset += MAX_WRITE_BATCH) {
    const chunk = docs.slice(offset, offset + MAX_WRITE_BATCH);
    const statuses = collection[method](chunk);
    const failed = statuses.filter((s) => !s.ok);
    if (failed.length > 0) throw new HostError("SEMANTIC_WRITE_REJECTED");
    written += chunk.length;
  }
  return written;
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
    const exists = fs.existsSync(resolved);
    const collection = exists
      ? zvec.ZVecOpen(resolved)
      : zvec.ZVecCreateAndOpen(resolved, buildSchema(req.schema));
    collections.set(req.generation, { collection, path: resolved });
    return { generation: req.generation, created: !exists, docCount: collection.stats.docCount };
  },

  upsert(req) {
    const { collection } = requireCollection(req.collectionId);
    return { written: chunkedWrite(collection, "upsertSync", req.docs || []) };
  },

  insert(req) {
    const { collection } = requireCollection(req.collectionId);
    return { written: chunkedWrite(collection, "insertSync", req.docs || []) };
  },

  fetch(req) {
    const { collection } = requireCollection(req.collectionId);
    return { docs: Object.keys(collection.fetchSync(req.ids || [])) };
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

  async query(req) {
    const { collection } = requireCollection(req.collectionId);
    const q = req.query || {};
    const request = { fieldName: q.fieldName, topk: Math.min(Number(q.topK) || 20, 100) };
    if (q.fts) request.fts = q.fts;
    if (q.vector) request.vector = Float32Array.from(q.vector);
    const docs = await collection.query(request);
    return { hits: docs.length, ids: docs.slice(0, 10).map((d) => d.id) };
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

// ── TEST-ONLY crash injection ────────────────────────────────────────────────────────────────
// Registered ONLY when the Phase 0D crash-isolation harness explicitly sets this environment
// variable on the forked child. A production launch never sets it, so `__testAbort` is not a
// known request type and is rejected as SEMANTIC_UNKNOWN_REQUEST like any other unknown message.
// This block must be REMOVED before Phase 1A ships (see the cleanup classification).
if (process.env.AWKIT_ZVEC_HOST_TEST_ABORT === "1") {
  handlers.__testAbort = () => {
    // Hard native-level abort: no JS error, no graceful exit — the worst case the host manager
    // must survive. Exits with SIGABRT (134).
    process.abort();
  };
}

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
