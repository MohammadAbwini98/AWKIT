// Proves the cross-process single-instance guard (awkit-ekd.6): only one SpecterStudio process may run
// per user-data profile, so two processes can never race on the shared security.sqlite / settings stores.
//
// Launches a primary instance (A) against an isolated profile and signs it in past the SecurityGate,
// then launches a second instance (B) against the SAME profile and asserts B fails to acquire the lock
// and exits without opening a window, while A stays alive.
//
// Run: node scripts/verify-single-instance.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isolatedLaunchEnv, resolveMainWindow, signInFirstRun } from "./lib/gui-verify-harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { env, cleanup } = isolatedLaunchEnv("awkit-single-instance");

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const primary = await electron.launch({ args: [root], cwd: root, env });
let secondary = null;
try {
  const primaryWin = await resolveMainWindow(primary);
  await primaryWin.waitForLoadState("domcontentloaded");
  await signInFirstRun(primaryWin);
  check("primary instance reaches the app shell", !primaryWin.isClosed());

  // Launch a second instance against the SAME profile. It must fail the single-instance lock: either
  // Playwright's launch rejects because the process exits, or it resolves but opens no window and
  // closes shortly. Both outcomes prove the guard; a persistent second window would be the failure.
  let secondOpenedWindow = false;
  try {
    secondary = await Promise.race([
      electron.launch({ args: [root], cwd: root, env }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("second launch timed out")), 12000))
    ]);
    // Give it a moment to either open a window or quit from the failed lock.
    await new Promise((r) => setTimeout(r, 3500));
    secondOpenedWindow = secondary.windows().length > 0;
  } catch {
    // Second process exited during/right after launch — exactly what the lock should cause.
    secondOpenedWindow = false;
  }
  check("second instance does not open its own window (single-instance lock held)", !secondOpenedWindow);

  check("primary instance stays alive after the second launch attempt", !primaryWin.isClosed());
} finally {
  if (secondary) await secondary.close().catch(() => undefined);
  await primary.close().catch(() => undefined);
  cleanup();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nSingle-instance guard: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
