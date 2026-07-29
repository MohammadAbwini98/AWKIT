// E2E-LIC — Licensing page + run-enforcement gate in the REAL Electron app (specs/e2e/E2E-LIC.md,
// bd awkit-xyo, awkit-1cc). Rewritten 2026-07-29 for the owner decision that enforcement is ON by
// default; the pre-2026-07-29 "default OFF admits runs" invariant is deliberately gone.
//
// Launch A — FRESH profile, default enforcement: the unlicensed Licensing page renders with machine
//   code + guidance; the activation request carries ONLY the hashed fingerprint (no raw
//   hostname/MAC/machine-GUID, no secrets); garbage and forged imports fail safely; and a real
//   (dryRun:false) run returns `licenseBlocked`, because a fresh install gets no migration grace.
//   Validation/dry-run and the whole shell stay usable.
// Launch B — same profile with the non-packaged test bypass: the identical run is admitted, proving
//   both branches of the gate are reachable and that A's block was the gate, not a broken fixture.
// Launch C — a SEPARATE profile that already held workflows before its first enforcing launch, i.e.
//   an upgrade: the migration window opens, the same unlicensed run is admitted under grace, and the
//   Licensing page persistently shows the deadline and the activation action.
//
// The A/C pair is what makes the grace claim real: identical app, identical run, one profile classed
// fresh and one classed upgraded, opposite outcomes. Asserting only C would be satisfied by an
// implementation that simply admits everything.
//
// No private key material is used; import cases use deliberately invalid files only.
//
// Run: node scripts/verify-e2e-licensing-gui.mjs   (after `npm run build`)
import { _electron as electron } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import path from "node:path";
import { resolveMainWindow, signInFirstRun, DEFAULT_CREDS } from "./lib/gui-verify-harness.mjs";
import { repoRoot, artifactRoot, makeChecker, watchConsole, loginAs, navClick, directLogin, directLogout } from "./lib/e2e-qa-lib.mjs";

const { check, note, shotDir, summarize } = makeChecker("e2e-licensing");

// Launches A and B share one profile (B must see the same provisioned SU). It is NOT pre-seeded:
// seeding writes workflow JSON into the profile, which is exactly the evidence the migration anchor
// reads as "this installation already existed" — pre-seeding here would hand launch A a grace window
// and silently destroy the case it exists to prove.
const dataRoot = mkdtempSync(path.join(tmpdir(), "awkit-e2e-lic-"));
const baseEnv = {
  ...process.env,
  LOCALAPPDATA: dataRoot,
  MOCK_FIXTURES_WRITE_REPO: "false"
};
delete baseEnv.ELECTRON_RUN_AS_NODE;
delete baseEnv.AWKIT_TEST_LICENSE_BYPASS; // launch A must run with enforcement at its DEFAULT (on)

const fixturesRoot = path.join(repoRoot, "resources", "test-fixtures", "mock-site");
const readFixture = (kind, id) => JSON.parse(readFileSync(path.join(fixturesRoot, kind, `${id}.json`), "utf8"));
const SIMPLE_FLOW_IDS = ["mock-login-flow", "mock-fill-form-flow", "mock-screenshot-flow"];

const RUN_REQUEST = { workflowId: "mock-simple-workflow", dryRun: false, headless: true, totalInstances: 1 };

