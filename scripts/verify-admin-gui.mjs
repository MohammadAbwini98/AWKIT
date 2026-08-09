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

async function adminLayout(win, expectedTitle) {
  return win.evaluate((title) => {
    const page = document.querySelector(".awkit-admin-page");
    const header = page?.querySelector(".awkit-admin-header");
    const heading = header?.querySelector("h1");
    if (!page || !header || !heading) return null;
    const rect = page.getBoundingClientRect();
    const main = document.querySelector(".main-surface");
    const mainRect = main?.getBoundingClientRect();
    return {
      title: heading.textContent?.trim(),
      expectedTitle: title,
      fillsSurface: Boolean(mainRect && rect.width >= mainRect.width - 34),
      noPageOverflow: page.scrollWidth <= page.clientWidth + 1,
      summaryItems: page.querySelectorAll(".awkit-admin-summary-item").length
    };
  }, expectedTitle);
}

async function captureAdminThemes(win, shotDir, slug) {
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.evaluate(() => {
    document.querySelector(".main-surface")?.scrollTo({ top: 0, left: 0 });
    document.querySelector(".awkit-admin-page")?.scrollTo({ top: 0, left: 0 });
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
      const page = document.querySelector(".awkit-admin-page");
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
          [...page.querySelectorAll(".awkit-admin-table-scroll")].every((scroller) => scroller.scrollWidth >= scroller.clientWidth)
      };
    }, viewport));
  }
  check(`${label} remains contained at 1024, 1280, 1440, and 1920 widths`, observations.every((item) => item.valid), JSON.stringify(observations));
  await win.setViewportSize({ width: 1440, height: 900 });
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
  const shotDir = path.join(root, "reports", "security-admin");
  mkdirSync(shotDir, { recursive: true });

  // The protected Super User sees the Administration group.
  const adminNav = await win.evaluate(() => [...document.querySelectorAll("button.nav-item")].some((b) => (b.textContent || "").trim() === "Users"));
  check("Administration nav is visible to the Super User", adminNav);

  // ── Users page ───────────────────────────────────────────────────────────────
  await nav(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 10000 }).catch(() => {});
  check("Users page renders the create-user card", (await win.getByRole("heading", { name: "Add a user" }).count()) >= 1);
  check("existing Super User is listed", (await win.getByText("@guiverifier").count()) >= 1);
  const usersLayout = await adminLayout(win, "Users");
  check("Users uses the shared Administration header and full-width surface", usersLayout?.title === "Users" && usersLayout.fillsSurface && usersLayout.noPageOverflow && usersLayout.summaryItems === 3, JSON.stringify(usersLayout));

  // Create a Viewer user (fresh first-run login counts as a fresh reauth → no prompt).
  await win.locator(".awkit-admin-create-form input").first().fill("viewer1");
  await win.locator('.awkit-admin-create-form input[type="password"]').first().fill("V1ewer!Pass9");
  await win.getByRole("button", { name: "Create user", exact: true }).click();
  await win.waitForTimeout(900);
  check("newly created user appears in the list", (await win.getByText("@viewer1").count()) >= 1);
  check("no renderer console errors on Users", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

  await verifyAdminResponsive(win, "Users");
  await captureAdminThemes(win, shotDir, "users");

  // ── Roles / Permissions / Audit / Licensing ─────────────────────────────────
  await nav(win, "Roles");
  check("Roles page lists the Super User role", (await win.getByRole("heading", { name: "Super User" }).count()) >= 1);
  const rolesLayout = await adminLayout(win, "Roles");
  check("Roles uses the shared Administration header and summary", rolesLayout?.title === "Roles" && rolesLayout.noPageOverflow && rolesLayout.summaryItems === 3, JSON.stringify(rolesLayout));

  const roleForm = win.locator(".settings-card", { has: win.getByRole("heading", { name: "Add a custom role" }) });
  await roleForm.locator("input").first().fill("QA Runner");
  await roleForm.locator("label", { hasText: "workflow.execute" }).locator('input[type="checkbox"]').check();
  await roleForm.getByRole("button", { name: "Create role" }).click();
  await win.getByRole("heading", { name: "QA Runner", exact: true }).waitFor({ timeout: 10000 });
  check("custom role can be created from the Roles page", true);
  const createdRoleCard = win.locator(".settings-card", { has: win.getByRole("heading", { name: "QA Runner", exact: true }) });
  await createdRoleCard.getByRole("button", { name: "Edit" }).click();
  const roleEditor = win.locator(".awkit-admin-role-modal");
  await roleEditor.locator("label", { hasText: "workflow.stop" }).locator('input[type="checkbox"]').check();
  await roleEditor.getByRole("button", { name: "Save role" }).click();
  await win.waitForTimeout(900);
  check("custom role permissions can be edited", (await createdRoleCard.getByText("workflow.stop", { exact: true }).count()) === 1);
  await verifyAdminResponsive(win, "Roles");
  await captureAdminThemes(win, shotDir, "roles");

  await nav(win, "Permissions");
  check("Permissions matrix renders", (await win.getByRole("heading", { name: "Permission matrix" }).count()) >= 1);
  check("custom role appears in the permission matrix", (await win.getByRole("columnheader", { name: "QA Runner" }).count()) === 1);
  check("Permissions are organized into named capability groups", (await win.locator(".awkit-admin-matrix-group").count()) >= 4);
  const permissionMatrixLayout = await win.evaluate(() => {
    const surface = document.querySelector(".awkit-admin-primary-surface");
    const scroller = document.querySelector(".awkit-admin-table-scroll");
    const table = document.querySelector(".awkit-admin-matrix");
    if (!surface || !scroller || !table) return null;
    return {
      surfaceWidth: surface.getBoundingClientRect().width,
      scrollerWidth: scroller.getBoundingClientRect().width,
      tableWidth: table.getBoundingClientRect().width
    };
  });
  check(
    "Permissions matrix uses the available Administration content width",
    permissionMatrixLayout && permissionMatrixLayout.tableWidth >= permissionMatrixLayout.surfaceWidth - 2,
    JSON.stringify(permissionMatrixLayout)
  );
  await verifyAdminResponsive(win, "Permissions");
  await captureAdminThemes(win, shotDir, "permissions");

  await nav(win, "Users");
  const viewerRow = win.locator("tr", { hasText: "@viewer1" }).first();
  await viewerRow.getByRole("button", { name: "Roles" }).click();
  const accessModal = win.locator(".awkit-admin-role-modal");
  await accessModal.locator("label", { hasText: "QA Runner" }).locator('input[type="checkbox"]').check();
  await accessModal.getByLabel("workflow.execute override").selectOption("deny");
  await accessModal.getByRole("button", { name: "Save access" }).click();
  await win.waitForTimeout(900);
  check("custom role assignment appears on the user", (await viewerRow.getByText("QA Runner").count()) === 1);
  await viewerRow.getByRole("button", { name: "Roles" }).click();
  check(
    "direct deny override persists in the access editor",
    await win.locator(".awkit-admin-role-modal").getByLabel("workflow.execute override").inputValue() === "deny"
  );
  await win.keyboard.press("Escape");
  check("access editor closes with Escape and returns focus", (await win.locator(".awkit-admin-role-modal").count()) === 0 && await viewerRow.getByRole("button", { name: "Roles" }).evaluate((button) => button === document.activeElement));

  await nav(win, "Roles");
  const customRoleCard = win.locator(".settings-card", { has: win.getByRole("heading", { name: "QA Runner", exact: true }) });
  await customRoleCard.getByRole("button", { name: "Delete" }).click();
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
  await win.getByRole("heading", { name: "License status" }).first().waitFor({ timeout: 10000 }).catch(() => {});
  check("Licensing page renders the license status card", (await win.getByRole("heading", { name: "License status" }).count()) >= 1);
  check("Licensing shows the not-activated state on a fresh profile", (await win.getByText("Not activated").count()) >= 1);
  const licensingLayout = await adminLayout(win, "Licensing");
  check("Licensing uses the shared Administration header and dashboard summary", licensingLayout?.title === "Licensing" && licensingLayout.noPageOverflow && licensingLayout.summaryItems === 3, JSON.stringify(licensingLayout));
  await verifyAdminResponsive(win, "Licensing");
  await captureAdminThemes(win, shotDir, "licensing");

  check("no renderer console errors overall", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await app.close().catch(() => undefined);
  cleanup();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nSuper User Admin GUI: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
