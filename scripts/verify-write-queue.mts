// Deterministic unit checks for the serial write queue (app/main/writeQueue.ts) that backs
// UI-settings persistence. No Electron — pure async semantics.
//
// Run: npx tsx scripts/verify-write-queue.mts
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isTransientReplaceError, replaceFileAtomically } from "../app/main/atomicReplace";
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 5. Atomic replacement retries (app/main/atomicReplace.ts) — awkit-4qs.
//
// The defect: a single transient Windows EPERM/EBUSY from `rename` discarded the user's settings
// write outright. The risk in FIXING it is the opposite one — a retry loop that swallows permanent
// errors, retries forever, leaves temp files behind, or reports success it did not achieve. Each
// check below drives a REAL failure through the helper rather than asserting the code's shape.
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const errno = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`simulated ${code}`), { code });

  const noSleep = async () => undefined;

  // 5a. A transient failure that later clears must succeed, not propagate.
  {
    let calls = 0;
    await replaceFileAtomically("t", "target", {
      sleep: noSleep,
      renameImpl: async () => {
        calls += 1;
        if (calls < 3) throw errno("EBUSY");
      }
    });
    check("EBUSY that clears on the 3rd attempt succeeds", calls === 3, `attempts=${calls}`);
  }

  // 5b. Retries are BOUNDED. An always-failing transient error must stop and rethrow.
  {
    let calls = 0;
    let thrown: NodeJS.ErrnoException | null = null;
    await replaceFileAtomically("t", "target", {
      attempts: 4,
      sleep: noSleep,
      renameImpl: async () => {
        calls += 1;
        throw errno("EPERM");
      }
    }).catch((e) => { thrown = e as NodeJS.ErrnoException; });
    check("persistent EPERM stops after exactly `attempts` tries", calls === 4, `attempts=${calls}`);
    check("persistent EPERM propagates the ORIGINAL errno", thrown?.code === "EPERM", `code=${thrown?.code}`);
  }

  // 5c. Non-transient errors must NOT be retried. This is the check that stops the fix from
  // turning a clear immediate failure (disk full, missing temp) into a slow one.
  for (const code of ["ENOENT", "ENOSPC", "EACCES", "EXDEV"]) {
    let calls = 0;
    let thrown: NodeJS.ErrnoException | null = null;
    await replaceFileAtomically("t", "target", {
      sleep: noSleep,
      renameImpl: async () => {
        calls += 1;
        throw errno(code);
      }
    }).catch((e) => { thrown = e as NodeJS.ErrnoException; });
    check(`${code} fails on the FIRST attempt (not retried)`, calls === 1, `attempts=${calls}`);
    check(`${code} propagates unchanged`, thrown?.code === code, `code=${thrown?.code}`);
  }

  // 5d. Classification is not vacuous in either direction.
  check("EPERM is classified transient", isTransientReplaceError(errno("EPERM")));
  check("EBUSY is classified transient", isTransientReplaceError(errno("EBUSY")));
  check("ENOENT is NOT classified transient", !isTransientReplaceError(errno("ENOENT")));
  check("a non-errno value is NOT classified transient", !isTransientReplaceError(new Error("plain")));

  // 5e. The temp file is cleaned up on every terminal path, so it cannot accumulate in the
  // storage folder. Driven against the real filesystem — a mock would prove nothing about rm().
  for (const [label, code] of [["after exhausting retries", "EBUSY"], ["on a permanent error", "ENOSPC"]] as const) {
    const dir = await mkdtemp(join(tmpdir(), "awkit-atomic-"));
    const tmpFile = join(dir, "settings.json.tmp");
    const target = join(dir, "settings.json");
    await writeFile(target, '{"prior":true}\n', "utf8");
    await writeFile(tmpFile, '{"next":true}\n', "utf8");

    await replaceFileAtomically(tmpFile, target, {
      attempts: 2,
      sleep: noSleep,
      renameImpl: async () => { throw errno(code); }
    }).catch(() => undefined);

    const tmpGone = !existsSync(tmpFile);
    const priorIntact = readFileSync(target, "utf8") === '{"prior":true}\n';
    check(`temp file removed ${label}`, tmpGone, `exists=${!tmpGone}`);
    check(`prior target left intact ${label}`, priorIntact, readFileSync(target, "utf8").trim());
    await rm(dir, { recursive: true, force: true });
  }

  // 5f. A real rename over a real existing file still works — the helper must not have broken the
  // ordinary success path while adding retries.
  {
    const dir = await mkdtemp(join(tmpdir(), "awkit-atomic-"));
    const tmpFile = join(dir, "settings.json.tmp");
    const target = join(dir, "settings.json");
    await writeFile(target, '{"prior":true}\n', "utf8");
    await writeFile(tmpFile, '{"next":true}\n', "utf8");
    await replaceFileAtomically(tmpFile, target);
    check("real replacement writes the new content", readFileSync(target, "utf8") === '{"next":true}\n');
    check("real replacement consumes the temp file", !existsSync(tmpFile));
    await rm(dir, { recursive: true, force: true });
  }

  // 5g. Retrying must not let a later settings write overtake an earlier one. The queue is what
  // guarantees losslessness, and a retry runs INSIDE a queued task, so this is the regression that
  // would matter most if the retry were ever moved outside the queue.
  {
    const q = createSerialQueue();
    const order: string[] = [];
    let firstCalls = 0;
    const slowRetry = q.run(async () => {
      await replaceFileAtomically("t", "target", {
        attempts: 3,
        backoffMs: 5,
        renameImpl: async () => {
          firstCalls += 1;
          if (firstCalls < 3) throw errno("EBUSY");
        }
      });
      order.push("first");
    });
    const second = q.run(async () => { order.push("second"); });
    await Promise.all([slowRetry, second]);
    check(
      "a retrying write still completes before the next queued write",
      JSON.stringify(order) === JSON.stringify(["first", "second"]),
      `order=${order}`
    );
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nWrite queue: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
