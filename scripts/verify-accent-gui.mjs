// Real-Electron end-to-end check for the user-selectable accent (Appearance → Accent Color): solid AND
// two-color gradient. Drives the actual app through the SecurityGate against an ISOLATED, empty
// %LOCALAPPDATA%:
//   • default accent is the Hologram purple (solid) on a clean profile;
//   • a solid custom accent recolors the whole app (+ a real primary button + canvas connector), status
//     colors intact, and persists to the store AND ui-settings.json;
//   • a two-color GRADIENT accent sets data-accent-mode="gradient", gradients the primary buttons, and
//     keeps fine controls (--awkit-accent) solid; status colors intact;
//   • the built-in Specter Blue preset applies its documented royal-blue → cyan pair;
//   • Flow Designer + the login screen honor it; the canvas keeps its nodes;
//   • a reload restores it before sign-in (no flash); Reset to Default Purple returns to solid purple.
// Also writes the deliverable screenshots to the directory passed as argv[2] (default: a temp dir).
//
// Run: node scripts/verify-accent-gui.mjs [screenshotDir]   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = process.argv[2] || path.join(tmpdir(), "awkit-accent-shots");
mkdirSync(shotDir, { recursive: true });

const CUSTOM = "#0EA5E9"; // sky blue — unmistakably not the default purple (solid test)
const GRAD_PRIMARY = "#2563EB";
const GRAD_SECONDARY = "#22D3EE";
const SPECTER = { primary: "#1D4ED8", secondary: "#38BDF8" };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const norm = (v) => String(v || "").trim().toLowerCase();

const readAccentVar = (win) =>
  win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--awkit-accent").trim());
const readVar = (win, name) =>
  win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
const readMode = (win) => win.evaluate(() => document.documentElement.dataset.accentMode || "solid");
const getAccent = (win) => win.evaluate(() => window.playwrightFlowStudio.settings.get().then((s) => s.accent));

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

