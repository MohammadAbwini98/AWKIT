// E2E-AUTH — authentication lifecycle against the REAL Electron app (specs/e2e/E2E-AUTH.md,
// bd awkit-xyo). Two isolated launches: (1) first-run validation → SU provisioning → user admin
// (weak/duplicate/double-click create) → wrong/unknown/temp logins → forced password change
// (mismatch/policy/success) → old-vs-new password → disable/enable → reset-password cycle;
// (2) a short-idle launch proving the proactive inactivity lock (AWKIT_SESSION_IDLE_MS).
// Passwords are generated in-process per run and never persisted.
//
// Run: node scripts/verify-e2e-auth-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow } from "./lib/gui-verify-harness.mjs";
import {
  repoRoot,
  makeChecker,
  genPassword,
  watchConsole,
  loginAs,
  signOut,
  navClick,
  createUser,
  submitForcedChange
} from "./lib/e2e-qa-lib.mjs";

const { check, note, shotDir, summarize } = makeChecker("e2e-auth");

const SU = { display: "E2E Super User", username: "e2esu", password: genPassword("Su") };
const OP = { username: "opuser", temp: genPassword("Tmp"), final: genPassword("Op"), temp2: genPassword("Rst") };

const onLoginScreen = async (win) => (await win.locator("#awkit-login-username").count()) > 0;
const onShell = async (win) => (await win.locator(".app-shell").count()) > 0;
const onForcedChange = async (win) =>
  (await win.getByRole("heading", { name: "Update your password" }).count()) > 0;
const loginError = async (win) => (await win.locator(".form-message.error").innerText().catch(() => "")).trim();

