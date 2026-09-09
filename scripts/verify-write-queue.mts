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

/** The single exit path: totals are printed here and nowhere else, so every way this file can end —
 *  normal completion, a wedge, an escaped rejection — produces the same `Write queue: N/M` line. */
function finish(): never {
  clearTimeout(runDeadline);
  const passed = results.filter((r) => r.pass).length;
  console.log(`\nWrite queue: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

// Whole-run backstop — awkit-rkd8 GAP 4.
//
// A coordinator that wedges leaves this file awaiting a promise that will never settle. Without a
// deadline that ends one of two ways, and both are unreadable: CI kills the job after its own
// timeout, or — worse — the event loop simply empties, because a never-settling promise holds
// nothing open, and Node exits on an unsettled top-level await with no totals and no failing
// assertion name. This timer is deliberately NOT unref'd: holding the loop open is the whole point,
// so the wedge is reported as a NAMED red with the normal totals instead of vanishing. Nothing
// awaits it, no check synchronizes on it, and `finish()` clears it on the normal path, so it costs a
// green run nothing.
const RUN_DEADLINE_MS = 60_000;
const runDeadline = setTimeout(() => {
  check(
    "the verifier reached its totals without wedging on an unsettled coordination promise",
    false,
    `still running after ${RUN_DEADLINE_MS}ms with ${results.length} checks recorded — the last check printed above is where it wedged`
  );
  finish();
}, RUN_DEADLINE_MS);

// Same requirement from the other direction: a rejection that escapes to the top level would end the
// process with no totals line. Report it as a named red and exit through the one exit path.
process.on("unhandledRejection", (reason: unknown) => {
  check(
    "no promise rejection escaped to the top level of the verifier",
    false,
    reason instanceof Error ? `${reason.message}` : String(reason)
  );
  finish();
});
process.on("uncaughtException", (error: unknown) => {
  check(
    "no exception escaped to the top level of the verifier",
    false,
    error instanceof Error ? `${error.message}` : String(error)
  );
  finish();
});

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
  // Bounded settlement, shared by every block in this section. 6f owned these originally; 6g, 6h and
  // 6i need the identical guarantee, so they are hoisted to the smallest scope all of them can see.
  //
  // A verifier that awaits a wedged coordinator prints no totals and names no failing assertion — a
  // CI timeout instead of a red — which is strictly worse than a failure.
  //
  // Exactly which blocks are LOCALLY bounded, stated precisely because a maintainer extending block 6
  // will rely on it: 6f, 6g, 6h and 6i route every coordinator await through `settleWithin` /
  // `settleAllWithin` and so settle with a NAMED outcome. 6a, 6c, 6d and 6e do NOT — they still
  // `await Promise.all(...)` over `runExclusive` promises directly, and their only protection is the
  // global `runDeadline` backstop at the top of this file, which prints totals and exits rather than
  // hanging. That backstop is a whole-file safety net, not a per-assertion named outcome: a wedge in
  // 6a is reported as "the verifier is still running after N ms", not as the specific check that hung.
  // Extending one of those blocks with a new coordinator await inherits that weaker guarantee, so
  // prefer `settleWithin` in anything added below.
  type Outcome<T> = { kind: "resolved"; value: T } | { kind: "rejected"; error: unknown } | { kind: "timeout" };

  /** Settles with a NAMED outcome even when `promise` never settles, so a deadlock is reported as a
   *  failed check instead of hanging the verifier before it can print its totals. */
  const settleWithin = async <T,>(promise: Promise<T>, ms: number): Promise<Outcome<T>> => {
    promise.catch(() => undefined); // the promise may be abandoned on the timeout path
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<Outcome<T>>((settle) => {
      timer = setTimeout(() => settle({ kind: "timeout" }), ms);
    });
    const outcome = await Promise.race([
      promise.then<Outcome<T>, Outcome<T>>(
        (value) => ({ kind: "resolved", value }),
        (error: unknown) => ({ kind: "rejected", error })
      ),
      expiry
    ]);
    if (timer) clearTimeout(timer); // cleared on BOTH outcomes so a live timer cannot hold the loop open
    return outcome;
  };

  /** Every outcome, in submission order, always the same length as the input. Never rejects and never
   *  outlives `ms`, so one wedged or rejecting member cannot strand the others or the totals line. */
  const settleAllWithin = <T,>(promises: readonly Promise<T>[], ms: number): Promise<Outcome<T>[]> =>
    Promise.all(promises.map((promise) => settleWithin(promise, ms)));

  /** Deadline for the coordination blocks. Generous relative to the event-loop-turn work they do, so
   *  it can only expire on a genuine wedge, never on a slow host. */
  const COORDINATION_DEADLINE_MS = 5000;

  /** Renders an outcome for a check detail, so a red says what actually happened. */
  const describe = <T,>(outcome: Outcome<T>): string =>
    outcome.kind === "resolved"
      ? `resolved(${String(outcome.value)})`
      : outcome.kind === "rejected"
        ? `rejected(${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)})`
        : "TIMEOUT";

  // Direct occupancy instrumentation — awkit-rkd8 GAP 2.
  //
  // Everything below 6f decided mutual exclusion from `activeFolderCoordinationKeys()`: a lane-map
  // SAMPLE. Presence in that map is a proxy — it says a lane object exists, not that exactly one task
  // was inside it. These record when each task actually entered and left, so non-overlap is decided
  // from execution INTERVALS, which is the property the module exists to provide.
  type LifetimeEvent = { id: string; key: string; kind: "enter" | "exit"; at: number };
  /** A task's observed occupancy. `enter`/`exit` are ticks of a logical clock that advances once per
   *  observed event, so two spans intersect exactly when the tasks were genuinely inside together. */
  type Span = { id: string; key: string; enter: number; exit: number };

  /** Capture is deliberately permissive — every event is kept, including duplicates and orphans — so
   *  the strict predicates below can SEE a malformed observation rather than silently validating a
   *  well-formed subset of it. */
  const lifetimeRecorder = () => {
    const events: LifetimeEvent[] = [];
    let clock = 0;
    const mark = (id: string, key: string, kind: "enter" | "exit"): void => {
      clock += 1;
      events.push({ id, key, kind, at: clock });
    };
    return {
      events,
      /** Wraps a task body so its entry and exit are both timestamped even if the body throws. */
      observe:
        <T,>(id: string, key: string, body: () => Promise<T>) =>
          async (): Promise<T> => {
            mark(id, key, "enter");
            try {
              return await body();
            } finally {
              mark(id, key, "exit");
            }
          },
      render: (): string => events.map((e) => `${e.id}:${e.kind}`).join(" ")
    };
  };

  /** Pairs events into spans, or returns `null` when ANY requested id is missing an enter, missing an
   *  exit, duplicated, or exits no later than it entered. Returning `null` rather than a shorter array
   *  is the whole point: a missing observation must not read as an empty — and therefore trivially
   *  non-overlapping, trivially in-order — interval set. */
  const spansOf = (events: readonly LifetimeEvent[], ids: readonly string[]): Span[] | null => {
    const spans: Span[] = [];
    for (const id of ids) {
      const enters = events.filter((e) => e.id === id && e.kind === "enter");
      const exits = events.filter((e) => e.id === id && e.kind === "exit");
      if (enters.length !== 1 || exits.length !== 1) return null;
      if (enters[0].key !== exits[0].key) return null;
      if (exits[0].at <= enters[0].at) return null;
      spans.push({ id, key: enters[0].key, enter: enters[0].at, exit: exits[0].at });
    }
    return spans;
  };

  /** Every pair of same-key spans whose occupancy intervals intersect. Direct evidence of a mutual
   *  exclusion failure; no lane-map sample can produce it. */
  const overlappingSameKeyPairs = (spans: readonly Span[]): string[] => {
    const clashes: string[] = [];
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        if (spans[i].key !== spans[j].key) continue;
        if (spans[i].enter < spans[j].exit && spans[j].enter < spans[i].exit) {
          clashes.push(`${spans[i].id}[${spans[i].enter},${spans[i].exit}] x ${spans[j].id}[${spans[j].enter},${spans[j].exit}]`);
        }
      }
    }
    return clashes;
  };

  /** Peak simultaneous occupancy of one key, walked over the event stream in clock order. */
  const maxConcurrentOnKey = (events: readonly LifetimeEvent[], key: string): number => {
    let active = 0;
    let max = 0;
    for (const event of events.filter((e) => e.key === key).sort((a, b) => a.at - b.at)) {
      active += event.kind === "enter" ? 1 : -1;
      max = Math.max(max, active);
    }
    return max;
  };

  const renderSpans = (spans: readonly Span[] | null): string =>
    spans === null ? "unpairable" : `[${spans.map((s) => `${s.id}(${s.enter}-${s.exit})`).join(" ")}]`;

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

  // 6f. Same-key RE-ENTRANCY: a task already running on a lane that asks for that same lane again —
  // awkit-utbf.
  //
  // `owned.tail.then(task, task)` makes the inner call wait on a tail that only settles once the
  // OUTER task returns, while the outer task is waiting on the inner one. Nothing breaks the cycle:
  // there is no timeout and no diagnostic, `pending` never reaches 0, the lane is never evicted, and
  // every store in the process pointed at that folder wedges for the process lifetime. The symptom
  // today is a CI timeout with no failing assertion name, which is strictly worse than a red — so
  // every check below is BOUNDED and reports its own failure by name.
  //
  // The contract: a same-key re-entrant call must REJECT, naming the re-entrancy and the coordination
  // key, without mutating lane state. It must discriminate by async CONTEXT, not by "the lane is
  // busy" — an ordinary caller outside the running task still queues normally (6f-b), and a nested
  // call on a DIFFERENT folder is untouched (6f-c). Those two are what stop a guard from satisfying
  // 6f-a by simply rejecting everything that arrives while a lane is occupied.
  {
    // `settleWithin` / `Outcome<T>` are the block-6 helpers hoisted at the top of this section; this
    // block's semantics are unchanged by the move — it still bounds every await it performs.
    const REENTRANT_DEADLINE_MS = 1500;
    /** The guard's message must contain this substring, and the coordination key, verbatim. */
    const REENTRANCY_MARKER = "re-entrant folder write coordination";
    const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

    // 6f-a / 6f-d. One run answers both questions: what the re-entrant call DID, and what it LEFT
    // BEHIND. They share a run because the lane state to inspect is the state that run produced.
    {
      const folder = await mkdtemp(join(tmpdir(), "awkit-coord-reentrant-"));
      const key = folderCoordinationKey(folder);
      const outcomes: Outcome<string>[] = [];
      const abandoned: Promise<string>[] = [];
      let activeWhileRunning: string[] = [];

      await runExclusive(folder, async () => {
        activeWhileRunning = activeFolderCoordinationKeys();
        // The defect under test: the task holding the lane asks for the same lane again.
        const inner = runExclusive(folder, async () => "inner-value");
        abandoned.push(inner);
        outcomes.push(await settleWithin(inner, REENTRANT_DEADLINE_MS));
        // Returning the moment the race settles is what lets the lane drain when no guard exists:
        // the queued inner task can only start once THIS task's tail settles, so the verifier can
        // still finish and print totals on the timed-out path.
      });
      // Safe only now that the outer task has returned — un-guarded, the abandoned inner runs here.
      await Promise.all(abandoned.map((p) => p.then(() => undefined, () => undefined)));

      const outcome: Outcome<string> = outcomes[0] ?? { kind: "timeout" };
      const rejection = outcome.kind === "rejected" ? messageOf(outcome.error) : "";

      // Cardinality FIRST: an empty key set would let the eviction assertion below pass vacuously.
      check(
        "exactly one lane is active while the re-entrant task runs, and it is this folder's key",
        activeWhileRunning.length === 1 && activeWhileRunning[0] === key,
        `active=[${activeWhileRunning.join(",")}], expected=[${key}]`
      );
      check(
        `a same-key re-entrant call rejects within ${REENTRANT_DEADLINE_MS}ms instead of deadlocking`,
        outcome.kind === "rejected",
        outcome.kind === "timeout"
          ? `did not reject within ${REENTRANT_DEADLINE_MS}ms — the lane deadlocked`
          : `outcome=${outcome.kind}`
      );
      check(
        `the re-entrancy rejection names same-key re-entrancy ("${REENTRANCY_MARKER}")`,
        rejection.includes(REENTRANCY_MARKER),
        rejection || `outcome=${outcome.kind}`
      );
      check(
        "the re-entrancy rejection includes the coordination key",
        rejection.length > 0 && rejection.includes(key),
        rejection ? `expected key=${key}` : `outcome=${outcome.kind}`
      );

      await drainEventLoop(8);
      const leftBehind = activeFolderCoordinationKeys();
      check(
        // Named for the END STATE it samples, not for the interim it does not: this reads the active
        // keys once, after the drain, so it decides that the lane evicted normally — not that lane
        // state was never mutated along the way.
        "a rejected re-entrant call still lets the lane evict normally — no lane survives the drain",
        outcome.kind === "rejected" && leftBehind.length === 0,
        `outcome=${outcome.kind}, active=${leftBehind.join(",") || "none"}`
      );
      await rm(folder, { recursive: true, force: true });
    }

    // 6f-b. A caller OUTSIDE the running task is not re-entrant, however busy the lane is: it must
    // still be admitted, and must still run behind the task in FIFO order. This is what proves the
    // guard discriminates by async context, so it must pass both before and after the guard exists.
    {
      const folder = await mkdtemp(join(tmpdir(), "awkit-coord-outside-"));
      const sequence: string[] = [];
      const started = deferred();
      const release = deferred();
      const running = runExclusive(folder, async () => {
        sequence.push("running-start");
        started.resolve();
        await release.promise;
        sequence.push("running-end");
        return "running-value";
      });
      await started.promise; // this continuation belongs to the top level, NOT to the running task
      const outside = runExclusive(folder, async () => { sequence.push("outside"); return "outside-value"; });
      // Every chance to jump the queue; a task correctly waiting on a lane can never arrive.
      await drainEventLoop(GATE_DRAIN_TURNS);
      const jumpedAhead = sequence.includes("outside");
      release.resolve();
      const outsideOutcome = await settleWithin(outside, REENTRANT_DEADLINE_MS);
      const runningOutcome = await settleWithin(running, REENTRANT_DEADLINE_MS);
      check(
        "an outside caller on the same key is still admitted while a task is running",
        outsideOutcome.kind === "resolved" && outsideOutcome.value === "outside-value"
          && runningOutcome.kind === "resolved" && runningOutcome.value === "running-value",
        `outside=${outsideOutcome.kind}, running=${runningOutcome.kind}`
      );
      check(
        "an outside same-key caller runs AFTER the running task, in FIFO order",
        !jumpedAhead && JSON.stringify(sequence) === JSON.stringify(["running-start", "running-end", "outside"]),
        `sequence=${sequence}`
      );
      await drainEventLoop(8);
      await rm(folder, { recursive: true, force: true });
    }

    // 6f-c. A nested call on a DIFFERENT folder is not re-entrancy on that key, so it must keep
    // working. Without this, a guard could satisfy 6f-a by rejecting every nested call there is.
    {
      const folderA = await mkdtemp(join(tmpdir(), "awkit-coord-nested-a-"));
      const folderB = await mkdtemp(join(tmpdir(), "awkit-coord-nested-b-"));
      const nested = await settleWithin(
        runExclusive(folderA, async () => runExclusive(folderB, async () => "nested-b-value")),
        REENTRANT_DEADLINE_MS
      );
      check(
        "a task running on one folder can still nest a call on a DIFFERENT folder",
        nested.kind === "resolved" && nested.value === "nested-b-value",
        nested.kind === "resolved" ? String(nested.value) : `outcome=${nested.kind}`
      );
      await drainEventLoop(8);
      await rm(folderA, { recursive: true, force: true });
      await rm(folderB, { recursive: true, force: true });
    }
  }

  // 6g. Lane lifetime under a QUEUE: a lane must NOT be evicted while admitted work is still queued
  // behind the task that is currently running — awkit-s410.
  //
  // Every existing eviction check (6b, 6d, 6f-a) samples only the FINAL state, after everything
  // admitted has drained — 6d and 6f-a hold one task at a time, and 6b admits three at once but does
  // not sample until all of them plus a fourth have settled — so not one of them ever observes the
  // lane while work is still queued behind the runner. Measured, not argued: every one of them passed
  // under the pending-at-start mutant. A coordinator that released the lane on the
  // RUNNING task's settle — incrementing `pending` at task start rather than at admission, or
  // deleting the key without consulting the queue behind it — would pass all of them while silently
  // un-serializing the task waiting behind: that task would then run on a fresh second lane,
  // concurrently with anything else admitted in the meantime, which is the mutual exclusion this
  // module exists to provide. Proving it requires TWO tasks on one key at once, with the sample
  // taken from inside the QUEUED task — it must still see this key live.
  //
  // What this block MEASURES is lane-map presence, not overlap: it admits no third caller, so the
  // un-serialization above is a consequence argued from the implementation (an evicted key means the
  // next arrival builds a fresh lane whose tail is already resolved), not a concurrency this block
  // observed. That proxy is sound for the eviction mutant it was built for and is blind to a lane
  // that stays in the map while its tail stops chaining. Both of those blind spots are now MEASURED
  // rather than argued, in 6h (a third same-key caller, continuity and FIFO) and 6i (occupancy
  // intervals) — awkit-rkd8. This block is kept as-is: it is the regression guard for the
  // pending-at-start mutant it was measured against, and 6h/6i are additions, not replacements.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-coord-queued-"));
    const key = folderCoordinationKey(folder);
    const release = deferred();
    const insideT2: string[][] = [];

    const t1 = runExclusive(folder, async () => { await release.promise; return "t1"; });
    await drainEventLoop(4);          // T1 is running; this continuation is TOP-LEVEL, not T1's ALS context

    const t2 = runExclusive(folder, async () => { insideT2.push(activeFolderCoordinationKeys()); return "t2"; });
    await drainEventLoop(GATE_DRAIN_TURNS);   // give T2 every chance to jump the queue

    // Named for what the predicate decides: T2's body has NOT run. It deliberately does NOT claim T2
    // was admitted — a rejected or never-admitted T2 would satisfy this too. Admission is a PAIR-level
    // fact, established by the Promise.all below resolving and check 2 finding T2's sample, so read
    // this as the first half of an admitted-but-not-started proof, never as standalone evidence.
    check(
      "a second same-key task has not started while the first still holds the lane",
      insideT2.length === 0,
      `insideT2=[${insideT2.map((s) => `[${s.join(",")}]`).join(" ")}], expected=[] while T1 still holds the lane`
    );

    release.resolve();
    // BOUNDED — awkit-rkd8 GAP 4. This was `await Promise.all([t1, t2])`, which under a coordinator
    // that wedges a queued task never returns: no totals, no failing assertion name. Both outcomes are
    // now NAMED, and the settlement fact is asserted BEFORE anything reads `insideT2`, so a wedged or
    // rejected pair reds here instead of quietly shaping the samples the checks below quantify over.
    const [outcomeT1, outcomeT2] = await settleAllWithin([t1, t2], COORDINATION_DEADLINE_MS);
    check(
      "the running and queued same-key tasks both settled within the bounded deadline",
      outcomeT1.kind === "resolved" && outcomeT1.value === "t1" && outcomeT2.kind === "resolved" && outcomeT2.value === "t2",
      `t1=${describe(outcomeT1)}, t2=${describe(outcomeT2)}, deadline=${COORDINATION_DEADLINE_MS}ms`
    );

    // Cardinality/presence FIRST — an empty sample would let the eviction assertion below pass vacuously.
    //
    // DISCLOSED BLIND SPOT — this is a single-instant presence sample, not a continuity proof. It
    // reads the lane map exactly once, at T2's first instruction, so it cannot distinguish a lane
    // that was never evicted from one that was evicted and re-added before the sample was taken.
    // That is the DUAL of the blind spot disclosed in this block's header. The mutant that fits
    // through it is ARGUED from the coordinator's structure and was NOT executed — unlike the
    // pending-at-start mutant this block was measured against above, nothing below has been run
    // red: a coordinator that deleted the key when T1 settled but created lanes lazily at TASK
    // START (get-or-create) instead of at admission should pass this check green, because T2
    // captured its lane reference at admission so it would still run, and its own first
    // instruction would re-insert the key that the sample then sees. Stated without overstatement,
    // and equally argued: under that mutant T2 itself is still chained behind T1 and stays
    // serialized; what would run un-serialized is a THIRD same-key arrival that finds no lane and
    // builds a fresh one.
    //
    // awkit-rkd8 CORRECTION, adjudicated against the coordinator source: the paragraph above located
    // that third arrival "in the window between T1's settle and T2's start". No external caller can
    // be admitted there. `runExclusive` captures its lane reference and installs
    // `tail.then(runTask, runTask)` SYNCHRONOUSLY at admission, so T1's settle and T2's start are
    // adjacent links in one already-registered reaction chain; those reactions drain ahead of any
    // later macrotask, and a top-level caller can only arrive on a later turn. That window is not
    // observable, and a test asserting anything inside it would be asserting a fiction. The
    // reachable invariant is CONTINUITY — a third caller arriving LATER, while T2 runs, must land on
    // the same chain — and that is what 6h admits and measures.
    check(
      "the QUEUED task sampled exactly one live lane at its first instruction, and it is this key",
      insideT2.length === 1 && insideT2[0].length === 1 && insideT2[0][0] === key,
      `insideT2=[${insideT2.map((s) => `[${s.join(",")}]`).join(" ")}], expected=[[${key}]]`
    );

    await drainEventLoop(8);
    // Leak check — named for what it actually proves. Absence here is satisfied by a lane evicted
    // CORRECTLY and, equally, by one evicted a task too early: measured under the pending-at-start
    // mutant, this check still passed and only the presence sample above went red. The ordering is
    // established by the PAIR; this half alone catches evict-never, not evict-too-early.
    check(
      "this key's lane does not survive once the running and queued tasks have both drained",
      !activeFolderCoordinationKeys().includes(key),
      `active=${activeFolderCoordinationKeys().join(",") || "none"}, expected: without ${key}`
    );
    await rm(folder, { recursive: true, force: true });
  }

  // 6h. A THIRD same-key caller: one continuous serialization chain — awkit-rkd8 GAP 1 and GAP 3.
  //
  // 6g admits two callers and decides everything from a single-instant lane-map sample. Two defect
  // shapes walk straight through that. One: a lane evicted a task too early and REBUILT by the next
  // arrival — the map is populated at every instant anyone looks, just never by the same lane object,
  // so the chain silently restarts. Two: a lane that stays in the map while `tail` stops advancing —
  // present, but no longer chaining new work behind the running task. Neither is a lane-map fact, so
  // no lane-map sample can exclude them.
  //
  // The third caller is admitted at the one moment that makes both observable: AFTER the lane has
  // already retired T1 and while T2 is running. Under correct code the lane survives that handover
  // (T2's admission kept `pending` above zero) and T3 chains behind T2 on the same generation. Under
  // premature eviction T3 finds no lane, builds a fresh one whose tail is already resolved, and runs
  // BESIDE T2 — measured below as an interval intersection, not inferred from the map.
  //
  // On why the third caller lands here and not earlier: see the awkit-rkd8 correction in 6g. The
  // window "between T1's settle and T2's start" that awkit-s410 named is not enterable by an external
  // caller, so this block asserts the invariant that is actually reachable — continuity — rather than
  // a timing fiction.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-coord-continuity-"));
    const key = folderCoordinationKey(folder);
    const recorder = lifetimeRecorder();
    const releaseT1 = deferred();
    const releaseT2 = deferred();
    const ids = ["T1", "T2", "T3"];

    const t1 = runExclusive(folder, recorder.observe("T1", key, async () => { await releaseT1.promise; return "T1"; }));
    await drainEventLoop(4);
    const t2 = runExclusive(folder, recorder.observe("T2", key, async () => { await releaseT2.promise; return "T2"; }));
    await drainEventLoop(4);

    // Hand the lane from T1 to T2 and let the chain settle. Asserted, not assumed: the third caller's
    // whole purpose depends on arriving after a completed handover, so a run that never reached that
    // state must say so by name rather than quietly measuring something else.
    releaseT1.resolve();
    await drainEventLoop(GATE_DRAIN_TURNS);
    check(
      "the lane completed one handover before the third same-key caller arrived",
      recorder.render() === "T1:enter T1:exit T2:enter",
      `events=[${recorder.render()}], expected=[T1:enter T1:exit T2:enter]`
    );

    // Admitted HERE: top level, later than T2, while T2 is still inside the lane.
    const t3 = runExclusive(folder, recorder.observe("T3", key, async () => "T3"));
    await drainEventLoop(GATE_DRAIN_TURNS);   // every chance for T3 to overtake or run beside T2
    // This predicate decides ONE thing: T3 has recorded no lifetime event yet. It does not decide that
    // T3 was admitted — a T3 rejected outright at admission would also record no event and would pass
    // here. That is why the name does not say "admitted": admission is decided by the settlement check
    // immediately below, which requires T3 to resolve with its own value and reds on a rejection.
    check(
      "the third same-key caller has not started beside the running task",
      !recorder.events.some((e) => e.id === "T3"),
      `events=[${recorder.render()}], expected no T3 event while T2 still holds the lane`
    );

    releaseT2.resolve();
    const outcomes = await settleAllWithin([t1, t2, t3], COORDINATION_DEADLINE_MS);
    const values = outcomes.map((o) => (o.kind === "resolved" ? o.value : `<${o.kind}>`));
    check(
      "all three same-key callers settled within the bounded deadline, each with its own value",
      outcomes.length === ids.length && ids.every((id, i) => values[i] === id),
      `outcomes=[${outcomes.map(describe).join(", ")}], expected=[${ids.join(", ")}], deadline=${COORDINATION_DEADLINE_MS}ms`
    );

    // Cardinality BEFORE ordering and overlap: all three predicates below quantify over the observed
    // events, and every one of them is trivially satisfiable by an empty or partial observation set.
    const enters = recorder.events.filter((e) => e.kind === "enter");
    const exits = recorder.events.filter((e) => e.kind === "exit");
    check(
      "each of the three same-key callers entered the lane exactly once",
      enters.length === ids.length && ids.every((id) => enters.filter((e) => e.id === id).length === 1),
      `enters=[${enters.map((e) => e.id).join(",") || "none"}], expected exactly one each of ${ids.join(",")}`
    );
    check(
      "each of the three same-key callers exited the lane exactly once",
      exits.length === ids.length && ids.every((id) => exits.filter((e) => e.id === id).length === 1),
      `exits=[${exits.map((e) => e.id).join(",") || "none"}], expected exactly one each of ${ids.join(",")}`
    );
    check(
      "the three same-key callers produced exactly six lifetime events and nothing else",
      recorder.events.length === ids.length * 2,
      `events=${recorder.events.length} ([${recorder.render()}]), expected=${ids.length * 2}`
    );

    const spans = spansOf(recorder.events, ids);
    check(
      "each of the three same-key callers has a well-formed occupancy interval",
      spans !== null && spans.length === ids.length,
      spans === null
        ? `unpairable events: [${recorder.events.map((e) => `${e.id}:${e.kind}@${e.at}`).join(" ")}]`
        : renderSpans(spans)
    );
    const clashes = spans === null ? [] : overlappingSameKeyPairs(spans);
    check(
      "the third same-key caller did not overlap the task it was admitted behind",
      spans !== null && spans.length === ids.length && clashes.length === 0,
      spans === null
        ? "unpairable spans — overlap is undecidable here, not absent"
        : `overlaps=[${clashes.join("; ") || "none"}], spans=${renderSpans(spans)}`
    );
    // NAMED FOR WHAT IT DECIDES, deliberately. The predicate compares occupancy intervals: three
    // well-formed spans, each starting only after the previous one ended, in admission order. It does
    // NOT decide that one lane OBJECT survived all three callers — that is lane-generation identity,
    // which this verifier is forbidden to observe and does not observe. A coordinator that rebuilt the
    // lane between callers yet still serialized them strictly would pass here, and would be correct:
    // serialization is the contract, lane identity is an implementation detail. What makes this the
    // right GAP 1 assertion anyway is mutant M1: premature eviction does not merely rebuild the lane,
    // it lets the rebuilt lane run T3 BESIDE T2, which shows up here as an interleaving and goes red.
    check(
      "the three same-key callers occupied the lane strictly one after another, in FIFO admission order",
      spans !== null && spans.length === ids.length && spans.every((span, i) => i === 0 || spans[i - 1].exit < span.enter),
      `spans=${renderSpans(spans)}, expected ${ids.join(" then ")} with no interleaving`
    );

    await drainEventLoop(8);
    check(
      "this key's lane does not survive once all three same-key callers have drained",
      !activeFolderCoordinationKeys().includes(key),
      `active=${activeFolderCoordinationKeys().join(",") || "none"}, expected: without ${key}`
    );
    await rm(folder, { recursive: true, force: true });
  }

  // 6i. Mutual exclusion measured DIRECTLY, from occupancy intervals — awkit-rkd8 GAP 2.
  //
  // 6d and 6g decide exclusion from `activeFolderCoordinationKeys()`. Presence in that map says a
  // lane OBJECT exists; it does not say exactly one task was inside it, and no sequence of samples
  // can, because the map is not where overlap lives. This block records when each task actually
  // entered and left and decides six separate facts from those intervals — every caller entered,
  // every caller exited, the event count is exact, peak occupancy is exactly 1, no two intervals
  // intersect, and the order is FIFO. Cardinality comes first every time: `.every()` over a dropped
  // observation is precisely how a check like this passes while the defect it exists for is present.
  //
  // The control at the end runs the SAME recorder and the SAME overlap predicate over deliberately
  // un-serialized work. Without it, "no intervals intersected" would be equally true of an instrument
  // that cannot detect an intersection at all.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-coord-overlap-"));
    const key = folderCoordinationKey(folder);
    const recorder = lifetimeRecorder();
    const ids = ["W0", "W1", "W2", "W3"];
    const lengths = [12, 3, 9, 1];   // deliberately not descending: a shortest-first result is overlap

    const outcomes = await settleAllWithin(
      ids.map((id, i) => runExclusive(folder, recorder.observe(id, key, async () => {
        await drainEventLoop(lengths[i]);
        return id;
      }))),
      COORDINATION_DEADLINE_MS
    );
    const values = outcomes.map((o) => (o.kind === "resolved" ? o.value : `<${o.kind}>`));
    check(
      "every same-key writer settled within the bounded deadline, each with its own value",
      outcomes.length === ids.length && ids.every((id, i) => values[i] === id),
      `outcomes=[${outcomes.map(describe).join(", ")}], expected=[${ids.join(", ")}], deadline=${COORDINATION_DEADLINE_MS}ms`
    );

    const enters = recorder.events.filter((e) => e.kind === "enter");
    const exits = recorder.events.filter((e) => e.kind === "exit");
    check(
      "every same-key writer entered the lane exactly once",
      enters.length === ids.length && ids.every((id) => enters.filter((e) => e.id === id).length === 1),
      `enters=[${enters.map((e) => e.id).join(",") || "none"}], expected exactly one each of ${ids.join(",")}`
    );
    check(
      "every same-key writer exited the lane exactly once",
      exits.length === ids.length && ids.every((id) => exits.filter((e) => e.id === id).length === 1),
      `exits=[${exits.map((e) => e.id).join(",") || "none"}], expected exactly one each of ${ids.join(",")}`
    );
    check(
      "the same-key writers produced exactly one enter and one exit each and nothing else",
      recorder.events.length === ids.length * 2,
      `events=${recorder.events.length} ([${recorder.render()}]), expected=${ids.length * 2}`
    );

    const spans = spansOf(recorder.events, ids);
    check(
      "every same-key writer has a well-formed occupancy interval",
      spans !== null && spans.length === ids.length,
      spans === null
        ? `unpairable events: [${recorder.events.map((e) => `${e.id}:${e.kind}@${e.at}`).join(" ")}]`
        : renderSpans(spans)
    );
    const clashes = spans === null ? [] : overlappingSameKeyPairs(spans);
    check(
      "no two same-key occupancy intervals intersect",
      spans !== null && spans.length === ids.length && clashes.length === 0,
      spans === null
        ? "unpairable spans — overlap is undecidable here, not absent"
        : `overlaps=[${clashes.join("; ") || "none"}], spans=${renderSpans(spans)}`
    );
    check(
      "at most one same-key writer occupied the lane at any instant",
      spans !== null && spans.length === ids.length && maxConcurrentOnKey(recorder.events, key) === 1,
      `maxConcurrent=${maxConcurrentOnKey(recorder.events, key)} over ${spans?.length ?? 0}/${ids.length} spans, expected exactly 1`
    );
    check(
      "the same-key writers occupied the lane in FIFO admission order",
      spans !== null && spans.length === ids.length && spans.every((span, i) => i === 0 || spans[i - 1].exit < span.enter),
      `spans=${renderSpans(spans)}, expected ${ids.join(" then ")} with no interleaving`
    );
    await rm(folder, { recursive: true, force: true });

    // CONTROL — the same recorder, the same span pairing, the same overlap predicate, over four tasks
    // the coordinator does NOT serialize with each other (four distinct folders). They share one
    // recorder label so the same-key predicate compares them: if this does not find intersections,
    // the six assertions above are measuring nothing.
    const controlIds = ["C0", "C1", "C2", "C3"];
    const controlFolders: string[] = [];
    for (let i = 0; i < controlIds.length; i += 1) {
      controlFolders.push(await mkdtemp(join(tmpdir(), "awkit-coord-overlap-control-")));
    }
    const controlRecorder = lifetimeRecorder();
    const allArrived = deferred();
    let arrivedCount = 0;
    const controlOutcomes = await settleAllWithin(
      controlFolders.map((controlFolder, i) => runExclusive(controlFolder, controlRecorder.observe(controlIds[i], "control", async () => {
        arrivedCount += 1;
        if (arrivedCount >= controlIds.length) allArrived.resolve();
        await Promise.race([allArrived.promise, drainEventLoop(GATE_DRAIN_TURNS)]);
        return controlIds[i];
      }))),
      COORDINATION_DEADLINE_MS
    );
    const controlSpans = spansOf(controlRecorder.events, controlIds);
    const controlClashes = controlSpans === null ? [] : overlappingSameKeyPairs(controlSpans);
    check(
      "control: the same instrument DOES detect intersecting intervals when work is not coordinated",
      controlOutcomes.length === controlIds.length &&
        controlOutcomes.every((outcome) => outcome.kind === "resolved") &&
        controlSpans !== null &&
        controlSpans.length === controlIds.length &&
        controlClashes.length > 0 &&
        maxConcurrentOnKey(controlRecorder.events, "control") === controlIds.length,
      `maxConcurrent=${maxConcurrentOnKey(controlRecorder.events, "control")}, overlaps=${controlClashes.length}, spans=${renderSpans(controlSpans)}`
    );
    for (const controlFolder of controlFolders) await rm(controlFolder, { recursive: true, force: true });
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

finish();
