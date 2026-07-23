// Real-Electron end-to-end check for the Super-User custom workspace logo (Settings → Appearance →
// Workspace Logo). Drives the actual app through the SecurityGate against an ISOLATED, empty
// %LOCALAPPDATA%:
//   • a clean profile shows the built-in workspace icon (no custom logo);
//   • the Super User sees the Branding card, picks a logo, previews it, Applies → the sidebar updates
//     immediately and the main store reports it active;
//   • an Administrator (can reach Settings, but lacks the branding permission) SEES the logo in the
//     sidebar but has NO Branding card, and a direct preload-IPC upload is REJECTED;
//   • Replace swaps to a new image (cache invalidated); Remove restores the default icon;
//   • the logo PERSISTS across a real app restart;
//   • a corrupted stored asset falls back to the default icon on next launch (never a broken image,
//     never a crash).
// Screenshots are written to argv[2] (default: a temp dir).
//
// Run: node scripts/verify-branding-gui.mjs [screenshotDir]   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";
import { loginAs, createUser, signOut, navClick, submitForcedChange, genPassword } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = process.argv[2] || path.join(tmpdir(), "awkit-branding-shots");
mkdirSync(shotDir, { recursive: true });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── Minimal valid PNG generator (8-bit RGBA) — no image dependency ────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
};
const makePng = (w, h, [r, g, b] = [29, 78, 216]) => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((1 + w * 4) * h);
  for (let y = 0; y < h; y++) {
    let o = y * (1 + w * 4);
    raw[o++] = 0; // filter byte
    for (let x = 0; x < w; x++) {
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = 255; // opaque, so the logo is visible in screenshots
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
};

const filesDir = mkdtempSync(path.join(tmpdir(), "awkit-branding-files-"));
const logoA = path.join(filesDir, "logoA.png");
const logoB = path.join(filesDir, "logoB.png");
const logoSvg = path.join(filesDir, "logo.svg");
writeFileSync(logoA, makePng(200, 120, [29, 78, 216])); // wide, royal blue
writeFileSync(logoB, makePng(96, 96, [219, 39, 119])); // square + different color → different data URL
writeFileSync(
  logoSvg,
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">' +
    '<rect width="128" height="128" rx="24" fill="#16a34a"/><circle cx="64" cy="64" r="30" fill="#ffffff"/></svg>'
);

// ── Page helpers ──────────────────────────────────────────────────────────────
const sidebarHasLogo = (win) => win.evaluate(() => !!document.querySelector(".nav-workspace-logo-full"));
const sidebarLogoSrc = (win) => win.evaluate(() => document.querySelector(".nav-workspace-logo-full")?.getAttribute("src") || null);
const sidebarHasDefaultIcon = (win) => win.evaluate(() => !!document.querySelector(".nav-workspace-mark svg") && !document.querySelector(".nav-workspace-logo-full"));
const brandingActive = (win) => win.evaluate(() => window.playwrightFlowStudio.branding.getState().then((s) => s.active));
const shot = async (win, name) => {
  try {
    await win.screenshot({ path: path.join(shotDir, name) });
    console.log(`    · screenshot → ${path.join(shotDir, name)}`);
  } catch (err) {
    console.log(`    · screenshot ${name} failed: ${err.message}`);
  }
};

const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-branding-gui");
const userDataDir = path.join(dataRoot, "electron-userdata");
const launchArgs = [root, `--user-data-dir=${userDataDir}`];

async function launch() {
  const app = await electron.launch({ args: launchArgs, cwd: root, env });
  const win = await resolveMainWindow(app);
  const consoleErrors = [];
  win.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  win.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  win.on("dialog", (d) => d.accept().catch(() => undefined)); // accept the Remove confirm()
  await win.waitForLoadState("domcontentloaded");
  return { app, win, consoleErrors };
}

async function openBrandingSettings(win) {
  await navClick(win, "Settings");
  await win.getByRole("heading", { name: "Appearance — Workspace Logo" }).first().waitFor({ timeout: 8000 }).catch(() => {});
}
async function applyLogo(win, file) {
  await win.locator(".branding-controls input[type='file']").setInputFiles(file);
  await win.waitForTimeout(400);
  await win.locator(".branding-actions").getByRole("button", { name: /Apply/ }).click();
  await win.waitForTimeout(600);
}

// ══ Launch 1: first-run Super User ══════════════════════════════════════════════
let { app, win, consoleErrors } = await launch();
await signInFirstRun(win);
await win.waitForTimeout(300);

check("clean profile → sidebar shows the built-in workspace icon", await sidebarHasDefaultIcon(win));
check("clean profile → branding state inactive", (await brandingActive(win)) === false);
await shot(win, "01-default-sidebar.png");

await openBrandingSettings(win);
check("Super User sees the Workspace Logo card", (await win.getByRole("heading", { name: "Appearance — Workspace Logo" }).count()) >= 1);
check("card shows a Choose Logo control", (await win.locator(".branding-actions").getByRole("button", { name: "Choose Logo" }).count()) >= 1);
await shot(win, "02-su-branding-card.png");

// Pick a logo → preview appears (unsaved) before Apply.
await win.locator(".branding-controls input[type='file']").setInputFiles(logoA);
await win.waitForTimeout(400);
check("selecting a file shows a live preview", (await win.locator(".branding-preview-logo-full").count()) >= 1);
check("preview is not yet applied to the sidebar", (await sidebarHasLogo(win)) === false);
await shot(win, "03-su-preview.png");

await win.locator(".branding-actions").getByRole("button", { name: /Apply/ }).click();
await win.waitForTimeout(700);
check("after Apply the sidebar shows the custom logo", await sidebarHasLogo(win));
check("after Apply the store reports active", (await brandingActive(win)) === true);
const appliedSrc = await sidebarLogoSrc(win);
check("sidebar logo is a data: URL (self-contained, no path)", (appliedSrc || "").startsWith("data:image/png;base64,"));
await shot(win, "04-su-logo-applied.png");

// SVG is accepted by RASTERIZING to PNG at import (never stored or rendered as raw SVG markup).
await win.locator(".branding-controls input[type='file']").setInputFiles(logoSvg);
await win.waitForTimeout(400);
check("SVG selection produces a live preview", (await win.locator(".branding-preview-logo-full").count()) >= 1);
await win.locator(".branding-actions").getByRole("button", { name: /Apply/ }).click();
await win.waitForTimeout(700);
check("SVG logo applies and shows in the sidebar", await sidebarHasLogo(win));
check("SVG upload accepted by the main-process PNG re-validation", (await brandingActive(win)) === true);
check("stored SVG upload is served as PNG (rasterized, not raw SVG)", ((await sidebarLogoSrc(win)) || "").startsWith("data:image/png;base64,"));
await shot(win, "04b-su-svg-rasterized.png");
// Restore a known raster logo for the subsequent replace/persistence steps.
await applyLogo(win, logoA);

// Persists across in-app navigation (main holds it).
await navClick(win, "Dashboard");
await navClick(win, "Settings");
check("logo persists across in-app navigation", await sidebarHasLogo(win));

// ══ Administrator: sees the logo, but no controls; direct IPC denied ═══════════
await navClick(win, "Users");
const adminUser = `brandadmin_${Date.now().toString(36)}`;
const adminTemp = genPassword("Ba");
const adminNew = genPassword("Bb");
await createUser(win, { username: adminUser, displayName: "Brand Admin", password: adminTemp, roles: ["Administrator"] });
await signOut(win);
await loginAs(win, adminUser, adminTemp);
await win.waitForTimeout(700);
// Admin-created accounts must change password on first login.
if ((await win.locator('.awkit-login-form input[type="password"]').count()) >= 3) {
  await submitForcedChange(win, adminTemp, adminNew);
}
await win.waitForSelector(".app-shell", { timeout: 20000 });
await win.waitForTimeout(300);

check("Administrator sees the custom logo in the sidebar", await sidebarHasLogo(win));
await navClick(win, "Settings");
// Use the ungated "Application" card (holds the Appearance control) as the "Settings opened" marker —
// the Accent card is a separate feature branch and is not present here.
await win.getByRole("heading", { name: "Application" }).first().waitFor({ timeout: 8000 }).catch(() => {});
check("Administrator can open Settings (Application card present)", (await win.getByRole("heading", { name: "Application" }).count()) >= 1);
check("Administrator does NOT see the Workspace Logo card", (await win.getByRole("heading", { name: "Appearance — Workspace Logo" }).count()) === 0);
await shot(win, "05-admin-no-card.png");

const directUpload = await win.evaluate(async () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const r = await window.playwrightFlowStudio.branding.uploadLogo(bytes);
  return r;
});
check("Administrator direct-IPC uploadLogo is rejected (main-process boundary)", directUpload && directUpload.ok === false, JSON.stringify(directUpload));
const directRemove = await win.evaluate(() => window.playwrightFlowStudio.branding.removeLogo());
check("Administrator direct-IPC removeLogo is rejected", directRemove && directRemove.ok === false, JSON.stringify(directRemove));

