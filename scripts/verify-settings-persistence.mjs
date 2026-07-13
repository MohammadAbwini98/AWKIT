// Integration checks for UI-settings persistence safety in the REAL built Electron app:
//   • Many concurrent settings.update calls (each setting a different field) all persist —
//     no lost updates from racing read-modify-write (proves serialization).
//   • Closing the app immediately after the last update still persists it (proves the
//     before-quit flush).
//   • No leftover *.tmp files remain (proves atomic temp+rename writes clean up).
//
// Run: node scripts/verify-settings-persistence.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function launch() {
  const app = await electron.launch({ args: [root], cwd: root, env });
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(400);
  return { app, win };
}

// --- 1 & 3: concurrent patches all persist; no tmp files left behind ---
let storageDir = "";
{
  const { app, win } = await launch();
  storageDir = await win.evaluate(async () => {
    // Fire many DIFFERENT concurrent patches at once. With a racing read-modify-write most
    // would be lost; with the serial queue all must land.
    const patches = [];
    for (let i = 0; i < 40; i++) {
      patches.push(window.playwrightFlowStudio.settings.update({ workflowRunCards: { [`perf-race-${i}`]: { totalRuns: i, concurrentInstances: 1, runMode: "headless", isolationMode: "browserContext", screenshotOnFailure: true, stopOnError: false } } }));
    }
    await Promise.all(patches);
    const s = await window.playwrightFlowStudio.settings.get();
    return s.paths.logsPath; // any resolved path lets us locate the storage dir
  });
  const persisted = await win.evaluate(async () => {
    const s = await window.playwrightFlowStudio.settings.get();
    let ok = 0;
    for (let i = 0; i < 40; i++) if (s.workflowRunCards[`perf-race-${i}`]?.totalRuns === i) ok++;
    return ok;
  });
  check("40 concurrent settings patches all persist (no lost updates)", persisted === 40, `persisted=${persisted}/40`);
  await app.close();
}

// Resolve the ui-settings.json directory (…/storage) from LOCALAPPDATA, and check for tmp files.
{
  const base = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || root, "AppData", "Local");
  const storage = path.join(base, "WebFlow Studio", "storage");
  let tmpCount = -1;
  try {
    const files = await readdir(storage);
    tmpCount = files.filter((f) => f.startsWith("ui-settings.json") && f.endsWith(".tmp")).length;
  } catch {
    tmpCount = -1;
  }
  check("No leftover ui-settings temp files (atomic writes clean up)", tmpCount === 0, `tmpFiles=${tmpCount}`);
}

// --- 2: closing immediately after the last update still persists it (before-quit flush) ---
{
  const stamp = `flush-${Date.now()}`;
  const { app, win } = await launch();
  // Fire the update WITHOUT awaiting its disk write, then close the app right away.
  await win.evaluate((value) => {
    window.playwrightFlowStudio.settings.update({ selectedBuilderWorkflowId: value });
  }, stamp);
  await app.close(); // triggers before-quit → flushSettingsWrites

  const { app: app2, win: win2 } = await launch();
  const persistedValue = await win2.evaluate(() => window.playwrightFlowStudio.settings.get().then((s) => s.selectedBuilderWorkflowId));
  check("Update fired just before close is flushed on shutdown", persistedValue === stamp, `value=${persistedValue}`);
  // Cleanup the race-test keys via a full replace (settings.update only merges, can't delete keys).
  await win2.evaluate(async () => {
    const s = await window.playwrightFlowStudio.settings.get();
    const cards = { ...s.workflowRunCards };
    for (const k of Object.keys(cards)) if (k.startsWith("perf-race-")) delete cards[k];
    await window.playwrightFlowStudio.settings.import({ ...s, workflowRunCards: cards, selectedBuilderWorkflowId: "" }).catch(() => undefined);
  });
  await app2.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nSettings persistence: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
