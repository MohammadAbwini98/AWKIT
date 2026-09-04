// Durability checks for the JSON profile store (src/storage/ProfileStore.ts) that persists the
// user's flows / workflows / data sources / reports. No Electron — pure fs semantics in a temp dir.
//
// Guards audit findings A1 (non-atomic write), A2 (silent corrupt-file drop), A3 (non-atomic
// id-rename update), and S1 (concurrent-save race).
//
// Run: npx tsx scripts/verify-profile-store.mts
import { mkdir, mkdtemp, readdir, rename, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { replaceFileAtomically } from "../src/storage/atomicReplace";
import { activeFolderCoordinationKeys, folderCoordinationKey } from "../src/storage/folderWriteCoordinator";
import { JsonProfileStore } from "../src/storage/ProfileStore";

interface Doc {
  id: string;
  name: string;
  payload: string;
}

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  [PASS]" : "  [FAIL]"} ${name}${detail ? ` -- ${detail}` : ""}`);
}

const tmpFiles = async (folder: string) => (await readdir(folder)).filter((f) => f.endsWith(".tmp"));
const jsonFiles = async (folder: string) => (await readdir(folder)).filter((f) => f.endsWith(".json"));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

/**
 * Yields the event loop a bounded number of times. NOT a sleep: nothing waits on wall-clock time, so
 * the result does not depend on how fast the host is — only on the loop having been given `turns`
 * chances to make progress.
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

/** Retained for callers that only need to yield the loop. NOT a valid bound for the concurrency
 *  gate — see `drainFilesystemTurns`. */
const GATE_DRAIN_TURNS = 200;

/**
 * Filesystem round trips the concurrency gate's escape arm spends before giving up on a writer that
 * has not arrived. Sized by measurement in `verify-r0-characterization.mts`, which carries the same
 * gate: at 64 turns the margin over a genuinely free writer was only 4.2x, so 256 is used here too.
 */
const GATE_FS_TURNS = 256;

/**
 * The always-terminating arm of the concurrency gate, paced in the SAME currency a competing writer
 * spends: real filesystem round trips.
 *
 * MEASURED CORRECTION (2026-09-04). This arm used to be `drainEventLoop(200)`, described above as
 * "long enough for any writer that is genuinely free to reach its rename". That was false. 200 chained
 * `setImmediate` turns cost a median of 0.746 ms, while a free writer must still complete a
 * `writeFile` — a libuv THREADPOOL round trip — at a median of 0.855 ms; in 19 of 25 measured samples
 * the free writer was slower than the bound. Every `maxActive === 1` assertion in this file therefore
 * rested on winning a coin flip: "no overlap observed" could mean the holder simply finished first.
 * Spending filesystem round trips makes the bound dominate a free writer by construction, while a
 * writer queued behind a folder lane still cannot arrive however many are spent. Still no sleep.
 */
async function drainFilesystemTurns(folder: string, turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await readdir(folder).catch(() => [] as string[]);
  }
}

interface OverlapProbe {
  renameFor(owner: string): (from: string, to: string) => Promise<void>;
  readonly maxActive: number;
  readonly events: readonly string[];
  readonly keysOnEnter: readonly (readonly string[])[];
  /** Renames that threw, i.e. attempts `replaceFileAtomically` went on to retry. */
  readonly renameFailures: readonly string[];
}

/**
 * Measures whether two or more writers can be inside atomic replacement at the same instant, with no
 * sleep and no wall-clock timing. Each writer records `enter`, waits on
 * `race(allArrived, drainFilesystemTurns(folder, n))`, renames, records `exit`. Both arms of that race
 * terminate: independent per-instance queues let every writer arrive (so `allArrived` wins and the
 * overlap is observable), while one lane per resolved folder makes arrival impossible for the queued
 * writers (so the bounded drain wins and the holder proceeds alone). Neither shape can hang.
 *
 * MEASURED CORRECTION (2026-09-04): `exit` is recorded in a `finally`. It used to be recorded only on
 * the success path, and `replaceFileAtomically` RETRIES `renameImpl` on transient `EPERM`/`EBUSY`, so
 * one writer whose first rename lost a Windows sharing race re-entered with `active` still held —
 * fabricating `maxActive=2` and an interleaved log for a SINGLE writer, which fails the non-overlap
 * assertions against a correct implementation. Observed doing exactly that in the sibling verifier.
 */
function overlapProbe(writerCount: number): OverlapProbe {
  const allArrived = deferred();
  const events: string[] = [];
  const keysOnEnter: string[][] = [];
  const renameFailures: string[] = [];
  let arrived = 0;
  let active = 0;
  let maxActive = 0;

  return {
    renameFor: (owner: string) => async (from: string, to: string): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`${owner}:enter`);
      keysOnEnter.push(activeFolderCoordinationKeys());
      arrived += 1;
      if (arrived >= writerCount) allArrived.resolve();
      try {
        await Promise.race([allArrived.promise, drainFilesystemTurns(dirname(to), GATE_FS_TURNS)]);
        await rename(from, to);
      } catch (error) {
        renameFailures.push(`${owner}: ${(error as Error).message}`);
        throw error;
      } finally {
        events.push(`${owner}:exit`);
        active -= 1;
      }
    },
    get maxActive() { return maxActive; },
    get events() { return events; },
    get keysOnEnter() { return keysOnEnter; },
    get renameFailures() { return renameFailures; }
  };
}

