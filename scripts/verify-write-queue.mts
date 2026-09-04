// Deterministic unit checks for the serial write queue (app/main/writeQueue.ts) that backs
// UI-settings persistence. No Electron — pure async semantics.
//
// Run: npx tsx scripts/verify-write-queue.mts
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { isTransientReplaceError, replaceFileAtomically } from "../app/main/atomicReplace";
import { createSerialQueue } from "../app/main/writeQueue";
import { activeFolderCoordinationKeys, folderCoordinationKey, runExclusive } from "../src/storage/folderWriteCoordinator";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

/**
 * Yields the event loop a bounded number of times. Used instead of `delay(ms)` for the coordination
 * checks below: it varies task length deterministically without waiting on wall-clock time, so the
 * results do not depend on how loaded the host is.
 */
function drainEventLoop(turns: number): Promise<void> {
  return new Promise<void>((settle) => {
    let remaining = Math.max(1, turns);
    const step = (): void => {
      remaining -= 1;
      if (remaining <= 0) settle();
      else setImmediate(step);
    };
    setImmediate(step);
  });
}

/** Long enough for any genuinely un-queued task to arrive; a task waiting on a lane can never
 *  arrive however long this is, so both arms of the gate terminate. */
const GATE_DRAIN_TURNS = 200;

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
    const thrown = await replaceFileAtomically("t", "target", {
      attempts: 4,
      sleep: noSleep,
      renameImpl: async () => {
        calls += 1;
        throw errno("EPERM");
      }
    }).then(
      () => null,
      (error: unknown) => error as NodeJS.ErrnoException
    );
    check("persistent EPERM stops after exactly `attempts` tries", calls === 4, `attempts=${calls}`);
    check("persistent EPERM propagates the ORIGINAL errno", thrown?.code === "EPERM", `code=${thrown?.code}`);
  }

  // 5c. Non-transient errors must NOT be retried. This is the check that stops the fix from
  // turning a clear immediate failure (disk full, missing temp) into a slow one.
  for (const code of ["ENOENT", "ENOSPC", "EACCES", "EXDEV"]) {
    let calls = 0;
    const thrown = await replaceFileAtomically("t", "target", {
      sleep: noSleep,
      renameImpl: async () => {
        calls += 1;
        throw errno(code);
      }
    }).then(
      () => null,
      (error: unknown) => error as NodeJS.ErrnoException
    );
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// 6. Per-resolved-folder write coordination (src/storage/folderWriteCoordinator.ts) — R1B.
//
// `createSerialQueue` above is owned by whoever constructs it, so it can only serialize the writes
// that go through that one object. R1B needs the queue to be owned by the DESTINATION instead, so
// that stores constructed independently — different call sites, different times, no shared object —
// still take turns on one folder. These drive the coordinator directly; the store-level behavior it
// produces is asserted in verify-profile-store.mts and verify-r0-characterization.mts.
//
// Timing here is event-loop turns, never wall-clock sleeps, so nothing depends on host speed.
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  // 6a. One key: FIFO admission and mutual exclusion, with tasks of deliberately different lengths.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-coord-fifo-"));
    const lengths = [30, 5, 20, 1, 10];
    const order: number[] = [];
    const running: number[] = [];
    let maxConcurrent = 0;
    await Promise.all(lengths.map((turns, i) => runExclusive(folder, async () => {
      running.push(i);
      maxConcurrent = Math.max(maxConcurrent, running.length);
      await drainEventLoop(turns);
      order.push(i);
      running.splice(running.indexOf(i), 1);
    })));
    check("Coordinator runs same-folder tasks in FIFO order regardless of length", JSON.stringify(order) === JSON.stringify([0, 1, 2, 3, 4]), `order=${order}`);
    check("Coordinator never runs two same-folder tasks at once", maxConcurrent === 1 && order.length === lengths.length, `maxConcurrent=${maxConcurrent}, completed=${order.length}`);

    // Control: the identical tasks without the coordinator finish shortest-first and overlap.
    const looseOrder: number[] = [];
    const looseRunning: number[] = [];
    let looseMax = 0;
    await Promise.all(lengths.map(async (turns, i) => {
      looseRunning.push(i);
      looseMax = Math.max(looseMax, looseRunning.length);
      await drainEventLoop(turns);
      looseOrder.push(i);
      looseRunning.splice(looseRunning.indexOf(i), 1);
    }));
    check(
      "control: without the coordinator the same tasks overlap and complete out of order",
      looseMax === lengths.length && JSON.stringify(looseOrder) !== JSON.stringify([0, 1, 2, 3, 4]),
      `maxConcurrent=${looseMax}, order=${looseOrder}`
    );
    await rm(folder, { recursive: true, force: true });
  }

  // 6b. A rejecting task must reach its own caller and must not strand or poison the lane.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-coord-reject-"));
    const ran: string[] = [];
    const sentinel = new Error("coordinated-boom");
    const first = runExclusive(folder, async () => { ran.push("a"); return "a-value"; });
    const failing = runExclusive(folder, async () => { ran.push("bad"); throw sentinel; });
    const later = runExclusive(folder, async () => { ran.push("c"); return "c-value"; });
    const failure = await failing.then(() => null, (error: unknown) => error);
    check("a task's own rejection reaches its own caller unchanged", failure === sentinel, String(failure));
    check("the value of a resolved task is returned to its caller", (await first) === "a-value" && (await later) === "c-value");
    check("a rejected task does not strand the tasks queued behind it", JSON.stringify(ran) === JSON.stringify(["a", "bad", "c"]), `ran=${ran}`);
    // A lane poisoned by the failure would reject or hang here instead of running normally.
    const afterFailure = await runExclusive(folder, async () => "still-usable");
    check("the lane is still usable for a brand-new task after a failure", afterFailure === "still-usable", afterFailure);
    await drainEventLoop(8);
    check("a failed task leaves no stranded lane behind", !activeFolderCoordinationKeys().includes(folderCoordinationKey(folder)), activeFolderCoordinationKeys().join(", ") || "none");
    await rm(folder, { recursive: true, force: true });
  }

  // 6c. Same gate, two shapes: same key must exclude, different keys must not. Running one harness
  // both ways is what makes each result meaningful — a harness that simply never overlaps would
  // report "excluded" for both.
  {
    const folderA = await mkdtemp(join(tmpdir(), "awkit-coord-a-"));
    const folderB = await mkdtemp(join(tmpdir(), "awkit-coord-b-"));
    const measure = async (keys: readonly [string, string]): Promise<{ max: number; done: string[] }> => {
      const arrived = deferred();
      const done: string[] = [];
      let entered = 0;
      let active = 0;
      let max = 0;
      await Promise.all(keys.map((key, i) => runExclusive(key, async () => {
        active += 1;
        max = Math.max(max, active);
        entered += 1;
        if (entered >= keys.length) arrived.resolve();
        await Promise.race([arrived.promise, drainEventLoop(GATE_DRAIN_TURNS)]);
        done.push(`t${i}`);
        active -= 1;
      })));
      return { max, done };
    };
    const different = await measure([folderA, folderB]);
    const same = await measure([folderA, folderA]);
    check("different resolved folders are coordinated independently and may overlap", different.max === 2 && different.done.length === 2, `maxConcurrent=${different.max}`);
    check("the same resolved folder excludes, measured by the SAME harness", same.max === 1 && same.done.length === 2, `maxConcurrent=${same.max}`);
    check("distinct folders produce distinct coordination keys", folderCoordinationKey(folderA) !== folderCoordinationKey(folderB), `${folderCoordinationKey(folderA)} vs ${folderCoordinationKey(folderB)}`);
    await rm(folderA, { recursive: true, force: true });
    await rm(folderB, { recursive: true, force: true });
  }

  // 6d. Lane lifetime: a key exists only while it is coordinating something.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-coord-life-"));
    const key = folderCoordinationKey(folder);
    check("no lane exists for a folder nothing has written to", !activeFolderCoordinationKeys().includes(key), key);
    const sampled: string[][] = [];
    await runExclusive(folder, async () => { sampled.push(activeFolderCoordinationKeys()); });
    // Positive control: without this, the eviction check below would also pass against a stub that
    // simply never reported any key.
    check("the lane is live while its task is running", sampled.length === 1 && sampled[0].includes(key), sampled.map((s) => `[${s.join(",")}]`).join(" "));
    await drainEventLoop(8);
    check("the lane is evicted once it has nothing left to coordinate", !activeFolderCoordinationKeys().includes(key), activeFolderCoordinationKeys().join(", ") || "none");
    // Re-entrancy: an evicted key must be recreated, not treated as permanently retired.
    const reentry = await measureSameFolderExclusion(folder);
    check("a folder written again after eviction is coordinated again", reentry.max === 1 && reentry.completed === 2, `maxConcurrent=${reentry.max}, completed=${reentry.completed}`);
    await rm(folder, { recursive: true, force: true });
  }

  // 6e. Path spelling: one folder must be one lane, however each caller happened to write the path.
  // A store configured from Settings, one from a default, and one from a joined path can all name
  // the same directory differently; if those split into separate keys the coordinator silently
  // stops coordinating exactly when two different call sites are involved.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-coord-spelling-"));
    const spellings = [
      folder,
      `${folder}${sep}`,
      `${folder}${sep}${sep}`,
      `${folder}${sep}.`,
      `${folder}${sep}nested${sep}..`,
      folder.replace(/[\\/]/g, "/")
    ];
    const keys = new Set(spellings.map(folderCoordinationKey));
    check("every spelling of one folder resolves to a single coordination key", spellings.length === 6 && keys.size === 1, `${spellings.length} spellings -> ${keys.size} key(s): ${[...keys].join(" | ")}`);
    check("a sibling folder is NOT folded into that key", folderCoordinationKey(`${folder}-sibling`) !== [...keys][0], folderCoordinationKey(`${folder}-sibling`));
    // Behavioural, not just textual: two differently spelled paths must actually take turns.
    const arrived = deferred();
    let entered = 0;
    let active = 0;
    let max = 0;
    await Promise.all([spellings[3], spellings[1]].map((spelling) => runExclusive(spelling, async () => {
      active += 1;
      max = Math.max(max, active);
      entered += 1;
      if (entered >= 2) arrived.resolve();
      await Promise.race([arrived.promise, drainEventLoop(GATE_DRAIN_TURNS)]);
      active -= 1;
    })));
    check("two differently spelled paths for one folder actually exclude each other", max === 1 && entered === 2, `maxConcurrent=${max}, entered=${entered}`);
    await rm(folder, { recursive: true, force: true });
  }
}

async function measureSameFolderExclusion(folder: string): Promise<{ max: number; completed: number }> {
  const arrived = deferred();
  let entered = 0;
  let active = 0;
  let max = 0;
  let completed = 0;
  await Promise.all([0, 1].map(() => runExclusive(folder, async () => {
    active += 1;
    max = Math.max(max, active);
    entered += 1;
    if (entered >= 2) arrived.resolve();
    await Promise.race([arrived.promise, drainEventLoop(GATE_DRAIN_TURNS)]);
    completed += 1;
    active -= 1;
  })));
  return { max, completed };
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nWrite queue: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
