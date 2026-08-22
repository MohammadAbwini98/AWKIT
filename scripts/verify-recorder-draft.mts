// Verifies recorder persistence without launching a browser:
//   • the unsaved-recording draft (actions) is written, restored on "restart", and cleared on discard;
//   • the reusable saved-URL history (Task 6) is deduped, persisted separately, survives a
//     save/cancel discard, and restores on "restart";
//   • the optional wait-time capture (Task 1) inserts a fixed-time wait for meaningful pauses only;
//   • REC-022: cancelling a protected-login handoff PRESERVES the pre-login draft (only the full
//     recording Cancel / save paths may discard it);
//   • the session-profile metadata store (SessionCaptureService) round-trips through real files,
//     recovers from corrupt/missing metadata, preserves unknown compatible fields, and its writes
//     are atomic with EPERM/EBUSY retry.
//
// Run: npm run verify:recorder-draft
import { recorderService } from "@src/recorder/RecorderService";
import { SessionCaptureService } from "@src/session/SessionCaptureService";
import { writeJsonFileAtomic } from "@src/session/atomicWrite";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";import { tmpdir } from "node:os";
import { join } from "node:path";

const results: { name: string; pass: boolean }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  results.push({ name, pass });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const dir = await mkdtemp(join(tmpdir(), "awtkit-recdraft-"));
const draftPath = join(dir, "recorder-draft.json");
const urlsPath = join(dir, "recorder-urls.json");
// `private` is compile-time only; drive the internal state directly for a browser-free round-trip.
const svc = recorderService as unknown as Record<string, any>;

svc.configureDraftStorage(draftPath);
svc.configureUrlStorage(urlsPath);

// ── Draft (actions only) ─────────────────────────────────────────────────────
svc.actions = [{ id: "a1", type: "fill", name: "Fill Email", locator: { strategy: "label", value: "Email" }, valueSource: { type: "static", value: "me@test.dev" } }];
await svc.persistDraft();
const rawDraft = await readFile(draftPath, "utf8").catch(() => null);
check("draft file is written to disk", Boolean(rawDraft), draftPath);
const parsedDraft = rawDraft ? JSON.parse(rawDraft) : {};
check("draft preserves the recorded action + value", parsedDraft.actions?.[0]?.valueSource?.value === "me@test.dev");
check("draft does not store URLs (they live in their own history)", parsedDraft.urls === undefined);

// Simulate a fresh app session: empty in-memory state + un-memoized load, then restore from disk.
svc.actions = [];
svc.draftLoad = null;
await svc.ensureDraftLoaded();
check("restart restores the recorded actions", svc.getActions().length === 1 && svc.getActions()[0].valueSource.value === "me@test.dev");

// ── Reusable saved-URL history (Task 6) ──────────────────────────────────────
svc.recordedUrls = [];
svc.urlHistoryLoad = null;
await svc.ensureUrlHistoryLoaded();
await svc.saveUrl("example.com"); // bare host → normalized to https://example.com/
check("saveUrl normalizes a bare host", svc.getUrls()[0]?.url === "https://example.com/");
await svc.saveUrl("https://example.com/"); // same normalized URL → deduped
check("saveUrl dedupes the same normalized URL", svc.getUrls().length === 1);
await svc.saveUrl("https://other.test/page");
check("saveUrl appends a new distinct URL", svc.getUrls().length === 2);
const rawUrls = await readFile(urlsPath, "utf8").catch(() => null);
check("URL history is persisted to its own file", Boolean(rawUrls) && JSON.parse(rawUrls!).urls?.length === 2);

// Discard (save/cancel) clears the recording but KEEPS the reusable URL history.
await svc.discardDraft();
const draftGone = await access(draftPath).then(() => true).catch(() => false);
check("discard deletes the draft file", !draftGone);
check("discard clears the recorded actions", svc.getActions().length === 0);
check("discard keeps the saved URLs for reuse", svc.getUrls().length === 2);

// Restart restores the URL history from disk.
svc.recordedUrls = [];
svc.urlHistoryLoad = null;
await svc.ensureUrlHistoryLoaded();
check("restart restores the saved URL history", svc.getUrls().length === 2);

