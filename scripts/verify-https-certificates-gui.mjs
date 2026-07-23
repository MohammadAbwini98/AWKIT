// Real-Electron end-to-end check for Settings → Recorder Security → "Ignore invalid HTTPS certificates".
// Drives the ACTUAL app through the SecurityGate against an ISOLATED, empty %LOCALAPPDATA%, covering the
// manual validation checklist:
//   • clean profile → the toggle is OFF and ui-settings.json holds recorder.security.ignoreHttpsErrors=false;
//   • ticking it opens the confirmation dialog and persists NOTHING yet;
//   • Cancel leaves the toggle OFF and the store untouched;
//   • Enable persists true to the store AND ui-settings.json, and shows the active-state warning;
//   • the value survives a full app restart;
//   • a legacy ui-settings.json with NO `security` key still loads and resolves to false (back-compat);
//   • unticking restores validation immediately (no confirmation).
// Writes deliverable screenshots to argv[2] (default: a temp dir).
//
// Run: node scripts/verify-https-certificates-gui.mjs [screenshotDir]   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = process.argv[2] || path.join(tmpdir(), "awkit-cert-shots");
mkdirSync(shotDir, { recursive: true });

const LABEL = "Ignore invalid HTTPS certificates";

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function findSettingsFile(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const found = findSettingsFile(full);
      if (found) return found;
    } else if (entry === "ui-settings.json") {
      return full;
    }
  }
  return null;
}

const readOnDisk = (dir) => {
  const file = findSettingsFile(dir);
  return file ? JSON.parse(readFileSync(file, "utf8")) : null;
};

const getSetting = (win) =>
  win.evaluate(() => window.playwrightFlowStudio.settings.get().then((s) => s.recorder?.security?.ignoreHttpsErrors));

const toggle = (win) => win.getByRole("checkbox").and(win.locator("input")).nth(0);

async function navTo(win, label) {
  await win.evaluate((lbl) => {
    const items = [...document.querySelectorAll("button.nav-item")];
    const target = items.find((b) => (b.textContent || "").trim() === lbl || b.getAttribute("title") === lbl);
    target?.click();
  }, label);
  await win.waitForTimeout(400);
}

async function shot(win, name) {
  try {
    await win.screenshot({ path: path.join(shotDir, name) });
    console.log(`    · screenshot → ${path.join(shotDir, name)}`);
  } catch (err) {
    console.log(`    · screenshot ${name} failed: ${err.message}`);
  }
}

/** The certificate checkbox inside the Recorder Security card. */
const certCheckbox = (win) => win.locator("section.settings-card", { hasText: "Recorder Security" }).locator('input[type="checkbox"]').first();

async function signInExisting(win, creds = DEFAULT_CREDS) {
  await win.waitForSelector(".awkit-login-form", { timeout: 20000 });
  await win.fill("#awkit-login-username", creds.username);
  await win.locator('.awkit-login-form input[type="password"]').first().fill(creds.password);
  await win.getByRole("button", { name: "Sign in", exact: true }).click();
  await win.waitForSelector(".app-shell", { timeout: 25000 });
}

const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-cert-gui");
const userDataDir = path.join(dataRoot, "electron-userdata");
const launchArgs = { args: [root, `--user-data-dir=${userDataDir}`], cwd: root, env };

let app = await electron.launch(launchArgs);
let win = await resolveMainWindow(app);
const consoleErrors = [];
win.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
await win.waitForLoadState("domcontentloaded");
await signInFirstRun(win);
await win.waitForTimeout(300);

// ── 1. Clean profile → disabled by default ──────────────────────────────────
console.log("\n[1] Default state on a clean profile");
check("setting defaults to false in the store", (await getSetting(win)) === false, String(await getSetting(win)));

await navTo(win, "Settings");
await win.getByRole("heading", { name: "Recorder Security" }).first().waitFor({ timeout: 10000 }).catch(() => {});
check("Recorder Security card renders", (await win.getByRole("heading", { name: "Recorder Security" }).count()) >= 1);
check("the labelled toggle renders", (await win.getByText(LABEL, { exact: true }).count()) >= 1);
check("toggle is unchecked by default", (await certCheckbox(win).isChecked()) === false);
check("no active-state warning banner when off", (await win.locator("section.settings-card", { hasText: "Recorder Security" }).locator(".settings-banner.error").count()) === 0);
await shot(win, "01-recorder-security-default-off.png");

// ── 2. Enabling requires confirmation ───────────────────────────────────────
console.log("\n[2] Enabling requires confirmation");
// `.click()`, not `.check()`: the checkbox is controlled by the persisted value, so it deliberately
// stays UNCHECKED until the confirmation is accepted — Playwright's check() would fail on that.
await certCheckbox(win).click();
await win.waitForTimeout(350);
const dialogVisible = (await win.locator('[role="alertdialog"]').count()) >= 1;
check("confirmation dialog appears", dialogVisible);
check("toggle stays visually OFF until confirmed", (await certCheckbox(win).isChecked()) === false);
const dialogText = dialogVisible ? await win.locator('[role="alertdialog"]').innerText() : "";
check(
  "dialog states the security consequence",
  dialogText.includes("disables certificate trust validation") && dialogText.includes("authorized internal, development, or testing"),
  dialogText.split("\n")[0]
);
check("dialog offers Cancel and Enable", dialogText.includes("Cancel") && dialogText.includes("Enable"));
check("NOTHING is persisted while the dialog is open", (await getSetting(win)) === false, String(await getSetting(win)));
await shot(win, "02-confirmation-dialog.png");

