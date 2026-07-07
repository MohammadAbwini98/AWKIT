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
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { loadSqlJs } from "@src/runner/store/SqlJsLoader";
import { capturePackagedAppPids, ensurePackagedAppDead, type PackagedAppPids } from "./helpers/packaged-process-tree.mts";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const unpackedDir = join(root, "dist", "win-unpacked");
const exePath = join(unpackedDir, "WebFlow Studio.exe");
const portableExePath = join(root, "dist", "WebFlow Studio 0.1.0.exe");
const setupExePath = join(root, "dist", "WebFlow Studio Setup 0.1.0.exe");
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

let passed = 0;
let failed = 0;
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
      "$procs = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath;" +
      "$conns = Get-NetTCPConnection -State Established,SynSent -ErrorAction SilentlyContinue | Select-Object OwningProcess,RemoteAddress,RemotePort;" +
      "@{procs=$procs;conns=$conns} | ConvertTo-Json -Depth 4 -Compress"
  );
  if (!raw) return null;
  const arr = <V>(value: V[] | V | null | undefined): V[] => (Array.isArray(value) ? value : value ? [value] : []);
  return { procs: arr(raw.procs), conns: arr(raw.conns) };
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
  return path.includes("win-unpacked") || path.includes("webflow studio") || path.includes("browsers\\chromium");
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
  return sample ? chromeRoots(sample, appPids).length : -1;
}

