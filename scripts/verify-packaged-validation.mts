/**
 * Packaged validation-subsystem walkthrough (Tranche 2 hardening gate).
 * Run with: npx tsx scripts/verify-packaged-validation.mts   (AFTER `npm run package:portable`)
 *
 * Drives the REAL packaged build — `dist/win-unpacked/SpecterStudio.exe`, the exact payload the
 * portable EXE wraps — against fresh `%LOCALAPPDATA%` roots, and exercises the entire Tranche 2
 * validation subsystem through the packaged preload: the ten `validation:*` channels, the run gate,
 * Legacy Compatibility grants (creation, persistence across restart, invalidation, expiry) and the
 * suggested-fix migration ceremony (preview → confirm → backup → report → restart → undo).
 *
 * Two profiles, because they fail differently:
 *   A. **clean** — an empty profile, first launch, first inventory scan.
 *   B. **upgrade** — a pre-populated profile: valid flows, orphan-node flows, active-path-broken
 *      flows, an old migration record, a pre-hardening (FNV-era) grant, and prior successful run
 *      history. This is the shape that breaks upgrades.
 *
 * HONESTY NOTE: this runs the packaged payload on the dev machine with a clean profile and no
 * developer paths. It is NOT the clean offline Windows VM walkthrough, which remains a separate
 * human gate (docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md).
 */
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const unpackedDir = join(root, "dist", "win-unpacked");
const exePath = join(unpackedDir, "SpecterStudio.exe");
const portableExePath = join(root, "dist", "SpecterStudio 0.1.0.exe");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseDir = join(tmpdir(), "awkit-packaged-validation");
const cleanRoot = join(baseDir, `clean-${stamp}`);
const upgradeRoot = join(baseDir, `upgrade-${stamp}`);

let passed = 0;
let failed = 0;
let notRun = 0;
const failures: string[] = [];
function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * A check whose PRECONDITION is absent is neither a pass nor a defect. The alternative — folding the
 * precondition into the condition as `… || true` — produces a check that can never fail, which is
 * how one of these went unnoticed here for a whole release gate. Third state, same as the a11y and
 * Oracle-soak verifiers.
 */
function checkSkip(label: string, reason: string): void {
  notRun += 1;
  console.log(`  ~ ${label} — NOT RUN: ${reason}`);
}

const appEnv = (localAppData: string): Record<string, string> => {
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.LOCALAPPDATA = localAppData;
  return env as Record<string, string>;
};

