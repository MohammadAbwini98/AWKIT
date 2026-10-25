/**
 * verify:visual-assertion-packaged — Phase N, N6 packaged acceptance (VA-16). Verifier class: packaged-application.
 * Run AFTER `npm run package:portable`, against the exact payload it produced (`dist/win-unpacked`).
 *
 *  A. The shipped ASAR: no `out/calibration-main`, no calibration entry, harness or mode switch in any shipped file,
 *     no call of the grant issuer anywhere (only the store's own method definition), and the packaged main entry.
 *  B. The packaged app (isolated profile, `AWKIT_VISUAL_ASSERTIONS=enforce` so even the strongest flag is shown not
 *     to enable anything): capabilities report the packaged build with enforce unavailable; the preload exposes no
 *     calibration surface; the Designer offers observe only for an observe step, and shows an imported enforce step
 *     as unavailable with its reason.
 *  C. Real runs on the bundled Chromium (licensed through the walkthrough's verification-license path; without the
 *     issuer key these report BLOCKED, never passed): the imported enforce step fails `visual-unverified /
 *     enforce-unavailable-in-production` and the observe step passes; after a relaunch with every visual flag unset,
 *     an ordinary workflow passes with no visual block in its report, and the enforce step still fails closed.
 *
 * Run: npm run package:portable && npm run verify:visual-assertion-packaged
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractFile, listPackage } from "@electron/asar";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

import { cleanupMintedArtifacts, mintVerificationLicense, resolveIssuerKey, sanitizeAppEnv } from "./helpers/packaged-license.mts";
import { appVersion, stalePackagedPayload } from "./helpers/packaged-artifacts.mjs";
// @ts-expect-error Shared E2E helper is intentionally plain ESM JavaScript.
import { navClick } from "./lib/e2e-qa-lib.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const unpacked = join(root, "dist", "win-unpacked");
const exePath = join(unpacked, "SpecterStudio.exe");
const asarPath = join(unpacked, "resources", "app.asar");
const ACCOUNT = { displayName: "Packaged Visual", username: "pkgvisual", password: "Visual!Packaged2026" };

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

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => (address && typeof address === "object" ? ok(address.port) : fail(new Error("no port"))));
    });
  });
}

// ── A. The shipped ASAR ───────────────────────────────────────────────────────────────────────────
function inspectAsar(): void {
  console.log("\nA. The shipped ASAR");
  const entries = listPackage(asarPath, { isPack: false }).map((e) => e.replace(/\\/g, "/"));
  check("the ASAR was listed", entries.length > 100, String(entries.length));
  check("out/calibration-main is not shipped", !entries.some((e) => e.startsWith("/out/calibration-main")));
  check("no unpacked calibration build either", !existsSync(join(unpacked, "resources", "app.asar.unpacked", "out", "calibration-main")));
  const pkg = JSON.parse(extractFile(asarPath, "package.json").toString("utf8")) as { main?: string; version?: string };
  check("the packaged main entry is the production main", pkg.main === "./out/main/main.js" || pkg.main === "out/main/main.js", pkg.main);
  check("the packaged version is this checkout's version", pkg.version === appVersion(root), `${pkg.version} vs ${appVersion(root)}`);
  const shipped = entries.filter((e) => e.startsWith("/out/") && /\.(m?js|html)$/.test(e));
  const texts = shipped.map((e) => ({ e, text: extractFile(asarPath, e.slice(1)).toString("utf8") }));
  check("shipped code was read", texts.length > 3, String(texts.length));
  const markers = ["AWKIT_CALIBRATION_MODE", "visualCalibrationRoot", "VisualCalibrationHarness", "calibration-main"];
  const offenders = texts.filter(({ text }) => markers.some((m) => text.includes(m))).map(({ e }) => e);
  check("no shipped file holds the calibration entry, harness or mode switch", offenders.length === 0, offenders.join(", "));
  const callers = texts.filter(({ text }) => /\.issueGrantUnchecked\(/.test(text)).map(({ e }) => e);
  check("nothing shipped calls the grant issuer (only the store defines it)", callers.length === 0, callers.join(", "));
}

// ── Packaged app helpers ──────────────────────────────────────────────────────────────────────────
function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function seed(localAppData: string, lab: string): void {
  const data = join(localAppData, "SpecterStudio");
  const now = new Date().toISOString();
  const flow = (id: string, name: string, nodes: unknown[]) => ({
    id,
    name,
    version: 1,
    createdAt: now,
    updatedAt: now,
    nodes: [{ id: "start", type: "start", name: "Start" }, ...nodes, { id: "end", type: "end", name: "End" }],
    edges: ["start", ...nodes.map((n) => (n as { id: string }).id)].map((source, i, all) => ({
      id: `e${i}`,
      source,
      target: all[i + 1] ?? "end",
      type: "success"
    }))
  });
  const open = { id: "open-lab", type: "goto", name: "Open the lab", url: lab, valueSource: { type: "static", value: lab }, timeoutMs: 30000 };
  writeJson(
    join(data, "flows", "va-pkg-flow.json"),
    flow("va-pkg-flow", "VA packaged flow", [
      open,
      { id: "va-observe", type: "assertVisual", name: "Assert observe", mode: "observe", locator: { strategy: "testId", value: "va-card" }, timeoutMs: 15000 },
      { id: "va-enforce", type: "assertVisual", name: "Assert enforce", mode: "enforce", locator: { strategy: "testId", value: "va-card-b" }, timeoutMs: 15000, onFailure: { action: "continue" } }
    ])
  );
  writeJson(
    join(data, "flows", "plain-pkg-flow.json"),
    flow("plain-pkg-flow", "Plain packaged flow", [open, { id: "click-button", type: "click", name: "Click Continue", locator: { strategy: "testId", value: "va-button" }, timeoutMs: 15000 }])
  );
  for (const [id, flowId] of [
    ["va-pkg-workflow", "va-pkg-flow"],
    ["plain-pkg-workflow", "plain-pkg-flow"]
  ]) {
    writeJson(join(data, "workflows", `${id}.json`), {
      id,
      name: id,
      version: 1,
      createdAt: now,
      updatedAt: now,
      nodes: [{ id: "ref", type: "flowRef", flowId, alias: flowId, order: 1, required: true, inputBindings: {}, retryPolicy: { count: 0, delayMs: 0 }, failurePolicy: "continue", position: { x: 0, y: 0 } }],
      edges: [],
      runtimeInputs: [],
      execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: false }
    });
  }
}

async function launch(localAppData: string, extra: Record<string, string>): Promise<{ app: ElectronApplication; win: Page }> {
  const env = sanitizeAppEnv({
    ...process.env,
    LOCALAPPDATA: localAppData,
    APPDATA: join(localAppData, "Roaming"),
    AWKIT_VISUAL_ASSERTIONS: undefined,
    AWKIT_VISUAL_FUSION: undefined,
    AWKIT_VISUAL_RECOVERY: undefined,
    AWKIT_VISUAL_DIAGNOSIS: undefined,
    AWKIT_VISUAL_RECORDER: undefined,
    ELECTRON_RUN_AS_NODE: undefined,
    ...extra
  });
  const app = await electron.launch({ executablePath: exePath, args: [`--user-data-dir=${join(localAppData, "Roaming", "SpecterStudio")}`], env: env as never, timeout: 90_000 });
  const deadline = Date.now() + 90_000;
  await app.firstWindow({ timeout: 90_000 }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const candidate of app.windows()) {
      if (await candidate.evaluate(() => typeof (window as any).playwrightFlowStudio?.visualAssertions?.capabilities === "function").catch(() => false)) {
        return { app, win: candidate };
      }
    }
    await sleep(400);
  }
  throw new Error("the packaged main window with the preload bridge never appeared");
}

async function signIn(win: Page): Promise<string> {
  await win.waitForSelector(".awkit-login-card, .app-shell", { timeout: 30_000 });
  if ((await win.locator("#awkit-setup-username").count()) > 0) {
    await win.fill("#awkit-setup-display", ACCOUNT.displayName);
    await win.fill("#awkit-setup-username", ACCOUNT.username);
    const pw = win.locator('.awkit-login-form input[type="password"]');
    await pw.nth(0).fill(ACCOUNT.password);
    await pw.nth(1).fill(ACCOUNT.password);
    await win.getByRole("button", { name: "Create account" }).click();
    await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 30_000 });
    await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
    await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
  } else if ((await win.locator(".app-shell").count()) === 0) {
    await win.fill("#awkit-login-username", ACCOUNT.username);
    await win.locator('.awkit-login-form input[type="password"]').first().fill(ACCOUNT.password);
    await win.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
  const res = (await win.evaluate(
    async (c) => (window as any).playwrightFlowStudio.security.login({ providerId: "local", username: c.username, password: c.password }),
    ACCOUNT
  )) as any;
  if (!res?.ok) throw new Error(`login failed: ${res?.reason}`);
  return res.principal.sessionRef as string;
}

/** Activate a short-lived verification license, as verify:packaged-walkthrough does; a reason when it cannot. */
async function license(win: Page, sessionRef: string, workDir: string): Promise<string | null> {
  const key = resolveIssuerKey();
  if (!key.available) return key.reason ?? "no issuer key";
  const activation = (await win.evaluate(async (r) => (window as any).playwrightFlowStudio.licensing.exportRequest(r), sessionRef)) as any;
  if (!activation?.ok || !activation.value?.fingerprintHash) return "the packaged app did not return an activation request";
  try {
    const minted = await mintVerificationLicense({ repoRoot: root, keyPath: key.keyPath as string, activationRequest: activation.value, workDir, expiresInMinutes: 45 });
    await win.evaluate(async (i) => (window as any).playwrightFlowStudio.security.reauth(i), { sessionRef, password: ACCOUNT.password });
    const imported = (await win.evaluate(async (i) => (window as any).playwrightFlowStudio.licensing.import(i), { sessionRef, license: minted.license })) as any;
    return imported?.ok === true && imported.value?.ok === true ? null : "the verification license was not accepted";
  } catch (error) {
    return `the external issuer failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function runAndReport(win: Page, workflowId: string): Promise<{ status: string; instances: any[]; live: any[] } | { refused: string }> {
  const started = (await win.evaluate(
    async (id) => (window as any).playwrightFlowStudio.executions.runWorkflow({ workflowId: id, dryRun: false, headless: true, totalInstances: 1, maxConcurrentInstances: 1 }),
    workflowId
  )) as any;
  if (!started?.executionId) return { refused: String(started?.status ?? JSON.stringify(started)).slice(0, 200) };
  const deadline = Date.now() + 120_000;
  for (;;) {
    const report = (await win.evaluate(async (id) => (window as any).playwrightFlowStudio.reports.get(id), started.executionId)) as any;
    const list = (await win.evaluate(async () => (window as any).playwrightFlowStudio.executions.list())) as any[];
    const mine = list.filter((i) => i.executionId === started.executionId);
    const settled = mine.length > 0 && mine.every((i) => ["passed", "failed", "cancelled", "stopped", "completed", "error"].includes(String(i.status)));
    if (settled && report?.instances?.length) return { status: String(report.status), instances: report.instances, live: mine };
    if (Date.now() > deadline) throw new Error(`${workflowId} did not finish within 120 s`);
    await sleep(500);
  }
}

// ── B and C. The packaged app ─────────────────────────────────────────────────────────────────────
async function packagedApp(): Promise<void> {
  const localAppData = mkdtempSync(join(tmpdir(), "awkit-va-packaged-"));
  const port = await freePort();
  const lab = `http://127.0.0.1:${port}/visual-intelligence/assertion`;
  seed(localAppData, lab);
  const server: ChildProcess = spawn(process.execPath, ["mock-site/server.mjs"], { cwd: root, env: { ...process.env, MOCK_SITE_PORT: String(port) }, stdio: "ignore", windowsHide: true });
  let app: ElectronApplication | undefined;
  const workDir = join(localAppData, "license-work");
  try {
    for (let i = 0; i < 100 && !(await fetch(lab).then((r) => r.ok, () => false)); i += 1) await sleep(100);

    console.log("\nB. The packaged app, with AWKIT_VISUAL_ASSERTIONS=enforce");
    const first = await launch(localAppData, { AWKIT_VISUAL_ASSERTIONS: "enforce" });
    app = first.app;
    const page = first.win;
    const sessionRef = await signIn(page);
    const caps = (await page.evaluate(async () => (window as any).playwrightFlowStudio.visualAssertions.capabilities())) as any;
    check("capabilities: packaged build, enforce unavailable", caps?.appMode === "packaged" && caps.enforceAvailable === false, JSON.stringify(caps));
    const surface = (await page.evaluate(() => ({
      top: Object.keys((window as any).playwrightFlowStudio),
      visual: Object.keys((window as any).playwrightFlowStudio.visualAssertions).sort()
    }))) as { top: string[]; visual: string[] };
    check("the preload exposes no calibration or grant surface", !surface.top.some((k) => /calibrat|grant/i.test(k)) && !surface.visual.some((k) => /calibrat|grant/i.test(k)), JSON.stringify(surface));

    await navClick(page, "Flow Designer");
    await page.getByRole("button", { name: "Saved flow" }).click();
    await page.getByRole("option", { name: "VA packaged flow" }).click();
    await page.getByText("Assert enforce", { exact: true }).first().click();
    const section = page.getByTestId("visual-assertion-section");
    await section.waitFor({ state: "visible", timeout: 20_000 });
    const enforceUi = await page.evaluate(() => {
      const select = document.querySelector('[data-testid="visual-assertion-mode"]') as HTMLSelectElement | null;
      const warning = document.querySelector('[data-testid="visual-assertion-enforce-unavailable"]');
      return {
        value: select?.value,
        options: [...(select?.options ?? [])].map((o) => `${o.value}:${o.disabled ? "disabled" : "enabled"}`),
        warning: (warning?.textContent ?? "").replace(/\s+/g, " ").trim()
      };
    });
    check("an imported enforce step reads enforce, with enforce offered only as a disabled option", enforceUi.value === "enforce" && enforceUi.options.includes("enforce:disabled") && enforceUi.options.includes("observe:enabled"), JSON.stringify(enforceUi.options));
    check("...and shows its unavailable state with the fail-closed reason", /unavailable in this build/i.test(enforceUi.warning) && /enforce-unavailable-in-production/.test(enforceUi.warning), enforceUi.warning);
    await page.getByText("Assert observe", { exact: true }).first().click();
    await page.waitForFunction(() => (document.querySelector('[data-testid="visual-assertion-mode"]') as HTMLSelectElement | null)?.value === "observe", undefined, { timeout: 10_000 });
    const observeOptions = await page.evaluate(() => [...((document.querySelector('[data-testid="visual-assertion-mode"]') as HTMLSelectElement | null)?.options ?? [])].map((o) => o.value));
    check("an observe step is offered observe only (enforce is never offered in the packaged build)", observeOptions.length === 1 && observeOptions[0] === "observe", JSON.stringify(observeOptions));

    console.log("\nC. Real runs on the bundled Chromium");
    const unlicensed = await license(page, sessionRef, workDir);
    if (unlicensed) {
      block("the imported enforce step fails closed at run time", unlicensed);
      block("an ordinary workflow runs with every visual flag unset", unlicensed);
      return;
    }
    const enforced = await runAndReport(page, "va-pkg-workflow");
    if ("refused" in enforced) {
      check("the visual workflow was admitted", false, enforced.refused);
    } else {
      const records = (enforced.instances[0]?.visualAssertions ?? []) as any[];
      const enforceRecord = records.find((r) => r.stepId === "va-enforce");
      const observeRecord = records.find((r) => r.stepId === "va-observe");
      check(
        "with flag enforce the imported enforce step fails visual-unverified / enforce-unavailable-in-production",
        enforceRecord?.status === "failed" && enforceRecord.failureClass === "visual-unverified" && enforceRecord.code === "enforce-unavailable-in-production",
        JSON.stringify(enforceRecord)
      );
      check("...and the observe step is evaluated observe-only and passes", observeRecord?.status === "passed" && observeRecord.appMode === "packaged", JSON.stringify(observeRecord));
      check(
        "the run used the bundled Chromium",
        enforced.live.length > 0 && enforced.live.every((i) => i.config?.browserDistribution === "bundledChromium"),
        JSON.stringify(enforced.live.map((i) => i.config?.browserDistribution))
      );
    }
    await app.close().catch(() => undefined);
    app = undefined;

    console.log("\nC2. Relaunched with every visual flag unset");
    const second = await launch(localAppData, {});
    app = second.app;
    const page2 = second.win;
    await signIn(page2);
    const plain = await runAndReport(page2, "plain-pkg-workflow");
    if ("refused" in plain) check("an ordinary workflow is admitted", false, plain.refused);
    else {
      check("an ordinary workflow passes with every visual flag unset", plain.status === "passed", plain.status);
      check("...and its report carries no visual assertion block", plain.instances.every((i) => i.visualAssertions === undefined));
    }
    const offFlag = await runAndReport(page2, "va-pkg-workflow");
    if ("refused" in offFlag) check("the visual workflow is admitted with the flag off", false, offFlag.refused);
    else {
      const rec = (offFlag.instances[0]?.visualAssertions ?? []).find((r: any) => r.stepId === "va-enforce");
      check("with the flag unset the enforce step still fails closed (enforce-unavailable-in-production)", rec?.status === "failed" && rec.code === "enforce-unavailable-in-production", JSON.stringify(rec));
    }
  } finally {
    await app?.close().catch(() => undefined);
    server.kill();
    cleanupMintedArtifacts(workDir);
  }
}

async function main(): Promise<void> {
  console.log("N6 packaged acceptance (dist/win-unpacked)\n\nPreconditions:");
  if (!existsSync(exePath) || !existsSync(asarPath)) {
    console.error(`  NOT RUN: ${exePath} is missing. Run npm run package:portable first.`);
    process.exit(2);
  }
  const stale = await stalePackagedPayload(root);
  if (stale) {
    console.error(`  NOT RUN: the packaged payload is older than the source (${stale}). Run npm run package:portable first.`);
    process.exit(2);
  }
  check("the packaged payload is current", true);
  inspectAsar();
  try {
    await packagedApp();
  } catch (error) {
    failed += 1;
    console.error(`  ✗ unexpected error — ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`\nverify:visual-assertion-packaged — ${passed} passed, ${failed} failed, ${blocked} blocked`);
  process.exit(failed > 0 ? 1 : blocked > 0 ? 3 : 0);
}

void main();