// ── Wait-time capture (Task 1) ───────────────────────────────────────────────
svc.actions = [{ id: "seed", type: "click", name: "Click" }];
svc.captureWaitTime = true;
svc.lastActionAt = Date.now() - 1500;
svc.maybeInsertWait(Date.now());
const inserted = svc.getActions().find((a: any) => a.type === "wait");
check("capture-on inserts a wait for a meaningful pause", Boolean(inserted) && inserted.waitMs >= 1400 && inserted.waitMs <= 1600, `${inserted?.waitMs}ms`);

svc.actions = [{ id: "seed2", type: "click", name: "Click" }];
svc.lastActionAt = Date.now() - 100; // below the 500ms threshold
svc.maybeInsertWait(Date.now());
check("sub-threshold pauses are ignored", !svc.getActions().some((a: any) => a.type === "wait"));

svc.actions = [{ id: "seed3", type: "click", name: "Click" }];
svc.captureWaitTime = false;
svc.lastActionAt = Date.now() - 3000;
svc.maybeInsertWait(Date.now());
check("capture-off never inserts a wait", !svc.getActions().some((a: any) => a.type === "wait"));

svc.actions = [{ id: "seed4", type: "click", name: "Click" }];
svc.captureSmartWaits = false;
svc.captureWaitTime = true;
svc.signals = [{ kind: "request", method: "POST", path: "/api/save", status: 200, startedAt: 1000, endedAt: 1200 }];
svc.lastActionAt = Date.now() - 1500;
svc.attachSmartWaits(Date.now());
svc.maybeInsertWait(Date.now());
const smartOffActions = svc.getActions();
check("smart-waits disabled does not attach afterWaits", smartOffActions[0]?.afterWaits === undefined);
check("legacy fixed wait still works when smart-waits disabled", smartOffActions.some((a: any) => a.type === "wait"));

// ── REC-006 — live typing compacts to ONE fill action ────────────────────────
// The page fires an `input` event per keystroke. `recordActionFromPage` collapses consecutive fills
// on the same page + locator in place. Driven through that method (not the Playwright binding, which
// is a one-line adapter over it) with a stand-in page object, so no browser is needed.
{
  const fakePage = { url: () => "https://example.test/form" } as unknown as never;
  svc.isRecording = true;
  svc.actions = [];
  svc.lastActionPage = null;
  svc.lastActionAt = 0;
  svc.captureWaitTime = false;
  svc.captureSmartWaits = false;
  const locator = { strategy: "label", value: "Email" };
  const typed = "ada@example.test";
  for (let i = 1; i <= typed.length; i += 1) {
    svc.recordActionFromPage(fakePage, {
      type: "fill",
      name: "Fill Email",
      locator,
      valueSource: { type: "static", value: typed.slice(0, i) }
    });
  }
  const fills = svc.getActions().filter((a: any) => a.type === "fill");
  check("REC-006 consecutive fills on one field collapse to a single action", fills.length === 1, `${typed.length} keystrokes → ${fills.length} action(s)`);
  check("REC-006 the collapsed action carries the FINAL value", fills[0]?.valueSource?.value === typed, fills[0]?.valueSource?.value);

  // The draft must not grow per keystroke either — that is the persistence half of the case.
  await svc.persistDraft();
  const raw = await readFile(draftPath, "utf8").catch(() => null);
  const persisted = raw ? JSON.parse(raw) : {};
  check("REC-006 the persisted draft holds one fill, not one per keystroke", persisted.actions?.length === 1, `${persisted.actions?.length} action(s)`);

  // A different field must NOT be folded into the previous one.
  svc.recordActionFromPage(fakePage, {
    type: "fill",
    name: "Fill Name",
    locator: { strategy: "label", value: "Full name" },
    valueSource: { type: "static", value: "Ada" }
  });
  check("REC-006 a different field starts a new action", svc.getActions().filter((a: any) => a.type === "fill").length === 2);

  // A non-fill between two fills on the same field must also break the run.
  svc.recordActionFromPage(fakePage, { type: "click", name: "Click Submit", locator: { strategy: "role", value: "button" } });
  svc.recordActionFromPage(fakePage, { type: "fill", name: "Fill Email", locator, valueSource: { type: "static", value: "second@example.test" } });
  const tail = svc.getActions().slice(-3).map((a: any) => a.type);
  check("REC-006 an intervening action breaks the compaction run", tail.join(",") === "fill,click,fill", tail.join(","));
  svc.isRecording = false;
}

