// Phase 0 spike harness — shared operations run identically by the native (system Node),
// main-process, and utility-process hosts, per the plan's requirement to "use the same
// synthetic dataset and operations for both placements" (§6.3).
//
// Spike-only: no production code imports this file. Direct @zvec/zvec imports stay
// confined to this file and its callers, per the plan's Non-Goals / adapter-only rule.

import {
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecCollectionSchema,
  ZVecCreateAndOpen,
  ZVecOpen,
  ZVecGetDefaultJiebaDictDir,
  isZVecError
} from "@zvec/zvec";

const VECTOR_DIM = 16;
const SYNTHETIC_DOC_COUNT = 1200; // exceeds the plan's 1,000-document minimum (§19.1 item 4)

function makeSchema() {
  return new ZVecCollectionSchema({
    name: "zvecPhase0Spike",
    fields: [
      {
        name: "title",
        dataType: ZVecDataType.STRING,
        indexParams: { indexType: ZVecIndexType.FTS, tokenizerName: "standard" }
      },
      {
        name: "titleZh",
        dataType: ZVecDataType.STRING,
        indexParams: { indexType: ZVecIndexType.FTS, tokenizerName: "jieba" }
      },
      { name: "category", dataType: ZVecDataType.STRING }
    ],
    vectors: [
      {
        name: "embedding",
        dataType: ZVecDataType.VECTOR_FP32,
        dimension: VECTOR_DIM,
        indexParams: { indexType: ZVecIndexType.FLAT, metricType: ZVecMetricType.COSINE }
      }
    ]
  });
}

function syntheticVector(seed) {
  const v = new Float32Array(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i++) {
    v[i] = Math.sin(seed * 0.017 + i) * 0.5 + 0.5;
  }
  return v;
}

const CATEGORIES = ["workflow", "flow", "documentation", "run-failure", "locator-success"];
const CHINESE_SAMPLES = ["自动化测试失败", "工作流执行成功", "定位器解析超时", "全文检索索引", "离线运行报告"];

function syntheticDocs(count) {
  const docs = [];
  for (let i = 0; i < count; i++) {
    docs.push({
      id: `doc-${i}`,
      fields: {
        title: `synthetic automation record number ${i} for category ${CATEGORIES[i % CATEGORIES.length]}`,
        titleZh: CHINESE_SAMPLES[i % CHINESE_SAMPLES.length],
        category: CATEGORIES[i % CATEGORIES.length]
      },
      vectors: { embedding: syntheticVector(i) }
    });
  }
  return docs;
}

// Optional disk-flushed step trace. A hard native crash produces no catchable JS error and, in a
// packaged GUI app, no console output — so when a trace sink is provided each step boundary is
// written to disk immediately. The last line present after a crash names the operation that died.
let traceSink = null;
export function setOpsTraceSink(fn) {
  traceSink = fn;
}
function traceStep(line) {
  if (traceSink) {
    try {
      traceSink(line);
    } catch {
      /* tracing must never affect the result being measured */
    }
  }
}

async function timed(label, fn) {
  const start = performance.now();
  traceStep(`step:begin ${label}`);
  try {
    const result = await fn();
    traceStep(`step:ok ${label}`);
    return { label, ok: true, durationMs: performance.now() - start, result };
  } catch (err) {
    const zvec = isZVecError(err);
    traceStep(`step:threw ${label} ${String(err?.message ?? err)}`);
    return {
      label,
      ok: false,
      durationMs: performance.now() - start,
      error: { message: String(err?.message ?? err), code: zvec ? err.code : undefined, isZVecError: zvec }
    };
  }
}

/**
 * Runs required operations 2-14 (create through batch/update/upsert/delete) against a
 * fresh or reopened collection at `collectionPath`. Steps 1 (native load), 15 (restart
 * persistence), 16-17 (abrupt termination + recovery), and 18 (cleanup) are orchestrated
 * by the caller so the same dataset/logic can be reused across process boundaries.
 */
