// Real-Electron walkthrough of the Super User Administration area (Phase 3). Launches the built app on an
// isolated empty %LOCALAPPDATA%, drives first-run to provision the protected Super User (all permissions),
// then exercises the admin UI: Users list + create a user + Roles + Permissions matrix + Audit Log +
// Licensing placeholder. Proves the RBAC-gated nav + pages render and the admin IPC round-trips.
//
// Run: node scripts/verify-admin-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Click a primary-nav item by its exact visible label. */
async function nav(win, label) {
  await win.evaluate((text) => {
    const item = [...document.querySelectorAll("button.nav-item")].find((b) => (b.textContent || "").trim() === text);
    item?.click();
  }, label);
  await win.waitForTimeout(500);
}

const { env, cleanup } = isolatedLaunchEnv("awkit-admin-gui");
const app = await electron.launch({ args: [root], cwd: root, env });
const consoleErrors = [];
try {
  const win = await resolveMainWindow(app);
  win.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.waitForTimeout(400);

  // The protected Super User sees the Administration group.
  const adminNav = await win.evaluate(() => [...document.querySelectorAll("button.nav-item")].some((b) => (b.textContent || "").trim() === "Users"));
  check("Administration nav is visible to the Super User", adminNav);

  // ── Users page ───────────────────────────────────────────────────────────────
  await nav(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 10000 }).catch(() => {});
  check("Users page renders the create-user card", (await win.getByRole("heading", { name: "Add a user" }).count()) >= 1);
  check("existing Super User is listed", (await win.getByText("@guiverifier").count()) >= 1);

  // Create a Viewer user (fresh first-run login counts as a fresh reauth → no prompt).
  await win.locator(".awkit-admin-create-form input").first().fill("viewer1");
  await win.locator('.awkit-admin-create-form input[type="password"]').first().fill("V1ewer!Pass9");
  await win.getByRole("button", { name: "Create user", exact: true }).click();
  await win.waitForTimeout(900);
  check("newly created user appears in the list", (await win.getByText("@viewer1").count()) >= 1);
  check("no renderer console errors on Users", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  const shotDir = path.join(root, "reports", "security-admin");
  mkdirSync(shotDir, { recursive: true });
  await win.screenshot({ path: path.join(shotDir, "user-management.png") }).catch(() => undefined);

  // ── Roles / Permissions / Audit / Licensing ─────────────────────────────────
  await nav(win, "Roles");
  check("Roles page lists the Super User role", (await win.getByRole("heading", { name: "Super User" }).count()) >= 1);
  await nav(win, "Permissions");
  check("Permissions matrix renders", (await win.getByRole("heading", { name: "Permission matrix" }).count()) >= 1);
  await nav(win, "Audit Log");
  await win.waitForTimeout(400);
  check("Audit Log shows the USER_CREATE event", (await win.getByText("USER_CREATE").count()) >= 1);
  // PR #21 replaced the licensing placeholder with the real LicensingPage (offline per-machine).
  await nav(win, "Licensing");
  await win.getByRole("heading", { name: "License status" }).first().waitFor({ timeout: 10000 }).catch(() => {});
  check("Licensing page renders the license status card", (await win.getByRole("heading", { name: "License status" }).count()) >= 1);
  check("Licensing shows the not-activated state on a fresh profile", (await win.getByText("Not activated").count()) >= 1);

  check("no renderer console errors overall", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await app.close().catch(() => undefined);
  cleanup();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nSuper User Admin GUI: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