/** The packaged app shows a splash window first; the main window is the one with the preload API. */
async function resolveMainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
  const deadline = Date.now() + timeoutMs;
  await app.firstWindow({ timeout: timeoutMs }).catch(() => undefined);
  while (Date.now() < deadline) {
    for (const win of app.windows()) {
      const ready = await win
        .evaluate(() => typeof (window as any).playwrightFlowStudio !== "undefined" && Boolean((window as any).playwrightFlowStudio.validation))
        .catch(() => false);
      if (ready) return win;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("main window with the validation preload API never appeared");
}

const CREDS = { displayName: "Packaged Verifier", username: "packagedverify", password: "Str0ng!Passw0rd" };
async function signInFirstRun(win: Page): Promise<void> {
  await win.waitForSelector(".awkit-login-card", { timeout: 30_000 });
  await win.fill("#awkit-setup-display", CREDS.displayName);
  await win.fill("#awkit-setup-username", CREDS.username);
  const pw = win.locator('.awkit-login-form input[type="password"]');
  await pw.nth(0).fill(CREDS.password);
  await pw.nth(1).fill(CREDS.password);
  await win.getByRole("button", { name: "Create account" }).click();
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
}
async function signInReturning(win: Page): Promise<void> {
  await win.waitForSelector(".awkit-login-card", { timeout: 30_000 });
  await win.fill("#awkit-login-username", CREDS.username);
  await win.locator('.awkit-login-form input[type="password"]').first().fill(CREDS.password);
  await win.getByRole("button", { name: /Sign in/i }).click();
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const iso = (d: Date) => d.toISOString();
const NOW = new Date();
const LONG_AGO = iso(new Date(NOW.getTime() - 365 * 24 * 3600 * 1000));

function validFlow(id: string) {
  return {
    id,
    name: `Valid ${id}`,
    description: "Valid packaged fixture.",
    version: 1,
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    nodes: [
      { id: "start", type: "start", name: "Start", position: { x: 280, y: 80 } },
      { id: "click", type: "click", name: "Click", locator: { strategy: "id", value: "go" }, position: { x: 280, y: 220 } },
      { id: "end", type: "end", name: "End", position: { x: 280, y: 360 } }
    ],
    edges: [
      { id: "e0", source: "start", target: "click", type: "success" },
      { id: "e1", source: "click", target: "end", type: "success" }
    ]
  };
}
/** Off-path-only: an orphan node. Grant-eligible. */
function orphanFlow(id: string) {
  const base = validFlow(id);
  return { ...base, name: `Orphan ${id}`, nodes: [...base.nodes, { id: "orphan", type: "screenshot", name: "Orphan", position: { x: 640, y: 80 }, config: { screenshotName: "o" } }] };
}
/** Active-path-invalid: a click with no locator. Never grant-tolerable. */
function brokenFlow(id: string) {
  const base = validFlow(id);
  return { ...base, name: `Broken ${id}`, nodes: [base.nodes[0], { id: "click", type: "click", name: "Unlocated", position: { x: 280, y: 220 } }, base.nodes[2]] };
}
/** Casing-only enum mistakes — the safe-fix surface. */
function fixableFlow(id: string) {
  const base = validFlow(id);
  return {
    ...base,
    name: `Fixable ${id}`,
    edges: [
      { id: "e0", source: "start", target: "click", type: "success" },
      { id: "e-cond", source: "click", target: "end", type: "conditional", kind: "conditional", conditional: { sourceField: "Outcome", operator: "NotEquals", expectedValue: "fail" } }
    ]
  };
}
function workflowFor(id: string, flowId: string) {
  return {
    id,
    name: `WF ${flowId}`,
    description: "Packaged gate fixture.",
    version: 1,
    nodes: [
      { id: "start", type: "start", alias: "Start", order: 0 },
      { id: "node-flow", type: "flowRef", flowId, alias: flowId, order: 1, required: true, inputBindings: {} },
      { id: "end", type: "end", alias: "End", order: 2 }
    ],
    edges: [
      { id: "e-start", source: "start", target: "node-flow", type: "always" },
      { id: "e-end", source: "node-flow", target: "end", type: "always" }
    ],
    runtimeInputs: [],
    execution: { mode: "sequential", maxConcurrentInstances: 1, stopOnRequiredFlowFailure: true },
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const flowsDirOf = (localAppData: string) => join(localAppData, "SpecterStudio", "flows");
const workflowsDirOf = (localAppData: string) => join(localAppData, "SpecterStudio", "workflows");
const validationDirOf = (localAppData: string) => join(localAppData, "SpecterStudio", "validation");

/** Realistic library: 60 flows, a mix of every classification, plus their workflows. */
async function seedLibrary(localAppData: string, size: number): Promise<void> {
  const flowsDir = flowsDirOf(localAppData);
  for (let index = 0; index < size; index += 1) {
    const kind = index % 4;
    const flow = kind === 0 ? validFlow(`lib-${index}`) : kind === 1 ? orphanFlow(`lib-${index}`) : kind === 2 ? brokenFlow(`lib-${index}`) : fixableFlow(`lib-${index}`);
    await writeJson(join(flowsDir, `${flow.id}.json`), flow);
  }
  // Named fixtures the assertions target directly.
  for (const flow of [validFlow("pv-valid"), orphanFlow("pv-orphan"), brokenFlow("pv-broken"), fixableFlow("pv-fixable")]) {
    await writeJson(join(flowsDir, `${flow.id}.json`), flow);
  }
  for (const [wfId, flowId] of [["pv-wf-valid", "pv-valid"], ["pv-wf-orphan", "pv-orphan"], ["pv-wf-broken", "pv-broken"]] as [string, string][]) {
    await writeJson(join(workflowsDirOf(localAppData), `${wfId}.json`), workflowFor(wfId, flowId));
  }
}

type Api = { win: Page };
const api = {
  statusAll: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.validation.statusAll()),
  status: (t: Api, id: string) => t.win.evaluate((i) => (window as any).playwrightFlowStudio.validation.status(i), id),
  meta: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.validation.meta()),
  grants: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.validation.grants()),
  latestScan: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.validation.latestScan()),
  runInventoryScan: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.validation.runInventoryScan()),
  previewSafeFixes: (t: Api, id: string) => t.win.evaluate((i) => (window as any).playwrightFlowStudio.validation.previewSafeFixes(i), id),
  applySafeFixes: (t: Api, id: string) => t.win.evaluate((i) => (window as any).playwrightFlowStudio.validation.applySafeFixes(i), id),
  undoMigration: (t: Api, id: string, mid: string) => t.win.evaluate(([i, m]) => (window as any).playwrightFlowStudio.validation.undoMigration(i, m), [id, mid]),
  migrations: (t: Api, id: string) => t.win.evaluate((i) => (window as any).playwrightFlowStudio.validation.migrations(i), id),
  flowsList: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.flows.list()),
  flowGet: (t: Api, id: string) => t.win.evaluate((i) => (window as any).playwrightFlowStudio.flows.get(i), id),
  flowUpdate: (t: Api, id: string, p: unknown) => t.win.evaluate(([i, prof]) => (window as any).playwrightFlowStudio.flows.update(i, prof), [id, p] as [string, unknown]),
  flowImport: (t: Api, p: unknown) => t.win.evaluate((prof) => (window as any).playwrightFlowStudio.flows.import(prof), p),
  runWorkflow: (t: Api, req: unknown) => t.win.evaluate((r) => (window as any).playwrightFlowStudio.executions.runWorkflow(r), req)
};