/**
 * Re-measures the assumption every `maxActive === 1` assertion rests on: that the gate's escape arm
 * outlasts a writer that is genuinely free. If it does not, "no overlap was observed" stops being
 * evidence of coordination — which is the defect this harness shipped with until 2026-09-04.
 *
 * MEASURED CORRECTION (2026-09-04, second round). The free-writer proxy used to be `writeFile(512B)`
 * plus `rm` — TWO filesystem round trips. Every `maxActive === 1` assertion it licenses gates
 * `store.create(...)`, which before it ever reaches `renameImpl` performs a recursive `mkdir`
 * (`ensureStoreFolder`), a second `mkdir` plus (with a seed folder) a `readdir` from `ensureSeeded`,
 * a `readFile` that misses with ENOENT, and the temp `writeFile`. Timing a 2-round-trip stand-in and
 * then licensing a 5-round-trip operation understated the free writer by well over 2x, so the printed
 * margin flattered the gate against the operation actually under test. The proxy now spends the same
 * currency in the same quantity as the gated operation. The THRESHOLD is unchanged (`> free * 4`) —
 * only the thing being measured was wrong.
 */
async function gateBoundDominatesAFreeWriter(folder: string): Promise<{ bound: number; free: number }> {
  const time = async (work: () => Promise<unknown>): Promise<number> => {
    const started = process.hrtime.bigint();
    await work();
    return Number(process.hrtime.bigint() - started) / 1e6;
  };
  const bounds: number[] = [];
  const frees: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    bounds.push(await time(() => drainFilesystemTurns(folder, GATE_FS_TURNS)));
    frees.push(await time(async () => {
      // The pre-rename work of a real `create()`, step for step, so the bound is compared against the
      // operation the assertions actually gate rather than against a cheaper stand-in.
      const scratch = join(folder, `bound-probe-${sample}.tmp`);
      await mkdir(folder, { recursive: true });                                   // ensureStoreFolder
      await readdir(folder);                                                      // ensureSeeded scan
      await readFile(join(folder, `bound-probe-absent-${sample}.json`), "utf8")   // get(): ENOENT miss
        .then(() => undefined, () => undefined);
      await writeFile(scratch, "x".repeat(512), "utf8");                          // atomicWrite temp
      await rm(scratch, { force: true });
    }));
  }
  // Pessimistic pairing on purpose: cheapest bound against dearest free writer.
  return { bound: Math.min(...bounds), free: Math.max(...frees) };
}

/** First point where one critical section opened before the previous one closed, or null. */
function firstInterleave(events: readonly string[]): string | null {
  for (let index = 0; index + 1 < events.length; index += 1) {
    if (events[index].endsWith(":enter") && events[index + 1].endsWith(":enter")) {
      return `${events[index]} -> ${events[index + 1]}`;
    }
  }
  return null;
}

/**
 * The pre-R1B design rebuilt locally: a write chain owned by the INSTANCE rather than by the
 * destination folder, plus the same check-then-write `create` shape. Two of these aimed at one folder
 * is exactly what shipped before `folderWriteCoordinator`, so it is the control that proves the
 * coordination assertions below can still fail.
 */
class InstanceQueuedStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly folder: string,
    private readonly renameImpl: (from: string, to: string) => Promise<void>,
    /** Barrier reached after the existence check and before the write, so the check-then-write
     *  window is opened deterministically instead of relying on filesystem scheduling. */
    private readonly afterExistenceCheck: () => Promise<void> = async () => undefined
  ) {}

  write(doc: Doc, mode: "create" | "update"): Promise<void> {
    const task = async (): Promise<void> => {
      const target = join(this.folder, `${doc.id}.json`);
      if (mode === "create") {
        const exists = await readFile(target, "utf8").then(() => true, () => false);
        await this.afterExistenceCheck();
        if (exists) throw new Error(`Profile already exists: ${doc.id}`);
      }
      const tmp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      await replaceFileAtomically(tmp, target, { renameImpl: this.renameImpl });
    };
    const result = this.chain.then(task, task);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * The pre-R1B id-renaming `update()`: write the new record, then delete the old one — both on the
   * INSTANCE chain, so a second instance aimed at the same folder is free to run between them.
   * `JsonProfileStore.update()` does the same two steps, but inside ONE folder-lane critical section.
   */
  renameId(doc: Doc, previousId: string): Promise<void> {
    const task = async (): Promise<void> => {
      const target = join(this.folder, `${doc.id}.json`);
      const tmp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tmp, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
      await replaceFileAtomically(tmp, target, { renameImpl: this.renameImpl });
      await rm(join(this.folder, `${previousId}.json`), { force: true });
    };
    const result = this.chain.then(task, task);
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }
}

/** The `.json` records on disk, sorted — the only store state a competing writer could observe. */
const jsonRecords = async (folder: string): Promise<string[]> => (await jsonFiles(folder)).sort();

/** The mid-rename transient: the new record is in place but the old file has not been removed yet. */
const showsBothIds = (listing: readonly string[]): boolean =>
  listing.includes("old-id.json") && listing.includes("new-id.json");

/** The state where the record has been lost entirely — neither id resolves. */
const showsNeitherId = (listing: readonly string[]): boolean =>
  !listing.includes("old-id.json") && !listing.includes("new-id.json");

/** The only state an outside writer may ever see: the rename has fully landed. */
const showsSettledRename = (listing: readonly string[]): boolean =>
  listing.includes("new-id.json") && !listing.includes("old-id.json");

interface RenameWindowProbe {
  /** `renameImpl` for the renaming store: holds the both-ids-present window open. */
  renamingRename(from: string, to: string): Promise<void>;
  /** `renameImpl` for the competing store: samples the folder from inside its own critical section. */
  competingRename(from: string, to: string): Promise<void>;
  /** Settles the instant the mid-rename window is open on disk. */
  readonly windowOpen: Promise<void>;
  /** Folder listings sampled by the renamer INSIDE its window. */
  readonly windowListings: readonly (readonly string[])[];
  /** Folder listings sampled by the competitor when it was admitted. */
  readonly competitorListings: readonly (readonly string[])[];
}