async function applyDraft(win) {
  await win.locator(".accent-actions").getByRole("button", { name: "Apply" }).click();
  await win.waitForTimeout(350);
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
const readOnDiskAccent = (dir) => {
  const f = findSettingsFile(dir);
  return f ? JSON.parse(readFileSync(f, "utf8")).accent : null;
};

async function signInExisting(win, creds = DEFAULT_CREDS) {
  await win.waitForSelector(".awkit-login-form", { timeout: 20000 });
  await win.fill("#awkit-login-username", creds.username);
  await win.locator('.awkit-login-form input[type="password"]').first().fill(creds.password);
  await win.getByRole("button", { name: "Sign in", exact: true }).click();
  await win.waitForSelector(".app-shell", { timeout: 25000 });
}

const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-accent-gui");
// Own Electron userData dir so the single-instance lock + localStorage never collide with the user's app.
const userDataDir = path.join(dataRoot, "electron-userdata");

const app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`], cwd: root, env });
const win = await resolveMainWindow(app);
const consoleErrors = [];
win.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
await win.waitForLoadState("domcontentloaded");
await signInFirstRun(win);
await win.waitForTimeout(300);

// 1. Clean profile → default purple, solid.
check("default accent is purple #7c3aed", norm(await readAccentVar(win)) === "#7c3aed", await readAccentVar(win));
check("default accent mode is solid", (await readMode(win)) === "solid");

// 2. Settings → Accent Color card renders.
await navTo(win, "Settings");
await win.getByRole("heading", { name: "Appearance — Accent Color" }).first().waitFor({ timeout: 10000 }).catch(() => {});
check("Accent Color card renders", (await win.getByRole("heading", { name: "Appearance — Accent Color" }).count()) >= 1);
check("style segmented control renders", (await win.locator(".accent-seg").count()) >= 1);
check("preset row renders", (await win.locator(".accent-preset").count()) >= 3);
await shot(win, "01-settings-default-purple.png");

// 3. Solid custom accent through the UI.
await win.locator('input[aria-label="Primary color hex value"]').fill(CUSTOM);
await applyDraft(win);
check("solid custom applied to :root", norm(await readAccentVar(win)) === norm(CUSTOM), await readAccentVar(win));
check("solid custom keeps mode solid", (await readMode(win)) === "solid");
const primaryVarSolid = await win.locator(".settings-toolbar .toolbar-button.primary").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--awkit-accent").trim()).catch(() => "");
check("real primary button inherits the custom accent", norm(primaryVarSolid) === norm(CUSTOM), primaryVarSolid);
check("canvas connector follows the accent", norm(await readVar(win, "--awkit-connector-default")) === norm(CUSTOM));
check("status success unchanged (green)", norm(await readVar(win, "--awkit-success")).includes("14a46c"));
let stored = await getAccent(win);
check("store persisted solid custom", stored.mode === "solid" && norm(stored.primaryColor) === norm(CUSTOM), JSON.stringify(stored));
check("ui-settings.json holds solid custom", norm(readOnDiskAccent(dataRoot)?.primaryColor) === norm(CUSTOM));
await shot(win, "02-settings-solid-custom.png");

// 4. Two-color GRADIENT accent through the UI.
await win.locator(".accent-seg").getByRole("button", { name: "Gradient" }).click();
await win.waitForTimeout(200);
check("secondary color control appears in gradient mode", (await win.locator('input[aria-label="Secondary color hex value"]').count()) >= 1);
await win.locator('input[aria-label="Primary color hex value"]').fill(GRAD_PRIMARY);
await win.locator('input[aria-label="Secondary color hex value"]').fill(GRAD_SECONDARY);
await applyDraft(win);
check("gradient mode sets data-accent-mode=gradient", (await readMode(win)) === "gradient");
check("--awkit-accent-gradient is a linear-gradient", (await readVar(win, "--awkit-accent-gradient")).startsWith("linear-gradient("));
check("--awkit-accent-on-gradient is set", (await readVar(win, "--awkit-accent-on-gradient")).length > 0);
const primaryBgImage = await win.locator(".settings-toolbar .toolbar-button.primary").first().evaluate((el) => getComputedStyle(el).backgroundImage).catch(() => "");
check("real primary button uses a gradient background", primaryBgImage.includes("gradient"), primaryBgImage.slice(0, 40));
check("fine controls keep a SOLID accent (--awkit-accent is a hex)", /^#[0-9a-f]{6}$/.test(norm(await readAccentVar(win))), await readAccentVar(win));
check("gradient mode leaves status success green", norm(await readVar(win, "--awkit-success")).includes("14a46c"));
stored = await getAccent(win);
check("store persisted the gradient pair", stored.mode === "gradient" && norm(stored.primaryColor) === norm(GRAD_PRIMARY) && norm(stored.secondaryColor) === norm(GRAD_SECONDARY), JSON.stringify(stored));
await shot(win, "03-settings-gradient-custom.png");

// 5. Specter Blue preset.
await win.getByRole("button", { name: "Specter Blue" }).click();
await win.waitForTimeout(150);
await applyDraft(win);
stored = await getAccent(win);
check("Specter Blue preset persists documented royal→cyan pair", stored.mode === "gradient" && norm(stored.primaryColor) === norm(SPECTER.primary) && norm(stored.secondaryColor) === norm(SPECTER.secondary) && stored.preset === "specter-blue", JSON.stringify(stored));
check("Specter Blue keeps data-accent-mode=gradient", (await readMode(win)) === "gradient");
await shot(win, "04-settings-specter-blue.png");

// 6. Flow Designer honors the gradient + keeps its nodes (no graph reset).
await navTo(win, "Flow Designer");
await win.waitForSelector(".flow-designer-body", { timeout: 8000 }).catch(() => {});
await win.waitForTimeout(500);
check("Flow Designer keeps data-accent-mode=gradient", (await readMode(win)) === "gradient");
const nodeCount = await win.locator(".action-flow-node").count();
check("Flow Designer canvas still renders its nodes under gradient", nodeCount >= 1, `nodes=${nodeCount}`);
await shot(win, "05-flow-designer-gradient.png");

// 7. Reload → login screen restores the gradient before sign-in (no flash).
await win.reload();
await win.waitForSelector(".awkit-login-form", { timeout: 20000 });
await win.waitForTimeout(300);
check("gradient restored on fresh bootstrap (data-accent-mode)", (await readMode(win)) === "gradient");
check("login bootstrap has the gradient token", (await readVar(win, "--awkit-accent-gradient")).startsWith("linear-gradient("));
check("login uses the accent (blue, not purple)", norm(await readAccentVar(win)) !== "#7c3aed", await readAccentVar(win));
await shot(win, "06-login-gradient.png");

// 8. Sign back in — store round-trip keeps the gradient.
await signInExisting(win);
await win.waitForTimeout(400);
stored = await getAccent(win);
check("gradient survives the reload via the store", stored.mode === "gradient" && stored.preset === "specter-blue", JSON.stringify(stored));

// 9. Reset to Default Purple → solid default.
await navTo(win, "Settings");
await win.getByRole("heading", { name: "Appearance — Accent Color" }).first().waitFor({ timeout: 10000 }).catch(() => {});
await win.getByRole("button", { name: "Reset to Default Purple" }).click();
await applyDraft(win);
check("reset restores default purple (:root)", norm(await readAccentVar(win)) === "#7c3aed", await readAccentVar(win));
check("reset restores solid mode", (await readMode(win)) === "solid");
stored = await getAccent(win);
check("reset persists solid default (primaryColor null)", stored.mode === "solid" && stored.primaryColor === null, JSON.stringify(stored));
await shot(win, "07-settings-reset-default.png");

check("no renderer console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
await app.close();

// 10. Reset persisted to disk.
const disk = readOnDiskAccent(dataRoot);
check("ui-settings.json reset to solid default on disk", disk && disk.mode === "solid" && disk.primaryColor === null, JSON.stringify(disk));

cleanup();

const passed = results.filter((r) => r.pass).length;
console.log(`\nAccent GUI E2E: ${passed}/${results.length} checks passed`);
console.log(`Screenshots in: ${shotDir}`);
process.exit(passed === results.length ? 0 : 1);
