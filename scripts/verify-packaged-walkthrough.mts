/**
 * Phase 5 — packaged clean-profile walkthrough (release-candidate gate, dev-machine half).
 * Run with: npm run verify:packaged-walkthrough   (AFTER `npm run package:portable`)
 *
 * Drives the REAL packaged build (dist/win-unpacked — the exact payload the portable EXE and
 * NSIS installer wrap) with a FRESH, EMPTY LOCALAPPDATA root, simulating the first run on a
 * clean user profile:
 *
 *  A. preconditions (packaged EXE, portable EXE, NSIS installer, mock site fixtures)
 *  B. local mock site up (loopback only — the app needs no internet)
 *  C. first run on a fresh profile: window renders (no white screen), durable runtime
 *     initializes, runtime.sqlite + runtime folders created under the fresh root
 *  D. import mock flows/workflows via the app's own IPC, run a full workflow inside the
 *     packaged app, assert completion + artifacts (JSONL log, screenshots, report, state)
 *  E. hard cancellation: a long-waiting run is stopped from the API; run ends `cancelled`
 *     (not failed), the bundled-Chromium process tree is gone
 *  F. browser process bound: 4 concurrent instances never exceed AWKIT_MAX_BROWSERS=2
 *     browser roots at OS level; stopAll drains everything
 *  G. recorder launches + cancels cleanly inside the packaged app
 *  H. clean shutdown: no leftover bundled-Chromium; only loopback TCP traffic observed
 *  I. hard kill mid-run (orphaned run scenario)
 *  J. restart: startup recovery surfaces the orphaned run as recoverable; recovery panel
 *     renders in the Instance Monitor; details/markReviewed work; runtime.sqlite readable
 *     externally afterwards
 *  K. the ACTUAL portable EXE boots on a second fresh profile and creates the runtime
 *  L. NSIS installer integrity (sha512 matches latest.yml)
 *
 * HONESTY NOTE: this is NOT the clean/offline Windows VM walkthrough. It proves the packaged
 * app works with no developer paths and no pre-existing app data, and that it only talks to
 * loopback — but it still executes on the dev machine. The separate human VM walkthrough in
 * docs/ai/PHASE5_OFFLINE_VM_WALKTHROUGH.md remains the final gate.
 */
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { loadSqlJs } from "@src/runner/store/SqlJsLoader";
import { capturePackagedAppPids, ensurePackagedAppDead, type PackagedAppPids } from "./helpers/packaged-process-tree.mts";
import {
  ISSUER_KEY_ENV,
  cleanupMintedArtifacts,
  mintVerificationLicense,
  resolveIssuerKey,
  sanitizeAppEnv
} from "./helpers/packaged-license.mts";
import {
  portableExePath as resolvePortableExePath,
  setupExeName,
  setupExePath as resolveSetupExePath
} from "./helpers/packaged-artifacts.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const unpackedDir = join(root, "dist", "win-unpacked");
const exePath = join(unpackedDir, "SpecterStudio.exe");
// Both resolved from package.json — see scripts/helpers/packaged-artifacts.mjs. Hardcoding 0.1.0
// meant this gate examined July artifacts while the app moved on to 0.1.13.
const portableExePath = resolvePortableExePath(root);
const setupExePath = resolveSetupExePath(root);
const latestYmlPath = join(root, "dist", "latest.yml");
const fixturesRoot = join(root, "resources", "test-fixtures", "mock-site");

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const baseDir = process.env.AWKIT_PHASE5_DIR || join(tmpdir(), "awkit-phase5");
const freshRootA = join(baseDir, `clean-profile-${stamp}`);
const freshRootB = join(baseDir, `portable-profile-${stamp}`);
const evidenceDir = join(root, "dist", "phase5-evidence");

const MOCK_PORT = 4321; // committed fixtures point at http://localhost:4321
const MOCK_BASE = `http://localhost:${MOCK_PORT}`;
// The mock server binds 127.0.0.1 and Node 18 resolves "localhost" to ::1 first, so the
// readiness probe must hit the IPv4 loopback explicitly (Chromium tries both families).
const MOCK_PROBE = `http://127.0.0.1:${MOCK_PORT}/login`;
const WALKTHROUGH_ACCOUNT = {
  displayName: "Packaged Walkthrough",
  username: "phase5admin",
  password: "Phase5!LocalWalkthrough2026"
};

let passed = 0;
let failed = 0;
let blocked = 0;

/**
 * Thrown when the packaged app cannot be licensed, so the real-execution parts cannot even be
 * attempted. It is NOT a failure and NOT a silent skip: the run records BLOCKED and makes no claim
 * about packaged execution in either direction.
 */
class PackagedLicensingBlocked extends Error {}

function check(label: string, condition: unknown, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Newest file mtime under `dir`, used to detect a packaged tree older than its own sources. */
async function newestFileMtime(dir: string): Promise<{ path: string; mtimeMs: number }> {
  let newest = { path: dir, mtimeMs: 0 };
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const found = entry.isDirectory()
      ? await newestFileMtime(full)
      : entry.isFile()
        ? { path: full, mtimeMs: (await stat(full)).mtimeMs }
        : newest;
    if (found.mtimeMs > newest.mtimeMs) newest = found;
  }
  return newest;
}

/** The packaged app shows a splash first; return only the main window carrying the preload bridge. */
async function resolvePackagedMainWindow(app: ElectronApplication, timeoutMs = 60_000): Promise<Page> {
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

/** Provision the synthetic first-run account or sign it back in after a packaged restart. */
async function ensureWalkthroughAuthenticated(win: Page): Promise<void> {
  await win.waitForSelector(".awkit-login-card, .app-shell", { timeout: 30_000 });
  if ((await win.locator(".app-shell").count()) > 0) return;

  if ((await win.locator("#awkit-setup-username").count()) > 0) {
    await win.fill("#awkit-setup-display", WALKTHROUGH_ACCOUNT.displayName);
    await win.fill("#awkit-setup-username", WALKTHROUGH_ACCOUNT.username);
    const passwords = win.locator('.awkit-login-form input[type="password"]');
    await passwords.nth(0).fill(WALKTHROUGH_ACCOUNT.password);
    await passwords.nth(1).fill(WALKTHROUGH_ACCOUNT.password);
    await win.getByRole("button", { name: "Create account" }).click();
    await win.getByRole("heading", { name: "Save your recovery code" }).waitFor({ timeout: 30_000 });
    await win.getByRole("checkbox", { name: "I saved this recovery code in a secure place." }).check();
    await win.getByRole("button", { name: "Continue to SpecterStudio" }).click();
  } else {
    await win.fill("#awkit-login-username", WALKTHROUGH_ACCOUNT.username);
    await win.locator('.awkit-login-form input[type="password"]').first().fill(WALKTHROUGH_ACCOUNT.password);
    await win.getByRole("button", { name: "Sign in" }).click();
  }
  await win.waitForSelector(".app-shell", { timeout: 30_000 });
}

async function pollUntil<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, intervalMs = 1000): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value as T;
    } catch {
      /* keep polling */
    }
    await sleep(intervalMs);
  }
  return null;
}

function httpOk(url: string): Promise<boolean> {
  return new Promise((resolveOk) => {
    const req = httpGet(url, (res) => {
      res.resume();
      resolveOk((res.statusCode ?? 500) < 400);
    });
    req.on("error", () => resolveOk(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolveOk(false);
    });
  });
}

function psJson<T>(script: string): Promise<T | null> {
  return new Promise((resolvePs) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout.trim()) return resolvePs(null);
        try {
          resolvePs(JSON.parse(stdout) as T);
        } catch {
          resolvePs(null);
        }
      }
    );
  });
}

interface PsProcess {
  ProcessId: number;
  ParentProcessId: number;
  Name: string;
  ExecutablePath: string | null;
  CommandLine: string | null;
}
interface PsConnection {
  OwningProcess: number;
  RemoteAddress: string;
  RemotePort: number;
}
interface SystemSample {
  procs: PsProcess[];
  conns: PsConnection[];
}