/**
 * Opens — deterministically, with no sleep — the window inside an id-renaming `update()` where BOTH
 * ids exist on disk, and records what any other same-folder writer can see while it is open.
 *
 * The renamer performs the real rename of `<new-id>.json`, samples the folder to prove the transient
 * state is genuinely present, releases the competitor, and only then drains a bounded number of
 * FILESYSTEM round trips before returning. Because that drain happens INSIDE `renameImpl`,
 * `replaceFileAtomically` has not resolved and `update()` has not reached its delete, so the window
 * stays open for the whole drain. A competitor admitted during it samples the folder from inside its
 * own critical section.
 *
 * Both arms terminate: per-instance chains admit the competitor immediately (its listing shows the
 * transient), one lane per folder never admits it at all (the drain expires and its listing can only
 * show the settled state). Neither shape can hang.
 *
 * The drain is paced in filesystem round trips for the same measured reason as `overlapProbe`: a
 * `setImmediate` chain is CHEAPER than the `writeFile` a free competitor must finish first, so an
 * event-loop drain would have closed the window before an unblocked competitor could look into it —
 * making "the competitor never saw the window" true by timing rather than by coordination.
 */
function renameWindowProbe(folder: string, newFile: string): RenameWindowProbe {
  const opened = deferred();
  const windowListings: string[][] = [];
  const competitorListings: string[][] = [];

  return {
    renamingRename: async (from: string, to: string): Promise<void> => {
      await rename(from, to);
      // Seeding the pre-rename record goes straight through; only the rename target opens a window.
      if (!to.endsWith(newFile)) return;
      windowListings.push(await jsonRecords(folder));
      opened.resolve();
      await drainFilesystemTurns(folder, GATE_FS_TURNS);
    },
    competingRename: async (from: string, to: string): Promise<void> => {
      competitorListings.push(await jsonRecords(folder));
      await rename(from, to);
    },
    windowOpen: opened.promise,
    get windowListings() { return windowListings; },
    get competitorListings() { return competitorListings; }
  };
}