// ══ Back to Super User: Replace + Remove ═══════════════════════════════════════
await signOut(win);
await loginAs(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
await win.waitForSelector(".app-shell", { timeout: 20000 });
await win.waitForTimeout(300);

await openBrandingSettings(win);
const beforeReplace = await sidebarLogoSrc(win);
await applyLogo(win, logoB);
const afterReplace = await sidebarLogoSrc(win);
check("Replace updates the sidebar to the new image (cache invalidated)", !!afterReplace && afterReplace !== beforeReplace);
await shot(win, "06-su-replaced.png");

await win.locator(".branding-actions").getByRole("button", { name: "Remove Custom Logo" }).click();
await win.waitForTimeout(700);
check("Remove restores the default icon", await sidebarHasDefaultIcon(win));
check("Remove clears the active branding state", (await brandingActive(win)) === false);
await shot(win, "07-su-removed.png");

// Re-apply so there is something to persist across restart.
await applyLogo(win, logoA);
check("logo re-applied before restart", await sidebarHasLogo(win));
await app.close();

// ══ Launch 2: restart persistence ══════════════════════════════════════════════
({ app, win, consoleErrors } = await launch());
await loginAs(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
await win.waitForSelector(".app-shell", { timeout: 20000 });
await win.waitForTimeout(400);
check("custom logo persists across an app restart", await sidebarHasLogo(win));
await shot(win, "08-restart-persisted.png");
const restartErrors = consoleErrors.slice();
await app.close();

// ══ Launch 3: corrupt-asset fallback ═══════════════════════════════════════════
const logoOnDisk = path.join(dataRoot, "SpecterStudio", "branding", "active", "logo.png");
check("stored logo file exists on disk", existsSync(logoOnDisk), logoOnDisk);
writeFileSync(logoOnDisk, Buffer.from("this is not a valid png file at all — corrupted"));
({ app, win, consoleErrors } = await launch());
await loginAs(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
await win.waitForSelector(".app-shell", { timeout: 20000 });
await win.waitForTimeout(400);
check("corrupt stored asset → sidebar falls back to the default icon", await sidebarHasDefaultIcon(win));
check("corrupt stored asset → no broken <img> rendered", (await sidebarHasLogo(win)) === false);
check("corrupt stored asset → app still boots (no crash)", (await win.locator(".app-shell").count()) >= 1);
check("no renderer console errors on the corrupt-asset boot", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
await shot(win, "09-corrupt-fallback.png");
await app.close();

check("no renderer console errors across the restart boot", restartErrors.length === 0, restartErrors.slice(0, 3).join(" | "));

cleanup();
rmSync(filesDir, { recursive: true, force: true });

const passed = results.filter((r) => r.pass).length;
console.log(`\nBranding GUI E2E: ${passed}/${results.length} checks passed`);
console.log(`Screenshots in: ${shotDir}`);
process.exit(passed === results.length ? 0 : 1);
