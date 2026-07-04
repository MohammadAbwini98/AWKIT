// Verifies recorder persistence without launching a browser:
//   • the unsaved-recording draft (actions) is written, restored on "restart", and cleared on discard;
//   • the reusable saved-URL history (Task 6) is deduped, persisted separately, survives a
//     save/cancel discard, and restores on "restart";
//   • the optional wait-time capture (Task 1) inserts a fixed-time wait for meaningful pauses only.
//
// Run: npm run verify:recorder-draft
import { recorderService } from "@src/recorder/RecorderService";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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

await rm(dir, { recursive: true, force: true });
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} recorder-draft checks passed`);
process.exit(passed === results.length ? 0 : 1);
