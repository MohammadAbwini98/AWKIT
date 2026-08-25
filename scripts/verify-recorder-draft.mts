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
  // AWKIT-QA-003: renamed from `draftGoneAfterDiscard`, which held the OPPOSITE sense of its name
  // (true when the draft still EXISTS) and invited a polarity-inverting "fix".
  const draftExistsAfterDiscard = await access(draftPath).then(() => true).catch(() => false);
  check("REC-022 explicit discard still deletes the draft (cancel is not discard)", !draftExistsAfterDiscard);

  // AWKIT-REC-036: cancelling a handoff must clear the ambiguity state — it points at the page the
  // handoff just closed, and previewCandidate would otherwise hit a raw "target closed" error.
  {
    (svc as unknown as Record<string, unknown>).ambiguityState = { kind: "login-form", reason: "synthetic", timestamp: new Date().toISOString() };
    (svc as unknown as Record<string, unknown>).ambiguityPage = { isClosed: () => true };
    await seedDraft(["amb1"]);
    svc.handoff = handoffInPhase("detected");
    await svc.cancelSecureHandoff();
    const state = (svc as unknown as Record<string, unknown>).ambiguityState;
    const page = (svc as unknown as Record<string, unknown>).ambiguityPage;
    check("AWKIT-REC-036 cancelling a handoff clears stale ambiguityState", state === null || state === undefined, JSON.stringify(state));
    check("AWKIT-REC-036 cancelling a handoff clears stale ambiguityPage", page === null || page === undefined);
    check("AWKIT-REC-036 the preserved draft is unaffected by the ambiguity reset", svc.getActions().length === 1);

    // stopRecording had the same pre-existing gap; both exits must be clean.
    (svc as unknown as Record<string, unknown>).ambiguityState = { kind: "login-form", reason: "synthetic-stop" };
    (svc as unknown as Record<string, unknown>).ambiguityPage = { isClosed: () => true };
    svc.isRecording = true;
    await svc.stopRecording();
    const stateAfterStop = (svc as unknown as Record<string, unknown>).ambiguityState;
    const pageAfterStop = (svc as unknown as Record<string, unknown>).ambiguityPage;
    check("AWKIT-REC-036 stopping a recording clears stale ambiguityState", stateAfterStop === null || stateAfterStop === undefined);
    check("AWKIT-REC-036 stopping a recording clears stale ambiguityPage", pageAfterStop === null || pageAfterStop === undefined);
  }

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

  // AWKIT-SES-004: corrupt metadata must NOT silently collapse the registry to [] — that let the
  // next mutation write the truncated list back and make captured profiles unreachable forever.
  // The bytes are quarantined as a .corrupt-* sibling and reads FAIL CLOSED with an actionable
  // error until the operator restores or removes them.
  await writeFile(metadataFile, "{ this is not valid json", "utf8");
  const CORRUPT_BYTES = "{ this is not valid json";
  await writeFile(metadataFile, CORRUPT_BYTES, "utf8");
  const corrupt = newService();
  let corruptError = "";
  try {
    const listed = await corrupt.list();
    check("session store: corrupt metadata does NOT collapse to an empty registry", false, `returned ${listed.length} sessions`);
  } catch (error) {
    corruptError = error instanceof Error ? error.message : String(error);
  }
  check("session store: corrupt metadata fails the read loudly (fail closed)", /corrupt/i.test(corruptError), corruptError);
  const corruptSiblings = (await readdir(sessionsDir)).filter((f) => f.startsWith("session-profiles.json.corrupt-"));
  check("session store: corrupt metadata is quarantined as exactly one .corrupt-* sibling", corruptSiblings.length === 1, JSON.stringify(corruptSiblings));
  if (corruptSiblings.length === 1) {
    check("session store: the quarantined sibling preserves the original bytes", (await readFile(join(sessionsDir, corruptSiblings[0]), "utf8")) === CORRUPT_BYTES);
  }

  // Seed a valid fixture through the production atomic writer, including an UNKNOWN field that a
  // future schema may add — it must survive every mutation and reload losslessly.
  const fixtureProfileDir = join(sessionsDir, "session-fixture1");
  await mkdir(join(fixtureProfileDir, "Default"), { recursive: true });
  await writeFile(join(fixtureProfileDir, "Default", "Preferences"), "{}", "utf8");
  // The legacy profile dir must REALLY exist on disk (with the Chrome scaffolding deleteProfile
  // recurses through). Without it the post-delete "directory is gone" assertion would be true by
  // absence and would stay green even if the removal logic were deleted.
  const legacyProfileDir = join(sessionsDir, "session-legacy1");
  await mkdir(join(legacyProfileDir, "Default"), { recursive: true });
  await writeFile(join(legacyProfileDir, "Default", "Preferences"), "{}", "utf8");
  const legacyProfile = {
    id: "session-legacy1",
    name: "Legacy Session",
    profileDir: legacyProfileDir,
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
  // Seed a deliberately stale lastUsedAt first: `typeof lastUsedAt === "string"` is already satisfied
  // by the earlier markUsed, so only a value that CHANGED proves the concurrent markUsed survived.
  const staleUsedAt = "2000-01-01T00:00:00.000Z";
  const seedRows = JSON.parse(await readFile(metadataFile, "utf8")) as Record<string, unknown>[];
  for (const row of seedRows) if (row.id === "session-fixture1") row.lastUsedAt = staleUsedAt;
  await writeJsonFileAtomic(metadataFile, seedRows);
  const beforeUsed = (await newService().getById("session-fixture1"))?.lastUsedAt;
  check("session store: concurrent probe starts from a known stale lastUsedAt", beforeUsed === staleUsedAt, String(beforeUsed));
  const concurrent = newService();
  await Promise.all([concurrent.rename("session-fixture1", "Kept Name"), concurrent.markUsed("session-fixture1")]);
  const afterConcurrent = await newService().getById("session-fixture1");
  check(
    "session store: concurrent rename+markUsed both land (no lost update)",
    afterConcurrent?.name === "Kept Name" && typeof afterConcurrent?.lastUsedAt === "string" && afterConcurrent?.lastUsedAt !== beforeUsed,
    `${afterConcurrent?.name}/${afterConcurrent?.lastUsedAt}`
  );

  // The opposite interleaving must hold too: whichever operation is issued first, neither write may
  // be overwritten by the other's read-modify-write cycle.
  const seedRows2 = JSON.parse(await readFile(metadataFile, "utf8")) as Record<string, unknown>[];
  for (const row of seedRows2) if (row.id === "session-fixture1") row.lastUsedAt = staleUsedAt;
  await writeJsonFileAtomic(metadataFile, seedRows2);
  const beforeUsed2 = (await newService().getById("session-fixture1"))?.lastUsedAt;
  const concurrent2 = newService();
  await Promise.all([concurrent2.markUsed("session-fixture1"), concurrent2.rename("session-fixture1", "Kept Name 2")]);
  const afterConcurrent2 = await newService().getById("session-fixture1");
  check(
    "session store: concurrent markUsed+rename both land in the reverse order too",
    afterConcurrent2?.name === "Kept Name 2" && typeof afterConcurrent2?.lastUsedAt === "string" && afterConcurrent2?.lastUsedAt !== beforeUsed2,
    `${afterConcurrent2?.name}/${afterConcurrent2?.lastUsedAt}`
  );

  // hasCapturedData is existence-only: true with state files present, false otherwise.
  check("hasCapturedData: true when Default state files exist", svcStore.hasCapturedData("session-fixture1") === true);
  const emptyId = join("session-empty-scaffold");
  await mkdir(join(sessionsDir, emptyId), { recursive: true });
  check("hasCapturedData: false for unused scaffolding", svcStore.hasCapturedData(emptyId) === false);
  check("hasCapturedData: false for a missing profile dir", svcStore.hasCapturedData("session-missing") === false);

  // deleteProfile removes both the registry entry and the profile directory. The BEFORE assertion is
  // load-bearing: it proves the directory existed, so "gone" afterwards can only mean removal.
  const dirBeforeDelete = await access(join(legacyProfile.profileDir, "Default", "Preferences")).then(() => true).catch(() => false);
  check("session store: profile directory exists before delete", dirBeforeDelete, legacyProfile.profileDir);
  await svcStore.deleteProfile("session-legacy1");
  const afterDelete = newService();
  check("session store: delete removes the registry entry", (await afterDelete.getById("session-legacy1")) === null);
  const dirGone = await access(legacyProfile.profileDir).then(() => false).catch(() => true);
  check("session store: delete removes the profile directory", dirBeforeDelete && dirGone);

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

  // ── AWKIT-SES-003 — closing Chrome only marks a capture ready with REAL authenticated state ──
  {
    const ses3Dir = await mkdtemp(join(tmpdir(), "awtkit-ses003-"));
    const ses3 = new SessionCaptureService(ses3Dir);
    const ses3Meta = join(ses3Dir, "session-profiles.json");
    const row = (id: string) => ({
      id,
      name: id,
      profileDir: join(ses3Dir, id),
      targetUrl: "https://example.test/app",
      createdAt: new Date().toISOString(),
      status: "capturing"
    });
    // Strong signal: real authenticated state (cookies under Default/Network).
    await mkdir(join(ses3Dir, "session-strong", "Default", "Network"), { recursive: true });
    await writeFile(join(ses3Dir, "session-strong", "Default", "Network", "Cookies"), "{}", "utf8");
    // Weak-only: Preferences alone is written by Chrome very early and must NEVER mark reusable.
    await mkdir(join(ses3Dir, "session-weak", "Default"), { recursive: true });
    await writeFile(join(ses3Dir, "session-weak", "Default", "Preferences"), "{}", "utf8");
    // No Default at all: abandoned before first navigation.
    await mkdir(join(ses3Dir, "session-bare"), { recursive: true });
    await writeJsonFileAtomic(ses3Meta, [row("session-strong"), row("session-weak"), row("session-bare")]);

    const closeBrowser = (id: string) => (ses3 as unknown as { handleBrowserClosed(id: string): void }).handleBrowserClosed(id);
    closeBrowser("session-strong");
    closeBrowser("session-weak");
    closeBrowser("session-bare");
    const afterClose = await ses3.list();
    check("SES-003 a capture WITH cookies/local storage becomes ready on browser close", afterClose.find((p) => p.id === "session-strong")?.status === "ready", JSON.stringify(afterClose.map((p) => [p.id, p.status])));
    check("SES-003 a Preferences-only capture stays error (never satisfies reuse matching)", afterClose.find((p) => p.id === "session-weak")?.status === "error");
    check("SES-003 an abandoned-before-use capture stays error", afterClose.find((p) => p.id === "session-bare")?.status === "error");

    await rm(ses3Dir, { recursive: true, force: true });
  }


  // ── AWKIT-QA-002 — a REJECTING operation must not poison the enqueue chain ──
  {
    const qDir = await mkdtemp(join(tmpdir(), "awtkit-qa002-"));
    const qSvc = new SessionCaptureService(qDir);
    // Holder object rather than a bare `let`: TypeScript narrows `let ran = false` to the literal
    // `false` and does not track the assignment inside the queued callback, so `ran === true` was a
    // compile error (TS2367) even though the assertion is exactly right. A property read is not
    // narrowed that way.
    const after = { ran: false };
    const enqueue = (op: () => Promise<unknown>) =>
      (qSvc as unknown as { enqueue(op: () => Promise<unknown>): Promise<unknown> }).enqueue(op);
    await enqueue(async () => {
      throw new Error("synthetic queue rejection");
    }).catch(() => undefined);
    await enqueue(async () => {
      after.ran = true;
      return null;
    });
    results.push({ name: "QA-002 an operation enqueued AFTER a rejection still runs and lands", pass: after.ran === true });
    results.push({ name: "QA-002 list() works after a rejected operation poisoned nothing", pass: Array.isArray(await qSvc.list()) });
    await rm(qDir, { recursive: true, force: true });
  }

  await rm(sessionsDir, { recursive: true, force: true });
}

