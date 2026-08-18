// Shared harness for the real-Electron GUI verifiers (see bd awkit-gmn).
//
// Two facts about the app broke every `_electron` + `app.firstWindow()` GUI verifier at once:
//   1. A branding-splash BrowserWindow is shown first and has NO `window.playwrightFlowStudio`
//      preload bridge, so `app.firstWindow()` can return the splash — which then self-closes,
//      leaving the test holding a dead page ("Target page, context or browser has been closed").
//   2. PR #15's SecurityGate mounts ONLY the sign-in surface until authenticated — the real
//      <App/> shell (nav items, routes, canvases) never mounts pre-auth.
//
// `resolveMainWindow(app)` handles (1); `signInFirstRun(win)` handles (2) by driving the
// clean-machine first-run against an ISOLATED, empty %LOCALAPPDATA% (so it is always first-run and
// never touches the developer's real profile). Reference implementation proven in
// scripts/verify-reports-gui.mjs.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Default first-run credentials. The password satisfies the policy (>=12 chars, 3 of 4 classes).
 */
export const DEFAULT_CREDS = Object.freeze({
  displayName: "GUI Verifier",
  username: "guiverifier",
  password: "Str0ng!Passw0rd"
});

/**
 * Build a launch env pointed at a fresh, isolated %LOCALAPPDATA% temp dir. Returns the env (with
 * ELECTRON_RUN_AS_NODE stripped so Electron boots as a GUI app), the data root, and a cleanup fn.
 * @param {string} [label] short slug used in the temp dir name.
 * @param {Record<string,string>} [extraEnv] extra env vars to merge in.
 */
export function isolatedLaunchEnv(label = "awkit-gui", extraEnv = {}) {
  const dataRoot = mkdtempSync(path.join(tmpdir(), `${label}-`));
  // AWKIT_TEST_LICENSE_BYPASS: licensing enforcement is ON by default since 2026-07-29 (awkit-1cc),
  // and an isolated profile is by construction a FRESH install — which gets no migration window — so
  // without this every GUI verifier that runs a real workflow would be refused at the run gate. The
  // variable is read only when `app.isPackaged` is false, so it cannot weaken a shipped build.
  // `extraEnv` is spread last so a suite that is testing licensing can delete or override it.
  const env = { ...process.env, LOCALAPPDATA: dataRoot, AWKIT_TEST_LICENSE_BYPASS: "1", ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE; // GUI app, not plain Node
  return {
    env,
    dataRoot,
    cleanup() {
      // `force: true` swallows ENOENT but NOT the Windows file-lock errors, and Electron does not
      // release every handle under the profile the instant `app.close()` resolves. A bare rmSync
      // therefore throws EPERM intermittently — which aborted the calling suite mid-run and made it
      // report a partial result (12/13) that read exactly like a product regression.
      //
      // `maxRetries` is Node's own bounded retry for precisely this set (EBUSY, EMFILE, ENFILE,
      // ENOTEMPTY, EPERM) with a linear backoff, so no hand-rolled loop and no fixed sleep. Shared
      // harness code, so this covers every GUI verifier rather than the one where it was noticed.
      rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  };
}

/**
 * The launch splash has no preload bridge, so app.firstWindow() can return it (and it then
 * self-closes). Poll app.windows() for the real main window that exposes
 * window.playwrightFlowStudio.settings and return it.
 */
export async function resolveMainWindow(app, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow().catch(() => undefined);
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      try {
        const ready = await w.evaluate(
          () => typeof window.playwrightFlowStudio !== "undefined" && !!window.playwrightFlowStudio.settings
        );
        if (ready) return w;
      } catch {
        /* window navigating/closing — retry */
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("main window with the SpecterStudio bridge did not appear within timeout");
}

/**
 * Drive the clean-machine first-run: SecurityGate shows FirstRunSetup on an empty profile; provision
 * the Super User, capture and acknowledge the one-time recovery code, then wait for the protected app
 * shell. Assumes an isolated,
 * empty %LOCALAPPDATA% (see isolatedLaunchEnv) — on a profile that already has a user this would show
 * the login form instead and time out. Resolves once `.app-shell` has mounted.
 */
/** The app renders failures as `app-toast app-toast-error` (app/renderer/components/shared/Toast.tsx). */
export const ERROR_TOAST_SELECTOR = ".app-toast-error";

/**
 * Wait for persisted state, and fail the MOMENT the app says the save failed.
 *
 * The suites used to click Save and then wait for the state to appear, which cannot tell "the save
 * is still in flight" from "the save failed and the app already said so". A real EPERM save loss hid
 * behind that for three investigations: the app raised "Failed to save changes. EPERM ..." within
 * milliseconds, the suite waited out its whole timeout, and the failure surfaced several checks later
 * somewhere unrelated. The toast auto-dismisses, so reading the DOM after the timeout finds an empty
 * toast list - the evidence is gone by the time anything looks. It has to be sampled on every poll.
 *
 * Only toasts that appear AFTER this call starts are fatal. A stale error toast left on screen by an
 * earlier step would otherwise abort a save that is perfectly healthy.
 */
export async function waitForPersistedState(win, predicate, arg, options = {}) {
  const { timeout = 10_000, interval = 100, label = "persisted state", describe } = options;
  const readErrorToasts = () =>
    win
      .evaluate(
        (selector) =>
          [...document.querySelectorAll(selector)].map((node) => (node.textContent ?? "").trim()).filter(Boolean),
        ERROR_TOAST_SELECTOR
      )
      .catch(() => []);

  const baseline = new Set(await readErrorToasts());
  const deadline = Date.now() + timeout;
  let lastToast = null;

  for (;;) {
    // The predicate is read FIRST: a save that lands in the same tick as some unrelated error toast
    // is a success, and should be reported as one.
    const value = await win.evaluate(predicate, arg);
    if (value) return value;

    const toasts = await readErrorToasts();
    const fresh = toasts.filter((text) => !baseline.has(text));
    if (fresh.length > 0) {
      const error = new Error(
        `${label} failed: the app reported an error while waiting - ${JSON.stringify(fresh)}. ` +
          `This is the app's own message, not an inference; the save did not merely run late.`
      );
      error.errorToast = fresh;
      error.awkitAppReportedError = true;
      throw error;
    }
    if (toasts.length > 0) lastToast = toasts;

    if (Date.now() >= deadline) {
      const detail = describe ? await describe().catch((error) => ({ describeFailed: String(error) })) : null;
      const error = new Error(
        `${label} never became true within ${timeout}ms` +
          (detail === null ? "" : `. Actual: ${JSON.stringify(detail)}`)
      );
      error.observedToast = lastToast;
      error.awkitWaitTimedOut = true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export async function signInFirstRun(win, creds = DEFAULT_CREDS) {
  await win.waitForSelector(".awkit-login-card", { timeout: 20000 });
  await win.fill("#awkit-setup-display", creds.displayName);
  await win.fill("#awkit-setup-username", creds.username);
  const pw = win.locator('.awkit-login-form input[type="password"]');
  await pw.nth(0).fill(creds.password);
  await pw.nth(1).fill(creds.password);
  await win.getByRole("button", { name: "Create account" }).click();
  await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 20000 });
  const recoveryCode = (await win.locator(".awkit-recovery-code code").textContent())?.trim() ?? "";
  if (!recoveryCode) throw new Error("first-run recovery code was not displayed");
  await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
  await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
  await win.waitForSelector(".app-shell", { timeout: 25000 });
  return { recoveryCode };
}