// ── Launch A: FRESH profile, enforcement at its default (ON) ──────────────────
{
  const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env: baseEnv });
  try {
    const win = await resolveMainWindow(app);
    const consoleWatch = watchConsole(win);
    await win.waitForLoadState("domcontentloaded");
    await signInFirstRun(win);
    await win.waitForTimeout(400);

    const globalAttention = win.getByRole("button", { name: /license attention: not activated/i });
    await globalAttention.waitFor({ timeout: 10000 });
    check("A0: global status bar surfaces an attention-only unlicensed state", (await globalAttention.count()) === 1);

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

    // A6 — import the workflow through the app's own IPC. Deliberately NOT pre-seeded on disk: this
    // profile has to still classify as a fresh install when the migration anchor is written at
    // bootstrap, which happens before any of this.
    consoleWatch.setLabel("A6 import via IPC");
    for (const flowId of SIMPLE_FLOW_IDS) {
      await win.evaluate((f) => window.playwrightFlowStudio.flows.import(f), readFixture("flows", flowId));
    }
    await win.evaluate((w) => window.playwrightFlowStudio.workflows.import(w), readFixture("workflows", "mock-simple-workflow"));
    const imported = await win.evaluate(async () => (await window.playwrightFlowStudio.workflows.list()).map((w) => w.id));
    check("A6: workflow imported through the app's own IPC", imported.includes("mock-simple-workflow"), imported.join(", "));

    // A7 — enforcement is ON by default and this profile is a FRESH install, so it gets no grace.
    consoleWatch.setLabel("A7 run blocked");
    const blockedFresh = await win.evaluate(async (req) => {
      const r = await window.playwrightFlowStudio.executions.runWorkflow(req);
      return { status: r?.status, userAction: r?.license?.userAction, reason: r?.license?.reason, error: r?.error };
    }, RUN_REQUEST);
    check(
      "A7: default enforcement BLOCKS a real unlicensed run on a fresh install",
      blockedFresh.status === "licenseBlocked",
      `status=${blockedFresh.status} ${blockedFresh.error ?? ""}`
    );
    check(
      "A7: the block is attributed to being unlicensed, not to a grace or evaluation fault",
      blockedFresh.reason === "NOT_LICENSED",
      String(blockedFresh.reason)
    );
    check(
      "A7: block carries an actionable user message",
      typeof blockedFresh.userAction === "string" && blockedFresh.userAction.length > 0,
      blockedFresh.userAction
    );

    // A8 — a fresh install must report NO open migration window. Asserting this directly is what
    // stops A7 passing for the wrong reason if grace were silently never implemented.
    if (su.ok) {
      const enforcement = await win.evaluate(async (ref) => {
        const r = await window.playwrightFlowStudio.licensing.getStatus(ref);
        return r.value?.enforcement;
      }, su.sessionRef);
      check("A8: enforcement is reported as ON", enforcement?.enforced === true, JSON.stringify(enforcement));
      check("A8: a fresh install has NO migration window", enforcement?.inGrace === false, JSON.stringify(enforcement));
      check("A8: runs are reported as not allowed", enforcement?.runsAllowed === false, JSON.stringify(enforcement));
    }

    // A9 — validation / dry-run diagnostics stay available while execution is blocked.
    const dryFresh = await win.evaluate(async (id) => {
      const r = await window.playwrightFlowStudio.executions.runWorkflow({ workflowId: id });
      return r?.status;
    }, RUN_REQUEST.workflowId);
    check("A9: dry-run/validation path is NOT gated", dryFresh === "validated", `status=${dryFresh}`);
    await win.screenshot({ path: path.join(shotDir, "A7-blocked-fresh.png") }).catch(() => undefined);

    if (su.ok) await directLogout(win, su.sessionRef);
    check("A: zero renderer console errors", consoleWatch.errors.length === 0, consoleWatch.summary());
  } finally {
    await app.close().catch(() => undefined);
  }
}

// ── Launch B: the non-packaged test bypass, on the SAME still-unlicensed profile ──
// This is the negative control for launch A: same app, same profile, same run request, the only
// difference being the bypass. If A's block were caused by a broken fixture rather than the gate,
// B would block too.
{
  const env = { ...baseEnv, AWKIT_TEST_LICENSE_BYPASS: "1" };
  const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env });
  try {
    const win = await resolveMainWindow(app);
    const consoleWatch = watchConsole(win);
    await win.waitForLoadState("domcontentloaded");
    consoleWatch.setLabel("B bypass");
    await loginAs(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
    await win.waitForSelector(".app-shell", { timeout: 20000 });

    // B1 — the identical run is admitted, so A7's block is attributable to enforcement alone.
    const admitted = await win.evaluate(async (req) => {
      const r = await window.playwrightFlowStudio.executions.runWorkflow(req);
      return { status: r?.status, error: r?.error };
    }, RUN_REQUEST);
    check(
      "B1: the test bypass admits the identical unlicensed run",
      admitted.status === "started",
      `status=${admitted.status} ${admitted.error ?? ""}`
    );
    await win.evaluate(() => window.playwrightFlowStudio.executions.stopAll()).catch(() => undefined);
    await win.waitForTimeout(1500);

    // B2 — the shell + Licensing page stay fully usable.
    await navClick(win, "Licensing");
    await win.getByRole("heading", { name: "License status" }).waitFor({ timeout: 10000 });
    check("B2: app shell fully usable", (await win.locator(".app-shell").count()) === 1);

    check("B: zero renderer console errors", consoleWatch.errors.length === 0, consoleWatch.summary());
  } finally {
    await app.close().catch(() => undefined);
  }
}

rmSync(dataRoot, { recursive: true, force: true });

