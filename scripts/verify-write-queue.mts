// Deterministic unit checks for the serial write queue (app/main/writeQueue.ts) that backs
// UI-settings persistence. No Electron — pure async semantics.
//
// Run: npx tsx scripts/verify-write-queue.mts
import { createSerialQueue } from "../app/main/writeQueue";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 1. FIFO order preserved even with varying task durations.
{
  const q = createSerialQueue();
  const order: number[] = [];
  const running: number[] = [];
  let maxConcurrent = 0;
  const tasks = [30, 5, 20, 1, 10].map((ms, i) =>
    q.run(async () => {
      running.push(i);
      maxConcurrent = Math.max(maxConcurrent, running.length);
      await delay(ms);
      order.push(i);
      running.splice(running.indexOf(i), 1);
    })
  );
  await Promise.all(tasks);
  check("Tasks run in FIFO order regardless of duration", JSON.stringify(order) === JSON.stringify([0, 1, 2, 3, 4]), `order=${order}`);
  check("Never more than one task runs at a time", maxConcurrent === 1, `maxConcurrent=${maxConcurrent}`);
}

// 2. A rejected task does not block or poison the ones queued behind it.
{
  const q = createSerialQueue();
  const ran: string[] = [];
  const a = q.run(async () => { ran.push("a"); });
  const bad = q.run(async () => { ran.push("bad"); throw new Error("boom"); });
  const c = q.run(async () => { ran.push("c"); });
  bad.catch(() => undefined); // caller handles its own rejection
  let badRejected = false;
  await a;
  await bad.catch(() => { badRejected = true; });
  await c;
  check("Failed task rejects for its caller", badRejected, `badRejected=${badRejected}`);
  check("Queue continues after a failed write", JSON.stringify(ran) === JSON.stringify(["a", "bad", "c"]), `ran=${ran}`);
}

// 3. flush() resolves only after all currently-queued tasks have settled.
{
  const q = createSerialQueue();
  let done = 0;
  q.run(async () => { await delay(15); done++; });
  q.run(async () => { await delay(15); done++; throw new Error("x"); }).catch(() => undefined);
  q.run(async () => { await delay(15); done++; });
  await q.flush();
  check("flush() completes all pending writes (incl. after a failure)", done === 3, `done=${done}`);
  check("flush() drains the queue (size 0 after)", q.size === 0, `size=${q.size}`);
}

// 4. flush() never rejects (so it can't deadlock shutdown), even if the last task failed.
{
  const q = createSerialQueue();
  q.run(async () => { throw new Error("last-fails"); }).catch(() => undefined);
  let flushRejected = false;
  await q.flush().catch(() => { flushRejected = true; });
  check("flush() never rejects", !flushRejected, `flushRejected=${flushRejected}`);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nWrite queue: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