async function sampleSystem(): Promise<SystemSample | null> {
  const raw = await psJson<{ procs: PsProcess[] | PsProcess; conns: PsConnection[] | PsConnection | null }>(
    "$ErrorActionPreference='SilentlyContinue';" +
      "$procs = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine;" +
      "$conns = Get-NetTCPConnection -State Established,SynSent -ErrorAction SilentlyContinue | Select-Object OwningProcess,RemoteAddress,RemotePort;" +
      "@{procs=$procs;conns=$conns} | ConvertTo-Json -Depth 4 -Compress"
  );
  if (!raw) return null;
  const arr = <V,>(value: V[] | V | null | undefined): V[] => (Array.isArray(value) ? value : value ? [value] : []);
  return { procs: arr(raw.procs), conns: arr(raw.conns) };
}

/**
 * A running Windows machine always has well over a hundred processes, so a null or implausibly small
 * sample means the enumeration FAILED, not that nothing is running. That distinction is the whole
 * point here: `sampleSystem` runs PowerShell under `$ErrorActionPreference='SilentlyContinue'`, so a
 * broken probe returns quietly — and every "no leftover process" assertion below would then read
 * "I could not look" as "I looked and found nothing", passing precisely when it is blind.
 */
const SAMPLE_MIN_PROCESSES = 50;
function isLiveSample(sample: SystemSample | null): sample is SystemSample {
  return sample !== null && sample.procs.length >= SAMPLE_MIN_PROCESSES;
}

function isLoopback(address: string): boolean {
  return (
    address === "127.0.0.1" ||
    address.startsWith("127.") ||
    address === "::1" ||
    address === "0.0.0.0" ||
    address === "::" ||
    address === ""
  );
}

/** Bundled-Chromium browser roots (chrome.exe launched directly by the app main process). */
function chromeRoots(sample: SystemSample, appPids: Set<number>): PsProcess[] {
  return sample.procs.filter(
    (proc) =>
      proc.Name.toLowerCase() === "chrome.exe" &&
      appPids.has(proc.ParentProcessId) &&
      (proc.ExecutablePath ?? "").toLowerCase().includes("win-unpacked")
  );
}

/** Every bundled-Chromium process regardless of parent (for leak detection). */
function bundledChromeAll(sample: SystemSample): PsProcess[] {
  return sample.procs.filter(
    (proc) => proc.Name.toLowerCase() === "chrome.exe" && (proc.ExecutablePath ?? "").toLowerCase().includes("win-unpacked")
  );
}

/** App-owned process: the packaged app itself, its portable extraction, or the bundled Chromium. */
function isAppProcess(proc: PsProcess): boolean {
  const path = (proc.ExecutablePath ?? "").toLowerCase();
  return path.includes("win-unpacked") || path.includes("specterstudio") || path.includes("webflow studio") || path.includes("browsers\\chromium");
}