// ── Launch 1: full lifecycle on a fresh profile ────────────────────────────────
{
  const { env, cleanup } = isolatedLaunchEnv("awkit-e2e-auth");
  const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env });
  try {
    const win = await resolveMainWindow(app);
    const consoleWatch = watchConsole(win);
    await win.waitForLoadState("domcontentloaded");
    await win.waitForSelector(".awkit-login-card", { timeout: 20000 });

    // 1 — first-run: mismatched confirm password is blocked client-side (no account created).
    consoleWatch.setLabel("first-run validation");
    await win.fill("#awkit-setup-display", SU.display);
    await win.fill("#awkit-setup-username", SU.username);
    const setupPw = win.locator('.awkit-login-form input[type="password"]');
    await setupPw.nth(0).fill(SU.password);
    await setupPw.nth(1).fill(`${SU.password}-mismatch`);
    const mismatchMsg = await win.getByText("Passwords do not match.").count();
    const createBtn = win.getByRole("button", { name: "Create account" });
    check("first-run: mismatched confirm shows a field error", mismatchMsg >= 1);
    check("first-run: mismatched confirm blocks submission", await createBtn.isDisabled());
    check("first-run: no account created (still on setup)", !(await onShell(win)));

    // 2 — weak password rejected by the trusted-layer policy (still gated).
    await setupPw.nth(0).fill("short");
    await setupPw.nth(1).fill("short");
    await createBtn.click();
    await win.waitForTimeout(700);
    const policyErrors = await win.locator(".awkit-login-errors li").count();
    const inlineError = await win.locator(".form-message.error").count();
    check("first-run: weak password rejected with policy errors", policyErrors >= 1 || inlineError >= 1);
    check("first-run: weak password leaves the app gated", !(await onShell(win)));

    // 3 — valid SU credentials provision + auto sign-in; avatar/account chip present.
    await setupPw.nth(0).fill(SU.password);
    await setupPw.nth(1).fill(SU.password);
    await createBtn.click();
    await win.waitForSelector(".app-shell", { timeout: 25000 });
    check("first-run: valid credentials auto sign in (shell mounts)", true);
    const avatarInitials = (await win.locator(".awkit-account-trigger").innerText().catch(() => "")).trim();
    check("account chip shows the signed-in identity", avatarInitials.includes(SU.display), avatarInitials);
    await win.screenshot({ path: path.join(shotDir, "01-su-shell.png") }).catch(() => undefined);

    // 4 — create user with a weak temp password → rejected, absent from the list.
    consoleWatch.setLabel("user admin");
    await navClick(win, "Users");
    await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 10000 });
    await createUser(win, { username: OP.username, password: "weakpw", roles: ["Operator"] });
    check("admin: weak temp password rejected with a message", (await win.locator(".form-message.error").count()) >= 1);
    check("admin: rejected user is absent from the list", (await win.getByText(`@${OP.username}`).count()) === 0);

    // 5 — compliant create with a DOUBLE-CLICK on Create user → exactly one row (no duplicate).
    const form = win.locator(".awkit-admin-create-form");
    await form.locator("label", { hasText: "Username" }).locator("input").first().fill(OP.username);
    await form.locator('input[type="password"]').first().fill(OP.temp);
    const options = form.locator(".awkit-admin-role-option");
    const optionCount = await options.count();
    for (let i = 0; i < optionCount; i++) {
      const option = options.nth(i);
      const name = (await option.innerText()).trim();
      await option.locator('input[type="checkbox"]').setChecked(name === "Operator");
    }
    await form.getByRole("button", { name: "Create user", exact: true }).dblclick();
    await win.waitForTimeout(1200);
    const opRows = await win.locator("tr", { hasText: `@${OP.username}` }).count();
    check("admin: double-clicked create yields exactly one user row", opRows === 1, `rows=${opRows}`);
    const opRow = win.locator("tr", { hasText: `@${OP.username}` }).first();
    check("admin: new user carries the must-reset badge", (await opRow.getByText("must reset").count()) >= 1);
    await win.screenshot({ path: path.join(shotDir, "02-user-created.png") }).catch(() => undefined);

    // 6 — duplicate username rejected; list unchanged.
    await createUser(win, { username: OP.username, password: genPassword("Dup"), roles: ["Operator"] });
    check("admin: duplicate username rejected with a message", (await win.locator(".form-message.error").count()) >= 1);
    check("admin: duplicate create leaves one row", (await win.locator("tr", { hasText: `@${OP.username}` }).count()) === 1);

    // 7 — sign out via the AccountMenu returns to login.
    await signOut(win);
    check("sign-out returns to the login screen", await onLoginScreen(win));

    // 8/9 — wrong password and unknown user produce the SAME generic error (no enumeration).
    consoleWatch.setLabel("login failures");
    await loginAs(win, OP.username, `${OP.temp}-wrong`);
    await win.waitForTimeout(700);
    const wrongPwError = await loginError(win);
    check("login: wrong password rejected with an error", wrongPwError.length > 0 && !(await onShell(win)), wrongPwError);
    await loginAs(win, "ghost", genPassword("Gh"));
    await win.waitForTimeout(700);
    const unknownUserError = await loginError(win);
    check("login: unknown user gets the SAME generic error (no enumeration)", unknownUserError === wrongPwError, unknownUserError);

    // 10 — temp-password login lands on ForcedPasswordChange, never the shell.
    await loginAs(win, OP.username, OP.temp);
    await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 15000 });
    check("temp login reaches forced password change (not the shell)", !(await onShell(win)));
    await win.screenshot({ path: path.join(shotDir, "03-forced-change.png") }).catch(() => undefined);

    // 11 — mismatched new passwords block submission (still gated).
    consoleWatch.setLabel("forced change");
    await submitForcedChange(win, OP.temp, OP.final, `${OP.final}-x`);
    check("forced change: mismatch shows the error", (await win.getByText("Passwords do not match.").count()) >= 1);
    check("forced change: mismatch keeps the gate", await onForcedChange(win));

    // 12 — non-compliant new password rejected by policy (still gated).
    await submitForcedChange(win, OP.temp, "shortpw1");
    await win.waitForTimeout(700);
    check(
      "forced change: weak new password rejected with policy errors",
      (await win.locator(".awkit-login-errors li").count()) >= 1 || (await win.locator(".form-message.error").count()) >= 1
    );
    check("forced change: weak new password keeps the gate", await onForcedChange(win));

    // 13 — compliant new password admits the user to the shell.
    await submitForcedChange(win, OP.temp, OP.final);
    await win.waitForSelector(".app-shell", { timeout: 20000 });
    check("forced change: compliant password reaches the shell", true);

    // 15 — the retired temp password fails; the new one works.
    await signOut(win);
    await loginAs(win, OP.username, OP.temp);
    await win.waitForTimeout(700);
    check("old temp password is rejected after the change", (await loginError(win)).length > 0 && !(await onShell(win)));
    await loginAs(win, OP.username, OP.final);
    await win.waitForSelector(".app-shell", { timeout: 20000 });
    check("new password signs in", true);

    // 16 — SU disables the account → login refused.
    consoleWatch.setLabel("disable/reset cycle");
    await signOut(win);
    await loginAs(win, SU.username, SU.password);
    await win.waitForSelector(".app-shell", { timeout: 20000 });
    await navClick(win, "Users");
    const row = () => win.locator("tr", { hasText: `@${OP.username}` }).first();
    await row().getByRole("button", { name: "Disable", exact: true }).click();
    await win.waitForTimeout(900);
    check("admin: disable updates the status badge", (await row().getByText("Disabled").count()) >= 1);
    await signOut(win);
    await loginAs(win, OP.username, OP.final);
    await win.waitForTimeout(700);
    check("disabled account cannot sign in", (await loginError(win)).length > 0 && !(await onShell(win)));

    // 17 — SU re-enables + resets the password → the user is forced to change again.
    await loginAs(win, SU.username, SU.password);
    await win.waitForSelector(".app-shell", { timeout: 20000 });
    await navClick(win, "Users");
    await row().getByRole("button", { name: "Enable", exact: true }).click();
    await win.waitForTimeout(900);
    await row().getByRole("button", { name: "Reset password", exact: true }).click();
    const modal = win.locator(".awkit-admin-modal");
    await modal.waitFor({ timeout: 8000 });
    await modal.locator('input[type="password"]').first().fill(OP.temp2);
    await modal.getByRole("button", { name: "Reset password", exact: true }).click();
    await win.waitForTimeout(900);
    await signOut(win);
    await loginAs(win, OP.username, OP.temp2);
    await win.getByRole("heading", { name: "Update your password" }).waitFor({ timeout: 15000 });
    check("reset password forces a change at the next sign-in", await onForcedChange(win));

    // 18 — zero renderer console errors across the whole lifecycle.
    check("zero renderer console errors (whole run)", consoleWatch.errors.length === 0, consoleWatch.summary());
  } finally {
    await app.close().catch(() => undefined);
    cleanup();
  }
}

