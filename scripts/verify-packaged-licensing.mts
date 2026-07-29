/**
 * Packaged licensing negative matrix + the migration-grace scenario (owner decision 2026-07-29,
 * bd `awkit-1cc`). Companion to `verify:packaged-walkthrough`, which proves the POSITIVE case —
 * a genuinely licensed packaged app executes real workflows.
 *
 * Verifier class: **packaged-application**. Run AFTER `npm run package:portable`:
 *   npm run verify:packaged-licensing
 *
 * ## What this proves
 *
 * Each of the five blocking states actually prevents a new run **in the packaged build**, where no
 * bypass exists:
 *
 *   | state             | how it is produced here                        | needs the issuer key |
 *   |-------------------|------------------------------------------------|----------------------|
 *   | NOT_ACTIVATED     | no license file                                | no                   |
 *   | INVALID_SIGNATURE | structurally complete license, worthless sig   | no                   |
 *   | CORRUPTED         | unreadable license envelope                    | no                   |
 *   | EXPIRED           | validly signed, expiry in the past             | YES                  |
 *   | MACHINE_MISMATCH  | validly signed for a different fingerprint     | YES                  |
 *
 * The last two need a real signature because the validator checks the signature BEFORE the
 * fingerprint and before expiry — an unsigned attempt would collapse into `INVALID_SIGNATURE` and the
 * matrix would silently test the same thing three times. Without the key those two report **BLOCKED**,
 * never skipped and never passed, while the other three still run.
 *
 * States are produced by writing the store file directly, because `licensing:import` deliberately
 * REJECTS invalid/mismatched/corrupt material before committing — a machine whose stored license has
 * decayed into one of these is the real scenario, and it cannot be reached through the supported path.
 * The envelope checksum is computed exactly as the store computes it, so each case reads as its own
 * status instead of everything collapsing into `CORRUPTED`.
 *
 * ## Migration grace
 *
 * A profile that already held workflows before its first enforcing launch gets the one-time 14-day
 * window, and its saved workflows keep executing. This is verified on its OWN profile, deliberately
 * separate from the walkthrough — grace must never be the mechanism that grants the normal gate its
 * execution rights, and the walkthrough asserts `inGrace === false` for exactly that reason.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import type { LicenseDocument } from "@src/licensing/LicenseTypes";
import {
  ISSUER_KEY_ENV,
  cleanupMintedArtifacts,
  forgeUnsignedLicense,
  freshDir,
  mintVerificationLicense,
  removeStoredLicense,
  resolveIssuerKey,
  sanitizeAppEnv,
  seedUpgradedProfile,
  writeCorruptStoredLicense,
  writeStoredLicenseEnvelope
} from "./helpers/packaged-license.mts";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const exePath = join(root, "dist", "win-unpacked", "SpecterStudio.exe");
const fixturesRoot = join(root, "resources", "test-fixtures", "mock-site");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseDir = join(tmpdir(), "awkit-packaged-licensing", stamp);

const MOCK_PORT = 4321;
const MOCK_PROBE = `http://127.0.0.1:${MOCK_PORT}/login`;
const ACCOUNT = {
  displayName: "Packaged Licensing",
  username: "liccheck",
  password: "Licensing!LocalGate2026"
};
const RUN_REQUEST = { workflowId: "mock-simple-workflow", headless: true, dryRun: false, totalInstances: 1 };

let passed = 0;
let failed = 0;
let blocked = 0;
const check = (label: string, cond: unknown, detail?: string): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const block = (label: string, reason: string): void => {
  blocked += 1;
  console.log(`  ⊘ ${label} — BLOCKED: ${reason}`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function httpOk(url: string): Promise<boolean> {
  return new Promise((res) => {
    const req = httpGet(url, (r) => {
      r.resume();
      res((r.statusCode ?? 500) < 400);
    });
    req.on("error", () => res(false));
    req.setTimeout(2000, () => {
      req.destroy();
      res(false);
    });
  });
}

const appEnv = (localAppData: string) =>
  sanitizeAppEnv({ ...process.env, LOCALAPPDATA: localAppData, AWKIT_MAX_BROWSERS: "2", ELECTRON_RUN_AS_NODE: undefined });

async function mainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow({ timeout: timeoutMs }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      const ready = await candidate
        .evaluate(() => typeof (window as any).playwrightFlowStudio?.executions?.runtimeStatus === "function")
        .catch(() => false);
      if (ready) return candidate;
    }
    await sleep(400);
  }
  throw new Error("packaged main window with the preload bridge never appeared");
}

async function signIn(win: Page): Promise<string> {
  await win.waitForSelector(".awkit-login-card, .app-shell", { timeout: 30_000 });
  if ((await win.locator(".app-shell").count()) === 0) {
    await win.fill("#awkit-setup-display", ACCOUNT.displayName);
    await win.fill("#awkit-setup-username", ACCOUNT.username);
    const pw = win.locator('.awkit-login-form input[type="password"]');
    await pw.nth(0).fill(ACCOUNT.password);
    await pw.nth(1).fill(ACCOUNT.password);
    await win.getByRole("button", { name: "Create account" }).click();
    await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 30_000 });
    await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
    await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
    await win.waitForSelector(".app-shell", { timeout: 30_000 });
  }
  const res = (await win.evaluate(
    async (creds) =>
      (window as any).playwrightFlowStudio.security.login({
        providerId: "local",
        username: creds.username,
        password: creds.password
      }),
    ACCOUNT
  )) as any;
  if (!res?.ok) throw new Error(`login failed: ${res?.reason}`);
  return res.principal.sessionRef as string;
}

const statusOf = (win: Page, ref: string) =>
  win.evaluate(async (r) => (window as any).playwrightFlowStudio.licensing.getStatus(r), ref) as Promise<any>;
const attemptRun = (win: Page) =>
  win.evaluate(async (req) => (window as any).playwrightFlowStudio.executions.runWorkflow(req), RUN_REQUEST) as Promise<any>;
const importFixtures = async (win: Page): Promise<void> => {
  for (const id of ["mock-login-flow", "mock-fill-form-flow", "mock-screenshot-flow"]) {
    const flow = JSON.parse(readFileSync(join(fixturesRoot, "flows", `${id}.json`), "utf8"));
    await win.evaluate(async (f) => (window as any).playwrightFlowStudio.flows.import(f), flow);
  }
  const wf = JSON.parse(readFileSync(join(fixturesRoot, "workflows", "mock-simple-workflow.json"), "utf8"));
  await win.evaluate(async (w) => (window as any).playwrightFlowStudio.workflows.import(w), wf);
};

async function main(): Promise<void> {
  console.log("Packaged licensing — negative matrix + migration grace\n");

  console.log("Preconditions:");
  if (!existsSync(exePath)) {
    console.error(`  ✗ Packaged app not found (${exePath}). Build it first: npm run package:portable`);
    process.exit(1);
  }
  check("packaged EXE exists", true, exePath);
  check("mock-site fixtures exist", existsSync(join(fixturesRoot, "workflows", "mock-simple-workflow.json")));

  let mockSite: ReturnType<typeof spawn> | null = null;
  if (!(await httpOk(MOCK_PROBE))) {
    mockSite = spawn(process.execPath, [join(root, "mock-site", "server.mjs")], {
      env: { ...process.env, MOCK_SITE_PORT: String(MOCK_PORT) },
      stdio: "ignore",
      windowsHide: true
    });
    for (let i = 0; i < 40 && !(await httpOk(MOCK_PROBE)); i += 1) await sleep(500);
  }
  check("mock site is serving on loopback", await httpOk(MOCK_PROBE), MOCK_PROBE);

  const key = resolveIssuerKey();
  const negativeRoot = freshDir(join(baseDir, "negative"));
  const graceRoot = freshDir(join(baseDir, "grace"));
  const workDir = join(baseDir, "issuer-work");
  let app: ElectronApplication | null = null;

  try {
    // ── Negative matrix ────────────────────────────────────────────────────────────────────────
    console.log("\nNegative matrix — every blocking state refuses a new run in the packaged build");
    app = await electron.launch({ executablePath: exePath, env: appEnv(negativeRoot) as never, timeout: 60_000 });
    const win = await mainWindow(app);
    await win.waitForLoadState("domcontentloaded");
    const ref = await signIn(win);
    await importFixtures(win);

    const fresh = await statusOf(win, ref);
    check(
      "the negative profile is a FRESH install with no migration window",
      fresh?.value?.enforcement?.inGrace === false,
      JSON.stringify(fresh?.value?.enforcement)
    );
    const fingerprint = fresh?.value?.machineFingerprintHash as string;
    check("packaged app reports a machine fingerprint", typeof fingerprint === "string" && fingerprint.length > 16);

    /** Assert the app is in `expected` state and that a real run is refused for that reason. */
    async function expectBlocked(label: string, expectedStatus: string): Promise<void> {
      const status = await statusOf(win, ref);
      check(`${label}: status is ${expectedStatus}`, status?.value?.status === expectedStatus, JSON.stringify(status?.value?.status));
      check(
        `${label}: the run gate reports runs are not allowed`,
        status?.value?.enforcement?.runsAllowed === false,
        JSON.stringify(status?.value?.enforcement)
      );
      const run = await attemptRun(win);
      check(`${label}: a real packaged run is REFUSED`, run?.status === "licenseBlocked", JSON.stringify(run?.status));
      check(
        `${label}: the refusal names the license state`,
        run?.license?.status === expectedStatus,
        JSON.stringify(run?.license?.status)
      );
    }

    removeStoredLicense(negativeRoot);
    await expectBlocked("NOT_ACTIVATED", "NOT_ACTIVATED");

    writeStoredLicenseEnvelope({ localAppData: negativeRoot, license: forgeUnsignedLicense(fingerprint) });
    await expectBlocked("INVALID_SIGNATURE", "INVALID_SIGNATURE");

    writeCorruptStoredLicense(negativeRoot);
    await expectBlocked("CORRUPTED", "CORRUPTED");

    if (!key.available) {
      block("EXPIRED refuses a packaged run", key.reason as string);
      block("MACHINE_MISMATCH refuses a packaged run", key.reason as string);
    } else {
      const activation = (await win.evaluate(
        async (r) => (window as any).playwrightFlowStudio.licensing.exportRequest(r),
        ref
      )) as any;

      const expiredLicense = (
        await mintVerificationLicense({
          repoRoot: root,
          keyPath: key.keyPath as string,
          activationRequest: activation.value,
          workDir,
          expiresAtOverrideIso: new Date(Date.now() - 24 * 60 * 60_000).toISOString()
        })
      ).license;
      writeStoredLicenseEnvelope({ localAppData: negativeRoot, license: expiredLicense });
      await expectBlocked("EXPIRED", "EXPIRED");

      const otherFingerprint = "0".repeat(64);
      check("the mismatch fixture targets a DIFFERENT machine", otherFingerprint !== fingerprint);
      const mismatchLicense = (
        await mintVerificationLicense({
          repoRoot: root,
          keyPath: key.keyPath as string,
          activationRequest: activation.value,
          workDir,
          fingerprintHashOverride: otherFingerprint,
          expiresInMinutes: 45
        })
      ).license;
      writeStoredLicenseEnvelope({ localAppData: negativeRoot, license: mismatchLicense });
      await expectBlocked("MACHINE_MISMATCH", "MACHINE_MISMATCH");
    }

    // The matrix must not be able to pass by refusing everything unconditionally. With the key we
    // have already shown admission in the walkthrough; here, prove at least that the SAME app admits
    // a run under the grace window below. Without that control, "everything is blocked" is equally
    // satisfied by an app that cannot run at all.
    await app.close();
    app = null;

    // ── Migration grace, on its own profile ────────────────────────────────────────────────────
    console.log("\nMigration grace — an upgraded packaged install keeps running for 14 days");
    seedUpgradedProfile(graceRoot, fixturesRoot, ["mock-simple-workflow"]);
    check(
      "the grace profile holds workflows BEFORE its first enforcing launch",
      existsSync(join(graceRoot, "SpecterStudio", "workflows", "mock-simple-workflow.json"))
    );

    app = await electron.launch({ executablePath: exePath, env: appEnv(graceRoot) as never, timeout: 60_000 });
    const graceWin = await mainWindow(app);
    await graceWin.waitForLoadState("domcontentloaded");
    const graceRef = await signIn(graceWin);
    await importFixtures(graceWin);

    const graceStatus = await statusOf(graceWin, graceRef);
    check(
      "an upgraded packaged install opens the migration window",
      graceStatus?.value?.enforcement?.inGrace === true,
      JSON.stringify(graceStatus?.value?.enforcement)
    );
    check(
      "the window is the full 14 days",
      graceStatus?.value?.enforcement?.graceDaysRemaining === 14,
      String(graceStatus?.value?.enforcement?.graceDaysRemaining)
    );
    check(
      "it is still UNLICENSED — grace admits, it does not license",
      graceStatus?.value?.status === "NOT_ACTIVATED",
      JSON.stringify(graceStatus?.value?.status)
    );
    check(
      "enforcement is still reported ON during grace",
      graceStatus?.value?.enforcement?.enforced === true,
      JSON.stringify(graceStatus?.value?.enforcement)
    );

    const gracedRun = await attemptRun(graceWin);
    check(
      "saved workflows still EXECUTE in the packaged build during the window",
      gracedRun?.status === "started",
      JSON.stringify({ status: gracedRun?.status, error: gracedRun?.error })
    );
    check(
      "admission is attributed to the migration window, not a license",
      graceStatus?.value?.enforcement?.reason === "MIGRATION_GRACE",
      JSON.stringify(graceStatus?.value?.enforcement?.reason)
    );
    await graceWin.evaluate(() => (window as any).playwrightFlowStudio.executions.stopAll()).catch(() => undefined);
    await sleep(2000);
  } finally {
    await app?.close().catch(() => undefined);
    cleanupMintedArtifacts(workDir);
    if (mockSite && !mockSite.killed) mockSite.kill();
  }

  console.log(`\n${passed} PASS / ${failed} FAIL${blocked ? ` / ${blocked} BLOCKED` : ""} — packaged licensing`);
  if (blocked > 0) {
    console.log(
      `BLOCKED cases need a validly signed license, so they need ${ISSUER_KEY_ENV} set on an authorized\n` +
        "validation machine or CI runner. Recorded as BLOCKED, not skipped and not passed."
    );
  }
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✗ Unhandled failure: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