// ── REC-010 — the complete waiting-time boundary and cap matrix ──────────────
// The existing checks cover "meaningful", "sub-threshold" and "off". The exact 500 ms boundary and
// the 60 s cap were never exercised, and a boundary written as `<` vs `<=` is precisely the kind of
// thing that only an on-the-nose value catches.
{
  const waitFor = (deltaMs: number, capture = true) => {
    svc.actions = [{ id: `seed-${deltaMs}`, type: "click", name: "Click" }];
    svc.captureWaitTime = capture;
    const now = Date.now();
    svc.lastActionAt = now - deltaMs;
    svc.maybeInsertWait(now);
    return svc.getActions().find((a: any) => a.type === "wait");
  };
  check("REC-010 a 499 ms pause is below the threshold and inserts nothing", !waitFor(499));
  const atBoundary = waitFor(500);
  check("REC-010 a 500 ms pause is AT the threshold and inserts a wait", Boolean(atBoundary), `${atBoundary?.waitMs}ms`);
  const justOver = waitFor(501);
  check("REC-010 a 501 ms pause inserts a wait", Boolean(justOver), `${justOver?.waitMs}ms`);
  const excessive = waitFor(120_000);
  check("REC-010 an excessive pause is capped at 60 s, not recorded verbatim", excessive?.waitMs === 60_000, `${excessive?.waitMs}ms`);
  check("REC-010 capture-off inserts nothing even for an excessive pause", !waitFor(120_000, false));
  // With no prior action there is no think-time to measure.
  svc.actions = [];
  svc.captureWaitTime = true;
  svc.lastActionAt = Date.now() - 5_000;
  svc.maybeInsertWait(Date.now());
  check("REC-010 no wait is inserted when there is no preceding action", svc.getActions().length === 0);
}

// ── REC-014 — corrupt and missing draft recovery ─────────────────────────────
{
  // Corrupt: unparseable JSON must not throw and must not resurrect stale actions.
  await writeFile(draftPath, "{ this is not valid json", "utf8");
  svc.actions = [];
  svc.draftLoad = null;
  let corruptThrew = false;
  await svc.ensureDraftLoaded().catch(() => {
    corruptThrew = true;
  });
  check("REC-014 a corrupt draft does not throw on load", !corruptThrew);
  check("REC-014 a corrupt draft restores no actions", svc.getActions().length === 0, `${svc.getActions().length}`);

  // Structurally valid JSON of the wrong shape.
  await writeFile(draftPath, JSON.stringify({ actions: "not-an-array" }), "utf8");
  svc.actions = [];
  svc.draftLoad = null;
  let wrongShapeThrew = false;
  await svc.ensureDraftLoaded().catch(() => {
    wrongShapeThrew = true;
  });
  check("REC-014 a wrong-shaped draft does not throw on load", !wrongShapeThrew);
  check("REC-014 a wrong-shaped draft restores no actions", Array.isArray(svc.getActions()) && svc.getActions().length === 0);

  // Missing file.
  await rm(draftPath, { force: true });
  svc.actions = [];
  svc.draftLoad = null;
  let missingThrew = false;
  await svc.ensureDraftLoaded().catch(() => {
    missingThrew = true;
  });
  check("REC-014 a missing draft does not throw on load", !missingThrew);
  check("REC-014 a missing draft restores no actions", svc.getActions().length === 0);

  // A corrupt draft must not take the reusable URL history down with it.
  check("REC-014 URL history survives a corrupt draft", svc.getUrls().length === 2, `${svc.getUrls().length}`);
}