// ── Launch 2: proactive idle lock (spec step 14) on its own short-idle profile ─
{
  const { env, cleanup } = isolatedLaunchEnv("awkit-e2e-auth-idle", { AWKIT_SESSION_IDLE_MS: "4000" });
  const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env });
  try {
    const win = await resolveMainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    await win.waitForSelector(".awkit-login-card", { timeout: 20000 });
    await win.fill("#awkit-setup-display", SU.display);
    await win.fill("#awkit-setup-username", SU.username);
    const pw = win.locator('.awkit-login-form input[type="password"]');
    await pw.nth(0).fill(SU.password);
    await pw.nth(1).fill(SU.password);
    await win.getByRole("button", { name: "Create account" }).click();
    await win.waitForSelector(".app-shell", { timeout: 25000 });

    // No input from here: the proactive lock must fire on its own.
    await win.waitForSelector("#awkit-login-username", { timeout: 15000 });
    check("idle lock returns to the login screen without any focus event", true);
    const notice = (await win.locator(".awkit-login-notice").innerText().catch(() => "")).trim();
    check("idle lock shows the inactivity notice", /inactivity/i.test(notice), notice);
  } catch (error) {
    check("idle lock returns to the login screen without any focus event", false, String(error));
  } finally {
    await app.close().catch(() => undefined);
    cleanup();
  }
}

note("Spec step 14 runs as a dedicated second launch so the 4s idle window cannot interrupt steps 1–13.");
process.exit(summarize() > 0 ? 1 : 0);
