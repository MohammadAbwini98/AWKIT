// E2E-REAUTH — live ReauthDialog GUI flow in the REAL Electron app (specs/e2e/E2E-RBAC.md step 10,
// bd awkit-2d8). A DEDICATED launch with a short AWKIT_REAUTH_WINDOW_MS so a sensitive Super-User admin
// op (create user) requires a fresh re-auth once the window lapses. This verifier proves the full
// contract against observable application + audit state (never a bare timing sleep):
//   • Cancel    → the held create is dropped and applied nothing.
//   • Wrong pw  → the dialog stays open with an error, applies nothing, and writes NO success audit.
//   • Correct pw→ the dialog closes and the held create is applied EXACTLY once (no duplicate/replay).
// Exactly-once / no-replay / no-wrong-password-success are proven by baseline-delta counts of
// USER_CREATE(success) audit events plus the admin user list — not by UI text alone. Passwords are
// generated in-process and are asserted absent from console output and audit records.
//
// Kept separate from verify-e2e-rbac-gui.mjs on purpose: a globally-short reauth window would make that
// suite's multi-user seeding prompt on every createUser. Here the window is expired deliberately.
//
// Run: node scripts/verify-e2e-reauth-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";
import { repoRoot, makeChecker, genPassword, watchConsole, navClick, createUser, directLogin, directLogout } from "./lib/e2e-qa-lib.mjs";

const REAUTH_WINDOW_MS = 1000;
const { check, shotDir, summarize } = makeChecker("e2e-reauth");

// Per-run secrets — never logged; scanned for later to prove they never leak.
const pwCancel = genPassword("Cxl");
const pwTarget = genPassword("Tgt");
const pwWrong = genPassword("Bad");
const secrets = [pwCancel, pwTarget, pwWrong, DEFAULT_CREDS.password];

