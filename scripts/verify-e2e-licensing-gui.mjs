// E2E-LIC — Licensing page + run-enforcement gate in the REAL Electron app (specs/e2e/E2E-LIC.md,
// bd awkit-xyo). Launch A (enforcement unset = default OFF): unlicensed Licensing page renders with
// machine code + guidance; activation-request export contains ONLY the hashed fingerprint (no raw
// hostname/MAC/machine-GUID, no secrets); garbage and forged license imports fail safely; a real
// (dryRun:false) workflow run is ADMITTED while unlicensed — the default-OFF invariant. Launch B
// (SPECTER_LICENSE_ENFORCE=true, same profile): the same real run returns `licenseBlocked` with an
// actionable message, while validation/dry-run and the app shell stay fully usable.
// No private key material is used; import cases use deliberately invalid files only.
//
// Run: node scripts/verify-e2e-licensing-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";
import { repoRoot, artifactRoot, makeChecker, watchConsole, loginAs, navClick, directLogin, directLogout } from "./lib/e2e-qa-lib.mjs";

const { check, note, shotDir, summarize } = makeChecker("e2e-licensing");

// One shared isolated profile for BOTH launches (launch B must see the same provisioned SU + fixtures).
const dataRoot = mkdtempSync(path.join(tmpdir(), "awkit-e2e-lic-"));
const baseEnv = { ...process.env, LOCALAPPDATA: dataRoot };
delete baseEnv.ELECTRON_RUN_AS_NODE;
delete baseEnv.SPECTER_LICENSE_ENFORCE; // launch A must run with enforcement at its DEFAULT (unset)

// Seed the mock workflows into the isolated profile before first launch (app IPC-compatible fixtures).
// Side effect: seed-mock-fixtures.mjs ALSO rewrites the tracked repo copies under
// resources/test-fixtures/mock-site/ (timestamp-only churn) — `git checkout -- resources/test-fixtures/`
// after a run if you don't want that diff.
execFileSync(process.execPath, [path.join(repoRoot, "scripts", "seed-mock-fixtures.mjs")], {
  env: baseEnv,
  cwd: repoRoot,
  stdio: "ignore"
});
note("seeded mock fixtures into the isolated profile (mock-simple-workflow)");

const RUN_REQUEST = { workflowId: "mock-simple-workflow", dryRun: false, headless: true, totalInstances: 1 };