// ── Launch C: an UPGRADED profile gets the one-time migration window ───────────
// Seeded BEFORE first launch, so the profile already holds workflows when the anchor is written —
// which is exactly what "this installation existed before enforcement" means on disk.
{
  const upgradedRoot = mkdtempSync(path.join(tmpdir(), "awkit-e2e-lic-upgraded-"));
  const upgradedEnv = { ...process.env, LOCALAPPDATA: upgradedRoot, MOCK_FIXTURES_WRITE_REPO: "false" };
  delete upgradedEnv.ELECTRON_RUN_AS_NODE;
  delete upgradedEnv.AWKIT_TEST_LICENSE_BYPASS; // grace must carry this launch, not the bypass

  execFileSync(process.execPath, [path.join(repoRoot, "scripts", "seed-mock-fixtures.mjs")], {
    env: upgradedEnv,
    cwd: repoRoot,
    stdio: "ignore"
  });
  note("seeded mock fixtures BEFORE first launch so the profile classifies as an upgrade");

  const app = await electron.launch({ args: [repoRoot], cwd: repoRoot, env: upgradedEnv });
  try {
    const win = await resolveMainWindow(app);
    const consoleWatch = watchConsole(win);
    await win.waitForLoadState("domcontentloaded");
    consoleWatch.setLabel("C migration grace");
    await signInFirstRun(win);
    await win.waitForTimeout(400);
    // `signInFirstRun` drives the first-run UI; the session ref for IPC-level assertions comes from
    // `directLogin`, exactly as launch A does it.
    const su = await directLogin(win, DEFAULT_CREDS.username, DEFAULT_CREDS.password);
    check("C0: direct SU session for IPC-level assertions", su.ok === true, su.reason);

    // C1 — the window is open, and reports a real deadline rather than just a boolean.
    const enforcement = su.ok
      ? await win.evaluate(async (ref) => {
          const r = await window.playwrightFlowStudio.licensing.getStatus(ref);
          return r.value?.enforcement;
        }, su.sessionRef)
      : null;
    check("C1: an upgraded install opens the migration window", enforcement?.inGrace === true, JSON.stringify(enforcement));
    check(
      "C1: the window reports a parseable deadline",
      typeof enforcement?.graceEndsAtUtc === "string" && !Number.isNaN(Date.parse(enforcement.graceEndsAtUtc)),
      String(enforcement?.graceEndsAtUtc)
    );
    check(
      "C1: the deadline is the full 14 days, not a truncated or zero window",
      enforcement?.graceDaysRemaining === 14,
      String(enforcement?.graceDaysRemaining)
    );
    check("C1: enforcement is still reported as ON during grace", enforcement?.enforced === true, JSON.stringify(enforcement));

    // C2 — the same unlicensed run that launch A refused is admitted here.
    const gracedRun = await win.evaluate(async (req) => {
      const r = await window.playwrightFlowStudio.executions.runWorkflow(req);
      return { status: r?.status, error: r?.error };
    }, RUN_REQUEST);
    check(
      "C2: saved workflows still execute during the migration window",
      gracedRun.status === "started",
      `status=${gracedRun.status} ${gracedRun.error ?? ""}`
    );
    await win.evaluate(() => window.playwrightFlowStudio.executions.stopAll()).catch(() => undefined);
    await win.waitForTimeout(1500);

    // C3 — the deadline and the activation action are visible on the Licensing page, not just in IPC.
    await navClick(win, "Licensing");
    await win.getByRole("heading", { name: "License status" }).waitFor({ timeout: 10000 });
    const graceBanner = win.getByText(/one-time .* activation period/i);
    check("C3: the Licensing page shows the grace period", (await graceBanner.count()) >= 1);
    // Format the expected date INSIDE the page: Node's ICU and Chromium's can differ, and comparing
    // across them would test the two locale databases rather than the banner. This asserts the banner
    // carries the real deadline as the renderer itself would write it.
    const expectedDeadline = await win.evaluate(
      (iso) => new Date(Date.parse(iso)).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
      enforcement.graceEndsAtUtc
    );
    const bannerText = await graceBanner.first().innerText();
    check(
      "C3: the banner names the actual deadline, not a placeholder",
      bannerText.includes(expectedDeadline),
      `expected "${expectedDeadline}" in "${bannerText.replace(/\s+/g, " ").slice(0, 160)}"`
    );
    check("C3: the banner states the remaining day count", /\b14-day\b/.test(bannerText), bannerText.replace(/\s+/g, " ").slice(0, 160));
    check(
      "C3: the activation action stays available during grace",
      (await win.getByRole("button", { name: /export activation request/i }).count()) >= 1
    );
    await win.screenshot({ path: path.join(shotDir, "C3-migration-grace.png") }).catch(() => undefined);

    check("C: zero renderer console errors", consoleWatch.errors.length === 0, consoleWatch.summary());
  } finally {
    await app.close().catch(() => undefined);
    rmSync(upgradedRoot, { recursive: true, force: true });
  }
}

process.exit(summarize() > 0 ? 1 : 0);
