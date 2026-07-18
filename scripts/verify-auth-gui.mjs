// Real-Electron walkthrough of the secure sign-in UI (SecurityGate). Launches the built app through
// Playwright's `_electron` against an ISOLATED, empty %LOCALAPPDATA% (temp dir) so it exercises a clean
// first-run without touching the user's real security store. Asserts:
//   • no-flash: the protected app shell (.app-shell) is NEVER present before authentication;
//   • first-run provisioning creates the Super User and signs straight in (app shell appears);
//   • the title-bar session chip shows the user + a working Sign-out that returns to the login screen;
//   • the login screen shows Active Directory as a disabled "Coming soon" tab;
//   • re-login with the created credentials reaches the app shell;
//   • the theme is applied (data-theme) and there are zero renderer console errors.
//
// Run: node scripts/verify-auth-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Isolated writable data root so the app provisions a clean, empty security store.
const dataRoot = mkdtempSync(path.join(tmpdir(), "awkit-auth-gui-"));
const env = { ...process.env, LOCALAPPDATA: dataRoot };
delete env.ELECTRON_RUN_AS_NODE;

const CREDS = { displayName: "Site Admin", username: "admin1", password: "Str0ng!Passw0rd" };

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function resolveMainWindow(app, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow().catch(() => undefined);
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        const ready = await w.evaluate(
          () => typeof window.playwrightFlowStudio !== "undefined" && !!window.playwrightFlowStudio.security
        );
        if (ready) return w;
      } catch {
        /* window navigating/closing — retry */
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("main window with the security bridge did not appear within timeout");
}

const app = await electron.launch({ args: [root], cwd: root, env });
const consoleErrors = [];
try {
  const win = await resolveMainWindow(app);
  win.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await win.waitForLoadState("domcontentloaded");

  // ── First-run surface + no-flash ────────────────────────────────────────────
  await win.waitForSelector(".awkit-login-card", { timeout: 20000 });
  check("theme applied before auth", await win.evaluate(() => !!document.documentElement.dataset.theme));
  check("no protected app shell before auth (no-flash)", (await win.locator(".app-shell").count()) === 0);
  check("first-run setup shown on a clean machine", (await win.getByRole("heading", { name: "Set up SpecterStudio" }).count()) >= 1);

  // ── Provision the Super User (auto sign-in on success) ───────────────────────
  await win.fill("#awkit-setup-display", CREDS.displayName);
  await win.fill("#awkit-setup-username", CREDS.username);
  const setupPw = win.locator('.awkit-login-form input[type="password"]');
  await setupPw.nth(0).fill(CREDS.password);
  await setupPw.nth(1).fill(CREDS.password);
  await win.getByRole("button", { name: "Create account" }).click();

  await win.waitForSelector(".app-shell", { timeout: 25000 });
  check("first-run provisioning signs into the app shell", true);
  const userChip = await win.locator(".app-frame-user").innerText().catch(() => "");
  check("title-bar session chip shows the display name", userChip.trim() === CREDS.displayName, userChip);
  check("sign-out control present", (await win.locator(".app-frame-logout").count()) === 1);

  const shotDir = path.join(root, "reports", "security-login");
  mkdirSync(shotDir, { recursive: true });
  await win.screenshot({ path: path.join(shotDir, "authed-shell.png") }).catch(() => undefined);

  // ── Sign out → back to login (shell gone) ────────────────────────────────────
  await win.locator(".app-frame-logout").click();
  await win.waitForSelector("#awkit-login-username", { timeout: 15000 });
  check("sign-out returns to the login screen", (await win.locator(".awkit-login-card").count()) >= 1);
  check("app shell removed after sign-out", (await win.locator(".app-shell").count()) === 0);

  // Active Directory disabled + "coming soon".
  const adTab = win.locator(".awkit-login-tab", { hasText: "Active Directory" });
  check("Active Directory tab present", (await adTab.count()) >= 1);
  check("Active Directory tab is disabled", await adTab.first().isDisabled());
  check("Active Directory marked coming soon", (await win.getByText(/coming soon/i).count()) >= 1);
  await win.screenshot({ path: path.join(shotDir, "login.png") }).catch(() => undefined);

  // ── Re-login with the created credentials ────────────────────────────────────
  await win.fill("#awkit-login-username", CREDS.username);
  await win.locator('.awkit-login-form input[type="password"]').first().fill(CREDS.password);
  await win.getByRole("button", { name: "Sign in" }).click();
  await win.waitForSelector(".app-shell", { timeout: 20000 });
  check("re-login with created credentials reaches the app shell", true);

  check("zero renderer console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await app.close().catch(() => undefined);
  rmSync(dataRoot, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\nverify:auth-gui — ${results.length - failed}/${results.length} checks passed`);
process.exit(failed > 0 ? 1 : 0);
