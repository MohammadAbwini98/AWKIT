// Real-Electron walkthrough of the Super User Administration area (Phase 3). Launches the built app on an
// isolated empty %LOCALAPPDATA%, drives first-run to provision the protected Super User (all permissions),
// then exercises the admin UI: Users list + create a user + Roles + Permissions matrix + Audit Log +
// Licensing. Proves the RBAC-gated nav + pages render and the admin IPC round-trips.
//
// Users, Roles, Permissions, Audit Log and Licensing use the SpecterStudio design frame (`.sys-page`
// with a `.sys-admin-head`); License Issuer still uses the older Administration frame, so the layout
// probes accept either.
//
// Run: node scripts/verify-admin-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";
import { createUser, userRows, waitForUsersPage } from "./lib/e2e-qa-lib.mjs";

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

async function adminLayout(win, expectedTitle) {
  return win.evaluate((title) => {
    const page = document.querySelector(".sys-page") ?? document.querySelector(".awkit-admin-page");
    const header = page?.querySelector(".sys-admin-head, .awkit-admin-header");
    const heading = header?.querySelector("h1");
    if (!page || !header || !heading) return null;
    const rect = page.getBoundingClientRect();
    const main = document.querySelector(".main-surface");
    const mainRect = main?.getBoundingClientRect();
    return {
      title: heading.textContent?.trim(),
      expectedTitle: title,
      headerVisible: header.getBoundingClientRect().height > 24,
      // The design frame caps its width (max-width) on very wide surfaces, so "fills" means it spans
      // the surface up to that cap rather than the raw surface width.
      fillsSurface: Boolean(mainRect && rect.width >= Math.min(mainRect.width, 1480) - 34),
      noPageOverflow: page.scrollWidth <= page.clientWidth + 1,
      metricCards: page.querySelectorAll(".sys-metric, .awkit-admin-metric-card").length,
      panels: page.querySelectorAll(".sys-panel").length
    };
  }, expectedTitle);
}

async function captureAdminThemes(win, shotDir, slug) {
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.evaluate(() => {
    document.querySelector(".main-surface")?.scrollTo({ top: 0, left: 0 });
    document.querySelector(".sys-page, .awkit-admin-page")?.scrollTo({ top: 0, left: 0 });
  });
  for (const theme of ["dark", "light"]) {
    await win.evaluate((nextTheme) => document.documentElement.setAttribute("data-theme", nextTheme), theme);
    await win.waitForTimeout(80);
    await win.screenshot({ path: path.join(shotDir, `${slug}-${theme}.png`), fullPage: true }).catch(() => undefined);
  }
  await win.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
}

async function verifyAdminResponsive(win, label) {
  const observations = [];
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 }
  ]) {
    await win.setViewportSize(viewport);
    await win.waitForTimeout(100);
    observations.push(await win.evaluate(({ width, height }) => {
      const page = document.querySelector(".sys-page") ?? document.querySelector(".awkit-admin-page");
      const main = document.querySelector(".main-surface");
      if (!page || !main) return { width, height, valid: false };
      const pageRect = page.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      return {
        width,
        height,
        valid: page.scrollWidth <= page.clientWidth + 1 &&
          pageRect.left >= mainRect.left - 1 &&
          pageRect.right <= mainRect.right + 1 &&
          [...page.querySelectorAll(".sys-table-scroll, .awkit-admin-table-scroll")].every((scroller) => scroller.scrollWidth >= scroller.clientWidth)
      };
    }, viewport));
  }
  check(`${label} remains contained at 1024, 1280, 1440, and 1920 widths`, observations.every((item) => item.valid), JSON.stringify(observations));
  await win.setViewportSize({ width: 1440, height: 900 });
}

/** A permission pill in a dialog, matched on its exact permission code (not a prefix of a longer one). */
const permissionPill = (scope, permission) =>
  scope.locator(".sys-check-pill").filter({ has: scope.page().locator("code", { hasText: new RegExp(`^${permission.replace(/\./g, "\\.")}$`) }) });