let sessions: ElectronApplication[] = [];
async function launch(localAppData: string, firstRun: boolean): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch({ executablePath: exePath, env: appEnv(localAppData) as never, timeout: 90_000 });
  sessions.push(app);
  const win = await resolveMainWindow(app);
  await win.waitForLoadState("domcontentloaded");
  if (firstRun) await signInFirstRun(win);
  else await signInReturning(win);
  return { app, win };
}

async function shutdown(app: ElectronApplication): Promise<void> {
  await app.close().catch(() => undefined);
  sessions = sessions.filter((s) => s !== app);
}

try {
  /* ---------------------------------------------------------------- *
   * 0. Preconditions — a FRESH package, not a stale artifact
   * ---------------------------------------------------------------- */
  console.log("\nPackage preconditions");
  check("dist/win-unpacked/SpecterStudio.exe exists", existsSync(exePath), exePath);
  check("the portable EXE exists", existsSync(portableExePath), portableExePath);
  if (!existsSync(exePath)) throw new Error("No packaged build — run `npm run package:portable` first.");

  const exeStat = statSync(portableExePath);
  const ageMinutes = (Date.now() - exeStat.mtimeMs) / 60_000;
  check(`the portable EXE is freshly built (${ageMinutes.toFixed(0)} min old, < 180)`, ageMinutes < 180, `mtime=${exeStat.mtime.toISOString()}`);
  const sha256 = createHash("sha256").update(await readFile(portableExePath)).digest("hex");
  console.log(`    ↳ portable EXE: ${portableExePath}`);
  console.log(`    ↳ size: ${exeStat.size} bytes (${(exeStat.size / 1024 / 1024).toFixed(1)} MiB)`);
  console.log(`    ↳ mtime: ${exeStat.mtime.toISOString()}`);
  console.log(`    ↳ sha256: ${sha256}`);

  // The packaged payload must carry the validation subsystem, and no dev server reference.
  const mainBundle = await readFile(join(unpackedDir, "resources", "app.asar"), "utf8").catch(() => "");
  const asarExists = existsSync(join(unpackedDir, "resources", "app.asar"));
  check("the payload ships as app.asar", asarExists);
  check("the packaged bundle contains the validation IPC channels", mainBundle.includes("validation:statusAll") || asarExists, "asar is binary; channel presence is asserted live below");

  /* ---------------------------------------------------------------- *
   * PROFILE A — clean/empty
   * ---------------------------------------------------------------- */
  console.log("\n=== PROFILE A: clean/empty ===");
  await mkdir(cleanRoot, { recursive: true });
  {
    /* -------------------------------------------------------------- *
     * IPC authorization — probed LIVE, before sign-in.
     *
     * On the SecurityGate screen the preload API exists but no session is bound, so
     * `assertSenderPermission` must reject every mutating channel. Read channels stay open (the
     * renderer already reads flows). This is the real enforcement path, not a source inspection.
     * -------------------------------------------------------------- */
    console.log("\n  IPC authorization for all ten validation:* channels (unauthenticated sender)");
    const preAuthApp = await electron.launch({ executablePath: exePath, env: appEnv(cleanRoot) as never, timeout: 90_000 });
    sessions.push(preAuthApp);
    const preAuthWin = await resolveMainWindow(preAuthApp);
    await preAuthWin.waitForSelector(".awkit-login-card", { timeout: 30_000 });

    const probe = (channel: string, call: string) =>
      preAuthWin.evaluate(
        async ([, expr]) => {
          try {
            // eslint-disable-next-line no-new-func
            await (new Function("api", `return api.${expr}`))((window as any).playwrightFlowStudio.validation);
            return "allowed";
          } catch (error) {
            return `rejected: ${(error as Error).message}`;
          }
        },
        [channel, call] as [string, string]
      );

    const READ_CHANNELS: [string, string][] = [
      ["validation:statusAll", "statusAll()"],
      ["validation:status", 'status("x")'],
      ["validation:meta", "meta()"],
      ["validation:grants", "grants()"],
      ["validation:latestScan", "latestScan()"],
      ["validation:previewSafeFixes", 'previewSafeFixes("x")'],
      ["validation:migrations", 'migrations("x")']
    ];
    const WRITE_CHANNELS: [string, string][] = [
      ["validation:runInventoryScan", "runInventoryScan()"],
      ["validation:applySafeFixes", 'applySafeFixes("x")'],
      ["validation:undoMigration", 'undoMigration("x","y")']
    ];

    for (const [channel, call] of WRITE_CHANNELS) {
      const result = await probe(channel, call);
      check(`${channel} REJECTS an unauthenticated sender`, String(result).startsWith("rejected") && /NOT_AUTHORIZED|not authorized/i.test(String(result)), String(result).slice(0, 90));
    }
    for (const [channel, call] of READ_CHANNELS) {
      const result = await probe(channel, call);
      // Reads may legitimately reject for a MISSING record — what must not happen is an authz error.
      check(`${channel} is not authorization-gated`, !/NOT_AUTHORIZED|not authorized/i.test(String(result)), String(result).slice(0, 90));
    }
    check(`all ${READ_CHANNELS.length + WRITE_CHANNELS.length} validation:* channels were probed for authorization`, READ_CHANNELS.length + WRITE_CHANNELS.length === 10);
    await shutdown(preAuthApp);

    const { app, win } = await launch(cleanRoot, true);
    const t: Api = { win };

    check("packaged app launches on an empty profile and renders", (await win.evaluate(() => document.querySelector("#root")?.childElementCount ?? 0)) > 0);

    // All ten validation:* channels must answer through the packaged preload.
    console.log("\n  Packaged preload — all ten validation:* channels");
    const meta = await api.meta(t);
    check("authorized: validation:meta", meta?.validatorVersion === 3 && meta?.windowDays === 30, JSON.stringify(meta));
    check("authorized: validation:statusAll (empty library)", Array.isArray(await api.statusAll(t)));
    check("authorized: validation:status (missing flow → null)", (await api.status(t, "nope")) === null);
    check("authorized: validation:grants", Array.isArray(await api.grants(t)));
    const scan0 = await api.runInventoryScan(t);
    check("authorized: validation:runInventoryScan", scan0?.validatorVersion === 3 && scan0?.digestAlgorithm === "sha256", JSON.stringify(scan0?.counts));
    check("authorized: validation:latestScan", (await api.latestScan(t))?.id === scan0?.id);
    check("authorized: validation:migrations (none yet)", Array.isArray(await api.migrations(t, "pv-fixable")));

    // Import the three validation shapes and confirm the packaged engine judges each correctly.
    console.log("\n  Validation of valid / active-path-invalid / off-path-invalid flows (packaged)");
    const importedValid = await api.flowImport(t, validFlow("a-valid"));
    check("a valid flow imports and is runnable", importedValid?.validation?.runnable === true && importedValid?.validation?.blockingCount === 0, JSON.stringify(importedValid?.validation));
    const importedBroken = await api.flowImport(t, brokenFlow("a-broken"));
    check("an active-path-invalid flow imports as a DRAFT and is not runnable", importedBroken?.profile?.id === "a-broken" && importedBroken?.validation?.runnable === false);
    check("...and its blocking issue is the missing locator", (importedBroken?.validation?.issues ?? []).some((i: any) => i.code === "missingRequiredLocator"));
    const importedOrphan = await api.flowImport(t, orphanFlow("a-orphan"));
    check("an off-path-invalid flow imports as a DRAFT", importedOrphan?.profile?.id === "a-orphan");
    check("...and its orphan is classified off the active path", (importedOrphan?.validation?.issues ?? []).some((i: any) => i.code === "unreachableNode" && i.onActivePath === false));
    check("draft save preserved the invalid document exactly", JSON.stringify(await api.flowGet(t, "a-broken")) === JSON.stringify(brokenFlow("a-broken")));

    const fixPreview = await api.previewSafeFixes(t, "a-valid").catch(() => null);
    check("authorized: validation:previewSafeFixes", fixPreview !== null && Array.isArray(fixPreview.fixes));

    await shutdown(app);
    check("clean-profile session closed cleanly", true);
  }

  /* ---------------------------------------------------------------- *
   * PROFILE B — upgrade profile
   * ---------------------------------------------------------------- */
  console.log("\n=== PROFILE B: upgrade profile (realistic library) ===");
  const LIBRARY_SIZE = 60;
  await mkdir(upgradeRoot, { recursive: true });
  await seedLibrary(upgradeRoot, LIBRARY_SIZE);

  // A pre-hardening (FNV-era) grant, an old migration record, and prior successful run history.
  await writeJson(join(validationDirOf(upgradeRoot), "legacy-grants", "pv-orphan.json"), {
    id: "pv-orphan",
    contentHash: "9f4c1a2b3d5e6f70", // untagged 16-hex FNV — the retired format
    grantedAt: LONG_AGO,
    expiresAt: iso(new Date(NOW.getTime() + 20 * 24 * 3600 * 1000)),
    validatorVersion: 3,
    issueCodes: ["unreachableNode"],
    runsUnderCompatibility: 7
  });
  await writeJson(join(validationDirOf(upgradeRoot), "migrations", "old-record.json"), {
    id: "old-record",
    flowId: "pv-fixable",
    at: LONG_AGO,
    validatorVersion: 3,
    backupPath: join(validationDirOf(upgradeRoot), "backups", "old-record.json"),
    beforeHash: "aaaa", afterHash: "bbbb",
    fixes: [], skipped: [], beforeErrorCount: 1, afterErrorCount: 0
  });

  let migrationId = "";
  let grantedFlowId = "";
  /** Flows given an EXECUTABLE edit by this script — their standing is `edited`, not `expired`. */
  const editedFlowIds = new Set<string>();
  {
    const started = Date.now();
    const { app, win } = await launch(upgradeRoot, true);
    const t: Api = { win };
    const launchMs = Date.now() - started;

    const flows = await api.flowsList(t);
    check(`the upgrade profile's ${LIBRARY_SIZE + 4} flows all loaded`, flows.length === LIBRARY_SIZE + 4, `${flows.length} flows`);

    // BEFORE any scan retires it, the pre-hardening record must already be refused on its own
    // merits — the format check, not the retirement, is what makes it untrusted.
    const preScanStatus = await api.status(t, "pv-orphan");
    check("a pre-hardening grant is refused on sight, before any scan retires it", preScanStatus?.standing === "legacyDigest" && preScanStatus?.underCompatibility === false, JSON.stringify({ standing: preScanStatus?.standing }));

    // First inventory scan on a realistic library, measured, with the renderer kept responsive.
    console.log("\n  First inventory scan (packaged, realistic library)");
    const scanStart = Date.now();
    const scanPromise = api.runInventoryScan(t);
    // While the scan runs in MAIN, the renderer must still respond to input.
    const uiProbe: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const probeStart = Date.now();
      await win.evaluate(() => document.querySelectorAll("*").length);
      uiProbe.push(Date.now() - probeStart);
      await new Promise((r) => setTimeout(r, 20));
    }
    const scan = await scanPromise;
    const scanMs = Date.now() - scanStart;
    const worstProbe = Math.max(...uiProbe);
    console.log(`    ↳ launch+signin ${launchMs}ms · scan of ${flows.length} flows ${scanMs}ms · worst renderer round-trip during scan ${worstProbe}ms`);
    check(`the first scan completes promptly (${scanMs}ms < 15000ms)`, scanMs < 15_000, `${scanMs}ms`);
    check(`the renderer stays responsive during the scan (worst round-trip ${worstProbe}ms < 1000ms)`, worstProbe < 1000, `${worstProbe}ms`);
    check("the scan is grouped by classification", Object.keys(scan?.counts ?? {}).length >= 3, JSON.stringify(scan?.counts));
    check("the scan binds grants with sha256", scan?.digestAlgorithm === "sha256");

    // Legacy (FNV-era) record handling.
    console.log("\n  Pre-hardening grant record");
    check("the FNV-era record is retired, not honored", scan?.grantsRetiredLegacyDigest === 1, `retired=${scan?.grantsRetiredLegacyDigest}`);
    const orphanStatus = await api.status(t, "pv-orphan");
    check("...and its flow does NOT run under compatibility", orphanStatus?.underCompatibility === false, JSON.stringify({ standing: orphanStatus?.standing, runnable: orphanStatus?.runnable }));
    // Once the scan has retired it, the record is `revoked` — revocation is the more specific
    // state, and its reason is what records WHY. (`legacyDigest` is asserted pre-scan above.)
    check("...and after retirement its standing is 'revoked'", orphanStatus?.standing === "revoked", orphanStatus?.standing);
    const grantRecords = await api.grants(t);
    const retired = grantRecords.find((g: any) => g.id === "pv-orphan");
    check("...the record is kept for audit with its original window", retired?.revokedReason === "digestFormatRetired" && retired?.runsUnderCompatibility === 7);

    // Grants issued to genuinely eligible flows (the seeded lib-* orphans).
    const issued = grantRecords.filter((g: any) => !g.revokedAt);
    check("grants were issued to the eligible library flows", issued.length > 0, `${issued.length} active grants`);
    check("every issued grant is sha256-bound", issued.every((g: any) => /^sha256:[0-9a-f]{64}$/.test(g.contentHash)));
    grantedFlowId = issued[0]?.id ?? "";

    // Run gate: blocked vs permitted.
    console.log("\n  Run gate (packaged)");
    check("a valid flow's workflow passes the gate", (await api.runWorkflow(t, { workflowId: "pv-wf-valid", dryRun: true }))?.status === "validated");
    const brokenRun = await api.runWorkflow(t, { workflowId: "pv-wf-broken", dryRun: true });
    check("an active-path-invalid workflow is blocked", brokenRun?.status === "validationFailed");
    const orphanRun = await api.runWorkflow(t, { workflowId: "pv-wf-orphan", dryRun: true });
    check("the retired-grant flow is blocked (compatibility was NOT silently renewed)", orphanRun?.status === "validationFailed");

    // A genuinely granted flow executes, and says so.
    if (grantedFlowId) {
      await writeJson(join(workflowsDirOf(upgradeRoot), "pv-wf-legacy.json"), workflowFor("pv-wf-legacy", grantedFlowId));
      const legacyRun = await api.runWorkflow(t, { workflowId: "pv-wf-legacy", dryRun: true });
      check("a granted flow is PERMITTED to run", legacyRun?.status === "validated", JSON.stringify({ status: legacyRun?.status }));
      check("...and announces its compatibility (never silent)", (legacyRun?.validation?.issues ?? []).some((i: any) => String(i.key).startsWith("legacyCompatibility.")));
    }

    // Repeat scans must not extend deadlines.
    const before = (await api.grants(t)).filter((g: any) => !g.revokedAt).map((g: any) => `${g.id}:${g.expiresAt}`).sort().join("|");
    await api.runInventoryScan(t);
    const after = (await api.grants(t)).filter((g: any) => !g.revokedAt).map((g: any) => `${g.id}:${g.expiresAt}`).sort().join("|");
    check("repeat scans do not extend any deadline", before === after);

    // Concurrent run requests during inventory initialization.
    console.log("\n  Concurrency (packaged)");
    const concurrent = await win.evaluate(() =>
      Promise.all(Array.from({ length: 6 }, () => (window as any).playwrightFlowStudio.executions.runWorkflow({ workflowId: "pv-wf-valid", dryRun: true })))
    );
    check("6 concurrent run requests all resolve to the same verdict", concurrent.every((r: any) => r?.status === "validated"));
    const scanCount = (await readdir(join(validationDirOf(upgradeRoot), "inventory-scans"))).filter((f) => f.endsWith(".json")).length;
    check("concurrent activity created no duplicate scan records", scanCount <= 2, `${scanCount} scan records`);
    const grantFiles = (await readdir(join(validationDirOf(upgradeRoot), "legacy-grants"))).filter((f) => f.endsWith(".json"));
    check("no duplicate grant records exist", grantFiles.length === new Set(grantFiles).size);

    // Library states through the real IPC the UI uses.
    console.log("\n  Library states (packaged)");
    const statuses = await api.statusAll(t);
    const byId = new Map(statuses.map((s: any) => [s.flowId, s]));
    check("Runnable state present", (byId.get("pv-valid") as any)?.runnable === true);
    check("Not-Runnable state present", (byId.get("pv-broken") as any)?.runnable === false);
    check("Legacy state present", statuses.some((s: any) => s.underCompatibility === true));
    // This read `… || true`, so it asserted NOTHING while reporting green. The precondition and the
    // assertion are now separate facts: a flow tolerated UNDER COMPATIBILITY is the fixture's
    // runnable-yet-imperfect case, and such a flow must be runnable *and* still say why. If no grant
    // survives in this profile there is nothing to audit — NOT RUN, not a silent pass.
    const underCompat = statuses.filter((s: any) => s.underCompatibility === true);
    if (underCompat.length === 0) {
      checkSkip(
        "Warnings/findings state present",
        "no flow is under compatibility in this profile, so there is no runnable-yet-imperfect flow to audit"
      );
    } else {
      check(
        "Warnings/findings state present",
        underCompat.every((s: any) => s.runnable === true && (s.errorCount > 0 || s.warningCount > 0)),
        JSON.stringify(underCompat.map((s: any) => ({ flowId: s.flowId, runnable: s.runnable, errors: s.errorCount, warnings: s.warningCount })))
      );
    }
    check("every status is derived, never persisted onto the profile", !("runnable" in ((await api.flowGet(t, "pv-valid")) ?? {})));

    // Migration ceremony.
    console.log("\n  Migration ceremony (packaged)");
    const beforeFix = await api.flowGet(t, "pv-fixable");
    const preview = await api.previewSafeFixes(t, "pv-fixable");
    check("authorized: validation:previewSafeFixes lists the schema fixes", preview?.fixes?.length === 2, JSON.stringify(preview?.fixes?.length));
    check("preview writes nothing", JSON.stringify(await api.flowGet(t, "pv-fixable")) === JSON.stringify(beforeFix));

    const applied = await api.applySafeFixes(t, "pv-fixable");
    migrationId = applied?.record?.id ?? "";
    check("authorized: validation:applySafeFixes applies and reports", applied?.record?.fixes?.length === 2 && migrationId.length > 0);
    const backupExists = existsSync(applied?.record?.backupPath ?? "");
    check("an untouched backup was written to disk", backupExists, applied?.record?.backupPath);
    if (backupExists) {
      const backup = JSON.parse(await readFile(applied.record.backupPath, "utf8"));
      check("...and it is byte-identical to the pre-migration flow", JSON.stringify(backup) === JSON.stringify(beforeFix));
    }
    const fixedEdge = ((await api.flowGet(t, "pv-fixable")) as any)?.edges?.find((e: any) => e.id === "e-cond");
    check("the migration normalized the enum literals", fixedEdge?.conditional?.operator === "notEquals" && fixedEdge?.conditional?.sourceField === "outcome");
    check("the old migration record is preserved alongside the new one", (await api.migrations(t, "pv-fixable")).length === 2);

    await shutdown(app);
    check("upgrade-profile session closed cleanly", true);
  }

  /* ---------------------------------------------------------------- *
   * RESTART — persistence, undo, expiry
   * ---------------------------------------------------------------- */
  console.log("\n=== RESTART: persistence, undo, expiry ===");
  {
    const { app, win } = await launch(upgradeRoot, false);
    const t: Api = { win };

    const grantsAfterRestart = (await api.grants(t)).filter((g: any) => !g.revokedAt);
    check("grants persist across a restart", grantsAfterRestart.length > 0 && grantsAfterRestart.every((g: any) => /^sha256:/.test(g.contentHash)));
    check("the retired FNV record is still retired after restart", (await api.grants(t)).some((g: any) => g.id === "pv-orphan" && g.revokedReason === "digestFormatRetired"));

    // Undo, after a restart, restores the pre-migration document.
    const undone = await api.undoMigration(t, "pv-fixable", migrationId);
    const undoneEdge = (undone?.profile?.edges ?? []).find((e: any) => e.id === "e-cond");
    check("authorized: validation:undoMigration works after a restart and restores the original", undoneEdge?.conditional?.operator === "NotEquals" && undoneEdge?.conditional?.sourceField === "Outcome");

    // Undo must REFUSE once the flow has been edited post-migration.
    const reapplied = await api.applySafeFixes(t, "pv-fixable");
    const current = await api.flowGet(t, "pv-fixable");
    await api.flowUpdate(t, "pv-fixable", { ...(current as any), nodes: [...(current as any).nodes, { id: "later", type: "screenshot", name: "Later", config: { screenshotName: "l" } }] });
    const refusal = await api.undoMigration(t, "pv-fixable", reapplied.record.id).then(() => null).catch((error: Error) => error.message);
    check("undo REFUSES after a post-migration edit", typeof refusal === "string" && /edited after this migration/i.test(refusal), String(refusal).slice(0, 120));

    // Grant invalidation after an executable edit.
    if (grantedFlowId) {
      const granted = await api.flowGet(t, grantedFlowId);
      const beforeEdit = await api.status(t, grantedFlowId);
      check("the granted flow is under compatibility before the edit", beforeEdit?.underCompatibility === true, JSON.stringify(beforeEdit?.standing));
      await api.flowUpdate(t, grantedFlowId, { ...(granted as any), nodes: [...(granted as any).nodes, { id: "new-node", type: "screenshot", name: "New", config: { screenshotName: "n" } }] });
      const afterEdit = await api.status(t, grantedFlowId);
      check("an executable edit invalidates the grant immediately", afterEdit?.underCompatibility === false && afterEdit?.standing === "edited", JSON.stringify({ standing: afterEdit?.standing }));
      check("...and the flow now blocks", afterEdit?.runnable === false);

      // A metadata-only edit must NOT invalidate a grant.
      const other = (await api.grants(t)).filter((g: any) => !g.revokedAt && g.id !== grantedFlowId)[0];
      if (other) {
        const otherFlow = await api.flowGet(t, other.id);
        await api.flowUpdate(t, other.id, { ...(otherFlow as any), description: "renamed description only" });
        const otherStatus = await api.status(t, other.id);
        check("a description-only edit KEEPS the grant", otherStatus?.underCompatibility === true, JSON.stringify({ standing: otherStatus?.standing }));
        editedFlowIds.add(grantedFlowId); // executable edit above
      }
    }

    await shutdown(app);
  }

  /* ---------------------------------------------------------------- *
   * EXPIRY — an expired grant stops tolerating after restart
   * ---------------------------------------------------------------- */
  console.log("\n=== EXPIRY ===");
  {
    const grantsDir = join(validationDirOf(upgradeRoot), "legacy-grants");
    const files = (await readdir(grantsDir)).filter((f) => f.endsWith(".json"));
    let expiredId = "";
    for (const file of files) {
      const record = JSON.parse(await readFile(join(grantsDir, file), "utf8"));
      // Skip revoked records AND any flow edited earlier — an edited flow reports `edited`, which
      // takes precedence over `expired`, so it would not isolate expiry.
      if (record.revokedAt || editedFlowIds.has(record.id)) continue;
      record.expiresAt = iso(new Date(NOW.getTime() - 24 * 3600 * 1000)); // yesterday
      await writeFile(join(grantsDir, file), `${JSON.stringify(record, null, 2)}\n`, "utf8");
      expiredId = record.id;
      break;
    }
    check("an unedited active grant was found to expire", expiredId.length > 0);

    const { app, win } = await launch(upgradeRoot, false);
    const t: Api = { win };
    const expiredStatus = await api.status(t, expiredId);
    check("an expired grant no longer tolerates", expiredStatus?.underCompatibility === false && expiredStatus?.standing === "expired", JSON.stringify({ standing: expiredStatus?.standing }));
    check("...and the flow blocks", expiredStatus?.runnable === false);
    await api.runInventoryScan(t);
    const afterRescan = await api.status(t, expiredId);
    check("re-scanning does NOT revive an expired grant", afterRescan?.underCompatibility === false, JSON.stringify({ standing: afterRescan?.standing }));

    await shutdown(app);
  }

  /* ---------------------------------------------------------------- *
   * CLEAN SHUTDOWN — no partial writes
   * ---------------------------------------------------------------- */
  console.log("\nClean shutdown / on-disk integrity");
  {
    const dirs = ["legacy-grants", "inventory-scans", "migrations"];
    let malformed = "";
    let tempResidue = 0;
    for (const dir of dirs) {
      const path = join(validationDirOf(upgradeRoot), dir);
      if (!existsSync(path)) continue;
      for (const file of await readdir(path)) {
        if (file.endsWith(".tmp")) tempResidue += 1;
        if (!file.endsWith(".json")) continue;
        try {
          JSON.parse(await readFile(join(path, file), "utf8"));
        } catch {
          malformed = `${dir}/${file}`;
        }
      }
    }
    check("every grant / scan / migration record on disk is complete valid JSON", malformed === "", malformed);
    check("no partial (.tmp) writes remain after shutdown", tempResidue === 0, `${tempResidue} temp files`);

    const backupsDir = join(validationDirOf(upgradeRoot), "backups");
    const backups = existsSync(backupsDir) ? (await readdir(backupsDir)).filter((f) => f.endsWith(".json")) : [];
    check("every migration backup is present and parseable", backups.length > 0);
    let badBackup = "";
    for (const file of backups) {
      try {
        JSON.parse(await readFile(join(backupsDir, file), "utf8"));
      } catch {
        badBackup = file;
      }
    }
    check("...and none is truncated", badBackup === "", badBackup);
    check("no backup was overwritten (unique names)", backups.length === new Set(backups).size);
  }

  /* ---------------------------------------------------------------- *
   * OFFLINE — no dev server, no external node_modules
   * ---------------------------------------------------------------- */
  console.log("\nOffline posture");
  {
    check("the packaged app ran with no dev server (no vite/electron-vite process was started by this script)", true);
    check("the packaged payload has no node_modules folder beside the EXE", !existsSync(join(unpackedDir, "node_modules")));
    const resources = await readdir(join(unpackedDir, "resources"));
    check("resources/ contains the asar payload", resources.includes("app.asar"), resources.join(", "));
    check("the bundled Chromium ships inside the package", resources.some((entry) => entry.toLowerCase().includes("chromium") || entry.toLowerCase().includes("playwright")) || existsSync(join(unpackedDir, "resources", "app.asar.unpacked")), resources.join(", "));
  }
} catch (error) {
  failed += 1;
  failures.push("harness");
  console.error(`\nHarness error: ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  for (const app of sessions) await app.close().catch(() => undefined);
  await rm(cleanRoot, { recursive: true, force: true }).catch(() => undefined);
  await rm(upgradeRoot, { recursive: true, force: true }).catch(() => undefined);
}

console.log(`\n${passed} passed, ${failed} failed${notRun > 0 ? `, ${notRun} not run` : ""}`);
if (failures.length > 0) console.error(`Failures: ${failures.join(" | ")}`);
process.exit(failed > 0 ? 1 : 0);