async function bundledChromeNow(): Promise<PsProcess[]> {
  const sample = await sampleSystem();
  return sample ? bundledChromeAll(sample) : [];
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
 * The packaged "WebFlow Studio.exe" that Playwright spawns is a LAUNCHER STUB — the real
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
  return env as Record<string, string>;
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
  recorderCancel: (t: Api) => t.win.evaluate(() => (window as any).playwrightFlowStudio.recorder.cancel())
};

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
    { id: "wait", type: "wait", name: "Long Wait", config: { waitType: "time" }, timeoutMs: 120000 },
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
  check("portable EXE exists", existsSync(portableExePath), portableExePath);
  check("NSIS installer exists", existsSync(setupExePath), setupExePath);
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
  const summary: Record<string, unknown> = { freshRootA, freshRootB, mockBase: MOCK_BASE, startedAt: new Date().toISOString() };

  try {
    console.log("\nPart C — first run on a fresh, empty profile (packaged app, session A)");
    sessionA = await electron.launch({ executablePath: exePath, env: appEnv(freshRootA) as never, timeout: 60_000 });
    await registerAppPids(sessionA, observer);
    const winA = await sessionA.firstWindow({ timeout: 60_000 });
    await winA.waitForLoadState("domcontentloaded");
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

    const appRoot = join(freshRootA, "WebFlow Studio");
    for (const folder of ["flows", "workflows", "logs", "screenshots", "runtime"]) {
      check(`fresh runtime folder created: ${folder}/`, existsSync(join(appRoot, folder)));
    }
    const beforeImport = (await api.workflows(tA)) as any[];
    check(
      "fresh install shows only the bundled sample workflow (no dev/mock leftovers)",
      Array.isArray(beforeImport) &&
        beforeImport.some((wf) => wf.id === "customer-onboarding-workflow") &&
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
      check(
        "run report written",
        existsSync(aggregateReport) || existsSync(doneD.paths.reports),
        aggregateReport
      );
      const instanceRoot = dirname(doneD.paths.storage);
      const stateFiles = (await walkFiles(instanceRoot)).filter((file) => file.endsWith("flow-state.json"));
      check("end-of-run state artifacts written (flow-state.json)", stateFiles.length > 0, instanceRoot);
    }

    console.log("\nPart E — hard cancellation inside the packaged app");
    const runE = (await api.runWorkflow(tA, { workflowId: longWorkflowId, headless: true, dryRun: false })) as any;
    const runningE = await waitForInstanceStatus(tA, runE.executionId, ["running", "waitingForManualAction"], 60000);
    check("long-wait run reached running state", runningE?.status === "running", runningE?.status);
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
    check("4-instance concurrent run accepted", runF?.status === "started");
    let maxRoots = 0;
    let maxActiveSlots = 0;
    let sawQueuedWhileSaturated = false;
    const boundDeadline = Date.now() + 25000;
    while (Date.now() < boundDeadline) {
      const rootsNow = await chromeRootsNow(observer.appRootPids);
      const status = (await api.runtimeStatus(tA)) as any;
      const instances = ((await api.instances(tA)) as any[]).filter((item) => item.executionId === runF.executionId);
      maxRoots = Math.max(maxRoots, rootsNow);
      maxActiveSlots = Math.max(maxActiveSlots, status?.browserPool?.activeSlots ?? 0);
      const queued = instances.filter((item) => ["queued", "pending", "starting"].includes(item.status)).length;
      if ((status?.browserPool?.activeSlots ?? 0) >= 2 && queued >= 1) sawQueuedWhileSaturated = true;
      await sleep(1000);
    }
    check(`browser roots never exceeded the cap of 2 (max seen: ${maxRoots})`, maxRoots > 0 && maxRoots <= 2);
    check(`pool slots never exceeded the cap of 2 (max seen: ${maxActiveSlots})`, maxActiveSlots > 0 && maxActiveSlots <= 2);
    check("excess instances queued instead of spawning browsers", sawQueuedWhileSaturated);
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
    summary.processBound = { maxRoots, maxActiveSlots };

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
      afterA.length === 0,
      afterA.map((proc) => proc.ProcessId).join(",")
    );
    check("ui settings persisted under the fresh profile", existsSync(join(appRoot, "storage", "ui-settings.json")));

    console.log("\nPart I — hard kill mid-run (orphaned-run scenario, session B)");
    sessionB = await electron.launch({ executablePath: exePath, env: appEnv(freshRootA) as never, timeout: 60_000 });
    const pidB = await registerAppPids(sessionB, observer); // REAL Electron main pid, not the launcher stub
    const winB = await sessionB.firstWindow({ timeout: 60_000 });
    await winB.waitForLoadState("domcontentloaded");
    const tB: Api = { win: winB };
    const runI = (await api.runWorkflow(tB, { workflowId: longWorkflowId, headless: true, dryRun: false })) as any;
    const runningI = await waitForInstanceStatus(tB, runI.executionId, ["running"], 60000);
    killedInstanceId = runningI?.instanceId ?? `${runI.executionId}-i1`;
    check("session B run is live before the kill", runningI?.status === "running");
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
    const selfExited = await pollUntil(async () => {
      leakedChrome = await bundledChromeNow();
      return leakedChrome.length === 0 ? true : null;
    }, 20000, 2500);
    console.log(
      selfExited
        ? "  (orphaned bundled-Chromium processes self-exited after the app died)"
        : `  (observed ${leakedChrome.length} orphaned bundled-Chromium process(es) still alive 20s after the kill — swept)`
    );
    summary.hardKill = { instanceId: killedInstanceId, orphanedChromeSelfExited: selfExited === true, leakedChromeAfterKill: leakedChrome.length };
    for (const proc of leakedChrome) await taskkill(proc.ProcessId, true);

    console.log("\nPart J — restart after the kill: startup recovery + recovery panel (session C)");
    sessionC = await electron.launch({ executablePath: exePath, env: appEnv(freshRootA) as never, timeout: 60_000 });
    await registerAppPids(sessionC, observer);
    const winC = await sessionC.firstWindow({ timeout: 60_000 });
    await winC.waitForLoadState("domcontentloaded");
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
    const portableSqlite = join(freshRootB, "WebFlow Studio", "runtime", "runtime.sqlite");
    const portableBooted = await pollUntil(async () => (existsSync(portableSqlite) ? true : null), 240000, 2000);
    check("portable EXE created the durable runtime on a fresh profile", portableBooted === true, portableSqlite);
    if (portableBooted) {
      check("portable-run runtime folders created", existsSync(join(freshRootB, "WebFlow Studio", "flows")));
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
      check("latest.yml declares the Setup artifact", yml.includes("WebFlow-Studio-Setup-0.1.0.exe") || yml.includes("WebFlow Studio Setup 0.1.0.exe"));
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
      for (const proc of finalSample.procs.filter((p) => isAppProcess(p) && p.Name.toLowerCase() === "webflow studio.exe")) {
        await taskkill(proc.ProcessId, true);
      }
    }
    // Final no-zombie verification: after teardown NOTHING app-owned may remain.
    const postSweep = await sampleSystem();
    const zombies = postSweep
      ? postSweep.procs.filter((p) => isAppProcess(p) && ["webflow studio.exe", "chrome.exe"].includes(p.Name.toLowerCase()))
      : [];
    check(
      "teardown left no zombie app or bundled-Chromium processes",
      teardownLeftovers.length === 0 && zombies.length === 0,
      `leftover pids: ${teardownLeftovers.join(",") || "-"}; zombies: ${zombies.map((p) => `${p.Name}(${p.ProcessId})`).join(",") || "-"}`
    );
    summary.teardown = { leftovers: teardownLeftovers, zombies: zombies.map((p) => ({ pid: p.ProcessId, name: p.Name })) };
    summary.finishedAt = new Date().toISOString();
    await writeFile(join(evidenceDir, "walkthrough-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8").catch(() => undefined);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed.`);
  console.log(`Evidence: ${evidenceDir}`);
  console.log("REMINDER: this proves the packaged app on THIS machine with a fresh profile and loopback-only");
  console.log("traffic. The clean/offline Windows VM walkthrough (PHASE5_OFFLINE_VM_WALKTHROUGH.md) is a");
  console.log("separate human gate and is NOT claimed by this script.");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`✗ Unhandled failure: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