const { env, cleanup } = isolatedLaunchEnv("awkit-e2e-reauth", { AWKIT_REAUTH_WINDOW_MS: String(REAUTH_WINDOW_MS) });
const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env });
try {
  const win = await resolveMainWindow(app);
  const consoleWatch = watchConsole(win);
  // Collect ALL console text (not only errors) so we can prove no credential is ever printed.
  const consoleText = [];
  win.on("console", (msg) => consoleText.push(msg.text()));
  await win.waitForLoadState("domcontentloaded");
  await signInFirstRun(win); // SU provisioned + signed in — this is the last "fresh auth" before the op.
  consoleWatch.setLabel("reauth");

  await navClick(win, "Users");
  await win.getByRole("heading", { name: "Add a user" }).first().waitFor({ timeout: 10000 });

  // A SEPARATE Super-User session (direct IPC) used only for verification READS (listUsers / listAudit).
  // Reads are non-sensitive, so this session's own reauth window is irrelevant; it never drives the UI.
  const admin = await directLogin(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
  check("admin verification session (direct IPC) is available", admin.ok === true, admin.reason);

  // Snapshot observable state: the admin user list + the count of USER_CREATE success audit events.
  const snapshot = () =>
    win.evaluate(async (ref) => {
      const api = window.playwrightFlowStudio;
      const users = await api.security.admin.listUsers(ref);
      const audit = await api.security.admin.listAudit({ sessionRef: ref, limit: 500 });
      const usernames = (users.value ?? []).map((u) => u.username);
      const records = audit.value ?? [];
      return {
        usernames,
        userCount: usernames.length,
        createSuccess: records.filter((a) => a.eventType === "USER_CREATE" && a.result === "success").length,
        auditJson: JSON.stringify(records)
      };
    }, admin.sessionRef);

  const base = await snapshot();

  const dialog = win.locator(".awkit-reauth-modal");
  const dialogPassword = () => dialog.locator('input[type="password"]').first();
  const confirmButton = () => dialog.getByRole("button", { name: "Confirm", exact: true });
  const cancelButton = () => dialog.getByRole("button", { name: "Cancel", exact: true });

  // Trigger a sensitive op after letting the window lapse. The small safety wait (> the window, measured
  // from the last fresh auth) ensures expiry; the ASSERTION then waits on the observable dialog element
  // (reauth required) rather than on elapsed time alone.
  const triggerCreateExpectingReauth = async (username, password) => {
    await win.waitForTimeout(REAUTH_WINDOW_MS + 400);
    await createUser(win, { username, displayName: "Reauth Target", password, roles: ["Operator"] });
    await dialog.waitFor({ state: "visible", timeout: 10000 });
  };

  // ── Case A — CANCEL: the held create must be dropped and apply nothing ────────────────────────────
  const cancelUser = "reauth-cancelled";
  await triggerCreateExpectingReauth(cancelUser, pwCancel);
  check("cancel: sensitive create prompts the ReauthDialog after the window lapses", (await dialog.count()) === 1);
  const heldA = await snapshot();
  check(
    "cancel: pending action is held (user absent + no new USER_CREATE success audit)",
    !heldA.usernames.includes(cancelUser) && heldA.createSuccess === base.createSuccess
  );
  await cancelButton().click();
  await dialog.waitFor({ state: "detached", timeout: 8000 }).catch(() => undefined);
  check("cancel: closes the ReauthDialog", (await dialog.count()) === 0);
  const afterCancel = await snapshot();
  check(
    "cancel: applied nothing (user absent, user count unchanged, no new create audit)",
    !afterCancel.usernames.includes(cancelUser) &&
      afterCancel.userCount === base.userCount &&
      afterCancel.createSuccess === base.createSuccess
  );

  // ── Case B — WRONG then CORRECT: apply exactly once, nothing on the wrong attempt ─────────────────
  const targetUser = "reauth-applied";
  await triggerCreateExpectingReauth(targetUser, pwTarget);
  check("apply: sensitive create prompts the ReauthDialog", (await dialog.count()) === 1);
  check(
    "apply: ReauthDialog shows the confirm-password heading",
    (await win.getByRole("heading", { name: "Confirm your password" }).count()) === 1
  );
  // Screenshot the empty dialog (no password entered → nothing sensitive on screen).
  await win.screenshot({ path: path.join(shotDir, "reauth-dialog.png") }).catch(() => undefined);
  const heldB = await snapshot();
  check(
    "apply: pending action is held (target absent + no new USER_CREATE success before reauth)",
    !heldB.usernames.includes(targetUser) && heldB.createSuccess === base.createSuccess
  );

  // (a) WRONG password — dialog stays open with an error, applies nothing, writes NO success audit.
  await dialogPassword().fill(pwWrong);
  await confirmButton().click();
  await dialog.locator(".form-message.error").waitFor({ state: "visible", timeout: 6000 }).catch(() => undefined);
  check("wrong password: keeps the ReauthDialog open", (await dialog.count()) === 1);
  check("wrong password: surfaces an error inside the dialog", (await dialog.locator(".form-message.error").count()) === 1);
  const afterWrong = await snapshot();
  check("wrong password: applied nothing (target still absent)", !afterWrong.usernames.includes(targetUser));
  check("wrong password: wrote NO USER_CREATE success audit event", afterWrong.createSuccess === base.createSuccess);

  // (b) CORRECT password — dialog closes, the held create is retried and applied exactly once.
  await dialogPassword().fill(DEFAULT_CREDS.password);
  await confirmButton().click();
  await dialog.waitFor({ state: "detached", timeout: 10000 }).catch(() => undefined);
  check("correct password: closes the ReauthDialog", (await dialog.count()) === 0);
  // Poll on observable applied state (the created user appears) rather than a fixed wait.
  await win.getByText(`@${targetUser}`).first().waitFor({ timeout: 10000 }).catch(() => undefined);
  const afterCorrect = await snapshot();
  check(
    "correct password: applied the held create — target user exists EXACTLY once",
    afterCorrect.usernames.filter((u) => u === targetUser).length === 1
  );
  check(
    "correct password: EXACTLY one new USER_CREATE success audit (applied once, no replay)",
    afterCorrect.createSuccess === base.createSuccess + 1
  );
  check(
    "no unrelated/queued action replayed (only the target added; the cancelled create never ran)",
    afterCorrect.userCount === base.userCount + 1 && !afterCorrect.usernames.includes(cancelUser)
  );
  await win.screenshot({ path: path.join(shotDir, "reauth-applied.png") }).catch(() => undefined);

  // ── Credential-leak proofs (#7): no password in console output or in audit records ────────────────
  check(
    "no password appears in renderer console output",
    !consoleText.some((t) => secrets.some((s) => s && t.includes(s)))
  );
  check(
    "no password appears in audit records",
    !secrets.some((s) => s && afterCorrect.auditJson.includes(s))
  );
  check("zero renderer console errors during the reauth flow", consoleWatch.errors.length === 0, consoleWatch.summary());

  await directLogout(win, admin.sessionRef);
} finally {
  await app.close().catch(() => undefined);
  cleanup();
}

process.exit(summarize() > 0 ? 1 : 0);
