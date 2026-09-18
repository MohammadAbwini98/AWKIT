// Shared drivers for the E2E QA GUI verifiers (specs/e2e/E2E-*.md, bd awkit-xyo). Builds on
// scripts/lib/gui-verify-harness.mjs (isolated %LOCALAPPDATA%, splash-safe window resolution,
// first-run provisioning) and adds the login / sign-out / user-admin / direct-IPC steps that the
// auth, RBAC, licensing, and route-sweep suites all share. Passwords are generated in-process per
// run and never written to any file; only usernames appear in logs.
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const artifactRoot = path.join(repoRoot, "test-artifacts", "2026-07-19-e2e-qa");

/** Per-suite artifact dirs (logs + screenshots) under the assessment evidence folder. */
export function artifactDirs(suite) {
  const logs = path.join(artifactRoot, "logs");
  const shots = path.join(artifactRoot, "screenshots", suite);
  mkdirSync(logs, { recursive: true });
  mkdirSync(shots, { recursive: true });
  return { logFile: path.join(logs, `${suite}.log`), shotDir: shots };
}

/** Check collector: console + per-suite log file + exit summary (repo verifier convention). */
export function makeChecker(suite) {
  const { logFile, shotDir } = artifactDirs(suite);
  const results = [];
  const line = (text) => {
    console.log(text);
    try {
      appendFileSync(logFile, `${text}\n`, "utf8");
    } catch {
      /* evidence logging must never fail the run */
    }
  };
  line(`\n=== ${suite} — ${new Date().toISOString()} ===`);
  return {
    shotDir,
    check(name, pass, detail) {
      results.push({ name, pass: Boolean(pass), detail });
      line(`  ${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    },
    note(text) {
      line(`  · ${text}`);
    },
    summarize() {
      const passed = results.filter((r) => r.pass).length;
      line(`\n${suite}: ${passed}/${results.length} checks passed`);
      return results.length - passed;
    }
  };
}

/** Policy-compliant unique password (>=12 chars, 3+ classes), generated in-process per run. */
export function genPassword(tag) {
  return `E2e!${tag}${randomBytes(6).toString("base64url")}9a`;
}

/** Collect renderer console errors + uncaught page errors, attributable via a mutable label. */
export function watchConsole(win) {
  const errors = [];
  const state = { label: "startup" };
  win.on("console", (msg) => {
    if (msg.type() === "error") errors.push({ at: state.label, text: msg.text() });
  });
  win.on("pageerror", (err) => errors.push({ at: state.label, text: `pageerror: ${err.message}` }));
  return {
    errors,
    setLabel: (label) => {
      state.label = label;
    },
    summary: (max = 3) => errors.slice(0, max).map((e) => `[${e.at}] ${e.text}`).join(" | ")
  };
}

/** Submit the login form. Caller waits for the resulting surface (shell / forced-change / error). */
export async function loginAs(win, username, password) {
  await win.waitForSelector("#awkit-login-username", { timeout: 15000 });
  await win.fill("#awkit-login-username", username);
  await win.locator('.awkit-login-form input[type="password"]').first().fill(password);
  await win.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Sign out through the AccountMenu (avatar trigger → Sign out) and wait for the login screen. */
export async function signOut(win) {
  await win.locator(".awkit-account-trigger").click();
  await win.getByRole("menuitem", { name: "Sign out" }).click();
  await win.waitForSelector("#awkit-login-username", { timeout: 15000 });
}

/**
 * Click a left-nav item (group item or footer) by its exact visible label. Right after sign-in the
 * permission-filtered nav may not have rendered yet, so wait (bounded) for the item before clicking;
 * an item that never appears still falls through to the old silent no-op.
 */
export async function navClick(win, label) {
  await win
    .waitForFunction(
      (text) => [...document.querySelectorAll("button.nav-item")].some((b) => (b.textContent || "").trim() === text),
      label,
      { timeout: 5000 }
    )
    .catch(() => undefined);
  await win.evaluate((text) => {
    const item = [...document.querySelectorAll("button.nav-item")].find(
      (b) => (b.textContent || "").trim() === text
    );
    item?.click();
  }, label);
  await win.waitForTimeout(500);
}

/** Visible left-nav item labels (permission-filtered groups + the pinned footer). */
export async function navLabels(win) {
  return win.evaluate(() =>
    [...document.querySelectorAll("button.nav-item")]
      .map((b) => (b.textContent || "").trim())
      .filter((t) => t.length > 0)
  );
}

/** Wait for the Users page's design frame (the administration head titled "Users"). */
export async function waitForUsersPage(win, timeout = 10000) {
  await win
    .locator(".sys-admin-head")
    .getByRole("heading", { name: "Users", exact: true })
    .waitFor({ timeout })
    .catch(async (error) => {
      // Evidence for the failure: what the window showed instead of the Users page.
      mkdirSync(artifactRoot, { recursive: true });
      await win.screenshot({ path: path.join(artifactRoot, "users-page-timeout.png") }).catch(() => undefined);
      throw error;
    });
}

/** Directory rows on the Users page for a username (shown as each row's sub-line). */
export function userRows(win, username) {
  return win.locator(".users-page .sys-table tbody tr", { hasText: username });
}

/**
 * Open the Users page "Create user" dialog (unless a rejected attempt left it open), fill it and
 * submit. `roles` is the exact set of role names to check (all other role pills are unchecked).
 * Waits briefly for the IPC round-trip; a rejection keeps the dialog open with its inline error.
 */
export async function createUser(win, { username, displayName, password, roles }) {
  const form = win.locator(".users-create-modal");
  if (!(await form.isVisible())) {
    await win.locator(".sys-admin-actions").getByRole("button", { name: "Create user", exact: true }).click();
    await form.waitFor({ state: "visible", timeout: 10000 });
  }
  await form.locator("label", { hasText: "Username" }).locator("input").first().fill(username);
  if (displayName) {
    await form.locator("label", { hasText: "Display name" }).locator("input").first().fill(displayName);
  }
  await form.locator('input[type="password"]').first().fill(password);
  const options = form.locator(".sys-check-pill");
  const count = await options.count();
  for (let i = 0; i < count; i++) {
    const option = options.nth(i);
    const name = (await option.innerText()).trim();
    await option.locator('input[type="checkbox"]').setChecked(roles.includes(name));
  }
  await form.getByRole("button", { name: "Create user", exact: true }).click();
  await win.waitForTimeout(900);
}

/** Complete the forced-password-change screen. Caller waits for the resulting surface. */
export async function submitForcedChange(win, currentPassword, nextPassword, confirmPassword = nextPassword) {
  const fields = win.locator('.awkit-login-form input[type="password"]');
  await fields.nth(0).fill(currentPassword);
  await fields.nth(1).fill(nextPassword);
  await fields.nth(2).fill(confirmPassword);
  const submit = win.getByRole("button", { name: "Update password", exact: true });
  if (await submit.isEnabled()) await submit.click();
}

/**
 * Direct preload-IPC login (the desktop equivalent of direct API access): authenticates via
 * `window.playwrightFlowStudio.security.login` inside the renderer and returns the sessionRef,
 * bypassing every UI affordance. Callers MUST directLogout the ref.
 */
export async function directLogin(win, username, password) {
  return win.evaluate(async ({ u, p }) => {
    const r = await window.playwrightFlowStudio.security.login({ providerId: "local", username: u, password: p });
    return r.ok ? { ok: true, sessionRef: r.principal.sessionRef } : { ok: false, reason: r.reason };
  }, { u: username, p: password });
}

export async function directLogout(win, sessionRef) {
  if (!sessionRef) return;
  await win
    .evaluate(async (ref) => window.playwrightFlowStudio.security.logout(ref).catch(() => undefined), sessionRef)
    .catch(() => undefined);
}