// ── Launch A: enforcement DEFAULT (OFF) ────────────────────────────────────────
{
  const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env: baseEnv });
  try {
    const win = await resolveMainWindow(app);
    const consoleWatch = watchConsole(win);
    await win.waitForLoadState("domcontentloaded");
    await signInFirstRun(win);
    await win.waitForTimeout(400);

    // A1 — unlicensed Licensing page renders real content (placeholder is gone).
    consoleWatch.setLabel("A1 page render");
    await navClick(win, "Licensing");
    await win.getByRole("heading", { name: "License status" }).waitFor({ timeout: 10000 });
    check("A1: License status card renders (no placeholder)", (await win.getByText(/not yet implemented/i).count()) === 0);
    const badgeText = (await win.locator(".awkit-admin-badge").first().innerText().catch(() => "")).trim();
    check("A1: status badge shows the no-license state", /not activated/i.test(badgeText), badgeText);
    const machineCode = (await win.locator(".awkit-license-code code").innerText().catch(() => "")).trim();
    check("A1: machine code is visible", machineCode.length >= 8, machineCode.slice(0, 12));
    check("A1: actionable guidance text present", (await win.locator(".awkit-admin-muted").count()) >= 1);
    await win.screenshot({ path: path.join(shotDir, "A1-unlicensed.png") }).catch(() => undefined);

    // A2/A3 — machine code + activation request through the SAME preload IPC the page uses.
    consoleWatch.setLabel("A2-A3 activation request");
    const su = await directLogin(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
    check("direct SU session for IPC-level assertions", su.ok === true, su.reason);
    let fingerprintHash = "";
    if (su.ok) {
      const status = await win.evaluate(async (ref) => {
        const r = await window.playwrightFlowStudio.licensing.getStatus(ref);
        return { ok: r.ok, status: r.value?.status, hash: r.value?.machineFingerprintHash };
      }, su.sessionRef);
      fingerprintHash = status.hash ?? "";
      check("A2: stable non-empty machine code (hashed fingerprint)", status.ok && fingerprintHash.length >= 32, `status=${status.status}`);
      check("A2: unlicensed status is NOT_ACTIVATED-class (not VALID)", status.ok && status.status !== "VALID", String(status.status));

      const request = await win.evaluate(async (ref) => {
        const r = await window.playwrightFlowStudio.licensing.exportRequest(ref);
        return { ok: r.ok, value: r.value };
      }, su.sessionRef);
      check("A3: activation request exports", request.ok === true);
      if (request.ok) {
        const json = JSON.stringify(request.value);
        const exportDir = path.join(artifactRoot, "defects");
        mkdirSync(exportDir, { recursive: true });
        writeFileSync(path.join(artifactRoot, "logs", "activation-request-sample.json"), JSON.stringify(request.value, null, 2), "utf8");
        check("A3: request carries the hashed fingerprint", json.includes(fingerprintHash));
        const host = hostname();
        const user = userInfo().username;
        const macLike = /\b([0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/i.test(json);
        check(
          "A3: request leaks NO raw hostname/username/MAC",
          !json.toLowerCase().includes(host.toLowerCase()) && !json.toLowerCase().includes(user.toLowerCase()) && !macLike,
          macLike ? "MAC-like token found" : undefined
        );
      }
    }

    // A4 — garbage import fails safely in the UI; page stays usable.
    consoleWatch.setLabel("A4 garbage import");
    const garbageFile = path.join(dataRoot, "garbage-license.dat");
    writeFileSync(garbageFile, Buffer.from([0x00, 0xff, 0x13, 0x37, 0x99, 0x42]));
    await win.locator('input[type="file"]').setInputFiles(garbageFile);
    await win.waitForTimeout(700);
    check("A4: garbage file surfaces a safe on-page error", (await win.getByText(/isn't a valid license file/i).count()) >= 1);
    check("A4: page remains usable after the bad import", (await win.getByRole("heading", { name: "License status" }).count()) >= 1);

    // A5 — structurally-valid but FORGED license is rejected by signature verification.
    consoleWatch.setLabel("A5 forged import");
    const forged = {
      schemaVersion: 1,
      licenseId: "e2e-forged-0001",
      serialNumber: "SN-E2E-FORGED",
      product: "SpecterStudio",
      machineFingerprintHash: fingerprintHash || "0".repeat(64),
      issuedAtUtc: new Date(Date.now() - 86400000).toISOString(),
      validFromUtc: new Date(Date.now() - 86400000).toISOString(),
      expiresAtUtc: new Date(Date.now() + 365 * 86400000).toISOString(),
      licenseType: "standard",
      entitlements: [],
      issuer: "e2e-forger",
      signingKeyId: "key1",
      signatureAlgorithm: "Ed25519",
      signature: Buffer.alloc(64).toString("base64")
    };
    const forgedFile = path.join(dataRoot, "forged-license.json");
    writeFileSync(forgedFile, JSON.stringify(forged, null, 2), "utf8");
    await win.locator('input[type="file"]').setInputFiles(forgedFile);
    await win.waitForTimeout(900);
    check("A5: forged license rejected with a signature-class message", (await win.locator(".form-message.error").count()) >= 1);
    if (su.ok) {
      const after = await win.evaluate(async (ref) => {
        const r = await window.playwrightFlowStudio.licensing.getStatus(ref);
        return r.value?.status;
      }, su.sessionRef);
      check("A5: still unlicensed after the forged import", after !== "VALID", String(after));
    }
    await win.screenshot({ path: path.join(shotDir, "A5-forged-rejected.png") }).catch(() => undefined);

    // A6 — default-OFF invariant: a REAL run is admitted while unlicensed.
    consoleWatch.setLabel("A6 run admitted");
    const admitted = await win.evaluate(async (req) => {
      const r = await window.playwrightFlowStudio.executions.runWorkflow(req);
      return { status: r?.status, error: r?.error };
    }, RUN_REQUEST);
    check(
      "A6: enforcement OFF admits a real unlicensed run (never licenseBlocked)",
      admitted.status === "started",
      `status=${admitted.status} ${admitted.error ?? ""}`
    );
    await win.evaluate(() => window.playwrightFlowStudio.executions.stopAll()).catch(() => undefined);
    await win.waitForTimeout(1500);

    if (su.ok) await directLogout(win, su.sessionRef);
    check("A: zero renderer console errors", consoleWatch.errors.length === 0, consoleWatch.summary());
  } finally {
    await app.close().catch(() => undefined);
  }
}

// ── Launch B: SPECTER_LICENSE_ENFORCE=true on the SAME (still unlicensed) profile ─
{
  const env = { ...baseEnv, SPECTER_LICENSE_ENFORCE: "true" };
  const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env });
  try {
    const win = await resolveMainWindow(app);
    const consoleWatch = watchConsole(win);
    await win.waitForLoadState("domcontentloaded");
    consoleWatch.setLabel("B enforcement");
    await loginAs(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
    await win.waitForSelector(".app-shell", { timeout: 20000 });

    // B1 — the run gate blocks a real run with an actionable, non-throwing response.
    const blocked = await win.evaluate(async (req) => {
      const r = await window.playwrightFlowStudio.executions.runWorkflow(req);
      return { status: r?.status, userAction: r?.license?.userAction, licStatus: r?.license?.status };
    }, RUN_REQUEST);
    check("B1: enforcement ON blocks the real run with licenseBlocked", blocked.status === "licenseBlocked", `status=${blocked.status}`);
    check("B1: block carries an actionable user message", typeof blocked.userAction === "string" && blocked.userAction.length > 0, blocked.userAction);

    // B2 — validation / dry-run diagnostics stay available under enforcement.
    const dry = await win.evaluate(async (id) => {
      const r = await window.playwrightFlowStudio.executions.runWorkflow({ workflowId: id });
      return r?.status;
    }, RUN_REQUEST.workflowId);
    check("B2: dry-run/validation path is NOT gated", dry === "validated", `status=${dry}`);

    // B3 — the shell + Licensing page stay fully usable (enforcement gates runs only).
    await navClick(win, "Licensing");
    await win.getByRole("heading", { name: "License status" }).waitFor({ timeout: 10000 });
    check("B3: Licensing page renders under enforcement", true);
    check("B3: app shell fully usable under enforcement", (await win.locator(".app-shell").count()) === 1);
    await win.screenshot({ path: path.join(shotDir, "B3-enforced.png") }).catch(() => undefined);

    check("B: zero renderer console errors", consoleWatch.errors.length === 0, consoleWatch.summary());
  } finally {
    await app.close().catch(() => undefined);
  }
}

rmSync(dataRoot, { recursive: true, force: true });
process.exit(summarize() > 0 ? 1 : 0);