// ── REC-022 — cancelling a protected-login handoff preserves the draft ───────
{
  const draftAction = (id: string) => ({
    id,
    type: "click",
    name: `Click ${id}`,
    locator: { strategy: "role", value: "button" }
  });

  const seedDraft = async (ids: string[]) => {
    svc.actions = ids.map(draftAction);
    svc.isRecording = true;
    await svc.persistDraft();
  };

  const handoffInPhase = (phase: string) => ({
    active: true,
    phase,
    sourceAlias: "main",
    detectedUrl: "https://example.test/login",
    origin: "https://example.test",
    reason: "login-form",
    signals: ["password field"],
    timestamp: new Date().toISOString(),
    message: `synthetic ${phase}`
  });

  // Cancel from the capturingSession phase — the user has already completed a manual login and
  // aborts the capture. The pre-login actions must survive on disk AND in memory.
  await seedDraft(["pre1", "pre2"]);
  svc.handoff = handoffInPhase("capturingSession");
  let cancelThrew = "";
  await svc.cancelSecureHandoff().catch((error: unknown) => {
    cancelThrew = error instanceof Error ? error.message : String(error);
  });
  const rawAfterCancel = await readFile(draftPath, "utf8").catch(() => null);
  const parsedAfterCancel = rawAfterCancel ? JSON.parse(rawAfterCancel) : {};
  check("REC-022 cancel during session capture does not throw", cancelThrew === "", cancelThrew);
  check("REC-022 cancel during session capture keeps the draft file on disk", Boolean(rawAfterCancel));
  check("REC-022 the preserved draft holds exactly the two pre-login actions", parsedAfterCancel.actions?.length === 2, `${parsedAfterCancel.actions?.length}`);
  check("REC-022 cancel during session capture keeps the actions in memory", svc.getActions().length === 2, `${svc.getActions().length}`);
  check("REC-022 cancel ends the recording", svc.isRecording === false);
  check("REC-022 cancel clears the active handoff", !svc.getHandoff()?.active);

  // Same guarantee from the detected phase.
  await seedDraft(["det1"]);
  svc.handoff = handoffInPhase("detected");
  await svc.cancelSecureHandoff();
  const rawDetected = await readFile(draftPath, "utf8").catch(() => null);
  const parsedDetected = rawDetected ? JSON.parse(rawDetected) : {};
  check("REC-022 cancel from the detected phase preserves the draft on disk", parsedDetected.actions?.length === 1, `${parsedDetected.actions?.length}`);

  // Contrast control: an explicit discard still deletes the draft (the earlier discard checks cover
  // this too, but the pairing must hold at the exact state a handoff cancel leaves behind).
  await svc.discardDraft();
  const draftGoneAfterDiscard = await access(draftPath).then(() => true).catch(() => false);
  check("REC-022 explicit discard still deletes the draft (cancel is not discard)", !draftGoneAfterDiscard);

  // The preserved draft must restore after an app restart (fresh in-memory state).
  await seedDraft(["resume1"]);
  svc.handoff = handoffInPhase("capturingSession");
  await svc.cancelSecureHandoff();
  svc.actions = [];
  svc.draftLoad = null;
  await svc.ensureDraftLoaded();
  check("REC-022 the preserved draft restores on restart", svc.getActions().length === 1 && svc.getActions()[0].id === "resume1");
}

// ── REC-023 — handoff cancel and error-phase recovery ────────────────────────
{
  const phases = ["detected", "capturingSession", "sessionCaptured", "error"] as const;
  for (const phase of phases) {
    svc.isRecording = true;
    svc.handoff = {
      active: phase === "detected" || phase === "capturingSession",
      phase,
      sourceAlias: "main",
      detectedUrl: "https://example.test/login",
      origin: "https://example.test",
      reason: "login-form",
      signals: ["password field"],
      timestamp: new Date().toISOString(),
      message: `synthetic ${phase}`
    };
    let threw = "";
    await svc.cancelSecureHandoff().catch((error: unknown) => {
      threw = error instanceof Error ? error.message : String(error);
    });
    check(`REC-023 cancel from the ${phase} phase does not throw`, threw === "", threw);
    check(`REC-023 cancel from the ${phase} phase ends the recording`, svc.isRecording === false);
    check(`REC-023 cancel from the ${phase} phase leaves no active handoff blocking the next session`, !svc.getHandoff()?.active, JSON.stringify(svc.getHandoff()?.phase));
  }

  // Resume/ignore must refuse when the phase does not allow it, rather than half-resuming.
  svc.handoff = null;
  let ignoreError = "";
  try {
    svc.ignoreCurrentProtectedDetection();
  } catch (error) {
    ignoreError = error instanceof Error ? error.message : String(error);
  }
  check("REC-023 ignore is refused when no detection is waiting", /no protected-login detection/i.test(ignoreError), ignoreError);

  svc.handoff = { active: false, phase: "error", sourceAlias: "main", detectedUrl: "", origin: "", reason: "login-form", signals: [], timestamp: "", message: "err", error: "boom" };
  let continueError = "";
  await svc.continueWithNormalBrowser().catch((error: unknown) => {
    continueError = error instanceof Error ? error.message : String(error);
  });
  check("REC-023 normal-browser handoff is refused from the error phase", /no protected-login handoff is active/i.test(continueError), continueError);

  svc.handoff = { active: true, phase: "detected", sourceAlias: "main", detectedUrl: "", origin: "", reason: "login-form", signals: [], timestamp: "", message: "d" };
  let captureError = "";
  await svc.captureSessionAndResume().catch((error: unknown) => {
    captureError = error instanceof Error ? error.message : String(error);
  });
  check("REC-023 session capture is refused before the capture phase begins", /no session capture is in progress/i.test(captureError), captureError);
  svc.handoff = null;
  svc.isRecording = false;
}

