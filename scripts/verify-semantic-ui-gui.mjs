/**
 * Semantic UI — real Electron GUI verification (awkit-0jp).
 *
 * Proves the renderer surface added for the semantic index actually exists and is gated, in a real
 * Electron window with a real security kernel. What it pins:
 *
 *   • the Semantic Search nav item and page render for a permitted role;
 *   • a Viewer — who holds NO semantic permission — cannot see the nav item at all;
 *   • Settings → Semantic Index renders health, and its maintenance controls follow the permission;
 *   • none of the above logs a renderer error.
 *
 * The Viewer check is the one worth having. `RoutePermissions` treats an unregistered route as
 * visible to every signed-in user, so the failure mode here is an OPEN page, not a locked one, and a
 * source-only assertion cannot tell you what the nav actually rendered.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";
import { createUser, genPassword, loginAs, makeChecker, navClick, navLabels, signOut, submitForcedChange, watchConsole } from "./lib/e2e-qa-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { check, note, summarize, shotDir } = makeChecker("semantic-ui-gui");

const { env, dataRoot, cleanup } = isolatedLaunchEnv("awkit-semantic-ui-gui");
const userDataDir = path.join(dataRoot, "electron-userdata");

const NAV_LABEL = "Semantic Search";

async function launch() {
  const app = await electron.launch({ args: [root, `--user-data-dir=${userDataDir}`], cwd: root, env });
  const win = await resolveMainWindow(app);
  const console_ = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  return { app, win, console_ };
}

const shot = async (win, name) => {
  await win.screenshot({ path: path.join(shotDir, name) }).catch(() => undefined);
};

let app;
let win;
let console_;

try {
  ({ app, win, console_ } = await launch());
  console_.setLabel("first-run super user");
  await signInFirstRun(win);
  await win.waitForTimeout(400);

  // ── Super User: the page exists and renders ────────────────────────────────────────────────
  const superUserNav = await navLabels(win);
  check(`Super User sees the "${NAV_LABEL}" nav item`, superUserNav.includes(NAV_LABEL), superUserNav.join(", "));

  await navClick(win, NAV_LABEL);
  await win.waitForTimeout(500);

  // Assert the page actually mounted, not merely that a click was dispatched — `navClick` uses
  // optional chaining, so clicking a missing item is a silent no-op.
  const heading = await win.getByRole("heading", { name: NAV_LABEL }).first().isVisible().catch(() => false);
  check("the Semantic Search page renders its heading", heading);
  check("the query form is present", (await win.locator(".semantic-query-form").count()) === 1);
  check("all three query modes are offered to a Super User", (await win.locator(".semantic-mode-row button").count()) === 3);
  check("the kind filter renders for the default Search mode", (await win.locator(".semantic-kind-filter").count()) === 1);

  // The empty state must be distinguishable from a failure: a fresh profile has no index yet, and
  // "nothing searched" is not an error.
  const emptyText = await win.locator(".empty-state").first().innerText().catch(() => "");
  check("an unsearched page shows a neutral empty state, not an error", /nothing searched/i.test(emptyText), emptyText.slice(0, 80));
  await shot(win, "01-semantic-search-page.png");

  // ── Settings → Semantic Index ──────────────────────────────────────────────────────────────
  console_.setLabel("settings panel");
  await navClick(win, "Settings");
  await win.waitForTimeout(600);
  const panel = win.locator(".settings-card").filter({ hasText: "Semantic Index" }).first();
  check("Settings shows the Semantic Index panel", (await panel.count()) === 1);
  check("the panel reports a health status", (await panel.locator(".semantic-health-dot").count()) >= 1);
  check("a managing role sees Rebuild", (await panel.getByRole("button", { name: /Rebuild Index/ }).count()) === 1);
  check("a managing role sees Clear", (await panel.getByRole("button", { name: /Clear Index/ }).count()) === 1);
  // Scroll it into view before capturing: the panel sits well below the fold, so an unscrolled
  // screenshot is evidence of the top of Settings, not of the thing being asserted.
  await panel.scrollIntoViewIfNeeded().catch(() => undefined);
  await win.waitForTimeout(300);
  await shot(win, "02-settings-semantic-index.png");

  // ── Create a Viewer, then verify the surface is absent for it ──────────────────────────────
  console_.setLabel("viewer setup");
  await navClick(win, "Users");
  await win.waitForTimeout(600);
  const viewerUser = `viewer_${Date.now().toString(36)}`;
  const viewerTemp = genPassword("Vw");
  await createUser(win, { username: viewerUser, displayName: "Semantic Viewer", password: viewerTemp, roles: ["Viewer"] });
  await signOut(win);
  await win.waitForTimeout(400);

  const viewerFinal = genPassword("Vw2");
  await loginAs(win, viewerUser, viewerTemp);
  await win.waitForTimeout(600);
  // Admin-created accounts must change password on first login.
  if ((await win.locator('.awkit-login-form input[type="password"]').count()) >= 3) {
    await submitForcedChange(win, viewerTemp, viewerFinal);
    await win.waitForTimeout(800);
  }

  console_.setLabel("viewer");
  const viewerNav = await navLabels(win);
  // Guard the guard: if the nav rendered nothing at all, "absent" would pass for the wrong reason.
  check("the Viewer's navigation rendered at all", viewerNav.length > 0, `${viewerNav.length} items`);
  check(`a Viewer does NOT see "${NAV_LABEL}"`, !viewerNav.includes(NAV_LABEL), viewerNav.join(", "));
  await shot(win, "03-viewer-nav.png");

  const viewerErrors = console_.errors.filter((e) => e.at === "viewer");
  check("the Viewer session logged no renderer error", viewerErrors.length === 0, console_.summary());

  note(`nav labels seen by Viewer: ${viewerNav.join(", ")}`);

  const relevantErrors = console_.errors.filter((e) => !/Autofill|DevTools/i.test(e.text));
  check("no renderer errors across the semantic journeys", relevantErrors.length === 0, console_.summary());
} finally {
  await app?.close().catch(() => undefined);
  cleanup?.();
}

const failed = summarize();
process.exit(failed === 0 ? 0 : 1);