export async function runOpsHarness(collectionPath, { reopenOnly = false, runTag = "main" } = {}) {
  const steps = [];
  let collection;
  const tag = (suffix) => `${suffix}-${runTag}`;

  steps.push(
    await timed("jiebaDictDirAutoResolved", async () => {
      const dir = ZVecGetDefaultJiebaDictDir();
      if (!dir) throw new Error("No default jieba dictionary directory was auto-registered.");
      return { dir };
    })
  );

  steps.push(
    await timed(reopenOnly ? "reopenCollection" : "createCollection", async () => {
      collection = reopenOnly ? ZVecOpen(collectionPath) : ZVecCreateAndOpen(collectionPath, makeSchema());
      return { path: collection.path, docCount: collection.stats.docCount };
    })
  );
  if (!collection) return { ok: false, steps };

  if (!reopenOnly) {
    steps.push(
      await timed("batchInsert1200Docs", async () => {
        // Finding (Phase 0): the real binding enforces a max write-batch size of 1024 docs
        // per insertSync call ("Too many docs: N exceeds max write batch size of 1024").
        // This is undocumented in the TS types and must be recorded in the compatibility
        // report — any production batch-insert path needs its own chunking at <=1024.
        const MAX_BATCH = 1024;
        const docs = syntheticDocs(SYNTHETIC_DOC_COUNT);
        for (let offset = 0; offset < docs.length; offset += MAX_BATCH) {
          const chunk = docs.slice(offset, offset + MAX_BATCH);
          const statuses = collection.insertSync(chunk);
          const failed = statuses.filter((s) => !s.ok);
          if (failed.length > 0) throw new Error(`${failed.length} of ${chunk.length} inserts failed in chunk starting at ${offset}`);
        }
        return { inserted: docs.length, docCount: collection.stats.docCount, maxWriteBatchSize: MAX_BATCH };
      })
    );
  }

  steps.push(
    await timed("ftsQueryStandardTokenizer", async () => {
      const docs = await collection.query({ fieldName: "title", fts: { queryString: "automation AND failed" }, topk: 20 });
      return { hits: docs.length };
    })
  );

  steps.push(
    await timed("ftsQueryJiebaTokenizer", async () => {
      const docs = await collection.query({ fieldName: "titleZh", fts: { matchString: "自动化" }, topk: 20 });
      return { hits: docs.length };
    })
  );

  steps.push(
    await timed("vectorFixtureQuery", async () => {
      const docs = await collection.query({ fieldName: "embedding", vector: syntheticVector(42), topk: 5 });
      return { hits: docs.length, topId: docs[0]?.id };
    })
  );

  steps.push(
    await timed("insertOne", async () => {
      const status = collection.insertSync({
        id: tag("extra-insert"),
        fields: { title: "extra inserted record", titleZh: CHINESE_SAMPLES[0], category: "workflow" },
        vectors: { embedding: syntheticVector(9001) },
        // titleZh, category, and embedding are all non-nullable in the schema (default
        // nullable: false), so every insert must supply all of them.
      });
      if (!status.ok) throw new Error(status.message);
      return status;
    })
  );

  steps.push(
    await timed("fetchDocs", async () => {
      const fetched = collection.fetchSync(["doc-0", "doc-1", tag("extra-insert")]);
      const found = Object.keys(fetched);
      if (!found.includes(tag("extra-insert"))) throw new Error("Newly inserted document was not fetchable");
      return { found };
    })
  );

  steps.push(
    await timed("updateDoc", async () => {
      const marker = tag("updated-category");
      const status = collection.updateSync({ id: "doc-0", fields: { category: marker } });
      if (!status.ok) throw new Error(status.message);
      const [after] = Object.values(collection.fetchSync(["doc-0"]));
      if (after?.fields?.category !== marker) throw new Error("Update did not persist");
      return status;
    })
  );

  steps.push(
    await timed("upsertDoc", async () => {
      const marker = tag("upserted-existing");
      // Finding (Phase 0): unlike updateSync (a true partial patch — see updateDoc above),
      // upsertSync rejected a partial payload for an *existing* doc with the same
      // "field[embedding] is required but not provided" error as a fresh insert. upsertSync
      // therefore behaves as insert-or-replace, not insert-or-patch: every non-nullable
      // field/vector must be supplied on every upsert call, existing doc or not.
      const statuses = collection.upsertSync([
        {
          id: "doc-1",
          fields: { title: "synthetic automation record number 1 for category flow", titleZh: CHINESE_SAMPLES[1], category: marker },
          vectors: { embedding: syntheticVector(1) }
        },
        {
          id: tag("upsert-new"),
          fields: { title: "brand new upserted doc", titleZh: CHINESE_SAMPLES[2], category: "workflow" },
          vectors: { embedding: syntheticVector(77) }
        }
      ]);
      const failed = statuses.filter((s) => !s.ok);
      if (failed.length > 0) throw new Error("Upsert batch had failures");
      const [after] = Object.values(collection.fetchSync(["doc-1"]));
      if (after?.fields?.category !== marker) throw new Error("Upsert of existing doc did not persist");
      return { count: statuses.length };
    })
  );

  // Delete tests are self-contained (insert-then-delete on run-tagged scratch ids) so they
  // are safe to repeat across multiple reopens without depending on bulk-insert state that
  // only exists on the very first (non-reopen) run.
  steps.push(
    await timed("batchDeleteByIds", async () => {
      const scratchIds = [tag("scratch-del-1"), tag("scratch-del-2")];
      const insertStatuses = collection.insertSync(
        scratchIds.map((id, i) => ({
          id,
          fields: { title: `scratch delete target ${id}`, titleZh: CHINESE_SAMPLES[3], category: "workflow" },
          vectors: { embedding: syntheticVector(5000 + i) }
        }))
      );
      if (insertStatuses.some((s) => !s.ok)) throw new Error("Scratch insert for delete test failed");

      const statuses = collection.deleteSync(scratchIds);
      const failed = statuses.filter((s) => !s.ok);
      if (failed.length > 0) throw new Error("Delete batch had failures");
      const stillPresent = Object.keys(collection.fetchSync(scratchIds));
      if (stillPresent.length > 0) throw new Error("Deleted documents were still fetchable");
      return { count: statuses.length };
    })
  );

  steps.push(
    await timed("deleteByFilter", async () => {
      const marker = tag("delete-by-filter-target");
      const insertStatus = collection.insertSync({
        id: tag("scratch-del-filter"),
        fields: { title: "scratch delete-by-filter target", titleZh: CHINESE_SAMPLES[4], category: marker },
        vectors: { embedding: syntheticVector(6000) }
      });
      if (!insertStatus.ok) throw new Error("Scratch insert for deleteByFilter test failed");

      // Finding (Phase 0): the filter expression grammar is SQL-style — a single "=" for
      // equality, not "==". A double-equals filter is a syntax error, not a no-match.
      const status = await collection.deleteByFilter(`category = "${marker}"`);
      if (!status.ok) throw new Error(status.message);
      const stillPresent = Object.keys(collection.fetchSync([tag("scratch-del-filter")]));
      if (stillPresent.length > 0) throw new Error("deleteByFilter did not remove the target document");
      return status;
    })
  );

  steps.push(
    await timed("closeCollection", async () => {
      collection.closeSync();
      return { closed: true };
    })
  );

  const ok = steps.every((s) => s.ok);
  return { ok, steps };
}

export function destroyCollectionAt(collectionPath) {
  const collection = ZVecOpen(collectionPath);
  collection.destroySync();
}

export { SYNTHETIC_DOC_COUNT };