// ── Session-profile store — real-file persistence, recovery, and atomic writes ──
{
  const sessionsDir = await mkdtemp(join(tmpdir(), "awtkit-sessionstore-"));
  const metadataFile = join(sessionsDir, "session-profiles.json");
  const newService = () => new SessionCaptureService(sessionsDir);
  const tmpResidue = async () => (await readdir(sessionsDir)).filter((f) => f.endsWith(".tmp"));

  // Missing metadata: a fresh store is empty and safe.
  const fresh = newService();
  check("session store: missing metadata lists zero sessions safely", (await fresh.list()).length === 0);
  check("session store: missing metadata resolves no session", (await fresh.getById("nope")) === null);

  // Corrupt metadata: must not throw and must not resurrect phantom sessions; mutations fail safely.
  await writeFile(metadataFile, "{ this is not valid json", "utf8");
  const corrupt = newService();
  let corruptThrew = "";
  try {
    const listed = await corrupt.list();
    check("session store: corrupt metadata lists zero sessions safely", listed.length === 0, `${listed.length}`);
    check("session store: corrupt metadata resolves no session", (await corrupt.getById("x")) === null);
  } catch (error) {
    corruptThrew = error instanceof Error ? error.message : String(error);
  }
  check("session store: corrupt metadata never throws on read", corruptThrew === "", corruptThrew);
  let renameOnCorrupt = "";
  await corrupt.rename("x", "y").catch((error: unknown) => {
    renameOnCorrupt = error instanceof Error ? error.message : String(error);
  });
  check("session store: mutation against corrupt metadata fails with an actionable error", /not found/i.test(renameOnCorrupt), renameOnCorrupt);

  // Seed a valid fixture through the production atomic writer, including an UNKNOWN field that a
  // future schema may add — it must survive every mutation and reload losslessly.
  const fixtureProfileDir = join(sessionsDir, "session-fixture1");
  await mkdir(join(fixtureProfileDir, "Default"), { recursive: true });
  await writeFile(join(fixtureProfileDir, "Default", "Preferences"), "{}", "utf8");
  const legacyProfile = {
    id: "session-legacy1",
    name: "Legacy Session",
    profileDir: join(sessionsDir, "session-legacy1"),
    targetUrl: "https://legacy.test/app",
    createdAt: "2026-08-22T00:00:00.000Z",
    status: "ready"
  };
  const fixtureProfile = {
    id: "session-fixture1",
    name: "Fixture Session",
    profileDir: fixtureProfileDir,
    targetUrl: "https://example.test/app",
    createdAt: "2026-08-22T00:00:00.000Z",
    status: "ready",
    futureUnknownField: { keep: true }
  };
  await writeJsonFileAtomic(metadataFile, [legacyProfile, fixtureProfile]);

  const svcStore = newService();
  const loaded = await svcStore.getById("session-fixture1");
  check("session store: seeded session resolves by id", loaded?.name === "Fixture Session");

  // list() backfills origin/source for the legacy row without touching the future field.
  const listed = await svcStore.list();
  const legacyListed = listed.find((p) => p.id === "session-legacy1");
  check("session store: legacy row gains origin + source backfill", legacyListed?.origin === "https://legacy.test" && legacyListed?.source === "manual");
  const fixtureListed = listed.find((p) => p.id === "session-fixture1");
  check("session store: known fields keep their values through list()", fixtureListed?.status === "ready");
  check("session store: unknown compatible field survives list()+persist", (fixtureListed as unknown as Record<string, unknown> | undefined)?.futureUnknownField !== undefined);

  // Persistence round trip: rename + markUsed survive a full service re-initialization.
  await svcStore.rename("session-fixture1", "Renamed Session");
  await svcStore.markUsed("session-fixture1");
  const reloaded = newService();
  const afterRename = await reloaded.getById("session-fixture1");
  check("session store: rename survives close/reload", afterRename?.name === "Renamed Session", afterRename?.name);
  check("session store: lastUsedAt survives close/reload", typeof afterRename?.lastUsedAt === "string");
  check("session store: unknown compatible field survives rename/reload round trip", Boolean((afterRename as unknown as Record<string, unknown> | null)?.futureUnknownField));

  // Concurrent mutations must not drop one update (read-modify-write serialization).
  const concurrent = newService();
  await Promise.all([concurrent.rename("session-fixture1", "Kept Name"), concurrent.markUsed("session-fixture1")]);
  const afterConcurrent = await newService().getById("session-fixture1");
  check("session store: concurrent rename+markUsed both land (no lost update)", afterConcurrent?.name === "Kept Name" && typeof afterConcurrent?.lastUsedAt === "string");

  // hasCapturedData is existence-only: true with state files present, false otherwise.
  check("hasCapturedData: true when Default state files exist", svcStore.hasCapturedData("session-fixture1") === true);
  const emptyId = join("session-empty-scaffold");
  await mkdir(join(sessionsDir, emptyId), { recursive: true });
  check("hasCapturedData: false for unused scaffolding", svcStore.hasCapturedData(emptyId) === false);
  check("hasCapturedData: false for a missing profile dir", svcStore.hasCapturedData("session-missing") === false);

  // deleteProfile removes both the registry entry and the profile directory.
  await svcStore.deleteProfile("session-legacy1");
  const afterDelete = newService();
  check("session store: delete removes the registry entry", (await afterDelete.getById("session-legacy1")) === null);
  const dirGone = await access(legacyProfile.profileDir).then(() => false).catch(() => true);
  check("session store: delete removes the profile directory", dirGone);

  // The product path leaves no temp residue behind.
  check("atomic writes leave no temp residue in the profiles root", (await tmpResidue()).length === 0);

  // Atomic write retry semantics (fault-injected low-level seams; default impls are real fs).
  {
    const { rename: realRename } = await import("node:fs/promises");
    const target = join(sessionsDir, "retry-probe.json");

    let flakyCalls = 0;
    const flakyRename: typeof realRename = async (from: any, to: any) => {
      flakyCalls += 1;
      if (flakyCalls <= 2) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return realRename(from, to);
    };
    await writeJsonFileAtomic(target, { ok: "retried" }, { attempts: 4, delayMs: 1, renameImpl: flakyRename as never });
    const retried = JSON.parse(await readFile(target, "utf8"));
    check("atomic write retries EBUSY and succeeds on a later attempt", flakyCalls === 3 && retried.ok === "retried", `${flakyCalls} attempt(s)`);

    let alwaysCalls = 0;
    let exhaustedCode = "";
    try {
      await writeJsonFileAtomic(target, { ok: false }, {
        attempts: 3,
        delayMs: 1,
        renameImpl: (() => {
          alwaysCalls += 1;
          throw Object.assign(new Error("eperm"), { code: "EPERM" });
        }) as never
      });
    } catch (error) {
      exhaustedCode = (error as NodeJS.ErrnoException)?.code ?? "";
    }
    check("atomic write throws after exhausting retries", exhaustedCode === "EPERM" && alwaysCalls === 3, `${exhaustedCode || "no error"}/${alwaysCalls}`);

    let writeCalls = 0;
    let fatalCode = "";
    try {
      await writeJsonFileAtomic(target, { ok: false }, {
        attempts: 4,
        delayMs: 1,
        writeFileImpl: ((path: any, data: any, opts: any) => {
          writeCalls += 1;
          return writeFile(path, data, opts);
        }) as never,
        renameImpl: (() => {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        }) as never
      });
    } catch (error) {
      fatalCode = (error as NodeJS.ErrnoException)?.code ?? "";
    }
    check("non-retryable codes fail fast without retrying", fatalCode === "EACCES" && writeCalls === 1, `${fatalCode}/${writeCalls}`);

    check("atomic write probes leave no temp residue", (await tmpResidue()).length === 0);
    await rm(target, { force: true });
  }

  await rm(sessionsDir, { recursive: true, force: true });
}

await rm(dir, { recursive: true, force: true });
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} recorder-draft checks passed`);
process.exit(passed === results.length ? 0 : 1);