async function main() {
  // 1. Atomic write + concurrent creates: 40 profiles written in parallel all persist, no temp residue.
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-1-"));
    const store = new JsonProfileStore<Doc>({ folder });
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => store.create({ id: `doc-${i}`, name: `Doc ${i}`, payload: "x".repeat(200) }))
    );
    const listed = await store.list();
    const leftoverTmp = await tmpFiles(folder);
    check("40 concurrent creates all persist", listed.length === 40, `count=${listed.length}`);
    check("no leftover .tmp files after writes (A1)", leftoverTmp.length === 0, `tmp=${leftoverTmp.length}`);
    // Every persisted file is complete, valid JSON (atomic write never truncates).
    let allValid = true;
    for (const f of await jsonFiles(folder)) {
      try {
        JSON.parse(await readFile(join(folder, f), "utf8"));
      } catch {
        allValid = false;
      }
    }
    check("every persisted file is complete valid JSON (A1)", allValid);
    await rm(folder, { recursive: true, force: true });
  }

  // 2. Concurrent updates to the SAME id serialize cleanly: final state is one valid record, no residue.
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-2-"));
    const store = new JsonProfileStore<Doc>({ folder });
    await store.create({ id: "hot", name: "v0", payload: "" });
    await Promise.all(
      Array.from({ length: 40 }, (_, i) => store.update("hot", { id: "hot", name: `v${i + 1}`, payload: `p${i + 1}` }))
    );
    const final = await store.get("hot");
    const leftoverTmp = await tmpFiles(folder);
    const listed = await store.list();
    check("40 concurrent updates leave exactly one record (S1)", listed.length === 1, `count=${listed.length}`);
    check("final record is readable/valid after concurrent writes (S1)", !!final && final.id === "hot", `final=${final?.name}`);
    check("no leftover .tmp files after concurrent updates (A1/S1)", leftoverTmp.length === 0, `tmp=${leftoverTmp.length}`);
    await rm(folder, { recursive: true, force: true });
  }

  // 3. Corrupt file is quarantined, not silently dropped (A2).
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-3-"));
    const store = new JsonProfileStore<Doc>({ folder });
    await store.create({ id: "good", name: "Good", payload: "ok" });
    await writeFile(join(folder, "broken.json"), "{ this is : not json ", "utf8");
    const listed = await store.list();
    const entries = await readdir(folder);
    const quarantined = entries.filter((f) => f.includes(".corrupt-"));
    check("corrupt file is excluded from list() (A2)", listed.length === 1 && listed[0].id === "good", `count=${listed.length}`);
    check("corrupt file is quarantined to a .corrupt-* sibling, not lost (A2)", quarantined.length === 1, `quarantined=${quarantined}`);
    check("original broken.json no longer present after quarantine (A2)", !entries.includes("broken.json"));
    // The quarantined bytes are preserved verbatim.
    const preserved = await readFile(join(folder, quarantined[0]), "utf8");
    check("quarantined bytes preserved for recovery (A2)", preserved === "{ this is : not json ");
    await rm(folder, { recursive: true, force: true });
  }

  // 4. id-rename update writes-new-before-deleting-old and never loses the record (A3).
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-4-"));
    const store = new JsonProfileStore<Doc>({ folder });
    await store.create({ id: "old-id", name: "Renamed", payload: "keepme" });
    await store.update("old-id", { id: "new-id", name: "Renamed", payload: "keepme" });
    const byNew = await store.get("new-id");
    const byOld = await store.get("old-id");
    check("renamed record is retrievable under the new id (A3)", byNew?.payload === "keepme", `payload=${byNew?.payload}`);
    check("old id no longer resolves after rename (A3)", byOld === null);
    const listed = await store.list();
    check("exactly one record remains after id rename (A3)", listed.length === 1, `count=${listed.length}`);
    await rm(folder, { recursive: true, force: true });
  }

  // 4b. R1B: the id-renaming update() keeps write-new and delete-old in ONE critical section.
  //
  // Block 4 asserts only the A3 OUTCOME, which a per-instance queue satisfies just as well — the two
  // steps still run back to back on one object, they are merely not closed to anybody else. The R1B
  // property is about who else can get in: while the new record is on disk and the old one has not
  // been removed, a competing same-folder writer must not be admitted, so no observer can ever see
  // both ids present (a duplicate) or neither (a lost record).
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-ps-4b-"));
    const probe = renameWindowProbe(folder, "new-id.json");

    // Two stores that share nothing but the folder string — exactly the split per-instance queues made.
    const renamer = new JsonProfileStore<Doc>({ folder, atomicReplace: { renameImpl: probe.renamingRename } });
    const competitor = new JsonProfileStore<Doc>({ folder, atomicReplace: { renameImpl: probe.competingRename } });
    check(
      "the renaming writer and the competing writer are two independently constructed stores on one folder",
      renamer !== competitor && new Set([renamer, competitor]).size === 2
    );

    await renamer.create({ id: "old-id", name: "Renamed", payload: "keepme" });
    const renaming = renamer.update("old-id", { id: "new-id", name: "Renamed", payload: "keepme" });
    // The competitor is issued only once the window is genuinely open, so admission order is fixed by
    // construction rather than by whichever mkdir happened to land first.
    await probe.windowOpen;
    const competing = competitor.create({ id: "rival", name: "Rival", payload: "r" });
    await Promise.all([renaming, competing]);

    // Non-vacuity, renamer side: the state the competitor must not see has to actually exist. Without
    // this the "never observed" assertion would also pass if the window were never opened at all.
    // Capture permissively, validate strictly: the cardinality guard is a strict LOWER bound (so an
    // empty set can never satisfy the `every` below) while the predicate stays exact. Pinning it to
    // `=== 1` would instead make a transient EPERM rename retry — a second, equally valid sample —
    // read as a failure of the property under test.
    check(
      "the mid-rename window is real: inside it BOTH old-id.json and new-id.json are on disk",
      probe.windowListings.length >= 1 && probe.windowListings.every(showsBothIds),
      probe.windowListings.map((listing) => `[${listing.join(",")}]`).join(" ") || "no window sampled"
    );
    // Non-vacuity, competitor side: an empty observation set must FAIL, not pass by never looking.
    check(
      "the competing writer really ran and really sampled the folder from inside its own critical section",
      probe.competitorListings.length >= 1,
      `samples=${probe.competitorListings.length}`
    );
    check(
      "no competing same-folder writer is ever admitted into the id-rename window: it never sees both ids, nor neither (R1B)",
      probe.competitorListings.length > 0 &&
        probe.competitorListings.every((listing) => !showsBothIds(listing) && !showsNeitherId(listing)),
      probe.competitorListings.map((listing) => `[${listing.join(",")}]`).join(" ") || "none"
    );
    check(
      "every competitor sample shows the SETTLED rename — new id present, old id already gone",
      probe.competitorListings.length > 0 && probe.competitorListings.every(showsSettledRename),
      probe.competitorListings.map((listing) => `[${listing.join(",")}]`).join(" ") || "none"
    );

    const after = await new JsonProfileStore<Doc>({ folder }).list();
    const residue = await tmpFiles(folder);
    check(
      "the contested rename still lands correctly: exactly the renamed record and the competitor's",
      after.length === 2 && after.map((doc) => doc.id).sort().join(",") === "new-id,rival",
      after.map((doc) => doc.id).join(",")
    );
    check("the contested rename leaves no .tmp residue", residue.length === 0, residue.join(", ") || "none");

    // ── Mutation control: rebuild the pre-R1B per-instance queues and the interleave comes back ──
    // Same harness, same window, same competitor — only the write-coordination ownership changes.
    const legacyFolder = await mkdtemp(join(tmpdir(), "awkit-ps-4b-legacy-"));
    const legacyProbe = renameWindowProbe(legacyFolder, "new-id.json");
    const legacyRenamer = new InstanceQueuedStore(legacyFolder, legacyProbe.renamingRename);
    const legacyCompetitor = new InstanceQueuedStore(legacyFolder, legacyProbe.competingRename);
    await legacyRenamer.write({ id: "old-id", name: "Renamed", payload: "keepme" }, "update");
    const legacyRenaming = legacyRenamer.renameId({ id: "new-id", name: "Renamed", payload: "keepme" }, "old-id");
    await legacyProbe.windowOpen;
    const legacyCompeting = legacyCompetitor.write({ id: "rival", name: "Rival", payload: "r" }, "update");
    await Promise.all([legacyRenaming, legacyCompeting]);

    check(
      "control: the legacy per-instance facade opens the same mid-rename window",
      legacyProbe.windowListings.length >= 1 && legacyProbe.windowListings.every(showsBothIds),
      legacyProbe.windowListings.map((listing) => `[${listing.join(",")}]`).join(" ") || "no window sampled"
    );
    check(
      "control: under per-instance write chains the competitor IS admitted mid-rename and observes both ids",
      legacyProbe.competitorListings.length >= 1 && legacyProbe.competitorListings.some(showsBothIds),
      legacyProbe.competitorListings.map((listing) => `[${listing.join(",")}]`).join(" ") || "none"
    );
    // Assert the failing condition explicitly: the R1B predicate above, evaluated against the legacy
    // observations, must be FALSE. If it were still true the check would not be discriminating.
    check(
      "control: the R1B never-admitted assertion FAILS against the restored per-instance design, so it is discriminating",
      !(legacyProbe.competitorListings.length > 0 &&
        legacyProbe.competitorListings.every((listing) => !showsBothIds(listing) && !showsNeitherId(listing))),
      `legacy competitor samples=${legacyProbe.competitorListings.map((listing) => `[${listing.join(",")}]`).join(" ") || "none"}`
    );
    check(
      "control: and the settled-rename assertion FAILS against it too",
      !(legacyProbe.competitorListings.length > 0 && legacyProbe.competitorListings.every(showsSettledRename)),
      legacyProbe.competitorListings.map((listing) => `[${listing.join(",")}]`).join(" ") || "none"
    );

    await rm(legacyFolder, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  }

  // 5. Draft model (Stage 2b): the store persists a validation-INVALID but parseable flow verbatim.
  // Validation informs (engine/UI layers); persistence never gates on it and never mutates the
  // document — a saved draft is byte-for-byte what the caller supplied.
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-5-"));
    const store = new JsonProfileStore<Record<string, unknown> & { id: string }>({ folder });
    // Missing Start/End, a broken connector endpoint, a negative timeout — invalid by every
    // engine rule, but a perfectly parseable document.
    const invalidFlow = {
      id: "draft-invalid",
      name: "Draft",
      version: 1,
      nodes: [{ id: "n1", type: "click", name: "Click", timeoutMs: -5 }],
      edges: [{ id: "e1", source: "n1", target: "ghost", type: "success" }]
    };
    const imported = await store.import(structuredClone(invalidFlow));
    check("an invalid-but-parseable flow imports as a draft (Stage 2b)", imported.id === "draft-invalid");
    const readBack = await store.get("draft-invalid");
    check(
      "the stored draft is exactly what was supplied — nothing auto-fixed or removed",
      JSON.stringify(readBack) === JSON.stringify(invalidFlow)
    );
    const updated = await store.update("draft-invalid", structuredClone(invalidFlow));
    check("re-saving the invalid draft succeeds and stays unchanged", JSON.stringify(updated) === JSON.stringify(invalidFlow));
    await rm(folder, { recursive: true, force: true });
  }

  // 6. Schema evolution: approval metadata and unknown future fields remain byte-for-byte intact.
  // JsonProfileStore is deliberately field-agnostic; narrowing this path would silently strip
  // evidence during save/reload even though the FlowProfile schema remains backward-compatible.
  {
    const folder = await mkdtemp(join(tmpdir(), "awtkit-ps-6-"));
    const store = new JsonProfileStore<Record<string, unknown> & { id: string }>({ folder });
    const flow = {
      id: "approval-round-trip",
      name: "Approval round trip",
      version: 1,
      futureProfileField: { retained: true },
      nodes: [{
        id: "choose-second",
        type: "click",
        name: "Choose second twin",
        futureStepField: ["keep", "me"],
        locator: {
          strategy: "css",
          value: ".pos-btn:nth-of-type(2)",
          context: {
            frame: { selector: "iframe#catalog" },
            shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "product-host" }] }
          },
          resolution: "user-approved-fallback",
          resolvedBy: "user",
          approvedFallbackReason: "Reviewed: position is intentional in this fixture.",
          approvedFallbackBinding: {
            version: 1,
            stepType: "click",
            stepName: "Choose second twin",
            locator: { strategy: "css", value: ".pos-btn:nth-of-type(2)" },
            context: {
              frame: { selector: "iframe#catalog" },
              shadow: { boundary: "open", hosts: [{ strategy: "testId", value: "product-host" }] }
            },
            futureBindingField: "preserve-fail-closed"
          },
          futureLocatorEvidence: { recorder: "next-version" }
        }
      }],
      edges: []
    };
    await store.create(structuredClone(flow));
    const readBack = await store.get(flow.id);
    check("approval binding + unknown future fields survive profile-store create/get", JSON.stringify(readBack) === JSON.stringify(flow));
    const updated = await store.update(flow.id, structuredClone(flow));
    check("approval binding + unknown future fields survive profile-store update", JSON.stringify(updated) === JSON.stringify(flow));
    await rm(folder, { recursive: true, force: true });
  }

  {
    /*
     * Transient rename failures must not lose a save.
     *
     * A single unretried `rename` here cost a real save: soaking the Workflow capsule suite
     * reproduced "EPERM: operation not permitted, rename '<...>.tmp' -> '<...>.json'" about one run
     * in four, with the edited workflow on screen and Save enabled. The renderer showed a
     * "Failed to save changes" toast that auto-dismissed, so the only lasting trace was a workflow
     * that had silently reverted. These drive the failure through the injected rename rather than
     * hoping the OS produces one.
     */
    const folder = await mkdtemp(join(tmpdir(), "awkit-profile-retry-"));
    const profile = { id: "retry-fixture", name: "first" } as { id: string; name: string };

    let attempts = 0;
    const retries: number[] = [];
    const failTwiceThenSucceed = async (from: string, to: string): Promise<void> => {
      attempts += 1;
      if (attempts <= 2) {
        const error = new Error("EPERM: operation not permitted, rename") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      await rename(from, to);
    };

    const retrying = new JsonProfileStore<{ id: string; name: string }>({
      folder,
      atomicReplace: {
        renameImpl: failTwiceThenSucceed,
        sleep: async () => undefined,
        onRetry: (attempt) => retries.push(attempt)
      }
    });

    await retrying.create(profile);
    const afterRetry = await retrying.get(profile.id);
    check("a save survives two transient EPERM renames", afterRetry?.name === "first", JSON.stringify(afterRetry));
    // Cardinality: "it succeeded" is also true when the rename never failed. Assert it actually retried.
    check("it retried rather than succeeding first time", retries.length === 2 && attempts === 3, `retries=${retries.length}, attempts=${attempts}`);

    let permanent: NodeJS.ErrnoException | null = null;
    let permanentAttempts = 0;
    const alwaysEperm = new JsonProfileStore<{ id: string; name: string }>({
      folder,
      atomicReplace: {
        renameImpl: async () => {
          permanentAttempts += 1;
          const error = new Error("EPERM: operation not permitted, rename") as NodeJS.ErrnoException;
          error.code = "EPERM";
          throw error;
        },
        sleep: async () => undefined
      }
    });
    try {
      await alwaysEperm.update(profile.id, { id: profile.id, name: "second" });
    } catch (error) {
      permanent = error as NodeJS.ErrnoException;
    }
    check("a persistent EPERM still fails, with the original errno", permanent?.code === "EPERM", String(permanent));
    check("it gave up after a bounded number of attempts", permanentAttempts === 5, `attempts=${permanentAttempts}`);
    const unchanged = await alwaysEperm.get(profile.id);
    check("a failed save leaves the previous file intact", unchanged?.name === "first", JSON.stringify(unchanged));
    const leftovers = (await readdir(folder)).filter((entry) => entry.endsWith(".tmp"));
    check("no temp files are left behind by a failed save", leftovers.length === 0, leftovers.join(", "));

    let nonTransientAttempts = 0;
    let nonTransient: NodeJS.ErrnoException | null = null;
    const enospc = new JsonProfileStore<{ id: string; name: string }>({
      folder,
      atomicReplace: {
        renameImpl: async () => {
          nonTransientAttempts += 1;
          const error = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
          error.code = "ENOSPC";
          throw error;
        },
        sleep: async () => undefined
      }
    });
    try {
      await enospc.update(profile.id, { id: profile.id, name: "third" });
    } catch (error) {
      nonTransient = error as NodeJS.ErrnoException;
    }
    check("a non-transient error is NOT retried", nonTransientAttempts === 1, `attempts=${nonTransientAttempts}`);
    check("and it is reported immediately with its own errno", nonTransient?.code === "ENOSPC", String(nonTransient));

    await rm(folder, { recursive: true, force: true });
  }

  // 7. R1B: coordination is owned by the RESOLVED FOLDER, not by the store instance.
  // Blocks 1-2 above only ever exercise ONE store object, so they pass just as well when the queue
  // lives on the instance. These construct several stores that share nothing but the folder string.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-ps-7-"));
    // The harness proves its own bound before any `maxActive === 1` below is allowed to mean anything.
    // Those assertions all say "the queued writer could not arrive"; that is only evidence if a writer
    // that CAN arrive would have. Measured, not assumed.
    const margin = await gateBoundDominatesAFreeWriter(folder);
    check(
      "harness precondition: the concurrency gate outlasts a genuinely free writer, so an unobserved overlap cannot be a timing artifact",
      margin.bound > margin.free * 4,
      `slowestFreeWriter=${margin.free.toFixed(3)}ms fastestBound=${margin.bound.toFixed(3)}ms ratio=${(margin.bound / margin.free).toFixed(1)}x`
    );
    const WRITERS = 6;
    const probe = overlapProbe(WRITERS);
    const stores = Array.from({ length: WRITERS }, (_, i) =>
      new JsonProfileStore<Doc>({ folder, atomicReplace: { renameImpl: probe.renameFor(`w${i}`) } })
    );
    check(
      "the same-folder writers are independently constructed stores sharing only the folder string",
      new Set(stores).size === WRITERS,
      `stores=${new Set(stores).size}`
    );
    const settled = await Promise.allSettled(
      stores.map((store, i) => store.create({ id: `doc-${i}`, name: `Doc ${i}`, payload: "y".repeat(100) }))
    );
    const fulfilled = settled.filter((r) => r.status === "fulfilled").length;
    check("every cross-instance same-folder write completes", fulfilled === WRITERS, `fulfilled=${fulfilled}/${WRITERS}`);
    // `renameFailures` was collected but never asserted until 2026-09-04, so a transient Windows
    // sharing retry could silently add an extra enter/exit pair. Every assertion below counts events
    // (`WRITERS * 2`) or reads `maxActive`; both are only about writers if no rename was attempted
    // twice. Reported separately so a retry is diagnosed as a retry, not as a coordination defect.
    check(
      "each cross-instance writer renamed exactly once, so the counts below measure writers and not retries",
      probe.renameFailures.length === 0,
      probe.renameFailures.join(" | ") || "none"
    );
    check(
      `${WRITERS} independently constructed stores never overlap inside atomic replacement (R1B)`,
      probe.maxActive === 1,
      `maxActive=${probe.maxActive}`
    );
    check(
      "their critical sections are strictly serial: every enter is followed by its own exit",
      probe.events.length === WRITERS * 2 && firstInterleave(probe.events) === null,
      probe.events.join(" ")
    );
    check(
      "all of them are admitted through exactly ONE coordination key for the folder",
      probe.keysOnEnter.length === WRITERS &&
        probe.keysOnEnter.every((keys) => keys.length === 1 && keys[0] === folderCoordinationKey(folder)),
      `${probe.keysOnEnter.length} samples`
    );
    const listed = await new JsonProfileStore<Doc>({ folder }).list();
    const leftoverTmp = await tmpFiles(folder);
    const persisted = await jsonFiles(folder);
    check("each cross-instance write persists exactly one record", listed.length === WRITERS && persisted.length === WRITERS, `records=${listed.length}, files=${persisted.length}`);
    check("cross-instance same-folder writes leave no .tmp residue", leftoverTmp.length === 0, `tmp=${leftoverTmp.length}`);
    await drainEventLoop(8);
    const liveKeys = activeFolderCoordinationKeys();
    check("the folder's coordination lane is released once its writes settle", liveKeys.length === 0, liveKeys.join(", ") || "none");
    await rm(folder, { recursive: true, force: true });
  }

  // 7b. Negative control for block 7: restore the pre-R1B per-instance chains and the overlap returns.
  // Without this, "maxActive === 1" could be true because the harness never gave the writers a chance
  // to overlap in the first place.
  //
  // The control drives the SAME operation block 7 does — `create`, i.e. check-then-write — rather than
  // the cheaper plain `update` it used until 2026-09-04. A control that exercises a different, shorter
  // code path is not a mirror: it could overlap for reasons block 7's writers never face, and block 7
  // could avoid overlapping for reasons the control never tests.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-ps-7b-"));
    const WRITERS = 6;
    const probe = overlapProbe(WRITERS);
    const legacy = Array.from({ length: WRITERS }, (_, i) => new InstanceQueuedStore(folder, probe.renameFor(`w${i}`)));
    const settled = await Promise.allSettled(
      legacy.map((store, i) => store.write({ id: `doc-${i}`, name: `Doc ${i}`, payload: "y".repeat(100) }, "create"))
    );
    const fulfilled = settled.filter((r) => r.status === "fulfilled").length;
    check("control: the legacy per-instance facade completes the same create() writes", fulfilled === WRITERS, `fulfilled=${fulfilled}/${WRITERS}`);
    // A retry re-enters `renameImpl`, adding an enter/exit pair that neither `maxActive` nor
    // `firstInterleave` can distinguish from a design property. Assert the control's overlap evidence
    // is untainted by one.
    check(
      "control: no writer retried its rename, so the overlap below is the design and not a retry artifact",
      probe.renameFailures.length === 0,
      probe.renameFailures.join(" | ") || "none"
    );
    // `>= 2` rather than `=== WRITERS`: any overlap at all falsifies block 7's `=== 1`, and how many
    // of the six land inside the same window depends on the fs threadpool, not on the design.
    check(
      "control: per-instance write chains DO let same-folder writers overlap, so block 7 is discriminating",
      probe.maxActive >= 2 && firstInterleave(probe.events) !== null,
      `maxActive=${probe.maxActive}, firstInterleave=${firstInterleave(probe.events)}`
    );
    await rm(folder, { recursive: true, force: true });
  }

  // 7c. create() is check-then-write. Two independently constructed stores creating the same id used
  // to both observe "absent" and both write; the folder lane makes the pair mutually exclusive.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-ps-7c-"));
    const first = new JsonProfileStore<Doc>({ folder });
    const second = new JsonProfileStore<Doc>({ folder });
    const settled = await Promise.allSettled([
      first.create({ id: "contested", name: "from-first", payload: "1" }),
      second.create({ id: "contested", name: "from-second", payload: "2" })
    ]);
    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const rejection = rejected.length > 0 ? String(rejected[0].reason) : "";
    check(
      "two independently constructed stores creating one id: exactly one wins, the other is refused",
      settled.filter((r) => r.status === "fulfilled").length === 1 && rejected.length === 1,
      `fulfilled=${settled.filter((r) => r.status === "fulfilled").length}, rejected=${rejected.length}`
    );
    check("the loser is refused for the right reason, not by an unrelated error", rejection.includes("Profile already exists: contested"), rejection);
    const listed = await new JsonProfileStore<Doc>({ folder }).list();
    check("only one record exists after the contested create", listed.length === 1 && listed[0].id === "contested", `count=${listed.length}`);

    // Control: the same contest under per-instance chains admits BOTH creates.
    const legacyFolder = await mkdtemp(join(tmpdir(), "awkit-ps-7c-legacy-"));
    const bothChecked = deferred();
    let checked = 0;
    const barrier = async (): Promise<void> => {
      checked += 1;
      if (checked >= 2) bothChecked.resolve();
      await Promise.race([bothChecked.promise, drainEventLoop(GATE_DRAIN_TURNS)]);
    };
    const legacyFirst = new InstanceQueuedStore(legacyFolder, rename, barrier);
    const legacySecond = new InstanceQueuedStore(legacyFolder, rename, barrier);
    const legacySettled = await Promise.allSettled([
      legacyFirst.write({ id: "contested", name: "from-first", payload: "1" }, "create"),
      legacySecond.write({ id: "contested", name: "from-second", payload: "2" }, "create")
    ]);
    check(
      "control: per-instance chains let BOTH creates observe an absent record and both write",
      checked === 2 && legacySettled.filter((r) => r.status === "fulfilled").length === 2,
      `checked=${checked}, fulfilled=${legacySettled.filter((r) => r.status === "fulfilled").length}`
    );
    await rm(legacyFolder, { recursive: true, force: true });
    await rm(folder, { recursive: true, force: true });
  }

  // 7d. Reports go through the same store, and `createReportStore()` builds a FRESH JsonProfileStore
  // on every call — so a run that persists several reports is the cross-instance same-folder case by
  // construction, not by accident. These use the factory's exact option set (`{ folder }` only; no
  // createClone, no seed folder) so the result cannot come from a difference in how the store was
  // configured. The instrumented pair adds `atomicReplace.renameImpl`, which changes only what runs
  // inside the critical section — lane selection is keyed off `options.folder`.
  {
    const reports = await mkdtemp(join(tmpdir(), "awkit-ps-7d-reports-"));
    type ReportRecord = { id: string; runId: string; status: string };
    const factoryShaped = (renameImpl?: (from: string, to: string) => Promise<void>) =>
      new JsonProfileStore<ReportRecord>(renameImpl ? { folder: reports, atomicReplace: { renameImpl } } : { folder: reports });

    const probe = overlapProbe(3);
    const perWrite = [factoryShaped(probe.renameFor("r0")), factoryShaped(probe.renameFor("r1")), factoryShaped(probe.renameFor("r2"))];
    check("each report write uses its own freshly constructed store, as createReportStore() does", new Set(perWrite).size === 3);
    const written = await Promise.allSettled(
      perWrite.map((store, i) => store.create({ id: `run-${i}`, runId: `run-${i}`, status: "completed" }))
    );
    check("every report write completes", written.filter((r) => r.status === "fulfilled").length === 3, `fulfilled=${written.filter((r) => r.status === "fulfilled").length}/3`);
    check(
      "each report writer renamed exactly once, so the event count below measures writers and not retries",
      probe.renameFailures.length === 0,
      probe.renameFailures.join(" | ") || "none"
    );
    check("report stores for one resolved reports folder share a lane and never overlap", probe.maxActive === 1, `maxActive=${probe.maxActive}`);
    check(
      "their report writes are strictly serial and admitted through one coordination key",
      probe.events.length === 6 && firstInterleave(probe.events) === null &&
        probe.keysOnEnter.length === 3 && probe.keysOnEnter.every((keys) => keys.length === 1 && keys[0] === folderCoordinationKey(reports)),
      probe.events.join(" ")
    );
    const persisted = await jsonFiles(reports);
    const residue = await tmpFiles(reports);
    check("all three reports persist with no .tmp residue", persisted.length === 3 && residue.length === 0, `files=${persisted.length}, tmp=${residue.length}`);

    // Same contention, but with the factory's literal option set and no injected seam at all.
    const contested = await Promise.allSettled([
      factoryShaped().create({ id: "run-contested", runId: "run-contested", status: "completed" }),
      factoryShaped().create({ id: "run-contested", runId: "run-contested", status: "failed" })
    ]);
    check(
      "two unmodified createReportStore()-shaped stores contending on one report id: exactly one wins",
      contested.filter((r) => r.status === "fulfilled").length === 1 && contested.filter((r) => r.status === "rejected").length === 1,
      contested.map((r) => r.status).join(", ")
    );
    await rm(reports, { recursive: true, force: true });
  }

  // 8. Stored format compatibility: R1B changed WHO serializes writes, never HOW a record is encoded.
  // These assert the on-disk bytes, not just that a parse succeeds, because "it reloads" stays true
  // through an indentation or trailing-newline change that would rewrite every user's whole store.
  {
    const folder = await mkdtemp(join(tmpdir(), "awkit-ps-8-"));
    const store = new JsonProfileStore<Record<string, unknown> & { id: string }>({ folder });
    const bytesOf = async (id: string): Promise<string> => readFile(join(folder, `${id}.json`), "utf8");
    const canonical = (doc: unknown): string => `${JSON.stringify(doc, null, 2)}\n`;

    // save / reload
    const saved = { id: "compat", name: "Compat", version: 3, nodes: [{ id: "n1", type: "click" }], edges: [] };
    await store.create(structuredClone(saved));
    check("save then reload returns the identical document", JSON.stringify(await store.get("compat")) === JSON.stringify(saved));
    check("the stored file is 2-space pretty-printed with a trailing newline", (await bytesOf("compat")) === canonical(saved), JSON.stringify((await bytesOf("compat")).slice(0, 40)));

    // The byte assertion must be able to fail: neither compact nor 4-space encoding may satisfy it.
    const storedBytes = await bytesOf("compat");
    check(
      "that byte assertion discriminates: compact, 4-space and newline-less encodings all differ from it",
      storedBytes !== JSON.stringify(saved) &&
        storedBytes !== `${JSON.stringify(saved, null, 4)}\n` &&
        storedBytes !== JSON.stringify(saved, null, 2)
    );

    // edit / re-save
    const edited = { ...structuredClone(saved), name: "Compat edited", nodes: [{ id: "n1", type: "click" }, { id: "n2", type: "fill" }] };
    await store.update("compat", structuredClone(edited));
    check("edit then re-save reloads exactly the edited document", JSON.stringify(await store.get("compat")) === JSON.stringify(edited));
    check("the re-saved file keeps the same encoding", (await bytesOf("compat")) === canonical(edited));

    // import / export
    const imported = { id: "compat-import", name: "Imported", version: 3, unknownTopLevel: { keep: true }, nodes: [], edges: [] };
    await store.import(structuredClone(imported));
    const exported = await store.export("compat-import");
    check("import then export round-trips the document unchanged", JSON.stringify(exported) === JSON.stringify(imported));
    check("an imported document is stored in the same encoding as a created one", (await bytesOf("compat-import")) === canonical(imported));

    // a report-shaped record (createReportStore persists these through the same store)
    const report = {
      id: "run-2026-01-01T00-00-00-000Z-abc123",
      runId: "run-2026-01-01T00-00-00-000Z-abc123",
      startedAt: "2026-01-01T00:00:00.000Z",
      endedAt: "2026-01-01T00:01:00.000Z",
      status: "completed",
      totals: { instances: 2, passed: 2, failed: 0 },
      instances: [
        { instanceId: "i1", status: "completed", steps: [{ name: "Open", status: "passed", durationMs: 12 }] },
        { instanceId: "i2", status: "completed", steps: [{ name: "Open", status: "passed", durationMs: 15 }] }
      ],
      runtimeInputs: { user: "demo" }
    };
    await store.create(structuredClone(report));
    check("a report-shaped record round-trips unchanged", JSON.stringify(await store.get(report.id)) === JSON.stringify(report));
    check("a report-shaped record is stored in the same encoding", (await bytesOf(report.id)) === canonical(report));

    // a legacy fixture written by an older build, then updated through the coordinated path
    const legacy = {
      id: "legacy-fixture",
      name: "Legacy",
      version: 1,
      legacyOnlyField: "written-by-an-older-build",
      nested: { alsoUnknown: [1, 2, 3], deeper: { retained: true } },
      nodes: [{ id: "n1", type: "click", legacyStepField: "kept" }],
      edges: []
    };
    await writeFile(join(folder, "legacy-fixture.json"), canonical(legacy), "utf8");
    const loadedLegacy = await store.get("legacy-fixture");
    check("a legacy on-disk fixture loads unchanged through the coordinated store", JSON.stringify(loadedLegacy) === JSON.stringify(legacy));
    await store.update("legacy-fixture", structuredClone(legacy));
    check("its unknown fields survive an update() round trip", JSON.stringify(await store.get("legacy-fixture")) === JSON.stringify(legacy));
    check("and rewriting it is byte-identical to the file the older build wrote", (await bytesOf("legacy-fixture")) === canonical(legacy));

    const residue = await tmpFiles(folder);
    check("the compatibility suite leaves no .tmp residue", residue.length === 0, residue.join(", ") || "none");
    await rm(folder, { recursive: true, force: true });
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nProfile store: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