// ── 3. Cancel restores the disabled state ───────────────────────────────────
console.log("\n[3] Cancelling the confirmation");
await win.locator('[role="alertdialog"]').getByRole("button", { name: "Cancel" }).click();
await win.waitForTimeout(350);
check("dialog closes", (await win.locator('[role="alertdialog"]').count()) === 0);
check("toggle returns to the disabled state", (await certCheckbox(win).isChecked()) === false);
check("store still false after cancel", (await getSetting(win)) === false, String(await getSetting(win)));
check("ui-settings.json still false after cancel", readOnDisk(dataRoot)?.recorder?.security?.ignoreHttpsErrors === false);

// ── 4. Confirming enables + persists ────────────────────────────────────────
console.log("\n[4] Confirming enables and persists");
// `.click()`, not `.check()`: the checkbox is controlled by the persisted value, so it deliberately
// stays UNCHECKED until the confirmation is accepted — Playwright's check() would fail on that.
await certCheckbox(win).click();
await win.waitForTimeout(300);
await win.locator('[role="alertdialog"]').getByRole("button", { name: "Enable" }).click();
await win.waitForTimeout(500);
check("toggle is now checked", (await certCheckbox(win).isChecked()) === true);
check("store persisted true", (await getSetting(win)) === true, String(await getSetting(win)));
check("ui-settings.json persisted true", readOnDisk(dataRoot)?.recorder?.security?.ignoreHttpsErrors === true);
check(
  "active-state warning banner is shown",
  (await win.locator("section.settings-card", { hasText: "Recorder Security" }).locator(".settings-banner.error").count()) >= 1
);
await shot(win, "03-enabled-with-warning.png");

// ── 5. Persistence across a full application restart ────────────────────────
console.log("\n[5] Persistence across an application restart");
await app.close();
app = await electron.launch(launchArgs);
win = await resolveMainWindow(app);
await win.waitForLoadState("domcontentloaded");
await signInExisting(win);
await win.waitForTimeout(400);
check("value survives an app restart", (await getSetting(win)) === true, String(await getSetting(win)));
await navTo(win, "Settings");
await win.getByRole("heading", { name: "Recorder Security" }).first().waitFor({ timeout: 10000 }).catch(() => {});
check("toggle reflects the persisted value after restart", (await certCheckbox(win).isChecked()) === true);

// ── 6. Disabling restores validation immediately ────────────────────────────
console.log("\n[6] Disabling restores validation");
await certCheckbox(win).click();
await win.waitForTimeout(500);
check("no confirmation required to DISABLE", (await win.locator('[role="alertdialog"]').count()) === 0);
check("store back to false", (await getSetting(win)) === false, String(await getSetting(win)));
check("ui-settings.json back to false", readOnDisk(dataRoot)?.recorder?.security?.ignoreHttpsErrors === false);
check(
  "active-state warning banner disappears",
  (await win.locator("section.settings-card", { hasText: "Recorder Security" }).locator(".settings-banner.error").count()) === 0
);
await shot(win, "04-disabled-again.png");

// ── 7. Backward compatibility with a pre-feature settings file ──────────────
console.log("\n[7] Legacy settings file without the security key");
await app.close();
const settingsFile = findSettingsFile(dataRoot);
const legacy = JSON.parse(readFileSync(settingsFile, "utf8"));
// Simulate a settings file written before this feature existed.
delete legacy.recorder.security;
legacy.recorder.captureSmartWaits = false; // a sibling value that must survive untouched
writeFileSync(settingsFile, JSON.stringify(legacy, null, 2), "utf8");
check("legacy fixture has no security key", readOnDisk(dataRoot)?.recorder?.security === undefined);

app = await electron.launch(launchArgs);
win = await resolveMainWindow(app);
await win.waitForLoadState("domcontentloaded");
await signInExisting(win);
await win.waitForTimeout(400);
check("app starts normally on the legacy file", true);
check("missing key resolves to false", (await getSetting(win)) === false, String(await getSetting(win)));
const legacyRecorder = await win.evaluate(() => window.playwrightFlowStudio.settings.get().then((s) => s.recorder));
check("sibling recorder settings are preserved", legacyRecorder.captureSmartWaits === false, JSON.stringify(legacyRecorder));

// ── 8. Import must never enable the bypass (no confirmation dialog on that path) ──
console.log("\n[8] Settings import cannot silently enable the bypass");
const importResult = await win.evaluate(async () => {
  const current = await window.playwrightFlowStudio.settings.get();
  const tampered = { ...current, recorder: { ...current.recorder, security: { ignoreHttpsErrors: true } } };
  const applied = await window.playwrightFlowStudio.settings.import(tampered);
  return applied.recorder.security.ignoreHttpsErrors;
});
check("importing a file with ignoreHttpsErrors=true still resolves to false", importResult === false, String(importResult));
check("ui-settings.json after import is false", readOnDisk(dataRoot)?.recorder?.security?.ignoreHttpsErrors === false);

check("no renderer console errors during the walkthrough", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await app.close();
cleanup();

const passed = results.filter((r) => r.pass).length;
console.log(`\nHTTPS certificate settings GUI: ${passed}/${results.length} checks passed`);
console.log(`Screenshots: ${shotDir}`);
process.exit(passed === results.length ? 0 : 1);