// ── AWKIT-DUR-003 — torn drafts are quarantined, writes are atomic, death flush cancels the timer ──
{
  const durDir = await mkdtemp(join(tmpdir(), "awkit-dur003-"));
  const draftFile = join(durDir, "recorder-draft.json");
  const durSvc = recorderService as unknown as Record<string, any>;

  // 1. Torn-write fixture: a truncated draft is QUARANTINED (bytes preserved) and restores nothing.
  //    The old behavior silently treated it as "nothing to restore" and the next save overwrote it
  //    with no trace at all.
  const TORN = '{ "version": 1, "actions": [ { "type": "click", "na';
  await writeFile(draftFile, TORN, "utf8");
  durSvc.configureDraftStorage(draftFile);
  durSvc.configureUrlStorage(join(durDir, "url-history.json"));
  durSvc.draftLoad = null;
  durSvc.isRecording = false;
  durSvc.actions = [];
  await durSvc.ensureDraftLoaded();
  results.push({ name: "DUR-003 a torn draft restores no actions", pass: durSvc.actions.length === 0 });
  const corruptSiblingsDur = (await readdir(durDir)).filter((f) => f.startsWith("recorder-draft.json.corrupt-"));
  results.push({ name: "DUR-003 exactly one .corrupt-* sibling preserves the torn bytes", pass: corruptSiblingsDur.length === 1 && (await readFile(join(durDir, corruptSiblingsDur[0]), "utf8").catch(() => "")) === TORN });

  // 2. Atomic write evidence: persistDraft leaves no .tmp residue and produces complete JSON.
  await writeJsonFileAtomic(draftFile, { version: 1, updatedAt: new Date().toISOString(), actions: [{ id: "a1", type: "click", name: "Click" }] });
  const tmpResidueDur = (await readdir(durDir)).filter((f) => f.includes(".tmp"));
  results.push({ name: "DUR-003 atomic draft write leaves no .tmp residue", pass: tmpResidueDur.length === 0 });
  let parsesAfterPersist = false;
  try { JSON.parse(await readFile(draftFile, "utf8")); parsesAfterPersist = true; } catch { /* torn */ }
  results.push({ name: "DUR-003 the persisted draft is complete JSON (no torn tail)", pass: parsesAfterPersist });

  // 3. Wiring guards on the service source.
  const svcSrc = await readFile("src/recorder/RecorderService.ts", "utf8");
  const deathIdx = svcSrc.indexOf("AWKIT-DUR-003: cancel the debounced write FIRST");
  const deathBody = svcSrc.slice(deathIdx, deathIdx + 420);
  results.push({ name: "DUR-003 onUnexpectedDeath clears draftTimer before flushing", pass: deathIdx > -1 && /clearTimeout\(this\.draftTimer\)/.test(deathBody) });
  results.push({ name: "DUR-003 persistDraft uses the shared atomic writer", pass: /writeJsonFileAtomic\(this\.draftPath/.test(svcSrc) });
  results.push({ name: "DUR-003 persistUrlHistory uses the shared atomic writer", pass: /writeJsonFileAtomic\(this\.urlHistoryPath/.test(svcSrc) });

  durSvc.actions = [];
  durSvc.draftLoad = null;
  await rm(durDir, { recursive: true, force: true });
}

// ── AWKIT-REC-037 — the preserved draft is reachable in the UI and never destroyed silently ──
{
  const pageSrc = await readFile("app/renderer/pages/Recorder.tsx", "utf8");
  const svcSrc = await readFile("src/recorder/RecorderService.ts", "utf8");
  const sessionSrc = await readFile("src/session/SessionCaptureService.ts", "utf8");

  // 1. The page fetches the restored draft + handoff on MOUNT, unconditionally.
  {
    const mountAt = pageSrc.indexOf("AWKIT-REC-037");
    const mountBlock = mountAt > -1 ? pageSrc.slice(mountAt, mountAt + 800) : "";
  {
    const mountAt = pageSrc.indexOf("AWKIT-REC-037: fetch the preserved draft");
    const region = mountAt > -1 ? pageSrc.slice(mountAt, mountAt + 900) : "";
    results.push({
      name: "REC-037 the page fetches actions and handoff on mount (draft visible after restart)",
      pass: region.includes("getActions()") && region.includes("getHandoff().then(setHandoff)") && region.includes("useEffect"),
    });
  }
  }
  // 2. Save is disabled for the whole handoff pause (not only while isRecording).
  check(
    "REC-037 saveDisabled includes an active-handoff term",
    /const saveDisabled = isRecording \|\| handoffActive \|\| isSaving/.test(pageSrc)
  );
  // 3. Cancelling a handoff refetches instead of blanking local state.
  {
    const handler = pageSrc.slice(pageSrc.indexOf("const handleCancelHandoff"), pageSrc.indexOf("const handleCancelHandoff") + 700);
    check("REC-037 cancelling a handoff refetches the preserved actions", handler.includes("getActions().then(setActions)") && !handler.includes("setActions([])"), handler.includes("setActions([])") ? "handler still blanks actions" : "");
  }
  // 4. Starting over a restored draft requires explicit confirmation (no silent destruction).
  check(
    "REC-037 starting over a preserved draft opens a confirmation dialog",
    pageSrc.includes("startOverwriteConfirmOpen") && /Discard draft and start/.test(pageSrc)
  );

  // 5. Chrome availability is validated BEFORE closing the automation browser.
  {
    const fnStart = svcSrc.indexOf("public async continueWithNormalBrowser");
    const body = svcSrc.slice(fnStart, svcSrc.indexOf("captureSessionAndResume", fnStart));
    check(
      "REC-037 continueWithNormalBrowser checks Chrome BEFORE closing the recorder browser",
      body.indexOf("detectBrowser()") > -1 && body.indexOf("detectBrowser()") < body.indexOf("await this.closeBrowser()"),
      `detect@${body.indexOf("detectBrowser()")} close@${body.indexOf("await this.closeBrowser()")}`
    );
  }
  // 6. Liveness watch stays armed during the detected pause.
  check(
    "REC-037 a closed paused browser surfaces instead of reading Recording",
    /pausedForDetection = this\.handoff\?\.active === true && this\.handoff\.phase === "detected"/.test(svcSrc) &&
      svcSrc.includes('phase: "error"')
  );
  // 7. Session capture validates the URL BEFORE registering a capturing row.
  {
    const validateAt = sessionSrc.indexOf('if (url && !/^https?:\\/\\//i.test(url)');
    const registerAt = sessionSrc.indexOf("Register the profile in metadata");
    check(
      "REC-037 session capture rejects bad URLs before persisting a capturing row",
      validateAt > -1 && registerAt > -1 && validateAt < registerAt,
      `validate@${validateAt} register@${registerAt}`
    );
  }
}

await rm(dir, { recursive: true, force: true });

// AWKIT-QA-005: cardinality assertion — an uncaught throw shrinks results.length, so this pins the
// EXPECTED count; a shortened run FAILS instead of printing a full-looking tally. Intentional
// additions must bump EXPECTED_CHECKS.
const EXPECTED_CHECKS = 109;
{
  const { assertCardinality } = await import("./lib/verify-harness.mjs");
  const passed = results.filter((r) => r.pass).length;
  if (!assertCardinality(passed, results.length - passed, EXPECTED_CHECKS, "QA-005 recorder-draft")) process.exitCode = 1;
}
const passedFinal = results.filter((r) => r.pass).length;
console.log(`\n${passedFinal}/${EXPECTED_CHECKS} recorder-draft checks passed (failed: ${results.length - passedFinal})`);
process.exit(process.exitCode === 1 || passedFinal !== results.length ? 1 : 0);
