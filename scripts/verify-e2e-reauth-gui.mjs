// E2E-REAUTH — live ReauthDialog GUI flow in the REAL Electron app (specs/e2e/E2E-RBAC.md step 10,
// bd awkit-2d8). A DEDICATED launch with a short AWKIT_REAUTH_WINDOW_MS so a sensitive Super-User admin
// op (create user) requires a fresh re-auth once the window lapses: the real ReauthDialog appears, a
// WRONG password keeps it open with an error (and the pending action does NOT apply), and the CORRECT
// password confirms → the dialog closes → the held create is retried + applied.
//
// Kept separate from verify-e2e-rbac-gui.mjs on purpose: a globally-short reauth window would make that
// suite's multi-user seeding prompt on every createUser. Here the window is expired deliberately, once.
//
// Run: node scripts/verify-e2e-reauth-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";
import { repoRoot, makeChecker, genPassword, watchConsole, navClick, createUser } from "./lib/e2e-qa-lib.mjs";

const REAUTH_WINDOW_MS = 1000;
const { check, shotDir, summarize } = makeChecker("e2e-reauth");

const { env, cleanup } = isolatedLaunchEnv("awkit-e2e-reauth", { AWKIT_REAUTH_WINDOW_MS: String(REAUTH_WINDOW_MS) });
const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env });
try {
  const win = await resolveMainWindow(app);
  const consoleWatch = watchConsole(win);
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win); // SU provisioned + signed in — this is the last "fresh auth" before the op.
  consoleWatch.setLabel("reauth");

  await navClick(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 10000 });

  // Let the sensitive-op reauth window lapse (measured from the first-run login above). Navigation and
  // reads do not refresh it — only a login / a successful reauth do — so the next sensitive op prompts.
  await win.waitForTimeout(REAUTH_WINDOW_MS + 600);

  // Trigger a sensitive op: create a user. With the window lapsed the backend returns REAUTH_REQUIRED
  // (security:admin:createUser runs adminCall(..., sensitive=true)), and UserManagement holds the create
  // behind the ReauthDialog, retrying it once after a good reauth.
  const newUser = "reauthee";
  await createUser(win, { username: newUser, displayName: "Reauth Target", password: genPassword("Rt"), roles: ["Operator"] });

  const dialog = win.locator(".awkit-reauth-modal");
  check("sensitive create prompts the ReauthDialog after the window lapses", (await dialog.count()) === 1);
  check(
    "ReauthDialog shows the confirm-password heading",
    (await win.getByRole("heading", { name: "Confirm your password" }).count()) === 1
  );
  await win.screenshot({ path: path.join(shotDir, "reauth-dialog.png") }).catch(() => undefined);
  // The pending create must be held behind the reauth — the user must not exist yet.
  check("pending sensitive action is held (user not created before reauth)", (await win.getByText(`@${newUser}`).count()) === 0);

  const dialogPassword = () => dialog.locator('input[type="password"]').first();
  const confirmButton = () => dialog.getByRole("button", { name: "Confirm", exact: true });

  // (a) WRONG password keeps the dialog open with an error, and still applies nothing.
  await dialogPassword().fill(genPassword("Wrong"));
  await confirmButton().click();
  await win.waitForTimeout(700);
  check("wrong password keeps the ReauthDialog open", (await dialog.count()) === 1);
  check("wrong password surfaces an error inside the dialog", (await dialog.locator(".form-message.error").count()) === 1);
  check("wrong password did not apply the pending action", (await win.getByText(`@${newUser}`).count()) === 0);

  // (b) CORRECT password confirms → dialog closes → the held create is retried and applied.
  await dialogPassword().fill(DEFAULT_CREDS.password);
  await confirmButton().click();
  await win.waitForSelector(".awkit-reauth-modal", { state: "detached", timeout: 10000 }).catch(() => undefined);
  check("correct password closes the ReauthDialog", (await dialog.count()) === 0);
  await win.getByText(`@${newUser}`).first().waitFor({ timeout: 8000 }).catch(() => undefined);
  check("correct password applied the pending action (user created)", (await win.getByText(`@${newUser}`).count()) >= 1);
  await win.screenshot({ path: path.join(shotDir, "reauth-applied.png") }).catch(() => undefined);

  check("zero renderer console errors during the reauth flow", consoleWatch.errors.length === 0, consoleWatch.summary());
} finally {
  await app.close().catch(() => undefined);
  cleanup();
}

process.exit(summarize() > 0 ? 1 : 0);