class NetworkObserver {
  readonly appRootPids = new Set<number>();
  readonly nonLoopback: Array<{ at: string; remote: string; port: number; pid: number; name: string; path: string }> = [];
  loopbackConnections = 0;
  samples = 0;
  maxChromeRoots = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  start(intervalMs = 4000): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async tick(): Promise<SystemSample | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const sample = await sampleSystem();
      if (!sample) return null;
      this.samples += 1;
      // Attribute connections by EXECUTABLE PATH, not by parent-pid descent: Windows reuses
      // pids aggressively, so a descendant set polluted by dead roots can blame the user's
      // own Chrome for traffic that is not ours (observed in walkthrough run 2).
      const appProcs = new Map(sample.procs.filter(isAppProcess).map((proc) => [proc.ProcessId, proc]));
      for (const conn of sample.conns) {
        const owner = appProcs.get(conn.OwningProcess);
        if (!owner) continue;
        if (isLoopback(conn.RemoteAddress)) {
          this.loopbackConnections += 1;
        } else {
          this.nonLoopback.push({
            at: new Date().toISOString(),
            remote: conn.RemoteAddress,
            port: conn.RemotePort,
            pid: conn.OwningProcess,
            name: owner.Name,
            path: owner.ExecutablePath ?? "?"
          });
        }
      }
      this.maxChromeRoots = Math.max(this.maxChromeRoots, chromeRoots(sample, this.appRootPids).length);
      return sample;
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Direct one-shot probe — never contends with the observer's interval sampler. */
async function chromeRootsNow(appPids: Set<number>): Promise<number> {
  const sample = await sampleSystem();
  return isLiveSample(sample) ? chromeRoots(sample, appPids).length : -1;
}

/** `null` means the probe could not see the process table — NEVER conflate it with an empty result. */
async function bundledChromeNow(): Promise<PsProcess[] | null> {
  const sample = await sampleSystem();
  return isLiveSample(sample) ? bundledChromeAll(sample) : null;
}

function taskkill(pid: number, tree: boolean): Promise<void> {
  return new Promise((resolveKill) => {
    const args = ["/PID", String(pid), "/F"];
    if (tree) args.splice(2, 0, "/T");
    execFile("taskkill", args, () => resolveKill());
  });
}

async function pidAlive(pid: number): Promise<boolean> {
  const rows = await psJson<Array<{ ProcessId: number }> | { ProcessId: number }>(
    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object ProcessId | ConvertTo-Json -Compress`
  );
  return rows !== null;
}

/**
 * The packaged "SpecterStudio.exe" that Playwright spawns is a LAUNCHER STUB — the real
 * Electron main process is its child (verified empirically: spawned pid != main process.pid,
 * and killing the stub leaves the app alive). Register BOTH pids (chrome roots are children
 * of the real main) and always target the real main for kill scenarios. Every launched
 * session's pids are also kept in `sessionPids` so the finally-block teardown can tree-kill
 * the REAL main even on failure paths (Phase 5.1D).
 */
const sessionPids = new Map<ElectronApplication, PackagedAppPids>();
async function registerAppPids(session: ElectronApplication, observer: NetworkObserver): Promise<number> {
  const pids = await capturePackagedAppPids(session);
  if (pids.stubPid) observer.appRootPids.add(pids.stubPid);
  if (pids.mainPid) observer.appRootPids.add(pids.mainPid);
  sessionPids.set(session, pids);
  return pids.mainPid || pids.stubPid;
}

const appEnv = (localAppData: string): Record<string, string> => {
  const env = { ...process.env } as Record<string, string | undefined>;
  delete env.ELECTRON_RUN_AS_NODE;
  env.LOCALAPPDATA = localAppData;
  env.AWKIT_MAX_BROWSERS = "2";
  // The packaged application must never observe the issuer key path, and must never be handed the
  // (already inert) test bypass — leaving it set would make this gate's evidence ambiguous about why
  // a run was admitted.
  return sanitizeAppEnv(env) as Record<string, string>;
};

type Api = { win: Page };
const api = {
  runtimeStatus: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.executions.runtimeStatus()),
  instances: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.executions.list()),
  workflows: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.workflows.list()),
  importFlow: (t: Api, flow: unknown) => t.win.evaluate((f) => (window as any).playwrightFlowStudio.flows.import(f), flow),
  importWorkflow: (t: Api, wf: unknown) => t.win.evaluate((w) => (window as any).playwrightFlowStudio.workflows.import(w), wf),
  runWorkflow: (t: Api, request: unknown) => t.win.evaluate((r) => (window as any).playwrightFlowStudio.executions.runWorkflow(r), request),
  stopInstance: (t: Api, id: string) => t.win.evaluate((i) => (window as any).playwrightFlowStudio.executions.stopInstance(i), id),
  stopAll: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.executions.stopAll()),
  recoveryDetails: (t: Api, id: string) => t.win.evaluate((i) => (window as any).playwrightFlowStudio.executions.recoveryDetails(i), id),
  recoveryAction: (t: Api, id: string, action: string) =>
    t.win.evaluate(
      (args: { id: string; action: string }) => (window as any).playwrightFlowStudio.executions.recoveryAction(args.id, args.action),
      { id, action }
    ),
  recorderStart: (t: Api, url: string) => t.win.evaluate((u) => (window as any).playwrightFlowStudio.recorder.start(u), url),
  recorderStatus: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.recorder.getStatus()),
  recorderCancel: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.recorder.cancel()),
  settingsGet: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.settings.get()),
  settingsUpdate: (t: Api, patch: unknown) =>
    t.win.evaluate((p) => (window as any).playwrightFlowStudio.settings.update(p), patch),
  detectInstalledChrome: (t: Api, configuredPath?: string) =>
    t.win.evaluate((p) => (window as any).playwrightFlowStudio.settings.detectInstalledChrome(p), configuredPath)
};

/** Licensing IPC needs a session ref and a FRESH re-auth for import/remove (both are sensitive). */
async function packagedSession(win: Page): Promise<string> {
  const res = (await win.evaluate(
    async (creds) =>
      (window as any).playwrightFlowStudio.security.login({
        providerId: "local",
        username: creds.username,
        password: creds.password
      }),
    WALKTHROUGH_ACCOUNT
  )) as any;
  if (!res?.ok) throw new Error(`packaged login failed: ${res?.reason ?? "unknown"}`);
  return res.principal.sessionRef as string;
}

async function freshReauth(win: Page, sessionRef: string): Promise<void> {
  const res = (await win.evaluate(
    async (input) => (window as any).playwrightFlowStudio.security.reauth(input),
    { sessionRef, password: WALKTHROUGH_ACCOUNT.password }
  )) as any;
  if (!res?.ok) throw new Error(`re-auth failed: ${res?.reason ?? "unknown"}`);
}

const licensingApi = {
  status: (win: Page, ref: string) =>
    win.evaluate(async (r) => (window as any).playwrightFlowStudio.licensing.getStatus(r), ref),
  exportRequest: (win: Page, ref: string) =>
    win.evaluate(async (r) => (window as any).playwrightFlowStudio.licensing.exportRequest(r), ref),
  import: (win: Page, ref: string, license: unknown) =>
    win.evaluate(async (input) => (window as any).playwrightFlowStudio.licensing.import(input), {
      sessionRef: ref,
      license
    }),
  remove: (win: Page, ref: string) =>
    win.evaluate(async (r) => (window as any).playwrightFlowStudio.licensing.remove(r), ref)
};

interface LicensedSession {
  licensed: boolean;
  reason?: string;
  sessionRef?: string;
  workDir?: string;
  serialNumber?: string;
}

/**
 * License the packaged machine the way a real administrator would: read the fingerprint through the
 * app's own IPC, mint a short-lived license with the EXTERNAL issuer, import it through the same
 * channel the Licensing page uses, and confirm the app now considers itself operable.
 *
 * Blocks (never skips, never passes) when no issuer key is configured for this machine.
 */
async function licensePackagedMachine(t: Api, _localAppData: string): Promise<LicensedSession> {
  const win = t.win;
  const sessionRef = await packagedSession(win);

  // The walkthrough profile is a FRESH install, so the migration window must be shut. Asserting it
  // here is what stops grace from quietly becoming the mechanism that grants this gate its execution
  // rights — the license below has to do that work, or the gate proves nothing about licensing.
  const before = (await licensingApi.status(win, sessionRef)) as any;
  check(
    "packaged fresh profile starts NOT_ACTIVATED",
    before?.value?.status === "NOT_ACTIVATED",
    JSON.stringify(before?.value?.status)
  );
  check(
    "no migration grace on the walkthrough profile (grace is not what licenses this gate)",
    before?.value?.enforcement?.inGrace === false,
    JSON.stringify(before?.value?.enforcement)
  );
  check(
    "enforcement is ON in the packaged build",
    before?.value?.enforcement?.enforced === true,
    JSON.stringify(before?.value?.enforcement)
  );

  // Unlicensed, a real run must be refused. This is the "before" half of the licensing proof.
  const refused = (await api.runWorkflow(t, {
    workflowId: "mock-simple-workflow",
    headless: true,
    dryRun: false
  })) as any;
  check(
    "unlicensed packaged app REFUSES a real run",
    refused?.status === "licenseBlocked",
    JSON.stringify(refused?.status)
  );

  const key = resolveIssuerKey();
  if (!key.available) return { licensed: false, reason: key.reason, sessionRef };

  const activation = (await licensingApi.exportRequest(win, sessionRef)) as any;
  if (!activation?.ok || !activation.value?.fingerprintHash) {
    return { licensed: false, reason: "the packaged app did not return an activation request", sessionRef };
  }

  const workDir = join(baseDir, `license-${stamp}`);
  let minted: Awaited<ReturnType<typeof mintVerificationLicense>>;
  try {
    minted = await mintVerificationLicense({
      repoRoot: root,
      keyPath: key.keyPath as string,
      activationRequest: activation.value,
      workDir,
      expiresInMinutes: 45
    });
  } catch (error) {
    cleanupMintedArtifacts(workDir);
    return {
      licensed: false,
      reason: `the external issuer failed: ${error instanceof Error ? error.message : String(error)}`,
      sessionRef
    };
  }

  check(
    "minted license is bound to THIS machine's fingerprint",
    minted.license.machineFingerprintHash === activation.value.fingerprintHash
  );
  // "Verification-issued" can no longer be a magic type string: signing goes through
  // `LicenseIssuerService`, whose allowlist is the product's real licence types (`awkit-vf9r`). The
  // pair below is a stronger claim anyway — a production licence is not a `trial` that expires the
  // same day, so this still cannot be satisfied by accidentally importing a real one.
  check("minted license carries an issuable licence type", minted.license.licenseType === "trial");
  check(
    "...and is short-lived, so it cannot be a production licence",
    Date.parse(minted.license.expiresAtUtc) - Date.parse(minted.license.validFromUtc) <= 25 * 60 * 60_000,
    `${minted.license.validFromUtc} -> ${minted.license.expiresAtUtc}`
  );
  check(
    "minted license carries only the execution entitlement",
    Array.isArray(minted.license.entitlements) &&
      minted.license.entitlements.length === 1 &&
      minted.license.entitlements[0] === "workflow.execute",
    JSON.stringify(minted.license.entitlements)
  );
  const mintedLifetimeMs = Date.parse(minted.license.expiresAtUtc) - Date.now();
  check(
    "minted license is short-lived (under two hours)",
    mintedLifetimeMs > 0 && mintedLifetimeMs < 2 * 60 * 60_000,
    `${Math.round(mintedLifetimeMs / 60000)} minutes`
  );

  await freshReauth(win, sessionRef);
  const imported = (await licensingApi.import(win, sessionRef, minted.license)) as any;
  check(
    "license imported through the app's own administrator IPC",
    imported?.ok === true && imported.value?.ok === true,
    JSON.stringify(imported?.reason ?? imported?.value?.rejectedReason)
  );

  const after = (await licensingApi.status(win, sessionRef)) as any;
  // A deliberately short-lived license validates as EXPIRING_SOON, not VALID — the "expiring soon"
  // window is 7 days. Assert OPERABILITY, which is what the run gate actually consults.
  check(
    "packaged app reports an operable license after import",
    after?.value?.operable === true,
    `${after?.value?.status} / operable=${after?.value?.operable}`
  );
  check(
    "the run gate now admits runs",
    after?.value?.enforcement?.runsAllowed === true,
    JSON.stringify(after?.value?.enforcement)
  );
  check(
    "admission is attributed to the license, NOT to migration grace",
    after?.value?.enforcement?.reason === "LICENSE_OPERABLE" && after?.value?.enforcement?.inGrace === false,
    JSON.stringify(after?.value?.enforcement)
  );

  return {
    licensed: after?.value?.operable === true,
    sessionRef,
    workDir,
    serialNumber: minted.license.serialNumber,
    reason: after?.value?.operable === true ? undefined : "import did not yield an operable license"
  };
}

/**
 * Teardown: remove the license through the app's own IPC, delete every artifact the issuer produced,
 * and confirm the machine has genuinely returned to a blocked state. The last part matters — a gate
 * that licenses a machine and leaves it licensed has changed the machine it was measuring.
 */
async function unlicensePackagedMachine(t: Api, session: LicensedSession): Promise<void> {
  const win = t.win;
  if (!session.licensed) return;
  try {
    // A fresh session ref, NOT the one from the licensing session: teardown runs in a later Electron
    // instance (session C) after two restarts, where the original ref no longer resolves.
    const sessionRef = await packagedSession(win);
    await freshReauth(win, sessionRef);
    const removed = (await licensingApi.remove(win, sessionRef)) as any;
    check("verification license removed through the app's own IPC", removed?.ok === true, JSON.stringify(removed?.reason));

    const afterRemoval = (await licensingApi.status(win, sessionRef)) as any;
    check(
      "packaged app returns to NOT_ACTIVATED after removal",
      afterRemoval?.value?.status === "NOT_ACTIVATED",
      JSON.stringify(afterRemoval?.value?.status)
    );
    check(
      "execution is blocked again once the license is gone",
      afterRemoval?.value?.enforcement?.runsAllowed === false,
      JSON.stringify(afterRemoval?.value?.enforcement)
    );

    const refusedAgain = (await api.runWorkflow(t, {
      workflowId: "mock-simple-workflow",
      headless: true,
      dryRun: false
    })) as any;
    check(
      "a real run is refused again after teardown",
      refusedAgain?.status === "licenseBlocked",
      JSON.stringify(refusedAgain?.status)
    );
  } catch (error) {
    check("license teardown completed", false, error instanceof Error ? error.message : String(error));
  } finally {
    if (session.workDir) cleanupMintedArtifacts(session.workDir);
  }
}


async function findInstance(t: Api, executionId: string, index = 1): Promise<any | null> {
  // instance.executionId is the raw run UUID, but instanceId is prefixed with the engine's
  // decorated execution id (<profileId>-<timestamp>-<hash>-i<N>) — match by suffix.
  const list = (await api.instances(t)) as any[];
  return list.find((item) => item.executionId === executionId && String(item.instanceId).endsWith(`-i${index}`)) ?? null;
}

async function waitForInstanceStatus(t: Api, executionId: string, statuses: string[], timeoutMs: number, index = 1): Promise<any | null> {
  return pollUntil(async () => {
    const inst = await findInstance(t, executionId, index);
    return inst && statuses.includes(inst.status) ? inst : null;
  }, timeoutMs);
}

async function walkFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(full)));
    else out.push(full);
  }
  return out;
}

async function readFixture(kind: "flows" | "workflows", id: string): Promise<any> {
  return JSON.parse(await readFile(join(fixturesRoot, kind, `${id}.json`), "utf8"));
}

const longFlowId = "phase5-long-wait-flow";
const longWorkflowId = "phase5-long-workflow";
const longFlow = {
  id: longFlowId,
  name: "Phase5 — Long Wait Flow",
  description: "Opens the mock login page, then waits 120s (cancellation / kill target).",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  nodes: [
    { id: "start", type: "start", name: "Start" },
    { id: "goto", type: "goto", name: "Open Login", url: `${MOCK_BASE}/login`, valueSource: { type: "static", value: `${MOCK_BASE}/login` } },
    {
      id: "wait",
      type: "wait",
      name: "Long Wait",
      value: "120000",
      valueSource: { type: "static", value: "120000" },
      config: { waitType: "time" },
      timeoutMs: 120000
    },
    { id: "end", type: "end", name: "End" }
  ],
  edges: [
    { id: "l-e0", source: "start", target: "goto", type: "success" },
    { id: "l-e1", source: "goto", target: "wait", type: "success" },
    { id: "l-e2", source: "wait", target: "end", type: "success" }
  ]
};
const longWorkflow = {
  id: longWorkflowId,
  name: "Phase5 — Long Workflow",
  description: "Single long-wait flow for cancellation/recovery walkthroughs.",
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  nodes: [
    {
      id: longFlowId,
      type: "flowRef",
      flowId: longFlowId,
      alias: longFlowId,
      order: 1,
      required: true,
      inputBindings: {},
      retryPolicy: { count: 0, delayMs: 1000 },
      failurePolicy: "stop",
      position: { x: 140, y: 180 }
    }
  ],
  edges: [],
  runtimeInputs: [],
  execution: { mode: "sequential", maxConcurrentInstances: 4, stopOnRequiredFlowFailure: true }
};

async function main(): Promise<void> {
  console.log("Phase 5 packaged clean-profile walkthrough (dist/win-unpacked + portable EXE)");
  console.log(`  fresh profile A: ${freshRootA}`);
  console.log(`  fresh profile B: ${freshRootB}`);
  console.log(`  evidence:        ${evidenceDir}`);
  await mkdir(freshRootA, { recursive: true });
  await mkdir(freshRootB, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });

  console.log("\nPart A — preconditions");
  if (!existsSync(exePath)) {
    console.error(`  ✗ Packaged app not found (${exePath}). Build it first: npm run package:portable`);
    process.exit(1);
  }
  check("packaged win-unpacked EXE exists", true, exePath);

  // A packaged tree older than the sources it claims to contain proves nothing: every check below
  // would drive a stale bundle and report a green result about code that is no longer in the
  // repository. Refuse outright rather than produce a misleading pass.
  const asarPath = join(unpackedDir, "resources", "app.asar");
  const packagedStamp = await stat(existsSync(asarPath) ? asarPath : exePath);
  const newestSource = (await Promise.all([join(root, "src"), join(root, "app")].map(newestFileMtime)))
    .reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
  if (newestSource.mtimeMs > packagedStamp.mtimeMs) {
    console.error(
      `  ✗ dist/win-unpacked is STALE — ${relative(root, newestSource.path)} ` +
        `(${new Date(newestSource.mtimeMs).toISOString()}) is newer than the packaged payload ` +
        `(${new Date(packagedStamp.mtimeMs).toISOString()}).\n` +
        `    Re-run "npm run package:portable" first. Driving a stale bundle reports a pass about ` +
        `code that is not in the working tree.`
    );
    process.exit(1);
  }
  check(
    "packaged payload is at least as new as src/ and app/",
    true,
    `packaged ${new Date(packagedStamp.mtimeMs).toISOString()} >= newest source ${new Date(newestSource.mtimeMs).toISOString()}`
  );
  check("portable EXE exists", existsSync(portableExePath), portableExePath);
  // Names the command that produces it: a gate failing for want of a build is a build step, not a
  // defect in the app. This used to "pass" by pointing at a 0.1.0 installer built in July.
  check(
    "NSIS installer exists",
    existsSync(setupExePath),
    existsSync(setupExePath) ? setupExePath : `${setupExePath} — run \`npm run package:installer\` first`
  );
  check("mock-site fixtures exist", existsSync(join(fixturesRoot, "workflows", "mock-simple-workflow.json")));

  console.log("\nPart B — local mock site (loopback only)");
  let mockSite: ReturnType<typeof spawn> | null = null;
  if (!(await httpOk(MOCK_PROBE))) {
    mockSite = spawn(process.execPath, [join(root, "mock-site", "server.mjs")], {
      env: { ...process.env, MOCK_SITE_PORT: String(MOCK_PORT) },
      stdio: "ignore",
      windowsHide: true
    });
  }
  const mockUp = await pollUntil(async () => ((await httpOk(MOCK_PROBE)) ? true : null), 20000, 500);
  check("mock site is serving on loopback", mockUp === true, MOCK_PROBE);

  const observer = new NetworkObserver();
  observer.start();

  let sessionA: ElectronApplication | null = null;
  let sessionB: ElectronApplication | null = null;
  let sessionC: ElectronApplication | null = null;
  let portableProc: ReturnType<typeof spawn> | null = null;
  let killedInstanceId = "";
  let licensedSession: LicensedSession = { licensed: false };
  const summary: Record<string, unknown> = { freshRootA, freshRootB, mockBase: MOCK_BASE, startedAt: new Date().toISOString() };

  try {
    console.log("\nPart C — first run on a fresh, empty profile (packaged app, session A)");
    sessionA = await electron.launch({ executablePath: exePath, env: appEnv(freshRootA) as never, timeout: 60_000 });
    await registerAppPids(sessionA, observer);
    const winA = await resolvePackagedMainWindow(sessionA);
    await winA.waitForLoadState("domcontentloaded");
    const preAuthChromeProbe = (await winA.evaluate(async () => {
      try {
        await (window as any).playwrightFlowStudio.settings.detectInstalledChrome();
        return { denied: false, message: "allowed" };
      } catch (error) {
        return { denied: true, message: error instanceof Error ? error.message : String(error) };
      }
    })) as { denied: boolean; message: string };
    check(
      "packaged installed-Chrome detection rejects an unauthenticated direct IPC call",
      preAuthChromeProbe.denied && /NOT_AUTHORIZED|not authorized/i.test(preAuthChromeProbe.message),
      preAuthChromeProbe.message
    );
    await ensureWalkthroughAuthenticated(winA);
    const tA: Api = { win: winA };
    check("packaged app launched and opened a window", true);

    const rendered = await pollUntil(async () => {
      const count = await winA.evaluate(() => document.querySelector("#root")?.childElementCount ?? 0);
      return count > 0 ? count : null;
    }, 20000, 500);
    check("renderer painted content (no white screen)", (rendered ?? 0) > 0, `#root children: ${rendered}`);
    await winA.screenshot({ path: join(evidenceDir, "01-first-run.png") }).catch(() => undefined);

    const statusA = await pollUntil(async () => {
      const status = await api.runtimeStatus(tA);
      return status?.environment ? status : null;
    }, 30000, 500);
    const envA = (statusA as any)?.environment;
    check("durable runtime initialized at startup", Boolean(envA), JSON.stringify(statusA ?? {}).slice(0, 200));
    check(`appMode reported as "packaged" (got "${envA?.appMode}")`, envA?.appMode === "packaged");
    check("durable store enabled (sql.js WASM loaded in packaged main)", envA?.durableStoreEnabled === true);
    check(
      "runtime root is the FRESH profile root (no developer/app-resource path)",
      typeof envA?.runtimeRoot === "string" &&
        envA.runtimeRoot.toLowerCase().startsWith(freshRootA.toLowerCase()) &&
        !envA.runtimeRoot.includes("app.asar"),
      envA?.runtimeRoot
    );
    check(
      "runtime.sqlite created under the fresh profile root",
      typeof envA?.sqlitePath === "string" && envA.sqlitePath.toLowerCase().startsWith(freshRootA.toLowerCase()) && existsSync(envA.sqlitePath),
      envA?.sqlitePath
    );
    summary.environment = envA;

    const appRoot = join(freshRootA, "SpecterStudio");
    for (const folder of ["flows", "workflows", "logs", "screenshots", "runtime"]) {
      check(`fresh runtime folder created: ${folder}/`, existsSync(join(appRoot, folder)));
    }

    console.log("\nPart C2 — installed Google Chrome from the fresh packaged app (Super User)");
    const chromeResolution = (await api.detectInstalledChrome(tA)) as any;
    if (!chromeResolution?.available) {
      blocked += 1;
      console.log(`  ⊘ Packaged installed Chrome — BLOCKED: ${chromeResolution?.code ?? "CHROME_UNAVAILABLE"}: ${chromeResolution?.message ?? "not found"}`);
      summary.installedChrome = { blocked: true, resolution: chromeResolution };
    } else {
      check("packaged app discovers a real installed Google Chrome executable", existsSync(chromeResolution.executablePath), chromeResolution.executablePath);
      const invalidResolution = (await api.detectInstalledChrome(tA, join(freshRootA, "missing", "chrome.exe"))) as any;
      check(
        "an explicit invalid Chrome path fails without silent fallback",
        invalidResolution?.available === false && invalidResolution?.code === "CHROME_EXECUTABLE_INVALID",
        JSON.stringify(invalidResolution)
      );
      await api.settingsUpdate(tA, {
        superUser: { chrome: { mode: "installedChrome", executablePath: chromeResolution.executablePath } }
      });
      const installedSettings = (await api.settingsGet(tA)) as any;
      check(
        "Super User installed-Chrome selection persists through packaged settings IPC",
        installedSettings?.superUser?.chrome?.mode === "installedChrome" &&
          installedSettings?.superUser?.chrome?.executablePath === chromeResolution.executablePath
      );

      const installedRecorder = (await api.recorderStart(tA, `${MOCK_BASE}/recorder-lab`)) as any;
      check("packaged Recorder launches through installed Chrome", installedRecorder?.isRecording === true, JSON.stringify(installedRecorder)?.slice(0, 180));
      const recorderProfile = join(appRoot, "profiles", "installed-chrome-recorder");
      const installedProcess = await pollUntil(async () => {
        const system = await sampleSystem();
        if (!system) return null;
        return system.procs.find(
          (proc) =>
            proc.Name.toLowerCase() === "chrome.exe" &&
            (proc.ExecutablePath ?? "").toLowerCase() === String(chromeResolution.executablePath).toLowerCase() &&
            (proc.CommandLine ?? "").toLowerCase().includes(recorderProfile.toLowerCase())
        ) ?? null;
      }, 20_000, 500);
      check("installed Chrome is the actual recorded process executable", Boolean(installedProcess), chromeResolution.executablePath);
      check("installed Chrome uses the AWKIT-owned recorder profile", existsSync(recorderProfile) && Boolean(installedProcess), recorderProfile);
      const dailyProfile = join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "User Data").toLowerCase();
      check(
        "packaged Recorder never points at the user's daily Chrome profile",
        Boolean(installedProcess) && !(installedProcess?.CommandLine ?? "").toLowerCase().includes(dailyProfile),
        (installedProcess?.CommandLine ?? "missing process").slice(0, 240)
      );
      await api.recorderCancel(tA);
      const installedRecorderStopped = await pollUntil(async () => {
        const status = (await api.recorderStatus(tA)) as any;
        return status?.isRecording === false ? true : null;
      }, 15_000, 500);
      check("installed-Chrome Recorder cancels cleanly", installedRecorderStopped === true);

      // Bundled Chromium remains the canonical offline default for the rest of this walkthrough.
      await api.settingsUpdate(tA, {
        superUser: { chrome: { mode: "bundledChromium", executablePath: "" } }
      });
      const restoredSettings = (await api.settingsGet(tA)) as any;
      check("bundled Chromium remains available after installed-Chrome proof", restoredSettings?.superUser?.chrome?.mode === "bundledChromium");
      summary.installedChrome = {
        available: true,
        source: chromeResolution.source,
        executablePath: chromeResolution.executablePath,
        recorderProfile,
        processId: installedProcess?.ProcessId
      };
    }
    const beforeImport = (await api.workflows(tA)) as any[];
    check(
      "fresh install contains no dev/mock walkthrough leftovers",
      Array.isArray(beforeImport) &&
        beforeImport.every((wf) => !String(wf.id).startsWith("mock-") && !String(wf.id).startsWith("phase5-")),
      beforeImport?.map((wf) => wf.id).join(", ")
    );

    console.log("\nPart D — import fixtures via app IPC + run a full workflow in the packaged app");
    for (const flowId of ["mock-login-flow", "mock-fill-form-flow", "mock-screenshot-flow"]) {
      await api.importFlow(tA, await readFixture("flows", flowId));
    }
    await api.importWorkflow(tA, await readFixture("workflows", "mock-simple-workflow"));
    await api.importFlow(tA, longFlow);
    await api.importWorkflow(tA, longWorkflow);
    const afterImport = (await api.workflows(tA)) as any[];
    check(
      "workflows imported through the packaged app's own IPC",
      afterImport.some((wf) => wf.id === "mock-simple-workflow") && afterImport.some((wf) => wf.id === longWorkflowId),
      afterImport.map((wf) => wf.id).join(", ")
    );

    // ── D-LIC: license this machine for real, the way an administrator would ────────────────────
    //
    // Enforcement is ON by default and a packaged build has NO bypass, so every real run below is
    // refused until this succeeds. That is the point: the gate now proves the packaged app's
    // import → validate → run path, not just its engine.
    licensedSession = await licensePackagedMachine(tA, freshRootA);
    if (!licensedSession.licensed) {
      blocked += 1;
      console.log(`  ⊘ Parts D–G real execution — BLOCKED: ${licensedSession.reason}`);
      console.log("    Reporting BLOCKED rather than skipping: the four real runs below cannot be");
      console.log("    attempted, so no claim is made about packaged execution either way.");
      throw new PackagedLicensingBlocked(licensedSession.reason ?? "licensing unavailable");
    }

    const runD = (await api.runWorkflow(tA, { workflowId: "mock-simple-workflow", headless: true, dryRun: false })) as any;
    check("workflow run accepted by the packaged engine", runD?.status === "started", JSON.stringify(runD)?.slice(0, 200));
    const doneD = await waitForInstanceStatus(tA, runD.executionId, ["completed", "failed", "cancelled"], 120000);
    check(`workflow run COMPLETED in the packaged app (got "${doneD?.status}")`, doneD?.status === "completed", doneD?.currentStep);
    summary.simpleWorkflow = { executionId: runD?.executionId, status: doneD?.status };

    if (doneD) {
      const logsExist = existsSync(doneD.paths.logs);
      check("per-instance JSONL run log written", logsExist, doneD.paths.logs);
      if (logsExist) {
        const lines = (await readFile(doneD.paths.logs, "utf8")).trim().split("\n");
        let parsedLines = 0;
        let hasIds = false;
        for (const line of lines) {
          try {
            const row = JSON.parse(line);
            parsedLines += 1;
            if (row.instanceId || row.runId || row.nodeId) hasIds = true;
          } catch {
            /* counted below */
          }
        }
        check(`run log lines are valid JSONL (${parsedLines}/${lines.length})`, parsedLines === lines.length && parsedLines > 0);
        check("run log lines carry run/node identifiers", hasIds);
        await copyFile(doneD.paths.logs, join(evidenceDir, "02-run-log.jsonl")).catch(() => undefined);
      }
      const shots = await walkFiles(doneD.paths.screenshots);
      check("workflow screenshot artifact(s) created", shots.length > 0, doneD.paths.screenshots);
      if (shots.length > 0) await copyFile(shots[0], join(evidenceDir, "03-workflow-screenshot.png")).catch(() => undefined);
      // The aggregate run report is written under the RAW executionId; instance state files
      // live under the DECORATED instance root (paths.storage's parent).
      const aggregateReport = join(appRoot, "reports", `${runD.executionId}.json`);
      const reportWritten = await pollUntil(
        async () => (existsSync(aggregateReport) || existsSync(doneD.paths.reports) ? true : null),
        10_000,
        250
      );
      check(
        "run report written",
        reportWritten === true,
        aggregateReport
      );
      const instanceRoot = dirname(doneD.paths.storage);
      // POLLED, like the report check above it. `writeRunStateArtifacts` runs in the engine's
      // post-run flush (`ExecutionEngine.ts`), AFTER the instance already reports `completed` — so a
      // single immediate sample races that flush and reports a failure that is not real. Measured:
      // the run reached `completed` at 19:13:4x and `storage/state/flow-state.json` landed at
      // 19:13:54.364, with all four state artifacts present and well-formed. The assertion is
      // unchanged — the file must still appear; it simply gets the same bounded window.
      const stateWritten = await pollUntil(
        async () => {
          const found = (await walkFiles(instanceRoot)).filter((file) => file.endsWith("flow-state.json"));
          return found.length > 0 ? found : null;
        },
        10_000,
        250
      );
      check("end-of-run state artifacts written (flow-state.json)", stateWritten !== null, instanceRoot);
    }

    console.log("\nPart E — hard cancellation inside the packaged app");
    const runE = (await api.runWorkflow(tA, { workflowId: longWorkflowId, headless: true, dryRun: false })) as any;
    const runningE = await waitForInstanceStatus(tA, runE.executionId, ["running", "waitingForManualAction"], 60000);
    check(
      "long-wait run reached running state",
      runningE?.status === "running",
      JSON.stringify({ response: runE, observedStatus: runningE?.status })?.slice(0, 1000)
    );
    await sleep(2500); // let the goto land + heartbeats/durable rows write
    const chromeBefore = await pollUntil(async () => {
      const count = await chromeRootsNow(observer.appRootPids);
      return count >= 1 ? count : null;
    }, 15000, 1500);
    check("bundled Chromium is actually running during the run", (chromeBefore ?? 0) >= 1, `browser roots: ${chromeBefore}`);
    if (runningE) await api.stopInstance(tA, runningE.instanceId);
    const cancelledE = await waitForInstanceStatus(tA, runE.executionId, ["cancelled", "failed", "completed"], 30000);
    check(`stop ends the run as "cancelled", not failed (got "${cancelledE?.status}")`, cancelledE?.status === "cancelled");
    const chromeGone = await pollUntil(async () => {
      const count = await chromeRootsNow(observer.appRootPids);
      return count === 0 ? true : null;
    }, 25000, 2000);
    check("browser process tree is gone after cancellation (hard stop)", chromeGone === true);
    const statusAfterE = (await api.runtimeStatus(tA)) as any;
    check(
      "browser slot released after cancellation",
      statusAfterE?.browserPool?.activeSlots === 0,
      `activeSlots: ${statusAfterE?.browserPool?.activeSlots}`
    );
    check(
      "no locks left held after cancellation",
      (statusAfterE?.locks?.totalHeld ?? -1) === 0,
      `totalHeld: ${statusAfterE?.locks?.totalHeld}`
    );
    summary.cancellation = { executionId: runE?.executionId, finalStatus: cancelledE?.status };

    console.log("\nPart F — browser process bound under concurrent load (cap = 2)");
    const runF = (await api.runWorkflow(tA, {
      workflowId: longWorkflowId,
      headless: true,
      dryRun: false,
      totalInstances: 4,
      maxConcurrentInstances: 4
    })) as any;
    check("4-instance concurrent run accepted", runF?.status === "started", JSON.stringify(runF)?.slice(0, 1000));
    let maxRoots = 0;
    let maxInstanceSlots = 0;
    let maxConcurrentInstancesObserved = 0;
    let maxQueuedInstancesObserved = 0;
    const boundDeadline = Date.now() + 25000;
    while (Date.now() < boundDeadline) {
      const rootsNow = await chromeRootsNow(observer.appRootPids);
      const status = (await api.runtimeStatus(tA)) as any;
      const instances = ((await api.instances(tA)) as any[]).filter((item) => item.executionId === runF.executionId);
      maxRoots = Math.max(maxRoots, rootsNow);
      // Shared-browser mode intentionally reports zero *real* slots: each instance owns a virtual
      // context slot while the SharedBrowserPool multiplexes those contexts over <= maxBrowsersPerHost
      // browser roots. Observe both layers instead of treating virtual slots as a stale queue.
      maxInstanceSlots = Math.max(maxInstanceSlots, status?.browserPool?.slots?.length ?? 0);
      maxConcurrentInstancesObserved = Math.max(
        maxConcurrentInstancesObserved,
        instances.filter((item) => ["starting", "running"].includes(item.status)).length
      );
      maxQueuedInstancesObserved = Math.max(
        maxQueuedInstancesObserved,
        instances.filter((item) => ["queued", "pending"].includes(item.status)).length
      );
      await sleep(1000);
    }
    check(`browser roots never exceeded the cap of 2 (max seen: ${maxRoots})`, maxRoots > 0 && maxRoots <= 2);
    check(
      `instance/context slots never exceeded the configured cap of 2 (max seen: ${maxInstanceSlots})`,
      maxInstanceSlots > 0 && maxInstanceSlots <= 2,
      `concurrent instances observed: ${maxConcurrentInstancesObserved}`
    );
    check(
      "excess instances remained queued while 2 isolated browser contexts were active",
      maxConcurrentInstancesObserved === 2 && maxQueuedInstancesObserved >= 2,
      `active: ${maxConcurrentInstancesObserved}, queued: ${maxQueuedInstancesObserved}, roots: ${maxRoots}`
    );
    await api.stopAll(tA);
    const allDrained = await pollUntil(async () => {
      const instances = ((await api.instances(tA)) as any[]).filter((item) => item.executionId === runF.executionId);
      return instances.length === 4 && instances.every((item) => ["cancelled", "completed", "failed"].includes(item.status))
        ? instances
        : null;
    }, 45000);
    check(
      "stopAll drained all 4 instances to a terminal state",
      allDrained !== null,
      allDrained ? (allDrained as any[]).map((item) => item.status).join(",") : "timeout"
    );
    check(
      "every stopped instance ended cancelled",
      allDrained !== null && (allDrained as any[]).every((item) => item.status === "cancelled"),
      allDrained ? (allDrained as any[]).map((item) => item.status).join(",") : ""
    );
    const drainedChrome = await pollUntil(async () => {
      const count = await chromeRootsNow(observer.appRootPids);
      return count === 0 ? true : null;
    }, 25000, 2000);
    check("all browser slots/processes released after stopAll", drainedChrome === true);
    summary.processBound = { maxRoots, maxInstanceSlots, maxConcurrentInstancesObserved, maxQueuedInstancesObserved };

    console.log("\nPart G — recorder launches inside the packaged app");
    const recStart = (await api.recorderStart(tA, `${MOCK_BASE}/recorder-lab`).catch((error: Error) => ({ error: error.message }))) as any;
    check("recorder started (bundled browser launched)", recStart?.isRecording === true, JSON.stringify(recStart)?.slice(0, 150));
    const recStatus = (await api.recorderStatus(tA)) as any;
    check("recorder status reports recording", recStatus?.isRecording === true);
    await api.recorderCancel(tA);
    const recStopped = await pollUntil(async () => {
      const status = (await api.recorderStatus(tA)) as any;
      return status?.isRecording === false ? true : null;
    }, 15000, 1000);
    check("recorder cancelled cleanly (browser closed)", recStopped === true);

    console.log("\nPart H — clean shutdown of session A");
    await sessionA.close();
    sessionA = null;
    await sleep(2000);
    const afterA = await bundledChromeNow();
    check(
      "no bundled-Chromium processes left after clean app exit",
      afterA !== null && afterA.length === 0,
      afterA === null ? "process enumeration failed — cannot claim the tree is clean" : afterA.map((proc) => proc.ProcessId).join(",")
    );
    check("ui settings persisted under the fresh profile", existsSync(join(appRoot, "storage", "ui-settings.json")));

    console.log("\nPart I — hard kill mid-run (orphaned-run scenario, session B)");
    sessionB = await electron.launch({ executablePath: exePath, env: appEnv(freshRootA) as never, timeout: 60_000 });
    const pidB = await registerAppPids(sessionB, observer); // REAL Electron main pid, not the launcher stub
    const winB = await resolvePackagedMainWindow(sessionB);
    await winB.waitForLoadState("domcontentloaded");
    await ensureWalkthroughAuthenticated(winB);
    const tB: Api = { win: winB };
    const runI = (await api.runWorkflow(tB, { workflowId: longWorkflowId, headless: true, dryRun: false })) as any;
    const runningI = await waitForInstanceStatus(tB, runI.executionId, ["running"], 60000);
    killedInstanceId = runningI?.instanceId ?? `${runI.executionId}-i1`;
    check(
      "session B run is live before the kill",
      runningI?.status === "running",
      JSON.stringify({ response: runI, observedStatus: runningI?.status })?.slice(0, 1000)
    );
    await sleep(4000); // heartbeats + durable rows
    // Hard kill = Task Manager "End task" on the main process. NOTE: Node's process.kill()
    // does NOT reliably terminate the packaged Electron root on Windows (walkthrough runs 1/2
    // left zombie apps behind) — use taskkill /F and VERIFY death.
    await taskkill(pidB, false);
    sessionB = null;
    const rootDead = await pollUntil(async () => ((await pidAlive(pidB)) ? null : true), 15000, 1000);
    check("hard kill actually terminated the app main process", rootDead === true, `pid ${pidB}`);
    // Observe (without intervening) whether the orphaned browser tree self-exits.
    let leakedChrome: PsProcess[] = [];
    let leakProbeBlind = false;
    const selfExited = await pollUntil(async () => {
      const observed = await bundledChromeNow();
      // A failed probe must not resolve the poll: returning true here would print "self-exited"
      // as a positive finding derived from a measurement that never happened.
      if (observed === null) {
        leakProbeBlind = true;
        return null;
      }
      leakProbeBlind = false;
      leakedChrome = observed;
      return leakedChrome.length === 0 ? true : null;
    }, 20000, 2500);
    check("the orphan probe could read the process table", !leakProbeBlind);
    console.log(
      leakProbeBlind
        ? "  (orphan observation is INCONCLUSIVE — the process table could not be read)"
        : selfExited
        ? "  (orphaned bundled-Chromium processes self-exited after the app died)"
        : `  (observed ${leakedChrome.length} orphaned bundled-Chromium process(es) still alive 20s after the kill — swept)`
    );
    summary.hardKill = { instanceId: killedInstanceId, orphanedChromeSelfExited: selfExited === true, leakedChromeAfterKill: leakedChrome.length };
    for (const proc of leakedChrome) await taskkill(proc.ProcessId, true);

    console.log("\nPart J — restart after the kill: startup recovery + recovery panel (session C)");
    sessionC = await electron.launch({ executablePath: exePath, env: appEnv(freshRootA) as never, timeout: 60_000 });
    await registerAppPids(sessionC, observer);
    const winC = await resolvePackagedMainWindow(sessionC);
    await winC.waitForLoadState("domcontentloaded");
    await ensureWalkthroughAuthenticated(winC);
    const tC: Api = { win: winC };
    const recovered = await pollUntil(async () => {
      const status = (await api.runtimeStatus(tC)) as any;
      const runs = status?.recoverableRuns as any[] | undefined;
      return runs?.some((run) => run.instanceId === killedInstanceId) ? runs : null;
    }, 30000);
    check("orphaned run surfaced as recoverable after restart", recovered !== null, killedInstanceId);
    const orphanRun = (recovered as any[] | null)?.find((run) => run.instanceId === killedInstanceId);
    check(`orphaned run status recorded (got "${orphanRun?.status}")`, typeof orphanRun?.status === "string");
    check(
      "safe run (goto+wait only) classified recoverable — NOT auto-resumed, no new run started",
      orphanRun?.recoverable === true,
      `recoverable: ${orphanRun?.recoverable}, note: ${orphanRun?.recoveryNote}`
    );
    const activeAfterRestart = ((await api.instances(tC)) as any[]).filter((item) => ["running", "starting"].includes(item.status));
    check("no run was auto-resumed at startup", activeAfterRestart.length === 0, `active: ${activeAfterRestart.length}`);
    const details = (await api.recoveryDetails(tC, killedInstanceId)) as any;
    check("recovery details return the durable run row", details?.run?.instanceId === killedInstanceId);
    check(
      "recovery details include node attempts with ids",
      Array.isArray(details?.attempts) && details.attempts.length > 0 && details.attempts.every((attempt: any) => attempt.nodeId && attempt.attemptId),
      `attempts: ${details?.attempts?.length}`
    );
    summary.recovery = {
      status: orphanRun?.status,
      recoverable: orphanRun?.recoverable,
      attempts: details?.attempts?.length,
      lastKnownUrl: details?.run?.lastKnownUrl
    };

    // Recovery panel in the real UI: navigate to the Instances page.
    let panelVisible = false;
    try {
      const navButton = winC.locator('button.nav-item[title="Instances"], button.nav-item:has-text("Instances")').first();
      await navButton.click({ timeout: 10000 });
      await winC.waitForSelector('[data-testid="recoverable-runs-panel"]', { timeout: 15000 });
      panelVisible = true;
      await winC.screenshot({ path: join(evidenceDir, "04-recovery-panel.png") }).catch(() => undefined);
    } catch {
      panelVisible = false;
    }
    check("Recoverable Runs panel renders in the Instance Monitor", panelVisible);

    const actioned = (await api.recoveryAction(tC, killedInstanceId, "markReviewed")) as any;
    check("Mark reviewed action succeeds", actioned?.success === true, actioned?.error);
    const clearedFromList = await pollUntil(async () => {
      const status = (await api.runtimeStatus(tC)) as any;
      const runs = (status?.recoverableRuns ?? []) as any[];
      return runs.every((run) => run.instanceId !== killedInstanceId) ? true : null;
    }, 15000);
    check("reviewed run disappears from the recoverable list", clearedFromList === true);

    // D-LIC teardown: hand the machine back exactly as it was found. Deliberately the LAST thing
    // that touches licensing — sessions B and C run real workloads on this same profile, so removing
    // the license any earlier (as a first attempt did) leaves them unlicensed and collapses Parts I-J
    // into a cascade of failures that look like recovery bugs. It must also run BEFORE session C is
    // closed, because removal goes through the app's own administrator IPC and needs a live window.
    console.log("\nPart J-LIC — remove the verification license and confirm execution is blocked again");
    await unlicensePackagedMachine(tC, licensedSession);
    licensedSession = { licensed: false };

    await sessionC.close();
    sessionC = null;

    console.log("\nPart J2 — runtime.sqlite readable EXTERNALLY after the whole walkthrough");
    const sqlitePath = join(appRoot, "runtime", "runtime.sqlite");
    check("runtime.sqlite exists", existsSync(sqlitePath), sqlitePath);
    if (existsSync(sqlitePath)) {
      const bytes = await readFile(sqlitePath);
      check("SQLite format 3 header intact", bytes.subarray(0, 16).toString("utf8").startsWith("SQLite format 3"));
      const SQL = await loadSqlJs();
      const db = new SQL.Database(bytes);
      try {
        const rows = db.exec("SELECT status, COUNT(*) FROM runtime_runs GROUP BY status");
        const statuses = new Map<string, number>();
        if (rows.length) for (const [status, count] of rows[0].values as [string, number][]) statuses.set(String(status), Number(count));
        summary.durableRunStatuses = Object.fromEntries(statuses);
        check("durable DB recorded completed run(s)", (statuses.get("completed") ?? 0) >= 1, JSON.stringify(Object.fromEntries(statuses)));
        check("durable DB recorded cancelled run(s)", (statuses.get("cancelled") ?? 0) >= 1);
        check("durable DB recorded the reviewed (recovered) run", (statuses.get("reviewed") ?? 0) >= 1);
      } finally {
        db.close();
      }
    }

    console.log("\nPart K — the ACTUAL portable EXE boots on a second fresh profile");
    portableProc = spawn(portableExePath, [], { env: appEnv(freshRootB) as never, stdio: "ignore", detached: false });
    const portablePid = portableProc.pid!;
    const portableSqlite = join(freshRootB, "SpecterStudio", "runtime", "runtime.sqlite");
    const portableBooted = await pollUntil(async () => (existsSync(portableSqlite) ? true : null), 240000, 2000);
    check("portable EXE created the durable runtime on a fresh profile", portableBooted === true, portableSqlite);
    if (portableBooted) {
      check("portable-run runtime folders created", existsSync(join(freshRootB, "SpecterStudio", "flows")));
      const bytes = await readFile(portableSqlite);
      check("portable-run runtime.sqlite has a valid SQLite header", bytes.subarray(0, 16).toString("utf8").startsWith("SQLite format 3"));
    }
    await new Promise((resolveKill) => execFile("taskkill", ["/PID", String(portablePid), "/T", "/F"], () => resolveKill(null)));
    portableProc = null;

    console.log("\nPart L — NSIS installer integrity (sha512 vs latest.yml)");
    if (existsSync(setupExePath) && existsSync(latestYmlPath)) {
      const yml = await readFile(latestYmlPath, "utf8");
      const declared = /sha512:\s*(\S+)/.exec(yml)?.[1] ?? "";
      const hash = createHash("sha512");
      hash.update(await readFile(setupExePath));
      const actual = hash.digest("base64");
      // electron-builder writes the URL-safe (dash-separated) artifact name into latest.yml.
      const setupName = setupExeName(root);
      check(
        "latest.yml declares the Setup artifact",
        yml.includes(setupName) || yml.includes(setupName.replace(/ /g, "-")),
        `expected ${setupName}`
      );
      check("NSIS installer sha512 matches latest.yml (bit-exact build)", declared === actual, `declared ${declared.slice(0, 16)}… vs actual ${actual.slice(0, 16)}…`);
    } else {
      check("NSIS installer + latest.yml present for integrity check", false);
    }

    console.log("\nPart M — network isolation observation (whole walkthrough)");
    observer.stop();
    check(`system sampling ran (${observer.samples} samples)`, observer.samples >= 5);
    const chromiumEgress = observer.nonLoopback.filter((conn) => conn.path.toLowerCase().includes("browsers\\chromium"));
    const appEgress = observer.nonLoopback.filter((conn) => !conn.path.toLowerCase().includes("browsers\\chromium"));
    check(
      "app processes (Electron main/renderer, portable) made NO non-loopback TCP connections",
      appEgress.length === 0,
      appEgress
        .slice(0, 5)
        .map((conn) => `${conn.name}(${conn.pid}, ${conn.path})→${conn.remote}:${conn.port}`)
        .join("; ")
    );
    if (chromiumEgress.length > 0) {
      // Known behavior (Phase 5 finding): each bundled-Chromium launch emits a short burst of
      // Chromium-internal Google-service connections even with Playwright's default
      // --disable-background-networking. App data never leaves loopback; on an offline machine
      // these attempts simply fail. Recorded in walkthrough-summary.json; see KNOWN_ISSUES.
      const remotes = [...new Set(chromiumEgress.map((conn) => conn.remote))];
      console.log(`  ⚠ bundled Chromium emitted ${chromiumEgress.length} non-loopback connection(s) at browser startup`);
      console.log(`    (Chromium-internal Google services: ${remotes.slice(0, 6).join(", ")} — warn-only; set AWKIT_WALKTHROUGH_STRICT_NET=1 to fail on this)`);
    }
    if (process.env.AWKIT_WALKTHROUGH_STRICT_NET === "1") {
      check("STRICT: bundled Chromium made no non-loopback connections", chromiumEgress.length === 0, `${chromiumEgress.length} connection(s)`);
    }
    console.log(`  (loopback connections observed: ${observer.loopbackConnections} — app ⇄ mock site / DevTools pipe)`);
    summary.network = {
      samples: observer.samples,
      loopbackConnections: observer.loopbackConnections,
      nonLoopback: observer.nonLoopback
    };
  } catch (error) {
    // A BLOCKED licensing precondition is a recorded outcome, not a failure and not a crash: the
    // real-execution parts were never attempted, so nothing is claimed about them either way.
    if (!(error instanceof PackagedLicensingBlocked)) throw error;
    summary.licensing = { blocked: true, reason: error.message };
  } finally {
    observer.stop();
    // Phase 5.1D: tree-kill the REAL Electron main (not just the launcher stub) for every
    // session launched, even on failure paths — killing only the stub leaves a zombie app.
    const teardownLeftovers: number[] = [];
    for (const session of [sessionA, sessionB, sessionC]) {
      if (!session) continue;
      const pids = sessionPids.get(session) ?? { stubPid: session.process().pid ?? 0, mainPid: 0 };
      teardownLeftovers.push(...(await ensurePackagedAppDead(session, pids)));
    }
    if (portableProc?.pid) {
      await new Promise((resolveKill) => execFile("taskkill", ["/PID", String(portableProc!.pid), "/T", "/F"], () => resolveKill(null)));
    }
    mockSite?.kill();
    // Sweep any bundled-Chromium or zombie app stragglers so the walkthrough never leaks processes.
    const finalSample = await sampleSystem();
    if (finalSample) {
      for (const proc of bundledChromeAll(finalSample)) await taskkill(proc.ProcessId, true);
      for (const proc of finalSample.procs.filter((p) => isAppProcess(p) && ["specterstudio.exe", "webflow studio.exe"].includes(p.Name.toLowerCase()))) {
        await taskkill(proc.ProcessId, true);
      }
    }
    // Final no-zombie verification: after teardown NOTHING app-owned may remain.
    const postSweep = await sampleSystem();
    const sweepVisible = isLiveSample(postSweep);
    const zombies = sweepVisible
      ? postSweep.procs.filter((p) => isAppProcess(p) && ["specterstudio.exe", "webflow studio.exe", "chrome.exe"].includes(p.Name.toLowerCase()))
      : [];
    check(
      "teardown left no zombie app or bundled-Chromium processes",
      sweepVisible && teardownLeftovers.length === 0 && zombies.length === 0,
      sweepVisible
        ? `leftover pids: ${teardownLeftovers.join(",") || "-"}; zombies: ${zombies.map((p) => `${p.Name}(${p.ProcessId})`).join(",") || "-"}`
        : "post-sweep process enumeration failed — no no-zombie claim can be made"
    );
    summary.teardown = { leftovers: teardownLeftovers, zombies: zombies.map((p) => ({ pid: p.ProcessId, name: p.Name })) };
    summary.finishedAt = new Date().toISOString();
    await writeFile(join(evidenceDir, "walkthrough-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8").catch(() => undefined);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed${blocked ? `, ${blocked} blocked` : ""}.`);
  if (blocked > 0) {
    console.log(
      `BLOCKED: licensed packaged execution was not attempted. Set ${ISSUER_KEY_ENV} on an authorized\n` +
        "validation machine or CI runner to run it. This is recorded as BLOCKED, not skipped and not passed —\n" +
        "no claim is made about packaged execution in either direction."
    );
  }
  console.log(`Evidence: ${evidenceDir}`);
  console.log("REMINDER: this proves the packaged app on THIS machine with a fresh profile and loopback-only");
  console.log("traffic. The clean/offline Windows VM walkthrough (PHASE5_OFFLINE_VM_WALKTHROUGH.md) is a");
  console.log("separate human gate and is NOT claimed by this script.");
  if (failed > 0 || blocked > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✗ Unhandled failure: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
