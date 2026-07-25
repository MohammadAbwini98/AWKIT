/**
 * Genuinely concurrent generation-allocation verifier.
 *
 * The lifecycle verifier's allocation tests are sequential: they prove uniqueness and `EEXIST`
 * recovery, but NOT that two simultaneous allocators cannot pick the same sequence. That distinction
 * matters, because the bug being guarded against — check-then-create — only manifests when two
 * allocators interleave between the check and the create.
 *
 * So this spawns several SEPARATE OS PROCESSES, releases them from one barrier file, and has each
 * allocate repeatedly. Separate processes rather than worker threads: threads in one process share a
 * filesystem cache and an event loop, which can hide the very interleaving under test.
 *
 * Run: npx tsx scripts/verify-zvec-generation-concurrency.mts
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isGenerationName, semanticIndexLayout } from "@src/semantic/SemanticGenerationLayout";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

interface WorkerResult {
  pid: number;
  allocated: string[];
  errors: string[];
}

function runWorker(runtimeRoot: string, count: number, barrier: string, readyDir: string): Promise<WorkerResult | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["tsx", path.join("scripts", "zvec-harness", "allocGenerationWorker.mts"), runtimeRoot, String(count), barrier, readyDir],
      { cwd: ROOT, shell: true }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("close", () => {
      try {
        // tsx may emit warnings before the JSON payload; take the last JSON object on stdout.
        const start = stdout.lastIndexOf("{");
        resolve(start >= 0 ? (JSON.parse(stdout.slice(start)) as WorkerResult) : null);
      } catch {
        console.error(`    worker parse failure. stdout=${stdout.slice(0, 200)} stderr=${stderr.slice(0, 200)}`);
        resolve(null);
      }
    });
  });
}

const WORKERS = 4;
const PER_WORKER = 8;

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "awkit-genconc-"));
const layout = semanticIndexLayout(runtimeRoot);
fs.mkdirSync(layout.generations, { recursive: true });
const barrier = path.join(runtimeRoot, "GO");
const readyDir = path.join(runtimeRoot, "ready");

console.log(`Concurrent generation allocation (${WORKERS} separate processes x ${PER_WORKER} allocations):\n`);

try {
  // Two-stage barrier: every worker announces READY, and only once all of them have is GO written.
  // A fixed sleep could release the barrier before a slow worker reached its spin loop, which would
  // silently degrade this into a partially-sequential test that still looked like it passed.
  const pending = Array.from({ length: WORKERS }, () => runWorker(runtimeRoot, PER_WORKER, barrier, readyDir));

  const readyDeadline = Date.now() + 120_000;
  let readyCount = 0;
  while (Date.now() < readyDeadline) {
    readyCount = fs.existsSync(readyDir) ? fs.readdirSync(readyDir).filter((n) => n.startsWith("ready-")).length : 0;
    if (readyCount >= WORKERS) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  check(`all ${WORKERS} workers announced READY before release`, readyCount >= WORKERS, `${readyCount} ready`);
  fs.writeFileSync(barrier, "go");

  const results = await Promise.all(pending);
  const live = results.filter((r): r is WorkerResult => r !== null);

  check(`all ${WORKERS} workers reported`, live.length === WORKERS, `${live.length} reported`);

  const allNames = live.flatMap((r) => r.allocated);
  const expected = WORKERS * PER_WORKER;

  check(`every allocation succeeded (${allNames.length}/${expected})`, allNames.length === expected, JSON.stringify(live.map((r) => r.errors)));
  check("no worker reported an allocation error", live.every((r) => r.errors.length === 0), JSON.stringify(live.flatMap((r) => r.errors).slice(0, 3)));

  // The core assertion: no two concurrent allocators may claim the same generation name.
  const unique = new Set(allNames);
  check(`every generation name is unique across processes (${unique.size} distinct)`, unique.size === allNames.length, `${allNames.length - unique.size} duplicates`);

  check("more than one process actually allocated (the race was real)", live.filter((r) => r.allocated.length > 0).length > 1);

  // Each claimed name must correspond to a directory that exists and is well-formed.
  const onDisk = fs.readdirSync(layout.generations, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  check(`directory count matches allocations (${onDisk.length})`, onDisk.length === allNames.length, `${onDisk.length} dirs vs ${allNames.length} names`);
  check("every directory has a well-formed generation name", onDisk.every(isGenerationName), onDisk.filter((n) => !isGenerationName(n)).join(","));
  check("every claimed name exists on disk", allNames.every((n) => onDisk.includes(n)));

  // No allocator may have written pointer/metadata state — allocation is directory-only.
  check("allocation wrote no active-generation pointer", !fs.existsSync(layout.activeGenerationFile));
  check("allocation wrote no metadata file", !fs.existsSync(layout.metadataFile));
  check(
    "no partial .tmp files were left behind",
    !fs.readdirSync(layout.root).some((n) => n.endsWith(".tmp")),
    fs.readdirSync(layout.root).join(",")
  );
} finally {
  try {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  } catch {
    /* disposable */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
