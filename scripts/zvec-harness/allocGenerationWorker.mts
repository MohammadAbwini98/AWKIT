/**
 * Test-only worker for the concurrent generation-allocation verifier.
 *
 * Runs as a SEPARATE OS PROCESS so the race is real rather than simulated: worker threads inside one
 * process share a filesystem cache and an event loop, which can mask a check-then-create bug that a
 * genuine multi-process race would expose.
 *
 * Every worker spins on a barrier file and only then starts allocating, so all workers hit
 * `createGeneration` inside the same few milliseconds.
 *
 * Usage: tsx allocGenerationWorker.mts <runtimeRoot> <count> <barrierFile>
 */

import fs from "node:fs";
import path from "node:path";

import { createGeneration } from "@src/semantic/SemanticGenerationManager";

const [runtimeRoot, countArg, barrierFile, readyDir] = process.argv.slice(2);
const count = Number(countArg);

// Two-stage barrier. Announcing readiness first is what makes the race provable: the parent waits
// for every ready file before releasing GO, so a slow machine cannot let the barrier drop before
// some worker has actually reached its spin loop. A fixed sleep could only ever assume that.
fs.mkdirSync(readyDir, { recursive: true });
fs.writeFileSync(path.join(readyDir, `ready-${process.pid}`), "");

// Busy-wait on the barrier. A tight loop is intentional: a timer would let the OS stagger the
// workers, which is exactly what must NOT happen here.
const deadline = Date.now() + 60_000;
while (!fs.existsSync(barrierFile) && Date.now() < deadline) {
  /* spin */
}

const allocated: string[] = [];
const errors: string[] = [];

for (let i = 0; i < count; i += 1) {
  try {
    allocated.push(createGeneration(runtimeRoot).name);
  } catch (error) {
    errors.push(String((error as Error)?.message ?? error));
  }
}

process.stdout.write(JSON.stringify({ pid: process.pid, allocated, errors }));
