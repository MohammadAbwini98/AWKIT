// Child-process worker for the abrupt-termination test (plan §19.1 item 16).
// Opens (or creates) the collection and writes continuously until the parent SIGKILLs
// this process, so termination lands mid-write rather than between operations.
import { ZVecCreateAndOpen, ZVecOpen } from "@zvec/zvec";
import fs from "node:fs";

const [, , collectionPath, readyFlagPath] = process.argv;

let collection;
try {
  collection = ZVecOpen(collectionPath);
} catch {
  const { ZVecCollectionSchema, ZVecDataType, ZVecIndexType, ZVecMetricType } = await import("@zvec/zvec");
  collection = ZVecCreateAndOpen(
    collectionPath,
    new ZVecCollectionSchema({
      name: "zvecPhase0AbruptWrite",
      fields: [{ name: "title", dataType: ZVecDataType.STRING }],
      vectors: [{ name: "embedding", dataType: ZVecDataType.VECTOR_FP32, dimension: 8, indexParams: { indexType: ZVecIndexType.FLAT, metricType: ZVecMetricType.COSINE } }]
    })
  );
}

let i = 0;
fs.writeFileSync(readyFlagPath, "ready");
// Continuous insert loop — the parent process kills this process (SIGKILL) at a random
// point while this loop is running, deliberately landing mid-write.
setInterval(() => {
  const batch = [];
  for (let b = 0; b < 50; b++, i++) {
    batch.push({
      id: `abrupt-${i}`,
      fields: { title: `abrupt write doc ${i}` },
      vectors: { embedding: new Float32Array(8).fill(i % 7) }
    });
  }
  try {
    collection.insertSync(batch);
  } catch {
    // A failure here just means the process is already being torn down; nothing to report.
  }
}, 5);
