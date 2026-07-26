// Verifies recorder persistence without launching a browser:
//   • the unsaved-recording draft (actions) is written, restored on "restart", and cleared on discard;
//   • the reusable saved-URL history (Task 6) is deduped, persisted separately, survives a
//     save/cancel discard, and restores on "restart";
//   • the optional wait-time capture (Task 1) inserts a fixed-time wait for meaningful pauses only.
//
// Run: npm run verify:recorder-draft
import { recorderService } from "@src/recorder/RecorderService";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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

await rm(dir, { recursive: true, force: true });
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} recorder-draft checks passed`);
process.exit(passed === results.length ? 0 : 1);