const { env, electronArgs, cleanup } = isolatedLaunchEnv("awkit-admin-gui");
const app = await electron.launch({ args: [root, ...electronArgs], cwd: root, env });
const consoleErrors = [];
try {
  const win = await resolveMainWindow(app);
  win.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win);
  await win.waitForTimeout(400);
  const shotDir = path.join(root, "reports", "security-admin");
  mkdirSync(shotDir, { recursive: true });

  // The protected Super User sees the Administration group.
  const adminNav = await win.evaluate(() => [...document.querySelectorAll("button.nav-item")].some((b) => (b.textContent || "").trim() === "Users"));
  check("Administration nav is visible to the Super User", adminNav);

  // ── Users page ───────────────────────────────────────────────────────────────
  await nav(win, "Users");
  await waitForUsersPage(win).catch(() => {});
  check(
    "Users page exposes Create user in its Administration head",
    (await win.locator(".sys-admin-actions").getByRole("button", { name: "Create user", exact: true }).count()) === 1
  );
  check("existing Super User is listed", (await userRows(win, "guiverifier").count()) >= 1);
  const usersLayout = await adminLayout(win, "Users");
  check("Users uses the shared Administration header and full-width surface", usersLayout?.title === "Users" && usersLayout.headerVisible && usersLayout.fillsSurface && usersLayout.noPageOverflow && usersLayout.metricCards === 4, JSON.stringify(usersLayout));

  // Create a Viewer user (fresh first-run login counts as a fresh reauth → no prompt).
  await createUser(win, { username: "viewer1", password: "V1ewer!Pass9", roles: ["Viewer"] });
  check("newly created user appears in the list", (await userRows(win, "viewer1").count()) >= 1);
  check("the Create user dialog closes after a successful create", (await win.locator(".users-create-modal").count()) === 0);
  check("no renderer console errors on Users", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  await verifyAdminResponsive(win, "Users");
  await captureAdminThemes(win, shotDir, "users");

  // ── Roles / Permissions / Audit / Licensing ─────────────────────────────────
  await nav(win, "Roles");
  check("Roles page lists the Super User role", (await win.getByRole("heading", { name: "Super User" }).count()) >= 1);
  const rolesLayout = await adminLayout(win, "Roles");
  check(
    "Roles uses the shared Administration header and one panel per built-in role",
    rolesLayout?.title === "Roles" && rolesLayout.noPageOverflow && rolesLayout.panels >= 5,
    JSON.stringify(rolesLayout)
  );

  await win.locator(".sys-admin-actions").getByRole("button", { name: "Create role", exact: true }).click();
  const roleEditor = win.locator(".roles-editor-modal");
  await roleEditor.waitFor({ state: "visible", timeout: 10000 });
  await roleEditor.locator("label", { hasText: "Role name" }).locator("input").fill("QA Runner");
  await permissionPill(roleEditor, "workflow.execute").locator('input[type="checkbox"]').check();
  await roleEditor.getByRole("button", { name: "Create role", exact: true }).click();
  await win.getByRole("heading", { name: "QA Runner", exact: true }).waitFor({ timeout: 10000 });
  check("custom role can be created from the Roles page", (await roleEditor.count()) === 0);
  const createdRolePanel = win.locator(".roles-panel", { has: win.getByRole("heading", { name: "QA Runner", exact: true }) });
  check("the new role grants only what was selected", (await createdRolePanel.getByText(/workflow\.stop/).count()) === 0);
  await createdRolePanel.getByRole("button", { name: "Edit", exact: true }).click();
  await roleEditor.waitFor({ state: "visible", timeout: 10000 });
  await permissionPill(roleEditor, "workflow.stop").locator('input[type="checkbox"]').check();
  await roleEditor.getByRole("button", { name: "Save role", exact: true }).click();
  await win.waitForTimeout(900);
  check("custom role permissions can be edited", (await createdRolePanel.getByText(/workflow\.stop/).count()) === 1);
  await verifyAdminResponsive(win, "Roles");
  await captureAdminThemes(win, shotDir, "roles");

  await nav(win, "Permissions");
  check("Permissions matrix renders", (await win.getByRole("heading", { name: "Permission to role matrix" }).count()) >= 1);
  check("custom role appears in the permission matrix", (await win.getByRole("columnheader", { name: "QA Runner" }).count()) === 1);
  check("Permissions are organized into named capability groups", (await win.locator(".permissions-page .sys-table tr.is-group").count()) >= 4);
  const permissionMatrixLayout = await win.evaluate(() => {
    const surface = document.querySelector(".permissions-matrix-card");
    const scroller = surface?.querySelector(".sys-table-scroll");
    const table = surface?.querySelector(".sys-table");
    if (!surface || !scroller || !table) return null;
    return {
      surfaceWidth: surface.getBoundingClientRect().width,
      scrollerWidth: scroller.getBoundingClientRect().width,
      tableWidth: table.getBoundingClientRect().width
    };
  });
  check(
    "Permissions matrix uses the available Administration content width",
    permissionMatrixLayout && permissionMatrixLayout.tableWidth >= permissionMatrixLayout.scrollerWidth - 2,
    JSON.stringify(permissionMatrixLayout)
  );
  await verifyAdminResponsive(win, "Permissions");
  await captureAdminThemes(win, shotDir, "permissions");

  await nav(win, "Users");
  const viewerRow = userRows(win, "viewer1").first();
  const accessModal = win.locator(".users-access-modal");
  await viewerRow.getByRole("button", { name: "Edit access", exact: true }).click();
  await accessModal.locator(".sys-check-pill", { hasText: "QA Runner" }).locator('input[type="checkbox"]').check();
  await accessModal.getByLabel("workflow.execute override").selectOption("deny");
  await accessModal.getByRole("button", { name: "Save access" }).click();
  await win.waitForTimeout(900);
  check("custom role assignment appears on the user", (await viewerRow.getByText("QA Runner").count()) === 1);
  await viewerRow.getByRole("button", { name: "Edit access", exact: true }).click();
  check(
    "direct deny override persists in the access editor",
    await accessModal.getByLabel("workflow.execute override").inputValue() === "deny"
  );
  await win.keyboard.press("Escape");
  await accessModal.waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
  check(
    "access editor closes with Escape and returns focus",
    (await accessModal.count()) === 0 && await viewerRow.getByRole("button", { name: "Edit access", exact: true }).evaluate((button) => button === document.activeElement)
  );

  await nav(win, "Roles");
  const customRolePanel = win.locator(".roles-panel", { has: win.getByRole("heading", { name: "QA Runner", exact: true }) });
  await customRolePanel.getByRole("button", { name: "Delete", exact: true }).click();
  await win.getByRole("button", { name: "Delete role" }).click();
  await win.waitForTimeout(900);
  check("custom role can be deleted", (await win.getByRole("heading", { name: "QA Runner", exact: true }).count()) === 0);

  await nav(win, "Audit Log");
  await win.waitForTimeout(400);
  check("Audit Log shows the USER_CREATE event", (await win.getByText("USER_CREATE").count()) >= 1);
  check("Audit Log exposes local search and result filters", (await win.getByRole("search", { name: "Audit filters" }).count()) === 1);
  await verifyAdminResponsive(win, "Audit Log");
  await captureAdminThemes(win, shotDir, "audit-log");
  // PR #21 replaced the licensing placeholder with the real LicensingPage (offline per-machine).
  await nav(win, "Licensing");
  const licensingHead = win.locator(".sys-admin-head").getByRole("heading", { name: "Licensing", exact: true });
  await licensingHead.waitFor({ timeout: 10000 }).catch(() => {});
  check("Licensing page renders the license status summary", (await licensingHead.count()) === 1 && (await win.locator(".licensing-page .sys-metric").count()) >= 1);
  check("Licensing shows the not-activated state on a fresh profile", (await win.getByText("Not activated").count()) >= 1);
  const licensingLayout = await adminLayout(win, "Licensing");
  check("Licensing uses the shared Administration header and dashboard summary", licensingLayout?.title === "Licensing" && licensingLayout.noPageOverflow && licensingLayout.metricCards === 4, JSON.stringify(licensingLayout));
  await verifyAdminResponsive(win, "Licensing");
  await captureAdminThemes(win, shotDir, "licensing");

  // ─── License Issuer (role-exclusive trust boundary) ─────────────────────────
  // The page is gated by ISSUER_ROLE, which is exclusive and cannot be held alongside other roles.
  // First prove the Super User does NOT get it, then create a dedicated Issuer account through the
  // supported Users UI, switch accounts via Sign out/Sign in, and verify the redesigned page.
  check(
    "License Issuer nav is hidden from the Super User (role-exclusive route)",
    (await win.evaluate(() => [...document.querySelectorAll("button.nav-item")].some((b) => (b.textContent || "").trim() === "License Issuer"))) === false
  );

  // Create the dedicated Issuer account through the supported Create user dialog.
  await nav(win, "Users");
  await waitForUsersPage(win);
  await createUser(win, { username: "issuer1", password: "Str0ng!Passw0rd", roles: ["Issuer"] });
  check("Issuer account created from the Users page", (await userRows(win, "issuer1").count()) >= 1);

  // Sign out through the account menu.
  await win.locator("button.awkit-account-trigger").click();
  await win.locator(".awkit-account-menu-item", { hasText: "Sign out" }).click();
  await win.waitForSelector(".awkit-login-card", { timeout: 20000 });

  // Sign in as the dedicated Issuer account. The temporary password forces a password change first —
  // complete that real flow before the shell mounts.
  await win.fill("#awkit-login-username", "issuer1");
  await win.locator('.awkit-login-form input[type="password"]').fill("Str0ng!Passw0rd");
  await win.getByRole("button", { name: "Sign in" }).click();
  await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 20000 });
  const changeForm = win.locator(".awkit-login-form");
  await changeForm.locator('input[type="password"]').nth(0).fill("Str0ng!Passw0rd");
  await changeForm.locator('input[type="password"]').nth(1).fill("Issu3r!Passw0rd9");
  await changeForm.locator('input[type="password"]').nth(2).fill("Issu3r!Passw0rd9");
  await changeForm.getByRole("button", { name: "Update password" }).click();
  await win.waitForSelector(".app-shell", { timeout: 25000 });

  // The Issuer sees only its own route — not the Super User administration pages.
  check(
    "Issuer session does not see the Super User administration nav",
    (await win.evaluate(() => [...document.querySelectorAll("button.nav-item")].some((b) => (b.textContent || "").trim() === "Users"))) === false
  );
  await nav(win, "License Issuer");
  await win.getByRole("heading", { name: "Signing readiness" }).first().waitFor({ timeout: 10000 }).catch(() => {});
  const issuerLayout = await adminLayout(win, "License Issuer");
  check(
    "License Issuer uses the shared Administration header and metric summary",
    issuerLayout?.title === "License Issuer" && issuerLayout.headerVisible && issuerLayout.noPageOverflow && issuerLayout.metricCards === 4,
    JSON.stringify(issuerLayout)
  );
  check("License Issuer shows signing readiness state", (await win.getByRole("heading", { name: "Signing readiness" }).count()) >= 1);
  check("License Issuer exposes the activation request picker", (await win.getByRole("button", { name: /Select activation request/ }).count()) === 1);
  await verifyAdminResponsive(win, "License Issuer");
  await captureAdminThemes(win, shotDir, "license-issuer");

  check("no renderer console errors overall", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await app.close().catch(() => undefined);
  cleanup();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nSuper User Admin GUI: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
